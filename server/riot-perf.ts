/**
 * P1-Dynamic Performance Pricing Pipeline — v2
 *
 * Every 10 minutes, processes a batch of riot_assets players:
 * 1. Fetch last 10 match IDs from Riot match-v5
 * 2. For each unseen matchId: fetch detail, compute CompositeMatchScore (0-100)
 *    using 3-component model: RoleRelativeScore + SelfTrendScore + ContextScore
 * 3. EMA-smooth score into riot_player_state.emaPerf
 * 4. Run valuationJob to update PVI / FairValue
 * 5. MarketPrice is moved exclusively by AMM trades + gravity (never directly here)
 *
 * Rate limiting: token-bucket targeting ≤15 req/s and ≤90 req/2min.
 */

import { db } from "./db";
import { riotAssets, riotMatchCache, riotPlayerState, assets } from "@shared/schema";
import { eq, sql, inArray, desc } from "drizzle-orm";
import {
  detectRole,
  extractMetrics,
  computeMatchScore,
  computeRoleRelativeScore,
  computeSelfTrendScore,
  computeContextScore,
  computeCompositeMatchScore,
  applyEMA,
  applyEMAWithClamp,
  computePerformanceImpact,
  getLatestEma,
  storeMatchPerformance,
  seedDefaultBaselines,
  PERF_ENGINE_CONFIG,
} from "./services/performanceEngine";
import { getRiotApiKey } from "./app-config";
import { computeAndPersistValuation } from "./services/valuationJob";

// ─────────────────────────────────────────────────────────────
//  Rate limiter — token bucket (15 tok/s, burst 15; 90 tok/2min)
// ─────────────────────────────────────────────────────────────
const RATE = { perSecond: 14, per2Min: 85 }; // safety margins

const bucket = {
  tokens: RATE.perSecond,
  last: Date.now(),
  window2min: [] as number[], // timestamps of recent requests
};

async function throttledFetch(url: string): Promise<Response> {
  const now = Date.now();

  // Remove timestamps older than 2 min from sliding window
  bucket.window2min = bucket.window2min.filter(t => now - t < 120_000);

  // Block if 2-min budget exhausted
  if (bucket.window2min.length >= RATE.per2Min) {
    const oldest = bucket.window2min[0];
    const waitMs = 120_000 - (now - oldest) + 500;
    console.log(`[RiotPerf] 2-min rate limit: waiting ${Math.ceil(waitMs / 1000)}s`);
    await sleep(waitMs);
    return throttledFetch(url);
  }

  // Token bucket refill
  const elapsed = (Date.now() - bucket.last) / 1000;
  bucket.tokens = Math.min(RATE.perSecond, bucket.tokens + elapsed * RATE.perSecond);
  bucket.last = Date.now();

  if (bucket.tokens < 1) {
    const waitMs = ((1 - bucket.tokens) / RATE.perSecond) * 1000 + 50;
    await sleep(waitMs);
    bucket.tokens = 0;
    bucket.last = Date.now();
  } else {
    bucket.tokens -= 1;
  }

  bucket.window2min.push(Date.now());

  const apiKey = await getRiotApiKey();
  if (!apiKey) throw new Error("RIOT_API_KEY_NOT_CONFIGURED");

  const res = await fetch(url, { headers: { "X-Riot-Token": apiKey } });

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get("Retry-After") || "10", 10);
    console.warn(`[RiotPerf] 429 rate limited — sleeping ${retryAfter}s`);
    await sleep(retryAfter * 1000);
    return throttledFetch(url);
  }

  if (res.status === 404) return res;
  if (!res.ok) throw new Error(`Riot API ${res.status}: ${res.statusText} — ${url}`);
  return res;
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

// ─────────────────────────────────────────────────────────────
//  Helper: compute EMA of recent perfScores for SelfTrendScore
//  Uses existing riotMatchCache entries (before the current match)
// ─────────────────────────────────────────────────────────────
async function getRecentPerfEma(puuid: string): Promise<number> {
  const rows = await db
    .select({ perfScore: riotMatchCache.perfScore })
    .from(riotMatchCache)
    .where(eq(riotMatchCache.puuid, puuid))
    .orderBy(desc(riotMatchCache.processedAt))
    .limit(PERF_ENGINE_CONFIG.SELF_TREND_WINDOW);

  if (rows.length === 0) return 50; // default neutral

  // Reverse to oldest-first, then compute EMA
  const scores = rows.reverse().map(r => parseFloat(r.perfScore));
  let ema = scores[0];
  for (let i = 1; i < scores.length; i++) {
    ema = applyEMAWithClamp(ema, scores[i], 0.30, 20);
  }
  return ema;
}

// ─────────────────────────────────────────────────────────────
//  Process a single player
// ─────────────────────────────────────────────────────────────
async function processPlayer(asset: typeof riotAssets.$inferSelect): Promise<void> {
  const { puuid } = asset;

  // 1. Fetch recent match IDs
  const matchListUrl = `https://americas.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?start=0&count=10&queue=420`;
  const matchListRes = await throttledFetch(matchListUrl);
  if (matchListRes.status === 404) {
    console.warn(`[RiotPerf] 404 for matchlist puuid=${puuid.slice(0, 12)}...`);
    return;
  }
  const matchIds: string[] = await matchListRes.json();
  if (!Array.isArray(matchIds) || matchIds.length === 0) return;

  // 2. Find which matchIds are not in cache
  const cached = await db
    .select({ matchId: riotMatchCache.matchId })
    .from(riotMatchCache)
    .where(inArray(riotMatchCache.matchId, matchIds));
  const cachedSet = new Set(cached.map(r => r.matchId));
  const newMatchIds = matchIds.filter(id => !cachedSet.has(id)).slice(0, 5); // max 5 new per run

  // 3. Process each new match
  let latestMatchScore: number | null = null;
  let latestRole: string = "MID";

  for (const matchId of newMatchIds) {
    try {
      const matchRes = await throttledFetch(
        `https://americas.api.riotgames.com/lol/match/v5/matches/${matchId}`
      );
      if (matchRes.status === 404) continue;
      const match = await matchRes.json();

      const info = match.info;
      if (!info) continue;
      const durationMin = (info.gameDuration || 0) / 60;
      if (durationMin < 5) continue; // skip remakes

      const participant = (info.participants || []).find((p: any) => p.puuid === puuid);
      if (!participant) continue;

      // Compute team kills for kill participation
      const teamId = participant.teamId;
      const teamKills = (info.participants || [])
        .filter((p: any) => p.teamId === teamId)
        .reduce((sum: number, p: any) => sum + (p.kills || 0), 0);

      // Role detection (T002)
      const role = detectRole(participant.teamPosition, participant.individualPosition);
      latestRole = role;

      // Metric extraction (T002)
      const metrics = extractMetrics(role, {
        kills: participant.kills || 0,
        deaths: participant.deaths || 0,
        assists: participant.assists || 0,
        totalDamageDealtToChampions: participant.totalDamageDealtToChampions || 0,
        goldEarned: participant.goldEarned || 0,
        visionScore: participant.visionScore || 0,
        totalMinionsKilled: participant.totalMinionsKilled || 0,
        neutralMinionsKilled: participant.neutralMinionsKilled || 0,
        wardsPlaced: participant.wardsPlaced || 0,
        wardsKilled: participant.wardsKilled || 0,
        win: participant.win || false,
      }, teamKills, durationMin);

      // Z-score match score (T002)
      const matchScore = await computeMatchScore(metrics, role, "LOL");

      // ── Composite Match Score (0-100): RRS + STS + CTX ──────────────────────
      // Component 1: RoleRelativeScore — z-score vs Challenger baseline, normalized to [0,100]
      const roleRelativeScore = computeRoleRelativeScore(matchScore);

      // Component 2: SelfTrendScore — compare this game vs player's own recent EMA
      // Load BEFORE inserting this match so we compare against prior history only
      const prevPerfEma = await getRecentPerfEma(puuid);
      const selfTrendScore = computeSelfTrendScore(roleRelativeScore, prevPerfEma);

      // Component 3: ContextScore — win/loss + match duration weight
      const contextScore = computeContextScore(participant.win || false, durationMin);

      // Composite: RRS×0.60 + STS×0.25 + CTX×0.15
      const compositeScore = computeCompositeMatchScore(roleRelativeScore, selfTrendScore, contextScore);

      // Load previous z-score EMA for performanceScores table (legacy audit trail)
      const prevEma = await getLatestEma(puuid);
      const newEma = applyEMA(prevEma, matchScore, PERF_ENGINE_CONFIG.EMA_ALPHA);

      // Store z-score match detail to playerMatchMetrics + performanceScores
      await storeMatchPerformance(puuid, matchId, role, metrics, matchScore, newEma);

      // Store composite score (0-100) to riotMatchCache — this feeds the PVI/FairValue pipeline
      const position = participant.teamPosition || participant.individualPosition || "MIDDLE";
      await db
        .insert(riotMatchCache)
        .values({
          matchId,
          puuid,
          gameStartTimestamp: String(info.gameStartTimestamp || 0),
          teamPosition: position,
          perfScore: compositeScore.toFixed(2),
        })
        .onConflictDoNothing();

      latestMatchScore = matchScore; // keep z-score for momentum calculation

      if (process.env.NODE_ENV !== "production") {
        console.log(
          `[RiotPerf] Match ${matchId.slice(0, 8)}: ` +
          `rrs=${roleRelativeScore.toFixed(1)} sts=${selfTrendScore.toFixed(1)}(prevEma=${prevPerfEma.toFixed(1)}) ` +
          `ctx=${contextScore.toFixed(1)} → composite=${compositeScore.toFixed(1)}`
        );
      }

    } catch (err: any) {
      console.warn(`[RiotPerf] Error processing match ${matchId}: ${err.message}`);
    }
  }

  // 4. Load player state (needed for EMA perf + daily circuit breaker)
  const [state] = await db
    .select()
    .from(riotPlayerState)
    .where(eq(riotPlayerState.puuid, puuid));

  // 5. Get latest EMA score from new performance engine (z-score space, [-10,+10])
  const emaScore = await getLatestEma(puuid);

  // Fallback: if no z-score data yet, use legacy PP-based EMA from riotPlayerState
  const legacyEma = state ? parseFloat(state.emaPerf) : 50;

  // 6. Compute price impact using 60/30/10 driver formula
  const currentPrice = parseFloat(asset.lastTradePrice);

  // 6a. Performance impact (60% weight): from z-score EMA [-10,+10] → pct [-1.5%,+1.5%]
  const performanceImpact = computePerformanceImpact(emaScore); // already clamped ±1.5%

  // 6b. Order flow impact (30% weight): proxy from recent momentum (momentum is already %)
  const assetMomentum = parseFloat(asset.momentum) || 0;
  const orderFlowImpact = Math.max(-0.01, Math.min(0.01, assetMomentum / 1000)); // scaled to ±1%

  // 6c. Minor factors (10% weight): win rate influence
  const winrate = parseFloat(asset.winrate) / 100; // 0-1
  const minorFactors = Math.max(-0.005, Math.min(0.005, (winrate - 0.5) * 0.02));

  // 6d. Combine with weights and clamp max tick move ±3%
  let priceChangePct = (performanceImpact * 0.60) + (orderFlowImpact * 0.30) + (minorFactors * 0.10);
  priceChangePct = Math.max(-0.03, Math.min(0.03, priceChangePct)); // maxTickMove ±3%

  let newPrice = currentPrice * (1 + priceChangePct);

  // 6e. Keep fair price for fundamentalPrice using legacy EMA (used for market drift)
  const fair = 10 + (legacyEma / 100) * 20;

  // 7. Daily circuit breaker: ±15% of dayStartPrice
  const todayStr = new Date().toISOString().slice(0, 10);
  let dayStartPrice = currentPrice;

  if (state) {
    const storedDate = typeof state.dayStartDate === "string" ? state.dayStartDate : String(state.dayStartDate);
    if (storedDate === todayStr) {
      dayStartPrice = parseFloat(state.dayStartPrice);
    } else {
      dayStartPrice = currentPrice;
    }
  }

  const maxUp = dayStartPrice * 1.15;   // maxDailyMove +15%
  const maxDown = dayStartPrice * 0.85; // maxDailyMove -15%
  newPrice = Math.max(maxDown, Math.min(maxUp, newPrice));
  newPrice = Math.max(6, Math.min(40, newPrice)); // global price bounds

  // 8. Compute momentum
  const price24hAgo = parseFloat(asset.price24hAgo);
  const momentum = price24hAgo > 0 ? ((newPrice - price24hAgo) / price24hAgo) * 100 : 0;
  const dailyChangePct = dayStartPrice > 0 ? ((newPrice - dayStartPrice) / dayStartPrice) * 100 : 0;

  // 9. Update legacy EMA perf using PP system (still needed for fundamentalPrice)
  const recentScores = await db
    .select({ perfScore: riotMatchCache.perfScore })
    .from(riotMatchCache)
    .where(eq(riotMatchCache.puuid, puuid))
    .orderBy(sql`${riotMatchCache.processedAt} DESC`)
    .limit(5);

  let newLegacyEma = legacyEma;
  if (recentScores.length > 0) {
    const latestPP = parseFloat(recentScores[0].perfScore);
    newLegacyEma = 0.2 * latestPP + 0.8 * legacyEma;
  }

  // 10. Upsert player state
  await db
    .insert(riotPlayerState)
    .values({
      puuid,
      emaPerf: newLegacyEma.toFixed(2),
      dayStartPrice: dayStartPrice.toFixed(2),
      dayStartDate: todayStr,
      dailyChangePct: dailyChangePct.toFixed(4),
    })
    .onConflictDoUpdate({
      target: riotPlayerState.puuid,
      set: {
        emaPerf: newLegacyEma.toFixed(2),
        dayStartPrice: dayStartPrice.toFixed(2),
        dayStartDate: todayStr,
        dailyChangePct: dailyChangePct.toFixed(4),
        updatedAt: new Date(),
      },
    });

  // 11. Update riot_assets momentum ONLY — market price is now exclusively moved by
  //     the AMM (trades + market-maker gravity). Performance does NOT update lastTradePrice.
  await db
    .update(riotAssets)
    .set({
      momentum: momentum.toFixed(4),
      updatedAt: new Date(),
    })
    .where(eq(riotAssets.puuid, puuid));

  // 12. Compute and persist PVI / Fair Value via the valuation job.
  //     This also writes fairValueGS → assets.fundamentalPrice for backward compat.
  try {
    await computeAndPersistValuation(puuid);
  } catch (err: any) {
    console.warn(`[RiotPerf] ValuationJob error for ${puuid.slice(0, 12)}...: ${err.message}`);
  }

  console.log(
    `[RiotPerf] ${asset.gameName}#${asset.tagLine}: ` +
    `ema_z=${emaScore.toFixed(2)}σ perfImpact=${(performanceImpact * 100).toFixed(3)}% ` +
    `(price unchanged — moved only by AMM + gravity)`
  );
}

// ─────────────────────────────────────────────────────────────
//  Batch job — processes BATCH_SIZE players per run
// ─────────────────────────────────────────────────────────────
const BATCH_SIZE = 10;
let perfJobRunning = false;
let lastRunAt: Date | null = null;
let lastRunErrors = 0;
let lastRunProcessed = 0;

export async function runPerfPricingJob(): Promise<{ processed: number; errors: number }> {
  if (perfJobRunning) {
    console.log("[RiotPerf] Job already running, skipping.");
    return { processed: 0, errors: 0 };
  }

  const _perfKey = await getRiotApiKey();
  if (!_perfKey) {
    console.log("[RiotPerf] RIOT_API_KEY not configured — skipping perf job.");
    return { processed: 0, errors: 0 };
  }

  perfJobRunning = true;
  let processed = 0;
  let errors = 0;

  try {
    // Rotate through players: order by updatedAt ASC so least recently updated goes first
    const players = await db
      .select()
      .from(riotAssets)
      .orderBy(sql`${riotAssets.updatedAt} ASC`)
      .limit(BATCH_SIZE);

    if (players.length === 0) {
      console.log("[RiotPerf] No riot_assets found — skipping.");
      return { processed: 0, errors: 0 };
    }

    console.log(`[RiotPerf] Processing batch of ${players.length} players...`);

    for (const player of players) {
      try {
        await processPlayer(player);
        processed++;
      } catch (err: any) {
        errors++;
        console.error(`[RiotPerf] Failed player ${player.gameName}: ${err.message}`);
      }
    }
  } finally {
    perfJobRunning = false;
    lastRunAt = new Date();
    lastRunErrors = errors;
    lastRunProcessed = processed;
  }

  console.log(`[RiotPerf] Batch done: processed=${processed} errors=${errors}`);
  return { processed, errors };
}

// ─────────────────────────────────────────────────────────────
//  Scheduler
// ─────────────────────────────────────────────────────────────
const JOB_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
// In production containers can restart frequently — run sooner
const INITIAL_DELAY_MS = process.env.NODE_ENV === "production" ? 30_000 : 2 * 60 * 1000;
let schedulerStarted = false;

export function startPerfPricingScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  // Seed default baselines on startup (idempotent)
  seedDefaultBaselines().catch((err) => console.error("[RiotPerf] Seed error:", err));

  const loop = async () => {
    console.log("[RiotPerf] Running P1 pricing batch...");
    try {
      const result = await runPerfPricingJob();
      console.log(`[RiotPerf] Perf batch completed: processed=${result.processed} errors=${result.errors}`);
    } catch (err: any) {
      console.error("[RiotPerf] Scheduler error:", err.message);
    }
    setTimeout(loop, JOB_INTERVAL_MS);
  };

  const delaySec = Math.round(INITIAL_DELAY_MS / 1000);
  setTimeout(loop, INITIAL_DELAY_MS);
  console.log(`[RiotPerf] Performance pricing scheduler started (first run in ${delaySec}s, then every 10 min).`);
}

export function getPerfJobStatus() {
  return {
    running: perfJobRunning,
    lastRunAt,
    lastRunProcessed,
    lastRunErrors,
  };
}

export async function getMatchCacheCount(): Promise<number> {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(riotMatchCache);
  return Number(row?.count ?? 0);
}

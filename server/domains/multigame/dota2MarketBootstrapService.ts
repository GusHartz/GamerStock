// ─── Dota2 Market Bootstrap Service ──────────────────────────────────────────
//
// Populates the Terminal with an initial supply of Dota2 player assets
// sourced from the OpenDota /api/proPlayers endpoint (no Steam OAuth, no API key).
//
// Design rules (Fase 24):
//  1. Bootstrap = one-time seed of the initial universe
//  2. Continuous operation = maintenance of EXISTING assets only
//  3. No Steam connect, no user claim flows, no auto-discovery after bootstrap
//  4. Assets created here are "house supply" owned by the platform
//
// assetUid format: "dota2:dota2:player:{accountId32}"
//   → matches isDota2 check in market routes (uid.startsWith("dota2:"))
//   → matches getAssetGame() helper in frontend ([1] → "dota2")
//
// Source endpoint: GET https://api.opendota.com/api/proPlayers
//   Returns ~2000 professional players with account_id, name, team_name, avatar
//   No pagination needed — the full list is returned in a single call
// ─────────────────────────────────────────────────────────────────────────────

import { db } from "../../db";
import { like, and, eq, count as drizzleCount } from "drizzle-orm";
import { supplyForPrice, DEFAULT_AMM_PARAMS } from "../../services/ammPricing";
import { getOrCreateMarket } from "../../market-core/asset-registry";
import {
  assets,
  assetMarkets,
  assetMarketState,
  assetPriceSnapshots,
  dota2ValuationState,
  dota2ValueHistory,
} from "@shared/schema";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BootstrapOptions {
  /** Max players to seed total (default: 100) */
  limit?: number;
  /** Only include players with a team (default: false) */
  activeOnly?: boolean;
  /** Abort if more than this many Dota2 assets already exist (default: 10) */
  skipIfExistingAbove?: number;
  /** Initial price for all assets (default: 15.00) */
  basePrice?: string;
}

export interface BootstrapResult {
  created: number;
  skipped: number;
  errors: string[];
  durationMs: number;
}

export interface BootstrapStatusResult {
  totalDota2Assets: number;
  listed: number;
  active: number;
  withFundamentalPrice: number;
  withLastTradePrice: number;
  withAmmSeeded: number;
}

// ── OpenDota proPlayers response shape ────────────────────────────────────────

interface ProPlayer {
  account_id:      number;
  steamid:         string;
  name:            string | null;
  personaname:     string | null;
  team_id:         number | null;
  team_name:       string | null;
  team_tag:        string | null;
  avatar:          string | null;
  avatarfull:      string | null;
  last_match_time: string | null;
  is_pro:          boolean | null;
  loccountrycode:  string | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const OPENDOTA_BASE = "https://api.opendota.com/api";

// ── Fetch pro players ─────────────────────────────────────────────────────────

// Module-level cache for proPlayers list (valid for 60 minutes)
let _proPlayersCache: ProPlayer[] | null = null;
let _proPlayersCacheAt = 0;
const PRO_PLAYERS_CACHE_TTL_MS = 60 * 60 * 1000;

async function fetchProPlayers(): Promise<ProPlayer[]> {
  const now = Date.now();
  if (_proPlayersCache && now - _proPlayersCacheAt < PRO_PLAYERS_CACHE_TTL_MS) {
    console.log(`[Dota2Bootstrap] proPlayers cache hit (${_proPlayersCache.length} players)`);
    return _proPlayersCache;
  }

  // Retry up to 3 times with exponential backoff on 429
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      const delay = attempt * 5000;
      console.log(`[Dota2Bootstrap] Retry ${attempt}/3 fetchProPlayers (${delay}ms delay)...`);
      await new Promise(r => setTimeout(r, delay));
    }
    console.log("[Dota2Bootstrap] Fetching proPlayers from OpenDota...");
    const res = await fetch(`${OPENDOTA_BASE}/proPlayers`, {
      headers: { "Accept": "application/json" },
      signal:  AbortSignal.timeout(30_000),
    });
    if (res.status === 429) {
      console.warn("[Dota2Bootstrap] proPlayers rate-limited (429), will retry...");
      continue;
    }
    if (!res.ok) {
      throw new Error(`OPENDOTA_HTTP_${res.status}: /api/proPlayers`);
    }
    const data = (await res.json()) as ProPlayer[];
    _proPlayersCache   = data;
    _proPlayersCacheAt = Date.now();
    console.log(`[Dota2Bootstrap] Fetched ${data.length} pro players (cached for 60min)`);
    return data;
  }
  throw new Error("OPENDOTA_RATE_LIMITED: /api/proPlayers (all 3 retries exhausted)");
}

// ── Compute display name ──────────────────────────────────────────────────────

function buildDisplayName(p: ProPlayer): string {
  const tag = p.name?.trim() || p.personaname?.trim() || null;
  if (!tag) return `Dota2Pro#${p.account_id}`;
  const team = p.team_tag?.trim();
  if (team) return `[${team}] ${tag}`;
  return tag;
}

// ── Seed a single player asset ────────────────────────────────────────────────

async function seedPlayer(
  p: ProPlayer,
  marketId: number,
  priceStr: string,
): Promise<"created" | "skipped"> {
  const accountId32 = String(p.account_id);
  const assetUid    = `dota2:dota2:player:${accountId32}`;
  const displayName = buildDisplayName(p);
  const price       = parseFloat(priceStr);

  // ── Idempotency: skip if already exists ───────────────────────────────────
  const [existing] = await db
    .select({ id: assets.id })
    .from(assets)
    .where(eq(assets.assetUid, assetUid))
    .limit(1);

  if (existing) return "skipped";

  // ── 1. Create asset ───────────────────────────────────────────────────────
  const [asset] = await db.insert(assets).values({
    marketId,
    assetUid,
    entityType:           "player",
    externalId:           accountId32,
    displayName,
    symbol:               "",
    lastTradePrice:       priceStr,
    price24hAgo:          priceStr,
    fundamentalPrice:     priceStr,
    fundamentalUpdatedAt: new Date(),
    volume24h:            "0.00",
    momentum:             "0.0000",
    tradingStatus:        "ACTIVE",
    listingStatus:        "LISTED",
  } as any).returning({ id: assets.id });

  const assetId = asset.id;

  // ── 2. Seed AMM market ────────────────────────────────────────────────────
  await db.insert(assetMarkets).values({
    assetId,
    isEnabled:           true,
    floorPrice:          "5.000000",
    paramA:              "5.000000",
    paramB:              "100.000000",
    feeBps:              100,
    platformFeeSplitBps: 7000,
    playerFeeSplitBps:   3000,
  }).onConflictDoNothing();

  const supply = supplyForPrice(price, DEFAULT_AMM_PARAMS);
  await db.insert(assetMarketState).values({
    assetId,
    supply:    supply.toFixed(6),
    lastPrice: priceStr,
    version:   1,
  }).onConflictDoNothing();

  // ── 3. Initial price snapshot ─────────────────────────────────────────────
  await db.insert(assetPriceSnapshots).values({
    assetId,
    price:     priceStr,
    volume24h: "0.00",
    momentum:  "0.0000",
  });

  console.log(`[Dota2Bootstrap] Created uid=${assetUid} name="${displayName}" team="${p.team_name || "–"}"`);
  return "created";
}

// ── Main bootstrap ─────────────────────────────────────────────────────────────

export async function bootstrapDota2Market(
  opts: BootstrapOptions = {},
): Promise<BootstrapResult> {
  const t0             = Date.now();
  const limit          = opts.limit ?? 100;
  const skipThreshold  = opts.skipIfExistingAbove ?? 10;
  const basePrice      = opts.basePrice ?? "15.00";
  const activeOnly     = opts.activeOnly ?? false;

  // ── Safety guard: abort if market already substantially populated ─────────
  const [{ n }] = await db
    .select({ n: drizzleCount() })
    .from(assets)
    .where(like(assets.assetUid, "dota2:%"));

  const existingCount = Number(n);
  if (existingCount > skipThreshold) {
    console.log(
      `[Dota2Bootstrap] Skipping — ${existingCount} Dota2 assets already exist ` +
      `(threshold=${skipThreshold}). Pass force=true to override.`
    );
    return { created: 0, skipped: existingCount, errors: [], durationMs: Date.now() - t0 };
  }

  // ── Ensure Dota2 market row exists (create if missing) ─────────────────────
  const market = await getOrCreateMarket({
    provider: "steam",
    game: "dota2",
    region: "global",
    scope: "default",
    entityType: "player",
    externalId: "dota2-global",
    displayName: "Dota2 Global",
    symbol: "",
  });

  const marketId = market.id;

  // ── Fetch player list from OpenDota ──────────────────────────────────────
  let players: ProPlayer[];
  try {
    players = await fetchProPlayers();
  } catch (err: any) {
    return { created: 0, skipped: 0, errors: [`Fetch failed: ${err.message}`], durationMs: Date.now() - t0 };
  }

  // ── Filter: optional activeOnly (has team_id + recent match) ─────────────
  let candidates = players.filter(p => {
    if (!p.account_id) return false;
    if (activeOnly && !p.team_id) return false;
    return true;
  });

  // Prefer players with a name and team (better display quality)
  candidates.sort((a, b) => {
    const aScore = (a.team_id ? 2 : 0) + (a.name ? 1 : 0);
    const bScore = (b.team_id ? 2 : 0) + (b.name ? 1 : 0);
    return bScore - aScore;
  });

  // Apply limit
  candidates = candidates.slice(0, limit);
  console.log(`[Dota2Bootstrap] Will seed ${candidates.length} players (limit=${limit})`);

  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const p of candidates) {
    try {
      const result = await seedPlayer(p, marketId, basePrice);
      if (result === "created") created++;
      else skipped++;
    } catch (err: any) {
      const msg = `accountId=${p.account_id} (${p.name}): ${err.message}`;
      console.error(`[Dota2Bootstrap] Error: ${msg}`);
      errors.push(msg);
    }

    // Polite delay — avoid thundering herd on DB
    await new Promise(r => setTimeout(r, 5));
  }

  const durationMs = Date.now() - t0;
  console.log(
    `[Dota2Bootstrap] Done — created=${created} skipped=${skipped} ` +
    `errors=${errors.length} duration=${durationMs}ms`
  );

  return { created, skipped, errors, durationMs };
}

// ── Status query ──────────────────────────────────────────────────────────────

export async function getBootstrapStatus(): Promise<BootstrapStatusResult> {
  const rows = await db
    .select({
      id:               assets.id,
      listingStatus:    assets.listingStatus,
      tradingStatus:    assets.tradingStatus,
      fundamentalPrice: assets.fundamentalPrice,
      lastTradePrice:   assets.lastTradePrice,
    })
    .from(assets)
    .where(like(assets.assetUid, "dota2:%"));

  const totalDota2Assets = rows.length;
  const listed           = rows.filter(r => r.listingStatus === "LISTED").length;
  const active           = rows.filter(r => r.tradingStatus === "ACTIVE").length;
  const withFundamental  = rows.filter(r => r.fundamentalPrice != null).length;
  const withLastTrade    = rows.filter(r => r.lastTradePrice != null).length;

  // Count assets that have AMM seeded
  const ammRows = await db
    .select({ assetId: assetMarkets.assetId })
    .from(assetMarkets)
    .innerJoin(assets, eq(assets.id, assetMarkets.assetId));

  const dota2AmmSet = new Set(ammRows.map(r => r.assetId));
  const withAmmSeeded = rows.filter(r => dota2AmmSet.has(r.id)).length;

  return {
    totalDota2Assets,
    listed,
    active,
    withFundamentalPrice: withFundamental,
    withLastTradePrice:   withLastTrade,
    withAmmSeeded,
  };
}

// ── Real-data enrichment (Fase 25) ────────────────────────────────────────────
//
// Full-pipeline enrichment for bootstrapped Dota2 assets:
//   1. GET /api/players/{id}/wl         → wins, losses  (eligibility + real WR)
//   2. GET /api/players/{id}            → MMR / rank    (real mmrNorm)
//   3. GET /api/players/{id}/recentMatches → last 20    (real momentum)
//
// Eligibility: WL accessible AND wins+losses >= MIN_GAMES_THRESHOLD
//   → Ineligible assets → tradingStatus="PAUSED", listingStatus="UNDER_REVIEW"
//   → No artificial performance for ineligible players
//
// Full formula (all 3 real components — no neutral assumptions):
//   mmrNorm     = clamp(mmr / 12000, 0, 1)           ← real MMR
//   wrNorm      = clamp((winRate - 0.5) / 0.2, -1, 1) ← real win rate
//   gamesFactor = clamp(log10(totalGames+1) / 3, 0, 1) ← real game count
//   initialValue = clamp(8 + 10*mmrNorm + 3*wrNorm + 2*gamesFactor, 6, 25)
//   playerValue  = initialValue × (0.60 + 0.40 × confidenceScore)
//
// Momentum (real — not neutral):
//   recentWR  = wins-in-last-20 / 20
//   momentum  = clamp((recentWR - overallWR) × 10, -2, 2)
//
// Rate limiting: 2 players per batch, 1200ms inter-batch delay (~5 calls/sec).
// ─────────────────────────────────────────────────────────────────────────────

const BOOTSTRAP_SENTINEL_PROFILE_ID = 0;
const MIN_GAMES_THRESHOLD            = 20;  // minimum public matches to be eligible

// ── Shared OpenDota fetch helpers ─────────────────────────────────────────────

interface OpenDotaPlayerInfo {
  rank_tier:        number | null;
  leaderboard_rank: number | null;
  mmr_estimate:     { estimate: number } | null;
}

interface OpenDotaWL {
  win:  number;
  lose: number;
}

interface OpenDotaRecentMatch {
  radiant_win:  boolean;
  player_slot:  number;
}

async function fetchPlayerInfo(accountId32: string): Promise<OpenDotaPlayerInfo | null> {
  try {
    const res = await fetch(
      `${OPENDOTA_BASE}/players/${accountId32}`,
      { headers: { "Accept": "application/json" }, signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) return null;
    return await res.json() as OpenDotaPlayerInfo;
  } catch {
    return null;
  }
}

async function fetchPlayerWL(accountId32: string): Promise<OpenDotaWL | null> {
  try {
    const res = await fetch(
      `${OPENDOTA_BASE}/players/${accountId32}/wl`,
      { headers: { "Accept": "application/json" }, signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) return null;
    const data = await res.json() as { win?: number; lose?: number };
    return { win: data.win ?? 0, lose: data.lose ?? 0 };
  } catch {
    return null;
  }
}

async function fetchRecentMatches(accountId32: string): Promise<OpenDotaRecentMatch[] | null> {
  try {
    const res = await fetch(
      `${OPENDOTA_BASE}/players/${accountId32}/recentMatches`,
      { headers: { "Accept": "application/json" }, signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) return null;
    const data = await res.json() as OpenDotaRecentMatch[];
    return Array.isArray(data) ? data.slice(0, 20) : null;
  } catch {
    return null;
  }
}

// ── MMR helpers ───────────────────────────────────────────────────────────────

function mmrFromInfo(info: OpenDotaPlayerInfo): number {
  if (info.mmr_estimate?.estimate && info.mmr_estimate.estimate > 0) {
    return info.mmr_estimate.estimate;
  }
  if (info.leaderboard_rank && info.leaderboard_rank > 0) {
    const rank = info.leaderboard_rank;
    if (rank <= 10)  return 11500;
    if (rank <= 50)  return 10500;
    if (rank <= 100) return 10000;
    if (rank <= 200) return 9500;
    if (rank <= 500) return 9000;
    return 8500;
  }
  if (info.rank_tier && info.rank_tier > 0) {
    const major = Math.floor(info.rank_tier / 10);
    const minor = info.rank_tier % 10;
    const tierMmr: Record<number, number> = {
      8: 7000 + (minor > 0 ? minor * 200 : 0),
      7: 5500 + (minor * 150),
      6: 4000 + (minor * 120),
      5: 3000 + (minor * 100),
    };
    return tierMmr[major] ?? 5000;
  }
  return 0; // unknown — no fallback for real-data pipeline
}

// ── Full real-data computation ─────────────────────────────────────────────────

interface RealValuationResult {
  mmr:           number;
  winRate:       number;
  totalGames:    number;
  mmrNorm:       number;
  wrNorm:        number;
  gamesFactor:   number;
  initialValue:  number;
  playerValue:   number;
  confidence:    number;
}

function computeFullRealValuation(
  mmr: number,
  wins: number,
  losses: number,
): RealValuationResult {
  const totalGames  = wins + losses;
  const winRate     = totalGames > 0 ? wins / totalGames : 0.5;
  const mmrNorm     = Math.min(1, Math.max(0, mmr / 12000));
  const wrNorm      = Math.min(1, Math.max(-1, (winRate - 0.5) / 0.2));
  const gamesFactor = Math.min(1, Math.max(0, Math.log10(totalGames + 1) / 3));

  const raw         = 8 + 10 * mmrNorm + 3 * wrNorm + 2 * gamesFactor;
  const initialValue = parseFloat(Math.min(25, Math.max(6, raw)).toFixed(4));

  // Confidence: higher when we have real WL + real MMR
  const hasMmr       = mmr > 0;
  const hasGoodSample = totalGames >= 50;
  const confidence    = hasMmr ? (hasGoodSample ? 0.80 : 0.65) : 0.50;

  const playerValue = parseFloat((initialValue * (0.60 + 0.40 * confidence)).toFixed(4));

  return { mmr, winRate, totalGames, mmrNorm, wrNorm, gamesFactor, initialValue, playerValue, confidence };
}

function computeRealMomentum(
  recentMatches: OpenDotaRecentMatch[],
  overallWR: number,
): number {
  if (recentMatches.length === 0) return 0;
  const recentWins = recentMatches.filter(m =>
    (m.player_slot < 128 && m.radiant_win) || (m.player_slot >= 128 && !m.radiant_win)
  ).length;
  const recentWR  = recentWins / recentMatches.length;
  const raw       = (recentWR - overallWR) * 10;
  return parseFloat(Math.min(2, Math.max(-2, raw)).toFixed(4));
}

// ── Real-data enrichment result ───────────────────────────────────────────────

export interface RealEnrichResult {
  processed:    number;
  eligible:     number;
  ineligible:   number;
  noWlData:     number;
  enriched:     number;
  errors:       string[];
  durationMs:   number;
  priceRange:   { min: number; max: number; avg: number } | null;
  momentumDistribution: { positive: number; negative: number; neutral: number };
}

export async function enrichDota2WithRealData(opts: {
  limit?:    number;
  offset?:   number;
  dryRun?:   boolean;
  minGames?: number;
} = {}): Promise<RealEnrichResult> {
  const t0       = Date.now();
  const limit    = opts.limit    ?? 50;
  const offset   = opts.offset   ?? 0;
  const dryRun   = opts.dryRun   ?? false;
  const minGames = opts.minGames ?? MIN_GAMES_THRESHOLD;
  const BATCH    = 2;   // 3 calls per player × 2 players = 6 concurrent calls
  const DELAY_MS = 1200;

  const rows = await db
    .select({
      id:             assets.id,
      assetUid:       assets.assetUid,
      displayName:    assets.displayName,
      volume24h:      assets.volume24h,
    })
    .from(assets)
    .where(like(assets.assetUid, "dota2:dota2:player:%"))
    .limit(limit)
    .offset(offset);

  let eligible        = 0;
  let ineligible      = 0;
  let noWlData        = 0;
  let enriched        = 0;
  const errors: string[] = [];
  const prices: number[] = [];
  const momentumDist  = { positive: 0, negative: 0, neutral: 0 };

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);

    await Promise.all(batch.map(async (row) => {
      const accountId32 = row.assetUid.split(":")[3];
      if (!accountId32) { errors.push(`No accountId in uid=${row.assetUid}`); return; }

      // Step 1: fetch WL (eligibility gate)
      const wl = await fetchPlayerWL(accountId32);

      if (!wl) {
        noWlData++;
        ineligible++;
        console.log(`[Dota2RealEnrich] INELIGIBLE (no WL) uid=${row.assetUid} name=${row.displayName}`);
        if (!dryRun) {
          // Ineligibility is signalled by trading_status=PAUSED only.
          // listing_status stays at its prior value (LISTED) so the asset
          // remains visible in /assets read-side endpoints.
          await db.update(assets)
            .set({ tradingStatus: "PAUSED", updatedAt: new Date() })
            .where(eq(assets.id, row.id));
        }
        return;
      }

      const totalGames = wl.win + wl.lose;
      if (totalGames < minGames) {
        ineligible++;
        console.log(`[Dota2RealEnrich] INELIGIBLE (games=${totalGames}<${minGames}) uid=${row.assetUid} name=${row.displayName}`);
        if (!dryRun) {
          // Same rationale as above: PAUSED for trading, LISTED preserved.
          await db.update(assets)
            .set({ tradingStatus: "PAUSED", updatedAt: new Date() })
            .where(eq(assets.id, row.id));
        }
        return;
      }

      // Step 2: fetch profile for MMR (parallel with recentMatches)
      const [info, recentMatches] = await Promise.all([
        fetchPlayerInfo(accountId32),
        fetchRecentMatches(accountId32),
      ]);

      const mmr = info ? mmrFromInfo(info) : 0;
      const valuation = computeFullRealValuation(mmr, wl.win, wl.lose);
      const momentum  = computeRealMomentum(recentMatches ?? [], valuation.winRate);
      const priceStr  = valuation.playerValue.toFixed(2);
      const hasNoTrades = parseFloat(row.volume24h ?? "0") === 0;

      eligible++;

      if (dryRun) {
        console.log(
          `[Dota2RealEnrich][DRY] uid=${row.assetUid} mmr=${mmr} wr=${(valuation.winRate*100).toFixed(1)}% ` +
          `games=${totalGames} initVal=${valuation.initialValue} price=${priceStr} momentum=${momentum}`,
        );
        prices.push(valuation.playerValue);
        if (momentum > 0.05) momentumDist.positive++;
        else if (momentum < -0.05) momentumDist.negative++;
        else momentumDist.neutral++;
        enriched++;
        return;
      }

      const supply = supplyForPrice(valuation.playerValue, DEFAULT_AMM_PARAMS);

      await db.update(assets)
        .set({
          fundamentalPrice:     priceStr,
          fundamentalUpdatedAt: new Date(),
          momentum:             momentum.toFixed(4),
          tradingStatus:        "ACTIVE",
          listingStatus:        "LISTED",
          ...(hasNoTrades ? {
            lastTradePrice: priceStr,
            price24hAgo:    priceStr,
            updatedAt:      new Date(),
          } : { updatedAt: new Date() }),
        })
        .where(eq(assets.id, row.id));

      if (hasNoTrades) {
        await db.update(assetMarketState)
          .set({ lastPrice: priceStr, supply: supply.toFixed(6) })
          .where(eq(assetMarketState.assetId, row.id));

        await db.update(assetPriceSnapshots)
          .set({ price: priceStr })
          .where(eq(assetPriceSnapshots.assetId, row.id));
      }

      await db.insert(dota2ValuationState)
        .values({
          assetId:          row.id,
          playerProfileId:  BOOTSTRAP_SENTINEL_PROFILE_ID,
          game:             "dota2",
          initialValue:     valuation.initialValue.toFixed(4),
          rawValue:         valuation.initialValue.toFixed(4),
          playerValue:      valuation.playerValue.toFixed(4),
          confidenceScore:  valuation.confidence.toFixed(4),
          sampleConfidence: (totalGames >= 50 ? 0.80 : 0.50).toFixed(4),
          roleConfidence:   "0.6000",
          dataCompleteness: (mmr > 0 ? 0.80 : 0.50).toFixed(4),
          rankStability:    "0.7000",
          matchesCount:     totalGames,
          valuationVersion: 2,
        } as any)
        .onConflictDoUpdate({
          target: [dota2ValuationState.assetId],
          set: {
            rawValue:        valuation.initialValue.toFixed(4),
            playerValue:     valuation.playerValue.toFixed(4),
            confidenceScore: valuation.confidence.toFixed(4),
            matchesCount:    totalGames,
            updatedAt:       new Date(),
          },
        });

      // ── Mandatory BOOTSTRAP audit-trail event (INV_4 invariant) ──────────
      // Idempotent — only inserts if no BOOTSTRAP event already exists.
      const [existingBootstrap] = await db
        .select({ id: dota2ValueHistory.id })
        .from(dota2ValueHistory)
        .where(and(
          eq(dota2ValueHistory.assetId, row.id),
          eq(dota2ValueHistory.eventType, "BOOTSTRAP"),
        ))
        .limit(1);

      if (!existingBootstrap) {
        await db.insert(dota2ValueHistory).values({
          assetId:          row.id,
          playerProfileId:  BOOTSTRAP_SENTINEL_PROFILE_ID,
          rawValueBefore:   "0.0000",
          rawValueAfter:    valuation.playerValue.toFixed(4),
          playerValueAfter: valuation.playerValue.toFixed(4),
          confidenceScore:  valuation.confidence.toFixed(4),
          eventType:        "BOOTSTRAP",
          metadataJson:     JSON.stringify({
            source:     "dota2_real_enrich",
            mmr,
            totalGames,
            winRate:    valuation.winRate,
          }),
        } as any);
      }

      console.log(
        `[Dota2RealEnrich] uid=${row.assetUid} mmr=${mmr} wr=${(valuation.winRate*100).toFixed(1)}% ` +
        `games=${totalGames} price=${priceStr} momentum=${momentum}`,
      );

      prices.push(valuation.playerValue);
      if (momentum > 0.05) momentumDist.positive++;
      else if (momentum < -0.05) momentumDist.negative++;
      else momentumDist.neutral++;
      enriched++;
    }));

    if (i + BATCH < rows.length) {
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }

  const durationMs = Date.now() - t0;
  const priceRange = prices.length > 0
    ? {
        min: parseFloat(Math.min(...prices).toFixed(2)),
        max: parseFloat(Math.max(...prices).toFixed(2)),
        avg: parseFloat((prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(2)),
      }
    : null;

  console.log(
    `[Dota2RealEnrich] Done — processed=${rows.length} eligible=${eligible} ` +
    `ineligible=${ineligible} noWlData=${noWlData} enriched=${enriched} ` +
    `priceRange=${JSON.stringify(priceRange)} durationMs=${durationMs}`,
  );

  return { processed: rows.length, eligible, ineligible, noWlData, enriched, errors, durationMs, priceRange, momentumDistribution: momentumDist };
}

// ── Legacy enrichment (MMR-only, Fase 24B) ────────────────────────────────────
// Kept for backward compat. Use enrichDota2WithRealData for real-data pipeline.

export interface EnrichResult {
  processed: number;
  enriched:  number;
  skipped:   number;
  noMmr:     number;
  errors:    string[];
  durationMs: number;
}

export async function enrichDota2Valuations(opts: {
  limit?:  number;
  offset?: number;
  dryRun?: boolean;
} = {}): Promise<EnrichResult> {
  const t0       = Date.now();
  const limit    = opts.limit  ?? 50;
  const offset   = opts.offset ?? 0;
  const dryRun   = opts.dryRun ?? false;
  const BATCH    = 5;
  const DELAY_MS = 800;
  const CONFIDENCE = 0.50;

  const rows = await db
    .select({ id: assets.id, assetUid: assets.assetUid, volume24h: assets.volume24h })
    .from(assets)
    .where(like(assets.assetUid, "dota2:dota2:player:%"))
    .limit(limit)
    .offset(offset);

  let enriched = 0; let skippedNo = 0; let noMmr = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i += BATCH) {
    await Promise.all(rows.slice(i, i + BATCH).map(async (row) => {
      const accountId32 = row.assetUid.split(":")[3];
      if (!accountId32) { skippedNo++; return; }
      const info = await fetchPlayerInfo(accountId32);
      const mmr  = info ? mmrFromInfo(info) : (noMmr++, 7000);
      const mmrNorm = Math.min(1, Math.max(0, mmr / 12000));
      const initialValue = parseFloat(Math.min(25, Math.max(6, 8 + 10 * mmrNorm + 2)).toFixed(4));
      const playerValue  = parseFloat((initialValue * (0.60 + 0.40 * CONFIDENCE)).toFixed(4));
      const priceStr     = playerValue.toFixed(2);
      const hasNoTrades  = parseFloat(row.volume24h ?? "0") === 0;
      if (dryRun) { enriched++; return; }
      const supply = supplyForPrice(playerValue, DEFAULT_AMM_PARAMS);
      await db.update(assets).set({ fundamentalPrice: priceStr, fundamentalUpdatedAt: new Date(), ...(hasNoTrades ? { lastTradePrice: priceStr, price24hAgo: priceStr, updatedAt: new Date() } : { updatedAt: new Date() }) }).where(eq(assets.id, row.id));
      if (hasNoTrades) {
        await db.update(assetMarketState).set({ lastPrice: priceStr, supply: supply.toFixed(6) }).where(eq(assetMarketState.assetId, row.id));
        await db.update(assetPriceSnapshots).set({ price: priceStr }).where(eq(assetPriceSnapshots.assetId, row.id));
      }
      await db.insert(dota2ValuationState).values({ assetId: row.id, playerProfileId: BOOTSTRAP_SENTINEL_PROFILE_ID, game: "dota2", initialValue: initialValue.toFixed(4), rawValue: initialValue.toFixed(4), playerValue: playerValue.toFixed(4), confidenceScore: CONFIDENCE.toFixed(4), sampleConfidence: "0.3000", roleConfidence: "0.5000", dataCompleteness: "0.4000", rankStability: "0.7000", matchesCount: 0, valuationVersion: 1 } as any).onConflictDoUpdate({ target: [dota2ValuationState.assetId], set: { rawValue: initialValue.toFixed(4), playerValue: playerValue.toFixed(4), updatedAt: new Date() } });

      // ── Mandatory BOOTSTRAP audit-trail event (INV_4 invariant) ──────────
      // Idempotent — only inserts if no BOOTSTRAP event already exists.
      const [existingBoot] = await db
        .select({ id: dota2ValueHistory.id })
        .from(dota2ValueHistory)
        .where(and(
          eq(dota2ValueHistory.assetId, row.id),
          eq(dota2ValueHistory.eventType, "BOOTSTRAP"),
        ))
        .limit(1);

      if (!existingBoot) {
        await db.insert(dota2ValueHistory).values({
          assetId:          row.id,
          playerProfileId:  BOOTSTRAP_SENTINEL_PROFILE_ID,
          rawValueBefore:   "0.0000",
          rawValueAfter:    playerValue.toFixed(4),
          playerValueAfter: playerValue.toFixed(4),
          confidenceScore:  CONFIDENCE.toFixed(4),
          eventType:        "BOOTSTRAP",
          metadataJson:     JSON.stringify({
            source: "dota2_mmr_enrich",
            mmr,
          }),
        } as any);
      }

      enriched++;
    }));
    if (i + BATCH < rows.length) await new Promise(r => setTimeout(r, DELAY_MS));
  }

  return { processed: rows.length, enriched, skipped: skippedNo, noMmr, errors, durationMs: Date.now() - t0 };
}

// ── Market refill: add eligible players to replace ineligible/paused ones ─────
//
// Fetches the full proPlayers list, finds players not yet in the DB, checks
// their eligibility (WL accessible + totalGames >= minGames), and seeds the
// eligible ones until `target` total ACTIVE+LISTED Dota2 assets is reached.
// ─────────────────────────────────────────────────────────────────────────────

export interface RefillResult {
  checked:    number;
  eligible:   number;
  created:    number;
  skipped:    number;
  targetMet:  boolean;
  errors:     string[];
  durationMs: number;
}

export async function refillDota2Market(opts: {
  target?:    number;
  minGames?:  number;
  limit?:     number;
  dryRun?:    boolean;
} = {}): Promise<RefillResult> {
  const t0       = Date.now();
  const target   = opts.target   ?? 500;
  const minGames = opts.minGames ?? MIN_GAMES_THRESHOLD;
  const limit    = opts.limit    ?? 50;   // max new players to try per call
  const dryRun   = opts.dryRun   ?? false;

  const market = await getOrCreateMarket({
    provider: "steam",
    game: "dota2",
    region: "global",
    scope: "default",
    entityType: "player",
    externalId: "dota2-global",
    displayName: "Dota2 Global",
    symbol: "",
  });

  const marketId = market.id;

  // Count current ACTIVE+LISTED assets
  const activeRows = await db
    .select({ id: assets.id })
    .from(assets)
    .where(and(
      like(assets.assetUid, "dota2:dota2:player:%"),
      eq(assets.tradingStatus, "ACTIVE"),
      eq(assets.listingStatus, "LISTED"),
    ));
  const currentActive = activeRows.length;

  if (currentActive >= target) {
    return { checked: 0, eligible: 0, created: 0, skipped: 0, targetMet: true, errors: [], durationMs: Date.now() - t0 };
  }

  const needed = target - currentActive;
  console.log(`[Dota2Refill] Need ${needed} more ACTIVE assets (current=${currentActive}, target=${target})`);

  // Get existing accountIds to avoid duplicates
  const existingRows = await db
    .select({ assetUid: assets.assetUid })
    .from(assets)
    .where(like(assets.assetUid, "dota2:dota2:player:%"));

  const existingIds = new Set(existingRows.map(r => r.assetUid.split(":")[3]));

  // Fetch full proPlayers list and pick candidates not yet in DB
  let players: ProPlayer[];
  try {
    players = await fetchProPlayers();
  } catch (err: any) {
    return { checked: 0, eligible: 0, created: 0, skipped: 0, targetMet: false, errors: [`Fetch failed: ${err.message}`], durationMs: Date.now() - t0 };
  }

  const candidates = players
    .filter(p => p.account_id && !existingIds.has(String(p.account_id)))
    .sort((a, b) => {
      const aScore = (a.team_id ? 2 : 0) + (a.name ? 1 : 0);
      const bScore = (b.team_id ? 2 : 0) + (b.name ? 1 : 0);
      return bScore - aScore;
    })
    .slice(0, limit);

  let checked  = 0;
  let eligible = 0;
  let created  = 0;
  let skipped  = 0;
  const errors: string[] = [];

  for (const p of candidates) {
    if (created >= needed) break;
    checked++;

    const accountId32 = String(p.account_id);
    const wl = await fetchPlayerWL(accountId32);

    if (!wl) {
      skipped++;
      console.log(`[Dota2Refill] SKIP (no WL) accountId=${accountId32} name=${p.name}`);
      await new Promise(r => setTimeout(r, 400));
      continue;
    }

    const totalGames = wl.win + wl.lose;
    if (totalGames < minGames) {
      skipped++;
      console.log(`[Dota2Refill] SKIP (games=${totalGames}<${minGames}) accountId=${accountId32} name=${p.name}`);
      await new Promise(r => setTimeout(r, 400));
      continue;
    }

    eligible++;
    if (dryRun) {
      console.log(`[Dota2Refill][DRY] ELIGIBLE accountId=${accountId32} name=${p.name} games=${totalGames} wr=${(wl.win/(wl.win+wl.lose)*100).toFixed(1)}%`);
      created++;
      await new Promise(r => setTimeout(r, 400));
      continue;
    }

    // Fetch full data for valuation
    const [info, recentMatches] = await Promise.all([
      fetchPlayerInfo(accountId32),
      fetchRecentMatches(accountId32),
    ]);

    const mmr       = info ? mmrFromInfo(info) : 0;
    const valuation = computeFullRealValuation(mmr, wl.win, wl.lose);
    const momentum  = computeRealMomentum(recentMatches ?? [], valuation.winRate);
    const priceStr  = valuation.playerValue.toFixed(2);

    try {
      const result = await seedPlayerWithValuation(p, marketId, priceStr, momentum, valuation);
      if (result === "created") {
        created++;
        console.log(`[Dota2Refill] CREATED accountId=${accountId32} name=${p.name} price=${priceStr} momentum=${momentum}`);
      } else {
        skipped++;
      }
    } catch (err: any) {
      errors.push(`accountId=${accountId32}: ${err.message}`);
    }

    await new Promise(r => setTimeout(r, 1200));
  }

  const targetMet = (currentActive + created) >= target;
  const durationMs = Date.now() - t0;
  console.log(`[Dota2Refill] Done — checked=${checked} eligible=${eligible} created=${created} targetMet=${targetMet} durationMs=${durationMs}`);

  return { checked, eligible, created, skipped, targetMet, errors, durationMs };
}

// ── Seed helpers ──────────────────────────────────────────────────────────────

async function seedPlayerWithValuation(
  p: ProPlayer,
  marketId: number,
  priceStr: string,
  momentum: number,
  valuation: RealValuationResult,
): Promise<"created" | "skipped"> {
  const accountId32 = String(p.account_id);
  const assetUid    = `dota2:dota2:player:${accountId32}`;
  const name        = p.name || p.personaname || `Dota2 Player #${accountId32}`;
  const teamTag     = p.team_name ? `[${p.team_name}] ` : "";
  const displayName = `${teamTag}${name}`;
  const symbol      = name.replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 8) || `D2P${accountId32.slice(-4)}`;

  const providerJson = JSON.stringify({
    provider:    "steam",
    game:        "dota2",
    accountId32,
    name:        p.name,
    teamName:    p.team_name,
    avatar:      p.avatar,
    countryCode: p.country_code,
  });

  const [existing] = await db
    .select({ id: assets.id })
    .from(assets)
    .where(eq(assets.assetUid, assetUid))
    .limit(1);

  if (existing) return "skipped";

  const supply = supplyForPrice(valuation.playerValue, DEFAULT_AMM_PARAMS);

  const [newAsset] = await db.insert(assets).values({
    marketId,
    assetUid,
    entityType:           "player",
    externalId:           accountId32,
    displayName,
    symbol,
    lastTradePrice:       priceStr,
    price24hAgo:          priceStr,
    volume24h:            "0.00",
    momentum:             momentum.toFixed(4),
    providerJson,
    fundamentalPrice:     priceStr,
    fundamentalUpdatedAt: new Date(),
    tradingStatus:        "ACTIVE",
    listingStatus:        "LISTED",
    playerProfileId:      null,
  } as any).returning({ id: assets.id });

  if (!newAsset) return "skipped";

  await db.insert(assetMarkets).values({ assetId: newAsset.id, marketId }).onConflictDoNothing();
  await db.insert(assetMarketState).values({
    assetId:   newAsset.id,
    lastPrice: priceStr,
    supply:    supply.toFixed(6),
    bidPrice:  (valuation.playerValue * 0.994).toFixed(2),
    askPrice:  (valuation.playerValue * 1.006).toFixed(2),
  } as any).onConflictDoNothing();
  await db.insert(assetPriceSnapshots).values({ assetId: newAsset.id, price: priceStr } as any).onConflictDoNothing();
  await db.insert(dota2ValuationState).values({
    assetId:          newAsset.id,
    playerProfileId:  BOOTSTRAP_SENTINEL_PROFILE_ID,
    game:             "dota2",
    initialValue:     valuation.initialValue.toFixed(4),
    rawValue:         valuation.initialValue.toFixed(4),
    playerValue:      valuation.playerValue.toFixed(4),
    confidenceScore:  valuation.confidence.toFixed(4),
    sampleConfidence: (valuation.totalGames >= 50 ? 0.80 : 0.50).toFixed(4),
    roleConfidence:   "0.6000",
    dataCompleteness: (valuation.mmr > 0 ? 0.80 : 0.50).toFixed(4),
    rankStability:    "0.7000",
    matchesCount:     valuation.totalGames,
    valuationVersion: 2,
  } as any).onConflictDoNothing();

  return "created";
}

// ── Continuous maintenance governance ─────────────────────────────────────────

export const CONTINUOUS_SYNC_POLICY = {
  discoveryEnabled:   false,
  onlyExistingAssets: true,
  note: "Fase 25: Dota2 supply is fixed after bootstrap. New players added only via explicit admin refill with eligibility checks.",
} as const;

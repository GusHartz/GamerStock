// ─── Dota2 Valuation Service ──────────────────────────────────────────────────
// Fase 7: ConfidenceScore + InitialValue bootstrap + RawValue/PlayerValue update.
//
// IMPORTANT SEPARATION OF CONCERNS:
//   Value ≠ Price.  Price comes from the market (AMM / order-book).
//   Value is a fundamental estimate derived from player performance data.
//   This service never touches market price — it only manages valuation state.
//
// Valuation pipeline:
//   PerformanceScores (Fase 6)
//     → ConfidenceScore (Fase 7a)
//     → InitialValue  bootstrap  (Fase 7b)
//     → RawValue      EMA update (Fase 7c)
//     → PlayerValue   confidence-adjusted (Fase 7d)
//
// ─────────────────────────────────────────────────────────────────────────────

import { db }                                     from "../../db";
import { eq }                                     from "drizzle-orm";
import { dota2ValuationState, dota2ValueHistory } from "@shared/schema/multigame";
import * as repo                                  from "./repository";
import { calculateConfidenceScore }               from "./dota2ConfidenceCalculator";
import { estimateMmrFromRankSignal }              from "./dota2ConfidenceCalculator";
import { projectDota2ValuationToCanonical }       from "./dota2CanonicalProjection";
import type {
  InsertDota2ValuationState,
  InsertDota2ValueHistory,
} from "@shared/schema";

// ── Constants ─────────────────────────────────────────────────────────────────

const ALPHA        = 0.08;   // EMA smoothing factor
const BETA         = 0.10;   // performance sensitivity
const INITIAL_VALUE_MIN = 6;
const INITIAL_VALUE_MAX = 25;

const HISTORY_LIMIT = 20;    // recent role_confidence samples from analytics

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

function n(v: string | number | null | undefined): number {
  return parseFloat(String(v ?? 0));
}

/**
 * Compute InitialValue from proxy data.
 *
 * InitialValue = clamp(8 + 10*mmrNorm + 3*wrNorm + 2*gamesFactor, 6, 25)
 *   mmrNorm    = clamp(mmr / 12000, 0, 1)
 *   wrNorm     = clamp((wr - 0.5) / 0.2, -1, 1)
 *   gamesFactor= clamp(log10(games + 1) / 3, 0, 1)
 */
function computeInitialValue(opts: {
  mmr:     number;
  winRate: number;   // 0..1
  games:   number;
}): { initialValue: number; mmrNorm: number; wrNorm: number; gamesFactor: number } {
  const mmrNorm    = clamp(opts.mmr / 12000, 0, 1);
  const wrNorm     = clamp((opts.winRate - 0.5) / 0.2, -1, 1);
  const gamesFactor= clamp(Math.log10(opts.games + 1) / 3, 0, 1);
  const raw        = 8 + 10 * mmrNorm + 3 * wrNorm + 2 * gamesFactor;
  return {
    initialValue: parseFloat(clamp(raw, INITIAL_VALUE_MIN, INITIAL_VALUE_MAX).toFixed(4)),
    mmrNorm, wrNorm, gamesFactor,
  };
}

/**
 * PlayerValue = RawValue × (0.60 + 0.40 × ConfidenceScore)
 */
function computePlayerValue(rawValue: number, confidenceScore: number): number {
  return parseFloat((rawValue * (0.60 + 0.40 * confidenceScore)).toFixed(4));
}

/**
 * RawValue EMA update incorporating one performance score.
 */
function applyPerformanceDelta(rawValueOld: number, performanceScore: number): number {
  const delta  = (performanceScore - 50) / 50;
  const impact = rawValueOld * (1 + BETA * delta);
  const newRaw = (1 - ALPHA) * rawValueOld + ALPHA * impact;
  return parseFloat(clamp(newRaw, INITIAL_VALUE_MIN - 2, 50).toFixed(4));
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

export interface BootstrapResult {
  assetId:         number;
  initialValue:    number;
  rawValue:        number;
  playerValue:     number;
  confidenceScore: number;
  sampleConfidence:number;
  roleConfidence:  number;
  dataCompleteness:number;
  rankStability:   number;
  proxyFlags:      Record<string, boolean>;
  historyId:       number;
  alreadyExisted:  boolean;
}

export async function bootstrapDota2Valuation(userId: string): Promise<BootstrapResult> {
  const profiles = await repo.findPlayerProfilesByUser(userId);
  const profile  = profiles.find(p => p.game === "dota2");
  if (!profile) throw Object.assign(new Error("DOTA2_PROFILE_NOT_FOUND"), { status: 404 });

  // Find the asset linked to this profile
  const asset = await repo.findAssetByPlayerProfileId(profile.id);
  if (!asset) throw Object.assign(new Error("DOTA2_ASSET_NOT_FOUND"), { status: 404 });

  // Check if already bootstrapped
  const existing = await repo.getDota2ValuationState(asset.id);

  // Load latest eligibility snapshot for confidence inputs
  const snap = await repo.findLatestEligibilitySnapshot(profile.id);
  if (!snap) throw Object.assign(new Error("ELIGIBILITY_SNAPSHOT_REQUIRED"), { status: 422 });

  // Gather recent role_confidence values from analytics
  const recentAnalytics = await repo.listMatchAnalyticsByProfile(profile.id, { eligibleOnly: true, limit: HISTORY_LIMIT });
  const recentRoleConfidences = recentAnalytics
    .map(a => n(a.roleConfidence))
    .filter(v => v > 0);

  // ConfidenceScore
  const confidence = calculateConfidenceScore({
    sampleSize:           n(snap.sampleSize),
    dataCompleteness:     n(snap.dataCompleteness),
    roleDetectability:    n(snap.roleDetectability),
    rankSignal:           snap.rankSignal ?? null,
    recentRoleConfidences,
  });

  // MMR proxy from rank signal
  const { mmr, isProxy: mmrIsProxy } = estimateMmrFromRankSignal(snap.rankSignal ?? null);

  // Win rate proxy: compute from eligible analytics won/total
  const wonCount  = recentAnalytics.filter(a => {
    try { return JSON.parse(a.contextJson ?? "{}").won === true; } catch { return false; }
  }).length;
  const winRate   = recentAnalytics.length > 0 ? wonCount / recentAnalytics.length : 0.50;
  const wrIsProxy = recentAnalytics.length === 0;

  const { initialValue, mmrNorm, wrNorm, gamesFactor } = computeInitialValue({
    mmr,
    winRate,
    games: n(snap.sampleSize),
  });

  const rawValue    = initialValue;
  const playerValue = computePlayerValue(rawValue, confidence.confidenceScore);

  const metadataJson = JSON.stringify({
    mmr, mmrIsProxy, mmrNorm,
    winRate, wrIsProxy, wrNorm,
    gamesFactor,
    games:           n(snap.sampleSize),
    rankSignal:      snap.rankSignal,
    recentAnalytics: recentAnalytics.length,
    wonCount,
    proxyFlags:      confidence.proxyFlags,
  });

  const stateRow: InsertDota2ValuationState = {
    assetId:              asset.id,
    playerProfileId:      profile.id,
    game:                 "dota2" as any,
    initialValue:         String(initialValue),
    rawValue:             String(rawValue),
    playerValue:          String(playerValue),
    confidenceScore:      String(confidence.confidenceScore),
    sampleConfidence:     String(confidence.sampleConfidence),
    roleConfidence:       String(confidence.roleConfidence),
    dataCompleteness:     String(confidence.dataCompleteness),
    rankStability:        String(confidence.rankStability),
    lastPerformanceScore: null,
    matchesCount:         0,
    valuationVersion:     1,
  };

  await repo.upsertDota2ValuationState(stateRow as any);

  // ── Project valuation into canonical market layer ─────────────────────────
  // First projection seeds lastTradePrice + snapshot; subsequent calls update
  // fundamentalPrice only — market price is driven by trades after that point.
  await projectDota2ValuationToCanonical(asset.id, playerValue).catch(err =>
    console.error("[Dota2Projection] bootstrap projection failed:", err.message),
  );

  const histRow: InsertDota2ValueHistory = {
    assetId:           asset.id,
    playerProfileId:   profile.id,
    performanceScoreId:null,
    rawValueBefore:    null,
    rawValueAfter:     String(rawValue),
    playerValueAfter:  String(playerValue),
    performanceScore:  null,
    confidenceScore:   String(confidence.confidenceScore),
    alphaUsed:         null,
    betaUsed:          null,
    eventType:         "BOOTSTRAP" as any,
    metadataJson,
  };

  const histId = await repo.insertDota2ValueHistory(histRow as any);

  return {
    assetId:          asset.id,
    initialValue,
    rawValue,
    playerValue,
    confidenceScore:  confidence.confidenceScore,
    sampleConfidence: confidence.sampleConfidence,
    roleConfidence:   confidence.roleConfidence,
    dataCompleteness: confidence.dataCompleteness,
    rankStability:    confidence.rankStability,
    proxyFlags:       confidence.proxyFlags as any,
    historyId:        histId,
    alreadyExisted:   !!existing,
  };
}

// ── Incremental update ────────────────────────────────────────────────────────

export interface UpdateValuationResult {
  assetId:          number;
  processed:        number;
  skipped:          number;
  rawValueBefore:   number;
  rawValueAfter:    number;
  playerValueAfter: number;
  confidenceScore:  number;
  history:          { performanceScoreId: number; rawValueAfter: number; playerValueAfter: number }[];
}

export async function updateDota2Valuation(
  userId: string,
  opts: { scoreLimit?: number } = {},
): Promise<UpdateValuationResult> {
  const profiles = await repo.findPlayerProfilesByUser(userId);
  const profile  = profiles.find(p => p.game === "dota2");
  if (!profile) throw Object.assign(new Error("DOTA2_PROFILE_NOT_FOUND"), { status: 404 });

  const asset = await repo.findAssetByPlayerProfileId(profile.id);
  if (!asset) throw Object.assign(new Error("DOTA2_ASSET_NOT_FOUND"), { status: 404 });

  const state = await repo.getDota2ValuationState(asset.id);
  if (!state) throw Object.assign(new Error("VALUATION_NOT_BOOTSTRAPPED"), { status: 422 });

  // ── Idempotency guard: only fetch scores NOT yet applied ──────────────────
  // Applied in chronological order (ASC) for deterministic EMA sequence.
  const unappliedScores = await repo.listDota2PerformanceScores(profile.id, {
    limit:    opts.scoreLimit ?? 50,
    offset:   0,
    applied:  false,
    orderAsc: true,
  });

  // Filter out invalid score values
  const validScores = unappliedScores.filter(s => {
    const sc = n(s.performanceScore);
    return sc > 0 && sc <= 100;
  });

  // ── Early return: nothing to do ───────────────────────────────────────────
  // Zero net effect — no DB writes at all.
  if (validScores.length === 0) {
    const rawValue    = n(state.rawValue);
    const playerValue = computePlayerValue(rawValue, n(state.confidenceScore));
    return {
      assetId:          asset.id,
      processed:        0,
      skipped:          unappliedScores.length,
      rawValueBefore:   rawValue,
      rawValueAfter:    rawValue,
      playerValueAfter: playerValue,
      confidenceScore:  n(state.confidenceScore),
      history:          [],
    };
  }

  // ── Refresh confidence ────────────────────────────────────────────────────
  const snap = await repo.findLatestEligibilitySnapshot(profile.id);
  const recentAnalytics = await repo.listMatchAnalyticsByProfile(profile.id, { eligibleOnly: true, limit: HISTORY_LIMIT });
  const recentRoleConfidences = recentAnalytics.map(a => n(a.roleConfidence)).filter(v => v > 0);

  const confidence = snap
    ? calculateConfidenceScore({
        sampleSize:           n(snap.sampleSize),
        dataCompleteness:     n(snap.dataCompleteness),
        roleDetectability:    n(snap.roleDetectability),
        rankSignal:           snap.rankSignal ?? null,
        recentRoleConfidences,
      })
    : {
        confidenceScore:  n(state.confidenceScore),
        sampleConfidence: n(state.sampleConfidence),
        roleConfidence:   n(state.roleConfidence),
        dataCompleteness: n(state.dataCompleteness),
        rankStability:    n(state.rankStability),
        proxyFlags:       { roleConfidenceProxy: true, rankStabilityProxy: true },
      };

  let rawValue         = n(state.rawValue);
  const rawValueBefore = rawValue;
  let matchesCount     = state.matchesCount ?? 0;
  const historyEntries: { performanceScoreId: number; rawValueAfter: number; playerValueAfter: number }[] = [];
  let processed = 0, skipped = 0;

  for (const sc of validScores) {
    const pscore = n(sc.performanceScore);
    if (pscore <= 0 || pscore > 100) { skipped++; continue; }

    const rawBefore = rawValue;
    rawValue = applyPerformanceDelta(rawValue, pscore);
    const pv = computePlayerValue(rawValue, confidence.confidenceScore);

    // Insert history entry (includes explicit performanceScoreId link)
    const histRow: InsertDota2ValueHistory = {
      assetId:            asset.id,
      playerProfileId:    profile.id,
      performanceScoreId: sc.id,
      rawValueBefore:     String(rawBefore),
      rawValueAfter:      String(rawValue),
      playerValueAfter:   String(pv),
      performanceScore:   String(pscore),
      confidenceScore:    String(confidence.confidenceScore),
      alphaUsed:          String(ALPHA),
      betaUsed:           String(BETA),
      eventType:          "MATCH_UPDATE" as any,
      metadataJson: JSON.stringify({
        role:              sc.role,
        trendConfidence:   sc.trendConfidence,
        scoreId:           sc.id,
        appliedAt:         new Date().toISOString(),
      }),
    };

    const histId = await repo.insertDota2ValueHistory(histRow as any);

    // ── Mark score as applied — idempotency fence ──────────────────────────
    // After this call, re-running update-valuation will skip this score.
    await repo.markDota2PerformanceScoreApplied(sc.id, histId);

    historyEntries.push({ performanceScoreId: sc.id, rawValueAfter: rawValue, playerValueAfter: pv });
    matchesCount++;
    processed++;
  }

  const playerValue = computePlayerValue(rawValue, confidence.confidenceScore);

  const updatedState: InsertDota2ValuationState = {
    assetId:              asset.id,
    playerProfileId:      profile.id,
    game:                 "dota2" as any,
    initialValue:         state.initialValue as any,
    rawValue:             String(rawValue),
    playerValue:          String(playerValue),
    confidenceScore:      String(confidence.confidenceScore),
    sampleConfidence:     String(confidence.sampleConfidence),
    roleConfidence:       String(confidence.roleConfidence),
    dataCompleteness:     String(confidence.dataCompleteness),
    rankStability:        String(confidence.rankStability),
    lastPerformanceScore: String(n(validScores[validScores.length - 1].performanceScore)),
    matchesCount,
    valuationVersion:     (state.valuationVersion ?? 1) + 1,
  };

  await repo.upsertDota2ValuationState(updatedState as any);

  // ── Project updated valuation into canonical market layer ─────────────────
  // Only refreshes fundamentalPrice — lastTradePrice is market-driven by this point.
  await projectDota2ValuationToCanonical(asset.id, playerValue).catch(err =>
    console.error("[Dota2Projection] update projection failed:", err.message),
  );

  return {
    assetId:          asset.id,
    processed,
    skipped,
    rawValueBefore,
    rawValueAfter:    rawValue,
    playerValueAfter: playerValue,
    confidenceScore:  confidence.confidenceScore,
    history:          historyEntries,
  };
}

// ── Read valuation ────────────────────────────────────────────────────────────

export async function getDota2Valuation(userId: string) {
  const profiles = await repo.findPlayerProfilesByUser(userId);
  const profile  = profiles.find(p => p.game === "dota2");
  if (!profile) throw Object.assign(new Error("DOTA2_PROFILE_NOT_FOUND"), { status: 404 });

  const asset = await repo.findAssetByPlayerProfileId(profile.id);
  if (!asset) throw Object.assign(new Error("DOTA2_ASSET_NOT_FOUND"), { status: 404 });

  const state = await repo.getDota2ValuationState(asset.id);
  if (!state) return null;

  return {
    ...state,
    initialValue:    n(state.initialValue),
    rawValue:        n(state.rawValue),
    playerValue:     n(state.playerValue),
    confidenceScore: n(state.confidenceScore),
    note:            "PlayerValue is a fundamental estimate. It does NOT equal market price.",
  };
}

// ── Bulk asset dynamic update (Phase 2 — Dynamic Loop Coverage) ───────────────
//
// Called by multigameValuationScheduler for assets with player_profile_id = 0
// (platform-seeded bulk assets — no live connected account).
//
// Pipeline per cycle:
//   GET /api/players/{id}/wl → winRate + totalGames
//   → performance score proxy  (winRate on 0–100 scale)
//   → EMA delta via applyPerformanceDelta()
//   → RECALC history event    (if |delta| ≥ 0.05)
//   → always touches updatedAt (loop coverage tracking)
//
// Returns an EXPLICIT result — never returns silently empty.
// Reason codes: VALUATION_NOT_BOOTSTRAPPED, PROVIDER_HTTP_{N}, NETWORK_ERROR,
//               INSUFFICIENT_GAMES, DELTA_TOO_SMALL, updated=true.
// ─────────────────────────────────────────────────────────────────────────────

export interface BulkUpdateResult {
  assetId:           number;
  updated:           boolean;
  reason?:           string;
  rawValueBefore?:   number;
  rawValueAfter?:    number;
  playerValueAfter?: number;
  delta?:            number;
}

/** Touch updatedAt to mark this asset as "loop attempted" this cycle. */
async function touchUpdatedAt(assetId: number): Promise<void> {
  await db
    .update(dota2ValuationState)
    .set({ updatedAt: new Date() })
    .where(eq(dota2ValuationState.assetId, assetId));
}

/**
 * Update valuation for a bulk Dota2 asset via OpenDota public API.
 * Called once per scheduler cycle for assets with player_profile_id = 0.
 */
export async function updateBulkDota2ValuationFromProvider(
  assetId:           number,
  openDotaAccountId: string,
): Promise<BulkUpdateResult> {
  const state = await repo.getDota2ValuationState(assetId);
  if (!state) {
    return { assetId, updated: false, reason: "VALUATION_NOT_BOOTSTRAPPED" };
  }

  const currentRaw = n(state.rawValue);
  const currentPv  = n(state.playerValue);
  const confidence = n(state.confidenceScore);

  // ── Fetch WL from OpenDota public API ─────────────────────────────────────
  let winRate    = 0.50;
  let totalGames = 0;
  try {
    const url = `https://api.opendota.com/api/players/${openDotaAccountId}/wl?limit=100`;
    const res  = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      await touchUpdatedAt(assetId);
      return { assetId, updated: false, reason: `PROVIDER_HTTP_${res.status}` };
    }
    const data   = await res.json() as { win?: number; lose?: number };
    const wins   = Number(data.win  ?? 0);
    const losses = Number(data.lose ?? 0);
    totalGames   = wins + losses;
    if (totalGames < 5) {
      await touchUpdatedAt(assetId);
      return { assetId, updated: false, reason: "INSUFFICIENT_GAMES" };
    }
    winRate = wins / totalGames;
  } catch {
    await touchUpdatedAt(assetId);
    return { assetId, updated: false, reason: "NETWORK_ERROR" };
  }

  // ── Performance score proxy from WR ────────────────────────────────────────
  // WR=0.50 → score=50 (neutral), WR=0.60 → score=70, WR=0.40 → score=30
  const performanceScore = clamp((winRate - 0.5) * 200 + 50, 0, 100);

  // ── Apply EMA ──────────────────────────────────────────────────────────────
  const newRaw = applyPerformanceDelta(currentRaw, performanceScore);
  const newPv  = computePlayerValue(newRaw, confidence);
  const delta  = Math.abs(newPv - currentPv);

  if (delta < 0.05) {
    // Small delta — touch updatedAt for loop coverage tracking only
    await touchUpdatedAt(assetId);
    return { assetId, updated: false, reason: "DELTA_TOO_SMALL" };
  }

  // ── Significant change: update state + RECALC event ───────────────────────
  await db
    .update(dota2ValuationState)
    .set({
      rawValue:     String(newRaw),
      playerValue:  String(newPv),
      updatedAt:    new Date(),
      matchesCount: (state.matchesCount ?? 0) + 1,
    })
    .where(eq(dota2ValuationState.assetId, assetId));

  await db.insert(dota2ValueHistory).values({
    assetId,
    playerProfileId:  0,
    rawValueBefore:   String(currentRaw),
    rawValueAfter:    String(newRaw),
    playerValueAfter: String(newPv),
    performanceScore: String(parseFloat(performanceScore.toFixed(2))),
    confidenceScore:  String(confidence),
    alphaUsed:        String(ALPHA),
    betaUsed:         String(BETA),
    eventType:        "RECALC" as any,
    metadataJson:     JSON.stringify({
      source:             "bulk_opendota_loop",
      openDotaAccountId,
      winRate:            parseFloat(winRate.toFixed(4)),
      totalGames,
      performanceScore:   parseFloat(performanceScore.toFixed(2)),
    }),
  } as any);

  await projectDota2ValuationToCanonical(assetId, newPv).catch(() => null);

  return {
    assetId,
    updated:          true,
    rawValueBefore:   currentRaw,
    rawValueAfter:    newRaw,
    playerValueAfter: newPv,
    delta,
  };
}

// ── Value history ─────────────────────────────────────────────────────────────

export async function getDota2ValueHistory(
  userId: string,
  limit  = 20,
  offset = 0,
  eventType?: string,
) {
  const profiles = await repo.findPlayerProfilesByUser(userId);
  const profile  = profiles.find(p => p.game === "dota2");
  if (!profile) throw Object.assign(new Error("DOTA2_PROFILE_NOT_FOUND"), { status: 404 });

  const asset = await repo.findAssetByPlayerProfileId(profile.id);
  if (!asset) throw Object.assign(new Error("DOTA2_ASSET_NOT_FOUND"), { status: 404 });

  const [items, total] = await Promise.all([
    repo.listDota2ValueHistory(asset.id, { limit, offset, eventType }),
    repo.countDota2ValueHistory(asset.id),
  ]);

  return { items, total, limit, offset };
}

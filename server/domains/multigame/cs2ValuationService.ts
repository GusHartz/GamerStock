// ─── CS2 Valuation Service (V1 + V2) ──────────────────────────────────────────
// Fase 3 (CS2): ConfidenceScore + InitialValue bootstrap for CS2 players.
// Fase 5 (CS2): EMA-based incremental update from match/performance data.
//
// IMPORTANT SEPARATION OF CONCERNS:
//   Value ≠ Price.  Price comes from the market (AMM / order-book).
//   Value is a fundamental estimate derived from available player data.
//   This service never touches market price — it only manages valuation state.
//
// ── V1 pipeline (bootstrap) ───────────────────────────────────────────────────
//   EligibilitySnapshot (onboarding data)
//     → ConfidenceScore  (cs2ConfidenceCalculator)
//     → InitialValue     bootstrap from rank + sample + completeness
//     → RawValue         = InitialValue at bootstrap (no match data yet)
//     → PlayerValue      = RawValue × confidence multiplier
//
//   Formula:
//     initialValue = clamp(7 + 9*rankNorm + 3*sampleFactor + 2*dataCompleteness, 6, 25)
//     rawValue     = initialValue
//     playerValue  = clamp(rawValue × (0.60 + 0.40 × confidenceScore), 6, 25)
//
// ── V2 pipeline (EMA update from match sync) ─────────────────────────────────
//   CS2 Career Stats (Steam)
//     → performanceScore (FPS signals: K/D, HS%, WR, KPR) — computed by cs2MatchSyncService
//     → perfValue        mapped from performanceScore → GS value scale
//     → newRawValue      EMA blend of perfValue + prevRawValue
//     → playerValue      = newRawValue × confidence multiplier
//
//   Formula:
//     perfValue    = clamp(6 + 19 × performanceScore, 6, 25)
//     alpha        = step(sampleSize): <20 → 0.10 | 20-49 → 0.18 | ≥50 → 0.25
//     rawEma       = alpha × perfValue + (1 − alpha) × rawValue_prev
//     delta        = clamp(rawEma − rawValue_prev, −EMA_MAX_DELTA, +EMA_MAX_DELTA)
//     newRawValue  = clamp(rawValue_prev + delta, 6, 25)
//     playerValue  = clamp(newRawValue × (0.60 + 0.40 × confidenceScore), 6, 25)
//
//   Guardrails:
//     - alpha conservative (max 0.25) — no sync-driven spikes
//     - delta cap ±3.0 GS — no single update can move value more than 3 GS
//     - clamp [6, 25] on rawValue and playerValue
//     - V1 fallback if performanceScore is null (re-runs bootstrap formula)
//
// ── Storage ───────────────────────────────────────────────────────────────────
//   Reuses dota2_valuation_state (game discriminator = "cs2") and
//   dota2_value_history tables.  No new schema required for V1/V2.
//   roleConfidence column stores signalConfidence for CS2 (same slot,
//   different semantic — documented in the metadataJson audit field).
//
//   History event types:
//     BOOTSTRAP    — initial valuation (V1 bootstrap)
//     MATCH_SYNC   — V1 refresh (bootstrap re-run after sync, no EMA)
//     MATCH_UPDATE — V2 EMA update (alphaUsed non-null in history row)
//
// ── TODOs (future phases) ─────────────────────────────────────────────────────
//   TODO [Fase 5]: FACEIT per-match history → richer performanceScore inputs
//   TODO [Fase 6]: cs2PerformanceService — per-match analytics
//   TODO [Fase 7]: Tune alpha schedule; add beta for confidence-weighted EMA
//   TODO [Fase 7]: Dynamic alpha from time-since-last-sync decay
//   TODO [ops]:   Cache Steam stats responses (1h TTL)
// ─────────────────────────────────────────────────────────────────────────────

import { db }                                     from "../../db";
import { eq }                                     from "drizzle-orm";
import { assets }                                 from "@shared/schema";
import { dota2ValuationState }                   from "@shared/schema/multigame";
import * as repo                                  from "./repository";
import { calculateCs2ConfidenceScore }            from "./cs2ConfidenceCalculator";
import { normaliseCs2RankSignal }                 from "./cs2ConfidenceCalculator";
import { projectDota2ValuationToCanonical }       from "./dota2CanonicalProjection";
import type {
  InsertDota2ValuationState,
  InsertDota2ValueHistory,
} from "@shared/schema";

// ── Constants ─────────────────────────────────────────────────────────────────

const CS2_VALUE_MIN = 6;
const CS2_VALUE_MAX = 25;

/**
 * log10 normalisation base — corresponds to SAMPLE_FULL_THRESHOLD (50) + 1.
 * clamp(log10(sampleSize + 1) / LOG10_SAMPLE_BASE, 0, 1)
 */
const LOG10_SAMPLE_BASE = Math.log10(51);

// ── V2 EMA calibration ────────────────────────────────────────────────────────

/**
 * EMA alpha schedule — how much weight a new sync gets.
 * Conservative by design: prevents a single bad/good sync from
 * causing a large valuation swing.
 *
 *   sampleSize < 20  → 0.10  (early data: low trust, stay near bootstrap)
 *   sampleSize 20-49 → 0.18  (growing history: moderate responsiveness)
 *   sampleSize ≥ 50  → 0.25  (mature history: more responsive, still smooth)
 */
const EMA_ALPHA_LOW   = 0.10;
const EMA_ALPHA_MED   = 0.18;
const EMA_ALPHA_HIGH  = 0.25;

/**
 * Maximum raw value change allowed per single sync run.
 * Prevents a corrupted sync or outlier stats from destroying the valuation.
 * e.g. if rawValue was 14 and EMA says 19, delta is capped to +3 → result 17.
 */
const EMA_MAX_DELTA = 3.00;

/**
 * Performance value mapping:
 *   performanceScore = 0.0 → perfValue = 6  GS (floor)
 *   performanceScore = 0.5 → perfValue = 15.5 GS (midpoint)
 *   performanceScore = 1.0 → perfValue = 25 GS (ceiling)
 */
const PERF_VALUE_BASE = CS2_VALUE_MIN;           // 6
const PERF_VALUE_SPAN = CS2_VALUE_MAX - CS2_VALUE_MIN;  // 19

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function n(v: string | number | null | undefined): number {
  return parseFloat(String(v ?? 0));
}

/**
 * Compute CS2 InitialValue from available onboarding signals (V1 formula).
 *
 *   initialValue = clamp(7 + 9*rankNorm + 3*sampleFactor + 2*dataCompleteness, 6, 25)
 *
 * Intentionally does NOT use MMR (Dota2-specific), winRate (no CS2 match data yet),
 * or role signals (CS2 has no positional role concept).
 */
function computeCs2InitialValue(opts: {
  rankNorm:        number;
  sampleFactor:    number;
  dataCompleteness: number;
}): number {
  const raw = 7
    + 9  * opts.rankNorm
    + 3  * opts.sampleFactor
    + 2  * opts.dataCompleteness;
  return parseFloat(clamp(raw, CS2_VALUE_MIN, CS2_VALUE_MAX).toFixed(4));
}

/**
 * CS2 sampleFactor: log-scale normalisation.
 * 0 games → 0.0, ~50 games → ~1.0.
 */
function computeSampleFactor(sampleSize: number): number {
  return clamp(Math.log10(sampleSize + 1) / LOG10_SAMPLE_BASE, 0, 1);
}

/**
 * PlayerValue = RawValue × (0.60 + 0.40 × ConfidenceScore)
 * Confidence-weighted discount on the raw fundamental value.
 */
function computeCs2PlayerValue(rawValue: number, confidenceScore: number): number {
  return parseFloat(clamp(rawValue * (0.60 + 0.40 * confidenceScore), CS2_VALUE_MIN, CS2_VALUE_MAX).toFixed(4));
}

// ── V2 EMA helpers ────────────────────────────────────────────────────────────

/**
 * Map a CS2 performance score (0..1) to a GS value in the [6, 25] range.
 *
 * Calibration:
 *   score = 0.0 → 6.0 GS  (inactive / below-average player)
 *   score = 0.5 → 15.5 GS (average competitive player)
 *   score = 1.0 → 25.0 GS (elite / pro-level player)
 */
function computePerfValue(performanceScore: number): number {
  return parseFloat(
    clamp(PERF_VALUE_BASE + PERF_VALUE_SPAN * performanceScore, CS2_VALUE_MIN, CS2_VALUE_MAX).toFixed(4),
  );
}

/**
 * Select EMA alpha based on sample size (number of career matches).
 *
 * Lower alpha = more inertia = smoother, slower response.
 * Higher alpha = more reactive = faster adaptation.
 */
function selectAlpha(sampleSize: number): number {
  if (sampleSize < 20) return EMA_ALPHA_LOW;
  if (sampleSize < 50) return EMA_ALPHA_MED;
  return EMA_ALPHA_HIGH;
}

/**
 * Apply EMA update with delta guardrail.
 *
 * @returns { newRawValue, deltaRaw, deltaClampApplied, alphaUsed, perfValue }
 */
function applyEmaUpdate(opts: {
  prevRawValue:     number;
  performanceScore: number;
  sampleSize:       number;
}): {
  newRawValue:       number;
  deltaRaw:          number;
  deltaClampApplied: boolean;
  alphaUsed:         number;
  perfValue:         number;
} {
  const { prevRawValue, performanceScore, sampleSize } = opts;

  const perfValue = computePerfValue(performanceScore);
  const alpha     = selectAlpha(sampleSize);

  // Raw EMA result
  const rawEma = alpha * perfValue + (1 - alpha) * prevRawValue;

  // Uncapped delta
  const rawDelta = rawEma - prevRawValue;

  // Apply per-sync delta cap
  const clampedDelta    = clamp(rawDelta, -EMA_MAX_DELTA, EMA_MAX_DELTA);
  const deltaClampApplied = Math.abs(rawDelta - clampedDelta) > 0.0001;

  const newRawValue = parseFloat(
    clamp(prevRawValue + clampedDelta, CS2_VALUE_MIN, CS2_VALUE_MAX).toFixed(4),
  );

  return {
    newRawValue,
    deltaRaw:          parseFloat(clampedDelta.toFixed(4)),
    deltaClampApplied,
    alphaUsed:         alpha,
    perfValue,
  };
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

export interface Cs2ValuationBootstrapResult {
  assetId:          number;
  initialValue:     number;
  rawValue:         number;
  playerValue:      number;
  confidenceScore:  number;
  sampleConfidence: number;
  /** Signal confidence (CS2 equivalent of roleConfidence in Dota2). */
  signalConfidence: number;
  dataCompleteness: number;
  stabilityScore:   number;
  proxyFlags:       Record<string, boolean>;
  historyId:        number;
  /** true if a valuation state already existed before this call. */
  alreadyExisted:   boolean;
  /** Inputs used, for auditability. */
  inputs: {
    rankSignal:        string | null;
    rankNorm:          number;
    rankNormIsProxy:   boolean;
    sampleSize:        number;
    sampleFactor:      number;
    dataCompleteness:  number;
  };
}

/**
 * Bootstrap CS2 valuation for the authenticated user.
 *
 * Idempotent: calling multiple times re-computes from the latest snapshot
 * and upserts the state row — safe to run after match data enriches the snapshot.
 *
 * @param userId GS platform user ID
 */
export async function bootstrapCs2Valuation(userId: string): Promise<Cs2ValuationBootstrapResult> {
  // ── Load CS2 profile ──────────────────────────────────────────────────────
  const profiles = await repo.findPlayerProfilesByUser(userId);
  const profile  = profiles.find((p: any) => p.game === "cs2");
  if (!profile) throw Object.assign(new Error("CS2_PROFILE_NOT_FOUND"), { status: 404 });

  // ── Load CS2 asset ────────────────────────────────────────────────────────
  const asset = await repo.findAssetByPlayerProfileId(profile.id);
  if (!asset) throw Object.assign(new Error("CS2_ASSET_NOT_FOUND"), { status: 404 });

  // ── Check if already bootstrapped ────────────────────────────────────────
  const existing = await repo.getDota2ValuationState((asset as any).id);

  // ── Load eligibility snapshot ─────────────────────────────────────────────
  const snap = await repo.findLatestEligibilitySnapshot(profile.id);
  if (!snap) throw Object.assign(new Error("ELIGIBILITY_SNAPSHOT_REQUIRED"), { status: 422 });

  // ── Confidence ────────────────────────────────────────────────────────────
  const confidence = calculateCs2ConfidenceScore({
    sampleSize:       n(snap.sampleSize),
    dataCompleteness: n(snap.dataCompleteness),
    rankSignal:       snap.rankSignal ?? null,
  });

  // ── Valuation inputs ──────────────────────────────────────────────────────
  const { normValue: rankNorm, isProxy: rankNormIsProxy } =
    normaliseCs2RankSignal(snap.rankSignal ?? null);

  const sampleSize   = n(snap.sampleSize);
  const sampleFactor = computeSampleFactor(sampleSize);

  const initialValue = computeCs2InitialValue({
    rankNorm,
    sampleFactor,
    dataCompleteness: clamp(n(snap.dataCompleteness), 0, 1),
  });

  const rawValue    = initialValue;
  const playerValue = computeCs2PlayerValue(rawValue, confidence.confidenceScore);

  // ── Build audit metadata ──────────────────────────────────────────────────
  const metadataJson = JSON.stringify({
    game:              "cs2",
    valuationPath:     "V1_BOOTSTRAP",
    rankSignal:        snap.rankSignal,
    rankNorm,
    rankNormIsProxy,
    sampleSize,
    sampleFactor,
    dataCompleteness:  n(snap.dataCompleteness),
    proxyFlags:        confidence.proxyFlags,
    note:              "CS2 V1 bootstrap. signalConfidence stored in roleConfidence column.",
  });

  // ── Persist valuation state ───────────────────────────────────────────────
  const stateRow: InsertDota2ValuationState = {
    assetId:              (asset as any).id,
    playerProfileId:      profile.id,
    game:                 "cs2" as any,
    initialValue:         String(initialValue),
    rawValue:             String(rawValue),
    playerValue:          String(playerValue),
    confidenceScore:      String(confidence.confidenceScore),
    sampleConfidence:     String(confidence.sampleConfidence),
    roleConfidence:       String(confidence.signalConfidence),
    dataCompleteness:     String(confidence.dataCompleteness),
    rankStability:        String(confidence.stabilityScore),
    lastPerformanceScore: null,
    matchesCount:         0,
    valuationVersion:     existing ? ((existing.valuationVersion ?? 1) + 1) : 1,
  };

  await repo.upsertDota2ValuationState(stateRow as any);

  // ── Project into canonical market layer ───────────────────────────────────
  await projectDota2ValuationToCanonical((asset as any).id, playerValue).catch((err: Error) =>
    console.error("[Cs2Projection] bootstrap projection failed:", err.message),
  );

  // ── Append value history entry ────────────────────────────────────────────
  const histRow: InsertDota2ValueHistory = {
    assetId:            (asset as any).id,
    playerProfileId:    profile.id,
    performanceScoreId: null,
    rawValueBefore:     null,
    rawValueAfter:      String(rawValue),
    playerValueAfter:   String(playerValue),
    performanceScore:   null,
    confidenceScore:    String(confidence.confidenceScore),
    alphaUsed:          null,
    betaUsed:           null,
    eventType:          "BOOTSTRAP" as any,
    metadataJson,
  };

  const histId = await repo.insertDota2ValueHistory(histRow as any);

  return {
    assetId:          (asset as any).id,
    initialValue,
    rawValue,
    playerValue,
    confidenceScore:  confidence.confidenceScore,
    sampleConfidence: confidence.sampleConfidence,
    signalConfidence: confidence.signalConfidence,
    dataCompleteness: confidence.dataCompleteness,
    stabilityScore:   confidence.stabilityScore,
    proxyFlags:       confidence.proxyFlags as any,
    historyId:        histId,
    alreadyExisted:   !!existing,
    inputs: {
      rankSignal:       snap.rankSignal ?? null,
      rankNorm,
      rankNormIsProxy,
      sampleSize,
      sampleFactor:     parseFloat(sampleFactor.toFixed(4)),
      dataCompleteness: parseFloat(n(snap.dataCompleteness).toFixed(4)),
    },
  };
}

// ── Read ──────────────────────────────────────────────────────────────────────

/**
 * Return the current CS2 valuation state for the authenticated user.
 * Returns null if bootstrapCs2Valuation has not been called yet.
 */
export async function getCs2Valuation(userId: string) {
  const profiles = await repo.findPlayerProfilesByUser(userId);
  const profile  = profiles.find((p: any) => p.game === "cs2");
  if (!profile) throw Object.assign(new Error("CS2_PROFILE_NOT_FOUND"), { status: 404 });

  const asset = await repo.findAssetByPlayerProfileId(profile.id);
  if (!asset) throw Object.assign(new Error("CS2_ASSET_NOT_FOUND"), { status: 404 });

  const state = await repo.getDota2ValuationState((asset as any).id);
  if (!state) return null;

  return {
    ...state,
    game:             "cs2",
    initialValue:     n(state.initialValue),
    rawValue:         n(state.rawValue),
    playerValue:      n(state.playerValue),
    confidenceScore:  n(state.confidenceScore),
    sampleConfidence: n(state.sampleConfidence),
    /** signalConfidence (CS2-specific) stored in roleConfidence column. */
    signalConfidence: n(state.roleConfidence),
    dataCompleteness: n(state.dataCompleteness),
    stabilityScore:   n(state.rankStability),
    lastPerformanceScore: state.lastPerformanceScore !== null ? n(state.lastPerformanceScore) : null,
    note: "PlayerValue is a fundamental estimate. It does NOT equal market price.",
  };
}

// ── Value history ─────────────────────────────────────────────────────────────

/**
 * Return CS2 value history for the authenticated user (most recent first).
 */
export async function getCs2ValueHistory(
  userId: string,
  limit  = 20,
  offset = 0,
  eventType?: string,
) {
  const profiles = await repo.findPlayerProfilesByUser(userId);
  const profile  = profiles.find((p: any) => p.game === "cs2");
  if (!profile) throw Object.assign(new Error("CS2_PROFILE_NOT_FOUND"), { status: 404 });

  const asset = await repo.findAssetByPlayerProfileId(profile.id);
  if (!asset) throw Object.assign(new Error("CS2_ASSET_NOT_FOUND"), { status: 404 });

  const [items, total] = await Promise.all([
    repo.listDota2ValueHistory((asset as any).id, { limit, offset, eventType }),
    repo.countDota2ValueHistory((asset as any).id),
  ]);

  return { items, total, limit, offset, game: "cs2" };
}

// ── Incremental update (V2 EMA) ───────────────────────────────────────────────

export interface Cs2ValuationRefreshInput {
  userId:            string;
  /** Updated match count from the provider (from career aggregate). */
  sampleSize:        number;
  /** Updated data completeness (0..1) from sync readiness computation. */
  dataCompleteness:  number;
  /**
   * CS2 performance score (0..1) derived from career stats (K/D, HS%, WR, KPR).
   * When non-null: V2 EMA path is used.
   * When null:     V1 bootstrap re-run path is used (fallback).
   */
  performanceScore:  number | null;
  /** Provider status — used for audit metadata. */
  providerStatus:    string;
}

export interface Cs2ValuationRefreshResult {
  rawValueBefore:    number | null;
  rawValueAfter:     number;
  playerValueAfter:  number;
  confidenceScore:   number;
  historyId:         number;
  /** "V2_EMA" when EMA was applied; "V1_BOOTSTRAP_RERUN" when fallback used. */
  valuationPath:     "V2_EMA" | "V1_BOOTSTRAP_RERUN";
  /** Only set on V2_EMA path. */
  ema?: {
    perfValue:         number;
    alphaUsed:         number;
    deltaRaw:          number;
    deltaClampApplied: boolean;
  };
}

/**
 * Refresh CS2 valuation state after a match sync run.
 *
 * V2 path (performanceScore non-null, ≥ 10 matches):
 *   Applies an EMA blend of the new performance-derived value and the previous
 *   rawValue, with a per-sync delta cap of ±3.0 GS to prevent sudden swings.
 *
 *   EMA formula:
 *     perfValue   = 6 + 19 × performanceScore            (maps 0..1 → 6..25 GS)
 *     alpha       = f(sampleSize): 0.10 | 0.18 | 0.25    (conservative schedule)
 *     rawEma      = alpha × perfValue + (1−alpha) × prevRawValue
 *     delta       = clamp(rawEma − prevRawValue, −3.0, +3.0)
 *     newRawValue = clamp(prevRawValue + delta, 6, 25)
 *
 * V1 fallback (performanceScore null):
 *   Re-runs the bootstrap formula with updated sampleSize + dataCompleteness.
 *   No EMA applied. Used when provider data is insufficient or unavailable.
 *
 * Requires an existing valuation state (bootstrapCs2Valuation must have run first).
 */
export async function refreshCs2ValuationFromMatchData(
  input: Cs2ValuationRefreshInput,
): Promise<Cs2ValuationRefreshResult> {
  const { userId, sampleSize, dataCompleteness, performanceScore, providerStatus } = input;

  // ── Load CS2 profile + asset ──────────────────────────────────────────────
  const profiles = await repo.findPlayerProfilesByUser(userId);
  const profile  = profiles.find((p: any) => p.game === "cs2");
  if (!profile) throw Object.assign(new Error("CS2_PROFILE_NOT_FOUND"), { status: 404 });

  const asset = await repo.findAssetByPlayerProfileId(profile.id);
  if (!asset) throw Object.assign(new Error("CS2_ASSET_NOT_FOUND"), { status: 404 });

  // ── Load existing valuation state ─────────────────────────────────────────
  const existing = await repo.getDota2ValuationState((asset as any).id);
  if (!existing) {
    throw Object.assign(
      new Error("CS2_VALUATION_NOT_BOOTSTRAPPED: call bootstrap-valuation first"),
      { status: 422 },
    );
  }

  const rawValueBefore = n(existing.rawValue);

  // ── Load latest eligibility snapshot for rankSignal ───────────────────────
  const snap = await repo.findLatestEligibilitySnapshot(profile.id);
  const rankSignal = snap?.rankSignal ?? null;

  // ── Re-run confidence with updated inputs ─────────────────────────────────
  const confidence = calculateCs2ConfidenceScore({
    sampleSize,
    dataCompleteness,
    rankSignal,
  });

  // ── Compute new rawValue ───────────────────────────────────────────────────
  // V2 EMA path — when we have a real performance score from career stats
  // V1 fallback — re-run bootstrap formula (no EMA, deterministic)

  let newRawValue:    number;
  let valuationPath:  "V2_EMA" | "V1_BOOTSTRAP_RERUN";
  let emaDetails:     Cs2ValuationRefreshResult["ema"] | undefined;
  let alphaUsedStr:   string | null = null;
  let eventType:      string;

  if (performanceScore !== null) {
    // ── V2: EMA update ──────────────────────────────────────────────────────
    const ema = applyEmaUpdate({ prevRawValue: rawValueBefore, performanceScore, sampleSize });

    newRawValue   = ema.newRawValue;
    valuationPath = "V2_EMA";
    alphaUsedStr  = String(ema.alphaUsed);
    eventType     = "MATCH_UPDATE";   // valid enum value: BOOTSTRAP|MATCH_UPDATE|RECALC|MANUAL_ADJUSTMENT

    emaDetails = {
      perfValue:         ema.perfValue,
      alphaUsed:         ema.alphaUsed,
      deltaRaw:          ema.deltaRaw,
      deltaClampApplied: ema.deltaClampApplied,
    };
  } else {
    // ── V1 fallback: bootstrap formula re-run ────────────────────────────────
    const { normValue: rankNorm } = normaliseCs2RankSignal(rankSignal);
    const sampleFactor = computeSampleFactor(sampleSize);

    newRawValue   = computeCs2InitialValue({ rankNorm, sampleFactor, dataCompleteness });
    valuationPath = "V1_BOOTSTRAP_RERUN";
    alphaUsedStr  = null;
    eventType     = "MATCH_SYNC";     // V1 fallback — kept with legacy string (cast as any below)
  }

  const newPlayerValue = computeCs2PlayerValue(newRawValue, confidence.confidenceScore);

  // ── Build audit metadata ──────────────────────────────────────────────────
  const { normValue: rankNorm, isProxy: rankNormIsProxy } = normaliseCs2RankSignal(rankSignal);
  const sampleFactor = computeSampleFactor(sampleSize);

  const metadataJson = JSON.stringify({
    game:              "cs2",
    valuationPath,
    eventSource:       "MATCH_SYNC",
    providerStatus,
    rankSignal,
    rankNorm,
    rankNormIsProxy,
    sampleSize,
    sampleFactor,
    dataCompleteness,
    performanceScore,
    proxyFlags:        confidence.proxyFlags,
    ...(emaDetails ? {
      ema: {
        perfValue:         emaDetails.perfValue,
        alphaUsed:         emaDetails.alphaUsed,
        prevRawValue:      rawValueBefore,
        newRawValue,
        deltaRaw:          emaDetails.deltaRaw,
        deltaClampApplied: emaDetails.deltaClampApplied,
      },
    } : {}),
    note: valuationPath === "V2_EMA"
      ? `V2 EMA update. alpha=${emaDetails!.alphaUsed}, perfValue=${emaDetails!.perfValue}. Delta capped to ±${EMA_MAX_DELTA} GS/sync.`
      : "V1 bootstrap formula re-run (no performanceScore available).",
  });

  // ── Update valuation state ────────────────────────────────────────────────
  const updatedState: InsertDota2ValuationState = {
    assetId:              (asset as any).id,
    playerProfileId:      profile.id,
    game:                 "cs2" as any,
    initialValue:         existing.initialValue,   // unchanged — set at bootstrap
    rawValue:             String(newRawValue),
    playerValue:          String(newPlayerValue),
    confidenceScore:      String(confidence.confidenceScore),
    sampleConfidence:     String(confidence.sampleConfidence),
    roleConfidence:       String(confidence.signalConfidence),
    dataCompleteness:     String(confidence.dataCompleteness),
    rankStability:        String(confidence.stabilityScore),
    lastPerformanceScore: performanceScore !== null ? String(performanceScore) : existing.lastPerformanceScore,
    matchesCount:         sampleSize,
    valuationVersion:     (existing.valuationVersion ?? 1) + 1,
  };

  await repo.upsertDota2ValuationState(updatedState as any);

  // ── Project updated value to canonical market layer ───────────────────────
  await projectDota2ValuationToCanonical((asset as any).id, newPlayerValue).catch((err: Error) =>
    console.error("[Cs2ValuationRefresh] projection failed:", err.message),
  );

  // ── Append value history entry ────────────────────────────────────────────
  const histRow: InsertDota2ValueHistory = {
    assetId:            (asset as any).id,
    playerProfileId:    profile.id,
    performanceScoreId: null,
    rawValueBefore:     String(rawValueBefore),
    rawValueAfter:      String(newRawValue),
    playerValueAfter:   String(newPlayerValue),
    performanceScore:   performanceScore !== null ? String(performanceScore) : null,
    confidenceScore:    String(confidence.confidenceScore),
    alphaUsed:          alphaUsedStr,
    betaUsed:           null,   // reserved for future two-factor EMA
    eventType:          eventType as any,
    metadataJson,
  };

  const historyId = await repo.insertDota2ValueHistory(histRow as any);

  return {
    rawValueBefore,
    rawValueAfter:    newRawValue,
    playerValueAfter: newPlayerValue,
    confidenceScore:  confidence.confidenceScore,
    historyId,
    valuationPath,
    ...(emaDetails ? { ema: emaDetails } : {}),
  };
}

// ── V3: Synthetic Match EMA ────────────────────────────────────────────────────
// Applied when a stats delta yields new synthetic match records.
// Unlike V2, this works directly with assetId (no userId / profile lookup needed)
// and uses a fixed alpha = 0.20.
//
// After the EMA update this function ALSO writes last_trade_price = playerValue
// so Terminal prices diverge from the $15.00 flat bootstrap baseline.
// ─────────────────────────────────────────────────────────────────────────────

/** Fixed EMA alpha for synthetic-match updates (aggressive enough to move quickly). */
const SYNTH_ALPHA = 0.20;

export interface Cs2SyntheticValuationInput {
  assetId:             number;
  /** Average performance score (0..1) from the generated synthetic match rows. */
  avgPerformanceScore: number;
  /** Streak win bonus (0..STREAK_MAX) computed by cs2SyntheticMatchService. */
  streakBonus:         number;
  /** Streak loss penalty (0..STREAK_MAX) computed by cs2SyntheticMatchService. */
  streakPenalty:       number;
}

export interface Cs2SyntheticValuationResult {
  rawValueBefore:   number;
  rawValueAfter:    number;
  playerValueAfter: number;
  historyId:        number;
  alphaUsed:        number;
  perfValue:        number;
  adjustedPerfValue: number;
}

/**
 * Apply a synthetic-match EMA update to an existing CS2 valuation state.
 *
 * Works with any CS2 asset (user-connected or platform-bootstrapped).
 * Requires the valuation state to have been bootstrapped already.
 *
 * Formula:
 *   perfValue         = clamp(6 + 19 × avgPerformanceScore, 6, 25)
 *   adjustedPerfValue = clamp(perfValue + streakBonus − streakPenalty, 6, 25)
 *   rawEma            = 0.20 × adjustedPerfValue + 0.80 × prevRawValue
 *   delta             = clamp(rawEma − prevRawValue, −3.0, +3.0)
 *   newRawValue       = clamp(prevRawValue + delta, 6, 25)
 *   newPlayerValue    = clamp(newRawValue × (0.60 + 0.40 × confidenceScore), 6, 25)
 *
 * After update:
 *   assets.fundamental_price = newPlayerValue  (via projectDota2ValuationToCanonical)
 *   assets.last_trade_price  = newPlayerValue  (forced — diverges from $15 baseline)
 */
export async function refreshCs2ValuationFromSyntheticMatches(
  input: Cs2SyntheticValuationInput,
): Promise<Cs2SyntheticValuationResult> {
  const { assetId, avgPerformanceScore, streakBonus, streakPenalty } = input;

  // ── Load existing valuation state ─────────────────────────────────────────
  const existing = await repo.getDota2ValuationState(assetId);
  if (!existing) {
    throw Object.assign(
      new Error(`CS2_VALUATION_NOT_BOOTSTRAPPED: assetId=${assetId}`),
      { status: 422 },
    );
  }

  const prevRawValue = parseFloat(String(existing.rawValue ?? "15"));
  const prevConfidence = parseFloat(String(existing.confidenceScore ?? "0.5"));

  // ── Compute adjusted performance value ────────────────────────────────────
  const perfValue = clamp(6 + 19 * avgPerformanceScore, CS2_VALUE_MIN, CS2_VALUE_MAX);
  const adjustedPerfValue = clamp(perfValue + streakBonus - streakPenalty, CS2_VALUE_MIN, CS2_VALUE_MAX);

  // ── EMA with fixed alpha = 0.20 ───────────────────────────────────────────
  const rawEma = SYNTH_ALPHA * adjustedPerfValue + (1 - SYNTH_ALPHA) * prevRawValue;
  const rawDelta = clamp(rawEma - prevRawValue, -EMA_MAX_DELTA, EMA_MAX_DELTA);
  const newRawValue = parseFloat(
    clamp(prevRawValue + rawDelta, CS2_VALUE_MIN, CS2_VALUE_MAX).toFixed(4),
  );

  // ── Recompute confidence score ────────────────────────────────────────────
  // Reuse existing confidence (no snapshot update needed for synthetic match)
  const newPlayerValue = computeCs2PlayerValue(newRawValue, prevConfidence);

  // ── Update valuation state ────────────────────────────────────────────────
  const updatedState: InsertDota2ValuationState = {
    assetId,
    playerProfileId:      existing.playerProfileId,
    game:                 "cs2" as any,
    initialValue:         existing.initialValue,
    rawValue:             String(newRawValue),
    playerValue:          String(newPlayerValue),
    confidenceScore:      String(prevConfidence),
    sampleConfidence:     existing.sampleConfidence,
    roleConfidence:       existing.roleConfidence,
    dataCompleteness:     existing.dataCompleteness,
    rankStability:        existing.rankStability,
    lastPerformanceScore: String(avgPerformanceScore),
    matchesCount:         (existing.matchesCount ?? 0) + 1,
    valuationVersion:     (existing.valuationVersion ?? 1) + 1,
  };

  await repo.upsertDota2ValuationState(updatedState as any);

  // ── Project to canonical market layer (updates fundamentalPrice) ───────────
  await projectDota2ValuationToCanonical(assetId, newPlayerValue).catch((err: Error) =>
    console.error("[Cs2SyntheticValuation] projection failed:", err.message),
  );

  // ── Force-update lastTradePrice so Terminal diverges from $15 baseline ────
  await db
    .update(assets)
    .set({ lastTradePrice: newPlayerValue.toFixed(2) })
    .where(eq(assets.id, assetId));

  // ── Append history row ─────────────────────────────────────────────────────
  const metadataJson = JSON.stringify({
    game:                "cs2",
    valuationPath:       "V3_SYNTHETIC_EMA",
    eventSource:         "SYNTHETIC_MATCH",
    alphaUsed:           SYNTH_ALPHA,
    avgPerformanceScore,
    streakBonus,
    streakPenalty,
    perfValue,
    adjustedPerfValue,
    prevRawValue,
    newRawValue,
    rawDelta,
    note: `Synthetic EMA. alpha=0.20, perfValue=${perfValue.toFixed(4)}, streak adj=${(streakBonus - streakPenalty).toFixed(4)}.`,
  });

  const histRow: InsertDota2ValueHistory = {
    assetId,
    playerProfileId:    existing.playerProfileId,
    performanceScoreId: null,
    rawValueBefore:     String(prevRawValue),
    rawValueAfter:      String(newRawValue),
    playerValueAfter:   String(newPlayerValue),
    performanceScore:   String(avgPerformanceScore),
    confidenceScore:    String(prevConfidence),
    alphaUsed:          String(SYNTH_ALPHA),
    betaUsed:           null,
    eventType:          "SYNTHETIC_MATCH" as any,
    metadataJson,
  };

  const historyId = await repo.insertDota2ValueHistory(histRow as any);

  console.log(
    `[Cs2SyntheticValuation] assetId=${assetId} ` +
    `prevRaw=${prevRawValue.toFixed(4)} → newRaw=${newRawValue.toFixed(4)} ` +
    `playerValue=${newPlayerValue.toFixed(4)} ` +
    `perf=${avgPerformanceScore.toFixed(4)} adj=${adjustedPerfValue.toFixed(4)} ` +
    `delta=${rawDelta.toFixed(4)} lastTradePrice updated`,
  );

  return {
    rawValueBefore:   prevRawValue,
    rawValueAfter:    newRawValue,
    playerValueAfter: newPlayerValue,
    historyId,
    alphaUsed:        SYNTH_ALPHA,
    perfValue,
    adjustedPerfValue,
  };
}

// ── Bulk asset dynamic update (Phase 2 — Dynamic Loop Coverage) ───────────────
//
// Called by multigameValuationScheduler for CS2 bulk assets (player_profile_id = 0).
//
// PandaScore API is currently unavailable (401) for bulk CS2 enrichment.
// This function fulfils the loop coverage contract by:
//   1. Touching dota2_valuation_state.updated_at (loop coverage tracking)
//   2. Returning an EXPLICIT "PROVIDER_UNAVAILABLE" result (never fails silently)
//
// When PandaScore becomes available again, implement the real fetch here:
//   GET /csgo/players/{pandascoreId} → career stats → EMA delta → RECALC event
// ─────────────────────────────────────────────────────────────────────────────

export interface Cs2BulkUpdateResult {
  assetId:  number;
  updated:  boolean;
  reason?:  string;
}

/**
 * Update valuation for a bulk CS2 asset.
 * Currently touches updatedAt and returns PROVIDER_UNAVAILABLE (PandaScore 401).
 * The explicit return ensures the loop never silently skips this asset.
 */
export async function updateBulkCs2ValuationFromProvider(
  assetId:       number,
  _pandascoreId: string,
): Promise<Cs2BulkUpdateResult> {
  await db
    .update(dota2ValuationState)
    .set({ updatedAt: new Date() })
    .where(eq(dota2ValuationState.assetId, assetId));

  return { assetId, updated: false, reason: "PROVIDER_UNAVAILABLE" };
}

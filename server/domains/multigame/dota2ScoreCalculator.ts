// ─── Dota2 Score Calculator ───────────────────────────────────────────────────
// Pure calculation layer for Fase 5 RoleRelativeScore.
//
// Pipeline per match:
//   1. Resolve baseline for each metric (Level A → B → C)
//   2. Compute robust z-score: z = (x - median) / (MAD * 1.4826)
//   3. Clamp z ∈ [-3, 3]
//   4. MetricScore = 50 + 16.67 * z_clamped  (clamp final to [0, 100])
//   5. Handle inverted metrics (deaths etc.) — applies before z computation
//      via score inversion: invertedScore = 100 - metricScore
//   6. Redistribute weights when a metric is missing
//   7. RoleRelativeScore = Σ(metricScore × effectiveWeight)
//
// No DB calls — takes baseline rows as input, returns numeric output.
// ─────────────────────────────────────────────────────────────────────────────

import type { PerformanceBaseline, BaselineFallbackLevel, DetectedRole } from "@shared/schema";
import type { Dota2MetricName } from "@shared/schema";
import { getWeightsForRole } from "./dota2MetricConfig";
import type { DerivedMetricMap } from "./dota2MetricDeriver";

// ── Constants ─────────────────────────────────────────────────────────────────

const CONSISTENCY_FACTOR = 1.4826;  // converts MAD → consistent std-dev estimate
const Z_CLAMP            = 3;        // clip z to ±3
const SCORE_CENTER       = 50;       // z=0 → score=50
const SCORE_SCALE        = 16.67;    // so z=±3 → score≈100 or 0

// ── Baseline lookup ───────────────────────────────────────────────────────────

export interface BaselineLookup {
  /** Indexed map: game|metric|role|heroId?|rankBucket?|patchBucket?|durationBucket? → baseline */
  byLevel: Map<string, PerformanceBaseline>;
}

/** Build a lookup structure from a flat list of baselines. */
export function buildBaselineLookup(baselines: PerformanceBaseline[]): BaselineLookup {
  const byLevel = new Map<string, PerformanceBaseline>();
  for (const b of baselines) {
    const key = makeBaselineKey(b.fallbackLevel as BaselineFallbackLevel, {
      game:           b.game,
      metric:         b.metric,
      role:           b.role as DetectedRole,
      heroId:         b.heroId ?? null,
      rankBucket:     b.rankBucket ?? null,
      patchBucket:    b.patchBucket ?? null,
      durationBucket: b.durationBucket ?? null,
    });
    byLevel.set(key, b);
  }
  return { byLevel };
}

function makeBaselineKey(
  level:   BaselineFallbackLevel,
  dims: {
    game:           string;
    metric:         string;
    role:           string;
    heroId:         number | null;
    rankBucket:     string | null;
    patchBucket:    string | null;
    durationBucket: string | null;
  },
): string {
  if (level === "A") {
    return `A|${dims.game}|${dims.metric}|${dims.role}|${dims.heroId ?? "_"}|${dims.rankBucket ?? "_"}|${dims.patchBucket ?? "_"}|${dims.durationBucket ?? "_"}`;
  }
  if (level === "B") {
    return `B|${dims.game}|${dims.metric}|${dims.role}|${dims.rankBucket ?? "_"}|${dims.patchBucket ?? "_"}|${dims.durationBucket ?? "_"}`;
  }
  return `C|${dims.game}|${dims.metric}|${dims.role}|${dims.rankBucket ?? "_"}`;
}

// ── Baseline resolver ─────────────────────────────────────────────────────────

export interface ResolvedBaseline {
  baseline:      PerformanceBaseline;
  fallbackLevel: BaselineFallbackLevel;
}

/**
 * Resolve the best available baseline for a given metric / match context.
 * Tries A → B → C. Returns null if no baseline exists at any level.
 */
export function resolveBaseline(
  lookup:        BaselineLookup,
  metric:        string,
  role:          DetectedRole,
  heroId:        number | null,
  rankBucket:    string | null,
  patchBucket:   string | null,
  durationBucket: string | null,
): ResolvedBaseline | null {
  const dims = { game: "dota2", metric, role };

  // Level A
  const keyA = makeBaselineKey("A", { ...dims, heroId, rankBucket, patchBucket, durationBucket });
  const bA = lookup.byLevel.get(keyA);
  if (bA) return { baseline: bA, fallbackLevel: "A" };

  // Level B
  const keyB = makeBaselineKey("B", { ...dims, heroId: null, rankBucket, patchBucket, durationBucket });
  const bB = lookup.byLevel.get(keyB);
  if (bB) return { baseline: bB, fallbackLevel: "B" };

  // Level C
  const keyC = makeBaselineKey("C", { ...dims, heroId: null, rankBucket, patchBucket: null, durationBucket: null });
  const bC = lookup.byLevel.get(keyC);
  if (bC) return { baseline: bC, fallbackLevel: "C" };

  return null;
}

// ── Core math ─────────────────────────────────────────────────────────────────

/**
 * Compute the robust z-score: z = (x - median) / (MAD × 1.4826)
 * Returns 0 when MAD = 0 (all cohort values identical).
 */
export function robustZScore(x: number, median: number, mad: number): number {
  const scale = mad * CONSISTENCY_FACTOR;
  if (scale === 0) return 0;
  return (x - median) / scale;
}

/**
 * Convert a (possibly inverted) z-score to a 0–100 metric score.
 * Inversion: applied before scoring by negating z → lower raw value → higher score.
 */
export function zToMetricScore(z: number, isInverted: boolean): number {
  const zAdjusted = isInverted ? -z : z;
  const zClamped  = Math.max(-Z_CLAMP, Math.min(Z_CLAMP, zAdjusted));
  const score     = SCORE_CENTER + SCORE_SCALE * zClamped;
  return Math.max(0, Math.min(100, score));
}

// ── Score calculation ─────────────────────────────────────────────────────────

export interface ScoreCalculationInput {
  role:           DetectedRole;
  heroId:         number | null;
  rankBucket:     string | null;
  patchBucket:    string | null;
  durationBucket: string | null;
  /** Derived metric values (from dota2MetricDeriver) */
  metrics:        DerivedMetricMap;
  /** Pre-built lookup from performanceBaselines rows */
  lookup:         BaselineLookup;
}

export interface MetricScoreDetail {
  rawValue:      number;
  median:        number;
  mad:           number;
  zScore:        number;
  metricScore:   number;       // 0–100
  isInverted:    boolean;
  fallbackLevel: BaselineFallbackLevel;
  weight:        number;       // original weight
  effectiveWeight: number;     // after redistribution
}

export interface ScoreCalculationResult {
  roleRelativeScore:  number;                                    // 0–100
  metricScores:       Record<string, MetricScoreDetail>;         // per-metric detail
  missingMetrics:     string[];                                  // metrics with no value or baseline
  baselineFallbackLevel: BaselineFallbackLevel | "MIXED";        // overall worst fallback used
  scoreVersion:       number;
}

/**
 * Calculate RoleRelativeScore for a single match.
 *
 * Missing metrics (no raw value OR no baseline) are excluded and their
 * weights redistributed proportionally among present metrics.
 */
export function calculateRoleRelativeScore(
  input: ScoreCalculationInput,
): ScoreCalculationResult | null {
  const { role, heroId, rankBucket, patchBucket, durationBucket, metrics, lookup } = input;

  const weightEntries = getWeightsForRole(role);
  if (weightEntries.length === 0) return null;

  const metricScores: Record<string, MetricScoreDetail> = {};
  const missingMetrics: string[] = [];
  const fallbackLevels = new Set<BaselineFallbackLevel>();

  // Phase 1: Attempt to score every metric
  interface TentativeScore {
    metric:         string;
    rawValue:       number;
    zScore:         number;
    metricScore:    number;
    isInverted:     boolean;
    fallbackLevel:  BaselineFallbackLevel;
    originalWeight: number;
    median:         number;
    mad:            number;
  }

  const tentative: TentativeScore[] = [];

  for (const entry of weightEntries) {
    const { metric, weight, isInverted } = entry;
    const rawValue = (metrics as any)[metric];

    if (rawValue == null) {
      missingMetrics.push(metric);
      continue;
    }

    const resolved = resolveBaseline(
      lookup, metric, role, heroId, rankBucket, patchBucket, durationBucket,
    );

    if (!resolved) {
      missingMetrics.push(metric);
      continue;
    }

    const { baseline, fallbackLevel } = resolved;
    const median    = parseFloat(String(baseline.medianValue));
    const mad       = parseFloat(String(baseline.madValue));
    const z         = robustZScore(rawValue, median, mad);
    const score     = zToMetricScore(z, isInverted);

    fallbackLevels.add(fallbackLevel);
    tentative.push({ metric, rawValue, zScore: z, metricScore: score, isInverted, fallbackLevel, originalWeight: weight, median, mad });
  }

  if (tentative.length === 0) return null; // nothing to score

  // Phase 2: Redistribute weights proportionally
  const totalOriginalWeight = tentative.reduce((s, t) => s + t.originalWeight, 0);
  if (totalOriginalWeight === 0) return null;

  let roleRelativeScore = 0;

  for (const t of tentative) {
    const effectiveWeight = t.originalWeight / totalOriginalWeight;

    metricScores[t.metric] = {
      rawValue:        t.rawValue,
      median:          t.median,
      mad:             t.mad,
      zScore:          parseFloat(t.zScore.toFixed(6)),
      metricScore:     parseFloat(t.metricScore.toFixed(4)),
      isInverted:      t.isInverted,
      fallbackLevel:   t.fallbackLevel,
      weight:          t.originalWeight,
      effectiveWeight: parseFloat(effectiveWeight.toFixed(6)),
    };

    roleRelativeScore += t.metricScore * effectiveWeight;
  }

  roleRelativeScore = Math.max(0, Math.min(100, roleRelativeScore));

  // Determine overall fallback level
  let overallFallback: BaselineFallbackLevel | "MIXED";
  if      (fallbackLevels.size === 0)                overallFallback = "C";
  else if (fallbackLevels.size === 1)                overallFallback = Array.from(fallbackLevels)[0];
  else if (fallbackLevels.has("A") && !fallbackLevels.has("C")) overallFallback = "B";
  else                                               overallFallback = "MIXED";

  return {
    roleRelativeScore:     parseFloat(roleRelativeScore.toFixed(4)),
    metricScores,
    missingMetrics,
    baselineFallbackLevel: overallFallback,
    scoreVersion:          1,
  };
}

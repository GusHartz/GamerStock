// ─── Dota2 Baseline Builder ───────────────────────────────────────────────────
// Computes robust baseline statistics (median, MAD) for every metric / cohort
// combination from the current set of eligible player_match_analytics rows.
//
// Cohort levels:
//   A  hero_id + role + rank_bucket + patch_bucket + duration_bucket
//   B  role + rank_bucket + patch_bucket + duration_bucket       (no hero)
//   C  role + rank_bucket                                        (minimal)
//
// Minimum sample thresholds (configurable):
//   Level A: MIN_SAMPLE_A = 10
//   Level B: MIN_SAMPLE_B = 20
//   Level C: MIN_SAMPLE_C = 5    (last resort — always try to build)
//
// Outputs a flat array of InsertPerformanceBaseline rows ready to upsert.
// ─────────────────────────────────────────────────────────────────────────────

import type { InsertPerformanceBaseline, BaselineFallbackLevel } from "@shared/schema";
import type { PlayerMatchAnalytic } from "@shared/schema";
import { deriveAllMetrics }  from "./dota2MetricDeriver";
import type { DerivedMetricMap } from "./dota2MetricDeriver";
import { SCORED_ROLES, getWeightsForRole } from "./dota2MetricConfig";

// ── Constants ─────────────────────────────────────────────────────────────────

const MIN_SAMPLE_A = 10;
const MIN_SAMPLE_B = 20;
const MIN_SAMPLE_C = 5;

export const BASELINE_VERSION = new Date().toISOString().slice(0, 10).replace(/-/g, "");

// ── Robust statistics ─────────────────────────────────────────────────────────

/** Compute the median of an array. Returns null for empty arrays. */
export function computeMedian(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Compute the Median Absolute Deviation (MAD).
 * MAD = median(|xᵢ - median(x)|)
 */
export function computeMAD(values: number[], median: number): number {
  if (values.length === 0) return 0;
  const deviations = values.map(v => Math.abs(v - median));
  return computeMedian(deviations) ?? 0;
}

// ── Cohort key builders ───────────────────────────────────────────────────────

function cohortKeyA(
  metric:         string,
  role:           string,
  heroId:         number | null,
  rankBucket:     string | null,
  patchBucket:    string | null,
  durationBucket: string | null,
): string {
  return `A|${metric}|${role}|${heroId ?? "_"}|${rankBucket ?? "_"}|${patchBucket ?? "_"}|${durationBucket ?? "_"}`;
}

function cohortKeyB(
  metric:         string,
  role:           string,
  rankBucket:     string | null,
  patchBucket:    string | null,
  durationBucket: string | null,
): string {
  return `B|${metric}|${role}|${rankBucket ?? "_"}|${patchBucket ?? "_"}|${durationBucket ?? "_"}`;
}

function cohortKeyC(
  metric:     string,
  role:       string,
  rankBucket: string | null,
): string {
  return `C|${metric}|${role}|${rankBucket ?? "_"}`;
}

// ── Metric value extraction ───────────────────────────────────────────────────

/**
 * Extract all scoreable metric values from an analytics record.
 * Parses metricsJson and contextJson, then runs the deriver.
 */
function extractMetricValues(
  analytic:     PlayerMatchAnalytic,
  metricNames:  string[],
): Partial<Record<string, number | null>> {
  let metricsObj: Record<string, any> = {};
  if (analytic.metricsJson) {
    try { metricsObj = JSON.parse(analytic.metricsJson); } catch { /* skip */ }
  }

  // Reconstruct a ParsedMatchMetrics-like object from stored JSON
  const pseudoParsed = {
    heroId:                  metricsObj.heroId ?? null,
    duration:                metricsObj.duration ?? null,
    kills:                   metricsObj.kills ?? null,
    deaths:                  metricsObj.deaths ?? null,
    assists:                 metricsObj.assists ?? null,
    gpm:                     metricsObj.gpm ?? null,
    xpm:                     metricsObj.xpm ?? null,
    netWorth:                metricsObj.netWorth ?? null,
    heroDamage:              metricsObj.heroDamage ?? null,
    towerDamage:             metricsObj.towerDamage ?? null,
    lastHits:                metricsObj.lastHits ?? null,
    denies:                  metricsObj.denies ?? null,
    heroHealing:             metricsObj.heroHealing ?? null,
    obsPlaced:               metricsObj.obsPlaced ?? null,
    senPlaced:               metricsObj.senPlaced ?? null,
    stunDuration:            metricsObj.stunDuration ?? null,
    teamfightParticipation:  metricsObj.teamfightParticipation ?? null,
    isRoaming:               metricsObj.isRoaming ?? null,
    providerLaneRole:        null,
    isRanked:                analytic.isRanked,
    radiantWin:              metricsObj.radiantWin ?? false,
    isRadiant:               metricsObj.isRadiant ?? false,
    won:                     metricsObj.won ?? false,
    lobbyType:               7,
    gameMode:                22,
  };

  const derived: DerivedMetricMap = deriveAllMetrics(pseudoParsed as any);
  const result: Partial<Record<string, number | null>> = {};
  for (const m of metricNames) {
    result[m] = (derived as any)[m] ?? null;
  }
  return result;
}

// ── Builder ───────────────────────────────────────────────────────────────────

export interface BuildBaselinesInput {
  analytics:       PlayerMatchAnalytic[];   // all eligible analytics records
  baselineVersion: string;
}

export interface BuiltBaseline {
  rows: InsertPerformanceBaseline[];
  /** Number of (metric, cohort) pairs computed */
  computedCount: number;
  /** Number of cohorts skipped due to insufficient sample size */
  skippedCount:  number;
}

/**
 * Build all baseline rows from a set of eligible analytics records.
 * Returns InsertPerformanceBaseline[] ready for bulk upsert.
 *
 * This function is pure — it does not touch the database.
 */
export function buildBaselines(input: BuildBaselinesInput): BuiltBaseline {
  const { analytics, baselineVersion } = input;

  // Accumulate raw metric values per cohort key
  const bucketsA = new Map<string, number[]>();
  const bucketsB = new Map<string, number[]>();
  const bucketsC = new Map<string, number[]>();

  // Cohort metadata for reconstruction
  const cohortMetaA = new Map<string, { metric: string; role: string; heroId: number | null; rankBucket: string | null; patchBucket: string | null; durationBucket: string | null }>();
  const cohortMetaB = new Map<string, { metric: string; role: string; rankBucket: string | null; patchBucket: string | null; durationBucket: string | null }>();
  const cohortMetaC = new Map<string, { metric: string; role: string; rankBucket: string | null }>();

  for (const analytic of analytics) {
    const role = analytic.detectedRole;
    if (!role || role === "UNKNOWN" || !SCORED_ROLES.includes(role as any)) continue;

    const metricNames = getWeightsForRole(role as any).map(w => w.metric);
    const values = extractMetricValues(analytic, metricNames);

    const heroId      = analytic.heroId ?? null;
    const rankBucket  = null; // Fase 5: rank_bucket not yet in analytics table — null for now
    const patchBucket = analytic.patchBucket ?? null;
    const durBucket   = analytic.durationBucket ?? null;

    for (const metric of metricNames) {
      const val = values[metric];
      if (val == null) continue; // missing → skip this data point for this metric

      // Level A
      const keyA = cohortKeyA(metric, role, heroId, rankBucket, patchBucket, durBucket);
      if (!bucketsA.has(keyA)) {
        bucketsA.set(keyA, []);
        cohortMetaA.set(keyA, { metric, role, heroId, rankBucket, patchBucket, durationBucket: durBucket });
      }
      bucketsA.get(keyA)!.push(val);

      // Level B
      const keyB = cohortKeyB(metric, role, rankBucket, patchBucket, durBucket);
      if (!bucketsB.has(keyB)) {
        bucketsB.set(keyB, []);
        cohortMetaB.set(keyB, { metric, role, rankBucket, patchBucket, durationBucket: durBucket });
      }
      bucketsB.get(keyB)!.push(val);

      // Level C
      const keyC = cohortKeyC(metric, role, rankBucket);
      if (!bucketsC.has(keyC)) {
        bucketsC.set(keyC, []);
        cohortMetaC.set(keyC, { metric, role, rankBucket });
      }
      bucketsC.get(keyC)!.push(val);
    }
  }

  const rows: InsertPerformanceBaseline[] = [];
  let computedCount = 0;
  let skippedCount  = 0;

  const processLevel = <T extends { metric: string; role: string }>(
    buckets:  Map<string, number[]>,
    metaMap:  Map<string, T>,
    level:    BaselineFallbackLevel,
    minSample: number,
    buildRow: (meta: T, median: number, mad: number, n: number) => InsertPerformanceBaseline,
  ) => {
    for (const [key, values] of Array.from(buckets)) {
      if (values.length < minSample) { skippedCount++; continue; }
      const median = computeMedian(values)!;
      const mad    = computeMAD(values, median);
      const meta   = metaMap.get(key)!;
      rows.push(buildRow(meta, median, mad, values.length));
      computedCount++;
    }
  };

  // Level A
  processLevel(bucketsA, cohortMetaA, "A", MIN_SAMPLE_A, (meta, median, mad, n) => ({
    game:            "dota2",
    metric:          meta.metric,
    role:            meta.role as any,
    heroId:          meta.heroId,
    rankBucket:      meta.rankBucket,
    patchBucket:     meta.patchBucket,
    durationBucket:  meta.durationBucket as any,
    fallbackLevel:   "A",
    medianValue:     String(median.toFixed(4)),
    madValue:        String(mad.toFixed(4)),
    sampleSize:      n,
    baselineVersion,
  }));

  // Level B
  processLevel(bucketsB, cohortMetaB, "B", MIN_SAMPLE_B, (meta, median, mad, n) => ({
    game:            "dota2",
    metric:          meta.metric,
    role:            meta.role as any,
    heroId:          null,
    rankBucket:      meta.rankBucket,
    patchBucket:     meta.patchBucket,
    durationBucket:  meta.durationBucket as any,
    fallbackLevel:   "B",
    medianValue:     String(median.toFixed(4)),
    madValue:        String(mad.toFixed(4)),
    sampleSize:      n,
    baselineVersion,
  }));

  // Level C
  processLevel(bucketsC, cohortMetaC, "C", MIN_SAMPLE_C, (meta, median, mad, n) => ({
    game:            "dota2",
    metric:          meta.metric,
    role:            meta.role as any,
    heroId:          null,
    rankBucket:      meta.rankBucket,
    patchBucket:     null,
    durationBucket:  undefined,
    fallbackLevel:   "C",
    medianValue:     String(median.toFixed(4)),
    madValue:        String(mad.toFixed(4)),
    sampleSize:      n,
    baselineVersion,
  }));

  return { rows, computedCount, skippedCount };
}

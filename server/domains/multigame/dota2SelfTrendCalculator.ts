// ─── Dota2 Self-Trend Calculator ──────────────────────────────────────────────
// Computes SelfTrendScore for a match by comparing it against the player's own
// recent match history using the same robust z-score framework as Fase 5.
//
// Key difference from Fase 5 (baseline engine):
//   Fase 5: compare player vs cohort population  (external baseline)
//   Fase 6: compare this match vs player's own recent window (internal baseline)
//
// Algorithm:
//   1. Gather the player's own N most recent eligible matches (excluding current)
//   2. Compute per-metric median and MAD from that window
//   3. Apply robust z-score, clamp, convert to 0–100 score
//   4. Redistribute weights for missing metrics
//   5. Aggregate with role weights → SelfTrendScore 0–100
//
// TrendConfidence scale:
//   ≥15 valid matches → 1.00
//   8–14              → 0.70
//   3–7               → 0.40
//   <3                → 0.00 (score computed but not used in PerformanceScore)
// ─────────────────────────────────────────────────────────────────────────────

import { computeMedian, computeMAD } from "./dota2BaselineBuilder";
import { robustZScore, zToMetricScore } from "./dota2ScoreCalculator";
import { getWeightsForRole }           from "./dota2MetricConfig";
import { deriveAllMetrics }            from "./dota2MetricDeriver";
import type { DetectedRole }           from "@shared/schema";
import type { DerivedMetricMap }       from "./dota2MetricDeriver";

// ── Constants ─────────────────────────────────────────────────────────────────

/** How many recent matches to look back for the self-trend window. */
const TREND_WINDOW = 20;

/** TrendConfidence thresholds */
const CONF_HIGH   = 15;   // 1.00
const CONF_MED    = 8;    // 0.70
const CONF_LOW    = 3;    // 0.40
// < CONF_LOW → 0.00

// ── Types ─────────────────────────────────────────────────────────────────────

/** Minimal representation of a historical match for self-trend calculation. */
export interface HistoricalMatchData {
  metricsJson: string | null;
  isEligible:  boolean;
}

export interface SelfTrendResult {
  selfTrendScore:   number;         // 0–100 (or 50 if no history)
  trendConfidence:  number;         // 0.00–1.00
  validMatchCount:  number;         // how many history matches had valid data
  missingMetrics:   string[];
  perMetricDetail:  Record<string, {
    rawValue:      number;
    histMedian:    number;
    histMAD:       number;
    zScore:        number;
    metricScore:   number;
    effectiveWeight: number;
  }>;
}

// ── Confidence calculator ─────────────────────────────────────────────────────

export function computeTrendConfidence(validMatchCount: number): number {
  if (validMatchCount >= CONF_HIGH) return 1.00;
  if (validMatchCount >= CONF_MED)  return 0.70;
  if (validMatchCount >= CONF_LOW)  return 0.40;
  return 0.00;
}

// ── History value extractor ───────────────────────────────────────────────────

/** Parse metricsJson from a historical match and derive all metrics. */
function extractHistoricalMetrics(metricsJson: string | null): DerivedMetricMap | null {
  if (!metricsJson) return null;
  let obj: Record<string, any>;
  try {
    obj = JSON.parse(metricsJson);
  } catch {
    return null;
  }

  const pseudo = {
    heroId:                  obj.heroId          ?? null,
    duration:                obj.duration         ?? null,
    kills:                   obj.kills            ?? null,
    deaths:                  obj.deaths           ?? null,
    assists:                 obj.assists          ?? null,
    gpm:                     obj.gpm              ?? null,
    xpm:                     obj.xpm              ?? null,
    netWorth:                obj.netWorth         ?? null,
    heroDamage:              obj.heroDamage       ?? null,
    towerDamage:             obj.towerDamage      ?? null,
    lastHits:                obj.lastHits         ?? null,
    denies:                  obj.denies           ?? null,
    heroHealing:             obj.heroHealing      ?? null,
    obsPlaced:               obj.obsPlaced        ?? null,
    senPlaced:               obj.senPlaced        ?? null,
    stunDuration:            obj.stunDuration     ?? null,
    teamfightParticipation:  obj.teamfightParticipation ?? null,
    isRoaming:               obj.isRoaming        ?? null,
    providerLaneRole:        null,
    isRanked:                true,
    radiantWin:              obj.radiantWin       ?? false,
    isRadiant:               obj.isRadiant        ?? false,
    won:                     obj.won              ?? false,
    lobbyType:               7,
    gameMode:                22,
  };

  return deriveAllMetrics(pseudo as any);
}

// ── Main calculator ───────────────────────────────────────────────────────────

/**
 * Calculate the SelfTrendScore for a single match.
 *
 * @param currentMetrics  Derived metrics for the match being scored
 * @param role            Player's detected role for this match
 * @param recentHistory   Array of recent matches (max TREND_WINDOW, ordered newest first)
 */
export function calculateSelfTrend(
  currentMetrics: DerivedMetricMap,
  role:           DetectedRole,
  recentHistory:  HistoricalMatchData[],
): SelfTrendResult {
  const weightEntries = getWeightsForRole(role);
  if (weightEntries.length === 0 || recentHistory.length === 0) {
    return noHistoryResult();
  }

  // Build per-metric historical value arrays
  const histArrays: Partial<Record<string, number[]>> = {};
  let validMatchCount = 0;
  let anyMetricFound  = false;

  for (const h of recentHistory.slice(0, TREND_WINDOW)) {
    const hm = extractHistoricalMetrics(h.metricsJson);
    if (!hm) continue;

    let matchHadData = false;
    for (const entry of weightEntries) {
      const val = (hm as any)[entry.metric];
      if (val == null) continue;
      if (!histArrays[entry.metric]) histArrays[entry.metric] = [];
      histArrays[entry.metric]!.push(val);
      matchHadData = true;
      anyMetricFound = true;
    }
    if (matchHadData) validMatchCount++;
  }

  const trendConfidence = computeTrendConfidence(validMatchCount);

  // Not enough history — return neutral score
  if (!anyMetricFound || validMatchCount < CONF_LOW) {
    return { ...noHistoryResult(), trendConfidence, validMatchCount };
  }

  // Score each metric against player's own history
  const perMetricDetail: SelfTrendResult["perMetricDetail"] = {};
  const tentative: { metric: string; metricScore: number; isInverted: boolean; origWeight: number }[] = [];

  for (const entry of weightEntries) {
    const { metric, weight, isInverted } = entry;
    const currentVal  = (currentMetrics as any)[metric];
    const histValues  = histArrays[metric] ?? [];

    if (currentVal == null || histValues.length < 2) continue;

    const histMedian  = computeMedian(histValues)!;
    const histMAD     = computeMAD(histValues, histMedian);
    const z           = robustZScore(currentVal, histMedian, histMAD);
    const metricScore = zToMetricScore(z, isInverted);

    tentative.push({ metric, metricScore, isInverted, origWeight: weight });
    perMetricDetail[metric] = {
      rawValue:   currentVal,
      histMedian,
      histMAD,
      zScore:     parseFloat(z.toFixed(6)),
      metricScore: parseFloat(metricScore.toFixed(4)),
      effectiveWeight: 0, // filled below
    };
  }

  if (tentative.length === 0) {
    return { ...noHistoryResult(), trendConfidence, validMatchCount };
  }

  // Redistribute weights
  const totalOrigWeight = tentative.reduce((s, t) => s + t.origWeight, 0);
  let selfTrendScore = 0;
  const missingMetrics = weightEntries
    .filter(e => !perMetricDetail[e.metric])
    .map(e => e.metric);

  for (const t of tentative) {
    const eff = t.origWeight / totalOrigWeight;
    perMetricDetail[t.metric].effectiveWeight = parseFloat(eff.toFixed(6));
    selfTrendScore += t.metricScore * eff;
  }

  selfTrendScore = Math.max(0, Math.min(100, selfTrendScore));

  return {
    selfTrendScore:  parseFloat(selfTrendScore.toFixed(4)),
    trendConfidence,
    validMatchCount,
    missingMetrics,
    perMetricDetail,
  };
}

/** Neutral result when there is no usable history. */
function noHistoryResult(): SelfTrendResult {
  return {
    selfTrendScore:  50,  // neutral — neither above nor below own baseline
    trendConfidence: 0.00,
    validMatchCount: 0,
    missingMetrics:  [],
    perMetricDetail: {},
  };
}

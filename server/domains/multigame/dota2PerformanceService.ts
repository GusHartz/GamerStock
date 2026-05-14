// ─── Dota2 Performance Service ────────────────────────────────────────────────
// Fase 6 orchestration layer.
//
// Pipeline per match:
//   1. Load player's eligible analytics with score components (Fase 5)
//   2. For each analytics record that has a score_component but no performance_score:
//      a. Extract metrics from metricsJson
//      b. Fetch player's N recent prior matches (self-trend window)
//      c. Calculate SelfTrendScore + TrendConfidence
//      d. Calculate ContextScore
//      e. Compute effective weights from TrendConfidence
//      f. Aggregate PerformanceScore
//      g. Upsert dota2_performance_scores
//
// Weights:
//   effective_self_trend_weight = 0.25 × trend_confidence
//   effective_context_weight    = 0.15  (fixed)
//   effective_role_weight       = 1 − effective_self_trend_weight − 0.15
//
// PerformanceScore = role_weight × RRS + trend_weight × SelfTrend + ctx_weight × ContextScore
// ─────────────────────────────────────────────────────────────────────────────

import * as repo                    from "./repository";
import { calculateSelfTrend }       from "./dota2SelfTrendCalculator";
import { calculateContextScore }    from "./dota2ContextCalculator";
import { deriveAllMetrics }         from "./dota2MetricDeriver";
import type {
  InsertDota2PerformanceScore,
  DetectedRole,
  DurationBucket,
} from "@shared/schema";

// ── Constants ─────────────────────────────────────────────────────────────────

const CONTEXT_WEIGHT_FIXED = 0.15;
const TREND_WEIGHT_BASE    = 0.25;
const SCORE_VERSION        = 1;

// How many recent eligible matches to look back for self-trend
const TREND_HISTORY_LIMIT  = 25;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ComputePerformanceInput {
  userId:      string;
  scoreLimit?: number;  // max analytics records to process per call (default: 50)
}

export interface PerformanceMatchResult {
  analyticsId:       number;
  providerMatchId:   string;
  role:              string;
  roleRelativeScore: number;
  selfTrendScore:    number | null;
  contextScore:      number;
  performanceScore:  number;
  trendConfidence:   number;
  effectiveRoleWeight:      number;
  effectiveSelfTrendWeight: number;
  effectiveContextWeight:   number;
  skipped:           boolean;
  skipReason?:       string;
}

export interface ComputePerformanceResult {
  computed:  number;
  skipped:   number;
  failed:    number;
  matches:   PerformanceMatchResult[];
  playerSummary: {
    avgPerformanceScore: number | null;
    totalScored:         number;
    avgByRole:           { role: string; avgScore: number; count: number }[];
  };
}

export interface PerformanceScoresResult {
  items:   any[];
  total:   number;
  limit:   number;
  offset:  number;
  avgScore: number | null;
}

// ── Weight composition ────────────────────────────────────────────────────────

function computeEffectiveWeights(trendConfidence: number): {
  effectiveRoleWeight:      number;
  effectiveSelfTrendWeight: number;
  effectiveContextWeight:   number;
} {
  const effectiveSelfTrendWeight = parseFloat((TREND_WEIGHT_BASE * trendConfidence).toFixed(4));
  const effectiveContextWeight   = CONTEXT_WEIGHT_FIXED;
  const effectiveRoleWeight      = parseFloat(
    Math.max(0, 1 - effectiveSelfTrendWeight - effectiveContextWeight).toFixed(4)
  );
  return { effectiveRoleWeight, effectiveSelfTrendWeight, effectiveContextWeight };
}

// ── Metrics reconstruction helper ─────────────────────────────────────────────

function rebuildMetrics(metricsJson: string | null) {
  let obj: Record<string, any> = {};
  if (metricsJson) { try { obj = JSON.parse(metricsJson); } catch { /* */ } }

  const pseudo = {
    heroId:                  obj.heroId            ?? null,
    duration:                obj.duration           ?? null,
    kills:                   obj.kills              ?? null,
    deaths:                  obj.deaths             ?? null,
    assists:                 obj.assists            ?? null,
    gpm:                     obj.gpm                ?? null,
    xpm:                     obj.xpm                ?? null,
    netWorth:                obj.netWorth           ?? null,
    heroDamage:              obj.heroDamage         ?? null,
    towerDamage:             obj.towerDamage        ?? null,
    lastHits:                obj.lastHits           ?? null,
    denies:                  obj.denies             ?? null,
    heroHealing:             obj.heroHealing        ?? null,
    obsPlaced:               obj.obsPlaced          ?? null,
    senPlaced:               obj.senPlaced          ?? null,
    stunDuration:            obj.stunDuration       ?? null,
    teamfightParticipation:  obj.teamfightParticipation ?? null,
    isRoaming:               obj.isRoaming          ?? null,
    providerLaneRole:        null,
    isRanked:                true,
    radiantWin:              obj.radiantWin         ?? false,
    isRadiant:               obj.isRadiant          ?? false,
    won:                     obj.won                ?? false,
    lobbyType:               7,
    gameMode:                22,
  };

  return { derivedMetrics: deriveAllMetrics(pseudo as any), won: obj.won ?? false };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compute and persist PerformanceScore for all eligible scored matches of a player.
 */
export async function computeDota2PerformanceScores(
  input: ComputePerformanceInput,
): Promise<ComputePerformanceResult> {
  const { userId, scoreLimit = 50 } = input;

  const profiles = await repo.findPlayerProfilesByUser(userId);
  const profile  = profiles.find(p => p.game === "dota2");
  if (!profile) {
    throw Object.assign(new Error("DOTA2_PROFILE_NOT_FOUND"), { status: 404 });
  }

  // Load eligible analytics records (have role_relative_score in score_components)
  const scoreComponents = await repo.listScoreComponentsByProfile(
    profile.id, { limit: scoreLimit },
  );

  if (scoreComponents.length === 0) {
    const [summary, total] = await Promise.all([
      repo.avgDota2PerformanceScoreByProfile(profile.id),
      repo.countDota2PerformanceScores(profile.id),
    ]);
    return {
      computed: 0, skipped: 0, failed: 0, matches: [],
      playerSummary: { avgPerformanceScore: summary?.overall ?? null, totalScored: total, avgByRole: summary?.byRole ?? [] },
    };
  }

  // Load the analytics records that correspond to these score components
  // (we need metricsJson, heroId, durationBucket, detectedRole)
  const analyticsIds = scoreComponents.map(c => c.playerMatchAnalyticsId);
  const analyticsMap = await repo.findAnalyticsByIds(analyticsIds);

  // Load self-trend history: all eligible analytics ordered by processedAt desc
  const allEligibleHistory = await repo.listMatchAnalyticsByProfile(
    profile.id, { eligibleOnly: true, limit: TREND_HISTORY_LIMIT + scoreComponents.length },
  );

  const results: PerformanceMatchResult[] = [];
  let computed = 0, skipped = 0, failed = 0;

  for (const sc of scoreComponents) {
    const analytic = analyticsMap.get(sc.playerMatchAnalyticsId);
    if (!analytic) {
      skipped++;
      results.push({
        analyticsId: sc.playerMatchAnalyticsId, providerMatchId: "", role: sc.role ?? "UNKNOWN",
        roleRelativeScore: 0, selfTrendScore: null, contextScore: 50, performanceScore: 0,
        trendConfidence: 0, effectiveRoleWeight: 0.85, effectiveSelfTrendWeight: 0, effectiveContextWeight: 0.15,
        skipped: true, skipReason: "ANALYTICS_NOT_FOUND",
      });
      continue;
    }

    const role = analytic.detectedRole as DetectedRole | null;
    if (!role || role === "UNKNOWN") {
      skipped++;
      results.push({
        analyticsId: sc.playerMatchAnalyticsId, providerMatchId: analytic.providerMatchId,
        role: role ?? "UNKNOWN", roleRelativeScore: 0, selfTrendScore: null, contextScore: 50,
        performanceScore: 0, trendConfidence: 0, effectiveRoleWeight: 0.85, effectiveSelfTrendWeight: 0,
        effectiveContextWeight: 0.15, skipped: true, skipReason: "UNKNOWN_ROLE",
      });
      continue;
    }

    const roleRelativeScore = parseFloat(String(sc.roleRelativeScore));

    // Build self-trend history window: all eligible matches OLDER than this one
    const trendHistory = allEligibleHistory
      .filter(h => h.id !== analytic.id && h.detectedRole === role)
      .slice(0, TREND_HISTORY_LIMIT)
      .map(h => ({ metricsJson: h.metricsJson, isEligible: h.isEligible }));

    const { derivedMetrics, won } = rebuildMetrics(analytic.metricsJson);

    // A. Self-Trend calculation
    const selfTrendResult = calculateSelfTrend(derivedMetrics, role, trendHistory);

    // B. Context calculation
    const contextResult = calculateContextScore({
      role,
      durationBucket: analytic.durationBucket as DurationBucket | null,
      won,
      isRanked: analytic.isRanked,
      metrics: derivedMetrics,
      roleRelativeScore,
    });

    // C. Effective weights
    const weights = computeEffectiveWeights(selfTrendResult.trendConfidence);

    // D. PerformanceScore = weighted sum
    const performanceScore = parseFloat(Math.max(0, Math.min(100,
      weights.effectiveRoleWeight      * roleRelativeScore +
      weights.effectiveSelfTrendWeight * selfTrendResult.selfTrendScore +
      weights.effectiveContextWeight   * contextResult.contextScore,
    )).toFixed(4));

    // E. Build full audit breakdown
    const componentsJson = JSON.stringify({
      roleRelativeScore: {
        value:  roleRelativeScore,
        weight: weights.effectiveRoleWeight,
        source: "Fase5_RoleRelativeScore",
      },
      selfTrend: {
        value:           selfTrendResult.selfTrendScore,
        weight:          weights.effectiveSelfTrendWeight,
        trendConfidence: selfTrendResult.trendConfidence,
        validMatchCount: selfTrendResult.validMatchCount,
        missingMetrics:  selfTrendResult.missingMetrics,
        perMetricDetail: selfTrendResult.perMetricDetail,
      },
      context: {
        value:             contextResult.contextScore,
        weight:            weights.effectiveContextWeight,
        matchDifficulty:   contextResult.matchDifficulty,
        matchLengthFit:    contextResult.matchLengthFit,
        objectiveLeverage: contextResult.objectiveLeverage,
        winLossContext:     contextResult.winLossContext,
        roleExpectationFit: contextResult.roleExpectationFit,
      },
      performanceScore,
    });

    const insertRow: InsertDota2PerformanceScore = {
      playerMatchAnalyticsId:   analytic.id,
      playerProfileId:          profile.id,
      game:                     "dota2" as any,
      role:                     role as any,
      roleRelativeScore:        String(roleRelativeScore),
      selfTrendScore:           String(selfTrendResult.selfTrendScore),
      contextScore:             String(contextResult.contextScore),
      performanceScore:         String(performanceScore),
      trendConfidence:          String(selfTrendResult.trendConfidence),
      effectiveRoleWeight:      String(weights.effectiveRoleWeight),
      effectiveSelfTrendWeight: String(weights.effectiveSelfTrendWeight),
      effectiveContextWeight:   String(weights.effectiveContextWeight),
      componentsJson,
      scoreVersion:             SCORE_VERSION,
    };

    try {
      await repo.upsertDota2PerformanceScore(insertRow as any);
      results.push({
        analyticsId:              analytic.id,
        providerMatchId:          analytic.providerMatchId,
        role,
        roleRelativeScore,
        selfTrendScore:           selfTrendResult.selfTrendScore,
        contextScore:             contextResult.contextScore,
        performanceScore,
        trendConfidence:          selfTrendResult.trendConfidence,
        effectiveRoleWeight:      weights.effectiveRoleWeight,
        effectiveSelfTrendWeight: weights.effectiveSelfTrendWeight,
        effectiveContextWeight:   weights.effectiveContextWeight,
        skipped: false,
      });
      computed++;
    } catch (err: any) {
      failed++;
      results.push({
        analyticsId: analytic.id, providerMatchId: analytic.providerMatchId, role,
        roleRelativeScore, selfTrendScore: null, contextScore: contextResult.contextScore,
        performanceScore: 0, trendConfidence: selfTrendResult.trendConfidence,
        effectiveRoleWeight: weights.effectiveRoleWeight, effectiveSelfTrendWeight: weights.effectiveSelfTrendWeight,
        effectiveContextWeight: weights.effectiveContextWeight,
        skipped: true, skipReason: `DB_ERROR: ${err.message}`,
      });
    }
  }

  const [summary, totalScored] = await Promise.all([
    repo.avgDota2PerformanceScoreByProfile(profile.id),
    repo.countDota2PerformanceScores(profile.id),
  ]);

  return {
    computed, skipped, failed,
    matches: results,
    playerSummary: {
      avgPerformanceScore: summary?.overall ?? null,
      totalScored,
      avgByRole: summary?.byRole ?? [],
    },
  };
}

/**
 * List persisted performance scores for a player.
 */
export async function getDota2PerformanceScores(
  userId:   string,
  limit   = 20,
  offset  = 0,
  role?:    string,
  applied?: boolean,
): Promise<PerformanceScoresResult> {
  const profiles = await repo.findPlayerProfilesByUser(userId);
  const profile  = profiles.find(p => p.game === "dota2");
  if (!profile) {
    throw Object.assign(new Error("DOTA2_PROFILE_NOT_FOUND"), { status: 404 });
  }

  const [items, total, summary] = await Promise.all([
    repo.listDota2PerformanceScores(profile.id, { limit, offset, role, applied }),
    repo.countDota2PerformanceScores(profile.id),
    repo.avgDota2PerformanceScoreByProfile(profile.id),
  ]);

  return {
    items,
    total,
    limit,
    offset,
    avgScore: summary?.overall ?? null,
  };
}

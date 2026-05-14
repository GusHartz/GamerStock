// ─── Dota2 Baseline Service ───────────────────────────────────────────────────
// Fase 5 orchestration layer. Three main responsibilities:
//
//   A. Baseline rebuild — loads eligible analytics, runs builder, upserts DB
//   B. RoleRelativeScore calculation — for a single player's pending analytics
//   C. Score inspection — read persisted components
//
// Workflow:
//   1. Admin triggers POST /api/admin/dota2/rebuild-baselines
//        → findEligibleAnalyticsForBaseline → buildBaselines → deleteBaselinesForGame
//        → bulkUpsertBaselines → seedMetricWeights (idempotent)
//   2. Player triggers POST /api/me/dota2/score-matches
//        → findAnalyticsForScoring → findBaselinesForGame → calculateRoleRelativeScore
//        → upsertScoreComponent (per match)
//   3. Player / admin reads GET /api/me/dota2/score-components
// ─────────────────────────────────────────────────────────────────────────────

import * as repo from "./repository";
import {
  buildBaselines,
  BASELINE_VERSION,
}                             from "./dota2BaselineBuilder";
import {
  buildBaselineLookup,
  calculateRoleRelativeScore,
}                             from "./dota2ScoreCalculator";
import { deriveAllMetrics }   from "./dota2MetricDeriver";
import {
  SCORED_ROLES,
  getWeightsForRole,
  WEIGHT_CONFIG_VERSION,
}                             from "./dota2MetricConfig";
import type {
  InsertPerformanceMetricWeight,
  InsertPerformanceScoreComponent,
  BaselineFallbackLevel,
  DetectedRole,
  PlayerMatchAnalytic,
} from "@shared/schema";

// ─────────────────────────────────────────────────────────────────────────────
//  A. Baseline Rebuild
// ─────────────────────────────────────────────────────────────────────────────

export interface RebuildBaselinesResult {
  game:          string;
  analyticsUsed: number;
  computed:      number;
  skipped:       number;
  baselineVersion: string;
  weightsSeeded: boolean;
}

/**
 * Full baseline rebuild for a game.
 * Steps: fetch eligible analytics → build stats → replace DB rows → seed weights.
 * Idempotent: can be run multiple times.
 */
export async function rebuildBaselines(
  game: string = "dota2",
): Promise<RebuildBaselinesResult> {
  // 1. Load eligible analytics
  const analytics = await repo.findEligibleAnalyticsForBaseline(game);

  // 2. Compute baseline rows (pure)
  const { rows, computedCount, skippedCount } = buildBaselines({
    analytics,
    baselineVersion: BASELINE_VERSION,
  });

  // 3. Replace existing baselines (delete → insert)
  await repo.deleteBaselinesForGame(game);
  if (rows.length > 0) {
    await repo.bulkUpsertBaselines(rows);
  }

  // 4. Seed metric weights (idempotent — skips existing rows)
  const weightRows = buildMetricWeightRows(game);
  await repo.seedMetricWeights(weightRows);

  return {
    game,
    analyticsUsed:   analytics.length,
    computed:        computedCount,
    skipped:         skippedCount,
    baselineVersion: BASELINE_VERSION,
    weightsSeeded:   true,
  };
}

// ── Weight row builder ────────────────────────────────────────────────────────

function buildMetricWeightRows(game: string): InsertPerformanceMetricWeight[] {
  const rows: InsertPerformanceMetricWeight[] = [];
  for (const role of SCORED_ROLES) {
    for (const entry of getWeightsForRole(role)) {
      rows.push({
        game:        game as any,
        role:        role as any,
        metric:      entry.metric,
        weight:      String(entry.weight),
        isInverted:  entry.isInverted,
        version:     WEIGHT_CONFIG_VERSION,
      });
    }
  }
  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
//  B. Score Calculation
// ─────────────────────────────────────────────────────────────────────────────

export interface ScoreMatchesInput {
  userId:       string;
  /** Max analytics records to score per call (default: 50) */
  scoreLimit?:  number;
}

export interface MatchScoreResult {
  analyticsId:       number;
  providerMatchId:   string;
  role:              DetectedRole;
  roleRelativeScore: number;
  baselineFallback:  string;
  missingMetrics:    string[];
  skipped:           boolean;
  skipReason?:       string;
}

export interface ScoreMatchesResult {
  scored:          number;
  skipped:         number;
  failed:          number;
  matches:         MatchScoreResult[];
  playerSummary: {
    avgScoreByRole: { role: string; avgScore: number; matchCount: number }[];
    totalScored:    number;
  };
}

/**
 * Score all eligible, unscored match analytics for a player.
 * Loads baselines once and reuses the lookup for all matches.
 */
export async function scoreDota2Matches(
  input: ScoreMatchesInput,
): Promise<ScoreMatchesResult> {
  const { userId, scoreLimit = 50 } = input;

  // Locate player profile
  const profiles = await repo.findPlayerProfilesByUser(userId);
  const profile  = profiles.find(p => p.game === "dota2");
  if (!profile) {
    throw Object.assign(new Error("DOTA2_PROFILE_NOT_FOUND"), { status: 404 });
  }

  // Load eligible analytics not yet scored (no score component row)
  // We load all and filter in-app to avoid a complex anti-join query
  const allAnalytics = await repo.listMatchAnalyticsByProfile(
    profile.id, { eligibleOnly: true, limit: scoreLimit },
  );

  if (allAnalytics.length === 0) {
    const summary = await repo.avgRoleRelativeScoreByProfile(profile.id);
    const total   = await repo.countScoreComponentsByProfile(profile.id);
    return {
      scored: 0, skipped: 0, failed: 0, matches: [],
      playerSummary: { avgScoreByRole: summary, totalScored: total },
    };
  }

  // Load all baselines once (shared across all matches)
  const baselineRows = await repo.findBaselinesForGame("dota2");
  const lookup       = buildBaselineLookup(baselineRows);

  const results: MatchScoreResult[] = [];
  let scored = 0, skipped = 0, failed = 0;

  for (const analytic of allAnalytics) {
    const role = analytic.detectedRole as DetectedRole | null;
    if (!role || role === "UNKNOWN") {
      results.push({
        analyticsId:       analytic.id,
        providerMatchId:   analytic.providerMatchId,
        role:              role ?? ("UNKNOWN" as any),
        roleRelativeScore: 0,
        baselineFallback:  "N/A",
        missingMetrics:    [],
        skipped:           true,
        skipReason:        "UNKNOWN_ROLE",
      });
      skipped++;
      continue;
    }

    // Parse stored metrics
    let metricsObj: Record<string, any> = {};
    if (analytic.metricsJson) {
      try { metricsObj = JSON.parse(analytic.metricsJson); } catch { /* */ }
    }

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

    const derivedMetrics = deriveAllMetrics(pseudoParsed as any);

    const calcResult = calculateRoleRelativeScore({
      role,
      heroId:         analytic.heroId ?? null,
      rankBucket:     null,
      patchBucket:    analytic.patchBucket ?? null,
      durationBucket: analytic.durationBucket ?? null,
      metrics:        derivedMetrics,
      lookup,
    });

    if (!calcResult) {
      results.push({
        analyticsId:       analytic.id,
        providerMatchId:   analytic.providerMatchId,
        role,
        roleRelativeScore: 0,
        baselineFallback:  "N/A",
        missingMetrics:    [],
        skipped:           true,
        skipReason:        "NO_BASELINE",
      });
      skipped++;
      continue;
    }

    // Build effective weights map (metric → effectiveWeight)
    const effectiveWeights: Record<string, number> = {};
    const zscores: Record<string, number> = {};
    for (const [m, detail] of Object.entries(calcResult.metricScores)) {
      effectiveWeights[m] = detail.effectiveWeight;
      zscores[m] = detail.zScore;
    }

    const scoreComponent: InsertPerformanceScoreComponent = {
      playerMatchAnalyticsId: analytic.id,
      playerProfileId:        profile.id,
      game:                   "dota2" as any,
      role:                   role as any,
      baselineFallbackLevel:  (calcResult.baselineFallbackLevel === "MIXED"
                                ? "C" : calcResult.baselineFallbackLevel) as any,
      baselineVersion:        BASELINE_VERSION,
      metricScoresJson:       JSON.stringify(
                                Object.fromEntries(
                                  Object.entries(calcResult.metricScores)
                                    .map(([m, d]) => [m, d.metricScore])
                                )
                              ),
      metricZscoresJson:      JSON.stringify(zscores),
      effectiveWeightsJson:   JSON.stringify(effectiveWeights),
      missingMetricsJson:     calcResult.missingMetrics.length > 0
                                ? JSON.stringify(calcResult.missingMetrics)
                                : null,
      roleRelativeScore:      String(calcResult.roleRelativeScore),
      scoreVersion:           calcResult.scoreVersion,
    };

    try {
      await repo.upsertScoreComponent(scoreComponent as any);
      results.push({
        analyticsId:       analytic.id,
        providerMatchId:   analytic.providerMatchId,
        role,
        roleRelativeScore: calcResult.roleRelativeScore,
        baselineFallback:  calcResult.baselineFallbackLevel,
        missingMetrics:    calcResult.missingMetrics,
        skipped:           false,
      });
      scored++;
    } catch (err: any) {
      results.push({
        analyticsId:       analytic.id,
        providerMatchId:   analytic.providerMatchId,
        role,
        roleRelativeScore: 0,
        baselineFallback:  "N/A",
        missingMetrics:    [],
        skipped:           true,
        skipReason:        `DB_ERROR: ${err.message}`,
      });
      failed++;
    }
  }

  const [summary, totalScored] = await Promise.all([
    repo.avgRoleRelativeScoreByProfile(profile.id),
    repo.countScoreComponentsByProfile(profile.id),
  ]);

  return {
    scored, skipped, failed,
    matches: results,
    playerSummary: { avgScoreByRole: summary, totalScored },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  C. Score Inspection
// ─────────────────────────────────────────────────────────────────────────────

export interface ScoreComponentsResult {
  items:   any[];
  total:   number;
  limit:   number;
  offset:  number;
  summary: { role: string; avgScore: number; matchCount: number }[];
}

export async function getDota2ScoreComponents(
  userId:  string,
  limit  = 20,
  offset = 0,
  role?:   string,
): Promise<ScoreComponentsResult> {
  const profiles = await repo.findPlayerProfilesByUser(userId);
  const profile  = profiles.find(p => p.game === "dota2");
  if (!profile) {
    throw Object.assign(new Error("DOTA2_PROFILE_NOT_FOUND"), { status: 404 });
  }

  const [items, total, summary] = await Promise.all([
    repo.listScoreComponentsByProfile(profile.id, { limit, offset, role }),
    repo.countScoreComponentsByProfile(profile.id),
    repo.avgRoleRelativeScoreByProfile(profile.id),
  ]);

  return { items, total, limit, offset, summary };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Baseline inspection (admin)
// ─────────────────────────────────────────────────────────────────────────────

export async function getBaselineStats(game = "dota2") {
  return repo.countBaselines(game);
}

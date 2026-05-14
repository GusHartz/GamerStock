// ─── Dota2 Match Enrichment Service ─────────────────────────────────────────
// Orchestrates the full Fase 4 enrichment pipeline:
//
//   player_match_source_data (RAW_FETCHED or DETAIL_FETCHED)
//     → [1] fetch match detail from OpenDota (if not yet fetched)
//     → [2] store full payload in raw_payload_json
//     → [3] parse analytics (extract structured metrics)
//     → [4] detect role (PROVIDER → HEURISTIC → FALLBACK)
//     → [5] classify per-match eligibility
//     → [6] upsert player_match_analytics
//     → [7] update match_status (PROCESSED | SKIPPED | FAILED)
//
// Rules:
//   - Each match is processed independently (failure of one != failure of all)
//   - Re-processing is idempotent (ON CONFLICT DO UPDATE in repository)
//   - LoL data is never touched
//   - No PerformanceScore computed here (Fase 5+)
// ─────────────────────────────────────────────────────────────────────────────

import * as repo          from "./repository";
import * as openDota      from "./providers/openDotaClient";
import { parseMatchDetail, hasRequiredMetrics } from "./dota2MatchParser";
import { detectRole, ROLE_CONFIDENCE_THRESHOLD } from "./dota2RoleDetector";
import type { InsertPlayerMatchAnalytic, MatchAnalyticsEligibilityCode } from "@shared/schema";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Maximum matches to enrich per single run. Keeps API call count bounded. */
const DEFAULT_PROCESS_LIMIT = 10;

// Small delay between OpenDota API calls to stay within rate limit
const API_CALL_DELAY_MS = 500;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EnrichMatchesInput {
  userId:        string;
  /** Max matches to process per run (default: 10) */
  processLimit?: number;
}

export interface MatchProcessingResult {
  sourceId:      number;
  providerMatchId: string;
  status:        "processed" | "skipped" | "failed";
  isEligible?:   boolean;
  detectedRole?: string;
  eligibilityCode?: string;
  error?:        string;
}

export interface EnrichMatchesResult {
  processed:  number;
  skipped:    number;
  failed:     number;
  eligible:   number;
  matches:    MatchProcessingResult[];
  /** Updated player-level eligibility summary */
  readiness: {
    totalAnalyzed:    number;
    eligibleMatches:  number;
    dataCompleteness: number;
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Per-match processing ──────────────────────────────────────────────────────

async function processSingleMatch(
  rawRecord:   ReturnType<typeof Object.create> & Awaited<ReturnType<typeof repo.findMatchesForEnrichment>>[number],
  accountId32: string,
): Promise<MatchProcessingResult> {
  const sourceId        = rawRecord.id;
  const providerMatchId = rawRecord.providerMatchId;

  // ── Step 1: Fetch detail if not already stored ─────────────────────────────
  let detailPayload: any;
  try {
    if (rawRecord.rawPayloadJson) {
      // Already have payload from a previous partial run
      detailPayload = JSON.parse(rawRecord.rawPayloadJson);
    } else {
      detailPayload = await openDota.fetchMatchDetail(providerMatchId);
      await repo.enrichMatchPayload(sourceId, JSON.stringify(detailPayload));
    }
  } catch (err: any) {
    const errorMsg = `DETAIL_FETCH_FAILED: ${err.message}`;
    await repo.updateMatchSourceStatus(sourceId, "FAILED", errorMsg);
    return { sourceId, providerMatchId, status: "failed", error: errorMsg };
  }

  // ── Step 2: Parse analytics from detail payload ────────────────────────────
  let parseResult: ReturnType<typeof parseMatchDetail>;
  try {
    parseResult = parseMatchDetail(detailPayload as openDota.OpenDotaMatchDetail, accountId32);
  } catch (err: any) {
    const errorMsg = `PARSE_FAILED: ${err.message}`;
    await repo.updateMatchSourceStatus(sourceId, "FAILED", errorMsg);
    return { sourceId, providerMatchId, status: "failed", error: errorMsg };
  }

  // ── Step 3: Account mismatch check ────────────────────────────────────────
  if (!parseResult) {
    const analyticsData: InsertPlayerMatchAnalytic = {
      playerMatchSourceDataId: sourceId,
      playerProfileId:         rawRecord.playerProfileId,
      connectedAccountId:      rawRecord.connectedAccountId,
      assetId:                 rawRecord.assetId,
      game:                    rawRecord.game,
      providerGroup:           rawRecord.providerGroup,
      providerMatchId,
      heroId:                  null,
      detectedRole:            undefined,
      roleSource:              undefined,
      roleConfidence:          undefined,
      durationBucket:          undefined,
      patchBucket:             undefined,
      isRanked:                rawRecord.isRanked ?? false,
      isEligible:              false,
      eligibilityReasonCode:   "ACCOUNT_MISMATCH",
      dataCompleteness:        "0",
      metricsJson:             null,
      missingMetricsJson:      JSON.stringify(["all"]),
      contextJson:             null,
      processedAt:             new Date(),
    };
    await repo.upsertMatchAnalytics(analyticsData as any);
    await repo.updateMatchSourceStatus(sourceId, "SKIPPED", null);
    return {
      sourceId, providerMatchId, status: "skipped",
      isEligible: false, eligibilityCode: "ACCOUNT_MISMATCH",
    };
  }

  const { metrics, durationBucket, missingMetrics, dataCompleteness, contextFields } = parseResult;

  // ── Step 4: Classify per-match eligibility ────────────────────────────────
  let eligibilityCode: MatchAnalyticsEligibilityCode;
  let isEligible = false;

  if (!metrics.isRanked) {
    eligibilityCode = "NOT_RANKED";
  } else if (!hasRequiredMetrics(parseResult)) {
    eligibilityCode = "MISSING_REQUIRED_METRICS";
  } else {
    // ── Step 5: Role detection ─────────────────────────────────────────────
    const roleResult = detectRole(metrics);
    if (roleResult.detectedRole === "UNKNOWN" || roleResult.roleConfidence < ROLE_CONFIDENCE_THRESHOLD) {
      eligibilityCode = "ROLE_UNCERTAIN";
    } else {
      eligibilityCode = "ELIGIBLE";
      isEligible = true;
    }

    // ── Step 6: Upsert analytics record ───────────────────────────────────
    const analyticsData: InsertPlayerMatchAnalytic = {
      playerMatchSourceDataId: sourceId,
      playerProfileId:         rawRecord.playerProfileId,
      connectedAccountId:      rawRecord.connectedAccountId,
      assetId:                 rawRecord.assetId,
      game:                    rawRecord.game,
      providerGroup:           rawRecord.providerGroup,
      providerMatchId,
      heroId:                  metrics.heroId,
      detectedRole:            roleResult.detectedRole,
      roleSource:              roleResult.roleSource,
      roleConfidence:          String(roleResult.roleConfidence),
      durationBucket,
      patchBucket:             null,
      isRanked:                metrics.isRanked,
      isEligible,
      eligibilityReasonCode:   eligibilityCode,
      dataCompleteness:        String(parseFloat(dataCompleteness.toFixed(4))),
      metricsJson:             JSON.stringify({
        heroId:                metrics.heroId,
        duration:              metrics.duration,
        kills:                 metrics.kills,
        deaths:                metrics.deaths,
        assists:               metrics.assists,
        gpm:                   metrics.gpm,
        xpm:                   metrics.xpm,
        netWorth:              metrics.netWorth,
        heroDamage:            metrics.heroDamage,
        towerDamage:           metrics.towerDamage,
        lastHits:              metrics.lastHits,
        denies:                metrics.denies,
        heroHealing:           metrics.heroHealing,
        obsPlaced:             metrics.obsPlaced,
        senPlaced:             metrics.senPlaced,
        stunDuration:          metrics.stunDuration,
        teamfightParticipation: metrics.teamfightParticipation,
        isRoaming:             metrics.isRoaming,
        won:                   metrics.won,
        isRadiant:             metrics.isRadiant,
      }),
      missingMetricsJson:      missingMetrics.length > 0 ? JSON.stringify(missingMetrics) : null,
      contextJson:             JSON.stringify({
        ...contextFields,
        lobbyType:  metrics.lobbyType,
        gameMode:   metrics.gameMode,
        durationBucket,
        roleDetectionSource: roleResult.roleSource,
        roleConfidence:      roleResult.roleConfidence,
      }),
      processedAt:             new Date(),
    };

    await repo.upsertMatchAnalytics(analyticsData as any);
    await repo.updateMatchSourceStatus(sourceId, isEligible ? "PROCESSED" : "SKIPPED", null);

    return {
      sourceId,
      providerMatchId,
      status:          isEligible ? "processed" : "skipped",
      isEligible,
      detectedRole:    roleResult.detectedRole,
      eligibilityCode,
    };
  }

  // Non-role eligibility failure path (NOT_RANKED or MISSING_REQUIRED_METRICS)
  const analyticsData: InsertPlayerMatchAnalytic = {
    playerMatchSourceDataId: sourceId,
    playerProfileId:         rawRecord.playerProfileId,
    connectedAccountId:      rawRecord.connectedAccountId,
    assetId:                 rawRecord.assetId,
    game:                    rawRecord.game,
    providerGroup:           rawRecord.providerGroup,
    providerMatchId,
    heroId:                  metrics.heroId,
    detectedRole:            undefined,
    roleSource:              undefined,
    roleConfidence:          undefined,
    durationBucket,
    patchBucket:             null,
    isRanked:                metrics.isRanked,
    isEligible:              false,
    eligibilityReasonCode:   eligibilityCode,
    dataCompleteness:        String(parseFloat(dataCompleteness.toFixed(4))),
    metricsJson:             JSON.stringify({ heroId: metrics.heroId, duration: metrics.duration, isRanked: metrics.isRanked }),
    missingMetricsJson:      missingMetrics.length > 0 ? JSON.stringify(missingMetrics) : null,
    contextJson:             JSON.stringify(contextFields),
    processedAt:             new Date(),
  };

  await repo.upsertMatchAnalytics(analyticsData as any);
  await repo.updateMatchSourceStatus(sourceId, "SKIPPED", null);

  return {
    sourceId, providerMatchId, status: "skipped",
    isEligible: false, eligibilityCode,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Run the enrichment pipeline for the authenticated user's Dota2 matches.
 * Processes up to `processLimit` matches per call.
 */
export async function enrichDota2Matches(
  input: EnrichMatchesInput,
): Promise<EnrichMatchesResult> {
  const { userId, processLimit = DEFAULT_PROCESS_LIMIT } = input;

  // ── Locate player profile ───────────────────────────────────────────────────
  const account = await repo.findDota2ConnectedAccount(userId);
  if (!account) {
    throw Object.assign(new Error("DOTA2_ACCOUNT_NOT_CONNECTED"), { status: 404 });
  }

  const profiles = await repo.findPlayerProfilesByUser(userId);
  const profile = profiles.find(p => p.game === "dota2");
  if (!profile) {
    throw Object.assign(new Error("DOTA2_PROFILE_NOT_FOUND"), { status: 404 });
  }

  let accountId32: string;
  try {
    accountId32 = openDota.steamId64ToAccountId32(account.providerAccountId);
  } catch (err: any) {
    throw Object.assign(new Error(`INVALID_STEAM_ID: ${err.message}`), { status: 400 });
  }

  // ── Fetch matches pending enrichment ───────────────────────────────────────
  const matchesToProcess = await repo.findMatchesForEnrichment(
    profile.id, ["RAW_FETCHED", "DETAIL_FETCHED"], processLimit,
  );

  const results: MatchProcessingResult[] = [];
  let processed = 0, skipped = 0, failed = 0, eligible = 0;

  for (const match of matchesToProcess) {
    const result = await processSingleMatch(match, accountId32);
    results.push(result);

    if      (result.status === "processed") processed++;
    else if (result.status === "skipped")   skipped++;
    else                                    failed++;
    if (result.isEligible) eligible++;

    // Polite delay between API calls
    if (matchesToProcess.indexOf(match) < matchesToProcess.length - 1) {
      await sleep(API_CALL_DELAY_MS);
    }
  }

  // ── Compute readiness summary ────────────────────────────────────────────
  const [totalAnalyzed, eligibleMatches] = await Promise.all([
    repo.countTotalAnalyticsByProfile(profile.id),
    repo.countEligibleAnalyticsByProfile(profile.id),
  ]);

  const dataCompleteness = totalAnalyzed > 0
    ? parseFloat((eligibleMatches / totalAnalyzed).toFixed(4))
    : 0;

  return {
    processed,
    skipped,
    failed,
    eligible,
    matches: results,
    readiness: {
      totalAnalyzed,
      eligibleMatches,
      dataCompleteness,
    },
  };
}

/**
 * Get match analytics list for the authenticated user's Dota2 profile.
 */
export interface MatchAnalyticsListResult {
  items:     any[];
  total:     number;
  limit:     number;
  offset:    number;
  eligible:  number;
}

export async function getDota2MatchAnalytics(
  userId:       string,
  limit  = 20,
  offset = 0,
  eligibleOnly = false,
): Promise<MatchAnalyticsListResult> {
  const profiles = await repo.findPlayerProfilesByUser(userId);
  const profile = profiles.find(p => p.game === "dota2");
  if (!profile) {
    throw Object.assign(new Error("DOTA2_PROFILE_NOT_FOUND"), { status: 404 });
  }

  const [items, total, eligible] = await Promise.all([
    repo.listMatchAnalyticsByProfile(profile.id, { limit, offset, eligibleOnly }),
    repo.countTotalAnalyticsByProfile(profile.id),
    repo.countEligibleAnalyticsByProfile(profile.id),
  ]);

  return { items, total, limit, offset, eligible };
}

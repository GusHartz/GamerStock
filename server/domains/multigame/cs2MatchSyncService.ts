// ─── CS2 Match Sync Service ────────────────────────────────────────────────────
// Fase 4 (CS2): Ingestion pipeline for CS2 player data.
//
// Overview:
//   GS User (CS2 connected account)
//     → Steam Web API: fetch aggregate career stats
//     → Persist aggregate record (idempotent upsert in player_match_source_data)
//     → Compute CS2 performance score from FPS signals
//     → Refresh eligibility snapshot with updated sampleSize / dataCompleteness
//     → Trigger cs2ValuationService incremental update
//
// Provider strategy (V1):
//   The Steam Web API (`GetUserStatsForGame`, appid=730) provides aggregate
//   career stats — not per-match history. This is the only publicly available
//   data source that doesn't require a third-party key beyond STEAM_WEB_API_KEY.
//
//   Storage: one idempotent "career_aggregate" record per player in
//   player_match_source_data (providerMatchId = "career_aggregate").
//   This record is upserted on every sync run.
//
//   Rationale for aggregate-first:
//   - Per-match CS2 data is not publicly available from Valve.
//   - FACEIT API provides per-match data for FACEIT players (future TODO).
//   - PandaScore covers pro tournament matches (future TODO).
//   - The aggregate approach is sufficient for V1 valuation updates.
//
// CS2 performance signals (FPS-specific — NOT Dota2/MOBA signals):
//   kdRatio          (kills / deaths)         — primary skill indicator
//   headshotPct      (headshots / kills)       — precision / FPS technique
//   winRate          (wins / matches)          — competitive success
//   avgKillsPerRound (kills / rounds)          — impact metric (FPS equivalent of impact score)
//
// Performance score formula:
//   performanceScore = clamp(
//     0.35 * kdNorm           (K/D, range 0.3..2.0 → 0..1)
//   + 0.30 * hsNorm           (HS%, range 0..55% → 0..1)
//   + 0.20 * winRateNorm      (WR, range 20%..80% → 0..1)
//   + 0.15 * kprNorm          (KPR, range 0..0.8 → 0..1)
//   , 0, 1)
//
// TODOs (next phases):
//   TODO [Fase 5]: FACEIT API integration — per-match history for FACEIT players
//   TODO [Fase 5]: PandaScore match history for pro players identified via onboarding
//   TODO [Fase 6]: cs2PerformanceService — per-match analytics (when per-match data available)
//   TODO [Fase 7]: cs2ValuationService V2 — full EMA update from performance history
//   TODO [ops]:   Cache Steam stats responses (valid for 1h — Steam rate-limits per-key)
// ─────────────────────────────────────────────────────────────────────────────

import * as repo                             from "./repository";
import { fetchCs2CareerStats,
         validateSteamApiKey }               from "./providers/steamCs2StatsClient";
import { refreshCs2ValuationFromMatchData,
         refreshCs2ValuationFromSyntheticMatches } from "./cs2ValuationService";
import { saveCs2StatsSnapshot,
         getLatestCs2Snapshots }             from "./cs2StatsSnapshotService";
import { computeCs2StatsDelta }              from "./cs2DeltaEngine";
import { generateSyntheticMatches,
         annotateCs2SyntheticMatchRows }     from "./cs2SyntheticMatchService";
import type { Cs2CareerStats }               from "./providers/steamCs2StatsClient";
import type { InsertPlayerMatchSourceDatum } from "@shared/schema";

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Synthetic match ID for the career aggregate record.
 * This is the stable dedup key for the single aggregate row per player.
 * Upserted on every sync — one row, always current.
 */
const CAREER_AGGREGATE_MATCH_ID = "career_aggregate";

/**
 * Minimum matches Valve reports before we consider data meaningful.
 * Below this threshold the provider data is too sparse for reliable signals.
 */
const MIN_MATCHES_FOR_SIGNAL = 10;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SyncCs2StatsInput {
  userId:              string;
  /** If true, forces re-sync even if aggregate was synced recently. */
  forceRefresh?:       boolean;
}

export interface Cs2PerformanceScore {
  /** Overall performance score 0..1. */
  score:            number;
  /** K/D ratio (raw). */
  kdRatio:          number;
  /** Headshot % (raw, 0..1). */
  headshotPct:      number;
  /** Win rate (raw, 0..1). */
  winRate:          number;
  /** Average kills per round (raw). */
  avgKillsPerRound: number;
  /** Normalised components (each 0..1). */
  components: {
    kdNorm:      number;
    hsNorm:      number;
    winRateNorm: number;
    kprNorm:     number;
  };
}

export interface SyncCs2StatsResult {
  /** Provider response outcome. */
  providerStatus:   "ok" | "no_key" | "private_profile" | "empty_stats" | "provider_error";
  providerError?:   string;
  /** true if the aggregate record already existed (updated), false if created. */
  recordUpdated:    boolean;
  /** CS2 stats from the provider (null if provider failed). */
  careerStats:      Cs2CareerStats | null;
  /** CS2 performance score derived from career stats (null if insufficient data). */
  performanceScore: Cs2PerformanceScore | null;
  /** Eligibility snapshot after this sync run. */
  readiness: {
    totalMatches:     number;
    dataCompleteness: number;
    reasonCode:       string;
    isEligible:       boolean;
    snapshotId:       number;
  };
  /** Valuation update result (null if skipped). */
  valuation: {
    rawValueAfter:    number;
    playerValueAfter: number;
    confidenceScore:  number;
    historyId:        number;
    /** Which valuation path was used: V2 EMA or V1 bootstrap re-run. */
    valuationPath:    "V2_EMA" | "V1_BOOTSTRAP_RERUN";
  } | null;
  /** Synthetic match pipeline result (null if skipped or no new matches detected). */
  syntheticPipeline: {
    snapshotId:          number;
    deltaMatches:        number;
    matchesGenerated:    number;
    avgPerformanceScore: number;
    streakBonus:         number;
    streakPenalty:       number;
    rawValueBefore:      number;
    rawValueAfter:       number;
    playerValueAfter:    number;
    lastTradePriceAfter: number;
  } | null;
}

// ── Performance scoring ───────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Compute a CS2 performance score (0..1) from career aggregate stats.
 *
 * Uses only FPS-specific signals — intentionally avoids MOBA/Dota2 metrics
 * like MMR, role weight, or impact-of-gold-spent.
 *
 * Calibration reference points (approximate for high Diamond / Global Elite level):
 *   K/D ≈ 1.2, HS% ≈ 50%, WR ≈ 55%, KPR ≈ 0.75
 *
 * Returns null for clearly insufficient data (< 10 matches).
 */
function computeCs2PerformanceScore(stats: Cs2CareerStats): Cs2PerformanceScore | null {
  if (stats.totalMatchesPlayed < MIN_MATCHES_FOR_SIGNAL) return null;

  // K/D normalisation: maps 0.3 (very poor) → 2.0 (exceptional) onto 0..1
  const kdNorm = clamp((stats.kdRatio - 0.3) / 1.7, 0, 1);

  // HS% normalisation: maps 0% → 55% onto 0..1
  // ~55% is elite level for primary rifles; higher HS% usually means AWP/pistol focus
  const hsNorm = clamp(stats.headshotPct / 0.55, 0, 1);

  // Win rate normalisation: maps 20% (very bad) → 80% (exceptional) onto 0..1
  const winRateNorm = clamp((stats.winRate - 0.20) / 0.60, 0, 1);

  // Kills Per Round normalisation: maps 0 → 0.80 (exceptional) onto 0..1
  // Average competitive player: ~0.60-0.70 KPR
  const kprNorm = clamp(stats.avgKillsPerRound / 0.80, 0, 1);

  const score = parseFloat((
    0.35 * kdNorm +
    0.30 * hsNorm +
    0.20 * winRateNorm +
    0.15 * kprNorm
  ).toFixed(4));

  return {
    score:            clamp(score, 0, 1),
    kdRatio:          stats.kdRatio,
    headshotPct:      stats.headshotPct,
    winRate:          stats.winRate,
    avgKillsPerRound: stats.avgKillsPerRound,
    components:       { kdNorm, hsNorm, winRateNorm, kprNorm },
  };
}

// ── Readiness logic ───────────────────────────────────────────────────────────

function computeReadinessReasonCode(
  totalMatches:     number,
  providerStatus:   string,
): { reasonCode: string; isEligible: boolean } {
  if (providerStatus === "no_key") {
    return { reasonCode: "PENDING_PROVIDER_CONFIG", isEligible: false };
  }
  if (providerStatus === "private_profile") {
    return { reasonCode: "PRIVATE_PROFILE", isEligible: false };
  }
  if (providerStatus === "provider_error") {
    return { reasonCode: "PROVIDER_SYNC_FAILED", isEligible: false };
  }
  if (totalMatches === 0) {
    return { reasonCode: "PENDING_DATA_COLLECTION", isEligible: false };
  }
  if (totalMatches < MIN_MATCHES_FOR_SIGNAL) {
    return { reasonCode: "INSUFFICIENT_MATCH_HISTORY", isEligible: false };
  }
  return { reasonCode: "READY_FOR_ANALYTICS", isEligible: false };
  // TODO [Fase 7]: promote to ELIGIBLE once performance-based valuation V2 is stable
}

// ── Core sync function ────────────────────────────────────────────────────────

/**
 * Synchronise CS2 stats for the authenticated user.
 *
 * Pipeline:
 *   1. Locate CS2 connected account + player profile
 *   2. Fetch aggregate career stats from Steam Web API
 *   3. Upsert aggregate record in player_match_source_data (idempotent)
 *   4. Compute CS2 performance score from FPS signals
 *   5. Create new eligibility snapshot with updated facts
 *   6. Refresh valuation via cs2ValuationService
 */
export async function syncCs2Stats(input: SyncCs2StatsInput): Promise<SyncCs2StatsResult> {
  const { userId } = input;

  // ── Step 0: Validate Steam API key before doing anything ──────────────────
  const keyResult = validateSteamApiKey();
  if (!keyResult.valid) {
    console.error(`[CS2Sync] BLOCKED — ${keyResult.message}`);
    throw Object.assign(new Error(keyResult.message), { status: 503, code: keyResult.error });
  }
  console.log(`[CS2Sync] Steam API key validated (32 chars). Starting sync for userId=${userId}`);

  // ── Step 1: Locate CS2 connected account + player profile ─────────────────
  const account = await repo.findCs2ConnectedAccount(userId);
  if (!account) {
    throw Object.assign(new Error("CS2_ACCOUNT_NOT_CONNECTED"), { status: 404 });
  }

  const profiles = await repo.findPlayerProfilesByUser(userId);
  const profile  = profiles.find((p: any) => p.game === "cs2");
  if (!profile) {
    throw Object.assign(new Error("CS2_PROFILE_NOT_FOUND"), { status: 404 });
  }

  const steamId64 = account.providerAccountId;

  // Resolve CS2 asset ID upfront — needed for snapshot + synthetic match pipeline
  const cs2Asset = await repo.findAssetByPlayerProfileId(profile.id);
  const cs2AssetId: number | null = cs2Asset ? (cs2Asset as any).id : null;

  // ── Step 2: Fetch aggregate career stats ──────────────────────────────────
  const statsResult = await fetchCs2CareerStats(steamId64);

  let providerStatus: SyncCs2StatsResult["providerStatus"];
  let providerError: string | undefined;
  let careerStats: Cs2CareerStats | null = null;

  if (statsResult.ok) {
    providerStatus = "ok";
    careerStats    = statsResult.stats;
    console.log(`[CS2Sync] Steam responded correctly — matches=${careerStats.totalMatchesPlayed} kd=${careerStats.kdRatio}`);
  } else {
    providerError  = statsResult.message;
    switch (statsResult.error) {
      case "NO_API_KEY":
      case "INVALID_API_KEY": providerStatus = "no_key";          break;
      case "PRIVATE_PROFILE": providerStatus = "private_profile"; break;
      case "EMPTY_STATS":     providerStatus = "empty_stats";     break;
      default:                providerStatus = "provider_error";  break;
    }
    if (providerStatus === "private_profile") {
      console.warn(`[CS2Sync] Skipping private profile — steamId=${steamId64}. Player must make CS2 stats public in Steam settings.`);
    } else if (providerStatus === "empty_stats") {
      console.warn(`[CS2Sync] No CS2 stats — steamId=${steamId64}. Account has not played CS2 or game not owned.`);
    } else if (providerStatus === "no_key") {
      console.error(`[CS2Sync] BLOCKED — invalid or missing Steam API key. ${statsResult.message}`);
    } else {
      console.warn(`[CS2Sync] Provider: ${statsResult.error} — ${statsResult.message}`);
    }
  }

  // ── Step 3: Compute performance score ─────────────────────────────────────
  const performanceScore = careerStats
    ? computeCs2PerformanceScore(careerStats)
    : null;

  // ── Step 4: Upsert career aggregate record ────────────────────────────────
  const existingIds = await repo.findExistingProviderMatchIds(
    profile.id, "steam", [CAREER_AGGREGATE_MATCH_ID],
  );
  const recordExists = existingIds.has(CAREER_AGGREGATE_MATCH_ID);

  const totalMatchesFromProvider = careerStats?.totalMatchesPlayed ?? 0;

  const upsertPayload: InsertPlayerMatchSourceDatum = {
    playerProfileId:    profile.id,
    connectedAccountId: account.id,
    assetId:            null,
    game:               "cs2" as const,
    providerGroup:      "steam" as const,
    providerMatchId:    CAREER_AGGREGATE_MATCH_ID,
    providerAccountId:  steamId64,
    playedAt:           null,
    matchStatus:        "RAW_FETCHED" as const,
    queueType:          "competitive_aggregate",
    rankBucket:         null,
    patchVersion:       null,
    durationSeconds:    null,
    isRanked:           true,
    rawSummaryJson:     careerStats
      ? JSON.stringify({
          syncedAt:         new Date().toISOString(),
          providerStatus,
          careerStats,
          performanceScore,
        })
      : JSON.stringify({
          syncedAt:       new Date().toISOString(),
          providerStatus,
          providerError:  providerError ?? null,
          careerStats:    null,
        }),
    rawPayloadJson:     null,
    ingestionError:     providerStatus !== "ok" ? (providerError ?? null) : null,
    lastSyncedAt:       new Date(),
  };

  try {
    await repo.bulkUpsertMatchSourceData([upsertPayload]);
  } catch (err: any) {
    console.error(`[CS2Sync] Upsert failed for profile ${profile.id}: ${err.message}`);
  }

  // ── Step 5: Compute readiness facts ───────────────────────────────────────
  const { reasonCode, isEligible } = computeReadinessReasonCode(
    totalMatchesFromProvider,
    providerStatus,
  );

  const dataCompleteness = providerStatus === "ok" && totalMatchesFromProvider >= MIN_MATCHES_FOR_SIGNAL
    ? parseFloat(Math.min(totalMatchesFromProvider / 50, 1).toFixed(4))
    : 0;

  // ── Step 6: Persist new eligibility snapshot ──────────────────────────────
  console.log(`[CS2Sync] Creating eligibility snapshot — profile=${profile.id} status=${providerStatus} matches=${totalMatchesFromProvider}`);
  const snapshot = await repo.createEligibilitySnapshot({
    playerProfileId:   profile.id,
    game:              "cs2",
    isEligible,
    reasonCode,
    sampleSize:        totalMatchesFromProvider,
    dataCompleteness:  dataCompleteness.toFixed(4),
    roleDetectability: undefined,
    rankSignal:        undefined,
    snapshotJson: JSON.stringify({
      syncedAt:          new Date().toISOString(),
      providerStatus,
      providerError:     providerError ?? null,
      totalMatches:      totalMatchesFromProvider,
      performanceScore,
    }),
  });

  console.log(`[CS2Sync] Snapshot created id=${snapshot.id} reasonCode=${reasonCode} isEligible=${isEligible}`);

  // ── Step 7: Refresh valuation (career-aggregate EMA) ─────────────────────
  let valuationResult: SyncCs2StatsResult["valuation"] = null;

  if (totalMatchesFromProvider >= MIN_MATCHES_FOR_SIGNAL) {
    try {
      console.log(`[CS2Sync] Running valuation refresh — matches=${totalMatchesFromProvider} perfScore=${performanceScore?.score ?? "null"}`);
      const vUpdate = await refreshCs2ValuationFromMatchData({
        userId,
        sampleSize:       totalMatchesFromProvider,
        dataCompleteness,
        performanceScore: performanceScore?.score ?? null,
        providerStatus,
      });
      valuationResult = {
        rawValueAfter:    vUpdate.rawValueAfter,
        playerValueAfter: vUpdate.playerValueAfter,
        confidenceScore:  vUpdate.confidenceScore,
        historyId:        vUpdate.historyId,
        valuationPath:    vUpdate.valuationPath,
      };
      console.log(`[CS2Sync] Valuation updated — rawValue=${vUpdate.rawValueAfter} playerValue=${vUpdate.playerValueAfter} confidence=${vUpdate.confidenceScore}`);
    } catch (err: any) {
      console.warn(`[CS2Sync] Valuation refresh skipped: ${err.message}`);
    }
  } else if (providerStatus !== "private_profile" && providerStatus !== "no_key") {
    console.log(`[CS2Sync] Valuation refresh skipped — insufficient matches (${totalMatchesFromProvider} < ${MIN_MATCHES_FOR_SIGNAL})`);
  }

  // ── Step 8: Snapshot + Delta + Synthetic Match pipeline ───────────────────
  // Only runs when:
  //   a) Provider returned stats (careerStats != null)
  //   b) We have a resolved assetId
  //
  // Saves current career stats as a new snapshot row, diffs against the
  // previous snapshot to detect new matches, generates synthetic match records
  // from the delta, and applies the synthetic EMA to update lastTradePrice.
  let syntheticResult: SyncCs2StatsResult["syntheticPipeline"] = null;

  if (careerStats && cs2AssetId) {
    try {
      console.log(`[CS2Sync] Starting snapshot → delta → synthetic match pipeline for assetId=${cs2AssetId}`);

      // Step 8a: Fetch previous snapshot (before saving current)
      const prevSnapshots = await getLatestCs2Snapshots(cs2AssetId, 1);
      const prevSnap = prevSnapshots[0] ?? null;

      // Step 8b: Save current snapshot (append-only)
      const currSnap = await saveCs2StatsSnapshot(cs2AssetId, careerStats);
      console.log(`[CS2Sync] Snapshot saved — id=${currSnap.id} kills=${careerStats.totalKills} matches=${careerStats.totalMatchesPlayed}`);

      // Step 8c: Compute delta
      const delta = computeCs2StatsDelta(prevSnap, currSnap);

      console.log(
        `[CS2Sync] Delta — assetId=${cs2AssetId} ` +
        `deltaMatches=${delta.deltaMatches} isValid=${delta.isValid}` +
        (delta.reason ? ` reason=${delta.reason}` : ""),
      );

      // Step 8d: Only generate synthetic matches and update valuation
      //           when the delta detected new matches
      if (delta.isValid && delta.deltaMatches > 0) {
        console.log(`[CS2Sync] Generating synthetic matches — deltaMatches=${delta.deltaMatches}`);
        const synthResult = await generateSyntheticMatches(cs2AssetId, delta);
        console.log(`[CS2Sync] Synthetic matches generated: ${synthResult.matchesGenerated}`);

        if (synthResult.matchesGenerated > 0) {
          // Step 8e: Apply synthetic EMA + update lastTradePrice
          const synthValuation = await refreshCs2ValuationFromSyntheticMatches({
            assetId:             cs2AssetId,
            avgPerformanceScore: synthResult.avgPerformanceScore,
            streakBonus:         synthResult.streakBonus,
            streakPenalty:       synthResult.streakPenalty,
          });

          // Annotate synthetic match rows with EMA results
          const rowIds = synthResult.rows.map((r: any) => r.id as number);
          await annotateCs2SyntheticMatchRows(
            rowIds,
            synthValuation.rawValueBefore,
            synthValuation.rawValueAfter,
            synthValuation.playerValueAfter,
            synthValuation.alphaUsed,
          );

          syntheticResult = {
            snapshotId:          currSnap.id,
            deltaMatches:        delta.deltaMatches,
            matchesGenerated:    synthResult.matchesGenerated,
            avgPerformanceScore: synthResult.avgPerformanceScore,
            streakBonus:         synthResult.streakBonus,
            streakPenalty:       synthResult.streakPenalty,
            rawValueBefore:      synthValuation.rawValueBefore,
            rawValueAfter:       synthValuation.rawValueAfter,
            playerValueAfter:    synthValuation.playerValueAfter,
            lastTradePriceAfter: synthValuation.playerValueAfter,
          };
          console.log(
            `[CS2Sync] Valuation updated via synthetic EMA — ` +
            `rawBefore=${synthValuation.rawValueBefore} rawAfter=${synthValuation.rawValueAfter} ` +
            `playerValue=${synthValuation.playerValueAfter} price=$${synthValuation.playerValueAfter.toFixed(2)}`
          );
        }
      }
    } catch (err: any) {
      console.error(`[CS2Sync] Synthetic pipeline error (non-fatal): ${err.message}`);
    }
  }

  return {
    providerStatus,
    ...(providerError ? { providerError } : {}),
    recordUpdated:   recordExists,
    careerStats,
    performanceScore,
    readiness: {
      totalMatches:     totalMatchesFromProvider,
      dataCompleteness,
      reasonCode,
      isEligible,
      snapshotId:       snapshot.id,
    },
    valuation:         valuationResult,
    syntheticPipeline: syntheticResult,
  };
}

// ── Helper: match list read ───────────────────────────────────────────────────

export interface Cs2StatsListResult {
  items:  any[];
  total:  number;
  limit:  number;
  offset: number;
}

/**
 * Return the stored CS2 match/aggregate records for the authenticated user.
 * Currently returns at most one row (career_aggregate) per player in V1.
 */
export async function getCs2MatchList(
  userId:  string,
  limit  = 20,
  offset = 0,
): Promise<Cs2StatsListResult> {
  const profiles = await repo.findPlayerProfilesByUser(userId);
  const profile  = profiles.find((p: any) => p.game === "cs2");
  if (!profile) {
    throw Object.assign(new Error("CS2_PROFILE_NOT_FOUND"), { status: 404 });
  }

  const [items, total] = await Promise.all([
    repo.listMatchSourceDataByProfile(profile.id, { limit, offset }),
    repo.countMatchSourceDataByProfile(profile.id),
  ]);

  return { items, total, limit, offset };
}

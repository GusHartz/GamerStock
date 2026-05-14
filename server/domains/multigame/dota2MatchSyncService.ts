// ─── Dota2 Match Sync Service ─────────────────────────────────────────────────
// Orchestrates the full match ingestion pipeline for a connected Dota2 account:
//
//   ConnectedAccount (steam+dota2)
//     → OpenDota: fetch match summaries
//     → Persist raw match records (idempotent upsert)
//     → Compute readiness facts from real data
//     → Create new EligibilitySnapshot
//
// Rules:
//   1. Always idempotent — re-syncing the same matches is safe
//   2. Persistence happens before eligibility update
//   3. No analytics/scoring computed here (Fase 4+)
//   4. LoL data is never touched
//   5. Provider failures produce PROVIDER_SYNC_FAILED reason code (no throw to caller)
// ─────────────────────────────────────────────────────────────────────────────

import * as repo                     from "./repository";
import * as openDota                 from "./providers/openDotaClient";
import type { InsertPlayerMatchSourceDatum } from "@shared/schema";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Minimum ranked matches required to qualify for analytics. */
const MIN_RANKED_MATCHES = 10;

/** Maximum matches to fetch per sync run. Keep low during Fase 3 rollout. */
const DEFAULT_FETCH_LIMIT = 50;

// ── Public types ─────────────────────────────────────────────────────────────

export interface SyncMatchesInput {
  userId:       string;
  /** Override default fetch limit (capped at 500 internally by OpenDota). */
  fetchLimit?:  number;
}

export interface SyncMatchesResult {
  /** Total matches returned by the provider this sync run. */
  fetched:    number;
  /** New rows inserted. */
  inserted:   number;
  /** Existing rows updated (matched by unique key, refreshed). */
  updated:    number;
  /** Rows present on provider but skipped (e.g. already processed). */
  skipped:    number;
  /** Matches the provider returned but we failed to persist. */
  failed:     number;
  /** Eligibility readiness summary after this sync. */
  readiness: {
    totalMatches:         number;
    rankedMatches:        number;
    dataCompleteness:     number;
    reasonCode:           string;
    isEligible:           boolean;
    snapshotId:           number;
  };
  providerError?: string;
}

// ── Eligibility logic ─────────────────────────────────────────────────────────

function computeReadinessReasonCode(
  totalMatches:     number,
  rankedMatches:    number,
  dataCompleteness: number,
  providerError:    string | null,
): { reasonCode: string; isEligible: boolean } {
  if (providerError) {
    return { reasonCode: "PROVIDER_SYNC_FAILED", isEligible: false };
  }
  if (totalMatches === 0) {
    return { reasonCode: "PENDING_DATA_COLLECTION", isEligible: false };
  }
  if (rankedMatches < MIN_RANKED_MATCHES) {
    return { reasonCode: "INSUFFICIENT_MATCH_HISTORY", isEligible: false };
  }
  if (dataCompleteness < 0.5) {
    return { reasonCode: "INCOMPLETE_SOURCE_DATA", isEligible: false };
  }
  return { reasonCode: "READY_FOR_ANALYTICS", isEligible: false }; // Fase 4 promotes to ELIGIBLE
}

// ── Core sync function ────────────────────────────────────────────────────────

export async function syncDota2Matches(input: SyncMatchesInput): Promise<SyncMatchesResult> {
  const { userId, fetchLimit = DEFAULT_FETCH_LIMIT } = input;

  // ── Step 1: Locate connected account + player profile ────────────────────────
  const account = await repo.findDota2ConnectedAccount(userId);
  if (!account) {
    throw Object.assign(new Error("DOTA2_ACCOUNT_NOT_CONNECTED"), { status: 404 });
  }

  const profiles = await repo.findPlayerProfilesByUser(userId);
  const profile = profiles.find(p => p.game === "dota2");
  if (!profile) {
    throw Object.assign(new Error("DOTA2_PROFILE_NOT_FOUND"), { status: 404 });
  }

  const steamId64 = account.providerAccountId;
  let accountId32: string;
  try {
    accountId32 = openDota.steamId64ToAccountId32(steamId64);
  } catch (err: any) {
    throw Object.assign(
      new Error(`INVALID_STEAM_ID: ${err.message}`),
      { status: 400 },
    );
  }

  // ── Step 2: Fetch player info for rank tier (best-effort, non-blocking) ──────
  let currentRankBucket: string | null = null;
  try {
    const playerInfo = await openDota.fetchPlayerInfo(accountId32);
    currentRankBucket = openDota.rankTierToBucket(playerInfo.rank_tier);
  } catch (err) {
    console.warn(`[Dota2Sync] Could not fetch rank info for ${accountId32}: ${err}`);
  }

  // ── Step 3: Fetch match summaries from OpenDota ───────────────────────────────
  let rawMatches: openDota.OpenDotaMatchSummary[] = [];
  let providerError: string | null = null;

  try {
    rawMatches = await openDota.fetchPlayerMatches(accountId32, fetchLimit);
  } catch (err: any) {
    providerError = err?.message ?? "UNKNOWN_PROVIDER_ERROR";
    console.error(`[Dota2Sync] Provider fetch failed for ${accountId32}: ${providerError}`);
  }

  // ── Step 4: Dedup — find which match IDs already exist ────────────────────────
  const fetchedMatchIds = rawMatches.map(m => String(m.match_id));
  const existingIds = await repo.findExistingProviderMatchIds(
    profile.id, "steam", fetchedMatchIds,
  );

  // ── Step 5: Build upsert payloads ─────────────────────────────────────────────
  const toUpsert: InsertPlayerMatchSourceDatum[] = rawMatches.map(m => {
    const isRanked = m.lobby_type === 7;
    const queueType = openDota.lobbyTypeToQueueLabel(m.lobby_type);
    const playedAt = m.start_time ? new Date(m.start_time * 1000) : null;
    const isNew = !existingIds.has(String(m.match_id));

    return {
      playerProfileId:    profile.id,
      connectedAccountId: account.id,
      assetId:            null,
      game:               "dota2" as const,
      providerGroup:      "steam" as const,
      providerMatchId:    String(m.match_id),
      providerAccountId:  steamId64,
      playedAt,
      matchStatus:        "RAW_FETCHED" as const,
      queueType,
      rankBucket:         currentRankBucket,
      patchVersion:       null,
      durationSeconds:    m.duration ?? null,
      isRanked,
      rawSummaryJson:     JSON.stringify(m),
      rawPayloadJson:     null,
      ingestionError:     null,
    } satisfies InsertPlayerMatchSourceDatum;
  });

  // ── Step 6: Bulk upsert ────────────────────────────────────────────────────────
  let inserted = 0;
  let updated  = 0;
  let failed   = 0;

  if (toUpsert.length > 0) {
    try {
      const affectedCount = await repo.bulkUpsertMatchSourceData(toUpsert);
      // affectedCount = total rows touched (inserts + updates)
      inserted = toUpsert.filter(r => !existingIds.has(r.providerMatchId)).length;
      updated  = toUpsert.filter(r =>  existingIds.has(r.providerMatchId)).length;
    } catch (err: any) {
      console.error(`[Dota2Sync] Bulk upsert failed: ${err.message}`);
      failed = toUpsert.length;
      providerError = providerError ?? `PERSISTENCE_ERROR: ${err.message}`;
    }
  }

  const skipped = rawMatches.length - inserted - updated - failed;

  // ── Step 7: Compute readiness from real data ──────────────────────────────────
  const totalMatches  = await repo.countMatchSourceDataByProfile(profile.id);
  const rankedMatches = await repo.countRankedMatchesByProfile(profile.id);
  const dataCompleteness = totalMatches > 0 ? rankedMatches / totalMatches : 0;

  const { reasonCode, isEligible } = computeReadinessReasonCode(
    totalMatches, rankedMatches, dataCompleteness, providerError,
  );

  // ── Step 8: Persist new eligibility snapshot with real facts ──────────────────
  const snapshot = await repo.createEligibilitySnapshot({
    playerProfileId: profile.id,
    game:            "dota2",
    isEligible,
    reasonCode,
    sampleSize:      totalMatches,
    dataCompleteness: dataCompleteness.toFixed(4),
    roleDetectability: undefined,
    rankSignal:      currentRankBucket ?? undefined,
    snapshotJson:    JSON.stringify({
      syncedAt:      new Date().toISOString(),
      fetchedCount:  rawMatches.length,
      insertedCount: inserted,
      updatedCount:  updated,
      providerError: providerError ?? null,
      accountId32,
      rankBucket:    currentRankBucket,
    }),
  });

  return {
    fetched:  rawMatches.length,
    inserted,
    updated,
    skipped:  Math.max(0, skipped),
    failed,
    readiness: {
      totalMatches,
      rankedMatches,
      dataCompleteness: parseFloat(dataCompleteness.toFixed(4)),
      reasonCode,
      isEligible,
      snapshotId: snapshot.id,
    },
    ...(providerError ? { providerError } : {}),
  };
}

// ── Helper: status read ───────────────────────────────────────────────────────

export interface Dota2MatchListResult {
  items:  any[];
  total:  number;
  limit:  number;
  offset: number;
}

export async function getDota2MatchList(
  userId:  string,
  limit  = 20,
  offset = 0,
): Promise<Dota2MatchListResult> {
  const profiles = await repo.findPlayerProfilesByUser(userId);
  const profile = profiles.find(p => p.game === "dota2");
  if (!profile) {
    throw Object.assign(new Error("DOTA2_PROFILE_NOT_FOUND"), { status: 404 });
  }

  const [items, total] = await Promise.all([
    repo.listMatchSourceDataByProfile(profile.id, { limit, offset }),
    repo.countMatchSourceDataByProfile(profile.id),
  ]);

  return { items, total, limit, offset };
}

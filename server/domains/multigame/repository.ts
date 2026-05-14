// ─── Multigame Repository ─────────────────────────────────────────────────────
// Data access layer for ConnectedAccounts, PlayerProfiles,
// PlayerEligibilitySnapshots, PlayerMatchSourceData, PlayerMatchAnalytics,
// PerformanceBaselines, PerformanceMetricWeights, PerformanceScoreComponents,
// and TerminalAssets.
// ─────────────────────────────────────────────────────────────────────────────
import { db } from "../../db";
import {
  connectedAccounts,
  playerProfiles,
  playerEligibilitySnapshots,
  playerMatchSourceData,
  playerMatchAnalytics,
  performanceBaselines,
  performanceMetricWeights,
  performanceScoreComponents,
  dota2PerformanceScores,
  dota2ValuationState,
  dota2ValueHistory,
  assetListingReviews,
  accountVerificationEvents,
  assetListingSubmissions,
  dota2AssetClaimRequests,
  assetOwnershipLinks,
  assets,
  markets,
  type ConnectedAccount,
  type InsertConnectedAccount,
  type PlayerProfile,
  type InsertPlayerProfile,
  type PlayerEligibilitySnapshot,
  type InsertPlayerEligibilitySnapshot,
  type PlayerMatchSourceDatum,
  type InsertPlayerMatchSourceDatum,
  type PlayerMatchAnalytic,
  type InsertPlayerMatchAnalytic,
  type PerformanceBaseline,
  type InsertPerformanceBaseline,
  type PerformanceMetricWeight,
  type InsertPerformanceMetricWeight,
  type PerformanceScoreComponent,
  type InsertPerformanceScoreComponent,
  type Dota2PerformanceScore,
  type InsertDota2PerformanceScore,
  type Dota2ValuationState,
  type InsertDota2ValuationState,
  type Dota2ValueHistoryRow,
  type InsertDota2ValueHistory,
  type AssetListingReview,
  type InsertAssetListingReview,
  type AccountVerificationEvent,
  type InsertAccountVerificationEvent,
  type AssetListingSubmission,
  type InsertAssetListingSubmission,
  type Dota2AssetClaimRequest,
  type InsertDota2AssetClaimRequest,
  type AssetOwnershipLink,
  type InsertAssetOwnershipLink,
  type MatchSourceStatus,
  type Asset,
  type Market,
} from "@shared/schema";
import { eq, and, desc, asc, count, inArray, isNotNull, sql as drizzleSql } from "drizzle-orm";

// ── ConnectedAccounts ─────────────────────────────────────────────────────────

export async function findConnectedAccountsByUser(userId: string): Promise<ConnectedAccount[]> {
  return db
    .select()
    .from(connectedAccounts)
    .where(eq(connectedAccounts.userId, userId))
    .orderBy(desc(connectedAccounts.createdAt));
}

export async function findConnectedAccountById(id: number): Promise<ConnectedAccount | null> {
  const [row] = await db.select().from(connectedAccounts).where(eq(connectedAccounts.id, id));
  return row ?? null;
}

/**
 * Ownership-safe lookup: finds by id AND userId to prevent info-leakage
 * across user boundaries.
 */
export async function findConnectedAccountByIdForUser(
  id: number,
  userId: string,
): Promise<ConnectedAccount | null> {
  const [row] = await db
    .select()
    .from(connectedAccounts)
    .where(and(eq(connectedAccounts.id, id), eq(connectedAccounts.userId, userId)));
  return row ?? null;
}

/**
 * Find by external provider identity — used for global dedup check
 * (a provider account can be claimed by at most one GS user).
 */
export async function findConnectedAccountByProviderIdentity(opts: {
  providerGroup: string;
  game: string;
  providerAccountId: string;
}): Promise<ConnectedAccount | null> {
  const [row] = await db
    .select()
    .from(connectedAccounts)
    .where(
      and(
        eq(connectedAccounts.providerGroup, opts.providerGroup as any),
        eq(connectedAccounts.game, opts.game as any),
        eq(connectedAccounts.providerAccountId, opts.providerAccountId),
      ),
    );
  return row ?? null;
}

export async function createConnectedAccount(
  data: InsertConnectedAccount,
): Promise<ConnectedAccount> {
  const [row] = await db.insert(connectedAccounts).values(data as any).returning();
  return row;
}

export async function updateConnectedAccount(
  id: number,
  userId: string,
  patch: Partial<Pick<ConnectedAccount,
    "providerAccountName" | "providerProfileUrl" | "verificationStatus" | "isPrimary" | "lastVerifiedAt"
  >>,
): Promise<ConnectedAccount | null> {
  const [row] = await db
    .update(connectedAccounts)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(connectedAccounts.id, id), eq(connectedAccounts.userId, userId)))
    .returning();
  return row ?? null;
}

export async function deleteConnectedAccount(id: number, userId: string): Promise<boolean> {
  const result = await db
    .delete(connectedAccounts)
    .where(and(eq(connectedAccounts.id, id), eq(connectedAccounts.userId, userId)));
  return (result.rowCount ?? 0) > 0;
}

/**
 * Convenience: find the first steam+dota2 ConnectedAccount for a user.
 * Returns null if the user has no Dota2 connected account.
 */
export async function findDota2ConnectedAccount(userId: string): Promise<ConnectedAccount | null> {
  const accounts = await findConnectedAccountsByUser(userId);
  return accounts.find(a => a.providerGroup === "steam" && a.game === "dota2") ?? null;
}

export async function findCs2ConnectedAccount(userId: string): Promise<ConnectedAccount | null> {
  const accounts = await findConnectedAccountsByUser(userId);
  return accounts.find(a => a.providerGroup === "steam" && a.game === "cs2") ?? null;
}

// ── PlayerProfiles ────────────────────────────────────────────────────────────

export async function findPlayerProfilesByUser(userId: string): Promise<PlayerProfile[]> {
  const accounts = await findConnectedAccountsByUser(userId);
  if (accounts.length === 0) return [];

  const accountIds = accounts.map((a) => a.id);
  return db
    .select()
    .from(playerProfiles)
    .where(
      and(
        isNotNull(playerProfiles.primaryConnectedAccountId),
        inArray(playerProfiles.primaryConnectedAccountId as any, accountIds),
      ),
    )
    .orderBy(desc(playerProfiles.createdAt));
}

export async function findPlayerProfileById(id: number): Promise<PlayerProfile | null> {
  const [row] = await db.select().from(playerProfiles).where(eq(playerProfiles.id, id));
  return row ?? null;
}

export async function findPlayerProfileByConnectedAccountId(
  connectedAccountId: number,
): Promise<PlayerProfile | null> {
  const [row] = await db
    .select()
    .from(playerProfiles)
    .where(eq(playerProfiles.primaryConnectedAccountId, connectedAccountId));
  return row ?? null;
}

export async function createPlayerProfile(
  data: InsertPlayerProfile,
): Promise<PlayerProfile> {
  const [row] = await db.insert(playerProfiles).values(data as any).returning();
  return row;
}

export async function updatePlayerProfileStatus(
  id: number,
  status: string,
): Promise<PlayerProfile | null> {
  const [row] = await db
    .update(playerProfiles)
    .set({ status: status as any, updatedAt: new Date() })
    .where(eq(playerProfiles.id, id))
    .returning();
  return row ?? null;
}

// ── Markets ───────────────────────────────────────────────────────────────────

/**
 * Find an existing market or create it if it doesn't exist.
 * Used by the Dota2 onboarding service to ensure a steam/dota2 market exists.
 */
export async function findOrCreateMarket(opts: {
  provider: string;
  game: string;
  region?: string;
  scope?: string;
}): Promise<Market> {
  const { provider, game, region = "global", scope = "default" } = opts;

  const [existing] = await db
    .select()
    .from(markets)
    .where(
      and(
        eq(markets.provider, provider),
        eq(markets.game, game),
        eq(markets.region, region),
        eq(markets.scope, scope),
      ),
    );
  if (existing) return existing;

  const [created] = await db
    .insert(markets)
    .values({ provider, game, region, scope })
    .returning();
  return created;
}

// ── Assets (stubs) ────────────────────────────────────────────────────────────

export async function findAssetByUid(assetUid: string): Promise<Asset | null> {
  const [row] = await db.select().from(assets).where(eq(assets.assetUid, assetUid));
  return row ?? null;
}

export async function findAssetByExternalId(externalId: string): Promise<Asset | null> {
  const [row] = await db.select().from(assets).where(eq(assets.externalId, externalId));
  return row ?? null;
}

/**
 * Like findAssetByExternalId, but also filters by the market game.
 * Used in STEAM_ID_DIRECT discovery to avoid matching assets from a different game
 * (e.g. finding a dota2 asset when looking for a cs2 asset by the same SteamID64).
 */
export async function findAssetByExternalIdAndGame(
  externalId: string,
  game: string,
): Promise<Asset | null> {
  const rows = await db
    .select({
      id:                   assets.id,
      marketId:             assets.marketId,
      assetUid:             assets.assetUid,
      entityType:           assets.entityType,
      externalId:           assets.externalId,
      displayName:          assets.displayName,
      symbol:               assets.symbol,
      lastTradePrice:       assets.lastTradePrice,
      price24hAgo:          assets.price24hAgo,
      volume24h:            assets.volume24h,
      momentum:             assets.momentum,
      providerJson:         assets.providerJson,
      lastSyncedAt:         assets.lastSyncedAt,
      fundamentalPrice:     assets.fundamentalPrice,
      fundamentalUpdatedAt: assets.fundamentalUpdatedAt,
      createdAt:            assets.createdAt,
      updatedAt:            assets.updatedAt,
      playerProfileId:      assets.playerProfileId,
      tradingStatus:        assets.tradingStatus,
      listingStatus:        assets.listingStatus,
    })
    .from(assets)
    .innerJoin(markets, and(eq(markets.id, assets.marketId), eq(markets.game, game)))
    .where(eq(assets.externalId, externalId))
    .limit(1);
  return (rows[0] as Asset) ?? null;
}

export async function findAssetByPlayerProfileId(
  playerProfileId: number,
): Promise<Asset | null> {
  const [row] = await db
    .select()
    .from(assets)
    .where(eq(assets.playerProfileId, playerProfileId));
  return row ?? null;
}

export interface CreateAssetStubInput {
  marketId:       number;
  assetUid:       string;
  entityType:     string;
  externalId:     string;
  displayName:    string;
  symbol?:        string;
  playerProfileId: number;
  tradingStatus:  string;
  listingStatus:  string;
}

export async function createAssetStub(input: CreateAssetStubInput): Promise<Asset> {
  const [row] = await db
    .insert(assets)
    .values({
      marketId:       input.marketId,
      assetUid:       input.assetUid,
      entityType:     input.entityType,
      externalId:     input.externalId,
      displayName:    input.displayName,
      symbol:         input.symbol ?? "",
      playerProfileId: input.playerProfileId,
      tradingStatus:  input.tradingStatus as any,
      listingStatus:  input.listingStatus as any,
    } as any)
    .returning();
  return row;
}

// ── PlayerEligibilitySnapshots ────────────────────────────────────────────────

export async function createEligibilitySnapshot(
  data: InsertPlayerEligibilitySnapshot,
): Promise<PlayerEligibilitySnapshot> {
  const [row] = await db
    .insert(playerEligibilitySnapshots)
    .values(data as any)
    .returning();
  return row;
}

export async function findLatestEligibilitySnapshot(
  playerProfileId: number,
): Promise<PlayerEligibilitySnapshot | null> {
  const [row] = await db
    .select()
    .from(playerEligibilitySnapshots)
    .where(eq(playerEligibilitySnapshots.playerProfileId, playerProfileId))
    .orderBy(desc(playerEligibilitySnapshots.createdAt))
    .limit(1);
  return row ?? null;
}

export async function findAllEligibilitySnapshots(
  playerProfileId: number,
): Promise<PlayerEligibilitySnapshot[]> {
  return db
    .select()
    .from(playerEligibilitySnapshots)
    .where(eq(playerEligibilitySnapshots.playerProfileId, playerProfileId))
    .orderBy(desc(playerEligibilitySnapshots.createdAt));
}

// ── Terminal Assets ───────────────────────────────────────────────────────────
// TerminalAssets are served from the existing `assets` table (enriched with
// multigame columns added in Fase 1). The `markets` join provides game + provider.

export interface TerminalAssetView {
  id:               number;
  assetUid:         string;
  game:             string;
  provider:         string;
  displayName:      string;
  symbol:           string;
  entityType:       string;
  lastTradePrice:   string;
  price24hAgo:      string;
  volume24h:        string;
  playerProfileId:  number | null;
  tradingStatus:    string | null;
  listingStatus:    string | null;
  lastSyncedAt:     Date;
}

export async function listTerminalAssets(opts: {
  game?: string;
  tradingStatus?: string;
  listingStatus?: string;
  limit?: number;
  offset?: number;
}): Promise<{ assets: TerminalAssetView[]; total: number }> {
  const { game, tradingStatus, listingStatus, limit = 50, offset = 0 } = opts;

  // ── Terminal eligibility policy ──────────────────────────────────────────────
  // Same criteria as /api/assets: must be listed, active, linked to a real
  // player profile, and have a calculated fundamental_price (real API data).
  // Callers may further narrow by game/tradingStatus/listingStatus.
  const conditions: any[] = [
    isNotNull(assets.playerProfileId),
    isNotNull(assets.fundamentalPrice),
  ];
  // Allow caller to override status filters; default to LISTED/ACTIVE
  conditions.push(eq(assets.listingStatus,  listingStatus ?? "LISTED"));
  conditions.push(eq(assets.tradingStatus,  tradingStatus ?? "ACTIVE"));
  if (game) conditions.push(eq(markets.game, game));

  const whereClause = and(...conditions);

  const [countRow] = await db
    .select({ total: count() })
    .from(assets)
    .innerJoin(markets, eq(markets.id, assets.marketId))
    .where(whereClause as any);

  const rows = await db
    .select({
      id:              assets.id,
      assetUid:        assets.assetUid,
      game:            markets.game,
      provider:        markets.provider,
      displayName:     assets.displayName,
      symbol:          assets.symbol,
      entityType:      assets.entityType,
      lastTradePrice:  assets.lastTradePrice,
      price24hAgo:     assets.price24hAgo,
      volume24h:       assets.volume24h,
      playerProfileId: assets.playerProfileId,
      tradingStatus:   assets.tradingStatus,
      listingStatus:   assets.listingStatus,
      lastSyncedAt:    assets.lastSyncedAt,
    })
    .from(assets)
    .innerJoin(markets, eq(markets.id, assets.marketId))
    .where(whereClause as any)
    .orderBy(desc(assets.lastTradePrice))
    .limit(limit)
    .offset(offset);

  return { assets: rows as TerminalAssetView[], total: Number(countRow?.total ?? 0) };
}

export async function findTerminalAssetById(id: number): Promise<TerminalAssetView | null> {
  const [row] = await db
    .select({
      id:              assets.id,
      assetUid:        assets.assetUid,
      game:            markets.game,
      provider:        markets.provider,
      displayName:     assets.displayName,
      symbol:          assets.symbol,
      entityType:      assets.entityType,
      lastTradePrice:  assets.lastTradePrice,
      price24hAgo:     assets.price24hAgo,
      volume24h:       assets.volume24h,
      playerProfileId: assets.playerProfileId,
      tradingStatus:   assets.tradingStatus,
      listingStatus:   assets.listingStatus,
      lastSyncedAt:    assets.lastSyncedAt,
    })
    .from(assets)
    .innerJoin(markets, eq(markets.id, assets.marketId))
    .where(eq(assets.id, id));
  return (row as TerminalAssetView) ?? null;
}

// ── PlayerMatchSourceData ─────────────────────────────────────────────────────

/**
 * Upsert a match record.
 * Unique key: (player_profile_id, provider_group, provider_match_id).
 *
 * On conflict:
 *   - Always bump lastSyncedAt + updatedAt
 *   - Promote matchStatus if new status is "higher" (RAW→DETAIL→PROCESSING→PROCESSED)
 *   - Overwrite rawSummaryJson and rawPayloadJson if provided
 *   - Overwrite ingestionError (clears old error on successful re-sync)
 */
export async function upsertMatchSourceData(
  data: InsertPlayerMatchSourceDatum,
): Promise<PlayerMatchSourceDatum> {
  const now = new Date();
  const [row] = await db
    .insert(playerMatchSourceData)
    .values({ ...data, lastSyncedAt: now, updatedAt: now } as any)
    .onConflictDoUpdate({
      target: [
        playerMatchSourceData.playerProfileId,
        playerMatchSourceData.providerGroup,
        playerMatchSourceData.providerMatchId,
      ],
      set: {
        matchStatus:    data.matchStatus as any,
        rawSummaryJson: data.rawSummaryJson   ?? drizzleSql`excluded.raw_summary_json`,
        rawPayloadJson: data.rawPayloadJson   ?? drizzleSql`excluded.raw_payload_json`,
        rankBucket:     data.rankBucket       ?? drizzleSql`excluded.rank_bucket`,
        patchVersion:   data.patchVersion     ?? drizzleSql`excluded.patch_version`,
        ingestionError: data.ingestionError   ?? null,
        lastSyncedAt:   now,
        updatedAt:      now,
      },
    })
    .returning();
  return row;
}

/**
 * Bulk-upsert multiple match records for the same player.
 * Returns the count of rows affected (inserts + updates).
 */
export async function bulkUpsertMatchSourceData(
  rows: InsertPlayerMatchSourceDatum[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const now = new Date();
  const result = await db
    .insert(playerMatchSourceData)
    .values(rows.map(r => ({ ...r, lastSyncedAt: now, updatedAt: now })) as any)
    .onConflictDoUpdate({
      target: [
        playerMatchSourceData.playerProfileId,
        playerMatchSourceData.providerGroup,
        playerMatchSourceData.providerMatchId,
      ],
      set: {
        matchStatus:    drizzleSql`excluded.match_status`,
        rawSummaryJson: drizzleSql`excluded.raw_summary_json`,
        rankBucket:     drizzleSql`excluded.rank_bucket`,
        ingestionError: null,
        lastSyncedAt:   now,
        updatedAt:      now,
      },
    })
    .returning({ id: playerMatchSourceData.id });
  return result.length;
}

/**
 * List match source records for a player profile (paginated, newest first).
 */
export async function listMatchSourceDataByProfile(
  playerProfileId: number,
  opts: { limit?: number; offset?: number } = {},
): Promise<PlayerMatchSourceDatum[]> {
  return db
    .select()
    .from(playerMatchSourceData)
    .where(eq(playerMatchSourceData.playerProfileId, playerProfileId))
    .orderBy(desc(playerMatchSourceData.playedAt))
    .limit(opts.limit ?? 50)
    .offset(opts.offset ?? 0);
}

/**
 * Count total match records for a player profile.
 */
export async function countMatchSourceDataByProfile(playerProfileId: number): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(playerMatchSourceData)
    .where(eq(playerMatchSourceData.playerProfileId, playerProfileId));
  return row?.total ?? 0;
}

/**
 * Count ranked match records for a player profile.
 * Used for eligibility readiness scoring.
 */
export async function countRankedMatchesByProfile(playerProfileId: number): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(playerMatchSourceData)
    .where(
      and(
        eq(playerMatchSourceData.playerProfileId, playerProfileId),
        eq(playerMatchSourceData.isRanked, true),
      ),
    );
  return row?.total ?? 0;
}

/**
 * Find a specific match by provider identity (used for dedup checks).
 */
export async function findMatchByProviderIdentity(
  playerProfileId: number,
  providerGroup: string,
  providerMatchId: string,
): Promise<PlayerMatchSourceDatum | null> {
  const [row] = await db
    .select()
    .from(playerMatchSourceData)
    .where(
      and(
        eq(playerMatchSourceData.playerProfileId, playerProfileId),
        eq(playerMatchSourceData.providerGroup, providerGroup as any),
        eq(playerMatchSourceData.providerMatchId, providerMatchId),
      ),
    );
  return row ?? null;
}

/**
 * Return the IDs of matches that already exist for a player+provider combination.
 * Used for efficient dedup: only process match IDs NOT in this set.
 */
export async function findExistingProviderMatchIds(
  playerProfileId: number,
  providerGroup: string,
  providerMatchIds: string[],
): Promise<Set<string>> {
  if (providerMatchIds.length === 0) return new Set();
  const rows = await db
    .select({ providerMatchId: playerMatchSourceData.providerMatchId })
    .from(playerMatchSourceData)
    .where(
      and(
        eq(playerMatchSourceData.playerProfileId, playerProfileId),
        eq(playerMatchSourceData.providerGroup, providerGroup as any),
        inArray(playerMatchSourceData.providerMatchId, providerMatchIds),
      ),
    );
  return new Set(rows.map(r => r.providerMatchId));
}

/**
 * Fetch RAW_FETCHED or DETAIL_FETCHED match records ready for enrichment processing.
 * Ordered by playedAt ascending (oldest first) so we process chronologically.
 */
export async function findMatchesForEnrichment(
  playerProfileId: number,
  statuses: MatchSourceStatus[] = ["RAW_FETCHED", "DETAIL_FETCHED"],
  limit = 20,
): Promise<PlayerMatchSourceDatum[]> {
  return db
    .select()
    .from(playerMatchSourceData)
    .where(
      and(
        eq(playerMatchSourceData.playerProfileId, playerProfileId),
        inArray(playerMatchSourceData.matchStatus, statuses),
      ),
    )
    .orderBy(playerMatchSourceData.playedAt)
    .limit(limit);
}

/**
 * Update the match_status of a single player_match_source_data record.
 * Optionally clears or sets ingestion_error.
 */
export async function updateMatchSourceStatus(
  id:              number,
  status:          MatchSourceStatus,
  ingestionError?: string | null,
): Promise<void> {
  const now = new Date();
  await db
    .update(playerMatchSourceData)
    .set({
      matchStatus:    status as any,
      ingestionError: ingestionError !== undefined ? ingestionError : drizzleSql`ingestion_error`,
      lastSyncedAt:   now,
      updatedAt:      now,
    })
    .where(eq(playerMatchSourceData.id, id));
}

/**
 * Patch the rawPayloadJson of an existing match source record and bump status.
 */
export async function enrichMatchPayload(
  id:             number,
  rawPayloadJson: string,
): Promise<void> {
  const now = new Date();
  await db
    .update(playerMatchSourceData)
    .set({
      rawPayloadJson,
      matchStatus:  "DETAIL_FETCHED" as any,
      lastSyncedAt: now,
      updatedAt:    now,
    })
    .where(eq(playerMatchSourceData.id, id));
}

// ── PlayerMatchAnalytics ──────────────────────────────────────────────────────

/**
 * Upsert an analytics record for a single match.
 * Unique key: player_match_source_data_id (one analytics per raw record).
 * On conflict: full overwrite so re-processing produces fresh data.
 */
export async function upsertMatchAnalytics(
  data: InsertPlayerMatchAnalytic,
): Promise<PlayerMatchAnalytic> {
  const now = new Date();
  const [row] = await db
    .insert(playerMatchAnalytics)
    .values({ ...data, updatedAt: now } as any)
    .onConflictDoUpdate({
      target: [playerMatchAnalytics.playerMatchSourceDataId],
      set: {
        detectedRole:          data.detectedRole as any,
        roleSource:            data.roleSource as any,
        roleConfidence:        data.roleConfidence,
        durationBucket:        data.durationBucket as any,
        isRanked:              data.isRanked,
        isEligible:            data.isEligible,
        eligibilityReasonCode: data.eligibilityReasonCode as any,
        dataCompleteness:      data.dataCompleteness,
        metricsJson:           data.metricsJson,
        missingMetricsJson:    data.missingMetricsJson,
        contextJson:           data.contextJson,
        processedAt:           data.processedAt ?? drizzleSql`NOW()`,
        updatedAt:             now,
      },
    })
    .returning();
  return row;
}

/**
 * List analytics records for a player (paginated, newest processed first).
 */
export async function listMatchAnalyticsByProfile(
  playerProfileId: number,
  opts: { limit?: number; offset?: number; eligibleOnly?: boolean } = {},
): Promise<PlayerMatchAnalytic[]> {
  const conditions = [eq(playerMatchAnalytics.playerProfileId, playerProfileId)];
  if (opts.eligibleOnly) conditions.push(eq(playerMatchAnalytics.isEligible, true));
  return db
    .select()
    .from(playerMatchAnalytics)
    .where(and(...conditions))
    .orderBy(desc(playerMatchAnalytics.processedAt))
    .limit(opts.limit ?? 20)
    .offset(opts.offset ?? 0);
}

/**
 * Count eligible analytics records for a player profile.
 * Used by Fase 5 eligibility gate and player-level readiness update.
 */
export async function countEligibleAnalyticsByProfile(
  playerProfileId: number,
): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(playerMatchAnalytics)
    .where(
      and(
        eq(playerMatchAnalytics.playerProfileId, playerProfileId),
        eq(playerMatchAnalytics.isEligible, true),
      ),
    );
  return row?.total ?? 0;
}

/**
 * Count total analytics records for a player profile.
 */
export async function countTotalAnalyticsByProfile(
  playerProfileId: number,
): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(playerMatchAnalytics)
    .where(eq(playerMatchAnalytics.playerProfileId, playerProfileId));
  return row?.total ?? 0;
}

/**
 * Fetch all eligible analytics for a game (for baseline building).
 * Optionally constrain to a role.
 */
export async function findEligibleAnalyticsForBaseline(
  game: string,
  role?: string,
): Promise<PlayerMatchAnalytic[]> {
  const conditions = [
    eq(playerMatchAnalytics.game, game as any),
    eq(playerMatchAnalytics.isEligible, true),
    isNotNull(playerMatchAnalytics.detectedRole),
    isNotNull(playerMatchAnalytics.metricsJson),
  ];
  if (role) conditions.push(eq(playerMatchAnalytics.detectedRole, role as any));
  return db
    .select()
    .from(playerMatchAnalytics)
    .where(and(...conditions));
}

// ── PerformanceBaselines ──────────────────────────────────────────────────────

/**
 * Bulk upsert baseline rows. ON CONFLICT (cohort unique key) → full update.
 * Processes in batches to stay within statement size limits.
 */
export async function bulkUpsertBaselines(
  rows: InsertPerformanceBaseline[],
  batchSize = 200,
): Promise<number> {
  if (rows.length === 0) return 0;
  const now = new Date();
  let upserted = 0;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    // Drizzle doesn't support expression-based unique indexes in onConflictDoUpdate.
    // We use INSERT … ON CONFLICT DO NOTHING + manual delete+insert approach:
    // Simpler: delete + re-insert (baselines are cheap to rebuild).
    await db.insert(performanceBaselines)
      .values(batch.map(r => ({ ...r, updatedAt: now } as any)))
      .onConflictDoNothing();
    upserted += batch.length;
  }
  return upserted;
}

/**
 * Delete all baselines for a given game (before a full rebuild).
 */
export async function deleteBaselinesForGame(game: string): Promise<void> {
  await db.delete(performanceBaselines)
    .where(eq(performanceBaselines.game, game as any));
}

/**
 * Load all baselines for a game (used by score calculator).
 */
export async function findBaselinesForGame(
  game: string,
): Promise<PerformanceBaseline[]> {
  return db
    .select()
    .from(performanceBaselines)
    .where(eq(performanceBaselines.game, game as any));
}

/**
 * Count baselines by fallback level for a game.
 */
export async function countBaselines(game: string): Promise<{ total: number; byLevel: Record<string, number> }> {
  const rows = await db
    .select({ fallbackLevel: performanceBaselines.fallbackLevel, total: count() })
    .from(performanceBaselines)
    .where(eq(performanceBaselines.game, game as any))
    .groupBy(performanceBaselines.fallbackLevel);
  const total = rows.reduce((s, r) => s + (r.total ?? 0), 0);
  const byLevel: Record<string, number> = {};
  for (const r of rows) if (r.fallbackLevel) byLevel[r.fallbackLevel] = r.total ?? 0;
  return { total, byLevel };
}

// ── PerformanceMetricWeights ──────────────────────────────────────────────────

/**
 * Seed the canonical weight configuration (idempotent — skips existing rows).
 */
export async function seedMetricWeights(
  rows: InsertPerformanceMetricWeight[],
): Promise<void> {
  if (rows.length === 0) return;
  await db.insert(performanceMetricWeights)
    .values(rows as any)
    .onConflictDoNothing();
}

/**
 * Get all metric weights for a game (all roles, all versions).
 */
export async function findMetricWeights(game: string): Promise<PerformanceMetricWeight[]> {
  return db
    .select()
    .from(performanceMetricWeights)
    .where(eq(performanceMetricWeights.game, game as any))
    .orderBy(performanceMetricWeights.role, performanceMetricWeights.metric);
}

// ── PerformanceScoreComponents ────────────────────────────────────────────────

/**
 * Upsert a single score component record.
 * Unique on player_match_analytics_id — re-scoring replaces previous result.
 */
export async function upsertScoreComponent(
  data: InsertPerformanceScoreComponent,
): Promise<PerformanceScoreComponent> {
  const now = new Date();
  const [row] = await db
    .insert(performanceScoreComponents)
    .values({ ...data, updatedAt: now } as any)
    .onConflictDoUpdate({
      target: [performanceScoreComponents.playerMatchAnalyticsId],
      set: {
        role:                  data.role as any,
        baselineFallbackLevel: data.baselineFallbackLevel as any,
        baselineVersion:       data.baselineVersion,
        metricScoresJson:      data.metricScoresJson,
        metricZscoresJson:     data.metricZscoresJson,
        effectiveWeightsJson:  data.effectiveWeightsJson,
        missingMetricsJson:    data.missingMetricsJson,
        roleRelativeScore:     data.roleRelativeScore,
        scoreVersion:          data.scoreVersion,
        updatedAt:             now,
      },
    })
    .returning();
  return row;
}

/**
 * List score components for a player profile (most recently computed first).
 */
export async function listScoreComponentsByProfile(
  playerProfileId: number,
  opts: { limit?: number; offset?: number; role?: string } = {},
): Promise<PerformanceScoreComponent[]> {
  const conditions = [eq(performanceScoreComponents.playerProfileId, playerProfileId)];
  if (opts.role) conditions.push(eq(performanceScoreComponents.role, opts.role as any));
  return db
    .select()
    .from(performanceScoreComponents)
    .where(and(...conditions))
    .orderBy(desc(performanceScoreComponents.createdAt))
    .limit(opts.limit ?? 20)
    .offset(opts.offset ?? 0);
}

/**
 * Count score components for a player profile.
 */
export async function countScoreComponentsByProfile(
  playerProfileId: number,
): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(performanceScoreComponents)
    .where(eq(performanceScoreComponents.playerProfileId, playerProfileId));
  return row?.total ?? 0;
}

/**
 * Compute average RoleRelativeScore by role for a player profile.
 */
export async function avgRoleRelativeScoreByProfile(
  playerProfileId: number,
): Promise<{ role: string; avgScore: number; matchCount: number }[]> {
  const rows = await db
    .select({
      role:       performanceScoreComponents.role,
      avgScore:   drizzleSql<string>`AVG(role_relative_score)`,
      matchCount: count(),
    })
    .from(performanceScoreComponents)
    .where(eq(performanceScoreComponents.playerProfileId, playerProfileId))
    .groupBy(performanceScoreComponents.role);

  return rows.map(r => ({
    role:       r.role ?? "UNKNOWN",
    avgScore:   parseFloat(r.avgScore ?? "0"),
    matchCount: r.matchCount ?? 0,
  }));
}

/**
 * Fetch analytics records by an array of IDs (for bulk lookup during scoring).
 */
export async function findAnalyticsByIds(
  ids: number[],
): Promise<Map<number, PlayerMatchAnalytic>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select()
    .from(playerMatchAnalytics)
    .where(inArray(playerMatchAnalytics.id, ids));
  return new Map(rows.map(r => [r.id, r]));
}

// ── Dota2PerformanceScores ────────────────────────────────────────────────────

/**
 * Upsert a final performance score record.
 * Unique on player_match_analytics_id.
 */
export async function upsertDota2PerformanceScore(
  data: InsertDota2PerformanceScore,
): Promise<Dota2PerformanceScore> {
  const now = new Date();
  const [row] = await db
    .insert(dota2PerformanceScores)
    .values({ ...data, updatedAt: now } as any)
    .onConflictDoUpdate({
      target: [dota2PerformanceScores.playerMatchAnalyticsId],
      set: {
        roleRelativeScore:        data.roleRelativeScore,
        selfTrendScore:           data.selfTrendScore,
        contextScore:             data.contextScore,
        performanceScore:         data.performanceScore,
        trendConfidence:          data.trendConfidence,
        effectiveRoleWeight:      data.effectiveRoleWeight,
        effectiveSelfTrendWeight: data.effectiveSelfTrendWeight,
        effectiveContextWeight:   data.effectiveContextWeight,
        componentsJson:           data.componentsJson,
        scoreVersion:             data.scoreVersion,
        updatedAt:                now,
      },
    })
    .returning();
  return row;
}

/**
 * List performance scores for a player (most recent first).
 * Fase 8: supports `applied` boolean filter for idempotency control.
 */
export async function listDota2PerformanceScores(
  playerProfileId: number,
  opts: { limit?: number; offset?: number; role?: string; applied?: boolean; orderAsc?: boolean } = {},
): Promise<Dota2PerformanceScore[]> {
  const conditions = [eq(dota2PerformanceScores.playerProfileId, playerProfileId)];
  if (opts.role) conditions.push(eq(dota2PerformanceScores.role, opts.role as any));
  if (opts.applied !== undefined) {
    conditions.push(eq(dota2PerformanceScores.appliedToValuation, opts.applied));
  }
  const order = opts.orderAsc
    ? asc(dota2PerformanceScores.createdAt)
    : desc(dota2PerformanceScores.createdAt);
  return db
    .select()
    .from(dota2PerformanceScores)
    .where(and(...conditions))
    .orderBy(order)
    .limit(opts.limit ?? 20)
    .offset(opts.offset ?? 0);
}

/**
 * Fase 8: Mark a performance score as applied to valuation.
 * Records the history entry ID for full traceability.
 */
export async function markDota2PerformanceScoreApplied(
  scoreId:          number,
  valuationHistoryId: number,
): Promise<void> {
  await db
    .update(dota2PerformanceScores)
    .set({
      appliedToValuation:   true,
      appliedToValuationAt: new Date(),
      valuationHistoryId,
      updatedAt:            new Date(),
    } as any)
    .where(eq(dota2PerformanceScores.id, scoreId));
}

/**
 * Count performance scores for a player profile.
 */
export async function countDota2PerformanceScores(
  playerProfileId: number,
): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(dota2PerformanceScores)
    .where(eq(dota2PerformanceScores.playerProfileId, playerProfileId));
  return row?.total ?? 0;
}

/**
 * Aggregate performance scores — overall average and by-role breakdown.
 */
export async function avgDota2PerformanceScoreByProfile(
  playerProfileId: number,
): Promise<{ overall: number | null; byRole: { role: string; avgScore: number; count: number }[] } | null> {
  const byRoleRows = await db
    .select({
      role:     dota2PerformanceScores.role,
      avgScore: drizzleSql<string>`AVG(performance_score)`,
      cnt:      count(),
    })
    .from(dota2PerformanceScores)
    .where(eq(dota2PerformanceScores.playerProfileId, playerProfileId))
    .groupBy(dota2PerformanceScores.role);

  if (byRoleRows.length === 0) return null;

  const byRole = byRoleRows.map(r => ({
    role:     r.role ?? "UNKNOWN",
    avgScore: parseFloat(r.avgScore ?? "0"),
    count:    r.cnt ?? 0,
  }));

  const totalSamples = byRole.reduce((s, r) => s + r.count, 0);
  const weightedSum  = byRole.reduce((s, r) => s + r.avgScore * r.count, 0);
  const overall      = totalSamples > 0 ? weightedSum / totalSamples : null;

  return { overall: overall ? parseFloat(overall.toFixed(4)) : null, byRole };
}

// ── Dota2 Asset Fundamentals ──────────────────────────────────────────────────

export interface Dota2AssetFundamentals {
  assetId:              number;
  assetUid:             string;
  playerProfileId:      number | null;
  game:                 string;
  symbol:               string | null;
  displayName:          string | null;
  tradingStatus:        string | null;
  listingStatus:        string | null;
  playerValue:          number | null;
  confidenceScore:      number | null;
  sampleConfidence:     number | null;
  roleConfidence:       number | null;
  dataCompleteness:     number | null;
  rankStability:        number | null;
  lastPerformanceScore: number | null;
  matchesCount:         number | null;
  valuationVersion:     number | null;
  valuationUpdatedAt:   Date | null;
  pendingScoreCount:    number;
}

/**
 * Fase 8: Read model for Terminal fundamentals.
 * Joins assets + markets + dota2_valuation_state in one query.
 * Returns null if asset not found.
 */
export async function findDota2AssetFundamentals(
  assetId: number,
): Promise<Dota2AssetFundamentals | null> {
  const [assetRow] = await db
    .select({
      assetId:         assets.id,
      assetUid:        assets.assetUid,
      playerProfileId: assets.playerProfileId,
      symbol:          assets.symbol,
      displayName:     assets.displayName,
      tradingStatus:   assets.tradingStatus,
      listingStatus:   assets.listingStatus,
      game:            markets.game,
    })
    .from(assets)
    .innerJoin(markets, eq(markets.id, assets.marketId))
    .where(eq(assets.id, assetId));

  if (!assetRow) return null;

  const valuation = await getDota2ValuationState(assetId);

  const [pendingRow] = await db
    .select({ cnt: count() })
    .from(dota2PerformanceScores)
    .where(
      and(
        eq(dota2PerformanceScores.playerProfileId, assetRow.playerProfileId ?? -1),
        eq(dota2PerformanceScores.appliedToValuation, false),
      ),
    );

  return {
    assetId:              assetRow.assetId,
    assetUid:             assetRow.assetUid,
    playerProfileId:      assetRow.playerProfileId ?? null,
    game:                 assetRow.game ?? "dota2",
    symbol:               assetRow.symbol ?? null,
    displayName:          assetRow.displayName ?? null,
    tradingStatus:        assetRow.tradingStatus ?? null,
    listingStatus:        assetRow.listingStatus ?? null,
    playerValue:          valuation ? parseFloat(String(valuation.playerValue)) : null,
    confidenceScore:      valuation ? parseFloat(String(valuation.confidenceScore)) : null,
    sampleConfidence:     valuation ? parseFloat(String(valuation.sampleConfidence)) : null,
    roleConfidence:       valuation ? parseFloat(String(valuation.roleConfidence)) : null,
    dataCompleteness:     valuation ? parseFloat(String(valuation.dataCompleteness)) : null,
    rankStability:        valuation ? parseFloat(String(valuation.rankStability)) : null,
    lastPerformanceScore: valuation?.lastPerformanceScore ? parseFloat(String(valuation.lastPerformanceScore)) : null,
    matchesCount:         valuation?.matchesCount ?? null,
    valuationVersion:     valuation?.valuationVersion ?? null,
    valuationUpdatedAt:   valuation?.updatedAt ?? null,
    pendingScoreCount:    pendingRow?.cnt ?? 0,
  };
}

// ── Dota2ValuationState ───────────────────────────────────────────────────────

/**
 * Upsert the current valuation state for an asset.
 * Unique on asset_id.
 */
export async function upsertDota2ValuationState(
  data: InsertDota2ValuationState,
): Promise<Dota2ValuationState> {
  const now = new Date();
  const [row] = await db
    .insert(dota2ValuationState)
    .values({ ...data, updatedAt: now } as any)
    .onConflictDoUpdate({
      target: [dota2ValuationState.assetId],
      set: {
        rawValue:             data.rawValue,
        playerValue:          data.playerValue,
        confidenceScore:      data.confidenceScore,
        sampleConfidence:     data.sampleConfidence,
        roleConfidence:       data.roleConfidence,
        dataCompleteness:     data.dataCompleteness,
        rankStability:        data.rankStability,
        lastPerformanceScore: data.lastPerformanceScore,
        matchesCount:         data.matchesCount,
        valuationVersion:     data.valuationVersion,
        updatedAt:            now,
      },
    })
    .returning();
  return row;
}

/**
 * Get valuation state for an asset (null if not bootstrapped yet).
 */
export async function getDota2ValuationState(
  assetId: number,
): Promise<Dota2ValuationState | null> {
  const [row] = await db
    .select()
    .from(dota2ValuationState)
    .where(eq(dota2ValuationState.assetId, assetId))
    .limit(1);
  return row ?? null;
}

// ── Dota2ValueHistory ─────────────────────────────────────────────────────────

/**
 * Append a new history entry (audit trail). Returns the new row id.
 */
export async function insertDota2ValueHistory(
  data: InsertDota2ValueHistory,
): Promise<number> {
  const [row] = await db
    .insert(dota2ValueHistory)
    .values(data as any)
    .returning({ id: dota2ValueHistory.id });
  return row.id;
}

/**
 * List value history for an asset, most recent first.
 */
export async function listDota2ValueHistory(
  assetId: number,
  opts: { limit?: number; offset?: number; eventType?: string } = {},
): Promise<Dota2ValueHistoryRow[]> {
  const conditions = [eq(dota2ValueHistory.assetId, assetId)];
  if (opts.eventType) conditions.push(eq(dota2ValueHistory.eventType, opts.eventType as any));
  return db
    .select()
    .from(dota2ValueHistory)
    .where(and(...conditions))
    .orderBy(desc(dota2ValueHistory.createdAt))
    .limit(opts.limit ?? 20)
    .offset(opts.offset ?? 0);
}

/**
 * Count value history entries for an asset.
 */
export async function countDota2ValueHistory(assetId: number): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(dota2ValueHistory)
    .where(eq(dota2ValueHistory.assetId, assetId));
  return row?.total ?? 0;
}

// ── Asset Status Transitions (Fase 9) ─────────────────────────────────────────

/**
 * Fase 9: Update asset trading and listing status.
 * Used exclusively by admin approval/rejection workflow.
 * Never call this from user-facing endpoints.
 */
export async function updateAssetStatus(
  assetId:      number,
  statusUpdate: { tradingStatus?: string; listingStatus?: string },
): Promise<Asset | null> {
  const set: Record<string, any> = { updatedAt: new Date() };
  if (statusUpdate.tradingStatus) set["tradingStatus"] = statusUpdate.tradingStatus;
  if (statusUpdate.listingStatus) set["listingStatus"] = statusUpdate.listingStatus;
  const [row] = await db
    .update(assets)
    .set(set as any)
    .where(eq(assets.id, assetId))
    .returning();
  return row ?? null;
}

// ── AssetListingReviews (Fase 9) ──────────────────────────────────────────────

/**
 * Insert an immutable listing review record.
 * One record per admin decision (approve or reject).
 */
export async function insertAssetListingReview(
  data: InsertAssetListingReview,
): Promise<AssetListingReview> {
  const now = new Date();
  const [row] = await db
    .insert(assetListingReviews)
    .values({ ...data, createdAt: now, updatedAt: now } as any)
    .returning();
  return row;
}

/**
 * Get the most recent listing review for an asset.
 * Returns null if no review has been recorded.
 */
export async function findLatestAssetListingReview(
  assetId: number,
): Promise<AssetListingReview | null> {
  const [row] = await db
    .select()
    .from(assetListingReviews)
    .where(eq(assetListingReviews.assetId, assetId))
    .orderBy(desc(assetListingReviews.createdAt))
    .limit(1);
  return row ?? null;
}

export interface Dota2AssetUnderReview {
  assetId:          number;
  assetUid:         string;
  displayName:      string | null;
  symbol:           string | null;
  tradingStatus:    string | null;
  listingStatus:    string | null;
  playerProfileId:  number | null;
  lastSyncedAt:     Date | null;
  latestReview:     AssetListingReview | null;
  // Fase 10: frozen snapshot submitted by the user (null if not yet submitted)
  latestSubmission: AssetListingSubmission | null;
}

/**
 * List all Dota2 assets with listing_status = UNDER_REVIEW for the admin queue.
 * Includes the most recent review record (if any) for context.
 */
export async function listDota2AssetsUnderReview(): Promise<Dota2AssetUnderReview[]> {
  const rows = await db
    .select({
      assetId:        assets.id,
      assetUid:       assets.assetUid,
      displayName:    assets.displayName,
      symbol:         assets.symbol,
      tradingStatus:  assets.tradingStatus,
      listingStatus:  assets.listingStatus,
      playerProfileId: assets.playerProfileId,
      lastSyncedAt:   assets.lastSyncedAt,
    })
    .from(assets)
    .innerJoin(markets, eq(markets.id, assets.marketId))
    .where(
      and(
        eq(markets.game, "dota2"),
        eq(assets.listingStatus, "UNDER_REVIEW"),
      ),
    )
    .orderBy(desc(assets.lastSyncedAt));

  // Fetch latest review + latest submission for each asset (N+1 OK for small queues)
  const results: Dota2AssetUnderReview[] = await Promise.all(
    rows.map(async row => ({
      ...row,
      latestReview:     await findLatestAssetListingReview(row.assetId),
      latestSubmission: await findLatestAssetListingSubmission(row.assetId),
    })),
  );

  return results;
}

// ── AccountVerificationEvents (Fase 10) ───────────────────────────────────────

/**
 * Log an account verification event (immutable — one row per attempt).
 */
export async function insertAccountVerificationEvent(
  data: InsertAccountVerificationEvent,
): Promise<AccountVerificationEvent> {
  const [row] = await db
    .insert(accountVerificationEvents)
    .values({ ...data, createdAt: new Date() } as any)
    .returning();
  return row;
}

/**
 * List all verification events for a connected account (most recent first).
 */
export async function listAccountVerificationEvents(
  connectedAccountId: number,
): Promise<AccountVerificationEvent[]> {
  return db
    .select()
    .from(accountVerificationEvents)
    .where(eq(accountVerificationEvents.connectedAccountId, connectedAccountId))
    .orderBy(desc(accountVerificationEvents.createdAt));
}

// ── AssetListingSubmissions (Fase 10) ─────────────────────────────────────────

/**
 * Create a new listing submission with a frozen readiness snapshot.
 */
export async function insertAssetListingSubmission(
  data: InsertAssetListingSubmission,
): Promise<AssetListingSubmission> {
  const now = new Date();
  const [row] = await db
    .insert(assetListingSubmissions)
    .values({ ...data, submissionStatus: "PENDING", createdAt: now, updatedAt: now } as any)
    .returning();
  return row;
}

/**
 * Find the most recent listing submission for an asset.
 */
export async function findLatestAssetListingSubmission(
  assetId: number,
): Promise<AssetListingSubmission | null> {
  const [row] = await db
    .select()
    .from(assetListingSubmissions)
    .where(eq(assetListingSubmissions.assetId, assetId))
    .orderBy(desc(assetListingSubmissions.createdAt))
    .limit(1);
  return row ?? null;
}

/**
 * List all submissions by a user (most recent first).
 */
export async function listAssetListingSubmissionsByUser(
  userId: string,
): Promise<AssetListingSubmission[]> {
  return db
    .select()
    .from(assetListingSubmissions)
    .where(eq(assetListingSubmissions.submittedByUserId, userId))
    .orderBy(desc(assetListingSubmissions.createdAt));
}

/**
 * Transition a submission to a new status.
 * Used by admin approve/reject and user withdraw.
 */
export async function updateAssetListingSubmissionStatus(
  submissionId: number,
  status:       string,
): Promise<AssetListingSubmission | null> {
  const [row] = await db
    .update(assetListingSubmissions)
    .set({ submissionStatus: status as any, updatedAt: new Date() })
    .where(eq(assetListingSubmissions.id, submissionId))
    .returning();
  return row ?? null;
}

/**
 * Update the connected account's verificationStatus and name.
 * Used after successful Steam OpenID verification.
 */
export async function updateConnectedAccountVerificationStatus(
  connectedAccountId: number,
  status:             string,
  providerAccountName?: string,
): Promise<void> {
  const set: Record<string, any> = {
    verificationStatus: status as any,
    updatedAt:          new Date(),
  };
  if (providerAccountName !== undefined) {
    set["providerAccountName"] = providerAccountName;
  }
  await db
    .update(connectedAccounts)
    .set(set as any)
    .where(eq(connectedAccounts.id, connectedAccountId));
}

/**
 * Fase 17: Mark ALL Steam ConnectedAccounts for a user with a given SteamID64 as verified.
 *
 * When a user completes Steam OpenID verification, the same SteamID64 applies to ALL
 * their Steam-connected games (dota2, cs2, etc.). This function updates every matching
 * account atomically so multi-game accounts all reflect VERIFIED status.
 *
 * Called from the Steam callback handler instead of the single-account update.
 */
export async function updateAllSteamConnectedAccountsVerificationStatus(
  userId:               string,
  steamId64:            string,
  status:               string,
  providerAccountName?: string,
): Promise<void> {
  const set: Record<string, any> = {
    verificationStatus: status as any,
    updatedAt:          new Date(),
  };
  if (providerAccountName !== undefined) {
    set["providerAccountName"] = providerAccountName;
  }
  await db
    .update(connectedAccounts)
    .set(set as any)
    .where(
      and(
        eq(connectedAccounts.userId, userId),
        eq(connectedAccounts.providerGroup, "steam"),
        eq(connectedAccounts.providerAccountId, steamId64),
      ),
    );
}

// ── Dota2 Asset Claim Requests (Fase 11) ─────────────────────────────────────

/**
 * Create a new Dota2 asset claim request.
 * Caller must verify the connected account is VERIFIED before calling this.
 */
export async function insertDota2ClaimRequest(
  data: InsertDota2AssetClaimRequest,
): Promise<Dota2AssetClaimRequest> {
  const now = new Date();
  const [row] = await db
    .insert(dota2AssetClaimRequests)
    .values({ ...data, claimStatus: "PENDING", createdAt: now, updatedAt: now } as any)
    .returning();
  return row;
}

/**
 * Find open (PENDING or UNDER_REVIEW) claims for a given asset+user pair.
 * Used to prevent duplicate open claims.
 */
export async function findOpenDota2ClaimsByAssetAndUser(
  assetId: number,
  userId:  string,
): Promise<Dota2AssetClaimRequest[]> {
  return db
    .select()
    .from(dota2AssetClaimRequests)
    .where(
      and(
        eq(dota2AssetClaimRequests.assetId, assetId),
        eq(dota2AssetClaimRequests.requestedByUserId, userId),
      ),
    )
    .then(rows => rows.filter(r => r.claimStatus === "PENDING" || r.claimStatus === "UNDER_REVIEW"));
}

/**
 * Get a single claim request by id.
 */
export async function findDota2ClaimRequest(
  id: number,
): Promise<Dota2AssetClaimRequest | null> {
  const [row] = await db
    .select()
    .from(dota2AssetClaimRequests)
    .where(eq(dota2AssetClaimRequests.id, id));
  return row ?? null;
}

/**
 * List all claim requests submitted by a user (most recent first).
 */
export async function listDota2ClaimRequestsByUser(
  userId: string,
): Promise<Dota2AssetClaimRequest[]> {
  return db
    .select()
    .from(dota2AssetClaimRequests)
    .where(eq(dota2AssetClaimRequests.requestedByUserId, userId))
    .orderBy(desc(dota2AssetClaimRequests.createdAt));
}

/**
 * List all claim requests — optionally filtered by status — for the admin queue.
 */
export async function listDota2ClaimRequestsAdmin(
  claimStatus?: string,
): Promise<Dota2AssetClaimRequest[]> {
  const rows = await db
    .select()
    .from(dota2AssetClaimRequests)
    .orderBy(desc(dota2AssetClaimRequests.createdAt));

  if (claimStatus) {
    return rows.filter(r => r.claimStatus === claimStatus);
  }
  return rows;
}

/**
 * Update claim status and review fields.
 */
export async function updateDota2ClaimRequest(
  id:     number,
  update: Partial<{
    claimStatus:  string;
    reviewNotes:  string;
    reviewedBy:   string;
    reviewedAt:   Date;
  }>,
): Promise<Dota2AssetClaimRequest | null> {
  const [row] = await db
    .update(dota2AssetClaimRequests)
    .set({ ...update, updatedAt: new Date() } as any)
    .where(eq(dota2AssetClaimRequests.id, id))
    .returning();
  return row ?? null;
}

// ── Fase 14: Cancel Claim (user-initiated) ───────────────────────────────────

/**
 * Cancel a Dota2 asset claim — user-initiated.
 *
 * Rules:
 *   - Only the claim owner (requestedByUserId) may cancel.
 *   - Allowed statuses: PENDING, UNDER_REVIEW.
 *   - Terminal statuses (APPROVED / REJECTED / CANCELLED) are not cancellable.
 *   - Audit trail is preserved (row is never deleted).
 *
 * @throws "FORBIDDEN" if claim belongs to another user.
 * @throws "NOT_CANCELLABLE:<status>" if claim is in a terminal state.
 * @returns null if claimId not found; updated row on success.
 */
export async function cancelDota2ClaimRequest(
  claimId: number,
  userId:  string,
): Promise<Dota2AssetClaimRequest | null> {
  const [existing] = await db
    .select()
    .from(dota2AssetClaimRequests)
    .where(eq(dota2AssetClaimRequests.id, claimId));

  if (!existing) return null;

  if (existing.requestedByUserId !== userId) {
    throw new Error("FORBIDDEN");
  }

  const cancellable = ["PENDING", "UNDER_REVIEW"];
  if (!cancellable.includes(existing.claimStatus as string)) {
    throw new Error(`NOT_CANCELLABLE:${existing.claimStatus}`);
  }

  const [row] = await db
    .update(dota2AssetClaimRequests)
    .set({ claimStatus: "CANCELLED" as any, updatedAt: new Date() })
    .where(eq(dota2AssetClaimRequests.id, claimId))
    .returning();
  return row ?? null;
}

// ── Asset Ownership Links (Fase 11) ──────────────────────────────────────────

/**
 * Create a new ownership link (typically called on claim approval).
 */
export async function insertAssetOwnershipLink(
  data: InsertAssetOwnershipLink,
): Promise<AssetOwnershipLink> {
  const now = new Date();
  const [row] = await db
    .insert(assetOwnershipLinks)
    .values({ ...data, status: "ACTIVE", createdAt: now, updatedAt: now } as any)
    .returning();
  return row;
}

/**
 * Find the current ACTIVE ownership link for an asset (at most one at a time).
 */
export async function findActiveAssetOwnershipLink(
  assetId: number,
): Promise<AssetOwnershipLink | null> {
  const [row] = await db
    .select()
    .from(assetOwnershipLinks)
    .where(
      and(
        eq(assetOwnershipLinks.assetId, assetId),
        eq(assetOwnershipLinks.status, "ACTIVE"),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * List all ownership links for a user (active and revoked — full audit trail).
 */
export async function listAssetOwnershipLinksByUser(
  userId: string,
): Promise<AssetOwnershipLink[]> {
  return db
    .select()
    .from(assetOwnershipLinks)
    .where(eq(assetOwnershipLinks.userId, userId))
    .orderBy(desc(assetOwnershipLinks.createdAt));
}

/**
 * Revoke an ownership link (marks REVOKED — row is never deleted).
 */
export async function revokeAssetOwnershipLink(
  linkId: number,
): Promise<AssetOwnershipLink | null> {
  const [row] = await db
    .update(assetOwnershipLinks)
    .set({ status: "REVOKED" as any, updatedAt: new Date() })
    .where(eq(assetOwnershipLinks.id, linkId))
    .returning();
  return row ?? null;
}

// ── Fase 12A: Claim Safety Core ───────────────────────────────────────────────

/**
 * Approve a Dota2 asset claim inside a single DB transaction.
 *
 * Invariants enforced atomically:
 *   1. Claim must be PENDING or UNDER_REVIEW (validated inside tx)
 *   2. Any existing ACTIVE ownership link for the asset is REVOKED first
 *   3. A new ACTIVE ownership link is created
 *   4. Claim is updated to APPROVED with reviewer info
 *
 * The DB also has a partial unique index on asset_ownership_links(asset_id)
 * WHERE status='ACTIVE', so a concurrent approval race that somehow bypasses
 * step 2 will hit a unique violation and roll back.
 *
 * @throws {Error} if claim not found, already in a terminal state, or DB fails
 */
export async function approveDota2ClaimTx(
  claimId:     number,
  reviewedBy:  string,
  reviewNotes?: string,
): Promise<{ claim: Dota2AssetClaimRequest; ownershipLink: AssetOwnershipLink }> {
  return db.transaction(async (tx) => {
    // Step 1: Load and validate claim
    const [claim] = await tx
      .select()
      .from(dota2AssetClaimRequests)
      .where(eq(dota2AssetClaimRequests.id, claimId));

    if (!claim) {
      throw new Error(`CLAIM_NOT_FOUND:${claimId}`);
    }

    const approvable = ["PENDING", "UNDER_REVIEW"];
    if (!approvable.includes(claim.claimStatus)) {
      throw new Error(`CLAIM_NOT_APPROVABLE:${claim.claimStatus}`);
    }

    const now = new Date();

    // Step 2: Revoke any existing ACTIVE ownership link for this asset
    const [existingActive] = await tx
      .select()
      .from(assetOwnershipLinks)
      .where(
        and(
          eq(assetOwnershipLinks.assetId, claim.assetId),
          eq(assetOwnershipLinks.status, "ACTIVE"),
        ),
      )
      .limit(1);

    if (existingActive) {
      await tx
        .update(assetOwnershipLinks)
        .set({ status: "REVOKED" as any, updatedAt: now })
        .where(eq(assetOwnershipLinks.id, existingActive.id));
    }

    // Step 3: Create new ACTIVE ownership link
    // If a concurrent approval sneaked through, the partial unique index
    // (asset_id WHERE status='ACTIVE') will raise a unique violation here,
    // rolling back the entire transaction.
    const [ownershipLink] = await tx
      .insert(assetOwnershipLinks)
      .values({
        assetId:         claim.assetId,
        playerProfileId: claim.playerProfileId,
        userId:          claim.requestedByUserId,
        ownershipType:   "CLAIMED_OWNER" as any,
        status:          "ACTIVE" as any,
        sourceType:      "CLAIM_APPROVAL",
        sourceId:        claim.id,
        createdAt:       now,
        updatedAt:       now,
      } as any)
      .returning();

    // Step 4: Mark claim APPROVED
    const [updatedClaim] = await tx
      .update(dota2AssetClaimRequests)
      .set({
        claimStatus: "APPROVED" as any,
        reviewedBy,
        reviewedAt:  now,
        reviewNotes: reviewNotes ?? null,
        updatedAt:   now,
      })
      .where(eq(dota2AssetClaimRequests.id, claimId))
      .returning();

    return { claim: updatedClaim, ownershipLink };
  });
}

// ── Fase 13: Admin Read Models ─────────────────────────────────────────────────

/**
 * Find the most recent claim request for a given asset (admin read model helper).
 */
export async function findLatestDota2ClaimByAsset(
  assetId: number,
): Promise<Dota2AssetClaimRequest | null> {
  const [row] = await db
    .select()
    .from(dota2AssetClaimRequests)
    .where(eq(dota2AssetClaimRequests.assetId, assetId))
    .orderBy(desc(dota2AssetClaimRequests.createdAt))
    .limit(1);
  return row ?? null;
}

/**
 * List all claim requests for a given asset (admin read model — all history).
 */
export async function listDota2ClaimsByAsset(
  assetId: number,
): Promise<Dota2AssetClaimRequest[]> {
  return db
    .select()
    .from(dota2AssetClaimRequests)
    .where(eq(dota2AssetClaimRequests.assetId, assetId))
    .orderBy(desc(dota2AssetClaimRequests.createdAt));
}

/**
 * List Dota2 claim requests for admin with optional multi-field filters.
 * Supports: status, approvalType, matchConfidence.
 * Verification status and hasActiveOwner are applied in the route (post-fetch),
 * since they require joining external tables.
 */
export async function listDota2ClaimRequestsAdminFiltered(opts: {
  claimStatus?:    string;
  approvalType?:   string;
  matchConfidence?: string;
}): Promise<Dota2AssetClaimRequest[]> {
  const conditions = [];
  if (opts.claimStatus)     conditions.push(eq(dota2AssetClaimRequests.claimStatus,    opts.claimStatus    as any));
  if (opts.approvalType)    conditions.push(eq(dota2AssetClaimRequests.approvalType,   opts.approvalType   as any));
  if (opts.matchConfidence) conditions.push(eq(dota2AssetClaimRequests.matchConfidence, opts.matchConfidence as any));

  return db
    .select()
    .from(dota2AssetClaimRequests)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(dota2AssetClaimRequests.createdAt));
}

// ── Fase 18: Multi-Game Admin Ops & Observability ──────────────────────────────

/**
 * Fase 18: List claim requests across ALL games with flexible filters.
 *
 * The `dota2_asset_claim_requests` table stores claims for all games
 * via the `game` column. This replaces the dota2-only admin endpoints
 * for the multi-game admin UI.
 */
export async function listMultigameClaimsAdmin(opts: {
  game?:            string;
  claimStatus?:     string;
  approvalType?:    string;
  matchConfidence?: string;
  limit?:           number;
  offset?:          number;
}): Promise<{ claims: Dota2AssetClaimRequest[]; total: number }> {
  const { limit = 50, offset = 0 } = opts;
  const conditions: any[] = [];

  if (opts.game)            conditions.push(eq(dota2AssetClaimRequests.game,            opts.game            as any));
  if (opts.claimStatus)     conditions.push(eq(dota2AssetClaimRequests.claimStatus,     opts.claimStatus     as any));
  if (opts.approvalType)    conditions.push(eq(dota2AssetClaimRequests.approvalType,    opts.approvalType    as any));
  if (opts.matchConfidence) conditions.push(eq(dota2AssetClaimRequests.matchConfidence, opts.matchConfidence as any));

  const whereClause = conditions.length ? and(...conditions) : undefined;

  const [countRow] = await db
    .select({ total: count() })
    .from(dota2AssetClaimRequests)
    .where(whereClause);

  const rows = await db
    .select()
    .from(dota2AssetClaimRequests)
    .where(whereClause)
    .orderBy(desc(dota2AssetClaimRequests.createdAt))
    .limit(limit)
    .offset(offset);

  return { claims: rows, total: Number(countRow?.total ?? 0) };
}

// ─── Aggregate types ──────────────────────────────────────────────────────────

export interface MultiGameOpsSummary {
  connectedAccounts: {
    total:                number;
    byProviderGame:       Array<{ providerGroup: string; game: string | null; count: number }>;
    byVerificationStatus: Array<{ verificationStatus: string | null; count: number }>;
  };
  claims: {
    total:             number;
    byGameAndStatus:   Array<{ game: string | null; claimStatus: string | null; count: number }>;
    autoApprovedCount: number;
    manualPendingCount: number;
    rejectedCount:     number;
  };
  assets: {
    total:          number;
    byGameAndListing: Array<{ game: string | null; listingStatus: string | null; count: number }>;
    underReviewCount: number;
    listedCount:    number;
  };
  ownedAssets: {
    activeCount: number;
    byGame:      Array<{ game: string | null; count: number }>;
  };
  verificationEvents: {
    total:      number;
    byStatus:   Array<{ status: string | null; count: number }>;
    failedCount: number;
    verifiedCount: number;
  };
  generatedAt: string;
}

/**
 * Fase 18: Return aggregated metrics across all games for the admin Ops Summary dashboard.
 *
 * Runs 8 parallel aggregate queries and assembles the result.
 * All GROUP BY counts use Drizzle's `count()` to stay type-safe.
 */
export async function getMultigameOpsSummary(): Promise<MultiGameOpsSummary> {

  const [
    // 1. Connected accounts total
    [accountTotalRow],
    // 2. Connected accounts by provider+game
    accountsByProviderGame,
    // 3. Connected accounts by verificationStatus
    accountsByVerifStatus,
    // 4. Claims by game+status
    claimsByGameAndStatus,
    // 5. Claims approvalType aggregate
    claimsByApprovalType,
    // 6. Assets listing status by game (via market join)
    assetsByGameAndListing,
    // 7. Active ownership links by game (via asset → market join)
    ownershipByGame,
    // 8. Verification events by status
    verificationEventsByStatus,
  ] = await Promise.all([
    // 1
    db.select({ total: count() }).from(connectedAccounts),
    // 2
    db.select({
      providerGroup:      connectedAccounts.providerGroup,
      game:               connectedAccounts.game,
      count: count(),
    }).from(connectedAccounts).groupBy(connectedAccounts.providerGroup, connectedAccounts.game),
    // 3
    db.select({
      verificationStatus: connectedAccounts.verificationStatus,
      count: count(),
    }).from(connectedAccounts).groupBy(connectedAccounts.verificationStatus),
    // 4
    db.select({
      game:        dota2AssetClaimRequests.game,
      claimStatus: dota2AssetClaimRequests.claimStatus,
      count: count(),
    }).from(dota2AssetClaimRequests).groupBy(dota2AssetClaimRequests.game, dota2AssetClaimRequests.claimStatus),
    // 5
    db.select({
      approvalType: dota2AssetClaimRequests.approvalType,
      claimStatus:  dota2AssetClaimRequests.claimStatus,
      count: count(),
    }).from(dota2AssetClaimRequests).groupBy(dota2AssetClaimRequests.approvalType, dota2AssetClaimRequests.claimStatus),
    // 6 — assets join markets to get game
    db.select({
      game:          markets.game,
      listingStatus: assets.listingStatus,
      count: count(),
    }).from(assets).innerJoin(markets, eq(markets.id, assets.marketId)).groupBy(markets.game, assets.listingStatus),
    // 7 — active ownership links joined to assets → markets
    db.select({
      game:  markets.game,
      count: count(),
    }).from(assetOwnershipLinks)
      .innerJoin(assets, eq(assets.id, assetOwnershipLinks.assetId))
      .innerJoin(markets, eq(markets.id, assets.marketId))
      .where(eq(assetOwnershipLinks.status, "ACTIVE" as any))
      .groupBy(markets.game),
    // 8
    db.select({
      status: accountVerificationEvents.status,
      count: count(),
    }).from(accountVerificationEvents).groupBy(accountVerificationEvents.status),
  ]);

  // ── Assemble claims aggregates ─────────────────────────────────────────────
  const claimTotal = claimsByGameAndStatus.reduce((sum, r) => sum + Number(r.count), 0);
  const autoApprovedCount = claimsByApprovalType
    .filter(r => r.approvalType === "AUTO_POLICY" && r.claimStatus === "APPROVED")
    .reduce((sum, r) => sum + Number(r.count), 0);
  const manualPendingCount = claimsByApprovalType
    .filter(r => r.claimStatus === "PENDING" || r.claimStatus === "UNDER_REVIEW")
    .reduce((sum, r) => sum + Number(r.count), 0);
  const rejectedCount = claimsByGameAndStatus
    .filter(r => r.claimStatus === "REJECTED")
    .reduce((sum, r) => sum + Number(r.count), 0);

  // ── Assemble asset aggregates ──────────────────────────────────────────────
  const assetTotal        = assetsByGameAndListing.reduce((sum, r) => sum + Number(r.count), 0);
  const underReviewCount  = assetsByGameAndListing.filter(r => r.listingStatus === "UNDER_REVIEW").reduce((sum, r) => sum + Number(r.count), 0);
  const listedCount       = assetsByGameAndListing.filter(r => r.listingStatus === "LISTED").reduce((sum, r) => sum + Number(r.count), 0);

  // ── Assemble verification event aggregates ────────────────────────────────
  const verifTotal    = verificationEventsByStatus.reduce((sum, r) => sum + Number(r.count), 0);
  const failedCount   = verificationEventsByStatus.filter(r => r.status === "FAILED").reduce((sum, r)  => sum + Number(r.count), 0);
  const verifiedCount = verificationEventsByStatus.filter(r => r.status === "VERIFIED").reduce((sum, r) => sum + Number(r.count), 0);

  const activeOwnershipCount = ownershipByGame.reduce((sum, r) => sum + Number(r.count), 0);

  return {
    connectedAccounts: {
      total:                Number(accountTotalRow?.total ?? 0),
      byProviderGame:       accountsByProviderGame.map(r => ({ ...r, count: Number(r.count) })),
      byVerificationStatus: accountsByVerifStatus.map(r => ({ ...r, count: Number(r.count) })),
    },
    claims: {
      total:             claimTotal,
      byGameAndStatus:   claimsByGameAndStatus.map(r => ({ ...r, count: Number(r.count) })),
      autoApprovedCount,
      manualPendingCount,
      rejectedCount,
    },
    assets: {
      total:            assetTotal,
      byGameAndListing: assetsByGameAndListing.map(r => ({ ...r, count: Number(r.count) })),
      underReviewCount,
      listedCount,
    },
    ownedAssets: {
      activeCount: activeOwnershipCount,
      byGame:      ownershipByGame.map(r => ({ ...r, count: Number(r.count) })),
    },
    verificationEvents: {
      total:        verifTotal,
      byStatus:     verificationEventsByStatus.map(r => ({ ...r, count: Number(r.count) })),
      failedCount,
      verifiedCount,
    },
    generatedAt: new Date().toISOString(),
  };
}

// ─── Troubleshooting types ────────────────────────────────────────────────────

export interface MultiGameTroubleshootingData {
  recentVerificationFailures:  AccountVerificationEvent[];
  pendingClaimsWithActiveOwner: Array<Dota2AssetClaimRequest & { ownerUserId: string | null }>;
  oldestPendingClaims:         Dota2AssetClaimRequest[];
  assetsWithOpenSubmission:    Array<{ assetId: number; assetUid: string | null; displayName: string | null; game: string | null; listingStatus: string | null }>;
  generatedAt: string;
}

/**
 * Fase 18: Return troubleshooting data for the admin Ops panel.
 *
 * Surfaces:
 *   1. Last 10 verification failures (so ops can re-trigger if needed)
 *   2. Open claims (PENDING/UNDER_REVIEW) on assets that already have an ACTIVE owner
 *      — these are conflict cases that need manual resolution
 *   3. Oldest pending claims (FIFO queue visibility — are claims stuck?)
 *   4. Assets in UNDER_REVIEW listing with an open submission (ready for admin action)
 */
export async function getMultigameTroubleshootingData(): Promise<MultiGameTroubleshootingData> {

  const [
    verificationFailures,
    pendingClaims,
    assetsUnderReview,
  ] = await Promise.all([
    // 1. Last 10 verification failures
    db.select()
      .from(accountVerificationEvents)
      .where(eq(accountVerificationEvents.status, "FAILED" as any))
      .orderBy(desc(accountVerificationEvents.createdAt))
      .limit(10),

    // 2+3. Open claims (PENDING or UNDER_REVIEW)
    db.select()
      .from(dota2AssetClaimRequests)
      .where(drizzleSql`${dota2AssetClaimRequests.claimStatus} IN ('PENDING', 'UNDER_REVIEW')`)
      .orderBy(asc(dota2AssetClaimRequests.createdAt))
      .limit(50),

    // 4. Assets in UNDER_REVIEW listing
    db.select({
      assetId:       assets.id,
      assetUid:      assets.assetUid,
      displayName:   assets.displayName,
      game:          markets.game,
      listingStatus: assets.listingStatus,
    }).from(assets)
      .innerJoin(markets, eq(markets.id, assets.marketId))
      .where(eq(assets.listingStatus, "UNDER_REVIEW" as any))
      .orderBy(asc(assets.createdAt))
      .limit(50),
  ]);

  // Enrich open claims: find which have an active owner (conflict cases)
  const pendingAssetIds = Array.from(new Set(pendingClaims.map(c => c.assetId)));
  let activeOwnersByAsset: Map<number, string | null> = new Map();

  if (pendingAssetIds.length > 0) {
    const ownerLinks = await db
      .select({ assetId: assetOwnershipLinks.assetId, userId: assetOwnershipLinks.userId })
      .from(assetOwnershipLinks)
      .where(
        and(
          inArray(assetOwnershipLinks.assetId, pendingAssetIds),
          eq(assetOwnershipLinks.status, "ACTIVE" as any),
        ),
      );
    for (const link of ownerLinks) {
      activeOwnersByAsset.set(link.assetId, link.userId);
    }
  }

  const pendingClaimsWithActiveOwner = pendingClaims
    .filter(c => activeOwnersByAsset.has(c.assetId))
    .map(c => ({ ...c, ownerUserId: activeOwnersByAsset.get(c.assetId) ?? null }));

  const oldestPendingClaims = pendingClaims.slice(0, 10);

  return {
    recentVerificationFailures:  verificationFailures as AccountVerificationEvent[],
    pendingClaimsWithActiveOwner,
    oldestPendingClaims,
    assetsWithOpenSubmission:    assetsUnderReview,
    generatedAt:                 new Date().toISOString(),
  };
}

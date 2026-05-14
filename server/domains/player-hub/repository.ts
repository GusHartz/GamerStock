// ─── Player Hub Domain — Repository ──────────────────────────────────────────
import { eq, and, inArray, desc } from "drizzle-orm";
import { db } from "../../db";
import {
  playerClaims, playerPublicProfiles, assets, markets,
  playerAssetRequests,
} from "@shared/schema";
import { assetOwnershipLinks } from "@shared/schema/multigame";
import type { CreateAssetRequestInput } from "./types";

export const playerHubRepository = {

  // ── Claims (read-only; writes delegate to playerClaimsService) ─────────────

  async findClaimsByUser(userId: string) {
    return db
      .select()
      .from(playerClaims)
      .where(eq(playerClaims.userId, userId))
      .orderBy(desc(playerClaims.requestedAt));
  },

  async findProfileByUser(userId: string) {
    const [row] = await db
      .select()
      .from(playerPublicProfiles)
      .where(eq(playerPublicProfiles.claimedByUserId, userId))
      .limit(1);
    return row ?? null;
  },

  async findAllProfilesByUser(userId: string) {
    return db
      .select()
      .from(playerPublicProfiles)
      .where(eq(playerPublicProfiles.claimedByUserId, userId));
  },

  /**
   * Returns all ACTIVE asset_ownership_links for the user.
   *
   * This covers assets acquired via the multigame claim-asset flow
   * (POST /api/me/dota2/claim-asset, POST /api/me/cs2/claim-asset),
   * which writes to dota2_asset_claim_requests + asset_ownership_links
   * rather than player_claims.
   *
   * Without this, assets that the user claimed through the multigame onboarding
   * path would appear as "In Terminal" in Discovered Assets (because claimDiscovery
   * reads asset_ownership_links) but remain invisible in Asset Portfolio (which
   * previously only read player_claims and player_public_profiles).
   */
  async findActiveOwnershipLinksByUser(userId: string) {
    return db
      .select({
        assetId: assetOwnershipLinks.assetId,
        ownershipType: assetOwnershipLinks.ownershipType,
        status: assetOwnershipLinks.status,
        sourceType: assetOwnershipLinks.sourceType,
        createdAt: assetOwnershipLinks.createdAt,
      })
      .from(assetOwnershipLinks)
      .where(
        and(
          eq(assetOwnershipLinks.userId, userId),
          eq(assetOwnershipLinks.status, "ACTIVE"),
        ),
      );
  },

  // ── Assets enriched with market/game info ─────────────────────────────────

  async findAssetsByIds(assetIds: number[]) {
    if (assetIds.length === 0) return [];
    return db
      .select({
        id: assets.id,
        assetUid: assets.assetUid,
        displayName: assets.displayName,
        lastTradePrice: assets.lastTradePrice,
        momentum: assets.momentum,
        tradingStatus: assets.tradingStatus,
        listingStatus: assets.listingStatus,
        game: markets.game,
        provider: markets.provider,
      })
      .from(assets)
      .innerJoin(markets, eq(assets.marketId, markets.id))
      .where(inArray(assets.id, assetIds));
  },

  // ── Asset Requests ────────────────────────────────────────────────────────

  async findRequestsByUser(userId: string) {
    return db
      .select()
      .from(playerAssetRequests)
      .where(eq(playerAssetRequests.requestedByUserId, userId))
      .orderBy(desc(playerAssetRequests.createdAt));
  },

  async findPendingRequestForUserAndGame(
    userId: string,
    gameId: string,
    externalAccountRef: string,
  ) {
    const rows = await db
      .select()
      .from(playerAssetRequests)
      .where(
        and(
          eq(playerAssetRequests.requestedByUserId, userId),
          eq(playerAssetRequests.gameId, gameId),
          eq(playerAssetRequests.externalAccountRef, externalAccountRef),
          eq(playerAssetRequests.status, "pending"),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  },

  async createRequest(input: CreateAssetRequestInput) {
    const [row] = await db
      .insert(playerAssetRequests)
      .values({
        requestedByUserId: input.requestedByUserId,
        playerId: input.playerId ?? null,
        gameId: input.gameId,
        platform: input.platform,
        externalAccountRef: input.externalAccountRef ?? null,
        externalUsername: input.externalUsername ?? null,
        externalProfileUrl: input.externalProfileUrl ?? null,
        requestedAssetType: input.requestedAssetType ?? "pro_player_card",
        notes: input.notes ?? null,
        status: "pending",
      })
      .returning();
    return row;
  },
};

// ─── Player Claim System — Repository ─────────────────────────────────────────
// All DB access for player_claims and player_public_profiles tables.
// ─────────────────────────────────────────────────────────────────────────────
import { eq, and } from "drizzle-orm";
import { db } from "../../db";
import { playerClaims, playerPublicProfiles } from "@shared/schema";
import type {
  CreateClaimInput,
  ReviewClaimInput,
  RevokeClaimInput,
  UpdatePublicProfileInput,
} from "./types";

export const playerClaimsRepository = {
  // ── Claims ──────────────────────────────────────────────────────────────────

  async findClaimById(id: number) {
    const [row] = await db.select().from(playerClaims).where(eq(playerClaims.id, id)).limit(1);
    return row ?? null;
  },

  async findClaimsByUser(userId: string) {
    return db.select().from(playerClaims).where(eq(playerClaims.userId, userId));
  },

  async findApprovedClaimByUser(userId: string) {
    const rows = await db.select().from(playerClaims).where(
      and(eq(playerClaims.userId, userId), eq(playerClaims.claimStatus, "approved"))
    ).limit(1);
    return rows[0] ?? null;
  },

  async findPendingClaimForAsset(assetId: number) {
    const rows = await db.select().from(playerClaims).where(
      and(eq(playerClaims.assetId, assetId), eq(playerClaims.claimStatus, "pending"))
    ).limit(1);
    return rows[0] ?? null;
  },

  async findApprovedClaimForAsset(assetId: number) {
    const rows = await db.select().from(playerClaims).where(
      and(eq(playerClaims.assetId, assetId), eq(playerClaims.claimStatus, "approved"))
    ).limit(1);
    return rows[0] ?? null;
  },

  async listAllClaims(statusFilter?: string) {
    if (statusFilter) {
      return db.select().from(playerClaims).where(eq(playerClaims.claimStatus, statusFilter as any));
    }
    return db.select().from(playerClaims);
  },

  async createClaim(input: CreateClaimInput) {
    const [row] = await db.insert(playerClaims).values({
      userId: input.userId,
      assetId: input.assetId,
      assetUid: input.assetUid,
      puuid: input.puuid ?? null,
      evidenceNote: input.evidenceNote ?? null,
      verificationMethod: input.verificationMethod ?? "manual_admin_review",
      claimStatus: "pending",
    }).returning();
    return row;
  },

  /** Creates a claim that is immediately approved — no pending review required. */
  async createApprovedClaim(input: CreateClaimInput) {
    const now = new Date();
    const [row] = await db.insert(playerClaims).values({
      userId: input.userId,
      assetId: input.assetId,
      assetUid: input.assetUid,
      puuid: input.puuid ?? null,
      evidenceNote: input.evidenceNote ?? null,
      verificationMethod: "steam_auto_verified",
      claimStatus: "approved",
      approvedAt: now,
    }).returning();
    return row;
  },

  async approveClaim(input: ReviewClaimInput) {
    const now = new Date();
    const [row] = await db.update(playerClaims)
      .set({
        claimStatus: "approved",
        reviewedBy: input.reviewedByUserId,
        reviewedAt: now,
        approvedAt: now,
      })
      .where(eq(playerClaims.id, input.claimId))
      .returning();
    return row ?? null;
  },

  async rejectClaim(input: ReviewClaimInput) {
    const now = new Date();
    const [row] = await db.update(playerClaims)
      .set({
        claimStatus: "rejected",
        reviewedBy: input.reviewedByUserId,
        reviewedAt: now,
        rejectedAt: now,
        rejectionReason: input.rejectionReason ?? null,
      })
      .where(eq(playerClaims.id, input.claimId))
      .returning();
    return row ?? null;
  },

  async revokeClaim(input: RevokeClaimInput) {
    const [row] = await db.update(playerClaims)
      .set({ claimStatus: "revoked", revokedAt: new Date() })
      .where(eq(playerClaims.id, input.claimId))
      .returning();
    return row ?? null;
  },

  // ── Public Profiles ──────────────────────────────────────────────────────────

  async findProfileByAsset(assetId: number) {
    const [row] = await db.select().from(playerPublicProfiles)
      .where(eq(playerPublicProfiles.assetId, assetId)).limit(1);
    return row ?? null;
  },

  async findProfileByUser(userId: string) {
    const [row] = await db.select().from(playerPublicProfiles)
      .where(eq(playerPublicProfiles.claimedByUserId, userId)).limit(1);
    return row ?? null;
  },

  async createProfile(input: {
    assetId: number;
    claimedByUserId: string;
    claimId: number;
  }) {
    const [row] = await db.insert(playerPublicProfiles).values({
      assetId: input.assetId,
      claimedByUserId: input.claimedByUserId,
      claimId: input.claimId,
    }).returning();
    return row;
  },

  async updateProfile(input: UpdatePublicProfileInput) {
    const updateData: Record<string, any> = { lastUpdatedAt: new Date() };
    if (input.bio !== undefined) updateData.bio = input.bio;
    if (input.profileImageUrl !== undefined) updateData.profileImageUrl = input.profileImageUrl;
    if (input.bannerUrl !== undefined) updateData.bannerUrl = input.bannerUrl;
    if (input.headline !== undefined) updateData.headline = input.headline;
    if (input.socialLinks !== undefined) updateData.socialLinksJson = JSON.stringify(input.socialLinks);
    if (input.teamAffiliation !== undefined) updateData.teamAffiliation = input.teamAffiliation;
    if (input.isVisible !== undefined) updateData.isVisible = input.isVisible;

    const [row] = await db.update(playerPublicProfiles)
      .set(updateData)
      .where(eq(playerPublicProfiles.claimId, input.claimId))
      .returning();
    return row ?? null;
  },
};

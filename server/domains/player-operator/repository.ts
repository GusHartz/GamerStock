// ─── Player Operator Domain — Repository ─────────────────────────────────────
import { eq, and, desc, asc } from "drizzle-orm";
import { db } from "../../db";
import {
  playerOperatorAccess,
  playerOperatorSnapshots,
  playerMissions,
  playerRecommendedActions,
  playerActivityEvents,
  playerCardVisuals,
  playerMoments,
  mediaAssets,
} from "@shared/schema";
import type { PlayerCardVisual } from "@shared/schema";
import type {
  CreateMissionInput,
  UpdateMissionInput,
  UpdateCardVisualInput,
  CreateMomentInput,
  UpdateMomentInput,
  RelaunchMomentInput,
} from "./types";

export const playerOperatorRepository = {
  // ── Access ──────────────────────────────────────────────────────────────────

  async findAccess(assetId: number, userId: string) {
    const [row] = await db
      .select()
      .from(playerOperatorAccess)
      .where(and(eq(playerOperatorAccess.assetId, assetId), eq(playerOperatorAccess.userId, userId)))
      .limit(1);
    return row ?? null;
  },

  async upsertAccess(assetId: number, userId: string, claimId: number) {
    const existing = await this.findAccess(assetId, userId);
    if (existing) return existing;
    const [row] = await db
      .insert(playerOperatorAccess)
      .values({ assetId, userId, accessLevel: "owner", grantedByClaimId: claimId })
      .returning();
    return row;
  },

  // ── Snapshot ────────────────────────────────────────────────────────────────

  async findSnapshot(assetId: number) {
    const [row] = await db
      .select()
      .from(playerOperatorSnapshots)
      .where(eq(playerOperatorSnapshots.assetId, assetId))
      .limit(1);
    return row ?? null;
  },

  async upsertSnapshot(assetId: number, data: Partial<typeof playerOperatorSnapshots.$inferInsert>) {
    const existing = await this.findSnapshot(assetId);
    if (existing) {
      const [row] = await db
        .update(playerOperatorSnapshots)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(playerOperatorSnapshots.assetId, assetId))
        .returning();
      return row;
    }
    const [row] = await db
      .insert(playerOperatorSnapshots)
      .values({ assetId, ...data })
      .returning();
    return row;
  },

  // ── Missions ────────────────────────────────────────────────────────────────

  async findMission(id: number) {
    const [row] = await db.select().from(playerMissions).where(eq(playerMissions.id, id)).limit(1);
    return row ?? null;
  },

  async findActiveMissionForAsset(assetId: number) {
    const [row] = await db
      .select()
      .from(playerMissions)
      .where(and(eq(playerMissions.assetId, assetId), eq(playerMissions.status, "active")))
      .orderBy(desc(playerMissions.createdAt))
      .limit(1);
    return row ?? null;
  },

  async listMissionsForAsset(assetId: number) {
    return db
      .select()
      .from(playerMissions)
      .where(eq(playerMissions.assetId, assetId))
      .orderBy(desc(playerMissions.createdAt));
  },

  async createMission(input: CreateMissionInput) {
    const [row] = await db
      .insert(playerMissions)
      .values({
        assetId: input.assetId,
        type: input.type,
        title: input.title,
        description: input.description ?? null,
        goalValue: String(input.goalValue),
        currentValue: "0",
        progressPercentage: "0",
        status: "active",
        createdByUserId: input.createdByUserId,
        endDate: input.endDate ? new Date(input.endDate) : null,
      })
      .returning();
    return row;
  },

  async updateMission(input: UpdateMissionInput) {
    const updates: Partial<typeof playerMissions.$inferInsert> = { updatedAt: new Date() };
    if (input.status !== undefined) updates.status = input.status;
    if (input.title !== undefined) updates.title = input.title;
    if (input.description !== undefined) updates.description = input.description;
    if (input.goalValue !== undefined) updates.goalValue = String(input.goalValue);
    if (input.endDate !== undefined) updates.endDate = new Date(input.endDate);
    const [row] = await db
      .update(playerMissions)
      .set(updates)
      .where(and(eq(playerMissions.id, input.missionId), eq(playerMissions.assetId, input.assetId)))
      .returning();
    return row ?? null;
  },

  // ── Recommended Actions ─────────────────────────────────────────────────────

  async listPendingActions(assetId: number) {
    return db
      .select()
      .from(playerRecommendedActions)
      .where(and(eq(playerRecommendedActions.assetId, assetId), eq(playerRecommendedActions.status, "pending")))
      .orderBy(asc(playerRecommendedActions.createdAt));
  },

  async findAction(id: number) {
    const [row] = await db
      .select()
      .from(playerRecommendedActions)
      .where(eq(playerRecommendedActions.id, id))
      .limit(1);
    return row ?? null;
  },

  async triggerAction(id: number) {
    const [row] = await db
      .update(playerRecommendedActions)
      .set({ status: "triggered", triggeredAt: new Date(), updatedAt: new Date() })
      .where(eq(playerRecommendedActions.id, id))
      .returning();
    return row ?? null;
  },

  // ── Activity Events ─────────────────────────────────────────────────────────

  async listRecentActivity(assetId: number, limit = 10) {
    return db
      .select()
      .from(playerActivityEvents)
      .where(eq(playerActivityEvents.assetId, assetId))
      .orderBy(desc(playerActivityEvents.createdAt))
      .limit(limit);
  },

  // ── Card Visuals ────────────────────────────────────────────────────────────

  async findLatestCardVisual(assetId: number) {
    const [row] = await db
      .select()
      .from(playerCardVisuals)
      .where(eq(playerCardVisuals.assetId, assetId))
      .orderBy(desc(playerCardVisuals.createdAt))
      .limit(1);
    return row ?? null;
  },

  async findLatestCardVisualWithImageUrl(assetId: number): Promise<{ cardVisual: PlayerCardVisual; imageUrl: string | null } | null> {
    const row = await this.findLatestCardVisual(assetId);
    if (!row) return null;
    if (!row.mediaAssetId) return { cardVisual: row, imageUrl: null };
    const [mediaRow] = await db
      .select({ publicUrl: mediaAssets.publicUrl })
      .from(mediaAssets)
      .where(eq(mediaAssets.id, row.mediaAssetId))
      .limit(1);
    return { cardVisual: row, imageUrl: mediaRow?.publicUrl ?? null };
  },

  async setCardVisualMediaAsset(assetId: number, mediaAssetId: number, userId: string): Promise<PlayerCardVisual> {
    const existing = await this.findLatestCardVisual(assetId);
    const now = new Date();
    if (existing) {
      const [row] = await db
        .update(playerCardVisuals)
        .set({ mediaAssetId, updatedAt: now })
        .where(eq(playerCardVisuals.id, existing.id))
        .returning();
      return row;
    }
    const [row] = await db
      .insert(playerCardVisuals)
      .values({
        assetId,
        mediaAssetId,
        templateId: "default-gold",
        overlayConfigJson: {},
        cropConfigJson: {},
        status: "editing",
        createdByUserId: userId,
      })
      .returning();
    return row;
  },

  async upsertCardVisual(input: UpdateCardVisualInput) {
    const existing = await this.findLatestCardVisual(input.assetId);
    const now = new Date();
    if (existing) {
      const updates: Partial<typeof playerCardVisuals.$inferInsert> = { updatedAt: now };
      if (input.templateId) updates.templateId = input.templateId;
      if (input.overlayConfig) updates.overlayConfigJson = input.overlayConfig;
      if (input.cropConfig) updates.cropConfigJson = input.cropConfig;
      if (input.status) {
        updates.status = input.status;
        if (input.status === "published") updates.publishedAt = now;
      }
      const [row] = await db
        .update(playerCardVisuals)
        .set(updates)
        .where(eq(playerCardVisuals.id, existing.id))
        .returning();
      return row;
    }
    const [row] = await db
      .insert(playerCardVisuals)
      .values({
        assetId: input.assetId,
        templateId: input.templateId ?? "default-gold",
        overlayConfigJson: input.overlayConfig ?? {},
        cropConfigJson: input.cropConfig ?? {},
        status: input.status ?? "editing",
        createdByUserId: input.createdByUserId,
      })
      .returning();
    return row;
  },

  // ── Moments ─────────────────────────────────────────────────────────────────

  async listMoments(assetId: number) {
    return db
      .select()
      .from(playerMoments)
      .where(eq(playerMoments.assetId, assetId))
      .orderBy(desc(playerMoments.createdAt));
  },

  async findMoment(id: number) {
    const [row] = await db.select().from(playerMoments).where(eq(playerMoments.id, id)).limit(1);
    return row ?? null;
  },

  async findActiveMomentsForAsset(assetId: number) {
    return db
      .select()
      .from(playerMoments)
      .where(and(eq(playerMoments.assetId, assetId), eq(playerMoments.status, "active")));
  },

  async findDraftMomentsForAsset(assetId: number) {
    return db
      .select()
      .from(playerMoments)
      .where(and(eq(playerMoments.assetId, assetId), eq(playerMoments.status, "draft")));
  },

  async findSoldOutMomentsForAsset(assetId: number) {
    return db
      .select()
      .from(playerMoments)
      .where(and(eq(playerMoments.assetId, assetId), eq(playerMoments.status, "sold_out")));
  },

  async createMoment(input: CreateMomentInput) {
    const [row] = await db
      .insert(playerMoments)
      .values({
        assetId: input.assetId,
        title: input.title,
        rarity: input.rarity,
        price: String(input.price),
        supplyTotal: input.supplyTotal,
        supplySold: 0,
        soldPercentage: "0",
        revenueGenerated: "0",
        salesVelocity: "0",
        status: input.status ?? "draft",
        createdByUserId: input.createdByUserId,
      })
      .returning();
    return row;
  },

  async updateMoment(input: UpdateMomentInput) {
    const updates: Partial<typeof playerMoments.$inferInsert> = { updatedAt: new Date() };
    if (input.title !== undefined) updates.title = input.title;
    if (input.rarity !== undefined) updates.rarity = input.rarity;
    if (input.price !== undefined) updates.price = String(input.price);
    if (input.supplyTotal !== undefined) updates.supplyTotal = input.supplyTotal;
    if (input.status !== undefined) updates.status = input.status;
    const [row] = await db
      .update(playerMoments)
      .set(updates)
      .where(and(eq(playerMoments.id, input.momentId), eq(playerMoments.assetId, input.assetId)))
      .returning();
    return row ?? null;
  },

  async relaunchMoment(input: RelaunchMomentInput) {
    const [row] = await db
      .update(playerMoments)
      .set({
        price: String(input.price),
        supplyTotal: input.supplyTotal,
        supplySold: 0,
        soldPercentage: "0",
        revenueGenerated: "0",
        salesVelocity: "0",
        status: "active",
        updatedAt: new Date(),
      })
      .where(and(eq(playerMoments.id, input.momentId), eq(playerMoments.assetId, input.assetId)))
      .returning();
    return row ?? null;
  },

  // ── Activity Events (write) ──────────────────────────────────────────────────

  async insertActivityEvent(data: {
    assetId: number;
    type: string;
    actorUserId?: string;
    actorDisplayMasked?: string;
    valueNumeric?: number;
    metadataJson?: Record<string, unknown>;
  }) {
    const [row] = await db
      .insert(playerActivityEvents)
      .values({
        assetId: data.assetId,
        type: data.type as any,
        actorUserId: data.actorUserId,
        actorDisplayMasked: data.actorDisplayMasked,
        valueNumeric: data.valueNumeric !== undefined ? String(data.valueNumeric) : null,
        metadataJson: data.metadataJson ?? {},
      })
      .returning();
    return row;
  },
};

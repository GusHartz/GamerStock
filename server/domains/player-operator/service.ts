// ─── Player Operator Domain — Service ────────────────────────────────────────
// Business logic for the player operator (creator economy) domain.
// Real data is used wherever available; sensible mock values fill the gaps
// for KPIs not yet computed by background jobs.
// ─────────────────────────────────────────────────────────────────────────────
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { assets, playerClaims } from "@shared/schema";
import { playerOperatorRepository } from "./repository";
import * as mediaService from "../media/service";
import { evaluateActionCenterRules } from "./rules";
import {
  serializeSnapshot,
  serializeMission,
  serializeCardVisual,
  serializeActivityEvent,
  serializeMoment,
  mockSnapshot,
} from "./serializers";
import type {
  OverviewResponse,
  OperatorPlayerInfo,
  CreateMissionInput,
  UpdateMissionInput,
  UpdateCardVisualInput,
  TriggerActionInput,
  CreateMomentInput,
  UpdateMomentInput,
  RelaunchMomentInput,
} from "./types";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchAsset(assetId: number) {
  const [row] = await db.select().from(assets).where(eq(assets.id, assetId)).limit(1);
  return row ?? null;
}

function deriveTrendStatus(
  volumeDelta: number,
  earningsDelta: number,
): "trending" | "stable" | "declining" {
  if (volumeDelta > 5 || earningsDelta > 5) return "trending";
  if (volumeDelta < -5 || earningsDelta < -5) return "declining";
  return "stable";
}

// ── Service ───────────────────────────────────────────────────────────────────

export const playerOperatorService = {

  // ── Overview — combines all operator data into a single response ─────────
  async getOverview(assetId: number, userId: string): Promise<OverviewResponse> {
    const asset = await fetchAsset(assetId);
    if (!asset) throw Object.assign(new Error("Asset not found"), { statusCode: 404 });

    const [snapshotRow, activeMission, cardVisualResult, recentActivity, activeMoments, draftMoments, soldOutMoments] =
      await Promise.all([
        playerOperatorRepository.findSnapshot(assetId),
        playerOperatorRepository.findActiveMissionForAsset(assetId),
        playerOperatorRepository.findLatestCardVisualWithImageUrl(assetId),
        playerOperatorRepository.listRecentActivity(assetId, 5),
        playerOperatorRepository.findActiveMomentsForAsset(assetId),
        playerOperatorRepository.findDraftMomentsForAsset(assetId),
        playerOperatorRepository.findSoldOutMomentsForAsset(assetId),
      ]);

    const snapshot = snapshotRow ? serializeSnapshot(snapshotRow) : mockSnapshot();
    const status = deriveTrendStatus(snapshot.volumeDelta, snapshot.earningsDelta);

    const player: OperatorPlayerInfo = {
      assetId,
      playerName: asset.displayName,
      avatarUrl: null,
      bannerImageUrl: null,
      status,
      viewMode: "operator",
      isOwner: true,
    };

    const actionCenter = evaluateActionCenterRules({ snapshot, activeMission, activeMoments, draftMoments, soldOutMoments });

    return {
      player,
      snapshot,
      actionCenter,
      mission: activeMission ? serializeMission(activeMission) : null,
      cardVisual: cardVisualResult ? serializeCardVisual(cardVisualResult.cardVisual, cardVisualResult.imageUrl) : null,
      activityPreview: recentActivity.map(serializeActivityEvent),
    };
  },

  // ── Performance Snapshot ─────────────────────────────────────────────────
  async getPerformanceSnapshot(assetId: number) {
    const asset = await fetchAsset(assetId);
    if (!asset) throw Object.assign(new Error("Asset not found"), { statusCode: 404 });
    const row = await playerOperatorRepository.findSnapshot(assetId);
    return row ? serializeSnapshot(row) : mockSnapshot();
  },

  // ── Action Center ────────────────────────────────────────────────────────
  async getActionCenter(assetId: number) {
    const [snapshotRow, activeMission, activeMoments, draftMoments, soldOutMoments] = await Promise.all([
      playerOperatorRepository.findSnapshot(assetId),
      playerOperatorRepository.findActiveMissionForAsset(assetId),
      playerOperatorRepository.findActiveMomentsForAsset(assetId),
      playerOperatorRepository.findDraftMomentsForAsset(assetId),
      playerOperatorRepository.findSoldOutMomentsForAsset(assetId),
    ]);
    const snapshot = snapshotRow ? serializeSnapshot(snapshotRow) : mockSnapshot();
    return evaluateActionCenterRules({ snapshot, activeMission, activeMoments, draftMoments, soldOutMoments });
  },

  // ── Missions ─────────────────────────────────────────────────────────────
  async getMission(assetId: number) {
    const mission = await playerOperatorRepository.findActiveMissionForAsset(assetId);
    return mission ? serializeMission(mission) : null;
  },

  async createMission(input: CreateMissionInput) {
    const asset = await fetchAsset(input.assetId);
    if (!asset) throw Object.assign(new Error("Asset not found"), { statusCode: 404 });

    // Guard: enforce max 1 active mission per asset
    const existingActive = await playerOperatorRepository.findActiveMissionForAsset(input.assetId);
    if (existingActive) {
      throw Object.assign(
        new Error("This asset already has an active mission. Complete or close it before creating a new one."),
        { statusCode: 409 },
      );
    }

    const row = await playerOperatorRepository.createMission(input);
    return serializeMission(row);
  },

  async updateMission(input: UpdateMissionInput) {
    const row = await playerOperatorRepository.updateMission(input);
    if (!row) throw Object.assign(new Error("Mission not found"), { statusCode: 404 });
    return serializeMission(row);
  },

  // ── Live Activity ────────────────────────────────────────────────────────
  async getLiveActivity(assetId: number) {
    const events = await playerOperatorRepository.listRecentActivity(assetId, 20);
    return events.map(serializeActivityEvent);
  },

  // ── Card Visual ──────────────────────────────────────────────────────────
  async getCardVisual(assetId: number) {
    const result = await playerOperatorRepository.findLatestCardVisualWithImageUrl(assetId);
    if (!result) return null;
    return serializeCardVisual(result.cardVisual, result.imageUrl);
  },

  async updateCardVisual(input: UpdateCardVisualInput) {
    const row = await playerOperatorRepository.upsertCardVisual(input);
    const result = await playerOperatorRepository.findLatestCardVisualWithImageUrl(input.assetId);
    return serializeCardVisual(row, result?.imageUrl ?? null);
  },

  async uploadCardImage(
    assetId: number,
    userId: string,
    buffer: Buffer,
    originalName: string,
    mimeType: string,
    fileSize: number,
  ) {
    const asset = await fetchAsset(assetId);
    if (!asset) throw Object.assign(new Error("Asset not found"), { statusCode: 404 });
    const mediaAsset = await mediaService.saveUploadedFile({ buffer, originalName, mimeType, fileSize, createdBy: userId });
    const cardVisualRow = await playerOperatorRepository.setCardVisualMediaAsset(assetId, mediaAsset.id, userId);
    return {
      imageUrl: mediaAsset.publicUrl,
      cardVisual: serializeCardVisual(cardVisualRow, mediaAsset.publicUrl),
    };
  },

  // ── Trigger Action ───────────────────────────────────────────────────────
  async triggerAction(input: TriggerActionInput) {
    const action = await playerOperatorRepository.findAction(input.actionId);
    if (!action) throw Object.assign(new Error("Action not found"), { statusCode: 404 });
    if (action.assetId !== input.assetId) {
      throw Object.assign(new Error("Action does not belong to this asset"), { statusCode: 403 });
    }
    const row = await playerOperatorRepository.triggerAction(input.actionId);
    return { success: true, action: row };
  },

  // ── Moments ──────────────────────────────────────────────────────────────

  async listMoments(assetId: number) {
    const asset = await fetchAsset(assetId);
    if (!asset) throw Object.assign(new Error("Asset not found"), { statusCode: 404 });
    const rows = await playerOperatorRepository.listMoments(assetId);
    return rows.map(serializeMoment);
  },

  async createMoment(input: CreateMomentInput) {
    const asset = await fetchAsset(input.assetId);
    if (!asset) throw Object.assign(new Error("Asset not found"), { statusCode: 404 });
    const row = await playerOperatorRepository.createMoment(input);
    // Emit activity event for moment creation
    await playerOperatorRepository.insertActivityEvent({
      assetId: input.assetId,
      type: "moment_created",
      actorUserId: input.createdByUserId,
      actorDisplayMasked: "Operator",
      metadataJson: { momentId: row.id, title: row.title, rarity: row.rarity },
    });
    return serializeMoment(row);
  },

  async updateMoment(input: UpdateMomentInput) {
    const existing = await playerOperatorRepository.findMoment(input.momentId);
    if (!existing) throw Object.assign(new Error("Moment not found"), { statusCode: 404 });
    if (existing.assetId !== input.assetId) {
      throw Object.assign(new Error("Moment does not belong to this asset"), { statusCode: 403 });
    }
    const row = await playerOperatorRepository.updateMoment(input);
    if (!row) throw Object.assign(new Error("Moment not found"), { statusCode: 404 });
    // Emit activity event when activated
    if (input.status === "active" && existing.status !== "active") {
      await playerOperatorRepository.insertActivityEvent({
        assetId: input.assetId,
        type: "moment_activated",
        actorDisplayMasked: "Operator",
        metadataJson: { momentId: row.id, title: row.title },
      });
    }
    return serializeMoment(row);
  },

  async relaunchMoment(input: RelaunchMomentInput) {
    const existing = await playerOperatorRepository.findMoment(input.momentId);
    if (!existing) throw Object.assign(new Error("Moment not found"), { statusCode: 404 });
    if (existing.assetId !== input.assetId) {
      throw Object.assign(new Error("Moment does not belong to this asset"), { statusCode: 403 });
    }
    // Relaunch is same-record update: reset supply/sold/revenue, set active
    const row = await playerOperatorRepository.relaunchMoment(input);
    if (!row) throw Object.assign(new Error("Moment not found"), { statusCode: 404 });
    await playerOperatorRepository.insertActivityEvent({
      assetId: input.assetId,
      type: "moment_relaunched",
      actorDisplayMasked: "Operator",
      valueNumeric: input.price,
      metadataJson: { momentId: row.id, title: row.title, newSupply: input.supplyTotal },
    });
    return serializeMoment(row);
  },

  // ── Access provisioning (called after claim approval) ────────────────────
  async ensureAccess(assetId: number, userId: string, claimId: number) {
    return playerOperatorRepository.upsertAccess(assetId, userId, claimId);
  },

  // ── Verify that this userId is the approved claim owner for assetId ──────
  async verifyOperatorAccess(assetId: number, userId: string): Promise<boolean> {
    // Check the operator_access table first (fast path)
    const access = await playerOperatorRepository.findAccess(assetId, userId);
    if (access) return true;

    // Fallback: check approved claim in player_claims
    const [claim] = await db
      .select()
      .from(playerClaims)
      .where(eq(playerClaims.assetId, assetId))
      .limit(10);

    // Find any approved claim for this userId
    if (!claim) return false;
    const claims = await db
      .select()
      .from(playerClaims)
      .where(eq(playerClaims.assetId, assetId));

    return claims.some((c) => c.userId === userId && c.claimStatus === "approved");
  },
};

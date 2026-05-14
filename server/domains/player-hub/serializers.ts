// ─── Player Hub Domain — Serializers ─────────────────────────────────────────
import type { PlayerClaim, PlayerAssetRequest } from "@shared/schema";
import type { HubAssetView, HubAssetRequestView } from "./types";

// ── Game display names ────────────────────────────────────────────────────────
const GAME_NAMES: Record<string, string> = {
  lol:      "League of Legends",
  dota2:    "Dota 2",
  cs2:      "CS2",
  valorant: "Valorant",
  r6:       "Rainbow Six",
};

export function gameDisplayName(gameId: string): string {
  return GAME_NAMES[gameId] ?? gameId;
}

// ── Asset status derived from price momentum ──────────────────────────────────
export function deriveAssetStatus(momentum: string | null): "trending" | "stable" | "declining" {
  const m = Number(momentum ?? "0");
  if (m > 0.2) return "trending";
  if (m < -0.2) return "declining";
  return "stable";
}

// ── Claim-enriched asset view ─────────────────────────────────────────────────
export function serializeHubAsset(
  assetRow: {
    id: number;
    assetUid: string;
    displayName: string;
    lastTradePrice: string;
    momentum: string | null;
    game: string;
  },
  claim: PlayerClaim | null,
): HubAssetView {
  const claimStatus = claim?.claimStatus ?? null;
  const claimId = claim?.id ?? null;
  const operatorReady = claimStatus === "approved";
  const canOpenOperator = operatorReady;
  const canClaim = !claim || claimStatus === "rejected" || claimStatus === "revoked";

  return {
    assetId: assetRow.id,
    assetUid: assetRow.assetUid,
    gameId: assetRow.game,
    gameName: gameDisplayName(assetRow.game),
    cardName: assetRow.displayName,
    imageUrl: null,
    lastTradePrice: Number(assetRow.lastTradePrice),
    status: deriveAssetStatus(assetRow.momentum),
    claimStatus,
    claimId,
    operatorReady,
    canClaim,
    canOpenOperator,
  };
}

// ── Asset request view ────────────────────────────────────────────────────────
export function serializeAssetRequest(row: PlayerAssetRequest): HubAssetRequestView {
  return {
    id: row.id,
    gameId: row.gameId,
    gameName: gameDisplayName(row.gameId),
    platform: row.platform,
    externalUsername: row.externalUsername ?? null,
    externalAccountRef: row.externalAccountRef ?? null,
    requestedAssetType: row.requestedAssetType,
    notes: row.notes ?? null,
    status: row.status,
    reviewNotes: row.reviewNotes ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
  };
}

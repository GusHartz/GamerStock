// ─── Player Hub Domain — Types ────────────────────────────────────────────────
import type { AssetRequestStatus } from "@shared/schema";

// ── Request payloads ─────────────────────────────────────────────────────────

export interface CreateAssetRequestInput {
  requestedByUserId: string;
  playerId?: number;
  gameId: string;
  platform: string;
  externalAccountRef?: string;
  externalUsername?: string;
  externalProfileUrl?: string;
  requestedAssetType?: string;
  notes?: string;
}

// ── Response shapes ───────────────────────────────────────────────────────────

export interface HubClaimSummary {
  approved: number;
  pending: number;
  rejected: number;
}

export interface HubPlayerInfo {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  bannerImageUrl: string | null;
  claimSummary: HubClaimSummary;
}

export interface HubSummary {
  totalAssets: number;
  operatorReadyAssets: number;
  pendingClaims: number;
  pendingRequests: number;
}

export interface HubAssetView {
  assetId: number;
  assetUid: string;
  gameId: string;
  gameName: string;
  cardName: string;
  imageUrl: string | null;
  lastTradePrice: number;
  status: "trending" | "stable" | "declining";
  claimStatus: string | null;
  claimId: number | null;
  operatorReady: boolean;
  canClaim: boolean;
  canOpenOperator: boolean;
}

export interface HubAssetRequestView {
  id: number;
  gameId: string;
  gameName: string;
  platform: string;
  externalUsername: string | null;
  externalAccountRef: string | null;
  requestedAssetType: string;
  notes: string | null;
  status: AssetRequestStatus;
  reviewNotes: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface HubOverviewResponse {
  player: HubPlayerInfo;
  summary: HubSummary;
  assetsPreview: HubAssetView[];
  requestsPreview: HubAssetRequestView[];
}

export interface HubAssetsResponse {
  assets: HubAssetView[];
}

export interface HubAssetRequestsResponse {
  requests: HubAssetRequestView[];
  total: number;
}

// ── Discovered Assets (Steam auto-discovery) ─────────────────────────────────

export type DiscoveredAssetStatus =
  | "available"       // Can be added to terminal (no open claim, not owned)
  | "claim_pending"   // Claim already submitted, awaiting review
  | "already_added"   // User already owns this asset (approved claim)
  | "unavailable";    // Steam not verified or policy blocks claim

export interface HubDiscoveredAssetView {
  /** null for virtual candidates — no internal asset yet for this game. */
  assetId:             number | null;
  assetUid:            string | null;
  provider:            "steam";
  gameId:              string;
  gameName:            string;
  displayName:         string | null;
  providerAccountName: string | null;
  status:              DiscoveredAssetStatus;
  canAdd:              boolean;
  linkedAssetId:       number | null;
  verificationStatus:  string;
  matchConfidence:     string;
}

export interface HubDiscoveredAssetsResponse {
  discoveredAssets: HubDiscoveredAssetView[];
  hasSteamAccount:  boolean;
  steamAccountName: string | null;
}

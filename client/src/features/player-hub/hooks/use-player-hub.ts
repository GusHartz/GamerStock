import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

// ── Types ─────────────────────────────────────────────────────────────────────

export type DiscoveredAssetStatus =
  | "available"
  | "claim_pending"
  | "already_added"
  | "unavailable";

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
  status: "pending" | "under_review" | "approved" | "rejected" | "ingested";
  reviewNotes: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface HubOverview {
  player: {
    userId: string;
    displayName: string;
    avatarUrl: string | null;
    bannerImageUrl: string | null;
    claimSummary: { approved: number; pending: number; rejected: number };
  };
  summary: {
    totalAssets: number;
    operatorReadyAssets: number;
    pendingClaims: number;
    pendingRequests: number;
  };
  assetsPreview: HubAssetView[];
  requestsPreview: HubAssetRequestView[];
}

export interface AssetRequestInput {
  gameId: string;
  platform: string;
  externalAccountRef?: string;
  externalUsername?: string;
  externalProfileUrl?: string;
  requestedAssetType?: string;
  notes?: string;
}

// ── Queries ───────────────────────────────────────────────────────────────────

export function useHubOverview() {
  return useQuery<HubOverview>({
    queryKey: ["/api/player-hub/overview"],
    queryFn: async () => {
      const res = await fetch("/api/player-hub/overview", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load hub overview");
      return res.json();
    },
    staleTime: 30_000,
    retry: false,
  });
}

export function useHubAssets() {
  return useQuery<{ assets: HubAssetView[] }>({
    queryKey: ["/api/player-hub/assets"],
    queryFn: async () => {
      const res = await fetch("/api/player-hub/assets", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load assets");
      return res.json();
    },
    staleTime: 30_000,
    retry: false,
  });
}

export function useHubAssetRequests() {
  return useQuery<{ requests: HubAssetRequestView[]; total: number }>({
    queryKey: ["/api/player-hub/asset-requests"],
    queryFn: async () => {
      const res = await fetch("/api/player-hub/asset-requests", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load asset requests");
      return res.json();
    },
    staleTime: 30_000,
    retry: false,
  });
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export function useSubmitAssetRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AssetRequestInput) => {
      const res = await apiRequest("POST", "/api/player-hub/asset-requests", input);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/player-hub/asset-requests"] });
      qc.invalidateQueries({ queryKey: ["/api/player-hub/overview"] });
    },
  });
}

export function useClaimAssetFromHub(assetId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { assetUid: string; evidenceNote?: string }) => {
      const res = await apiRequest("POST", `/api/player-hub/assets/${assetId}/claim`, input);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/player-hub/assets"] });
      qc.invalidateQueries({ queryKey: ["/api/player-hub/overview"] });
      qc.invalidateQueries({ queryKey: ["/api/player-claims/me"] });
    },
  });
}

export function useDiscoveredAssets() {
  return useQuery<HubDiscoveredAssetsResponse>({
    queryKey: ["/api/player-hub/discovered-assets"],
    queryFn: async () => {
      const res = await fetch("/api/player-hub/discovered-assets", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load discovered assets");
      return res.json();
    },
    staleTime: 60_000,
    retry: false,
  });
}

export function useAddToTerminal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { assetId: number; assetUid: string }) => {
      const res = await apiRequest(
        "POST",
        `/api/player-hub/discovered-assets/${input.assetId}/add-to-terminal`,
        { assetUid: input.assetUid },
      );
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/player-hub/discovered-assets"] });
      qc.invalidateQueries({ queryKey: ["/api/player-hub/assets"] });
      qc.invalidateQueries({ queryKey: ["/api/player-hub/overview"] });
    },
  });
}

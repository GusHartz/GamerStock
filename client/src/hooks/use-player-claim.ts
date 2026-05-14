import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export type ClaimStatus = "pending" | "approved" | "rejected" | "revoked";

export type PlayerClaim = {
  id: number;
  userId: string;
  assetId: number;
  assetUid: string;
  puuid: string | null;
  claimStatus: ClaimStatus;
  verificationMethod: string;
  evidenceNote: string | null;
  requestedAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  revokedAt: string | null;
};

export type PlayerPublicProfile = {
  id: number;
  assetId: number;
  claimedByUserId: string;
  claimId: number;
  bio: string | null;
  profileImageUrl: string | null;
  bannerUrl: string | null;
  headline: string | null;
  socialLinksJson: string;
  socialLinks: Array<{ platform: string; url: string }>;
  teamAffiliation: string | null;
  isVisible: boolean;
  createdAt: string;
  lastUpdatedAt: string;
};

export type PlayerAssetResult = {
  id: number;
  assetUid: string;
  displayName: string;
  symbol: string;
  entityType: string;
  lastTradePrice: string;
};

export function usePlayerClaims() {
  return useQuery<{ claims: PlayerClaim[] }>({
    queryKey: ["/api/player-claims/me"],
    queryFn: async () => {
      const res = await fetch("/api/player-claims/me", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch claims");
      return res.json();
    },
    retry: false,
    staleTime: 30_000,
  });
}

export function usePlayerProfile() {
  return useQuery<{ profile: PlayerPublicProfile }>({
    queryKey: ["/api/player-claims/me/profile"],
    queryFn: async () => {
      const res = await fetch("/api/player-claims/me/profile", { credentials: "include" });
      if (res.status === 404) return { profile: null as any };
      if (!res.ok) throw new Error("Failed to fetch profile");
      return res.json();
    },
    retry: false,
    staleTime: 30_000,
  });
}

export function usePlayerAssetSearch(query: string) {
  return useQuery<{ results: PlayerAssetResult[] }>({
    queryKey: ["/api/player-claims/search-players", query],
    queryFn: async () => {
      if (query.length < 2) return { results: [] };
      const res = await fetch(`/api/player-claims/search-players?q=${encodeURIComponent(query)}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Search failed");
      return res.json();
    },
    enabled: query.length >= 2,
    staleTime: 10_000,
  });
}

export function useSubmitClaim() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      assetId: number;
      assetUid: string;
      puuid?: string;
      evidenceNote?: string;
    }) => {
      const res = await apiRequest("POST", "/api/player-claims", input);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/player-claims/me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      claimId: number;
      bio?: string;
      profileImageUrl?: string;
      bannerUrl?: string;
      headline?: string;
      socialLinks?: Array<{ platform: string; url: string }>;
      teamAffiliation?: string;
      isVisible?: boolean;
    }) => {
      const { claimId, ...rest } = input;
      const res = await apiRequest("PATCH", `/api/player-claims/${claimId}/profile`, rest);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/player-claims/me/profile"] });
    },
  });
}

export function useActiveClaim(claims: PlayerClaim[] | undefined): PlayerClaim | null {
  if (!claims || claims.length === 0) return null;
  return (
    claims.find((c) => c.claimStatus === "approved") ??
    claims.find((c) => c.claimStatus === "pending") ??
    claims.find((c) => c.claimStatus === "rejected") ??
    claims[claims.length - 1] ??
    null
  );
}

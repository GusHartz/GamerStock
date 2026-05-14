// ─── Player Claim System — Domain Types ───────────────────────────────────────
// Internal types for the player-claims domain.
// ─────────────────────────────────────────────────────────────────────────────
import type { ClaimStatus, VerificationMethod } from "@shared/schema";

// ── Request payloads ─────────────────────────────────────────────────────────

export interface CreateClaimInput {
  userId: string;
  assetId: number;
  assetUid: string;
  puuid?: string;
  evidenceNote?: string;
  verificationMethod?: VerificationMethod;
}

export interface ReviewClaimInput {
  claimId: number;
  reviewedByUserId: string;
  status: "approved" | "rejected";
  rejectionReason?: string;
}

export interface RevokeClaimInput {
  claimId: number;
  revokedByUserId: string;
}

// ── Profile update (only approved claimant can do this) ─────────────────────
export interface UpdatePublicProfileInput {
  claimId: number;
  userId: string;
  bio?: string;
  profileImageUrl?: string;
  bannerUrl?: string;
  headline?: string;
  socialLinks?: Array<{ platform: string; url: string }>;
  teamAffiliation?: string;
  isVisible?: boolean;
}

// ── Service result shapes ────────────────────────────────────────────────────
export interface ClaimResult {
  success: boolean;
  claimId?: number;
  error?: string;
}

export interface ActiveClaim {
  claimId: number;
  assetId: number;
  assetUid: string;
  claimStatus: ClaimStatus;
}

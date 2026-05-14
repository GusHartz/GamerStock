// ─── Player Claim System — Service ────────────────────────────────────────────
// Business logic for claim lifecycle.
// Rules enforced here:
//   - A user can only have one pending claim at a time per asset
//   - An asset can only have one approved claim at a time
//   - Profile creation happens automatically upon claim approval
//   - Profile deletion does NOT happen on revoke (audit trail preserved)
// ─────────────────────────────────────────────────────────────────────────────
import { playerClaimsRepository } from "./repository";
import type {
  CreateClaimInput,
  ReviewClaimInput,
  RevokeClaimInput,
  UpdatePublicProfileInput,
  ClaimResult,
} from "./types";

export const playerClaimsService = {
  async requestClaim(input: CreateClaimInput): Promise<ClaimResult> {
    // Guard: asset must not already be claimed by someone else
    const existingApproved = await playerClaimsRepository.findApprovedClaimForAsset(input.assetId);
    if (existingApproved) {
      if (existingApproved.userId === input.userId) {
        return { success: false, error: "You already have an approved claim for this player." };
      }
      return { success: false, error: "This player profile has already been claimed by another user." };
    }

    // Guard: user must not have a pending claim for this same asset
    const existingPending = await playerClaimsRepository.findPendingClaimForAsset(input.assetId);
    if (existingPending && existingPending.userId === input.userId) {
      return { success: false, error: "You already have a pending claim for this player." };
    }

    const claim = await playerClaimsRepository.createClaim(input);
    console.log(`[PlayerClaims] New claim #${claim.id} by userId=${input.userId} for assetUid=${input.assetUid}`);
    return { success: true, claimId: claim.id };
  },

  async reviewClaim(input: ReviewClaimInput): Promise<ClaimResult> {
    const claim = await playerClaimsRepository.findClaimById(input.claimId);
    if (!claim) return { success: false, error: "Claim not found." };
    if (claim.claimStatus !== "pending") {
      return { success: false, error: `Claim is already ${claim.claimStatus} and cannot be reviewed again.` };
    }

    if (input.status === "approved") {
      // Guard: ensure nobody else got approved for this asset in the meantime
      const existingApproved = await playerClaimsRepository.findApprovedClaimForAsset(claim.assetId);
      if (existingApproved) {
        return { success: false, error: "Another claim for this player was approved already." };
      }

      const approved = await playerClaimsRepository.approveClaim(input);
      if (!approved) return { success: false, error: "Failed to approve claim." };

      // Auto-create public profile on approval if not already present
      const existingProfile = await playerClaimsRepository.findProfileByAsset(claim.assetId);
      if (!existingProfile) {
        await playerClaimsRepository.createProfile({
          assetId: claim.assetId,
          claimedByUserId: claim.userId,
          claimId: claim.id,
        });
        console.log(`[PlayerClaims] Auto-created public profile for assetId=${claim.assetId} userId=${claim.userId}`);
      }

      console.log(`[PlayerClaims] Claim #${claim.id} APPROVED by adminId=${input.reviewedByUserId}`);
      return { success: true, claimId: claim.id };
    }

    // Reject
    const rejected = await playerClaimsRepository.rejectClaim(input);
    if (!rejected) return { success: false, error: "Failed to reject claim." };
    console.log(`[PlayerClaims] Claim #${claim.id} REJECTED by adminId=${input.reviewedByUserId}`);
    return { success: true, claimId: claim.id };
  },

  async revokeClaim(input: RevokeClaimInput): Promise<ClaimResult> {
    const claim = await playerClaimsRepository.findClaimById(input.claimId);
    if (!claim) return { success: false, error: "Claim not found." };
    if (claim.claimStatus !== "approved") {
      return { success: false, error: "Only approved claims can be revoked." };
    }

    await playerClaimsRepository.revokeClaim(input);
    console.log(`[PlayerClaims] Claim #${claim.id} REVOKED by adminId=${input.revokedByUserId}`);
    return { success: true, claimId: claim.id };
  },

  async updateProfile(input: UpdatePublicProfileInput): Promise<ClaimResult> {
    // Verify the claim belongs to this user and is approved
    const claim = await playerClaimsRepository.findClaimById(input.claimId);
    if (!claim) return { success: false, error: "Claim not found." };
    if (claim.userId !== input.userId) return { success: false, error: "Not authorized." };
    if (claim.claimStatus !== "approved") {
      return { success: false, error: "Your claim must be approved before editing your profile." };
    }

    const profile = await playerClaimsRepository.findProfileByUser(input.userId);
    if (!profile) return { success: false, error: "Profile not found." };

    await playerClaimsRepository.updateProfile(input);
    return { success: true, claimId: input.claimId };
  },
};

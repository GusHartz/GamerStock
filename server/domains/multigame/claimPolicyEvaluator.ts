/**
 * Claim Policy Evaluator — GamerStock Multigame
 *
 * Pure function: evaluateClaimPolicy(input) → EvaluateClaimPolicyResult
 *
 * Takes runtime signals about a claim candidate and applies the configured
 * GameClaimPolicy rules to produce a rich policy decision.
 *
 * No I/O, no DB calls. All state is passed in by the caller (discovery adapter or route handler).
 * This makes the evaluator easy to unit-test and deterministic.
 *
 * Decision tree:
 *   1. No policy configured for game              → BLOCKED (NO_POLICY_FOR_GAME)
 *   2. verificationStatus !== requiredStatus       → BLOCKED (VERIFICATION_REQUIRED)
 *   3. providerGroup mismatch                     → BLOCKED (WRONG_PROVIDER)
 *   4. All auto-approval criteria satisfied        → AUTO_APPROVABLE + AUTO_POLICY
 *   5. Verified but some criteria not met          → REQUIRES_REVIEW
 */

import {
  getGamePolicy,
  PolicyDecision,
  ApprovalType,
  MatchConfidenceLevel,
} from "./claimPolicyConfig";

// ── Input / Output types ──────────────────────────────────────────────────────

export interface EvaluateClaimPolicyInput {
  /** Game code: "dota2", "cs2", "lol", "valorant", ... */
  game: string;
  /**
   * verificationStatus from the ConnectedAccount.
   * Typically "VERIFIED" | "PENDING" | "NOT_VERIFIED" | "FAILED"
   */
  verificationStatus: string | null;
  /**
   * providerGroup from the ConnectedAccount.
   * Typically "steam" | "riot"
   * Used to detect provider mismatches (e.g. riot account for dota2 asset).
   */
  providerGroup: string | null;
  /**
   * Match confidence between the connected account and the asset.
   * "HIGH"   — determined by direct profile link (onboarding tx)
   * "MEDIUM" — indirect match
   * "LOW"    — speculative match
   * null     — confidence not yet computed
   */
  matchConfidence: string | null;
  /** Whether an ACTIVE ownership link already exists for the asset. */
  hasActiveOwner: boolean;
  /** Whether an open (PENDING or UNDER_REVIEW) claim already exists for this asset+user. */
  hasOpenClaim: boolean;
}

export interface EvaluateClaimPolicyResult {
  /** High-level decision for the claim candidate. */
  policyDecision: PolicyDecision;
  /**
   * Human-readable reasons for the decision.
   * Empty when policyDecision = AUTO_APPROVABLE.
   * Contains specific blocking/review reasons otherwise.
   */
  reasons: string[];
  /**
   * Suggested approvalType to store on the claim record.
   *   AUTO_POLICY     — suitable for automatic approval
   *   REQUIRES_REVIEW — needs admin review
   *   MANUAL_ADMIN    — blocked; requires manual intervention if ever reconsidered
   */
  approvalType: ApprovalType;
  /** Whether the claim can be auto-approved inline (no admin review needed). */
  canAutoApprove: boolean;
  /**
   * Whether the user can submit a new claim.
   * false when: not verified, has open claim, or provider mismatch.
   */
  canClaim: boolean;
}

// ── Evaluator ─────────────────────────────────────────────────────────────────

export function evaluateClaimPolicy(
  input: EvaluateClaimPolicyInput,
): EvaluateClaimPolicyResult {
  const policy = getGamePolicy(input.game);
  const reasons: string[] = [];

  // ── Step 1: No policy for this game ─────────────────────────────────────────
  if (!policy) {
    return {
      policyDecision: "BLOCKED",
      reasons:        ["NO_POLICY_FOR_GAME"],
      approvalType:   "MANUAL_ADMIN",
      canAutoApprove: false,
      canClaim:       false,
    };
  }

  // ── Step 2: Verification status ──────────────────────────────────────────────
  const isVerified = input.verificationStatus === policy.requiredVerificationStatus;
  if (!isVerified) {
    reasons.push(
      `VERIFICATION_REQUIRED:status=${policy.requiredVerificationStatus},got=${input.verificationStatus ?? "null"}`,
    );
  }

  // ── Step 3: Provider group check ─────────────────────────────────────────────
  const providerMismatch =
    input.providerGroup !== null &&
    input.providerGroup !== policy.providerGroup;
  if (providerMismatch) {
    reasons.push(
      `WRONG_PROVIDER:expected=${policy.providerGroup},got=${input.providerGroup}`,
    );
  }

  // ── BLOCKED if not verified or wrong provider ────────────────────────────────
  if (!isVerified || providerMismatch) {
    return {
      policyDecision: "BLOCKED",
      reasons,
      approvalType:   "MANUAL_ADMIN",
      canAutoApprove: false,
      canClaim:       false,
    };
  }

  // ── Step 4: canClaim ──────────────────────────────────────────────────────────
  // User can submit a new claim as long as there is no open claim for this asset.
  // (alreadyOwned is checked by the caller and passed via hasActiveOwner for the
  //  policy decision; canClaim itself only guards the submission button.)
  const canClaim = !input.hasOpenClaim;

  // ── Step 5: Auto-approval criteria ───────────────────────────────────────────
  const { autoApproval } = policy;
  const autoReasons: string[] = [];

  // 5a. Match confidence
  const confidenceOk =
    input.matchConfidence !== null &&
    autoApproval.allowedMatchConfidences.includes(
      input.matchConfidence as MatchConfidenceLevel,
    );
  if (!confidenceOk) {
    autoReasons.push(
      `CONFIDENCE_INSUFFICIENT:got=${input.matchConfidence ?? "null"},required=${autoApproval.allowedMatchConfidences.join("|")}`,
    );
  }

  // 5b. Active owner guard
  const noOwnerOk =
    !autoApproval.requireNoActiveOwner || !input.hasActiveOwner;
  if (!noOwnerOk) {
    autoReasons.push("HAS_ACTIVE_OWNER");
  }

  // 5c. Open claim guard
  const noOpenClaimOk =
    !autoApproval.requireNoOpenClaim || !input.hasOpenClaim;
  if (!noOpenClaimOk) {
    autoReasons.push("HAS_OPEN_CLAIM");
  }

  const canAutoApprove = confidenceOk && noOwnerOk && noOpenClaimOk;

  if (canAutoApprove) {
    return {
      policyDecision: "AUTO_APPROVABLE",
      reasons:        [],
      approvalType:   "AUTO_POLICY",
      canAutoApprove: true,
      canClaim,
    };
  }

  return {
    policyDecision: "REQUIRES_REVIEW",
    reasons:        autoReasons,
    approvalType:   "REQUIRES_REVIEW",
    canAutoApprove: false,
    canClaim,
  };
}

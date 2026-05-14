/**
 * Claim Policy Configuration — GamerStock Multigame
 *
 * Declares per-game claim policy rules as versioned code config.
 * No DB table needed at this stage: policy changes are intentional and go through code review.
 *
 * Architecture:
 *   GameClaimPolicy describes:
 *     - which providerGroup is accepted for a game (steam | riot | ...)
 *     - which verificationMethod is accepted
 *     - what verificationStatus is required (always "VERIFIED" for now)
 *     - auto-approval criteria (confidence level, owner check, open-claim check)
 *
 * Provider-to-game mapping (current + planned):
 *   dota2    → steam  → STEAM_OPENID   (implemented Fase 10)
 *   cs2      → steam  → STEAM_OPENID   (same provider, different game stub)
 *   lol      → riot   → RIOT_OAUTH     (not yet implemented)
 *   valorant → riot   → RIOT_OAUTH     (not yet implemented)
 */

export type GameCode      = "dota2" | "cs2" | "lol" | "valorant" | (string & {});
export type ProviderGroup = "steam" | "riot" | (string & {});
export type VerificationMethod = "STEAM_OPENID" | "RIOT_OAUTH" | (string & {});
export type MatchConfidenceLevel = "HIGH" | "MEDIUM" | "LOW";
export type PolicyDecision = "AUTO_APPROVABLE" | "REQUIRES_REVIEW" | "BLOCKED";
export type ApprovalType   = "AUTO_POLICY" | "REQUIRES_REVIEW" | "MANUAL_ADMIN";

// ── Auto-approval criteria ────────────────────────────────────────────────────

export interface AutoApprovalCriteria {
  /**
   * Match confidence levels that qualify for auto-approval.
   * Only claims with one of these levels bypass manual review.
   */
  allowedMatchConfidences: MatchConfidenceLevel[];
  /**
   * If true, auto-approval is blocked when an ACTIVE ownership link exists for the asset.
   * Prevents silent owner displacement.
   */
  requireNoActiveOwner:    boolean;
  /**
   * If true, auto-approval is blocked when an open (PENDING/UNDER_REVIEW) claim exists.
   * Prevents race between user-submitted and auto-submitted claims.
   */
  requireNoOpenClaim:      boolean;
}

// ── Per-game policy record ────────────────────────────────────────────────────

export interface GameClaimPolicy {
  game:                       GameCode;
  providerGroup:              ProviderGroup;
  verificationMethod:         VerificationMethod;
  /**
   * The verificationStatus value that must be present for the claim to be considered.
   * Claims with any other status are BLOCKED.
   */
  requiredVerificationStatus: string;
  autoApproval:               AutoApprovalCriteria;
}

// ── Policy registry ───────────────────────────────────────────────────────────

export const GAME_CLAIM_POLICIES: Record<string, GameClaimPolicy> = {
  /**
   * Dota 2 — Steam / OpenID 2.0
   * Implemented since Fase 10. Steam OpenID verification flow is in steamVerificationService.ts.
   * matchConfidence HIGH = playerProfile was created in the same onboarding tx as the connected account.
   */
  dota2: {
    game:                       "dota2",
    providerGroup:              "steam",
    verificationMethod:         "STEAM_OPENID",
    requiredVerificationStatus: "VERIFIED",
    autoApproval: {
      allowedMatchConfidences: ["HIGH"],
      requireNoActiveOwner:    true,
      requireNoOpenClaim:      true,
    },
  },

  /**
   * CS2 — Steam / OpenID 2.0
   * Same provider as Dota2. Discovery adapter stub ready; full implementation in a future fase.
   * Policy is intentionally identical to Dota2 (same provider, same confidence requirement).
   */
  cs2: {
    game:                       "cs2",
    providerGroup:              "steam",
    verificationMethod:         "STEAM_OPENID",
    requiredVerificationStatus: "VERIFIED",
    autoApproval: {
      allowedMatchConfidences: ["HIGH"],
      requireNoActiveOwner:    true,
      requireNoOpenClaim:      true,
    },
  },

  /**
   * League of Legends — Riot / OAuth
   * Not yet implemented. Stub declared for architecture completeness.
   * Policy is conservative: HIGH confidence required, no active owner.
   */
  lol: {
    game:                       "lol",
    providerGroup:              "riot",
    verificationMethod:         "RIOT_OAUTH",
    requiredVerificationStatus: "VERIFIED",
    autoApproval: {
      allowedMatchConfidences: ["HIGH"],
      requireNoActiveOwner:    true,
      requireNoOpenClaim:      true,
    },
  },

  /**
   * Valorant — Riot / OAuth
   * Not yet implemented. Stub declared for architecture completeness.
   */
  valorant: {
    game:                       "valorant",
    providerGroup:              "riot",
    verificationMethod:         "RIOT_OAUTH",
    requiredVerificationStatus: "VERIFIED",
    autoApproval: {
      allowedMatchConfidences: ["HIGH"],
      requireNoActiveOwner:    true,
      requireNoOpenClaim:      true,
    },
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Retrieve the policy for a game. Returns null if no policy is configured.
 * A null policy means the game does not currently support asset claiming.
 */
export function getGamePolicy(game: string): GameClaimPolicy | null {
  return GAME_CLAIM_POLICIES[game] ?? null;
}

/**
 * Return all games that have an auto-approval policy configured for a provider.
 * Useful for enumerating which games a connected account (e.g. steam) can support.
 */
export function getGamesForProvider(providerGroup: ProviderGroup): GameClaimPolicy[] {
  return Object.values(GAME_CLAIM_POLICIES).filter(
    (p) => p.providerGroup === providerGroup,
  );
}

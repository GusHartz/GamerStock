/**
 * Epic Games Verification Adapter — GamerStock Multigame (Stub)
 *
 * Stub implementation of the VerificationAdapter interface for Epic Games OAuth 2.0.
 * Not yet implemented — throws descriptive errors if called.
 *
 * Status: STUB (Fase 16)
 *
 * When ready to implement (future fase):
 *   1. Register an Epic Games developer application at https://dev.epicgames.com/
 *   2. Set EPIC_CLIENT_ID and EPIC_CLIENT_SECRET secrets
 *   3. Implement startVerification() — build OAuth 2.0 authorize URL
 *   4. Implement handleCallback() — exchange code, call EOS (Epic Online Services)
 *      /user/v1/me to retrieve Epic Account ID + display name
 *   5. Implement normalizeIdentity() — Epic Account ID as providerAccountId
 *   6. Add "epic" to claimPolicyConfig.ts for affected games
 *   7. Remove the NOT_IMPLEMENTED throws in this file
 *
 * Epic OAuth 2.0 endpoints:
 *   Authorization: https://www.epicgames.com/id/authorize
 *   Token:         https://api.epicgames.dev/epic/oauth/v2/token
 *   User info:     https://api.epicgames.dev/epic/id/v1/accounts/{accountId}
 *
 * Affected games when implemented: fortnite, rocket-league, fall-guys
 *
 * Note: Epic's EAS (Epic Account Services) is separate from EOS (Epic Online Services).
 * For player identity verification, EAS OAuth is the correct entry point.
 */

import type {
  VerificationAdapter,
  VerificationStartParams,
  VerificationStartResult,
  VerificationCallbackParams,
  VerificationCallbackResult,
  NormalizedProviderIdentity,
} from "./verificationAdapter";

export const epicVerificationAdapter: VerificationAdapter = {
  providerGroup: "epic",
  method:        "EPIC_OAUTH",

  startVerification(_params: VerificationStartParams): VerificationStartResult {
    throw new Error(
      "EPIC_OAUTH_NOT_IMPLEMENTED: Epic Games OAuth verification is not yet available. " +
      "See epicVerificationAdapter.ts for implementation guide.",
    );
  },

  async handleCallback(
    _params: VerificationCallbackParams,
  ): Promise<VerificationCallbackResult> {
    throw new Error(
      "EPIC_OAUTH_NOT_IMPLEMENTED: Epic Games OAuth callback handling is not yet available. " +
      "See epicVerificationAdapter.ts for implementation guide.",
    );
  },

  normalizeIdentity(_rawData: unknown): NormalizedProviderIdentity {
    throw new Error(
      "EPIC_OAUTH_NOT_IMPLEMENTED: Epic Games identity normalization is not yet available.",
    );
  },
};

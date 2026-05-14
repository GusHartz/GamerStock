/**
 * Riot Verification Adapter — GamerStock Multigame (Stub)
 *
 * Stub implementation of the VerificationAdapter interface for Riot Games OAuth 2.0.
 * Not yet implemented — throws descriptive errors if called.
 *
 * Status: STUB (Fase 16)
 *
 * When ready to implement (future fase):
 *   1. Register a Riot developer application at https://developer.riotgames.com/
 *   2. Set RIOT_CLIENT_ID and RIOT_CLIENT_SECRET secrets
 *   3. Implement startVerification() — build OAuth 2.0 authorize URL with PKCE
 *   4. Implement handleCallback() — exchange code for access_token, call RSO /userinfo
 *      to retrieve PUUID + Riot ID (gameName#tagLine)
 *   5. Implement normalizeIdentity() — PUUID as providerAccountId, Riot ID as displayName
 *   6. Update claimPolicyConfig.ts if policy rules differ from dota2/cs2
 *   7. Remove the NOT_IMPLEMENTED throws and register active stubs in verificationRegistry.ts
 *
 * Riot OAuth scopes needed:
 *   - openid (for OIDC ID token with PUUID)
 *   - cpid (for account region data — optional)
 *
 * Note: Riot's RSO (Riot Sign On) uses standard OAuth 2.0 + OIDC.
 * The PUUID returned is cross-region and suitable as providerAccountId.
 *
 * Affected games when implemented: lol, valorant, tft, lor, wildrift
 */

import type {
  VerificationAdapter,
  VerificationStartParams,
  VerificationStartResult,
  VerificationCallbackParams,
  VerificationCallbackResult,
  NormalizedProviderIdentity,
} from "./verificationAdapter";

export const riotVerificationAdapter: VerificationAdapter = {
  providerGroup: "riot",
  method:        "RIOT_OAUTH",

  startVerification(_params: VerificationStartParams): VerificationStartResult {
    throw new Error(
      "RIOT_OAUTH_NOT_IMPLEMENTED: Riot OAuth verification is not yet available. " +
      "See riotVerificationAdapter.ts for implementation guide.",
    );
  },

  async handleCallback(
    _params: VerificationCallbackParams,
  ): Promise<VerificationCallbackResult> {
    throw new Error(
      "RIOT_OAUTH_NOT_IMPLEMENTED: Riot OAuth callback handling is not yet available. " +
      "See riotVerificationAdapter.ts for implementation guide.",
    );
  },

  normalizeIdentity(_rawData: unknown): NormalizedProviderIdentity {
    throw new Error(
      "RIOT_OAUTH_NOT_IMPLEMENTED: Riot identity normalization is not yet available.",
    );
  },
};

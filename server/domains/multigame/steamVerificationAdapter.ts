/**
 * Steam Verification Adapter — GamerStock Multigame
 *
 * First concrete implementation of the VerificationAdapter interface (Fase 16).
 * Wraps the existing steamVerificationService.ts functions, which remain the
 * pure HTTP layer for the Steam OpenID 2.0 protocol.
 *
 * Flow:
 *   1. startVerification()  — calls buildSteamLoginUrl() → redirect URL + INITIATED event
 *   2. handleCallback()     — calls verifySteamCallback() → validates sig with Steam
 *                             → checks SteamID64 matches onboarding value
 *                             → returns VERIFIED or FAILED event payload
 *   3. normalizeIdentity()  — maps raw { steamId64, claimedId } into NormalizedProviderIdentity
 *
 * Design notes:
 *   - This adapter is stateless; all state lives in params passed by the caller.
 *   - DB writes happen in routes.ts (insertAccountVerificationEvent, updateConnectedAccountVerificationStatus).
 *   - The underlying steamVerificationService.ts is NOT changed — this adapter is a thin wrapper.
 *   - account_verification_events audit trail is preserved exactly as in Fase 10.
 */

import type {
  VerificationAdapter,
  VerificationStartParams,
  VerificationStartResult,
  VerificationCallbackParams,
  VerificationCallbackResult,
  NormalizedProviderIdentity,
} from "./verificationAdapter";
import {
  buildSteamLoginUrl,
  verifySteamCallback,
} from "./steamVerificationService";

export const steamVerificationAdapter: VerificationAdapter = {
  providerGroup: "steam",
  method:        "STEAM_OPENID",

  // ── startVerification ──────────────────────────────────────────────────────

  startVerification(params: VerificationStartParams): VerificationStartResult {
    const redirectUrl = buildSteamLoginUrl(params.callbackUrl, params.realm);

    return {
      redirectUrl,
      verificationEventPayload: {
        connectedAccountId: params.connectedAccountId,
        providerGroup:      "steam",
        game:               params.game as any,
        method:             "STEAM_OPENID" as any,
        status:             "INITIATED" as any,
        payloadJson:        JSON.stringify({ userId: params.userId }),
      },
    };
  },

  // ── handleCallback ─────────────────────────────────────────────────────────

  async handleCallback(
    params: VerificationCallbackParams,
  ): Promise<VerificationCallbackResult> {
    const result = await verifySteamCallback(params.query);

    // ── Case 1: Steam signature invalid or missing SteamID64 ────────────────
    if (!result.valid || !result.steamId64) {
      return {
        success:            false,
        normalizedIdentity: null,
        verificationStatus: "FAILED",
        verificationEventPayload: {
          connectedAccountId: params.connectedAccountId,
          providerGroup:      "steam",
          game:               params.game as any,
          method:             "STEAM_OPENID" as any,
          status:             "FAILED" as any,
          payloadJson:        JSON.stringify({
            error:     result.error,
            claimedId: result.claimedId,
          }),
        },
        errorCode: result.error ?? "UNKNOWN",
      };
    }

    // ── Case 2: SteamID64 mismatch (user authenticated with a different account) ──
    if (
      params.expectedProviderAccountId !== null &&
      params.expectedProviderAccountId !== result.steamId64
    ) {
      return {
        success:            false,
        normalizedIdentity: null,
        verificationStatus: "FAILED",
        verificationEventPayload: {
          connectedAccountId: params.connectedAccountId,
          providerGroup:      "steam",
          game:               params.game as any,
          method:             "STEAM_OPENID" as any,
          status:             "FAILED" as any,
          payloadJson:        JSON.stringify({
            error:    "STEAM_ID_MISMATCH",
            expected: params.expectedProviderAccountId,
            received: result.steamId64,
          }),
        },
        errorCode: "STEAM_ID_MISMATCH",
      };
    }

    // ── Case 3: Valid — normalize identity and return VERIFIED event ─────────
    const identity = this.normalizeIdentity({
      steamId64: result.steamId64,
      claimedId: result.claimedId,
    });

    return {
      success:            true,
      normalizedIdentity: identity,
      verificationStatus: "VERIFIED",
      verificationEventPayload: {
        connectedAccountId: params.connectedAccountId,
        providerGroup:      "steam",
        game:               params.game as any,
        method:             "STEAM_OPENID" as any,
        status:             "VERIFIED" as any,
        payloadJson:        JSON.stringify({
          steamId64: result.steamId64,
          claimedId: result.claimedId,
        }),
      },
      errorCode: null,
    };
  },

  // ── normalizeIdentity ──────────────────────────────────────────────────────

  normalizeIdentity(rawData: unknown): NormalizedProviderIdentity {
    const data = rawData as { steamId64?: string; claimedId?: string | null };
    return {
      // SteamID64 is the stable, globally unique identifier from Steam
      providerAccountId: data.steamId64 ?? "",
      // Steam OpenID 2.0 does not return a display name in the callback.
      // Display name enrichment (via Steam Web API) can be added in a future fase.
      displayName:       null,
      // claimedId is the full OpenID URL (https://steamcommunity.com/openid/id/{SteamID64})
      profileUrl:        data.claimedId ?? null,
      rawData:           data as Record<string, unknown>,
    };
  },
};

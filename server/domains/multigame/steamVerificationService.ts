/**
 * Fase 10: Steam OpenID 2.0 Verification Service
 *
 * Implements the Steam OpenID 2.0 flow WITHOUT additional packages.
 * Uses native fetch (Node.js 18+) for the check_authentication step.
 *
 * Steam OpenID 2.0 flow:
 *   1. We redirect the user to Steam with openid.mode=checkid_setup
 *   2. Steam authenticates the user and redirects back to our callback URL
 *   3. We verify the signature by POSTing to Steam with openid.mode=check_authentication
 *   4. If is_valid=true, we extract the SteamID64 from openid.claimed_id
 *
 * Ref: https://steamcommunity.com/dev/openid
 *
 * Design invariants:
 *   - No session mutation here — caller handles session + redirect
 *   - This service is pure HTTP; DB writes are done via repository calls
 *   - Verification ≠ claim; SteamID ownership is not disputed here
 */

const STEAM_OPENID_ENDPOINT = "https://steamcommunity.com/openid/login";
const STEAM_ID_REGEX         = /^https?:\/\/steamcommunity\.com\/openid\/id\/(\d+)$/;

export interface SteamCallbackParams {
  [key: string]: string | string[] | undefined;
}

export interface SteamVerificationResult {
  valid:     boolean;
  steamId64: string | null;
  claimedId: string | null;
  error?:    string;
}

/**
 * Build the redirect URL for Steam OpenID 2.0 login.
 *
 * @param returnTo  Full URL that Steam will redirect back to (our callback)
 * @param realm     The realm — typically the app's origin (e.g. https://myapp.replit.dev)
 */
export function buildSteamLoginUrl(returnTo: string, realm: string): string {
  const params = new URLSearchParams({
    "openid.ns":        "http://specs.openid.net/auth/2.0",
    "openid.mode":      "checkid_setup",
    "openid.return_to": returnTo,
    "openid.realm":     realm,
    "openid.identity":  "http://specs.openid.net/auth/2.0/identifier_select",
    "openid.claimed_id":"http://specs.openid.net/auth/2.0/identifier_select",
  });
  return `${STEAM_OPENID_ENDPOINT}?${params.toString()}`;
}

/**
 * Verify the Steam OpenID 2.0 callback.
 *
 * Sends all returned parameters (with openid.mode replaced by check_authentication)
 * to Steam's endpoint and parses the is_valid response.
 *
 * @param query  The query string parameters from the callback request
 */
export async function verifySteamCallback(
  query: SteamCallbackParams,
): Promise<SteamVerificationResult> {
  // Ensure required params are present
  const claimed  = typeof query["openid.claimed_id"] === "string" ? query["openid.claimed_id"] : null;
  const mode     = typeof query["openid.mode"]       === "string" ? query["openid.mode"]       : null;
  const sig      = typeof query["openid.sig"]        === "string" ? query["openid.sig"]        : null;
  const ns       = typeof query["openid.ns"]         === "string" ? query["openid.ns"]         : null;

  if (!claimed || !sig || !ns) {
    return { valid: false, steamId64: null, claimedId: claimed, error: "MISSING_OPENID_PARAMS" };
  }

  if (mode !== "id_res") {
    return { valid: false, steamId64: null, claimedId: claimed, error: `UNEXPECTED_MODE:${mode}` };
  }

  // Build the check_authentication request body
  const verifyParams: Record<string, string> = { "openid.mode": "check_authentication" };
  for (const [key, value] of Object.entries(query)) {
    if (key !== "openid.mode" && typeof value === "string") {
      verifyParams[key] = value;
    }
  }

  let responseText: string;
  try {
    const body = new URLSearchParams(verifyParams).toString();
    const res  = await fetch(STEAM_OPENID_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    responseText = await res.text();
  } catch (err: any) {
    return {
      valid: false, steamId64: null, claimedId: claimed,
      error: `STEAM_VERIFY_NETWORK_ERROR:${err.message}`,
    };
  }

  // Parse Steam's response: looks like "ns:...\nis_valid:true\n"
  const isValid = responseText.includes("is_valid:true");
  if (!isValid) {
    return { valid: false, steamId64: null, claimedId: claimed, error: "STEAM_INVALID_SIG" };
  }

  // Extract SteamID64 from claimed_id: https://steamcommunity.com/openid/id/{SteamID64}
  const match    = STEAM_ID_REGEX.exec(claimed);
  const steamId64 = match?.[1] ?? null;

  if (!steamId64) {
    return { valid: false, steamId64: null, claimedId: claimed, error: "INVALID_CLAIMED_ID_FORMAT" };
  }

  return { valid: true, steamId64, claimedId: claimed };
}

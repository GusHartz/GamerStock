/**
 * Verification Adapter Framework — GamerStock Multigame
 *
 * Defines the contract that all provider verification adapters must implement.
 * This is the core abstraction that allows Steam, Riot, Epic, and future providers
 * to plug in without changing the orchestration layer (routes.ts / registry).
 *
 * Design invariants (inherited from steamVerificationService.ts, Fase 10):
 *   - Adapters are pure I/O — they do NOT write to the database.
 *   - Adapters return event payloads; the caller (routes.ts) persists them.
 *   - Session management and redirects stay in routes.ts.
 *   - Verification ≠ claim — adapters only confirm provider identity ownership.
 *
 * Adapter responsibilities:
 *   startVerification()   — build the provider redirect URL + INITIATED event payload
 *   handleCallback()      — validate the provider callback + return VERIFIED/FAILED event payload
 *   normalizeIdentity()   — extract a canonical NormalizedProviderIdentity from raw provider data
 *
 * Not in scope for adapters:
 *   - DB writes (insertAccountVerificationEvent, updateConnectedAccountVerificationStatus)
 *   - Session mutation (req.session.*)
 *   - HTTP redirects
 *   - Claim logic (see claimPolicyEvaluator.ts)
 *
 * Adding a new provider adapter:
 *   1. Create a file like `riotVerificationAdapter.ts` that exports a `VerificationAdapter` object.
 *   2. Register it in `verificationRegistry.ts`.
 *   3. The existing Steam routes serve as the reference implementation.
 */

import type { InsertAccountVerificationEvent } from "@shared/schema/multigame";

// ── Core identity type ────────────────────────────────────────────────────────

/**
 * Canonical provider identity returned after a successful verification.
 *
 * All providers normalize their identity into this shape so that the
 * claim pipeline and connected_accounts updates work uniformly.
 *
 * Fields:
 *   providerAccountId — the stable, globally unique identifier from the provider.
 *                        For Steam: SteamID64 (e.g. "76561197960287930")
 *                        For Riot:  PUUID
 *                        For Epic:  Epic account ID
 *   displayName       — optional human-readable name (may require a secondary API call)
 *   profileUrl        — optional canonical profile URL (e.g. OpenID claimed_id for Steam)
 *   rawData           — full raw payload from the provider; stored for debugging / auditing
 */
export interface NormalizedProviderIdentity {
  providerAccountId: string;
  displayName:       string | null;
  profileUrl:        string | null;
  rawData:           Record<string, unknown>;
}

// ── startVerification ─────────────────────────────────────────────────────────

/**
 * Parameters passed to startVerification().
 * The adapter uses these to build the provider redirect URL and the INITIATED event.
 */
export interface VerificationStartParams {
  /** Connected account primary key (for the event record). */
  connectedAccountId: number;
  /** App user ID (stored in the event for audit purposes). */
  userId: string;
  /** Game code this account is being verified for (e.g. "dota2"). */
  game: string;
  /** Full callback URL the provider will redirect back to (e.g. https://app.replit.dev/api/auth/steam/callback). */
  callbackUrl: string;
  /** Realm / audience for the provider (typically the app origin). */
  realm: string;
}

/**
 * Result of startVerification().
 *   redirectUrl              — the URL the user must be redirected to
 *   verificationEventPayload — INITIATED event to persist before redirecting
 */
export interface VerificationStartResult {
  redirectUrl:              string;
  verificationEventPayload: InsertAccountVerificationEvent;
}

// ── handleCallback ────────────────────────────────────────────────────────────

/**
 * Parameters passed to handleCallback().
 * The adapter uses these to validate the provider callback and produce the outcome.
 */
export interface VerificationCallbackParams {
  /** Query string parameters from the provider callback (string-only map). */
  query: Record<string, string>;
  /** Connected account primary key of the account being verified. */
  connectedAccountId: number;
  /** App user ID. */
  userId: string;
  /** Game code this account is being verified for. */
  game: string;
  /**
   * The providerAccountId already recorded on the ConnectedAccount (from onboarding).
   * The adapter should validate that the callback identity matches this value.
   * null means the account was created without a providerAccountId (rare — guard only).
   */
  expectedProviderAccountId: string | null;
}

/**
 * Result of handleCallback().
 *   success                  — whether the verification succeeded
 *   normalizedIdentity       — canonical identity; null on failure
 *   verificationStatus       — "VERIFIED" or "FAILED" (to update the ConnectedAccount)
 *   verificationEventPayload — VERIFIED or FAILED event to persist
 *   errorCode                — short error code when success=false; null on success
 */
export interface VerificationCallbackResult {
  success:                 boolean;
  normalizedIdentity:      NormalizedProviderIdentity | null;
  verificationStatus:      "VERIFIED" | "FAILED";
  verificationEventPayload: InsertAccountVerificationEvent;
  errorCode:               string | null;
}

// ── Adapter interface ─────────────────────────────────────────────────────────

/**
 * The core contract all provider adapters implement.
 *
 * Implementations:
 *   steamVerificationAdapter  — Steam OpenID 2.0 (active, Fase 10/16)
 *   riotVerificationAdapter   — Riot OAuth 2.0   (stub, Fase 16)
 *   epicVerificationAdapter   — Epic OAuth 2.0   (stub, Fase 16)
 */
export interface VerificationAdapter {
  /** Provider group identifier — must match `providerGroup` in connected_accounts. */
  readonly providerGroup: string;
  /** Verification method code — stored in account_verification_events.method. */
  readonly method: string;

  /**
   * Build the redirect URL and INITIATED event payload.
   * Synchronous — no network I/O needed at this stage.
   * The caller persists the event and redirects the user.
   */
  startVerification(params: VerificationStartParams): VerificationStartResult;

  /**
   * Validate the provider callback and produce the outcome.
   * Asynchronous — requires a back-channel call to the provider (e.g. Steam, Riot).
   * The caller persists the returned event and updates the ConnectedAccount.
   */
  handleCallback(params: VerificationCallbackParams): Promise<VerificationCallbackResult>;

  /**
   * Normalize provider-specific raw data into a canonical NormalizedProviderIdentity.
   * Called internally by handleCallback() but exposed for testing and future enrichment.
   */
  normalizeIdentity(rawData: unknown): NormalizedProviderIdentity;
}

// ─── Identity Engine v2 — Type Definitions ────────────────────────────────────
// All types/interfaces for the identity layer.
// Shared between services, repositories, and route handlers.
// ─────────────────────────────────────────────────────────────────────────────

// ── Core identity snapshot ──────────────────────────────────────────────────
export interface IdentityUser {
  id: string;
  email: string | null;
  displayName: string | null;
  role: string;
  status: string | null;
  mustChangePassword: boolean;
}

// ── What /api/auth/me returns to the client ─────────────────────────────────
// `capabilities` is derived at runtime from approved player claims.
// It is NOT stored in the session — computed fresh on each /me call.
export interface SessionResponse {
  user: {
    id: string;
    email: string | null;
    displayName: string | null;
    role: string;
    mustChangePassword: boolean;
    status: string | null;
  };
  capabilities: Capability[];
}

// ── Capabilities (derived, never stored as role) ─────────────────────────────
// A capability is a permission granted by a claim approval, not by a role change.
// This keeps identity clean: a player user is still role="user" with extra capabilities.
//
// DECISION: Capability over new role.
// Rationale: adding a "player" role would require role-check updates across all
// domain middleware. A capability list in the session response is additive and
// backward-compatible — existing code that doesn't read `capabilities` is unaffected.
// Future capabilities can be added without schema changes.
export type Capability =
  | "player_profile_control"   // has an approved player claim → can edit public profile
  | "player_treasury_access"   // future: player economy features
  | "riot_verified";           // future: Riot account linked + verified

// ── Signup / Login request shapes ────────────────────────────────────────────
export interface SignupInput {
  name: string;
  displayName: string;
  email: string;
  password: string;
  gamesSelected?: string[];
  gamesOther?: string;
}

export interface LoginInput {
  emailOrDisplayName: string;
  password: string;
}

// ── Password credential operations ────────────────────────────────────────────
export interface CredentialVerifyResult {
  valid: boolean;
  userId?: string;
}

// ── Token for password reset ──────────────────────────────────────────────────
export interface ResetTokenPayload {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}

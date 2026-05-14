/**
 * ExternalIdentity — Model
 *
 * Represents a verified external identity linked to a GamerStock user.
 * An external identity is broader than a wallet — it could be:
 *   - An EVM wallet address (Ethereum, Polygon, Base, Arbitrum)
 *   - A Solana public key
 *   - A custodial account identifier (Privy DID, Magic Link email)
 *   - A future cross-chain identity (IBC address, etc.)
 *
 * Phase 8: Code model only. No DB table yet.
 * Phase 9+: Will map to a `external_identities` table.
 *
 * ─── Relationship to users ───────────────────────────────────────────────────
 * One GamerStock user → many ExternalIdentities
 * One ExternalIdentity → one GamerStock user (enforced by unique constraint)
 *
 * ─── Verification ────────────────────────────────────────────────────────────
 * EVM: Sign-in With Ethereum (SIWE) message signature verification
 * Solana: ed25519 signature over a nonce
 * Custodial: provider-issued JWT / DID
 */

export type ExternalIdentityProvider =
  | "EVM"       // Ethereum-compatible wallet (MetaMask, WalletConnect, etc.)
  | "SOLANA"    // Solana wallet (Phantom, Backpack, etc.)
  | "PRIVY"     // Privy custodial / embedded wallet
  | "MAGIC"     // Magic Link
  | "UNKNOWN";

export type ExternalIdentityStatus =
  | "PENDING"   // Link requested but not yet verified
  | "ACTIVE"    // Verified and active
  | "REVOKED"   // Unlinked by user
  | "SUSPENDED"; // Admin action

export interface ExternalIdentity {
  id: string;
  userId: string;
  provider: ExternalIdentityProvider;
  externalAddress: string;
  chainId?: number;
  status: ExternalIdentityStatus;
  verifiedAt?: Date;
  revokedAt?: Date;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExternalIdentityCreateInput {
  userId: string;
  provider: ExternalIdentityProvider;
  externalAddress: string;
  chainId?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Normalize a wallet address for storage/comparison.
 * EVM: lowercase the hex string.
 * Solana: base58 addresses are case-sensitive — return as-is.
 */
export function normalizeAddress(address: string, provider: ExternalIdentityProvider): string {
  if (provider === "EVM") return address.toLowerCase();
  return address;
}

/**
 * Check if an address string looks like a valid EVM address (checksummed or not).
 * Does NOT verify checksum — that happens in the adapter implementation.
 */
export function looksLikeEvmAddress(address: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(address);
}

/**
 * Check if an address string looks like a Solana public key (base58, 32-44 chars).
 */
export function looksLikeSolanaAddress(address: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
}

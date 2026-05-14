/**
 * WalletLink — Model
 *
 * Represents a confirmed, active link between a GamerStock user account
 * and an external wallet. A WalletLink is the persisted result of a successful
 * WalletLinkAdapter.confirmLink() call.
 *
 * Phase 8: Code model only. No DB table yet.
 * Phase 9+: Will map to a `wallet_links` table.
 *
 * ─── Nonce flow ──────────────────────────────────────────────────────────────
 * 1. requestLink() → generate nonce, store WalletLinkNonce (short TTL)
 * 2. User signs nonce with wallet
 * 3. confirmLink() → verify signature, persist WalletLink, delete nonce
 *
 * ─── Primary link ────────────────────────────────────────────────────────────
 * Users may link multiple wallets. At most one is the "primary" — used for
 * treasury payouts if no explicit payout wallet is specified.
 */

export type WalletLinkStatus = "ACTIVE" | "REVOKED";

export interface WalletLink {
  id: string;
  userId: string;
  walletAddress: string;
  chainId: number;
  isPrimary: boolean;
  status: WalletLinkStatus;
  linkedAt: Date;
  revokedAt?: Date;
  lastUsedAt?: Date;
}

/**
 * Pending nonce record — stored temporarily during the link handshake.
 * TTL: typically 5-10 minutes.
 */
export interface WalletLinkNonce {
  nonce: string;
  userId: string;
  walletAddress: string;
  chainId: number;
  expiresAt: Date;
  createdAt: Date;
}

export interface WalletLinkCreateInput {
  userId: string;
  walletAddress: string;
  chainId: number;
  isPrimary?: boolean;
}

/**
 * Build the SIWE (Sign-In With Ethereum) message that the user must sign.
 * This is a simplified version — production would use the full EIP-4361 format.
 */
export function buildSiweMessage(params: {
  domain: string;
  walletAddress: string;
  nonce: string;
  issuedAt: Date;
  expiresAt: Date;
}): string {
  return [
    `${params.domain} wants you to link your Ethereum account:`,
    params.walletAddress,
    "",
    "By signing this message you authorize GamerStock to associate this wallet with your account.",
    "",
    `Nonce: ${params.nonce}`,
    `Issued At: ${params.issuedAt.toISOString()}`,
    `Expiration Time: ${params.expiresAt.toISOString()}`,
  ].join("\n");
}

/**
 * Generate a cryptographically random nonce string.
 * In production, use crypto.randomBytes(32).toString("hex").
 */
export function generateLinkNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}

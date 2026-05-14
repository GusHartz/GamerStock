/**
 * WalletLinkAdapter — Interface Contract
 *
 * Defines the contract for linking an external wallet address to a GamerStock
 * user account. Implementations could back this with:
 *   - EVM-compatible wallets (MetaMask, WalletConnect, Privy)
 *   - Solana wallets (Phantom)
 *   - Custodial wallet providers (Thirdweb, Magic Link)
 *
 * No implementation exists yet. The interface is the extension point.
 *
 * ─── Future flow ────────────────────────────────────────────────────────────
 * 1. User calls requestLink({ userId, walletAddress, chainId })
 *    → Server generates a nonce and stores it (in DB or cache)
 * 2. Frontend asks user to sign the nonce with their wallet
 * 3. User calls confirmLink({ userId, walletAddress, signature, nonce })
 *    → Adapter verifies signature on-chain or via ethers/viem
 *    → If valid, persists the WalletLink record
 * 4. unlink() removes the record (user can have multiple wallets)
 * 5. listLinkedWallets() returns all wallets for a user
 *
 * ─── Schema extension (Phase 9+) ────────────────────────────────────────────
 * Will require a new `wallet_links` table (see models/wallet-link.ts).
 * No schema changes in Phase 8.
 */

export interface LinkRequest {
  userId: string;
  walletAddress: string;
  chainId: number;
}

export interface LinkConfirmation {
  userId: string;
  walletAddress: string;
  signature: string;
  nonce: string;
}

export interface WalletLinkResult {
  success: boolean;
  walletAddress: string;
  chainId: number;
  linkedAt: Date;
  error?: string;
}

export interface WalletLinkAdapter {
  /**
   * Initiate a wallet link request.
   * Returns a nonce that the user must sign with their wallet.
   */
  requestLink(req: LinkRequest): Promise<{ nonce: string; expiresAt: Date }>;

  /**
   * Confirm a wallet link by verifying the signed nonce.
   * On success, persists a WalletLink record for the user.
   */
  confirmLink(confirmation: LinkConfirmation): Promise<WalletLinkResult>;

  /**
   * Remove a linked wallet from a user account.
   */
  unlink(userId: string, walletAddress: string): Promise<{ success: boolean }>;

  /**
   * List all wallets currently linked to a user account.
   */
  listLinkedWallets(userId: string): Promise<WalletLinkResult[]>;

  /**
   * Check if a specific wallet address is linked to any GamerStock account.
   * Used to prevent duplicate linking across users.
   */
  isWalletLinked(walletAddress: string): Promise<{ linked: boolean; userId?: string }>;
}

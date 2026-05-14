/**
 * TreasurySettlementAdapter — Interface Contract
 *
 * Defines the contract for settling accumulated player fee balances on-chain.
 * The GamerStock treasury accumulates player fees in `playerFeeBalance` (PostgreSQL).
 * This adapter is the extension point for future on-chain settlement.
 *
 * ─── How GamerStock treasury currently works (Web2) ─────────────────────────
 * 1. A trade executes → `feeLedger` row inserted (platformFee + playerFee split)
 * 2. `playerFeeBalance` accumulates per-asset player fees (running total)
 * 3. Periodically (future), fees are settled to the player who "owns" the asset
 *
 * ─── Future Web3 settlement flow ────────────────────────────────────────────
 * 1. Off-chain: query `playerFeeBalance` for amounts above settlementThreshold
 * 2. Call queuePayout() → creates an intent record (DB or queue)
 * 3. Settlement worker signs and submits on-chain transfer (e.g., ERC-20 USDC)
 * 4. Call markSettled() once tx is confirmed → updates DB record
 * 5. getSettlementStatus() lets admin/user check status of pending payouts
 *
 * ─── Schema extension (Phase 9+) ────────────────────────────────────────────
 * Will require a `settlement_intents` table. No schema changes in Phase 8.
 */

export type SettlementStatus = "PENDING" | "QUEUED" | "SUBMITTED" | "CONFIRMED" | "FAILED";

export interface PayoutIntent {
  intentId: string;
  userId: string;
  walletAddress: string;
  assetId: number;
  amountGS: number;
  chainId: number;
  createdAt: Date;
}

export interface SettlementRecord extends PayoutIntent {
  status: SettlementStatus;
  txHash?: string;
  confirmedAt?: Date;
  failureReason?: string;
}

export interface TreasurySettlementAdapter {
  /**
   * Queue a payout intent for a user.
   * Reads from playerFeeBalance, creates a settlement intent record.
   * Does NOT submit on-chain yet.
   */
  queuePayout(params: {
    userId: string;
    walletAddress: string;
    assetId: number;
    amountGS: number;
    chainId: number;
  }): Promise<PayoutIntent>;

  /**
   * Mark a settlement intent as confirmed after the on-chain tx is verified.
   */
  markSettled(intentId: string, txHash: string): Promise<SettlementRecord>;

  /**
   * Mark a settlement intent as failed (e.g., tx reverted, gas issue).
   */
  markFailed(intentId: string, reason: string): Promise<SettlementRecord>;

  /**
   * Get the current status of a settlement intent.
   */
  getSettlementStatus(intentId: string): Promise<SettlementRecord | null>;

  /**
   * List all pending payouts for a user.
   */
  listPendingPayouts(userId: string): Promise<SettlementRecord[]>;

  /**
   * Estimate the on-chain gas cost for a payout (informational).
   */
  estimateGasCost(amountGS: number, chainId: number): Promise<{ estimatedGasUSD: number }>;
}

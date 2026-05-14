// ─── Input types ─────────────────────────────────────────────────────────────

export interface ReserveBuyOrderParams {
  userId: string;
  orderId: string;
  reserveAmount: string;
  assetId?: string;
  metadata?: Record<string, unknown>;
}

export interface ReleaseBuyOrderParams {
  userId: string;
  orderId: string;
  releaseAmount: string;
  reason: "cancelled" | "expired" | "partial_fill_remainder" | "adjustment";
}

export interface SettleMatchedTradeParams {
  tradeId: string;
  buyOrderId: string;
  sellOrderId: string;
  buyerUserId: string;
  sellerUserId: string;
  assetId: string;
  quantity: number;
  executionPrice: string;
  /**
   * GS$ gross notional: price × quantity.
   * Buyer's locked balance is consumed by this full amount.
   * Seller receives gross minus the fee total.
   */
  grossAmountGS: string;
  /**
   * Excess locked GS$ to release back to buyer's available_balance.
   * Use when buyer reserved more than the final execution cost
   * (price improvement or partial fill remainder).
   * Defaults to "0.000000" if not provided.
   */
  releaseAmount?: string;
  /**
   * Total fee in basis points for this trade.
   * Overrides the platform default (200 bps) when provided.
   * Source: assetMarkets.feeBps for the relevant asset.
   */
  feeBps?: number;
  /**
   * DB integer asset id (assets.id) — used to update playerFeeBalance.
   * Optional: if omitted, playerFeeBalance is skipped for this settlement.
   */
  assetDbId?: number;
  metadata?: Record<string, unknown>;
}

// ─── Result types ─────────────────────────────────────────────────────────────

export interface ReservationResult {
  orderId: string;
  userId: string;
  reservedAmount: string;
  availableBalance: string;
  lockedBalance: string;
}

export interface ReleaseResult {
  orderId: string;
  userId: string;
  releasedAmount: string;
  availableBalance: string;
  lockedBalance: string;
  reason: string;
}

export interface SettlementResult {
  tradeId: string;
  buyOrderId: string;
  sellOrderId: string;
  grossAmountGS: string;
  releasedAmount: string;
  buyer: {
    userId: string;
    lockedConsumed: string;
    newLockedBalance: string;
    newTotalBalance: string;
    newAvailableBalance: string;
  };
  seller: {
    userId: string;
    credited: string;
    newAvailableBalance: string;
    newTotalBalance: string;
  };
  /** true = already settled, operation was a no-op */
  idempotent: boolean;
}

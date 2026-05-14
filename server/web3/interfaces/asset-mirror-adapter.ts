/**
 * AssetMirrorAdapter — Interface Contract
 *
 * Defines the contract for mirroring GamerStock in-game events on-chain.
 * "Mirroring" means recording provable events on a public ledger without
 * changing the in-game state — the canonical record stays in PostgreSQL.
 *
 * ─── Mirroring vs. On-chain ownership ───────────────────────────────────────
 * Phase 8 is MIRROR-only (event recording), not full tokenization.
 * Full tokenization (ERC-1155 player shares, on-chain AMM) is a separate phase.
 *
 * ─── What can be mirrored (future) ──────────────────────────────────────────
 * mirrorTrade()          → emit a TradeEvent on-chain (who bought/sold what)
 * mirrorTreasuryCredit() → record a fee credit in the on-chain treasury
 * mirrorSeasonReward()   → record Arena season rewards on-chain for provability
 *
 * ─── Why mirror? ────────────────────────────────────────────────────────────
 * - Provable trade history (non-repudiable audit trail)
 * - Future: player "ownership certificates" that exist outside GamerStock
 * - Future: composability with DeFi (collateralize player shares, etc.)
 *
 * ─── Schema extension (Phase 9+) ────────────────────────────────────────────
 * Will require a `mirror_events` table (txHash, eventType, payload, status).
 * No schema changes in Phase 8.
 */

export type MirrorStatus = "PENDING" | "SUBMITTED" | "CONFIRMED" | "SKIPPED" | "FAILED";

export interface MirrorResult {
  mirrorId: string;
  eventType: string;
  status: MirrorStatus;
  txHash?: string;
  submittedAt?: Date;
  confirmedAt?: Date;
  error?: string;
}

export interface AssetMirrorAdapter {
  /**
   * Mirror a completed trade on-chain.
   * Records: who traded, which asset, direction, shares, price, timestamp.
   * Does NOT modify on-chain asset ownership — pure event recording.
   */
  mirrorTrade(params: {
    tradeId: number;
    userId: string;
    puuid: string;
    type: "BUY" | "SELL";
    shares: number;
    executionPrice: number;
    occurredAt: Date;
  }): Promise<MirrorResult>;

  /**
   * Mirror a treasury fee credit on-chain.
   * Records: assetId, playerFee amount, timestamp.
   */
  mirrorTreasuryCredit(params: {
    assetId: number;
    playerFee: number;
    platformFee: number;
    tradeId: number;
    occurredAt: Date;
  }): Promise<MirrorResult>;

  /**
   * Mirror an Arena season reward on-chain for provability.
   * Records: userId, season, reward amount, reward type.
   */
  mirrorSeasonReward(params: {
    userId: string;
    seasonId: number;
    rewardType: string;
    rewardValue: number;
    occurredAt: Date;
  }): Promise<MirrorResult>;

  /**
   * Check the mirror status of a previously submitted event.
   */
  getMirrorStatus(mirrorId: string): Promise<MirrorResult | null>;

  /**
   * Whether the adapter is currently active (has a working RPC connection).
   * Used by health checks. Returns false in Phase 8 (not yet implemented).
   */
  isActive(): Promise<boolean>;
}

/**
 * GamerStock — Prediction Trade Model (Phase 1 types)
 *
 * This file introduces the semantic types and constants for the new GS trade
 * engine. No execution logic lives here — only contracts. The existing
 * placeOrder / settlement flow is untouched; these types are meant to coexist
 * and guide the future executeTrade implementation.
 *
 * Official product rules (Phase 1):
 *   - Each market has 2 tradable sides (prediction_outcomes).
 *   - Users trade ONE side per action.
 *   - Valid actions: BUY or SELL.
 *   - Primary input: amountUsd.
 *   - Shares derived as: shares = amountUsd / price.
 *   - Order type (initial): MARKET only.
 *   - Settlement is binary:
 *       winning side  → 1.00 GS$ per share
 *       losing side   → 0.00 GS$ per share
 *   - GS fee applies to profit at settlement only (NOT implemented in Phase 1).
 *
 * Semantic note:
 *   prediction_outcome rows ARE the tradable sides at the product layer.
 *   In user-facing contexts, treat each outcome as a TradableSide.
 */

// ── Trade action ──────────────────────────────────────────────────────────────

/** The two directions a user can trade on a market side. */
export type TradeAction = "BUY" | "SELL";

export const TRADE_ACTIONS = ["BUY", "SELL"] as const satisfies readonly TradeAction[];

// ── Order type ────────────────────────────────────────────────────────────────

/** Supported order types. MARKET is the only type in Phase 1. */
export type TradeOrderType = "MARKET";

export const TRADE_ORDER_TYPES = ["MARKET"] as const satisfies readonly TradeOrderType[];

// ── Tradable side (prediction_outcome as product concept) ─────────────────────

/**
 * A TradableSide is a thin product-layer projection of a prediction_outcome.
 * Use this type when passing side information between trade-related services.
 */
export interface TradableSide {
  /** prediction_outcomes.id */
  outcomeId: number;
  /** "yes" | "no" or any outcome code used in the market */
  code:  string;
  /** Display label, e.g. "Team A wins" */
  label: string;
  /** Current implied probability [0, 1] — null if unavailable */
  impliedProbability: number | null;
  /** Current market price in GS$ per share — null if unavailable */
  price: number | null;
}

// ── Trade intent (payload for future executeTrade) ────────────────────────────

/**
 * TradeIntent represents a user's intention to execute a trade.
 * This will become the validated input to executeTrade() in a future phase.
 *
 * NOT used by placeOrder — coexists with the existing flow.
 */
export interface TradeIntent {
  /** The user placing the trade */
  userId: string;
  /** The market being traded */
  marketId: number;
  /** The specific side (outcome) the user is trading */
  outcomeId: number;
  /** BUY or SELL */
  action: TradeAction;
  /** Nominal amount in GS$ the user wants to spend (BUY) or receive (SELL) */
  amountUsd: number;
  /** Order type — MARKET only in Phase 1 */
  orderType: TradeOrderType;
  /**
   * Client-supplied idempotency key.
   * Re-submitting the same key returns the original result without side effects.
   */
  idempotencyKey: string;
}

// ── Settlement constants ───────────────────────────────────────────────────────

/** Value of one winning share at settlement, in GS$. */
export const SETTLEMENT_WINNING_SHARE_VALUE = 1.0;

/** Value of one losing share at settlement, in GS$. */
export const SETTLEMENT_LOSING_SHARE_VALUE = 0.0;

/**
 * GamerStock — Domain Events
 *
 * Strongly-typed event envelope definitions for the internal domain event bus.
 * These are pure data structures — no side effects here.
 *
 * Design principles:
 *  - Every event is immutable: created once, read many times.
 *  - Every event carries enough context for handlers to act without querying DB.
 *  - No external dependencies (plain TypeScript).
 *
 * ─── Event catalogue ───────────────────────────────────────────────────────
 *  TradeExecuted        A trade (buy or sell) was successfully committed.
 *  OrderPlaced          A limit/market order was placed in the order book.
 *  OrderCancelled       An open order was cancelled.
 *  ValuationUpdated     A new fair-value computation was persisted for an asset.
 *  FeeCaptured          Platform/player fee was captured on a trade.
 *  ArenaXpGranted       XP was granted to a user from the Arena engine.
 */

export type DomainEventName =
  | "TradeExecuted"
  | "OrderPlaced"
  | "OrderCancelled"
  | "ValuationUpdated"
  | "FeeCaptured"
  | "ArenaXpGranted";

export interface BaseDomainEvent<T extends DomainEventName> {
  eventName: T;
  occurredAt: Date;
}

// ─── TradeExecuted ────────────────────────────────────────────────────────────
export interface TradeExecutedPayload {
  tradeId: number;
  userId: string;
  puuid: string;
  type: "BUY" | "SELL";
  shares: number;
  executionPrice: number;
  grossValue: number;
  fee: number;
  source: "riot" | "sandbox" | "BOT" | "MANUAL" | string;
  realizedPnl?: number;
  pnlPct?: number;
}

export interface TradeExecutedEvent extends BaseDomainEvent<"TradeExecuted"> {
  payload: TradeExecutedPayload;
}

// ─── OrderPlaced ──────────────────────────────────────────────────────────────
export interface OrderPlacedPayload {
  orderId: number;
  userId: string;
  puuid: string;
  orderType: "BUY" | "SELL";
  shares: number;
  limitPrice?: number;
}

export interface OrderPlacedEvent extends BaseDomainEvent<"OrderPlaced"> {
  payload: OrderPlacedPayload;
}

// ─── OrderCancelled ───────────────────────────────────────────────────────────
export interface OrderCancelledPayload {
  orderId: number;
  userId: string;
  puuid: string;
}

export interface OrderCancelledEvent extends BaseDomainEvent<"OrderCancelled"> {
  payload: OrderCancelledPayload;
}

// ─── ValuationUpdated ─────────────────────────────────────────────────────────
export interface ValuationUpdatedPayload {
  puuid: string;
  fairValueGS: number;
  divergencePct: number;
  confidenceScore: number;
  recentPerformance?: number | null;
}

export interface ValuationUpdatedEvent extends BaseDomainEvent<"ValuationUpdated"> {
  payload: ValuationUpdatedPayload;
}

// ─── FeeCaptured ─────────────────────────────────────────────────────────────
export interface FeeCapturedPayload {
  tradeId:      number;
  assetId:      number;
  notional:     number;
  feeTotal:     number;
  platformFee:  number;
  playerFee:    number;
  liquidityFee: number;
  currency:     "GS" | "USDC";
}

export interface FeeCapturedEvent extends BaseDomainEvent<"FeeCaptured"> {
  payload: FeeCapturedPayload;
}

// ─── ArenaXpGranted ──────────────────────────────────────────────────────────
export interface ArenaXpGrantedPayload {
  userId: string;
  xpAmount: number;
  reason: string;
  triggeredBy: "trade" | "duel" | "season" | "system";
}

export interface ArenaXpGrantedEvent extends BaseDomainEvent<"ArenaXpGranted"> {
  payload: ArenaXpGrantedPayload;
}

// ─── Union ────────────────────────────────────────────────────────────────────
export type DomainEvent =
  | TradeExecutedEvent
  | OrderPlacedEvent
  | OrderCancelledEvent
  | ValuationUpdatedEvent
  | FeeCapturedEvent
  | ArenaXpGrantedEvent;

// ─── Factory helpers ──────────────────────────────────────────────────────────
export function createTradeExecutedEvent(payload: TradeExecutedPayload): TradeExecutedEvent {
  return { eventName: "TradeExecuted", occurredAt: new Date(), payload };
}

export function createOrderPlacedEvent(payload: OrderPlacedPayload): OrderPlacedEvent {
  return { eventName: "OrderPlaced", occurredAt: new Date(), payload };
}

export function createOrderCancelledEvent(payload: OrderCancelledPayload): OrderCancelledEvent {
  return { eventName: "OrderCancelled", occurredAt: new Date(), payload };
}

export function createValuationUpdatedEvent(payload: ValuationUpdatedPayload): ValuationUpdatedEvent {
  return { eventName: "ValuationUpdated", occurredAt: new Date(), payload };
}

export function createFeeCapturedEvent(payload: FeeCapturedPayload): FeeCapturedEvent {
  return { eventName: "FeeCaptured", occurredAt: new Date(), payload };
}

export function createArenaXpGrantedEvent(payload: ArenaXpGrantedPayload): ArenaXpGrantedEvent {
  return { eventName: "ArenaXpGranted", occurredAt: new Date(), payload };
}

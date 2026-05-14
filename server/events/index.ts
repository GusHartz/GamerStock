/**
 * server/events — Public API + Bootstrap
 *
 * This module is the single entry point for the GamerStock domain event system.
 * Call registerAllHandlers() once at server startup (server/index.ts).
 *
 * ─── What is exported ─────────────────────────────────────────────────────
 * eventBus              The singleton in-memory event bus.
 * createXxxEvent()      Factory helpers for constructing typed events.
 * registerAllHandlers() Wires all domain handlers to the bus.
 *
 * ─── Usage in service code ────────────────────────────────────────────────
 *   import { eventBus, createTradeExecutedEvent } from "../events";
 *   eventBus.emitBackground(createTradeExecutedEvent({ ... }));
 */

export { eventBus } from "./event-bus";

export {
  createTradeExecutedEvent,
  createOrderPlacedEvent,
  createOrderCancelledEvent,
  createValuationUpdatedEvent,
  createFeeCapturedEvent,
  createArenaXpGrantedEvent,
} from "./domain-events";

export type {
  DomainEvent,
  DomainEventName,
  TradeExecutedPayload,
  OrderPlacedPayload,
  OrderCancelledPayload,
  ValuationUpdatedPayload,
  FeeCapturedPayload,
  ArenaXpGrantedPayload,
} from "./domain-events";

import { eventBus } from "./event-bus";
import { handleTradeExecutedForArena, handleArenaXpGranted } from "./handlers/arena-event-handlers";
import { handleTradeExecutedForMarket, handleOrderPlaced, handleOrderCancelled } from "./handlers/market-event-handlers";
import { handleValuationUpdated } from "./handlers/valuation-event-handlers";
import { handleFeeCaptured } from "./handlers/treasury-event-handlers";

/**
 * Register all domain event handlers.
 * Must be called once at server startup, before any requests are served.
 */
export function registerAllHandlers(): void {
  // ── TradeExecuted ──────────────────────────────────────────────────────
  // SHADOW: arena handler observes but does not duplicate XP grant
  eventBus.on("TradeExecuted", "arena:shadow-observe", handleTradeExecutedForArena);
  eventBus.on("TradeExecuted", "market:observe",       handleTradeExecutedForMarket);

  // ── Orders ─────────────────────────────────────────────────────────────
  eventBus.on("OrderPlaced",    "market:order-placed",    handleOrderPlaced);
  eventBus.on("OrderCancelled", "market:order-cancelled", handleOrderCancelled);

  // ── ValuationUpdated ───────────────────────────────────────────────────
  // ACTIVE: valuation events are emitted from computeAndPersistValuation()
  eventBus.on("ValuationUpdated", "valuation:observe", handleValuationUpdated);

  // ── FeeCaptured ────────────────────────────────────────────────────────
  // SHADOW: handler ready, emitter not yet wired (see treasury-event-handlers.ts)
  eventBus.on("FeeCaptured", "treasury:observe", handleFeeCaptured);

  // ── ArenaXpGranted ─────────────────────────────────────────────────────
  eventBus.on("ArenaXpGranted", "arena:xp-audit", handleArenaXpGranted);

  console.log("[EventBus] All domain event handlers registered:", eventBus.snapshot());
}

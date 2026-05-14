/**
 * Market Domain — Event Handlers
 *
 * Listens for domain events that affect the market layer.
 *
 * ─── Phase 7 status ───────────────────────────────────────────────────────
 * OBSERVATION MODE: Handlers registered but perform no state mutation.
 * Useful for:
 *  - Future: invalidating market price caches on OrderCancelled
 *  - Future: updating volume stats on TradeExecuted without a DB query
 *  - Future: broadcasting WS push on high-volume events
 *
 * Phase 8+ migration path:
 *  - Move the marketHub.broadcastTrade() call from tradeExecutor.ts into
 *    handleTradeExecutedForMarket() once the event carries the full payload.
 *  - Move daily volume tracking here instead of inline in the executor.
 */

import type { TradeExecutedEvent, OrderPlacedEvent, OrderCancelledEvent } from "../domain-events";

export async function handleTradeExecutedForMarket(event: TradeExecutedEvent): Promise<void> {
  if (process.env.EVENTS_DEBUG === "true") {
    console.debug(
      `[MarketHandler] TradeExecuted — puuid=${event.payload.puuid} ` +
      `type=${event.payload.type} shares=${event.payload.shares} ` +
      `price=${event.payload.executionPrice.toFixed(4)} gross=${event.payload.grossValue.toFixed(4)}`
    );
  }
}

export async function handleOrderPlaced(event: OrderPlacedEvent): Promise<void> {
  if (process.env.EVENTS_DEBUG === "true") {
    console.debug(
      `[MarketHandler] OrderPlaced — orderId=${event.payload.orderId} ` +
      `puuid=${event.payload.puuid} type=${event.payload.orderType}`
    );
  }
}

export async function handleOrderCancelled(event: OrderCancelledEvent): Promise<void> {
  if (process.env.EVENTS_DEBUG === "true") {
    console.debug(
      `[MarketHandler] OrderCancelled — orderId=${event.payload.orderId} ` +
      `puuid=${event.payload.puuid}`
    );
  }
}

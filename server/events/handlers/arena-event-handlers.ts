/**
 * Arena Domain — Event Handlers
 *
 * Listens for domain events and applies Arena-side side-effects.
 *
 * ─── Integration mode (Phase 7) ───────────────────────────────────────────
 * SHADOW MODE for TradeExecuted:
 *   The direct call to updateArenaOnTrade() inside tradeExecutor.ts and
 *   trading/routes.ts is still active. This handler runs in PARALLEL
 *   via the event bus — it currently does nothing extra beyond logging
 *   in debug mode. This ensures:
 *   (a) No duplicate XP is granted (handler is observation-only for now).
 *   (b) The wire is proven before we cut the direct call in Phase 8.
 *
 * Phase 8 migration path:
 *   1. Move the updateArenaOnTrade() call from tradeExecutor.ts into this handler.
 *   2. Remove the direct import of updateArenaOnTrade from tradeExecutor.ts.
 *   3. Remove the direct import from trading/routes.ts.
 */

import type { TradeExecutedEvent, ArenaXpGrantedEvent } from "../domain-events";

/**
 * SHADOW: Receives TradeExecuted events. Currently observes only.
 * Direct call to updateArenaOnTrade() in tradeExecutor.ts remains the
 * authoritative path for Arena XP until Phase 8.
 */
export async function handleTradeExecutedForArena(event: TradeExecutedEvent): Promise<void> {
  const { userId, type, realizedPnl, pnlPct, source, puuid } = event.payload;

  if (process.env.EVENTS_DEBUG === "true") {
    console.debug(
      `[ArenaHandler:shadow] TradeExecuted observed — user=${userId} type=${type} ` +
      `source=${source} puuid=${puuid} pnl=${realizedPnl?.toFixed(2) ?? "n/a"}`
    );
  }

  // SHADOW MODE: no additional action taken.
  // When Phase 8 migrates the direct call here, this handler will call:
  //   await updateArenaOnTrade({ userId, tradeType: type, realizedPnl, pnlPct, meta: { source, puuid } });
}

/**
 * Receives ArenaXpGranted events emitted by the Arena engine.
 * Currently observes only — structured for future persistence/audit.
 */
export async function handleArenaXpGranted(event: ArenaXpGrantedEvent): Promise<void> {
  if (process.env.EVENTS_DEBUG === "true") {
    console.debug(
      `[ArenaHandler] ArenaXpGranted — user=${event.payload.userId} ` +
      `xp=${event.payload.xpAmount} reason=${event.payload.reason}`
    );
  }
}

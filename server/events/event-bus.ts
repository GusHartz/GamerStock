/**
 * GamerStock — Internal Event Bus
 *
 * A lightweight, in-process, synchronous event bus.
 *
 * Design:
 *  - No external dependencies (no Redis, no Kafka, no message queues).
 *  - Synchronous dispatch by default — handlers run inline during emit().
 *    This preserves existing request-cycle timing expectations.
 *  - Async handlers are fire-and-forget (errors are caught and logged,
 *    never propagated to the emitting caller).
 *  - Multiple handlers per event are supported (fan-out).
 *  - Handler registration is idempotent by name: re-registering a handler
 *    with the same name replaces the previous one.
 *
 * Usage:
 *  // Register (once at startup, in server/events/index.ts):
 *  eventBus.on("TradeExecuted", "arena:xp-grant", handleTradeForArena);
 *
 *  // Emit (in service code):
 *  eventBus.emit(createTradeExecutedEvent({ ... }));
 */

import type { DomainEvent, DomainEventName } from "./domain-events";

export type EventHandler<E extends DomainEvent = DomainEvent> = (
  event: E
) => void | Promise<void>;

interface RegisteredHandler {
  name: string;
  handler: EventHandler<any>;
}

class EventBus {
  private readonly handlers = new Map<DomainEventName, RegisteredHandler[]>();
  private _debugMode = false;

  enableDebug() { this._debugMode = true; }
  disableDebug() { this._debugMode = false; }

  /**
   * Register a handler for a specific event type.
   * @param eventName  The domain event name to subscribe to.
   * @param handlerName  A unique human-readable key (used for logging + dedup).
   * @param handler  The function to call when the event fires.
   */
  on<E extends DomainEvent>(
    eventName: DomainEventName,
    handlerName: string,
    handler: EventHandler<E>
  ): void {
    if (!this.handlers.has(eventName)) {
      this.handlers.set(eventName, []);
    }
    const list = this.handlers.get(eventName)!;
    const existing = list.findIndex(h => h.name === handlerName);
    if (existing >= 0) {
      list[existing] = { name: handlerName, handler };
    } else {
      list.push({ name: handlerName, handler });
    }
    if (this._debugMode) {
      console.debug(`[EventBus] Registered handler "${handlerName}" for "${eventName}"`);
    }
  }

  /**
   * Unregister a handler by name.
   */
  off(eventName: DomainEventName, handlerName: string): void {
    const list = this.handlers.get(eventName);
    if (!list) return;
    const idx = list.findIndex(h => h.name === handlerName);
    if (idx >= 0) list.splice(idx, 1);
  }

  /**
   * Emit an event. All registered handlers are called sequentially.
   * Async handlers are awaited; errors are caught and logged but never thrown.
   * Returns a Promise that resolves when all handlers have settled.
   */
  async emit(event: DomainEvent): Promise<void> {
    const list = this.handlers.get(event.eventName);
    if (!list || list.length === 0) return;

    if (this._debugMode) {
      console.debug(`[EventBus] emit "${event.eventName}" → ${list.length} handler(s)`);
    }

    for (const { name, handler } of list) {
      try {
        const result = handler(event);
        if (result && typeof result.then === "function") {
          await result;
        }
      } catch (err: any) {
        console.error(`[EventBus] Handler "${name}" for "${event.eventName}" threw:`, err?.message ?? err);
      }
    }
  }

  /**
   * Same as emit() but never awaited — fire-and-forget for call sites that
   * cannot be async (e.g., synchronous Express middleware).
   * Errors are still caught and logged.
   */
  emitBackground(event: DomainEvent): void {
    this.emit(event).catch(err => {
      console.error(`[EventBus] Background emit "${event.eventName}" failed:`, err?.message ?? err);
    });
  }

  /**
   * List all registered handler names for a given event (for observability).
   */
  listHandlers(eventName: DomainEventName): string[] {
    return (this.handlers.get(eventName) ?? []).map(h => h.name);
  }

  /**
   * Snapshot of all registered handlers (for diagnostics / admin).
   */
  snapshot(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const [name, handlers] of this.handlers.entries()) {
      out[name] = handlers.map(h => h.name);
    }
    return out;
  }

  /**
   * Remove all registered handlers. Useful for test teardown.
   */
  reset(): void {
    this.handlers.clear();
  }
}

export const eventBus = new EventBus();

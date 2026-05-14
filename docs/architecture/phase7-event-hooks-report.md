# Phase 7 — Internal Domain Event Hooks Report

**Date:** 2026-03-09  
**Status:** ✅ Complete — server boots clean, event bus live, 2 emitters wired, no breaking changes

---

## Objective

Create a lightweight, in-process, synchronous domain event bus that decouples core GamerStock services (market, arena, valuation, treasury) without introducing external messaging infrastructure, changing payloads, modifying schemas, or altering observable behavior.

---

## Architecture Created

```
server/events/
  domain-events.ts          ← Typed event definitions + factory helpers
  event-bus.ts              ← In-memory event bus (singleton)
  handlers/
    arena-event-handlers.ts      ← TradeExecuted, ArenaXpGranted
    market-event-handlers.ts     ← TradeExecuted, OrderPlaced, OrderCancelled
    valuation-event-handlers.ts  ← ValuationUpdated
    treasury-event-handlers.ts   ← FeeCaptured
  index.ts                  ← Public API + registerAllHandlers()
```

---

## Events Created

| Event | Payload Fields | Status |
|---|---|---|
| `TradeExecuted` | tradeId, userId, puuid, type, shares, executionPrice, grossValue, fee, source, realizedPnl?, pnlPct? | ✅ Emitted from `tradeExecutor.ts` |
| `OrderPlaced` | orderId, userId, puuid, orderType, shares, limitPrice? | ✅ Type defined, handler registered |
| `OrderCancelled` | orderId, userId, puuid | ✅ Type defined, handler registered |
| `ValuationUpdated` | puuid, fairValueGS, divergencePct, confidenceScore, recentPerformance | ✅ Emitted from `valuationJob.ts` |
| `FeeCaptured` | tradeId, assetId, feeTotal, platformFee, playerFee, notional | ⏳ Shadow mode: handler registered, emitter deferred to Phase 8 |
| `ArenaXpGranted` | userId, xpAmount, reason, triggeredBy | ✅ Type defined, handler registered |

All events extend a `BaseDomainEvent<T>` interface carrying `eventName` and `occurredAt: Date`.

---

## Event Bus — Design

**File:** `server/events/event-bus.ts`  
**Instance:** `eventBus` (singleton, created once at module load)

Key characteristics:
- **In-memory** — no external dependencies
- **Synchronous fan-out** — handlers are called sequentially within a single `async emit()` call
- **Fire-and-forget path** — `emitBackground()` wraps `emit()` in a `.catch()` so errors never propagate to the caller
- **Error isolation** — each handler is individually try/caught; one failing handler does not block others
- **Named handlers** — registration is idempotent by `handlerName` (re-registering replaces)
- **Observability** — `snapshot()` returns a map of all registered handlers (used for the boot log)
- **Debug mode** — set `EVENTS_DEBUG=true` env var for per-event/handler trace logs

---

## Handlers Created

### `arena-event-handlers.ts`
| Handler name | Event | Mode |
|---|---|---|
| `arena:shadow-observe` | `TradeExecuted` | **SHADOW** — observes only; direct `updateArenaOnTrade()` call in `tradeExecutor.ts` remains authoritative |
| `arena:xp-audit` | `ArenaXpGranted` | Observation only |

### `market-event-handlers.ts`
| Handler name | Event | Mode |
|---|---|---|
| `market:observe` | `TradeExecuted` | Observation only |
| `market:order-placed` | `OrderPlaced` | Observation only |
| `market:order-cancelled` | `OrderCancelled` | Observation only |

### `valuation-event-handlers.ts`
| Handler name | Event | Mode |
|---|---|---|
| `valuation:observe` | `ValuationUpdated` | **ACTIVE** — receives real events emitted by `computeAndPersistValuation()` |

### `treasury-event-handlers.ts`
| Handler name | Event | Mode |
|---|---|---|
| `treasury:observe` | `FeeCaptured` | **SHADOW** — handler ready, emitter not yet wired |

---

## Integration Points — Where Events Are Emitted

### 1. `server/services/tradeExecutor.ts` — `executeRiotTrade()`

**Event:** `TradeExecuted`  
**Mode:** Shadow alongside existing direct call

```typescript
// EXISTING (unchanged — still authoritative):
updateArenaOnTrade({ ... }).catch(() => {});

// NEW — event emission (shadow mode):
eventBus.emitBackground(createTradeExecutedEvent({
  tradeId: resultTrade.id,
  userId, puuid, type, shares,
  executionPrice, grossValue, fee, source,
  realizedPnl: riotRealizedPnl,
  pnlPct: riotPnlPct,
}));
```

The direct `updateArenaOnTrade()` call is preserved. The event emission is additive and fire-and-forget via `emitBackground()`. No timing or behavior change.

### 2. `server/services/valuationJob.ts` — `computeAndPersistValuation()`

**Event:** `ValuationUpdated`  
**Mode:** Active (non-mutating)

```typescript
// After DB upsert + console.log at end of computeAndPersistValuation():
eventBus.emitBackground(createValuationUpdatedEvent({
  puuid,
  fairValueGS,
  divergencePct,
  confidenceScore,
  recentPerformance,
}));
```

Emitted on every successful valuation computation. Handler currently observes (logs in debug mode). The valuation job's own DB persistence is untouched.

---

## Shadow Mode — What's Not Yet Wired

| Deferred Item | Reason | Phase |
|---|---|---|
| `FeeCaptured` emitter | Requires extracting `assetId` from inside the DB transaction scope in `tradeExecutor.ts`; requires a careful transaction boundary inspection — low risk but deferred for safety | Phase 8 |
| Cut direct `updateArenaOnTrade()` in `tradeExecutor.ts` | Shadow mode needs to prove reliability before direct call is removed | Phase 8 |
| `OrderPlaced` / `OrderCancelled` emitters | Order placement in routes.ts not yet wired; events defined and handlers ready | Phase 8 |
| Sandbox trade `TradeExecuted` | `trading/routes.ts` inline sandbox trade handler not yet emitting events | Phase 8 |

---

## Bootstrap — `server/index.ts`

`registerAllHandlers()` is called once at startup, before routes are registered:

```typescript
attachMarketWs(httpServer);
registerAllHandlers();          // ← Phase 7 addition
await registerRoutes(httpServer, app);
```

Boot log output (confirmed live):
```
[EventBus] All domain event handlers registered: {
  TradeExecuted: [ 'arena:shadow-observe', 'market:observe' ],
  OrderPlaced: [ 'market:order-placed' ],
  OrderCancelled: [ 'market:order-cancelled' ],
  ValuationUpdated: [ 'valuation:observe' ],
  FeeCaptured: [ 'treasury:observe' ],
  ArenaXpGranted: [ 'arena:xp-audit' ]
}
```

---

## No Breaking Changes — Confirmation

- ✅ All existing direct calls preserved (`updateArenaOnTrade`, etc.)
- ✅ No payload changes
- ✅ No schema changes
- ✅ No DB changes
- ✅ Event emission is fire-and-forget (`emitBackground`) — never blocks the request path
- ✅ Handler errors are individually caught and logged — never propagate to callers
- ✅ Server boots clean, zero startup errors
- ✅ All existing API routes respond normally

---

## Phase 8 — Recommended Next Steps

1. **Cut `updateArenaOnTrade` direct call from `tradeExecutor.ts`** — move the call into `arena-event-handlers.ts:handleTradeExecutedForArena()`. Remove the direct `arena` import from `tradeExecutor.ts`. This is the first true domain decoupling.

2. **Emit `FeeCaptured`** — after the `feeLedger.insert` inside the `tradeExecutor.ts` transaction, extract `assetId` and emit the event. This enables real-time treasury aggregation in `treasury-event-handlers.ts`.

3. **Emit `OrderPlaced` / `OrderCancelled`** — in the order management routes. These are the lowest-risk events to wire since order routes are read-heavy.

4. **Emit `TradeExecuted` from sandbox trade path** — `server/domains/trading/routes.ts` sandbox flow.

5. **Emit `ArenaXpGranted`** from `arena.ts` — after XP is granted, emit the event for audit/observability. This enables Arena stats to be consumed by multiple handlers without Arena needing to know who's listening.

6. **Add admin endpoint** — `GET /api/admin/events/handlers` returning `eventBus.snapshot()` for live observability of the event bus state.

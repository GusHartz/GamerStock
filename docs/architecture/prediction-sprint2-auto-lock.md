# Prediction Markets — Sprint 2: Auto-Lock Scheduler

## Overview

When a prediction market's `closeAt` timestamp elapses, the market should stop accepting
orders and transition to `"locked"` so an admin can then resolve and settle it.

Two complementary mechanisms enforce this:

1. **Auto-lock scheduler** — background job that periodically locks expired markets.
2. **Runtime order placement guard** — rejects orders on non-open or expired markets
   even if the scheduler has not run yet.

---

## Scheduler Pattern Reused

Matches `server/scheduler/market-sync-scheduler.ts` exactly:
- Single file with all logic encapsulated
- `let schedulerStarted = false` guard prevents double-start on hot reload
- Exported `start*()` function called once from `server/index.ts` in the boot block
- Uses `setInterval` with a plain async function — no external cron library required

```typescript
// server/scheduler/market-sync-scheduler.ts (existing pattern)
export function startMarketSyncScheduler() {
  setInterval(runSync, INTERVAL_MS);
}

// server/scheduler/prediction-auto-lock.ts (new — same pattern)
export function startPredictionAutoLockScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  runAutoLock(); // immediate boot pass
  setInterval(() => runAutoLock(), INTERVAL_MS);
}
```

Registered in `server/index.ts`:
```typescript
import { startPredictionAutoLockScheduler } from "./scheduler/prediction-auto-lock";

// In boot callback:
startPredictionAutoLockScheduler();
```

---

## How Auto-Lock Works

### Interval

Default: **60 seconds**. Configurable via `PREDICTION_AUTOLOCK_INTERVAL_MS` environment variable.

### On boot

An immediate lock pass runs at server startup to catch any markets that expired while
the server was offline (e.g. overnight restart, deploy gap).

### Each tick

1. Query `prediction_markets` for rows where:
   - `status = 'open'`
   - `closes_at IS NOT NULL`
   - `closes_at <= NOW()`

2. For each lockable market, call `predictionService.transitionMarketStatus()` with
   `targetStatus: "locked"` and `actorUserId: "auto_lock_scheduler"`.
   The transition function enforces the lifecycle guard (`open → locked` is valid;
   `locked → locked` would fail and be logged as a warning — safe to ignore on retry).

3. Log how many markets were locked this run.

### Operational state (in-process, non-persisted)

The scheduler exposes `getPredictionAutoLockState()` which returns:

```json
{
  "enabled":          true,
  "lastRunAt":        "2026-03-14T12:30:00.000Z",
  "lastLockedCount":  2,
  "totalLocked":      5,
  "runCount":         14
}
```

This is included in `GET /api/predictions/health` under the `autoLock` key.
State resets to zero on process restart — it is operational metadata, not audit data.

---

## Why Runtime Validation Still Exists

The scheduler runs every 60 seconds by default. A market whose `closeAt` is `T` might
still accept orders for up to 60 seconds after `T` if the scheduler hasn't run yet.

The runtime guard in `placeOrder()` catches this gap:

```typescript
// In placeOrder() — service.ts
if (market.status !== "open") {
  return { error: `Market is not open. Current status: ${market.status}.` };
}
if (market.closeAt && new Date() >= new Date(market.closeAt)) {
  return { error: "Market has expired — betting period is closed." };
}
```

**Both checks must remain.** The scheduler reduces the window for stale-open markets to
appear in listings; the runtime guard closes that window to zero for order placement.

---

## Statuses Rejected by Order Placement

`placeOrder()` rejects any market that is not `"open"`:

| Market status | Order placement result |
|---|---|
| `draft` | ❌ 422 — `"Market is not open for betting. Current status: draft."` |
| `open` + `closeAt` elapsed | ❌ 422 — `"Market has expired — betting period is closed."` |
| `locked` | ❌ 422 — `"Market is not open for betting. Current status: locked."` |
| `resolved` | ❌ 422 — `"Market is not open for betting. Current status: resolved."` |
| `settled` | ❌ 422 — `"Market is not open for betting. Current status: settled."` |
| `cancelled` | ❌ 422 — `"Market is not open for betting. Current status: cancelled."` |
| `open` + `closeAt` in future (or null) | ✅ Order accepted |

The check `market.status !== "open"` is a single guard that covers all non-open statuses.
The `closeAt` check adds the temporal expiry guard independently of DB status.

---

## Files Created / Modified

| File | Change |
|---|---|
| `server/scheduler/prediction-auto-lock.ts` | New — scheduler with `startPredictionAutoLockScheduler()` |
| `server/domains/prediction/repository.ts` | Added `findLockableMarkets()` |
| `server/domains/prediction/routes.ts` | Health endpoint now includes `autoLock` state |
| `server/index.ts` | Import + call `startPredictionAutoLockScheduler()` at boot |
| `docs/architecture/prediction-sprint2-auto-lock.md` | This document |

---

## Operational Assumptions

- Markets without a `closeAt` are never auto-locked (they require manual admin action).
- The job does not create settlement rows — locking only blocks new orders.
  Resolution and settlement remain a separate admin action via `POST /markets/:id/resolve`.
- If `transitionMarketStatus` fails for an individual market (e.g. concurrent admin action
  already locked it), the error is logged and the job continues with the next market.
- The job interval is wall-clock based. Under high load or DB contention, a tick may be
  delayed — the runtime guard in order placement is the zero-lag safety net.

---

## Example Verification

### Create a market with closeAt in the past

Use the admin session to create a market with `closeAt` already elapsed:

```bash
# 1. Create event (if needed)
curl -s -b admin_cookies.txt \
  -X POST http://localhost:5000/api/predictions/events \
  -H "Content-Type: application/json" \
  -d '{"title": "Test event","game":"lol"}'

# 2. Create market with closeAt in the past
curl -s -b admin_cookies.txt \
  -X POST http://localhost:5000/api/predictions/markets \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": 1,
    "question": "Will test team win?",
    "marketType": "binary",
    "currency": "GS",
    "closeAt": "2020-01-01T00:00:00Z",
    "outcomes": [{"label":"YES"},{"label":"NO"}]
  }'

# 3. Advance market to "open"
curl -s -b admin_cookies.txt \
  -X POST http://localhost:5000/api/predictions/markets/:id/transition \
  -H "Content-Type: application/json" \
  -d '{"targetStatus":"open"}'
```

### Verify the job locked it

After the scheduler's next tick (≤60 seconds), check the market status:
```bash
curl -s -b admin_cookies.txt http://localhost:5000/api/predictions/markets/:id \
  | jq .status
# Expected: "locked"
```

Or check the health endpoint:
```bash
curl -s http://localhost:5000/api/predictions/health | jq .autoLock
# Expected: { enabled: true, lastLockedCount: 1, totalLocked: 1, ... }
```

### Verify order placement rejects expired markets (runtime guard, no scheduler needed)

```bash
# Create open market with closeAt in the past, then immediately try to order:
curl -s -b user_cookies.txt \
  -X POST http://localhost:5000/api/predictions/orders \
  -H "Content-Type: application/json" \
  -d '{"marketId": <id>, "outcomeId": <id>, "quantity":"5","price":"0.5","currency":"GS"}'

# Expected (even before the scheduler runs):
# { "message": "Market has expired — betting period is closed." }
```

---

## Remaining TODOs (Sprint 3+)

1. **Admin alert on auto-lock**: emit an internal event or admin notification when a market
   is auto-locked so admins know to resolve it promptly.
2. **Persist auto-lock audit log**: write a record to a `prediction_market_events` table
   (new) for each scheduler-triggered lock, including timestamp and actor.
3. **Configurable per-market grace period**: allow markets to define a `lockGracePeriodMs`
   so closeAt can be soft (warn-only) vs hard (immediate lock).
4. **Resolution deadline reminder**: if a market has been locked for >24h with no resolution,
   surface it in the admin dashboard.
5. **Platform rake**: deducted at settlement (Sprint 3).
6. **Cancellation flow**: `locked → cancelled` path with `unlockFunds` per position.

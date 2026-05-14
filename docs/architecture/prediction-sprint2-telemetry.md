# Prediction Markets — Sprint 2: Market Telemetry

## Overview

Every filled prediction order now updates two telemetry stores:

1. **`prediction_price_snapshots`** — append-only time-series tick per fill (existed since Sprint 2 order placement; now fully intentional)
2. **`prediction_market_stats`** — one materialized row per market, upserted on each fill

Both writes are **best-effort / fire-and-forget** — a telemetry failure cannot affect the critical financial flow (wallet lock, order fill, position update).

---

## When Snapshots Are Written

On every successfully filled order (step 8 of the order placement flow, after position is updated):

```
1. Order created (pending)
2. walletService.lockFunds()        ← critical
3. Order → filled, position upserted ← critical
4. [best-effort] insertPriceSnapshot + recordOrderTelemetry ← telemetry
```

If the telemetry block fails (DB error, timeout), a warning is logged and the order response is still returned successfully. The financial state is unaffected.

---

## What Snapshot Price Means Right Now

**`snapshot.price` = accepted execution price from the filled order**

This is NOT:
- An AMM-derived implied probability
- A market-maker quoted price
- A weighted average of recent fills

It IS:
- The exact price the user submitted and the system accepted
- In Sprint 2, price ∈ (0, 1) exclusive — it represents the user's stated implied probability
- The simplest possible auditable price tick for future charting

A richer pricing model (LMSR, pari-mutuel implied probability, VWAP) is deferred to Sprint 3+.

---

## Snapshot Schema

```
prediction_price_snapshots
├── market_id    — which market
├── outcome_id   — which outcome
├── price        — execution price (user-submitted, accepted by system)
├── volume_window — totalValue of this order (qty × price in GS$)
└── recorded_at  — timestamp of insert (DB default NOW())
```

**`volume_window` = order `totalValue` (qty × price)**

Rationale: `totalValue` is the actual GS$ staked on this order — it is the most meaningful
volume unit for a prediction market. Raw `quantity` (number of shares) was rejected because
shares have no common unit across markets with different price levels.

---

## Stats Fields Maintained

| Field | Updated on fill? | How |
|---|---|---|
| `last_price_yes` | ✅ Yes | Set to execution price when `outcome.sortOrder === 0` |
| `last_price_no` | ✅ Yes | Set to execution price when `outcome.sortOrder !== 0` |
| `volume_24h` | ✅ Yes | SQL increment: `volume_24h + totalValue` |
| `traders_24h` | ❌ No — deferred | Requires `COUNT(DISTINCT userId) WHERE createdAt >= NOW() - 24h` |
| `updated_at` | ✅ Yes | Set to current timestamp on every fill |

---

## YES / NO Determination

For binary markets:
- `outcome.sortOrder === 0` → YES slot → updates `last_price_yes`
- `outcome.sortOrder !== 0` → NO slot → updates `last_price_no`

This is the binary market convention established in Sprint 1 (first outcome created = YES).
Fallback: if `sortOrder` is null, defaults to NO slot (safe, never overwrites YES data).

For multi-outcome markets (Sprint 3+): use `outcome.code` ("yes"/"no"/"draw"/etc.) instead
of relying on sortOrder.

---

## Approximations

| Field | Exact or Approximate | Notes |
|---|---|---|
| `snapshot.price` | Approximate — user stated, not market-derived | Acceptable for MVP charting |
| `snapshot.volumeWindow` | Exact | The actual GS$ staked in this order |
| `stats.last_price_yes` | Approximate — last fill only, not VWAP | Good enough for market list display |
| `stats.volume_24h` | **Approximate — cumulative, not rolling** | Grows forever; reset logic deferred to Sprint 3 |
| `stats.traders_24h` | Not maintained | Deferred |

`volume_24h` is the most important approximation to note. It is a **cumulative total** since
the market was created, not a true 24-hour sliding window. It monotonically increases.
A true rolling 24h window requires scanning `prediction_orders` with a timestamp filter on
each fill — feasible but deferred to keep Sprint 2 telemetry cheap.

---

## Failure Tolerance Decision

**Chosen: best-effort `Promise.all` in fire-and-forget wrapper**

```typescript
// In placeOrder() — after position is secured
Promise.all([
  updateMarketPool(...),
  updateOutcomePoolShare(...),
  insertPriceSnapshot(...),          // snapshot write
  recordOrderTelemetry(...),         // stats update
]).catch((err) => {
  console.warn("[Prediction:placeOrder] Non-critical telemetry update failed:", err.message);
});
```

**Why**: The order fill and wallet lock are already committed by the time telemetry runs.
A telemetry DB error cannot be undone, so blocking the response on it adds risk with no benefit.
If the telemetry block fails, a warning appears in logs and can be investigated without
impacting the user's order.

**Alternative considered**: Wrapping in a DB transaction so both financial and telemetry are atomic.
Rejected because: (1) telemetry is not financial-grade data; (2) it would add latency to every order;
(3) existing pattern in this codebase uses best-effort for non-critical writes.

---

## Files Created / Modified

| File | Change |
|---|---|
| `server/domains/prediction/repository.ts` | Added `recordOrderTelemetry()` with SQL increment |
| `server/domains/prediction/service.ts` | Added `recordOrderTelemetry` to best-effort block; documented telemetry model inline |
| `server/domains/prediction/routes.ts` | Health endpoint includes `telemetry` metadata block |
| `docs/architecture/prediction-sprint2-telemetry.md` | This document |

---

## Remaining TODOs (Sprint 3+)

1. **True rolling `volume_24h`**: Replace cumulative with `SUM(totalValue) WHERE createdAt >= NOW() - INTERVAL '24 hours'`.
   Run as a periodic materialized refresh (e.g., every 5 minutes via the auto-lock scheduler tick).

2. **`traders_24h`**: `COUNT(DISTINCT userId) FROM prediction_orders WHERE marketId=X AND createdAt >= NOW() - 24h`.
   Can be added to the periodic refresh job.

3. **Implied probability model**: Derive `snapshot.price` from market pool state rather than
   user-submitted price. LMSR or simple pool ratio: `poolShareOutcome / poolTotal`.

4. **VWAP for `last_price_yes/no`**: Replace last-fill price with volume-weighted average
   over the last N fills for a more stable price signal.

5. **Chart endpoint**: `GET /api/predictions/markets/:id/outcomes/:outcomeId/chart`
   returning `prediction_price_snapshots` paginated for frontend charting.

6. **Stats reset on settlement**: Zero out `volume_24h` and `traders_24h` when market settles,
   or archive them to a `prediction_market_stats_history` table.

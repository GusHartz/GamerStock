# Prediction Markets — Sprint 4.5: Explicit `cancelled_at` Field

## Overview

Prior to this change, the `prediction_positions` table had no dedicated cancellation timestamp. The read path used `updated_at` as a proxy for cancelled positions (since `updatePositionStatus` always touches `updated_at`). This was functional but approximated: if a position were ever updated after cancellation (e.g., by a future migration), `updated_at` would drift.

This sprint adds an explicit `cancelled_at` column to `prediction_positions`, sets it precisely at the moment of cancellation, and updates all read paths to prefer it with a documented fallback for legacy rows.

---

## Why `updated_at` Was Insufficient

`updated_at` is a general-purpose housekeeping column set on every `UPDATE` to the positions row. Using it as a proxy for cancellation time is correct only if nothing else updates the row after cancellation. That holds today, but:

- A future backfill, migration, or data-correction script touching `updated_at` would silently corrupt the displayed `cancelledAt` time.
- The intent is ambiguous — `updated_at` says "this row changed", not "this position was cancelled".
- Observability tools and analytics querying `cancelled_at` directly would return no results and require column-aliasing workarounds.

An explicit `cancelled_at` column removes all ambiguity.

---

## Schema Change

### Column added

```sql
ALTER TABLE prediction_positions
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP;
```

**Drizzle definition** (`shared/schema/prediction.ts`):

```typescript
cancelledAt: timestamp("cancelled_at"),
```

Placed adjacent to `payoutAt` for logical grouping:

```typescript
payoutAt:    timestamp("payout_at"),
cancelledAt: timestamp("cancelled_at"),   // ← added Sprint 4.5
status:      varchar("status", { length: 20 }).notNull().default("active"),
```

**Insert schema:** `cancelledAt` is omitted (system-managed, never set by API callers):

```typescript
export const insertPredictionPositionSchema = createInsertSchema(predictionPositions).omit({
  id: true, payout: true, payoutAt: true, cancelledAt: true, status: true,
  createdAt: true, updatedAt: true,
});
```

---

## Write-Path Change

### Function: `cancelAndRefundMarket` (`server/domains/prediction/service.ts`)

**Before:**
```typescript
await predictionRepository.updatePositionStatus(positionId, "cancelled", {
  payout:      "0.000000",
  payoutAt:    now,
  realizedPnl: "0.000000",
});
```

**After:**
```typescript
await predictionRepository.updatePositionStatus(positionId, "cancelled", {
  payout:      "0.000000",
  payoutAt:    now,
  cancelledAt: now,         // ← Sprint 4.5: explicit cancellation timestamp
  realizedPnl: "0.000000",
});
```

`now` is the `Date` captured at the start of the cancellation transaction — consistent across all positions in the same market cancellation batch.

### Repository: `updatePositionStatus` signature widened

```typescript
// Before
extra: Partial<Pick<PredictionPosition, "payout" | "payoutAt" | "realizedPnl">>

// After
extra: Partial<Pick<PredictionPosition, "payout" | "payoutAt" | "cancelledAt" | "realizedPnl">>
```

No behavioral change for settled positions — they do not pass `cancelledAt`.

---

## Read Fallback Behavior for Legacy Rows

Legacy cancelled rows (positions cancelled before Sprint 4.5 was deployed) have `cancelled_at = NULL`.

The read path in `getMyPortfolio` / `recentHistory` uses:

```typescript
cancelledAt: row.status === "cancelled"
  ? (row.cancelledAt ?? row.updatedAt)    // prefer explicit; fall back to updatedAt
  : null,
```

| Row type | `cancelled_at` value | `cancelledAt` exposed |
|---|---|---|
| Cancelled post-Sprint 4.5 | Explicit timestamp | `row.cancelledAt` |
| Cancelled pre-Sprint 4.5 (legacy) | `NULL` | `row.updatedAt` (fallback) |
| Settled | N/A | `null` |
| Active | N/A | `null` |

The `updated_at` fallback is acceptable for legacy rows because `updated_at` was set at cancellation and is unlikely to be touched again for those rows (cancelled positions are terminal — no further writes in normal operation).

---

## Affected Read Endpoints

| Endpoint | Field | Change |
|---|---|---|
| `GET /api/predictions/me/portfolio` | `recentHistory[].cancelledAt` | Now uses `cancelled_at ?? updated_at` |
| `GET /api/predictions/me/history` | Not exposed (`UserHistoryCard` has no `cancelledAt`) | No change needed |

---

## Backfill Status

**Backfill is optional.** The fallback to `updated_at` covers all legacy rows correctly.

A backfill would only be needed for strict reporting/analytics:

```sql
-- Optional — backfills legacy rows using updated_at as the best available proxy.
-- Safe to run: cancelled_at was NULL, updated_at was the exact time of cancellation.
UPDATE prediction_positions
SET    cancelled_at = updated_at
WHERE  status       = 'cancelled'
  AND  cancelled_at IS NULL;
```

This is **not required** for the application to function correctly.

---

## EnrichedPosition Type Update

`cancelledAt: Date | null` added to `EnrichedPosition` in `server/domains/prediction/types.ts`:

```typescript
payoutAt:    Date | null;
cancelledAt: Date | null;   // Sprint 4.5 — explicit cancellation timestamp; null for legacy rows
```

The repository query `findEnrichedPositionsByUser` was updated to select `predictionPositions.cancelledAt`.

---

## Example Response

### Cancelled position (post-Sprint 4.5 — explicit `cancelledAt`)

```json
{
  "positionId": 10,
  "marketId": 6,
  "marketTitle": "Will team A win the map?",
  "outcomeCode": "YES",
  "status": "cancelled",
  "payout": "0.000000",
  "realizedPnl": "0.000000",
  "payoutAt": null,
  "cancelledAt": "2026-03-15T14:22:07.000Z"
}
```

### Cancelled position (legacy — `cancelledAt` falls back to `updatedAt`)

```json
{
  "positionId": 3,
  "marketId": 3,
  "outcomeCode": "YES",
  "status": "cancelled",
  "cancelledAt": "2026-03-14T12:33:22.269Z"
}
```

`2026-03-14T12:33:22.269Z` is `updated_at` — the time `updatePositionStatus` ran during cancellation.

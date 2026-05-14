# Prediction Markets — Sprint 3: Market Lifecycle Audit Events

## Purpose

Every structural change to a prediction market's lifecycle is now recorded as an immutable row in `prediction_market_events`. This gives the operations team a reliable, queryable timeline for any market — from creation through settlement or cancellation.

The table is **append-only and best-effort**: event writes happen after the primary financial/lifecycle operation completes and never block or roll back it.

---

## Table Shape

**Table:** `prediction_market_events`

| Column        | Type          | Nullable | Description |
|---------------|---------------|----------|-------------|
| `id`          | SERIAL PK     | No       | Auto-increment row ID |
| `market_id`   | INTEGER (FK → prediction_markets.id CASCADE) | No | Market this event belongs to |
| `event_type`  | VARCHAR(50)   | No       | Type of lifecycle event (see below) |
| `from_status` | VARCHAR(30)   | Yes      | Market status before the transition |
| `to_status`   | VARCHAR(30)   | Yes      | Market status after the transition |
| `actor_user_id` | VARCHAR(128) | Yes     | User who triggered the event (null for system events) |
| `source`      | VARCHAR(50)   | Yes      | Origin: `admin`, `scheduler`, `settlement`, `system` |
| `note`        | TEXT          | Yes      | Optional human-readable context |
| `metadata`    | JSONB         | Yes      | Structured context (winningOutcomeId, payout totals, etc.) |
| `created_at`  | TIMESTAMP     | No       | Immutable — defaultNow(), never updated |

**Indexes:** `market_id`, `created_at`, `event_type`

**No `updated_at`** — rows are immutable once written.

---

## Event Types Currently Recorded

| Event Type         | Trigger                                        | Source      | from_status → to_status |
|--------------------|------------------------------------------------|-------------|--------------------------|
| `market_created`   | `createMarket()` succeeds                      | `admin`     | null → `draft` |
| `market_opened`    | `transitionMarketStatus()` → open              | `admin`     | `draft` → `open` |
| `market_locked`    | `transitionMarketStatus()` → locked (manually) | `admin`     | `open` → `locked` |
| `market_auto_locked` | Auto-lock scheduler locks an expired market  | `scheduler` | `open` → `locked` |
| `market_resolved`  | `resolveAndSettleMarket()` step C              | `admin`     | `locked` → `resolved` |
| `market_settled`   | `resolveAndSettleMarket()` step F              | `settlement` | `resolved` → `settled` |
| `market_cancelled` | `cancelAndRefundMarket()` step G               | `admin`     | (varies) → `cancelled` |

### Source Convention

| Source       | Meaning |
|--------------|---------|
| `admin`      | Human operator via the admin REST API |
| `scheduler`  | Background auto-lock scheduler (`startPredictionAutoLockScheduler`) |
| `settlement` | Financial settlement logic inside `resolveAndSettleMarket()` |
| `system`     | Reserved for future automated flows |

### Detection of Scheduler vs Manual Lock

`transitionMarketStatus()` receives `actorUserId: "auto_lock_scheduler"` from the scheduler.
The service uses this sentinel value to:
- Set `event_type = "market_auto_locked"` (vs `market_locked` for manual)
- Set `source = "scheduler"` (vs `admin` for manual)

No interface change was needed — the scheduler already passes this sentinel.

---

## When Events Are Written

Events are written **after** the primary mutation (wallet op, `updateMarketStatus`) completes. The exact call site for each:

| Flow | Call site |
|---|---|
| `createMarket()` | After successful DB insert + console.log |
| `transitionMarketStatus()` | After `updateMarketStatus()` call |
| `resolveAndSettleMarket()` step C | After `locked → resolved` status update |
| `resolveAndSettleMarket()` step F | After `resolved → settled` status update (both zero-positions path and main path) |
| `cancelAndRefundMarket()` step G | After `updateMarketStatus(cancelled)` call |

---

## Failure Tolerance: Best-Effort

**All event writes are best-effort.**

Strategy:
1. The primary operation (wallet mutation, status update) runs and completes.
2. `emitMarketEvent()` is called after the primary operation succeeds.
3. If the event write throws, the error is logged with prefix `[Prediction:event]` and execution continues normally.
4. The primary operation is **not rolled back** by an event write failure.

This means:
- A missing event row indicates an event write failure, not a missing financial operation.
- The financial ledger (`wallet_ledger`) and `prediction_settlements` remain the source of truth for financial state.
- `prediction_market_events` is supplementary operational data.

**Future option:** if stronger consistency is needed, event writes can be moved inside DB transactions alongside `updateMarketStatus` calls (each `updateMarketStatus` is already transactional via Drizzle).

---

## Read Endpoint

```
GET /api/predictions/markets/:id/events
```

**Auth:** Admin-only (`isAdminOnly` guard).

**Response shape:**
```json
{
  "marketId": 4,
  "total": 4,
  "events": [
    {
      "id": 1,
      "marketId": 4,
      "eventType": "market_created",
      "fromStatus": null,
      "toStatus": "draft",
      "actorUserId": "abc-123",
      "source": "admin",
      "note": null,
      "metadata": { "question": "Will Team A win?", "marketType": "binary" },
      "createdAt": "2026-03-14T12:00:00.000Z"
    },
    ...
  ]
}
```

Events are ordered by `created_at ASC` (oldest first = chronological timeline).

---

## Example Event Timelines

### Market: opened → auto-locked → resolved → settled

```
id | event_type         | from_status | to_status | source      | metadata
---|--------------------|-----------  |-----------|-------------|----------------------------
1  | market_created     | null        | draft     | admin       | { question, marketType }
2  | market_opened      | draft       | open      | admin       | null
3  | market_auto_locked | open        | locked    | scheduler   | null
4  | market_resolved    | locked      | resolved  | admin       | { winningOutcomeId: 7 }
5  | market_settled     | resolved    | settled   | settlement  | { positionsSettled: 3, totalWinnerPayout: "21.000000", currency: "GS" }
```

### Market: cancelled (with active positions)

```
id | event_type         | from_status | to_status | source | metadata
---|--------------------|-----------  |-----------|--------|------------------------------------
1  | market_created     | null        | draft     | admin  | { question, marketType }
2  | market_opened      | draft       | open      | admin  | null
3  | market_cancelled   | open        | cancelled | admin  | { positionsCancelled: 2, totalRefunded: "9.300000", currency: "GS" }
```

### Example API Response (market that was resolved and settled)

```
GET /api/predictions/markets/1/events
Authorization: Admin session

200 OK
{
  "marketId": 1,
  "total": 5,
  "events": [
    {
      "id": 1,
      "marketId": 1,
      "eventType": "market_created",
      "fromStatus": null,
      "toStatus": "draft",
      "actorUserId": "guhartz-admin-id",
      "source": "admin",
      "note": null,
      "metadata": { "question": "Will Faker get 10+ kills?", "marketType": "binary" },
      "createdAt": "2026-03-14T10:00:00.000Z"
    },
    {
      "id": 2,
      "marketId": 1,
      "eventType": "market_opened",
      "fromStatus": "draft",
      "toStatus": "open",
      "actorUserId": "guhartz-admin-id",
      "source": "admin",
      "note": null,
      "metadata": null,
      "createdAt": "2026-03-14T10:01:00.000Z"
    },
    {
      "id": 3,
      "marketId": 1,
      "eventType": "market_auto_locked",
      "fromStatus": "open",
      "toStatus": "locked",
      "actorUserId": "auto_lock_scheduler",
      "source": "scheduler",
      "note": null,
      "metadata": null,
      "createdAt": "2026-03-14T11:00:00.000Z"
    },
    {
      "id": 4,
      "marketId": 1,
      "eventType": "market_resolved",
      "fromStatus": "locked",
      "toStatus": "resolved",
      "actorUserId": "guhartz-admin-id",
      "source": "admin",
      "note": null,
      "metadata": { "winningOutcomeId": 2 },
      "createdAt": "2026-03-14T12:00:00.000Z"
    },
    {
      "id": 5,
      "marketId": 1,
      "eventType": "market_settled",
      "fromStatus": "resolved",
      "toStatus": "settled",
      "actorUserId": "guhartz-admin-id",
      "source": "settlement",
      "note": null,
      "metadata": {
        "winningOutcomeId": 2,
        "positionsSettled": 1,
        "positionsSkipped": 0,
        "totalWinnerPayout": "14.000000",
        "totalStakeConsumed": "7.000000",
        "currency": "GS"
      },
      "createdAt": "2026-03-14T12:00:00.001Z"
    }
  ]
}
```

---

## Remaining TODOs (Future Sprints)

| Item | Priority | Notes |
|------|----------|-------|
| `market_opened` event for programmatic open transition | Low | Currently only fires if `transitionMarketStatus()` is called. Direct DB opens (e.g., via scheduled `openAt`) are not yet captured. |
| Add `source` param to `TransitionMarketStatusInput` | Low | Currently inferred via `actorUserId === "auto_lock_scheduler"` sentinel. Explicit `source` field would be cleaner for future callers. |
| Paginate `listMarketEvents` | Low | Not needed now — markets have O(10) lifecycle events each. |
| Surface events in admin UI | Future | Read endpoint is ready; UI wiring is out of scope for Sprint 3. |
| Move event writes inside DB transactions | Future | If audit completeness becomes a hard requirement, wrap `emitMarketEvent()` inside the same transaction as `updateMarketStatus()`. Currently intentionally best-effort. |
| `market_opened` from `openAt` scheduler (if implemented) | Future | Requires a future `openAt` scheduler similar to auto-lock. |

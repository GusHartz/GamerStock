# Prediction Markets — Sprint 4 Market Detail Read Model

**Implemented:** Sprint 4 (market detail)  
**Status:** Complete and smoke-tested

---

## Bug Fixed During Implementation

**`positionCounts` returned `{}` (empty object)**

`countPositionsByStatus(marketId)` returns `{ status: string; count: number }[]` — a flat array, not a keyed map. The initial `getMarketDetail` implementation passed this raw array directly into the response as `positionCounts`, which serialised as `{}` because arrays have no own enumerable string keys matching `active/settled/cancelled/total`.

**Fix:** Reduce the array in the service layer using the same pattern as `getAdminSummary`:

```typescript
const positionCounts = { active: 0, settled: 0, cancelled: 0, total: 0 };
for (const row of countRows) {
  positionCounts.total += row.count;
  if (row.status === "active")    positionCounts.active    += row.count;
  if (row.status === "settled")   positionCounts.settled   += row.count;
  if (row.status === "cancelled") positionCounts.cancelled += row.count;
}
```

Any status bucket not present in the DB result defaults to `0`. Verified by smoke test: market 1 now returns `{"active":0,"settled":1,"cancelled":0,"total":1}` with `sum(active+settled+cancelled) === total`.

---

## Overview

Sprint 4 adds `GET /api/predictions/markets/:idOrSlug/detail` — a single endpoint that powers a full Prediction Market detail page. It composes seven sections from existing tables using parallel queries, returning a complete read model without any new DB schema, pricing engine, or analytics pipeline.

The base `GET /api/predictions/markets/:idOrSlug` endpoint (returns `PredictionMarketWithOutcomes`) remains unchanged and is still appropriate for lightweight list-level reads.

---

## Endpoint Added

```
GET /api/predictions/markets/:idOrSlug/detail
```

**Route ordering note:** This route is registered **before** the bare `GET /api/predictions/markets/:idOrSlug` route. Express treats `/1/detail` as a two-segment path and matches the more specific `/detail` handler first. No conflict with the existing single-segment `:idOrSlug` handler.

**Auth:** `isAuthenticated` — same middleware as `GET /api/predictions/markets/:idOrSlug`. Unauthenticated requests receive `401 { "message": "Unauthorized" }`.

**`:idOrSlug` resolution:** Same regex check as the base route — `/^\d+$/` selects numeric ID lookup, any other string hits slug lookup (`findMarketBySlug`). Both flows go through `findMarketWithOutcomes`.

---

## Response Shape

```typescript
interface MarketDetailResponse {
  // 1. Market identity
  marketId:          number;
  uid:               string;
  slug:              string | null;
  question:          string;
  description:       string | null;
  status:            string;
  marketType:        string;
  currency:          string;
  openAt:            Date | null;
  closeAt:           Date | null;
  resolveAt:         Date | null;
  settledAt:         Date | null;
  resolvedOutcomeId: number | null;
  createdAt:         Date;

  // 2. Event context (null if market has no linked event)
  event: {
    eventId:        number;
    game:           string;
    tournamentName: string | null;
    eventName:      string | null;
    teamAName:      string | null;
    teamBName:      string | null;
    startsAt:       Date | null;
    eventStatus:    string;           // e.g. "scheduled"
  } | null;

  // 3. Outcomes (ordered by sortOrder ASC from the base query)
  outcomes: Array<{
    outcomeId:          number;
    code:               string | null;
    label:              string;
    description:        string | null;
    isWinner:           boolean;
    poolShare:          string;
    impliedProbability: string | null;   // from prediction_outcomes.implied_probability
    payoutValue:        string | null;   // non-null after settlement
    sortOrder:          number;
  }>;

  // 4. Stats summary (null if no stats row yet)
  stats: {
    volume24h:    string;
    traders24h:   number;
    lastPriceYes: string | null;
    lastPriceNo:  string | null;
    updatedAt:    Date | null;
  } | null;

  // 5. Recent price snapshots (recordedAt DESC, all outcomes, max 50)
  recentSnapshots: Array<{
    outcomeId:    number;
    price:        string;
    volumeWindow: string | null;
    recordedAt:   Date;
  }>;
  snapshotLimit: number;  // 50 (documents the hard cap for the client)

  // 6. Lifecycle event timeline (createdAt DESC, max 10)
  recentEvents: Array<{
    eventType:  string;
    fromStatus: string | null;
    toStatus:   string | null;
    source:     string | null;
    note:       string | null;
    createdAt:  Date;
  }>;
  eventLimit: number;  // 10

  // 7. Operational summary
  positionCounts: {
    active:    number;
    settled:   number;
    cancelled: number;
    total:     number;
  };
  availableActions: string[];   // e.g. ["lock", "cancel"] for open markets
  userCanTrade:     boolean;    // true when status=open AND (closeAt IS NULL OR closeAt > NOW())
}
```

---

## Source Tables

| Section | Source Table(s) | Query |
|---|---|---|
| Market identity | `prediction_markets` | `findMarketWithOutcomes(idOrSlug)` |
| Event context | `prediction_events` | LEFT JOIN inside `findMarketWithOutcomes` |
| Outcomes | `prediction_outcomes` | Joined inside `findMarketWithOutcomes`, sorted `sortOrder ASC` |
| Stats | `prediction_market_stats` | Joined inside `findMarketWithOutcomes` (1 row) |
| Snapshots | `prediction_price_snapshots` | `getMarketSnapshots(marketId, 50)` — new repo fn |
| Lifecycle events | `prediction_market_events` | `getRecentMarketEvents(marketId, 10)` — new repo fn |
| Position counts | `prediction_positions` | `countPositionsByStatus(marketId)` — GROUP BY |
| availableActions | — | `availableActions(status)` — pure function |
| userCanTrade | — | Derived in service layer (no DB query) |

---

## Query Strategy

**Execution order (service layer):**

```
Step 1: findMarketWithOutcomes(idOrSlug)
         → resolves market + outcomes + event + stats in 3 parallel sub-queries
         → returns null if not found (404)

Step 2: Promise.all([
          getMarketSnapshots(market.id, 50),
          getRecentMarketEvents(market.id, 10),
          countPositionsByStatus(market.id),
        ])
         → 3 independent queries in parallel

Step 3: derive userCanTrade, availableActions — zero DB queries
Step 4: compose and return MarketDetailResponse
```

Total DB round-trips: 4 (market lookup) + 3 parallel = 7. No N+1. No sequential blocking.

---

## Snapshot and Event Limits

### Price snapshots — 50 rows max

**Why 50?** A binary market has 2 outcomes. 50 total rows gives approximately 25 ticks per outcome — enough for a simple sparkline chart. Most markets will have far fewer ticks.

The rows are ordered `recordedAt DESC` (most recent first). The client can reverse for chronological chart rendering.

**No candle aggregation.** Raw ticks are returned. If a charting library needs OHLC candles, that aggregation should happen in the frontend or in a separate chart-specific endpoint.

### Lifecycle events — 10 rows max

**Why 10?** The lifecycle of a typical prediction market has 3–6 events (created → opened → locked → resolved → settled). 10 rows covers the entire lifecycle of most markets plus any extra cancellations or admin retries.

Events are ordered `createdAt DESC` (most recent first) to show the current state at the top of a timeline strip. The client can reverse for chronological display.

---

## Derived Fields

### `userCanTrade`

```typescript
const isOpen     = market.status === "open";
const notExpired = !market.closeAt || new Date(market.closeAt) > new Date();
const userCanTrade = isOpen && notExpired;
```

This is a pure boolean computed at read time — no DB query. It gives the frontend a ready-made gate signal for showing/hiding the trade button.

### `availableActions`

Reuses the existing `availableActions(status)` pure function:

| Status | Actions |
|---|---|
| `draft` | `["open", "cancel"]` |
| `open` | `["lock", "cancel"]` |
| `locked` | `["resolve", "cancel"]` |
| `resolved` / `settled` / `cancelled` | `[]` |

---

## `impliedProbability` Note

`impliedProbability` is returned directly from the `prediction_outcomes` column (type `numeric(6,4)`). It is set by the pricing engine when an order is filled (Sprint 2). For markets with no traded positions yet, it is `null`. The field is **not** computed on the fly in this endpoint.

The client should handle `null` gracefully (e.g., display "—" instead of 0%).

---

## Auth Assumptions

- `isAuthenticated`: checks `req.session?.isAdmin || req.session?.userId` or Passport's `req.isAuthenticated()`
- Unauthenticated: `401 { "message": "Unauthorized" }`
- No admin-only restriction — any authenticated user can read market detail
- This matches the auth level of the base `GET /markets/:idOrSlug` endpoint

---

## Files Changed

| File | Change |
|---|---|
| `server/domains/prediction/types.ts` | Added `PriceSnapshotPoint`, `MarketLifecycleEvent`, `DetailOutcomeCard`, `MarketDetailResponse` interfaces |
| `server/domains/prediction/repository.ts` | Added `getMarketSnapshots(marketId, limit)`, `getRecentMarketEvents(marketId, limit)`; imported new types; exported both |
| `server/domains/prediction/service.ts` | Added `SNAPSHOT_LIMIT`, `EVENT_LIMIT` constants; added `getMarketDetail(idOrSlug)`; exported via `predictionService` |
| `server/domains/prediction/routes.ts` | Added `GET /api/predictions/markets/:idOrSlug/detail` (before bare `:idOrSlug` route); updated header comment |
| `docs/architecture/prediction-sprint4-market-detail.md` | This document |

---

## Example Response

### `GET /api/predictions/markets/1/detail` (settled market with event)

```json
{
  "marketId": 1,
  "uid": "mkt_dev_furia_win",
  "slug": "dev-furia-wins-match-1",
  "question": "Will FURIA win this match against NAVI?",
  "description": null,
  "status": "settled",
  "marketType": "binary",
  "currency": "GS",
  "openAt": null,
  "closeAt": null,
  "resolveAt": null,
  "settledAt": "2026-03-14T11:56:35.000Z",
  "resolvedOutcomeId": 1,
  "createdAt": "2026-03-14T11:00:00.000Z",

  "event": {
    "eventId": 1,
    "game": "lol",
    "tournamentName": "ESL Pro League Season 21",
    "eventName": "Group Stage Day 1",
    "teamAName": "FURIA",
    "teamBName": "NAVI",
    "startsAt": "2026-03-15T18:00:00.000Z",
    "eventStatus": "scheduled"
  },

  "outcomes": [
    {
      "outcomeId": 1,
      "code": "YES",
      "label": "Yes — FURIA wins",
      "description": null,
      "isWinner": true,
      "poolShare": "7.000000",
      "impliedProbability": null,
      "payoutValue": null,
      "sortOrder": 0
    },
    {
      "outcomeId": 2,
      "code": "NO",
      "label": "No — NAVI wins",
      "description": null,
      "isWinner": false,
      "poolShare": "0.000000",
      "impliedProbability": null,
      "payoutValue": null,
      "sortOrder": 1
    }
  ],

  "stats": {
    "volume24h": "7.000000",
    "traders24h": 0,
    "lastPriceYes": "0.500000",
    "lastPriceNo": null,
    "updatedAt": "2026-03-14T11:56:35.000Z"
  },

  "recentSnapshots": [
    {
      "outcomeId": 1,
      "price": "0.500000",
      "volumeWindow": "2.000000",
      "recordedAt": "2026-03-14T11:56:35.694561Z"
    },
    {
      "outcomeId": 1,
      "price": "0.500000",
      "volumeWindow": "5.000000",
      "recordedAt": "2026-03-14T11:56:11.920500Z"
    }
  ],
  "snapshotLimit": 50,

  "recentEvents": [
    {
      "eventType": "market_settled",
      "fromStatus": "resolved",
      "toStatus": "settled",
      "source": "settlement",
      "note": "Settled with 1 active position.",
      "createdAt": "2026-03-14T11:56:35.000Z"
    },
    {
      "eventType": "market_resolved",
      "fromStatus": "locked",
      "toStatus": "resolved",
      "source": "admin",
      "note": null,
      "createdAt": "2026-03-14T11:56:35.000Z"
    }
  ],
  "eventLimit": 10,

  "positionCounts": {
    "active": 0,
    "settled": 1,
    "cancelled": 0,
    "total": 1
  },
  "availableActions": [],
  "userCanTrade": false
}
```

### `GET /api/predictions/markets/7/detail` (open market, no event)

```json
{
  "marketId": 7,
  "slug": "sprint3-read-test-will-ruler-win-mvp-xyz123",
  "question": "Sprint3 Read Test: Will Ruler win MVP?",
  "status": "open",
  "currency": "GS",
  "openAt": null,
  "closeAt": null,
  "resolveAt": null,
  "settledAt": null,
  "resolvedOutcomeId": null,
  "event": null,
  "outcomes": [
    { "outcomeId": 13, "code": "YES", "label": "Yes", "isWinner": false, "poolShare": "0.000000", "impliedProbability": null, "payoutValue": null, "sortOrder": 0 },
    { "outcomeId": 14, "code": "NO",  "label": "No",  "isWinner": false, "poolShare": "0.000000", "impliedProbability": null, "payoutValue": null, "sortOrder": 1 }
  ],
  "stats": { "volume24h": "0.000000", "traders24h": 0, "lastPriceYes": null, "lastPriceNo": null, "updatedAt": null },
  "recentSnapshots": [],
  "snapshotLimit": 50,
  "recentEvents": [
    { "eventType": "market_opened", "fromStatus": "draft", "toStatus": "open", "source": "admin", "note": null, "createdAt": "..." },
    { "eventType": "market_created", "fromStatus": null, "toStatus": "draft", "source": "admin", "note": null, "createdAt": "..." }
  ],
  "eventLimit": 10,
  "positionCounts": { "active": 0, "settled": 0, "cancelled": 0, "total": 0 },
  "availableActions": ["lock", "cancel"],
  "userCanTrade": true
}
```

---

## Approximations Made

1. **`impliedProbability` is always `null` in dev** — the Sprint 2 pricing engine sets it when a position is filled. Dev markets have been resolved/cancelled without user orders, so the column is `null`.
2. **`traders24h` is always `0`** — telemetry placeholder from Sprint 2 (deferred field).
3. **`payoutValue` is `null`** for non-winning outcomes even after settlement — the schema supports it but the current settlement engine only sets it on the winning outcome.
4. **`recentEvents` is ordered `createdAt DESC`** — most recent first. The client may reverse for chronological timeline display.
5. **`recentSnapshots` mix all outcomes** — the client filters by `outcomeId` for per-outcome charts.
6. **`recentEvents: []` for legacy seeded markets is expected and correct.** Markets created during Sprint 1/2 development seeding (e.g. market ID 1) were created before the `prediction_market_events` audit-trail table existed. No lifecycle events were emitted for state transitions (draft→open→locked→resolved→settled) on those markets. `recentEvents: []` truthfully reflects the DB state — **no backfilling is done and no synthetic events are invented**. Markets created from Sprint 3 onwards (market IDs 7+) have a full lifecycle event history because `createPredictionMarket`, `openMarket`, `lockMarket`, `resolveMarket`, `settleMarket`, and `cancelMarket` all write to `prediction_market_events`. The client should handle `recentEvents: []` gracefully (e.g., display "No event history available" rather than treating empty as an error).

---

## Remaining TODOs for Future Sprint 4 / Sprint 5 Steps

| Item | Priority |
|---|---|
| `GET /api/predictions/browse` — unified paginated browse (multi-status, game, currency filters) | High |
| Cache detail response for 30s TTL — reduces DB load for popular markets | Medium |
| Per-outcome snapshot endpoint — `GET /api/predictions/markets/:id/outcomes/:outcomeId/snapshots?limit=100` | Low |
| `impliedProbability` computation on-the-fly — fallback to `poolShare / totalPool` when outcome column is null | Medium |
| Market detail with user's own position — compose `getMyPositions` subset for the current user's position in this market | Medium |
| `GET /api/predictions/markets/:idOrSlug` upgrade — optionally redirect to detail endpoint, or deprecate in favor of detail | Low |

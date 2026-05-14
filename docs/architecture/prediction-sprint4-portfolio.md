# Prediction Markets — Sprint 4: Portfolio Endpoint

## Overview

`GET /api/predictions/me/portfolio` is a composed read-model endpoint that produces a UI-ready portfolio snapshot for the authenticated user. It has no new DB tables, no wallet or ledger coupling, and no mark-to-market engine. All data is sourced from the existing enriched position query (`findEnrichedPositionsByUser`).

---

## Endpoint

```
GET /api/predictions/me/portfolio
Auth: isAuthenticated (user session cookie)
Params: none
```

---

## Response Sections

### 1. `summary`

Aggregate counts and financial totals for the portfolio header.

| Field | Type | Computation |
|---|---|---|
| `activeMarkets` | `number` | Count of distinct `marketId` values across active positions |
| `activePositions` | `number` | Count of active position rows |
| `settledPositions` | `number` | Count of settled position rows |
| `cancelledPositions` | `number` | Count of cancelled position rows |
| `openExposure` | `string` (2 dp) | `SUM(costBasis)` for active rows; null costBasis treated as 0 |
| `realizedPnl` | `string` (2 dp) | `SUM(realizedPnl)` for settled rows only |
| `totalPayout` | `string` (2 dp) | `SUM(payout)` for settled rows |
| `totalRefunded` | `string` (2 dp) | `SUM(costBasis)` for cancelled rows |
| `currency` | `"GS"` | Monomorphic in current model |

**Cancelled positions and realizedPnl:** Cancelled positions are **not** included in `realizedPnl`. Their financial effect is captured separately in `totalRefunded` (the costBasis that was returned to the user's wallet). This distinction makes the portfolio math straightforward: `realizedPnl` = the net gain/loss from finished markets, not from administrative cancellations.

### 2. `activeMarketPositions`

Active positions grouped by market — one entry per distinct market. Groups are ordered by the underlying query's natural sort (`createdAt DESC` on the first position added to each group).

Each group contains:

| Field | Notes |
|---|---|
| `marketId`, `marketSlug`, `marketTitle` | Market identity |
| `marketStatus`, `marketType`, `currency` | Market metadata |
| `closeAt` | Raw market close time |
| `userCanTrade` | `true` if `marketStatus === "open"` AND (`closeAt` is null OR `closeAt > now`) |
| `event` | Event context (null if market has no linked event) |
| `outcomesHeld[]` | One entry per active position row for this market |
| `totalQuantity` | `SUM(parseFloat(quantity))` across outcomesHeld |
| `totalCostBasis` | `SUM(costBasis)` across outcomesHeld (2 dp) |

#### `outcomesHeld` entry

| Field | Source |
|---|---|
| `positionId` | `prediction_positions.id` |
| `outcomeId` | `prediction_positions.outcome_id` |
| `outcomeCode` | `prediction_outcomes.code` |
| `outcomeLabel` | `prediction_outcomes.label` |
| `quantity` | `prediction_positions.quantity` |
| `avgPrice` | `prediction_positions.avg_price` |
| `costBasis` | `prediction_positions.cost_basis` |
| `status` | Always `"active"` in this section |

### 3. `recentHistory`

Compact list of settled and cancelled positions, capped at **20 rows** (constant `PORTFOLIO_HISTORY_LIMIT = 20`), ordered by `createdAt DESC` (repository default sort).

Each item:

| Field | Notes |
|---|---|
| `positionId`, `marketId`, `marketTitle`, `marketSlug` | Identity |
| `outcomeId`, `outcomeCode`, `outcomeLabel` | Which outcome was held |
| `status` | `"settled"` or `"cancelled"` |
| `payout` | Null for cancelled positions |
| `realizedPnl` | Null for cancelled positions |
| `payoutAt` | Non-null for settled positions |
| `cancelledAt` | Non-null for cancelled positions — **sourced from `updatedAt`** (see approximations) |

### 4. `meta`

| Field | Type | Notes |
|---|---|---|
| `generatedAt` | ISO string | Server timestamp at response generation |
| `historyLimit` | `number` | Always `20` — documents the cap to the client |
| `hasMoreHistory` | `boolean` | `true` if total history rows > `historyLimit` |
| `isEmpty` | `boolean` | `true` if user has no positions at all (new user empty-state) |

---

## Data Flow

```
GET /me/portfolio
        │
        ├── Promise.all [
        │     findEnrichedPositionsByUser(userId, ["active"])
        │     findEnrichedPositionsByUser(userId, ["settled","cancelled"])
        │   ]
        │
        ├── partition history → settledRows / cancelledRows
        │
        ├── reduce active rows → summary.activeMarkets (Set), counts, sums
        ├── reduce active rows → groupMap<marketId, ActiveMarketPositionGroup>
        ├── slice historyRows[0..19] → recentHistory
        │
        └── return { summary, activeMarketPositions, recentHistory, meta }
```

**Two DB queries, one per status bucket. All aggregation is in-process.**

---

## Query Reuse

The endpoint reuses `findEnrichedPositionsByUser` — the same query that backs `/me/positions` and `/me/history`. No new repository function was added.

The query performs:
- `INNER JOIN prediction_markets` — market fields
- `LEFT JOIN prediction_outcomes` — outcome label/code
- `LEFT JOIN prediction_events` — event context (null if no event)

---

## Approximations

| Item | Approximation | Impact |
|---|---|---|
| `cancelledAt` | Sourced from `prediction_positions.updated_at` | `updatedAt` is set by `updatePositionStatus` at cancellation time. For positions that have never had any other update this is accurate. A future migration adding an explicit `cancelledAt` column would be exact. |
| `totalRefunded` | Uses `costBasis` as refund amount | The wallet credits back `costBasis` on cancellation (see `wallet/service.ts → creditWallet`). This is the correct amount but is read from the position table, not from the ledger, to avoid cross-domain coupling. |
| `realizedPnl` for cancelled rows | Excluded (treated as 0) | Cancelled positions return capital; they produce no profit or loss. Tracking them separately in `totalRefunded` avoids conflating refunds with earnings. |
| `currency` hardcoded `"GS"` | All positions use GS in current DB | If multi-currency positions are introduced, `currency` should aggregate per-currency buckets. |
| `groupOrder` in `activeMarketPositions` | Map insertion order = first position `createdAt DESC` | First active position per market determines group order. A future sort (e.g., by `closeAt ASC`) could be added via a sort step. |
| Mark-to-market / implied probability | Not computed | Portfolio has no live pricing. `avgPrice` is available per outcome held but no current-price feed is attached. A future sprint can add a `currentPrice` and `unrealizedPnl` per outcome. |

---

## Constants

| Constant | Value | File |
|---|---|---|
| `PORTFOLIO_HISTORY_LIMIT` | `20` | `server/domains/prediction/service.ts` |

---

## Future Enhancements

| Item | Priority |
|---|---|
| `unrealizedPnl` per held outcome using AMM current price | High |
| `currentPrice` per held outcome | High |
| Explicit `cancelledAt` column on `prediction_positions` | Medium |
| Per-currency portfolio breakdown when multi-currency positions land | Medium |
| Sort `activeMarketPositions` by `closeAt ASC` (closest deadline first) | Low |
| Cursor pagination for `recentHistory` beyond 20 | Low |
| `/me/portfolio?currency=GS` filter param | Low |

---

## Example Response

```json
{
  "summary": {
    "activeMarkets": 1,
    "activePositions": 2,
    "settledPositions": 4,
    "cancelledPositions": 3,
    "openExposure": "20.00",
    "realizedPnl": "8.50",
    "totalPayout": "58.50",
    "totalRefunded": "15.00",
    "currency": "GS"
  },
  "activeMarketPositions": [
    {
      "marketId": 7,
      "marketSlug": "sprint3-read-test-will-ruler-win-mvp-xyz123",
      "marketTitle": "Sprint3 Read Test: Will Ruler win MVP?",
      "marketStatus": "open",
      "marketType": "binary",
      "currency": "GS",
      "closeAt": null,
      "userCanTrade": true,
      "event": null,
      "outcomesHeld": [
        {
          "positionId": 42,
          "outcomeId": 13,
          "outcomeCode": "YES",
          "outcomeLabel": "Yes",
          "quantity": "10.000000",
          "avgPrice": "0.500000",
          "costBasis": "5.000000",
          "status": "active"
        },
        {
          "positionId": 43,
          "outcomeId": 14,
          "outcomeCode": "NO",
          "outcomeLabel": "No",
          "quantity": "30.000000",
          "avgPrice": "0.500000",
          "costBasis": "15.000000",
          "status": "active"
        }
      ],
      "totalQuantity": 40,
      "totalCostBasis": "20.00"
    }
  ],
  "recentHistory": [
    {
      "positionId": 38,
      "marketId": 9,
      "marketTitle": "Sprint3 Read Test: Will Faker win the series?",
      "marketSlug": "sprint3-faker-series-slug",
      "outcomeId": 17,
      "outcomeCode": "YES",
      "outcomeLabel": "Yes",
      "status": "settled",
      "payout": "25.000000",
      "realizedPnl": "12.500000",
      "payoutAt": "2026-03-14T10:22:00.000Z",
      "cancelledAt": null
    },
    {
      "positionId": 32,
      "marketId": 6,
      "marketTitle": "Will team A win the map?",
      "marketSlug": null,
      "outcomeId": 11,
      "outcomeCode": "YES",
      "outcomeLabel": "Yes",
      "status": "cancelled",
      "payout": null,
      "realizedPnl": null,
      "payoutAt": null,
      "cancelledAt": "2026-03-13T16:45:00.000Z"
    }
  ],
  "meta": {
    "generatedAt": "2026-03-14T12:00:00.000Z",
    "historyLimit": 20,
    "hasMoreHistory": false,
    "isEmpty": false
  }
}
```

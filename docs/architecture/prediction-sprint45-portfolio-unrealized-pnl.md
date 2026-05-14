# Prediction Markets — Sprint 4.5: Portfolio Unrealized PnL Overlay

## Overview

`GET /api/predictions/me/portfolio` was enhanced with a lightweight mark-to-market overlay that exposes `currentPrice`, `marketValue`, and `unrealizedPnl` per held outcome, aggregates them per active market group, and surfaces a portfolio-level `unrealizedPnl` in `summary`.

All values are **indicative only**. The wallet, ledger, and settlement engine remain the sole sources of financial truth. These fields do not affect balances, settlements, or any downstream financial computation.

---

## Endpoint Enhanced

```
GET /api/predictions/me/portfolio          (auth: isAuthenticated, unchanged)
```

No new params. No schema changes.

---

## Fields Added

### On each `outcomesHeld` entry (`HeldOutcome`)

| Field | Type | Description |
|---|---|---|
| `currentPrice` | `string \| null` | Indicative last traded price for this outcome slot |
| `marketValue` | `string \| null` | `quantity × currentPrice`, 2 dp |
| `unrealizedPnl` | `string \| null` | `marketValue − costBasis`, 2 dp; positive = gain |

### On each `activeMarketPositions` entry (`ActiveMarketPositionGroup`)

| Field | Type | Description |
|---|---|---|
| `unrealizedPnl` | `string \| null` | Sum of priced outcome `unrealizedPnl` for this group |
| `totalMarketValue` | `string \| null` | Sum of priced outcome `marketValue` for this group |
| `hasPartialPricing` | `boolean` | `true` if any held outcome in this group has `currentPrice = null` |

### On `summary` (`PredictionPortfolioSummary`)

| Field | Type | Description |
|---|---|---|
| `unrealizedPnl` | `string \| null` | Sum of group `unrealizedPnl` across all active market groups that have at least one priced outcome; `null` if no active position has pricing |
| `hasPartialPricing` | `boolean` | `true` if any active market group has partial or missing pricing |

---

## Pricing Source

**Table:** `prediction_market_stats`

**Columns used:** `last_price_yes`, `last_price_no`

**Mapping rule:**

| Outcome code | Price slot |
|---|---|
| `"YES"` | `lastPriceYes` |
| `"NO"` | `lastPriceNo` |
| anything else / `null` | `null` (no price) |

These fields are written by `recordOrderTelemetry()` whenever a prediction order is filled. They represent the **last executed trade price** for each outcome slot — not a mid-market estimate, not a derived value.

---

## Calculation Formulas

```
currentPrice   = stats.lastPriceYes  (if outcomeCode === "YES")
               | stats.lastPriceNo   (if outcomeCode === "NO")
               | null                (otherwise)

marketValue    = parseFloat(quantity) × parseFloat(currentPrice)   → toFixed(2)
               | null  (if any input is null)

unrealizedPnl  = marketValue − parseFloat(costBasis)              → toFixed(2)
               | null  (if marketValue is null)
```

Per-group aggregation (priced outcomes only):

```
group.unrealizedPnl    = SUM(o.unrealizedPnl  for o in outcomesHeld where o.unrealizedPnl ≠ null)
group.totalMarketValue = SUM(o.marketValue     for o in outcomesHeld where o.marketValue  ≠ null)
group.hasPartialPricing = outcomesHeld.some(o => o.currentPrice === null)
```

Summary aggregation (groups with pricing only):

```
summary.unrealizedPnl    = SUM(g.unrealizedPnl  for g in activeMarketPositions where g.unrealizedPnl ≠ null)
                         | null  (if no group has pricing)
summary.hasPartialPricing = activeMarketPositions.some(g => g.hasPartialPricing)
                          || pricedGroups.length < activeMarketPositions.length
```

---

## Query Strategy

Three queries total, two parallel legs:

```
Promise.all [
  findEnrichedPositionsByUser(userId, ["active"])           ← active position rows
  findEnrichedPositionsByUser(userId, ["settled","cancelled"]) ← history rows
]
   ↓ (after active rows resolve)
getMarketStatsBatch(activeMarketIdArray)                    ← one IN-list stats query
   ↓
in-process mark-to-market computation (no more DB calls)
```

`getMarketStatsBatch` uses:

```sql
SELECT * FROM prediction_market_stats
WHERE market_id IN ($activeMarketIds)
```

Returns `Map<marketId, PredictionMarketStats>`. Bounded to the number of distinct active-position markets (not the whole table). No N+1.

**Note:** The stats batch runs sequentially after the active rows query (it needs the market IDs). It runs in parallel with the history query implicitly — both active and history queries run in the first `Promise.all`, and the stats batch uses the active results immediately after.

---

## Null / Partial Pricing Behavior

| Condition | `currentPrice` | `marketValue` | `unrealizedPnl` |
|---|---|---|---|
| No stats row for market | `null` | `null` | `null` |
| Stats row exists but `lastPriceYes` is null (no YES trade yet) | `null` | `null` | `null` |
| Stats row exists but `lastPriceNo` is null | `null` | `null` | `null` |
| `outcomeCode` is null or not "YES"/"NO" | `null` | `null` | `null` |
| `quantity` is null (edge case) | N/A | `null` | `null` |
| `costBasis` is null | N/A | computed | `null` |

When a group has some priced and some unpriced outcomes, `group.unrealizedPnl` reflects only the priced subset and `hasPartialPricing = true` signals to the UI that the number is incomplete.

---

## Financial Source of Truth Statement

> These mark-to-market values are **indicative read-only overlays**. They are computed from the last traded price stored in `prediction_market_stats`, which lags real-time by the last filled order. They are not derived from the ledger, and they do not feed into settlement, wallet balances, or any financial computation. The wallet and ledger remain the sole sources of truth for all user balances and payouts.

---

## Approximations and Limitations

| Limitation | Notes |
|---|---|
| Price is "last traded", not "current bid/ask" | `lastPriceYes`/`lastPriceNo` reflect the last fill price, not a live order book mid-price |
| Stale prices | Markets with no recent trading activity will show the last recorded price, which may be hours or days old |
| Non-binary markets | Only `"YES"` and `"NO"` outcome codes are mapped. Multi-outcome markets with codes like `"TEAM_A"`, `"DRAW"` etc. would get `currentPrice = null` |
| No AMM formula re-evaluation | Prices are taken directly from stats, not re-derived from pool ratios |
| Float arithmetic | All computation uses `parseFloat` + `toFixed(2)`. For display purposes this is fine; do not use for settlement |
| Stats batch runs after active query | Sequential; cannot parallelise without pre-knowing market IDs |

---

## Example Responses

### Outcome with price available

```json
{
  "positionId": 42,
  "outcomeId": 13,
  "outcomeCode": "YES",
  "outcomeLabel": "Yes",
  "quantity": "10.000000",
  "avgPrice": "0.500000",
  "costBasis": "5.000000",
  "status": "active",
  "currentPrice": "0.650000",
  "marketValue": "6.50",
  "unrealizedPnl": "1.50"
}
```

### Outcome with no price (null case)

```json
{
  "positionId": 43,
  "outcomeId": 14,
  "outcomeCode": "NO",
  "outcomeLabel": "No",
  "quantity": "20.000000",
  "avgPrice": "0.500000",
  "costBasis": "10.000000",
  "status": "active",
  "currentPrice": null,
  "marketValue": null,
  "unrealizedPnl": null
}
```

### Market group with partial pricing

```json
{
  "marketId": 7,
  "marketTitle": "Will Ruler win MVP?",
  "outcomesHeld": [
    { "outcomeCode": "YES", "currentPrice": "0.65", "unrealizedPnl": "1.50" },
    { "outcomeCode": "NO",  "currentPrice": null,   "unrealizedPnl": null   }
  ],
  "unrealizedPnl": "1.50",
  "totalMarketValue": "6.50",
  "hasPartialPricing": true
}
```

### Summary with partial pricing

```json
{
  "activeMarkets": 1,
  "activePositions": 2,
  "openExposure": "15.00",
  "realizedPnl": "7.00",
  "unrealizedPnl": "1.50",
  "hasPartialPricing": true,
  "currency": "GS"
}
```

---

## Future Enhancements

| Enhancement | Notes |
|---|---|
| AMM formula re-evaluation | Derive current price from pool ratios instead of last-trade price |
| Real-time price feed | Subscribe to order-fill events and update a cache |
| Multi-outcome code mapping | Extend `resolveCurrentPrice` to support non-binary outcome codes |
| `pricedAt` timestamp | Surface `predictionMarketStats.updatedAt` per outcome to indicate price freshness |
| Portfolio total return | `openExposure + unrealizedPnl + realizedPnl` — a one-line metric for the portfolio header |

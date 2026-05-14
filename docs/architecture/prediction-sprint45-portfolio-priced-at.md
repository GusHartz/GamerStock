# Prediction Markets — Sprint 4.5: Portfolio Price Freshness (`pricedAt`)

## Endpoint Enhanced

```
GET /api/predictions/me/portfolio
```

---

## Overview

The portfolio endpoint already exposes `currentPrice`, `marketValue`, and `unrealizedPnl` on each held outcome (Sprint 4.5 mark-to-market overlay). However, clients had no way to know how fresh the displayed price was, or how much time had elapsed since the stat row was last updated.

This refinement adds `pricedAt` at two response levels (outcome and market group), plus `latestPricingAt` on the summary, all sourced directly from `prediction_market_stats.updated_at` — no new DB queries, no new columns, no schema changes.

---

## Pricing Freshness Source

```
prediction_market_stats.updated_at
```

This timestamp is written whenever a market-stats row is created or updated (e.g., after a fill populates `last_price_yes` / `last_price_no`). It is the authoritative "as-of" time for the price used by the portfolio overlay.

No derived timestamps are invented. `pricedAt` is either `stats.updatedAt` or `null`.

---

## Files Changed / Created

| File | Change |
|---|---|
| `server/domains/prediction/types.ts` | Added `pricedAt` to `HeldOutcome`, `ActiveMarketPositionGroup`, `latestPricingAt` to `PredictionPortfolioSummary` |
| `server/domains/prediction/service.ts` | Populated `pricedAt` in outcome push, group aggregation, and summary |
| `docs/architecture/prediction-sprint45-portfolio-priced-at.md` | This file |

---

## Fields Added

### `HeldOutcome.pricedAt`

```typescript
pricedAt: Date | null;
```

Set to `stats.updatedAt` when `currentPrice` is present for this outcome.
Null when `currentPrice` is null (no stats row, or outcome code not recognized as "YES"/"NO").

### `ActiveMarketPositionGroup.pricedAt`

```typescript
pricedAt: Date | null;
```

Set to `statsMap.get(marketId)?.updatedAt` **only when `hasPartialPricing = false`**.

**Conservative rule**: if any held outcome in the group lacks a price, the group's `pricedAt` is suppressed to `null`. This prevents clients from interpreting the timestamp as a freshness guarantee that doesn't cover all outcomes they hold.

### `PredictionPortfolioSummary.latestPricingAt`

```typescript
latestPricingAt: Date | null;
```

The maximum `pricedAt` across all fully-priced active market groups (`hasPartialPricing = false`).

Tells the client: "the freshest price data visible in this response is no older than this timestamp."

Null when no active group has a non-null `pricedAt`.

---

## Null Semantics

| Situation | `HeldOutcome.pricedAt` | `ActiveMarketPositionGroup.pricedAt` | `PredictionPortfolioSummary.latestPricingAt` |
|---|---|---|---|
| No stats row for the market | `null` | `null` | `null` (if all groups are in this state) |
| Stats row exists, outcome code is "YES"/"NO" | `stats.updatedAt` | `stats.updatedAt` (if fully priced) | max of all group `pricedAt` values |
| Stats row exists but outcome code unrecognized | `null` | `null` (partial) | unchanged from other groups |
| Market fully priced, `hasPartialPricing=false` | `stats.updatedAt` | `stats.updatedAt` | max across such groups |
| Market partially priced, `hasPartialPricing=true` | per-outcome (may be set) | `null` (suppressed) | excludes this group |

No timestamps are invented or derived from snapshots, fills, or order history.

---

## Implementation Detail

### Outcome level (per-position push)

```typescript
// In the main active-rows reduce loop:
const stats        = statsMap.get(row.marketId);
const currentPrice = resolveCurrentPrice(row.outcomeCode, stats);
const pricedAt     = currentPrice != null ? (stats?.updatedAt ?? null) : null;

group.outcomesHeld.push({
  ...
  currentPrice,
  pricedAt,
  ...
});
```

### Group level (aggregation loop)

```typescript
// After computing hasPartialPricing for the group:
group.pricedAt = group.hasPartialPricing
  ? null
  : (statsMap.get(group.marketId)?.updatedAt ?? null);
```

### Summary level

```typescript
const fullyPricedDates = activeMarketPositions
  .map(g => g.pricedAt)
  .filter((d): d is Date => d != null);

const summaryLatestPricingAt: Date | null = fullyPricedDates.length > 0
  ? new Date(Math.max(...fullyPricedDates.map(d => d.getTime())))
  : null;
```

No additional DB queries — `statsMap` was already fetched in one IN-list batch query as part of the unrealizedPnl overlay (Sprint 4.5 previous step).

---

## Limitations

1. **`stats.updatedAt` reflects the stats row write time, not the fill execution time.** If a fill occurs at T but the stats row is written at T+ε, `pricedAt` is T+ε. The delta is negligible in practice but worth noting for high-frequency scenarios.

2. **Binary markets only.** `resolveCurrentPrice` maps "YES"→`lastPriceYes`, "NO"→`lastPriceNo`. Custom outcome codes (non-binary markets) result in `currentPrice=null` → `pricedAt=null`. This is correct behavior; expanding requires a different pricing resolver.

3. **Stale stats rows.** If no trades have occurred in a market for a long time, `stats.updatedAt` will be old. `pricedAt` will correctly reflect this staleness — it will be an old timestamp rather than null. Clients can use this to decide whether to display or flag the price.

4. **No cache layer yet.** `pricedAt` reflects the DB state at request time. A future caching layer (Redis) should propagate `updatedAt` from the cached stats to avoid serving stale `pricedAt` values.

---

## Example Responses

### Fully priced active holding

```json
{
  "summary": {
    "unrealizedPnl": "0.00",
    "hasPartialPricing": false,
    "latestPricingAt": "2026-03-14T22:55:19.506Z"
  },
  "activeMarketPositions": [
    {
      "marketId": 7,
      "marketTitle": "Will Ruler win MVP?",
      "hasPartialPricing": false,
      "pricedAt": "2026-03-14T22:55:19.506Z",
      "outcomesHeld": [
        {
          "outcomeCode": "YES",
          "currentPrice": "0.500000",
          "marketValue": "2.50",
          "unrealizedPnl": "0.00",
          "pricedAt": "2026-03-14T22:55:19.506Z"
        }
      ]
    }
  ]
}
```

### Null-priced holding (no stats row for the market)

```json
{
  "summary": {
    "unrealizedPnl": null,
    "hasPartialPricing": true,
    "latestPricingAt": null
  },
  "activeMarketPositions": [
    {
      "marketId": 12,
      "marketTitle": "Will Team A win the series?",
      "hasPartialPricing": true,
      "pricedAt": null,
      "outcomesHeld": [
        {
          "outcomeCode": "YES",
          "currentPrice": null,
          "marketValue": null,
          "unrealizedPnl": null,
          "pricedAt": null
        }
      ]
    }
  ]
}
```

### Mixed: one priced group, one unpriced group

```json
{
  "summary": {
    "unrealizedPnl": "1.50",
    "hasPartialPricing": true,
    "latestPricingAt": "2026-03-14T22:55:19.506Z"
  },
  "activeMarketPositions": [
    {
      "marketId": 7,
      "pricedAt": "2026-03-14T22:55:19.506Z",
      "hasPartialPricing": false,
      "outcomesHeld": [
        { "outcomeCode": "YES", "currentPrice": "0.800000", "pricedAt": "2026-03-14T22:55:19.506Z" }
      ]
    },
    {
      "marketId": 12,
      "pricedAt": null,
      "hasPartialPricing": true,
      "outcomesHeld": [
        { "outcomeCode": "YES", "currentPrice": null, "pricedAt": null }
      ]
    }
  ]
}
```

---

## Remaining TODOs Before Cache Refinement

- [ ] When a Redis/cache layer is added, ensure `pricedAt` is populated from the cached `updatedAt` field (not the DB `updated_at` of the cache write itself)
- [ ] Consider exposing `pricedAt` on `me/history` items when historical pricing is introduced (out of scope for Sprint 4.5)
- [ ] For non-binary markets, extend `resolveCurrentPrice` and `pricedAt` to handle arbitrary outcome codes

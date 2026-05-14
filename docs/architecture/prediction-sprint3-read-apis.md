# Prediction Markets — Sprint 3 Read APIs

**Implemented:** Sprint 3 (product-facing read layer)  
**Author:** Sprint 3 implementation  
**Status:** Complete and smoke-tested

---

## Overview

This document describes the product-facing read API layer added in Sprint 3 for the Prediction Markets domain. These endpoints are thin projections over existing domain state — they introduce no new tables, no new financial flows, and no new mutation logic. They exist purely to support the Home, Predictions, and Portfolio product screens.

---

## Endpoints Added

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /api/predictions/live` | `isAuthenticated` | Open markets still accepting orders |
| `GET /api/predictions/upcoming` | `isAuthenticated` | Draft markets not yet open |
| `GET /api/predictions/resolved` | `isAuthenticated` | Settled and cancelled markets |
| `GET /api/predictions/me/positions` | `isAuthenticated` | Active positions (upgraded) |
| `GET /api/predictions/me/history` | `isAuthenticated` | Settled/cancelled position history |

Existing endpoints left intact:
- `GET /api/predictions/markets` — admin-facing generic list with free-form filters
- `GET /api/predictions/markets/:idOrSlug` — market detail
- `GET /api/predictions/me/orders` — raw order history

---

## Intended Product Screens

| Endpoint | Screen |
|---|---|
| `/live` | Home feed, Predictions tab — "Live Markets" section |
| `/upcoming` | Home feed, Predictions tab — "Upcoming Markets" section |
| `/resolved` | Predictions tab — "Closed / Resolved" section |
| `/me/positions` | Portfolio tab — "Active Positions" |
| `/me/history` | Portfolio tab — "Position History" |

---

## Filter / Status Logic

### Live markets — `GET /api/predictions/live`
```
status = "open"
AND (closeAt IS NULL OR closeAt > NOW())
```
A market is "live" only if it is currently accepting orders and has not yet closed. Markets that are `open` but past their `closeAt` timestamp appear here until the auto-lock scheduler transitions them to `locked`.

### Upcoming markets — `GET /api/predictions/upcoming`
```
status = "draft"
```
Draft markets have been created by an admin but are not yet open to trading. They appear in the upcoming list until an admin (or a future scheduler) transitions them to `open`. There is no `scheduled` status in the current codebase — all pre-open markets are `draft`.

> **Interpretation choice:** "upcoming" = not yet tradeable. An alternative would be markets with `openAt > now`, but `openAt` is optional and many markets are opened manually without a scheduled open time. Using `status = "draft"` is the safest filter given current semantics.

### Resolved markets — `GET /api/predictions/resolved`
```
status IN ("settled", "cancelled", "resolved")
```
`settled` — normal successful resolution with payouts distributed.  
`cancelled` — admin-cancelled with full refunds.  
`resolved` — transient intermediate state during settlement (market has been marked resolved but settlement ledger writes may still be in-flight). Including it ensures in-flight markets don't disappear from the resolved view.

### Active positions — `GET /api/predictions/me/positions`
```
position.userId = current user
AND position.status = "active"
```

### Position history — `GET /api/predictions/me/history`
```
position.userId = current user
AND position.status IN ("settled", "cancelled")
```

---

## Response Shapes

### Market list endpoints (`/live`, `/upcoming`, `/resolved`)

All three return `PredictionMarketPage`:

```typescript
{
  markets: PredictionMarketWithOutcomes[];
  total:   number;
  page:    number;
  limit:   number;
}
```

Each market in the array is a `PredictionMarketWithOutcomes` which includes:

```typescript
{
  // Core market fields
  id, uid, slug, question, description, marketType,
  status, currency, openAt, closeAt, resolveAt, settledAt,
  poolTotal, minStake, maxStake, resolvedOutcomeId, ...

  // Linked event (null if no event attached)
  event: {
    id, uid, title, game, region, eventType,
    tournamentName, eventName, teamAName, teamBName, startsAt, ...
  } | null;

  // All outcomes for this market
  outcomes: Array<{
    id, marketId, code, label, description,
    poolShare, impliedProbability, isWinner, payoutValue, sortOrder
  }>;

  // Stats snapshot (from prediction_market_stats)
  stats: {
    id, marketId, volume24h, traders24h,
    lastPriceYes, lastPriceNo, updatedAt
  } | null;
}
```

### Active positions — `GET /api/predictions/me/positions`

Returns `{ positions: UserPositionCard[], total: number }`.

```typescript
UserPositionCard {
  positionId:    number;
  marketId:      number;
  marketTitle:   string;       // = market.question
  marketSlug:    string | null;
  marketStatus:  string;
  marketType:    string;
  currency:      string;
  marketCloseAt: Date | null;
  event: {
    eventId:        number;
    game:           string;
    tournamentName: string | null;
    eventName:      string | null;
    teamAName:      string | null;
    teamBName:      string | null;
    startsAt:       Date | null;
  } | null;
  outcome: {
    outcomeId: number;
    code:      string | null;
    label:     string;
  } | null;
  quantity:  string | null;     // shares held
  avgPrice:  string | null;     // average fill price per share
  costBasis: string | null;     // total amount paid (shares × avgPrice)
  stake:     string | null;     // amount locked in wallet
  status:    string;
  createdAt: Date;
}
```

### Position history — `GET /api/predictions/me/history`

Returns `{ positions: UserHistoryCard[], total: number }`.

`UserHistoryCard` extends `UserPositionCard` with:

```typescript
{
  ...UserPositionCard,
  payout:          string | null;   // GS or USDC received on settlement
  realizedPnl:     string | null;   // payout - costBasis (negative = loss)
  payoutAt:        Date | null;     // when payout/refund was credited
  marketSettledAt: Date | null;     // when the market was fully settled
}
```

---

## Query Strategy

### Market list endpoints

All three delegate to the existing `listMarkets()` repository function, which already performs:
- A paginated `SELECT` from `prediction_markets`
- Per-market `Promise.all([outcomes query, event query, stats query])`

The N+1 pattern here is acceptable at current scale (markets per page ≤ 20). Each market requires 3 small indexed point-reads. No new query logic was written — only the `where` conditions were extended via two new `listMarkets` params:

- `statuses?: string[]` — uses `inArray()` for multi-value status filters
- `liveOnly?: boolean` — adds `OR (closeAt IS NULL, closeAt > now)` condition

### Position endpoints

A **single SQL JOIN query** resolves all enrichment in one pass:

```
prediction_positions
  INNER JOIN prediction_markets   ON markets.id = positions.market_id
  LEFT  JOIN prediction_outcomes  ON outcomes.id = positions.outcome_id
  LEFT  JOIN prediction_events    ON events.id = markets.event_id
WHERE
  positions.user_id = $userId
  AND positions.status = ANY($statuses)
ORDER BY positions.created_at DESC
```

No N+1. The `LEFT JOIN` on outcomes is technically always a match (outcome_id is NOT NULL with FK), but `LEFT` is used defensively. The `LEFT JOIN` on events handles markets with no linked event (event column comes back as null).

---

## Auth Assumptions

- **All endpoints require `isAuthenticated`** — consistent with the existing pattern on `GET /api/predictions/markets`.
- The three market browse endpoints (`/live`, `/upcoming`, `/resolved`) could be made public in a future sprint if the product requires unauthenticated browsing. The change is a one-line removal of the `isAuthenticated` middleware per route.
- `/me/positions` and `/me/history` are strictly personal — they scope by `userId` extracted from the session. A missing session returns `401`.

---

## Query Parameters

All three market list endpoints accept:

| Param | Type | Description |
|---|---|---|
| `page` | integer | Page number (default: 1) |
| `limit` | integer | Page size (default: 20) |
| `currency` | string | Filter by `"GS"` or `"USDC"` |
| `eventId` | integer | Filter by linked prediction event ID |

Position endpoints accept no query params — they always return all matching positions for the current user.

---

## Approximations in Returned Stats

- **`volume24h`** is a cumulative total since market creation, not a true 24-hour rolling window. The field name is aspirational. It represents total matched stake.
- **`traders24h`** is always `0` — the telemetry layer records the field but the distinct-trader count was deferred in Sprint 2. Included in the response for forward-compatibility.
- **`lastPriceYes` / `lastPriceNo`** are execution prices from the most recent filled order. They reflect the last traded price, not a mid-market or fair-value estimate.
- **`impliedProbability`** on outcomes is currently `null` for all markets. It would require a separate computation from the AMM or from poolShare ratios.

---

## Files Changed

| File | Change |
|---|---|
| `server/domains/prediction/types.ts` | Added `statuses?`, `liveOnly?` to `PredictionMarketListParams`; added `PredictionMarketCard`, `EnrichedPosition`, `UserPositionCard`, `UserHistoryCard` types |
| `server/domains/prediction/repository.ts` | Imported `inArray, isNull, gt, or` from drizzle-orm; added `statuses` and `liveOnly` handling to `listMarkets()`; added `findEnrichedPositionsByUser()` (single JOIN query); exported `findEnrichedPositionsByUser` |
| `server/domains/prediction/service.ts` | Imported new types; added `getLiveMarkets()`, `getUpcomingMarkets()`, `getResolvedMarkets()`, `mapToPositionCard()`, `mapToHistoryCard()`, `getMyPositions()`, `getMyHistory()`; exported all 5 via `predictionService` |
| `server/domains/prediction/routes.ts` | Added `GET /api/predictions/live`, `GET /api/predictions/upcoming`, `GET /api/predictions/resolved`; upgraded `GET /api/predictions/me/positions` to return enriched data; added `GET /api/predictions/me/history` |

---

## Future Expansion Ideas

1. **Make `/live`, `/upcoming`, `/resolved` public** — remove `isAuthenticated` when unauthenticated browsing is needed (Home screen pre-login).
2. **Add `liveOnly: true` to `getUpcomingMarkets`** — add an `openAt` scheduled field so upcoming markets have a known start time.
3. **Rolling `volume24h`** — replace cumulative volume with a true 24h window using `prediction_price_snapshots` timestamps.
4. **`impliedProbability` from poolShare** — compute and backfill `impliedProbability` from poolShare ratios during settlement.
5. **Position pagination** — add `page`/`limit` params to `/me/positions` and `/me/history` as user position counts grow.
6. **Leaderboard** — aggregate `realizedPnl` across users for a `/api/predictions/leaderboard` endpoint.
7. **Featured markets** — add a `featured: boolean` column to `prediction_markets` and a `/api/predictions/featured` endpoint for editorial curation.

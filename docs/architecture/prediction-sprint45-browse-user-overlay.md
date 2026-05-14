# Prediction Markets — Sprint 4.5: Browse User Position Overlay

## Overview

`GET /api/predictions/browse` was enhanced with a lightweight user-position overlay that adds `userHasPosition: boolean` to every market card in the response. This lets the Predictions browse UI indicate — without a separate request — whether the authenticated user already has an open stake in each listed market.

---

## Endpoint Enhanced

```
GET /api/predictions/browse          (unchanged auth requirement: isAuthenticated)
```

No new endpoints. No new query parameters. No schema changes.

---

## Field Added

### `userHasPosition: boolean`

Appended to every element of the `markets[]` array.

```json
{
  "marketId": 7,
  "question": "Will Ruler win MVP?",
  "status": "open",
  ...
  "userHasPosition": true
}
```

**Semantics:**

| Value | Meaning |
|---|---|
| `true` | The authenticated user has **at least one ACTIVE position** in this market |
| `false` | No active position (user may have had settled or cancelled positions) |

**Why only ACTIVE positions?**

- `userHasPosition` represents *current open exposure*, not historical participation.
- Settled positions are closed — including them would misleadingly flag resolved markets as "participated in."
- Cancelled positions were refunded — the user no longer has skin in the game.
- The browse page is an action surface (buy / enter market). Showing `true` only when the user currently holds a position is the signal the UI needs.

---

## Card Type Change

`PredictionMarketCard` (the base type) is **unchanged** — it is shared by `/markets/:id/detail`, admin-summary, and other endpoints.

A new `BrowseMarketCard` type was added as a strict extension:

```typescript
// server/domains/prediction/types.ts
export interface BrowseMarketCard extends PredictionMarketCard {
  userHasPosition: boolean;
}
```

`BrowseMarketsResponse.markets` was updated from `PredictionMarketCard[]` to `BrowseMarketCard[]`.

---

## Query Strategy

### One query per page, bounded to current market IDs

```sql
SELECT DISTINCT market_id
FROM   prediction_positions
WHERE  user_id   = $userId
  AND  status    = 'active'
  AND  market_id IN ($marketIds...)    -- at most `limit` IDs (max 100)
```

Implemented as `findActiveMarketIdsForUser(userId, marketIds): Promise<Set<number>>` in the repository. The IN-list is bounded to the current page size (≤ 100) so it scales with pagination, not with total market count.

### Execution order

```
Request arrives
    │
    ├── browseMarkets()          ← existing paginated query (unchanged)
    │     ↓ cards[]
    ├── findActiveMarketIdsForUser(userId, cards.map(c => c.marketId))
    │     ↓ Set<number>
    └── cards.map(c => ({ ...c, userHasPosition: activeSet.has(c.marketId) }))
```

The overlay query runs **sequentially after** `browseMarkets()` because it needs the page's market IDs. It cannot be parallelised without knowing those IDs first. At `limit=20` (default) it adds one small indexed query per request.

### Why not N+1?

The naive approach would be one `COUNT(*)` per card. Instead, a single `SELECT DISTINCT market_id ... WHERE market_id IN (...)` covers the entire page in one round-trip. The `prediction_positions(user_id, market_id, status)` combination is filterable by the existing indexed columns.

### Guard condition

The overlay query is skipped entirely when:
- `userId` is absent (not present in session — though the endpoint requires auth, `extractUserId` returns null for admin sessions without a userId)
- `cards` is empty (page beyond total)

---

## Flow of `userId` Through Layers

```
Route handler
  extractUserId(req)                     → userId: string | undefined
  predictionService.getMarketsBrowse({ ..., userId })

Service (getMarketsBrowse)
  BrowseMarketsParams.userId?            → optional; no change to filter logic
  predictionRepository.findActiveMarketIdsForUser(userId, marketIds)

Repository (findActiveMarketIdsForUser)
  SELECT DISTINCT market_id WHERE ...    → Set<number>
```

The `userId` field in `BrowseMarketsParams` is marked optional (`userId?`) so callers that don't have a userId (e.g. programmatic internal calls) still work and simply get `userHasPosition: false` on all cards.

---

## Approximations

| Item | Approximation | Impact |
|---|---|---|
| Sequential overlay query | Runs after `browseMarkets()`, not in parallel | Adds ~1 lightweight indexed query per request. Acceptable at current scale. |
| Admin sessions | `extractUserId(req)` returns null for pure-admin sessions → overlay skipped, all cards get `false` | Admins don't trade; `false` is correct for their use case. |
| Position multiplicity | `findActiveMarketIdsForUser` uses `SELECT DISTINCT` — a user with 3 YES positions in market 7 still gets `userHasPosition: true` (correct) | As intended. |

---

## Future Expansion Ideas

| Enhancement | Notes |
|---|---|
| `userPositionCount: number` | Add `COUNT(*)` instead of `COUNT(DISTINCT ...)` to the same query; expose as a number on `BrowseMarketCard` |
| `userOutcomesHeld: string[]` | Extend the query to `SELECT market_id, ARRAY_AGG(outcome_code)` — one query still, small output |
| `userAvgPrice: string` | Requires a weighted average computation; slightly heavier, still feasible in the same query |
| Parallel execution | If `browseMarkets` is ever split into a COUNT + data query, the overlay can be parallelised with the COUNT leg |
| Cache the overlay | User active market IDs could be cached in a short-TTL Redis set; useful when browse is called multiple times per session |

---

## Example Responses

### Market where `userHasPosition: true`

User has placed an active YES bet on market 7.

```json
{
  "marketId": 7,
  "uid": "mkt_sprint3_ruler_mvp_xyz123",
  "slug": "sprint3-read-test-will-ruler-win-mvp-xyz123",
  "question": "Sprint3 Read Test: Will Ruler win MVP?",
  "description": null,
  "marketType": "binary",
  "currency": "GS",
  "status": "open",
  "openAt": null,
  "closeAt": null,
  "resolveAt": null,
  "settledAt": null,
  "event": null,
  "outcomes": [
    { "outcomeId": 13, "code": "YES", "label": "Yes", "isWinner": false, "impliedProbability": null },
    { "outcomeId": 14, "code": "NO",  "label": "No",  "isWinner": false, "impliedProbability": null }
  ],
  "stats": { "volume24h": "0.000000", "traders24h": 0, "lastPriceYes": null, "lastPriceNo": null },
  "userHasPosition": true
}
```

### Market where `userHasPosition: false`

User has never placed a position, or only has settled/cancelled positions.

```json
{
  "marketId": 8,
  "uid": "mkt_sprint3_xyz_abc",
  "slug": null,
  "question": "Will Faker carry the finals?",
  "status": "settled",
  ...
  "userHasPosition": false
}
```

# Prediction Markets — Sprint 4 Browse Endpoint

**Implemented:** Sprint 4 (browse)
**Status:** Complete and smoke-tested

---

## Overview

Sprint 4 adds `GET /api/predictions/browse` — a unified, paginated market-list endpoint designed to power the main Predictions page. It replaces the need for the UI layer to call three separate narrow endpoints (`/live`, `/upcoming`, `/resolved`) and adds new capabilities:

- **tab-based browsing** with well-defined status semantics
- **explicit status override** for advanced filtering
- **game filter** (via LEFT JOIN to `prediction_events` — no separate query)
- **volume sort** (via LEFT JOIN to `prediction_market_stats` — no analytics pipeline)
- **consistent `PredictionMarketCard[]` payload** instead of the heavier `PredictionMarketWithOutcomes[]`

The three narrow endpoints remain **intact for backward compatibility**. No existing clients are broken.

---

## Endpoint Added

```
GET /api/predictions/browse
```

**Auth:** `isAuthenticated` — same as all prediction read endpoints.
Unauthenticated requests receive `401 { "message": "Unauthorized" }`.

---

## Query Parameters

| Param | Type | Default | Description |
|---|---|---|---|
| `tab` | `live \| upcoming \| resolved` | none | Maps to canonical status set (see Tab Semantics). Mutually exclusive with `statuses` — see Filter Precedence. |
| `statuses` | comma-separated string | none | Explicit DB statuses override. Beats `tab`. Valid values: `draft, open, locked, resolved, settled, cancelled`. |
| `game` | string | none | Filter by `prediction_events.game` (e.g. `lol`). Markets with no linked event are excluded when this filter is set. |
| `currency` | string | none | Filter by `prediction_markets.currency` (e.g. `GS`, `USDC`). |
| `eventId` | integer | none | Filter by `prediction_markets.event_id`. |
| `sort` | `closing_soon \| newest \| volume_desc` | tab-dependent | See Sort Defaults. |
| `page` | integer ≥ 1 | 1 | Page number. |
| `limit` | integer 1–100 | 20 | Results per page. |

### Validation errors (400)

- Unknown `tab` value
- Unknown `sort` value
- Unknown status in `statuses` list
- Non-numeric `eventId`
- `page < 1` or `limit` out of range [1–100]

---

## Filter Precedence Rules

**Rule: explicit `statuses[]` beats `tab`.**

If both `tab` and `statuses` are present in the same request:
- `statuses[]` is used to build the WHERE clause.
- `tab` is silently ignored.
- The response sets `"tab": null` to signal that the tab was overridden.

This prevents silent ambiguity. The client knows exactly which path was taken.

| Request | Effective filter | `tab` in response |
|---|---|---|
| `tab=live` | `status=open AND closeAt > now` | `"live"` |
| `statuses=locked,open` | `status IN (locked, open)` | `null` |
| `tab=live&statuses=locked` | `status=locked` (statuses wins) | `null` |
| _(neither)_ | no status filter | `null` |

---

## Tab Semantics

| Tab | Effective SQL condition |
|---|---|
| `live` | `status = 'open' AND (closeAt IS NULL OR closeAt > NOW())` |
| `upcoming` | `status = 'draft'` |
| `resolved` | `status IN ('settled', 'cancelled', 'resolved')` |

**Note on `resolved` tab:** The `'resolved'` DB status is a transient intermediate state during the settlement pipeline (a market is `resolved` before all positions are `settled`). It is included in the `resolved` tab so markets mid-settlement are visible rather than disappearing from the UI.

---

## Sort Logic

### Defaults per context

| Context | Default sort |
|---|---|
| `tab=live` | `closing_soon` |
| `tab=upcoming` | `newest` |
| `tab=resolved` | `newest` |
| explicit `statuses[]` | `newest` |
| no filter | `newest` |

### Sort implementations

| Sort | SQL | Tie-breaker |
|---|---|---|
| `closing_soon` | `closeAt ASC NULLS LAST` | `createdAt DESC` |
| `newest` | `createdAt DESC` | — |
| `volume_desc` | `COALESCE(stats.volume_24h, 0) DESC` | `createdAt DESC` |

**`closing_soon` with NULLS LAST:** Markets with no `closeAt` (no deadline) are pushed to the end. This is appropriate for `live` tab — "closing soon" means the market still has a deadline.

**`volume_desc` with COALESCE:** Markets with no stats row (just created, no trades) are treated as 0 volume and appear at the bottom. Avoids NULL sort surprises.

**Sort + `resolved` tab:** `closing_soon` on `resolved` markets is allowed but semantically odd (closeAt is usually in the past or null). The default for `resolved` is `newest`, but `closing_soon` is not blocked — the client can pass it if it wants chronological deadline ordering.

---

## Response Shape

```typescript
interface BrowseMarketsResponse {
  page:   number;
  limit:  number;
  total:  number;                 // total rows matching the filter (for pagination)
  tab:    "live" | "upcoming" | "resolved" | null;  // null when statuses[] override used

  appliedFilters: {
    statuses: string[];           // effective status list (empty = no status filter)
    game:     string | null;
    currency: string | null;
    eventId:  number | null;
    sort:     "closing_soon" | "newest" | "volume_desc";
  };

  markets: Array<{
    marketId:    number;
    uid:         string;
    slug:        string | null;
    question:    string;
    description: string | null;
    marketType:  string;
    currency:    string;
    status:      string;
    openAt:      Date | null;
    closeAt:     Date | null;
    resolveAt:   Date | null;
    settledAt:   Date | null;

    event: {
      eventId:        number;
      game:           string;
      tournamentName: string | null;
      eventName:      string | null;
      teamAName:      string | null;
      teamBName:      string | null;
      startsAt:       Date | null;
    } | null;

    outcomes: Array<{
      outcomeId:          number;
      code:               string | null;
      label:              string;
      isWinner:           boolean;
      impliedProbability: string | null;
    }>;

    stats: {
      volume24h:    string;
      traders24h:   number;
      lastPriceYes: string | null;
      lastPriceNo:  string | null;
    } | null;
  }>;
}
```

### Card type: `PredictionMarketCard`

The `markets` array reuses the existing `PredictionMarketCard` interface from `types.ts`. This is a compact projection — it does not include `resolvedOutcomeId`, `createdAt`, lifecycle events, snapshots, or position counts. For those, use the Market Detail endpoint.

---

## Query Architecture

### Main query (LEFT JOIN)

```
SELECT
  prediction_markets.*,
  prediction_events.game, .tournament_name, .event_name, .team_a, .team_b, .scheduled_at,
  prediction_market_stats.volume_24h, .traders_24h, .last_price_yes, .last_price_no
FROM prediction_markets
LEFT JOIN prediction_events ON prediction_events.id = prediction_markets.event_id
LEFT JOIN prediction_market_stats ON prediction_market_stats.market_id = prediction_markets.id
WHERE <conditions>
ORDER BY <sort>
LIMIT <limit> OFFSET <offset>
```

- The LEFT JOIN to `prediction_events` enables both the `game` filter and event card data in a single query.
- The LEFT JOIN to `prediction_market_stats` enables the `volume_desc` sort and stats card data.
- If `game` is filtered, markets without a linked event produce NULL for all event columns and fail the `WHERE prediction_events.game = ?` condition — they are excluded. This is correct: a market with no event has no game.

### Count query

```
SELECT COUNT(*) FROM prediction_markets
LEFT JOIN prediction_events ... LEFT JOIN prediction_market_stats ...
WHERE <same conditions>
```

The count query uses the same JOINs and WHERE as the main query so pagination math is accurate.

### Outcome query (N ≤ limit parallel queries)

Outcomes cannot be aggregated into the main SELECT without `json_agg()` / `array_agg()`. The existing pattern from `listMarkets()` is preserved: one SELECT per market, run via `Promise.all()`. With `limit ≤ 100`, this is 1 + 2 + N total queries.

---

## What This Endpoint Complements / Supersedes

| Existing endpoint | Relationship |
|---|---|
| `GET /api/predictions/live` | Fully superseded by `?tab=live`. Kept for backward compat. |
| `GET /api/predictions/upcoming` | Fully superseded by `?tab=upcoming`. Kept for backward compat. |
| `GET /api/predictions/resolved` | Fully superseded by `?tab=resolved`. Kept for backward compat. |
| `GET /api/predictions/markets` | Returns `PredictionMarketWithOutcomes[]` (heavier shape). Still useful for admin tooling that needs the full model. |
| `GET /api/predictions/markets/:idOrSlug/detail` | Browse returns compact cards; detail returns the full read model for a single market (snapshots, lifecycle events, position counts, availableActions). |
| `GET /api/predictions/home` | Home returns curated sections (liveMatches, trending, upcoming events) for a dashboard/widget. Browse returns flat paginated lists for a full predictions page. |
| `GET /api/predictions/me/positions` | Portfolio — user's own positions. Browse has no user-specific filtering. |

---

## Files Changed

| File | Change |
|---|---|
| `server/domains/prediction/types.ts` | Added `BrowseTab`, `BrowseSort`, `BROWSE_VALID_TABS`, `BROWSE_VALID_SORTS`, `BROWSE_VALID_STATUSES`, `BROWSE_DEFAULT_SORT`, `BrowseMarketsParams`, `BrowseMarketsResponse` |
| `server/domains/prediction/repository.ts` | Added `browseMarkets(params)` with LEFT JOIN queries; imported `BrowseMarketsParams`, `PredictionMarketCard`; exported `browseMarkets` |
| `server/domains/prediction/service.ts` | Added `getMarketsBrowse(raw)` with tab→statuses resolution, sort defaults, liveOnly flag; imported new types; exported `getMarketsBrowse` |
| `server/domains/prediction/routes.ts` | Added `GET /api/predictions/browse` with full validation; updated header comment |
| `docs/architecture/prediction-sprint4-browse.md` | This document |

---

## Example Responses

### `GET /api/predictions/browse?tab=live`

```json
{
  "page": 1,
  "limit": 20,
  "total": 1,
  "tab": "live",
  "appliedFilters": {
    "statuses": ["open"],
    "game": null,
    "currency": null,
    "eventId": null,
    "sort": "closing_soon"
  },
  "markets": [
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
      "stats": { "volume24h": "0.000000", "traders24h": 0, "lastPriceYes": null, "lastPriceNo": null }
    }
  ]
}
```

### `GET /api/predictions/browse?tab=resolved`

```json
{
  "page": 1,
  "limit": 20,
  "total": 6,
  "tab": "resolved",
  "appliedFilters": {
    "statuses": ["settled", "cancelled", "resolved"],
    "game": null,
    "currency": null,
    "eventId": null,
    "sort": "newest"
  },
  "markets": [
    {
      "marketId": 9,
      "question": "Sprint3 Read Test: Will Faker win the series?",
      "status": "settled",
      "event": null,
      "outcomes": [...],
      "stats": null
    },
    ...
  ]
}
```

### `GET /api/predictions/browse?statuses=locked,open&sort=volume_desc`

```json
{
  "page": 1,
  "limit": 20,
  "total": 3,
  "tab": null,
  "appliedFilters": {
    "statuses": ["locked", "open"],
    "game": null,
    "currency": null,
    "eventId": null,
    "sort": "volume_desc"
  },
  "markets": [
    { "marketId": 2, "status": "locked", "stats": { "volume24h": "0.000000", ... }, ... },
    { "marketId": 5, "status": "locked", "stats": { "volume24h": "0.000000", ... }, ... },
    { "marketId": 7, "status": "open",   "stats": { "volume24h": "0.000000", ... }, ... },
    ...
  ]
}
```

`tab: null` signals that explicit `statuses[]` override was used. Default sort for explicit statuses is `newest`, but `volume_desc` was explicitly requested.

### `GET /api/predictions/browse?game=lol&currency=GS&page=1&limit=10`

```json
{
  "page": 1,
  "limit": 10,
  "total": 3,
  "tab": null,
  "appliedFilters": {
    "statuses": [],
    "game": "lol",
    "currency": "GS",
    "eventId": null,
    "sort": "newest"
  },
  "markets": [
    {
      "marketId": 1,
      "question": "Will FURIA win this match against NAVI?",
      "status": "settled",
      "event": {
        "eventId": 1,
        "game": "lol",
        "tournamentName": "ESL Pro League Season 21",
        "teamAName": "FURIA",
        "teamBName": "NAVI",
        "startsAt": "2026-03-15T18:00:00.000Z"
      },
      "outcomes": [...],
      "stats": { "volume24h": "0.000000", "traders24h": 0, "lastPriceYes": null, "lastPriceNo": null }
    }
  ]
}
```

Only markets linked to a `prediction_events` row with `game='lol'` are returned. Markets without a linked event are excluded.

---

## Approximations Made

1. **No `game` column on `prediction_markets`** — `game` lives on `prediction_events`. Markets with `eventId IS NULL` are always excluded when `game` is filtered. The browse endpoint does not invent a fallback game field.
2. **`impliedProbability` is `null` in dev** — set by the Sprint 2 pricing engine when a position is filled. Dev markets have no user orders.
3. **`traders24h` is always `0`** — telemetry placeholder from Sprint 2.
4. **Outcome queries are N+1** — outcomes cannot be aggregated without `json_agg()`. At `limit=20` this is 20 queries all run in parallel via `Promise.all`. At `limit=100` it is 100 parallel queries. Acceptable at current scale; a future sprint can switch to a single `json_agg()` query if needed.
5. **`volume_desc` with `COALESCE(volume24h, 0)`** — markets with no stats row score 0 volume. In practice, `createMarket` inserts a zero-stats row immediately, so all markets should have a stats row.

---

## What Remains for Next Steps

| Item | Priority |
|---|---|
| Portfolio composition endpoint — `GET /api/predictions/me/portfolio` (position-weighted summary per market) | High |
| `GET /api/predictions/browse` with user position overlay — include a flag per card if the user holds a position | Medium |
| Replace `/live`, `/upcoming`, `/resolved` with client-side calls to `/browse?tab=...` | Low (backward compat — no rush) |
| `game` filter performance — add index on `prediction_events.game` + compound index on `prediction_markets.event_id, currency` | Medium |
| `json_agg()` for outcomes — collapse the N outcome queries into a single aggregated query | Low |
| Cursor-based pagination — replace `page/limit` with `cursor/limit` for large sorted result sets | Low |

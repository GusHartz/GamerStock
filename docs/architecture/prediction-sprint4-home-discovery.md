# Prediction Markets — Sprint 4 Home Discovery Read Model

**Implemented:** Sprint 4 (home aggregation)  
**Status:** Complete and smoke-tested

---

## Overview

Sprint 4 adds `GET /api/predictions/home` — a single aggregated endpoint that powers the Home screen's prediction-related discovery sections. It returns three sections (liveMatches, trendingPredictions, upcomingEvents) and a null placeholder for hotPlayers.

No new analytics pipelines, ranking engines, time-series computation, or DB schema changes were added. All data is composed from existing prediction tables using targeted queries.

---

## Endpoint Added

```
GET /api/predictions/home
```

**Auth:** `isAuthenticated` — consistent with all other prediction browse endpoints (`/live`, `/upcoming`, `/resolved`, `/markets`). This is a read-only endpoint that requires the user to be logged in.

**No query parameters.** Each section has a fixed internal limit of 8 items. If these need to be configurable, query params can be added in a future sprint without any DB changes.

---

## Response Shape

```typescript
{
  liveMatches:         LiveMatchCard[];       // open markets, soonest-closing first
  trendingPredictions: TrendingCard[];        // open/locked/settled by volume24h DESC
  upcomingEvents:      UpcomingEventCard[];   // scheduled events by startsAt ASC
  hotPlayers:          null;                  // always null — see Hot Players section below
  generatedAt:         string;               // ISO 8601 timestamp of response generation
  totalLive:           number;               // length of liveMatches
}
```

### LiveMatchCard

Represents one currently-open prediction market, sorted by how soon it closes (`closeAt ASC NULLS LAST`).

```typescript
{
  marketId:  number;
  uid:       string;
  slug:      string | null;
  question:  string;
  status:    "open";            // always "open" for this section
  currency:  string;            // "GS" or "USDC"
  openAt:    Date | null;
  closeAt:   Date | null;       // use for countdown timers on the UI
  outcomes:  Array<{
    outcomeId:  number;
    code:       string | null;
    label:      string;
    poolShare:  string;         // numeric; pool weight for this outcome
  }>;
  stats: {
    volume24h:    string;
    traders24h:   number;
    lastPriceYes: string | null;
    lastPriceNo:  string | null;
  } | null;
  event: {                      // null if market has no linked prediction event
    eventId:        number;
    game:           string;
    tournamentName: string | null;
    eventName:      string | null;
    teamAName:      string | null;
    teamBName:      string | null;
    startsAt:       Date | null;
  } | null;
}
```

### TrendingCard

Same structure as LiveMatchCard but `status` can be `"open" | "locked" | "settled"`. Adds a `trendingLabel` field.

```typescript
{
  // ... all LiveMatchCard fields except status is broader ...
  status:        string;        // "open" | "locked" | "settled"
  trendingLabel: string;        // cheap derived signal for UI badging
}
```

**trendingLabel derivation logic (no computation — pure conditionals):**

| Condition | Label |
|---|---|
| `volume24h > 5` | `"high_volume"` |
| `status === "settled"` | `"recently_settled"` |
| `status === "locked"` | `"action_locked"` |
| otherwise | `"active"` |

The threshold for `high_volume` is `> 5 GS/USDC`. In production this can be tuned without schema changes.

### UpcomingEventCard

Represents a prediction event in `scheduled` status — i.e., an event that has been created but whose markets may not yet be open to trading.

```typescript
{
  eventId:            number;
  uid:                string;
  title:              string;
  game:               string;
  region:             string | null;
  tournamentName:     string | null;
  eventName:          string | null;
  teamAName:          string | null;
  teamBName:          string | null;
  startsAt:           Date | null;
  linkedMarketsCount: number;     // count of linked draft/open/locked markets
  firstMarketSlug:    string | null; // slug of the earliest linked market (for deep-linking)
}
```

---

## How Each Section Is Defined

### liveMatches

**Query:** `prediction_markets WHERE status = 'open' AND (closeAt IS NULL OR closeAt > NOW()) ORDER BY closeAt ASC LIMIT 8`

- Only markets open to order placement are shown (same `liveOnly` filter as `GET /api/predictions/live`)
- Sorted soonest-closing first so the UI can display a countdown urgency signal
- Outcomes, event, and stats enriched for each row (same pattern as existing `listMarkets`)

### trendingPredictions

**Query:** `prediction_markets LEFT JOIN prediction_market_stats ON marketId WHERE status IN ('open', 'locked', 'settled') ORDER BY volume24h DESC LIMIT 8`

- Cancelled markets are excluded — they are terminal and misleading in a "trending" context (cancelled markets may have volume from the test period but their activity is finished)
- Draft markets excluded — they have no trading history, so `volume24h = 0` always
- If volume is equal (e.g., all zero in a dev environment), the DB's natural order applies
- Left join ensures markets without a stats row still appear (they sort last by volume)
- `trendingLabel` is derived in the service layer, not the DB

### upcomingEvents

**Query:** `prediction_events WHERE status = 'scheduled' ORDER BY startsAt ASC LIMIT 8`

- Uses the `prediction_events` table directly (event-level, not market-level) — this allows discovery of events even if their markets haven't been drafted yet
- `linkedMarketsCount` is computed with a GROUP BY subquery on markets with status in `['draft', 'open', 'locked']` for the returned event IDs — terminal markets excluded
- `firstMarketSlug` is the slug of the earliest-created linked market (for direct deep-link on the discovery card)

---

## Hot Players Section

`hotPlayers` is **always `null`** in the home response from the prediction domain.

**Why not implemented here:**

- Hot player discovery is owned by the existing player/discovery domain. The endpoint `GET /api/riot/players` already returns players ordered by `volume24h DESC` — this is the correct source.
- Coupling player asset data into the prediction domain would violate the domain isolation rule established in Sprint 1.

**Recommendation for the frontend Home screen:** Source the "Hot Players" section directly from `GET /api/riot/players?limit=8` or a dedicated player-domain aggregation endpoint. The `hotPlayers: null` field is a stable signal to the client that this section must be fetched independently.

---

## Auth Assumptions

- `isAuthenticated` middleware: checks `req.session?.isAdmin || req.session?.userId` or `req.isAuthenticated()` (Passport)
- Unauthenticated requests receive `401 { "message": "Unauthorized" }`
- No admin-only restriction — any authenticated user can call this endpoint
- This matches the auth level of all other prediction browse endpoints (`/live`, `/upcoming`, `/resolved`)

**Future consideration:** If GamerStock adds a public browse mode (no-login previews), `/api/predictions/home` is a candidate for making public. The only change needed is removing `isAuthenticated` from the route — no DB or logic changes required.

---

## Implementation Details

### New Files

| File | Change |
|---|---|
| `server/domains/prediction/types.ts` | Added `HomeEventContext`, `HomeStatsContext`, `HomeOutcomeStub`, `LiveMatchCard`, `TrendingCard`, `UpcomingEventCard`, `PredictionHomeResponse` interfaces |
| `server/domains/prediction/repository.ts` | Added `getHomeData({ liveLimit, trendingLimit, upcomingLimit })` function; exported it |
| `server/domains/prediction/service.ts` | Added `toHomeOutcomeStubs`, `toHomeStatsContext`, `toHomeEventContext`, `deriveTrendingLabel` helpers; added `getHome()`; exported it via `predictionService` |
| `server/domains/prediction/routes.ts` | Added `GET /api/predictions/home` route; updated header comment |
| `docs/architecture/prediction-sprint4-home-discovery.md` | This document |

### `getHomeData` function (repository)

Runs **three targeted DB queries** — each cheap and indexed:

1. **Live markets query** — single table scan with two-column WHERE (status, closeAt). `status` index applies.
2. **Trending markets query** — left join with `prediction_market_stats` (one row per market), WHERE on indexed `status`. `volume24h` is a table column, so ORDER BY doesn't require a sort on a computed value.
3. **Upcoming events query** — single table scan on `prediction_events` WHERE `status = 'scheduled'`. `idx_pred_events_status` index applies.
4. **Count subquery** — GROUP BY `event_id` on `prediction_markets` with `eventId IN (...)` for the returned event IDs (max 8). Bounded subquery.
5. **First slug subquery** — SELECT from `prediction_markets` WHERE `eventId IN (...)` ORDER BY `createdAt ASC`. Bounded.

Total DB round-trips: 3 main queries + 2 enrichment subqueries + N outcome/event/stats fetches for each live/trending row (bounded by 8+8=16 markets max). In production this can be optimized to a single JOIN query per section if N+1 latency becomes observable.

### `getHome` function (service)

Maps repository output to typed response cards:
- `toHomeOutcomeStubs` — projects outcome columns to `HomeOutcomeStub`
- `toHomeStatsContext` — projects stats to `HomeStatsContext` (null-safe)
- `toHomeEventContext` — projects event to `HomeEventContext` (null-safe)
- `deriveTrendingLabel` — pure conditional, no DB access
- Sets `hotPlayers: null` explicitly

---

## Example Response

```json
{
  "liveMatches": [
    {
      "marketId": 7,
      "uid": "mkt_ABCxyz123456",
      "slug": "sprint3-read-test-will-ruler-win-mvp-xyz123",
      "question": "Sprint3 Read Test: Will Ruler win MVP?",
      "status": "open",
      "currency": "GS",
      "openAt": null,
      "closeAt": null,
      "outcomes": [
        { "outcomeId": 13, "code": "YES", "label": "Yes", "poolShare": "0.000000" },
        { "outcomeId": 14, "code": "NO",  "label": "No",  "poolShare": "0.000000" }
      ],
      "stats": {
        "volume24h": "0.000000",
        "traders24h": 0,
        "lastPriceYes": null,
        "lastPriceNo": null
      },
      "event": null
    }
  ],
  "trendingPredictions": [
    {
      "marketId": 1,
      "uid": "mkt_dev_furia_win",
      "slug": "dev-furia-wins-match-1",
      "question": "Will FURIA win this match against NAVI?",
      "status": "settled",
      "currency": "GS",
      "openAt": null,
      "closeAt": null,
      "outcomes": [
        { "outcomeId": 1, "code": "YES", "label": "Yes — FURIA wins", "poolShare": "7.000000" },
        { "outcomeId": 2, "code": "NO",  "label": "No — NAVI wins",   "poolShare": "0.000000" }
      ],
      "stats": {
        "volume24h": "7.000000",
        "traders24h": 0,
        "lastPriceYes": "0.500000",
        "lastPriceNo": null
      },
      "event": {
        "eventId": 1,
        "game": "lol",
        "tournamentName": "ESL Pro League Season 21",
        "eventName": "Group Stage Day 1",
        "teamAName": "FURIA",
        "teamBName": "NAVI",
        "startsAt": "2026-03-15T18:00:00.000Z"
      },
      "trendingLabel": "recently_settled"
    },
    {
      "marketId": 2,
      "uid": "mkt_autolock_test",
      "slug": "auto-lock-test-will-team-a-beat-team-b-xyz",
      "question": "Auto-lock test: Will Team A beat Team B?",
      "status": "locked",
      "currency": "GS",
      "openAt": null,
      "closeAt": null,
      "outcomes": [ ... ],
      "stats": { "volume24h": "0.000000", "traders24h": 0, "lastPriceYes": null, "lastPriceNo": null },
      "event": null,
      "trendingLabel": "action_locked"
    }
  ],
  "upcomingEvents": [
    {
      "eventId": 1,
      "uid": "evt_dev123456",
      "title": "FURIA vs NAVI — ESL Pro League Season 21",
      "game": "lol",
      "region": null,
      "tournamentName": "ESL Pro League Season 21",
      "eventName": "Group Stage Day 1",
      "teamAName": "FURIA",
      "teamBName": "NAVI",
      "startsAt": "2026-03-15T18:00:00.000Z",
      "linkedMarketsCount": 1,
      "firstMarketSlug": "dev-furia-wins-match-1"
    }
  ],
  "hotPlayers": null,
  "generatedAt": "2026-03-14T13:29:27.496Z",
  "totalLive": 1
}
```

---

## Remaining TODOs for Next Sprint 4 Steps

### Predictions Page Read Model

The Predictions browse page needs pagination over all active markets. The existing `GET /api/predictions/live`, `GET /api/predictions/upcoming`, and `GET /api/predictions/resolved` endpoints already cover this, but a unified "all predictions" endpoint may be needed:

- `GET /api/predictions/browse?status=open|locked|settled|all&game=lol&currency=GS&page=1&limit=20`
- Would reuse `listMarkets` with multi-status filter (already supported via `statuses[]`)

### Market Detail Read Model

A player-facing market detail page needs a rich single-market response. The existing `GET /api/predictions/markets/:idOrSlug` already returns `PredictionMarketWithOutcomes` (market + outcomes + event + stats). Gaps:

- **Position count** for social proof (`X people have bet`)
- **Price history** (already available via `GET /api/predictions/markets/:id/price-history`)
- **Active positions for current user** (already available via `GET /api/predictions/me/positions`)

A `GET /api/predictions/markets/:idOrSlug/detail` endpoint aggregating all of the above in one request would improve frontend load performance.

### Home Section Limits as Query Params

Currently all three sections are hard-coded to 8 items. Adding optional query params (`liveLimit`, `trendingLimit`, `upcomingLimit`) would allow the frontend to control this without backend changes. Low priority — 8 items covers typical mobile home cards.

### Home Caching

`GET /api/predictions/home` runs live DB queries on every call. For high-traffic production use, a short TTL cache (e.g., 60 seconds) on the home aggregation would reduce DB load without impacting freshness. This can be implemented in the service layer with a simple in-memory Map or a Redis key.

### Hot Players Section

Source from `GET /api/riot/players` (player domain). The home response always returns `hotPlayers: null` — the frontend must fetch this section independently. A future Home aggregation service could compose both domains, but cross-domain coupling should be explicit and opt-in.

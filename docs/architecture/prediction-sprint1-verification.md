# Prediction Markets — Sprint 1 Verification Guide

**Domain:** `prediction`  
**Status:** Sprint 1 complete — Foundation + Schema + Read Endpoints + Dev Seed  
**Last updated:** Sprint 1 step 3

---

## What Sprint 1 Completed

| Area | Status |
|---|---|
| Drizzle schema — 8 tables | ✅ |
| DB tables pushed | ✅ |
| Backend module scaffolding | ✅ |
| Lifecycle enforcement (transition guard) | ✅ |
| Admin endpoints (create event, create market, transition) | ✅ |
| Read endpoints (list events, list markets, get market by id/slug) | ✅ |
| Dev seed (idempotent, esports-flavored) | ✅ |
| Health endpoint with DB counts + seed detection | ✅ |
| Architecture documentation | ✅ |
| Financial settlement wiring | ❌ Sprint 2 |
| Order matching engine | ❌ Sprint 2 |
| Realtime price updates | ❌ Sprint 2 |
| Frontend UI | ❌ Sprint 2+ |

---

## Schema Tables

| Table | Purpose |
|---|---|
| `prediction_events` | Real-world match/tournament context (teams = context only, not assets) |
| `prediction_markets` | Binary/multi-outcome question with lifecycle status |
| `prediction_outcomes` | Possible outcomes per market (YES/NO etc.) |
| `prediction_positions` | User position projections (financial truth is in wallet ledger) |
| `prediction_orders` | Immutable order log per bet action |
| `prediction_settlements` | Payout audit trail per user per market |
| `prediction_price_snapshots` | Time-series implied probability ticks |
| `prediction_market_stats` | Materialized rolling stats (volume_24h, last prices) |

---

## Files Added or Edited During Sprint 1

### New files

| File | Description |
|---|---|
| `shared/schema/prediction.ts` | All 8 Drizzle tables + insert schemas + inferred types |
| `server/domains/prediction/types.ts` | Domain-internal TypeScript types |
| `server/domains/prediction/validators.ts` | Zod request validation schemas |
| `server/domains/prediction/repository.ts` | Data access layer |
| `server/domains/prediction/service.ts` | Business logic + lifecycle enforcement |
| `server/domains/prediction/routes.ts` | Express routes + auth guards |
| `server/domains/prediction/seed.ts` | Idempotent dev seed (FURIA vs NAVI) |
| `docs/architecture/prediction-domain-foundation.md` | Architecture + delta notes |
| `docs/architecture/prediction-sprint1-verification.md` | This document |

### Edited files

| File | Change |
|---|---|
| `shared/schema/index.ts` | Added `export * from "./prediction"` |
| `server/routes.ts` | Imported + registered `registerPredictionRoutes`; added `/api/predictions/health` to public paths |

---

## Available Endpoints

### Public

```
GET /api/predictions/health
```

### Authenticated (user session required)

```
GET /api/predictions/events
GET /api/predictions/markets
GET /api/predictions/markets/:idOrSlug
GET /api/predictions/me/positions
POST /api/predictions/markets/:id/bet   ← Sprint 1 stub (no wallet debit)
```

### Admin only

```
POST /api/predictions/events
POST /api/predictions/markets
POST /api/predictions/markets/:id/transition
```

---

## How to Seed Local Prediction Data

The dev seed runs **automatically at startup** in development when the sample records are absent.

To verify it ran:

```bash
curl http://localhost:5000/api/predictions/health
# Look for: "seedDetected": true
```

To manually trigger or inspect:

```bash
# Check if seed data is in DB
curl -H "Cookie: <session>" http://localhost:5000/api/predictions/events
curl -H "Cookie: <session>" http://localhost:5000/api/predictions/markets
curl -H "Cookie: <session>" http://localhost:5000/api/predictions/markets/dev-furia-wins-match-1
```

The seed file is at `server/domains/prediction/seed.ts`.  
The sample event uses `externalRef = "dev-sample-furia-vs-navi-2025"` and slug `"dev-furia-wins-match-1"` as idempotency keys.

---

## Example API Responses

### GET /api/predictions/health

```json
{
  "domain": "prediction",
  "status": "operational",
  "sprint": 1,
  "timestamp": "2025-03-14T00:00:00.000Z",
  "mounted": true,
  "schemaTablesKnown": [
    "prediction_events",
    "prediction_markets",
    "prediction_outcomes",
    "prediction_positions",
    "prediction_orders",
    "prediction_settlements",
    "prediction_price_snapshots",
    "prediction_market_stats"
  ],
  "counts": {
    "events": 1,
    "markets": 1,
    "outcomes": 2
  },
  "seedDetected": true
}
```

### GET /api/predictions/events

```json
{
  "events": [
    {
      "id": 1,
      "uid": "evt_abc123",
      "title": "FURIA vs NAVI — ESL Pro League Season 21",
      "tournamentName": "ESL Pro League Season 21",
      "eventName": "FURIA vs NAVI — Group Stage Match",
      "game": "lol",
      "region": "NA",
      "eventType": "match",
      "teamAName": "FURIA",
      "teamBName": "NAVI",
      "status": "scheduled",
      "startsAt": "2025-03-16T00:00:00.000Z",
      "externalRef": "dev-sample-furia-vs-navi-2025",
      "createdAt": "2025-03-14T00:00:00.000Z"
    }
  ],
  "total": 1
}
```

### GET /api/predictions/markets

```json
{
  "markets": [
    {
      "id": 1,
      "uid": "mkt_xyz789",
      "slug": "dev-furia-wins-match-1",
      "question": "Will FURIA win this match against NAVI?",
      "marketType": "binary",
      "status": "open",
      "currency": "GS",
      "poolTotal": "0",
      "minStake": "1.000000",
      "maxStake": "10000.000000",
      "outcomes": [
        { "id": 1, "code": "YES", "label": "Yes — FURIA wins", "isWinner": false, "poolShare": "0" },
        { "id": 2, "code": "NO",  "label": "No — NAVI wins",   "isWinner": false, "poolShare": "0" }
      ],
      "event": {
        "id": 1,
        "teamAName": "FURIA",
        "teamBName": "NAVI",
        "status": "scheduled"
      },
      "stats": {
        "volume24h": "0",
        "traders24h": 0,
        "lastPriceYes": "0.500000",
        "lastPriceNo": "0.500000"
      }
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 20
}
```

### GET /api/predictions/markets/dev-furia-wins-match-1

Same shape as above but for a single market. Also accessible by numeric ID: `GET /api/predictions/markets/1`

---

## Lifecycle State Machine

```
draft ──► open ──► locked ──► resolved ──► settled
  │         │         │
  └─────────┴─────────┴──────────────────► cancelled
```

Transition using admin endpoint:

```bash
# Open the market (already open from seed)
POST /api/predictions/markets/1/transition
Body: { "targetStatus": "locked" }

# Resolve with outcome ID
POST /api/predictions/markets/1/transition
Body: { "targetStatus": "resolved", "resolvedOutcomeId": 1 }

# Settle (triggers Sprint 2 wallet credits — currently logged only)
POST /api/predictions/markets/1/transition
Body: { "targetStatus": "settled" }
```

---

## What Is Intentionally NOT Implemented

| Feature | Reason |
|---|---|
| Wallet lock on bet | Sprint 2 — walletService.lockFunds() |
| Payout credit on settlement | Sprint 2 — walletService.consumeLockedAndCredit() |
| Refund on cancel | Sprint 2 — walletService.unlockFunds() |
| Order-to-position fill flow | Sprint 2 — currently direct position insert |
| Price snapshot writes on bet | Sprint 2 — pricing engine |
| Auto-lock when closeAt elapses | Sprint 2 — background job |
| Oracle / result feed | Sprint 2+ — admin manual resolution only |
| Frontend UI | Sprint 2+ |
| Realtime pool updates via SSE | Sprint 2+ |
| CLOB matching engine | Sprint 2+ |

---

## Recommended Sprint 2 First Tasks

1. **Wallet debit on bet** — wire `walletService.lockFunds()` inside `predictionService.placeBet()`
2. **Order record creation** — replace direct position insert with order → fill flow
3. **Settlement engine** — when market transitions to `settled`:
   - Calculate pro-rata payout per winning position
   - Apply platform rake via fee-engine
   - Call `walletService.consumeLockedAndCredit()` per winner
   - Write `predictionSettlements` rows
4. **Cancellation refund** — when market transitions to `cancelled`:
   - Call `walletService.unlockFunds()` per active position
5. **Price snapshot on bet** — record `(stake / poolTotal)` as implied prob tick after each bet
6. **Auto-lock background job** — poll `closeAt` every minute
7. **Admin UI tab** — Prediction Markets tab in Market Lab with lifecycle controls

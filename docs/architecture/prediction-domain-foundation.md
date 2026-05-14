# Prediction Markets — Domain Foundation
**Sprint 1 | GamerStock Platform**

---

## Domain Goal

Prediction Markets introduce a **temporary, event-based wagering layer** on top of the GamerStock platform. Users can bet GS$ (or USDC) on real-world esports outcomes — match winners, series results, tournament progressions — using pari-mutuel style pooled markets.

Prediction markets are **structurally separate** from the permanent player-asset market. Players remain permanent equity assets. Teams are referenced as context strings only, never as tradeable instruments.

---

## Separation of Concerns

### Why prediction markets must be isolated from the permanent asset market

| Concern | Permanent Asset Market | Prediction Market |
|---|---|---|
| Asset lifetime | Permanent (players persist indefinitely) | Temporary (market expires after event) |
| Pricing mechanism | AMM with bid/ask spread, momentum, valuation | Pari-mutuel pool (implied probability from stakes) |
| Outcome | Continuous — no single resolution event | Binary/discrete — one outcome wins |
| Portfolio projection | Shares held across time, accumulate value | Stakes locked until settlement, then gone |
| Settlement | No settlement — asset retains value | One-time: losers get nothing, winners split pool |
| Valuation inputs | Riot API performance data, ELO, volume | External match result only |

Coupling prediction logic into the AMM or valuation engine would:
1. Pollute the permanent asset pricing with temporary event noise
2. Make settlement logic entangled with the continuous share model
3. Create race conditions between market simulation and event resolution

---

## Lifecycle States

```
draft ──► open ──► locked ──► resolved ──► settled
  │         │         │
  └─────────┴─────────┴──────────────────► cancelled
```

| State | Description |
|---|---|
| `draft` | Created by admin, not yet visible to users. Outcomes defined. |
| `open` | Accepting bets. Users can place stakes. Pool accumulates. |
| `locked` | Betting window closed (e.g., match started). No new bets. |
| `resolved` | Admin (or oracle) marks winning outcome. Payout calculation begins. |
| `settled` | Wallet credits dispatched to winners. Market is frozen. |
| `cancelled` | Market voided at any pre-resolved state. All stakes refunded. |

### Valid transitions

- `draft` → `open` | `cancelled`
- `open` → `locked` | `cancelled`
- `locked` → `resolved` | `cancelled`
- `resolved` → `settled`
- `settled` → _(terminal)_
- `cancelled` → _(terminal)_

---

## Financial Truth Model

**The wallet ledger is the source of truth. Everything else is a projection.**

```
User places bet
  └─ walletService.lockFunds()             ← ledger entry (referenceType: 'prediction_bet')
  └─ predictionPositions row created       ← projection row (status: 'active')

Market settles
  └─ walletService.consumeLockedAndCredit()  ← ledger entry (referenceType: 'prediction_payout')
  └─ predictionPositions.status → 'won'     ← projection updated

Market cancels
  └─ walletService.unlockFunds()            ← ledger entry (referenceType: 'prediction_refund')
  └─ predictionPositions.status → 'refunded' ← projection updated
```

> **Sprint 1 note:** The `walletService` financial wiring is scaffolded with TODO comments. Full debit/credit integration is Sprint 2's primary deliverable.

---

## Integration Points with Existing GamerStock Modules

### Reused (Sprint 2 integration)

| Module | How it integrates |
|---|---|
| **wallet / ledger** | Lock funds on bet, credit winners on settlement, unlock on cancel |
| **identity / session** | `userId` from `req.session.userId` for all position ownership |
| **admin domain** | Admin endpoints use existing `isAdminOnly` auth guard |
| **portfolio (future)** | Can project prediction exposure as a separate portfolio segment |

### Not coupled (intentionally excluded)

| Module | Why excluded |
|---|---|
| **Asset AMM core** | Permanent asset pricing must not be polluted by event noise |
| **Permanent asset valuation** | Riot API performance signals are irrelevant to prediction outcomes |
| **trade-settlement** | That service handles equity share settlement — incompatible lifecycle |
| **orders domain** | Order book mechanics don't apply to pooled pari-mutuel wagering |
| **synthetic domain** | Synthetic assets are a different abstraction layer |

---

## New Backend Module Structure

```
server/domains/prediction/
├── routes.ts       ← Express route registration, auth guards, input parsing
├── service.ts      ← Business logic, lifecycle enforcement, validation rules
├── repository.ts   ← All DB access (no direct db calls outside this file)
├── types.ts        ← Internal domain types, service result shapes
└── validators.ts   ← Zod schemas for HTTP request validation
```

### Shared schema

```
shared/schema/prediction.ts
├── predictionEvents    (table)
├── predictionMarkets   (table)
├── predictionOutcomes  (table)
├── predictionPositions (table)
├── Insert* types
└── Select* types
```

---

## Files Created in Sprint 1

### New files

| File | Purpose |
|---|---|
| `shared/schema/prediction.ts` | Drizzle ORM table definitions + inferred types |
| `server/domains/prediction/types.ts` | Domain-internal TypeScript types |
| `server/domains/prediction/validators.ts` | Zod request validation schemas |
| `server/domains/prediction/repository.ts` | Data access layer (all DB operations) |
| `server/domains/prediction/service.ts` | Business logic and lifecycle enforcement |
| `server/domains/prediction/routes.ts` | Express routes + auth guards |
| `docs/architecture/prediction-domain-foundation.md` | This document |

### Edited files

| File | Change |
|---|---|
| `shared/schema/index.ts` | Added `export * from "./prediction"` |
| `server/routes.ts` | Imported and registered `registerPredictionRoutes` |

### Database tables created (direct SQL)

- `prediction_events`
- `prediction_markets`
- `prediction_outcomes`
- `prediction_positions`

---

## Active Endpoints (Sprint 1)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/predictions/health` | Public | Domain health check |
| `GET` | `/api/predictions/events` | User | List all prediction events |
| `POST` | `/api/predictions/events` | Admin | Create a prediction event |
| `GET` | `/api/predictions/markets` | User | List markets (filterable by status/event/currency) |
| `GET` | `/api/predictions/markets/:id` | User | Single market with outcomes |
| `POST` | `/api/predictions/markets` | Admin | Create a market + outcomes in one call |
| `POST` | `/api/predictions/markets/:id/transition` | Admin | Advance lifecycle state |
| `POST` | `/api/predictions/markets/:id/bet` | User | Place a bet (position created; wallet wiring Sprint 2) |
| `GET` | `/api/predictions/me/positions` | User | User's prediction positions |

---

## Next Recommended Implementation Steps (Sprint 2)

1. **Wallet integration** — Wire `walletService.lockFunds()` in `placeBet()` and `walletService.consumeLockedAndCredit()` in the settlement flow.

2. **Settlement engine** — When status transitions to `settled`, calculate pro-rata payouts for all winning positions (pool minus platform fee, divided by total winning stake).

3. **Fee engine integration** — Apply a platform rake (e.g., 3%) on the pool at settlement, credited to the system wallet via the existing `fee-engine` domain.

4. **Admin Market Lab UI** — Add a Prediction Markets tab to the admin Market Lab page with lifecycle controls, market creation form, and resolution interface.

5. **User-facing UI** — Terminal prediction card, market detail page, position history panel.

6. **Realtime updates** — Broadcast pool size, implied probability, and status changes via the existing SSE broadcaster when markets are updated.

7. **Automated locking** — Background job that transitions `open → locked` when `closesAt` timestamp elapses.

8. **Oracle / result feed** — Integration point for automated match result ingestion (Riot API match data, third-party esports APIs).

---

## Sprint 1 Step 2 — Schema Normalization Delta

### What changed

**Additive columns added to existing tables**

| Table | Columns added |
|---|---|
| `prediction_events` | `tournament_name`, `event_name`, `status` (default: `scheduled`) |
| `prediction_markets` | `slug` (unique), `market_type` (default: `binary`), `resolution_source` |
| `prediction_outcomes` | `code` (short machine label e.g. "YES"/"NO"), `payout_value` |
| `prediction_positions` | `quantity`, `avg_price`, `cost_basis`, `realized_pnl`; `stake` made nullable |

**Naming aliases (spec vs DB)**
- `question` (DB) = `title` (spec) — DB column kept for backward compat; both refer to the market question
- `opens_at` / `closes_at` / `resolved_at` (DB) = `open_at` / `close_at` / `resolve_at` (spec) — same data
- `created_by_user_id` (DB) = `created_by` (spec) — Drizzle field now aliased as `createdBy`

**Four new tables created**

| Table | Purpose |
|---|---|
| `prediction_orders` | Immutable order log; each bet/trade creates one record |
| `prediction_settlements` | Payout audit trail per user per market (Sprint 2 wiring) |
| `prediction_price_snapshots` | Time-series price ticks for charting |
| `prediction_market_stats` | Materialized rolling stats (volume_24h, traders_24h, last prices) |

**DB indexes added**
12 new indexes across all prediction tables for query performance.

### Repository additions

- `findMarketBySlug(slug)` — look up a market by URL-friendly slug
- `findMarketWithOutcomes` now accepts `number | string` (id or slug)
- `stats` included in all market response shapes
- Full CRUD stubs for orders, settlements, price snapshots, market stats

### Validator additions

- `listEventsQuerySchema` — game/status/limit filters for GET /events
- `createPredictionEventSchema` — extended with `tournamentName`, `eventName`, `startsAt`
- `createPredictionMarketSchema` — extended with `slug`, `marketType`, `resolutionSource`, `openAt`, `closeAt`

### Endpoints after normalization

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/predictions/health` | Public | Lists all 8 tables |
| GET | `/api/predictions/events` | User | Filterable by game, status |
| POST | `/api/predictions/events` | Admin | Creates event with tournament/team context |
| GET | `/api/predictions/markets` | User | Filterable by status, marketType, eventId, currency |
| GET | `/api/predictions/markets/:idOrSlug` | User | Accepts numeric ID or slug string |
| POST | `/api/predictions/markets` | Admin | Creates market + outcomes + stats row atomically |
| POST | `/api/predictions/markets/:id/transition` | Admin | Lifecycle enforcement with transition guard |
| POST | `/api/predictions/markets/:id/bet` | User | Sprint 1 stub — wallet debit deferred |
| GET | `/api/predictions/me/positions` | User | User's prediction positions |

### Remaining TODOs for Sprint 2

1. `walletService.lockFunds()` on bet placement (replace sprint 1 stub in `placeBet`)
2. `walletService.consumeLockedAndCredit()` on settlement (in `transitionMarketStatus → settled`)
3. `walletService.unlockFunds()` on cancellation
4. Populate `prediction_settlements` records on settlement/cancellation
5. Populate `prediction_orders` on bet placement (replace direct position creation with order → position flow)
6. Populate `prediction_price_snapshots` from pool ratios on every bet
7. Background job to auto-lock markets when `closeAt` elapses

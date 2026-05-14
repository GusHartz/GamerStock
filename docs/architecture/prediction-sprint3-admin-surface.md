# Prediction Markets — Sprint 3 Admin Surface

**Implemented:** Sprint 3 (admin lifecycle normalization)  
**Status:** Complete and smoke-tested

---

## Overview

This document describes the normalized admin API surface for the Prediction Markets domain added in Sprint 3. The goal is a coherent, ergonomic set of endpoints for an admin UI or Market Lab to drive the full market lifecycle without needing to know internal implementation details.

No financial logic was changed. The verified settlement, cancellation, and wallet flows are wrapped — not rewritten.

---

## Normalized Admin Routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/predictions/events` | Create a new prediction event |
| `POST` | `/api/predictions/markets` | Create a new market (stays in draft) |
| `POST` | `/api/predictions/markets/:id/open` | **NEW** Open a draft market for trading |
| `POST` | `/api/predictions/markets/:id/lock` | **NEW** Lock an open market (close order intake) |
| `POST` | `/api/predictions/markets/:id/resolve` | Resolve locked market + settle all positions |
| `POST` | `/api/predictions/markets/:id/cancel` | Cancel market + refund all active positions |
| `POST` | `/api/predictions/markets/:id/transition` | Generic transition (backward-compat / CLI) |
| `GET`  | `/api/predictions/markets/:id/admin-summary` | **NEW** Compact operational snapshot |
| `GET`  | `/api/predictions/markets/:id/events` | Lifecycle audit event trail |

All admin mutation and read endpoints require `isAuthenticated + isAdminOnly`.

---

## Response Shape Convention

All five lifecycle mutation endpoints (`open`, `lock`, `transition`, `resolve`, `cancel`) return the `AdminMutationResponse` envelope:

```typescript
{
  ok:             boolean;      // always true on success (errors return 4xx/5xx)
  action:         string;       // "open" | "lock" | "resolve" | "cancel" | "transition"
  marketId:       number;
  previousStatus: string;       // market status BEFORE the mutation
  newStatus:      string;       // market status AFTER the mutation
  duplicate?:     boolean;      // true when idempotent retry detected

  // resolve-specific (present only on action="resolve")
  winningOutcomeId?:   number;
  positionsSettled?:   number;
  positionsSkipped?:   number;
  totalWinnerPayout?:  string;

  // cancel-specific (present only on action="cancel")
  positionsCancelled?: number;
  totalRefunded?:      string;
  currency?:           string;
}
```

**Design rationale:** `previousStatus` and `newStatus` are captured by reading the market immediately before calling the service function. The service layer is not modified — response normalization is done entirely in the route layer.

**Errors:** Non-success cases return HTTP 400 (validation), 404 (not found), 422 (precondition failed), or 500 (unexpected). The body is `{ message: string }`.

---

## availableActions Map

The `availableActions` field in `AdminMarketSummary` is derived from a pure status-to-actions mapping:

| Current Status | Available Actions |
|---|---|
| `draft` | `["open", "cancel"]` |
| `open` | `["lock", "cancel"]` |
| `locked` | `["resolve", "cancel"]` |
| `resolved` | `[]` — transient; auto-proceeds to settled |
| `settled` | `[]` — terminal; funds already distributed |
| `cancelled` | `[]` — terminal; funds already refunded |

Implemented in `service.ts` as `availableActions(status: string): string[]`. The mapping is a plain record object — no DB access, zero cost.

---

## Admin Summary Endpoint

### `GET /api/predictions/markets/:id/admin-summary`

Returns a compact operational snapshot. Cost: two indexed DB queries (`findMarketWithOutcomes` for market + outcomes + event + stats; `countPositionsByStatus` GROUP BY for position counts).

**Response shape:**

```typescript
{
  // Identity
  marketId:          number;
  uid:               string;
  slug:              string | null;
  question:          string;
  description:       string | null;

  // Status
  status:            string;
  resolvedOutcomeId: number | null;

  // Market config
  marketType:        string;
  currency:          string;
  openAt:            Date | null;
  closeAt:           Date | null;
  resolveAt:         Date | null;
  settledAt:         Date | null;
  createdAt:         Date;

  // Event context
  event: {
    id, uid, title, game, region, eventType,
    tournamentName, eventName, teamAName, teamBName, startsAt, ...
  } | null;

  // Outcomes
  outcomes: Array<{
    id, marketId, code, label, isWinner, poolShare,
    impliedProbability, payoutValue, sortOrder
  }>;

  // Stats snapshot (from prediction_market_stats)
  stats: {
    id, marketId, volume24h, traders24h,
    lastPriceYes, lastPriceNo, updatedAt
  } | null;

  // Position counts (single GROUP BY)
  positionCounts: {
    active:    number;
    settled:   number;
    cancelled: number;
    total:     number;
  };

  // Admin UI helpers
  availableActions: string[];        // derived from current status
  recentEventsUrl:  string;          // pointer: GET /api/predictions/markets/:id/events
}
```

---

## Lifecycle Transition Guards

The underlying service functions enforce these pre-conditions:

| Action | Allowed From Status |
|---|---|
| `open` | `draft` only |
| `lock` | `open` only |
| `resolve` | `locked` (or `resolved` for idempotent retry) |
| `cancel` | `draft`, `open`, `locked` |

Attempts to perform an illegal transition return HTTP 422 with a descriptive message.

---

## Auth Assumptions

- All admin endpoints use `isAuthenticated` + `isAdminOnly`.
- `isAdminOnly` checks `req.session?.isAdmin` or `req.session?.userRole === "admin"`.
- Admin login is at `POST /api/admin/login` with `{ username, password }` (NOT `email`).
- The `actorUserId` stored in lifecycle events and audit rows is extracted from `req.session?.userId ?? req.session?.adminUsername ?? "admin"`.
- No JWT or API-key auth — session-based only.

---

## Example Payloads

### Create market
```json
POST /api/predictions/markets
{
  "question": "Will T1 win MSI 2026?",
  "marketType": "binary",
  "currency": "GS",
  "minStake": "1",
  "outcomes": [
    { "label": "YES", "code": "YES" },
    { "label": "NO",  "code": "NO"  }
  ]
}
→ 201 { "marketId": 9, "uid": "mkt_...", "slug": "will-t1-win-msi-2026-xxxx" }
```

### Open market
```json
POST /api/predictions/markets/9/open
(no body required)

→ 200 {
  "ok": true, "action": "open",
  "marketId": 9, "previousStatus": "draft", "newStatus": "open"
}
```

### Lock market
```json
POST /api/predictions/markets/9/lock
(no body required)

→ 200 {
  "ok": true, "action": "lock",
  "marketId": 9, "previousStatus": "open", "newStatus": "locked"
}
```

### Resolve market
```json
POST /api/predictions/markets/9/resolve
{ "winningOutcomeId": 17, "resolutionSource": "manual", "note": "Match result confirmed" }

→ 200 {
  "ok": true, "action": "resolve",
  "marketId": 9, "previousStatus": "locked", "newStatus": "settled",
  "duplicate": false,
  "winningOutcomeId": 17,
  "positionsSettled": 4, "positionsSkipped": 0,
  "totalWinnerPayout": "52.300000"
}
```

### Cancel market
```json
POST /api/predictions/markets/9/cancel
{ "reason": "data_issue", "note": "Match was forfeited before betting closed" }

→ 200 {
  "ok": true, "action": "cancel",
  "marketId": 9, "previousStatus": "open", "newStatus": "cancelled",
  "duplicate": false,
  "positionsCancelled": 3, "totalRefunded": "18.750000", "currency": "GS"
}
```

### Admin summary (settled market with positions)
```json
GET /api/predictions/markets/1/admin-summary
→ 200 {
  "marketId": 1, "status": "settled",
  "question": "Will FURIA win this match against NAVI?",
  "resolvedOutcomeId": 1,
  "event": { "game": "lol", "teamAName": "FURIA", "teamBName": "NAVI", ... },
  "outcomes": [
    { "id": 1, "code": "YES", "label": "Yes — FURIA wins", "isWinner": true },
    { "id": 2, "code": "NO",  "label": "No — NAVI wins",   "isWinner": false }
  ],
  "stats": { "volume24h": "7.000000", "traders24h": 0, "lastPriceYes": "0.500000" },
  "positionCounts": { "active": 0, "settled": 1, "cancelled": 0, "total": 1 },
  "availableActions": [],
  "recentEventsUrl": "/api/predictions/markets/1/events"
}
```

---

## Files Changed

| File | Change |
|---|---|
| `server/domains/prediction/types.ts` | Added `AdminMutationResponse`, `AdminMarketSummary` interfaces |
| `server/domains/prediction/repository.ts` | Added `countPositionsByStatus(marketId)` — GROUP BY query; exported it |
| `server/domains/prediction/service.ts` | Added `LIFECYCLE_ACTIONS` map, `availableActions()`, `getAdminSummary()`; imported `AdminMarketSummary`; exported both via `predictionService` |
| `server/domains/prediction/routes.ts` | Added `fetchPreviousStatus()` helper; added `/open`, `/lock`, `/admin-summary` routes; normalized `/transition`, `/resolve`, `/cancel` response envelopes; updated header comment |

---

## What a Future Admin UI Can Rely On

1. **All lifecycle mutations return the same `AdminMutationResponse` shape** — no parsing variance.
2. **`previousStatus` and `newStatus` are always present** — admin UI can show "draft → open" diffs without a separate read.
3. **`duplicate: true`** signals a safe idempotent retry — UI can show "already in this state" without error.
4. **`availableActions`** in admin-summary drives the button state of the admin UI directly.
5. **`recentEventsUrl`** in admin-summary gives a stable pointer to the full audit trail.
6. **Error format is always `{ message: string }`** — consistent across all admin routes.

---

## Approximations

- `countPositionsByStatus` only counts `active`, `settled`, `cancelled`. Positions in any other status (e.g., legacy `won`, `lost`, `refunded` from early Sprint 1 testing) accumulate in `total` but not in the named buckets.
- `traders24h` in stats is always 0 (deferred telemetry field — see Sprint 2 notes).
- `volume24h` is cumulative, not a true 24h rolling window.

---

## Remaining TODOs Before Sprint 3 Fully Complete

1. **`POST /api/predictions/events/:id` (update event)** — currently no way to edit event details after creation.
2. **`GET /api/predictions/markets/:id/positions` (admin position list)** — for admin inspection of who holds positions in a market (uses existing `findPositionsByMarket`).
3. **Rate limiting on admin mutation routes** — protect resolve/cancel from accidental double-click.
4. **Scheduled open** — an `openAt` field exists on the market but no scheduler drives the `draft → open` transition. The auto-lock scheduler pattern can be extended.
5. **Admin event detail endpoint** — `GET /api/predictions/events/:id` for individual event inspection.
6. **Market Lab UX** — the admin surface is complete; the frontend Market Lab UI can now be built against stable endpoints.

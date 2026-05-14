# Phase 3C Migration Report

**Date:** 2026-03-09
**Scope:** Identity, Portfolio, News, System, Draft API

---

## Summary

| Domain | Routes Migrated | Destination |
|--------|----------------|-------------|
| Identity | 10 | `server/domains/identity/routes.ts` |
| Portfolio | 2 | `server/domains/portfolio/routes.ts` |
| News | 2 | `server/domains/news/routes.ts` |
| System | 2 | `server/domains/system/routes.ts` |
| Draft API | 1 (`app.use`) | `server/domains/arena/routes.ts` |
| **Total** | **17** | — |

**Lines removed from `server/routes.ts`:** −608 (1,964 → 1,356)

---

## Routes Migrated by Domain

### Identity (`server/domains/identity/routes.ts`)
| Method | Path |
|--------|------|
| POST | `/api/auth/signup` |
| POST | `/api/auth/login` |
| POST | `/api/auth/logout` |
| GET  | `/api/auth/me` |
| POST | `/api/access-requests` |
| POST | `/api/auth/forgot-password` |
| POST | `/api/auth/reset-password` |
| GET  | `/api/auth/reset-password/validate` |
| POST | `/api/auth/change-password` |
| POST | `/api/auth/force-change-password` |

**Imports used:** `db`, `storage`, `bcrypt`, `crypto`, `users`, `accessRequests`, `passwordResetTokens`, `eq`, `and`, `or`, `sqlExpr`

### Portfolio (`server/domains/portfolio/routes.ts`)
| Method | Path |
|--------|------|
| GET  | `api.portfolio.get.path` (`/api/portfolio`) |
| GET  | `/api/terminal/activity/me` |

**Imports used:** `db`, `storage`, `api`, `riotPositions`, `riotAssets`, `riotTrades`, `eq`, `and`, `desc`, `sqlExpr`

### News (`server/domains/news/routes.ts`) — **new file**
| Method | Path |
|--------|------|
| GET  | `/api/news/latest` |
| GET  | `/api/news/pulse` |

**Imports:** Dynamic imports of `newsService` (preserved as-is)

### System (`server/domains/system/routes.ts`) — **new file**
| Method | Path |
|--------|------|
| GET  | `/api/version` |
| GET  | `/api/market/health` |

**Imports:** None (uses `process.env` only)

### Draft API → Arena (`server/domains/arena/routes.ts`)
- Moved `app.use("/api/draft", isAuthenticated, draftRouter)` to end of arena domain
- Added `import draftRouter from "../../modules/draft/draft.routes"` to arena domain
- Draft module itself (`server/modules/draft/`) was not modified

---

## Routes Remaining in `server/routes.ts`

All remaining routes are market/trading/transactional and were intentionally NOT migrated per Phase 3C constraints:

| Method | Path | Reason Kept |
|--------|------|-------------|
| POST | `api.seed.execute.path` | Legacy sandbox seed |
| POST | `api.trade.execute.path` | Trade execution (transactional core) |
| GET  | `api.trade.recent.path` | Recent trades feed |
| GET  | `/api/market/stats` | Market stats |
| GET  | `/api/riot/asset/:puuid` | Riot asset detail |
| GET  | `/api/riot/trades/recent` | Riot trades feed |
| GET  | `/api/riot/asset/:puuid/trades` | Asset trade history |
| POST | `/api/riot/trade` | Riot trade execution (transactional) |
| GET  | `/api/terminal/market` | Terminal market state |
| GET  | `/api/market/heatmap` | Market heatmap |
| GET  | `/api/market/index` | Market index |
| GET  | `/api/market/assets` | Canonical asset registry |
| GET  | `/api/market/assets/:id` | Canonical asset detail |
| GET  | `/api/market/assets/:id/snapshots` | Price snapshots |
| GET  | `/api/riot/quote` | AMM quote |
| GET  | `/api/terminal/stream` | SSE stream |
| POST | `/api/orders` | Order placement (transactional) |
| GET  | `/api/orders/me` | User order list |
| GET  | `/api/orders/:id` | Order detail |
| POST | `/api/orders/:id/cancel` | Order cancel (transactional) |

Total remaining: **20 routes**

---

## Cleanup Done

- Removed `handleArenaError` dead code (was already unused after Phase 3B)
- Removed `import bcrypt from "bcryptjs"` from `routes.ts` (only needed in identity domain now)
- Removed `accessRequests` and `passwordResetTokens` from schema imports in `routes.ts`
- Removed `import draftRouter` from `routes.ts` (moved to arena domain)

---

## Dependencies / Imports Added to `routes.ts`

```ts
import { registerNewsRoutes } from "./domains/news/routes";
import { registerSystemRoutes } from "./domains/system/routes";
```

Both registered in `registerRoutes()` alongside the other domain registrations.

---

## Ambiguities Found

### `/api/terminal/market` (kept)
Large endpoint (~130 lines) that reads AMM state, open orders, and riot asset positions in one query. Semantically a portfolio/trading read, but deeply coupled to the sandbox market state and AMM pricing engine. Left in routes.ts for Phase 3D.

### `/api/market/heatmap` and `/api/market/index` (kept)
Read-only endpoints, but they live in the "Canonical Market API" section together with write-adjacent market routes. Deferring to Phase 3D to keep the market domain migration atomic.

### `/api/riot/trades/recent` and `/api/riot/asset/:puuid/trades` (kept)
Trade feed reads. Could belong to a future `market/routes.ts` or `trading/routes.ts` domain. Deferred for Phase 3D.

### Orders routes (kept)
`POST /api/orders` (placement) and `POST /api/orders/:id/cancel` are transactional and explicitly excluded from Phase 3C. `GET` order endpoints could migrate in Phase 3D.

---

## Criteria of Success — Verification

- [x] Application compiles without errors (tsx/ts)
- [x] Server starts on port 5000 with no boot errors
- [x] `GET /api/version` → `{"buildId":"dev",...}` (system domain)
- [x] `GET /api/market/health` → `{"ok":true,...}` (system domain)
- [x] `POST /api/auth/login` → correct 401 for invalid credentials (identity domain)
- [x] `GET /api/news/latest` → correct behavior (news domain, gated by adminAuth same as before)
- [x] `GET /api/portfolio` and `/api/terminal/activity/me` → correct 401 without session (portfolio domain, auth-gated)
- [x] No behavior changes — all payloads, paths, and auth middleware preserved verbatim

---

## Cumulative Phase 3 Summary

| Phase | Routes Migrated | Lines Removed |
|-------|----------------|---------------|
| 3A    | 8              | ~950          |
| 3B    | 98             | ~3,719        |
| 3C    | 17             | ~608          |
| **Total** | **123**    | **~5,277**    |

`server/routes.ts`: **5,947 → 1,356 lines** (−77.2% reduction)

# Phase 3B Migration Report

**Date:** 2026-03-09
**Scope:** Discovery, Arena, and Admin domain routes migrated from `server/routes.ts`

---

## Summary

Phase 3B completed the bulk of the routes migration. Three domain modules were populated in parallel by subagents, then `routes.ts` was cleaned atomically in a single-pass script.

| Domain | Routes migrated | Domain file lines |
|--------|----------------|------------------|
| Discovery | 13 | `server/domains/discovery/routes.ts` |
| Arena | 21 | `server/domains/arena/routes.ts` |
| Admin | 64 | `server/domains/admin/routes.ts` |
| **Total** | **98** | — |

---

## File Size Changes

| File | Before | After | Delta |
|------|--------|-------|-------|
| `server/routes.ts` | 5,683 lines | 1,964 lines | **−3,719 lines** |

---

## Routes Migrated

### Discovery Domain (`server/domains/discovery/routes.ts`)
Includes the `mapToUnifiedAsset` helper function (moved from inside `registerRoutes()` to module-level):
- `GET  api.vaults.list.path` — legacy vault list
- `GET  api.vaults.get.path` — legacy vault detail
- `GET  api.watchlist.list.path` — legacy watchlist
- `POST api.watchlist.add.path` — legacy watchlist add
- `DELETE api.watchlist.remove.path` — legacy watchlist remove
- `GET  /api/assets` — unified asset listing with filters/sorting
- `GET  /api/assets/search` — asset search
- `GET  /api/assets/watchlist` — riot-based watchlist read
- `POST /api/assets/watchlist` — riot-based watchlist add
- `DELETE /api/assets/watchlist/:assetId` — riot-based watchlist remove
- `GET  /api/assets/:assetUid` — asset detail
- `GET  /api/assets/:assetUid/snapshots` — asset price snapshots
- `POST /api/waitlist` — email waitlist signup

### Arena Domain (`server/domains/arena/routes.ts`)
Includes the `handleArenaError` helper (copied from `routes.ts` lines 86-94):
- `GET  /api/arena/me`
- `PATCH /api/arena/me`
- `GET  /api/arena/user-badges`
- `GET  /api/arena/profile`
- `GET  /api/arena/achievements/me`
- `GET  /api/arena/leaderboards`
- `GET  /api/arena/user-rank`
- `GET  /api/arena/rival`
- `GET  /api/arena/activity`
- `GET  /api/arena/seasons`
- `GET  /api/arena/seasons/me`
- `GET  /api/arena/seasons/:seasonId/rewards`
- `GET  /api/arena/challenges`
- `POST /api/arena/follow`
- `DELETE /api/arena/follow`
- `GET  /api/arena/following`
- `GET  /api/arena/trader/:username`
- `POST /api/arena/duel/challenge`
- `POST /api/arena/duel/accept`
- `POST /api/arena/duel/reject`
- `GET  /api/arena/duels`

### Admin Domain (`server/domains/admin/routes.ts`)
Covers all `/api/admin/*` routes including admin/arena, AMM calibration, bots, and market-lab:
- User creation, password reset, block/unblock (legacy v1 + v2)
- Access request approve/reject/create-user
- Admin login/logout/me, password reset
- Simulator pause/resume
- Riot API key management, Riot sync, diagnostics
- Performance pricing job, valuation run/seed
- Canonical sync, backfill trading asset links
- Ops markets, run-sync, sync-status, pricing selftest
- Admin system info, market mode, market audit
- Arena admin: seasons CRUD, activate/close, rewards, challenges, bootstrap, diagnostics
- AMM market calibration (list, seed, patch)
- Bot controls (status, start, stop, seed, config)
- Market-lab simulate (617 lines incl. `seededRand`, `computeSimAnchorEffect`, `applyDivergenceBraking`, `runReworkedBots` helpers)
- Market-lab stress-test

---

## Helpers Moved

| Helper | From | To |
|--------|------|----|
| `mapToUnifiedAsset()` | inline inside `registerRoutes()` | module-level in `discovery/routes.ts` |
| `handleArenaError()` | `routes.ts` lines 86-94 | copied to `arena/routes.ts` |
| `adminAuth` middleware | `routes.ts` lines 163-192 | copied to `admin/routes.ts` (routes.ts retains its copy for `app.use(adminAuth)` global middleware) |

---

## TypeScript Error Status

All new errors introduced by subagent divergences were fixed:
- `TS2353`: `updatedAt` on `accessRequests` → replaced with `reviewedAt`
- `TS2304`: `markets` not imported in admin/routes → added to schema import
- `TS2769`: `parseInt()` on varchar `accessRequests.id` → removed parseInt cast

Remaining errors in domain files are the **same pre-existing TS2769/TS2345 patterns** that exist in `routes.ts` (Drizzle ORM overload ambiguity, req.params string | string[] patterns).

---

## What Remains in `server/routes.ts` (36 routes)

These routes have NOT been migrated yet:
- Identity/Auth routes (`/api/auth/*`, `/api/access-requests`)
- Portfolio routes (`/api/portfolio/*`)
- Legacy Market Sandbox routes (`/api/sandbox/*`, trades)
- Real/Riot Asset Market routes (`/api/riot/asset/*`, `/api/riot/trades/*`, `/api/terminal/*`)
- News routes (`/api/news/*`)
- System routes (`/api/version`, `/api/market/health`, `/api/market/heatmap`, `/api/market/index`)
- Canonical Market routes (`/api/market/assets`, `/api/market/assets/:id`, `/api/market/assets/:id/snapshots`)
- Orders/Trigger routes (`/api/orders/*`)
- Draft API (`/api/draft`)

---

## Cumulative Progress (Phase 3A + 3B)

| Phase | Routes migrated | routes.ts lines removed |
|-------|---------------|------------------------|
| Phase 3A | 8 | 264 |
| Phase 3B | 98 | 3,719 |
| **Total** | **106** | **3,983** |

routes.ts: 5,947 lines → 1,964 lines (**−66.9%**)

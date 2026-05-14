# Phase 3A Migration Report

**Date:** 2026-03-09  
**Branch:** main  
**Objective:** Extract `player`, `performance`, and `valuation` domain routes from `server/routes.ts` into `server/domains/*/routes.ts`.

---

## Summary

| Metric | Value |
|---|---|
| Domains migrated | 3 (player, performance, valuation) |
| Routes migrated | 8 |
| Lines removed from `server/routes.ts` | 264 (5,947 → 5,683) |
| New TypeScript errors introduced | 0 |
| Server boot errors | 0 |
| Behavioral changes | None |

---

## Routes Migrated by Domain

### `server/domains/player/routes.ts`

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/riot/leaderboard` | `isAuthenticated` | Top 300 players by league points |
| GET | `/api/riot/players` | `isAuthenticated` | Paginated + optional search |

**Imports needed:**
- `db` from `../../db`
- `riotAssets` from `@shared/schema`
- `desc` from `drizzle-orm`
- `getRiotPlayers`, `getRiotPlayerCount` from `../../riot-sync`

---

### `server/domains/performance/routes.ts`

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/player/fundamentals/:puuid` | `isAuthenticated` | Win/loss stats + PVI signals |
| GET | `/api/performance/asset/:assetId/latest` | None (public) | Latest EMA match score |
| GET | `/api/admin/performance/baselines` | admin inline check | Role baselines + metric weights |
| GET | `/api/admin/performance/player/:assetId` | admin inline check | Last 20 scores + 10 match metrics |
| GET | `/api/admin/performance/match/:matchId` | admin inline check | Full match metrics + scores |

**Imports needed:**
- `db` from `../../db`
- `riotAssets`, `assetValuationState`, `performanceScores`, `playerMatchMetrics`, `roleBaselines`, `roleMetricWeights` from `@shared/schema`
- `eq`, `desc`, `and` from `drizzle-orm`

**Auth pattern note:** The 3 admin performance routes use inline checks (`req.user?.role !== "admin" && req.session?.userRole !== "admin"`) rather than the `isAdminOnly` middleware from `routes.ts`. This pattern was preserved exactly as-is — no normalization.

---

### `server/domains/valuation/routes.ts`

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/assets/:assetUid/valuation` | None (public) | Full PVI breakdown; null-safe when not computed |

**Imports needed:**
- `db` from `../../db`
- `assets`, `assetValuationState` from `@shared/schema`
- `eq` from `drizzle-orm`

---

## Lines Removed from `server/routes.ts`

| Block | Lines removed |
|---|---|
| `// PLAYER ROUTES` section header + 2 routes | ~31 lines |
| `// PERFORMANCE ROUTES` section header + `/api/player/fundamentals` | ~72 lines |
| `/api/assets/:assetUid/valuation` route + comment | ~49 lines |
| 4 performance routes at bottom (latest, baselines, player, match) | ~112 lines |
| **Total** | **264 lines** |

---

## Dependencies / Shared Code

### `isAuthenticated` middleware

`isAuthenticated` is defined as a private `const` in `routes.ts` (not exported). Rather than creating a new shared middleware file (deferred to Phase 4), both `player/routes.ts` and `performance/routes.ts` define an identical local copy:

```typescript
const isAuthenticated: RequestHandler = (req: any, res, next) => {
  if (req.session?.isAdmin || req.session?.userId) return next();
  if (typeof req.isAuthenticated === "function" && req.isAuthenticated()) return next();
  return res.status(401).json({ message: "Unauthorized" });
};
```

**Phase 4 action:** Extract to `server/middleware/auth.ts` and import everywhere.

---

## Ambiguities Found

### 1. `GET /api/admin/valuation/run` and `GET /api/admin/valuation/seed` (lines 1985, 1994)

These are **mutation endpoints** that trigger background valuation jobs (`runValuationBatch`, `seedInitialValuations`). They live in the admin Integrations section. Although the path contains `/valuation`, they belong to the **admin** domain (they control the valuation job scheduler, not read valuation state). **Kept in `routes.ts` for Phase 3B when admin is migrated.**

### 2. `GET /api/assets/:assetUid/snapshots` (line 3353)

This route sits immediately after the valuation route in the DISCOVERY section. It returns asset price snapshots, not valuation data. It belongs to **discovery** (or possibly **market**) — not valuation. **Kept in `routes.ts`; will be reviewed in Phase 3B.**

### 3. `GET /api/market/assets/:id/snapshots` (line ~3104)

Similarly, price history snapshots at a canonical asset level. Belongs to **market** domain. **Kept in `routes.ts`.**

### 4. `GET /api/player/fundamentals/:puuid`

This route blends **performance** data (PVI signals, match scores, recentPerformance) with **player** registry data (wins/losses, leaguePoints). It was placed in the **performance** domain because the primary consumer is the Player Fundamentals Panel (trading terminal), which uses performance metrics. The player-registry data (`wins`, `losses`, `leaguePoints`) is incidental context fetched alongside. **If player and performance domains are later merged or a cross-domain call pattern is established, this route may move.**

---

## Routes That Appeared Relevant But Were NOT Migrated

| Route | Domain | Reason kept |
|---|---|---|
| `POST /api/admin/valuation/run` | admin | Mutation (triggers valuation job); admin domain |
| `POST /api/admin/valuation/seed` | admin | Mutation (seeds initial valuations); admin domain |
| `GET /api/assets/:assetUid/snapshots` | discovery | Price snapshots, not PVI state; belongs with discovery |
| `GET /api/market/assets/:id/snapshots` | market | Canonical asset price history; belongs with market |
| `GET /api/riot/asset/:puuid` | market | Returns asset detail + trade execution context; belongs with market |

---

## Confirmation: No Behavioral Changes

- All route paths, HTTP methods, and auth middleware are identical to the originals.
- All response payloads are byte-for-byte equivalent.
- No new abstractions, helpers, or middleware were created (only local copies of `isAuthenticated`).
- Server boots cleanly with all schedulers running (verified post-migration).
- TypeScript errors: 0 new errors introduced (2 pre-existing `TS2769` errors in `performance/routes.ts` are exact copies of the same pre-existing errors in `routes.ts` at the corresponding lines).

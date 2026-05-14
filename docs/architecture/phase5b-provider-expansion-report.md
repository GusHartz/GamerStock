# Phase 5B — PerformanceProvider Expansion Report

**Date:** 2026-03-09  
**Status:** ✅ Complete — server boots clean, no breaking changes

---

## Objective

Expand `PerformanceProvider` usage to the remaining read endpoints that still coupled directly to `riotAssets` / `assetValuationState`, and clarify the conceptual boundary between performance data and player registry data.

---

## Interface Changes

One method added to `PerformanceProvider`:

```ts
getLeaderboard(limit?: number): Promise<LeaderboardEntry[]>
```

New type added:

```ts
interface LeaderboardEntry {
  puuid: string;
  gameName: string;
  tagLine: string;
  leaguePoints: number;
  wins: number;
  losses: number;
  winrate: string;          // string — matches Postgres numeric type, preserves payload shape
  lastTradePrice: string;
  price24hAgo: string;
  volume24h: string;
  momentum: string;
  lastSyncedAt: Date;
  updatedAt: Date;
}
```

Numeric fields kept as `string` intentionally — the existing leaderboard endpoint returned raw Postgres `numeric` values (strings), and any conversion would silently change the payload consumed by the frontend.

---

## Endpoints Migrated

### 1. `GET /api/riot/leaderboard`

**File:** `server/domains/player/routes.ts`

**Before:** Queried `riotAssets` directly via Drizzle, ordered by `leaguePoints DESC`.

**After:** Calls `provider.getLeaderboard(300)`. Riot adapter replicates the identical DB query. Synthetic adapter returns vault-based leaderboard entries for sandbox mode.

**Payload:** Identical — `{ data: LeaderboardEntry[], total: number }`.

---

### 2. `GET /api/player/fundamentals/:puuid`

**File:** `server/domains/performance/routes.ts`

**Before:** Two direct DB queries — `riotAssets` (wins/losses/LP/momentum) + `assetValuationState` (PVI + valuation fields).

**After:** Calls `provider.getPlayerFundamentals(puuid)`. Provider returns a `PlayerFundamentals` object; the handler maps it to the existing response shape.

**Payload:** Identical — all fields preserved, including `games` derived field computed from `wins + losses`.

**Null handling:** `null` return from provider maps to `404 { error: "Player not found" }` — same as before.

---

### 3. `GET /api/performance/asset/:assetId/latest`

**File:** `server/domains/performance/routes.ts`

**Before:** Direct DB query on `performanceScores` table.

**After:** Calls `provider.getLatestPerformanceScore(puuid)`. The `assetId` prefix-stripping logic (`assetId.includes(":")`) stays in the handler — this is routing/path concern, not provider concern.

**Payload mapping:** Provider field `puuid` → response field `assetId`; provider field `recordedAt` → response field `createdAt`. Shape is identical to the original.

---

## Endpoints NOT Migrated (Intentionally)

| Endpoint | Reason |
|---|---|
| `GET /api/admin/performance/baselines` | Returns `roleBaselines` + `roleMetricWeights` rows — internal scoring pipeline configuration. Adding these to the provider interface would import engine-private types into the provider contract. |
| `GET /api/admin/performance/player/:assetId` | Returns raw `performanceScores` + `playerMatchMetrics` rows for admin inspection. Same reasoning — this is engine-internal state, not player-facing data. |
| `GET /api/admin/performance/match/:matchId` | Raw match-level debug data. Admin tooling, not player data. |

These three routes continue to query the DB directly via Drizzle. This is the correct boundary — the provider contract covers **player-facing reads**; raw engine state belongs to the engine.

---

## Conceptual Boundary: Performance vs Player Registry

Phase 5B surfaced a real tension: `getLeaderboard()` and `getPlayers()` are **player registry** operations (listing, pagination, search), while `getPlayerFundamentals()` and `getLatestPerformanceScore()` are **performance data** operations.

### Why they stay in one interface for now

Both originate from the same source (Riot API or synthetic vault system). Splitting into two interfaces would require two factory calls per request with no practical benefit at this stage.

### When to split (Phase 5C trigger)

Split into `PlayerRegistryReader` + `PerformanceDataReader` if **any** of these conditions appear:
- A new game integration needs to source its leaderboard from a different system than its performance pipeline
- A caching strategy needs to differ between listing operations and performance queries
- The interface exceeds ~8 methods and becomes hard to implement for new adapters

Until then, one interface per provider is the right tradeoff.

---

## Adapter Coverage After Phase 5B

### Riot Adapter

| Method | Coverage |
|---|---|
| `getPlayers` | ✅ Full — delegates to `getRiotPlayers()` |
| `getPlayerCount` | ✅ Full — delegates to `getRiotPlayerCount()` |
| `getLeaderboard` | ✅ Full — reads `riotAssets` ordered by LP |
| `getPlayerFundamentals` | ✅ Full — reads `riotAssets` + `assetValuationState` |
| `getLatestPerformanceScore` | ✅ Full — reads `performanceScores` |
| `getRecentMatchSummaries` | ✅ Full — reads `riotMatchCache` |
| `syncPlayers` | ✅ Full — delegates to `syncChallengerNA1()` |
| `runPerformanceBatch` | ✅ Full — delegates to `runPerfPricingJob()` |

### Synthetic Adapter

| Method | Coverage | Notes |
|---|---|---|
| `getPlayers` | ✅ Functional | Backed by `vaults` table |
| `getPlayerCount` | ✅ Functional | Counts `vaults` rows |
| `getLeaderboard` | ✅ Functional | Vaults ordered by `performanceIndex` |
| `getPlayerFundamentals` | ⚠️ Partial | `performanceIndex`, `momentum`, `lastTradePrice` mapped; LP/wins/losses absent |
| `getLatestPerformanceScore` | ❌ Not available | Returns `null` — no match pipeline for sandbox |
| `getRecentMatchSummaries` | ❌ Not available | Returns `[]` — same reason |
| `syncPlayers` | ⚠️ No-op | Vault data seeded separately |
| `runPerformanceBatch` | ⚠️ No-op | No synthetic match generation yet |

---

## Points Still Calling Riot Directly

| File | What | Notes |
|---|---|---|
| `server/domains/admin/routes.ts` | `syncChallengerNA1()`, `runPerfPricingJob()` trigger endpoints | Admin-only ops. Phase 5C candidate. |
| `server/domains/performance/routes.ts` | Admin baselines / player history / match detail | Engine-internal state — intentionally direct. |
| `server/riot-perf.ts` | Internal `processPlayer`, `throttledFetch` | Core scoring pipeline — untouched by design. |
| `server/riot-sync.ts` | Internal `fetchWithRetry`, `syncChallengerNA1` | Core sync pipeline — untouched by design. |

---

## No Breaking Changes — Confirmation

- ✅ All API paths unchanged
- ✅ All response payloads identical
- ✅ All auth middleware preserved
- ✅ `riot-sync.ts` and `riot-perf.ts` untouched
- ✅ `performanceEngine.ts` untouched
- ✅ No schema / DB changes
- ✅ No market or trading flow changes
- ✅ Server boots clean, zero startup errors

---

## Recommended Next Steps for Phase 5C

1. **Admin trigger endpoints** — migrate `/api/admin/riot/sync` and `/api/admin/perf/run` to use `provider.syncPlayers()` / `provider.runPerformanceBatch()`. This completes the admin-facing provider integration.

2. **Synthetic match generation** — implement `getRecentMatchSummaries()` in `SyntheticPerformanceProvider` using bot profiles or seeded match data. This allows SANDBOX mode to surface performance history to the frontend.

3. **Evaluate `PlayerRegistryReader` split** — if a second game integration appears, extract `getPlayers` / `getPlayerCount` / `getLeaderboard` into a `PlayerRegistryReader` interface, keeping `getPlayerFundamentals` / `getLatestPerformanceScore` / `getRecentMatchSummaries` in `PerformanceDataReader`.

4. **Provider health endpoint** — add `GET /api/admin/provider/status` returning `{ providerName, game, marketMode }` for admin observability.

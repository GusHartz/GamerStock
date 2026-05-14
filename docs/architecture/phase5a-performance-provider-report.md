# Phase 5A — PerformanceProvider Abstraction Report

**Date:** 2026-03-09  
**Status:** ✅ Complete — server boots clean, no breaking changes

---

## Objective

Introduce a `PerformanceProvider` interface to decouple the GamerStock core from direct Riot API module dependencies. Enables multi-game readiness, synthetic/offline operation, and a clear migration path toward Web3-ready data sourcing — without altering any existing behaviour.

---

## Files Created

```
server/integrations/
  interfaces/
    performance-provider.ts       ← canonical interface + auxiliary types
  riot/
    performance-provider.ts       ← adapter: delegates to riot-sync.ts + riot-perf.ts
  synthetic/
    performance-provider.ts       ← adapter: reads from sandbox vault system
  performance-provider-factory.ts ← factory: selects active provider by config
```

---

## Interface Definition

**File:** `server/integrations/interfaces/performance-provider.ts`

### Auxiliary Types

| Type | Purpose |
|---|---|
| `PlayerRecord` | Minimal player identity + stats for listings |
| `PlayerFundamentals` | Wins/losses/LP/winrate/momentum + full valuation state |
| `PerformanceScore` | Single match performance score with EMA |
| `MatchSummary` | Processed match cache entry |
| `SyncResult` | Outcome of a player roster sync |
| `PerfBatchResult` | Outcome of a performance scoring batch |

### Interface Methods

| Method | Signature | Purpose |
|---|---|---|
| `getPlayers` | `(opts?) → PlayerRecord[]` | Player roster, with optional search + limit |
| `getPlayerCount` | `() → number` | Total player count |
| `getPlayerFundamentals` | `(puuid) → PlayerFundamentals \| null` | Win/loss/LP/valuation data for one player |
| `getLatestPerformanceScore` | `(puuid) → PerformanceScore \| null` | Most recent EMA score for a player |
| `getRecentMatchSummaries` | `(puuid, limit?) → MatchSummary[]` | Recent processed matches |
| `syncPlayers` | `() → SyncResult` | Trigger a player roster sync |
| `runPerformanceBatch` | `() → PerfBatchResult` | Trigger a performance scoring batch |

### Provider Identity Fields

| Field | Type | Purpose |
|---|---|---|
| `providerName` | `string` | Machine-readable identifier (`"riot-na1"`, `"synthetic"`) |
| `game` | `string` | Game scope (`"league-of-legends"`) |

---

## Adapters

### Riot Adapter (`server/integrations/riot/performance-provider.ts`)

- `providerName`: `"riot-na1"`
- `getPlayers` → delegates to `getRiotPlayers()` from `riot-sync.ts`, maps to `PlayerRecord[]`
- `getPlayerCount` → delegates to `getRiotPlayerCount()` from `riot-sync.ts`
- `getPlayerFundamentals` → reads from `riotAssets` + `assetValuationState` (same DB queries as the existing `/api/player/fundamentals/:puuid` handler)
- `getLatestPerformanceScore` → reads from `performanceScores` table
- `getRecentMatchSummaries` → reads from `riotMatchCache` table
- `syncPlayers` → delegates to `syncChallengerNA1()` from `riot-sync.ts`
- `runPerformanceBatch` → delegates to `runPerfPricingJob()` from `riot-perf.ts`

No new API calls. No behaviour changes. Pure delegation.

### Synthetic Adapter (`server/integrations/synthetic/performance-provider.ts`)

- `providerName`: `"synthetic"`
- `getPlayers` → reads from `vaults` table; maps `playerAlias` to `displayName`, generates `synthetic:vault:<id>` PUIDs
- `getPlayerCount` → counts `vaults` rows
- `getPlayerFundamentals` → maps `performanceIndex`, `momentum`, `lastTradePrice` from `vaults`
- `getLatestPerformanceScore` → returns `null` (no match data available in sandbox)
- `getRecentMatchSummaries` → returns `[]` (no match data available in sandbox)
- `syncPlayers` → no-op with log message
- `runPerformanceBatch` → no-op with log message

---

## Factory (`server/integrations/performance-provider-factory.ts`)

Selection priority:

1. **`PERFORMANCE_PROVIDER` env var** — `"riot"` or `"synthetic"` (hard override, useful for testing)
2. **Market mode** from `app_config` table — `REAL_RIOT_NA1` → Riot, `SANDBOX` → Synthetic
3. **Default** — Riot (preserves current production behaviour)

Instances are not cached. Each call to `getPerformanceProvider()` reads the current market mode so configuration changes take effect without server restart.

---

## Points Already Using PerformanceProvider

### `server/domains/player/routes.ts` — `GET /api/riot/players`

**Before:**
```ts
import { getRiotPlayers, getRiotPlayerCount } from "../../riot-sync";
const players = await getRiotPlayers(search);
const total = await getRiotPlayerCount();
```

**After:**
```ts
import { getPerformanceProvider } from "../../integrations/performance-provider-factory";
const provider = await getPerformanceProvider();
const players = await provider.getPlayers({ search });
const total = await provider.getPlayerCount();
```

Response shape is identical. An additional `provider` field is included in the JSON response for observability (value: `"riot-na1"` or `"synthetic"`).

---

## Points Still Calling Riot Directly

| File | Calls | Reason Not Migrated Yet |
|---|---|---|
| `server/domains/player/routes.ts` | `GET /api/riot/leaderboard` — reads `riotAssets` directly via Drizzle | Leaderboard has no sandbox equivalent; safe to leave direct for now |
| `server/domains/performance/routes.ts` | `/api/player/fundamentals/:puuid`, `/api/performance/asset/:assetId/latest`, admin perf routes | Read directly from DB (not from Riot API modules). Candidate for Phase 5B. |
| `server/domains/admin/routes.ts` | `syncChallengerNA1()`, `runPerfPricingJob()` | Admin-only trigger ops. Low priority. Phase 5B. |
| `server/riot-perf.ts` | Internal `throttledFetch`, `processPlayer` | Core pipeline — must not be touched until full provider migration is complete |
| `server/riot-sync.ts` | Internal `fetchWithRetry`, `syncChallengerNA1` | Core sync pipeline — same rule |

---

## Synthetic Provider — Current Limitations

| Capability | Status |
|---|---|
| Player roster (list/count) | ✅ Available — reads from `vaults` |
| Player fundamentals | ✅ Partial — `performanceIndex`, `momentum`, `lastTradePrice` mapped |
| LP / rank data | ⚠️ Not available — vaults have no league points |
| Wins / losses | ⚠️ Not available — vaults have no win/loss records |
| Performance scores | ❌ Not available — no match processing pipeline for sandbox |
| Match summaries | ❌ Not available — no `riotMatchCache` entries for sandbox players |
| syncPlayers | ⚠️ No-op — vault data seeded separately via seed endpoints |
| runPerformanceBatch | ⚠️ No-op — no synthetic match generation yet |

These are expected limitations at Phase 5A. Future phases can extend the synthetic adapter with generated match data.

---

## Factory Selection Behaviour

| Condition | Active Provider |
|---|---|
| `PERFORMANCE_PROVIDER=synthetic` env | Synthetic |
| `PERFORMANCE_PROVIDER=riot` env | Riot |
| Market mode = `SANDBOX` (DB config) | Synthetic |
| Market mode = `REAL_RIOT_NA1` (DB config) | Riot |
| Default (no override) | Riot |

---

## No Breaking Changes — Confirmation

- ✅ `server/riot-sync.ts` — untouched
- ✅ `server/riot-perf.ts` — untouched
- ✅ `server/services/performanceEngine.ts` — untouched
- ✅ All API payloads unchanged (`GET /api/riot/players` adds only a non-breaking `provider` field)
- ✅ No schema changes
- ✅ No database changes
- ✅ No market state mutations
- ✅ No trade flow changes
- ✅ Server boots clean

---

## Recommended Next Steps for Phase 5B

1. **Migrate `GET /api/player/fundamentals/:puuid`** in `performance/routes.ts` to call `provider.getPlayerFundamentals(puuid)` — the logic already exists in the Riot adapter.

2. **Migrate `GET /api/performance/asset/:assetId/latest`** to call `provider.getLatestPerformanceScore(puuid)`.

3. **Migrate admin trigger endpoints** (`/api/admin/riot/sync`, `/api/admin/perf/run`) to go through the provider's `syncPlayers()` / `runPerformanceBatch()`.

4. **Synthetic match generation** — extend `SyntheticPerformanceProvider.getRecentMatchSummaries()` with generated data from bot profiles for local development without any API dependency.

5. **Provider field on fundamentals response** — consider adding `provider: provider.providerName` to fundamentals responses for client-side observability.

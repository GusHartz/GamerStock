# Phase 5C — Job Service Layer Report

**Date:** 2026-03-09  
**Status:** ✅ Complete — server boots clean, no breaking changes

---

## Objective

Remove the last direct Riot module imports from admin HTTP handlers by introducing a formal job service layer. Admin endpoints now call integration services — not raw module functions — completing the separation between the HTTP transport layer and the operational orchestration layer.

---

## Conceptual Boundary (Established Across 5A–5C)

```
┌─────────────────────────────────────────────────────────┐
│  HTTP Handlers (server/domains/)                        │
│  — routes, auth, request/response shaping               │
└────────────────┬───────────────────┬────────────────────┘
                 │                   │
                 ▼                   ▼
┌───────────────────────┐  ┌──────────────────────────────┐
│  PerformanceProvider  │  │  Job Services                │
│  (integrations/)      │  │  (integrations/jobs/)        │
│                       │  │                              │
│  Read / data access:  │  │  Operational orchestration:  │
│  - getLeaderboard     │  │  - syncChallengerRoster      │
│  - getPlayerFundamentals  - runBatch                   │
│  - getLatestScore     │  │  - getStatus                 │
│  - getMatchSummaries  │  │                              │
│  - getPlayers         │  │  Reports outcomes, not data  │
└──────────┬────────────┘  └──────────────┬───────────────┘
           │                              │
           └──────────────┬───────────────┘
                          ▼
          ┌──────────────────────────────────┐
          │  Core Modules (server/)          │
          │  riot-sync.ts — player sync      │
          │  riot-perf.ts — perf scoring     │
          │  performanceEngine.ts — math     │
          │  valuationJob.ts — PVI/FV        │
          └──────────────────────────────────┘
```

**Provider** = read/adapt data for client consumption  
**Job Service** = operational orchestration for admin triggers and background jobs  
**Core Modules** = untouched business logic — sync, scoring, valuation

---

## Services Created

### `server/integrations/jobs/performance-sync-service.ts`

**Class:** `PerformanceSyncService`  
**Singleton export:** `performanceSyncService`

| Method | Signature | Delegates to |
|---|---|---|
| `syncChallengerRoster()` | `→ PlayerSyncResult` | `syncChallengerNA1()` in `riot-sync.ts` |
| `getStatus()` | `→ PerfJobStatus` | `getMatchCacheCount()` + `getPerfJobStatus()` in `riot-perf.ts` |

**Types defined:**

```ts
interface PlayerSyncResult { inserted: number; updated: number; total: number; }
interface PerfJobStatus    { running: boolean; lastRunAt: Date | null;
                             lastRunProcessed: number; lastRunErrors: number;
                             matchCacheCount: number; }
```

### `server/integrations/jobs/performance-batch-service.ts`

**Class:** `PerformanceBatchService`  
**Singleton export:** `performanceBatchService`

| Method | Signature | Delegates to |
|---|---|---|
| `runBatch()` | `→ PerfBatchResult` | `runPerfPricingJob()` in `riot-perf.ts` |

**Types defined:**

```ts
interface PerfBatchResult { processed: number; errors: number; }
```

---

## Admin Endpoints Migrated

### `POST /api/admin/riot/sync/challenger-na1`

**Before:** `const result = await syncChallengerNA1();`  
**After:** `const result = await performanceSyncService.syncChallengerRoster();`  
**Payload:** Identical — `{ inserted, updated, total }`

---

### `GET /api/admin/riot/status`

**Before:**
```ts
const matchCacheCount = await getMatchCacheCount();
res.json({ ..., matchCache: matchCacheCount, perfJob: getPerfJobStatus() });
```

**After:**
```ts
const status = await performanceSyncService.getStatus();
res.json({
  ...,
  matchCache: status.matchCacheCount,
  perfJob: {
    running: status.running,
    lastRunAt: status.lastRunAt,
    lastRunProcessed: status.lastRunProcessed,
    lastRunErrors: status.lastRunErrors,
  }
});
```

**Payload:** Identical shape — `perfJob` object fields are the same four keys.

---

### `POST /api/admin/riot/perf/run`

**Before:** `const result = await runPerfPricingJob();`  
**After:** `const result = await performanceBatchService.runBatch();`  
**Payload:** Identical — `{ processed, errors }`

---

## Direct Calls Removed from Admin Handlers

| Import removed | From |
|---|---|
| `syncChallengerNA1` | `../../riot-sync` |
| `getRiotPlayers` | `../../riot-sync` (was imported but never called) |
| `runPerfPricingJob` | `../../riot-perf` |
| `getPerfJobStatus` | `../../riot-perf` |
| `getMatchCacheCount` | `../../riot-perf` |

`server/domains/admin/routes.ts` no longer imports from `riot-sync.ts` or `riot-perf.ts` at all.

---

## Points Still Directly Coupled

| Location | What | Why it stays |
|---|---|---|
| `server/riot-perf.ts` | Internal `processPlayer`, `throttledFetch` | Core scoring pipeline — untouched by design |
| `server/riot-sync.ts` | Internal `fetchWithRetry`, `syncChallengerNA1` logic | Core sync pipeline — untouched by design |
| `server/index.ts` / schedulers | `startRiotSyncScheduler()`, `startPerfPricingScheduler()` | Scheduler wiring — bootstrapping concern, not HTTP handler concern. Phase 5D candidate if scheduler abstraction is needed. |
| `server/domains/performance/routes.ts` | Admin baselines / history / match detail — direct DB reads | Engine-internal state, intentionally outside the provider boundary |
| Other admin services (`runValuationBatch`, etc.) | `valuationJob`, market-core, AMM pricing | Different domain — outside the performance/sync scope of this phase |

---

## No Breaking Changes — Confirmation

- ✅ All API paths unchanged
- ✅ All response payloads identical
- ✅ All admin auth middleware preserved
- ✅ `riot-sync.ts` and `riot-perf.ts` untouched
- ✅ `performanceEngine.ts` untouched
- ✅ No schema / DB changes
- ✅ No market or trading flow changes
- ✅ Server boots clean, zero startup errors

---

## Recommended Next Steps for Phase 5D

1. **Scheduler abstraction** — `startRiotSyncScheduler()` and `startPerfPricingScheduler()` in `server/index.ts` still import directly from `riot-sync` and `riot-perf`. A `JobScheduler` or `IntegrationScheduler` service could wrap these, making the boot sequence provider-agnostic.

2. **Valuation job service** — `runValuationBatch()` and `seedInitialValuations()` are called directly from admin routes and the scheduler. A `ValuationJobService` parallel to `PerformanceBatchService` would complete the job service layer for the valuation pipeline.

3. **Provider health endpoint** — `GET /api/admin/provider/status` returning `{ providerName, game, marketMode }` for runtime observability of which provider is active.

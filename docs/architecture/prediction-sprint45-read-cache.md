# Prediction Markets — Sprint 4.5: In-Memory Read Cache

## Overview

Two read-heavy endpoints — `/api/predictions/home` and `/api/predictions/markets/:idOrSlug/detail` — are wrapped with a lightweight in-memory TTL cache. This eliminates repeated DB round-trips for data that changes on a timescale of seconds to minutes, not milliseconds.

The implementation is intentionally minimal: a plain `Map` with TTL-based expiry, scoped exclusively to the prediction domain, with no external dependencies and no infrastructure requirements.

---

## Endpoints Cached

| Endpoint | Cache Key | TTL |
|---|---|---|
| `GET /api/predictions/home` | `prediction:home` | 60 s |
| `GET /api/predictions/markets/:idOrSlug/detail` | `prediction:market-detail:<idOrSlug>` | 30 s |

---

## Files Created / Edited

| File | Change |
|---|---|
| `server/domains/prediction/cache.ts` | New — the cache module (Map + TTL helpers) |
| `server/domains/prediction/service.ts` | Edited — `getHome()` and `getMarketDetail()` wrapped with cache logic |
| `docs/architecture/prediction-sprint45-read-cache.md` | This file |

---

## Cache Helper Shape (`cache.ts`)

```typescript
// Core store
const store = new Map<string, CacheEntry<unknown>>();

// Read — returns null on miss or expired entry (lazy eviction)
getCached<T>(key: string): T | null

// Write — stores value with TTL
setCached<T>(key: string, value: T, ttlMs: number): void

// Explicit eviction — useful after mutations (currently unused; reserved)
evictCached(key: string): void

// Optional sweep of all expired entries (lazy eviction is sufficient at current scale)
clearExpired(): void

// Debug helper — returns live entry count
cacheSize(): number
```

The `CacheEntry` interface stores:
- `value: T` — the cached payload
- `expiresAt: number` — `Date.now() + ttlMs`, checked on every read
- `cachedAt: number` — write timestamp (for debug logging)

---

## TTLs Chosen

### Home — 60 seconds

The home page aggregates live markets, trending markets, and upcoming events. This data changes when:
- A market is opened or closed (rare — admin action)
- Volume/trending labels shift (driven by fills, which the market-maker bot executes every ~30 s)

A 60-second TTL means a new fill or status change is reflected within one minute. This is acceptable for a discovery/browsing surface.

### Market Detail — 30 seconds

The detail page is more specific and slightly more volatile:
- `positionCounts` changes on every order fill
- `stats` (lastPriceYes/No, volume24h) updates after every fill
- Lifecycle events are rare but timely

30 seconds is short enough to reflect recent activity without being so short the cache provides no benefit.

---

## Cache Key Strategy

### Home

Single static key: `"prediction:home"`. There is only one home payload (no per-user or per-filter variants).

### Market Detail

Key template: `"prediction:market-detail:<idOrSlug>"` where `<idOrSlug>` is the value passed by the route (numeric string like `"7"` or slug like `"will-ruler-win-mvp-k3882f"`).

**ID vs slug duplication:** If the same market is requested by both numeric ID and slug, two cache entries are created — one per access pattern. The payloads are identical; the duplication is harmless at this scale and TTL. Both entries expire independently within 30 seconds.

---

## Why In-Memory Cache Is Acceptable Now

1. **Single-process deployment** — GamerStock currently runs one Node process. An in-process Map is coherent by definition.
2. **Short TTLs** — 30–60 s expiry means stale data is bounded. No manual invalidation needed for correctness.
3. **No financial data** — only read aggregations are cached. Wallet, ledger, order, and settlement paths are untouched.
4. **Zero ops cost** — no Redis, no cluster config, no additional infrastructure.
5. **Easy to remove** — the two wrapped functions revert to pure DB reads by deleting the `getCached`/`setCached` calls. No schema or API changes required.

---

## Failure-Tolerance Behavior

Both `getCached` and `setCached` calls are wrapped in `try/catch` blocks:

```typescript
// On read
try {
  const cached = getCached<T>(key);
  if (cached) return cached;
} catch (cacheErr) {
  console.warn("[Prediction:cache] getCached error — proceeding with live read", cacheErr);
}

// On write (at end of function, after result is computed)
try {
  setCached(key, result, ttlMs);
} catch (cacheErr) {
  console.warn("[Prediction:cache] setCached error — ignoring", cacheErr);
}
```

**Cache errors never propagate to the caller.** The endpoint always falls back to a live DB-backed response.

---

## Staleness Signal — `generatedAt`

The home endpoint already includes `generatedAt: new Date().toISOString()` in its response. This is set once at computation time and preserved unchanged in the cache. When a client receives a cached response, `generatedAt` tells them how old the data is — a free staleness indicator with no additional fields needed.

Example:
- Request 1 (miss): `"generatedAt": "2026-03-14T23:14:01.937Z"` — fresh
- Request 2 (hit, 10 s later): `"generatedAt": "2026-03-14T23:14:01.937Z"` — same value; client can see it is 10 s old

No additional `cacheHit` or `cachedAt` fields were added to the response payloads. These would pollute product payloads and are not needed when `generatedAt` already serves as a staleness signal for home.

---

## Limitations

| Limitation | Impact |
|---|---|
| **Per-process only** | If the app ever scales to multiple Node processes or uses a cluster, each process has its own independent cache. Processes will not share cache state. |
| **Resets on restart** | Every deploy or crash wipes all cache entries. First request after a restart always hits the DB. |
| **No distributed invalidation** | A market status change triggered by an admin mutation is NOT reflected in other processes' caches until TTL expires. |
| **ID vs slug double entry** | Same market detail may be cached twice under different keys. Harmless but slightly wasteful. |
| **stats.updatedAt inside cached detail** | The `pricedAt` freshness timestamp inside a cached detail response reflects when the stats row was last updated — not when this response was cached. Clients may see `pricedAt` that is older than the cache TTL. |

---

## Example Miss vs Hit Behavior

### First request (cache miss)

```
[Prediction:cache] MISS+SET prediction:home (TTL 60s)
GET /api/predictions/home 200 in ~55ms
```

Response: fresh DB data, `generatedAt = T₀`

### Second request (cache hit, within TTL)

```
[Prediction:cache] HIT prediction:home
GET /api/predictions/home 200 in ~5ms
```

Response: identical payload, `generatedAt = T₀` (same as before — confirms hit)

### After TTL expiry

```
[Prediction:cache] MISS+SET prediction:home (TTL 60s)
GET /api/predictions/home 200 in ~55ms
```

Response: fresh DB data, `generatedAt = T₁` (new value)

---

## Remaining TODOs Before Moving On From Sprint 4.5

- [ ] **Cache invalidation hooks** — admin market transitions (`transitionMarketStatus`, `cancelAndRefundMarket`, `resolveAndSettleMarket`) should call `evictCached(detailCacheKey(marketId))` to proactively invalidate detail cache after mutations. Currently TTL handles this passively.
- [ ] **Redis migration path** — when the app scales to multiple processes, replace `getCached`/`setCached` with Redis calls. The `cache.ts` module can be swapped in one file without touching the service layer.
- [ ] **Home cache per-segment granularity** — if `liveMatches` and `trendingPredictions` need different TTLs (e.g., live matches expire in 15 s, trending in 60 s), split into two separate cache keys.
- [ ] **Cache size monitoring** — add `cacheSize()` to a debug/health endpoint if operational visibility is needed.

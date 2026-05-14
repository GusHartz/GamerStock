/**
 * Prediction domain — in-memory short-lived read cache
 *
 * Minimal Map-based TTL store.  Scoped to the prediction domain.
 * Intentionally NOT a platform-wide caching framework.
 *
 * Design goals:
 *  - Zero dependencies (pure JS Map)
 *  - Best-effort: cache miss / error always falls back to fresh DB read
 *  - Per-process only: reset on restart, no distributed invalidation
 *  - Easy to remove or replace with Redis later
 *
 * Sprint 4.5 — used for:
 *  - GET /api/predictions/home       (TTL 60 s)
 *  - GET /api/predictions/markets/:id/detail (TTL 30 s)
 */

interface CacheEntry<T> {
  value:     T;
  expiresAt: number; // Date.now() + ttlMs
  cachedAt:  number; // Date.now() at write time — useful for debug logging
}

const store = new Map<string, CacheEntry<unknown>>();

/**
 * Retrieve a cached value.
 * Returns null on miss or if the entry has expired.
 * Expired entries are evicted on read (lazy expiry).
 */
export function getCached<T>(key: string): T | null {
  const entry = store.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

/**
 * Store a value in the cache with a TTL in milliseconds.
 * Overwrites any existing entry for the same key.
 */
export function setCached<T>(key: string, value: T, ttlMs: number): void {
  store.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
    cachedAt:  Date.now(),
  });
}

/**
 * Manually evict a key (e.g., after a mutation).
 * No-op if the key is not present.
 */
export function evictCached(key: string): void {
  store.delete(key);
}

/**
 * Sweep all expired entries.
 * Optional — the store is small enough that lazy eviction on read is sufficient.
 * Can be called on a timer if needed.
 */
export function clearExpired(): void {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now > entry.expiresAt) store.delete(key);
  }
}

/** Total live (non-expired) entries — for debug/health endpoints only. */
export function cacheSize(): number {
  clearExpired();
  return store.size;
}

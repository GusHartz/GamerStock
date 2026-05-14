import { db } from "../db";
import { markets, marketSyncRuns, marketSyncStatus, assets, assetPriceSnapshots } from "@shared/schema";
import { eq, lt, and, isNotNull, sql as sqlExpr, desc } from "drizzle-orm";
import { syncCanonicalMarket } from "../market-core/sync";
import { marketHub } from "../ws/market-hub";

const INTERVAL_MS = 3 * 60 * 1000;
const PAUSE_DURATION_MS = 10 * 60 * 1000;
const FAILURE_THRESHOLD = 3;
const MIN_ASSET_COUNT = 200;
const DRIFT_STALE_MS = 15 * 60 * 1000;   // 15 minutes
const DRIFT_ALPHA = 0.05;                  // 5% step per run
const DRIFT_MAX_PCT = 0.015;              // clamp to ±1.5% per run

async function getRiotMarketId(): Promise<number> {
  const [m] = await db
    .select({ id: markets.id })
    .from(markets)
    .where(eq(markets.provider, "riot"))
    .limit(1);
  return m?.id ?? 1;
}

async function getOrInitStatus(marketId: number) {
  const [existing] = await db
    .select()
    .from(marketSyncStatus)
    .where(eq(marketSyncStatus.marketId, marketId));

  if (existing) return existing;

  await db.insert(marketSyncStatus).values({
    marketId,
    consecutiveFailures: 0,
    lastSuccessAt: null,
    pausedUntil: null,
    lastError: null,
  });

  const [fresh] = await db
    .select()
    .from(marketSyncStatus)
    .where(eq(marketSyncStatus.marketId, marketId));
  return fresh;
}

async function markSuccess(marketId: number) {
  await db
    .insert(marketSyncStatus)
    .values({
      marketId,
      consecutiveFailures: 0,
      lastSuccessAt: new Date(),
      pausedUntil: null,
      lastError: null,
    })
    .onConflictDoUpdate({
      target: marketSyncStatus.marketId,
      set: {
        consecutiveFailures: 0,
        lastSuccessAt: new Date(),
        pausedUntil: null,
        lastError: null,
      },
    });
}

async function markFailure(marketId: number, errorMsg: string) {
  const status = await getOrInitStatus(marketId);
  const newCount = (status.consecutiveFailures ?? 0) + 1;
  const shouldPause = newCount >= FAILURE_THRESHOLD;
  const pausedUntil = shouldPause ? new Date(Date.now() + PAUSE_DURATION_MS) : null;

  if (shouldPause) {
    console.warn(
      `[MarketSync] Circuit breaker OPEN — market=${marketId} failures=${newCount} pausedUntil=${pausedUntil?.toISOString()}`
    );
  }

  await db
    .insert(marketSyncStatus)
    .values({
      marketId,
      consecutiveFailures: newCount,
      lastError: errorMsg.slice(0, 500),
      pausedUntil,
    })
    .onConflictDoUpdate({
      target: marketSyncStatus.marketId,
      set: {
        consecutiveFailures: newCount,
        lastError: errorMsg.slice(0, 500),
        pausedUntil,
      },
    });
}

async function runDataQualityChecks(marketId: number, fetched: number) {
  if (fetched < MIN_ASSET_COUNT) {
    throw new Error(
      `Data quality check failed: fetched=${fetched} < minimum=${MIN_ASSET_COUNT}`
    );
  }

  const [{ zeroCount }] = await db
    .select({ zeroCount: sqlExpr<number>`count(*)::int` })
    .from(assets)
    .where(
      sqlExpr`${assets.marketId} = ${marketId} AND (${assets.lastTradePrice}::numeric <= 0 OR ${assets.lastTradePrice} IS NULL)`
    );

  const badPrices = Number(zeroCount);
  if (badPrices > 0) {
    console.warn(`[MarketSync] Data quality warning: ${badPrices} assets with price <= 0 (non-fatal)`);
  }
}

// ─────────────────────────────────────────────────────────────
//  Drift: nudge lastTradePrice toward fundamentalPrice for
//  stale assets (no trade in last 15 min). Volume unchanged.
// ─────────────────────────────────────────────────────────────
async function runDrift(marketId: number) {
  const staleCutoff = new Date(Date.now() - DRIFT_STALE_MS);

  const staleAssets = await db
    .select()
    .from(assets)
    .where(
      and(
        eq(assets.marketId, marketId),
        isNotNull(assets.fundamentalPrice),
        isNotNull(assets.lastTradePrice),
        lt(assets.updatedAt, staleCutoff),
      )
    );

  if (staleAssets.length === 0) return;

  let drifted = 0;
  const now = new Date();

  for (const asset of staleAssets) {
    const currentPrice = parseFloat(String(asset.lastTradePrice));
    const fundamental = parseFloat(String(asset.fundamentalPrice));

    if (!isFinite(currentPrice) || !isFinite(fundamental) || currentPrice <= 0) continue;

    let newPrice = currentPrice + DRIFT_ALPHA * (fundamental - currentPrice);

    // Clamp to ±1.5% per run
    const maxUp = currentPrice * (1 + DRIFT_MAX_PCT);
    const maxDown = currentPrice * (1 - DRIFT_MAX_PCT);
    newPrice = Math.max(maxDown, Math.min(maxUp, newPrice));

    // Skip negligible change
    if (Math.abs(newPrice - currentPrice) < 0.005) continue;

    const newPriceStr = newPrice.toFixed(2);

    await db.update(assets).set({
      lastTradePrice: newPriceStr,
      updatedAt: now,
    }).where(eq(assets.id, asset.id));

    // Snapshot (preserve volume and momentum — drift doesn't generate volume)
    await db.insert(assetPriceSnapshots).values({
      assetId: asset.id,
      price: newPriceStr,
      volume24h: asset.volume24h,
      momentum: asset.momentum,
    });

    // Emit WS so terminal updates in real time
    const event = {
      type: "asset.updated",
      data: {
        assetId: asset.id,
        lastTradePrice: newPriceStr,
        volume24h: asset.volume24h,
        momentum: asset.momentum,
        updatedAt: now.toISOString(),
      },
    };
    marketHub.publishTicker(event);
    marketHub.publishAsset(asset.id, event);

    drifted++;
  }

  if (drifted > 0) {
    console.log(`[Drift] Applied drift to ${drifted}/${staleAssets.length} stale assets (market=${marketId})`);
  }
}

async function runSync() {
  const start = Date.now();
  let marketId = 1;

  try {
    marketId = await getRiotMarketId();

    // Always run drift — even when canonical sync is paused by circuit breaker
    await runDrift(marketId).catch((err: any) => {
      console.error("[Drift] Error:", err?.message || err);
    });

    const status = await getOrInitStatus(marketId);
    if (status.pausedUntil && status.pausedUntil > new Date()) {
      console.log(
        `[MarketSync] Circuit breaker OPEN — skipping canonical sync for market=${marketId}, resumesAt=${status.pausedUntil.toISOString()}`
      );
      return;
    }

    console.log("[MarketSync] Starting canonical sync...");
    const result = await syncCanonicalMarket();
    const durationMs = Date.now() - start;

    await runDataQualityChecks(marketId, result.fetched);

    console.log(`[MarketSync] Done — fetched=${result.fetched} upserted=${result.upserted} in ${durationMs}ms`);

    await markSuccess(marketId);

    await db.insert(marketSyncRuns).values({
      marketId,
      startedAt: new Date(start),
      finishedAt: new Date(),
      durationMs,
      status: "success",
      rowsFetched: result.fetched,
      rowsUpdated: result.upserted,
    });
  } catch (err: any) {
    const durationMs = Date.now() - start;
    const errorMsg = String(err?.message || err);
    console.error("[MarketSync] Error:", errorMsg);

    await markFailure(marketId, errorMsg);

    try {
      await db.insert(marketSyncRuns).values({
        marketId,
        startedAt: new Date(start),
        finishedAt: new Date(),
        durationMs,
        status: "error",
        errorMessage: errorMsg.slice(0, 500),
      });
    } catch (logErr: any) {
      console.error("[MarketSync] Failed to log error row:", logErr?.message);
    }
  }
}

const SNAPSHOT_HEARTBEAT_MS = 60 * 1000; // 60 seconds

async function runSnapshotHeartbeat() {
  try {
    const activeAssets = await db
      .select({ id: assets.id, lastTradePrice: assets.lastTradePrice, volume24h: assets.volume24h, momentum: assets.momentum })
      .from(assets)
      .where(isNotNull(assets.lastTradePrice))
      .orderBy(desc(sqlExpr<number>`CAST(${assets.volume24h} AS NUMERIC)`))
      .limit(300);

    if (!activeAssets.length) return;

    const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000);
    const recentSnaps = await db
      .select({ assetId: assetPriceSnapshots.assetId })
      .from(assetPriceSnapshots)
      .where(sqlExpr<boolean>`${assetPriceSnapshots.recordedAt} >= ${twoMinAgo.toISOString()}`);

    const recentSet = new Set(recentSnaps.map(s => s.assetId));
    const staleAssets = activeAssets.filter(a => !recentSet.has(a.id));

    if (!staleAssets.length) return;

    const values = staleAssets.map(a => ({
      assetId: a.id,
      price: a.lastTradePrice!,
      volume24h: a.volume24h ?? "0",
      momentum: a.momentum ?? "0",
    }));

    await db.insert(assetPriceSnapshots).values(values);
  } catch (err: any) {
    console.error("[SnapshotHeartbeat] Error:", err?.message);
  }
}

export function startMarketSyncScheduler() {
  console.log(`[MarketSync] Scheduler started — interval=${INTERVAL_MS / 1000}s`);
  setInterval(runSync, INTERVAL_MS);
  setInterval(runSnapshotHeartbeat, SNAPSHOT_HEARTBEAT_MS);
  console.log(`[SnapshotHeartbeat] Started — interval=${SNAPSHOT_HEARTBEAT_MS / 1000}s`);
}

// ─── CS2 Stats Snapshot Service ───────────────────────────────────────────────
// Persists a snapshot of Steam career stats on every sync run.
// Snapshots are the raw material for the delta engine.
//
// Design rules:
//   - Append-only: one new row per sync call (no upsert)
//   - Full history retained indefinitely
//   - Only called when careerStats are available (providerStatus = "ok")
//   - assetId-based (not userId-based) — works for any CS2 asset
// ─────────────────────────────────────────────────────────────────────────────

import { db }                     from "../../db";
import { desc, eq }               from "drizzle-orm";
import { cs2StatsSnapshot }       from "@shared/schema/multigame";
import type { Cs2CareerStats }    from "./providers/steamCs2StatsClient";
import type { Cs2StatsSnapshot }  from "@shared/schema/multigame";

// ── Save ──────────────────────────────────────────────────────────────────────

/**
 * Save a new stats snapshot for the given asset.
 * Always inserts a new row — do NOT upsert.
 */
export async function saveCs2StatsSnapshot(
  assetId:     number,
  stats:       Cs2CareerStats,
): Promise<Cs2StatsSnapshot> {
  const [row] = await db.insert(cs2StatsSnapshot).values({
    assetId,
    kills:     stats.totalKills,
    deaths:    stats.totalDeaths,
    wins:      stats.totalWins,
    matches:   stats.totalMatchesPlayed,
    headshots: stats.totalHeadshots,
    rounds:    stats.totalRoundsPlayed,
  }).returning();

  console.log(
    `[CS2Snapshot] Saved — assetId=${assetId} ` +
    `matches=${stats.totalMatchesPlayed} kills=${stats.totalKills} ` +
    `deaths=${stats.totalDeaths} wins=${stats.totalWins}`,
  );

  return row;
}

// ── Read ──────────────────────────────────────────────────────────────────────

/**
 * Return the two most recent snapshots for the asset (latest first).
 * Used by the delta engine: diff[0] = current, diff[1] = previous.
 */
export async function getLatestCs2Snapshots(
  assetId: number,
  limit = 2,
): Promise<Cs2StatsSnapshot[]> {
  return db
    .select()
    .from(cs2StatsSnapshot)
    .where(eq(cs2StatsSnapshot.assetId, assetId))
    .orderBy(desc(cs2StatsSnapshot.createdAt))
    .limit(limit);
}

/**
 * Return the single most recent snapshot for the asset.
 * Returns null if no snapshot exists yet.
 */
export async function getLatestCs2StatsSnapshot(
  assetId: number,
): Promise<Cs2StatsSnapshot | null> {
  const rows = await getLatestCs2Snapshots(assetId, 1);
  return rows[0] ?? null;
}

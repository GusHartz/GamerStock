/**
 * Baseline Update Job
 *
 * Runs every 24 hours to recompute Challenger role baselines from
 * actual match data stored in player_match_metrics.
 *
 * For each (game, role, metric) group with ≥10 samples in the last 7 days,
 * computes mean + stdDev and upserts into role_baselines.
 */

import { db } from "../db";
import { playerMatchMetrics, roleBaselines } from "@shared/schema";
import { gte, sql } from "drizzle-orm";

function computeMean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function computeStdDev(values: number[], mean: number): number {
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export async function updateChallengerBaselines(): Promise<{ updated: number; skipped: number }> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const rows = await db
    .select()
    .from(playerMatchMetrics)
    .where(gte(playerMatchMetrics.createdAt, sevenDaysAgo));

  if (rows.length === 0) {
    console.log("[BaselineJob] No match metrics found in last 7 days, skipping.");
    return { updated: 0, skipped: 0 };
  }

  // Aggregate metrics by (game, role, metric)
  const buckets = new Map<string, number[]>();

  for (const row of rows) {
    const metrics = row.metricsJson as Record<string, number>;
    if (!metrics || typeof metrics !== "object") continue;

    for (const [metric, value] of Object.entries(metrics)) {
      if (typeof value !== "number" || !isFinite(value)) continue;
      const key = `${row.game}::${row.role}::${metric}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(value);
    }
  }

  const MIN_SAMPLES = 10;
  let updated = 0;
  let skipped = 0;

  for (const [key, values] of buckets) {
    if (values.length < MIN_SAMPLES) {
      skipped++;
      continue;
    }

    const [game, role, metric] = key.split("::");
    const mean = computeMean(values);
    const stdDev = computeStdDev(values, mean);

    if (stdDev <= 0) {
      skipped++;
      continue;
    }

    await db
      .insert(roleBaselines)
      .values({
        game,
        queue: "RANKED_SOLO",
        tier: "CHALLENGER",
        role,
        metric,
        meanValue: mean.toFixed(4),
        stdDev: stdDev.toFixed(4),
        sampleSize: values.length,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          roleBaselines.game,
          roleBaselines.queue,
          roleBaselines.tier,
          roleBaselines.role,
          roleBaselines.metric,
        ],
        set: {
          meanValue: mean.toFixed(4),
          stdDev: stdDev.toFixed(4),
          sampleSize: values.length,
          updatedAt: new Date(),
        },
      });

    updated++;
  }

  console.log(`[BaselineJob] Updated ${updated} baselines, skipped ${skipped} (insufficient samples).`);
  return { updated, skipped };
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const INITIAL_DELAY_MS = 60 * 1000; // 60 seconds after startup
let schedulerStarted = false;

export function startBaselineUpdateScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;

  const run = async () => {
    console.log("[BaselineJob] Running baseline update...");
    try {
      const result = await updateChallengerBaselines();
      console.log(`[BaselineJob] Done: updated=${result.updated} skipped=${result.skipped}`);
    } catch (err: any) {
      console.error("[BaselineJob] Error:", err.message);
    }
    setTimeout(run, INTERVAL_MS);
  };

  setTimeout(run, INITIAL_DELAY_MS);
  console.log(`[BaselineJob] Baseline update scheduler started (first run in ${INITIAL_DELAY_MS / 1000}s, then every 24h).`);
}

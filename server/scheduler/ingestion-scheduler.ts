// ─── Ingestion Scheduler ──────────────────────────────────────────────────────
// Responsibility: register the recurring ingestion job using setInterval,
// following the project's standard scheduler pattern.
//
// Env vars:
//   INGESTION_SCHEDULER_ENABLED      "true" (default) | "false"
//   INGESTION_SCHEDULER_INTERVAL_MS  milliseconds between cycles (default: 15 min)
//
// All ingestion logic lives in ingestionSchedulerService — this file only
// handles the timer setup and lifecycle logging.
// ─────────────────────────────────────────────────────────────────────────────

import { ingestionSchedulerService } from "../domains/ingestion/services/ingestionSchedulerService";

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

async function runCycle() {
  console.log("[IngestionScheduler] Cycle starting...");
  try {
    const result = await ingestionSchedulerService.runDefaultCycle();
    console.log(
      `[IngestionScheduler] Cycle complete — ` +
      `fetched=${result.fetchedCount} persisted=${result.persistedCount} ` +
      `dupeGroups=${result.duplicateGroupsFound} duration=${result.durationMs}ms` +
      (result.errors.length ? ` errors=${result.errors.length}` : "")
    );
    if (result.errors.length > 0) {
      result.errors.forEach((e) => console.error("[IngestionScheduler] Error:", e));
    }
  } catch (err: any) {
    console.error("[IngestionScheduler] Unhandled cycle error:", err?.message ?? err);
  }
}

export function startIngestionScheduler(): void {
  const enabled = (process.env.INGESTION_SCHEDULER_ENABLED ?? "true") !== "false";

  if (!enabled) {
    console.log("[IngestionScheduler] Disabled via INGESTION_SCHEDULER_ENABLED=false — skipping.");
    return;
  }

  if (!process.env.PANDASCORE_API_KEY) {
    console.log("[IngestionScheduler] Skipped — PANDASCORE_API_KEY not set.");
    return;
  }

  const intervalMs =
    Number(process.env.INGESTION_SCHEDULER_INTERVAL_MS) || DEFAULT_INTERVAL_MS;

  console.log(
    `[IngestionScheduler] Starting — interval=${intervalMs / 1000}s ` +
    `enabled=${enabled}`
  );

  // First run after a short warm-up delay so it doesn't compete with startup I/O
  setTimeout(() => {
    runCycle();
    setInterval(runCycle, intervalMs);
  }, 60_000); // 60 s warm-up, matching the news service pattern

  console.log("[IngestionScheduler] Registered (first cycle in 60s).");
}

// ─── Provider Resolution Scheduler ───────────────────────────────────────────
// Background cron that calls resolveEligiblePredictionMarketsFromProviders()
// at a configurable interval, following the project's standard scheduler pattern.
//
// Env vars:
//   PROVIDER_RESOLUTION_SCHEDULER_ENABLED   "true" (default) | "false"
//   PROVIDER_RESOLUTION_SCHEDULER_INTERVAL_MS  ms between cycles (default: 5 min)
//
// All resolution logic lives in providerResolutionBatchService — this file only
// handles the timer setup, lifecycle logging, and the overlap guard.
// ─────────────────────────────────────────────────────────────────────────────

import { runBatchWithOverlapGuard } from "../domains/prediction/services/providerResolutionBatchService";
import { isPredictEnabledServer } from "../lib/featureFlags";

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;  // 5 minutes
const WARMUP_DELAY_MS     = 2 * 60 * 1000;  // 2 minutes — avoids competing with startup I/O

const runCycle = async () => {
  console.log("[ProviderResolutionScheduler] Cycle starting...");
  try {
    const result = await runBatchWithOverlapGuard({ actor: "provider_resolution_scheduler" });
    if (result === null) {
      console.warn("[ProviderResolutionScheduler] Cycle skipped — previous batch still running.");
      return;
    }
    console.log(
      `[ProviderResolutionScheduler] Cycle complete — ` +
      `scanned=${result.totalScanned} resolved=${result.resolved} ` +
      `alreadyResolved=${result.alreadyResolved} noAction=${result.noAction} ` +
      `manualReview=${result.manualReviewRequired} failed=${result.failed} ` +
      `duration=${result.durationMs}ms`,
    );
  } catch (err: any) {
    console.error("[ProviderResolutionScheduler] Unhandled cycle error:", err?.message ?? err);
  }
};

let schedulerStarted = false;

export function startProviderResolutionScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;

  // Feature flag gate (Layer 1): skip entirely when Predict is disabled.
  if (!isPredictEnabledServer()) {
    console.log("[ProviderResolutionScheduler] Predict feature disabled — scheduler will not start.");
    return;
  }

  // Existing per-scheduler opt-out (Layer 2): env var override.
  const enabled =
    (process.env.PROVIDER_RESOLUTION_SCHEDULER_ENABLED ?? "true") !== "false";

  if (!enabled) {
    console.log(
      "[ProviderResolutionScheduler] Disabled via PROVIDER_RESOLUTION_SCHEDULER_ENABLED=false — skipping.",
    );
    return;
  }

  const intervalMs =
    Number(process.env.PROVIDER_RESOLUTION_SCHEDULER_INTERVAL_MS) || DEFAULT_INTERVAL_MS;

  // Warm-up delay: first cycle runs after 2 min so it doesn't race with startup I/O
  setTimeout(() => {
    runCycle();
    setInterval(runCycle, intervalMs);
  }, WARMUP_DELAY_MS);

  console.log(
    `[ProviderResolutionScheduler] Registered — ` +
    `interval=${intervalMs / 1000}s, first cycle in ${WARMUP_DELAY_MS / 1000}s.`,
  );
}

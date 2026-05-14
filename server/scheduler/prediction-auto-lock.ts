// ─── Prediction Auto-Lock Scheduler ───────────────────────────────────────────
// Background job that transitions prediction markets from "open" → "locked"
// once their closeAt timestamp has elapsed.
//
// Pattern: matches server/scheduler/market-sync-scheduler.ts — simple setInterval
// with a started-guard and a clearly named exported start function.
//
// Interval: 60 seconds (configurable via PREDICTION_AUTOLOCK_INTERVAL_MS env var).
// On each tick: find all open markets where closeAt <= now, lock each one.
//
// This job is COMPLEMENTARY to the runtime guard in order placement.
// The runtime guard rejects orders on expired-closeAt markets even if the
// scheduler has not run yet (e.g., cold start delay, scheduler lag, process restart).
// ─────────────────────────────────────────────────────────────────────────────
import { predictionRepository } from "../domains/prediction/repository";
import { predictionService }    from "../domains/prediction/service";
import { isPredictEnabledServer } from "../lib/featureFlags";

const INTERVAL_MS =
  parseInt(process.env.PREDICTION_AUTOLOCK_INTERVAL_MS ?? "60000", 10);

// ── In-process operational state (exposed to health endpoint) ─────────────────

export interface AutoLockState {
  enabled:       boolean;
  lastRunAt:     string | null;
  lastLockedCount: number;
  totalLocked:   number;
  runCount:      number;
}

const state: AutoLockState = {
  enabled:         false,
  lastRunAt:       null,
  lastLockedCount: 0,
  totalLocked:     0,
  runCount:        0,
};

export function getPredictionAutoLockState(): Readonly<AutoLockState> {
  return state;
}

// ── Core job function ─────────────────────────────────────────────────────────

async function runAutoLock(): Promise<void> {
  state.runCount++;
  state.lastRunAt = new Date().toISOString();

  let lockable: Awaited<ReturnType<typeof predictionRepository.findLockableMarkets>>;
  try {
    lockable = await predictionRepository.findLockableMarkets();
  } catch (err: any) {
    console.error("[PredictionAutoLock] DB query failed:", err?.message);
    state.lastLockedCount = 0;
    return;
  }

  if (lockable.length === 0) {
    state.lastLockedCount = 0;
    return;
  }

  console.log(`[PredictionAutoLock] Found ${lockable.length} market(s) past closeAt — locking.`);

  let lockedThisRun = 0;

  for (const market of lockable) {
    try {
      const result = await predictionService.transitionMarketStatus({
        marketId:    market.id,
        targetStatus: "locked",
        actorUserId: "auto_lock_scheduler",
      });

      if (result.success) {
        lockedThisRun++;
        console.log(
          `[PredictionAutoLock] Market #${market.id} ("${market.question?.slice(0, 60)}") → locked` +
          ` (closeAt=${market.closeAt?.toISOString()})`
        );
      } else {
        // Expected for already-locked/resolved/settled markets (race with manual action).
        console.warn(
          `[PredictionAutoLock] Market #${market.id} transition skipped: ${result.error}`
        );
      }
    } catch (err: any) {
      console.error(
        `[PredictionAutoLock] Market #${market.id} lock failed (non-fatal):`, err?.message
      );
    }
  }

  state.lastLockedCount = lockedThisRun;
  state.totalLocked    += lockedThisRun;

  if (lockedThisRun > 0) {
    console.log(`[PredictionAutoLock] Locked ${lockedThisRun} market(s) this run.`);
  }
}

// ── Scheduler start (call once at server boot) ────────────────────────────────

let schedulerStarted = false;

export function startPredictionAutoLockScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;

  // Feature flag gate: skip entirely when Predict is disabled.
  if (!isPredictEnabledServer()) {
    console.log("[PredictionAutoLock] Predict feature disabled — scheduler will not start.");
    return;
  }

  state.enabled = true;

  // Run immediately on startup to catch any markets that expired while server was down.
  runAutoLock().catch((err: any) => {
    console.error("[PredictionAutoLock] Initial run failed (non-fatal):", err?.message);
  });

  setInterval(() => {
    runAutoLock().catch((err: any) => {
      console.error("[PredictionAutoLock] Interval run failed (non-fatal):", err?.message);
    });
  }, INTERVAL_MS);

  console.log(
    `[PredictionAutoLock] Scheduler started — interval=${INTERVAL_MS / 1000}s,` +
    ` running initial lock pass on boot.`
  );
}

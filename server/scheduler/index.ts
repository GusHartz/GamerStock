// ─── Scheduler Orchestration ──────────────────────────────────────────────────
// Single entry point for all background schedulers and periodic jobs.
// Called once from server/index.ts after the HTTP server starts listening.
//
// Environment guards implemented here:
//   - Bot simulator: blocked in PROD unless ENABLE_BOTS=true
//   - Bot simulator: blocked always if DISABLE_BOTS=true
//   - Startup seed: delegates to startup-seed.ts which guards per data state
//
// To add a new scheduler: import the start function and call it here.
// DO NOT add scheduler logic back to server/index.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { startMarketSimulator } from "../market-maker";
import { startRiotSyncScheduler } from "../riot-sync";
import { startPerfPricingScheduler } from "../riot-perf";
import { startMarketSyncScheduler } from "./market-sync-scheduler";
import { startPredictionAutoLockScheduler } from "./prediction-auto-lock";
import { startIngestionScheduler } from "./ingestion-scheduler";
import { startProviderResolutionScheduler } from "./provider-resolution-scheduler";
import { startTriggerEngine } from "../services/triggerEngine";
import { startBaselineUpdateScheduler } from "../services/baselineUpdateJob";
import { startBotSimulator } from "../simulation/bots/bot-trader";
import { seedInitialValuations, runValuationBatch } from "../services/valuationJob";
import { startMultigameValuationLoop } from "../domains/multigame/multigameValuationScheduler";
import { runBulkCs2PriceProjectionV2 } from "../migrations/bulkCs2PriceProjection";
import { startTerminalReconciler } from "../domains/terminal/reconciler";
import { resolveExpiredDuels } from "../services/duelService";
import { backfillAchievementBadges } from "../services/achievementsService";
import { runStartupSeed } from "../market-core/startup-seed";
import { backgroundNewsRefresh } from "../services/newsService";
import { ensureSystemWalletsExist } from "../domains/fee-engine";

// ── Environment Guards ─────────────────────────────────────────────────────────

const isProd = process.env.NODE_ENV === "production";

/**
 * Determines whether the bot simulator should start.
 *
 * Rules (evaluated in order):
 *   1. DISABLE_BOTS=true  → never start (any environment)
 *   2. NODE_ENV=production → start ONLY if ENABLE_BOTS=true
 *   3. otherwise (dev/test) → start by default
 *
 * Rationale: bots modify real wallet balances and generate real trades.
 * In production this should be an intentional operational choice, not the default.
 */
function botGuard(): { run: boolean; reason: string } {
  if (process.env.DISABLE_BOTS === "true") {
    return { run: false, reason: "DISABLE_BOTS=true (explicit opt-out)" };
  }
  if (isProd && process.env.ENABLE_BOTS !== "true") {
    return { run: false, reason: "NODE_ENV=production without ENABLE_BOTS=true (safe default)" };
  }
  if (isProd) {
    return { run: true, reason: "NODE_ENV=production with ENABLE_BOTS=true (explicit opt-in)" };
  }
  return { run: true, reason: `NODE_ENV=${process.env.NODE_ENV || "development"} (default)` };
}

// ── Main Entry Point ───────────────────────────────────────────────────────────

/**
 * startSchedulers — starts all background jobs and periodic schedulers.
 *
 * Called once by server/index.ts after the HTTP server starts listening.
 * Each scheduler is independently non-fatal.
 * Guards control which schedulers run based on environment and flags.
 */
export async function startSchedulers(): Promise<void> {
  const env = process.env.NODE_ENV || "development";

  console.log("[Schedulers] ════════════════════════════════════════");
  console.log("[Schedulers] Initializing background jobs...");
  console.log(`[Schedulers] Environment : ${env}`);
  console.log(`[Schedulers] ENABLE_BOTS : ${process.env.ENABLE_BOTS ?? "(unset)"}`);
  console.log(`[Schedulers] DISABLE_BOTS: ${process.env.DISABLE_BOTS ?? "(unset)"}`);
  console.log("[Schedulers] ────────────────────────────────────────");

  // ── Core market infrastructure (always on) ────────────────────────────────

  startMarketSimulator();
  console.log("[Schedulers] ✓ Market simulator    — AMM + PAE + momentum (15s tick)");

  startRiotSyncScheduler();
  console.log("[Schedulers] ✓ Riot sync           — LoL challengers sync (24h interval)");

  startPerfPricingScheduler();
  console.log("[Schedulers] ✓ Perf pricing        — LoL PVI recalc (10m interval)");

  startMarketSyncScheduler();
  console.log("[Schedulers] ✓ Market sync         — canonical market state sync");

  startPredictionAutoLockScheduler();
  console.log("[Schedulers] ✓ Prediction lock     — auto-locks expired predictions");

  startIngestionScheduler();
  console.log("[Schedulers] ✓ Ingestion           — provider data ingestion");

  startProviderResolutionScheduler();
  console.log("[Schedulers] ✓ Provider resolution — resolves pending provider events");

  // ── System wallet init (idempotent, non-fatal) ────────────────────────────

  ensureSystemWalletsExist().catch((e: any) => {
    console.error("[Schedulers] System wallet init failed (non-fatal):", e?.message);
  });

  // ── Domain services ───────────────────────────────────────────────────────

  startTriggerEngine();
  console.log("[Schedulers] ✓ Trigger engine      — order trigger evaluation");

  startBaselineUpdateScheduler();
  console.log("[Schedulers] ✓ Baseline updater    — fundamental price baseline sync");

  startMultigameValuationLoop();
  console.log("[Schedulers] ✓ Multigame valuation — Dota2 + CS2 valuation loop");

  // One-time idempotent data correction (safe to re-run — no-op after first execution)
  runBulkCs2PriceProjectionV2().catch((e: any) =>
    console.error("[Schedulers] CS2 price projection V2 (non-fatal):", e?.message),
  );

  startTerminalReconciler();
  console.log("[Schedulers] ✓ Terminal reconciler — invariant integrity check");

  // ── Bot simulator (environment-guarded) ──────────────────────────────────

  const bots = botGuard();
  if (bots.run) {
    startBotSimulator()
      .then(() => console.log(`[Schedulers] ✓ Bot simulator       — started (${bots.reason})`))
      .catch((e: any) =>
        console.error("[Schedulers] Bot simulator failed to start (non-fatal):", e?.message),
      );
  } else {
    console.log(`[Schedulers] ✗ Bot simulator       — SKIPPED (${bots.reason})`);
  }

  // ── Startup seed (data bootstrap, non-blocking) ───────────────────────────
  // startup-seed.ts has its own data-existence guards:
  //   - skips Riot sync if markets/assets already exist
  //   - skips Dota2 bootstrap if assetCount > 0
  //   - skips CS2 bootstrap if cs2AssetCount > 0
  //   - skips Dota2 enrichment if dota2_valuation_state already populated

  console.log("[Schedulers] → Startup seed        — running in background...");
  runStartupSeed().catch((err: any) => {
    console.error("[Schedulers] Startup seed failed (non-fatal):", err?.message || err);
  });

  // ── One-time backfills (non-blocking, idempotent) ─────────────────────────

  backfillAchievementBadges().catch((err: any) => {
    console.error("[Schedulers] Achievement badge backfill (non-fatal):", err?.message || err);
  });

  // ── Valuation seed + periodic loop ───────────────────────────────────────

  seedInitialValuations().catch((err: any) => {
    console.error("[Schedulers] Initial valuation seed (non-fatal):", err?.message || err);
  });

  const VALUATION_INTERVAL_MS = 10 * 60 * 1000;
  const scheduleValuation = () =>
    setTimeout(async () => {
      await runValuationBatch(50).catch((err: any) => {
        console.error("[ValuationBatch] Scheduled run error (non-fatal):", err?.message);
      });
      scheduleValuation();
    }, VALUATION_INTERVAL_MS);
  scheduleValuation();
  console.log("[Schedulers] ✓ Valuation batch     — 10m interval");

  // ── Duel resolver (periodic) ─────────────────────────────────────────────

  const DUEL_RESOLVE_INTERVAL_MS = 15 * 60 * 1000;
  const scheduleDuelResolver = () =>
    setTimeout(async () => {
      await resolveExpiredDuels().catch((err: any) => {
        console.error("[DuelResolver] Scheduled run error (non-fatal):", err?.message);
      });
      scheduleDuelResolver();
    }, DUEL_RESOLVE_INTERVAL_MS);
  scheduleDuelResolver();
  console.log("[Schedulers] ✓ Duel resolver       — 15m interval");

  // ── News refresh (delayed start, periodic) ────────────────────────────────

  const NEWS_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
  setTimeout(() => {
    backgroundNewsRefresh().catch((err: any) => {
      console.error("[NewsService] Initial warm-up failed (non-fatal):", err?.message);
    });
    const scheduleNews = () =>
      setTimeout(async () => {
        await backgroundNewsRefresh().catch((err: any) => {
          console.error("[NewsService] Scheduled refresh (non-fatal):", err?.message);
        });
        scheduleNews();
      }, NEWS_REFRESH_INTERVAL_MS);
    scheduleNews();
  }, 30_000);
  console.log("[Schedulers] ✓ News refresh        — 10m interval (first run in 30s)");

  console.log("[Schedulers] ────────────────────────────────────────");
  console.log("[Schedulers] All schedulers initialized.");
  console.log("[Schedulers] ════════════════════════════════════════");
}

// ─── Provider Resolution Batch Service ───────────────────────────────────────
// Fase 5: batch/cron-safe resolution of MATCH_WINNER markets via PandaScore.
//
// Entry point:
//   resolveEligiblePredictionMarketsFromProviders(options?)
//
// What it does:
//   1. Queries markets eligible for provider resolution (Fase 5 filter rules)
//   2. Calls resolvePredictionMarketFromProvider() per market — one at a time,
//      non-throwing: any individual failure is captured and counted
//   3. Returns an aggregated BatchResolutionSummary
//
// Safety guarantees inherited from Fase 4:
//   - Each call is idempotent — settled markets return ALREADY_RESOLVED, no re-payment
//   - No wallet mutation outside the canonical settlement engine
//   - No distributed lock needed for correctness (DB unique index + status guards)
//
// Overlap guard:
//   - `running` flag prevents concurrent batch executions in the same process.
//     The scheduler uses this flag; the manual endpoint ignores it by default
//     (it can force-run, returning early if already running).
//
// Limitations:
//   - No distributed lock: two processes running concurrently can attempt the
//     same market. Safety relies on Fase 4's idempotency guarantees.
//   - No PandaScore rate-limit back-off: each market triggers one API call.
//     At 100 markets/batch this is well within PandaScore's default limits.
//   - Batch limit: default 100 eligible markets per run to cap API usage.
// ─────────────────────────────────────────────────────────────────────────────

import { predictionRepository }         from "../repository";
import { resolvePredictionMarketFromProvider } from "./providerResolutionService";
import type { ProviderResolutionStatus }      from "./providerResolutionService";

// ── Result types ──────────────────────────────────────────────────────────────

export interface BatchMarketDetail {
  marketId:   number;
  status:     ProviderResolutionStatus | "FAILED";
  reason?:    string;
  matchId?:   string;
  winnerId?:  number | null;
  winningOutcomeId?: number | null;
  settlementSummary?: {
    positionsSettled:  number;
    positionsSkipped:  number;
    totalWinnerPayout: string;
  };
}

export interface BatchResolutionSummary {
  startedAt:             string;   // ISO 8601
  finishedAt:            string;
  durationMs:            number;
  totalScanned:          number;   // markets returned by the eligibility query
  totalEligible:         number;   // subset that passed the intra-market checks
  resolved:              number;
  alreadyResolved:       number;
  noAction:              number;
  manualReviewRequired:  number;
  failed:                number;   // unexpected errors per market
  details:               BatchMarketDetail[];
}

export interface BatchResolutionOptions {
  /** Cap on markets fetched from DB. Default: 100. */
  limit?: number;
  /** Actor label recorded in ledger / market-events. Default: "batch_resolver" */
  actor?: string;
}

// ── Overlap guard ─────────────────────────────────────────────────────────────

let running = false;

export function isBatchRunning(): boolean {
  return running;
}

// ── Core batch function ───────────────────────────────────────────────────────

export const resolveEligiblePredictionMarketsFromProviders = async (
  options: BatchResolutionOptions = {},
): Promise<BatchResolutionSummary> => {
  const limit = options.limit ?? 100;
  const actor = options.actor ?? "batch_resolver";

  const startedAt = new Date();

  // ── 1. Query eligible markets ──────────────────────────────────────────────
  let eligible: Awaited<ReturnType<typeof predictionRepository.findMarketsEligibleForProviderResolution>>;
  try {
    eligible = await predictionRepository.findMarketsEligibleForProviderResolution(limit);
  } catch (err: any) {
    const now = new Date().toISOString();
    console.error("[ProviderResolutionBatch] DB eligibility query failed:", err?.message);
    return {
      startedAt:            startedAt.toISOString(),
      finishedAt:           now,
      durationMs:           Date.now() - startedAt.getTime(),
      totalScanned:         0,
      totalEligible:        0,
      resolved:             0,
      alreadyResolved:      0,
      noAction:             0,
      manualReviewRequired: 0,
      failed:               1,
      details:              [{ marketId: 0, status: "FAILED", reason: `Eligibility query failed: ${err?.message}` }],
    };
  }

  const totalScanned = eligible.length;
  console.log(`[ProviderResolutionBatch] Scanned ${totalScanned} eligible market(s)`);

  // ── 2. Process each market ─────────────────────────────────────────────────

  const details:             BatchMarketDetail[] = [];
  let resolved              = 0;
  let alreadyResolved       = 0;
  let noAction              = 0;
  let manualReviewRequired  = 0;
  let failed                = 0;

  for (const row of eligible) {
    const { marketId } = row;
    try {
      const result = await resolvePredictionMarketFromProvider(marketId, actor);

      const detail: BatchMarketDetail = {
        marketId,
        status:  result.status,
        reason:  result.reason,
        matchId: result.matchId,
        winnerId: result.winnerId,
        winningOutcomeId: result.winningOutcomeId ?? undefined,
        settlementSummary: result.settlementSummary,
      };
      details.push(detail);

      switch (result.status) {
        case "RESOLVED":               resolved++;              break;
        case "ALREADY_RESOLVED":       alreadyResolved++;       break;
        case "NO_ACTION":              noAction++;              break;
        case "MANUAL_REVIEW_REQUIRED": manualReviewRequired++;  break;
      }

      const emoji =
        result.status === "RESOLVED"               ? "✓" :
        result.status === "ALREADY_RESOLVED"       ? "=" :
        result.status === "MANUAL_REVIEW_REQUIRED" ? "!" : "–";
      console.log(
        `[ProviderResolutionBatch] Market #${marketId} ${emoji} ${result.status}` +
        (result.reason ? ` — ${result.reason}` : ""),
      );
    } catch (err: any) {
      failed++;
      const reason = `Unhandled error: ${err?.message ?? String(err)}`;
      console.error(`[ProviderResolutionBatch] Market #${marketId} FAILED:`, reason);
      details.push({ marketId, status: "FAILED", reason });
    }
  }

  // ── 3. Aggregate summary ───────────────────────────────────────────────────

  const finishedAt = new Date();
  const summary: BatchResolutionSummary = {
    startedAt:            startedAt.toISOString(),
    finishedAt:           finishedAt.toISOString(),
    durationMs:           finishedAt.getTime() - startedAt.getTime(),
    totalScanned,
    totalEligible:        totalScanned,   // all returned by query are eligible
    resolved,
    alreadyResolved,
    noAction,
    manualReviewRequired,
    failed,
    details,
  };

  console.log(
    `[ProviderResolutionBatch] Done — ` +
    `scanned=${totalScanned} resolved=${resolved} alreadyResolved=${alreadyResolved} ` +
    `noAction=${noAction} manualReview=${manualReviewRequired} failed=${failed} ` +
    `duration=${summary.durationMs}ms`,
  );

  return summary;
};

// ── Overlap-guarded wrapper used by the scheduler ─────────────────────────────

export const runBatchWithOverlapGuard = async (
  options: BatchResolutionOptions = {},
): Promise<BatchResolutionSummary | null> => {
  if (running) {
    console.warn("[ProviderResolutionBatch] Previous batch still running — skipping overlap.");
    return null;
  }

  running = true;
  try {
    return await resolveEligiblePredictionMarketsFromProviders(options);
  } finally {
    running = false;
  }
};

/**
 * PerformanceBatchService
 *
 * Operational service responsible for running the performance scoring batch
 * that processes riot_assets players, fetches recent match data, and updates
 * EMA scores + valuation state.
 *
 * ─── Responsibility boundary ──────────────────────────────────────────────────
 * Provider  = read/adapt data (query players, fundamentals, scores)
 * JobService = operational orchestration (trigger jobs, report outcomes)
 *
 * This service does not return performance scores for client consumption —
 * it returns job execution outcomes (processed count, error count).
 *
 * Delegates to riot-perf.ts internally. That module is not replaced here.
 */

import { runPerfPricingJob } from "../../riot-perf";

export interface PerfBatchResult {
  processed: number;
  errors: number;
}

export class PerformanceBatchService {
  /**
   * Run a single performance scoring batch.
   * Processes the least-recently-updated batch of riot_assets players,
   * fetches match history, computes EMA scores, and persists valuation state.
   *
   * Safe to call manually (admin trigger). The underlying module guards
   * against concurrent execution — calling while a batch is running returns
   * { processed: 0, errors: 0 } immediately.
   */
  async runBatch(): Promise<PerfBatchResult> {
    return runPerfPricingJob();
  }
}

export const performanceBatchService = new PerformanceBatchService();

/**
 * PerformanceSyncService
 *
 * Operational service responsible for syncing the player roster from the
 * upstream data source (Riot Challenger API in production, no-op in SANDBOX).
 *
 * ─── Responsibility boundary ──────────────────────────────────────────────────
 * Provider  = read/adapt data (query players, fundamentals, scores)
 * JobService = operational orchestration (trigger syncs, report job state)
 *
 * This service lives on the job side. It does not return player data for
 * client consumption — it returns operational results (counts, status).
 *
 * Delegates to riot-sync.ts internally. That module is not replaced here —
 * this is purely an encapsulation layer so that admin HTTP handlers are
 * decoupled from module imports.
 */

import { syncChallengerNA1 } from "../../riot-sync";
import { getMatchCacheCount, getPerfJobStatus } from "../../riot-perf";

export interface PlayerSyncResult {
  inserted: number;
  updated: number;
  total: number;
}

export interface PerfJobStatus {
  running: boolean;
  lastRunAt: Date | null;
  lastRunProcessed: number;
  lastRunErrors: number;
  matchCacheCount: number;
}

export class PerformanceSyncService {
  /**
   * Trigger a full Challenger roster sync from the upstream provider.
   * In production: fetches NA1 Challenger league from Riot API and upserts riot_assets.
   * In SANDBOX / missing API key: the underlying module already skips safely.
   */
  async syncChallengerRoster(): Promise<PlayerSyncResult> {
    return syncChallengerNA1();
  }

  /**
   * Return the current state of the performance pipeline and match cache.
   * Safe to call at any time — reads in-memory state and a single DB count.
   */
  async getStatus(): Promise<PerfJobStatus> {
    const matchCacheCount = await getMatchCacheCount();
    const jobStatus = getPerfJobStatus();
    return {
      ...jobStatus,
      matchCacheCount,
    };
  }
}

export const performanceSyncService = new PerformanceSyncService();

// ─── Ingestion Scheduler Service ─────────────────────────────────────────────
// Responsibility: orchestrate one complete ingestion cycle.
//   1. Fetch events from PandaScore (paginated, per-game)
//   2. Persist via candidateRepository.upsertManyCandidates
//   3. Run analytic deduplication
//   4. Return a structured operational summary
//
// This service contains NO timer/cron logic — that lives in
// server/scheduler/ingestion-scheduler.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { PandaScoreIngestionService } from "../providers/pandascore/pandascoreIngestionService";
import { candidateRepository } from "../repository/candidateRepository";
import { candidateDeduplicationService } from "./candidateDeduplicationService";
import type { FetchInventoryParams } from "../providers/pandascore/pandascoreIngestionService";

// ── Public types ──────────────────────────────────────────────────────────────

export interface IngestionCycleOptions {
  /** Game codes to ingest, e.g. ["lol", "cs2"]. Empty = no game filter (all). */
  games?:           string[];
  perPage?:         number;
  /** How many pages to fetch per endpoint per game. Default: 3. */
  maxPages?:        number;
  includeUpcoming?: boolean;
  includeRunning?:  boolean;
  includePast?:     boolean;
}

export interface IngestionCycleResult {
  startedAt:                     string;    // ISO 8601
  finishedAt:                    string;
  durationMs:                    number;
  gamesProcessed:                string[];
  fetchedCount:                  number;
  persistedCount:                number;
  duplicateGroupsFound:          number;
  schemaSupportsPersistedDedupe: false;
  errors:                        string[];
}

// ── Service ───────────────────────────────────────────────────────────────────

export class IngestionSchedulerService {
  private readonly pandaScore: PandaScoreIngestionService;

  /** True while a cycle is running — prevents overlapping executions. */
  private running = false;

  constructor(pandaScore?: PandaScoreIngestionService) {
    this.pandaScore = pandaScore ?? new PandaScoreIngestionService();
  }

  // ── Main entry points ─────────────────────────────────────────────────────

  /**
   * Runs one full ingestion cycle with the provided options.
   * If a cycle is already in progress, returns immediately with a warning.
   */
  async runOnce(options: IngestionCycleOptions = {}): Promise<IngestionCycleResult> {
    if (this.running) {
      console.warn("[IngestionScheduler] Cycle already in progress — skipping overlap.");
      const now = new Date().toISOString();
      return {
        startedAt:                     now,
        finishedAt:                    now,
        durationMs:                    0,
        gamesProcessed:                [],
        fetchedCount:                  0,
        persistedCount:                0,
        duplicateGroupsFound:          0,
        schemaSupportsPersistedDedupe: false,
        errors:                        ["Skipped: previous cycle still running"],
      };
    }

    this.running = true;
    const startedAt = new Date();
    const errors: string[] = [];
    let fetchedCount  = 0;
    let persistedCount = 0;
    let duplicateGroupsFound = 0;

    const games           = options.games?.length ? options.games : [undefined]; // undefined = no filter
    const perPage         = options.perPage  ?? 50;
    const maxPages        = options.maxPages ?? 3;
    const includeUpcoming = options.includeUpcoming ?? true;
    const includeRunning  = options.includeRunning  ?? true;
    const includePast     = options.includePast     ?? false;
    const gamesProcessed: string[] = [];

    try {
      for (const game of games) {
        const gameLabel = game ?? "all";
        try {
          const events = await this.fetchAllPages({
            videogame:       game,
            perPage,
            maxPages,
            includeUpcoming,
            includeRunning,
            includePast,
          });

          fetchedCount += events.length;

          if (events.length > 0) {
            const result = await candidateRepository.upsertManyCandidates(events);
            persistedCount += result.count;
          }

          gamesProcessed.push(gameLabel);
        } catch (err: any) {
          const msg = `[game=${gameLabel}] ${err?.message ?? String(err)}`;
          console.error("[IngestionScheduler] Fetch/persist error:", msg);
          errors.push(msg);
        }
      }

      // Analytic deduplication across everything just ingested
      try {
        const dedupeResult = await candidateDeduplicationService.applyDeduplication({
          limit: 2000,
        });
        duplicateGroupsFound = dedupeResult.groupsFound;
      } catch (err: any) {
        const msg = `dedupe: ${err?.message ?? String(err)}`;
        console.error("[IngestionScheduler] Dedup error:", msg);
        errors.push(msg);
      }
    } finally {
      this.running = false;
    }

    const finishedAt = new Date();
    return {
      startedAt:                     startedAt.toISOString(),
      finishedAt:                    finishedAt.toISOString(),
      durationMs:                    finishedAt.getTime() - startedAt.getTime(),
      gamesProcessed,
      fetchedCount,
      persistedCount,
      duplicateGroupsFound,
      schemaSupportsPersistedDedupe: false,
      errors,
    };
  }

  /**
   * Runs one cycle using environment-derived defaults.
   * Convenience wrapper called by the scheduler.
   */
  runDefaultCycle(): Promise<IngestionCycleResult> {
    const rawGames  = process.env.INGESTION_DEFAULT_GAMES ?? "";
    const games     = rawGames.split(",").map((g) => g.trim()).filter(Boolean);

    return this.runOnce({
      games:           games.length ? games : undefined,
      perPage:         Number(process.env.INGESTION_PER_PAGE)   || 50,
      maxPages:        Number(process.env.INGESTION_MAX_PAGES)  || 3,
      includeUpcoming: (process.env.INGESTION_INCLUDE_UPCOMING ?? "true") !== "false",
      includeRunning:  (process.env.INGESTION_INCLUDE_RUNNING  ?? "true") !== "false",
      includePast:     (process.env.INGESTION_INCLUDE_PAST     ?? "false") === "true",
    });
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  /** Fetches multiple pages for one game, deduplicates in memory, returns all events. */
  private async fetchAllPages(opts: {
    videogame?:       string;
    perPage:          number;
    maxPages:         number;
    includeUpcoming:  boolean;
    includeRunning:   boolean;
    includePast:      boolean;
  }) {
    const seen   = new Set<string>();
    const all    = [];

    for (let page = 1; page <= opts.maxPages; page++) {
      const params: FetchInventoryParams = {
        videogame:       opts.videogame,
        page,
        perPage:         opts.perPage,
        includeUpcoming: opts.includeUpcoming,
        includeRunning:  opts.includeRunning,
        includePast:     opts.includePast,
      };

      const events = await this.pandaScore.fetchInventory(params);
      if (events.length === 0) break; // provider returned empty page — stop early

      for (const e of events) {
        if (!seen.has(e.dedupeKey)) {
          seen.add(e.dedupeKey);
          all.push(e);
        }
      }

      // Stop paging if fewer results than requested — we've hit the last page
      if (events.length < opts.perPage) break;
    }

    return all;
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────
export const ingestionSchedulerService = new IngestionSchedulerService();

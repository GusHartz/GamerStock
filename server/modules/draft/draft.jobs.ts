import {
  computeCurrentDraftWeekMetrics,
  computeDraftWeekMetrics,
  MetricsJobSummary,
} from "./draft.metrics";
import { scoreDraftWeek, scoreCurrentDraftWeek, ScoringJobSummary } from "./draft.scoring";

// ─── Metrics Jobs ─────────────────────────────────────────────────────────────

export async function runDraftWeekMetricsJob(weekId: string): Promise<MetricsJobSummary> {
  console.log(`[DraftMetricsJob] Starting metrics aggregation for week: ${weekId}`);
  try {
    const summary = await computeDraftWeekMetrics(weekId);
    console.log(
      `[DraftMetricsJob] Done | week=${summary.weekId} processed=${summary.processed} eligible=${summary.eligible} skipped=${summary.skipped} duration=${summary.durationMs}ms`,
    );
    return summary;
  } catch (err) {
    console.error(`[DraftMetricsJob] Fatal error for week ${weekId}:`, err);
    throw err;
  }
}

export async function runCurrentDraftWeekMetricsJob(): Promise<MetricsJobSummary> {
  console.log(`[DraftMetricsJob] Starting metrics aggregation for current active week`);
  try {
    const summary = await computeCurrentDraftWeekMetrics();
    console.log(
      `[DraftMetricsJob] Done | week=${summary.weekId} processed=${summary.processed} eligible=${summary.eligible} skipped=${summary.skipped} duration=${summary.durationMs}ms`,
    );
    return summary;
  } catch (err) {
    console.error(`[DraftMetricsJob] Fatal error for current week:`, err);
    throw err;
  }
}

// ─── Scoring Jobs ─────────────────────────────────────────────────────────────

export async function runDraftScoringJob(weekId: string): Promise<ScoringJobSummary> {
  console.log(`[DraftScoringJob] Starting scoring for week: ${weekId}`);
  try {
    const summary = await scoreDraftWeek(weekId);
    console.log(
      `[DraftScoringJob] Done | week=${summary.weekId} entries=${summary.entriesProcessed} skipped=${summary.entriesSkipped} picks=${summary.picksScored} duration=${summary.durationMs}ms`,
    );
    return summary;
  } catch (err) {
    console.error(`[DraftScoringJob] Fatal error for week ${weekId}:`, err);
    throw err;
  }
}

export async function runCurrentDraftScoringJob(): Promise<ScoringJobSummary> {
  console.log(`[DraftScoringJob] Starting scoring for current active week`);
  try {
    const summary = await scoreCurrentDraftWeek();
    console.log(
      `[DraftScoringJob] Done | week=${summary.weekId} entries=${summary.entriesProcessed} skipped=${summary.entriesSkipped} picks=${summary.picksScored} duration=${summary.durationMs}ms`,
    );
    return summary;
  } catch (err) {
    console.error(`[DraftScoringJob] Fatal error for current week:`, err);
    throw err;
  }
}

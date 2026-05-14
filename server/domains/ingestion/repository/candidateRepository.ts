// ─── Ingestion Candidate Repository ───────────────────────────────────────────
// Responsibility: persist and read NormalizedCandidateEvent rows in
// prediction_event_candidates. No adapter logic, no review logic.
//
// Upsert strategy:
//   Conflict target → unique index uq_candidate_source_event (source, source_event_id)
//   On conflict     → update mutable fields only (status, scheduling, teams, payloads)
//                     editorial fields (reviewStatus, visibilityState, etc.) are
//                     NEVER overwritten after first insert — those belong to editors.
//
// Read methods (Sprint 3):
//   findCandidateById   → single row by PK
//   listCandidates      → filtered + paginated list with total count
//   updateCandidateReviewStatus → sets reviewStatus + audit fields
// ─────────────────────────────────────────────────────────────────────────────

import { sql, and, asc, eq, ilike, inArray, or } from "drizzle-orm";
import { db } from "../../../db";
import {
  predictionEventCandidates,
  type PredictionEventCandidate,
  type IngestionReviewStatus,
} from "../../../../shared/schema/ingestion";
import type { NormalizedCandidateEvent } from "../types/normalized-candidate-event";
import type { CandidateReviewStatus } from "../types/ingestion.types";

// ── List filters ──────────────────────────────────────────────────────────────

export interface ListCandidateFilters {
  reviewStatus?:     string;
  gameCode?:         string;
  source?:           string;
  normalizedStatus?: string;
  /** Case-insensitive substring match on matchTitle */
  search?:           string;
  limit?:            number;
  offset?:           number;
}

export interface ListCandidateResult {
  rows:  PredictionEventCandidate[];
  total: number;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function toRow(event: NormalizedCandidateEvent) {
  return {
    source:             event.source,
    sourceEventId:      event.sourceEventId  ?? "",
    sourceSeriesId:     event.sourceSeriesId ?? null,
    sourceLeagueId:     event.sourceLeagueId ?? null,
    sourceTournamentId: event.sourceTournamentId ?? null,

    gameCode:           event.gameCode,
    leagueName:         event.leagueName     ?? null,
    tournamentName:     event.tournamentName ?? null,
    matchTitle:         event.matchTitle,

    teamAName:          event.teamAName         ?? null,
    teamBName:          event.teamBName         ?? null,
    teamAExternalRef:   event.teamAExternalRef  ?? null,
    teamBExternalRef:   event.teamBExternalRef  ?? null,

    scheduledStartAt:   event.scheduledStartAt
                          ? new Date(event.scheduledStartAt)
                          : null,
    normalizedStatus:   event.normalizedStatus,

    winnerSide:         event.winnerSide        ?? null,
    winnerExternalRef:  event.winnerExternalRef ?? null,

    dedupeKey:          event.dedupeKey,

    confidenceScore:    event.confidenceScore != null
                          ? String(event.confidenceScore)
                          : null,

    rawPayload:         event.rawPayload  as Record<string, unknown>,
    normalizedPayload:  event.normalizedPayload ?? null,

    reviewStatus:       "pending_review" as const,
    visibilityState:    "hidden"         as const,
  };
}

function toUpdateSet(event: NormalizedCandidateEvent) {
  return {
    sourceSeriesId:     event.sourceSeriesId    ?? null,
    sourceLeagueId:     event.sourceLeagueId    ?? null,
    sourceTournamentId: event.sourceTournamentId ?? null,
    leagueName:         event.leagueName        ?? null,
    tournamentName:     event.tournamentName    ?? null,
    matchTitle:         event.matchTitle,
    teamAName:          event.teamAName         ?? null,
    teamBName:          event.teamBName         ?? null,
    teamAExternalRef:   event.teamAExternalRef  ?? null,
    teamBExternalRef:   event.teamBExternalRef  ?? null,
    scheduledStartAt:   event.scheduledStartAt
                          ? new Date(event.scheduledStartAt)
                          : null,
    normalizedStatus:   event.normalizedStatus,
    winnerSide:         event.winnerSide        ?? null,
    winnerExternalRef:  event.winnerExternalRef ?? null,
    confidenceScore:    event.confidenceScore != null
                          ? String(event.confidenceScore)
                          : null,
    rawPayload:         event.rawPayload as Record<string, unknown>,
    normalizedPayload:  event.normalizedPayload ?? null,
    updatedAt:          sql`now()`,
  };
}

// ── Repository ────────────────────────────────────────────────────────────────

export class CandidateRepository {

  // ── Write ───────────────────────────────────────────────────────────────────

  async upsertCandidate(
    event: NormalizedCandidateEvent
  ): Promise<PredictionEventCandidate> {
    const [row] = await db
      .insert(predictionEventCandidates)
      .values(toRow(event))
      .onConflictDoUpdate({
        target: [
          predictionEventCandidates.source,
          predictionEventCandidates.sourceEventId,
        ],
        set: toUpdateSet(event),
      })
      .returning();

    return row;
  }

  async upsertManyCandidates(
    events: NormalizedCandidateEvent[]
  ): Promise<{ count: number; ids: number[] }> {
    if (events.length === 0) return { count: 0, ids: [] };

    const rows = await db
      .insert(predictionEventCandidates)
      .values(events.map(toRow))
      .onConflictDoUpdate({
        target: [
          predictionEventCandidates.source,
          predictionEventCandidates.sourceEventId,
        ],
        set: {
          sourceSeriesId:     sql`excluded.source_series_id`,
          sourceLeagueId:     sql`excluded.source_league_id`,
          sourceTournamentId: sql`excluded.source_tournament_id`,
          leagueName:         sql`excluded.league_name`,
          tournamentName:     sql`excluded.tournament_name`,
          matchTitle:         sql`excluded.match_title`,
          teamAName:          sql`excluded.team_a_name`,
          teamBName:          sql`excluded.team_b_name`,
          teamAExternalRef:   sql`excluded.team_a_external_ref`,
          teamBExternalRef:   sql`excluded.team_b_external_ref`,
          scheduledStartAt:   sql`excluded.scheduled_start_at`,
          normalizedStatus:   sql`excluded.normalized_status`,
          winnerSide:         sql`excluded.winner_side`,
          winnerExternalRef:  sql`excluded.winner_external_ref`,
          confidenceScore:    sql`excluded.confidence_score`,
          rawPayload:         sql`excluded.raw_payload`,
          normalizedPayload:  sql`excluded.normalized_payload`,
          updatedAt:          sql`now()`,
        },
      })
      .returning({ id: predictionEventCandidates.id });

    return { count: rows.length, ids: rows.map((r) => r.id) };
  }

  // ── Read — deduplication analysis ─────────────────────────────────────────

  /**
   * Loads persisted candidates ordered by id asc for deduplication analysis.
   * Optionally filtered by gameCode. Caps at 1000 rows by default.
   */
  async findCandidatesForAnalysis(filters: {
    gameCode?: string;
    limit?: number;
  } = {}): Promise<PredictionEventCandidate[]> {
    if (filters.gameCode) {
      return db
        .select()
        .from(predictionEventCandidates)
        .where(eq(predictionEventCandidates.gameCode, filters.gameCode))
        .orderBy(asc(predictionEventCandidates.id))
        .limit(filters.limit ?? 1000);
    }

    return db
      .select()
      .from(predictionEventCandidates)
      .orderBy(asc(predictionEventCandidates.id))
      .limit(filters.limit ?? 1000);
  }

  // ── Read — admin review ────────────────────────────────────────────────────

  /** Returns a single candidate by primary key, or undefined if not found. */
  async findCandidateById(id: number): Promise<PredictionEventCandidate | undefined> {
    const [row] = await db
      .select()
      .from(predictionEventCandidates)
      .where(eq(predictionEventCandidates.id, id))
      .limit(1);

    return row;
  }

  /**
   * Returns candidates by a list of explicit IDs. Used by bulk operations.
   * Preserves the same id ASC ordering as listCandidates.
   * Caps at 500 rows (same as the BULK_LIMIT in candidateBulkService).
   */
  async findCandidatesByIds(ids: number[]): Promise<PredictionEventCandidate[]> {
    if (ids.length === 0) return [];
    return db
      .select()
      .from(predictionEventCandidates)
      .where(inArray(predictionEventCandidates.id, ids))
      .orderBy(asc(predictionEventCandidates.id))
      .limit(500);
  }

  /**
   * Paginated list with optional filters.
   * Sorted by scheduledStartAt ASC NULLS LAST, then id ASC (upcoming first).
   * Returns the filtered rows plus the total count (for pagination metadata).
   */
  async listCandidates(filters: ListCandidateFilters = {}): Promise<ListCandidateResult> {
    const limit  = Math.min(filters.limit  ?? 50, 200);
    const offset = filters.offset ?? 0;

    // Build where conditions dynamically
    const conditions = [];

    if (filters.reviewStatus) {
      conditions.push(eq(predictionEventCandidates.reviewStatus, filters.reviewStatus));
    }
    if (filters.gameCode) {
      conditions.push(eq(predictionEventCandidates.gameCode, filters.gameCode));
    }
    if (filters.source) {
      conditions.push(eq(predictionEventCandidates.source, filters.source));
    }
    if (filters.normalizedStatus) {
      conditions.push(eq(predictionEventCandidates.normalizedStatus, filters.normalizedStatus));
    }
    if (filters.search) {
      conditions.push(ilike(predictionEventCandidates.matchTitle, `%${filters.search}%`));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, countResult] = await Promise.all([
      db
        .select()
        .from(predictionEventCandidates)
        .where(where)
        .orderBy(sql`scheduled_start_at ASC NULLS LAST, id ASC`)
        .limit(limit)
        .offset(offset),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(predictionEventCandidates)
        .where(where),
    ]);

    return { rows, total: countResult[0]?.total ?? 0 };
  }

  // ── Write — review status ──────────────────────────────────────────────────

  /**
   * Updates reviewStatus and the audit trail fields.
   * Caller (CandidateReviewService) is responsible for validating the transition.
   */
  async updateCandidateReviewStatus(
    id:         number,
    nextStatus: CandidateReviewStatus,
    meta: {
      reviewedBy?:  string;
      reviewNotes?: string;
    } = {}
  ): Promise<PredictionEventCandidate> {
    const setPayload: Record<string, unknown> = {
      reviewStatus: nextStatus,
      reviewedAt:   sql`now()`,
      updatedAt:    sql`now()`,
    };

    if (meta.reviewedBy  !== undefined) setPayload.reviewedBy  = meta.reviewedBy;
    if (meta.reviewNotes !== undefined) setPayload.reviewNotes = meta.reviewNotes;

    const [row] = await db
      .update(predictionEventCandidates)
      .set(setPayload as any)
      .where(eq(predictionEventCandidates.id, id))
      .returning();

    return row;
  }
}

// ── Singleton export ──────────────────────────────────────────────────────────
export const candidateRepository = new CandidateRepository();

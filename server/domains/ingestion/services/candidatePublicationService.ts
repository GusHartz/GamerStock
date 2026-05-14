// ─── Candidate Publication Service ────────────────────────────────────────────
// Responsibility: publish an approved candidate as a real prediction_event,
// then auto-create a default MATCH_WINNER prediction market in DRAFT.
//
// Steps:
//   Transaction:
//     1. Validate candidate exists and is eligible (reviewStatus === "approved")
//     2. Guard against duplicate publication (check predictionEventPublications)
//     3. INSERT prediction_event (mapped from candidate fields)
//     4. INSERT prediction_event_publications (audit record)
//     5. UPDATE candidate reviewStatus → "published"
//   Post-transaction (best-effort):
//     6. Auto-create a binary MATCH_WINNER market in DRAFT with 2 outcomes
//        (idempotent — skips if one already exists for the event)
//
// Nothing outside the ingestion domain is mutated except:
//   - prediction_events   (created)
//   - prediction_event_publications (created)
//   - prediction_event_candidates.reviewStatus (updated to "published")
//   - prediction_markets  (auto-created in DRAFT — best-effort, never rolls back event)
//   - prediction_outcomes (auto-created — best-effort)
//   - prediction_market_stats (auto-created — best-effort)
// ─────────────────────────────────────────────────────────────────────────────

import { eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../../../db";
import { predictionEvents }           from "../../../../shared/schema/prediction";
import {
  predictionEventCandidates,
  predictionEventPublications,
  type PredictionEventCandidate,
  type PredictionEventPublication,
} from "../../../../shared/schema/ingestion";
import { candidateRepository }        from "../repository/candidateRepository";
import type { PredictionEvent }       from "../../../../shared/schema/prediction";
import { predictionRepository }       from "../../prediction/repository";
import { predictionService }          from "../../prediction/service";
import { isPredictEnabledServer }     from "../../../lib/featureFlags";

// ── Errors ────────────────────────────────────────────────────────────────────

export class CandidateNotFoundError extends Error {
  readonly statusCode = 404;
  constructor(id: number) {
    super(`Candidate #${id} not found`);
    this.name = "CandidateNotFoundError";
  }
}

export class PublicationNotEligibleError extends Error {
  readonly statusCode = 409;
  constructor(id: number, status: string) {
    super(
      `Candidate #${id} cannot be published — current reviewStatus is "${status}". ` +
      `Only "approved" candidates may be published.`
    );
    this.name = "PublicationNotEligibleError";
  }
}

export class AlreadyPublishedError extends Error {
  readonly statusCode = 409;
  constructor(id: number) {
    super(`Candidate #${id} has already been published.`);
    this.name = "AlreadyPublishedError";
  }
}

// ── Result ────────────────────────────────────────────────────────────────────

export interface PublishCandidateResult {
  predictionEvent:       PredictionEvent;
  publication:           PredictionEventPublication;
  updatedCandidate:      PredictionEventCandidate;
}

// ── Field mapping: candidate → prediction_event ───────────────────────────────
//
// candidate field              → prediction_event field
// ------------------------------------------------------------------
// matchTitle                   → title  (required; falls back to team pair)
// matchTitle                   → eventName
// tournamentName ?? leagueName → tournamentName
// gameCode (normalized below)  → game
// teamAName                    → teamAName
// teamBName                    → teamBName
// scheduledStartAt             → startsAt
// source + sourceEventId       → externalRef  ("PANDASCORE:12345")
// source metadata              → metadata (jsonb)
// ── Game code normalisation ──────────────────────────────────────
// prediction_events uses short codes already in use by the domain:
//   "lol"    "dota2"    "cs2"    "valorant"
// candidates may have "cs-go" from PandaScore — remap it.

const GAME_CODE_MAP: Record<string, string> = {
  "cs-go":    "cs2",
  "dota-2":   "dota2",
  "lol":      "lol",
  "valorant": "valorant",
  "rl":       "rl",
  "r6-siege": "r6",
  "overwatch":"overwatch",
  "pubg":     "pubg",
};

function normaliseGameCode(raw: string | null): string {
  if (!raw) return "other";
  return GAME_CODE_MAP[raw.toLowerCase()] ?? raw.toLowerCase();
}

function candidateToEventValues(c: PredictionEventCandidate) {
  const fallbackTitle =
    c.teamAName && c.teamBName
      ? `${c.teamAName} vs ${c.teamBName}`
      : c.matchTitle ?? "TBD";

  const metadata: Record<string, unknown> = {
    source:            c.source,
    sourceEventId:     c.sourceEventId,
    sourceSeriesId:    c.sourceSeriesId   ?? null,
    sourceLeagueId:    c.sourceLeagueId   ?? null,
    sourceTournamentId:c.sourceTournamentId ?? null,
    leagueName:        c.leagueName       ?? null,
    dedupeKey:         c.dedupeKey,
    normalizedStatus:  c.normalizedStatus ?? null,
    confidenceScore:   c.confidenceScore  ?? null,
    candidateId:       c.id,
    teamAExternalRef:  c.teamAExternalRef  ?? null,
    teamBExternalRef:  c.teamBExternalRef  ?? null,
    winnerExternalRef: c.winnerExternalRef ?? null,
  };

  return {
    uid:            `evt_${nanoid(12)}`,
    title:          c.matchTitle ?? fallbackTitle,
    eventName:      c.matchTitle ?? fallbackTitle,
    tournamentName: c.tournamentName ?? c.leagueName ?? null,
    game:           normaliseGameCode(c.gameCode),
    eventType:      "match" as const,
    teamAName:      c.teamAName ?? null,
    teamBName:      c.teamBName ?? null,
    startsAt:       c.scheduledStartAt ?? null,
    externalRef:    c.source && c.sourceEventId
                      ? `${c.source}:${c.sourceEventId}`
                      : null,
    metadata,
    status:         "scheduled" as const,
  };
}

// ── Service ───────────────────────────────────────────────────────────────────

export class CandidatePublicationService {

  /**
   * Publishes an approved candidate as a prediction_event.
   * Runs inside a single DB transaction — rolls back on any failure.
   */
  async publishCandidate(
    id:   number,
    meta: { publishedBy?: string; notes?: string } = {}
  ): Promise<PublishCandidateResult> {

    // ── Pre-transaction validation (fast fail) ──────────────────────────────
    const candidate = await candidateRepository.findCandidateById(id);
    if (!candidate) throw new CandidateNotFoundError(id);

    if (candidate.reviewStatus === "published") throw new AlreadyPublishedError(id);

    if (candidate.reviewStatus !== "approved") {
      throw new PublicationNotEligibleError(id, candidate.reviewStatus);
    }

    // ── Transaction ─────────────────────────────────────────────────────────
    const result = await db.transaction(async (tx) => {

      // 1. Idempotency guard — check for existing publication record
      const [existingPub] = await tx
        .select({ id: predictionEventPublications.id })
        .from(predictionEventPublications)
        .where(eq(predictionEventPublications.candidateEventId, candidate.id))
        .limit(1);

      if (existingPub) throw new AlreadyPublishedError(id);

      // 2. Create prediction_event
      const [event] = await tx
        .insert(predictionEvents)
        .values(candidateToEventValues(candidate))
        .returning();

      // 3. Create publication audit record
      const [publication] = await tx
        .insert(predictionEventPublications)
        .values({
          candidateEventId:  candidate.id,
          predictionEventId: event.id,
          publishedBy:       meta.publishedBy ?? null,
          publicationMode:   "manual",
          notes:             meta.notes       ?? null,
        })
        .returning();

      // 4. Update candidate to "published"
      const [updatedCandidate] = await tx
        .update(predictionEventCandidates)
        .set({
          reviewStatus: "published",
          reviewedAt:   sql`now()`,
          updatedAt:    sql`now()`,
        })
        .where(eq(predictionEventCandidates.id, candidate.id))
        .returning();

      return { predictionEvent: event, publication, updatedCandidate };
    });

    // ── Post-transaction: auto-create default MATCH_WINNER market (best-effort) ──
    // Gate: skip if Predict feature is disabled — the event is published but no
    // market is created. Markets can be created manually when Predict is re-enabled.
    if (isPredictEnabledServer()) {
      await this.autoCreateDefaultMarket(result.predictionEvent, meta.publishedBy, {
        teamAExternalRef: candidate.teamAExternalRef ?? null,
        teamBExternalRef: candidate.teamBExternalRef ?? null,
      });
    } else {
      console.log(
        `[Publication] Predict disabled — skipping auto-create market for event #${result.predictionEvent.id}`
      );
    }

    return result;
  }

  private async autoCreateDefaultMarket(
    event: PredictionEvent,
    publishedBy?: string,
    externalRefs?: { teamAExternalRef: string | null; teamBExternalRef: string | null },
  ): Promise<void> {
    try {
      const existing = await predictionRepository.findFirstMarketByEventAndType(
        event.id,
        "binary",
      );
      if (existing) {
        console.log(
          `[Publication] Skipping market auto-create for event #${event.id} — binary market already exists (market #${existing.id})`
        );
        return;
      }

      const teamA = event.teamAName?.trim() || null;
      const teamB = event.teamBName?.trim() || null;
      const bothTeamsPresent = !!(teamA && teamB);
      const question = bothTeamsPresent
        ? `${teamA} vs ${teamB} — Who wins?`
        : `${event.title} — What's the outcome?`;

      const marketResult = await predictionService.createMarket({
        eventId:         event.id,
        question,
        description:     `Auto-generated MATCH_WINNER market for "${event.title}"`,
        marketType:      "binary",
        currency:        "GS",
        minStake:        "1.000000",
        resolutionSource: "admin",
        createdByUserId: publishedBy ?? "system",
        outcomes: bothTeamsPresent
          ? [
              {
                label: teamA!, code: "TEAM_A", sortOrder: 0, impliedProbability: "0.5",
                metadata: { side: "A", externalOpponentId: externalRefs?.teamAExternalRef ?? null },
              },
              {
                label: teamB!, code: "TEAM_B", sortOrder: 1, impliedProbability: "0.5",
                metadata: { side: "B", externalOpponentId: externalRefs?.teamBExternalRef ?? null },
              },
            ]
          : [
              {
                label: "YES", code: "yes", sortOrder: 0, impliedProbability: "0.5",
                metadata: { side: "A", externalOpponentId: externalRefs?.teamAExternalRef ?? null },
              },
              {
                label: "NO",  code: "no",  sortOrder: 1, impliedProbability: "0.5",
                metadata: { side: "B", externalOpponentId: externalRefs?.teamBExternalRef ?? null },
              },
            ],
      });

      if (marketResult.success) {
        console.log(
          `[Publication] Auto-created DRAFT market #${marketResult.data!.marketId} ` +
          `(slug="${marketResult.data!.slug}") for event #${event.id} "${event.title}"`
        );
      } else {
        console.warn(
          `[Publication] Failed to auto-create market for event #${event.id}: ${marketResult.error}`
        );
      }
    } catch (err: any) {
      console.error(
        `[Publication] Auto-create market error for event #${event.id}:`,
        err.message
      );
    }
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────
export const candidatePublicationService = new CandidatePublicationService();

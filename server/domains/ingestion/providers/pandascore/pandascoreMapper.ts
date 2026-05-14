// ─── PandaScore → NormalizedCandidateEvent Mapper ─────────────────────────────
// Responsibility: convert raw PandaScoreMatch payloads into the internal
// NormalizedCandidateEvent contract. No HTTP, no DB, no side-effects.
// ─────────────────────────────────────────────────────────────────────────────

import type { NormalizedCandidateEvent } from "../../types/normalized-candidate-event";
import type { NormalizedMatchStatus, WinnerSide } from "../../types/ingestion.types";
import type { PandaScoreMatch, PandaScoreOpponent } from "./pandascoreClient";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Maps a PandaScore videogame slug to our canonical game code. */
function mapGameCode(slug: string | undefined | null): string {
  if (!slug) return "unknown";
  switch (slug.toLowerCase()) {
    case "cs-go":
    case "counter-strike-2": return "cs2";
    case "league-of-legends": return "lol";
    case "valorant":          return "valorant";
    case "dota-2":            return "dota2";
    case "rainbow-6":         return "rainbow6";
    default:
      // sanitise unknown slugs: lowercase, replace spaces with hyphens
      return slug.toLowerCase().replace(/\s+/g, "-");
  }
}

/** Maps a PandaScore match status string to our NormalizedMatchStatus. */
function mapMatchStatus(
  status: string | undefined | null,
  rescheduled: boolean
): NormalizedMatchStatus {
  switch ((status ?? "").toLowerCase()) {
    case "not_started":
    case "upcoming":
    case "scheduled":  return "scheduled";
    case "running":
    case "live":       return "live";
    case "finished":   return "finished";
    case "canceled":
    case "cancelled":  return "cancelled";
    case "postponed":  return "postponed";
    default:
      // If the match was rescheduled and we cannot read the status, treat as scheduled.
      return rescheduled ? "scheduled" : "scheduled";
  }
}

/** Determines which side won by comparing winner.id against each team's id. */
function mapWinnerSide(
  match: PandaScoreMatch,
  teamAId: number | null,
  teamBId: number | null
): WinnerSide {
  const winnerId = match.winner?.id ?? null;
  if (winnerId === null) return null;
  if (teamAId !== null && winnerId === teamAId) return "A";
  if (teamBId !== null && winnerId === teamBId) return "B";
  return null;
}

/** Builds the globally unique deduplication key for a candidate. */
function buildDedupeKey(gameCode: string, sourceEventId: string): string {
  return `PANDASCORE:${gameCode}:${sourceEventId}`;
}

/** Extracts the first two Team opponents from the opponents array. */
function extractTeams(opponents: PandaScoreOpponent[]): {
  teamAName: string | null;
  teamBName: string | null;
  teamAId:   number | null;
  teamBId:   number | null;
} {
  const teams = opponents.filter((o) => o.type === "Team");
  const a = teams[0]?.opponent ?? null;
  const b = teams[1]?.opponent ?? null;
  return {
    teamAName: a?.name ?? null,
    teamBName: b?.name ?? null,
    teamAId:   a?.id   ?? null,
    teamBId:   b?.id   ?? null,
  };
}

// ── Main mapper ───────────────────────────────────────────────────────────────

/**
 * Converts a raw PandaScoreMatch into a NormalizedCandidateEvent.
 * Returns null if the match lacks a stable id (cannot be deduplicated).
 */
export function mapPandaScoreMatchToNormalizedCandidateEvent(
  match: PandaScoreMatch
): NormalizedCandidateEvent | null {
  // Guard: without an id we cannot deduplicate or identify the record.
  if (!match.id) return null;

  const sourceEventId = String(match.id);
  const gameCode      = mapGameCode(match.videogame?.slug);
  const { teamAName, teamBName, teamAId, teamBId } = extractTeams(match.opponents ?? []);

  // Derive a human-readable title, falling back to "TeamA vs TeamB" when needed.
  const matchTitle =
    match.name?.trim() ||
    [teamAName, teamBName].filter(Boolean).join(" vs ") ||
    `PandaScore match ${sourceEventId}`;

  return {
    source:              "PANDASCORE",
    sourceEventId,
    sourceSeriesId:      match.serie?.id       ? String(match.serie.id)       : null,
    sourceLeagueId:      match.league?.id      ? String(match.league.id)      : null,
    sourceTournamentId:  match.tournament?.id  ? String(match.tournament.id)  : null,

    gameCode,
    leagueName:     match.league?.name     ?? null,
    tournamentName: match.tournament?.name ?? null,
    matchTitle,

    teamAName,
    teamBName,
    teamAExternalRef: teamAId !== null ? String(teamAId) : null,
    teamBExternalRef: teamBId !== null ? String(teamBId) : null,

    // Prefer begin_at (actual start) over scheduled_at (original plan).
    scheduledStartAt: match.begin_at ?? match.scheduled_at ?? null,

    normalizedStatus: mapMatchStatus(match.status, match.rescheduled ?? false),

    winnerSide:        mapWinnerSide(match, teamAId, teamBId),
    winnerExternalRef: match.winner?.id != null ? String(match.winner.id) : null,

    confidenceScore: null,   // PandaScore does not provide a confidence signal

    rawPayload:        match,
    normalizedPayload: null, // populated by a later enrichment step if needed

    dedupeKey: buildDedupeKey(gameCode, sourceEventId),
  };
}

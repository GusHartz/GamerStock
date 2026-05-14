// ─── Ingestion Domain — Normalised Candidate Event ────────────────────────────
// Sprint 1 · Etapa 3: canonical internal contract for any ingested match event.
//
// Every external provider adapter (PandaScore, Liquipedia, Manual, …) must
// produce a value that satisfies this type before it can be persisted as a
// prediction_event_candidate row.
//
// Design decisions:
//   - Uses canonical types from ingestion.types.ts (Etapa 2) — no local redefinition.
//   - Fields mirror the prediction_event_candidates schema columns one-for-one.
//   - Optional fields are nullable so adapters can omit unknown data explicitly.
//   - No runtime logic, no Zod schema, no class — types only.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  IngestionSource,
  NormalizedMatchStatus,
  WinnerSide,
} from "./ingestion.types";

// ─── Core contract ────────────────────────────────────────────────────────────

export type NormalizedCandidateEvent = {
  // ── Source identity ──────────────────────────────────────────────────────
  source:               IngestionSource;
  sourceEventId?:       string | null;
  sourceSeriesId?:      string | null;
  sourceLeagueId?:      string | null;
  sourceTournamentId?:  string | null;

  // ── Game / league context ─────────────────────────────────────────────────
  /** Short game identifier, e.g. "lol", "cs2", "valorant". Must be explicit. */
  gameCode:             string;
  leagueName?:          string | null;
  tournamentName?:      string | null;
  matchTitle:           string;

  // ── Teams ─────────────────────────────────────────────────────────────────
  teamAName?:           string | null;
  teamBName?:           string | null;
  teamAExternalRef?:    string | null;   // provider-side team identifier
  teamBExternalRef?:    string | null;

  // ── Timing & match lifecycle ──────────────────────────────────────────────
  scheduledStartAt?:    string | Date | null;
  /** Match lifecycle status — not a review status. Must be explicitly provided. */
  normalizedStatus:     NormalizedMatchStatus;

  // ── Result ────────────────────────────────────────────────────────────────
  winnerSide?:          WinnerSide;
  winnerExternalRef?:   string | null;

  // ── Quality signal ────────────────────────────────────────────────────────
  /** Provider-assigned confidence [0, 1]. Null if not applicable. */
  confidenceScore?:     number | null;

  // ── Payloads ──────────────────────────────────────────────────────────────
  /** The raw provider payload, stored as-is for auditing / replay. */
  rawPayload:           unknown;
  /** Optional pre-processed structured payload produced by the adapter. */
  normalizedPayload?:   Record<string, unknown> | null;

  // ── Deduplication ─────────────────────────────────────────────────────────
  /** Globally unique key used to prevent double-ingestion. Format: `source:game:externalId`. */
  dedupeKey:            string;
};

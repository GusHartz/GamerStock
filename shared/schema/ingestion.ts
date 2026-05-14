// ─── Ingestion Domain — Drizzle Schema ────────────────────────────────────────
// Sprint 1 · Etapa 1: base tables for esports event ingestion pipeline.
//
// Design decisions:
//   - serial IDs throughout (matches existing domain convention)
//   - No pg enums — use varchar string literals (matches prediction.ts convention)
//   - predictionEventId is integer (matches prediction_events.id which is serial)
//     but stored WITHOUT a foreign key constraint to keep the domain boundary clean
//   - candidateEventId FK to prediction_event_candidates IS safe (same domain)
//   - Audit timestamps: createdAt/updatedAt follow market.ts/.defaultNow() pattern
// ─────────────────────────────────────────────────────────────────────────────

import {
  pgTable,
  serial,
  varchar,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ─── String literal types ─────────────────────────────────────────────────────
// Aligned with canonical contracts in server/domains/ingestion/types/ingestion.types.ts
// Kept here as local aliases so Drizzle column typings remain self-contained.

export type IngestionReviewStatus =
  | "pending_review"
  | "approved"
  | "rejected"
  | "published"
  | "archived"
  | "needs_edit";             // was incorrectly "needs_review"

export type IngestionVisibilityState =
  | "hidden"
  | "listed"                  // was "visible"
  | "featured";               // was "published"

// Match lifecycle statuses — NOT review statuses
export type IngestionNormalizedStatus =
  | "scheduled"
  | "live"
  | "finished"
  | "cancelled"
  | "postponed";

export type IngestionPublicationMode =
  | "manual"
  | "auto";

// ─── prediction_event_candidates ─────────────────────────────────────────────
// Raw events fetched from external sources (PandaScore, Liquipedia, etc.)
// before they are reviewed and published as prediction_events.

export const predictionEventCandidates = pgTable(
  "prediction_event_candidates",
  {
    id:                   serial("id").primaryKey(),

    // Source identity
    source:               varchar("source", { length: 50 }).notNull(),
    sourceEventId:        varchar("source_event_id", { length: 255 }).notNull(),
    sourceSeriesId:       varchar("source_series_id", { length: 255 }),
    sourceLeagueId:       varchar("source_league_id", { length: 255 }),
    sourceTournamentId:   varchar("source_tournament_id", { length: 255 }),

    // Game / league context — must be explicitly provided on insert (no default)
    gameCode:             varchar("game_code", { length: 50 }).notNull(),
    leagueName:           varchar("league_name", { length: 255 }),
    tournamentName:       varchar("tournament_name", { length: 255 }),
    matchTitle:           varchar("match_title", { length: 500 }),

    // Teams
    teamAName:            varchar("team_a_name", { length: 150 }),
    teamBName:            varchar("team_b_name", { length: 150 }),
    teamAExternalRef:     varchar("team_a_external_ref", { length: 255 }),
    teamBExternalRef:     varchar("team_b_external_ref", { length: 255 }),

    // Timing & status
    scheduledStartAt:     timestamp("scheduled_start_at"),
    originalStatus:       varchar("original_status", { length: 100 }),
    // Match lifecycle — explicitly required on insert; no system default
    normalizedStatus:     varchar("normalized_status", { length: 50 }),

    // Result
    winnerSide:           varchar("winner_side", { length: 10 }),          // "teamA" | "teamB" | "draw"
    winnerExternalRef:    varchar("winner_external_ref", { length: 255 }),

    // Deduplication
    dedupeKey:            varchar("dedupe_key", { length: 512 }).notNull().unique(),

    // Quality signal
    confidenceScore:      numeric("confidence_score", { precision: 5, scale: 4 }),

    // Editorial workflow
    reviewStatus:         varchar("review_status", { length: 50 }).notNull().default("pending_review"),
    visibilityState:      varchar("visibility_state", { length: 50 }).notNull().default("hidden"),
    publishAt:            timestamp("publish_at"),
    reviewedBy:           varchar("reviewed_by", { length: 64 }),           // soft ref to users.id
    reviewedAt:           timestamp("reviewed_at"),
    reviewNotes:          text("review_notes"),

    // Raw & normalized payloads
    rawPayload:           jsonb("raw_payload"),
    normalizedPayload:    jsonb("normalized_payload"),

    // Audit
    createdAt:            timestamp("created_at").defaultNow().notNull(),
    updatedAt:            timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("uq_candidate_source_event").on(t.source, t.sourceEventId),
    index("idx_candidate_dedupe_key").on(t.dedupeKey),
    index("idx_candidate_review_status").on(t.reviewStatus),
    index("idx_candidate_game_code").on(t.gameCode),
    index("idx_candidate_scheduled_start").on(t.scheduledStartAt),
  ],
);

export type PredictionEventCandidate       = typeof predictionEventCandidates.$inferSelect;
export type NewPredictionEventCandidate    = typeof predictionEventCandidates.$inferInsert;
export const insertPredictionEventCandidateSchema = createInsertSchema(predictionEventCandidates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// ─── prediction_event_publications ────────────────────────────────────────────
// Audit log of when a candidate was published as a real prediction_event.
// predictionEventId is an integer soft-reference to prediction_events.id
// (no FK constraint to preserve domain isolation).

export const predictionEventPublications = pgTable(
  "prediction_event_publications",
  {
    id:                serial("id").primaryKey(),
    candidateEventId:  integer("candidate_event_id").notNull()
                         .references(() => predictionEventCandidates.id),
    predictionEventId: integer("prediction_event_id"),               // soft ref — no FK
    publishedBy:       varchar("published_by", { length: 64 }),      // soft ref to users.id
    publishedAt:       timestamp("published_at").defaultNow().notNull(),
    publicationMode:   varchar("publication_mode", { length: 50 }).notNull().default("manual"),
    notes:             text("notes"),
    createdAt:         timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("idx_pub_candidate_event_id").on(t.candidateEventId),
    index("idx_pub_prediction_event_id").on(t.predictionEventId),
  ],
);

export type PredictionEventPublication    = typeof predictionEventPublications.$inferSelect;
export type NewPredictionEventPublication = typeof predictionEventPublications.$inferInsert;
export const insertPredictionEventPublicationSchema = createInsertSchema(predictionEventPublications).omit({
  id: true,
  createdAt: true,
});

// ─── prediction_display_queue ─────────────────────────────────────────────────
// Curated display slots for surfaces (home hero, sidebar, etc.).
// entityType + entityId are soft references — no FK, flexible across domains.

export const predictionDisplayQueue = pgTable(
  "prediction_display_queue",
  {
    id:             serial("id").primaryKey(),
    entityType:     varchar("entity_type", { length: 50 }).notNull(),   // "market" | "event" | "player"
    entityId:       integer("entity_id").notNull(),
    surface:        varchar("surface", { length: 100 }).notNull(),       // "home_hero" | "sidebar" | …
    position:       integer("position").notNull(),
    startsAt:       timestamp("starts_at"),
    endsAt:         timestamp("ends_at"),
    isActive:       boolean("is_active").notNull().default(true),
    curationLabel:  varchar("curation_label", { length: 255 }),
    createdBy:      varchar("created_by", { length: 64 }),
    updatedBy:      varchar("updated_by", { length: 64 }),
    createdAt:      timestamp("created_at").defaultNow().notNull(),
    updatedAt:      timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("uq_display_queue_surface_position").on(t.surface, t.position),
    index("idx_display_queue_entity").on(t.entityType, t.entityId),
    index("idx_display_queue_is_active").on(t.isActive),
  ],
);

export type PredictionDisplayQueueItem    = typeof predictionDisplayQueue.$inferSelect;
export type NewPredictionDisplayQueueItem = typeof predictionDisplayQueue.$inferInsert;
export const insertPredictionDisplayQueueSchema = createInsertSchema(predictionDisplayQueue).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

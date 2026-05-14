// ─── Multigame Foundation (Fase 1 + Fase 2) ──────────────────────────────────
// Central enums, ConnectedAccount, PlayerProfile, PlayerEligibilitySnapshot.
//
// Chain: User → ConnectedAccount → PlayerProfile → TerminalAsset (assets table)
//                                        ↓
//                             PlayerEligibilitySnapshot
//
// LoL: preserved and operational. Legacy assets (player_profile_id=null) remain
//      functional via the existing riot path. No backfill in Fase 1/2.
//
// Dota2: full onboarding flow introduced in Fase 2 (steam + dota2).
// ─────────────────────────────────────────────────────────────────────────────
import {
  pgTable, serial, varchar, text, boolean, timestamp, integer, index, unique, numeric,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "../models/auth";

// ── Central enums ─────────────────────────────────────────────────────────────

export const GAMES = ["lol", "dota2", "cs2"] as const;
export type Game = typeof GAMES[number];

export const PROVIDER_GROUPS = ["riot", "steam"] as const;
export type ProviderGroup = typeof PROVIDER_GROUPS[number];

export const VERIFICATION_STATUS_VALUES = ["PENDING", "VERIFIED", "FAILED", "REVOKED"] as const;
export type VerificationStatus = typeof VERIFICATION_STATUS_VALUES[number];

export const PLAYER_PROFILE_STATUS_VALUES = ["DRAFT", "ACTIVE", "INACTIVE", "BLOCKED"] as const;
export type PlayerProfileStatus = typeof PLAYER_PROFILE_STATUS_VALUES[number];

export const TRADING_STATUS_VALUES = ["DRAFT", "ACTIVE", "PAUSED", "INACTIVE"] as const;
export type TradingStatus = typeof TRADING_STATUS_VALUES[number];

export const LISTING_STATUS_VALUES = ["ELIGIBLE", "UNDER_REVIEW", "LISTED", "REJECTED"] as const;
export type ListingStatus = typeof LISTING_STATUS_VALUES[number];

// Eligibility reason codes — Fase 2 baseline + Fase 3 data-driven codes.
export const ELIGIBILITY_REASON_CODES = [
  "PENDING_DATA_COLLECTION",    // Default: no matches ingested yet (Fase 2)
  "INSUFFICIENT_MATCH_HISTORY", // Fewer than minimum match count (Fase 3+)
  "INCOMPLETE_SOURCE_DATA",     // Matches ingested but data quality too low (Fase 3+)
  "READY_FOR_ANALYTICS",        // Sufficient quality data, ready for Fase 4 analysis
  "PROVIDER_SYNC_FAILED",       // Sync attempt failed (Fase 3+)
  "STALE_DATA",                 // Last match older than acceptable window
  "ROLE_UNDETECTABLE",          // Cannot assign primary role (Fase 4+)
  "DATA_READY",                 // Alias for editorial approval flow
  "ELIGIBLE",                   // Cleared for listing (post-analytics)
  "BLOCKED",                    // Manually blocked by admin
] as const;
export type EligibilityReasonCode = typeof ELIGIBILITY_REASON_CODES[number];

// ── Match source status ───────────────────────────────────────────────────────
// Lifecycle state for each raw match ingestion record.
export const MATCH_SOURCE_STATUS_VALUES = [
  "RAW_FETCHED",         // Match summary ingested from provider match list
  "DETAIL_FETCHED",      // Full match detail fetched from provider
  "PROCESSING_PENDING",  // Queued for analytics processing (Fase 4+)
  "PROCESSED",           // Analytics complete (Fase 4+)
  "FAILED",              // Fetch or processing error — see ingestion_error field
  "SKIPPED",             // Intentionally excluded (non-ranked, corrupted, etc.)
] as const;
export type MatchSourceStatus = typeof MATCH_SOURCE_STATUS_VALUES[number];

// ── Fase 4 analytics enums ─────────────────────────────────────────────────────

/** Dota2 role positions P1–P5 (carry through hard support). */
export const DETECTED_ROLE_VALUES = ["P1", "P2", "P3", "P4", "P5", "UNKNOWN"] as const;
export type DetectedRole = typeof DETECTED_ROLE_VALUES[number];

/** How the role was determined. */
export const ROLE_SOURCE_VALUES = ["PROVIDER", "HEURISTIC", "FALLBACK"] as const;
export type RoleSource = typeof ROLE_SOURCE_VALUES[number];

/** Match duration classification. SHORT <25m | MEDIUM 25–45m | LONG >45m. */
export const DURATION_BUCKET_VALUES = ["SHORT", "MEDIUM", "LONG"] as const;
export type DurationBucket = typeof DURATION_BUCKET_VALUES[number];

/** Per-match analytics eligibility codes. Separate from player-level eligibility. */
export const MATCH_ANALYTICS_ELIGIBILITY_CODES = [
  "ELIGIBLE",                   // Passed all per-match checks
  "NOT_RANKED",                 // lobby_type !== 7
  "MISSING_REQUIRED_METRICS",   // Core stats absent from payload
  "ROLE_UNCERTAIN",             // role_confidence too low (< 0.40)
  "ACCOUNT_MISMATCH",           // Player not found in match detail
  "CORRUPTED_SOURCE_DATA",      // Detail fetch failed or JSON unparseable
] as const;
export type MatchAnalyticsEligibilityCode = typeof MATCH_ANALYTICS_ELIGIBILITY_CODES[number];

// ── ConnectedAccount ──────────────────────────────────────────────────────────
// Represents an external account (Riot, Steam…) connected by a platform user.
// A ConnectedAccount does NOT become a TerminalAsset directly — it feeds into
// PlayerProfile which is the canonical identity gate.

export const connectedAccounts = pgTable("connected_accounts", {
  id:                   serial("id").primaryKey(),

  userId:               varchar("user_id").notNull()
                          .references(() => users.id, { onDelete: "cascade" }),

  providerGroup:        varchar("provider_group", { length: 32 }).notNull()
                          .$type<ProviderGroup>(),

  game:                 varchar("game", { length: 32 }).notNull()
                          .$type<Game>(),

  providerAccountId:    text("provider_account_id").notNull(),
  providerAccountName:  text("provider_account_name"),
  providerProfileUrl:   text("provider_profile_url"),

  verificationStatus:   varchar("verification_status", { length: 32 })
                          .notNull()
                          .default("PENDING")
                          .$type<VerificationStatus>(),

  isPrimary:            boolean("is_primary").notNull().default(false),

  linkedAt:             timestamp("linked_at").defaultNow().notNull(),
  lastVerifiedAt:       timestamp("last_verified_at"),

  createdAt:            timestamp("created_at").defaultNow().notNull(),
  updatedAt:            timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("connected_accounts_user_idx").on(t.userId),
  index("connected_accounts_provider_game_idx").on(t.providerGroup, t.game),
  // Global uniqueness: one provider account can only be linked once system-wide
  // (regardless of user). This prevents two GS users from claiming the same
  // external identity. Enforced via partial unique index in DB (see DDL migration).
  unique("connected_accounts_user_provider_account_unique")
    .on(t.userId, t.providerGroup, t.game, t.providerAccountId),
]);

export type ConnectedAccount = typeof connectedAccounts.$inferSelect;

export const insertConnectedAccountSchema = createInsertSchema(connectedAccounts).omit({
  id: true, linkedAt: true, createdAt: true, updatedAt: true,
});
export type InsertConnectedAccount = z.infer<typeof insertConnectedAccountSchema>;

// ── PlayerProfile ─────────────────────────────────────────────────────────────
// Canonical player identity within GamerStock.
// One PlayerProfile per (game, player) — independent of platform User.
// A user may link their ConnectedAccount to a PlayerProfile (Fase 2 flow).

export const playerProfiles = pgTable("player_profiles", {
  id:                         serial("id").primaryKey(),

  game:                       varchar("game", { length: 32 }).notNull()
                                .$type<Game>(),

  canonicalName:              text("canonical_name").notNull(),

  // FK to the primary ConnectedAccount that "owns" this profile (nullable).
  // Set when a user links their account; null for system-generated profiles.
  // Unique partial index: one profile per connected account (see DDL migration).
  primaryConnectedAccountId:  integer("primary_connected_account_id")
                                .references(() => connectedAccounts.id, { onDelete: "set null" }),

  status:                     varchar("status", { length: 32 })
                                .notNull()
                                .default("DRAFT")
                                .$type<PlayerProfileStatus>(),

  createdAt:                  timestamp("created_at").defaultNow().notNull(),
  updatedAt:                  timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("player_profiles_game_idx").on(t.game),
  index("player_profiles_status_idx").on(t.status),
]);

export type PlayerProfile = typeof playerProfiles.$inferSelect;

export const insertPlayerProfileSchema = createInsertSchema(playerProfiles).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertPlayerProfile = z.infer<typeof insertPlayerProfileSchema>;

// ── PlayerEligibilitySnapshot ─────────────────────────────────────────────────
// Immutable snapshot of a player's eligibility assessment at a point in time.
// Created on first connect and refreshed by the eligibility engine (Fase 3+).
// The latest snapshot is the current eligibility state.

export const playerEligibilitySnapshots = pgTable("player_eligibility_snapshots", {
  id:                serial("id").primaryKey(),

  playerProfileId:   integer("player_profile_id")
                       .notNull()
                       .references(() => playerProfiles.id, { onDelete: "cascade" }),

  game:              varchar("game", { length: 32 }).notNull()
                       .$type<Game>(),

  isEligible:        boolean("is_eligible").notNull().default(false),

  reasonCode:        varchar("reason_code", { length: 64 })
                       .notNull()
                       .default("PENDING_DATA_COLLECTION")
                       .$type<EligibilityReasonCode>(),

  // Number of matches ingested and analyzed
  sampleSize:        integer("sample_size").notNull().default(0),

  // 0.00–1.00 representing fraction of expected data fields present
  dataCompleteness:  numeric("data_completeness", { precision: 5, scale: 4 }).notNull().default("0.0000"),

  // 0.00–1.00 confidence that a primary role can be assigned (Fase 3+)
  roleDetectability: numeric("role_detectability", { precision: 5, scale: 4 }).notNull().default("0.0000"),

  // Highest rank signal observed (e.g. "Immortal", "Legend", etc.) or null
  rankSignal:        varchar("rank_signal", { length: 64 }),

  // Arbitrary JSON blob for future Fase 3+ analytics fields
  snapshotJson:      text("snapshot_json"),

  createdAt:         timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("eligibility_snapshots_profile_idx").on(t.playerProfileId),
  index("eligibility_snapshots_game_idx").on(t.game),
  index("eligibility_snapshots_created_at_idx").on(t.createdAt),
]);

export type PlayerEligibilitySnapshot = typeof playerEligibilitySnapshots.$inferSelect;

export const insertPlayerEligibilitySnapshotSchema = createInsertSchema(playerEligibilitySnapshots).omit({
  id: true, createdAt: true,
});
export type InsertPlayerEligibilitySnapshot = z.infer<typeof insertPlayerEligibilitySnapshotSchema>;

// ── PlayerMatchSourceData ─────────────────────────────────────────────────────
// Raw ingestion record for a single match from an external provider.
// One row per (player_profile_id, provider_group, provider_match_id).
//
// Lifecycle:
//   RAW_FETCHED → DETAIL_FETCHED → PROCESSING_PENDING → PROCESSED
//   any stage → FAILED | SKIPPED
//
// Re-syncing an existing match does an UPDATE (no duplicate rows).
// ─────────────────────────────────────────────────────────────────────────────
export const playerMatchSourceData = pgTable("player_match_source_data", {
  id:                 serial("id").primaryKey(),

  playerProfileId:    integer("player_profile_id")
                        .notNull()
                        .references(() => playerProfiles.id, { onDelete: "cascade" }),

  connectedAccountId: integer("connected_account_id")
                        .notNull()
                        .references(() => connectedAccounts.id, { onDelete: "cascade" }),

  // Nullable — asset may not yet exist when match is first ingested
  assetId:            integer("asset_id"),

  game:               varchar("game", { length: 32 }).notNull()
                        .$type<Game>(),

  providerGroup:      varchar("provider_group", { length: 32 }).notNull()
                        .$type<ProviderGroup>(),

  // Provider's unique identifier for the match (e.g. OpenDota match_id)
  providerMatchId:    text("provider_match_id").notNull(),

  // Provider's unique identifier for the player within the match
  providerAccountId:  text("provider_account_id").notNull(),

  playedAt:           timestamp("played_at"),

  matchStatus:        varchar("match_status", { length: 32 })
                        .notNull()
                        .default("RAW_FETCHED")
                        .$type<MatchSourceStatus>(),

  queueType:          varchar("queue_type", { length: 64 }),
  rankBucket:         varchar("rank_bucket", { length: 64 }),
  patchVersion:       varchar("patch_version", { length: 32 }),
  durationSeconds:    integer("duration_seconds"),
  isRanked:           boolean("is_ranked"),

  // Compact summary extracted from the match list response (lightweight, always present)
  rawSummaryJson:     text("raw_summary_json"),

  // Full match detail payload from provider (only when matchStatus >= DETAIL_FETCHED)
  rawPayloadJson:     text("raw_payload_json"),

  ingestionError:     text("ingestion_error"),

  firstSeenAt:        timestamp("first_seen_at").defaultNow().notNull(),
  lastSyncedAt:       timestamp("last_synced_at").defaultNow().notNull(),
  createdAt:          timestamp("created_at").defaultNow().notNull(),
  updatedAt:          timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  // Primary dedup: one row per (player, provider, match)
  unique("player_match_source_unique")
    .on(t.playerProfileId, t.providerGroup, t.providerMatchId),

  index("pmsd_player_profile_idx").on(t.playerProfileId),
  index("pmsd_connected_account_idx").on(t.connectedAccountId),
  index("pmsd_asset_idx").on(t.assetId),
  index("pmsd_game_idx").on(t.game),
  index("pmsd_status_idx").on(t.matchStatus),
  index("pmsd_played_at_idx").on(t.playedAt),
]);

export type PlayerMatchSourceDatum = typeof playerMatchSourceData.$inferSelect;

export const insertPlayerMatchSourceDataSchema = createInsertSchema(playerMatchSourceData).omit({
  id: true, firstSeenAt: true, createdAt: true, updatedAt: true,
});
export type InsertPlayerMatchSourceDatum = z.infer<typeof insertPlayerMatchSourceDataSchema>;

// ── PlayerMatchAnalytics ──────────────────────────────────────────────────────
// One analytics record per (player, match). Derived from rawPayloadJson after
// enrichment with full match detail. Keeps clean separation from raw source data.
//
// Lifecycle linkage:
//   player_match_source_data.match_status = RAW_FETCHED
//     → DETAIL_FETCHED  (full payload stored in rawPayloadJson)
//     → PROCESSED       (analytics extracted and saved here)
//     → SKIPPED         (match ineligible, analytics row still created with is_eligible=false)
//     → FAILED          (enrichment error, ingestion_error set on source record)
// ─────────────────────────────────────────────────────────────────────────────
export const playerMatchAnalytics = pgTable("player_match_analytics", {
  id:                      serial("id").primaryKey(),

  // FK to raw source — one analytics record per raw match record
  playerMatchSourceDataId: integer("player_match_source_data_id")
                             .notNull()
                             .references(() => playerMatchSourceData.id, { onDelete: "cascade" }),

  // Denormalized for query convenience (avoids joins in hot paths)
  playerProfileId:         integer("player_profile_id").notNull(),
  connectedAccountId:      integer("connected_account_id").notNull(),
  assetId:                 integer("asset_id"),

  game:                    varchar("game", { length: 32 }).notNull()
                             .$type<Game>(),
  providerGroup:           varchar("provider_group", { length: 32 }).notNull()
                             .$type<ProviderGroup>(),
  providerMatchId:         text("provider_match_id").notNull(),

  // Hero played (nullable when payload is incomplete)
  heroId:                  integer("hero_id"),

  // Role detection output
  detectedRole:            varchar("detected_role", { length: 8 })
                             .$type<DetectedRole>(),
  roleSource:              varchar("role_source", { length: 16 })
                             .$type<RoleSource>(),
  roleConfidence:          numeric("role_confidence", { precision: 5, scale: 4 }),

  // Match classification
  durationBucket:          varchar("duration_bucket", { length: 8 })
                             .$type<DurationBucket>(),
  patchBucket:             varchar("patch_bucket", { length: 16 }),
  isRanked:                boolean("is_ranked").notNull().default(false),

  // Per-match eligibility
  isEligible:              boolean("is_eligible").notNull().default(false),
  eligibilityReasonCode:   varchar("eligibility_reason_code", { length: 64 })
                             .notNull()
                             .$type<MatchAnalyticsEligibilityCode>(),

  // Completeness score 0.0–1.0: fraction of expected metrics present
  dataCompleteness:        numeric("data_completeness", { precision: 5, scale: 4 }),

  // Structured analytics extracted from the detail payload
  metricsJson:             text("metrics_json"),

  // Fields expected but absent (for Fase 5 filtering)
  missingMetricsJson:      text("missing_metrics_json"),

  // Contextual metadata (patch, game mode, lobby type, etc.)
  contextJson:             text("context_json"),

  processedAt:             timestamp("processed_at").defaultNow().notNull(),
  createdAt:               timestamp("created_at").defaultNow().notNull(),
  updatedAt:               timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  // One analytics record per raw match record (idempotent processing)
  unique("pma_source_unique").on(t.playerMatchSourceDataId),

  index("pma_player_profile_idx").on(t.playerProfileId),
  index("pma_game_idx").on(t.game),
  index("pma_eligible_idx").on(t.isEligible),
  index("pma_role_idx").on(t.detectedRole),
  index("pma_processed_at_idx").on(t.processedAt),
]);

export type PlayerMatchAnalytic = typeof playerMatchAnalytics.$inferSelect;

export const insertPlayerMatchAnalyticSchema = createInsertSchema(playerMatchAnalytics).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertPlayerMatchAnalytic = z.infer<typeof insertPlayerMatchAnalyticSchema>;

// ─────────────────────────────────────────────────────────────────────────────
//  FASE 5 — Baseline Engine + RoleRelativeScore
// ─────────────────────────────────────────────────────────────────────────────

// ── Fase 5 enums ──────────────────────────────────────────────────────────────

/** Baseline cohort fallback level. A=full cohort, B=no hero, C=minimal. */
export const BASELINE_FALLBACK_LEVELS = ["A", "B", "C"] as const;
export type BaselineFallbackLevel = typeof BASELINE_FALLBACK_LEVELS[number];

/** All Dota2 role-specific metric names tracked by the Fase 5 engine. */
export const DOTA2_METRIC_NAMES = [
  "gpm", "xpm", "last_hits", "net_worth", "hero_damage", "tower_damage",
  "death_control", "teamfight_participation", "kills", "assists",
  "kill_participation", "observer_wards", "deward_count", "stun_duration",
  "camps_stacked", "save_or_utility", "sentry_wards", "death_efficiency",
] as const;
export type Dota2MetricName = typeof DOTA2_METRIC_NAMES[number];

// ── PerformanceBaselines ──────────────────────────────────────────────────────
// Stores robust baseline stats (median, MAD) per metric cohort.
// Cohort dimensions: game + metric + role + hero_id? + rank_bucket? +
//                   patch_bucket? + duration_bucket?
// Fallback level:
//   A = all four dimensions (hero_id, rank_bucket, patch_bucket, duration_bucket)
//   B = no hero_id  (position + rank_bucket + patch_bucket + duration_bucket)
//   C = minimal     (position + rank_bucket only)
// ─────────────────────────────────────────────────────────────────────────────
export const performanceBaselines = pgTable("performance_baselines", {
  id:             serial("id").primaryKey(),

  game:           varchar("game", { length: 32 }).notNull().$type<Game>(),
  metric:         varchar("metric", { length: 64 }).notNull(),
  role:           varchar("role", { length: 8 }).notNull().$type<DetectedRole>(),

  // Cohort dimensions (all nullable for flexibility across fallback levels)
  heroId:         integer("hero_id"),
  rankBucket:     varchar("rank_bucket", { length: 16 }),
  patchBucket:    varchar("patch_bucket", { length: 16 }),
  durationBucket: varchar("duration_bucket", { length: 8 }).$type<DurationBucket>(),

  // Fallback level this baseline was built for
  fallbackLevel:  varchar("fallback_level", { length: 4 }).notNull()
                    .$type<BaselineFallbackLevel>(),

  // Robust statistics
  medianValue:    numeric("median_value", { precision: 12, scale: 4 }).notNull(),
  madValue:       numeric("mad_value", { precision: 12, scale: 4 }).notNull(),
  sampleSize:     integer("sample_size").notNull(),

  // Version fingerprint for cache invalidation (e.g. "20260317")
  baselineVersion: varchar("baseline_version", { length: 32 }),

  createdAt:      timestamp("created_at").defaultNow().notNull(),
  updatedAt:      timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  // Natural unique key: one baseline per (game, metric, role, cohort, level)
  unique("pb_cohort_unique").on(
    t.game, t.metric, t.role,
    t.heroId, t.rankBucket, t.patchBucket, t.durationBucket, t.fallbackLevel,
  ),
  index("pb_game_role_idx").on(t.game, t.role),
  index("pb_metric_idx").on(t.metric),
  index("pb_fallback_idx").on(t.fallbackLevel),
]);

export type PerformanceBaseline = typeof performanceBaselines.$inferSelect;

export const insertPerformanceBaselineSchema = createInsertSchema(performanceBaselines).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertPerformanceBaseline = z.infer<typeof insertPerformanceBaselineSchema>;

// ── PerformanceMetricWeights ──────────────────────────────────────────────────
// Stores the canonical weight configuration per (game, role, metric).
// Versioned so weight changes don't invalidate historical scores.
// ─────────────────────────────────────────────────────────────────────────────
export const performanceMetricWeights = pgTable("performance_metric_weights", {
  id:          serial("id").primaryKey(),

  game:        varchar("game", { length: 32 }).notNull().$type<Game>(),
  role:        varchar("role", { length: 8 }).notNull().$type<DetectedRole>(),
  metric:      varchar("metric", { length: 64 }).notNull(),

  weight:      numeric("weight", { precision: 6, scale: 4 }).notNull(),
  isInverted:  boolean("is_inverted").notNull().default(false),

  // Increment when weights change so old scores remain auditable
  version:     integer("version").notNull().default(1),

  createdAt:   timestamp("created_at").defaultNow().notNull(),
  updatedAt:   timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  unique("pmw_role_metric_version_unique").on(t.game, t.role, t.metric, t.version),
  index("pmw_game_role_idx").on(t.game, t.role),
]);

export type PerformanceMetricWeight = typeof performanceMetricWeights.$inferSelect;

export const insertPerformanceMetricWeightSchema = createInsertSchema(performanceMetricWeights).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertPerformanceMetricWeight = z.infer<typeof insertPerformanceMetricWeightSchema>;

// ── PerformanceScoreComponents ────────────────────────────────────────────────
// One row per eligible match analytics record.
// Stores all intermediate calculation artefacts for auditability:
//   - z-score per metric
//   - individual metric score (0–100)
//   - missing metrics and redistributed weights
//   - final RoleRelativeScore
// ─────────────────────────────────────────────────────────────────────────────
export const performanceScoreComponents = pgTable("performance_score_components", {
  id:                    serial("id").primaryKey(),

  // FK to analytics record (one score per eligible analytics row)
  playerMatchAnalyticsId: integer("player_match_analytics_id")
                            .notNull()
                            .references(() => playerMatchAnalytics.id, { onDelete: "cascade" }),

  // Denormalized for hot-path queries
  playerProfileId:       integer("player_profile_id").notNull(),
  game:                  varchar("game", { length: 32 }).notNull().$type<Game>(),
  role:                  varchar("role", { length: 8 }).notNull().$type<DetectedRole>(),

  // Which baseline fallback level was used
  baselineFallbackLevel: varchar("baseline_fallback_level", { length: 4 })
                           .notNull().$type<BaselineFallbackLevel>(),
  baselineVersion:       varchar("baseline_version", { length: 32 }),

  // JSON maps: { [metricName]: number }
  metricScoresJson:      text("metric_scores_json").notNull(),   // 0–100 per metric
  metricZscoresJson:     text("metric_zscores_json").notNull(),  // robust z-score per metric
  effectiveWeightsJson:  text("effective_weights_json").notNull(), // post-redistribution weights

  // Metrics absent from payload (weight redistributed)
  missingMetricsJson:    text("missing_metrics_json"),

  // Aggregated final score 0–100
  roleRelativeScore:     numeric("role_relative_score", { precision: 7, scale: 4 }).notNull(),

  // Weight config version used
  scoreVersion:          integer("score_version").notNull().default(1),

  createdAt:             timestamp("created_at").defaultNow().notNull(),
  updatedAt:             timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  unique("psc_analytics_unique").on(t.playerMatchAnalyticsId),
  index("psc_player_profile_idx").on(t.playerProfileId),
  index("psc_game_role_idx").on(t.game, t.role),
  index("psc_score_idx").on(t.roleRelativeScore),
]);

export type PerformanceScoreComponent = typeof performanceScoreComponents.$inferSelect;

export const insertPerformanceScoreComponentSchema = createInsertSchema(performanceScoreComponents).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertPerformanceScoreComponent = z.infer<typeof insertPerformanceScoreComponentSchema>;

// ── PerformanceScores ─────────────────────────────────────────────────────────
// Final aggregated performance score per match.
// Combines RoleRelativeScore (Fase 5) + SelfTrendScore + ContextScore (Fase 6).
//
// Formula:
//   effective_self_trend_weight = 0.25 × trend_confidence
//   effective_context_weight    = 0.15
//   effective_role_weight       = 1 − effective_self_trend_weight − 0.15
//   PerformanceScore = effective_role_weight × RoleRelativeScore
//                    + effective_self_trend_weight × SelfTrendScore
//                    + effective_context_weight × ContextScore
// ─────────────────────────────────────────────────────────────────────────────
export const dota2PerformanceScores = pgTable("dota2_performance_scores", {
  id:                        serial("id").primaryKey(),

  playerMatchAnalyticsId:    integer("player_match_analytics_id")
                               .notNull()
                               .references(() => playerMatchAnalytics.id, { onDelete: "cascade" }),

  playerProfileId:           integer("player_profile_id").notNull(),
  game:                      varchar("game", { length: 32 }).notNull().$type<Game>(),
  role:                      varchar("role", { length: 8 }).notNull().$type<DetectedRole>(),

  // Sub-scores 0–100
  roleRelativeScore:         numeric("role_relative_score", { precision: 7, scale: 4 }).notNull(),
  selfTrendScore:            numeric("self_trend_score", { precision: 7, scale: 4 }),
  contextScore:              numeric("context_score", { precision: 7, scale: 4 }).notNull(),

  // Final score 0–100
  performanceScore:          numeric("performance_score", { precision: 7, scale: 4 }).notNull(),

  // Weight attribution (sum ≈ 1.0)
  trendConfidence:           numeric("trend_confidence", { precision: 5, scale: 4 }).notNull(),
  effectiveRoleWeight:       numeric("effective_role_weight", { precision: 5, scale: 4 }).notNull(),
  effectiveSelfTrendWeight:  numeric("effective_self_trend_weight", { precision: 5, scale: 4 }).notNull(),
  effectiveContextWeight:    numeric("effective_context_weight", { precision: 5, scale: 4 }).notNull(),

  // Full breakdown JSON for auditability
  componentsJson:            text("components_json").notNull(),

  scoreVersion:              integer("score_version").notNull().default(1),

  // ── Fase 8: Idempotency guard ─────────────────────────────────────────────
  // Each score must be applied to valuation at most once.
  //   applied_to_valuation     = false → pending; true → already applied
  //   applied_to_valuation_at  = when it was applied
  //   valuation_history_id     = FK into dota2_value_history (full audit link)
  appliedToValuation:        boolean("applied_to_valuation").notNull().default(false),
  appliedToValuationAt:      timestamp("applied_to_valuation_at"),
  valuationHistoryId:        integer("valuation_history_id"),

  createdAt:                 timestamp("created_at").defaultNow().notNull(),
  updatedAt:                 timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  unique("ps_analytics_unique").on(t.playerMatchAnalyticsId),
  index("ps_player_profile_idx").on(t.playerProfileId),
  index("ps_game_role_idx").on(t.game, t.role),
  index("ps_score_idx").on(t.performanceScore),
  index("ps_applied_idx").on(t.appliedToValuation),
]);

export type Dota2PerformanceScore = typeof dota2PerformanceScores.$inferSelect;

export const insertDota2PerformanceScoreSchema = createInsertSchema(dota2PerformanceScores).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertDota2PerformanceScore = z.infer<typeof insertDota2PerformanceScoreSchema>;

// ── AssetValuationState ───────────────────────────────────────────────────────
// Fase 7: current valuation state for a Dota2 asset.
//
// Separation of concerns:
//   Price = market-driven (AMM / order-book) — NOT stored here.
//   Value = fundamental estimate from performance data — stored here.
//
// Formula summary:
//   ConfidenceScore = 0.35*SampleConf + 0.25*RoleConf + 0.20*DataComp + 0.20*RankStab
//   InitialValue    = clamp(8 + 10*mmrNorm + 3*wrNorm + 2*gamesFactor, 6, 25)
//   RawValue_new    = (1-α)*RawValue_old + α*RawValue_old*(1 + β*PerformanceDeltaBase)
//   PlayerValue     = RawValue * (0.60 + 0.40 * ConfidenceScore)
// ─────────────────────────────────────────────────────────────────────────────
export const dota2ValuationState = pgTable("dota2_valuation_state", {
  id:                   serial("id").primaryKey(),

  // FK to assets (no Drizzle .references() — consistent with existing pattern)
  assetId:              integer("asset_id").notNull(),
  playerProfileId:      integer("player_profile_id").notNull(),
  game:                 varchar("game", { length: 32 }).notNull().$type<Game>(),

  // Core valuation values
  initialValue:         numeric("initial_value", { precision: 10, scale: 4 }).notNull(),
  rawValue:             numeric("raw_value", { precision: 10, scale: 4 }).notNull(),
  playerValue:          numeric("player_value", { precision: 10, scale: 4 }).notNull(),

  // Confidence
  confidenceScore:      numeric("confidence_score", { precision: 5, scale: 4 }).notNull(),
  sampleConfidence:     numeric("sample_confidence", { precision: 5, scale: 4 }).notNull(),
  roleConfidence:       numeric("role_confidence", { precision: 5, scale: 4 }).notNull(),
  dataCompleteness:     numeric("data_completeness", { precision: 5, scale: 4 }).notNull(),
  rankStability:        numeric("rank_stability", { precision: 5, scale: 4 }).notNull(),

  // Tracking
  lastPerformanceScore: numeric("last_performance_score", { precision: 7, scale: 4 }),
  matchesCount:         integer("matches_count").notNull().default(0),
  valuationVersion:     integer("valuation_version").notNull().default(1),

  createdAt:            timestamp("created_at").defaultNow().notNull(),
  updatedAt:            timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  unique("avs_asset_unique").on(t.assetId),
  index("avs_player_profile_idx").on(t.playerProfileId),
  index("avs_game_idx").on(t.game),
  index("avs_player_value_idx").on(t.playerValue),
]);

export type Dota2ValuationState = typeof dota2ValuationState.$inferSelect;

export const insertDota2ValuationStateSchema = createInsertSchema(dota2ValuationState).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertDota2ValuationState = z.infer<typeof insertDota2ValuationStateSchema>;

// ── AssetValueHistory ─────────────────────────────────────────────────────────
// Fase 7: append-only audit trail for every valuation change.
// event_type: BOOTSTRAP | MATCH_UPDATE | RECALC | MANUAL_ADJUSTMENT
// ─────────────────────────────────────────────────────────────────────────────
export const VALUE_EVENT_TYPES = [
  "BOOTSTRAP",
  "MATCH_UPDATE",
  "MATCH_SYNC",
  "SYNTHETIC_MATCH",
  "RECALC",
  "MANUAL_ADJUSTMENT",
] as const;
export type ValueEventType = typeof VALUE_EVENT_TYPES[number];

export const dota2ValueHistory = pgTable("dota2_value_history", {
  id:                  serial("id").primaryKey(),

  assetId:             integer("asset_id").notNull(),
  playerProfileId:     integer("player_profile_id").notNull(),

  // Which performance score triggered this update (null for BOOTSTRAP/RECALC)
  performanceScoreId:  integer("performance_score_id"),

  // Before / after
  rawValueBefore:      numeric("raw_value_before", { precision: 10, scale: 4 }),
  rawValueAfter:       numeric("raw_value_after", { precision: 10, scale: 4 }).notNull(),
  playerValueAfter:    numeric("player_value_after", { precision: 10, scale: 4 }).notNull(),

  // Snapshot of key inputs
  performanceScore:    numeric("performance_score", { precision: 7, scale: 4 }),
  confidenceScore:     numeric("confidence_score", { precision: 5, scale: 4 }).notNull(),

  // Constants used (allow auditing formula changes)
  alphaUsed:           numeric("alpha_used", { precision: 5, scale: 4 }),
  betaUsed:            numeric("beta_used", { precision: 5, scale: 4 }),

  eventType:           varchar("event_type", { length: 32 }).notNull().$type<ValueEventType>(),
  metadataJson:        text("metadata_json"),

  createdAt:           timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("avh_asset_idx").on(t.assetId),
  index("avh_player_profile_idx").on(t.playerProfileId),
  index("avh_event_type_idx").on(t.eventType),
  index("avh_created_at_idx").on(t.createdAt),
]);

export type Dota2ValueHistoryRow = typeof dota2ValueHistory.$inferSelect;

export const insertDota2ValueHistorySchema = createInsertSchema(dota2ValueHistory).omit({
  id: true, createdAt: true,
});
export type InsertDota2ValueHistory = z.infer<typeof insertDota2ValueHistorySchema>;

// ── AssetListingReviews ───────────────────────────────────────────────────────
// Fase 9: Immutable audit log of every admin approve/reject decision on a
// Dota2 (or any game) asset listing request. One row per decision event.
//
// State machine:
//   DRAFT + UNDER_REVIEW  → admin reviews readiness snapshot
//   admin APPROVED        → ACTIVE + LISTED   (asset visible in terminal)
//   admin REJECTED        → DRAFT  + REJECTED (back to draft, reason recorded)
//
// NOTE: listing ≠ claim. This table records governance decisions, not player
//       ownership or claim status.
export const LISTING_REVIEW_DECISION_VALUES = ["APPROVED", "REJECTED"] as const;
export type ListingReviewDecision = typeof LISTING_REVIEW_DECISION_VALUES[number];

export const assetListingReviews = pgTable("asset_listing_reviews", {
  id:           serial("id").primaryKey(),

  // No Drizzle .references() — consistent with dota2ValuationState pattern;
  // assets table is in the main schema module.
  assetId:      integer("asset_id").notNull(),
  game:         varchar("game", { length: 32 }).notNull().$type<Game>(),

  // APPROVED → asset becomes ACTIVE + LISTED
  // REJECTED → asset stays DRAFT + REJECTED
  decision:     varchar("decision", { length: 16 }).notNull().$type<ListingReviewDecision>(),

  // Human-readable reason code for rejection or audit reference
  // e.g. INSUFFICIENT_MATCHES, LOW_CONFIDENCE, MANUAL_OVERRIDE
  reasonCode:   varchar("reason_code", { length: 64 }),

  // Full JSON snapshot of the readiness checks at the time of the decision.
  // Immutable — never updated after insert. Enables audit reconstruction.
  snapshotJson: text("snapshot_json").notNull(),

  // Who made the decision (admin user id or username). Nullable for system actions.
  reviewedBy:   varchar("reviewed_by", { length: 128 }),

  createdAt:    timestamp("created_at").defaultNow().notNull(),
  updatedAt:    timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("alr_asset_idx").on(t.assetId),
  index("alr_game_idx").on(t.game),
  index("alr_decision_idx").on(t.decision),
]);

export type AssetListingReview = typeof assetListingReviews.$inferSelect;

export const insertAssetListingReviewSchema = createInsertSchema(assetListingReviews).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertAssetListingReview = z.infer<typeof insertAssetListingReviewSchema>;

// ── AccountVerificationEvents ─────────────────────────────────────────────────
// Fase 10: Immutable audit log of every verification attempt on a
// ConnectedAccount (Steam OpenID, future: Riot, manual override, etc.).
//
// One row per attempt — never updated after insert.
export const ACCOUNT_VERIFICATION_METHOD_VALUES = ["STEAM_OPENID", "MANUAL_OVERRIDE"] as const;
export type AccountVerificationMethod = typeof ACCOUNT_VERIFICATION_METHOD_VALUES[number];

export const VERIFICATION_EVENT_STATUS_VALUES = [
  "INITIATED", "VERIFIED", "FAILED", "REVOKED",
] as const;
export type VerificationEventStatus = typeof VERIFICATION_EVENT_STATUS_VALUES[number];

export const accountVerificationEvents = pgTable("account_verification_events", {
  id:                 serial("id").primaryKey(),

  // No .references() — ConnectedAccounts live in the same multigame schema but
  // we keep FK-less to avoid circular dep complications (consistent with other tables).
  connectedAccountId: integer("connected_account_id").notNull(),
  providerGroup:      varchar("provider_group", { length: 32 }).notNull(),
  game:               varchar("game", { length: 32 }).$type<Game>(),

  // How verification was attempted
  method:             varchar("method", { length: 32 }).notNull().$type<AccountVerificationMethod>(),

  // Result of the verification attempt
  status:             varchar("status", { length: 32 }).notNull().$type<VerificationEventStatus>(),

  // Full JSON payload of the OpenID response or other provider data.
  // Immutable — enables audit reconstruction. Store only non-sensitive data.
  payloadJson:        text("payload_json"),

  createdAt:          timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("ave_connected_account_idx").on(t.connectedAccountId),
  index("ave_status_idx").on(t.status),
  index("ave_method_idx").on(t.method),
]);

export type AccountVerificationEvent = typeof accountVerificationEvents.$inferSelect;

export const insertAccountVerificationEventSchema = createInsertSchema(accountVerificationEvents).omit({
  id: true, createdAt: true,
});
export type InsertAccountVerificationEvent = z.infer<typeof insertAccountVerificationEventSchema>;

// ── AssetListingSubmissions ───────────────────────────────────────────────────
// Fase 10: User-initiated review submissions for terminal listing.
// When a user submits their asset for review, the system freezes the current
// readiness snapshot and creates an immutable record here.
//
// This is distinct from asset_listing_reviews (admin decisions).
// Flow: user submits → admin sees snapshot → admin decides (Fase 9 endpoints).
export const LISTING_SUBMISSION_STATUS_VALUES = [
  "PENDING", "UNDER_REVIEW", "APPROVED", "REJECTED", "WITHDRAWN",
] as const;
export type ListingSubmissionStatus = typeof LISTING_SUBMISSION_STATUS_VALUES[number];

export const assetListingSubmissions = pgTable("asset_listing_submissions", {
  id:                     serial("id").primaryKey(),

  assetId:                integer("asset_id").notNull(),
  playerProfileId:        integer("player_profile_id").notNull(),
  submittedByUserId:      varchar("submitted_by_user_id", { length: 128 }).notNull(),
  game:                   varchar("game", { length: 32 }).notNull().$type<Game>(),

  submissionStatus:       varchar("submission_status", { length: 32 })
                            .notNull()
                            .default("PENDING")
                            .$type<ListingSubmissionStatus>(),

  // Frozen at the moment of submission — never modified.
  // Contains full ListingReadinessSnapshot from evaluateDota2ListingReadiness.
  readinessSnapshotJson:  text("readiness_snapshot_json").notNull(),

  createdAt:              timestamp("created_at").defaultNow().notNull(),
  updatedAt:              timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("als_asset_idx").on(t.assetId),
  index("als_user_idx").on(t.submittedByUserId),
  index("als_status_idx").on(t.submissionStatus),
]);

export type AssetListingSubmission = typeof assetListingSubmissions.$inferSelect;

export const insertAssetListingSubmissionSchema = createInsertSchema(assetListingSubmissions).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertAssetListingSubmission = z.infer<typeof insertAssetListingSubmissionSchema>;

// ── Dota2 Asset Claim Requests (Fase 11) ──────────────────────────────────────
// A claim is a request for ownership of a Dota2 player asset.
// Distinct from listing (governance decision) and verification (identity check).
//
// Flow: user POST claim-asset → admin approve → ownership link created.
// Requires: connectedAccount steam+dota2 verificationStatus=VERIFIED.
// Prefixed dota2_ per CRITICAL table naming rule.
export const DOTA2_CLAIM_STATUS_VALUES = [
  "PENDING", "UNDER_REVIEW", "APPROVED", "REJECTED", "CANCELLED",
] as const;
export type Dota2ClaimStatus = typeof DOTA2_CLAIM_STATUS_VALUES[number];

// Hybrid claim model signal fields (Fase 13):
// claimOrigin     — how the claim was initiated (manual / system-assisted / fully auto)
// approvalType    — how this claim should be reviewed (admin manual / auto policy / requires review)
// matchConfidence — system confidence that claimant is the actual player (HIGH/MEDIUM/LOW)
// policyDecision  — computed at read-time; not stored
export const CLAIM_ORIGIN_VALUES     = ["MANUAL", "ASSISTED", "AUTO"]                       as const;
export const APPROVAL_TYPE_VALUES    = ["MANUAL_ADMIN", "AUTO_POLICY", "REQUIRES_REVIEW"]   as const;
export const MATCH_CONFIDENCE_VALUES = ["HIGH", "MEDIUM", "LOW"]                            as const;
export const POLICY_DECISION_VALUES  = ["AUTO_APPROVABLE", "REQUIRES_REVIEW", "BLOCKED"]    as const;

export type ClaimOrigin     = typeof CLAIM_ORIGIN_VALUES[number];
export type ApprovalType    = typeof APPROVAL_TYPE_VALUES[number];
export type MatchConfidence = typeof MATCH_CONFIDENCE_VALUES[number];
export type PolicyDecision  = typeof POLICY_DECISION_VALUES[number];

export const dota2AssetClaimRequests = pgTable("dota2_asset_claim_requests", {
  id:                 serial("id").primaryKey(),

  assetId:            integer("asset_id").notNull(),
  playerProfileId:    integer("player_profile_id").notNull(),

  // The ConnectedAccount that proved Steam identity (must be VERIFIED)
  connectedAccountId: integer("connected_account_id").notNull(),

  requestedByUserId:  varchar("requested_by_user_id", { length: 128 }).notNull(),
  game:               varchar("game", { length: 32 }).notNull().$type<Game>(),

  claimStatus:        varchar("claim_status", { length: 32 })
                        .notNull()
                        .default("PENDING")
                        .$type<Dota2ClaimStatus>(),

  // Optional claimant-supplied context (e.g. team confirmation link, social proof)
  reasonCode:         varchar("reason_code", { length: 64 }),
  evidenceJson:       text("evidence_json"),

  // Admin decision fields
  reviewNotes:        text("review_notes"),
  reviewedBy:         varchar("reviewed_by", { length: 128 }),
  reviewedAt:         timestamp("reviewed_at"),

  // Hybrid claim model signal fields (Fase 13)
  claimOrigin:        varchar("claim_origin", { length: 32 }).$type<ClaimOrigin>(),
  approvalType:       varchar("approval_type", { length: 32 }).$type<ApprovalType>(),
  matchConfidence:    varchar("match_confidence", { length: 32 }).$type<MatchConfidence>(),

  createdAt:          timestamp("created_at").defaultNow().notNull(),
  updatedAt:          timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("dacr_asset_idx").on(t.assetId),
  index("dacr_user_idx").on(t.requestedByUserId),
  index("dacr_status_idx").on(t.claimStatus),
  index("dacr_conn_acc_idx").on(t.connectedAccountId),
]);

export type Dota2AssetClaimRequest = typeof dota2AssetClaimRequests.$inferSelect;

export const insertDota2AssetClaimRequestSchema = createInsertSchema(dota2AssetClaimRequests).omit({
  id: true, createdAt: true, updatedAt: true, reviewNotes: true, reviewedBy: true, reviewedAt: true,
});
export type InsertDota2AssetClaimRequest = z.infer<typeof insertDota2AssetClaimRequestSchema>;

// ── Asset Ownership Links (Fase 11) ───────────────────────────────────────────
// Explicit, auditable ownership record created when a claim is approved.
// Not dota2-prefixed — generic cross-game ownership structure.
// Append-friendly: a REVOKED link is never deleted; a new ACTIVE link replaces it.
//
// sourceType/sourceId allow tracing which claim approval created this link.
export const OWNERSHIP_TYPE_VALUES = ["CLAIMED_OWNER", "SUBMITTED_BY"] as const;
export type OwnershipType = typeof OWNERSHIP_TYPE_VALUES[number];

export const OWNERSHIP_LINK_STATUS_VALUES = ["ACTIVE", "REVOKED"] as const;
export type OwnershipLinkStatus = typeof OWNERSHIP_LINK_STATUS_VALUES[number];

export const assetOwnershipLinks = pgTable("asset_ownership_links", {
  id:              serial("id").primaryKey(),

  assetId:         integer("asset_id").notNull(),
  playerProfileId: integer("player_profile_id").notNull(),

  // The platform user who holds ownership
  userId:          varchar("user_id", { length: 128 }).notNull(),

  ownershipType:   varchar("ownership_type", { length: 32 })
                     .notNull()
                     .$type<OwnershipType>(),

  status:          varchar("status", { length: 32 })
                     .notNull()
                     .default("ACTIVE")
                     .$type<OwnershipLinkStatus>(),

  // Audit: traceability back to the event that created this link
  sourceType:      varchar("source_type", { length: 64 }),  // e.g. "CLAIM_APPROVAL"
  sourceId:        integer("source_id"),                    // e.g. dota2_asset_claim_requests.id

  createdAt:       timestamp("created_at").defaultNow().notNull(),
  updatedAt:       timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("aol_asset_idx").on(t.assetId),
  index("aol_user_idx").on(t.userId),
  index("aol_status_idx").on(t.status),
]);

export type AssetOwnershipLink = typeof assetOwnershipLinks.$inferSelect;

export const insertAssetOwnershipLinkSchema = createInsertSchema(assetOwnershipLinks).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertAssetOwnershipLink = z.infer<typeof insertAssetOwnershipLinkSchema>;

// ── CS2 Stats Snapshot ────────────────────────────────────────────────────────
// Persisted on every Steam sync for a CS2 player.
// Stores the lifetime career totals at the time of sync.
// Used by the delta engine to detect new matches between syncs.
// One row per sync call (append-only) — full history retained.
// ─────────────────────────────────────────────────────────────────────────────
export const cs2StatsSnapshot = pgTable("cs2_stats_snapshot", {
  id:        serial("id").primaryKey(),

  // FK to assets (no Drizzle .references() — consistent with existing pattern)
  assetId:   integer("asset_id").notNull(),

  // Lifetime career totals from Steam GetUserStatsForGame
  kills:     integer("kills").notNull().default(0),
  deaths:    integer("deaths").notNull().default(0),
  wins:      integer("wins").notNull().default(0),
  matches:   integer("matches").notNull().default(0),
  headshots: integer("headshots").notNull().default(0),
  rounds:    integer("rounds").notNull().default(0),

  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("cs2_snap_asset_idx").on(t.assetId),
  index("cs2_snap_created_idx").on(t.createdAt),
]);

export type Cs2StatsSnapshot = typeof cs2StatsSnapshot.$inferSelect;

export const insertCs2StatsSnapshotSchema = createInsertSchema(cs2StatsSnapshot).omit({
  id: true, createdAt: true,
});
export type InsertCs2StatsSnapshot = z.infer<typeof insertCs2StatsSnapshotSchema>;

// ── CS2 Synthetic Match ───────────────────────────────────────────────────────
// One row per synthetic match generated from a stats delta.
// Synthetic matches are derived from the delta between two consecutive snapshots.
// Each row represents the estimated performance in one (or average of N) new games.
// Used by the EMA valuation engine to update rawValue without per-match API data.
// ─────────────────────────────────────────────────────────────────────────────
export const cs2SyntheticMatch = pgTable("cs2_synthetic_match", {
  id:               serial("id").primaryKey(),

  // FK to assets (no Drizzle .references() — consistent with existing pattern)
  assetId:          integer("asset_id").notNull(),

  // Delta context
  deltaMatches:     integer("delta_matches").notNull(),

  // Per-match estimated performance (derived from delta proportions)
  performanceScore: numeric("performance_score", { precision: 8, scale: 6 }).notNull(),
  kd:               numeric("kd", { precision: 8, scale: 4 }).notNull(),
  win:              boolean("win").notNull(),
  headshotRate:     numeric("headshot_rate", { precision: 8, scale: 6 }).notNull(),

  // EMA result applied for this match
  rawValueBefore:   numeric("raw_value_before", { precision: 10, scale: 4 }),
  rawValueAfter:    numeric("raw_value_after", { precision: 10, scale: 4 }),
  playerValueAfter: numeric("player_value_after", { precision: 10, scale: 4 }),
  alphaUsed:        numeric("alpha_used", { precision: 5, scale: 4 }),

  createdAt:        timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("cs2_synth_asset_idx").on(t.assetId),
  index("cs2_synth_created_idx").on(t.createdAt),
]);

export type Cs2SyntheticMatch = typeof cs2SyntheticMatch.$inferSelect;

export const insertCs2SyntheticMatchSchema = createInsertSchema(cs2SyntheticMatch).omit({
  id: true, createdAt: true,
});
export type InsertCs2SyntheticMatch = z.infer<typeof insertCs2SyntheticMatchSchema>;

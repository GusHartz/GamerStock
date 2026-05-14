// ─── Player Operator Domain — Schema ─────────────────────────────────────────
// Supports the Creator Economy MVP: operator (claimed player) mode.
// Entities:
//   player_operator_access        — who can access operator mode for an asset
//   player_operator_snapshots     — aggregated KPI snapshot per asset
//   player_missions               — holder/volume/activity growth missions
//   player_recommended_actions    — AI-free rule-based action recommendations
//   player_activity_events        — immutable activity feed per asset
//   player_card_visuals           — card visual customisation
//   player_moments                — limited collectible moments per asset
//   player_moment_transactions    — moment purchase records (future revenue)
// ─────────────────────────────────────────────────────────────────────────────
import {
  pgTable, serial, integer, varchar, text, numeric, timestamp,
  boolean, jsonb, index, unique,
} from "drizzle-orm/pg-core";
import { assets } from "./player";
import { users } from "../models/auth";
import { playerClaims } from "./claims";

// ─────────────────────────────────────────────────────────────────────────────
// Operator Access
// Derives from an approved player_claim; "owner" is the only level for now.
// ─────────────────────────────────────────────────────────────────────────────
export const OPERATOR_ACCESS_LEVELS = ["owner"] as const;
export type OperatorAccessLevel = typeof OPERATOR_ACCESS_LEVELS[number];

export const playerOperatorAccess = pgTable("player_operator_access", {
  id:             serial("id").primaryKey(),
  assetId:        integer("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
  userId:         varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accessLevel:    varchar("access_level", { length: 32 }).notNull().default("owner").$type<OperatorAccessLevel>(),
  grantedByClaimId: integer("granted_by_claim_id").references(() => playerClaims.id, { onDelete: "set null" }),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
  updatedAt:      timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  unique("player_operator_access_asset_user_uniq").on(t.assetId, t.userId),
  index("player_operator_access_asset_idx").on(t.assetId),
  index("player_operator_access_user_idx").on(t.userId),
]);

export type PlayerOperatorAccess = typeof playerOperatorAccess.$inferSelect;
export type InsertPlayerOperatorAccess = typeof playerOperatorAccess.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Performance Snapshot
// One row per asset; upserted by background jobs.
// ─────────────────────────────────────────────────────────────────────────────
export const TREND_STATUSES = ["up", "down", "stable"] as const;
export type TrendStatus = typeof TREND_STATUSES[number];

export const playerOperatorSnapshots = pgTable("player_operator_snapshots", {
  assetId:           integer("asset_id").primaryKey().references(() => assets.id, { onDelete: "cascade" }),
  earningsTotal:     numeric("earnings_total", { precision: 15, scale: 2 }).notNull().default("0"),
  earningsDeltaPct:  numeric("earnings_delta_pct", { precision: 8, scale: 4 }).notNull().default("0"),
  holdersTotal:      integer("holders_total").notNull().default(0),
  holdersDelta:      integer("holders_delta").notNull().default(0),
  conversionRate:    numeric("conversion_rate", { precision: 8, scale: 4 }).notNull().default("0"),
  conversionDelta:   numeric("conversion_delta", { precision: 8, scale: 4 }).notNull().default("0"),
  volumeTotal:       numeric("volume_total", { precision: 15, scale: 2 }).notNull().default("0"),
  volumeDelta:       numeric("volume_delta", { precision: 8, scale: 4 }).notNull().default("0"),
  trendStatus:       varchar("trend_status", { length: 16 }).notNull().default("stable").$type<TrendStatus>(),
  alertsJson:        jsonb("alerts_json").default([]),
  updatedAt:         timestamp("updated_at").defaultNow().notNull(),
});

export type PlayerOperatorSnapshot = typeof playerOperatorSnapshots.$inferSelect;
export type InsertPlayerOperatorSnapshot = typeof playerOperatorSnapshots.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Missions
// Growth / activity campaigns created by the operator for their asset.
// ─────────────────────────────────────────────────────────────────────────────
export const MISSION_TYPES = [
  "growth_holders", "buy_volume", "activity", "unlock_moment",
] as const;
export type MissionType = typeof MISSION_TYPES[number];

export const MISSION_STATUSES = ["active", "completed", "expired", "draft"] as const;
export type MissionStatus = typeof MISSION_STATUSES[number];

export const playerMissions = pgTable("player_missions", {
  id:                 serial("id").primaryKey(),
  assetId:            integer("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
  type:               varchar("type", { length: 32 }).notNull().$type<MissionType>(),
  title:              text("title").notNull(),
  description:        text("description"),
  goalValue:          numeric("goal_value", { precision: 15, scale: 2 }).notNull(),
  currentValue:       numeric("current_value", { precision: 15, scale: 2 }).notNull().default("0"),
  progressPercentage: numeric("progress_percentage", { precision: 5, scale: 2 }).notNull().default("0"),
  startDate:          timestamp("start_date").defaultNow().notNull(),
  endDate:            timestamp("end_date"),
  status:             varchar("status", { length: 16 }).notNull().default("active").$type<MissionStatus>(),
  participantsCount:  integer("participants_count").notNull().default(0),
  conversionImpact:   numeric("conversion_impact", { precision: 8, scale: 4 }),
  rewardId:           integer("reward_id"),
  createdByUserId:    varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt:          timestamp("created_at").defaultNow().notNull(),
  updatedAt:          timestamp("updated_at").defaultNow().notNull(),
  endedAt:            timestamp("ended_at"),
}, (t) => [
  index("player_missions_asset_idx").on(t.assetId),
  index("player_missions_status_idx").on(t.status),
]);

export type PlayerMission = typeof playerMissions.$inferSelect;
export type InsertPlayerMission = typeof playerMissions.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Recommended Actions (Action Center)
// Rule-generated, deterministic. No ML/AI at this stage.
// ─────────────────────────────────────────────────────────────────────────────
export const ACTION_TYPES = ["message", "mission", "moment"] as const;
export type ActionType = typeof ACTION_TYPES[number];

export const ACTION_PRIORITIES = ["high", "medium", "low"] as const;
export type ActionPriority = typeof ACTION_PRIORITIES[number];

export const ACTION_STATUSES = ["pending", "triggered", "dismissed", "expired"] as const;
export type ActionStatus = typeof ACTION_STATUSES[number];

export const playerRecommendedActions = pgTable("player_recommended_actions", {
  id:             serial("id").primaryKey(),
  assetId:        integer("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
  type:           varchar("type", { length: 16 }).notNull().$type<ActionType>(),
  title:          text("title").notNull(),
  reason:         text("reason"),
  expectedImpact: text("expected_impact"),
  priority:       varchar("priority", { length: 8 }).notNull().default("medium").$type<ActionPriority>(),
  status:         varchar("status", { length: 16 }).notNull().default("pending").$type<ActionStatus>(),
  sourceRule:     varchar("source_rule", { length: 64 }),
  payloadJson:    jsonb("payload_json").default({}),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
  updatedAt:      timestamp("updated_at").defaultNow().notNull(),
  triggeredAt:    timestamp("triggered_at"),
}, (t) => [
  index("player_recommended_actions_asset_idx").on(t.assetId),
  index("player_recommended_actions_status_idx").on(t.status),
]);

export type PlayerRecommendedAction = typeof playerRecommendedActions.$inferSelect;
export type InsertPlayerRecommendedAction = typeof playerRecommendedActions.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Activity Events
// Immutable event log for the activity feed.
// ─────────────────────────────────────────────────────────────────────────────
export const ACTIVITY_EVENT_TYPES = [
  "buy", "new_holder",
  "moment_purchase", "moment_created", "moment_activated", "moment_relaunched",
  "mission_started", "mission_completed",
] as const;
export type ActivityEventType = typeof ACTIVITY_EVENT_TYPES[number];

export const playerActivityEvents = pgTable("player_activity_events", {
  id:                  serial("id").primaryKey(),
  assetId:             integer("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
  type:                varchar("type", { length: 32 }).notNull().$type<ActivityEventType>(),
  actorUserId:         varchar("actor_user_id"),
  actorDisplayMasked:  text("actor_display_masked"),
  valueNumeric:        numeric("value_numeric", { precision: 15, scale: 2 }),
  metadataJson:        jsonb("metadata_json").default({}),
  createdAt:           timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("player_activity_events_asset_idx").on(t.assetId),
  index("player_activity_events_type_idx").on(t.type),
  index("player_activity_events_created_idx").on(t.createdAt),
]);

export type PlayerActivityEvent = typeof playerActivityEvents.$inferSelect;
export type InsertPlayerActivityEvent = typeof playerActivityEvents.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Card Visuals
// Player card customisation (template, crop, overlay).
// ─────────────────────────────────────────────────────────────────────────────
export const CARD_VISUAL_STATUSES = ["editing", "preview", "published"] as const;
export type CardVisualStatus = typeof CARD_VISUAL_STATUSES[number];

export const playerCardVisuals = pgTable("player_card_visuals", {
  id:               serial("id").primaryKey(),
  assetId:          integer("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
  mediaAssetId:     integer("media_asset_id"),
  templateId:       varchar("template_id", { length: 64 }).notNull().default("default-gold"),
  overlayConfigJson: jsonb("overlay_config_json").default({}),
  status:           varchar("status", { length: 16 }).notNull().default("editing").$type<CardVisualStatus>(),
  cropConfigJson:   jsonb("crop_config_json").default({}),
  createdByUserId:  varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  publishedAt:      timestamp("published_at"),
  createdAt:        timestamp("created_at").defaultNow().notNull(),
  updatedAt:        timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("player_card_visuals_asset_idx").on(t.assetId),
]);

export type PlayerCardVisual = typeof playerCardVisuals.$inferSelect;
export type InsertPlayerCardVisual = typeof playerCardVisuals.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Player Moments
// Limited collectible moments created by the asset operator.
// Relaunch model: same-record update (reset supply/price/status → active).
// ─────────────────────────────────────────────────────────────────────────────
export const MOMENT_RARITIES = ["common", "rare", "epic", "legendary"] as const;
export type MomentRarity = typeof MOMENT_RARITIES[number];

export const MOMENT_STATUSES = ["draft", "active", "sold_out"] as const;
export type MomentStatus = typeof MOMENT_STATUSES[number];

export const playerMoments = pgTable("player_moments", {
  id:               serial("id").primaryKey(),
  assetId:          integer("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
  title:            text("title").notNull(),
  rarity:           varchar("rarity", { length: 16 }).notNull().default("common").$type<MomentRarity>(),
  price:            numeric("price", { precision: 15, scale: 2 }).notNull(),
  supplyTotal:      integer("supply_total").notNull(),
  supplySold:       integer("supply_sold").notNull().default(0),
  soldPercentage:   numeric("sold_percentage", { precision: 5, scale: 2 }).notNull().default("0"),
  revenueGenerated: numeric("revenue_generated", { precision: 15, scale: 2 }).notNull().default("0"),
  salesVelocity:    numeric("sales_velocity", { precision: 8, scale: 4 }).notNull().default("0"),
  status:           varchar("status", { length: 16 }).notNull().default("draft").$type<MomentStatus>(),
  visualAssetId:    integer("visual_asset_id"),
  createdByUserId:  varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt:        timestamp("created_at").defaultNow().notNull(),
  updatedAt:        timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("player_moments_asset_idx").on(t.assetId),
  index("player_moments_status_idx").on(t.status),
]);

export type PlayerMoment = typeof playerMoments.$inferSelect;
export type InsertPlayerMoment = typeof playerMoments.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Player Moment Transactions
// Immutable record of each moment purchase.
// MVP starts with 0 real transactions; supplySold/revenue remain 0 until
// the buyer-side purchase flow is implemented (PASSO 5+).
// ─────────────────────────────────────────────────────────────────────────────
export const playerMomentTransactions = pgTable("player_moment_transactions", {
  id:           serial("id").primaryKey(),
  momentId:     integer("moment_id").notNull().references(() => playerMoments.id, { onDelete: "cascade" }),
  assetId:      integer("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
  buyerUserId:  varchar("buyer_user_id").references(() => users.id, { onDelete: "set null" }),
  price:        numeric("price", { precision: 15, scale: 2 }).notNull(),
  quantity:     integer("quantity").notNull().default(1),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("player_moment_transactions_moment_idx").on(t.momentId),
  index("player_moment_transactions_asset_idx").on(t.assetId),
  index("player_moment_transactions_buyer_idx").on(t.buyerUserId),
]);

export type PlayerMomentTransaction = typeof playerMomentTransactions.$inferSelect;
export type InsertPlayerMomentTransaction = typeof playerMomentTransactions.$inferInsert;

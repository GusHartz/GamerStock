// ─── Player Hub Domain — Schema ───────────────────────────────────────────────
// player_asset_requests: Manual requests for assets not yet in the platform.
// Submitted by authenticated users; reviewed by admins.
// ─────────────────────────────────────────────────────────────────────────────
import {
  pgTable, serial, varchar, text, timestamp, integer, index,
} from "drizzle-orm/pg-core";
import { users } from "../models/auth";

export const ASSET_REQUEST_STATUSES = [
  "pending", "under_review", "approved", "rejected", "ingested",
] as const;
export type AssetRequestStatus = typeof ASSET_REQUEST_STATUSES[number];

export const playerAssetRequests = pgTable("player_asset_requests", {
  id:                 serial("id").primaryKey(),
  requestedByUserId:  varchar("requested_by_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),

  // Optional: canonical player_id if the owner is linked to a known profile
  playerId:           integer("player_id"),

  // Target asset metadata (what the user is requesting)
  gameId:             varchar("game_id", { length: 32 }).notNull(),
  platform:           varchar("platform", { length: 32 }).notNull(),
  externalAccountRef: text("external_account_ref"),
  externalUsername:   text("external_username"),
  externalProfileUrl: text("external_profile_url"),
  requestedAssetType: varchar("requested_asset_type", { length: 64 }).notNull().default("pro_player_card"),
  notes:              text("notes"),

  // Lifecycle
  status:             varchar("status", { length: 16 }).notNull().default("pending").$type<AssetRequestStatus>(),
  reviewedByUserId:   varchar("reviewed_by_user_id"),
  reviewNotes:        text("review_notes"),

  createdAt:          timestamp("created_at").defaultNow().notNull(),
  updatedAt:          timestamp("updated_at").defaultNow().notNull(),
  resolvedAt:         timestamp("resolved_at"),
}, (t) => [
  index("player_asset_requests_user_idx").on(t.requestedByUserId),
  index("player_asset_requests_status_idx").on(t.status),
  index("player_asset_requests_game_idx").on(t.gameId),
]);

export type PlayerAssetRequest = typeof playerAssetRequests.$inferSelect;
export type InsertPlayerAssetRequest = typeof playerAssetRequests.$inferInsert;

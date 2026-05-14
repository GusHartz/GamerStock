import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, numeric, pgTable, timestamp, unique, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "@shared/models/auth";

export const draftWeeks = pgTable("draft_weeks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  game: varchar("game").notNull(),
  region: varchar("region").notNull(),
  startAt: timestamp("start_at").notNull(),
  lockAt: timestamp("lock_at").notNull(),
  endAt: timestamp("end_at").notNull(),
  status: varchar("status").notNull().default("open"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const draftEntries = pgTable("draft_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  weekId: varchar("week_id").notNull().references(() => draftWeeks.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  lockedAt: timestamp("locked_at"),
  totalScore: numeric("total_score", { precision: 10, scale: 4 }).notNull().default("0"),
  roleScore: numeric("role_score", { precision: 10, scale: 4 }).notNull().default("0"),
  performanceScore: numeric("performance_score", { precision: 10, scale: 4 }).notNull().default("0"),
  status: varchar("status").notNull().default("open"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  unique("draft_entries_week_user_unique").on(t.weekId, t.userId),
  index("draft_entries_user_id_idx").on(t.userId),
]);

export const draftEntryPicks = pgTable("draft_entry_picks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  draftEntryId: varchar("draft_entry_id").notNull().references(() => draftEntries.id),
  slotType: varchar("slot_type").notNull(),
  roleCode: varchar("role_code"),
  playerId: varchar("player_id").notNull(),
  score: numeric("score", { precision: 10, scale: 4 }).notNull().default("0"),
  scoreBreakdownJson: jsonb("score_breakdown_json"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("draft_entry_picks_player_id_idx").on(t.playerId),
]);

export const draftPlayerWeekMetrics = pgTable("draft_player_week_metrics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  playerId: varchar("player_id").notNull(),
  weekId: varchar("week_id").notNull().references(() => draftWeeks.id),
  roleCode: varchar("role_code").notNull(),
  matchesCount: integer("matches_count").notNull().default(0),
  avgMatchScore: numeric("avg_match_score", { precision: 10, scale: 4 }).notNull().default("0"),
  weeklyPerformanceScore: numeric("weekly_performance_score", { precision: 10, scale: 4 }).notNull().default("0"),
  pviStart: numeric("pvi_start", { precision: 10, scale: 4 }),
  pviEnd: numeric("pvi_end", { precision: 10, scale: 4 }),
  pviDelta: numeric("pvi_delta", { precision: 10, scale: 4 }),
  fairValueStart: numeric("fair_value_start", { precision: 10, scale: 4 }),
  fairValueEnd: numeric("fair_value_end", { precision: 10, scale: 4 }),
  marketPriceStart: numeric("market_price_start", { precision: 10, scale: 4 }),
  marketPriceEnd: numeric("market_price_end", { precision: 10, scale: 4 }),
  undervaluationLevel: numeric("undervaluation_level", { precision: 10, scale: 4 }),
  breakoutScore: numeric("breakout_score", { precision: 10, scale: 4 }),
  risingStarScore: numeric("rising_star_score", { precision: 10, scale: 4 }),
  hiddenGemScore: numeric("hidden_gem_score", { precision: 10, scale: 4 }),
  eligible: boolean("eligible").notNull().default(false),
  computedAt: timestamp("computed_at"),
}, (t) => [
  unique("draft_pw_metrics_player_week_uq").on(t.playerId, t.weekId),
  index("draft_player_week_metrics_player_id_idx").on(t.playerId),
  index("draft_player_week_metrics_week_id_idx").on(t.weekId),
]);

export const draftUserSeasonStats = pgTable("draft_user_season_stats", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  seasonId: varchar("season_id").notNull(),
  draftScoreTotal: numeric("draft_score_total", { precision: 10, scale: 4 }).notNull().default("0"),
  draftWeeksPlayed: integer("draft_weeks_played").notNull().default(0),
  avgDraftScore: numeric("avg_draft_score", { precision: 10, scale: 4 }).notNull().default("0"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertDraftWeekSchema = createInsertSchema(draftWeeks).omit({ id: true, createdAt: true });
export type InsertDraftWeek = z.infer<typeof insertDraftWeekSchema>;
export type DraftWeek = typeof draftWeeks.$inferSelect;

export const insertDraftEntrySchema = createInsertSchema(draftEntries).omit({ id: true, createdAt: true });
export type InsertDraftEntry = z.infer<typeof insertDraftEntrySchema>;
export type DraftEntry = typeof draftEntries.$inferSelect;

export const insertDraftEntryPickSchema = createInsertSchema(draftEntryPicks).omit({ id: true, createdAt: true });
export type InsertDraftEntryPick = z.infer<typeof insertDraftEntryPickSchema>;
export type DraftEntryPick = typeof draftEntryPicks.$inferSelect;

export const insertDraftPlayerWeekMetricsSchema = createInsertSchema(draftPlayerWeekMetrics).omit({ id: true });
export type InsertDraftPlayerWeekMetrics = z.infer<typeof insertDraftPlayerWeekMetricsSchema>;
export type DraftPlayerWeekMetrics = typeof draftPlayerWeekMetrics.$inferSelect;

export const insertDraftUserSeasonStatsSchema = createInsertSchema(draftUserSeasonStats).omit({ id: true, createdAt: true });
export type InsertDraftUserSeasonStats = z.infer<typeof insertDraftUserSeasonStatsSchema>;
export type DraftUserSeasonStats = typeof draftUserSeasonStats.$inferSelect;

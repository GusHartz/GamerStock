// ─── Arena Domain ─────────────────────────────────────────────────────────────
// Profiles, stats, events, achievements, seasons, badges, duels, follows, draft
// ─────────────────────────────────────────────────────────────────────────────
import { z } from "zod";
import {
  pgTable, serial, text, integer, numeric, timestamp, varchar,
  jsonb, unique, index, primaryKey,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { users } from "./auth";

// ===== Arena: Trader Profiles, Stats, and Events =====

export const arenaProfiles = pgTable("arena_profiles", {
  userId: varchar("user_id").primaryKey().references(() => users.id),
  avatarUrl: text("avatar_url"),
  avatarId: text("avatar_id").default("avatar_01"),
  bio: text("bio"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const arenaUserStats = pgTable("arena_user_stats", {
  userId: varchar("user_id").primaryKey().references(() => users.id),
  xpTotal: integer("xp_total").notNull().default(0),
  rank: text("rank").notNull().default("Bronze"),
  realizedProfitTotal: numeric("realized_profit_total", { precision: 18, scale: 6 }).notNull().default("0"),
  tradesTotal: integer("trades_total").notNull().default(0),
  winTrades: integer("win_trades").notNull().default(0),
  lossTrades: integer("loss_trades").notNull().default(0),
  bestTradePnl: numeric("best_trade_pnl", { precision: 18, scale: 6 }),
  worstTradePnl: numeric("worst_trade_pnl", { precision: 18, scale: 6 }),
  winStreakCurrent: integer("win_streak_current").notNull().default(0),
  winStreakBest: integer("win_streak_best").notNull().default(0),
  lossStreakCurrent: integer("loss_streak_current").notNull().default(0),
  traderStyle: text("trader_style"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("arena_user_stats_xp_idx").on(t.xpTotal),
  index("arena_user_stats_profit_idx").on(t.realizedProfitTotal),
  index("arena_user_stats_trades_idx").on(t.tradesTotal),
]);

export const arenaEvents = pgTable("arena_events", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  type: text("type").notNull(),
  xpDelta: integer("xp_delta").notNull().default(0),
  metaJson: jsonb("meta_json"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("arena_events_user_idx").on(t.userId),
]);

export const achievementsCatalog = pgTable("achievements_catalog", {
  code: varchar("code").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  iconKey: text("icon_key").notNull().default("trophy"),
  rarity: text("rarity").notNull().default("common"),
  xpReward: integer("xp_reward").notNull().default(0),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const userAchievements = pgTable("user_achievements", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  achievementCode: varchar("achievement_code").notNull().references(() => achievementsCatalog.code),
  unlockedAt: timestamp("unlocked_at").defaultNow().notNull(),
  metaJson: jsonb("meta_json"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  unique("user_achievements_user_code_uq").on(t.userId, t.achievementCode),
  index("user_achievements_user_unlocked_idx").on(t.userId, t.unlockedAt),
]);

export type ArenaProfile = typeof arenaProfiles.$inferSelect;
export type ArenaUserStats = typeof arenaUserStats.$inferSelect;
export type ArenaEvent = typeof arenaEvents.$inferSelect;
export type AchievementsCatalog = typeof achievementsCatalog.$inferSelect;
export type UserAchievement = typeof userAchievements.$inferSelect;

// ===== Arena Seasons =====

export const arenaSeasons = pgTable("arena_seasons", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  startsAt: timestamp("starts_at").notNull(),
  endsAt: timestamp("ends_at").notNull(),
  status: text("status").notNull().default("upcoming"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("arena_seasons_status_idx").on(t.status),
  index("arena_seasons_starts_at_idx").on(t.startsAt),
  index("arena_seasons_ends_at_idx").on(t.endsAt),
]);

export const arenaUserSeasonStats = pgTable("arena_user_season_stats", {
  seasonId: integer("season_id").notNull().references(() => arenaSeasons.id),
  userId: text("user_id").notNull(),
  xpSeason: integer("xp_season").notNull().default(0),
  rankSeason: text("rank_season").notNull().default("Bronze"),
  realizedProfitSeason: numeric("realized_profit_season", { precision: 18, scale: 6 }).notNull().default("0"),
  tradesSeason: integer("trades_season").notNull().default(0),
  winTradesSeason: integer("win_trades_season").notNull().default(0),
  lossTradesSeason: integer("loss_trades_season").notNull().default(0),
  bestTradePnlSeason: numeric("best_trade_pnl_season", { precision: 18, scale: 6 }),
  worstTradePnlSeason: numeric("worst_trade_pnl_season", { precision: 18, scale: 6 }),
  winStreakCurrentSeason: integer("win_streak_current_season").notNull().default(0),
  winStreakBestSeason: integer("win_streak_best_season").notNull().default(0),
  lossStreakCurrentSeason: integer("loss_streak_current_season").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  primaryKey({ columns: [t.seasonId, t.userId] }),
  index("arena_season_stats_xp_idx").on(t.seasonId, t.xpSeason),
  index("arena_season_stats_profit_idx").on(t.seasonId, t.realizedProfitSeason),
  index("arena_season_stats_wins_idx").on(t.seasonId, t.winTradesSeason),
]);

export const arenaSeasonLeaderboardSnapshot = pgTable("arena_season_leaderboard_snapshot", {
  id: serial("id").primaryKey(),
  seasonId: integer("season_id").notNull().references(() => arenaSeasons.id),
  metric: text("metric").notNull(),
  userId: text("user_id").notNull(),
  rankPosition: integer("rank_position").notNull(),
  value: numeric("value", { precision: 18, scale: 6 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("arena_snapshot_season_metric_rank_idx").on(t.seasonId, t.metric, t.rankPosition),
]);

export const arenaBadges = pgTable("arena_badges", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  iconKey: text("icon_key").notNull(),
  rarity: text("rarity").notNull().default("common"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const userBadges = pgTable("user_badges", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  badgeCode: text("badge_code").notNull().references(() => arenaBadges.code),
  metaJson: jsonb("meta_json"),
  awardedAt: timestamp("awarded_at").defaultNow().notNull(),
}, (t) => [
  unique("user_badges_user_badge_unique").on(t.userId, t.badgeCode),
  index("user_badges_user_idx").on(t.userId),
]);

// Season reward tiers — configured per season by admins
export const seasonRewards = pgTable("season_rewards", {
  id: serial("id").primaryKey(),
  seasonId: integer("season_id").notNull().references(() => arenaSeasons.id, { onDelete: "cascade" }),
  rankMin: integer("rank_min").notNull(),
  rankMax: integer("rank_max").notNull(),
  badgeCode: text("badge_code").notNull().references(() => arenaBadges.code),
  label: text("label"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("season_rewards_season_idx").on(t.seasonId),
]);

// Audit log of season reward distributions — prevents double-awarding
export const seasonRewardDistributions = pgTable("season_reward_distributions", {
  id: serial("id").primaryKey(),
  seasonId: integer("season_id").notNull().references(() => arenaSeasons.id),
  userId: text("user_id").notNull(),
  badgeCode: text("badge_code").notNull(),
  finalRank: integer("final_rank"),
  metaJson: jsonb("meta_json"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  unique("season_reward_dist_unique").on(t.seasonId, t.userId, t.badgeCode),
  index("season_reward_dist_season_idx").on(t.seasonId),
]);

// Weekly / limited-time challenges
export const arenaChallenges = pgTable("arena_challenges", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  type: text("type").notNull(),
  target: integer("target").notNull(),
  rewardXp: integer("reward_xp").notNull().default(0),
  startsAt: timestamp("starts_at").notNull(),
  endsAt: timestamp("ends_at").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("arena_challenges_status_idx").on(t.status),
  index("arena_challenges_dates_idx").on(t.startsAt, t.endsAt),
]);

export type ArenaSeason = typeof arenaSeasons.$inferSelect;
export type ArenaUserSeasonStats = typeof arenaUserSeasonStats.$inferSelect;
export type ArenaSeasonLeaderboardSnapshot = typeof arenaSeasonLeaderboardSnapshot.$inferSelect;
export type ArenaBadge = typeof arenaBadges.$inferSelect;
export type UserBadge = typeof userBadges.$inferSelect;
export type SeasonReward = typeof seasonRewards.$inferSelect;
export type SeasonRewardDistribution = typeof seasonRewardDistributions.$inferSelect;
export type ArenaChallenge = typeof arenaChallenges.$inferSelect;

export const insertArenaSeasonSchema = createInsertSchema(arenaSeasons).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertArenaSeason = z.infer<typeof insertArenaSeasonSchema>;

export const insertArenaChallengeSchema = createInsertSchema(arenaChallenges).omit({ id: true, createdAt: true });
export type InsertArenaChallenge = z.infer<typeof insertArenaChallengeSchema>;

// ===== Arena Phase 4 — Social Competition =====

// Follow system: who follows whom
export const arenaTraderFollows = pgTable("arena_trader_follows", {
  id: serial("id").primaryKey(),
  followerUserId: text("follower_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  followedUserId: text("followed_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  unique("arena_follows_unique").on(t.followerUserId, t.followedUserId),
  index("arena_follows_follower_idx").on(t.followerUserId),
  index("arena_follows_followed_idx").on(t.followedUserId),
]);

// Direct trader duels
export const arenaDuels = pgTable("arena_duels", {
  id: serial("id").primaryKey(),
  challengerUserId: text("challenger_user_id").notNull().references(() => users.id),
  opponentUserId: text("opponent_user_id").notNull().references(() => users.id),
  metric: text("metric").notNull().default("highest_profit"),
  durationDays: integer("duration_days").notNull().default(7),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  status: text("status").notNull().default("pending"),
  winnerUserId: text("winner_user_id"),
  resultType: text("result_type"),
  challengerSnapshot: jsonb("challenger_snapshot"),
  opponentSnapshot: jsonb("opponent_snapshot"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("arena_duels_challenger_idx").on(t.challengerUserId),
  index("arena_duels_opponent_idx").on(t.opponentUserId),
  index("arena_duels_status_idx").on(t.status),
]);

export type ArenaTraderFollow = typeof arenaTraderFollows.$inferSelect;
export type ArenaDuel = typeof arenaDuels.$inferSelect;

// ---------------------------------------------------------------------------
// Draft module — Weekly Performance Draft (re-exported from server module)
// ---------------------------------------------------------------------------
export {
  draftWeeks,
  draftEntries,
  draftEntryPicks,
  draftPlayerWeekMetrics,
  draftUserSeasonStats,
  insertDraftWeekSchema,
  insertDraftEntrySchema,
  insertDraftEntryPickSchema,
  insertDraftPlayerWeekMetricsSchema,
  insertDraftUserSeasonStatsSchema,
} from "../../server/modules/draft/draft.schema";

// ─── Performance Domain ───────────────────────────────────────────────────────
// Role baselines, metric weights, match metrics, performance scores
// ─────────────────────────────────────────────────────────────────────────────
import { z } from "zod";
import {
  pgTable, serial, text, integer, numeric, timestamp, jsonb, unique, index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

// ===== Role-Based Performance Engine =====

export const roleBaselines = pgTable("role_baselines", {
  id: serial("id").primaryKey(),
  game: text("game").notNull(),
  queue: text("queue").notNull().default("RANKED_SOLO"),
  tier: text("tier").notNull().default("CHALLENGER"),
  role: text("role").notNull(),
  metric: text("metric").notNull(),
  meanValue: numeric("mean_value", { precision: 12, scale: 4 }).notNull(),
  stdDev: numeric("std_dev", { precision: 12, scale: 4 }).notNull(),
  sampleSize: integer("sample_size").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  unique("role_baselines_unique").on(t.game, t.queue, t.tier, t.role, t.metric),
  index("role_baselines_role_idx").on(t.game, t.role),
]);

export type RoleBaseline = typeof roleBaselines.$inferSelect;
export const insertRoleBaselineSchema = createInsertSchema(roleBaselines).omit({ id: true, updatedAt: true });
export type InsertRoleBaseline = z.infer<typeof insertRoleBaselineSchema>;

export const roleMetricWeights = pgTable("role_metric_weights", {
  id: serial("id").primaryKey(),
  game: text("game").notNull(),
  role: text("role").notNull(),
  metric: text("metric").notNull(),
  weight: numeric("weight", { precision: 6, scale: 4 }).notNull(),
}, (t) => [
  unique("role_metric_weights_unique").on(t.game, t.role, t.metric),
  index("role_metric_weights_role_idx").on(t.game, t.role),
]);

export type RoleMetricWeight = typeof roleMetricWeights.$inferSelect;
export const insertRoleMetricWeightSchema = createInsertSchema(roleMetricWeights).omit({ id: true });
export type InsertRoleMetricWeight = z.infer<typeof insertRoleMetricWeightSchema>;

export const playerMatchMetrics = pgTable("player_match_metrics", {
  id: serial("id").primaryKey(),
  assetId: text("asset_id").notNull(),
  matchId: text("match_id").notNull(),
  game: text("game").notNull().default("LOL"),
  role: text("role").notNull(),
  metricsJson: jsonb("metrics_json").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  unique("player_match_metrics_unique").on(t.matchId, t.assetId),
  index("player_match_metrics_asset_idx").on(t.assetId),
  index("player_match_metrics_created_idx").on(t.createdAt),
]);

export type PlayerMatchMetric = typeof playerMatchMetrics.$inferSelect;

export const performanceScores = pgTable("performance_scores", {
  id: serial("id").primaryKey(),
  assetId: text("asset_id").notNull(),
  matchId: text("match_id").notNull(),
  role: text("role").notNull(),
  matchScore: numeric("match_score", { precision: 8, scale: 4 }).notNull(),
  emaScore: numeric("ema_score", { precision: 8, scale: 4 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("performance_scores_asset_idx").on(t.assetId),
  index("performance_scores_created_idx").on(t.createdAt),
]);

export type PerformanceScore = typeof performanceScores.$inferSelect;

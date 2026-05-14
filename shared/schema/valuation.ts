// ─── Valuation Domain ─────────────────────────────────────────────────────────
// PVI / fair value state per asset
// ─────────────────────────────────────────────────────────────────────────────
import { pgTable, integer, numeric, timestamp, text, index } from "drizzle-orm/pg-core";
import { assets } from "./player";

// ===== PVI — Asset Valuation State =====
/**
 * Stores the computed PVI (Player Value Index) and derived Fair Value for each riot asset.
 * Updated by the valuation job when new match data arrives.
 * Market Price is NOT stored here — it lives in assetMarketState / riotAssets.
 */
export const assetValuationState = pgTable("asset_valuation_state", {
  assetId: integer("asset_id").primaryKey().references(() => assets.id),
  puuid: text("puuid").notNull(),
  // PVI components (0-100)
  recentPerformance: numeric("recent_performance", { precision: 8, scale: 4 }).notNull().default("50.0000"),
  consistencyScore: numeric("consistency_score", { precision: 8, scale: 4 }).notNull().default("50.0000"),
  historicalSkill: numeric("historical_skill", { precision: 8, scale: 4 }).notNull().default("50.0000"),
  activityScore: numeric("activity_score", { precision: 8, scale: 4 }).notNull().default("50.0000"),
  // PVI values (0-100)
  pviRaw: numeric("pvi_raw", { precision: 8, scale: 4 }).notNull().default("50.0000"),
  pviFinal: numeric("pvi_final", { precision: 8, scale: 4 }).notNull().default("50.0000"),
  pviAdjusted: numeric("pvi_adjusted", { precision: 8, scale: 4 }).notNull().default("50.0000"),
  // Confidence (0-1)
  confidenceScore: numeric("confidence_score", { precision: 6, scale: 4 }).notNull().default("0.0000"),
  // Derived values
  fairValueGS: numeric("fair_value_gs", { precision: 10, scale: 4 }).notNull().default("5.0000"),
  divergencePct: numeric("divergence_pct", { precision: 10, scale: 4 }).notNull().default("0.0000"),
  lastMatchPulse: numeric("last_match_pulse", { precision: 8, scale: 4 }).notNull().default("50.0000"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("asset_valuation_puuid_idx").on(t.puuid),
  index("asset_valuation_updated_idx").on(t.updatedAt),
]);

export type AssetValuationState = typeof assetValuationState.$inferSelect;

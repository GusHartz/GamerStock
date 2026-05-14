// ─── Market Domain ────────────────────────────────────────────────────────────
// AMM market state, trigger orders, price snapshots, idempotency, sync logs,
// app config, news impact
// ─────────────────────────────────────────────────────────────────────────────
import { z } from "zod";
import {
  pgTable, serial, text, integer, numeric, timestamp, boolean,
  varchar, jsonb, uniqueIndex, unique, index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { assets } from "./player";
import { users } from "./auth";

// --- App Config (key-value store for server settings) ---
export const appConfig = pgTable("app_config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ===== Canonical Market AMM Engine =====
export const assetMarkets = pgTable("asset_markets", {
  assetId: integer("asset_id").primaryKey().references(() => assets.id),
  curveType: text("curve_type").notNull().default("LOG"),
  floorPrice: numeric("floor_price", { precision: 18, scale: 6 }).notNull().default("5.000000"),
  paramA: numeric("param_a", { precision: 18, scale: 6 }).notNull().default("5.000000"),
  paramB: numeric("param_b", { precision: 18, scale: 6 }).notNull().default("100.000000"),
  feeBps: integer("fee_bps").notNull().default(100),
  platformFeeSplitBps: integer("platform_fee_split_bps").notNull().default(7000),
  playerFeeSplitBps: integer("player_fee_split_bps").notNull().default(3000),
  isEnabled: boolean("is_enabled").notNull().default(true),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const assetMarketState = pgTable("asset_market_state", {
  assetId: integer("asset_id").primaryKey().references(() => assets.id),
  supply: numeric("supply", { precision: 18, scale: 6 }).notNull().default("0.000000"),
  lastPrice: numeric("last_price", { precision: 18, scale: 6 }).notNull().default("10.000000"),
  lastUpdatedAt: timestamp("last_updated_at").defaultNow().notNull(),
  version: integer("version").notNull().default(0),
});

export type AssetMarket = typeof assetMarkets.$inferSelect;
export type AssetMarketState = typeof assetMarketState.$inferSelect;

// ===== Asset Price Snapshots =====
export const assetPriceSnapshots = pgTable("asset_price_snapshots", {
  id: serial("id").primaryKey(),
  assetId: integer("asset_id").notNull().references(() => assets.id),
  price: numeric("price", { precision: 10, scale: 2 }).notNull(),
  volume24h: numeric("volume_24h", { precision: 15, scale: 2 }).notNull().default("0.00"),
  momentum: numeric("momentum", { precision: 8, scale: 4 }).notNull().default("0.0000"),
  recordedAt: timestamp("recorded_at").defaultNow().notNull(),
}, (t) => [
  index("asset_snap_asset_time_idx").on(t.assetId, t.recordedAt),
]);

export type AssetPriceSnapshot = typeof assetPriceSnapshots.$inferSelect;

// ===== Idempotency Keys (duplicate trade prevention) =====
export const idempotencyKeys = pgTable("idempotency_keys", {
  id: serial("id").primaryKey(),
  key: text("key").notNull(),
  userId: text("user_id").notNull(),
  endpoint: text("endpoint").notNull(),
  response: jsonb("response"),
  status: text("status").notNull().default("completed"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  uniqueIndex("idempotency_unique").on(t.key, t.userId, t.endpoint),
]);

// ===== Market Sync Run Log =====
export const marketSyncRuns = pgTable("market_sync_runs", {
  id: serial("id").primaryKey(),
  marketId: integer("market_id").notNull(),
  startedAt: timestamp("started_at").notNull(),
  finishedAt: timestamp("finished_at"),
  durationMs: integer("duration_ms"),
  status: text("status").notNull(),
  rowsFetched: integer("rows_fetched"),
  rowsUpdated: integer("rows_updated"),
  errorMessage: text("error_message"),
});

export type MarketSyncRun = typeof marketSyncRuns.$inferSelect;

// ===== Market Sync Circuit Breaker Status =====
export const marketSyncStatus = pgTable("market_sync_status", {
  marketId: integer("market_id").primaryKey(),
  lastSuccessAt: timestamp("last_success_at"),
  consecutiveFailures: integer("consecutive_failures").default(0),
  pausedUntil: timestamp("paused_until"),
  lastError: text("last_error"),
});

export type MarketSyncStatus = typeof marketSyncStatus.$inferSelect;

// ===== Trigger Orders (Limit / Stop Loss / Take Profit) =====
export const triggerOrders = pgTable("trigger_orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  assetId: text("asset_id").notNull(),
  mode: text("mode").notNull().default("SANDBOX"),
  side: text("side").notNull(),
  orderType: text("order_type").notNull(),
  triggerPrice: numeric("trigger_price", { precision: 18, scale: 6 }).notNull(),
  quantity: integer("quantity").notNull(),
  timeInForce: text("time_in_force").notNull().default("GTC"),
  status: text("status").notNull().default("OPEN"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  triggeredAt: timestamp("triggered_at"),
  executedAt: timestamp("executed_at"),
  lastError: text("last_error"),
  clientOrderId: text("client_order_id"),
  maxSlippageBps: integer("max_slippage_bps"),
  priceAtTrigger: numeric("price_at_trigger", { precision: 18, scale: 6 }),
  priceAtExecution: numeric("price_at_execution", { precision: 18, scale: 6 }),
}, (table) => [
  index("trigger_orders_status_mode_idx").on(table.status, table.mode),
  index("trigger_orders_asset_mode_idx").on(table.assetId, table.mode),
  index("trigger_orders_user_status_idx").on(table.userId, table.status),
  index("trigger_orders_mode_status_updated_idx").on(table.mode, table.status, table.updatedAt),
]);

export const triggerOrderEvents = pgTable("trigger_order_events", {
  id: serial("id").primaryKey(),
  orderId: varchar("order_id").notNull().references(() => triggerOrders.id),
  eventType: text("event_type").notNull(),
  metaJson: jsonb("meta_json"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("trigger_order_events_order_idx").on(table.orderId),
]);

export type TriggerOrder = typeof triggerOrders.$inferSelect;
export type TriggerOrderEvent = typeof triggerOrderEvents.$inferSelect;
export const insertTriggerOrderSchema = createInsertSchema(triggerOrders).omit({ id: true, createdAt: true, updatedAt: true, triggeredAt: true, executedAt: true, lastError: true, priceAtTrigger: true, priceAtExecution: true, status: true });
export type InsertTriggerOrder = z.infer<typeof insertTriggerOrderSchema>;

// ===== News Impact Engine =====
export const newsEvents = pgTable("news_events", {
  id: serial("id").primaryKey(),
  externalId: varchar("external_id", { length: 255 }).notNull().unique(),
  title: text("title").notNull(),
  summary: text("summary"),
  source: varchar("source", { length: 100 }),
  sourceUrl: text("source_url"),
  game: varchar("game", { length: 50 }),
  category: varchar("category", { length: 100 }),
  eventType: varchar("event_type", { length: 50 }),
  sentiment: varchar("sentiment", { length: 20 }),
  impactLevel: varchar("impact_level", { length: 20 }),
  entityTags: jsonb("entity_tags"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("news_events_external_id_idx").on(t.externalId),
  index("news_events_published_at_idx").on(t.publishedAt),
  index("news_events_sentiment_idx").on(t.sentiment),
  index("news_events_game_idx").on(t.game),
]);

export type NewsEvent = typeof newsEvents.$inferSelect;
export const insertNewsEventSchema = createInsertSchema(newsEvents).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertNewsEvent = z.infer<typeof insertNewsEventSchema>;

export const assetNewsPulses = pgTable("asset_news_pulses", {
  id: serial("id").primaryKey(),
  assetId: integer("asset_id").references(() => assets.id),
  newsEventId: integer("news_event_id").references(() => newsEvents.id),
  direction: varchar("direction", { length: 20 }).notNull(),
  strength: numeric("strength", { precision: 6, scale: 4 }).notNull(),
  reason: text("reason"),
  decayUntil: timestamp("decay_until", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("asset_news_pulses_asset_idx").on(t.assetId),
  index("asset_news_pulses_news_event_idx").on(t.newsEventId),
  index("asset_news_pulses_decay_idx").on(t.decayUntil),
]);

export type AssetNewsPulse = typeof assetNewsPulses.$inferSelect;

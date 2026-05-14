// ─── Player Domain ────────────────────────────────────────────────────────────
// Riot players, canonical assets/markets, sandbox vaults
// ─────────────────────────────────────────────────────────────────────────────
import { z } from "zod";
import {
  pgTable, text, serial, integer, numeric, timestamp,
  boolean, index, unique, varchar, date,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { playerProfiles } from "./multigame";

// --- Enums and Base Types ---
export const RankTiers = ["Iron", "Bronze", "Silver", "Gold", "Platinum", "Emerald", "Diamond", "Master", "GM", "Challenger"] as const;
export const Regions = ["BR", "NA", "EUW", "EUNE", "KR", "LATAM", "OCE", "TR"] as const;

// --- Riot Assets (real market assets with simulated pricing) ---
export const riotAssets = pgTable("riot_assets", {
  puuid: text("puuid").primaryKey(),
  gameName: text("game_name").notNull(),
  tagLine: text("tag_line").notNull().default(""),
  leaguePoints: integer("league_points").notNull().default(0),
  wins: integer("wins").notNull().default(0),
  losses: integer("losses").notNull().default(0),
  winrate: numeric("winrate", { precision: 5, scale: 2 }).notNull().default("0.00"),
  lastTradePrice: numeric("last_trade_price", { precision: 10, scale: 2 }).notNull(),
  price24hAgo: numeric("price_24h_ago", { precision: 10, scale: 2 }).notNull(),
  volume24h: numeric("volume_24h", { precision: 15, scale: 2 }).notNull().default("0.00"),
  momentum: numeric("momentum", { precision: 8, scale: 4 }).notNull().default("0.0000"),
  lastSyncedAt: timestamp("last_synced_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("riot_asset_lp_idx").on(table.leaguePoints),
]);

export type RiotAsset = typeof riotAssets.$inferSelect;

// --- Riot Match Cache (processed match performance scores) ---
export const riotMatchCache = pgTable("riot_match_cache", {
  matchId: text("match_id").primaryKey(),
  puuid: text("puuid").notNull(),
  gameStartTimestamp: numeric("game_start_timestamp", { precision: 15, scale: 0 }).notNull().default("0"),
  processedAt: timestamp("processed_at").defaultNow().notNull(),
  teamPosition: text("team_position").notNull().default(""),
  perfScore: numeric("perf_score", { precision: 6, scale: 2 }).notNull().default("50.00"),
}, (table) => [
  index("match_cache_puuid_idx").on(table.puuid),
]);

export type RiotMatchCacheRow = typeof riotMatchCache.$inferSelect;

// --- Riot Player State (EMA + daily circuit breaker) ---
export const riotPlayerState = pgTable("riot_player_state", {
  puuid: text("puuid").primaryKey(),
  emaPerf: numeric("ema_perf", { precision: 6, scale: 2 }).notNull().default("50.00"),
  dayStartPrice: numeric("day_start_price", { precision: 10, scale: 2 }).notNull().default("10.00"),
  dayStartDate: date("day_start_date").notNull().default(sql`CURRENT_DATE`),
  dailyChangePct: numeric("daily_change_pct", { precision: 8, scale: 4 }).notNull().default("0.0000"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// --- Riot Players (real data) ---
export const riotPlayers = pgTable("riot_players", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  platform: text("platform").notNull().default("NA1"),
  queue: text("queue").notNull().default("RANKED_SOLO_5x5"),
  summonerId: text("summoner_id").notNull(),
  summonerName: text("summoner_name").notNull(),
  leaguePoints: integer("league_points").notNull().default(0),
  wins: integer("wins").notNull().default(0),
  losses: integer("losses").notNull().default(0),
  winrate: numeric("winrate", { precision: 5, scale: 2 }).notNull().default("0.00"),
  tier: text("tier").notNull().default("CHALLENGER"),
  rank: text("rank").notNull().default("I"),
  lastSyncedAt: timestamp("last_synced_at").defaultNow().notNull(),
}, (table) => [
  unique("riot_player_platform_queue_summoner").on(table.platform, table.queue, table.summonerId),
  index("riot_player_lp_idx").on(table.leaguePoints),
]);

export type RiotPlayer = typeof riotPlayers.$inferSelect;
export type InsertRiotPlayer = typeof riotPlayers.$inferInsert;

// ===== Canonical Market Core (multi-provider / multi-game) =====
export const markets = pgTable("markets", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull(),
  game: text("game").notNull(),
  region: text("region").notNull().default("global"),
  scope: text("scope").notNull().default("default"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  unique("markets_provider_game_region_scope_unique").on(t.provider, t.game, t.region, t.scope),
  index("markets_provider_game_idx").on(t.provider, t.game),
]);

export const assets = pgTable("assets", {
  id: serial("id").primaryKey(),
  marketId: integer("market_id").notNull().references(() => markets.id),
  assetUid: text("asset_uid").notNull(),
  entityType: text("entity_type").notNull(),
  externalId: text("external_id").notNull(),
  displayName: text("display_name").notNull(),
  symbol: text("symbol").notNull().default(""),
  lastTradePrice: numeric("last_trade_price", { precision: 10, scale: 2 }).notNull().default("10.00"),
  price24hAgo: numeric("price_24h_ago", { precision: 10, scale: 2 }).notNull().default("10.00"),
  volume24h: numeric("volume_24h", { precision: 15, scale: 2 }).notNull().default("0.00"),
  momentum: numeric("momentum", { precision: 8, scale: 4 }).notNull().default("0.0000"),
  providerJson: text("provider_json"),
  lastSyncedAt: timestamp("last_synced_at").defaultNow().notNull(),
  fundamentalPrice: numeric("fundamental_price", { precision: 18, scale: 6 }),
  fundamentalUpdatedAt: timestamp("fundamental_updated_at"),
  // ── Multigame Fase 1: canonical identity link ─────────────────────────────
  // Null for legacy LoL assets (pre-Fase 1). Set in Fase 2 after PlayerProfile
  // rows are created for existing LoL assets.
  playerProfileId: integer("player_profile_id")
    .references(() => playerProfiles.id, { onDelete: "set null" }),
  tradingStatus: varchar("trading_status", { length: 32 }).default("ACTIVE"),
  listingStatus: varchar("listing_status", { length: 32 }).default("LISTED"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  unique("assets_asset_uid_unique").on(t.assetUid),
  index("assets_market_idx").on(t.marketId),
  index("assets_price_idx").on(t.lastTradePrice),
  index("assets_player_profile_idx").on(t.playerProfileId),
]);

export type Market = typeof markets.$inferSelect;
export type Asset = typeof assets.$inferSelect;

// --- Sandbox Vaults (simulated player assets) ---
export const vaults = pgTable("vaults", {
  id: serial("id").primaryKey(),
  playerAlias: text("player_alias").notNull(),
  rank: text("rank", { enum: RankTiers }).notNull(),
  region: text("region", { enum: Regions }).notNull(),
  winrate: numeric("winrate", { precision: 5, scale: 2 }).notNull(),
  performanceIndex: numeric("performance_index", { precision: 10, scale: 2 }).notNull().default("100.00"),
  momentum: numeric("momentum", { precision: 5, scale: 2 }).notNull().default("0.00"),
  lastTradePrice: numeric("last_trade_price", { precision: 10, scale: 2 }).notNull(),
  price24hAgo: numeric("price_24h_ago", { precision: 10, scale: 2 }).notNull().default("10.00"),
  volume24h: numeric("volume_24h", { precision: 15, scale: 2 }).notNull().default("0.00"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  assetId: integer("asset_id").references(() => assets.id),
});

// Snapshots of the vault's price and performance for charts
export const vaultSnapshots = pgTable("vault_snapshots", {
  id: serial("id").primaryKey(),
  vaultId: integer("vault_id").notNull().references(() => vaults.id),
  price: numeric("price", { precision: 10, scale: 2 }).notNull(),
  performanceIndex: numeric("performance_index", { precision: 10, scale: 2 }).notNull(),
  recordedAt: timestamp("recorded_at").defaultNow().notNull(),
});

export const insertVaultSchema = createInsertSchema(vaults).omit({ id: true, createdAt: true, updatedAt: true });
export type Vault = typeof vaults.$inferSelect;
export type InsertVault = z.infer<typeof insertVaultSchema>;
export type VaultSnapshot = typeof vaultSnapshots.$inferSelect;

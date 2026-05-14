// ─── Portfolio Domain ─────────────────────────────────────────────────────────
// Portfolios, positions (sandbox + riot + canonical), trades, ledger entries
// ─────────────────────────────────────────────────────────────────────────────
import { z } from "zod";
import {
  pgTable, serial, integer, numeric, timestamp, text, varchar,
  jsonb, index, unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { relations } from "drizzle-orm";
import { users } from "./auth";
import { vaults, vaultSnapshots, assets } from "./player";

export const portfolios = pgTable("portfolios", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id).unique(),
  balance: numeric("balance", { precision: 15, scale: 2 }).notNull().default("10000.00"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const positions = pgTable("positions", {
  id: serial("id").primaryKey(),
  portfolioId: integer("portfolio_id").notNull().references(() => portfolios.id),
  vaultId: integer("vault_id").notNull().references(() => vaults.id),
  assetId: integer("asset_id").references(() => assets.id),
  shares: integer("shares").notNull().default(0),
  averageCost: numeric("average_cost", { precision: 10, scale: 2 }).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("portfolio_vault_idx").on(table.portfolioId, table.vaultId),
  unique("portfolio_vault_unique").on(table.portfolioId, table.vaultId),
]);

export const trades = pgTable("trades", {
  id: serial("id").primaryKey(),
  portfolioId: integer("portfolio_id").notNull().references(() => portfolios.id),
  vaultId: integer("vault_id").notNull().references(() => vaults.id),
  assetId: integer("asset_id").references(() => assets.id),
  type: text("type", { enum: ["BUY", "SELL"] }).notNull(),
  shares: integer("shares").notNull(),
  pricePerShare: numeric("price_per_share", { precision: 10, scale: 2 }).notNull(),
  totalCost: numeric("total_cost", { precision: 15, scale: 2 }).notNull(),
  fee: numeric("fee", { precision: 10, scale: 2 }).notNull(),
  executedAt: timestamp("executed_at").defaultNow().notNull(),
});

// --- Riot Positions (user holdings of real Riot assets) ---
export const riotPositions = pgTable("riot_positions", {
  id: serial("id").primaryKey(),
  portfolioId: integer("portfolio_id").notNull().references(() => portfolios.id),
  puuid: text("puuid").notNull(),
  shares: integer("shares").notNull().default(0),
  averageCost: numeric("average_cost", { precision: 10, scale: 2 }).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("riot_pos_portfolio_idx").on(table.portfolioId),
  unique("riot_pos_unique").on(table.portfolioId, table.puuid),
]);

export type RiotPosition = typeof riotPositions.$inferSelect;

// --- Riot Trades (user-executed trades on real Riot assets) ---
export const riotTrades = pgTable("riot_trades", {
  id: serial("id").primaryKey(),
  portfolioId: integer("portfolio_id").notNull().references(() => portfolios.id),
  puuid: text("puuid").notNull(),
  type: text("type", { enum: ["BUY", "SELL"] }).notNull(),
  shares: integer("shares").notNull(),
  pricePerShare: numeric("price_per_share", { precision: 10, scale: 2 }).notNull(),
  totalCost: numeric("total_cost", { precision: 15, scale: 2 }).notNull(),
  fee: numeric("fee", { precision: 10, scale: 2 }).notNull(),
  executedAt: timestamp("executed_at").defaultNow().notNull(),
}, (table) => [
  index("riot_trade_portfolio_idx").on(table.portfolioId),
  index("riot_trade_puuid_idx").on(table.puuid),
]);

export type RiotTrade = typeof riotTrades.$inferSelect;

// --- Canonical Asset Positions (multigame — replaces riotPositions as primary path) ---
export const assetPositions = pgTable("asset_positions", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  assetId: integer("asset_id").notNull().references(() => assets.id),
  shares: integer("shares").notNull().default(0),
  averageCost: numeric("average_cost", { precision: 10, scale: 2 }).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("asset_pos_user_idx").on(table.userId),
  unique("asset_pos_unique").on(table.userId, table.assetId),
]);

export type AssetPosition = typeof assetPositions.$inferSelect;

// --- Canonical Asset Trades (multigame — replaces riotTrades as primary path) ---
export const assetTrades = pgTable("asset_trades", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  assetId: integer("asset_id").notNull().references(() => assets.id),
  type: text("type", { enum: ["BUY", "SELL"] }).notNull(),
  shares: integer("shares").notNull(),
  pricePerShare: numeric("price_per_share", { precision: 10, scale: 2 }).notNull(),
  grossValue: numeric("gross_value", { precision: 15, scale: 2 }).notNull(),
  fee: numeric("fee", { precision: 10, scale: 2 }).notNull(),
  executedAt: timestamp("executed_at").defaultNow().notNull(),
}, (table) => [
  index("asset_trade_user_idx").on(table.userId),
  index("asset_trade_asset_idx").on(table.assetId),
]);

export type AssetTrade = typeof assetTrades.$inferSelect;

// ===== Financial Ledger (immutable record of all balance changes) =====
export const ledgerEntries = pgTable("ledger_entries", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  portfolioId: integer("portfolio_id").notNull(),
  assetId: integer("asset_id"),
  type: text("type", { enum: ["debit", "credit"] }).notNull(),
  amount: numeric("amount", { precision: 18, scale: 6 }).notNull(),
  currency: text("currency").notNull(),
  referenceType: text("reference_type"),
  referenceId: integer("reference_id"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("ledger_user_idx").on(t.userId),
  index("ledger_portfolio_idx").on(t.portfolioId),
  index("ledger_reference_idx").on(t.referenceType, t.referenceId),
]);

export type LedgerEntry = typeof ledgerEntries.$inferSelect;

// --- Relations ---
export const vaultRelations = relations(vaults, ({ many }) => ({
  snapshots: many(vaultSnapshots),
  positions: many(positions),
  trades: many(trades),
}));

export const portfolioRelations = relations(portfolios, ({ one, many }) => ({
  user: one(users, {
    fields: [portfolios.userId],
    references: [users.id],
  }),
  positions: many(positions),
  trades: many(trades),
}));

export const positionRelations = relations(positions, ({ one }) => ({
  portfolio: one(portfolios, {
    fields: [positions.portfolioId],
    references: [portfolios.id],
  }),
  vault: one(vaults, {
    fields: [positions.vaultId],
    references: [vaults.id],
  }),
}));

export const tradeRelations = relations(trades, ({ one }) => ({
  portfolio: one(portfolios, {
    fields: [trades.portfolioId],
    references: [portfolios.id],
  }),
  vault: one(vaults, {
    fields: [trades.vaultId],
    references: [vaults.id],
  }),
}));

// --- Schemas & Types ---
export const insertPortfolioSchema = createInsertSchema(portfolios).omit({ id: true, updatedAt: true });
export type Portfolio = typeof portfolios.$inferSelect;
export type InsertPortfolio = z.infer<typeof insertPortfolioSchema>;

export const insertPositionSchema = createInsertSchema(positions).omit({ id: true, updatedAt: true });
export type Position = typeof positions.$inferSelect;

export type Trade = typeof trades.$inferSelect;

export const tradeWithVaultSchema = z.object({
  id: z.number(),
  portfolioId: z.number(),
  vaultId: z.number(),
  type: z.enum(["BUY", "SELL"]),
  shares: z.number(),
  pricePerShare: z.string(),
  totalCost: z.string(),
  fee: z.string(),
  executedAt: z.date(),
  vault: z.object({
    playerAlias: z.string(),
  }),
});

export type TradeWithVault = z.infer<typeof tradeWithVaultSchema>;

export const tradeRequestSchema = z.object({
  assetId: z.number().int().positive().optional(),
  vaultId: z.number().optional(),
  type: z.enum(["BUY", "SELL"]),
  shares: z.number().int().positive(),
});

export type TradeRequest = z.infer<typeof tradeRequestSchema>;

export interface TradeResponse {
  trade: Trade;
  newBalance: string;
  newShares: number;
}

export interface PortfolioPosition extends Position {
  vault: import("./player").Vault;
  currentValue: string;
  unrealizedPnL: string;
  unrealizedPnLPercent: string;
}

export interface PortfolioStats {
  balance: string;
  totalHoldingsValue: string;
  totalValue: string;
  realizedPnL: string;
}

export interface PortfolioDetailsResponse {
  portfolio: Portfolio;
  stats: PortfolioStats;
  positions: PortfolioPosition[];
}

export interface PaginatedVaultsResponse {
  data: import("./player").Vault[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface VaultDetailsResponse {
  vault: import("./player").Vault;
  snapshots: import("./player").VaultSnapshot[];
  userPosition?: Position;
}

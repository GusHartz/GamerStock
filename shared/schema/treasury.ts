// ─── Treasury Domain ──────────────────────────────────────────────────────────
// Fee ledger, player fee balances, system wallets, revenue share
// ─────────────────────────────────────────────────────────────────────────────
import {
  pgTable, serial, integer, numeric, timestamp, index, text, jsonb, unique, primaryKey,
} from "drizzle-orm/pg-core";
import { assets } from "./player";
import { CURRENCIES } from "./wallet";

// ─── System Wallet Types ──────────────────────────────────────────────────────

export const SYSTEM_WALLET_TYPES = [
  "platform_revenue",
  "player_pool",
  "liquidity_pool",
] as const;

export type SystemWalletType = (typeof SYSTEM_WALLET_TYPES)[number];

// ─── Fee Ledger ───────────────────────────────────────────────────────────────
// Immutable append-only record of every fee captured on a trade.
// Uses referenceType + referenceId (text) instead of a typed foreign key so
// both market-order trade IDs (integers) and limit-order trade IDs (strings)
// can be stored uniformly.

export const feeLedger = pgTable("fee_ledger", {
  id: serial("id").primaryKey(),
  referenceType: text("reference_type").notNull(),
  referenceId:   text("reference_id").notNull(),
  assetId:       integer("asset_id").references(() => assets.id),
  currency:      text("currency", { enum: CURRENCIES }).notNull().default("GS"),
  notional:      numeric("notional",       { precision: 18, scale: 6 }).notNull(),
  feeTotal:      numeric("fee_total",      { precision: 18, scale: 6 }).notNull(),
  platformFee:   numeric("platform_fee",   { precision: 18, scale: 6 }).notNull(),
  playerFee:     numeric("player_fee",     { precision: 18, scale: 6 }).notNull(),
  liquidityFee:  numeric("liquidity_fee",  { precision: 18, scale: 6 }).notNull(),
  createdAt:     timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("fee_ledger_asset_time_idx").on(t.assetId, t.createdAt),
  index("fee_ledger_ref_idx").on(t.referenceType, t.referenceId),
]);

// ─── Player Fee Balance ───────────────────────────────────────────────────────
// Running tally of accumulated player-pool fees per asset.
// Updated atomically alongside fee_ledger inserts.

export const playerFeeBalance = pgTable("player_fee_balance", {
  assetId:   integer("asset_id").primaryKey().references(() => assets.id),
  balance:   numeric("balance", { precision: 18, scale: 6 }).notNull().default("0.000000"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── System Wallets ───────────────────────────────────────────────────────────
// Platform-level balance projections for each revenue pool × currency.
// NOT linked to the users table — these are internal system accounts.
// One row per (walletType, currency) — 6 rows total (3 types × 2 currencies).

export const systemWallets = pgTable("system_wallets", {
  id:          serial("id").primaryKey(),
  walletType:  text("wallet_type",  { enum: SYSTEM_WALLET_TYPES }).notNull(),
  currency:    text("currency",     { enum: CURRENCIES }).notNull(),
  balance:     numeric("balance",   { precision: 18, scale: 6 }).notNull().default("0.000000"),
  updatedAt:   timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  unique("system_wallets_type_currency_unique").on(t.walletType, t.currency),
]);

// ─── System Wallet Ledger ─────────────────────────────────────────────────────
// Immutable audit trail for every credit/debit on a system wallet.
// Mirrors the role of wallet_ledger_entries for user wallets.

export const systemWalletLedger = pgTable("system_wallet_ledger", {
  id:            serial("id").primaryKey(),
  walletType:    text("wallet_type", { enum: SYSTEM_WALLET_TYPES }).notNull(),
  currency:      text("currency",    { enum: CURRENCIES }).notNull(),
  direction:     text("direction",   { enum: ["credit", "debit"] }).notNull(),
  amount:        numeric("amount",        { precision: 18, scale: 6 }).notNull(),
  balanceAfter:  numeric("balance_after", { precision: 18, scale: 6 }).notNull(),
  referenceType: text("reference_type"),
  referenceId:   text("reference_id"),
  description:   text("description"),
  metadata:      jsonb("metadata"),
  createdAt:     timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("swl_type_currency_idx").on(t.walletType, t.currency),
  index("swl_ref_idx").on(t.referenceType, t.referenceId),
]);

// ─── Player Earnings Balance ──────────────────────────────────────────────────
// Currency-aware projection of per-asset accrued player pool earnings.
// `accruedBalance` = total fees accrued to this player, NOT yet paid out.
// This is the authoritative cache — player_earnings_ledger is the source of truth.
// One row per (assetId, currency). Updated atomically with every ledger insert.
// NOTE: This supersedes the legacy player_fee_balance (GS-only, no ledger).

export const playerEarningsBalance = pgTable("player_earnings_balance", {
  assetId:        integer("asset_id").notNull().references(() => assets.id),
  currency:       text("currency", { enum: CURRENCIES }).notNull(),
  accruedBalance: numeric("accrued_balance", { precision: 18, scale: 6 })
    .notNull()
    .default("0.000000"),
  updatedAt:      timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  primaryKey({ columns: [t.assetId, t.currency] }),
  index("peb_asset_currency_idx").on(t.assetId, t.currency),
]);

// ─── Player Earnings Ledger ───────────────────────────────────────────────────
// Immutable append-only audit trail for every earnings credit (or future debit).
// Source of truth for player_earnings_balance.
//
// Idempotency: the unique constraint on
//   (assetId, currency, referenceType, referenceId, direction)
// ensures the same fee capture cannot accrue the same player earnings twice.
// direction is included in the key so a future debit ("payout") on the same
// referenceId is allowed to coexist alongside its matching credit.

export const playerEarningsLedger = pgTable("player_earnings_ledger", {
  id:            serial("id").primaryKey(),
  assetId:       integer("asset_id").notNull().references(() => assets.id),
  currency:      text("currency",   { enum: CURRENCIES }).notNull(),
  direction:     text("direction",  { enum: ["credit", "debit"] }).notNull(),
  amount:        numeric("amount",        { precision: 18, scale: 6 }).notNull(),
  balanceAfter:  numeric("balance_after", { precision: 18, scale: 6 }).notNull(),
  referenceType: text("reference_type").notNull(),
  referenceId:   text("reference_id").notNull(),
  createdAt:     timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  unique("pel_idempotency_key").on(
    t.assetId, t.currency, t.referenceType, t.referenceId, t.direction,
  ),
  index("pel_asset_currency_idx").on(t.assetId, t.currency),
  index("pel_ref_idx").on(t.referenceType, t.referenceId),
]);

// ─── TypeScript Types ─────────────────────────────────────────────────────────

export type FeeLedger             = typeof feeLedger.$inferSelect;
export type PlayerFeeBalance      = typeof playerFeeBalance.$inferSelect;
export type SystemWallet          = typeof systemWallets.$inferSelect;
export type SystemWalletLedger    = typeof systemWalletLedger.$inferSelect;
export type PlayerEarningsBalance = typeof playerEarningsBalance.$inferSelect;
export type PlayerEarningsLedger  = typeof playerEarningsLedger.$inferSelect;

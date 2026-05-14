import {
  pgTable, serial, integer, varchar, numeric, text, timestamp, jsonb,
  index, unique, check,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { users } from "./auth";

// ─── Currency & Entry Enums ───────────────────────────────────────────────────

export const CURRENCIES = ["GS", "USDC"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const ENTRY_TYPES = [
  "wallet_seed",
  "deposit",
  "withdrawal",
  "reward",
  "buy_hold",
  "buy_settle",
  "sell_settle",
  "fee_platform",
  "fee_player",
  "refund",
  "adjustment",
  "lock",
  "unlock",
] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

export const DIRECTIONS = ["credit", "debit"] as const;
export type Direction = (typeof DIRECTIONS)[number];

// ─── Wallets ──────────────────────────────────────────────────────────────────
// One row per (user, currency). Optimized balance cache — always consistent
// with the ledger. All mutations MUST occur inside a transaction that also
// writes a wallet_ledger_entries row.
//
// DB-level invariants (enforced via CHECK constraints):
//   available_balance >= 0
//   locked_balance    >= 0
//   total_balance     >= 0
//   total_balance      = available_balance + locked_balance

export const wallets = pgTable("wallets", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  currency: text("currency", { enum: CURRENCIES }).notNull(),
  availableBalance: numeric("available_balance", { precision: 18, scale: 6 }).notNull().default("0"),
  lockedBalance: numeric("locked_balance", { precision: 18, scale: 6 }).notNull().default("0"),
  totalBalance: numeric("total_balance", { precision: 18, scale: 6 }).notNull().default("0"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  unique("wallets_user_currency_unique").on(t.userId, t.currency),
  index("wallets_user_idx").on(t.userId),
  check("wallets_available_non_negative", sql`available_balance >= 0`),
  check("wallets_locked_non_negative",    sql`locked_balance >= 0`),
  check("wallets_total_non_negative",     sql`total_balance >= 0`),
  check("wallets_total_invariant",        sql`total_balance = available_balance + locked_balance`),
]);

// ─── Wallet Ledger Entries ────────────────────────────────────────────────────
// Immutable append-only audit trail. SOURCE OF TRUTH for all balance changes.
// wallet.availableBalance is a derived projection of these entries.

export const walletLedgerEntries = pgTable("wallet_ledger_entries", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  walletId: integer("wallet_id").notNull().references(() => wallets.id, { onDelete: "restrict" }),
  currency: text("currency", { enum: CURRENCIES }).notNull(),
  entryType: text("entry_type", { enum: ENTRY_TYPES }).notNull(),
  direction: text("direction", { enum: DIRECTIONS }).notNull(),
  amount: numeric("amount", { precision: 18, scale: 6 }).notNull(),
  balanceAfter: numeric("balance_after", { precision: 18, scale: 6 }).notNull(),
  referenceType: text("reference_type"),
  referenceId: text("reference_id"),
  description: text("description"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("wle_user_idx").on(t.userId),
  index("wle_wallet_idx").on(t.walletId),
  index("wle_created_idx").on(t.createdAt),
  index("wle_ref_idx").on(t.referenceType, t.referenceId),
  check("wle_amount_positive", sql`amount > 0`),
]);

// ─── Relations ────────────────────────────────────────────────────────────────

export const walletRelations = relations(wallets, ({ one, many }) => ({
  user: one(users, { fields: [wallets.userId], references: [users.id] }),
  ledgerEntries: many(walletLedgerEntries),
}));

export const walletLedgerRelations = relations(walletLedgerEntries, ({ one }) => ({
  wallet: one(wallets, { fields: [walletLedgerEntries.walletId], references: [wallets.id] }),
}));

// ─── TypeScript Types ─────────────────────────────────────────────────────────

export type Wallet = typeof wallets.$inferSelect;
export type InsertWallet = typeof wallets.$inferInsert;
export type WalletLedgerEntry = typeof walletLedgerEntries.$inferSelect;
export type InsertWalletLedgerEntry = typeof walletLedgerEntries.$inferInsert;

// ─── Discovery Domain ─────────────────────────────────────────────────────────
// Vault watchlist (legacy), canonical asset watchlist
// ─────────────────────────────────────────────────────────────────────────────
import {
  pgTable, serial, integer, timestamp, varchar, unique, index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./auth";
import { vaults, assets } from "./player";

// --- Legacy vault-based watchlist ---
export const watchlist = pgTable("watchlist", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  vaultId: integer("vault_id").notNull().references(() => vaults.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  unique("user_vault_watchlist_unique").on(table.userId, table.vaultId),
]);

export const watchlistRelations = relations(watchlist, ({ one }) => ({
  user: one(users, {
    fields: [watchlist.userId],
    references: [users.id],
  }),
  vault: one(vaults, {
    fields: [watchlist.vaultId],
    references: [vaults.id],
  }),
}));

// ===== Asset Watchlist (user-scoped, keyed by asset internal id) =====
export const assetWatchlist = pgTable("asset_watchlist", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  assetId: integer("asset_id").notNull().references(() => assets.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  unique("asset_watchlist_user_asset_unique").on(t.userId, t.assetId),
  index("asset_watchlist_user_idx").on(t.userId),
]);

export type AssetWatchlistRow = typeof assetWatchlist.$inferSelect;

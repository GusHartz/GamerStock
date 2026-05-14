// ─── Simulation Domain ────────────────────────────────────────────────────────
// Bot trader profiles and sandbox simulation data
// ─────────────────────────────────────────────────────────────────────────────
import { z } from "zod";
import {
  pgTable, serial, varchar, integer, numeric, timestamp, index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { users } from "./auth";

// --- Bot Trader Profiles ---
export const botProfiles = pgTable("bot_profiles", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  strategy: varchar("strategy").notNull(),
  riskProfile: varchar("risk_profile").notNull().default("MEDIUM"),
  intervalMultiplier: numeric("interval_multiplier", { precision: 4, scale: 2 }).notNull().default("1.00"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("bot_profiles_user_idx").on(t.userId),
  index("bot_profiles_strategy_idx").on(t.strategy),
]);

export type BotProfile = typeof botProfiles.$inferSelect;
export const insertBotProfileSchema = createInsertSchema(botProfiles).omit({ id: true, createdAt: true });
export type InsertBotProfile = z.infer<typeof insertBotProfileSchema>;

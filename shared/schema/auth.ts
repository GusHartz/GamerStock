// ─── Auth Domain ──────────────────────────────────────────────────────────────
// users, sessions, access management, password resets, waitlist
// ─────────────────────────────────────────────────────────────────────────────
import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";

// Re-export everything from the existing auth model (users, sessions,
// accessRequests, passwordResetTokens and their types)
export * from "../models/auth";

// --- Waitlist (pre-registration interest list) ---
export const waitlist = pgTable("waitlist", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  discord: text("discord"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

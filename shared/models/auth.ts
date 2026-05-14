import { sql } from "drizzle-orm";
import { boolean, index, jsonb, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

// Session storage table.
// (IMPORTANT) This table is mandatory for Replit Auth, don't drop it.
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)]
);

// User storage table.
// (IMPORTANT) This table is mandatory for Replit Auth, don't drop it.
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  // GamerStock auth fields
  displayName: varchar("display_name"),
  passwordHash: varchar("password_hash"),
  gamesSelected: text("games_selected").array(),
  gamesOther: varchar("games_other"),
  role: varchar("role").default("user"),
  emailVerified: boolean("email_verified").default(false),
  // status: active | blocked | deleted | pending_access | invited
  status: varchar("status").default("active"),
  isBot: boolean("is_bot").default(false),
  // Access management fields
  mustChangePassword: boolean("must_change_password").default(false),
  blockedAt: timestamp("blocked_at"),
  lastLoginAt: timestamp("last_login_at"),
  createdByAdmin: boolean("created_by_admin").default(false),
});

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

// Access requests from prospective users (public, pre-account)
export const accessRequests = pgTable("access_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  fullName: varchar("full_name").notNull(),
  email: varchar("email").notNull(),
  region: varchar("region"),
  primaryGame: varchar("primary_game"),
  usernameInterest: varchar("username_interest"),
  note: text("note"),
  // status: pending | approved | rejected
  status: varchar("status").default("pending").notNull(),
  reviewedByUserId: varchar("reviewed_by_user_id"),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type AccessRequest = typeof accessRequests.$inferSelect;
export type InsertAccessRequest = typeof accessRequests.$inferInsert;

// Password reset tokens (single-use, time-limited)
export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  tokenHash: varchar("token_hash").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;

// ─── Player Claim System ───────────────────────────────────────────────────────
// Modelling the link between a platform user and a professional player identity.
// A claim is a request for ownership of a player's public profile.
// It does NOT grant control over market data, pricing, or trading.
// ─────────────────────────────────────────────────────────────────────────────
import {
  pgTable, serial, varchar, text, timestamp, boolean, integer, index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "../models/auth";
import { assets } from "./player";

// ─────────────────────────────────────────────────────────────────────────────
// Claim Status lifecycle:
//   pending → approved | rejected
//   approved → revoked
// ─────────────────────────────────────────────────────────────────────────────
export const CLAIM_STATUSES = ["pending", "approved", "rejected", "revoked"] as const;
export type ClaimStatus = typeof CLAIM_STATUSES[number];

// Verification methods — extensible for future Riot/wallet verification.
export const VERIFICATION_METHODS = [
  "manual_admin_review",
  "steam_auto_verified",  // Steam-linked account verified automatically on add-to-terminal
  "riot_account_match",   // future: Riot OAuth verification
  "org_verification",     // future: team/org vouching
] as const;
export type VerificationMethod = typeof VERIFICATION_METHODS[number];

// ─────────────────────────────────────────────────────────────────────────────
// player_claims — one row per claim request
// A user may have at most one approved claim at a time.
// Multiple pending/rejected/revoked claims are allowed (audit trail).
// ─────────────────────────────────────────────────────────────────────────────
export const playerClaims = pgTable("player_claims", {
  id: serial("id").primaryKey(),

  // The platform user making the claim
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),

  // The canonical market asset this claim targets (assets.id)
  assetId: integer("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),

  // Denormalised for quick reference without joins
  assetUid: text("asset_uid").notNull(),

  // Riot PUUID provided by the claimant (optional at request time; required for
  // riot_account_match verification in the future)
  puuid: text("puuid"),

  // Current lifecycle status
  claimStatus: varchar("claim_status", { length: 32 })
    .notNull()
    .default("pending")
    .$type<ClaimStatus>(),

  // How this claim will be / was verified
  verificationMethod: varchar("verification_method", { length: 64 })
    .notNull()
    .default("manual_admin_review")
    .$type<VerificationMethod>(),

  // Free-text evidence from the claimant (social links, team confirmation, etc.)
  evidenceNote: text("evidence_note"),

  // Timestamps
  requestedAt: timestamp("requested_at").defaultNow().notNull(),
  reviewedAt: timestamp("reviewed_at"),
  reviewedBy: varchar("reviewed_by"),   // userId of admin who reviewed
  approvedAt: timestamp("approved_at"),
  rejectedAt: timestamp("rejected_at"),
  rejectionReason: text("rejection_reason"),
  revokedAt: timestamp("revoked_at"),
}, (t) => [
  index("player_claims_user_idx").on(t.userId),
  index("player_claims_asset_idx").on(t.assetId),
  index("player_claims_status_idx").on(t.claimStatus),
]);

export type PlayerClaim = typeof playerClaims.$inferSelect;
export type InsertPlayerClaim = typeof playerClaims.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// player_public_profiles — created/updated only after claim is approved.
// Controls what a verified player user can edit on their public identity.
// Market data (price, supply, valuation) is NEVER stored here.
// ─────────────────────────────────────────────────────────────────────────────
export const playerPublicProfiles = pgTable("player_public_profiles", {
  id: serial("id").primaryKey(),

  // The canonical asset this profile belongs to
  assetId: integer("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),

  // The user who owns this profile (the approved claimant)
  claimedByUserId: varchar("claimed_by_user_id").notNull().references(() => users.id, { onDelete: "set null" }),

  // The claim that granted this ownership (for audit trail)
  claimId: integer("claim_id").notNull().references(() => playerClaims.id),

  // ── Fields the player user CAN control ──────────────────────────────────
  bio: text("bio"),
  profileImageUrl: text("profile_image_url"),
  bannerUrl: text("banner_url"),
  headline: text("headline"),

  // JSON array of {platform, url} objects — stored as text to avoid jsonb type complexity
  socialLinksJson: text("social_links_json").default("[]").notNull(),

  teamAffiliation: varchar("team_affiliation", { length: 128 }),

  // Whether this profile is publicly visible
  isVisible: boolean("is_visible").notNull().default(true),

  // ── Timestamps ────────────────────────────────────────────────────────
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastUpdatedAt: timestamp("last_updated_at").defaultNow().notNull(),
}, (t) => [
  index("player_public_profiles_asset_idx").on(t.assetId),
  index("player_public_profiles_user_idx").on(t.claimedByUserId),
]);

export type PlayerPublicProfile = typeof playerPublicProfiles.$inferSelect;
export type InsertPlayerPublicProfile = typeof playerPublicProfiles.$inferInsert;

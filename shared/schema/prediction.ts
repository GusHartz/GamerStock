// ─── Prediction Markets — Drizzle Schema ──────────────────────────────────────
// Sprint 1: Foundation schema (normalized in step 2).
// Prediction markets are ISOLATED from the permanent player-asset market engine.
// Financial truth lives in the wallet ledger (referenceType = 'prediction_*').
//
// Additive-safe evolution: columns from the initial Sprint 1 pass are preserved.
// New columns added in the normalization step are noted below.
// ─────────────────────────────────────────────────────────────────────────────
import {
  pgTable,
  serial,
  varchar,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ─── Lifecycle types (string literals — no pgEnum to avoid migration pain) ────

export type PredictionMarketStatus =
  | "draft"
  | "open"
  | "locked"
  | "resolved"
  | "settled"
  | "cancelled";

export type PredictionPositionStatus = "active" | "won" | "lost" | "refunded";
export type PredictionOrderStatus    = "pending" | "filled" | "cancelled" | "expired";
export type PredictionOrderSide      = "buy" | "sell";
export type PredictionOrderType      = "market" | "limit";
export type PredictionMarketType     = "binary" | "multi" | "scalar";

// ─── prediction_events ────────────────────────────────────────────────────────
// Real-world sporting event context. Not a tradeable asset.
// Teams referenced here are CONTEXT ONLY — not portfolio assets.
//
// Additive additions (step 2): tournament_name, event_name, status

export const predictionEvents = pgTable(
  "prediction_events",
  {
    id:             serial("id").primaryKey(),
    // uid kept for backward compat with Sprint 1 data
    uid:            varchar("uid", { length: 64 }).notNull().unique(),
    // step-2 additive: structured naming alongside the legacy free-text title
    tournamentName: varchar("tournament_name", { length: 255 }),
    eventName:      varchar("event_name", { length: 255 }),
    // legacy title field (Sprint 1 — kept, maps to eventName concept)
    title:          varchar("title", { length: 255 }).notNull(),
    game:           varchar("game", { length: 50 }).notNull().default("lol"),
    region:         varchar("region", { length: 50 }),
    eventType:      varchar("event_type", { length: 50 }).notNull().default("match"),
    teamAName:      varchar("team_a", { length: 100 }),
    teamBName:      varchar("team_b", { length: 100 }),
    // step-2 additive: explicit status for event lifecycle
    status:         varchar("status", { length: 30 }).notNull().default("scheduled"),
    startsAt:       timestamp("scheduled_at"),           // DB col kept as scheduled_at
    externalRef:    varchar("external_ref", { length: 128 }),
    metadata:       jsonb("metadata"),
    createdAt:      timestamp("created_at").notNull().defaultNow(),
    updatedAt:      timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_pred_events_game").on(t.game),
    index("idx_pred_events_status").on(t.status),
    index("idx_pred_events_starts_at").on(t.startsAt),
  ]
);

// ─── prediction_markets ───────────────────────────────────────────────────────
// The question-based market. Lifecycle: draft → open → locked → resolved → settled.
// Each market belongs to one event. Multiple markets per event are allowed.
//
// Additive additions (step 2): slug, title (alias for question), market_type,
//   resolution_source
// Naming note: opens_at/closes_at/resolved_at/created_by_user_id from Sprint 1
//   map to open_at/close_at/resolve_at/created_by in the spec. DB columns unchanged.

export const predictionMarkets = pgTable(
  "prediction_markets",
  {
    id:               serial("id").primaryKey(),
    uid:              varchar("uid", { length: 64 }).notNull().unique(),
    // step-2 additive: human-readable slug for URL routing
    slug:             varchar("slug", { length: 128 }).unique(),
    eventId:          integer("event_id").references(() => predictionEvents.id, { onDelete: "restrict" }),
    // question = the canonical field (Sprint 1); title is the spec alias
    question:         varchar("question", { length: 512 }).notNull(),
    description:      text("description"),
    // step-2 additive: market category (binary, multi, scalar)
    marketType:       varchar("market_type", { length: 30 }).notNull().default("binary"),
    status:           varchar("status", { length: 20 }).notNull().default("draft"),
    resolvedOutcomeId: integer("resolved_outcome_id"),
    currency:         varchar("currency", { length: 10 }).notNull().default("GS"),
    poolTotal:        numeric("pool_total", { precision: 18, scale: 6 }).notNull().default("0"),
    minStake:         numeric("min_stake", { precision: 18, scale: 6 }).notNull().default("1.000000"),
    maxStake:         numeric("max_stake", { precision: 18, scale: 6 }),
    openAt:           timestamp("opens_at"),             // DB col kept as opens_at
    closeAt:          timestamp("closes_at"),            // DB col kept as closes_at
    resolveAt:        timestamp("resolved_at"),          // DB col kept as resolved_at
    settledAt:        timestamp("settled_at"),
    // step-2 additive: where result comes from (e.g. "riot_api", "admin", "oracle")
    resolutionSource: varchar("resolution_source", { length: 128 }),
    createdBy:        varchar("created_by_user_id", { length: 128 }), // DB col unchanged
    metadata:         jsonb("metadata"),
    createdAt:        timestamp("created_at").notNull().defaultNow(),
    updatedAt:        timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_pred_markets_status").on(t.status),
    index("idx_pred_markets_event_id").on(t.eventId),
    index("idx_pred_markets_slug").on(t.slug),
    index("idx_pred_markets_open_at").on(t.openAt),
  ]
);

// ─── prediction_outcomes ──────────────────────────────────────────────────────
// Possible outcomes for a market. Typically 2 (binary) but supports N outcomes.
//
// Additive additions (step 2): code, payout_value

export const predictionOutcomes = pgTable(
  "prediction_outcomes",
  {
    id:                 serial("id").primaryKey(),
    marketId:           integer("market_id").notNull().references(() => predictionMarkets.id, { onDelete: "cascade" }),
    // step-2 additive: short machine code (e.g. "YES", "NO", "TEAM_A")
    code:               varchar("code", { length: 50 }),
    label:              varchar("label", { length: 255 }).notNull(),
    description:        text("description"),
    poolShare:          numeric("pool_share", { precision: 18, scale: 6 }).notNull().default("0"),
    impliedProbability: numeric("implied_probability", { precision: 6, scale: 4 }),
    isWinner:           boolean("is_winner").default(false),
    // step-2 additive: final computed payout multiplier set on resolution
    payoutValue:        numeric("payout_value", { precision: 18, scale: 6 }),
    sortOrder:          integer("sort_order").notNull().default(0),
    metadata:           jsonb("metadata"),
    createdAt:          timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_pred_outcomes_market_id").on(t.marketId),
  ]
);

// ─── prediction_positions ─────────────────────────────────────────────────────
// A user's aggregated exposure on a specific outcome.
// The wallet ledger is the financial source of truth.
// This table is a PROJECTION — it aggregates order fills into a position view.
//
// Additive additions (step 2): quantity, avg_price, cost_basis, realized_pnl
// Legacy fields kept: stake, currency, payout, payout_at, wallet_ledger_ref

export const predictionPositions = pgTable(
  "prediction_positions",
  {
    id:              serial("id").primaryKey(),
    userId:          varchar("user_id", { length: 128 }).notNull(),
    marketId:        integer("market_id").notNull().references(() => predictionMarkets.id, { onDelete: "restrict" }),
    outcomeId:       integer("outcome_id").notNull().references(() => predictionOutcomes.id, { onDelete: "restrict" }),
    // step-2 additive: share-count based position tracking
    quantity:        numeric("quantity", { precision: 18, scale: 6 }),
    avgPrice:        numeric("avg_price", { precision: 18, scale: 6 }),
    costBasis:       numeric("cost_basis", { precision: 18, scale: 6 }),
    realizedPnl:     numeric("realized_pnl", { precision: 18, scale: 6 }),
    // Sprint-1 legacy fields (retained, used until Sprint 2 settlement refactor)
    stake:           numeric("stake", { precision: 18, scale: 6 }),
    currency:        varchar("currency", { length: 10 }).notNull().default("GS"),
    payout:          numeric("payout", { precision: 18, scale: 6 }),
    payoutAt:        timestamp("payout_at"),
    cancelledAt:     timestamp("cancelled_at"),
    status:          varchar("status", { length: 20 }).notNull().default("active"),
    walletLedgerRef: varchar("wallet_ledger_ref", { length: 128 }),
    createdAt:       timestamp("created_at").notNull().defaultNow(),
    updatedAt:       timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_pred_positions_user_id").on(t.userId),
    index("idx_pred_positions_market_id").on(t.marketId),
    index("idx_pred_positions_outcome_id").on(t.outcomeId),
  ]
);

// ─── prediction_orders ────────────────────────────────────────────────────────
// Immutable order log. Each bet or trade action creates one order record.
// Orders are filled (fully or partially), cancelled, or expired.
// Full CLOB matching is deferred to Sprint 2 — this table accepts the records.

export const predictionOrders = pgTable(
  "prediction_orders",
  {
    id:             serial("id").primaryKey(),
    marketId:       integer("market_id").notNull().references(() => predictionMarkets.id, { onDelete: "restrict" }),
    userId:         varchar("user_id", { length: 128 }).notNull(),
    outcomeId:      integer("outcome_id").notNull().references(() => predictionOutcomes.id, { onDelete: "restrict" }),
    side:           varchar("side", { length: 10 }).notNull(),       // buy | sell
    orderType:      varchar("order_type", { length: 10 }).notNull(), // market | limit
    quantity:       numeric("quantity", { precision: 18, scale: 6 }).notNull(),
    price:          numeric("price", { precision: 18, scale: 6 }),   // null for market orders
    totalValue:     numeric("total_value", { precision: 18, scale: 6 }),
    status:         varchar("status", { length: 20 }).notNull().default("pending"),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).unique(),
    createdAt:      timestamp("created_at").notNull().defaultNow(),
    updatedAt:      timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_pred_orders_market_id").on(t.marketId),
    index("idx_pred_orders_user_id").on(t.userId),
    index("idx_pred_orders_status").on(t.status),
    index("idx_pred_orders_idempotency_key").on(t.idempotencyKey),
  ]
);

// ─── prediction_settlements ───────────────────────────────────────────────────
// Immutable record of a payout event for one user on one market.
// Created when status transitions from resolved → settled.
// ledger_reference_id links back to the wallet ledger entry (Sprint 2 wiring).

export const predictionSettlements = pgTable(
  "prediction_settlements",
  {
    id:               serial("id").primaryKey(),
    marketId:         integer("market_id").notNull().references(() => predictionMarkets.id, { onDelete: "restrict" }),
    userId:           varchar("user_id", { length: 128 }).notNull(),
    positionId:       integer("position_id").references(() => predictionPositions.id, { onDelete: "restrict" }),
    grossPayout:      numeric("gross_payout", { precision: 18, scale: 6 }).notNull(),
    // Audit columns (Phase 4): remaining cost basis and profit used for fee calculation
    costBasisUsed:    numeric("cost_basis_used", { precision: 18, scale: 6 }).notNull().default("0"),
    profit:           numeric("profit", { precision: 18, scale: 6 }).notNull().default("0"),
    fees:             numeric("fees", { precision: 18, scale: 6 }).notNull().default("0"),
    netPayout:        numeric("net_payout", { precision: 18, scale: 6 }).notNull(),
    // Links to wallet ledger entry
    ledgerReferenceId: varchar("ledger_reference_id", { length: 128 }),
    settledAt:        timestamp("settled_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_pred_settlements_market_id").on(t.marketId),
    index("idx_pred_settlements_user_id").on(t.userId),
    index("idx_pred_settlements_position_id").on(t.positionId),
  ]
);

// ─── prediction_price_snapshots ───────────────────────────────────────────────
// Time-series price ticks for an outcome. Enables charting and history.
// Populated by the pricing engine (Sprint 2) or synthetic data (Sprint 1 seed).

export const predictionPriceSnapshots = pgTable(
  "prediction_price_snapshots",
  {
    id:           serial("id").primaryKey(),
    marketId:     integer("market_id").notNull().references(() => predictionMarkets.id, { onDelete: "cascade" }),
    outcomeId:    integer("outcome_id").notNull().references(() => predictionOutcomes.id, { onDelete: "cascade" }),
    price:        numeric("price", { precision: 10, scale: 6 }).notNull(),
    volumeWindow: numeric("volume_window", { precision: 18, scale: 6 }),
    recordedAt:   timestamp("recorded_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_pred_snapshots_market_outcome").on(t.marketId, t.outcomeId),
    index("idx_pred_snapshots_recorded_at").on(t.recordedAt),
  ]
);

// ─── prediction_market_stats ──────────────────────────────────────────────────
// Materialized rolling stats per market. One row per market, upserted on activity.
// Enables fast market-list rendering without aggregating orders/positions each time.

export const predictionMarketStats = pgTable(
  "prediction_market_stats",
  {
    id:           serial("id").primaryKey(),
    marketId:     integer("market_id").notNull().unique().references(() => predictionMarkets.id, { onDelete: "cascade" }),
    volume24h:    numeric("volume_24h", { precision: 18, scale: 6 }).notNull().default("0"),
    traders24h:   integer("traders_24h").notNull().default(0),
    lastPriceYes: numeric("last_price_yes", { precision: 10, scale: 6 }),
    lastPriceNo:  numeric("last_price_no", { precision: 10, scale: 6 }),
    updatedAt:    timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_pred_stats_market_id").on(t.marketId),
  ]
);

// ─── prediction_market_events ─────────────────────────────────────────────────
// Lightweight operational audit trail for prediction market lifecycle transitions.
//
// Every structural state change (creation, status transition, settlement,
// cancellation) is recorded here as an immutable append-only row.
//
// Design notes:
//   - No updatedAt — rows are immutable once written.
//   - source distinguishes human actors ("admin") from automated systems
//     ("scheduler", "settlement", "system").
//   - metadata holds optional structured context (e.g. winningOutcomeId on resolve).
//   - Writes are best-effort: a failed event write must never block a financial op.
//
// Sprint 3 event types recorded:
//   market_created | market_opened | market_locked | market_auto_locked |
//   market_resolved | market_settled | market_cancelled

export const predictionMarketEvents = pgTable(
  "prediction_market_events",
  {
    id:          serial("id").primaryKey(),
    marketId:    integer("market_id").notNull().references(() => predictionMarkets.id, { onDelete: "cascade" }),
    eventType:   varchar("event_type", { length: 50 }).notNull(),
    fromStatus:  varchar("from_status", { length: 30 }),
    toStatus:    varchar("to_status", { length: 30 }),
    actorUserId: varchar("actor_user_id", { length: 128 }),
    source:      varchar("source", { length: 50 }),        // "admin" | "scheduler" | "settlement" | "system"
    note:        text("note"),
    metadata:    jsonb("metadata"),
    createdAt:   timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_pred_mkt_events_market_id").on(t.marketId),
    index("idx_pred_mkt_events_created_at").on(t.createdAt),
    index("idx_pred_mkt_events_event_type").on(t.eventType),
  ]
);

// ─── Insert schemas (drizzle-zod) ─────────────────────────────────────────────

export const insertPredictionEventSchema = createInsertSchema(predictionEvents).omit({
  id: true, createdAt: true, updatedAt: true,
});

export const insertPredictionMarketSchema = createInsertSchema(predictionMarkets).omit({
  id: true, poolTotal: true, resolvedOutcomeId: true, resolveAt: true,
  settledAt: true, createdAt: true, updatedAt: true,
});

export const insertPredictionOutcomeSchema = createInsertSchema(predictionOutcomes).omit({
  id: true, poolShare: true, impliedProbability: true, isWinner: true,
  payoutValue: true, createdAt: true,
});

export const insertPredictionPositionSchema = createInsertSchema(predictionPositions).omit({
  id: true, payout: true, payoutAt: true, cancelledAt: true, status: true, createdAt: true, updatedAt: true,
});

export const insertPredictionOrderSchema = createInsertSchema(predictionOrders).omit({
  id: true, status: true, createdAt: true, updatedAt: true,
});

export const insertPredictionSettlementSchema = createInsertSchema(predictionSettlements).omit({
  id: true, settledAt: true,
});

export const insertPredictionPriceSnapshotSchema = createInsertSchema(predictionPriceSnapshots).omit({
  id: true, recordedAt: true,
});

export const insertPredictionMarketStatsSchema = createInsertSchema(predictionMarketStats).omit({
  id: true, updatedAt: true,
});

export const insertPredictionMarketEventSchema = createInsertSchema(predictionMarketEvents).omit({
  id: true, createdAt: true,
});

// ─── Inferred types ───────────────────────────────────────────────────────────

export type InsertPredictionMarketEvent    = z.infer<typeof insertPredictionMarketEventSchema>;
export type InsertPredictionEvent          = z.infer<typeof insertPredictionEventSchema>;
export type InsertPredictionMarket         = z.infer<typeof insertPredictionMarketSchema>;
export type InsertPredictionOutcome        = z.infer<typeof insertPredictionOutcomeSchema>;
export type InsertPredictionPosition       = z.infer<typeof insertPredictionPositionSchema>;
export type InsertPredictionOrder          = z.infer<typeof insertPredictionOrderSchema>;
export type InsertPredictionSettlement     = z.infer<typeof insertPredictionSettlementSchema>;
export type InsertPredictionPriceSnapshot  = z.infer<typeof insertPredictionPriceSnapshotSchema>;
export type InsertPredictionMarketStats    = z.infer<typeof insertPredictionMarketStatsSchema>;

export type PredictionEvent         = typeof predictionEvents.$inferSelect;
export type PredictionMarket        = typeof predictionMarkets.$inferSelect;
export type PredictionOutcome       = typeof predictionOutcomes.$inferSelect;
export type PredictionPosition      = typeof predictionPositions.$inferSelect;
export type PredictionOrder         = typeof predictionOrders.$inferSelect;
export type PredictionSettlement    = typeof predictionSettlements.$inferSelect;
export type PredictionPriceSnapshot = typeof predictionPriceSnapshots.$inferSelect;
export type PredictionMarketStats   = typeof predictionMarketStats.$inferSelect;
export type PredictionMarketEvent   = typeof predictionMarketEvents.$inferSelect;

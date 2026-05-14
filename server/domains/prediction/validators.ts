// ─── Prediction Markets — Request Validators ──────────────────────────────────
// Zod schemas for validating incoming API payloads.
// ─────────────────────────────────────────────────────────────────────────────
import { z } from "zod";

// ── Shared building blocks ────────────────────────────────────────────────────

export const paginationSchema = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const marketStatusSchema = z.enum([
  "draft",
  "open",
  "locked",
  "resolved",
  "settled",
  "cancelled",
]);

export const marketTypeSchema = z.enum(["binary", "multi", "scalar"]);
export const currencySchema   = z.enum(["GS", "USDC"]);

// ── GET /api/predictions/events ───────────────────────────────────────────────

export const listEventsQuerySchema = z.object({
  game:   z.string().max(50).optional(),
  status: z.string().max(30).optional(),
  limit:  z.coerce.number().int().min(1).max(200).default(50),
});

// ── POST /api/predictions/events ──────────────────────────────────────────────

export const createPredictionEventSchema = z.object({
  title:          z.string().min(3).max(255),
  tournamentName: z.string().max(255).optional(),
  eventName:      z.string().max(255).optional(),
  game:           z.string().max(50).default("lol"),
  region:         z.string().max(50).optional(),
  eventType:      z.enum(["match", "tournament_stage", "series", "special"]).default("match"),
  teamAName:      z.string().max(100).optional(),
  teamBName:      z.string().max(100).optional(),
  startsAt:       z.coerce.date().optional(),
  externalRef:    z.string().max(128).optional(),
  metadata:       z.record(z.unknown()).optional(),
});

// ── GET /api/predictions/markets ──────────────────────────────────────────────

export const marketListQuerySchema = z.object({
  status:     marketStatusSchema.optional(),
  marketType: marketTypeSchema.optional(),
  eventId:    z.coerce.number().int().positive().optional(),
  currency:   currencySchema.optional(),
  page:       z.coerce.number().int().min(1).default(1),
  limit:      z.coerce.number().int().min(1).max(100).default(20),
});

// ── POST /api/predictions/markets ─────────────────────────────────────────────

export const createPredictionMarketSchema = z.object({
  eventId:          z.number().int().positive().optional(),
  slug:             z.string().min(3).max(128).regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with dashes").optional(),
  question:         z.string().min(5).max(512),
  description:      z.string().max(2000).optional(),
  marketType:       marketTypeSchema.default("binary"),
  currency:         currencySchema.default("GS"),
  minStake:         z.string().regex(/^\d+(\.\d+)?$/).default("1"),
  maxStake:         z.string().regex(/^\d+(\.\d+)?$/).optional(),
  openAt:           z.coerce.date().optional(),
  closeAt:          z.coerce.date().optional(),
  resolutionSource: z.string().max(128).optional(),
  outcomes: z
    .array(
      z.object({
        label:       z.string().min(1).max(255),
        code:        z.string().max(50).optional(),
        description: z.string().max(1000).optional(),
        sortOrder:   z.number().int().min(0).default(0),
      })
    )
    .min(2, "A prediction market must have at least 2 outcomes")
    .max(20),
});

// ── POST /api/predictions/markets/:id/transition ──────────────────────────────

export const transitionMarketStatusSchema = z.object({
  targetStatus:      marketStatusSchema,
  resolvedOutcomeId: z.number().int().positive().optional(),
});

// ── POST /api/predictions/markets/:id/bet (Sprint 1 legacy) ───────────────────

export const placeBetSchema = z.object({
  outcomeId: z.number().int().positive(),
  stake:     z.string().regex(/^\d+(\.\d{1,6})?$/, "Stake must be a valid decimal number"),
  currency:  currencySchema.default("GS"),
});

// ── POST /api/predictions/orders (Sprint 2) ───────────────────────────────────

const positiveDecimalRegex = /^\d+(\.\d{1,6})?$/;

export const placeOrderSchema = z.object({
  marketId:  z.number().int().positive({ message: "marketId must be a positive integer" }),
  outcomeId: z.number().int().positive({ message: "outcomeId must be a positive integer" }),
  quantity:  z
    .string()
    .regex(positiveDecimalRegex, "quantity must be a valid positive decimal (up to 6dp)")
    .refine((v) => parseFloat(v) > 0, { message: "quantity must be greater than 0" }),
  price: z
    .string()
    .regex(positiveDecimalRegex, "price must be a valid positive decimal (up to 6dp)")
    .refine(
      (v) => {
        const f = parseFloat(v);
        return f > 0 && f < 1;
      },
      { message: "price must be between 0 and 1 exclusive (implied probability)" }
    ),
  currency:       currencySchema.default("GS"),
  idempotencyKey: z.string().min(1).max(128).optional(),
});

// ── POST /api/predictions/markets/:id/cancel (Sprint 3 cancellation) ──────────
// Admin-only. Cancels an eligible market and refunds all active positions.
// Eligible statuses: draft, open, locked.
// Not allowed: resolved, settled.

export const cancelMarketSchema = z.object({
  reason: z.string().max(255).optional(),
  note:   z.string().max(1000).optional(),
});

// ── POST /api/predictions/markets/:id/resolve (Sprint 2 settlement) ───────────
// Admin-only. Resolves a locked market and immediately settles all positions.
// Market must be in "locked" status (or already "resolved" for idempotent retry).

export const resolveMarketSchema = z.object({
  winningOutcomeId:  z.number().int().positive({ message: "winningOutcomeId must be a positive integer" }),
  resolutionSource:  z.string().max(255).optional(),
  note:              z.string().max(1000).optional(),
});

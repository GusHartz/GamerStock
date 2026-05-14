// ─── Prediction Markets — Routes ──────────────────────────────────────────────
// Sprint 1: Foundation endpoints.
// Sprint 2 (orders):     POST /api/predictions/orders — wallet-locked order placement.
// Sprint 2 (settlement): POST /api/predictions/markets/:id/resolve — resolve + settle.
// Sprint 3: Cancellation, events, read APIs, admin surface normalization.
// Sprint 4: Home discovery read model (GET /api/predictions/home).
//
// Public:
//   GET  /api/predictions/health
//
// Auth (user):
//   GET  /api/predictions/home               ← Sprint 4 (home aggregation)
//   GET  /api/predictions/browse             ← Sprint 4 (unified browse)
//   GET  /api/predictions/events
//   GET  /api/predictions/markets
//   GET  /api/predictions/markets/:idOrSlug/detail ← Sprint 4 (market detail)
//   GET  /api/predictions/markets/:idOrSlug
//   GET  /api/predictions/live
//   GET  /api/predictions/upcoming
//   GET  /api/predictions/resolved
//   GET  /api/predictions/me/positions       ← enriched (Sprint 3)
//   GET  /api/predictions/me/history         ← Sprint 3
//   GET  /api/predictions/me/portfolio       ← Sprint 4 composed portfolio
//   GET  /api/predictions/me/orders
//   POST /api/predictions/orders
//   POST /api/predictions/markets/:id/bet    (legacy Sprint 1 stub)
//
// Admin only:
//   POST /api/predictions/events
//   POST /api/predictions/markets
//   POST /api/predictions/markets/:id/open       ← Sprint 3 (normalized)
//   POST /api/predictions/markets/:id/lock       ← Sprint 3 (normalized)
//   POST /api/predictions/markets/:id/transition (generic — backward compat)
//   POST /api/predictions/markets/:id/resolve    (normalized Sprint 3)
//   POST /api/predictions/markets/:id/cancel     (normalized Sprint 3)
//   GET  /api/predictions/markets/:id/events
//   GET  /api/predictions/markets/:id/admin-summary  ← Sprint 3
// ─────────────────────────────────────────────────────────────────────────────
import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { isPredictEnabledServer } from "../../lib/featureFlags";
import { predictionService } from "./service";
import { predictionRepository } from "./repository";
import {
  getExternalMatchResolutionContext,
  ResolutionContextError,
} from "./services/externalResolutionService";
import { resolvePredictionMarketFromProvider } from "./services/providerResolutionService";
import {
  resolveEligiblePredictionMarketsFromProviders,
  isBatchRunning,
} from "./services/providerResolutionBatchService";
import { seedPredictionDevData } from "./seed";
import { db } from "../../db";
import {
  predictionEvents,
  predictionMarkets,
  predictionOutcomes,
} from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import {
  getPredictionAutoLockState,
} from "../../scheduler/prediction-auto-lock";
import {
  createPredictionEventSchema,
  createPredictionMarketSchema,
  transitionMarketStatusSchema,
  placeBetSchema,
  placeOrderSchema,
  resolveMarketSchema,
  cancelMarketSchema,
  marketListQuerySchema,
  listEventsQuerySchema,
} from "./validators";

// ── Auth guards ───────────────────────────────────────────────────────────────

const isAuthenticated: RequestHandler = (req: any, res, next) => {
  if (req.session?.isAdmin || req.session?.userId) return next();
  if (typeof req.isAuthenticated === "function" && req.isAuthenticated()) return next();
  return res.status(401).json({ message: "Unauthorized" });
};

const isAdminOnly: RequestHandler = (req: any, res, next) => {
  if (req.session?.isAdmin || req.session?.userRole === "admin") return next();
  return res.status(403).json({ message: "Forbidden" });
};

// ── Resolve userId from request ───────────────────────────────────────────────

function extractUserId(req: any): string | null {
  return (
    req.session?.userId ??
    (req.user as any)?.claims?.sub ??
    (req.user as any)?.id ??
    null
  );
}

function extractActorId(req: any): string {
  return (
    req.session?.userId ??
    req.session?.adminUsername ??
    "admin"
  );
}

// ── Admin helper: snapshot previous market status before a mutation ────────────
// Used by open/lock/transition/resolve/cancel routes to build the normalized
// AdminMutationResponse without touching the verified service layer.
async function fetchPreviousStatus(marketId: number): Promise<string | null> {
  const rows = await db
    .select({ status: predictionMarkets.status })
    .from(predictionMarkets)
    .where(eq(predictionMarkets.id, marketId))
    .limit(1);
  return rows[0]?.status ?? null;
}

// ── Feature flag: safe empty payload for GET /api/predictions/home ────────────
// Matches the HomeApiResponse shape expected by the client so the Home page
// stays stable and resilient when Predict is disabled.
const PREDICT_DISABLED_HOME = {
  livePredictions:        [],
  trendingPredictions:    [],
  upcomingEvents:         [],
  upcomingEventsEditorial: [],
  hotPlayers:             null,
  publicSurfaces:         null,
  totalLive:              0,
};

// ── Route registration ────────────────────────────────────────────────────────

export function registerPredictionRoutes(app: Express): void {

  // ── Feature flag gate: intercept ALL /api/predictions/* requests ───────────
  // Applied first so it runs before every route handler below.
  // • /health is always accessible (diagnostic endpoint, no auth, no DB ops).
  // • GET /home returns a controlled empty payload so the Home stays stable.
  // • Every other endpoint returns 503 when Predict is disabled.
  // Reversible: set PREDICT_ENABLED=true (or remove the env var) to re-enable.
  app.use("/api/predictions", (req: any, res: any, next: any) => {
    if (req.path === "/health") return next();
    if (isPredictEnabledServer()) return next();
    if (req.method === "GET" && req.path === "/home") {
      return res.json({ ...PREDICT_DISABLED_HOME, generatedAt: new Date().toISOString() });
    }
    return res.status(503).json({ message: "Predictions feature is currently disabled." });
  });

  // ── One-time DB idempotency constraint (Sprint 2 settlement guard) ─────────
  // Adds a partial UNIQUE index on prediction_settlements(position_id) so the
  // DB itself prevents duplicate settlement rows for the same position.
  // IF NOT EXISTS makes this a safe no-op on subsequent startups.

  db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS pred_settlements_position_unique
    ON prediction_settlements (position_id)
    WHERE position_id IS NOT NULL
  `).catch((err: any) => {
    console.warn("[Prediction] Could not ensure settlements unique index:", err?.message);
  });

  // ── Dev seed — fire-and-forget, idempotent ─────────────────────────────────

  if (process.env.NODE_ENV !== "production") {
    seedPredictionDevData().then((result) => {
      if (result.seeded) {
        console.log(`[Prediction] Dev seed: ${result.reason}`);
      } else {
        console.log(`[Prediction] Dev seed skipped: ${result.reason}`);
      }
    }).catch((err: any) => {
      console.error("[Prediction] Dev seed error (non-fatal):", err?.message ?? err);
    });
  }

  // ── GET /api/predictions/health (public) ───────────────────────────────────

  app.get("/api/predictions/health", async (_req, res) => {
    try {
      const [
        [{ eventsCount }],
        [{ marketsCount }],
        [{ outcomesCount }],
        seedCheck,
      ] = await Promise.all([
        db.select({ eventsCount:   sql<number>`count(*)::int` }).from(predictionEvents),
        db.select({ marketsCount:  sql<number>`count(*)::int` }).from(predictionMarkets),
        db.select({ outcomesCount: sql<number>`count(*)::int` }).from(predictionOutcomes),
        db
          .select({ id: predictionEvents.id })
          .from(predictionEvents)
          .where(eq(predictionEvents.externalRef, "dev-sample-furia-vs-navi-2025"))
          .limit(1),
      ]);

      return res.json({
        domain:    "prediction",
        status:    "operational",
        sprint:    "2-settlement",
        timestamp: new Date().toISOString(),
        mounted:   true,
        note:      "Sprint 2 complete: order placement + binary settlement. Sprint 3: cancellation, rake, auto-lock.",
        schemaTablesKnown: [
          "prediction_events",
          "prediction_markets",
          "prediction_outcomes",
          "prediction_positions",
          "prediction_orders",
          "prediction_settlements",
          "prediction_price_snapshots",
          "prediction_market_stats",
        ],
        endpoints: {
          "POST /api/predictions/orders":               "Sprint 2 — wallet-locked order placement",
          "POST /api/predictions/markets/:id/resolve":  "Sprint 2 — binary market resolution + settlement",
        },
        counts: {
          events:   Number(eventsCount),
          markets:  Number(marketsCount),
          outcomes: Number(outcomesCount),
        },
        seedDetected: seedCheck.length > 0,
        autoLock: getPredictionAutoLockState(),
        telemetry: {
          enabled: true,
          snapshotModel: "execution-price",
          statsFields:   ["last_price_yes", "last_price_no", "volume_24h"],
          approximations: ["volume_24h is cumulative, not a true 24h rolling window"],
          deferred:       ["traders_24h"],
        },
      });
    } catch (err: any) {
      console.error("[Prediction] Health check DB error:", err.message);
      return res.json({
        domain:    "prediction",
        status:    "degraded",
        sprint:    "2-settlement",
        timestamp: new Date().toISOString(),
        mounted:   true,
        error:     "DB query failed",
      });
    }
  });

  // ── GET /api/predictions/events/:id ────────────────────────────────────────

  app.get("/api/predictions/events/:id", isAuthenticated, async (req, res) => {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid event ID" });
    try {
      const event = await predictionService.getEvent(id);
      if (!event) return res.status(404).json({ message: `Event #${id} not found` });
      return res.json({ event });
    } catch (err: any) {
      console.error("[Prediction] GET /events/:id error:", err.message);
      return res.status(500).json({ message: "Failed to fetch prediction event." });
    }
  });

  // ── POST /api/predictions/events/:id/status (admin) ────────────────────────

  const updateEventStatusBodySchema = z.object({
    status: z.enum(["scheduled", "live", "finished", "cancelled", "postponed"]),
  });

  app.post(
    "/api/predictions/events/:id/status",
    isAuthenticated,
    isAdminOnly,
    async (req, res) => {
      const id = parseInt(req.params.id as string, 10);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid event ID" });
      const parsed = updateEventStatusBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Validation error", errors: parsed.error.flatten() });
      }
      try {
        const result = await predictionService.updateEventStatus(id, parsed.data.status);
        if (!result.success) return res.status(400).json({ message: result.error });
        return res.json(result.data);
      } catch (err: any) {
        console.error("[Prediction] POST /events/:id/status error:", err.message);
        return res.status(500).json({ message: "Failed to update event status." });
      }
    }
  );

  // ── GET /api/predictions/events ────────────────────────────────────────────

  app.get("/api/predictions/events", isAuthenticated, async (req, res) => {
    const parsed = listEventsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ message: "Validation error", errors: parsed.error.flatten() });
    }
    try {
      const events = await predictionService.listEvents(parsed.data);
      return res.json({ events, total: events.length });
    } catch (err: any) {
      console.error("[Prediction] GET /events error:", err.message);
      return res.status(500).json({ message: "Failed to list prediction events." });
    }
  });

  // ── POST /api/predictions/events (admin) ───────────────────────────────────

  app.post("/api/predictions/events", isAuthenticated, isAdminOnly, async (req, res) => {
    const parsed = createPredictionEventSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Validation error", errors: parsed.error.flatten() });
    }
    const result = await predictionService.createEvent(parsed.data);
    if (!result.success) {
      return res.status(422).json({ message: result.error });
    }
    return res.status(201).json(result.data);
  });

  // ── GET /api/predictions/markets ───────────────────────────────────────────

  app.get("/api/predictions/markets", isAuthenticated, async (req, res) => {
    const parsed = marketListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ message: "Validation error", errors: parsed.error.flatten() });
    }
    try {
      const page = await predictionService.listMarkets(parsed.data);
      return res.json(page);
    } catch (err: any) {
      console.error("[Prediction] GET /markets error:", err.message);
      return res.status(500).json({ message: "Failed to list prediction markets." });
    }
  });

  // ── GET /api/predictions/markets/:idOrSlug/detail (auth) ────────────────────
  // Sprint 4 rich market detail read model.
  // Auth: isAuthenticated — same level as the base GET /markets/:idOrSlug route.
  // Returns MarketDetailResponse: identity · event · outcomes · stats ·
  //   recentSnapshots (50 max, recordedAt DESC) · recentEvents (10 max, DESC) ·
  //   positionCounts · availableActions · userCanTrade.
  // NOTE: must be registered BEFORE the bare /:idOrSlug route so Express
  // matches /1/detail as a two-segment path, not a single-segment :idOrSlug.
  app.get(
    "/api/predictions/markets/:idOrSlug/detail",
    isAuthenticated,
    async (req, res) => {
      const raw       = req.params.idOrSlug;
      const idOrSlug  = /^\d+$/.test(raw) ? parseInt(raw, 10) : raw;
      try {
        const detail = await predictionService.getMarketDetail(idOrSlug);
        if (!detail) return res.status(404).json({ message: "Prediction market not found." });
        return res.json(detail);
      } catch (err) {
        console.error("[Prediction:detail]", err);
        return res.status(500).json({ message: "Failed to load market detail." });
      }
    }
  );

  // ── GET /api/predictions/markets/:marketId/my-side-position (auth) ──────────
  // Lightweight endpoint for the Trade Sheet SELL validation.
  // Returns the user's active position quantity for a given market + side.
  // Query param: ?sideId=<number>  (sideId === outcomeId in the DB)
  // Response: { sharesHeld, avgPrice, costBasis } or 404 if no active position.

  app.get(
    "/api/predictions/markets/:marketId/my-side-position",
    isAuthenticated,
    async (req: any, res) => {
      const userId = extractUserId(req);
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const marketId = parseInt(req.params.marketId, 10);
      if (isNaN(marketId) || marketId <= 0) {
        return res.status(400).json({ message: "Invalid marketId." });
      }

      const sideId = parseInt(String(req.query.sideId), 10);
      if (isNaN(sideId) || sideId <= 0) {
        return res.status(400).json({ message: "sideId query param required." });
      }

      try {
        const position = await predictionRepository.findPositionByUserMarketOutcome(
          userId, marketId, sideId
        );
        if (!position) return res.status(404).json({ message: "No active position." });

        return res.json({
          sharesHeld: parseFloat(position.quantity ?? "0"),
          avgPrice:   position.avgPrice   ?? "0",
          costBasis:  position.costBasis  ?? "0",
        });
      } catch (err: any) {
        console.error("[Prediction:my-side-position]", err.message);
        return res.status(500).json({ message: "Failed to load position." });
      }
    }
  );

  // ── GET /api/predictions/markets/:idOrSlug ─────────────────────────────────

  app.get("/api/predictions/markets/:idOrSlug", isAuthenticated, async (req, res) => {
    const raw = req.params.idOrSlug;
    const idOrSlug = /^\d+$/.test(raw) ? parseInt(raw, 10) : raw;

    const market = await predictionService.getMarket(idOrSlug);
    if (!market) return res.status(404).json({ message: "Prediction market not found." });

    return res.json(market);
  });

  // ── GET /api/predictions/markets/:id/events (admin) — Sprint 3 audit trail ──
  // Returns the ordered lifecycle event history for a prediction market.
  // Events are immutable and append-only. Ordered by created_at ASC.
  //
  // Event types: market_created | market_opened | market_locked | market_auto_locked
  //              market_resolved | market_settled | market_cancelled
  //
  // Auth: admin-only (operational data — not exposed to regular users).

  app.get(
    "/api/predictions/markets/:id/events",
    isAuthenticated,
    isAdminOnly,
    async (req, res) => {
      const marketId = parseInt(req.params.id, 10);
      if (isNaN(marketId)) return res.status(400).json({ message: "Invalid market id." });

      const market = await predictionService.getMarket(marketId);
      if (!market) return res.status(404).json({ message: "Prediction market not found." });

      const events = await predictionService.listMarketEvents(marketId);
      return res.json({ marketId, total: events.length, events });
    }
  );

  // ── POST /api/predictions/markets (admin) ──────────────────────────────────

  app.post("/api/predictions/markets", isAuthenticated, isAdminOnly, async (req: any, res) => {
    const parsed = createPredictionMarketSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Validation error", errors: parsed.error.flatten() });
    }
    const result = await predictionService.createMarket({
      ...parsed.data,
      createdByUserId: extractActorId(req),
    });
    if (!result.success) {
      return res.status(422).json({ message: result.error });
    }
    return res.status(201).json(result.data);
  });

  // ── POST /api/predictions/markets/:id/open (admin) ───────────────────────────
  // Dedicated "open market" action. No body required.
  // Transitions: draft → open. Records market_opened lifecycle event.

  app.post(
    "/api/predictions/markets/:id/open",
    isAuthenticated,
    isAdminOnly,
    async (req: any, res) => {
      const marketId = parseInt(req.params.id, 10);
      if (isNaN(marketId)) return res.status(400).json({ message: "Invalid market id." });

      const previousStatus = await fetchPreviousStatus(marketId);
      if (previousStatus === null) return res.status(404).json({ message: "Market not found." });

      const result = await predictionService.transitionMarketStatus({
        marketId,
        targetStatus: "open",
        actorUserId:  extractActorId(req),
      });
      if (!result.success) return res.status(422).json({ message: result.error });

      return res.json({
        ok:             true,
        action:         "open",
        marketId,
        previousStatus,
        newStatus:      "open",
      });
    }
  );

  // ── POST /api/predictions/markets/:id/lock (admin) ───────────────────────────
  // Dedicated "lock market" action. No body required.
  // Transitions: open → locked. Records market_locked lifecycle event.

  app.post(
    "/api/predictions/markets/:id/lock",
    isAuthenticated,
    isAdminOnly,
    async (req: any, res) => {
      const marketId = parseInt(req.params.id, 10);
      if (isNaN(marketId)) return res.status(400).json({ message: "Invalid market id." });

      const previousStatus = await fetchPreviousStatus(marketId);
      if (previousStatus === null) return res.status(404).json({ message: "Market not found." });

      const result = await predictionService.transitionMarketStatus({
        marketId,
        targetStatus: "locked",
        actorUserId:  extractActorId(req),
      });
      if (!result.success) return res.status(422).json({ message: result.error });

      return res.json({
        ok:             true,
        action:         "lock",
        marketId,
        previousStatus,
        newStatus:      "locked",
      });
    }
  );

  // ── POST /api/predictions/markets/:id/transition (admin) ──────────────────────
  // Generic status transition. Kept for backward-compat and CLI/automation use.
  // For new admin UI, prefer the dedicated /open, /lock, /resolve, /cancel routes.
  // Returns normalized AdminMutationResponse.

  app.post(
    "/api/predictions/markets/:id/transition",
    isAuthenticated,
    isAdminOnly,
    async (req: any, res) => {
      const marketId = parseInt(req.params.id, 10);
      if (isNaN(marketId)) return res.status(400).json({ message: "Invalid market id." });

      const parsed = transitionMarketStatusSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Validation error", errors: parsed.error.flatten() });
      }

      const previousStatus = await fetchPreviousStatus(marketId);
      if (previousStatus === null) return res.status(404).json({ message: "Market not found." });

      const result = await predictionService.transitionMarketStatus({
        marketId,
        targetStatus:      parsed.data.targetStatus,
        resolvedOutcomeId: parsed.data.resolvedOutcomeId,
        actorUserId:       extractActorId(req),
      });
      if (!result.success) return res.status(422).json({ message: result.error });

      return res.json({
        ok:             true,
        action:         "transition",
        marketId,
        previousStatus,
        newStatus:      parsed.data.targetStatus,
      });
    }
  );

  // ── POST /api/predictions/markets/:id/resolve (admin) ────────────────────────
  // Resolves a binary prediction market and immediately settles all positions.
  // Market must be "locked" (or "resolved" for idempotent retry).
  // Returns normalized AdminMutationResponse with settlement summary.

  app.post(
    "/api/predictions/markets/:id/resolve",
    isAuthenticated,
    isAdminOnly,
    async (req: any, res) => {
      const marketId = parseInt(req.params.id, 10);
      if (isNaN(marketId)) return res.status(400).json({ message: "Invalid market id." });

      const parsed = resolveMarketSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Validation error", errors: parsed.error.flatten() });
      }

      const previousStatus = await fetchPreviousStatus(marketId);
      if (previousStatus === null) return res.status(404).json({ message: "Market not found." });

      const result = await predictionService.resolveAndSettleMarket({
        marketId,
        winningOutcomeId:  parsed.data.winningOutcomeId,
        actorUserId:       extractActorId(req),
        resolutionSource:  parsed.data.resolutionSource,
        note:              parsed.data.note,
      });

      if (!result.success) {
        const isClientError =
          result.error?.includes("not found") ||
          result.error?.includes("does not belong") ||
          result.error?.includes("cannot be resolved") ||
          result.error?.includes("already resolved with");
        return res.status(isClientError ? 422 : 500).json({ message: result.error });
      }

      const d = result.data!;
      return res.json({
        ok:               true,
        action:           "resolve",
        marketId:         d.marketId,
        previousStatus,
        newStatus:        d.status,
        duplicate:        d.duplicate,
        winningOutcomeId: d.winningOutcomeId,
        positionsSettled: d.positionsSettled,
        positionsSkipped: d.positionsSkipped,
        totalWinnerPayout: d.totalWinnerPayout,
      });
    }
  );

  // ── POST /api/predictions/markets/:id/cancel (admin) ─────────────────────────
  // Cancels a market and refunds all active positions.
  // Market must be in: draft | open | locked.
  // Returns normalized AdminMutationResponse with refund summary.

  app.post(
    "/api/predictions/markets/:id/cancel",
    isAuthenticated,
    isAdminOnly,
    async (req: any, res) => {
      const marketId = parseInt(req.params.id, 10);
      if (isNaN(marketId)) return res.status(400).json({ message: "Invalid market id." });

      const parsed = cancelMarketSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Validation error", errors: parsed.error.flatten() });
      }

      const previousStatus = await fetchPreviousStatus(marketId);
      if (previousStatus === null) return res.status(404).json({ message: "Market not found." });

      const result = await predictionService.cancelAndRefundMarket({
        marketId,
        actorUserId: extractActorId(req),
        reason:      parsed.data.reason,
        note:        parsed.data.note,
      });

      if (!result.success) {
        const isClientError =
          result.error?.includes("not found") ||
          result.error?.includes("Cannot cancel") ||
          result.error?.includes("not eligible");
        return res.status(isClientError ? 422 : 500).json({ message: result.error });
      }

      const d = result.data!;
      return res.json({
        ok:                  true,
        action:              "cancel",
        marketId:            d.marketId,
        previousStatus,
        newStatus:           d.status,
        duplicate:           d.duplicate,
        positionsCancelled:  d.positionsCancelled,
        totalRefunded:       d.totalRefunded,
        currency:            d.currency,
      });
    }
  );

  // ── GET /api/predictions/markets/:id/admin-summary (admin) ────────────────────
  // Compact operational snapshot for admin UI / Market Lab.
  // Returns: market identity + status, event context, outcomes, stats,
  //          position counts by status, available lifecycle actions, and
  //          a pointer to the events audit trail.

  app.get(
    "/api/predictions/markets/:id/admin-summary",
    isAuthenticated,
    isAdminOnly,
    async (req: any, res) => {
      const marketId = parseInt(req.params.id, 10);
      if (isNaN(marketId)) return res.status(400).json({ message: "Invalid market id." });

      try {
        const summary = await predictionService.getAdminSummary(marketId);
        if (!summary) return res.status(404).json({ message: "Market not found." });
        return res.json(summary);
      } catch (err: any) {
        console.error("[Prediction] GET /admin-summary error:", err.message);
        return res.status(500).json({ message: "Failed to retrieve admin summary." });
      }
    }
  );

  // ── GET /api/predictions/markets/:id/external-resolution-context (admin) ──────
  // Read-only debug endpoint: loads the PandaScore match data for a market and
  // returns the consolidated resolution context (no side effects, no settlement).
  app.get(
    "/api/predictions/markets/:id/external-resolution-context",
    isAuthenticated,
    isAdminOnly,
    async (req: any, res) => {
      const marketId = parseInt(req.params.id, 10);
      if (isNaN(marketId)) return res.status(400).json({ message: "Invalid market id." });

      try {
        const ctx = await getExternalMatchResolutionContext(marketId);
        return res.json(ctx);
      } catch (err: any) {
        if (err instanceof ResolutionContextError) {
          const status =
            err.code === "MARKET_NOT_FOUND" ? 404
            : err.code === "NO_EVENT"       ? 422
            : err.code === "NO_EXTERNAL_REF"      ? 422
            : err.code === "UNSUPPORTED_PROVIDER" ? 422
            : err.code === "PANDASCORE_ERROR"     ? 502
            : 500;
          return res.status(status).json({ message: err.message, code: err.code });
        }
        console.error("[Prediction] GET /external-resolution-context error:", err.message);
        return res.status(500).json({ message: "Failed to retrieve resolution context." });
      }
    }
  );

  // ── POST /api/predictions/markets/:id/resolve-from-provider (admin) ─────────
  // Manual trigger: resolves a market using live PandaScore data.
  // Admin-only. Safe to call multiple times — idempotent by design.
  // No body required. Optional JSON body: { "actor": "admin-user-id" }
  app.post(
    "/api/predictions/markets/:id/resolve-from-provider",
    isAuthenticated,
    isAdminOnly,
    async (req: any, res) => {
      const marketId = parseInt(req.params.id, 10);
      if (isNaN(marketId)) return res.status(400).json({ message: "Invalid market id." });

      const actor: string = req.body?.actor ?? req.user?.id ?? "PANDASCORE";

      try {
        const result = await resolvePredictionMarketFromProvider(marketId, actor);
        const httpStatus =
          result.status === "RESOLVED"               ? 200
          : result.status === "ALREADY_RESOLVED"     ? 200
          : result.status === "MANUAL_REVIEW_REQUIRED" ? 422
          : 200;
        return res.status(httpStatus).json(result);
      } catch (err: any) {
        if (err.message?.includes("not found")) {
          return res.status(404).json({ message: err.message });
        }
        console.error("[Prediction] POST /resolve-from-provider error:", err.message);
        return res.status(500).json({ message: "Provider resolution failed unexpectedly." });
      }
    }
  );

  // ── POST /api/predictions/provider-resolution/run (admin) ───────────────────
  // Batch resolution: scans all MATCH_WINNER open/locked markets with a
  // PANDASCORE externalRef whose event has already started, and attempts to
  // resolve each one via live PandaScore data.
  //
  // Admin-only. Safe to call multiple times — each market call is idempotent.
  // Optional JSON body:
  //   { "limit": 50 }   — cap on markets fetched (default: 100)
  //   { "actor": "..." } — ledger actor label (default: "batch_resolver")
  //
  // Returns 409 if a batch is already running in this process.
  app.post(
    "/api/predictions/provider-resolution/run",
    isAuthenticated,
    isAdminOnly,
    async (req: any, res) => {
      if (isBatchRunning()) {
        return res.status(409).json({
          message: "A provider resolution batch is already running in this process. Retry shortly.",
        });
      }

      const limit = req.body?.limit ? parseInt(req.body.limit, 10) : 100;
      const actor: string = req.body?.actor ?? req.user?.id ?? "batch_resolver";

      if (isNaN(limit) || limit < 1 || limit > 500) {
        return res.status(400).json({ message: "limit must be 1–500." });
      }

      try {
        const summary = await resolveEligiblePredictionMarketsFromProviders({ limit, actor });
        return res.status(200).json(summary);
      } catch (err: any) {
        console.error("[Prediction] POST /provider-resolution/run error:", err.message);
        return res.status(500).json({ message: "Batch resolution failed unexpectedly." });
      }
    }
  );

  // ── GET /api/predictions/admin/markets/drafts (admin) ─────────────────────
  app.get(
    "/api/predictions/admin/markets/drafts",
    isAuthenticated,
    isAdminOnly,
    async (req: any, res) => {
      try {
        const eventIdParam = req.query.eventId ? Number(req.query.eventId) : undefined;
        if (eventIdParam !== undefined && (isNaN(eventIdParam) || eventIdParam <= 0)) {
          return res.status(400).json({ message: "Invalid eventId parameter" });
        }
        const items = await predictionRepository.listDraftMarketsWithEvent(eventIdParam);
        return res.json({
          ok: true,
          total: items.length,
          items: items.map((item) => ({
            marketId:     item.market.id,
            uid:          item.market.uid,
            slug:         item.market.slug,
            question:     item.market.question,
            marketType:   item.market.marketType,
            status:       item.market.status,
            createdAt:    item.market.createdAt,
            eventId:      item.event?.id ?? null,
            eventTitle:   item.event?.title ?? null,
            teamAName:    item.event?.teamAName ?? null,
            teamBName:    item.event?.teamBName ?? null,
            startsAt:     item.event?.startsAt ?? null,
            game:         item.event?.game ?? null,
            outcomes:     item.outcomes.map((o) => ({
              id:    o.id,
              label: o.label,
              code:  o.code,
            })),
          })),
        });
      } catch (err: any) {
        console.error("[Prediction] GET /admin/markets/drafts error:", err.message);
        return res.status(500).json({ message: "Failed to list draft markets." });
      }
    }
  );

  // ── POST /api/predictions/admin/markets/backfill-queue (admin) ────────────────
  // Creates + immediately opens a binary market for every active Display Queue
  // event that does not yet have an open or locked market. Safe to call multiple
  // times (idempotent per event).

  app.post(
    "/api/predictions/admin/markets/backfill-queue",
    isAuthenticated,
    isAdminOnly,
    async (req: any, res) => {
      try {
        const adminId: string = req.user?.id ?? "system";

        // 1. Fetch all active queue event IDs
        const queueItems = await predictionRepository.getQueuedSurfaces(["hero", "featured", "upcoming", "home"]);
        const queueEventIds = Array.from(new Set(
          queueItems.filter((q) => q.entityType === "event").map((q) => q.entityId!)
        ));
        if (queueEventIds.length === 0) {
          return res.json({ ok: true, created: 0, opened: 0, skipped: 0, errors: 0, detail: [] });
        }

        // 2. Find existing open/locked markets for these events (skip them)
        const existingTradeableMap = await predictionRepository.findTradeableMarketsByEventIds(queueEventIds);

        // 3. Find events that need a market
        const events = await predictionRepository.findEventsByIds(queueEventIds);
        const eventMap = new Map(events.map((e) => [e.id, e]));

        let created = 0, opened = 0, skipped = 0, errors = 0;
        const detail: Array<{ eventId: number; status: string; marketId?: number; note?: string }> = [];

        for (const eventId of queueEventIds) {
          if (existingTradeableMap.has(eventId)) {
            skipped++;
            detail.push({ eventId, status: "skipped", note: "already has open/locked market" });
            continue;
          }

          const event = eventMap.get(eventId);
          if (!event) {
            errors++;
            detail.push({ eventId, status: "error", note: "event not found" });
            continue;
          }

          try {
            // Check for any draft market first (idempotent)
            const existingDraft = await predictionRepository.findFirstMarketByEventAndType(eventId, "binary");

            let marketId: number;
            if (existingDraft) {
              marketId = existingDraft.id;
              detail.push({ eventId, status: "found_draft", marketId, note: "reusing existing draft" });
            } else {
              const teamA = event.teamAName?.trim() || null;
              const teamB = event.teamBName?.trim() || null;
              const bothPresent = !!(teamA && teamB);
              const question = bothPresent
                ? `${teamA} vs ${teamB} — Who wins?`
                : `${event.title} — What's the outcome?`;

              const mkResult = await predictionService.createMarket({
                eventId,
                question,
                description: `Auto-created backfill market for "${event.title}"`,
                marketType: "binary",
                currency: "GS",
                minStake: "1.000000",
                resolutionSource: "admin",
                createdByUserId: adminId,
                outcomes: bothPresent
                  ? [
                      { label: teamA!, code: "TEAM_A", sortOrder: 0, impliedProbability: "0.5" },
                      { label: teamB!, code: "TEAM_B", sortOrder: 1, impliedProbability: "0.5" },
                    ]
                  : [
                      { label: "YES", code: "yes", sortOrder: 0, impliedProbability: "0.5" },
                      { label: "NO",  code: "no",  sortOrder: 1, impliedProbability: "0.5" },
                    ],
              });

              if (!mkResult.success || !mkResult.data) {
                errors++;
                detail.push({ eventId, status: "error", note: mkResult.error ?? "createMarket failed" });
                continue;
              }
              marketId = mkResult.data.marketId;
              created++;
              detail.push({ eventId, status: "created", marketId });
            }

            // Open the market
            const openResult = await predictionService.transitionMarketStatus({
              marketId,
              targetStatus: "open",
              actorUserId: adminId,
            });

            if (openResult.success) {
              opened++;
              const existing = detail.find((d) => d.marketId === marketId);
              if (existing) existing.status = existing.status === "created" ? "created+opened" : "opened";
            } else {
              errors++;
              const existing = detail.find((d) => d.marketId === marketId);
              if (existing) existing.note = `open failed: ${openResult.error}`;
            }
          } catch (innerErr: any) {
            errors++;
            detail.push({ eventId, status: "error", note: innerErr.message });
          }
        }

        console.log(`[Prediction] Backfill queue: created=${created} opened=${opened} skipped=${skipped} errors=${errors}`);
        return res.json({ ok: true, created, opened, skipped, errors, detail });
      } catch (err: any) {
        console.error("[Prediction] POST /admin/markets/backfill-queue error:", err.message);
        return res.status(500).json({ message: "Backfill failed." });
      }
    }
  );

  // ── POST /api/predictions/orders (auth) — Sprint 2 order placement ──────────

  app.post("/api/predictions/orders", isAuthenticated, async (req: any, res) => {
    const userId = extractUserId(req);
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const headerKey = req.headers["idempotency-key"];
    const bodyWithKey = {
      ...req.body,
      ...(headerKey ? { idempotencyKey: String(headerKey) } : {}),
    };

    const parsed = placeOrderSchema.safeParse(bodyWithKey);
    if (!parsed.success) {
      return res.status(400).json({ message: "Validation error", errors: parsed.error.flatten() });
    }

    const result = await predictionService.placeOrder({
      userId,
      marketId:       parsed.data.marketId,
      outcomeId:      parsed.data.outcomeId,
      side:           "buy",
      orderType:      "market",
      quantity:       parsed.data.quantity,
      price:          parsed.data.price,
      currency:       parsed.data.currency,
      idempotencyKey: parsed.data.idempotencyKey,
    });

    if (!result.success) {
      const isClientError =
        result.error?.includes("not found") ||
        result.error?.includes("not open") ||
        result.error?.includes("expired") ||
        result.error?.includes("Outcome does not belong") ||
        result.error?.includes("below the minimum") ||
        result.error?.includes("exceeds the maximum") ||
        result.error?.includes("Insufficient");

      return res.status(isClientError ? 422 : 500).json({ message: result.error });
    }

    const statusCode = result.data!.duplicate ? 200 : 201;
    return res.status(statusCode).json(result.data);
  });

  // ── POST /api/predictions/trades (auth) — Phase 2 BUY MARKET trade ─────────
  //
  // New amountUsd-driven trade endpoint. Coexists with /orders (placeOrder).
  // Accepts: { marketId, sideId, action, orderType, amountUsd, idempotencyKey }
  // Returns: ExecuteTradeResult with executedPrice, shares, position + wallet summary.

  app.post("/api/predictions/trades", isAuthenticated, async (req: any, res) => {
    const userId = extractUserId(req);
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const {
      marketId,
      sideId,
      action,
      orderType,
      amountUsd,
      idempotencyKey,
    } = req.body;

    // Basic type validation before hitting the service
    if (!Number.isInteger(marketId) || marketId <= 0) {
      return res.status(400).json({ message: "marketId must be a positive integer." });
    }
    if (!Number.isInteger(sideId) || sideId <= 0) {
      return res.status(400).json({ message: "sideId must be a positive integer." });
    }
    if (action !== "BUY" && action !== "SELL") {
      return res.status(400).json({ message: "action must be \"BUY\" or \"SELL\"." });
    }
    if (orderType !== "MARKET") {
      return res.status(400).json({ message: "orderType must be \"MARKET\"." });
    }
    const parsedAmount = parseFloat(amountUsd);
    if (!isFinite(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ message: "amountUsd must be a positive number." });
    }
    if (!idempotencyKey || typeof idempotencyKey !== "string" || idempotencyKey.trim() === "") {
      return res.status(400).json({ message: "idempotencyKey is required." });
    }

    const result = await predictionService.executeMarketTrade({
      userId,
      marketId,
      sideId,
      action:    action as "BUY" | "SELL",
      orderType: "MARKET",
      amountUsd: parsedAmount,
      idempotencyKey: idempotencyKey.trim(),
    });

    if (!result.success) {
      const clientErrors = [
        "not found", "not open", "expired", "does not belong",
        "No tradable price", "Insufficient", "must be a positive",
      ];
      const isClientError = clientErrors.some(e => result.error?.includes(e));
      return res.status(isClientError ? 422 : 500).json({ message: result.error });
    }

    const statusCode = result.data!.duplicate ? 200 : 201;
    return res.status(statusCode).json(result.data);
  });

  // ── POST /api/predictions/markets/:id/bet (auth) — Sprint 1 legacy ─────────

  app.post("/api/predictions/markets/:id/bet", isAuthenticated, async (req: any, res) => {
    const marketId = parseInt(req.params.id, 10);
    if (isNaN(marketId)) return res.status(400).json({ message: "Invalid market id." });

    const userId = extractUserId(req);
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const parsed = placeBetSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Validation error", errors: parsed.error.flatten() });
    }
    const result = await predictionService.placeBet({
      userId,
      marketId,
      outcomeId: parsed.data.outcomeId,
      stake:     parsed.data.stake,
      currency:  parsed.data.currency,
    });
    if (!result.success) {
      return res.status(422).json({ message: result.error });
    }
    return res.status(201).json(result.data);
  });

  // ── GET /api/predictions/me/positions (auth) — enriched (Sprint 3) ─────────
  // Returns active positions enriched with market/outcome/event context.
  // Replaces the bare findPositionsByUser call from Sprint 2.

  app.get("/api/predictions/me/positions", isAuthenticated, async (req: any, res) => {
    const userId = extractUserId(req);
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    try {
      const positions = await predictionService.getMyPositions(userId);
      return res.json({ positions, total: positions.length });
    } catch (err: any) {
      console.error("[Prediction] GET /me/positions error:", err.message);
      return res.status(500).json({ message: "Failed to retrieve positions." });
    }
  });

  // ── GET /api/predictions/me/history (auth) ────────────────────────────────
  // Settled and cancelled positions with payout / refund context.

  app.get("/api/predictions/me/history", isAuthenticated, async (req: any, res) => {
    const userId = extractUserId(req);
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    try {
      const positions = await predictionService.getMyHistory(userId);
      return res.json({ positions, total: positions.length });
    } catch (err: any) {
      console.error("[Prediction] GET /me/history error:", err.message);
      return res.status(500).json({ message: "Failed to retrieve position history." });
    }
  });

  // ── GET /api/predictions/me/portfolio (auth) — Sprint 4 ──────────────────
  // Composed portfolio view: summary aggregates + active positions grouped by
  // market + compact recent history (capped at PORTFOLIO_HISTORY_LIMIT rows).
  // Read-model only — no wallet or ledger coupling.

  app.get("/api/predictions/me/portfolio", isAuthenticated, async (req: any, res) => {
    const userId = extractUserId(req);
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    try {
      const portfolio = await predictionService.getMyPortfolio(userId);
      return res.json(portfolio);
    } catch (err: any) {
      console.error("[Prediction] GET /me/portfolio error:", err.message);
      return res.status(500).json({ message: "Failed to retrieve prediction portfolio." });
    }
  });

  // ── GET /api/predictions/me/orders (auth) ─────────────────────────────────

  app.get("/api/predictions/me/orders", isAuthenticated, async (req: any, res) => {
    const userId = extractUserId(req);
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const marketId = req.query.marketId
      ? parseInt(req.query.marketId as string, 10)
      : undefined;

    try {
      const orders = await predictionRepository.findOrdersByUser(userId, marketId);
      return res.json({ orders, total: orders.length });
    } catch (err: any) {
      console.error("[Prediction] GET /me/orders error:", err.message);
      return res.status(500).json({ message: "Failed to retrieve orders." });
    }
  });

  // ── Sprint 4 Home Discovery (auth) ──────────────────────────────────────────
  // GET /api/predictions/home — compact aggregated view for the Home screen.
  // Auth: isAuthenticated — consistent with all prediction browse endpoints.
  // Returns PredictionHomeResponse: liveMatches, trendingPredictions,
  // upcomingEvents, hotPlayers (null), generatedAt, totalLive.
  // No query params — sections use fixed internal limits (8 items each).
  app.get("/api/predictions/home", isAuthenticated, async (_req, res) => {
    try {
      const home = await predictionService.getHome();
      return res.json(home);
    } catch (err) {
      console.error("[Prediction:home]", err);
      return res.status(500).json({ message: "Failed to load home data" });
    }
  });

  // ── Sprint 4 Browse Endpoint (auth) ─────────────────────────────────────────
  // GET /api/predictions/browse
  // Unified paginated market list — supersedes the narrow /live, /upcoming, /resolved
  // endpoints for new UI work (those endpoints are kept for backward compat).
  //
  // Query params:
  //   tab        = live | upcoming | resolved
  //   statuses   = comma-separated DB statuses (overrides tab)
  //   game       = e.g. "lol" (filter by prediction_events.game)
  //   currency   = "GS" | "USDC"
  //   eventId    = number
  //   sort       = closing_soon | newest | volume_desc
  //   page       = number (default 1)
  //   limit      = 1-100 (default 20)
  app.get("/api/predictions/browse", isAuthenticated, async (req: any, res) => {
    const VALID_TABS     = ["all", "live", "upcoming", "resolved"];
    const VALID_SORTS    = ["closing_soon", "newest", "volume_desc"];
    const VALID_STATUSES = ["draft", "open", "locked", "resolved", "settled", "cancelled"];

    try {
      const rawTab      = (req.query.tab      as string | undefined)?.trim();
      const rawStatuses = (req.query.statuses as string | undefined)?.trim();
      const rawSort     = (req.query.sort     as string | undefined)?.trim();
      const rawEventId  = (req.query.eventId  as string | undefined)?.trim();
      const game        = (req.query.game     as string | undefined)?.trim() || undefined;
      const currency    = (req.query.currency as string | undefined)?.trim() || undefined;

      // Validate tab
      if (rawTab && !VALID_TABS.includes(rawTab)) {
        return res.status(400).json({
          message: `Invalid tab. Must be one of: ${VALID_TABS.join(", ")}.`,
        });
      }
      // Validate sort
      if (rawSort && !VALID_SORTS.includes(rawSort)) {
        return res.status(400).json({
          message: `Invalid sort. Must be one of: ${VALID_SORTS.join(", ")}.`,
        });
      }
      // Parse + validate explicit statuses (comma-separated)
      let statuses: string[] | undefined;
      if (rawStatuses) {
        const parts   = rawStatuses.split(",").map((s) => s.trim()).filter(Boolean);
        const invalid = parts.filter((s) => !VALID_STATUSES.includes(s));
        if (invalid.length > 0) {
          return res.status(400).json({
            message: `Invalid statuses: ${invalid.join(", ")}. Must be one of: ${VALID_STATUSES.join(", ")}.`,
          });
        }
        statuses = parts;
      }
      // Pagination
      const page  = req.query.page  ? parseInt(req.query.page  as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
      if (isNaN(page)  || page  < 1)          return res.status(400).json({ message: "Invalid page: must be a positive integer." });
      if (isNaN(limit) || limit < 1 || limit > 100) return res.status(400).json({ message: "Invalid limit: must be between 1 and 100." });
      // eventId
      let eventId: number | undefined;
      if (rawEventId) {
        eventId = parseInt(rawEventId, 10);
        if (isNaN(eventId)) return res.status(400).json({ message: "Invalid eventId: must be a number." });
      }

      // Sprint 4.5: resolve userId from session — overlay userHasPosition on each card.
      const userId = extractUserId(req) ?? undefined;

      const result = await predictionService.getMarketsBrowse({
        tab:      rawTab      as any,
        statuses,
        sort:     rawSort     as any,
        game,
        currency,
        eventId,
        page,
        limit,
        userId,
      });
      return res.json(result);
    } catch (err: any) {
      console.error("[Prediction] GET /browse error:", err.message);
      return res.status(500).json({ message: "Failed to browse prediction markets." });
    }
  });

  // ── Sprint 3 Product-facing market browse endpoints (auth) ─────────────────
  // Auth: isAuthenticated — consistent with existing /api/predictions/markets.
  // All three return PredictionMarketPage shape with outcomes, event, and stats.

  // GET /api/predictions/live — open markets still accepting orders
  app.get("/api/predictions/live", isAuthenticated, async (req: any, res) => {
    const page     = req.query.page     ? parseInt(req.query.page  as string, 10) : 1;
    const limit    = req.query.limit    ? parseInt(req.query.limit as string, 10) : 20;
    const currency = (req.query.currency as string | undefined) || undefined;
    const eventId  = req.query.eventId  ? parseInt(req.query.eventId as string, 10) : undefined;

    try {
      const result = await predictionService.getLiveMarkets({ page, limit, currency, eventId });
      return res.json(result);
    } catch (err: any) {
      console.error("[Prediction] GET /live error:", err.message);
      return res.status(500).json({ message: "Failed to retrieve live markets." });
    }
  });

  // GET /api/predictions/upcoming — draft markets not yet open to trading
  app.get("/api/predictions/upcoming", isAuthenticated, async (req: any, res) => {
    const page     = req.query.page     ? parseInt(req.query.page  as string, 10) : 1;
    const limit    = req.query.limit    ? parseInt(req.query.limit as string, 10) : 20;
    const currency = (req.query.currency as string | undefined) || undefined;
    const eventId  = req.query.eventId  ? parseInt(req.query.eventId as string, 10) : undefined;

    try {
      const result = await predictionService.getUpcomingMarkets({ page, limit, currency, eventId });
      return res.json(result);
    } catch (err: any) {
      console.error("[Prediction] GET /upcoming error:", err.message);
      return res.status(500).json({ message: "Failed to retrieve upcoming markets." });
    }
  });

  // GET /api/predictions/resolved — settled, cancelled, or mid-resolution markets
  app.get("/api/predictions/resolved", isAuthenticated, async (req: any, res) => {
    const page     = req.query.page     ? parseInt(req.query.page  as string, 10) : 1;
    const limit    = req.query.limit    ? parseInt(req.query.limit as string, 10) : 20;
    const currency = (req.query.currency as string | undefined) || undefined;
    const eventId  = req.query.eventId  ? parseInt(req.query.eventId as string, 10) : undefined;

    try {
      const result = await predictionService.getResolvedMarkets({ page, limit, currency, eventId });
      return res.json(result);
    } catch (err: any) {
      console.error("[Prediction] GET /resolved error:", err.message);
      return res.status(500).json({ message: "Failed to retrieve resolved markets." });
    }
  });

  console.log("[Prediction] Routes registered — Sprint 3 complete (read APIs added).");
}

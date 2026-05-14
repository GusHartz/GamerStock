import type { Express, RequestHandler } from "express";
import { db } from "../../db";
import {
  performanceScores,
  playerMatchMetrics,
  roleBaselines,
  roleMetricWeights,
} from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";
import { getPerformanceProvider } from "../../integrations/performance-provider-factory";

const isAuthenticated: RequestHandler = (req: any, res, next) => {
  if (req.session?.isAdmin || req.session?.userId) return next();
  if (typeof req.isAuthenticated === "function" && req.isAuthenticated()) return next();
  return res.status(401).json({ message: "Unauthorized" });
};

/**
 * Performance Engine domain routes.
 *
 * Covers: match performance scores, player fundamentals,
 * role baselines, and match-level metrics reads.
 * Migrated from server/routes.ts — Phase 3A.
 *
 * Phase 5B migration notes:
 * - GET /api/player/fundamentals/:puuid → provider.getPlayerFundamentals()
 * - GET /api/performance/asset/:assetId/latest → provider.getLatestPerformanceScore()
 *
 * NOT migrated to provider (intentionally):
 * - /api/admin/performance/baselines — returns engine-internal roleBaselines /
 *   roleMetricWeights rows. These are private to the scoring pipeline, not
 *   player-facing data. Adding them to the provider interface would couple
 *   the contract to engine implementation details.
 * - /api/admin/performance/player/:assetId — returns raw performanceScores +
 *   playerMatchMetrics for admin inspection. Same reasoning.
 * - /api/admin/performance/match/:matchId — raw match detail for admin debugging.
 */
export function registerPerformanceRoutes(app: Express): void {
  // ─── Player Fundamentals ─────────────────────────────────────────────────────
  app.get("/api/player/fundamentals/:puuid", isAuthenticated, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const { puuid } = req.params;
      const provider = await getPerformanceProvider();
      const fundamentals = await provider.getPlayerFundamentals(puuid);

      if (!fundamentals) return res.status(404).json({ error: "Player not found" });

      const games = fundamentals.wins + fundamentals.losses;

      res.json({
        wins: fundamentals.wins,
        losses: fundamentals.losses,
        games,
        winRate: parseFloat(fundamentals.winrate.toFixed(1)),
        leaguePoints: fundamentals.leaguePoints,
        momentum: fundamentals.momentum,
        recentPerformance: fundamentals.recentPerformance,
        consistencyScore: fundamentals.consistencyScore,
        historicalSkill: fundamentals.historicalSkill,
        activityScore: fundamentals.activityScore,
        pviRaw: fundamentals.pviRaw,
        pviFinal: fundamentals.pviFinal,
        fairValueGS: fundamentals.fairValueGS,
        divergencePct: fundamentals.divergencePct,
        confidence: fundamentals.confidence,
        lastMatchPulse: fundamentals.lastMatchPulse,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Public: Latest performance score for an asset ───────────────────────────
  app.get("/api/performance/asset/:assetId/latest", async (req, res) => {
    try {
      const { assetId } = req.params;
      const puuid = assetId.includes(":") ? assetId.split(":").slice(3).join(":") : assetId;

      const provider = await getPerformanceProvider();
      const score = await provider.getLatestPerformanceScore(puuid);

      if (!score) return res.json({ score: null });

      res.json({
        score: {
          assetId: score.puuid,
          matchId: score.matchId,
          role: score.role,
          matchScore: score.matchScore,
          emaScore: score.emaScore,
          createdAt: score.recordedAt,
        },
      });
    } catch (e) {
      console.error("[Perf] GET /api/performance/asset/:assetId/latest error:", e);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ─── Admin: Performance Baselines ────────────────────────────────────────────
  app.get("/api/admin/performance/baselines", async (req: any, res) => {
    if (req.user?.role !== "admin" && req.session?.userRole !== "admin") {
      return res.status(403).json({ message: "Admin only" });
    }
    try {
      const { game, role } = req.query as Record<string, string>;

      const conditions = [];
      if (game) conditions.push(eq(roleBaselines.game, game));
      if (role) conditions.push(eq(roleBaselines.role, role));

      const rows = conditions.length > 0
        ? await db.select().from(roleBaselines).where(and(...conditions)).orderBy(roleBaselines.role, roleBaselines.metric)
        : await db.select().from(roleBaselines).orderBy(roleBaselines.role, roleBaselines.metric);

      const weights = await db.select().from(roleMetricWeights).orderBy(roleMetricWeights.role, roleMetricWeights.metric);

      res.json({ baselines: rows, weights });
    } catch (e) {
      console.error("[Admin/Perf] GET /baselines error:", e);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ─── Admin: Player Performance History ───────────────────────────────────────
  app.get("/api/admin/performance/player/:assetId", async (req: any, res) => {
    if (req.user?.role !== "admin" && req.session?.userRole !== "admin") {
      return res.status(403).json({ message: "Admin only" });
    }
    try {
      const { assetId } = req.params;
      const puuid = assetId.includes(":") ? assetId.split(":").slice(3).join(":") : assetId;

      const scores = await db
        .select()
        .from(performanceScores)
        .where(eq(performanceScores.assetId, puuid))
        .orderBy(desc(performanceScores.createdAt))
        .limit(20);

      const metrics = await db
        .select()
        .from(playerMatchMetrics)
        .where(eq(playerMatchMetrics.assetId, puuid))
        .orderBy(desc(playerMatchMetrics.createdAt))
        .limit(10);

      res.json({ assetId: puuid, scores, metrics });
    } catch (e) {
      console.error("[Admin/Perf] GET /player/:assetId error:", e);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ─── Admin: Match Performance Detail ─────────────────────────────────────────
  app.get("/api/admin/performance/match/:matchId", async (req: any, res) => {
    if (req.user?.role !== "admin" && req.session?.userRole !== "admin") {
      return res.status(403).json({ message: "Admin only" });
    }
    try {
      const { matchId } = req.params;

      const metrics = await db
        .select()
        .from(playerMatchMetrics)
        .where(eq(playerMatchMetrics.matchId, matchId));

      const scores = await db
        .select()
        .from(performanceScores)
        .where(eq(performanceScores.matchId, matchId));

      res.json({ matchId, metrics, scores });
    } catch (e) {
      console.error("[Admin/Perf] GET /match/:matchId error:", e);
      res.status(500).json({ message: "Internal server error" });
    }
  });
}

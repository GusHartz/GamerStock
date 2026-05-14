import type { Express, RequestHandler } from "express";
import { getPerformanceProvider } from "../../integrations/performance-provider-factory";

const isAuthenticated: RequestHandler = (req: any, res, next) => {
  if (req.session?.isAdmin || req.session?.userId) return next();
  if (typeof req.isAuthenticated === "function" && req.isAuthenticated()) return next();
  return res.status(401).json({ message: "Unauthorized" });
};

/**
 * Player Registry domain routes.
 *
 * Covers: Riot player leaderboard, player list.
 * Migrated from server/routes.ts — Phase 3A.
 * Phase 5A — getPlayers / getPlayerCount through PerformanceProvider.
 * Phase 5B — getLeaderboard through PerformanceProvider.
 */
export function registerPlayerRoutes(app: Express): void {
  app.get("/api/riot/leaderboard", isAuthenticated, async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const provider = await getPerformanceProvider();
      const data = await provider.getLeaderboard(300);
      res.json({ data, total: data.length });
    } catch (err: any) {
      console.error("[RIOT] Leaderboard error:", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/riot/players", isAuthenticated, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const search = typeof req.query.search === "string" ? req.query.search : undefined;
      const provider = await getPerformanceProvider();
      const players = await provider.getPlayers({ search });
      const total = await provider.getPlayerCount();
      res.json({ data: players, total, provider: provider.providerName });
    } catch (err: any) {
      console.error("[RIOT] Get players error:", err.message);
      res.status(500).json({ message: err.message });
    }
  });
}

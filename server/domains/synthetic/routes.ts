/**
 * server/domains/synthetic/routes.ts
 *
 * REST endpoints for the Synthetic Market Engine (demo mode).
 * Used by the terminal when no real Riot assets are available.
 *
 * Routes:
 *   GET /api/synthetic/terminal          → full read model (rows + tape + discovery + index)
 *   GET /api/synthetic/player/:id        → single player detail + valuation
 *   GET /api/synthetic/player/:id/history → price history for tf=24h|7d|30d
 */

import type { Express } from "express";
import {
  buildTerminalReadModel,
  buildPlayerDetail,
  buildPlayerHistory,
} from "../../simulation/synthetic-market/index";

export function registerSyntheticRoutes(app: Express): void {
  app.get("/api/synthetic/terminal", (_req, res) => {
    try {
      const model = buildTerminalReadModel();
      res.json(model);
    } catch (err) {
      console.error("[synthetic/terminal] error:", err);
      res.status(500).json({ error: "Failed to build synthetic read model" });
    }
  });

  app.get("/api/synthetic/player/:id", (req, res) => {
    const { id } = req.params;
    const detail = buildPlayerDetail(id);
    if (!detail) return res.status(404).json({ error: "Synthetic player not found" });
    res.json(detail);
  });

  app.get("/api/synthetic/player/:id/history", (req, res) => {
    const { id } = req.params;
    const tf = (req.query.tf as string) ?? "24h";
    if (!["24h", "7d", "30d"].includes(tf)) {
      return res.status(400).json({ error: "Invalid tf; use 24h, 7d, or 30d" });
    }
    const history = buildPlayerHistory(id, tf as "24h" | "7d" | "30d");
    if (!history) return res.status(404).json({ error: "Synthetic player not found" });
    res.json({ playerId: id, tf, snapshots: history });
  });
}

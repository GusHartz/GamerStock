// ─── Player Public Domain — Routes ────────────────────────────────────────────
// Public endpoints — no authentication required.
// ─────────────────────────────────────────────────────────────────────────────
import type { Express } from "express";
import { getPlayerPublicOverview, getPlayerPublicPerformanceHistory } from "./service";
import type { PerfRange, PerfMetric } from "./types";

const VALID_RANGES  = new Set<PerfRange>(["7d", "30d", "90d"]);
const VALID_METRICS = new Set<PerfMetric>(["price", "volume", "momentum"]);

export function registerPlayerPublicRoutes(app: Express): void {

  // ── GET /api/player-public/:assetId/overview ─────────────────────────────
  // Public — no auth required. Returns the public read model for a player asset.
  app.get("/api/player-public/:assetId/overview", async (req, res) => {
    const assetId = Number(req.params.assetId);
    if (isNaN(assetId) || assetId <= 0) {
      return res.status(400).json({ message: "Invalid asset ID." });
    }

    try {
      const overview = await getPlayerPublicOverview(assetId);
      return res.json(overview);
    } catch (err: any) {
      if (err.statusCode === 404) {
        return res.status(404).json({ message: "Asset not found." });
      }
      console.error("[PlayerPublic] GET /overview:", err.message);
      return res.status(500).json({ message: "Internal server error." });
    }
  });

  // ── GET /api/player-public/:assetId/performance-history ──────────────────
  // Public — no auth required.
  // Query params:
  //   range  = 7d | 30d | 90d  (default: 30d)
  //   metric = price | volume | momentum  (default: price)
  app.get("/api/player-public/:assetId/performance-history", async (req, res) => {
    const assetId = Number(req.params.assetId);
    if (isNaN(assetId) || assetId <= 0) {
      return res.status(400).json({ message: "Invalid asset ID." });
    }

    const rawRange  = String(req.query.range  ?? "30d");
    const rawMetric = String(req.query.metric ?? "price");

    if (!VALID_RANGES.has(rawRange as PerfRange)) {
      return res.status(400).json({ message: "Invalid range. Use: 7d, 30d, 90d." });
    }
    if (!VALID_METRICS.has(rawMetric as PerfMetric)) {
      return res.status(400).json({ message: "Invalid metric. Use: price, volume, momentum." });
    }

    try {
      const history = await getPlayerPublicPerformanceHistory(
        assetId,
        rawRange  as PerfRange,
        rawMetric as PerfMetric,
      );
      return res.json(history);
    } catch (err: any) {
      if (err.statusCode === 404) {
        return res.status(404).json({ message: "Asset not found." });
      }
      console.error("[PlayerPublic] GET /performance-history:", err.message);
      return res.status(500).json({ message: "Internal server error." });
    }
  });
}

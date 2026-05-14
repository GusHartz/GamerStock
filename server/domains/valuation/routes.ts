import type { Express } from "express";
import { db } from "../../db";
import { assets, assetValuationState } from "@shared/schema";
import { eq } from "drizzle-orm";

/**
 * Valuation Engine domain routes.
 *
 * Covers: PVI / Fair Value reads per asset.
 * Migrated from server/routes.ts — Phase 3A.
 */
export function registerValuationRoutes(app: Express): void {
  // GET /api/assets/:assetUid/valuation — full PVI breakdown for an asset
  app.get("/api/assets/:assetUid/valuation", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const decodedUid = decodeURIComponent(req.params.assetUid);
      const [assetRow] = await db
        .select({ id: assets.id, externalId: assets.externalId })
        .from(assets)
        .where(eq(assets.assetUid, decodedUid))
        .limit(1);
      if (!assetRow) return res.status(404).json({ message: "Asset not found" });

      const [val] = await db
        .select()
        .from(assetValuationState)
        .where(eq(assetValuationState.assetId, assetRow.id))
        .limit(1);

      if (!val) {
        return res.json({
          computed: false,
          pviRaw: null, pviFinal: null, pviAdjusted: null,
          fairValueGS: null, divergencePct: null, confidenceScore: null,
          lastMatchPulse: null, recentPerformance: null, consistencyScore: null,
          historicalSkill: null, activityScore: null, updatedAt: null,
        });
      }

      res.json({
        computed: true,
        pviRaw: parseFloat(val.pviRaw),
        pviFinal: parseFloat(val.pviFinal),
        pviAdjusted: parseFloat(val.pviAdjusted),
        fairValueGS: parseFloat(val.fairValueGS),
        divergencePct: parseFloat(val.divergencePct),
        confidenceScore: parseFloat(val.confidenceScore),
        lastMatchPulse: parseFloat(val.lastMatchPulse),
        recentPerformance: parseFloat(val.recentPerformance),
        consistencyScore: parseFloat(val.consistencyScore),
        historicalSkill: parseFloat(val.historicalSkill),
        activityScore: parseFloat(val.activityScore),
        updatedAt: val.updatedAt,
      });
    } catch (e) {
      console.error("[Assets] valuation error:", e);
      res.status(500).json({ message: "Internal server error" });
    }
  });
}

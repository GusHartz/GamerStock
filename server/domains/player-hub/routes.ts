// ─── Player Hub Domain — Routes ───────────────────────────────────────────────
// GET  /api/player-hub/overview                                — consolidated hub view
// GET  /api/player-hub/assets                                  — all assets with claim status
// GET  /api/player-hub/asset-requests                          — list of asset requests
// POST /api/player-hub/asset-requests                          — submit a new asset request
// POST /api/player-hub/assets/:assetId/claim                   — initiate claim for an asset
// GET  /api/player-hub/discovered-assets                       — Steam-discovered assets
// POST /api/player-hub/discovered-assets/:assetId/add-to-terminal — submit claim from discovery
// ─────────────────────────────────────────────────────────────────────────────
import type { Express, RequestHandler } from "express";
import { playerHubService } from "./service";

const isAuthenticated: RequestHandler = (req: any, res, next) => {
  if (req.session?.isAdmin || req.session?.userId) return next();
  return res.status(401).json({ message: "Unauthorized" });
};

export function registerPlayerHubRoutes(app: Express): void {

  // ── GET /api/player-hub/overview ─────────────────────────────────────────
  app.get("/api/player-hub/overview", isAuthenticated, async (req: any, res) => {
    const userId = String(req.session.userId);
    const displayName = req.session.displayName ?? req.session.username ?? userId;
    try {
      const overview = await playerHubService.getOverview(userId, displayName);
      return res.json(overview);
    } catch (err: any) {
      console.error("[PlayerHub] GET /overview:", err.message);
      return res.status(500).json({ message: "Failed to build hub overview." });
    }
  });

  // ── GET /api/player-hub/assets ────────────────────────────────────────────
  // TODO(cleanup): The Creator Hub no longer renders the Asset Portfolio section.
  // The frontend hook useHubAssets() has been removed from player-hub.tsx.
  // This GET route is no longer called by any frontend page — safe to remove
  // once confirmed no other consumers exist. The POST /claim sub-route below
  // is still active (used by DiscoveredAssetsSection).
  app.get("/api/player-hub/assets", isAuthenticated, async (req: any, res) => {
    const userId = String(req.session.userId);
    try {
      const result = await playerHubService.getAssets(userId);
      return res.json(result);
    } catch (err: any) {
      console.error("[PlayerHub] GET /assets:", err.message);
      return res.status(500).json({ message: "Failed to list assets." });
    }
  });

  // ── GET /api/player-hub/asset-requests ───────────────────────────────────
  app.get("/api/player-hub/asset-requests", isAuthenticated, async (req: any, res) => {
    const userId = String(req.session.userId);
    try {
      const result = await playerHubService.getAssetRequests(userId);
      return res.json(result);
    } catch (err: any) {
      console.error("[PlayerHub] GET /asset-requests:", err.message);
      return res.status(500).json({ message: "Failed to list asset requests." });
    }
  });

  // ── POST /api/player-hub/asset-requests ──────────────────────────────────
  app.post("/api/player-hub/asset-requests", isAuthenticated, async (req: any, res) => {
    const userId = String(req.session.userId);
    const {
      gameId, platform, externalAccountRef, externalUsername,
      externalProfileUrl, requestedAssetType, notes,
    } = req.body;

    if (!gameId || typeof gameId !== "string") {
      return res.status(400).json({ message: "gameId is required." });
    }
    if (!platform || typeof platform !== "string") {
      return res.status(400).json({ message: "platform is required." });
    }

    try {
      const request = await playerHubService.createAssetRequest({
        requestedByUserId: userId,
        gameId,
        platform,
        externalAccountRef,
        externalUsername,
        externalProfileUrl,
        requestedAssetType,
        notes,
      });
      return res.status(201).json({ request });
    } catch (err: any) {
      const status = err.statusCode ?? 500;
      console.error("[PlayerHub] POST /asset-requests:", err.message);
      return res.status(status).json({ message: err.message });
    }
  });

  // ── POST /api/player-hub/assets/:assetId/claim ───────────────────────────
  app.post("/api/player-hub/assets/:assetId/claim", isAuthenticated, async (req: any, res) => {
    const userId = String(req.session.userId);
    const assetId = Number(req.params.assetId);
    if (isNaN(assetId)) return res.status(400).json({ message: "Invalid asset ID." });

    const { assetUid, evidenceNote } = req.body;
    if (!assetUid || typeof assetUid !== "string") {
      return res.status(400).json({ message: "assetUid is required." });
    }

    try {
      const result = await playerHubService.claimAsset(userId, assetId, assetUid, evidenceNote);
      if (!result.success) {
        return res.status(409).json({ message: result.error });
      }
      return res.status(201).json({ claimId: result.claimId, message: "Claim submitted successfully." });
    } catch (err: any) {
      console.error("[PlayerHub] POST /assets/:assetId/claim:", err.message);
      return res.status(500).json({ message: "Failed to submit claim." });
    }
  });

  // ── GET /api/player-hub/discovered-assets ─────────────────────────────────
  app.get("/api/player-hub/discovered-assets", isAuthenticated, async (req: any, res) => {
    const userId = String(req.session.userId);
    try {
      const result = await playerHubService.getDiscoveredAssets(userId);
      return res.json(result);
    } catch (err: any) {
      console.error("[PlayerHub] GET /discovered-assets:", err.message);
      return res.status(500).json({ message: "Failed to discover assets." });
    }
  });

  // ── POST /api/player-hub/discovered-assets/:assetId/add-to-terminal ───────
  app.post(
    "/api/player-hub/discovered-assets/:assetId/add-to-terminal",
    isAuthenticated,
    async (req: any, res) => {
      const userId  = String(req.session.userId);
      const assetId = Number(req.params.assetId);
      // 0 is a valid sentinel meaning "virtual candidate — no internal asset yet"
      if (isNaN(assetId) || assetId < 0) return res.status(400).json({ message: "Invalid asset ID." });

      const { assetUid } = req.body;
      if (!assetUid || typeof assetUid !== "string") {
        return res.status(400).json({ message: "assetUid is required." });
      }

      try {
        const result = await playerHubService.addToTerminal(userId, assetId, assetUid);
        if (!result.success) {
          return res.status(409).json({ message: result.error });
        }
        return res.status(201).json({
          claimId: result.claimId,
          message: "Asset added to terminal.",
        });
      } catch (err: any) {
        console.error("[PlayerHub] POST /discovered-assets/:assetId/add-to-terminal:", err.message);
        return res.status(500).json({ message: "Failed to add asset to terminal." });
      }
    },
  );
}

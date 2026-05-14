// ─── Player Operator Domain — Routes ─────────────────────────────────────────
// Endpoints:
//   GET  /api/player-operator/:assetId/overview
//   GET  /api/player-operator/:assetId/performance-snapshot
//   GET  /api/player-operator/:assetId/action-center
//   GET  /api/player-operator/:assetId/mission
//   GET  /api/player-operator/:assetId/live-activity
//   GET  /api/player-operator/:assetId/card-visual
//   GET  /api/player-operator/:assetId/moments
//
//   POST   /api/player-operator/:assetId/missions
//   PATCH  /api/player-operator/:assetId/missions/:missionId
//
//   PATCH  /api/player-operator/:assetId/card-visual
//
//   POST   /api/player-operator/:assetId/actions/:actionId/trigger
//
//   POST   /api/player-operator/:assetId/moments
//   PATCH  /api/player-operator/:assetId/moments/:momentId
//   POST   /api/player-operator/:assetId/moments/:momentId/relaunch
// ─────────────────────────────────────────────────────────────────────────────
import type { Express, RequestHandler } from "express";
import multer from "multer";
import { playerOperatorService } from "./service";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── Shared middleware ─────────────────────────────────────────────────────────

const isAuthenticated: RequestHandler = (req: any, res, next) => {
  if (req.session?.isAdmin || req.session?.userId) return next();
  if (typeof req.isAuthenticated === "function" && req.isAuthenticated()) return next();
  return res.status(401).json({ message: "Unauthorized" });
};

/**
 * Gate: the authenticated user must have an approved claim (or operator_access
 * entry) for req.params.assetId.  Admins bypass this check.
 */
const requireOperatorAccess: RequestHandler = async (req: any, res, next) => {
  try {
    // Admins can access any operator view for support/debugging purposes
    if (req.session?.isAdmin) return next();

    const userId: string | undefined = req.session?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const assetId = Number(String(req.params.assetId));
    if (isNaN(assetId) || assetId <= 0) {
      return res.status(400).json({ message: "Invalid assetId" });
    }

    const hasAccess = await playerOperatorService.verifyOperatorAccess(assetId, userId);
    if (!hasAccess) {
      return res.status(403).json({ message: "Operator access denied — no approved claim for this player." });
    }
    return next();
  } catch (err) {
    return next(err);
  }
};

// ── Route registration ────────────────────────────────────────────────────────

export function registerPlayerOperatorRoutes(app: Express): void {

  // ── GET /overview ──────────────────────────────────────────────────────────
  app.get(
    "/api/player-operator/:assetId/overview",
    isAuthenticated,
    requireOperatorAccess,
    async (req: any, res) => {
      try {
        const assetId = Number(String(req.params.assetId));
        const userId: string = req.session?.userId ?? req.session?.adminUsername ?? "admin";
        const overview = await playerOperatorService.getOverview(assetId, userId);
        return res.json(overview);
      } catch (err: any) {
        return res.status(err.statusCode ?? 500).json({ message: err.message });
      }
    },
  );

  // ── GET /performance-snapshot ──────────────────────────────────────────────
  app.get(
    "/api/player-operator/:assetId/performance-snapshot",
    isAuthenticated,
    requireOperatorAccess,
    async (req, res) => {
      try {
        const assetId = Number(String(req.params.assetId));
        const snapshot = await playerOperatorService.getPerformanceSnapshot(assetId);
        return res.json(snapshot);
      } catch (err: any) {
        return res.status(err.statusCode ?? 500).json({ message: err.message });
      }
    },
  );

  // ── GET /action-center ─────────────────────────────────────────────────────
  app.get(
    "/api/player-operator/:assetId/action-center",
    isAuthenticated,
    requireOperatorAccess,
    async (req, res) => {
      try {
        const assetId = Number(String(req.params.assetId));
        const actions = await playerOperatorService.getActionCenter(assetId);
        return res.json({ actions });
      } catch (err: any) {
        return res.status(err.statusCode ?? 500).json({ message: err.message });
      }
    },
  );

  // ── GET /mission ───────────────────────────────────────────────────────────
  app.get(
    "/api/player-operator/:assetId/mission",
    isAuthenticated,
    requireOperatorAccess,
    async (req, res) => {
      try {
        const assetId = Number(String(req.params.assetId));
        const mission = await playerOperatorService.getMission(assetId);
        return res.json({ mission });
      } catch (err: any) {
        return res.status(err.statusCode ?? 500).json({ message: err.message });
      }
    },
  );

  // ── GET /live-activity ─────────────────────────────────────────────────────
  app.get(
    "/api/player-operator/:assetId/live-activity",
    isAuthenticated,
    requireOperatorAccess,
    async (req, res) => {
      try {
        const assetId = Number(String(req.params.assetId));
        const events = await playerOperatorService.getLiveActivity(assetId);
        return res.json({ events });
      } catch (err: any) {
        return res.status(err.statusCode ?? 500).json({ message: err.message });
      }
    },
  );

  // ── GET /card-visual ───────────────────────────────────────────────────────
  app.get(
    "/api/player-operator/:assetId/card-visual",
    isAuthenticated,
    requireOperatorAccess,
    async (req, res) => {
      try {
        const assetId = Number(String(req.params.assetId));
        const cardVisual = await playerOperatorService.getCardVisual(assetId);
        return res.json({ cardVisual });
      } catch (err: any) {
        return res.status(err.statusCode ?? 500).json({ message: err.message });
      }
    },
  );

  // ── POST /missions ─────────────────────────────────────────────────────────
  app.post(
    "/api/player-operator/:assetId/missions",
    isAuthenticated,
    requireOperatorAccess,
    async (req: any, res) => {
      try {
        const assetId = Number(String(req.params.assetId));
        const userId: string = req.session?.userId ?? req.session?.adminUsername ?? "admin";
        const { type, title, description, goalValue, endDate } = req.body;
        if (!type || !title || goalValue === undefined) {
          return res.status(400).json({ message: "type, title and goalValue are required" });
        }
        const mission = await playerOperatorService.createMission({
          assetId,
          createdByUserId: userId,
          type,
          title,
          description,
          goalValue: Number(goalValue),
          endDate,
        });
        return res.status(201).json({ mission });
      } catch (err: any) {
        return res.status(err.statusCode ?? 500).json({ message: err.message });
      }
    },
  );

  // ── PATCH /missions/:missionId ─────────────────────────────────────────────
  app.patch(
    "/api/player-operator/:assetId/missions/:missionId",
    isAuthenticated,
    requireOperatorAccess,
    async (req, res) => {
      try {
        const assetId = Number(String(req.params.assetId));
        const missionId = Number(String(req.params.missionId));
        const { status, title, description, goalValue, endDate } = req.body;
        const mission = await playerOperatorService.updateMission({
          missionId,
          assetId,
          status,
          title,
          description,
          goalValue: goalValue !== undefined ? Number(goalValue) : undefined,
          endDate,
        });
        return res.json({ mission });
      } catch (err: any) {
        return res.status(err.statusCode ?? 500).json({ message: err.message });
      }
    },
  );

  // ── PATCH /card-visual ─────────────────────────────────────────────────────
  app.patch(
    "/api/player-operator/:assetId/card-visual",
    isAuthenticated,
    requireOperatorAccess,
    async (req: any, res) => {
      try {
        const assetId = Number(String(req.params.assetId));
        const userId: string = req.session?.userId ?? req.session?.adminUsername ?? "admin";
        const { templateId, overlayConfig, cropConfig, status } = req.body;
        const cardVisual = await playerOperatorService.updateCardVisual({
          assetId,
          createdByUserId: userId,
          templateId,
          overlayConfig,
          cropConfig,
          status,
        });
        return res.json({ cardVisual });
      } catch (err: any) {
        return res.status(err.statusCode ?? 500).json({ message: err.message });
      }
    },
  );

  // ── POST /card-image — upload image for card visual ───────────────────────
  app.post(
    "/api/player-operator/:assetId/card-image",
    isAuthenticated,
    requireOperatorAccess,
    upload.single("file"),
    async (req: any, res) => {
      if (!req.file) {
        return res.status(400).json({ message: "No file provided. Send a multipart form with field 'file'." });
      }
      try {
        const assetId = Number(String(req.params.assetId));
        const userId: string = req.session?.userId ?? req.session?.adminUsername ?? "admin";
        const result = await playerOperatorService.uploadCardImage(
          assetId,
          userId,
          req.file.buffer,
          req.file.originalname,
          req.file.mimetype,
          req.file.size,
        );
        return res.status(201).json(result);
      } catch (err: any) {
        const code = err.statusCode ?? (err.message?.startsWith("Unsupported") || err.message?.startsWith("File too large") ? 400 : 500);
        return res.status(code).json({ message: err.message });
      }
    },
  );

  // ── POST /actions/:actionId/trigger ───────────────────────────────────────
  app.post(
    "/api/player-operator/:assetId/actions/:actionId/trigger",
    isAuthenticated,
    requireOperatorAccess,
    async (req: any, res) => {
      try {
        const assetId = Number(String(req.params.assetId));
        const actionId = Number(String(req.params.actionId));
        const userId: string = req.session?.userId ?? req.session?.adminUsername ?? "admin";
        const result = await playerOperatorService.triggerAction({ actionId, assetId, userId });
        return res.json(result);
      } catch (err: any) {
        return res.status(err.statusCode ?? 500).json({ message: err.message });
      }
    },
  );

  // ── GET /moments ──────────────────────────────────────────────────────────
  app.get(
    "/api/player-operator/:assetId/moments",
    isAuthenticated,
    requireOperatorAccess,
    async (req, res) => {
      try {
        const assetId = Number(String(req.params.assetId));
        const moments = await playerOperatorService.listMoments(assetId);
        return res.json({ moments });
      } catch (err: any) {
        return res.status(err.statusCode ?? 500).json({ message: err.message });
      }
    },
  );

  // ── POST /moments ─────────────────────────────────────────────────────────
  app.post(
    "/api/player-operator/:assetId/moments",
    isAuthenticated,
    requireOperatorAccess,
    async (req: any, res) => {
      try {
        const assetId = Number(String(req.params.assetId));
        const userId: string = req.session?.userId ?? req.session?.adminUsername ?? "admin";
        const { title, rarity, price, supplyTotal, status } = req.body;
        if (!title || !rarity || price === undefined || supplyTotal === undefined) {
          return res.status(400).json({ message: "title, rarity, price and supplyTotal are required" });
        }
        const moment = await playerOperatorService.createMoment({
          assetId,
          createdByUserId: userId,
          title,
          rarity,
          price: Number(price),
          supplyTotal: Number(supplyTotal),
          status: status ?? "draft",
        });
        return res.status(201).json({ moment });
      } catch (err: any) {
        return res.status(err.statusCode ?? 500).json({ message: err.message });
      }
    },
  );

  // ── PATCH /moments/:momentId ──────────────────────────────────────────────
  app.patch(
    "/api/player-operator/:assetId/moments/:momentId",
    isAuthenticated,
    requireOperatorAccess,
    async (req, res) => {
      try {
        const assetId = Number(String(req.params.assetId));
        const momentId = Number(String(req.params.momentId));
        const { title, rarity, price, supplyTotal, status } = req.body;
        const moment = await playerOperatorService.updateMoment({
          momentId,
          assetId,
          title,
          rarity,
          price: price !== undefined ? Number(price) : undefined,
          supplyTotal: supplyTotal !== undefined ? Number(supplyTotal) : undefined,
          status,
        });
        return res.json({ moment });
      } catch (err: any) {
        return res.status(err.statusCode ?? 500).json({ message: err.message });
      }
    },
  );

  // ── POST /moments/:momentId/relaunch ──────────────────────────────────────
  app.post(
    "/api/player-operator/:assetId/moments/:momentId/relaunch",
    isAuthenticated,
    requireOperatorAccess,
    async (req, res) => {
      try {
        const assetId = Number(String(req.params.assetId));
        const momentId = Number(String(req.params.momentId));
        const { price, supplyTotal } = req.body;
        if (price === undefined || supplyTotal === undefined) {
          return res.status(400).json({ message: "price and supplyTotal are required for relaunch" });
        }
        const moment = await playerOperatorService.relaunchMoment({
          momentId,
          assetId,
          price: Number(price),
          supplyTotal: Number(supplyTotal),
        });
        return res.json({ moment });
      } catch (err: any) {
        return res.status(err.statusCode ?? 500).json({ message: err.message });
      }
    },
  );
}

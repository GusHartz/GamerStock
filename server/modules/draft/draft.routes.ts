import { Router, type Request, type Response, type NextFunction } from "express";
import {
  getCurrentWeekHandler,
  getEntryHandler,
  createEntryHandler,
  updateEntryHandler,
  lockEntryHandler,
  getDraftPlayersHandler,
  runCurrentMetricsJobHandler,
  runMetricsJobByWeekHandler,
  runCurrentScoringJobHandler,
  runScoringJobByWeekHandler,
  listWeeksHandler,
  createWeekHandler,
  updateWeekHandler,
  openWeekHandler,
  lockWeekHandler,
  closeWeekHandler,
  ensureBotsHandler,
  generateBotsCurrentWeekHandler,
  generateBotsByWeekHandler,
} from "./draft.controller";

const router = Router();

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if ((req as any).session?.isAdmin) return next();
  res.status(403).json({ message: "Admin access required" });
}

// Public-ish (still require session via isAuthenticated in parent)
router.get("/weeks/current", getCurrentWeekHandler);
router.get("/players", getDraftPlayersHandler);

// Authenticated actions (userId extracted from session/user in controller)
router.get("/entry", getEntryHandler);
router.post("/entry", createEntryHandler);
router.patch("/entry", updateEntryHandler);
router.post("/lock", lockEntryHandler);

// Admin — draft week CRUD
router.get("/admin/weeks", requireAdmin, listWeeksHandler);
router.post("/admin/weeks", requireAdmin, createWeekHandler);
router.patch("/admin/weeks/:weekId", requireAdmin, updateWeekHandler);
router.post("/admin/weeks/:weekId/open", requireAdmin, openWeekHandler);
router.post("/admin/weeks/:weekId/lock", requireAdmin, lockWeekHandler);
router.post("/admin/weeks/:weekId/close", requireAdmin, closeWeekHandler);

// Admin — manual metrics job triggers
router.post("/admin/metrics/current", requireAdmin, runCurrentMetricsJobHandler);
router.post("/admin/metrics/:weekId", requireAdmin, runMetricsJobByWeekHandler);

// Admin — manual scoring job triggers
router.post("/admin/score/current", requireAdmin, runCurrentScoringJobHandler);
router.post("/admin/score/:weekId", requireAdmin, runScoringJobByWeekHandler);

// Admin — bot management
router.post("/admin/bots/ensure", requireAdmin, ensureBotsHandler);
router.post("/admin/bots/generate/current", requireAdmin, generateBotsCurrentWeekHandler);
router.post("/admin/bots/generate/:weekId", requireAdmin, generateBotsByWeekHandler);

export default router;

import type { Request, Response } from "express";
import {
  getCurrentWeek,
  getEntry,
  getOrCreateEntry,
  updateEntryPicks,
  lockEntry,
  getDraftPlayers,
  getAllWeeks,
  createWeek,
  updateWeek,
  setWeekStatus,
} from "./draft.service";
import { DraftValidationError } from "./draft.validators";
import {
  runCurrentDraftWeekMetricsJob,
  runDraftWeekMetricsJob,
  runDraftScoringJob,
  runCurrentDraftScoringJob,
} from "./draft.jobs";
import {
  ensureDraftBotsExist,
  generateBotDraftsForWeek,
  generateBotDraftsForCurrentWeek,
} from "./draft.bots";

function getUserId(req: Request): string | null {
  const user = (req as any).user;
  const session = (req as any).session;
  return user?.claims?.sub ?? user?.id ?? session?.userId ?? null;
}

function handleDraftError(label: string, err: unknown, res: Response): void {
  if (err instanceof DraftValidationError) {
    const statusMap: Record<string, number> = {
      NO_WEEK: 404,
      WEEK_NOT_OPEN: 409,
      NO_ENTRY: 404,
      ENTRY_LOCKED: 409,
      ALREADY_LOCKED: 409,
      PAST_DEADLINE: 409,
      INCOMPLETE_ENTRY: 422,
      INVALID_PLAYER: 400,
      INVALID_SLOT_TYPE: 400,
      DUPLICATE_SLOT: 400,
      TOO_MANY_PICKS: 400,
      EMPTY_PICKS: 400,
      INVALID_PAYLOAD: 400,
    };
    const status = statusMap[err.code] ?? 400;
    res.status(status).json({ message: err.message, code: err.code });
    return;
  }
  console.error(`[Draft] ${label} error:`, err);
  res.status(500).json({ message: "Internal server error" });
}

// GET /api/draft/weeks/current
export async function getCurrentWeekHandler(req: Request, res: Response): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  try {
    const week = await getCurrentWeek();
    if (!week) {
      res.status(404).json({ message: "No draft week is currently available", week: null });
      return;
    }
    res.json({ week });
  } catch (err) {
    handleDraftError("GET /api/draft/weeks/current", err, res);
  }
}

// GET /api/draft/entry
export async function getEntryHandler(req: Request, res: Response): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  try {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    const week = await getCurrentWeek();
    const entry = await getEntry(userId);
    res.json({ weekId: week?.id ?? null, entry: entry ?? null });
  } catch (err) {
    handleDraftError("GET /api/draft/entry", err, res);
  }
}

// POST /api/draft/entry
export async function createEntryHandler(req: Request, res: Response): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  try {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    const entry = await getOrCreateEntry(userId);
    res.status(201).json({ entry });
  } catch (err) {
    handleDraftError("POST /api/draft/entry", err, res);
  }
}

// PATCH /api/draft/entry
export async function updateEntryHandler(req: Request, res: Response): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  try {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    const entry = await updateEntryPicks(userId, req.body?.picks);
    res.json({ entry });
  } catch (err) {
    handleDraftError("PATCH /api/draft/entry", err, res);
  }
}

// POST /api/draft/lock
export async function lockEntryHandler(req: Request, res: Response): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  try {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    const entry = await lockEntry(userId);
    res.json({ success: true, entry });
  } catch (err) {
    handleDraftError("POST /api/draft/lock", err, res);
  }
}

// GET /api/draft/players
export async function getDraftPlayersHandler(req: Request, res: Response): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  try {
    const limit = Math.min(Number(req.query.limit) || 300, 500);
    const players = await getDraftPlayers(limit);
    res.json({ players, total: players.length });
  } catch (err) {
    handleDraftError("GET /api/draft/players", err, res);
  }
}

// POST /api/draft/admin/metrics/current  (admin only)
export async function runCurrentMetricsJobHandler(req: Request, res: Response): Promise<void> {
  try {
    const summary = await runCurrentDraftWeekMetricsJob();
    res.json({ success: true, summary });
  } catch (err) {
    console.error("[Draft] runCurrentMetricsJob error:", err);
    const msg = err instanceof Error ? err.message : "Internal server error";
    res.status(500).json({ success: false, message: msg });
  }
}

// POST /api/draft/admin/metrics/:weekId  (admin only)
export async function runMetricsJobByWeekHandler(req: Request, res: Response): Promise<void> {
  const { weekId } = req.params;
  if (!weekId) {
    res.status(400).json({ success: false, message: "weekId param is required" });
    return;
  }
  try {
    const summary = await runDraftWeekMetricsJob(weekId);
    res.json({ success: true, summary });
  } catch (err) {
    console.error(`[Draft] runMetricsJob(${weekId}) error:`, err);
    const msg = err instanceof Error ? err.message : "Internal server error";
    res.status(500).json({ success: false, message: msg });
  }
}

// POST /api/draft/admin/score/current  (admin only)
export async function runCurrentScoringJobHandler(req: Request, res: Response): Promise<void> {
  try {
    const summary = await runCurrentDraftScoringJob();
    res.json({ success: true, summary });
  } catch (err) {
    console.error("[Draft] runCurrentScoringJob error:", err);
    const msg = err instanceof Error ? err.message : "Internal server error";
    res.status(500).json({ success: false, message: msg });
  }
}

// POST /api/draft/admin/score/:weekId  (admin only)
export async function runScoringJobByWeekHandler(req: Request, res: Response): Promise<void> {
  const { weekId } = req.params;
  if (!weekId) {
    res.status(400).json({ success: false, message: "weekId param is required" });
    return;
  }
  try {
    const summary = await runDraftScoringJob(weekId);
    res.json({ success: true, summary });
  } catch (err) {
    console.error(`[Draft] runScoringJob(${weekId}) error:`, err);
    const msg = err instanceof Error ? err.message : "Internal server error";
    res.status(500).json({ success: false, message: msg });
  }
}

// ─── Admin Week CRUD ──────────────────────────────────────────────────────────

// GET /api/draft/admin/weeks
export async function listWeeksHandler(req: Request, res: Response): Promise<void> {
  try {
    const weeks = await getAllWeeks();
    res.json({ weeks });
  } catch (err) {
    console.error("[Draft] listWeeks error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

// POST /api/draft/admin/weeks
export async function createWeekHandler(req: Request, res: Response): Promise<void> {
  try {
    const { game, region, startAt, lockAt, endAt, status } = req.body ?? {};
    const week = await createWeek({
      game: game ?? "league_of_legends",
      region: region ?? "NA",
      startAt: new Date(startAt),
      lockAt: new Date(lockAt),
      endAt: new Date(endAt),
      status: status ?? "open",
    });
    res.status(201).json({ week });
  } catch (err) {
    handleDraftError("POST /api/draft/admin/weeks", err, res);
  }
}

// PATCH /api/draft/admin/weeks/:weekId
export async function updateWeekHandler(req: Request, res: Response): Promise<void> {
  const { weekId } = req.params;
  try {
    const { game, region, startAt, lockAt, endAt, status } = req.body ?? {};
    const patch: Record<string, unknown> = {};
    if (game !== undefined) patch.game = game;
    if (region !== undefined) patch.region = region;
    if (startAt !== undefined) patch.startAt = new Date(startAt);
    if (lockAt !== undefined) patch.lockAt = new Date(lockAt);
    if (endAt !== undefined) patch.endAt = new Date(endAt);
    if (status !== undefined) patch.status = status;

    const week = await updateWeek(weekId, patch as any);
    res.json({ week });
  } catch (err) {
    handleDraftError(`PATCH /api/draft/admin/weeks/${weekId}`, err, res);
  }
}

// POST /api/draft/admin/weeks/:weekId/open
export async function openWeekHandler(req: Request, res: Response): Promise<void> {
  const { weekId } = req.params;
  try {
    const week = await setWeekStatus(weekId, "open");
    res.json({ week });
  } catch (err) {
    handleDraftError(`POST /api/draft/admin/weeks/${weekId}/open`, err, res);
  }
}

// POST /api/draft/admin/weeks/:weekId/lock
export async function lockWeekHandler(req: Request, res: Response): Promise<void> {
  const { weekId } = req.params;
  try {
    const week = await setWeekStatus(weekId, "locked");
    res.json({ week });
  } catch (err) {
    handleDraftError(`POST /api/draft/admin/weeks/${weekId}/lock`, err, res);
  }
}

// POST /api/draft/admin/weeks/:weekId/close
export async function closeWeekHandler(req: Request, res: Response): Promise<void> {
  const { weekId } = req.params;
  try {
    const week = await setWeekStatus(weekId, "closed");
    res.json({ week });
  } catch (err) {
    handleDraftError(`POST /api/draft/admin/weeks/${weekId}/close`, err, res);
  }
}

// ─── Admin Bot Handlers ───────────────────────────────────────────────────────

// POST /api/draft/admin/bots/ensure
export async function ensureBotsHandler(req: Request, res: Response): Promise<void> {
  try {
    const result = await ensureDraftBotsExist();
    res.json({
      success: true,
      created: result.created,
      existing: result.existing,
      totalCreated: result.created.length,
      totalExisting: result.existing.length,
    });
  } catch (err) {
    console.error("[Draft] ensureBots error:", err);
    const msg = err instanceof Error ? err.message : "Internal server error";
    res.status(500).json({ success: false, message: msg });
  }
}

// POST /api/draft/admin/bots/generate/current
export async function generateBotsCurrentWeekHandler(req: Request, res: Response): Promise<void> {
  try {
    const summary = await generateBotDraftsForCurrentWeek();
    console.log(
      `[DraftBots] Job complete — week=${summary.weekId} created=${summary.entriesCreated} updated=${summary.entriesUpdated} skipped=${summary.entriesSkipped} failed=${summary.botsFailed} pool=${summary.candidatePoolSize} fallback=${summary.usingFallback} duration=${summary.durationMs}ms`,
    );
    res.json({ success: true, summary });
  } catch (err) {
    console.error("[Draft] generateBots(current) error:", err);
    const msg = err instanceof Error ? err.message : "Internal server error";
    res.status(500).json({ success: false, message: msg });
  }
}

// POST /api/draft/admin/bots/generate/:weekId
export async function generateBotsByWeekHandler(req: Request, res: Response): Promise<void> {
  const { weekId } = req.params;
  if (!weekId) {
    res.status(400).json({ success: false, message: "weekId param is required" });
    return;
  }
  try {
    const summary = await generateBotDraftsForWeek(weekId);
    console.log(
      `[DraftBots] Job complete — week=${summary.weekId} created=${summary.entriesCreated} updated=${summary.entriesUpdated} skipped=${summary.entriesSkipped} failed=${summary.botsFailed} pool=${summary.candidatePoolSize} fallback=${summary.usingFallback} duration=${summary.durationMs}ms`,
    );
    res.json({ success: true, summary });
  } catch (err) {
    console.error(`[Draft] generateBots(${weekId}) error:`, err);
    const msg = err instanceof Error ? err.message : "Internal server error";
    res.status(500).json({ success: false, message: msg });
  }
}

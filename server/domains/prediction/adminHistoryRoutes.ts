// ─── Admin History Routes ──────────────────────────────────────────────────────
// Mounted at: /api/admin/predictions
//
// Endpoints:
//   GET /history                         — paginated event-level history list
//   GET /events/:id/history-summary      — single event history + markets + settlements
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from "express";
import { z } from "zod";
import { listHistoryEvents, getEventHistorySummary } from "./adminHistoryService";

const router = Router();

// ── Query schema ──────────────────────────────────────────────────────────────

const listQuerySchema = z.object({
  eventStatus: z.string().optional(),
  game:        z.string().optional(),
  search:      z.string().optional(),
  limit:       z.coerce.number().int().min(1).max(200).optional(),
  offset:      z.coerce.number().int().min(0).optional(),
});

// ── GET /history ──────────────────────────────────────────────────────────────

router.get("/history", async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query parameters", details: parsed.error.flatten() });
    return;
  }

  try {
    const result = await listHistoryEvents(parsed.data);
    res.json(result);
  } catch (err: any) {
    console.error("[AdminHistory] GET /history error:", err.message);
    res.status(500).json({ error: "Failed to load history" });
  }
});

// ── GET /events/:id/history-summary ──────────────────────────────────────────

router.get("/events/:id/history-summary", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id) || id <= 0) {
    res.status(400).json({ error: "Invalid event ID" });
    return;
  }

  try {
    const result = await getEventHistorySummary(id);
    if (!result) {
      res.status(404).json({ error: `Event #${id} not found` });
      return;
    }
    res.json(result);
  } catch (err: any) {
    console.error("[AdminHistory] GET /events/:id/history-summary error:", err.message);
    res.status(500).json({ error: "Failed to load event history summary" });
  }
});

export default router;

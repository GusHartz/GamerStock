// ─── Admin Display Queue Routes ────────────────────────────────────────────────
// Mounted at: /api/admin/display-queue
//
// Endpoints:
//   GET    /                     list queue items (surface / isActive / entityType filters)
//   GET    /:id                  get single queue item
//   POST   /                     add a prediction_event to the queue
//   POST   /:id/reorder          swap positions within a surface
//   POST   /:id/deactivate       soft deactivate (is_active = false)
//   DELETE /:id                  hard delete
//
// Route handler responsibility: parse, validate id, call service, respond.
// All business logic lives in displayQueueService.
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from "express";
import { z } from "zod";
import {
  displayQueueService,
  DisplayQueueItemNotFoundError,
  DisplayQueueConflictError,
  DisplayQueueValidationError,
  VALID_SURFACES,
} from "../services/displayQueueService";

const router = Router();

// ── Shared error handler ──────────────────────────────────────────────────────

function handleQueueError(err: unknown, res: any): void {
  if (err instanceof DisplayQueueItemNotFoundError) {
    res.status(404).json({ error: err.message });
    return;
  }
  if (err instanceof DisplayQueueConflictError) {
    res.status(409).json({ error: err.message });
    return;
  }
  if (err instanceof DisplayQueueValidationError) {
    res.status(400).json({ error: err.message });
    return;
  }
  console.error("[AdminDisplayQueue] Unexpected error:", err);
  res.status(500).json({ error: "Internal server error" });
}

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// ── Query / body schemas ──────────────────────────────────────────────────────

const listQuerySchema = z.object({
  surface:    z.string().optional(),
  isActive:   z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  entityType: z.string().optional(),
  entityId:   z.coerce.number().int().positive().optional(),
  limit:      z.coerce.number().int().min(1).max(200).optional(),
  offset:     z.coerce.number().int().min(0).optional(),
});

const addBodySchema = z.object({
  entityId:      z.number().int().positive(),
  surface:       z.string().min(1),
  position:      z.number().int().positive().optional(),
  startsAt:      z.string().datetime().optional().nullable(),
  endsAt:        z.string().datetime().optional().nullable(),
  curationLabel: z.string().max(255).optional().nullable(),
  createdBy:     z.string().max(64).optional().nullable(),
});

const reorderBodySchema = z.object({
  position:  z.number().int().min(1),
  updatedBy: z.string().max(64).optional().nullable(),
});

const deactivateBodySchema = z.object({
  updatedBy: z.string().max(64).optional().nullable(),
}).optional();

// ── GET / — list ──────────────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query parameters", details: parsed.error.flatten() });
    return;
  }

  try {
    const result = await displayQueueService.listDisplayQueue(parsed.data);
    res.json({
      data:   result.rows,
      total:  result.total,
      limit:  parsed.data.limit  ?? 50,
      offset: parsed.data.offset ?? 0,
    });
  } catch (err) {
    handleQueueError(err, res);
  }
});

// ── GET /:id — single item ────────────────────────────────────────────────────

router.get("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid queue item id" }); return; }

  try {
    const item = await displayQueueService.getDisplayQueueItem(id);
    res.json({ data: item });
  } catch (err) {
    handleQueueError(err, res);
  }
});

// ── POST / — add prediction_event to queue ─────────────────────────────────────

router.post("/", async (req, res) => {
  const parsed = addBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }

  const { startsAt, endsAt, ...rest } = parsed.data;

  try {
    const item = await displayQueueService.addEventToDisplayQueue({
      ...rest,
      startsAt: startsAt ? new Date(startsAt) : null,
      endsAt:   endsAt   ? new Date(endsAt)   : null,
    });
    res.status(200).json({ data: item, message: `prediction_event #${item.entityId} added to "${item.surface}" at position ${item.position}` });
  } catch (err) {
    handleQueueError(err, res);
  }
});

// ── PATCH /:id — update editorial fields ─────────────────────────────────────

const patchBodySchema = z.object({
  curationLabel: z.string().max(255).nullable().optional(),
  isActive:      z.boolean().optional(),
  startsAt:      z.string().datetime().nullable().optional(),
  endsAt:        z.string().datetime().nullable().optional(),
  updatedBy:     z.string().max(64).nullable().optional(),
});

router.patch("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid queue item id" }); return; }

  const parsed = patchBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }

  const { startsAt, endsAt, ...rest } = parsed.data;

  try {
    const item = await displayQueueService.updateDisplayQueueItem(id, {
      ...rest,
      ...(startsAt !== undefined ? { startsAt: startsAt ? new Date(startsAt) : null } : {}),
      ...(endsAt   !== undefined ? { endsAt:   endsAt   ? new Date(endsAt)   : null } : {}),
    });
    res.json({ data: item, message: `Queue item #${id} updated` });
  } catch (err) {
    handleQueueError(err, res);
  }
});

// ── POST /:id/reorder ─────────────────────────────────────────────────────────

router.post("/:id/reorder", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid queue item id" }); return; }

  const parsed = reorderBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }

  try {
    const result = await displayQueueService.reorderDisplayQueueItem(id, parsed.data);
    res.json({
      data:        result.item,
      swappedWith: result.swappedWith ?? null,
      message:     result.swappedWith
        ? `Item #${id} moved to position ${result.item.position} (swapped with #${result.swappedWith.id})`
        : `Item #${id} moved to position ${result.item.position}`,
    });
  } catch (err) {
    handleQueueError(err, res);
  }
});

// ── POST /:id/deactivate ──────────────────────────────────────────────────────

router.post("/:id/deactivate", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid queue item id" }); return; }

  const meta = deactivateBodySchema.parse(req.body) ?? {};

  try {
    const item = await displayQueueService.deactivateDisplayQueueItem(id, meta?.updatedBy);
    res.json({ data: item, message: `Queue item #${id} deactivated` });
  } catch (err) {
    handleQueueError(err, res);
  }
});

// ── DELETE /:id — hard delete ─────────────────────────────────────────────────

router.delete("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid queue item id" }); return; }

  try {
    await displayQueueService.removeDisplayQueueItem(id);
    res.json({ message: `Queue item #${id} removed` });
  } catch (err) {
    handleQueueError(err, res);
  }
});

export default router;

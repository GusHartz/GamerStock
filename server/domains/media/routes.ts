// ─── Media Admin Routes ───────────────────────────────────────────────────────
// Mounted at /api/admin/media in server/routes.ts
//
// Asset endpoints:
//   POST /api/admin/media/upload              — upload image
//   GET  /api/admin/media                     — list all assets
//   GET  /api/admin/media/:id                 — single asset
//
// Event-media link endpoints (sub-resource under media):
//   POST /api/admin/media/events/:eventId     — attach asset to event
//   GET  /api/admin/media/events/:eventId     — list media for event
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import * as mediaService from "./service";

const router = Router();

// ── Multer: memory storage ────────────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 },
});

// ── POST /upload ──────────────────────────────────────────────────────────────

router.post("/upload", upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No file provided. Send a multipart form with field 'file'." });
    return;
  }
  try {
    const asset = await mediaService.saveUploadedFile({
      buffer:       req.file.buffer,
      originalName: req.file.originalname,
      mimeType:     req.file.mimetype,
      fileSize:     req.file.size,
      createdBy:    (req as any).user?.displayName ?? "admin",
    });
    res.status(201).json({ asset, message: `Asset "${asset.fileName}" uploaded (id ${asset.id})` });
  } catch (err: any) {
    const code = err.message.startsWith("Unsupported") || err.message.startsWith("File too large") ? 400 : 500;
    res.status(code).json({ error: err.message });
  }
});

// ── GET / — list assets ───────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  const limit  = Math.min(Number(req.query.limit  ?? 100), 200);
  const offset = Number(req.query.offset ?? 0);
  try {
    const result = await mediaService.listAssets(limit, offset);
    res.json({ data: result.rows, total: result.total, limit, offset });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /events/:eventId — list event media ───────────────────────────────────
// NOTE: must be declared before GET /:id so "events" is not matched as an id.

router.get("/events/:eventId", async (req, res) => {
  const eventId = parseInt(req.params.eventId as string, 10);
  if (isNaN(eventId)) { res.status(400).json({ error: "Invalid event id" }); return; }
  try {
    const items = await mediaService.listEventMedia(eventId);
    res.json({ data: items, total: items.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /events/:eventId — attach asset to event ─────────────────────────────

const attachSchema = z.object({
  mediaAssetId: z.number().int().positive(),
  usageType:    z.enum(["card", "hero", "thumbnail", "banner"]).default("card"),
  sortOrder:    z.number().int().min(0).optional(),
});

router.post("/events/:eventId", async (req, res) => {
  const eventId = parseInt(req.params.eventId as string, 10);
  if (isNaN(eventId)) { res.status(400).json({ error: "Invalid event id" }); return; }

  const parsed = attachSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }
  try {
    const link = await mediaService.attachToEvent({
      predictionEventId: eventId,
      mediaAssetId:      parsed.data.mediaAssetId,
      usageType:         parsed.data.usageType,
      sortOrder:         parsed.data.sortOrder,
    });
    res.status(201).json({ link, message: `Asset #${link.mediaAssetId} attached to event #${eventId} as "${link.usageType}"` });
  } catch (err: any) {
    const code = err.message.includes("not found") ? 404 : 500;
    res.status(code).json({ error: err.message });
  }
});

// ── DELETE /:id — delete asset + unlink event media ──────────────────────────

router.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid asset id" }); return; }
  try {
    const result = await mediaService.deleteMediaAsset(id);
    res.json({ message: `Asset #${id} deleted`, deletedLinks: result.deletedLinks });
  } catch (err: any) {
    const code = err.message.includes("not found") ? 404 : 500;
    res.status(code).json({ error: err.message });
  }
});

// ── GET /:id — single asset ───────────────────────────────────────────────────

router.get("/:id", async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid asset id" }); return; }
  try {
    const asset = await mediaService.getAsset(id);
    if (!asset) { res.status(404).json({ error: `Asset #${id} not found` }); return; }
    res.json({ asset });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

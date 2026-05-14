// ─── Admin Candidate Review Routes ────────────────────────────────────────────
// Mounted at: /api/admin/ingestion/candidates  (via routes/index.ts)
//
// Endpoints:
//   GET    /                    list candidates (paginated + filtered)
//   GET    /:id                 get single candidate
//   POST   /:id/approve         approve → ready for publication
//   POST   /:id/reject          reject → will not be published
//   POST   /:id/needs-edit      return for correction
//   POST   /:id/archive         archive approved or rejected candidate
//
// Route handler responsibility: parse request, call service, send response.
// All business logic lives in candidateReviewService.
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from "express";
import { z } from "zod";
import {
  candidateReviewService,
  CandidateNotFoundError,
  InvalidReviewTransitionError,
} from "../services/candidateReviewService";

const router = Router();

// ── Shared error handler ──────────────────────────────────────────────────────

function handleReviewError(err: unknown, res: any): void {
  if (err instanceof CandidateNotFoundError) {
    res.status(404).json({ error: err.message });
    return;
  }
  if (err instanceof InvalidReviewTransitionError) {
    res.status(409).json({ error: err.message });
    return;
  }
  console.error("[AdminCandidateReview] Unexpected error:", err);
  res.status(500).json({ error: "Internal server error" });
}

// ── Query param schema for list endpoint ─────────────────────────────────────

const listQuerySchema = z.object({
  reviewStatus:     z.string().optional(),
  gameCode:         z.string().optional(),
  source:           z.string().optional(),
  normalizedStatus: z.string().optional(),
  search:           z.string().optional(),
  limit:            z.coerce.number().int().min(1).max(200).optional(),
  offset:           z.coerce.number().int().min(0).optional(),
});

// Optional body schema for action endpoints
const reviewActionSchema = z.object({
  reviewedBy:  z.string().optional(),
  reviewNotes: z.string().optional(),
}).optional();

// ── GET / — list candidates ───────────────────────────────────────────────────

router.get("/", async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query parameters", details: parsed.error.flatten() });
    return;
  }

  try {
    const result = await candidateReviewService.listCandidates(parsed.data);
    res.json({
      data:  result.rows,
      total: result.total,
      limit: parsed.data.limit  ?? 50,
      offset: parsed.data.offset ?? 0,
    });
  } catch (err) {
    handleReviewError(err, res);
  }
});

// ── GET /:id — single candidate ───────────────────────────────────────────────

router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: "Invalid candidate id" });
    return;
  }

  try {
    const candidate = await candidateReviewService.getCandidateOrThrow(id);
    res.json({ data: candidate });
  } catch (err) {
    handleReviewError(err, res);
  }
});

// ── POST /:id/approve ─────────────────────────────────────────────────────────

router.post("/:id/approve", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: "Invalid candidate id" });
    return;
  }

  const meta = reviewActionSchema.parse(req.body) ?? {};

  try {
    const candidate = await candidateReviewService.approveCandidate(id, meta);
    res.json({ data: candidate, message: `Candidate #${id} approved` });
  } catch (err) {
    handleReviewError(err, res);
  }
});

// ── POST /:id/reject ──────────────────────────────────────────────────────────

router.post("/:id/reject", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: "Invalid candidate id" });
    return;
  }

  const meta = reviewActionSchema.parse(req.body) ?? {};

  try {
    const candidate = await candidateReviewService.rejectCandidate(id, meta);
    res.json({ data: candidate, message: `Candidate #${id} rejected` });
  } catch (err) {
    handleReviewError(err, res);
  }
});

// ── POST /:id/needs-edit ──────────────────────────────────────────────────────

router.post("/:id/needs-edit", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: "Invalid candidate id" });
    return;
  }

  const meta = reviewActionSchema.parse(req.body) ?? {};

  try {
    const candidate = await candidateReviewService.markCandidateNeedsEdit(id, meta);
    res.json({ data: candidate, message: `Candidate #${id} returned for editing` });
  } catch (err) {
    handleReviewError(err, res);
  }
});

// ── POST /:id/archive ─────────────────────────────────────────────────────────

router.post("/:id/archive", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: "Invalid candidate id" });
    return;
  }

  const meta = reviewActionSchema.parse(req.body) ?? {};

  try {
    const candidate = await candidateReviewService.archiveCandidate(id, meta);
    res.json({ data: candidate, message: `Candidate #${id} archived` });
  } catch (err) {
    handleReviewError(err, res);
  }
});

export default router;

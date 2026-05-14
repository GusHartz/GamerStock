// ─── Admin Candidate Publication Routes ───────────────────────────────────────
// Mounted at: /api/admin/ingestion/candidates  (alongside review routes)
//
// Endpoints:
//   POST /:id/publish   publish an approved candidate as a prediction_event
//
// Route handler responsibility: parse request, call service, send response.
// All business logic lives in candidatePublicationService.
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from "express";
import { z } from "zod";
import {
  candidatePublicationService,
  CandidateNotFoundError,
  PublicationNotEligibleError,
  AlreadyPublishedError,
} from "../services/candidatePublicationService";

const router = Router();

// ── Shared error handler ──────────────────────────────────────────────────────

function handlePublicationError(err: unknown, res: any): void {
  if (err instanceof CandidateNotFoundError) {
    res.status(404).json({ error: err.message });
    return;
  }
  if (err instanceof AlreadyPublishedError) {
    res.status(409).json({ error: err.message });
    return;
  }
  if (err instanceof PublicationNotEligibleError) {
    res.status(409).json({ error: err.message });
    return;
  }
  console.error("[AdminCandidatePublication] Unexpected error:", err);
  res.status(500).json({ error: "Internal server error" });
}

// ── POST /:id/publish ─────────────────────────────────────────────────────────

const publishBodySchema = z.object({
  publishedBy: z.string().optional(),
  notes:       z.string().optional(),
}).optional();

router.post("/:id/publish", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: "Invalid candidate id" });
    return;
  }

  const meta = publishBodySchema.parse(req.body) ?? {};

  try {
    const result = await candidatePublicationService.publishCandidate(id, meta);
    res.status(200).json({
      message:         `Candidate #${id} published as prediction_event #${result.predictionEvent.id}`,
      predictionEvent: result.predictionEvent,
      publication:     result.publication,
      candidate:       result.updatedCandidate,
    });
  } catch (err) {
    handlePublicationError(err, res);
  }
});

export default router;

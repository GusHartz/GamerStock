// ─── Admin Candidate Bulk Routes ──────────────────────────────────────────────
// Mounted at: /api/admin/ingestion/candidates  (registered BEFORE /:id routes)
//
// Endpoints:
//   POST /bulk/approve             — approve candidates in scope
//   POST /bulk/publish-approved    — publish approved candidates in scope
//   POST /bulk/approve-and-publish — approve + publish in scope
//
// Scope resolution (per endpoint):
//   1. If body.ids present       → operate on those specific IDs
//   2. Else if body.filters      → list matching candidates and operate on them
//   3. Else (no body)            → each operation uses its default eligible set
//      approve:             pending_review
//      publish-approved:    approved
//      approve-and-publish: pending_review
//
// HTTP contract:
//   200 with full BulkOperationResult — even when individual items failed
//   400 only for malformed body
//   500 only for unexpected service-level error
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from "express";
import { z } from "zod";
import {
  approveCandidatesBulk,
  publishApprovedCandidatesBulk,
  approveAndPublishCandidatesBulk,
} from "../services/candidateBulkService";

const router = Router();

// ── Shared body schema ────────────────────────────────────────────────────────

const filtersSchema = z.object({
  reviewStatus:     z.string().optional(),
  gameCode:         z.string().optional(),
  source:           z.string().optional(),
  normalizedStatus: z.string().optional(),
  search:           z.string().optional(),
}).optional();

const bulkBodySchema = z.object({
  ids:     z.array(z.number().int().positive()).max(500).optional(),
  filters: filtersSchema,
}).optional();

function parseBulkBody(raw: unknown) {
  const parsed = bulkBodySchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.flatten() };
  return { ok: true as const, data: parsed.data ?? {} };
}

// ── POST /bulk/approve ────────────────────────────────────────────────────────

router.post("/bulk/approve", async (req, res) => {
  const parsed = parseBulkBody(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error });
    return;
  }

  try {
    const result = await approveCandidatesBulk(
      { ids: parsed.data.ids, filters: parsed.data.filters },
      { reviewedBy: "admin_bulk" }
    );
    res.json({
      message: `Bulk approve: ${result.approved} approved, ${result.skipped} skipped, ${result.failed} failed`,
      ...result,
    });
  } catch (err: any) {
    console.error("[BulkRoute] approve error:", err?.message);
    res.status(500).json({ error: "Bulk approve failed", detail: err?.message });
  }
});

// ── POST /bulk/publish-approved ───────────────────────────────────────────────

router.post("/bulk/publish-approved", async (req, res) => {
  const parsed = parseBulkBody(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error });
    return;
  }

  try {
    const result = await publishApprovedCandidatesBulk(
      { ids: parsed.data.ids, filters: parsed.data.filters },
      { publishedBy: "admin_bulk" }
    );
    res.json({
      message: `Bulk publish: ${result.published} published, ${result.skipped} skipped, ${result.failed} failed`,
      ...result,
    });
  } catch (err: any) {
    console.error("[BulkRoute] publish-approved error:", err?.message);
    res.status(500).json({ error: "Bulk publish failed", detail: err?.message });
  }
});

// ── POST /bulk/approve-and-publish ────────────────────────────────────────────

router.post("/bulk/approve-and-publish", async (req, res) => {
  const parsed = parseBulkBody(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error });
    return;
  }

  try {
    const result = await approveAndPublishCandidatesBulk(
      { ids: parsed.data.ids, filters: parsed.data.filters },
      { actorUserId: "admin_bulk" }
    );
    res.json({
      message: `Bulk approve+publish: ${result.approved} approved, ${result.published} published, ${result.skipped} skipped, ${result.failed} failed`,
      ...result,
    });
  } catch (err: any) {
    console.error("[BulkRoute] approve-and-publish error:", err?.message);
    res.status(500).json({ error: "Bulk approve-and-publish failed", detail: err?.message });
  }
});

export default router;

// ─── Candidate Bulk Service ────────────────────────────────────────────────────
// Responsibility: run bulk editorial operations on prediction_event_candidates.
//
// Operations:
//   approveCandidatesBulk         — pending_review/needs_edit → approved
//   publishApprovedCandidatesBulk — approved → published (via candidatePublicationService)
//   approveAndPublishCandidatesBulk — combines both in sequence per candidate
//
// Design decisions:
//   - Reuses the existing individual services — no duplicated logic.
//   - Each item is processed independently; one failure does not abort others.
//   - Publish bulk never touches the Display Queue (same guarantee as single publish).
//   - Idempotency: already-approved → skip; already-published → skip.
//   - Scope: resolved by the caller passing IDs or filters. If neither,
//     each operation falls back to its natural eligible set (see comments below).
// ─────────────────────────────────────────────────────────────────────────────

import { candidateRepository, type ListCandidateFilters }  from "../repository/candidateRepository";
import { candidateReviewService }    from "./candidateReviewService";
import { candidatePublicationService } from "./candidatePublicationService";
import type { PredictionEventCandidate } from "../../../../shared/schema/ingestion";

// ── Shared types ──────────────────────────────────────────────────────────────

export type BulkAction = "approve" | "publish" | "approve_and_publish";
export type BulkItemStatus = "success" | "skipped" | "failed";

export interface BulkItemResult {
  candidateId: number;
  action:      BulkAction;
  status:      BulkItemStatus;
  reason?:     string;
}

export interface BulkOperationResult {
  totalSelected: number;
  processed:     number;
  approved?:     number;
  published?:    number;
  skipped:       number;
  failed:        number;
  results:       BulkItemResult[];
}

export interface BulkScope {
  /** Explicit candidate IDs — takes priority over filters. */
  ids?:     number[];
  /** Filters to select candidates when ids is not provided. */
  filters?: ListCandidateFilters;
}

// ── Max candidates per bulk run (prevents unbounded operations) ───────────────
const BULK_LIMIT = 500;

// ── Scope resolution ──────────────────────────────────────────────────────────

async function resolveCandidates(
  scope:           BulkScope,
  defaultFilters?: ListCandidateFilters
): Promise<PredictionEventCandidate[]> {
  if (scope.ids && scope.ids.length > 0) {
    return candidateRepository.findCandidatesByIds(scope.ids);
  }

  const filters: ListCandidateFilters = { ...(scope.filters ?? defaultFilters ?? {}), limit: BULK_LIMIT };
  const result = await candidateRepository.listCandidates(filters);
  return result.rows;
}

// ── 1. Approve bulk ───────────────────────────────────────────────────────────
//
// Eligible: pending_review, needs_edit
// Skip:     approved, published, rejected, archived
// Default fallback scope: all pending_review candidates

export async function approveCandidatesBulk(
  scope: BulkScope,
  meta:  { reviewedBy?: string } = {}
): Promise<BulkOperationResult> {
  const defaultFilters: ListCandidateFilters = { reviewStatus: "pending_review" };
  const candidates = await resolveCandidates(scope, defaultFilters);

  const results:   BulkItemResult[] = [];
  let approved = 0;
  let skipped  = 0;
  let failed   = 0;

  for (const c of candidates) {
    if (c.reviewStatus === "approved" || c.reviewStatus === "published") {
      results.push({ candidateId: c.id, action: "approve", status: "skipped",
        reason: `Already ${c.reviewStatus}` });
      skipped++;
      continue;
    }
    if (c.reviewStatus !== "pending_review" && c.reviewStatus !== "needs_edit") {
      results.push({ candidateId: c.id, action: "approve", status: "skipped",
        reason: `Not eligible for approval (status: ${c.reviewStatus})` });
      skipped++;
      continue;
    }

    try {
      await candidateReviewService.approveCandidate(c.id, meta);
      results.push({ candidateId: c.id, action: "approve", status: "success" });
      approved++;
    } catch (err: any) {
      results.push({ candidateId: c.id, action: "approve", status: "failed",
        reason: err?.message ?? "Unknown error" });
      failed++;
    }
  }

  return {
    totalSelected: candidates.length,
    processed:     approved + failed,
    approved,
    skipped,
    failed,
    results,
  };
}

// ── 2. Publish approved bulk ──────────────────────────────────────────────────
//
// Eligible: approved (only)
// Skip:     published, pending_review, needs_edit, rejected, archived
// Default fallback scope: all approved candidates

export async function publishApprovedCandidatesBulk(
  scope: BulkScope,
  meta:  { publishedBy?: string } = {}
): Promise<BulkOperationResult> {
  const defaultFilters: ListCandidateFilters = { reviewStatus: "approved" };
  const candidates = await resolveCandidates(scope, defaultFilters);

  const results:   BulkItemResult[] = [];
  let published = 0;
  let skipped   = 0;
  let failed    = 0;

  for (const c of candidates) {
    if (c.reviewStatus === "published") {
      results.push({ candidateId: c.id, action: "publish", status: "skipped",
        reason: "Already published" });
      skipped++;
      continue;
    }
    if (c.reviewStatus !== "approved") {
      results.push({ candidateId: c.id, action: "publish", status: "skipped",
        reason: `Not eligible for publish (status: ${c.reviewStatus} — must be approved)` });
      skipped++;
      continue;
    }

    try {
      await candidatePublicationService.publishCandidate(c.id, meta);
      results.push({ candidateId: c.id, action: "publish", status: "success" });
      published++;
    } catch (err: any) {
      results.push({ candidateId: c.id, action: "publish", status: "failed",
        reason: err?.message ?? "Unknown error" });
      failed++;
    }
  }

  return {
    totalSelected: candidates.length,
    processed:     published + failed,
    published,
    skipped,
    failed,
    results,
  };
}

// ── 3. Approve + publish bulk ─────────────────────────────────────────────────
//
// Per candidate:
//   - if pending_review or needs_edit → approve first, then publish
//   - if approved → skip approve, publish directly
//   - if published → skip entirely
//   - otherwise → skip with reason
//
// Default fallback scope: all pending_review candidates

export async function approveAndPublishCandidatesBulk(
  scope: BulkScope,
  meta:  { actorUserId?: string } = {}
): Promise<BulkOperationResult> {
  const defaultFilters: ListCandidateFilters = { reviewStatus: "pending_review" };
  const candidates = await resolveCandidates(scope, defaultFilters);

  const results:   BulkItemResult[] = [];
  let approved  = 0;
  let published = 0;
  let skipped   = 0;
  let failed    = 0;

  const reviewMeta  = { reviewedBy:  meta.actorUserId };
  const publishMeta = { publishedBy: meta.actorUserId };

  for (const c of candidates) {
    if (c.reviewStatus === "published") {
      results.push({ candidateId: c.id, action: "approve_and_publish", status: "skipped",
        reason: "Already published" });
      skipped++;
      continue;
    }

    const notEligible =
      c.reviewStatus !== "pending_review" &&
      c.reviewStatus !== "needs_edit" &&
      c.reviewStatus !== "approved";

    if (notEligible) {
      results.push({ candidateId: c.id, action: "approve_and_publish", status: "skipped",
        reason: `Not eligible (status: ${c.reviewStatus})` });
      skipped++;
      continue;
    }

    // Step A — approve if not already approved
    if (c.reviewStatus !== "approved") {
      try {
        await candidateReviewService.approveCandidate(c.id, reviewMeta);
        approved++;
      } catch (err: any) {
        results.push({ candidateId: c.id, action: "approve_and_publish", status: "failed",
          reason: `Approve step failed: ${err?.message ?? "Unknown error"}` });
        failed++;
        continue;
      }
    }

    // Step B — publish
    try {
      await candidatePublicationService.publishCandidate(c.id, publishMeta);
      results.push({ candidateId: c.id, action: "approve_and_publish", status: "success" });
      published++;
    } catch (err: any) {
      results.push({ candidateId: c.id, action: "approve_and_publish", status: "failed",
        reason: `Publish step failed: ${err?.message ?? "Unknown error"}` });
      failed++;
    }
  }

  return {
    totalSelected: candidates.length,
    processed:     approved + published + failed,
    approved,
    published,
    skipped,
    failed,
    results,
  };
}

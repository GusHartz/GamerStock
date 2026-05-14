// ─── Candidate Review Service ──────────────────────────────────────────────────
// Responsibility: validate and apply editorial review decisions on candidates.
//
// Business rules enforced here:
//   - Candidate must exist (404 if not)
//   - Only allowed status transitions may proceed (409 if invalid)
//   - `published` status is NOT set here — that belongs to the publication flow
//   - No side effects beyond updating reviewStatus + audit fields
//
// Allowed transitions:
//   pending_review → approved
//   pending_review → rejected
//   pending_review → needs_edit
//   needs_edit     → approved
//   needs_edit     → rejected
//   approved       → archived
//   rejected       → archived
// ─────────────────────────────────────────────────────────────────────────────

import {
  candidateRepository,
  type ListCandidateFilters,
  type ListCandidateResult,
} from "../repository/candidateRepository";
import type { PredictionEventCandidate } from "../../../../shared/schema/ingestion";
import type { CandidateReviewStatus } from "../types/ingestion.types";

// ── Transition table ──────────────────────────────────────────────────────────

const ALLOWED_TRANSITIONS: Record<string, CandidateReviewStatus[]> = {
  pending_review: ["approved", "rejected", "needs_edit"],
  needs_edit:     ["approved", "rejected"],
  approved:       ["archived"],
  rejected:       ["archived"],
  // `published` and `archived` are terminal — no further transitions
};

// ── Errors ────────────────────────────────────────────────────────────────────

export class CandidateNotFoundError extends Error {
  readonly statusCode = 404;
  constructor(id: number) {
    super(`Candidate #${id} not found`);
    this.name = "CandidateNotFoundError";
  }
}

export class InvalidReviewTransitionError extends Error {
  readonly statusCode = 409;
  constructor(
    id:      number,
    from:    string,
    to:      CandidateReviewStatus
  ) {
    super(
      `Cannot transition candidate #${id} from "${from}" to "${to}". ` +
      `Allowed from "${from}": ${(ALLOWED_TRANSITIONS[from] ?? []).join(", ") || "none"}`
    );
    this.name = "InvalidReviewTransitionError";
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

export class CandidateReviewService {

  // ── Read helpers (thin wrappers — keep routes clean) ──────────────────────

  async getCandidateOrThrow(id: number): Promise<PredictionEventCandidate> {
    const candidate = await candidateRepository.findCandidateById(id);
    if (!candidate) throw new CandidateNotFoundError(id);
    return candidate;
  }

  async listCandidates(filters: ListCandidateFilters): Promise<ListCandidateResult> {
    return candidateRepository.listCandidates(filters);
  }

  // ── Transition helpers ─────────────────────────────────────────────────────

  private async transition(
    id:     number,
    target: CandidateReviewStatus,
    meta:   { reviewedBy?: string; reviewNotes?: string } = {}
  ): Promise<PredictionEventCandidate> {
    const candidate = await this.getCandidateOrThrow(id);
    const current   = candidate.reviewStatus as CandidateReviewStatus;
    const allowed   = ALLOWED_TRANSITIONS[current] ?? [];

    if (!allowed.includes(target)) {
      throw new InvalidReviewTransitionError(id, current, target);
    }

    return candidateRepository.updateCandidateReviewStatus(id, target, meta);
  }

  // ── Public actions ────────────────────────────────────────────────────────

  /** Mark a candidate as approved and ready for the publication flow. */
  approveCandidate(id: number, meta?: { reviewedBy?: string; reviewNotes?: string }) {
    return this.transition(id, "approved", meta);
  }

  /** Permanently reject a candidate — will not be published. */
  rejectCandidate(id: number, meta?: { reviewedBy?: string; reviewNotes?: string }) {
    return this.transition(id, "rejected", meta);
  }

  /** Return a candidate for correction before re-review. */
  markCandidateNeedsEdit(id: number, meta?: { reviewedBy?: string; reviewNotes?: string }) {
    return this.transition(id, "needs_edit", meta);
  }

  /** Archive an approved or rejected candidate — removes it from active queues. */
  archiveCandidate(id: number, meta?: { reviewedBy?: string; reviewNotes?: string }) {
    return this.transition(id, "archived", meta);
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────
export const candidateReviewService = new CandidateReviewService();

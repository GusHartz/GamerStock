// ─── Ingestion Domain — Canonical Shared Types ────────────────────────────────
// Sprint 1 · Etapa 2: consolidated type contracts for the ingestion domain.
//
// These types are the single source of truth for all business logic within
// the ingestion domain (providers, services, repository, routes).
//
// The DB schema in shared/schema/ingestion.ts stores varchar columns;
// these types are the TypeScript contract that governs what values are legal.
//
// NO runtime logic here — types only.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Source identity ──────────────────────────────────────────────────────────

/** External data provider that originated the candidate event. */
export type IngestionSource =
  | "PANDASCORE"
  | "LIQUIPEDIA"
  | "MANUAL";

// ─── Editorial workflow ───────────────────────────────────────────────────────

/**
 * Review lifecycle for a candidate event.
 *
 * pending_review  → newly ingested, awaiting human review
 * approved        → reviewed and cleared for publication
 * rejected        → will never be published
 * published       → has been converted into a prediction_event
 * archived        → retired / no longer relevant
 * needs_edit      → returned to the submitter / ingestion pipeline for correction
 */
export type CandidateReviewStatus =
  | "pending_review"
  | "approved"
  | "rejected"
  | "published"
  | "archived"
  | "needs_edit";

/**
 * Controls whether the candidate is surfaced in any display context.
 *
 * hidden   → not visible in any surface (default)
 * listed   → visible in admin/editorial lists
 * featured → promoted to a display surface (home, sidebar, etc.)
 */
export type CandidateVisibilityState =
  | "hidden"
  | "listed"
  | "featured";

// ─── Match lifecycle ──────────────────────────────────────────────────────────

/**
 * Normalised match status derived from the external provider's status.
 * Represents the real-world state of the sporting event — NOT a review status.
 *
 * scheduled  → match has not started yet
 * live       → match is currently in progress
 * finished   → match concluded with a result
 * cancelled  → match will not take place
 * postponed  → match rescheduled to a future date/time
 */
export type NormalizedMatchStatus =
  | "scheduled"
  | "live"
  | "finished"
  | "cancelled"
  | "postponed";

// ─── Result ───────────────────────────────────────────────────────────────────

/**
 * Which side of the match won.
 * Null when the match has no result yet (scheduled / live / postponed).
 */
export type WinnerSide = "A" | "B" | null;

// ─── Display queue ────────────────────────────────────────────────────────────

/** Type of entity occupying a display queue slot. */
export type DisplayQueueEntityType =
  | "event"
  | "market"
  | "section";

/**
 * Named display surface where an entity can be curated.
 *
 * home        → homepage main area
 * predictions → predictions listing page
 * featured    → generic featured slot
 * hero        → hero / top-of-fold slot
 * upcoming    → upcoming events widget
 */
export type DisplayQueueSurface =
  | "home"
  | "predictions"
  | "featured"
  | "hero"
  | "upcoming";

// ─── Publication ─────────────────────────────────────────────────────────────

/** How the candidate was converted into a prediction_event. */
export type IngestionPublicationMode =
  | "manual"
  | "auto";

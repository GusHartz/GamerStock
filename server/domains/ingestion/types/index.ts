// ─── Ingestion Domain — Types Entry Point ─────────────────────────────────────
export * from "./ingestion.types";
export * from "./normalized-candidate-event";

// ─── Legacy placeholder — no active consumers; retained for build safety ───────
/** @deprecated Use NormalizedCandidateEvent for all new ingestion contracts. */
export interface IngestionEvent {
  source:     string;
  eventType:  string;
  payload:    Record<string, unknown>;
  receivedAt: Date;
}

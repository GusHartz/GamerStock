// ── Reconciler Structured Log Buffer ─────────────────────────────────────────
//
// In-memory circular buffer storing the last N reconciler actions.
// Emits structured JSON to stdout on every write.
//
// NÃO persistido em banco — memória apenas (Fase 2).
// Consultável via GET /api/admin/reconciler/log.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_LOG_ENTRIES = 200;

export type ReconcilerAction =
  | "QUARANTINE"
  | "REPAIR"
  | "REPROCESS"
  | "WARN_STALE"
  | "CYCLE_START"
  | "CYCLE_DONE";

export interface ReconcilerLogEntry {
  type:      "reconciler_action";
  timestamp: string;
  assetId:   number | null;
  game:      string | null;
  invariant: string | null;
  action:    ReconcilerAction;
  details:   Record<string, unknown>;
}

const logBuffer: ReconcilerLogEntry[] = [];

/**
 * Append a structured entry to the reconciler log buffer.
 * Also emits the entry as a JSON line to stdout.
 */
export function appendReconcilerLog(
  entry: Omit<ReconcilerLogEntry, "type" | "timestamp">,
): void {
  const full: ReconcilerLogEntry = {
    type:      "reconciler_action",
    timestamp: new Date().toISOString(),
    ...entry,
  };

  if (logBuffer.length >= MAX_LOG_ENTRIES) {
    logBuffer.shift();
  }
  logBuffer.push(full);

  console.log(JSON.stringify(full));
}

/**
 * Returns a copy of the log buffer, newest first.
 * Safe to call at any time — returns empty array until reconciler runs.
 */
export function getReconcilerLog(limit = 100): ReconcilerLogEntry[] {
  return [...logBuffer].reverse().slice(0, limit);
}

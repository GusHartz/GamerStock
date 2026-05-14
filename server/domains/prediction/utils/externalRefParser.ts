// ─── externalRefParser ────────────────────────────────────────────────────────
// Centralised parser for prediction_events.externalRef.
//
// Expected format: "<PROVIDER>:<id>"   e.g. "PANDASCORE:987654"
//
// Usage:
//   const parsed = parseExternalRef(event.externalRef);
//   if (parsed?.provider === "PANDASCORE") { ... }
// ─────────────────────────────────────────────────────────────────────────────

export interface ParsedExternalRef {
  /** Upper-cased provider token, e.g. "PANDASCORE" */
  provider: string;
  /** Raw identifier as a string (the part after the first ":") */
  matchId: string;
}

/**
 * Parses a `prediction_events.externalRef` string into its provider and matchId.
 *
 * Returns `null` when the value is absent, blank, or doesn't contain ":".
 * Falls back to `metadata.sourceEventId` if it produces a valid result
 * and the primary parsing fails.
 */
export function parseExternalRef(
  externalRef: string | null | undefined,
  fallbackSourceEventId?: string | null,
): ParsedExternalRef | null {
  if (externalRef) {
    const colonIdx = externalRef.indexOf(":");
    if (colonIdx > 0) {
      const provider = externalRef.slice(0, colonIdx).toUpperCase().trim();
      const matchId  = externalRef.slice(colonIdx + 1).trim();
      if (provider && matchId) return { provider, matchId };
    }
  }

  if (fallbackSourceEventId) {
    const id = fallbackSourceEventId.trim();
    if (id) return { provider: "PANDASCORE", matchId: id };
  }

  return null;
}

/** Convenience guard — returns true only for PANDASCORE refs. */
export function isPandaScoreRef(ref: ParsedExternalRef | null): ref is ParsedExternalRef & { provider: "PANDASCORE" } {
  return ref?.provider === "PANDASCORE";
}

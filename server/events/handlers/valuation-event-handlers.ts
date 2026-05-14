/**
 * Valuation Domain — Event Handlers
 *
 * Receives events emitted by the valuation pipeline.
 *
 * ─── Phase 7 status ───────────────────────────────────────────────────────
 * ACTIVE (non-mutating):
 * ValuationUpdated events are emitted by computeAndPersistValuation() after
 * every successful computation. Handlers here observe the event and log it.
 * No additional state mutation occurs — the valuation job already persists
 * its own state directly.
 *
 * Phase 8+ migration path:
 *  - Bot strategy recalibration: when a high-divergence valuation lands,
 *    flag assets for priority attention in the next bot cycle.
 *  - Cache invalidation: invalidate in-memory valuation cache on update.
 *  - Alert: emit an admin notification when divergencePct > configurable threshold.
 */

import type { ValuationUpdatedEvent } from "../domain-events";

export async function handleValuationUpdated(event: ValuationUpdatedEvent): Promise<void> {
  const { puuid, fairValueGS, divergencePct, confidenceScore } = event.payload;

  if (process.env.EVENTS_DEBUG === "true") {
    console.debug(
      `[ValuationHandler] ValuationUpdated — puuid=${puuid} ` +
      `fairValue=${fairValueGS.toFixed(4)} ` +
      `divergence=${divergencePct.toFixed(2)}% ` +
      `confidence=${confidenceScore.toFixed(2)}`
    );
  }

  // Phase 8 hook: flag high-divergence assets for bot recalibration
  // if (Math.abs(divergencePct) > HIGH_DIVERGENCE_THRESHOLD) {
  //   markAssetForBotPriority(puuid);
  // }
}

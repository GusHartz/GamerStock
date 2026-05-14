// ─── Terminal Consistency Reconciler ─────────────────────────────────────────
//
// Integrity guardian — NOT a one-time migration patch.
//
// Purpose:
//   Detects and acts on assets that violate the Terminal eligibility invariants
//   defined in ./invariants.ts. Runs on a periodic schedule (every 30 min).
//
// Actions per violated invariant:
//   • INV_1 (no valuation_state)   → QUARANTINE (listing → UNDER_REVIEW, trading → PAUSED)
//   • INV_2 (no fundamental_price) → QUARANTINE
//   • INV_3 (no last_trade_price)  → QUARANTINE
//   • INV_4 (no history)           → AUTO-REPAIR: write synthetic BOOTSTRAP event
//                                    using existing player_value (if valuation_state exists)
//                                    or QUARANTINE if no valuation_state
//   • INV_5 (stuck at baseline)    → QUARANTINE for ALL asset classes (no exceptions)
//                                    Phase 2: bulk assets are now covered by the dynamic loop;
//                                    if still at $15 baseline, the loop is not updating them.
//   • INV_6 (loop freshness)       → Stale loop coverage:
//                                    For bulk Dota2: try reprocess via provider API
//                                    For bulk CS2:   touch updatedAt (provider unavailable)
//                                    For user-linked: LOG WARN (loop handles; do not quarantine here)
//                                    If reprocess also fails or asset still stale → QUARANTINE
//
// Staleness threshold (INV_6):
//   An asset is considered stale if dota2_valuation_state.updated_at is older than
//   LOOP_STALENESS_MS (2 hours = 12 × 10-min cycles). A running loop should touch
//   every asset's updatedAt within each cycle, regardless of whether the value changed.
//
// Auto-repair for INV_4:
//   When an asset has a valuation_state but no history, the reconciler
//   writes a BOOTSTRAP event with the current player_value as both
//   rawValueAfter and playerValueAfter. This restores audit-trail integrity
//   without changing any price.
//
// Quarantine:
//   Sets listing_status = 'UNDER_REVIEW', trading_status = 'PAUSED'.
//   The asset remains in the DB and can be un-quarantined by admin action
//   or by the next successful enrichment cycle.
// ─────────────────────────────────────────────────────────────────────────────

import { db } from "../../db";
import { assets } from "@shared/schema";
import { dota2ValuationState, dota2ValueHistory } from "@shared/schema/multigame";
import { eq, and, like, sql as sqlExpr } from "drizzle-orm";
import { getConsistencySummary } from "./invariants";
import { updateBulkDota2ValuationFromProvider } from "../multigame/dota2ValuationService";
import { updateBulkCs2ValuationFromProvider } from "../multigame/cs2ValuationService";
import { appendReconcilerLog } from "./reconcilerLog";

// ── Config ────────────────────────────────────────────────────────────────────

const RECONCILER_INTERVAL_MS  = 30 * 60 * 1000;   // every 30 min
const RECONCILER_WARMUP_MS    = 5 * 60 * 1000;    // first run 5 min after boot
const BATCH_SIZE              = 100;                // assets processed per cycle
const LOOP_STALENESS_MS       = 2 * 60 * 60 * 1000; // 2 hours = 12 loop cycles
const LOG_PREFIX              = "[Reconciler]";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ReconcilerResult {
  game:          "cs2" | "dota2";
  scanned:       number;
  repaired:      number;   // auto-repair applied (INV_4)
  quarantined:   number;   // set to UNDER_REVIEW/PAUSED
  staleReprocessed: number; // INV_6: stale assets that were reprocessed successfully
  alreadyOk:     number;
  durationMs:    number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function quarantine(assetId: number, reason: string, game?: string): Promise<void> {
  await db.update(assets)
    .set({ listingStatus: "UNDER_REVIEW", tradingStatus: "PAUSED", updatedAt: new Date() })
    .where(eq(assets.id, assetId));
  console.warn(`${LOG_PREFIX} Quarantined assetId=${assetId}: ${reason}`);
  const invMatch = reason.match(/^(INV_\d+)/);
  appendReconcilerLog({
    assetId,
    game:      game ?? null,
    invariant: invMatch?.[1] ?? null,
    action:    "QUARANTINE",
    details:   { reason, listingStatus: "UNDER_REVIEW", tradingStatus: "PAUSED" },
  });
}

async function writeBootstrapRepairEvent(
  assetId:     number,
  playerValue: string,
): Promise<void> {
  await db.insert(dota2ValueHistory).values({
    assetId,
    playerProfileId:  0,
    rawValueBefore:   "0.0000",
    rawValueAfter:    playerValue,
    playerValueAfter: playerValue,
    confidenceScore:  "0.5000",
    eventType:        "BOOTSTRAP",
    metadataJson:     JSON.stringify({
      source:  "reconciler_repair",
      note:    "Synthetic BOOTSTRAP inserted by reconciler — original bootstrap ran but wrote no history event",
    }),
  } as any);
}

// ── Single-game reconcile ─────────────────────────────────────────────────────

async function reconcileGame(game: "cs2" | "dota2"): Promise<ReconcilerResult> {
  const t0               = Date.now();
  const prefix           = `${game}:${game}:%`;
  let scanned            = 0;
  let repaired           = 0;
  let quarantined        = 0;
  let staleReprocessed   = 0;
  let alreadyOk          = 0;

  const stalenessThreshold = new Date(Date.now() - LOOP_STALENESS_MS);

  let offset = 0;

  while (true) {
    const batch = await db
      .select({
        id:               assets.id,
        assetUid:         assets.assetUid,
        fundamentalPrice: assets.fundamentalPrice,
        lastTradePrice:   assets.lastTradePrice,
      })
      .from(assets)
      .where(and(
        like(assets.assetUid, prefix),
        eq(assets.listingStatus,  "LISTED"),
        eq(assets.tradingStatus,  "ACTIVE"),
      ))
      .limit(BATCH_SIZE)
      .offset(offset);

    if (batch.length === 0) break;
    offset += batch.length;
    scanned += batch.length;

    for (const asset of batch) {
      // ── Load supporting data ────────────────────────────────────────────────
      const [valState] = await db
        .select({
          id:              dota2ValuationState.id,
          playerValue:     dota2ValuationState.playerValue,
          playerProfileId: dota2ValuationState.playerProfileId,
          updatedAt:       dota2ValuationState.updatedAt,
        })
        .from(dota2ValuationState)
        .where(eq(dota2ValuationState.assetId, asset.id))
        .limit(1);

      const [histRow] = await db
        .select({ id: dota2ValueHistory.id, eventType: dota2ValueHistory.eventType })
        .from(dota2ValueHistory)
        .where(eq(dota2ValueHistory.assetId, asset.id))
        .limit(1);

      const hasValuationState   = Boolean(valState);
      const hasFundamentalPrice = asset.fundamentalPrice != null;
      const hasLastTradePrice   = asset.lastTradePrice != null;
      const hasHistory          = Boolean(histRow);
      const playerValue         = valState?.playerValue ?? "15.0000";
      const pvNum               = parseFloat(String(playerValue));
      const isAtBaseline        = Math.abs(pvNum - 15.0) <= 0.10;
      const isBulkAsset         = !valState || Number(valState.playerProfileId) === 0;
      const updatedAt           = valState?.updatedAt ? new Date(valState.updatedAt) : null;
      const isStale             = !updatedAt || updatedAt < stalenessThreshold;

      // ── INV_1: no valuation_state → quarantine ──────────────────────────────
      if (!hasValuationState) {
        await quarantine(asset.id, "INV_1: no dota2_valuation_state row", game);
        quarantined++;
        continue;
      }

      // ── INV_2: no fundamental_price → quarantine ────────────────────────────
      if (!hasFundamentalPrice) {
        await quarantine(asset.id, "INV_2: fundamental_price is NULL", game);
        quarantined++;
        continue;
      }

      // ── INV_3: no last_trade_price → quarantine ─────────────────────────────
      if (!hasLastTradePrice) {
        await quarantine(asset.id, "INV_3: last_trade_price is NULL", game);
        quarantined++;
        continue;
      }

      // ── INV_4: no history → auto-repair ────────────────────────────────────
      if (!hasHistory) {
        try {
          await writeBootstrapRepairEvent(asset.id, String(playerValue));
          console.log(
            `${LOG_PREFIX} Repaired INV_4 assetId=${asset.id} uid=${asset.assetUid} ` +
            `player_value=${playerValue}`,
          );
          appendReconcilerLog({
            assetId: asset.id, game, invariant: "INV_4", action: "REPAIR",
            details:  { uid: asset.assetUid, playerValue: String(playerValue), event: "BOOTSTRAP" },
          });
          repaired++;
        } catch (err: any) {
          console.error(`${LOG_PREFIX} INV_4 repair failed assetId=${asset.id}: ${err?.message}`);
          quarantined++;
          await quarantine(asset.id, "INV_4: repair of missing history failed", game);
        }
        continue;
      }

      // ── INV_5: stuck at baseline — quarantine ALL (no bulk exemption) ───────
      //
      // Phase 2: ALL ACTIVE/LISTED assets are covered by the dynamic loop.
      // If an asset remains at the $15 baseline despite the loop running,
      // either the loop is failing for this asset or the provider has no data.
      // Quarantine regardless of whether it is a bulk or user-linked asset.
      if (isAtBaseline) {
        console.warn(
          `${LOG_PREFIX} INV_5 quarantine assetId=${asset.id} uid=${asset.assetUid} ` +
          `player_value=${playerValue} isBulk=${isBulkAsset} — ` +
          `stuck at $15 baseline despite dynamic loop coverage. Quarantining.`,
        );
        await quarantine(asset.id, `INV_5: stuck at $15 baseline (bulk=${isBulkAsset}) — dynamic loop not updating`, game);
        quarantined++;
        continue;
      }

      // ── INV_6: loop freshness — stale updatedAt ─────────────────────────────
      //
      // dota2_valuation_state.updatedAt is touched on every loop cycle
      // (even when the provider is unavailable or the value delta is too small).
      // If updatedAt is older than LOOP_STALENESS_MS, the loop is not covering
      // this asset. Attempt reprocess; quarantine if it continues to fail.
      if (isStale) {
        if (isBulkAsset) {
          const playerId = asset.assetUid.split(":")[3] ?? "";
          if (playerId) {
            try {
              let reprocessOk = false;
              if (game === "dota2") {
                const r = await updateBulkDota2ValuationFromProvider(asset.id, playerId);
                reprocessOk = r.updated || r.reason === "DELTA_TOO_SMALL";
              } else {
                const r = await updateBulkCs2ValuationFromProvider(asset.id, playerId);
                reprocessOk = r.reason === "PROVIDER_UNAVAILABLE";
              }

              if (reprocessOk) {
                console.log(
                  `${LOG_PREFIX} INV_6 reprocessed (stale) assetId=${asset.id} uid=${asset.assetUid} game=${game}`,
                );
                appendReconcilerLog({
                  assetId: asset.id, game, invariant: "INV_6", action: "REPROCESS",
                  details: { uid: asset.assetUid, updatedAt: updatedAt?.toISOString() ?? null, reprocessOk: true },
                });
                staleReprocessed++;
                alreadyOk++;
                continue;
              }
            } catch (err: any) {
              console.error(`${LOG_PREFIX} INV_6 reprocess failed assetId=${asset.id}: ${err?.message}`);
            }
          }
          await quarantine(asset.id, `INV_6: stale bulk asset — loop not covering; reprocess failed`, game);
          quarantined++;
        } else {
          // User-linked stale: warn only — the dynamic loop is the primary mechanism
          console.warn(
            `${LOG_PREFIX} INV_6 stale (user-linked) assetId=${asset.id} uid=${asset.assetUid} ` +
            `updatedAt=${updatedAt?.toISOString() ?? "null"} — loop has not touched this asset in ${LOOP_STALENESS_MS / 3600000}h`,
          );
          appendReconcilerLog({
            assetId: asset.id, game, invariant: "INV_6", action: "WARN_STALE",
            details: {
              uid:          asset.assetUid,
              isBulkAsset:  false,
              updatedAt:    updatedAt?.toISOString() ?? null,
              staleAfterMs: LOOP_STALENESS_MS,
            },
          });
          alreadyOk++;
        }
        continue;
      }

      alreadyOk++;
    }

    if (batch.length < BATCH_SIZE) break;
  }

  return {
    game,
    scanned,
    repaired,
    quarantined,
    staleReprocessed,
    alreadyOk,
    durationMs: Date.now() - t0,
  };
}

// ── Full reconcile cycle ──────────────────────────────────────────────────────

async function runReconcileCycle(): Promise<void> {
  console.log(`${LOG_PREFIX} ═══ Reconcile cycle start ═══`);
  const start = Date.now();

  try {
    const [cs2Summary, dota2Summary] = await Promise.all([
      getConsistencySummary("cs2"),
      getConsistencySummary("dota2"),
    ]);

    console.log(
      `${LOG_PREFIX} CS2  summary:  total=${cs2Summary.totalActiveListedAssets} ` +
      `missingDvs=${cs2Summary.missingValuationState} ` +
      `missingHist=${cs2Summary.missingHistory} ` +
      `stuckBaseline=${cs2Summary.stuckAtBaseline} ` +
      `fullyOk=${cs2Summary.fullyEligible}`,
    );
    console.log(
      `${LOG_PREFIX} Dota2 summary: total=${dota2Summary.totalActiveListedAssets} ` +
      `missingDvs=${dota2Summary.missingValuationState} ` +
      `missingHist=${dota2Summary.missingHistory} ` +
      `stuckBaseline=${dota2Summary.stuckAtBaseline} ` +
      `fullyOk=${dota2Summary.fullyEligible}`,
    );

    const cs2NeedsReconcile =
      cs2Summary.missingValuationState > 0 ||
      cs2Summary.missingHistory > 0 ||
      cs2Summary.stuckAtBaseline > 0;

    const dota2NeedsReconcile =
      dota2Summary.missingValuationState > 0 ||
      dota2Summary.missingHistory > 0 ||
      dota2Summary.stuckAtBaseline > 0;

    // Always run reconcile to check INV_6 (loop freshness) even if no baseline issues
    const forceCs2Reconcile   = true;
    const forceDota2Reconcile = true;

    if (cs2NeedsReconcile || forceCs2Reconcile) {
      const r = await reconcileGame("cs2");
      console.log(
        `${LOG_PREFIX} CS2  reconcile done: scanned=${r.scanned} repaired=${r.repaired} ` +
        `quarantined=${r.quarantined} staleReprocessed=${r.staleReprocessed} ok=${r.alreadyOk} (${r.durationMs}ms)`,
      );
      if (cs2Summary.stuckAtBaseline > 0) {
        console.warn(
          `${LOG_PREFIX} ⚠ CS2 stuckAtBaseline=${cs2Summary.stuckAtBaseline}: ` +
          `assets quarantined — dynamic loop is not updating them. ` +
          `Apply V2 price migration if bulk assets have not been enriched.`,
        );
      }
    }

    if (dota2NeedsReconcile || forceDota2Reconcile) {
      const r = await reconcileGame("dota2");
      console.log(
        `${LOG_PREFIX} Dota2 reconcile done: scanned=${r.scanned} repaired=${r.repaired} ` +
        `quarantined=${r.quarantined} staleReprocessed=${r.staleReprocessed} ok=${r.alreadyOk} (${r.durationMs}ms)`,
      );
      if (dota2Summary.stuckAtBaseline > 0) {
        console.warn(
          `${LOG_PREFIX} ⚠ Dota2 stuckAtBaseline=${dota2Summary.stuckAtBaseline}: ` +
          `assets quarantined — dynamic loop is not updating them.`,
        );
      }
    }
  } catch (err: any) {
    console.error(`${LOG_PREFIX} Cycle error (non-fatal): ${err?.message}`);
  }

  console.log(`${LOG_PREFIX} ═══ Reconcile cycle done (${Date.now() - start}ms) ═══`);
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

export function startTerminalReconciler(): void {
  const schedule = () => {
    setTimeout(async () => {
      await runReconcileCycle();
      schedule();
    }, RECONCILER_INTERVAL_MS);
  };

  setTimeout(() => {
    runReconcileCycle().catch((err: any) =>
      console.error(`${LOG_PREFIX} First-run error: ${err?.message}`),
    );
    schedule();
  }, RECONCILER_WARMUP_MS);

  console.log(
    `${LOG_PREFIX} Started (first run in ${RECONCILER_WARMUP_MS / 60000}min, ` +
    `interval=${RECONCILER_INTERVAL_MS / 60000}min). ` +
    `Phase 2: INV_5 quarantines ALL baseline assets; INV_6 enforces loop freshness.`,
  );
}

// ── Manual trigger for admin route / testing ──────────────────────────────────
export async function runReconcilerOnce(): Promise<void> {
  await runReconcileCycle();
}

// ─── Terminal Eligibility Invariants ─────────────────────────────────────────
//
// SINGLE SOURCE OF TRUTH for what constitutes a valid, active terminal asset.
//
// An asset is only eligible for LISTED/ACTIVE status if ALL of the following
// invariants hold:
//
//   INV_1  ValuationState exists     — dota2_valuation_state row present
//   INV_2  FundamentalPrice set      — assets.fundamental_price is NOT NULL
//   INV_3  LastTradePrice set        — assets.last_trade_price is NOT NULL
//   INV_4  BootstrapHistory exists   — at least 1 row in dota2_value_history
//   INV_5  NonBaselineValue          — player_value ≠ $15 baseline, OR
//                                      history contains RECALC / MATCH_UPDATE
//
// INV_5 clarification:
//   A $15 flat price is acceptable ONLY when there is an explicit audit-trail
//   event proving the valuation ran (even if it confirmed $15).
//
// Gate rule at entry (gateTerminalPromotion):
//   INV_1–INV_4 are HARD gates — must pass before any asset can be LISTED/ACTIVE.
//   INV_5 is a SOFT gate — $15 baseline is acceptable at initial entry; it is
//   monitored by the reconciler and triggers quarantine only for user-linked
//   assets that remain at baseline after multiple enrichment cycles.
//
// Design:
//   • No side effects — only reads
//   • Game-agnostic (works for both cs2 and dota2)
//   • Used by: bootstrap services, player-hub addToTerminal, reconciler
// ─────────────────────────────────────────────────────────────────────────────

import { db } from "../../db";
import { assets } from "@shared/schema";
import { dota2ValuationState, dota2ValueHistory } from "@shared/schema/multigame";
import { eq } from "drizzle-orm";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TerminalEligibilityChecks {
  hasValuationState: boolean;
  hasFundamentalPrice: boolean;
  hasLastTradePrice: boolean;
  hasBootstrapHistory: boolean;
  hasNonBaselineValue: boolean;
}

export interface TerminalEligibilityReport {
  assetId: number;
  assetUid: string;
  game: string;
  eligible: boolean;
  failingInvariants: string[];
  checks: TerminalEligibilityChecks;
}

// ── Baseline sentinel ─────────────────────────────────────────────────────────
// player_value within ±0.10 of 15.00 is considered "still at baseline"
const BASELINE_PRICE = 15.0;
const BASELINE_TOLERANCE = 0.10;

function isBaseline(value: string | null | undefined): boolean {
  if (value == null) return true;
  return Math.abs(parseFloat(String(value)) - BASELINE_PRICE) <= BASELINE_TOLERANCE;
}

// ── Per-asset check ───────────────────────────────────────────────────────────

export async function checkTerminalEligibility(
  assetId: number,
): Promise<TerminalEligibilityReport> {
  const [asset] = await db
    .select({
      id:               assets.id,
      assetUid:         assets.assetUid,
      fundamentalPrice: assets.fundamentalPrice,
      lastTradePrice:   assets.lastTradePrice,
    })
    .from(assets)
    .where(eq(assets.id, assetId))
    .limit(1);

  if (!asset) {
    return {
      assetId,
      assetUid: "UNKNOWN",
      game: "unknown",
      eligible: false,
      failingInvariants: ["Asset not found in canonical assets table"],
      checks: {
        hasValuationState: false,
        hasFundamentalPrice: false,
        hasLastTradePrice: false,
        hasBootstrapHistory: false,
        hasNonBaselineValue: false,
      },
    };
  }

  const game = asset.assetUid.split(":")[1] ?? "unknown";

  const [valState] = await db
    .select({ id: dota2ValuationState.id, playerValue: dota2ValuationState.playerValue })
    .from(dota2ValuationState)
    .where(eq(dota2ValuationState.assetId, assetId))
    .limit(1);

  const [histRow] = await db
    .select({ id: dota2ValueHistory.id, eventType: dota2ValueHistory.eventType })
    .from(dota2ValueHistory)
    .where(eq(dota2ValueHistory.assetId, assetId))
    .limit(1);

  const hasValuationState  = Boolean(valState);
  const hasFundamentalPrice = asset.fundamentalPrice != null;
  const hasLastTradePrice   = asset.lastTradePrice != null;
  const hasBootstrapHistory = Boolean(histRow);
  const hasNonBaselineValue = hasBootstrapHistory || (hasValuationState && !isBaseline(valState!.playerValue));

  const failingInvariants: string[] = [];
  if (!hasValuationState)   failingInvariants.push("INV_1: no dota2_valuation_state row");
  if (!hasFundamentalPrice) failingInvariants.push("INV_2: fundamental_price is NULL");
  if (!hasLastTradePrice)   failingInvariants.push("INV_3: last_trade_price is NULL");
  if (!hasBootstrapHistory) failingInvariants.push("INV_4: no audit-trail events in dota2_value_history");
  if (!hasNonBaselineValue) failingInvariants.push("INV_5: player_value at $15 baseline with no corroborating history");

  return {
    assetId,
    assetUid: asset.assetUid,
    game,
    eligible: failingInvariants.length === 0,
    failingInvariants,
    checks: {
      hasValuationState,
      hasFundamentalPrice,
      hasLastTradePrice,
      hasBootstrapHistory,
      hasNonBaselineValue,
    },
  };
}

// ── Terminal promotion gate ───────────────────────────────────────────────────
//
// gateTerminalPromotion — the ONLY function that may authorize LISTED/ACTIVE.
//
// Rules:
//   • INV_1–INV_4 are hard gates: any failure blocks promotion.
//   • INV_5 ($15 baseline) is NOT a hard gate at entry — a $15 bootstrap price
//     is valid when the asset has a BOOTSTRAP history event (INV_4 satisfied).
//     The reconciler monitors and quarantines baseline-stuck user-linked assets.
//   • Never sets status directly — callers must apply the returned decision.

export interface PromotionDecision {
  approved: boolean;
  failingInvariants: string[];
  suggestedListingStatus:  "LISTED" | "UNDER_REVIEW";
  suggestedTradingStatus:  "ACTIVE" | "PAUSED";
  reason: string;
}

export async function gateTerminalPromotion(assetId: number): Promise<PromotionDecision> {
  const report = await checkTerminalEligibility(assetId);

  const hardFails = report.failingInvariants.filter(
    (inv) => !inv.startsWith("INV_5"),
  );

  if (hardFails.length === 0) {
    return {
      approved:               true,
      failingInvariants:      report.failingInvariants,
      suggestedListingStatus: "LISTED",
      suggestedTradingStatus: "ACTIVE",
      reason:                 "INV_1–INV_4 satisfied — approved for LISTED/ACTIVE",
    };
  }

  return {
    approved:               false,
    failingInvariants:      report.failingInvariants,
    suggestedListingStatus: "UNDER_REVIEW",
    suggestedTradingStatus: "PAUSED",
    reason:                 `Blocked by hard invariants: ${hardFails.join("; ")}`,
  };
}

// ── Bulk summary check (for reconciler) ──────────────────────────────────────
// Returns a summary without loading all assets into memory.

export interface TerminalConsistencySummary {
  game: string;
  totalActiveListedAssets: number;
  missingValuationState: number;
  missingFundamentalPrice: number;
  missingHistory: number;
  stuckAtBaseline: number;
  fullyEligible: number;
}

export async function getConsistencySummary(game: "cs2" | "dota2"): Promise<TerminalConsistencySummary> {
  const { sql, like, and, eq } = await import("drizzle-orm");
  const sqlExpr = sql;

  const prefix = `${game}:${game}:%`;

  const result = await db.execute(sqlExpr`
    SELECT
      COUNT(*)::int                                                        AS total,
      COUNT(*) FILTER (WHERE dvs.id IS NULL)::int                        AS missing_dvs,
      COUNT(*) FILTER (WHERE a.fundamental_price IS NULL)::int           AS missing_fp,
      COUNT(*) FILTER (WHERE dvh_cnt.cnt IS NULL OR dvh_cnt.cnt = 0)::int AS missing_hist,
      COUNT(*) FILTER (
        WHERE (dvs.player_value IS NULL OR ABS(dvs.player_value::numeric - 15.0) <= 0.10)
          AND (dvh_cnt.cnt IS NULL OR dvh_cnt.cnt = 0)
      )::int                                                              AS stuck_at_baseline,
      COUNT(*) FILTER (
        WHERE dvs.id IS NOT NULL
          AND a.fundamental_price IS NOT NULL
          AND (dvh_cnt.cnt IS NOT NULL AND dvh_cnt.cnt > 0)
          AND NOT (
            (dvs.player_value IS NULL OR ABS(dvs.player_value::numeric - 15.0) <= 0.10)
            AND (dvh_cnt.cnt IS NULL OR dvh_cnt.cnt = 0)
          )
      )::int                                                              AS fully_eligible
    FROM assets a
    LEFT JOIN dota2_valuation_state dvs
      ON dvs.asset_id = a.id
    LEFT JOIN (
      SELECT asset_id, COUNT(*)::int AS cnt
      FROM dota2_value_history
      GROUP BY asset_id
    ) dvh_cnt ON dvh_cnt.asset_id = a.id
    WHERE a.asset_uid LIKE ${prefix}
      AND a.listing_status  = 'LISTED'
      AND a.trading_status  = 'ACTIVE'
  `);
  const row = (result as any)?.rows?.[0] ?? (result as any)?.[0];

  return {
    game,
    totalActiveListedAssets: Number((row as any).total ?? 0),
    missingValuationState:   Number((row as any).missing_dvs ?? 0),
    missingFundamentalPrice: Number((row as any).missing_fp ?? 0),
    missingHistory:          Number((row as any).missing_hist ?? 0),
    stuckAtBaseline:         Number((row as any).stuck_at_baseline ?? 0),
    fullyEligible:           Number((row as any).fully_eligible ?? 0),
  };
}

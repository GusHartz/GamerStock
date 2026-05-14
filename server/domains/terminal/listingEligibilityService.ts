// ── Terminal Listing Eligibility Service ──────────────────────────────────────
//
// Evaluates whether an asset is eligible for:
//   A. INGESTION — can it enter the pipeline at all?
//   B. LISTING   — can it be displayed and traded in the Terminal?
//
// Separation of concerns:
//   ingestionEligibility = "does this player have enough data to be a valid asset?"
//   listingEligibility   = "does this asset have all the data the Terminal requires?"
//
// NOTE ON NAMING: The persistence layer uses dota2_valuation_state and
//   dota2_value_history for BOTH Dota2 and CS2. This is a naming artifact,
//   not a conceptual limitation. All eligibility logic is multigame.
//
// Fase 2 (2026-04-06): Diagnostic-only — no destructive side effects.
// ─────────────────────────────────────────────────────────────────────────────

import { db }                          from "../../db";
import { assets, markets }             from "@shared/schema";
import { dota2ValuationState, dota2ValueHistory } from "@shared/schema/multigame";
import { eq, sql as sqlExpr }          from "drizzle-orm";

// ── Output types ──────────────────────────────────────────────────────────────

export type RecommendedAction =
  | "OK"
  | "REQUIRES_PROVIDER_DATA"
  | "REQUIRES_BOOTSTRAP"
  | "REQUIRES_INITIAL_VALUATION"
  | "REVIEW_REQUIRED";

export interface EligibilityCheck {
  check:   string;
  passed:  boolean;
  detail?: string;
}

export interface TerminalEligibilityResult {
  assetId:              number;
  game:                 string;
  provider:             string;
  displayName:          string;
  symbol:               string;
  listingStatus:        string;
  tradingStatus:        string;
  isBulkAsset:          boolean;
  /** true if the asset has enough identity + provider data to be in the pipeline */
  eligibleForIngestion: boolean;
  /** true if the asset has all Terminal-required fields (valuation, price, history) */
  eligibleForListing:   boolean;
  ingestionChecks:      EligibilityCheck[];
  listingChecks:        EligibilityCheck[];
  /** Human-readable list of failing checks */
  issues:               string[];
  recommendedAction:    RecommendedAction;
}

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * Evaluate Terminal listing eligibility for a single asset.
 *
 * Returns null if the assetId does not exist.
 */
export async function evaluateTerminalEligibility(
  assetId: number,
): Promise<TerminalEligibilityResult | null> {
  // ── 1. Load asset + market ─────────────────────────────────────────────────
  const [row] = await db
    .select({
      id:               assets.id,
      assetUid:         assets.assetUid,
      externalId:       assets.externalId,
      displayName:      assets.displayName,
      symbol:           assets.symbol,
      fundamentalPrice: assets.fundamentalPrice,
      lastTradePrice:   assets.lastTradePrice,
      listingStatus:    assets.listingStatus,
      tradingStatus:    assets.tradingStatus,
      playerProfileId:  assets.playerProfileId,
      provider:         markets.provider,
      game:             markets.game,
    })
    .from(assets)
    .innerJoin(markets, eq(assets.marketId, markets.id))
    .where(eq(assets.id, assetId))
    .limit(1);

  if (!row) return null;

  // ── 2. Load valuation state ─────────────────────────────────────────────────
  const [valState] = await db
    .select({
      id:           dota2ValuationState.id,
      playerValue:  dota2ValuationState.playerValue,
      profileId:    dota2ValuationState.playerProfileId,
      updatedAt:    dota2ValuationState.updatedAt,
    })
    .from(dota2ValuationState)
    .where(eq(dota2ValuationState.assetId, assetId))
    .limit(1);

  // ── 3. Load history (at least 1 event) ─────────────────────────────────────
  const [histRow] = await db
    .select({ id: dota2ValueHistory.id, eventType: dota2ValueHistory.eventType })
    .from(dota2ValueHistory)
    .where(eq(dota2ValueHistory.assetId, assetId))
    .limit(1);

  // ── 4. Parse identity ──────────────────────────────────────────────────────
  const uidParts   = row.assetUid.split(":");
  const gameFromUid = uidParts[0] ?? row.game;
  const isBulkAsset = !row.playerProfileId || Number(row.playerProfileId) === 0;

  const hasFundamentalPrice = row.fundamentalPrice != null && Number(row.fundamentalPrice) > 0;
  const hasLastTradePrice   = row.lastTradePrice != null;
  const hasValuationState   = Boolean(valState);
  const hasPlayerValue      = hasValuationState && valState.playerValue != null;
  const hasHistory          = Boolean(histRow);
  const playerValue         = valState?.playerValue ?? null;
  const pvNum               = playerValue ? parseFloat(String(playerValue)) : null;
  const isAtBaseline        = pvNum !== null && Math.abs(pvNum - 15.0) <= 0.10;

  // ── 5. Ingestion checks ────────────────────────────────────────────────────
  const ingestionChecks: EligibilityCheck[] = [
    {
      check:  "asset_exists",
      passed: true,
      detail: `assetUid=${row.assetUid}`,
    },
    {
      check:  "game_defined",
      passed: Boolean(gameFromUid),
      detail: gameFromUid || "no game in uid",
    },
    {
      check:  "provider_defined",
      passed: Boolean(row.provider),
      detail: row.provider || "no provider",
    },
    {
      check:  "external_id_valid",
      passed: Boolean(row.externalId) && row.externalId !== "0",
      detail: `externalId=${row.externalId}`,
    },
    {
      check:  "has_initial_valuation_state",
      passed: hasValuationState,
      detail: hasValuationState
        ? `player_value=${valState.playerValue} (naming: dota2_valuation_state covers ${gameFromUid})`
        : "no row in dota2_valuation_state",
    },
    {
      check:  "player_value_not_at_baseline",
      passed: hasPlayerValue && !isAtBaseline,
      detail: pvNum !== null
        ? `player_value=${pvNum.toFixed(4)} — ${isAtBaseline ? "STUCK AT $15 BASELINE" : "OK"}`
        : "no player_value",
    },
  ];

  // ── 6. Listing checks ──────────────────────────────────────────────────────
  const listingChecks: EligibilityCheck[] = [
    {
      check:  "valuation_state_exists",
      passed: hasValuationState,
      detail: hasValuationState
        ? `id=${valState.id} updatedAt=${valState.updatedAt}`
        : "missing — run bootstrap",
    },
    {
      check:  "player_value_valid",
      passed: hasPlayerValue && !isAtBaseline,
      detail: pvNum !== null
        ? `player_value=${pvNum.toFixed(4)}`
        : "null",
    },
    {
      check:  "fundamental_price_exists",
      passed: hasFundamentalPrice,
      detail: hasFundamentalPrice
        ? `fundamental_price=${row.fundamentalPrice}`
        : "null or zero — run price projection",
    },
    {
      check:  "last_trade_price_exists",
      passed: hasLastTradePrice,
      detail: hasLastTradePrice
        ? `last_trade_price=${row.lastTradePrice}`
        : "null",
    },
    {
      check:  "bootstrap_history_exists",
      passed: hasHistory,
      detail: hasHistory
        ? `eventType=${histRow.eventType} (naming: dota2_value_history covers ${gameFromUid})`
        : "no row in dota2_value_history — BOOTSTRAP event missing",
    },
    {
      check:  "listing_status_ok",
      passed: row.listingStatus === "LISTED" || row.listingStatus === "ACTIVE",
      detail: `listing_status=${row.listingStatus} trading_status=${row.tradingStatus}`,
    },
  ];

  // ── 7. Derive summary ──────────────────────────────────────────────────────
  const ingestionFails = ingestionChecks.filter(c => !c.passed);
  const listingFails   = listingChecks.filter(c => !c.passed);

  const eligibleForIngestion = ingestionFails.length === 0;
  const eligibleForListing   = listingFails.length === 0;

  const issues: string[] = [
    ...ingestionFails.map(c => `[INGESTION] ${c.check}: ${c.detail ?? "failed"}`),
    ...listingFails.map(c =>   `[LISTING]   ${c.check}: ${c.detail ?? "failed"}`),
  ];

  let recommendedAction: RecommendedAction = "OK";
  if (!eligibleForIngestion) {
    if (!hasValuationState) {
      recommendedAction = "REQUIRES_INITIAL_VALUATION";
    } else if (isAtBaseline) {
      recommendedAction = "REQUIRES_PROVIDER_DATA";
    } else {
      recommendedAction = "REVIEW_REQUIRED";
    }
  } else if (!eligibleForListing) {
    if (!hasHistory) {
      recommendedAction = "REQUIRES_BOOTSTRAP";
    } else if (!hasFundamentalPrice) {
      recommendedAction = "REQUIRES_INITIAL_VALUATION";
    } else {
      recommendedAction = "REVIEW_REQUIRED";
    }
  }

  return {
    assetId,
    game:                 gameFromUid,
    provider:             row.provider,
    displayName:          row.displayName,
    symbol:               row.symbol,
    listingStatus:        row.listingStatus ?? "UNKNOWN",
    tradingStatus:        row.tradingStatus ?? "UNKNOWN",
    isBulkAsset,
    eligibleForIngestion,
    eligibleForListing,
    ingestionChecks,
    listingChecks,
    issues,
    recommendedAction,
  };
}

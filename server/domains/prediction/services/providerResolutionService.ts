// ─── Provider Resolution Service ─────────────────────────────────────────────
// Fase 4: first operational resolution of a MATCH_WINNER market from PandaScore.
//
// Entry point:
//   resolvePredictionMarketFromProvider(marketId, actor?)
//
// Flow:
//   1. Load market — fast-fail without hitting PandaScore if ineligible.
//   2. Fetch external resolution context (PandaScore match data + outcome mapping).
//   3. Apply eligibility rules and decide action.
//   4. If resolving: lock market if open, then delegate to resolveAndSettleMarket.
//
// Safety guarantees:
//   - Idempotency: already-settled markets return ALREADY_RESOLVED immediately
//     (no re-payment). The DB unique index on prediction_settlements also
//     prevents duplicate settlement rows at the DB level.
//   - No double-payment: resolveAndSettleMarket checks market.status and
//     market.resolvedOutcomeId before writing. Concurrent calls will hit the
//     same status check and the DB constraint will catch any race.
//   - Documented limitation: there is no distributed lock or advisory lock yet.
//     If two concurrent HTTP calls race on an OPEN market, both could call
//     transitionMarketStatus; the second transition will fail gracefully because
//     the allowed-transitions guard will reject "open → locked" on an already-
//     locked market. The resolveAndSettleMarket call is then safe.
//
// NÃO implementa settlement manual, alteração de wallet fora do fluxo canônico,
// cron job, nem resolução em lote.
// ─────────────────────────────────────────────────────────────────────────────

import { predictionRepository } from "../repository";
import { predictionService }    from "../service";
import {
  getExternalMatchResolutionContext,
  ResolutionContextError,
} from "./externalResolutionService";

// ── Result types ──────────────────────────────────────────────────────────────

export type ProviderResolutionStatus =
  | "RESOLVED"
  | "ALREADY_RESOLVED"
  | "NO_ACTION"
  | "MANUAL_REVIEW_REQUIRED";

export interface ProviderResolutionResult {
  status: ProviderResolutionStatus;
  reason?: string;

  marketId:   number;
  marketSlug: string | null;

  provider?:  string;
  matchId?:   string;
  winnerId?:  number | null;

  winningOutcomeId?:   number | null;
  winningOutcomeCode?: string | null;

  settlementSummary?: {
    positionsSettled:  number;
    positionsSkipped:  number;
    totalWinnerPayout: string;
  };
}

// ── Eligible market statuses (can attempt resolution) ─────────────────────────
const ELIGIBLE_STATUSES = new Set(["open", "locked"]);

// ── Service ───────────────────────────────────────────────────────────────────

export const resolvePredictionMarketFromProvider = async (
  marketId: number,
  actor    = "PANDASCORE",
): Promise<ProviderResolutionResult> => {

  // ── 1. Load market — fast path without hitting PandaScore ─────────────────
  const market = await predictionRepository.findMarketById(marketId);
  if (!market) {
    throw new Error(`Market #${marketId} not found`);
  }

  const base = { marketId: market.id, marketSlug: market.slug };

  if (market.status === "resolved" || market.status === "settled") {
    return {
      ...base,
      status: "ALREADY_RESOLVED",
      reason: `Market is already in status "${market.status}" — no action taken`,
      winningOutcomeId:   market.resolvedOutcomeId ?? null,
    };
  }

  if (!ELIGIBLE_STATUSES.has(market.status)) {
    return {
      ...base,
      status: "NO_ACTION",
      reason: `Market status "${market.status}" is not eligible for provider resolution`,
    };
  }

  // ── 2. Fetch external resolution context (calls PandaScore) ───────────────
  let ctx;
  try {
    ctx = await getExternalMatchResolutionContext(marketId);
  } catch (err: unknown) {
    if (err instanceof ResolutionContextError) {
      return {
        ...base,
        status: "NO_ACTION",
        reason: `Cannot fetch resolution context: [${err.code}] ${err.message}`,
      };
    }
    throw err;
  }

  const providerFields = {
    provider: ctx.provider,
    matchId:  ctx.matchId,
    winnerId: ctx.winnerId,
  };

  // ── 3. Apply resolution rules ─────────────────────────────────────────────

  const { matchStatus, winnerId, matchedWinningOutcomeId, matchedWinningOutcomeCode } = ctx;

  // Match still running or not started
  if (matchStatus !== "finished" && matchStatus !== "canceled") {
    return {
      ...base,
      ...providerFields,
      status: "NO_ACTION",
      reason: `Match status is "${matchStatus}" — not yet finished`,
    };
  }

  // Cancelled match without a winner → manual review needed
  if (matchStatus === "canceled" && (winnerId == null || matchedWinningOutcomeId == null)) {
    return {
      ...base,
      ...providerFields,
      status: "MANUAL_REVIEW_REQUIRED",
      reason: `Match was cancelled without a deterministic winner. Human review required before resolving or voiding the market.`,
    };
  }

  // Finished (or cancelled with forfeit winner) but no matched outcome
  if (matchedWinningOutcomeId == null) {
    return {
      ...base,
      ...providerFields,
      status: "NO_ACTION",
      reason: `Match has a winner (id=${winnerId}) but no internal outcome could be matched via externalOpponentId. Verify outcome metadata.`,
    };
  }

  // ── 4. Execute resolution ─────────────────────────────────────────────────

  // 4a. If market is still OPEN, lock it first (required by resolveAndSettleMarket)
  if (market.status === "open") {
    const lockResult = await predictionService.transitionMarketStatus({
      marketId,
      targetStatus: "locked",
      actorUserId:  actor,
    });
    if (!lockResult.success) {
      return {
        ...base,
        ...providerFields,
        status: "NO_ACTION",
        reason: `Could not lock market before resolving: ${lockResult.error}`,
      };
    }
    console.log(`[ProviderResolution] Market #${marketId} locked before settlement`);
  }

  // 4b. Resolve + settle via the canonical engine
  const settleResult = await predictionService.resolveAndSettleMarket({
    marketId,
    winningOutcomeId:  matchedWinningOutcomeId,
    actorUserId:       actor,
    resolutionSource:  `PANDASCORE:${ctx.matchId}`,
  });

  if (!settleResult.success) {
    return {
      ...base,
      ...providerFields,
      status: "NO_ACTION",
      reason: `resolveAndSettleMarket failed: ${settleResult.error}`,
      winningOutcomeId:   matchedWinningOutcomeId,
      winningOutcomeCode: matchedWinningOutcomeCode,
    };
  }

  const sd = settleResult.data!;
  return {
    ...base,
    ...providerFields,
    status:              "RESOLVED",
    winningOutcomeId:    sd.winningOutcomeId,
    winningOutcomeCode:  matchedWinningOutcomeCode,
    settlementSummary: {
      positionsSettled:  sd.positionsSettled,
      positionsSkipped:  sd.positionsSkipped,
      totalWinnerPayout: sd.totalWinnerPayout,
    },
  };
};

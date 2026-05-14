// ─── Prediction Markets — Service ─────────────────────────────────────────────
// Business logic for the prediction domain.
//
// Sprint 1: lifecycle methods, market/event/outcome management.
// Sprint 2 (order placement): placeOrder with real wallet lock + position projection.
// Sprint 2 (settlement):      resolveAndSettleMarket — binary payout + ledger credits.
// Phase 4 (fee on profit):    profit fee applied at final settlement only.
//
// Financial rule (enforced from Sprint 2 onwards):
//   Wallet ledger IS the source of truth.
//   predictionPositions is a PROJECTION — it aggregates filled orders.
//   Every stake debit and payout credit MUST go through walletService.
// ─────────────────────────────────────────────────────────────────────────────

import { predictionRepository } from "./repository";
import * as walletService from "../wallet/service";
import { getCached, setCached, evictCached } from "./cache";
import type {
  CreatePredictionEventInput,
  CreatePredictionMarketInput,
  TransitionMarketStatusInput,
  PlacePredictionBetInput,
  PlaceOrderInput,
  PlaceOrderResult,
  ExecuteTradeInput,
  ExecuteTradeResult,
  TradePositionSummary,
  ResolveMarketInput,
  ResolveAndSettleResult,
  PositionSettlementRecord,
  CancelMarketInput,
  CancelAndRefundResult,
  PositionCancelRecord,
  PredictionServiceResult,
  PredictionMarketPage,
  PredictionMarketListParams,
  PredictionMarketWithOutcomes,
  PredictionEventListParams,
  PredictionEvent,
  PredictionPosition,
  EnrichedPosition,
  UserPositionCard,
  UserHistoryCard,
  AdminMarketSummary,
  BrowseMarketsParams,
  BrowseMarketsResponse,
  BrowseMarketCard,
  BrowseTabCounts,
  BrowseTab,
  BrowseSort,
  PredictionPortfolioResponse,
  PredictionPortfolioSummary,
  ActiveMarketPositionGroup,
  RecentPredictionHistoryItem,
} from "./types";
import { BROWSE_DEFAULT_SORT } from "./types";
import { nanoid } from "nanoid";

// ── Phase 4: Platform fee rate on settlement profit ───────────────────────────
// Applied ONLY at final market settlement, ONLY when grossPayout > costBasis.
// BUY, SELL and losing positions are never charged a fee.
// Formula: fee = max(0, profit * PREDICTION_PROFIT_FEE_RATE)
const PREDICTION_PROFIT_FEE_RATE = 0.10; // 10 %

// ── Precision helpers ─────────────────────────────────────────────────────────

function toDecimal(n: string | number, scale = 6): string {
  const f = parseFloat(String(n));
  if (!isFinite(f)) throw new Error(`Invalid numeric value: ${n}`);
  return f.toFixed(scale);
}

function mul(a: string, b: string): string {
  return toDecimal(parseFloat(a) * parseFloat(b));
}

function add(a: string, b: string): string {
  return toDecimal(parseFloat(a) + parseFloat(b));
}

// ── Valid lifecycle transitions ───────────────────────────────────────────────

const VALID_TRANSITIONS: Record<string, string[]> = {
  draft:     ["open", "cancelled"],
  open:      ["locked", "cancelled"],
  locked:    ["resolved", "cancelled"],
  resolved:  ["settled"],
  settled:   [],
  cancelled: [],
};

function isValidTransition(from: string, to: string): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

// ── Market lifecycle audit event helper ───────────────────────────────────────
//
// All writes are BEST-EFFORT — a failed event write must never roll back or
// block the primary financial/lifecycle operation that already completed.
//
// Failure strategy:
//   1. The primary mutation (wallet op, status update) runs first.
//   2. emitMarketEvent() is called after the primary mutation succeeds.
//   3. On failure, a [Prediction:event] error is logged and execution continues.
//
// Source conventions:
//   "admin"       — initiated by a human operator via admin API
//   "scheduler"   — initiated by the auto-lock background scheduler
//   "settlement"  — emitted as a side-effect of financial settlement logic
//   "system"      — any other automated system path

interface EmitMarketEventParams {
  marketId:    number;
  eventType:   string;
  fromStatus?: string | null;
  toStatus?:   string | null;
  actorUserId?: string | null;
  source?:     string | null;
  note?:       string | null;
  metadata?:   Record<string, unknown> | null;
}

async function emitMarketEvent(params: EmitMarketEventParams): Promise<void> {
  try {
    await predictionRepository.recordMarketEvent({
      marketId:    params.marketId,
      eventType:   params.eventType,
      fromStatus:  params.fromStatus  ?? null,
      toStatus:    params.toStatus    ?? null,
      actorUserId: params.actorUserId ?? null,
      source:      params.source      ?? null,
      note:        params.note        ?? null,
      metadata:    params.metadata    ?? null,
    });
  } catch (err: any) {
    console.error(
      `[Prediction:event] Failed to write event '${params.eventType}' for market #${params.marketId}` +
      ` (best-effort — primary operation already completed): ${err?.message}`
    );
  }
}

// ── Market event read (thin delegation to repository) ─────────────────────────

async function listMarketEvents(marketId: number) {
  return predictionRepository.listMarketEvents(marketId);
}

// ── Events ────────────────────────────────────────────────────────────────────

async function createEvent(
  input: CreatePredictionEventInput
): Promise<PredictionServiceResult<{ eventId: number; uid: string }>> {
  try {
    const event = await predictionRepository.createEvent({
      title:          input.title,
      tournamentName: input.tournamentName ?? null,
      eventName:      input.eventName ?? null,
      game:           input.game ?? "lol",
      region:         input.region ?? null,
      eventType:      input.eventType ?? "match",
      teamAName:      input.teamAName ?? null,
      teamBName:      input.teamBName ?? null,
      startsAt:       input.startsAt ?? null,
      externalRef:    input.externalRef ?? null,
      metadata:       input.metadata ?? null,
    });
    console.log(`[Prediction] Event created: id=${event.id} title="${event.title}"`);
    return { success: true, data: { eventId: event.id, uid: event.uid } };
  } catch (err: any) {
    console.error("[Prediction] createEvent error:", err.message);
    return { success: false, error: "Failed to create prediction event." };
  }
}

async function listEvents(params: PredictionEventListParams = {}): Promise<PredictionEvent[]> {
  return predictionRepository.listEvents(params);
}

async function getEvent(id: number): Promise<PredictionEvent | null> {
  return predictionRepository.findEventById(id);
}

// ── Event Lifecycle ───────────────────────────────────────────────────────────
// Allowed status transitions for prediction_event.
// Changing event status does NOT automatically affect markets.
const EVENT_STATUS_TRANSITIONS: Record<string, string[]> = {
  scheduled: ["live", "cancelled", "postponed", "finished"],
  live:      ["finished", "cancelled"],
  postponed: ["scheduled", "cancelled"],
  finished:  [],
  cancelled: [],
};

const VALID_EVENT_STATUSES = ["scheduled", "live", "finished", "cancelled", "postponed"] as const;
type ValidEventStatus = typeof VALID_EVENT_STATUSES[number];

async function updateEventStatus(
  eventId: number,
  newStatus: ValidEventStatus,
): Promise<PredictionServiceResult<{
  eventId:        number;
  previousStatus: string;
  newStatus:      string;
  updatedAt:      string;
}>> {
  const event = await predictionRepository.findEventById(eventId);
  if (!event) return { success: false, error: `Event #${eventId} not found` };

  const allowed = EVENT_STATUS_TRANSITIONS[event.status] ?? [];
  if (!allowed.includes(newStatus)) {
    return {
      success: false,
      error: `Cannot transition event from '${event.status}' to '${newStatus}'. ` +
             `Allowed transitions: ${allowed.length > 0 ? allowed.join(", ") : "none (terminal status)"}`,
    };
  }

  const updated = await predictionRepository.updateEventStatus(eventId, newStatus);
  if (!updated) return { success: false, error: "Update failed — event not found in database" };

  // Evict the home cache so ineligible events stop appearing on active surfaces immediately.
  try { evictCached(CACHE_HOME_KEY); } catch { /* ignore */ }

  console.log(`[Prediction] Event #${eventId} status: ${event.status} → ${newStatus}`);
  return {
    success: true,
    data: {
      eventId,
      previousStatus: event.status,
      newStatus:      updated.status,
      updatedAt:      updated.updatedAt?.toISOString() ?? new Date().toISOString(),
    },
  };
}

// ── Markets ───────────────────────────────────────────────────────────────────

async function createMarket(
  input: CreatePredictionMarketInput
): Promise<PredictionServiceResult<{ marketId: number; uid: string; slug: string }>> {
  if (input.outcomes.length < 2) {
    return { success: false, error: "A prediction market requires at least 2 outcomes." };
  }

  try {
    const market = await predictionRepository.createMarket(
      {
        eventId:          input.eventId ?? null,
        slug:             input.slug ?? undefined,
        question:         input.question,
        description:      input.description ?? null,
        marketType:       input.marketType ?? "binary",
        currency:         input.currency ?? "GS",
        minStake:         input.minStake ?? "1.000000",
        maxStake:         input.maxStake ?? null,
        openAt:           input.openAt ?? null,
        closeAt:          input.closeAt ?? null,
        resolutionSource: input.resolutionSource ?? null,
        createdBy:        input.createdByUserId ?? null,
        metadata:         null,
      },
      input.outcomes
    );

    console.log(
      `[Prediction] Market created: id=${market.id} slug="${market.slug}" status=draft`
    );
    // Best-effort audit event — failure does not roll back market creation.
    await emitMarketEvent({
      marketId:    market.id,
      eventType:   "market_created",
      fromStatus:  null,
      toStatus:    "draft",
      actorUserId: input.createdByUserId ?? null,
      source:      "admin",
      note:        null,
      metadata:    { question: market.question, marketType: market.marketType },
    });
    return { success: true, data: { marketId: market.id, uid: market.uid, slug: market.slug! } };
  } catch (err: any) {
    console.error("[Prediction] createMarket error:", err.message);
    return { success: false, error: "Failed to create prediction market." };
  }
}

async function getMarket(
  idOrSlug: number | string
): Promise<PredictionMarketWithOutcomes | null> {
  return predictionRepository.findMarketWithOutcomes(idOrSlug);
}

async function listMarkets(
  params: PredictionMarketListParams
): Promise<PredictionMarketPage> {
  const { markets, total } = await predictionRepository.listMarkets(params);
  return {
    markets,
    total,
    page:  params.page  ?? 1,
    limit: params.limit ?? 20,
  };
}

// ── Lifecycle transitions (generic — used by admin transition endpoint) ────────

async function transitionMarketStatus(
  input: TransitionMarketStatusInput
): Promise<PredictionServiceResult> {
  const market = await predictionRepository.findMarketById(input.marketId);
  if (!market) {
    return { success: false, error: "Prediction market not found." };
  }

  if (!isValidTransition(market.status, input.targetStatus)) {
    return {
      success: false,
      error: `Cannot transition market from '${market.status}' to '${input.targetStatus}'.`,
    };
  }

  if (input.targetStatus === "resolved") {
    if (!input.resolvedOutcomeId) {
      return { success: false, error: "resolvedOutcomeId is required when resolving a market." };
    }
    const outcome = await predictionRepository.findOutcomeById(input.resolvedOutcomeId);
    if (!outcome || outcome.marketId !== input.marketId) {
      return { success: false, error: "resolvedOutcomeId does not belong to this market." };
    }
  }

  const extra: any = {};
  if (input.targetStatus === "resolved") {
    extra.resolvedOutcomeId = input.resolvedOutcomeId;
    extra.resolveAt          = new Date();
    await predictionRepository.markOutcomeAsWinner(input.resolvedOutcomeId!);
  }
  if (input.targetStatus === "settled") {
    extra.settledAt = new Date();
  }
  if (input.targetStatus === "cancelled") {
    // Sprint 3 (cancellation): Full refund logic is in cancelAndRefundMarket().
    // transitionMarketStatus only updates the status field here; callers that
    // need wallet refunds should call cancelAndRefundMarket() directly.
  }

  const fromStatus = market.status;
  await predictionRepository.updateMarketStatus(input.marketId, input.targetStatus, extra);
  console.log(
    `[Prediction] Market #${input.marketId} transitioned: ${fromStatus} → ${input.targetStatus}` +
    ` by userId=${input.actorUserId}`
  );

  // Best-effort audit event.
  // Distinguish auto-lock (scheduler) from manual admin transitions by actorUserId convention.
  // Event types use past tense to reflect the completed state change.
  const STATUS_TO_EVENT: Record<string, string> = {
    open:      "market_opened",
    locked:    "market_locked",
    resolved:  "market_resolved",
    settled:   "market_settled",
    cancelled: "market_cancelled",
  };
  const isAutoLock = input.targetStatus === "locked" && input.actorUserId === "auto_lock_scheduler";
  await emitMarketEvent({
    marketId:    input.marketId,
    eventType:   isAutoLock ? "market_auto_locked" : (STATUS_TO_EVENT[input.targetStatus] ?? `market_${input.targetStatus}`),
    fromStatus,
    toStatus:    input.targetStatus,
    actorUserId: input.actorUserId ?? null,
    source:      isAutoLock ? "scheduler" : "admin",
    note:        null,
    metadata:    null,
  });

  return { success: true };
}

// ── Sprint 2: Market resolution + settlement ──────────────────────────────────
//
// Payout formula (binary, Sprint 2):
//   winners: grossPayout = quantity * 1.0 GS$  (1 share = 1 GS$ at resolution)
//   losers:  grossPayout = 0
//   fees:    0 (Sprint 2 — rake deferred to Sprint 3)
//   netPayout = grossPayout - fees
//
// Wallet operations per position:
//   ALL positions: consumeLockedFunds(costBasis)  entryType="buy_settle"
//   winners only:  creditWallet(netPayout)         entryType="sell_settle"
//
// Idempotency safeguards:
//   1. Market must be "locked" (or "resolved" for partial-retry)
//   2. Market "settled" → return existing result immediately (no re-run)
//   3. Per-position: findSettlementByPositionId check before inserting
//      (DB partial unique index pred_settlements_position_unique enforces this at DB level)
//   4. resolvedOutcomeId on market row must not change between retries
//
// Flow:
//   A  Validate market exists, status ∈ {locked, resolved}
//   B  Validate winningOutcomeId belongs to market
//   C  If locked: mark winner + transition locked → resolved
//   D  Fetch all active positions for market
//   E  Per position:
//       i   Check existing settlement (skip if found)
//       ii  Compute payout
//       iii consumeLockedFunds(costBasis)
//       iv  creditWallet(netPayout) [winners only]
//       v   Insert prediction_settlements row
//       vi  Update position status → settled
//   F  Transition resolved → settled

async function resolveAndSettleMarket(
  input: ResolveMarketInput
): Promise<PredictionServiceResult<ResolveAndSettleResult>> {
  const { marketId, winningOutcomeId, actorUserId } = input;

  // ── A. Market validation ─────────────────────────────────────────────────────
  const market = await predictionRepository.findMarketById(marketId);
  if (!market) {
    return { success: false, error: "Prediction market not found." };
  }

  // Full idempotency: market already settled → return summary without re-running
  if (market.status === "settled") {
    console.log(`[Prediction:settle] Market #${marketId} already settled — returning idempotent response`);
    const existingSettlements = await predictionRepository.findSettlementsByMarket(marketId);
    const winnerSettlements = existingSettlements.filter(s => parseFloat(s.netPayout) > 0);
    const totalPayout = winnerSettlements
      .reduce((sum, s) => sum + parseFloat(s.netPayout), 0)
      .toFixed(6);

    return {
      success: true,
      data: {
        marketId,
        winningOutcomeId: market.resolvedOutcomeId ?? winningOutcomeId,
        status:           "settled",
        duplicate:        true,
        positionsSettled: 0,
        positionsSkipped: existingSettlements.length,
        totalWinnerPayout:  totalPayout,
        totalStakeConsumed: "0.000000",
        settlements:      [],
      },
    };
  }

  // Market must be locked or resolved (resolved = partial retry after crash between C and F)
  if (market.status !== "locked" && market.status !== "resolved") {
    return {
      success: false,
      error: `Market cannot be resolved from status '${market.status}'. Must be 'locked'.`,
    };
  }

  // ── B. Outcome validation ────────────────────────────────────────────────────
  const outcomes = await predictionRepository.findOutcomesByMarket(marketId);
  const winningOutcome = outcomes.find(o => o.id === winningOutcomeId);
  if (!winningOutcome) {
    return {
      success: false,
      error: `Outcome #${winningOutcomeId} does not belong to market #${marketId}.`,
    };
  }

  // Retry guard: if already resolved, winningOutcomeId must match
  if (market.status === "resolved" && market.resolvedOutcomeId !== null) {
    if (market.resolvedOutcomeId !== winningOutcomeId) {
      return {
        success: false,
        error: `Market #${marketId} already resolved with outcome #${market.resolvedOutcomeId}. ` +
               `Cannot re-resolve with a different outcome.`,
      };
    }
  }

  // ── C. Transition locked → resolved (skip if already resolved on retry) ──────
  if (market.status === "locked") {
    await predictionRepository.markOutcomeAsWinner(winningOutcomeId);
    await predictionRepository.updateMarketStatus(marketId, "resolved", {
      resolvedOutcomeId: winningOutcomeId,
      resolveAt:         new Date(),
    });
    console.log(
      `[Prediction:settle] Market #${marketId} → resolved` +
      ` winningOutcomeId=${winningOutcomeId} by userId=${actorUserId}`
    );
    // Best-effort audit event for resolution.
    await emitMarketEvent({
      marketId,
      eventType:   "market_resolved",
      fromStatus:  "locked",
      toStatus:    "resolved",
      actorUserId: actorUserId ?? null,
      source:      "admin",
      note:        null,
      metadata:    { winningOutcomeId },
    });
  }

  // ── D. Fetch active positions ─────────────────────────────────────────────────
  const activePositions = await predictionRepository.findActivePositionsByMarket(marketId);

  if (activePositions.length === 0) {
    // No positions to settle — still advance market to settled
    await predictionRepository.updateMarketStatus(marketId, "settled", { settledAt: new Date() });
    console.log(`[Prediction:settle] Market #${marketId} settled with 0 active positions.`);
    await emitMarketEvent({
      marketId,
      eventType:   "market_settled",
      fromStatus:  "resolved",
      toStatus:    "settled",
      actorUserId: actorUserId ?? null,
      source:      "settlement",
      note:        "Settled with 0 active positions.",
      metadata:    { winningOutcomeId, positionsSettled: 0 },
    });
    return {
      success: true,
      data: {
        marketId,
        winningOutcomeId,
        status:            "settled",
        duplicate:         false,
        positionsSettled:  0,
        positionsSkipped:  0,
        totalWinnerPayout:  "0.000000",
        totalStakeConsumed: "0.000000",
        settlements:        [],
      },
    };
  }

  // ── E. Settle each position ───────────────────────────────────────────────────
  const settlements: PositionSettlementRecord[] = [];
  let totalWinnerPayout   = "0.000000";
  let totalStakeConsumed  = "0.000000";
  let positionsSettled    = 0;
  let positionsSkipped    = 0;

  const currency = market.currency as "GS" | "USDC";
  const now      = new Date();

  for (const position of activePositions) {
    // ── i. Per-position idempotency check ───────────────────────────────────────
    const existingSettlement = await predictionRepository.findSettlementByPositionId(position.id);
    if (existingSettlement) {
      console.log(
        `[Prediction:settle] Position #${position.id} already settled (settlementId=${existingSettlement.id}) — skipping`
      );
      settlements.push({
        positionId:      position.id,
        userId:          position.userId,
        outcomeId:       position.outcomeId,
        isWinner:        position.outcomeId === winningOutcomeId,
        costBasis:       position.costBasis ?? "0",
        grossPayout:     existingSettlement.grossPayout,
        fees:            existingSettlement.fees,
        netPayout:       existingSettlement.netPayout,
        walletLedgerRef: existingSettlement.ledgerReferenceId ?? "",
        settlementId:    existingSettlement.id,
        skipped:         true,
      });
      positionsSkipped++;
      continue;
    }

    // ── ii. Compute payout ──────────────────────────────────────────────────────
    const isWinner    = position.outcomeId === winningOutcomeId;
    const quantity    = position.quantity ?? "0";
    const costBasis   = position.costBasis ?? position.stake ?? "0";
    // grossPayout = quantity * 1.0 for winners, 0 for losers
    const grossPayout      = isWinner ? toDecimal(parseFloat(quantity) * 1.0) : "0.000000";
    // Phase 4: profit-based fee — only on positive profit, only at settlement
    const grossPayoutNum   = parseFloat(grossPayout);
    const costBasisNum     = parseFloat(costBasis);
    const profitNum        = Math.max(0, grossPayoutNum - costBasisNum);
    const feeNum           = profitNum > 0 ? profitNum * PREDICTION_PROFIT_FEE_RATE : 0;
    const profit           = toDecimal(profitNum);
    const fees             = toDecimal(feeNum);
    const netPayout        = toDecimal(grossPayoutNum - feeNum);

    // walletLedgerRef: unique per position, used as referenceId for both wallet entries
    const walletLedgerRef = `pred_settle_pos_${position.id}`;

    // ── iii. consumeLockedFunds — always for all positions ─────────────────────
    // This permanently converts the locked bet stake into a real spend.
    if (parseFloat(costBasis) > 0) {
      try {
        await walletService.consumeLockedFunds({
          userId:        position.userId,
          currency,
          amount:        costBasis,
          entryType:     "buy_settle",
          description:   `Prediction bet settled: ${isWinner ? "winner" : "loser"} — market #${marketId}, position #${position.id}`,
          referenceType: "prediction_settlement",
          referenceId:   walletLedgerRef,
        });
      } catch (err: any) {
        console.error(
          `[Prediction:settle] consumeLockedFunds failed for position #${position.id}:`,
          err.message
        );
        // Skip this position — will be retried on next settle call
        continue;
      }
    }

    // ── iv. creditWallet — winners only ────────────────────────────────────────
    if (isWinner && parseFloat(netPayout) > 0) {
      try {
        await walletService.creditWallet({
          userId:        position.userId,
          currency,
          amount:        netPayout,
          entryType:     "sell_settle",
          description:   `Prediction payout: ${quantity} winning shares @ 1.00 ${currency} — market #${marketId}`,
          referenceType: "prediction_settlement",
          referenceId:   walletLedgerRef,
        });
      } catch (err: any) {
        console.error(
          `[Prediction:settle] creditWallet failed for position #${position.id}:`,
          err.message
        );
        // Funds consumed but not credited — critical: log for manual reconciliation
        console.error(
          `[Prediction:settle] RECONCILIATION NEEDED: position #${position.id}` +
          ` userId=${position.userId} netPayout=${netPayout} ${currency}` +
          ` referenceId=${walletLedgerRef}`
        );
        continue;
      }
    }

    // ── iv-b. Deduct platform fee from wallet — fee-payers only ─────────────────
    // Fee is recorded as a separate ledger entry (type "platform_fee") so it is
    // fully auditable. The fee is NOT sent to a treasury wallet in this phase —
    // it is debited from the user's credit before it hits available_balance.
    // Implementation: we simply reduce netPayout (already done above).
    // The fee amount is logged and stored in the settlement row for reconciliation.
    if (feeNum > 0) {
      console.log(
        `[Prediction:settle] Phase-4 fee: position #${position.id}` +
        ` userId=${position.userId} grossPayout=${grossPayout} costBasis=${costBasis}` +
        ` profit=${profit} fee=${fees} netPayout=${netPayout} (rate=${PREDICTION_PROFIT_FEE_RATE})`
      );
    }

    // ── v. Insert prediction_settlements row ────────────────────────────────────
    let settlement;
    try {
      settlement = await predictionRepository.createSettlement({
        marketId,
        userId:            position.userId,
        positionId:        position.id,
        grossPayout,
        costBasisUsed:     costBasis,
        profit,
        fees,
        netPayout,
        ledgerReferenceId: walletLedgerRef,
      });
    } catch (err: any) {
      // Unique constraint violation = concurrent settle call won the race for this position
      if (err.code === "23505") {
        console.warn(
          `[Prediction:settle] Settlement race on position #${position.id} — skipping`
        );
        positionsSkipped++;
        continue;
      }
      throw err; // unexpected — re-throw
    }

    // ── vi. Update position status → settled ────────────────────────────────────
    await predictionRepository.updatePositionStatus(position.id, "settled", {
      payout:   netPayout,
      payoutAt: now,
      realizedPnl: toDecimal(parseFloat(netPayout) - parseFloat(costBasis)),
    });

    // Accumulate totals
    totalWinnerPayout  = add(totalWinnerPayout, netPayout);
    totalStakeConsumed = add(totalStakeConsumed, costBasis);
    positionsSettled++;

    settlements.push({
      positionId:      position.id,
      userId:          position.userId,
      outcomeId:       position.outcomeId,
      isWinner,
      costBasis,
      grossPayout,
      fees,
      netPayout,
      walletLedgerRef,
      settlementId:    settlement.id,
      skipped:         false,
    });

    console.log(
      `[Prediction:settle] Position #${position.id} settled: ` +
      `userId=${position.userId} isWinner=${isWinner}` +
      ` costBasis=${costBasis} netPayout=${netPayout} ${currency}`
    );
  }

  // ── F. Transition resolved → settled ─────────────────────────────────────────
  await predictionRepository.updateMarketStatus(marketId, "settled", { settledAt: now });

  console.log(
    `[Prediction:settle] ✓ Market #${marketId} fully settled.` +
    ` positionsSettled=${positionsSettled} positionsSkipped=${positionsSkipped}` +
    ` totalWinnerPayout=${totalWinnerPayout} totalStakeConsumed=${totalStakeConsumed} ${currency}`
  );

  // Best-effort audit event for settlement completion.
  await emitMarketEvent({
    marketId,
    eventType:   "market_settled",
    fromStatus:  "resolved",
    toStatus:    "settled",
    actorUserId: actorUserId ?? null,
    source:      "settlement",
    note:        null,
    metadata: {
      winningOutcomeId,
      positionsSettled,
      positionsSkipped,
      totalWinnerPayout,
      totalStakeConsumed,
      currency,
    },
  });

  return {
    success: true,
    data: {
      marketId,
      winningOutcomeId,
      status:           "settled",
      duplicate:        false,
      positionsSettled,
      positionsSkipped,
      totalWinnerPayout,
      totalStakeConsumed,
      settlements,
    },
  };
}

// ── Sprint 3: Market cancellation + refund ────────────────────────────────────
//
// Eligibility rules:
//   allowed:     draft, open, locked
//   not allowed: resolved (partial settlement risk), settled (funds already paid out)
//   already cancelled → return duplicate:true immediately (no wallet replay)
//
// Wallet operation per active position:
//   walletService.unlockFunds(costBasis)  — entryType: "unlock"
//   Effect: lockedBalance -= costBasis,  availableBalance += costBasis
//   (total_balance unchanged — this is a return of locked funds, not a new credit)
//
// Audit record (prediction_settlements):
//   grossPayout=0, fees=0, netPayout=0, ledgerReferenceId="pred_cancel_pos_{positionId}"
//   Reuses the settlements table as a "position closure event" table.
//   The ledgerReferenceId prefix distinguishes cancellation rows from settlement rows.
//   DB unique index pred_settlements_position_unique prevents duplicate rows per position.
//
// Position status after cancellation:
//   status:      "cancelled"
//   payout:      "0.000000"   (no new funds credited — unlock is the wallet operation)
//   realizedPnl: "0.000000"   (break-even — user receives their full stake back)
//
// Flow:
//   A  Validate market exists
//   B  If market.status === "cancelled" → return duplicate:true
//   C  If market.status ∈ {resolved, settled} → reject (ineligible)
//   D  Validate status ∈ {draft, open, locked}
//   E  Fetch all active positions
//   F  Per position (idempotent loop):
//       i   findSettlementByPositionId → skip if exists
//       ii  walletService.unlockFunds(costBasis)
//       iii createSettlement(0/0/0, ledgerReferenceId=pred_cancel_pos_{id})
//       iv  updatePositionStatus → "cancelled"
//   G  updateMarketStatus → "cancelled"
//   H  Return CancelAndRefundResult

async function cancelAndRefundMarket(
  input: CancelMarketInput
): Promise<PredictionServiceResult<CancelAndRefundResult>> {
  const { marketId, actorUserId } = input;

  // ── A. Market validation ─────────────────────────────────────────────────────
  const market = await predictionRepository.findMarketById(marketId);
  if (!market) {
    return { success: false, error: "Prediction market not found." };
  }

  // ── B. Already cancelled — idempotent duplicate response ─────────────────────
  if (market.status === "cancelled") {
    console.log(`[Prediction:cancel] Market #${marketId} already cancelled — returning duplicate`);
    // Sum costBasis from all cancelled positions to reconstruct total previously refunded
    const allPositions   = await predictionRepository.findPositionsByMarket(marketId);
    const cancelledOnes  = allPositions.filter(p => p.status === "cancelled");
    const totalRefunded  = cancelledOnes
      .reduce((sum, p) => sum + parseFloat(p.costBasis ?? p.stake ?? "0"), 0)
      .toFixed(6);

    return {
      success: true,
      data: {
        marketId,
        status:             "cancelled",
        duplicate:          true,
        positionsCancelled: 0,
        positionsSkipped:   cancelledOnes.length,
        totalRefunded,
        currency:           market.currency,
        cancellations:      [],
      },
    };
  }

  // ── C & D. Eligibility check ──────────────────────────────────────────────────
  if (market.status === "settled") {
    return {
      success: false,
      error: "Cannot cancel a settled market — funds have already been paid out.",
    };
  }
  if (market.status === "resolved") {
    return {
      success: false,
      error:
        "Cannot cancel a resolved market — resolution is already recorded. " +
        "Complete settlement or contact support.",
    };
  }
  if (!["draft", "open", "locked"].includes(market.status)) {
    return {
      success: false,
      error: `Market status '${market.status}' is not eligible for cancellation.`,
    };
  }

  // ── E. Fetch active positions ─────────────────────────────────────────────────
  const activePositions = await predictionRepository.findActivePositionsByMarket(marketId);
  const currency = market.currency as "GS" | "USDC";

  // ── F. Process each position ──────────────────────────────────────────────────
  const cancellations: PositionCancelRecord[] = [];
  let positionsCancelled = 0;
  let positionsSkipped   = 0;
  let totalRefunded      = "0.000000";
  const now              = new Date();

  for (const position of activePositions) {
    const positionId      = position.id;
    const costBasis       = position.costBasis ?? position.stake ?? "0";
    const walletLedgerRef = `pred_cancel_pos_${positionId}`;

    // ── i. Per-position idempotency — skip if already processed ─────────────────
    const existingRecord = await predictionRepository.findSettlementByPositionId(positionId);
    if (existingRecord) {
      console.log(
        `[Prediction:cancel] Position #${positionId} already has closure record ` +
        `(id=${existingRecord.id}) — skipping`
      );
      cancellations.push({
        positionId,
        userId:          position.userId,
        costBasis,
        walletLedgerRef: existingRecord.ledgerReferenceId ?? walletLedgerRef,
        settlementId:    existingRecord.id,
        skipped:         true,
      });
      positionsSkipped++;
      continue;
    }

    // ── ii. Unlock funds — return locked stake to available balance ──────────────
    if (parseFloat(costBasis) > 0) {
      try {
        await walletService.unlockFunds({
          userId:        position.userId,
          currency,
          amount:        costBasis,
          entryType:     "unlock",
          description:   `Prediction market cancelled — refund for market #${marketId}, position #${positionId}`,
          referenceType: "prediction_cancellation",
          referenceId:   walletLedgerRef,
        });
      } catch (err: any) {
        console.error(
          `[Prediction:cancel] unlockFunds failed for position #${positionId}:`,
          err.message
        );
        // Skip this position — will succeed on retry once the locked balance is correct
        continue;
      }
    }

    // ── iii. Write audit record in prediction_settlements ─────────────────────────
    let auditRow;
    try {
      auditRow = await predictionRepository.createSettlement({
        marketId,
        userId:            position.userId,
        positionId,
        grossPayout:       "0.000000",
        fees:              "0.000000",
        netPayout:         "0.000000",
        ledgerReferenceId: walletLedgerRef,
      });
    } catch (err: any) {
      if (err.code === "23505") {
        // Race condition — concurrent cancel call already wrote the row
        console.warn(
          `[Prediction:cancel] Audit row race on position #${positionId} — skipping`
        );
        positionsSkipped++;
        continue;
      }
      throw err;
    }

    // ── iv. Update position status ────────────────────────────────────────────────
    // Sprint 4.5: cancelledAt is now set explicitly so the read path doesn't need
    // to fall back to updatedAt as a proxy. Legacy rows pre-dating this column will
    // still use updatedAt as a fallback (see mapToHistoryCard / getMyPortfolio).
    await predictionRepository.updatePositionStatus(positionId, "cancelled", {
      payout:      "0.000000",
      payoutAt:    now,
      cancelledAt: now,
      realizedPnl: "0.000000",  // Break-even: user receives their full stake back via unlock
    });

    totalRefunded = add(totalRefunded, costBasis);
    positionsCancelled++;

    cancellations.push({
      positionId,
      userId:          position.userId,
      costBasis,
      walletLedgerRef,
      settlementId:    auditRow.id,
      skipped:         false,
    });

    console.log(
      `[Prediction:cancel] Position #${positionId} cancelled: ` +
      `userId=${position.userId} refunded=${costBasis} ${currency}`
    );
  }

  // ── G. Mark market as cancelled ───────────────────────────────────────────────
  const cancelFromStatus = market.status;
  await predictionRepository.updateMarketStatus(marketId, "cancelled");

  console.log(
    `[Prediction:cancel] ✓ Market #${marketId} cancelled by userId=${actorUserId}. ` +
    `positionsCancelled=${positionsCancelled} positionsSkipped=${positionsSkipped} ` +
    `totalRefunded=${totalRefunded} ${currency}`
  );

  // Best-effort audit event for cancellation.
  await emitMarketEvent({
    marketId,
    eventType:   "market_cancelled",
    fromStatus:  cancelFromStatus,
    toStatus:    "cancelled",
    actorUserId: actorUserId ?? null,
    source:      "admin",
    note:        input.reason ?? null,
    metadata: {
      positionsCancelled,
      positionsSkipped,
      totalRefunded,
      currency,
    },
  });

  return {
    success: true,
    data: {
      marketId,
      status:             "cancelled",
      duplicate:          false,
      positionsCancelled,
      positionsSkipped,
      totalRefunded,
      currency,
      cancellations,
    },
  };
}

// ── Sprint 1 legacy bet stub — delegates to placeOrder ────────────────────────

async function placeBet(
  input: PlacePredictionBetInput
): Promise<PredictionServiceResult<{ positionId: number }>> {
  const result = await placeOrder({
    userId:    input.userId,
    marketId:  input.marketId,
    outcomeId: input.outcomeId,
    side:      "buy",
    orderType: "market",
    quantity:  input.stake,
    price:     "0.500000",
    currency:  input.currency,
  });

  if (!result.success) {
    return { success: false, error: result.error };
  }

  return { success: true, data: { positionId: result.data!.positionId } };
}

// ── Sprint 2: Prediction order placement ──────────────────────────────────────
//
// Flow:
//   1. Idempotency check  — query prediction_orders by idempotency_key (UNIQUE)
//   2. Validate market    — must exist and be "open"; check closeAt expiry
//   3. Validate outcome   — must belong to the market
//   4. Validate amounts   — quantity > 0, price ∈ (0,1), totalValue >= minStake
//   5. Create "pending" order row — uses DB UNIQUE constraint as idempotency gate
//   6. walletService.lockFunds() — atomic wallet transaction (SELECT FOR UPDATE)
//   7. Update order → "filled" + upsert position projection
//   8. Update market pool + outcome pool share (non-critical, best-effort)
//   9. Insert price snapshot (non-critical, best-effort)
//  10. Return PlaceOrderResult

async function placeOrder(
  input: PlaceOrderInput
): Promise<PredictionServiceResult<PlaceOrderResult>> {
  const idempotencyKey = input.idempotencyKey ?? `pred_${nanoid(24)}`;

  // ── 1. Idempotency check ─────────────────────────────────────────────────────
  const existingOrder = await predictionRepository.findOrderByIdempotencyKey(idempotencyKey);
  if (existingOrder) {
    console.log(
      `[Prediction:placeOrder] Idempotent replay: orderId=${existingOrder.id} key=${idempotencyKey}`
    );
    const existingPosition = await predictionRepository.findPositionByUserMarketOutcome(
      input.userId, existingOrder.marketId, existingOrder.outcomeId
    );
    return {
      success: true,
      data: {
        orderId:         existingOrder.id,
        positionId:      existingPosition?.id ?? 0,
        totalValue:      existingOrder.totalValue ?? "0",
        currency:        input.currency,
        walletLedgerRef: `pred_ord_${existingOrder.id}`,
        status:          existingOrder.status,
        idempotencyKey,
        duplicate:       true,
      },
    };
  }

  // ── 2. Validate market ───────────────────────────────────────────────────────
  const market = await predictionRepository.findMarketWithOutcomes(input.marketId);
  if (!market) {
    return { success: false, error: "Prediction market not found." };
  }
  if (market.status !== "open") {
    return {
      success: false,
      error: `Market is not open for betting. Current status: ${market.status}.`,
    };
  }
  if (market.closeAt && new Date() >= new Date(market.closeAt)) {
    return { success: false, error: "Market has expired — betting period is closed." };
  }

  // ── 3. Validate outcome ──────────────────────────────────────────────────────
  const outcome = market.outcomes.find((o) => o.id === input.outcomeId);
  if (!outcome) {
    return { success: false, error: "Outcome does not belong to this market." };
  }

  // ── 4. Validate amounts ──────────────────────────────────────────────────────
  const quantity   = toDecimal(input.quantity);
  const price      = toDecimal(input.price);
  const totalValue = mul(quantity, price);

  const minStake = parseFloat(market.minStake ?? "1");
  const totalNum = parseFloat(totalValue);
  if (totalNum < minStake) {
    return {
      success: false,
      error: `Total value (${totalValue}) is below the minimum stake of ${minStake} ${market.currency}.`,
    };
  }
  if (market.maxStake) {
    const maxStake = parseFloat(market.maxStake);
    if (totalNum > maxStake) {
      return {
        success: false,
        error: `Total value (${totalValue}) exceeds the maximum stake of ${maxStake} ${market.currency}.`,
      };
    }
  }

  // ── 5. Create pending order ──────────────────────────────────────────────────
  let order;
  try {
    order = await predictionRepository.createOrder({
      marketId:       input.marketId,
      userId:         input.userId,
      outcomeId:      input.outcomeId,
      side:           input.side,
      orderType:      input.orderType,
      quantity,
      price,
      totalValue,
      status:         "pending",
      idempotencyKey,
    });
  } catch (err: any) {
    if (err.code === "23505") {
      console.warn(`[Prediction:placeOrder] Race on idempotency key=${idempotencyKey}`);
      const raceOrder = await predictionRepository.findOrderByIdempotencyKey(idempotencyKey);
      return {
        success: true,
        data: {
          orderId:         raceOrder!.id,
          positionId:      0,
          totalValue:      raceOrder!.totalValue ?? "0",
          currency:        input.currency,
          walletLedgerRef: `pred_ord_${raceOrder!.id}`,
          status:          raceOrder!.status,
          idempotencyKey,
          duplicate:       true,
        },
      };
    }
    console.error("[Prediction:placeOrder] createOrder failed:", err.message);
    return { success: false, error: "Failed to create prediction order." };
  }

  const walletLedgerRef = `pred_ord_${order.id}`;

  // ── 6. Lock funds in wallet ──────────────────────────────────────────────────
  try {
    await walletService.lockFunds({
      userId:        input.userId,
      currency:      input.currency as "GS" | "USDC",
      amount:        totalValue,
      entryType:     "lock",
      description:   `Prediction bet lock: ${quantity} shares @ ${price} ${input.currency} — market #${input.marketId}, outcome #${input.outcomeId}`,
      referenceType: "prediction_order",
      referenceId:   String(order.id),
    });
  } catch (err: any) {
    await predictionRepository.updateOrderStatus(order.id, "failed").catch(() => {});
    console.warn(
      `[Prediction:placeOrder] Wallet lock failed for orderId=${order.id}: ${err.message}`
    );
    const isInsufficientFunds = err.message?.includes("Insufficient");
    return {
      success: false,
      error: isInsufficientFunds
        ? `Insufficient ${input.currency} balance. Need ${totalValue} ${input.currency}.`
        : "Failed to lock funds. Please try again.",
    };
  }

  // ── 7. Fill order + upsert position ─────────────────────────────────────────
  let positionId: number;
  try {
    await predictionRepository.updateOrderStatus(order.id, "filled");

    const existing = await predictionRepository.findPositionByUserMarketOutcome(
      input.userId, input.marketId, input.outcomeId
    );

    if (existing) {
      await predictionRepository.updatePositionForOrder(
        existing.id, quantity, totalValue, walletLedgerRef
      );
      positionId = existing.id;
    } else {
      const newPosition = await predictionRepository.createPosition({
        userId:          input.userId,
        marketId:        input.marketId,
        outcomeId:       input.outcomeId,
        quantity,
        avgPrice:        price,
        costBasis:       totalValue,
        stake:           totalValue,
        currency:        input.currency,
        status:          "active",
        walletLedgerRef,
      });
      positionId = newPosition.id;
    }
  } catch (err: any) {
    console.error(
      `[Prediction:placeOrder] Post-lock step failed for orderId=${order.id}:`,
      err.message,
      "Funds remain locked — referenceId:", order.id
    );
    return {
      success: false,
      error: "Order partially recorded. Contact support if funds appear locked.",
    };
  }

  // ── 8 & 9. Pool update + telemetry (non-critical, best-effort) ──────────────
  // These writes are intentionally fire-and-forget.
  // A failure here does NOT affect the filled order, locked wallet funds, or position.
  //
  // Telemetry model (Sprint 2 MVP):
  //   snapshot.price       = accepted execution price (not an AMM-derived implied probability)
  //   snapshot.volumeWindow = order totalValue (qty × price)
  //   stats.lastPriceYes/No = execution price of the most recent fill for that outcome slot
  //   stats.volume24h       = cumulative total (NOT a true 24h rolling window — see Sprint 3 TODO)
  //   stats.traders24h      = NOT updated (requires expensive DISTINCT count — deferred to Sprint 3)
  //
  // YES/NO determination: outcome.sortOrder === 0 → YES slot; anything else → NO slot.
  // This is a binary market convention. Multi-outcome markets should use outcome.code instead.

  const isFirstOutcome = (outcome?.sortOrder ?? 1) === 0;

  Promise.all([
    predictionRepository.updateMarketPool(input.marketId, totalValue),
    predictionRepository.updateOutcomePoolShare(input.outcomeId, totalValue),
    predictionRepository.insertPriceSnapshot({
      marketId:     input.marketId,
      outcomeId:    input.outcomeId,
      price,
      volumeWindow: totalValue,
    }),
    predictionRepository.recordOrderTelemetry(
      input.marketId,
      isFirstOutcome,
      price,
      totalValue,
    ),
  ]).then(() => {
    // Evict the home cache so the next /api/predictions/home request returns
    // fresh lastPriceYes / lastPriceNo values that reflect this trade.
    try { evictCached(CACHE_HOME_KEY); } catch { /* ignore */ }
  }).catch((err) => {
    console.warn("[Prediction:placeOrder] Non-critical telemetry update failed:", err.message);
    try { evictCached(CACHE_HOME_KEY); } catch { /* ignore */ }
  });

  console.log(
    `[Prediction:placeOrder] ✓ orderId=${order.id} positionId=${positionId}` +
    ` userId=${input.userId} market=${input.marketId} outcome=${input.outcomeId}` +
    ` quantity=${quantity} price=${price} total=${totalValue} ${input.currency}`
  );

  return {
    success: true,
    data: {
      orderId:         order.id,
      positionId,
      totalValue,
      currency:        input.currency,
      walletLedgerRef,
      status:          "filled",
      idempotencyKey,
      duplicate:       false,
    },
  };
}

// ── Sprint 3 Admin Surface ────────────────────────────────────────────────────
// availableActions: pure mapping from market status → allowed admin operations.
// getAdminSummary:  compact operational snapshot (market + event + outcomes +
//                  stats + position counts + availableActions) for the admin UI.
// ─────────────────────────────────────────────────────────────────────────────

const LIFECYCLE_ACTIONS: Record<string, string[]> = {
  draft:    ["open", "cancel"],
  open:     ["lock", "cancel"],
  locked:   ["resolve", "cancel"],
  resolved: [],     // transient state during settlement; no manual actions
  settled:  [],
  cancelled: [],
};

function availableActions(status: string): string[] {
  return LIFECYCLE_ACTIONS[status] ?? [];
}

async function getAdminSummary(marketId: number): Promise<AdminMarketSummary | null> {
  const [market, countRows] = await Promise.all([
    predictionRepository.findMarketWithOutcomes(marketId),
    predictionRepository.countPositionsByStatus(marketId),
  ]);
  if (!market) return null;

  const positionCounts = { active: 0, settled: 0, cancelled: 0, total: 0 };
  for (const row of countRows) {
    positionCounts.total += row.count;
    if (row.status === "active")    positionCounts.active    += row.count;
    if (row.status === "settled")   positionCounts.settled   += row.count;
    if (row.status === "cancelled") positionCounts.cancelled += row.count;
  }

  return {
    marketId:          market.id,
    uid:               market.uid,
    slug:              market.slug,
    question:          market.question,
    description:       market.description,
    status:            market.status,
    marketType:        market.marketType,
    currency:          market.currency,
    resolvedOutcomeId: market.resolvedOutcomeId,
    openAt:            market.openAt,
    closeAt:           market.closeAt,
    resolveAt:         market.resolveAt,
    settledAt:         market.settledAt,
    createdAt:         market.createdAt,
    event:             market.event,
    outcomes:          market.outcomes,
    stats:             market.stats,
    positionCounts,
    availableActions:  availableActions(market.status),
    recentEventsUrl:   `/api/predictions/markets/${marketId}/events`,
  };
}

// ── Sprint 3 Read APIs ────────────────────────────────────────────────────────
// Product-facing read views for Home, Predictions, and Portfolio screens.
// All three market list functions delegate to the shared listMarkets() repo
// function (which already joins outcomes, event, and stats) with different
// filter params.  No new DB logic — only param specialisation.
// ─────────────────────────────────────────────────────────────────────────────

// Live markets: status=open AND (closeAt IS NULL OR closeAt > now)
async function getLiveMarkets(
  params: Pick<PredictionMarketListParams, "currency" | "eventId" | "page" | "limit"> = {}
): Promise<PredictionMarketPage> {
  const { markets, total } = await predictionRepository.listMarkets({
    ...params,
    status:   "open",
    liveOnly: true,
  });
  return { markets, total, page: params.page ?? 1, limit: params.limit ?? 20 };
}

// Upcoming markets: status=draft (created but not yet open to trading)
async function getUpcomingMarkets(
  params: Pick<PredictionMarketListParams, "currency" | "eventId" | "page" | "limit"> = {}
): Promise<PredictionMarketPage> {
  const { markets, total } = await predictionRepository.listMarkets({
    ...params,
    status: "draft",
  });
  return { markets, total, page: params.page ?? 1, limit: params.limit ?? 20 };
}

// Resolved markets: status IN (settled, cancelled)
// "resolved" status is a transient intermediate state during settlement.
// In practice markets spend very little time there, but we include it so
// any markets that are mid-settlement still appear in this view.
async function getResolvedMarkets(
  params: Pick<PredictionMarketListParams, "currency" | "eventId" | "page" | "limit"> = {}
): Promise<PredictionMarketPage> {
  const { markets, total } = await predictionRepository.listMarkets({
    ...params,
    statuses: ["settled", "cancelled", "resolved"],
  });
  return { markets, total, page: params.page ?? 1, limit: params.limit ?? 20 };
}

// ── Sprint 4 Browse ───────────────────────────────────────────────────────────
// getMarketsBrowse: resolves tab semantics, applies sort defaults, delegates to
// browseMarkets() in the repository (which issues LEFT-JOIN queries for game +
// volume_desc sort without an analytics pipeline).
//
// Filter precedence (documented in browse arch doc):
//   1. explicit statuses[] beats tab — tab is set to null in response
//   2. tab (live|upcoming|resolved) maps to canonical status sets
//   3. neither → no status filter (all markets returned)
//
// Sort defaults per context (from BROWSE_DEFAULT_SORT):
//   live     → closing_soon   upcoming → newest   resolved → newest
//   explicit → newest         all      → newest
// ─────────────────────────────────────────────────────────────────────────────

async function getMarketsBrowse(raw: BrowseMarketsParams): Promise<BrowseMarketsResponse> {
  const page  = Math.max(1, raw.page  ?? 1);
  const limit = Math.min(100, Math.max(1, raw.limit ?? 20));

  // ── Tab → statuses resolution ─────────────────────────────────────────────
  // Explicit statuses[] takes precedence over tab.
  // tab=all (or no tab) → no status filter — quality gate only.
  let resolvedStatuses: string[];
  let resolvedLiveOnly  = false;
  let effectiveTab: BrowseTab | null = raw.tab ?? null;

  if (raw.statuses && raw.statuses.length > 0) {
    // Explicit override: tab is suppressed in the response to signal this path.
    resolvedStatuses = raw.statuses;
    effectiveTab     = null;
  } else if (raw.tab === "live") {
    resolvedStatuses = ["open"];
    resolvedLiveOnly = true;   // additionally gate on closeAt > now OR null
  } else if (raw.tab === "upcoming") {
    resolvedStatuses = ["draft"];
  } else if (raw.tab === "resolved") {
    // Include mid-settlement "resolved" status alongside settled + cancelled.
    resolvedStatuses = ["settled", "cancelled", "resolved"];
  } else {
    // tab=all or no tab → no status filter (quality gate still applied)
    resolvedStatuses = [];
  }

  // ── Sort default per context ──────────────────────────────────────────────
  const contextKey: string =
    raw.statuses?.length       ? "explicit"
    : raw.tab                  ? raw.tab
    : "all";
  const sort: BrowseSort = raw.sort ?? BROWSE_DEFAULT_SORT[contextKey] ?? "newest";

  // ── Delegate to repository (browse + tab counts in parallel) ──────────────
  const [{ cards, total }, counts] = await Promise.all([
    predictionRepository.browseMarkets({
      statuses: resolvedStatuses.length > 0 ? resolvedStatuses : undefined,
      liveOnly: resolvedLiveOnly,
      game:     raw.game,
      currency: raw.currency,
      eventId:  raw.eventId,
      sort,
      page,
      limit,
    }),
    predictionRepository.browseTabCounts({
      game:     raw.game,
      currency: raw.currency,
      eventId:  raw.eventId,
    }),
  ]);

  // ── User position overlay (Sprint 4.5) ───────────────────────────────────
  // One additional query bounded to the current page's market IDs.
  // Only ACTIVE positions make userHasPosition true — settled/cancelled don't.
  // Skipped entirely when no userId is provided or when the page is empty.
  let activeMarketIds = new Set<number>();
  if (raw.userId && cards.length > 0) {
    const marketIds = cards.map(c => c.marketId);
    activeMarketIds = await predictionRepository.findActiveMarketIdsForUser(raw.userId, marketIds);
  }

  const markets: BrowseMarketCard[] = cards.map(card => ({
    ...card,
    userHasPosition: activeMarketIds.has(card.marketId),
  }));

  return {
    page,
    limit,
    total,
    tab: effectiveTab,
    counts,
    appliedFilters: {
      statuses: resolvedStatuses,
      game:     raw.game     ?? null,
      currency: raw.currency ?? null,
      eventId:  raw.eventId  ?? null,
      sort,
    },
    markets,
  };
}

// ── Enriched position mappers ─────────────────────────────────────────────────

function mapToPositionCard(row: EnrichedPosition): UserPositionCard {
  return {
    positionId:    row.id,
    marketId:      row.marketId,
    marketTitle:   row.marketQuestion,
    marketSlug:    row.marketSlug,
    marketStatus:  row.marketStatus,
    marketType:    row.marketType,
    currency:      row.currency,
    marketCloseAt: row.marketCloseAt,
    event: row.eventId != null ? {
      eventId:        row.eventId,
      game:           row.eventGame ?? "",
      tournamentName: row.eventTournamentName,
      eventName:      row.eventEventName,
      teamAName:      row.eventTeamAName,
      teamBName:      row.eventTeamBName,
      startsAt:       row.eventStartsAt,
    } : null,
    outcome: {
      outcomeId: row.outcomeId,
      code:      row.outcomeCode,
      label:     row.outcomeLabel ?? "",
    },
    quantity:  row.quantity,
    avgPrice:  row.avgPrice,
    costBasis: row.costBasis,
    stake:     row.stake,
    status:    row.status,
    createdAt: row.createdAt,
  };
}

function mapToHistoryCard(row: EnrichedPosition): UserHistoryCard {
  return {
    ...mapToPositionCard(row),
    payout:          row.payout,
    realizedPnl:     row.realizedPnl,
    payoutAt:        row.payoutAt,
    marketSettledAt: row.marketSettledAt,
  };
}

// ── Sprint 4 Market Detail Read Model ────────────────────────────────────────
// GET /api/predictions/markets/:idOrSlug/detail
// Composes 7 sections in parallel from existing repository helpers.
// No new DB schemas. No new pricing logic. All data from existing tables.
// ─────────────────────────────────────────────────────────────────────────────

const SNAPSHOT_LIMIT = 50;  // max snapshot rows (covers ~25 ticks per outcome for binary)
const EVENT_LIMIT    = 10;  // max lifecycle event rows in the timeline strip

// ── In-memory read cache (Sprint 4.5) ─────────────────────────────────────────
// Best-effort: cache miss or error always falls back to a live DB read.
// Per-process only — reset on restart, no distributed invalidation.
const CACHE_DETAIL_TTL_MS = 30_000; // 30 s — short TTL; detail page is moderately volatile
const CACHE_HOME_TTL_MS   = 60_000; // 60 s — home data changes less frequently
const detailCacheKey = (k: number | string): string => `prediction:market-detail:${k}`;
const CACHE_HOME_KEY = "prediction:home";

async function getMarketDetail(
  idOrSlug: number | string
): Promise<import("./types").MarketDetailResponse | null> {
  // ── Cache check ──────────────────────────────────────────────────────────────
  // Key uses the raw idOrSlug passed by the caller (numeric ID or slug string).
  // If the same market is accessed by both ID and slug, two independent cache
  // entries are stored — content is identical, duplication is harmless at this TTL.
  try {
    const cached = getCached<import("./types").MarketDetailResponse | null>(detailCacheKey(idOrSlug));
    if (cached !== null) {
      console.debug(`[Prediction:cache] HIT ${detailCacheKey(idOrSlug)}`);
      return cached;
    }
  } catch (cacheErr) {
    console.warn("[Prediction:cache] getCached error (detail) — proceeding with live read", cacheErr);
  }

  // Step 1: resolve market (market + outcomes + event + stats)
  const market = await predictionRepository.findMarketWithOutcomes(idOrSlug);
  if (!market) return null;

  // Steps 2–4: run remaining queries in parallel (no inter-dependency)
  const [snapshots, recentEvents, countRows] = await Promise.all([
    predictionRepository.getMarketSnapshots(market.id, SNAPSHOT_LIMIT),
    predictionRepository.getRecentMarketEvents(market.id, EVENT_LIMIT),
    predictionRepository.countPositionsByStatus(market.id),
  ]);

  // countPositionsByStatus returns { status: string; count: number }[] — reduce to map
  // (mirrors getAdminSummary). Missing status buckets default to 0.
  const positionCounts = { active: 0, settled: 0, cancelled: 0, total: 0 };
  for (const row of countRows) {
    positionCounts.total += row.count;
    if (row.status === "active")    positionCounts.active    += row.count;
    if (row.status === "settled")   positionCounts.settled   += row.count;
    if (row.status === "cancelled") positionCounts.cancelled += row.count;
  }

  // userCanTrade: status=open AND (closeAt is unset OR closeAt is in the future)
  const isOpen     = market.status === "open";
  const notExpired = !market.closeAt || new Date(market.closeAt) > new Date();
  const userCanTrade = isOpen && notExpired;

  const outcomes: import("./types").DetailOutcomeCard[] = market.outcomes.map((o) => ({
    outcomeId:          o.id,
    code:               o.code,
    label:              o.label,
    description:        o.description ?? null,
    isWinner:           o.isWinner ?? false,
    poolShare:          o.poolShare,
    impliedProbability: o.impliedProbability ?? null,
    payoutValue:        o.payoutValue ?? null,
    sortOrder:          o.sortOrder,
  }));

  const stats = market.stats
    ? {
        volume24h:    market.stats.volume24h,
        traders24h:   market.stats.traders24h,
        lastPriceYes: market.stats.lastPriceYes ?? null,
        lastPriceNo:  market.stats.lastPriceNo ?? null,
        updatedAt:    market.stats.updatedAt ?? null,
      }
    : null;

  const event = market.event
    ? {
        eventId:        market.event.id,
        game:           market.event.game,
        tournamentName: market.event.tournamentName ?? null,
        eventName:      market.event.eventName ?? null,
        teamAName:      market.event.teamAName ?? null,
        teamBName:      market.event.teamBName ?? null,
        startsAt:       market.event.startsAt ?? null,
        eventStatus:    market.event.status,
      }
    : null;

  const result: import("./types").MarketDetailResponse = {
    // 1. Identity
    marketId:          market.id,
    uid:               market.uid,
    slug:              market.slug ?? null,
    question:          market.question,
    description:       market.description ?? null,
    status:            market.status,
    marketType:        market.marketType,
    currency:          market.currency,
    openAt:            market.openAt ?? null,
    closeAt:           market.closeAt ?? null,
    resolveAt:         market.resolveAt ?? null,
    settledAt:         market.settledAt ?? null,
    resolvedOutcomeId: market.resolvedOutcomeId ?? null,
    createdAt:         market.createdAt,
    // 2. Event
    event,
    // 3. Outcomes
    outcomes,
    // 4. Stats
    stats,
    // 5. Snapshots
    recentSnapshots: snapshots,
    snapshotLimit:   SNAPSHOT_LIMIT,
    // 6. Lifecycle events
    recentEvents: recentEvents,
    eventLimit:   EVENT_LIMIT,
    // 7. Operational summary
    positionCounts: {
      active:    positionCounts.active,
      settled:   positionCounts.settled,
      cancelled: positionCounts.cancelled,
      total:     positionCounts.total,
    },
    availableActions: availableActions(market.status),
    userCanTrade,
  };

  // ── Cache write ─────────────────────────────────────────────────────────────
  try {
    setCached(detailCacheKey(idOrSlug), result, CACHE_DETAIL_TTL_MS);
    console.debug(`[Prediction:cache] MISS+SET ${detailCacheKey(idOrSlug)} (TTL ${CACHE_DETAIL_TTL_MS / 1000}s)`);
  } catch (cacheErr) {
    console.warn("[Prediction:cache] setCached error (detail) — ignoring", cacheErr);
  }
  return result;
}

// ── Sprint 4 Home Discovery ───────────────────────────────────────────────────
// GET /api/predictions/home aggregation.
// Three parallel sections: liveMatches, trendingPredictions, upcomingEvents.
// All data comes from existing tables — no new analytics pipeline.
// hotPlayers is always null (owned by the player domain, not prediction).
// ─────────────────────────────────────────────────────────────────────────────

/** Map a PredictionMarketWithOutcomes → a compact LiveMatchCard */
function toHomeOutcomeStubs(outcomes: import("./types").PredictionOutcome[]) {
  return outcomes.map((o) => ({
    outcomeId: o.id,
    code:      o.code,
    label:     o.label,
    poolShare: o.poolShare,
  }));
}

function toHomeStatsContext(
  stats: import("./types").PredictionMarketStats | null
): import("./types").HomeStatsContext | null {
  if (!stats) return null;
  return {
    volume24h:    stats.volume24h,
    traders24h:   stats.traders24h,
    lastPriceYes: stats.lastPriceYes ?? null,
    lastPriceNo:  stats.lastPriceNo ?? null,
  };
}

function toHomeEventContext(
  event: import("./types").PredictionEvent | null
): import("./types").HomeEventContext | null {
  if (!event) return null;
  return {
    eventId:        event.id,
    game:           event.game,
    tournamentName: event.tournamentName ?? null,
    eventName:      event.eventName ?? null,
    teamAName:      event.teamAName ?? null,
    teamBName:      event.teamBName ?? null,
    startsAt:       event.startsAt ?? null,
  };
}

/**
 * Convert a PredictionMarketWithOutcomes (with event injected by service layer)
 * into the compact LiveMatchCard shape used by all home surfaces.
 */
function marketWithOutcomesToLiveMatchCard(
  m: PredictionMarketWithOutcomes,
): import("./types").LiveMatchCard {
  return {
    marketId: m.id,       uid:      m.uid,        slug:     m.slug ?? null,
    question: m.question, status:   "open" as const, currency: m.currency,
    openAt:   m.openAt ?? null, closeAt: m.closeAt ?? null,
    outcomes: toHomeOutcomeStubs(m.outcomes),
    stats:    toHomeStatsContext(m.stats),
    event:    toHomeEventContext(m.event),
  };
}

/**
 * Derive a cheap trending signal from market state + volume.
 * No time-series computation — just a label for UI badging.
 */
function deriveTrendingLabel(market: PredictionMarketWithOutcomes): string {
  const vol = parseFloat(String(market.stats?.volume24h ?? "0")) || 0;
  if (vol > 5)                    return "high_volume";
  if (market.status === "settled") return "recently_settled";
  if (market.status === "locked")  return "action_locked";
  return "active";
}

// ── Home v2 — Queue-driven surface helpers ─────────────────────────────────────

/**
 * Resolve media URLs for a single event from the batch media map.
 * Fallback chains:
 *   heroImageUrl  → hero → banner → card → thumbnail
 *   cardImageUrl  → card → thumbnail
 *   thumbnailUrl  → thumbnail
 */
function pickMedia(
  mediaMap: Map<number, Record<string, string>>,
  eventId:  number,
): import("./types").EventMediaUrls {
  const m = mediaMap.get(eventId) ?? {};
  return {
    heroImageUrl: m["hero"] ?? m["banner"] ?? m["card"] ?? m["thumbnail"] ?? null,
    cardImageUrl: m["card"] ?? m["thumbnail"] ?? null,
    thumbnailUrl: m["thumbnail"] ?? null,
  };
}

/**
 * Convert one prediction_display_queue item into an EditorialEventCard,
 * resolving the linked event from eventMap, attaching media from mediaMap,
 * enriching market metadata from metaMap, and resolving the first tradeable
 * market from tradeableMarketsMap.
 */
function queueItemToEditorialCard(
  item:                import("@shared/schema").PredictionDisplayQueueItem,
  eventMap:            Map<number, import("@shared/schema").PredictionEvent>,
  mediaMap:            Map<number, Record<string, string>>,
  metaMap:             Map<number, { linkedMarketsCount: number; firstMarketSlug: string | null }>,
  tradeableMarketsMap: Map<number, import("./types").LiveMatchCard>,
): import("./types").EditorialEventCard {
  const raw  = item.entityType === "event" ? (eventMap.get(item.entityId) ?? null) : null;
  const meta = raw ? (metaMap.get(raw.id) ?? null) : null;

  const event: import("./types").UpcomingEventCard | null = raw
    ? {
        eventId:            raw.id,
        uid:                raw.uid,
        title:              raw.title,
        game:               raw.game,
        region:             raw.region        ?? null,
        tournamentName:     raw.tournamentName ?? null,
        eventName:          raw.eventName     ?? null,
        teamAName:          raw.teamAName     ?? null,
        teamBName:          raw.teamBName     ?? null,
        startsAt:           raw.startsAt      ?? null,
        linkedMarketsCount: meta?.linkedMarketsCount ?? 0,
        firstMarketSlug:    meta?.firstMarketSlug    ?? null,
      }
    : null;

  const market = raw ? (tradeableMarketsMap.get(raw.id) ?? null) : null;

  return {
    queueId:       item.id,
    surface:       item.surface,
    position:      item.position,
    curationLabel: item.curationLabel ?? null,
    entityType:    item.entityType,
    entityId:      item.entityId,
    event,
    media:         pickMedia(mediaMap, item.entityId),
    market,
  };
}

/**
 * Compose the four queue-driven surfaces from the raw queue items, resolved
 * event entities, and media map. Fallback logic applied per surface.
 */
function buildPublicSurfaces(
  queueItems:          import("@shared/schema").PredictionDisplayQueueItem[],
  eventMap:            Map<number, import("@shared/schema").PredictionEvent>,
  mediaMap:            Map<number, Record<string, string>>,
  liveMatches:         import("./types").LiveMatchCard[],
  upcomingEvents:      import("./types").UpcomingEventCard[],
  metaMap:             Map<number, { linkedMarketsCount: number; firstMarketSlug: string | null }>,
  tradeableMarketsMap: Map<number, import("./types").LiveMatchCard>,
): import("./types").HomePublicSurfaces {
  // ── Eligibility filter (read-path only — no DB mutations) ─────────────────
  // Drop queue items whose event is finished or cancelled so they no longer
  // appear on active surfaces. Items remain in the DB for audit purposes.
  const INELIGIBLE_EVENT_STATUSES = new Set(["finished", "cancelled"]);
  const eligibleQueueItems = queueItems.filter((item) => {
    if (item.entityType !== "event") return true;
    const ev = eventMap.get(item.entityId);
    if (!ev) return false; // event not found — exclude defensively
    return !INELIGIBLE_EVENT_STATUSES.has(ev.status);
  });

  // Group queue items by surface and sort by position within each group.
  const bySurface = new Map<string, import("@shared/schema").PredictionDisplayQueueItem[]>();
  for (const item of eligibleQueueItems) {
    const arr = bySurface.get(item.surface) ?? [];
    arr.push(item);
    bySurface.set(item.surface, arr);
  }
  const sorted = (surface: string) =>
    (bySurface.get(surface) ?? []).sort((a, b) => a.position - b.position);

  // ── hero ────────────────────────────────────────────────────────────────────
  // Priority: hero surface → featured surface (first item) → first upcoming event.
  const heroItems     = sorted("hero");
  const featuredItems = sorted("featured");
  let hero: import("./types").EditorialEventCard | null = null;
  if (heroItems.length > 0) {
    hero = queueItemToEditorialCard(heroItems[0], eventMap, mediaMap, metaMap, tradeableMarketsMap);
  } else if (featuredItems.length > 0) {
    hero = queueItemToEditorialCard(featuredItems[0], eventMap, mediaMap, metaMap, tradeableMarketsMap);
  } else if (upcomingEvents.length > 0) {
    const ev = upcomingEvents[0];
    hero = {
      queueId:       0,
      surface:       "upcoming_fallback",
      position:      0,
      curationLabel: null,
      entityType:    "event",
      entityId:      ev.eventId,
      event:         ev,
      media:         pickMedia(mediaMap, ev.eventId),
      market:        tradeableMarketsMap.get(ev.eventId) ?? null,
    };
  }

  // ── featuredEvents ──────────────────────────────────────────────────────────
  // All items from the featured surface, in position order.
  // No fallback — an empty featured queue returns an empty array.
  const featuredEvents = featuredItems.map(
    (item) => queueItemToEditorialCard(item, eventMap, mediaMap, metaMap, tradeableMarketsMap),
  );

  // ── livePredictions ─────────────────────────────────────────────────────────
  // Open markets whose event is curated in the predictions surface come first;
  // the rest of the live matches fill the remaining slots.
  const predQueueEventIds = new Set<number>(
    sorted("predictions")
      .filter((i) => i.entityType === "event")
      .map((i) => i.entityId),
  );
  const prioritised: import("./types").LiveMatchCard[] = [];
  const rest:        import("./types").LiveMatchCard[] = [];
  for (const card of liveMatches) {
    const eid = card.event?.eventId;
    if (eid != null && predQueueEventIds.has(eid)) {
      prioritised.push(card);
    } else {
      rest.push(card);
    }
  }
  const livePredictions = [...prioritised, ...rest];

  // ── upcomingEventsEditorial ─────────────────────────────────────────────────
  // Queue upcoming surface when available; fallback to existing scheduled events.
  const upcomingQueueItems = sorted("upcoming");
  let upcomingEventsEditorial: import("./types").EditorialEventCard[];
  if (upcomingQueueItems.length > 0) {
    upcomingEventsEditorial = upcomingQueueItems.map(
      (item) => queueItemToEditorialCard(item, eventMap, mediaMap, metaMap, tradeableMarketsMap),
    );
  } else {
    upcomingEventsEditorial = upcomingEvents.map((ev) => ({
      queueId:       0,
      surface:       "scheduled_fallback",
      position:      0,
      curationLabel: null,
      entityType:    "event",
      entityId:      ev.eventId,
      event:         ev,
      media:         pickMedia(mediaMap, ev.eventId),
      market:        tradeableMarketsMap.get(ev.eventId) ?? null,
    }));
  }

  return { hero, heroMarket: null, featuredEvents, livePredictions, upcomingEventsEditorial };
}

async function getHome(): Promise<import("./types").PredictionHomeResponse> {
  // ── Cache check ──────────────────────────────────────────────────────────────
  // generatedAt in the cached payload records the original computation time;
  // serving it unchanged gives the client a free staleness indicator.
  try {
    const cached = getCached<import("./types").PredictionHomeResponse>(CACHE_HOME_KEY);
    if (cached) {
      console.debug("[Prediction:cache] HIT prediction:home");
      return cached;
    }
  } catch (cacheErr) {
    console.warn("[Prediction:cache] getCached error (home) — proceeding with live read", cacheErr);
  }

  // ── Parallel fetch: existing home data + queue surfaces ───────────────────
  const [homeData, queueItems] = await Promise.all([
    predictionRepository.getHomeData({ liveLimit: 8, trendingLimit: 8, upcomingLimit: 8 }),
    predictionRepository.getQueuedSurfaces(["hero", "featured", "predictions", "upcoming"]),
  ]);
  const { liveMarkets, trendingMarkets, upcomingEvents } = homeData;

  // ── Resolve queue event entities + media (parallel) ───────────────────────
  // No Set spread (TS target compat) — small arrays (≤8), duplicates harmless.
  const queueEventIds = queueItems
    .filter((i) => i.entityType === "event")
    .map((i) => i.entityId);
  // Resolve media for queue events AND upcoming events (for fallback editorial cards).
  const upcomingEventIds = upcomingEvents.map((e) => e.eventId);
  const allMediaEventIds = queueEventIds.concat(upcomingEventIds);

  const [queueEventsRaw, mediaMap] = await Promise.all([
    predictionRepository.findEventsByIds(queueEventIds),
    allMediaEventIds.length > 0
      ? predictionRepository.resolveEventMediaBatch(allMediaEventIds)
      : Promise.resolve(new Map<number, Record<string, string>>()),
  ]);
  const eventMap = new Map(queueEventsRaw.map((e) => [e.id, e]));

  // ── Batch-fetch editorial enrichment (meta + first tradeable market) ───────
  // Include upcoming event IDs so fallback/synthetic cards also get a market.
  const editorialEventIdSet = new Set<number>(queueEventIds);
  for (const ev of upcomingEvents) editorialEventIdSet.add(ev.eventId);
  const editorialEventIds = Array.from(editorialEventIdSet);
  const [metaMap, rawTradeableByEvent] = await Promise.all([
    editorialEventIds.length > 0
      ? predictionRepository.findEventMarketMetaByIds(editorialEventIds)
      : Promise.resolve(new Map<number, { linkedMarketsCount: number; firstMarketSlug: string | null }>()),
    editorialEventIds.length > 0
      ? predictionRepository.findTradeableMarketsByEventIds(editorialEventIds)
      : Promise.resolve(new Map<number, PredictionMarketWithOutcomes>()),
  ]);

  // Inject event entity into each raw market so toHomeEventContext works properly
  const tradeableMarketsMap = new Map<number, import("./types").LiveMatchCard>();
  Array.from(rawTradeableByEvent.entries()).forEach(([eventId, mRaw]) => {
    const eventEntity = eventMap.get(eventId) ?? null;
    const enriched: PredictionMarketWithOutcomes = { ...mRaw, event: eventEntity as any };
    tradeableMarketsMap.set(eventId, marketWithOutcomesToLiveMatchCard(enriched));
  });

  // ── Map existing home sections (unchanged shape) ───────────────────────────
  const liveMatches: import("./types").LiveMatchCard[] = liveMarkets.map((m) => ({
    marketId:  m.id,
    uid:       m.uid,
    slug:      m.slug ?? null,
    question:  m.question,
    status:    "open" as const,
    currency:  m.currency,
    openAt:    m.openAt ?? null,
    closeAt:   m.closeAt ?? null,
    outcomes:  toHomeOutcomeStubs(m.outcomes),
    stats:     toHomeStatsContext(m.stats),
    event:     toHomeEventContext(m.event),
  }));

  const trendingPredictions: import("./types").TrendingCard[] = trendingMarkets.map((m) => ({
    marketId:      m.id,
    uid:           m.uid,
    slug:          m.slug ?? null,
    question:      m.question,
    status:        m.status,
    currency:      m.currency,
    openAt:        m.openAt ?? null,
    closeAt:       m.closeAt ?? null,
    outcomes:      toHomeOutcomeStubs(m.outcomes),
    stats:         toHomeStatsContext(m.stats),
    event:         toHomeEventContext(m.event),
    trendingLabel: deriveTrendingLabel(m),
  }));

  // ── Build queue-driven editorial surfaces ─────────────────────────────────
  const publicSurfaces = buildPublicSurfaces(
    queueItems,
    eventMap,
    mediaMap,
    liveMatches,
    upcomingEvents,
    metaMap,
    tradeableMarketsMap,
  );

  // ── Resolve heroMarket ──────────────────────────────────────────────────────
  // Find the first tradeable (open/locked) market for the editorial hero event.
  //
  // Resolution priority:
  //  -1. hero.market      — batch-resolved by buildPublicSurfaces via tradeableMarketsMap (zero DB round-trip)
  //   0. firstMarketSlug  — direct slug lookup; strongest link between event and market
  //   1. liveMatches      — already in memory, zero extra round-trip
  //   2. trendingPredictions — also already in memory
  //   3. listMarkets({ eventId, statuses: ["open","locked"], limit: 1 }) — final DB fallback
  //
  // Only statuses "open" and "locked" are considered tradeable; draft/resolved/settled → null.
  const TRADEABLE = new Set(["open", "locked"]);

  const heroEventId   = publicSurfaces.hero?.event?.eventId        ?? null;
  const heroFirstSlug = publicSurfaces.hero?.event?.firstMarketSlug ?? null;

  // Step -1: already resolved by batch enrichment
  let resolved: import("./types").LiveMatchCard | null = publicSurfaces.hero?.market ?? null;

  // Step 0 — resolve by firstMarketSlug (most direct link)
  if (!resolved && heroFirstSlug) {
    const bySlug = await predictionRepository.findMarketWithOutcomes(heroFirstSlug);
    if (bySlug && TRADEABLE.has(bySlug.status)) {
      resolved = marketWithOutcomesToLiveMatchCard(bySlug);
    }
  }

  // Steps 1–3 — fallback chain keyed by eventId
  if (!resolved && heroEventId != null) {
    // 1. liveMatches
    resolved = liveMatches.find((m) => m.event?.eventId === heroEventId) ?? null;

    // 2. trendingPredictions
    if (!resolved) {
      const tm = trendingPredictions.find((m) => m.event?.eventId === heroEventId);
      if (tm) {
        resolved = {
          marketId: tm.marketId, uid: tm.uid, slug: tm.slug, question: tm.question,
          status:   "open" as const, currency: tm.currency,
          openAt:   tm.openAt, closeAt: tm.closeAt,
          outcomes: tm.outcomes, stats: tm.stats, event: tm.event,
        };
      }
    }

    // 3. DB query — market exists but fell outside the top-N home lists
    if (!resolved) {
      const { markets: fb } = await predictionRepository.listMarkets({
        statuses: ["open", "locked"],
        eventId:  heroEventId,
        limit:    1,
      });
      if (fb.length > 0) resolved = marketWithOutcomesToLiveMatchCard(fb[0]);
    }
  }

  publicSurfaces.heroMarket = resolved;

  const result: import("./types").PredictionHomeResponse = {
    liveMatches,
    trendingPredictions,
    upcomingEvents,
    hotPlayers:  null,
    generatedAt: new Date().toISOString(),
    totalLive:   liveMatches.length,
    publicSurfaces,
  };

  // ── Cache write ─────────────────────────────────────────────────────────────
  try {
    setCached(CACHE_HOME_KEY, result, CACHE_HOME_TTL_MS);
    console.debug(`[Prediction:cache] MISS+SET prediction:home (TTL ${CACHE_HOME_TTL_MS / 1000}s)`);
  } catch (cacheErr) {
    console.warn("[Prediction:cache] setCached error (home) — ignoring", cacheErr);
  }
  return result;
}

// Active positions for the current user (status=active).
async function getMyPositions(userId: string): Promise<UserPositionCard[]> {
  const rows = await predictionRepository.findEnrichedPositionsByUser(userId, ["active"]);
  return rows.map(mapToPositionCard);
}

// Position history for the current user (status=settled OR cancelled).
async function getMyHistory(userId: string): Promise<UserHistoryCard[]> {
  const rows = await predictionRepository.findEnrichedPositionsByUser(userId, ["settled", "cancelled"]);
  return rows.map(mapToHistoryCard);
}

// ── Sprint 4 Portfolio Composition ────────────────────────────────────────────
// GET /api/predictions/me/portfolio
//
// Read-model: composes existing enriched position + history data into a
// UI-ready portfolio response. No new DB tables. No wallet/ledger coupling.
// No mark-to-market engine. All arithmetic is simple sum/count over numeric
// string fields.
//
// Two queries in parallel:
//   1. findEnrichedPositionsByUser(userId, ["active"])      → active rows
//   2. findEnrichedPositionsByUser(userId, ["settled","cancelled"]) → history
//
// History is capped at PORTFOLIO_HISTORY_LIMIT (20 rows, already sorted
// createdAt DESC by the repository).
// ─────────────────────────────────────────────────────────────────────────────

const PORTFOLIO_HISTORY_LIMIT = 20;

/** Safe numeric sum over an array of nullable decimal strings. Returns "0.00" on empty. */
function sumDecimalStrings(values: (string | null)[]): string {
  const total = values.reduce((acc, v) => acc + (v != null ? parseFloat(v) : 0), 0);
  return total.toFixed(2);
}

// Resolve mark-to-market price for a single held outcome using sortOrder.
// Mapping: sortOrder === 0 → lastPriceYes (first slot), else → lastPriceNo (second slot).
// This is side-agnostic: works for YES/NO, Team A/Team B, or any binary outcome pair.
// Returns null when: stats row absent or price slot null.
function resolveCurrentPrice(
  sortOrder: number | null | undefined,
  stats:     import("@shared/schema/prediction").PredictionMarketStats | undefined
): string | null {
  if (!stats) return null;
  const isFirstSlot = (sortOrder ?? 1) === 0;
  return (isFirstSlot ? stats.lastPriceYes : stats.lastPriceNo) ?? null;
}

// Compute marketValue and unrealizedPnl from raw string fields.
// All arithmetic on parseFloat; output rounded to 2 dp.
// Returns null for both if currentPrice or quantity or costBasis is null.
function computeMarkToMarket(
  quantity:     string | null,
  costBasis:    string | null,
  currentPrice: string | null
): { marketValue: string | null; unrealizedPnl: string | null } {
  if (currentPrice == null || quantity == null || costBasis == null) {
    return { marketValue: null, unrealizedPnl: null };
  }
  const mv  = parseFloat(quantity) * parseFloat(currentPrice);
  const upnl = mv - parseFloat(costBasis);
  return {
    marketValue:   mv.toFixed(2),
    unrealizedPnl: upnl.toFixed(2),
  };
}

async function getMyPortfolio(userId: string): Promise<PredictionPortfolioResponse> {
  // Parallel fetch: active positions + full settled/cancelled history
  const [activeRows, historyRows] = await Promise.all([
    predictionRepository.findEnrichedPositionsByUser(userId, ["active"]),
    predictionRepository.findEnrichedPositionsByUser(userId, ["settled", "cancelled"]),
  ]);

  const settledRows   = historyRows.filter(r => r.status === "settled");
  const cancelledRows = historyRows.filter(r => r.status === "cancelled");

  // ── Market stats batch (Sprint 4.5) ───────────────────────────────────────
  // Fetch in parallel with history (both are independent of each other).
  // One IN-list query for all distinct active market IDs — no N+1.
  const activeMarketIdArray = [...new Set(activeRows.map(r => r.marketId))];
  const statsMap = activeMarketIdArray.length > 0
    ? await predictionRepository.getMarketStatsBatch(activeMarketIdArray)
    : new Map<number, import("@shared/schema/prediction").PredictionMarketStats>();

  // ── Active market position groups ──────────────────────────────────────────
  // Reduce active rows into a map keyed by marketId.
  // Market-level fields are stable across rows for the same market (same JOIN).
  const now = Date.now();
  const groupMap = new Map<number, ActiveMarketPositionGroup>();

  for (const row of activeRows) {
    let group = groupMap.get(row.marketId);
    if (!group) {
      const closeAt = row.marketCloseAt;
      const tradable =
        row.marketStatus === "open" &&
        (closeAt == null || new Date(closeAt).getTime() > now);

      group = {
        marketId:    row.marketId,
        marketSlug:  row.marketSlug,
        marketTitle: row.marketQuestion,
        marketStatus: row.marketStatus,
        marketType:  row.marketType,
        currency:    row.currency,
        closeAt,
        userCanTrade: tradable,
        event: row.eventId != null ? {
          eventId:        row.eventId,
          game:           row.eventGame ?? "",
          tournamentName: row.eventTournamentName,
          eventName:      row.eventEventName,
          teamAName:      row.eventTeamAName,
          teamBName:      row.eventTeamBName,
          startsAt:       row.eventStartsAt,
        } : null,
        outcomesHeld:     [],
        totalQuantity:    0,
        totalCostBasis:   "0.00",
        unrealizedPnl:    null,
        totalMarketValue: null,
        hasPartialPricing: false,
        pricedAt:          null,
      };
      groupMap.set(row.marketId, group);
    }

    // Sprint 4.5: compute per-outcome mark-to-market using stats map
    // Price resolved by sortOrder (side-agnostic): slot 0 → lastPriceYes, else → lastPriceNo.
    const stats        = statsMap.get(row.marketId);
    const currentPrice = resolveCurrentPrice(row.outcomeSortOrder, stats);
    const { marketValue, unrealizedPnl } = computeMarkToMarket(
      row.quantity, row.costBasis, currentPrice
    );

    // Sprint 4.5 price freshness: pricedAt mirrors stats.updatedAt when currentPrice
    // is present; null when there is no stats row or the outcome code is unrecognized.
    const pricedAt = currentPrice != null ? (stats?.updatedAt ?? null) : null;

    group.outcomesHeld.push({
      positionId:    row.id,
      outcomeId:     row.outcomeId,
      outcomeCode:   row.outcomeCode,
      outcomeLabel:  row.outcomeLabel ?? "",
      quantity:      row.quantity,
      avgPrice:      row.avgPrice,
      costBasis:     row.costBasis,
      status:        row.status,
      currentPrice,
      marketValue,
      unrealizedPnl,
      pricedAt,
    });

    group.totalQuantity  += row.quantity != null ? parseFloat(row.quantity) : 0;
    group.totalCostBasis  = sumDecimalStrings(group.outcomesHeld.map(o => o.costBasis));
  }

  // ── Per-group mark-to-market aggregation ──────────────────────────────────
  // Aggregate unrealizedPnl and totalMarketValue from priced outcomes only.
  // hasPartialPricing = true when any outcome in the group has currentPrice=null.
  // pricedAt (Sprint 4.5): stats.updatedAt for the market; suppressed when partial.
  for (const group of groupMap.values()) {
    const pricedOutcomes = group.outcomesHeld.filter(o => o.unrealizedPnl != null);
    group.hasPartialPricing = pricedOutcomes.length < group.outcomesHeld.length;

    if (pricedOutcomes.length > 0) {
      group.unrealizedPnl   = sumDecimalStrings(pricedOutcomes.map(o => o.unrealizedPnl));
      group.totalMarketValue = sumDecimalStrings(pricedOutcomes.map(o => o.marketValue));
    }

    // Group-level pricedAt: only set when the group is fully priced.
    // Conservative rule: if any outcome lacks pricing, pricedAt is suppressed to
    // avoid implying a freshness guarantee that doesn't cover all outcomes.
    group.pricedAt = group.hasPartialPricing
      ? null
      : (statsMap.get(group.marketId)?.updatedAt ?? null);
  }

  const activeMarketPositions: ActiveMarketPositionGroup[] = Array.from(groupMap.values());

  // ── Summary ────────────────────────────────────────────────────────────────
  const activeMarketIds = new Set(activeRows.map(r => r.marketId));

  // Summary unrealizedPnl: sum across groups that have pricing (priced subset).
  // hasPartialPricing: true if any group is fully or partially unpriced.
  const pricedGroups = activeMarketPositions.filter(g => g.unrealizedPnl != null);
  const summaryUnrealizedPnl = pricedGroups.length > 0
    ? sumDecimalStrings(pricedGroups.map(g => g.unrealizedPnl))
    : null;
  const summaryHasPartialPricing =
    activeMarketPositions.some(g => g.hasPartialPricing) ||
    pricedGroups.length < activeMarketPositions.length;

  // Sprint 4.5 price freshness: most recent pricedAt across fully-priced groups.
  // Uses the group pricedAt (which is suppressed when hasPartialPricing=true).
  // Result is the freshest stats.updatedAt the client can trust for its display.
  const fullyPricedDates = activeMarketPositions
    .map(g => g.pricedAt)
    .filter((d): d is Date => d != null);
  const summaryLatestPricingAt: Date | null = fullyPricedDates.length > 0
    ? new Date(Math.max(...fullyPricedDates.map(d => d.getTime())))
    : null;

  const summary: PredictionPortfolioSummary = {
    activeMarkets:      activeMarketIds.size,
    activePositions:    activeRows.length,
    settledPositions:   settledRows.length,
    cancelledPositions: cancelledRows.length,
    openExposure:       sumDecimalStrings(activeRows.map(r => r.costBasis)),
    realizedPnl:        sumDecimalStrings(settledRows.map(r => r.realizedPnl)),
    totalPayout:        sumDecimalStrings(settledRows.map(r => r.payout)),
    totalRefunded:      sumDecimalStrings(cancelledRows.map(r => r.costBasis)),
    currency:           "GS",
    unrealizedPnl:      summaryUnrealizedPnl,
    hasPartialPricing:  summaryHasPartialPricing,
    latestPricingAt:    summaryLatestPricingAt,
  };

  // ── Recent history (capped at PORTFOLIO_HISTORY_LIMIT) ────────────────────
  const slicedHistory = historyRows.slice(0, PORTFOLIO_HISTORY_LIMIT);
  const hasMoreHistory = historyRows.length > PORTFOLIO_HISTORY_LIMIT;

  const recentHistory: RecentPredictionHistoryItem[] = slicedHistory.map(row => ({
    positionId:   row.id,
    marketId:     row.marketId,
    marketTitle:  row.marketQuestion,
    marketSlug:   row.marketSlug,
    outcomeId:    row.outcomeId,
    outcomeCode:  row.outcomeCode,
    outcomeLabel: row.outcomeLabel ?? "",
    status:       row.status,
    payout:       row.payout,
    realizedPnl:  row.realizedPnl,
    payoutAt:     row.payoutAt,
    // Sprint 4.5: prefer explicit cancelled_at; fall back to updatedAt for legacy rows
    // where cancelled_at is null (positions cancelled before this column was added).
    cancelledAt:  row.status === "cancelled"
      ? (row.cancelledAt ?? row.updatedAt)
      : null,
  }));

  // ── Meta ──────────────────────────────────────────────────────────────────
  const isEmpty = activeRows.length === 0 && historyRows.length === 0;

  return {
    summary,
    activeMarketPositions,
    recentHistory,
    meta: {
      generatedAt:    new Date().toISOString(),
      historyLimit:   PORTFOLIO_HISTORY_LIMIT,
      hasMoreHistory,
      isEmpty,
    },
  };
}

export const predictionService = {
  // events
  createEvent,
  listEvents,
  getEvent,
  updateEventStatus,
  // markets
  createMarket,
  getMarket,
  listMarkets,
  transitionMarketStatus,
  // settlement (Sprint 2)
  resolveAndSettleMarket,
  // cancellation (Sprint 3)
  cancelAndRefundMarket,
  // market lifecycle audit events (Sprint 3)
  listMarketEvents,
  // read APIs — product-facing views (Sprint 3)
  getLiveMarkets,
  getUpcomingMarkets,
  getResolvedMarkets,
  getMyPositions,
  getMyHistory,
  getMyPortfolio,
  // admin surface (Sprint 3)
  availableActions,
  getAdminSummary,
  // home discovery (Sprint 4)
  getHome,
  // market detail (Sprint 4)
  getMarketDetail,
  // browse endpoint (Sprint 4)
  getMarketsBrowse,
  // orders (Sprint 2)
  placeOrder,
  // legacy bet stub (delegates to placeOrder)
  placeBet,
  // Phase 2 trade engine
  executeMarketTrade,
};

// ── Phase 2: executeMarketTrade ────────────────────────────────────────────────
//
// BUY-only MARKET order driven by amountUsd.
// Differences from placeOrder:
//   - Client sends amountUsd; server derives shares = amountUsd / executedPrice.
//   - Price is resolved server-side from outcome.impliedProbability → market stats.
//   - Buying power is validated directly from wallet.available_balance.
//   - All DB operations reuse existing repository + walletService primitives.
//   - placeOrder is NOT called; this is an independent path.
//
// Settlement continues to use the existing resolveAndSettleMarket flow — positions
// created here are fully compatible because they share the same table/columns.

/**
 * Resolve the current tradable price for an outcome.
 *
 * Resolution order:
 *   1. outcome.impliedProbability — set by pricing engine / admin
 *   2. market stats lastPriceYes / lastPriceNo — last executed fill
 *   3. null — trade is rejected (no price available)
 *
 * sortOrder=0 → YES slot; sortOrder>0 → NO slot.
 */
function resolveOutcomePrice(
  outcome: { impliedProbability: string | null; sortOrder: number },
  stats:   { lastPriceYes: string | null; lastPriceNo: string | null } | null
): string | null {
  // 1. Explicit probability on the outcome row
  if (outcome.impliedProbability != null) {
    const p = parseFloat(outcome.impliedProbability);
    if (isFinite(p) && p > 0 && p < 1) return toDecimal(p);
  }

  // 2. Last executed price from market stats
  if (stats) {
    const isYes   = outcome.sortOrder === 0;
    const raw     = isYes ? stats.lastPriceYes : stats.lastPriceNo;
    if (raw != null) {
      const p = parseFloat(raw);
      if (isFinite(p) && p > 0 && p < 1) return toDecimal(p);
    }
  }

  return null;
}

async function executeMarketTrade(
  input: ExecuteTradeInput
): Promise<PredictionServiceResult<ExecuteTradeResult>> {
  const { userId, marketId, sideId, action, orderType, amountUsd, idempotencyKey } = input;

  // ── Validate action / orderType ───────────────────────────────────────────
  if (action !== "BUY" && action !== "SELL") {
    return { success: false, error: "action must be \"BUY\" or \"SELL\"." };
  }
  if (orderType !== "MARKET") {
    return { success: false, error: "Only MARKET order type is supported in this phase." };
  }
  if (!isFinite(amountUsd) || amountUsd <= 0) {
    return { success: false, error: "amountUsd must be a positive number." };
  }

  // ── 1. Idempotency check ──────────────────────────────────────────────────
  const existingOrder = await predictionRepository.findOrderByIdempotencyKey(idempotencyKey);
  if (existingOrder) {
    console.log(
      `[Trade:executeMarketTrade] Idempotent replay: orderId=${existingOrder.id} key=${idempotencyKey}`
    );
    const existingPosition = await predictionRepository.findPositionByUserMarketOutcome(
      userId, existingOrder.marketId, existingOrder.outcomeId
    );
    const walletSummary = await walletService.getWalletSummary(userId);
    const gsWallet      = walletSummary.wallets.find(w => w.currency === "GS");
    const replayAction  = existingOrder.side === "sell" ? "SELL" : "BUY";

    const positionSummary: TradePositionSummary = {
      positionId:   existingPosition?.id ?? 0,
      outcomeId:    existingOrder.outcomeId,
      outcomeCode:  null,
      outcomeLabel: "",
      sharesHeld:   existingPosition?.quantity   ?? existingOrder.quantity   ?? "0",
      avgPrice:     existingPosition?.avgPrice    ?? existingOrder.price      ?? "0",
      costBasis:    existingPosition?.costBasis   ?? existingOrder.totalValue ?? "0",
    };

    return {
      success: true,
      data: {
        orderId:       existingOrder.id,
        positionId:    existingPosition?.id ?? 0,
        marketId:      existingOrder.marketId,
        sideId,
        action:        replayAction,
        orderType:     "MARKET",
        amountUsd:     toDecimal(amountUsd),
        executedPrice: existingOrder.price    ?? "0",
        shares:        existingOrder.quantity ?? "0",
        status:        existingOrder.status,
        idempotencyKey,
        duplicate:     true,
        realizedPnl:   replayAction === "SELL" ? (existingPosition?.realizedPnl ?? null) : null,
        position:      positionSummary,
        wallet: {
          currency:         "GS",
          availableBalance: gsWallet?.availableBalance ?? "0",
        },
      },
    };
  }

  // ── 2. Validate market ────────────────────────────────────────────────────
  const market = await predictionRepository.findMarketWithOutcomes(marketId);
  if (!market) {
    return { success: false, error: "Prediction market not found." };
  }
  if (market.status !== "open") {
    return {
      success: false,
      error: `Market is not open for trading. Current status: ${market.status}.`,
    };
  }
  if (market.closeAt && new Date() >= new Date(market.closeAt)) {
    return { success: false, error: "Market has expired — trading period is closed." };
  }

  // ── 3. Validate side (outcome) ────────────────────────────────────────────
  const outcome = market.outcomes.find(o => o.id === sideId);
  if (!outcome) {
    return { success: false, error: "Side (outcome) does not belong to this market." };
  }

  // ── 4. Resolve current price server-side ─────────────────────────────────
  const stats = await predictionRepository.getMarketStats(marketId);
  const executedPrice = resolveOutcomePrice(
    { impliedProbability: outcome.impliedProbability ?? null, sortOrder: outcome.sortOrder ?? 1 },
    stats ? { lastPriceYes: stats.lastPriceYes ?? null, lastPriceNo: stats.lastPriceNo ?? null } : null
  );

  if (!executedPrice) {
    return {
      success: false,
      error: "No tradable price is available for this side. Try again after the market is priced.",
    };
  }

  // ── SELL branch ───────────────────────────────────────────────────────────
  if (action === "SELL") {
    return executeMarketSell({
      userId, marketId, sideId, outcome, executedPrice, amountUsd, idempotencyKey,
    });
  }

  // ── 5 (BUY). Derive shares = amountUsd / price ────────────────────────────
  const priceNum  = parseFloat(executedPrice);
  const sharesNum = amountUsd / priceNum;
  const shares     = toDecimal(sharesNum);
  const totalValue = toDecimal(amountUsd); // cost basis = amountUsd (the GS$ to lock)

  // ── 6. Validate buying power from wallet.available_balance ────────────────
  const walletSummary = await walletService.getWalletSummary(userId);
  const gsWallet      = walletSummary.wallets.find(w => w.currency === "GS");
  if (!gsWallet) {
    return { success: false, error: "GS$ wallet not found. Please contact support." };
  }
  if (parseFloat(gsWallet.availableBalance) < amountUsd) {
    return {
      success: false,
      error: `Insufficient GS$ balance. Need ${totalValue} GS$, have ${gsWallet.availableBalance} GS$ available.`,
    };
  }

  // ── 7. Create pending order ───────────────────────────────────────────────
  let order: Awaited<ReturnType<typeof predictionRepository.createOrder>>;
  try {
    order = await predictionRepository.createOrder({
      marketId,
      userId,
      outcomeId:      sideId,
      side:           "buy",
      orderType:      "market",
      quantity:       shares,
      price:          executedPrice,
      totalValue,
      status:         "pending",
      idempotencyKey,
    } as any);
  } catch (err: any) {
    if (err.code === "23505") {
      // Concurrent race on the same idempotency key — return existing
      const raceOrder = await predictionRepository.findOrderByIdempotencyKey(idempotencyKey);
      if (raceOrder) {
        return {
          success: true,
          data: {
            orderId:       raceOrder.id,
            positionId:    0,
            marketId,
            sideId,
            action:        "BUY",
            orderType:     "MARKET",
            amountUsd:     totalValue,
            executedPrice,
            shares,
            status:        raceOrder.status,
            idempotencyKey,
            duplicate:     true,
            realizedPnl:   null,
            position: {
              positionId:  0, outcomeId: sideId, outcomeCode: null,
              outcomeLabel: outcome.label ?? "", sharesHeld: shares,
              avgPrice: executedPrice, costBasis: totalValue,
            },
            wallet: { currency: "GS", availableBalance: gsWallet.availableBalance },
          },
        };
      }
    }
    console.error("[Trade:executeMarketTrade] createOrder failed:", err.message);
    return { success: false, error: "Failed to create trade order. Please try again." };
  }

  const walletLedgerRef = `trade_ord_${order.id}`;

  // ── 8. Lock funds in GS$ wallet ──────────────────────────────────────────
  try {
    await walletService.lockFunds({
      userId,
      currency:      "GS",
      amount:        totalValue,
      entryType:     "lock",
      description:   `Trade BUY lock: ${shares} shares @ ${executedPrice} GS$ — market #${marketId}, side #${sideId}`,
      referenceType: "prediction_order",
      referenceId:   String(order.id),
    });
  } catch (err: any) {
    await predictionRepository.updateOrderStatus(order.id, "failed").catch(() => {});
    console.warn(
      `[Trade:executeMarketTrade] Wallet lock failed for orderId=${order.id}: ${err.message}`
    );
    const isInsufficient = err.message?.includes("Insufficient");
    return {
      success: false,
      error: isInsufficient
        ? `Insufficient GS$ balance. Need ${totalValue} GS$.`
        : "Failed to lock funds. Please try again.",
    };
  }

  // ── 9. Fill order + upsert position ──────────────────────────────────────
  let positionId: number;
  try {
    await predictionRepository.updateOrderStatus(order.id, "filled");

    const existingPos = await predictionRepository.findPositionByUserMarketOutcome(
      userId, marketId, sideId
    );

    if (existingPos) {
      await predictionRepository.updatePositionForOrder(
        existingPos.id, shares, totalValue, walletLedgerRef
      );
      positionId = existingPos.id;
    } else {
      const newPos = await predictionRepository.createPosition({
        userId,
        marketId,
        outcomeId:      sideId,
        quantity:       shares,
        avgPrice:       executedPrice,
        costBasis:      totalValue,
        stake:          totalValue,
        currency:       "GS",
        status:         "active",
        walletLedgerRef,
      } as any);
      positionId = newPos.id;
    }
  } catch (err: any) {
    console.error(
      `[Trade:executeMarketTrade] Post-lock step failed for orderId=${order.id}:`,
      err.message, "Funds remain locked — referenceId:", order.id
    );
    return {
      success: false,
      error: "Trade partially recorded. Contact support if funds appear locked.",
    };
  }

  // ── 10. Non-critical telemetry (fire-and-forget) ──────────────────────────
  const isFirstOutcome = (outcome.sortOrder ?? 1) === 0;
  Promise.all([
    predictionRepository.updateMarketPool(marketId, totalValue),
    predictionRepository.updateOutcomePoolShare(sideId, totalValue),
    predictionRepository.insertPriceSnapshot({ marketId, outcomeId: sideId, price: executedPrice, volumeWindow: totalValue }),
    predictionRepository.recordOrderTelemetry(marketId, isFirstOutcome, executedPrice, totalValue),
  ]).catch(err => {
    console.warn("[Trade:executeMarketTrade] Non-critical telemetry failed:", err.message);
  });

  // ── 11. Fetch fresh wallet balance for response ───────────────────────────
  const freshSummary  = await walletService.getWalletSummary(userId);
  const freshGsWallet = freshSummary.wallets.find(w => w.currency === "GS");

  // ── 12. Build and return response ─────────────────────────────────────────
  const updatedPos = await predictionRepository.findPositionByUserMarketOutcome(userId, marketId, sideId);

  const positionSummary: TradePositionSummary = {
    positionId,
    outcomeId:   sideId,
    outcomeCode: outcome.code ?? null,
    outcomeLabel: outcome.label ?? "",
    sharesHeld:  updatedPos?.quantity ?? shares,
    avgPrice:    updatedPos?.avgPrice ?? executedPrice,
    costBasis:   updatedPos?.costBasis ?? totalValue,
  };

  console.log(
    `[Trade:executeMarketTrade] ✓ orderId=${order.id} positionId=${positionId}` +
    ` userId=${userId} market=${marketId} side=${sideId}` +
    ` amountUsd=${totalValue} price=${executedPrice} shares=${shares} GS$`
  );

  return {
    success: true,
    data: {
      orderId:       order.id,
      positionId,
      marketId,
      sideId,
      action:        "BUY",
      orderType:     "MARKET",
      amountUsd:     totalValue,
      executedPrice,
      shares,
      status:        "filled",
      idempotencyKey,
      duplicate:     false,
      realizedPnl:   null,
      position:      positionSummary,
      wallet: {
        currency:         "GS",
        availableBalance: freshGsWallet?.availableBalance ?? "0",
      },
    },
  };
}

// ── Phase 3: executeMarketSell ─────────────────────────────────────────────────
//
// SELL flow delegated from executeMarketTrade after shared validation (steps 1-4).
// Financial model:
//   sharesToSell  = amountUsd / executedPrice
//   costRemoved   = sharesToSell * avgCostPerShare   (avgCostPerShare = costBasis / quantity)
//   realizedPnl   = proceeds - costRemoved           (proceeds = amountUsd = amountUsd)
//
// Wallet operations:
//   consumeLockedFunds(costRemoved)  — removes cost basis portion from locked_balance
//   creditWallet(proceeds)           — credits sale proceeds to available_balance
//
// This matches the settlement pattern: consumeLockedFunds + creditWallet.
// No position can go below 0 — oversell is blocked before any DB write.

async function executeMarketSell(ctx: {
  userId:         string;
  marketId:       number;
  sideId:         number;
  outcome:        { id: number; code: string | null; label: string; sortOrder: number | null };
  executedPrice:  string;
  amountUsd:      number;
  idempotencyKey: string;
}): Promise<PredictionServiceResult<ExecuteTradeResult>> {
  const { userId, marketId, sideId, outcome, executedPrice, amountUsd, idempotencyKey } = ctx;

  const priceNum       = parseFloat(executedPrice);
  const sharesToSell   = toDecimal(amountUsd / priceNum);
  const proceeds       = toDecimal(amountUsd);
  const walletLedgerRef = `trade_ord_sell_${idempotencyKey.slice(-12)}`;

  // ── S1. Load existing position ────────────────────────────────────────────
  const position = await predictionRepository.findPositionByUserMarketOutcome(
    userId, marketId, sideId
  );
  if (!position) {
    return { success: false, error: "No open position found for this market and side." };
  }

  const sharesHeldNum    = parseFloat(position.quantity ?? "0");
  const sharesToSellNum  = parseFloat(sharesToSell);

  // ── S2. Oversell guard ────────────────────────────────────────────────────
  if (sharesToSellNum > sharesHeldNum + 0.000001) {
    return {
      success: false,
      error: `Cannot sell ${sharesToSell} shares — you only hold ${position.quantity} shares. Reduce amountUsd.`,
    };
  }

  // ── S3. PnL calculation ───────────────────────────────────────────────────
  const costBasisNum      = parseFloat(position.costBasis ?? "0");
  const avgCostPerShare   = sharesHeldNum > 0 ? costBasisNum / sharesHeldNum : 0;
  const costRemovedNum    = sharesToSellNum * avgCostPerShare;
  const realizedPnlNum    = amountUsd - costRemovedNum;
  const costRemoved       = toDecimal(costRemovedNum);
  const realizedPnlDelta  = toDecimal(realizedPnlNum);

  // ── S4. Create pending SELL order ─────────────────────────────────────────
  let order: Awaited<ReturnType<typeof predictionRepository.createOrder>>;
  try {
    order = await predictionRepository.createOrder({
      marketId,
      userId,
      outcomeId:  sideId,
      side:       "sell",
      orderType:  "market",
      quantity:   sharesToSell,
      price:      executedPrice,
      totalValue: proceeds,
      status:     "pending",
      idempotencyKey,
    } as any);
  } catch (err: any) {
    if (err.code === "23505") {
      const raceOrder = await predictionRepository.findOrderByIdempotencyKey(idempotencyKey);
      if (raceOrder) {
        return {
          success: true,
          data: {
            orderId: raceOrder.id, positionId: position.id,
            marketId, sideId, action: "SELL", orderType: "MARKET",
            amountUsd: proceeds, executedPrice, shares: sharesToSell,
            status: raceOrder.status, idempotencyKey, duplicate: true,
            realizedPnl: realizedPnlDelta,
            position: {
              positionId: position.id, outcomeId: sideId,
              outcomeCode: outcome.code ?? null, outcomeLabel: outcome.label ?? "",
              sharesHeld: position.quantity ?? "0", avgPrice: position.avgPrice ?? executedPrice,
              costBasis: position.costBasis ?? "0",
            },
            wallet: { currency: "GS", availableBalance: "0" },
          },
        };
      }
    }
    console.error("[Trade:executeMarketSell] createOrder failed:", err.message);
    return { success: false, error: "Failed to create sell order. Please try again." };
  }

  // ── S5. Consume locked funds (cost basis portion) ─────────────────────────
  try {
    await walletService.consumeLockedFunds({
      userId,
      currency:      "GS",
      amount:        costRemoved,
      entryType:     "buy_settle",
      description:   `Trade SELL — cost basis consumed: ${costRemoved} GS$ for ${sharesToSell} shares (market #${marketId}, side #${sideId})`,
      referenceType: "prediction_order",
      referenceId:   String(order.id),
    });
  } catch (err: any) {
    await predictionRepository.updateOrderStatus(order.id, "failed").catch(() => {});
    console.warn(`[Trade:executeMarketSell] consumeLockedFunds failed for orderId=${order.id}: ${err.message}`);
    return {
      success: false,
      error: `Failed to process sell (locked balance issue). ${err.message}`,
    };
  }

  // ── S6. Credit sale proceeds to available_balance ─────────────────────────
  try {
    await walletService.creditWallet({
      userId,
      currency:      "GS",
      amount:        proceeds,
      entryType:     "sell_settle",
      description:   `Trade SELL proceeds: ${proceeds} GS$ for ${sharesToSell} shares @ ${executedPrice} (market #${marketId}, side #${sideId})`,
      referenceType: "prediction_order",
      referenceId:   String(order.id),
    });
  } catch (err: any) {
    console.error(`[Trade:executeMarketSell] creditWallet failed for orderId=${order.id}: ${err.message}`);
    return {
      success: false,
      error: "Sell order recorded but credit failed. Contact support.",
    };
  }

  // ── S7. Fill order + reduce position ─────────────────────────────────────
  let updatedPos: Awaited<ReturnType<typeof predictionRepository.reducePositionForSell>>;
  try {
    await predictionRepository.updateOrderStatus(order.id, "filled");
    updatedPos = await predictionRepository.reducePositionForSell(
      position.id, sharesToSell, costRemoved, realizedPnlDelta, walletLedgerRef
    );

    // If the position quantity is now effectively zero, mark it closed
    if (parseFloat(updatedPos.quantity ?? "0") <= 0.000001) {
      await predictionRepository.updatePositionStatus(position.id, "closed", {
        realizedPnl: updatedPos.realizedPnl,
      });
      updatedPos = { ...updatedPos, status: "closed" };
    }
  } catch (err: any) {
    console.error(`[Trade:executeMarketSell] Position reduction failed for orderId=${order.id}:`, err.message);
    return { success: false, error: "Sell partially recorded. Contact support." };
  }

  // ── S8. Non-critical telemetry ────────────────────────────────────────────
  const isFirstOutcome = (outcome.sortOrder ?? 1) === 0;
  Promise.all([
    predictionRepository.updateMarketPool(marketId, proceeds),
    predictionRepository.insertPriceSnapshot({ marketId, outcomeId: sideId, price: executedPrice, volumeWindow: proceeds }),
    predictionRepository.recordOrderTelemetry(marketId, isFirstOutcome, executedPrice, proceeds),
  ]).catch(err => {
    console.warn("[Trade:executeMarketSell] Non-critical telemetry failed:", err.message);
  });

  // ── S9. Fetch fresh wallet + return ──────────────────────────────────────
  const freshSummary  = await walletService.getWalletSummary(userId);
  const freshGsWallet = freshSummary.wallets.find(w => w.currency === "GS");

  console.log(
    `[Trade:executeMarketSell] ✓ orderId=${order.id} positionId=${position.id}` +
    ` userId=${userId} market=${marketId} side=${sideId}` +
    ` proceeds=${proceeds} price=${executedPrice} shares=${sharesToSell}` +
    ` realizedPnl=${realizedPnlDelta} GS$`
  );

  return {
    success: true,
    data: {
      orderId:       order.id,
      positionId:    position.id,
      marketId,
      sideId,
      action:        "SELL",
      orderType:     "MARKET",
      amountUsd:     proceeds,
      executedPrice,
      shares:        sharesToSell,
      status:        "filled",
      idempotencyKey,
      duplicate:     false,
      realizedPnl:   realizedPnlDelta,
      position: {
        positionId:   position.id,
        outcomeId:    sideId,
        outcomeCode:  outcome.code ?? null,
        outcomeLabel: outcome.label ?? "",
        sharesHeld:   updatedPos.quantity  ?? "0",
        avgPrice:     updatedPos.avgPrice  ?? executedPrice,
        costBasis:    updatedPos.costBasis ?? "0",
      },
      wallet: {
        currency:         "GS",
        availableBalance: freshGsWallet?.availableBalance ?? "0",
      },
    },
  };
}

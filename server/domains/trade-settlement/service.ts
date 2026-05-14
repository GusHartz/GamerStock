import { db } from "../../db";
import { wallets, walletLedgerEntries } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import * as walletRepo from "../wallet/repository";
import * as walletService from "../wallet/service";
import { captureTradeFees, computeFee } from "../fee-engine";
import type {
  ReserveBuyOrderParams,
  ReleaseBuyOrderParams,
  SettleMatchedTradeParams,
  ReservationResult,
  ReleaseResult,
  SettlementResult,
} from "./types";
import type { Wallet } from "@shared/schema";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function assertPositive(v: string, label: string): void {
  const n = parseFloat(v);
  if (!isFinite(n) || n <= 0) throw new Error(`${label} must be > 0, got: ${v}`);
}

function toDecimal(v: string | number): string {
  const n = parseFloat(String(v));
  if (!isFinite(n)) throw new Error(`Invalid amount: ${v}`);
  return n.toFixed(6);
}

function gte(a: string, b: string): boolean {
  return parseFloat(a) >= parseFloat(b);
}

// ─── 1. reserveBuyOrderFunds ──────────────────────────────────────────────────
/**
 * Reserves GS$ when a buy order is placed.
 *
 * Accounting effect:
 *   available_balance  -= reserveAmount
 *   locked_balance     += reserveAmount
 *   total_balance        unchanged
 *
 * Ledger entry: entry_type = buy_hold, reference_type = order
 */
export async function reserveBuyOrderFunds(
  params: ReserveBuyOrderParams,
): Promise<ReservationResult> {
  const { userId, orderId, reserveAmount, assetId, metadata } = params;
  assertPositive(reserveAmount, "reserveAmount");

  await walletService.ensureWalletsExist(userId);
  await walletService.lockFunds({
    userId,
    currency: "GS",
    amount: reserveAmount,
    entryType: "buy_hold",
    description: `Buy order hold: order ${orderId}${assetId ? ` / asset ${assetId}` : ""}`,
    referenceType: "order",
    referenceId: orderId,
  });

  const summary = await walletService.getWalletSummary(userId);
  const gs = summary.wallets.find((w) => w.currency === "GS")!;

  return {
    orderId,
    userId,
    reservedAmount: toDecimal(reserveAmount),
    availableBalance: gs.availableBalance,
    lockedBalance: gs.lockedBalance,
  };
}

// ─── 2. releaseBuyOrderFunds ──────────────────────────────────────────────────
/**
 * Releases previously locked GS$ back to available — used when an order is
 * cancelled, expires, or has a partial-fill remainder.
 *
 * Accounting effect:
 *   locked_balance     -= releaseAmount
 *   available_balance  += releaseAmount
 *   total_balance        unchanged
 *
 * Ledger entry: entry_type = unlock, reference_type = order
 */
export async function releaseBuyOrderFunds(
  params: ReleaseBuyOrderParams,
): Promise<ReleaseResult> {
  const { userId, orderId, releaseAmount, reason } = params;
  assertPositive(releaseAmount, "releaseAmount");

  await walletService.ensureWalletsExist(userId);
  await walletService.unlockFunds({
    userId,
    currency: "GS",
    amount: releaseAmount,
    entryType: "unlock",
    description: `Buy order release (${reason}): order ${orderId}`,
    referenceType: "order",
    referenceId: orderId,
  });

  const summary = await walletService.getWalletSummary(userId);
  const gs = summary.wallets.find((w) => w.currency === "GS")!;

  return {
    orderId,
    userId,
    releasedAmount: toDecimal(releaseAmount),
    availableBalance: gs.availableBalance,
    lockedBalance: gs.lockedBalance,
    reason,
  };
}

// ─── 3. settleMatchedTrade ────────────────────────────────────────────────────
/**
 * Atomically settles a matched trade between a buyer and a seller,
 * capturing the platform fee inside the same transaction.
 *
 * Buyer-side accounting:
 *   locked_balance     -= grossAmountGS   (buy_settle: convert hold → real spend)
 *   total_balance      -= grossAmountGS
 *   available_balance    unchanged
 *
 * Optional partial-fill release (releaseAmount > 0):
 *   locked_balance     -= releaseAmount   (unlock: excess hold back to available)
 *   available_balance  += releaseAmount
 *   total_balance        unchanged for this step
 *
 * Seller-side accounting (net of fee):
 *   available_balance  += grossAmountGS - feeTotal   (sell_settle)
 *   total_balance      += grossAmountGS - feeTotal
 *
 * Fee routing (inside same transaction):
 *   platform_revenue wallet  += platformFee   (60% of feeTotal)
 *   player_pool wallet       += playerFee     (25% of feeTotal)
 *   liquidity_pool wallet    += liquidityFee  (15% of feeTotal)
 *
 * Idempotency:
 *   If a buy_settle ledger entry with reference_type='trade' and
 *   reference_id=tradeId already exists, returns immediately with
 *   idempotent=true. Safe to call multiple times for the same trade.
 *
 * Deadlock prevention:
 *   Both wallet rows are locked (SELECT FOR UPDATE) in ascending wallet.id
 *   order so concurrent settlements on overlapping user pairs can never
 *   form a lock cycle.
 */
export async function settleMatchedTrade(
  params: SettleMatchedTradeParams,
): Promise<SettlementResult> {
  const {
    tradeId,
    buyOrderId,
    sellOrderId,
    buyerUserId,
    sellerUserId,
    assetId,
    quantity,
    executionPrice,
    grossAmountGS,
    releaseAmount = "0",
    feeBps,
    assetDbId,
    metadata,
  } = params;

  assertPositive(grossAmountGS, "grossAmountGS");
  assertPositive(executionPrice, "executionPrice");
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error(`quantity must be > 0, got: ${quantity}`);
  }

  const releaseF = parseFloat(releaseAmount);
  if (!isFinite(releaseF) || releaseF < 0) {
    throw new Error(`releaseAmount must be >= 0, got: ${releaseAmount}`);
  }

  const grossNorm   = toDecimal(grossAmountGS);
  const releaseNorm = releaseF > 0 ? toDecimal(releaseAmount) : "0.000000";

  // Pre-compute fee so we know the seller's net amount before entering the tx
  const feeBreakdown = computeFee(parseFloat(grossNorm), feeBps);
  const feeNorm      = toDecimal(feeBreakdown.feeTotal);
  const sellerNetNorm = toDecimal(parseFloat(grossNorm) - feeBreakdown.feeTotal);

  await walletService.ensureWalletsExist(buyerUserId);
  await walletService.ensureWalletsExist(sellerUserId);

  // ── Idempotency check (outside transaction — fast read) ─────────────────────
  const [existingEntry] = await db
    .select({ id: walletLedgerEntries.id })
    .from(walletLedgerEntries)
    .where(
      and(
        eq(walletLedgerEntries.referenceType, "trade"),
        eq(walletLedgerEntries.referenceId, tradeId),
        eq(walletLedgerEntries.entryType, "buy_settle"),
      ),
    )
    .limit(1);

  if (existingEntry) {
    const buyerSummary  = await walletService.getWalletSummary(buyerUserId);
    const sellerSummary = await walletService.getWalletSummary(sellerUserId);
    const bgs = buyerSummary.wallets.find((w) => w.currency === "GS")!;
    const sgs = sellerSummary.wallets.find((w) => w.currency === "GS")!;
    return {
      tradeId,
      buyOrderId,
      sellOrderId,
      grossAmountGS: grossNorm,
      releasedAmount: releaseNorm,
      buyer: {
        userId: buyerUserId,
        lockedConsumed: "0.000000",
        newLockedBalance: bgs.lockedBalance,
        newTotalBalance: bgs.totalBalance,
        newAvailableBalance: bgs.availableBalance,
      },
      seller: {
        userId: sellerUserId,
        credited: "0.000000",
        newAvailableBalance: sgs.availableBalance,
        newTotalBalance: sgs.totalBalance,
      },
      idempotent: true,
    };
  }

  // ── Atomic settlement transaction ────────────────────────────────────────────
  let buyerFinalWallet!: Wallet;
  let sellerFinalWallet!: Wallet;

  await db.transaction(async (tx) => {
    // 1. Read wallet IDs (unlocked — needed for lock ordering)
    const buyerRaw  = await walletRepo.findWalletByUserAndCurrency(buyerUserId,  "GS", tx);
    const sellerRaw = await walletRepo.findWalletByUserAndCurrency(sellerUserId, "GS", tx);

    if (!buyerRaw)  throw new Error(`GS wallet not found for buyer ${buyerUserId}`);
    if (!sellerRaw) throw new Error(`GS wallet not found for seller ${sellerUserId}`);

    // 2. Lock wallets in ascending ID order — prevents deadlock across concurrent settlements
    const [lowId, highId] = buyerRaw.id <= sellerRaw.id
      ? [buyerRaw.id, sellerRaw.id]
      : [sellerRaw.id, buyerRaw.id];

    const [lowWallet]  = await tx.select().from(wallets).where(eq(wallets.id, lowId)).for("update");
    const [highWallet] = await tx.select().from(wallets).where(eq(wallets.id, highId)).for("update");

    const buyerWallet  = lowWallet.id === buyerRaw.id  ? lowWallet  : highWallet;
    const sellerWallet = lowWallet.id === sellerRaw.id ? lowWallet  : highWallet;

    // 3. Validate buyer locked balance covers gross + any release remainder
    const totalFromLocked = parseFloat(grossNorm) + parseFloat(releaseNorm);
    if (!gte(buyerWallet.lockedBalance, toDecimal(totalFromLocked))) {
      throw new Error(
        `Buyer locked balance insufficient. Need ${totalFromLocked.toFixed(6)}, has ${buyerWallet.lockedBalance}`,
      );
    }

    // 4. Consume locked from buyer (locked ↓, total ↓, available unchanged)
    let buyerAfter = await walletRepo.applyConsumeLocked(buyerWallet.id, grossNorm, tx);
    await walletRepo.insertLedgerEntry(
      {
        userId: buyerUserId,
        walletId: buyerWallet.id,
        currency: "GS",
        entryType: "buy_settle",
        direction: "debit",
        amount: grossNorm,
        balanceAfter: buyerAfter.availableBalance,
        description: `Trade settlement (buy): ${quantity} shares @ ${executionPrice} GS — trade ${tradeId}`,
        referenceType: "trade",
        referenceId: tradeId,
        metadata: metadata
          ? { ...metadata, buyOrderId, sellOrderId, assetId, quantity, executionPrice }
          : { buyOrderId, sellOrderId, assetId, quantity, executionPrice },
      },
      tx,
    );

    // 5. Release remainder to buyer available (if partial fill or price improvement)
    if (parseFloat(releaseNorm) > 0) {
      buyerAfter = await walletRepo.applyUnlock(buyerWallet.id, releaseNorm, tx);
      await walletRepo.insertLedgerEntry(
        {
          userId: buyerUserId,
          walletId: buyerWallet.id,
          currency: "GS",
          entryType: "unlock",
          direction: "credit",
          amount: releaseNorm,
          balanceAfter: buyerAfter.availableBalance,
          description: `Partial fill remainder released: order ${buyOrderId}`,
          referenceType: "order",
          referenceId: buyOrderId,
          metadata: null,
        },
        tx,
      );
    }
    buyerFinalWallet = buyerAfter;

    // 6. Credit seller (net of fee: available ↑, total ↑)
    sellerFinalWallet = await walletRepo.applyCredit(sellerWallet.id, sellerNetNorm, tx);
    await walletRepo.insertLedgerEntry(
      {
        userId: sellerUserId,
        walletId: sellerWallet.id,
        currency: "GS",
        entryType: "sell_settle",
        direction: "credit",
        amount: sellerNetNorm,
        balanceAfter: sellerFinalWallet.availableBalance,
        description: `Trade settlement (sell net): ${quantity} shares @ ${executionPrice} GS, fee ${feeNorm} — trade ${tradeId}`,
        referenceType: "trade",
        referenceId: tradeId,
        metadata: metadata
          ? { ...metadata, buyOrderId, sellOrderId, assetId, quantity, executionPrice, feeNorm }
          : { buyOrderId, sellOrderId, assetId, quantity, executionPrice, feeNorm },
      },
      tx,
    );

    // 7. Capture fee → system wallets (atomic within this transaction)
    await captureTradeFees({
      referenceType: "limit_trade",
      referenceId:   tradeId,
      assetDbId,
      currency:      "GS",
      notional:      parseFloat(grossNorm),
      feeBps,
      tx,
    });
  });

  return {
    tradeId,
    buyOrderId,
    sellOrderId,
    grossAmountGS: grossNorm,
    releasedAmount: releaseNorm,
    buyer: {
      userId: buyerUserId,
      lockedConsumed: grossNorm,
      newLockedBalance:    buyerFinalWallet.lockedBalance,
      newTotalBalance:     buyerFinalWallet.totalBalance,
      newAvailableBalance: buyerFinalWallet.availableBalance,
    },
    seller: {
      userId: sellerUserId,
      credited: sellerNetNorm,
      newAvailableBalance: sellerFinalWallet.availableBalance,
      newTotalBalance:     sellerFinalWallet.totalBalance,
    },
    idempotent: false,
  };
}

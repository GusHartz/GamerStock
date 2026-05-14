// ─── Fee Engine ───────────────────────────────────────────────────────────────
// Currency-agnostic trade fee capture.
//
// Settlement flow:
//   1. Insert fee_ledger row (immutable record)
//   2. Credit platform_revenue system wallet
//   3. Credit player_pool system wallet  +  accruePlayerEarnings()
//      → player_earnings_ledger (source of truth, idempotent)
//      → player_earnings_balance.accruedBalance (currency-aware projection)
//      → legacy player_fee_balance (GS-only, web3 adapter compat)
//   4. Credit liquidity_pool system wallet
//   5. All inside the caller's transaction (or a new one if none provided)
//
// Design invariant:
//   ledger  = source of truth  (fee_ledger, system_wallet_ledger, player_earnings_ledger)
//   wallets = projection/cache (system_wallets, player_earnings_balance)
// ─────────────────────────────────────────────────────────────────────────────
import { db } from "../../db";
import { feeLedger } from "@shared/schema";
import { computeFee, DEFAULT_FEE_BPS } from "./fee";
import { creditSystemWallet } from "./system-wallet.service";
import { accruePlayerEarnings } from "../player-earnings/service";
import type { Currency } from "@shared/schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// ─── Public API ───────────────────────────────────────────────────────────────

export { computeFee, DEFAULT_FEE_BPS } from "./fee";
export { ensureSystemWalletsExist, getAllSystemWallets, getSystemWallet } from "./system-wallet.service";

// ─── Capture params ───────────────────────────────────────────────────────────

export interface CaptureFeesParams {
  /** e.g. "market_trade" | "limit_trade" */
  referenceType: string;
  /** string-coerced trade ID */
  referenceId:   string;
  /** DB integer asset id — used to update playerFeeBalance. Optional. */
  assetDbId?:    number;
  /** Trading currency — GS or USDC. */
  currency:      Currency;
  /** price × quantity, in the trade currency. */
  notional:      number;
  /** Basis points override from assetMarkets.feeBps. Defaults to 200. */
  feeBps?:       number;
  /** Pass the caller's transaction so this runs atomically with settlement. */
  tx?:           Tx;
}

export interface CaptureFeesResult {
  feeBps:       number;
  notional:     number;
  feeTotal:     number;
  platformFee:  number;
  playerFee:    number;
  liquidityFee: number;
}

// ─── Internal implementation ──────────────────────────────────────────────────

async function _capture(
  params: CaptureFeesParams,
  tx: Tx,
): Promise<CaptureFeesResult> {
  const {
    referenceType,
    referenceId,
    assetDbId,
    currency,
    notional,
    feeBps = DEFAULT_FEE_BPS,
  } = params;

  const bd = computeFee(notional, feeBps);

  // ── 1. Fee ledger row ────────────────────────────────────────────────────────
  await tx.insert(feeLedger).values({
    referenceType,
    referenceId,
    assetId:      assetDbId ?? null,
    currency,
    notional:     bd.notional.toFixed(6),
    feeTotal:     bd.feeTotal.toFixed(6),
    platformFee:  bd.platformFee.toFixed(6),
    playerFee:    bd.playerFee.toFixed(6),
    liquidityFee: bd.liquidityFee.toFixed(6),
  });

  const ledgerRef = { referenceType: "fee_ledger", referenceId };

  // ── 2. Platform revenue ──────────────────────────────────────────────────────
  await creditSystemWallet({
    walletType:    "platform_revenue",
    currency,
    amount:        bd.platformFee.toFixed(6),
    ...ledgerRef,
    description:   `Platform revenue: ${referenceType} ${referenceId}`,
    ctx:           tx,
  });

  // ── 3. Player pool + per-asset earnings accrual ─────────────────────────────
  await creditSystemWallet({
    walletType:    "player_pool",
    currency,
    amount:        bd.playerFee.toFixed(6),
    ...ledgerRef,
    description:   `Player pool: ${referenceType} ${referenceId}`,
    ctx:           tx,
  });

  if (assetDbId != null) {
    await accruePlayerEarnings({
      assetId:       assetDbId,
      currency,
      amount:        bd.playerFee,
      referenceType,
      referenceId,
      tx,
    });
  }

  // ── 4. Liquidity pool ────────────────────────────────────────────────────────
  await creditSystemWallet({
    walletType:    "liquidity_pool",
    currency,
    amount:        bd.liquidityFee.toFixed(6),
    ...ledgerRef,
    description:   `Liquidity pool: ${referenceType} ${referenceId}`,
    ctx:           tx,
  });

  return {
    feeBps:       bd.feeBps,
    notional:     bd.notional,
    feeTotal:     bd.feeTotal,
    platformFee:  bd.platformFee,
    playerFee:    bd.playerFee,
    liquidityFee: bd.liquidityFee,
  };
}

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * captureTradeFees — currency-agnostic fee capture.
 *
 * If `params.tx` is provided, runs inside that transaction (caller is
 * responsible for the outer transaction boundary).
 *
 * If no `params.tx` is provided, opens its own transaction.
 *
 * In all cases the three system wallet credits and the fee_ledger insert
 * are committed atomically.
 */
export async function captureTradeFees(
  params: CaptureFeesParams,
): Promise<CaptureFeesResult> {
  if (params.tx) {
    return _capture(params, params.tx);
  }
  return db.transaction((tx) => _capture(params, tx));
}

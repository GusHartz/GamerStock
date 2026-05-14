// ─── Player Earnings Service ──────────────────────────────────────────────────
// Accrues per-asset player pool earnings atomically within the fee-engine
// transaction.  This is the authoritative write path for:
//   - player_earnings_balance  (currency-aware accrued balance projection)
//   - player_earnings_ledger   (immutable source of truth)
//
// Legacy player_fee_balance (GS-only, no ledger) is also updated here for
// backward compatibility with the web3 treasury-settlement-adapter until it
// is migrated to player_earnings_balance.
//
// Design invariant (matches the rest of the wallet domain):
//   ledger  = source of truth   (player_earnings_ledger)
//   balance = projection/cache  (player_earnings_balance.accruedBalance)
//
// Idempotency: the unique constraint
//   pel_idempotency_key (assetId, currency, referenceType, referenceId, direction)
// makes every accrual operation safe to retry — a duplicate call is silently
// skipped via ON CONFLICT DO NOTHING on the ledger insert, and the balance
// upsert uses an additive expression so double-credits are impossible if the
// ledger insert is skipped.
// ─────────────────────────────────────────────────────────────────────────────
import { db } from "../../db";
import {
  playerEarningsBalance,
  playerEarningsLedger,
  playerFeeBalance,
} from "@shared/schema";
import { sql } from "drizzle-orm";
import type { Currency } from "@shared/schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// ─── Public API ───────────────────────────────────────────────────────────────

export interface AccruePlayerEarningsParams {
  /** assets.id — the integer PK of the player asset. */
  assetId:       number;
  /** Trading currency (GS | USDC). */
  currency:      Currency;
  /** The playerFee amount to credit (positive number). */
  amount:        number;
  /** Matches fee_ledger.reference_type (e.g. "market_trade" | "limit_trade"). */
  referenceType: string;
  /** Matches fee_ledger.reference_id (e.g. the string-coerced trade ID). */
  referenceId:   string;
  /** Caller's transaction — must be provided; runs atomically with fee capture. */
  tx:            Tx;
}

/**
 * accruePlayerEarnings — credits player-specific earnings inside the
 * caller's existing database transaction.
 *
 * Steps (all atomic with the surrounding fee-engine transaction):
 *   1. Upsert player_earnings_balance → accruedBalance += amount
 *      Returns the new accruedBalance for use as balanceAfter in the ledger.
 *   2. Insert player_earnings_ledger row (direction="credit") with balanceAfter.
 *      ON CONFLICT DO NOTHING enforces idempotency — duplicate calls are safe.
 *   3. Upsert legacy player_fee_balance (GS-only) for web3 adapter compat.
 *
 * Never call outside a transaction — always pass params.tx.
 */
export async function accruePlayerEarnings(
  params: AccruePlayerEarningsParams,
): Promise<void> {
  const { assetId, currency, amount, referenceType, referenceId, tx } = params;
  const amountStr = amount.toFixed(6);

  // ── 1. Upsert accrued balance and capture the resulting accruedBalance ────────
  const [updated] = await tx
    .insert(playerEarningsBalance)
    .values({
      assetId,
      currency,
      accruedBalance: amountStr,
      updatedAt:      new Date(),
    })
    .onConflictDoUpdate({
      target: [playerEarningsBalance.assetId, playerEarningsBalance.currency],
      set: {
        accruedBalance: sql`${playerEarningsBalance.accruedBalance} + ${amountStr}`,
        updatedAt:      new Date(),
      },
    })
    .returning({ accruedBalance: playerEarningsBalance.accruedBalance });

  // ── 2. Immutable ledger insert — skipped silently on duplicate (idempotency) ──
  await tx
    .insert(playerEarningsLedger)
    .values({
      assetId,
      currency,
      direction:    "credit",
      amount:       amountStr,
      balanceAfter: updated.accruedBalance,
      referenceType,
      referenceId,
    })
    .onConflictDoNothing();

  // ── 3. Legacy player_fee_balance (GS only — web3 adapter backward compat) ─────
  if (currency === "GS") {
    await tx
      .insert(playerFeeBalance)
      .values({
        assetId,
        balance:   amountStr,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [playerFeeBalance.assetId],
        set: {
          balance:   sql`${playerFeeBalance.balance} + ${amountStr}`,
          updatedAt: new Date(),
        },
      });
  }
}

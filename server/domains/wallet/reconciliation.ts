import { db } from "../../db";
import { wallets, walletLedgerEntries } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import type { Currency } from "@shared/schema";

// ─── Result types ─────────────────────────────────────────────────────────────

export interface WalletReconciliationResult {
  walletId: number;
  userId: string;
  currency: Currency;
  wallet_balance: string;
  ledger_balance: string;
  difference: string;
  total_credits: string;
  total_debits: string;
  entry_count: number;
  status: "OK" | "MISMATCH";
}

export interface UserReconciliationResult {
  userId: string;
  wallets: WalletReconciliationResult[];
  overall_status: "OK" | "MISMATCH";
}

// ─── Core reconciliation ──────────────────────────────────────────────────────

/**
 * Reconciles a single wallet against its ledger using SQL aggregation.
 *
 * wallet_balance  = available_balance + locked_balance  (the cached snapshot)
 * ledger_balance  = SUM(credits) - SUM(debits)          (reconstructed from source of truth)
 * difference      = wallet_balance - ledger_balance      (should always be 0.000000)
 *
 * Status is "OK" only when |difference| < 0.000001 (tolerates numeric rounding
 * at the last decimal place of our numeric(18,6) columns).
 */
export async function reconcileWallet(walletId: number): Promise<WalletReconciliationResult> {
  // 1. Load wallet row
  const [wallet] = await db
    .select()
    .from(wallets)
    .where(eq(wallets.id, walletId));

  if (!wallet) throw new Error(`Wallet not found: ${walletId}`);

  // 2. Aggregate ledger in a single SQL pass — no in-memory iteration
  const [agg] = await db
    .select({
      total_credits: sql<string>`COALESCE(SUM(CASE WHEN ${walletLedgerEntries.direction} = 'credit' THEN ${walletLedgerEntries.amount} ELSE 0 END), 0)::text`,
      total_debits:  sql<string>`COALESCE(SUM(CASE WHEN ${walletLedgerEntries.direction} = 'debit'  THEN ${walletLedgerEntries.amount} ELSE 0 END), 0)::text`,
      entry_count:   sql<number>`COUNT(*)::int`,
    })
    .from(walletLedgerEntries)
    .where(eq(walletLedgerEntries.walletId, walletId));

  const totalCredits = parseFloat(agg.total_credits);
  const totalDebits  = parseFloat(agg.total_debits);
  const ledgerBalance = totalCredits - totalDebits;

  // 3. wallet_balance = total_balance (available + locked, enforced by DB CHECK constraint)
  const walletBalance = parseFloat(wallet.totalBalance);

  // 4. Compare — tolerance of 1e-6 to absorb any numeric(18,6) edge rounding
  const difference = walletBalance - ledgerBalance;
  const status: "OK" | "MISMATCH" = Math.abs(difference) < 1e-6 ? "OK" : "MISMATCH";

  return {
    walletId: wallet.id,
    userId: wallet.userId,
    currency: wallet.currency as Currency,
    wallet_balance:  walletBalance.toFixed(6),
    ledger_balance:  ledgerBalance.toFixed(6),
    difference:      difference.toFixed(6),
    total_credits:   totalCredits.toFixed(6),
    total_debits:    totalDebits.toFixed(6),
    entry_count:     agg.entry_count,
    status,
  };
}

/**
 * Reconciles all wallets belonging to a user.
 * overall_status is "MISMATCH" if any individual wallet mismatches.
 */
export async function reconcileUser(userId: string): Promise<UserReconciliationResult> {
  const userWallets = await db
    .select()
    .from(wallets)
    .where(eq(wallets.userId, userId));

  if (userWallets.length === 0) {
    return {
      userId,
      wallets: [],
      overall_status: "OK",
    };
  }

  const results = await Promise.all(
    userWallets.map((w) => reconcileWallet(w.id)),
  );

  const overall_status: "OK" | "MISMATCH" = results.some((r) => r.status === "MISMATCH")
    ? "MISMATCH"
    : "OK";

  return { userId, wallets: results, overall_status };
}

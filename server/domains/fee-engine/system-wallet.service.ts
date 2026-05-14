// ─── System Wallet Service ────────────────────────────────────────────────────
// Manages platform-level wallets for revenue pools.
// All mutations are atomic: balance update + ledger entry in one statement.
// ─────────────────────────────────────────────────────────────────────────────
import { db } from "../../db";
import {
  systemWallets, systemWalletLedger,
  SYSTEM_WALLET_TYPES, CURRENCIES,
} from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import type { SystemWalletType, SystemWallet } from "@shared/schema";
import type { Currency } from "@shared/schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type DbOrTx = typeof db | Tx;

// ─── Bootstrap ────────────────────────────────────────────────────────────────

/**
 * Idempotent — creates the 6 system wallet rows (3 types × 2 currencies)
 * if they do not already exist. Safe to call on every startup.
 */
export async function ensureSystemWalletsExist(): Promise<void> {
  const rows = SYSTEM_WALLET_TYPES.flatMap((walletType) =>
    CURRENCIES.map((currency) => ({ walletType, currency })),
  );
  await db.insert(systemWallets).values(rows).onConflictDoNothing();
  console.log("[FeeEngine] System wallets ready (6 rows).");
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getSystemWallet(
  walletType: SystemWalletType,
  currency: Currency,
): Promise<SystemWallet | undefined> {
  const [row] = await db
    .select()
    .from(systemWallets)
    .where(
      and(
        eq(systemWallets.walletType, walletType),
        eq(systemWallets.currency, currency),
      ),
    );
  return row;
}

export async function getAllSystemWallets(): Promise<SystemWallet[]> {
  return db.select().from(systemWallets);
}

// ─── Credit ───────────────────────────────────────────────────────────────────

/**
 * Credits a system wallet and writes an immutable ledger entry.
 * Must be called inside the trade's DB transaction (pass `ctx`).
 *
 * @returns The new balance string after credit.
 */
export async function creditSystemWallet(params: {
  walletType:    SystemWalletType;
  currency:      Currency;
  amount:        string;
  referenceType: string;
  referenceId:   string;
  description?:  string;
  metadata?:     Record<string, unknown>;
  ctx:           DbOrTx;
}): Promise<string> {
  const { walletType, currency, amount, referenceType, referenceId, description, metadata, ctx } = params;

  const [updated] = await ctx
    .update(systemWallets)
    .set({
      balance:   sql`${systemWallets.balance} + ${amount}::numeric`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(systemWallets.walletType, walletType),
        eq(systemWallets.currency, currency),
      ),
    )
    .returning({ balance: systemWallets.balance });

  if (!updated) {
    throw new Error(
      `[FeeEngine] System wallet not found: ${walletType}/${currency}. Run ensureSystemWalletsExist() on startup.`,
    );
  }

  await ctx.insert(systemWalletLedger).values({
    walletType,
    currency,
    direction:     "credit",
    amount,
    balanceAfter:  updated.balance,
    referenceType,
    referenceId,
    description:   description ?? `${walletType} credit`,
    metadata:      metadata ?? null,
  });

  return updated.balance;
}

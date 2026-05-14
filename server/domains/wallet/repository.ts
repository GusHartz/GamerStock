import { db } from "../../db";
import { wallets, walletLedgerEntries } from "@shared/schema";
import { eq, and, desc, count, sql } from "drizzle-orm";
import type {
  Currency, EntryType, Wallet, WalletLedgerEntry, InsertWalletLedgerEntry,
} from "@shared/schema";

// ─── Transaction type ─────────────────────────────────────────────────────────
// Accepts either the top-level db or a Drizzle transaction object,
// so repository functions can be called inside or outside a transaction.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type DbOrTx = typeof db | Tx;

// ─── Wallet reads ─────────────────────────────────────────────────────────────

export async function findWalletsByUserId(userId: string): Promise<Wallet[]> {
  return db.select().from(wallets).where(eq(wallets.userId, userId));
}

export async function findWalletByUserAndCurrency(
  userId: string,
  currency: Currency,
  ctx: DbOrTx = db,
): Promise<Wallet | undefined> {
  const [row] = await ctx
    .select()
    .from(wallets)
    .where(and(eq(wallets.userId, userId), eq(wallets.currency, currency)));
  return row;
}

/**
 * SELECT ... FOR UPDATE — must be called inside a transaction.
 * Serializes concurrent mutations on the same wallet row.
 */
export async function findWalletForUpdate(
  userId: string,
  currency: Currency,
  tx: Tx,
): Promise<Wallet | undefined> {
  const [row] = await tx
    .select()
    .from(wallets)
    .where(and(eq(wallets.userId, userId), eq(wallets.currency, currency)))
    .for("update");
  return row;
}

// ─── Wallet creation ──────────────────────────────────────────────────────────

export async function insertWallet(
  userId: string,
  currency: Currency,
): Promise<Wallet> {
  const [row] = await db
    .insert(wallets)
    .values({ userId, currency })
    .onConflictDoNothing()
    .returning();
  if (row) return row;
  // Another concurrent call won the race — fetch and return the existing row
  const existing = await findWalletByUserAndCurrency(userId, currency);
  return existing!;
}

// ─── Ledger idempotency check ─────────────────────────────────────────────────

/**
 * Returns true if a wallet_seed entry already exists for this user + currency.
 * Called inside a transaction (after FOR UPDATE) to prevent double-seeding.
 */
export async function seedEntryExists(
  userId: string,
  currency: Currency,
  tx: Tx,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: walletLedgerEntries.id })
    .from(walletLedgerEntries)
    .where(
      and(
        eq(walletLedgerEntries.userId, userId),
        eq(walletLedgerEntries.currency, currency),
        eq(walletLedgerEntries.entryType, "wallet_seed"),
      ),
    )
    .limit(1);
  return row !== undefined;
}

// ─── Balance mutations ────────────────────────────────────────────────────────
// All accept a DbOrTx so callers can wrap them in a transaction.
// The total_balance invariant (total = available + locked) is maintained by
// every function here and enforced at DB level via CHECK constraint.

export async function applyCredit(
  walletId: number,
  amount: string,
  ctx: DbOrTx = db,
): Promise<Wallet> {
  const [updated] = await ctx
    .update(wallets)
    .set({
      availableBalance: sql`${wallets.availableBalance} + ${amount}::numeric`,
      totalBalance: sql`${wallets.totalBalance} + ${amount}::numeric`,
      updatedAt: new Date(),
    })
    .where(eq(wallets.id, walletId))
    .returning();
  return updated;
}

export async function applyDebit(
  walletId: number,
  amount: string,
  ctx: DbOrTx = db,
): Promise<Wallet> {
  const [updated] = await ctx
    .update(wallets)
    .set({
      availableBalance: sql`${wallets.availableBalance} - ${amount}::numeric`,
      totalBalance: sql`${wallets.totalBalance} - ${amount}::numeric`,
      updatedAt: new Date(),
    })
    .where(eq(wallets.id, walletId))
    .returning();
  return updated;
}

export async function applyLock(
  walletId: number,
  amount: string,
  ctx: DbOrTx = db,
): Promise<Wallet> {
  const [updated] = await ctx
    .update(wallets)
    .set({
      availableBalance: sql`${wallets.availableBalance} - ${amount}::numeric`,
      lockedBalance: sql`${wallets.lockedBalance} + ${amount}::numeric`,
      // total_balance unchanged: available decreases, locked increases by same amount
      updatedAt: new Date(),
    })
    .where(eq(wallets.id, walletId))
    .returning();
  return updated;
}

export async function applyUnlock(
  walletId: number,
  amount: string,
  ctx: DbOrTx = db,
): Promise<Wallet> {
  const [updated] = await ctx
    .update(wallets)
    .set({
      availableBalance: sql`${wallets.availableBalance} + ${amount}::numeric`,
      lockedBalance: sql`${wallets.lockedBalance} - ${amount}::numeric`,
      // total_balance unchanged: available increases, locked decreases by same amount
      updatedAt: new Date(),
    })
    .where(eq(wallets.id, walletId))
    .returning();
  return updated;
}

/**
 * Permanently consume funds from locked_balance (trade settlement).
 * locked_balance -= amount
 * total_balance  -= amount
 * available_balance is NOT touched.
 *
 * This represents converting a reserved hold into an actual spend.
 * The caller MUST validate locked >= amount before calling.
 */
export async function applyConsumeLocked(
  walletId: number,
  amount: string,
  ctx: DbOrTx = db,
): Promise<Wallet> {
  const [updated] = await ctx
    .update(wallets)
    .set({
      lockedBalance: sql`${wallets.lockedBalance} - ${amount}::numeric`,
      totalBalance:  sql`${wallets.totalBalance}  - ${amount}::numeric`,
      // available_balance unchanged
      updatedAt: new Date(),
    })
    .where(eq(wallets.id, walletId))
    .returning();
  return updated;
}

// ─── Ledger writes ────────────────────────────────────────────────────────────

export async function insertLedgerEntry(
  entry: InsertWalletLedgerEntry,
  ctx: DbOrTx = db,
): Promise<WalletLedgerEntry> {
  const [row] = await ctx.insert(walletLedgerEntries).values(entry).returning();
  return row;
}

// ─── Ledger reads ─────────────────────────────────────────────────────────────

export async function getLedgerEntriesForUser(
  userId: string,
  currency?: Currency,
  page = 1,
  limit = 50,
): Promise<{ entries: WalletLedgerEntry[]; total: number }> {
  const conditions = [eq(walletLedgerEntries.userId, userId)];
  if (currency) conditions.push(eq(walletLedgerEntries.currency, currency));

  const [{ total }] = await db
    .select({ total: count() })
    .from(walletLedgerEntries)
    .where(and(...conditions));

  const entries = await db
    .select()
    .from(walletLedgerEntries)
    .where(and(...conditions))
    .orderBy(desc(walletLedgerEntries.createdAt))
    .limit(limit)
    .offset((page - 1) * limit);

  return { entries, total: Number(total) };
}

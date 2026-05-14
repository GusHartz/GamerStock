import { db } from "../../db";
import * as repo from "./repository";
import type { Currency, CreditDebitParams, LockUnlockParams, ConsumeLockedParams, WalletSummary, LedgerPage } from "./types";
import { GS_SEED_AMOUNT } from "./types";
import { CURRENCIES } from "@shared/schema";

// ─── Precision helpers ────────────────────────────────────────────────────────
// Normalise amounts to 6 decimal places before any DB operation.
// NOTE: parseFloat is safe for GS$ (integer-based platform currency) and
// controlled USDC admin credits. When real USDC settlement is enabled,
// replace with decimal.js to avoid IEEE 754 precision loss.

function toDecimal(n: string | number): string {
  const f = parseFloat(String(n));
  if (!isFinite(f)) throw new Error(`Invalid amount: ${n}`);
  return f.toFixed(6);
}

function assertPositiveAmount(amount: string, label: string): void {
  const f = parseFloat(amount);
  if (!isFinite(f) || f <= 0) throw new Error(`${label} must be a positive number, got: ${amount}`);
}

function gte(a: string, b: string): boolean {
  return parseFloat(a) >= parseFloat(b);
}

// ─── Wallet initialization ────────────────────────────────────────────────────

/**
 * Idempotent: creates GS and USDC wallets for a user if they don't exist,
 * then seeds the initial GS$ fantasy balance (also idempotent — see
 * seedFantasyBalance for the double-seed guard).
 */
export async function ensureWalletsExist(userId: string): Promise<void> {
  for (const currency of CURRENCIES) {
    const existing = await repo.findWalletByUserAndCurrency(userId, currency);
    if (!existing) {
      await repo.insertWallet(userId, currency);
    }
  }
  // Apply initial GS$ seed (idempotent — no-op if already applied)
  await _seedInitial(userId);
}

/** Called at user creation — alias for ensureWalletsExist. */
export async function createWalletsForUser(userId: string): Promise<void> {
  return ensureWalletsExist(userId);
}

// ─── Fantasy seed ─────────────────────────────────────────────────────────────

/**
 * Seeds the GS$ wallet.
 *
 * IDEMPOTENT: if a wallet_seed ledger entry already exists for this user,
 * this is a no-op. This prevents accidental double-seeding from concurrent
 * signup calls or repeated admin invocations.
 *
 * All operations occur inside a single transaction with SELECT FOR UPDATE on
 * the wallet row, so concurrent calls serialize correctly.
 */
export async function seedFantasyBalance(userId: string, amount: string): Promise<void> {
  assertPositiveAmount(amount, "Seed amount");
  await ensureWalletsExist(userId);

  await db.transaction(async (tx) => {
    const wallet = await repo.findWalletForUpdate(userId, "GS", tx);
    if (!wallet) throw new Error(`GS wallet not found for user ${userId}`);

    // Idempotency guard: abort if seed already applied
    const alreadySeeded = await repo.seedEntryExists(userId, "GS", tx);
    if (alreadySeeded) return;

    const normalised = toDecimal(amount);
    const updated = await repo.applyCredit(wallet.id, normalised, tx);
    await repo.insertLedgerEntry(
      {
        userId,
        walletId: wallet.id,
        currency: "GS",
        entryType: "wallet_seed",
        direction: "credit",
        amount: normalised,
        balanceAfter: updated.availableBalance,
        description: `GS$ fantasy seed: +${amount}`,
        referenceType: null,
        referenceId: null,
        metadata: null,
      },
      tx,
    );
  });
}

/** Admin-only: credit USDC (e.g. for testing). Always creates a new ledger entry. */
export async function creditUsdc(userId: string, amount: string, description?: string): Promise<void> {
  assertPositiveAmount(amount, "USDC amount");
  await ensureWalletsExist(userId);

  await db.transaction(async (tx) => {
    const wallet = await repo.findWalletForUpdate(userId, "USDC", tx);
    if (!wallet) throw new Error(`USDC wallet not found for user ${userId}`);

    const normalised = toDecimal(amount);
    const updated = await repo.applyCredit(wallet.id, normalised, tx);
    await repo.insertLedgerEntry(
      {
        userId,
        walletId: wallet.id,
        currency: "USDC",
        entryType: "deposit",
        direction: "credit",
        amount: normalised,
        balanceAfter: updated.availableBalance,
        description: description ?? `USDC credit: +${amount}`,
        referenceType: null,
        referenceId: null,
        metadata: null,
      },
      tx,
    );
  });
}

// ─── Core accounting operations ───────────────────────────────────────────────
// Every operation:
//   1. Opens a db.transaction()
//   2. SELECT ... FOR UPDATE on the wallet (serialises concurrent mutations)
//   3. Validates balance invariant
//   4. UPDATEs wallet balance
//   5. INSERTs ledger entry
// All five steps succeed together or roll back together.

export async function creditWallet(params: CreditDebitParams): Promise<void> {
  const { userId, currency, amount, entryType, description, referenceType, referenceId, metadata } = params;
  assertPositiveAmount(amount, "Credit amount");
  await ensureWalletsExist(userId);

  await db.transaction(async (tx) => {
    const wallet = await repo.findWalletForUpdate(userId, currency, tx);
    if (!wallet) throw new Error(`${currency} wallet not found for user ${userId}`);

    const normalised = toDecimal(amount);
    const updated = await repo.applyCredit(wallet.id, normalised, tx);
    await repo.insertLedgerEntry(
      {
        userId,
        walletId: wallet.id,
        currency,
        entryType,
        direction: "credit",
        amount: normalised,
        balanceAfter: updated.availableBalance,
        description: description ?? null,
        referenceType: referenceType ?? null,
        referenceId: referenceId ?? null,
        metadata: metadata ?? null,
      },
      tx,
    );
  });
}

export async function debitWallet(params: CreditDebitParams): Promise<void> {
  const { userId, currency, amount, entryType, description, referenceType, referenceId, metadata } = params;
  assertPositiveAmount(amount, "Debit amount");
  await ensureWalletsExist(userId);

  await db.transaction(async (tx) => {
    const wallet = await repo.findWalletForUpdate(userId, currency, tx);
    if (!wallet) throw new Error(`${currency} wallet not found for user ${userId}`);

    const normalised = toDecimal(amount);
    // Validate inside the transaction on the freshly-locked row
    if (!gte(wallet.availableBalance, normalised)) {
      throw new Error(`Insufficient available ${currency} balance`);
    }

    const updated = await repo.applyDebit(wallet.id, normalised, tx);
    await repo.insertLedgerEntry(
      {
        userId,
        walletId: wallet.id,
        currency,
        entryType,
        direction: "debit",
        amount: normalised,
        balanceAfter: updated.availableBalance,
        description: description ?? null,
        referenceType: referenceType ?? null,
        referenceId: referenceId ?? null,
        metadata: metadata ?? null,
      },
      tx,
    );
  });
}

export async function lockFunds(params: LockUnlockParams): Promise<void> {
  const { userId, currency, amount, description, referenceType, referenceId } = params;
  assertPositiveAmount(amount, "Lock amount");
  await ensureWalletsExist(userId);

  await db.transaction(async (tx) => {
    const wallet = await repo.findWalletForUpdate(userId, currency, tx);
    if (!wallet) throw new Error(`${currency} wallet not found for user ${userId}`);

    const normalised = toDecimal(amount);
    if (!gte(wallet.availableBalance, normalised)) {
      throw new Error(`Insufficient available ${currency} balance to lock`);
    }

    const updated = await repo.applyLock(wallet.id, normalised, tx);
    await repo.insertLedgerEntry(
      {
        userId,
        walletId: wallet.id,
        currency,
        entryType: params.entryType ?? "lock",
        direction: "debit",
        amount: normalised,
        balanceAfter: updated.availableBalance,
        description: description ?? `Funds locked: ${amount} ${currency}`,
        referenceType: referenceType ?? null,
        referenceId: referenceId ?? null,
        metadata: null,
      },
      tx,
    );
  });
}

export async function unlockFunds(params: LockUnlockParams): Promise<void> {
  const { userId, currency, amount, description, referenceType, referenceId } = params;
  assertPositiveAmount(amount, "Unlock amount");
  await ensureWalletsExist(userId);

  await db.transaction(async (tx) => {
    const wallet = await repo.findWalletForUpdate(userId, currency, tx);
    if (!wallet) throw new Error(`${currency} wallet not found for user ${userId}`);

    const normalised = toDecimal(amount);
    if (!gte(wallet.lockedBalance, normalised)) {
      throw new Error(`Insufficient locked ${currency} balance to unlock`);
    }

    const updated = await repo.applyUnlock(wallet.id, normalised, tx);
    await repo.insertLedgerEntry(
      {
        userId,
        walletId: wallet.id,
        currency,
        entryType: params.entryType ?? "unlock",
        direction: "credit",
        amount: normalised,
        balanceAfter: updated.availableBalance,
        description: description ?? `Funds unlocked: ${amount} ${currency}`,
        referenceType: referenceType ?? null,
        referenceId: referenceId ?? null,
        metadata: null,
      },
      tx,
    );
  });
}

/**
 * Permanently consume funds from locked_balance at trade settlement.
 *
 * Effect:
 *   locked_balance    -= amount
 *   total_balance     -= amount
 *   available_balance  unchanged
 *
 * This is distinct from debitWallet (which touches available_balance).
 * Call this when a buy order fills and the reserved GS$ must be spent.
 * Validates locked >= amount inside a SELECT FOR UPDATE transaction.
 */
export async function consumeLockedFunds(params: ConsumeLockedParams): Promise<void> {
  const { userId, currency, amount, entryType, description, referenceType, referenceId, metadata } = params;
  assertPositiveAmount(amount, "Consume amount");
  await ensureWalletsExist(userId);

  await db.transaction(async (tx) => {
    const wallet = await repo.findWalletForUpdate(userId, currency, tx);
    if (!wallet) throw new Error(`${currency} wallet not found for user ${userId}`);

    const normalised = toDecimal(amount);
    if (!gte(wallet.lockedBalance, normalised)) {
      throw new Error(
        `Insufficient locked ${currency} balance. Required: ${normalised}, locked: ${wallet.lockedBalance}`,
      );
    }

    const updated = await repo.applyConsumeLocked(wallet.id, normalised, tx);
    await repo.insertLedgerEntry(
      {
        userId,
        walletId: wallet.id,
        currency,
        entryType,
        direction: "debit",
        amount: normalised,
        balanceAfter: updated.availableBalance,
        description: description ?? null,
        referenceType: referenceType ?? null,
        referenceId: referenceId ?? null,
        metadata: metadata ?? null,
      },
      tx,
    );
  });
}

// ─── Read operations ──────────────────────────────────────────────────────────

export async function getWalletSummary(userId: string): Promise<WalletSummary> {
  await ensureWalletsExist(userId);
  const rows = await repo.findWalletsByUserId(userId);
  return {
    userId,
    wallets: rows.map((w) => ({
      currency: w.currency as Currency,
      availableBalance: w.availableBalance,
      lockedBalance: w.lockedBalance,
      totalBalance: w.totalBalance,
    })),
  };
}

export async function getLedgerEntries(
  userId: string,
  options: { currency?: Currency; page?: number; limit?: number } = {},
): Promise<LedgerPage> {
  const page = options.page ?? 1;
  const limit = Math.min(options.limit ?? 50, 200);
  const { entries, total } = await repo.getLedgerEntriesForUser(userId, options.currency, page, limit);
  return { entries, total, page, limit };
}

// ─── Internal: initial GS$ seed ──────────────────────────────────────────────
// Separated from seedFantasyBalance so ensureWalletsExist can call it without
// the external assertPositiveAmount guard (amount is the platform constant).

async function _seedInitial(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const wallet = await repo.findWalletForUpdate(userId, "GS", tx);
    if (!wallet) return;

    const alreadySeeded = await repo.seedEntryExists(userId, "GS", tx);
    if (alreadySeeded) return;

    const updated = await repo.applyCredit(wallet.id, GS_SEED_AMOUNT, tx);
    await repo.insertLedgerEntry(
      {
        userId,
        walletId: wallet.id,
        currency: "GS",
        entryType: "wallet_seed",
        direction: "credit",
        amount: GS_SEED_AMOUNT,
        balanceAfter: updated.availableBalance,
        description: "Initial GS$ fantasy balance",
        referenceType: null,
        referenceId: null,
        metadata: null,
      },
      tx,
    );
  });
}

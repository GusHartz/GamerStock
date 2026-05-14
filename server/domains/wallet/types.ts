import type { Currency, EntryType, Direction, Wallet, WalletLedgerEntry } from "@shared/schema";

export type { Currency, EntryType, Direction, Wallet, WalletLedgerEntry };

// New users receive 1,000 GS$ on first wallet creation (Phase 1: 10k → 1k).
// Existing wallets are unaffected — seedFantasyBalance() is idempotent.
export const GS_SEED_AMOUNT = "1000.000000";
export const USDC_SEED_AMOUNT = "0.000000";

export interface WalletSummary {
  userId: string;
  wallets: {
    currency: Currency;
    availableBalance: string;
    lockedBalance: string;
    totalBalance: string;
  }[];
}

export interface LedgerPage {
  entries: WalletLedgerEntry[];
  total: number;
  page: number;
  limit: number;
}

export interface CreditDebitParams {
  userId: string;
  currency: Currency;
  amount: string;
  entryType: EntryType;
  description?: string;
  referenceType?: string;
  referenceId?: string;
  metadata?: Record<string, unknown>;
}

export interface LockUnlockParams {
  userId: string;
  currency: Currency;
  amount: string;
  entryType?: EntryType;
  description?: string;
  referenceType?: string;
  referenceId?: string;
}

/**
 * Consumes funds that are currently in locked_balance — a permanent debit of
 * a previously reserved amount. Unlike debitWallet (which reduces available),
 * this reduces locked and total while leaving available unchanged.
 * Used at trade settlement time to convert a hold into a real spend.
 */
export interface ConsumeLockedParams {
  userId: string;
  currency: Currency;
  amount: string;
  entryType: EntryType;
  description?: string;
  referenceType?: string;
  referenceId?: string;
  metadata?: Record<string, unknown>;
}

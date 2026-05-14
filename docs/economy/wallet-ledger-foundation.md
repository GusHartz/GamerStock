# GamerStock Economy — Wallet & Ledger Foundation

## Overview

This document describes Phase 1 of the GamerStock financial infrastructure: the multi-currency Wallet System and Universal Ledger. This forms the accounting backbone for all future financial operations on the platform.

---

## Two Currencies

### GS$ (GamerStock Dollar)
- **Type:** Internal / fantasy currency
- **Purpose:** Paper trading, Arena play, rewards, simulations, onboarding
- **On-chain:** No — exists only in the platform database
- **Starting balance:** 10,000 GS$ seeded for every new user
- **Conversion:** Cannot be converted to USDC at this time

### USDC
- **Type:** Real stablecoin (future)
- **Purpose:** Real-money trading, platform fees, player earnings, withdrawals
- **On-chain:** Not connected yet — reserved for future integration with Base/Solana/Circle
- **Starting balance:** 0.00 USDC
- **Conversion:** Cannot be converted from GS$ at this time

---

## Design Principles

1. **Ledger is the source of truth.** Every balance change writes an immutable `wallet_ledger_entries` row. The wallet balance is a derived projection.
2. **Wallet balance is an optimized cache.** `wallets.available_balance` and `wallets.locked_balance` are updated atomically alongside the ledger write for fast reads.
3. **Currencies are isolated.** GS and USDC are separate wallet rows. There is no shared balance, no automatic conversion.
4. **No negative balances.** The service layer enforces this before every debit or lock operation.
5. **Locked balance for order reservations.** When a trade order is placed, funds move from `available_balance` to `locked_balance`. On settlement, locked funds are consumed.

---

## Database Schema

### `wallets`

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `user_id` | varchar FK → users.id | CASCADE delete |
| `currency` | text enum: GS, USDC | |
| `available_balance` | numeric(18,6) | Spendable balance |
| `locked_balance` | numeric(18,6) | Reserved for open orders |
| `total_balance` | numeric(18,6) | available + locked |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

**Unique constraint:** `(user_id, currency)` — one wallet per user per currency.

### `wallet_ledger_entries`

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `user_id` | varchar | Denormalized for fast queries |
| `wallet_id` | integer FK → wallets.id | RESTRICT delete |
| `currency` | text enum: GS, USDC | |
| `entry_type` | text enum | See entry types below |
| `direction` | text enum: credit, debit | |
| `amount` | numeric(18,6) | Always positive |
| `balance_after` | numeric(18,6) | available_balance after this entry |
| `reference_type` | text nullable | e.g. "trade", "arena_reward" |
| `reference_id` | text nullable | ID of the referenced entity |
| `description` | text nullable | Human-readable explanation |
| `metadata` | jsonb nullable | Extensible payload |
| `created_at` | timestamp | Immutable once written |

**Entry types:**

| Type | Direction | When used |
|---|---|---|
| `wallet_seed` | credit | Initial GS$ balance on user creation |
| `deposit` | credit | USDC deposited (future) |
| `withdrawal` | debit | USDC withdrawn (future) |
| `reward` | credit | Arena/platform reward |
| `buy_hold` | debit | Funds locked when buy order placed |
| `buy_settle` | debit | Funds consumed when buy order fills |
| `sell_settle` | credit | Proceeds received when sell order fills |
| `fee_platform` | debit | GamerStock platform fee |
| `fee_player` | debit | Player/creator royalty fee |
| `refund` | credit | Order cancelled, locked funds returned |
| `adjustment` | credit or debit | Admin correction |
| `lock` | debit | Moves available → locked |
| `unlock` | credit | Moves locked → available |

---

## Services

**File:** `server/domains/wallet/service.ts`

| Function | Description |
|---|---|
| `createWalletsForUser(userId)` | Creates GS + USDC wallets, seeds 10,000 GS$ |
| `ensureWalletsExist(userId)` | Idempotent backfill — safe to call on every login |
| `seedFantasyBalance(userId, amount)` | Adds GS$ to a user's wallet (admin/test) |
| `creditUsdc(userId, amount, desc?)` | Adds USDC to a user's wallet (admin/test) |
| `creditWallet(params)` | Generic credit with full ledger entry |
| `debitWallet(params)` | Generic debit — enforces non-negative constraint |
| `lockFunds(params)` | Moves available → locked, writes ledger |
| `unlockFunds(params)` | Moves locked → available, writes ledger |
| `getWalletSummary(userId)` | Returns all wallets for a user |
| `getLedgerEntries(userId, opts)` | Paginated ledger history, optional currency filter |

---

## HTTP Endpoints

### User-facing (requires authentication)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/wallets/me` | Get all wallets for the logged-in user |
| `GET` | `/api/wallets/me/summary` | Same as above (alias) |
| `GET` | `/api/wallets/me/ledger` | Paginated ledger — supports `?currency=GS&page=1&limit=50` |

### Admin-only

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/admin/wallets/:userId/seed-gs` | Seed GS$ for a user. Body: `{ amount: "10000" }` |
| `POST` | `/api/admin/wallets/:userId/credit-usdc` | Credit USDC. Body: `{ amount: "100", description?: "..." }` |
| `POST` | `/api/admin/wallets/:userId/ensure` | Idempotent backfill for a specific user |

---

## Wallet Initialization

1. **New user signup:** `createWalletsForUser(userId)` is called immediately after user creation. Creates GS + USDC wallets. Seeds 10,000 GS$.
2. **Existing user login:** `ensureWalletsExist(userId)` is called fire-and-forget at login. Safe to call repeatedly — only creates missing wallets.
3. **Manual backfill:** `POST /api/admin/wallets/:userId/ensure` creates wallets for any specific user without disrupting existing balances.

---

## How Future Phases Will Use This

### Trade Settlement (Phase 2+)
When a buy order is placed:
1. `lockFunds({ currency: "GS", amount: estimatedCost })` — reserves funds
2. Order fills → `debitWallet({ entryType: "buy_settle" })` for actual cost
3. Order cancelled → `unlockFunds(...)` releases back to available

### Fee Engine
After settlement:
1. `debitWallet({ entryType: "fee_platform", ... })` — platform cut
2. `debitWallet({ entryType: "fee_player", ... })` — player royalty

### USDC Integration (Future)
The `USDC` wallet is reserved. When connected to Circle/Base/Solana:
1. On-chain deposit confirmed → `creditWallet({ currency: "USDC", entryType: "deposit" })`
2. Withdrawal request → `lockFunds(USDC)` → on-chain transaction → `debitWallet({ entryType: "withdrawal" })`

---

## Accounting Reconciliation

### Why the Ledger Is the Source of Truth

The `wallet_ledger_entries` table is an append-only, immutable audit trail. Every credit and debit that has ever occurred for a wallet is recorded there — nothing is ever updated or deleted. The `wallets` table (specifically `available_balance`, `locked_balance`, and `total_balance`) is an **optimized projection** of those entries: it exists purely so the application can read current balances with a single-row lookup instead of summing the entire ledger on every request.

Because the wallet cache is a derived value, it can theoretically diverge from the ledger if a bug bypasses the normal transaction path (e.g., a direct DB update outside the service layer). Reconciliation detects this.

### How Reconciliation Works

**`reconcileWallet(walletId)`** runs two queries against the database:

1. Reads `wallets` for the cached snapshot: `wallet_balance = total_balance = available_balance + locked_balance`
2. Runs a single SQL aggregation over `wallet_ledger_entries`:
   ```sql
   SUM(amount) WHERE direction = 'credit'  →  total_credits
   SUM(amount) WHERE direction = 'debit'   →  total_debits
   ledger_balance = total_credits - total_debits
   ```
3. Computes `difference = wallet_balance - ledger_balance`
4. Returns `status: "OK"` when `|difference| < 0.000001`, otherwise `"MISMATCH"`

**`reconcileUser(userId)`** runs `reconcileWallet` for every wallet owned by that user and aggregates results into a single response with an `overall_status`.

The aggregation runs in a single SQL pass using `SUM(CASE WHEN ...)` — no row-by-row iteration in application memory regardless of how many ledger entries exist.

### Admin Endpoints

Both endpoints require admin authentication.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/accounting/reconcile-wallet/:walletId` | Reconcile a single wallet by its numeric ID |
| `GET` | `/api/admin/accounting/reconcile-user/:userId` | Reconcile all wallets for a user |

**Example response — reconcile-user:**
```json
{
  "userId": "da6a2dd7-...",
  "overall_status": "OK",
  "wallets": [
    {
      "walletId": 1,
      "currency": "GS",
      "wallet_balance": "10000.000000",
      "ledger_balance": "10000.000000",
      "difference": "0.000000",
      "total_credits": "10000.000000",
      "total_debits": "0.000000",
      "entry_count": 1,
      "status": "OK"
    },
    {
      "walletId": 2,
      "currency": "USDC",
      "wallet_balance": "0.000000",
      "ledger_balance": "0.000000",
      "difference": "0.000000",
      "total_credits": "0.000000",
      "total_debits": "0.000000",
      "entry_count": 0,
      "status": "OK"
    }
  ]
}
```

### When to Use These Tools

- **Routine audits:** Run `reconcile-user` on any user reporting an incorrect balance to immediately determine if the wallet cache has drifted from the ledger.
- **After incidents:** Run reconciliation across affected users if a bug or failed transaction is suspected to have corrupted wallet state.
- **Pre-deploy checks:** Before and after any migration that touches the `wallets` or `wallet_ledger_entries` tables, reconcile a sample of users to confirm consistency.
- **These tools are read-only.** They never modify wallet state. Invoking them is always safe and has no side effects.

### Implementation

**File:** `server/domains/wallet/reconciliation.ts`

| Function | Description |
|---|---|
| `reconcileWallet(walletId)` | Single-wallet reconciliation using SQL aggregation |
| `reconcileUser(userId)` | Runs reconcileWallet for every wallet owned by the user |

---

## Current Limitations

- USDC wallets exist as empty placeholders; no on-chain connectivity yet
- No GS$ ↔ USDC conversion
- No withdrawal flow
- No payout flow to players
- Trade settlement does not yet call `lockFunds` / `debitWallet` — that comes when trading is wired to the wallet system
- No frontend wallet UI — balances readable via API only

# GamerStock Economy — Trade Settlement Engine (GS$)

## Overview

This document describes Phase 2 of the GamerStock financial infrastructure: the Trade Settlement Engine for GS$ (GamerStock Dollar). It connects the fantasy trading layer to the Wallet & Ledger system established in Phase 1.

All settlement in this phase is GS$ only. USDC settlement, fee splitting, and player earnings pools are deferred to Phase 3 (Fee Engine).

---

## Core Concepts

### The Difference Between Hold and Settlement

These are two distinct accounting operations that must never be conflated.

| Operation | When | Ledger Type | Effect on Wallet |
|---|---|---|---|
| **Hold** (`buy_hold`) | Order is placed | `buy_hold` / debit | `available ↓`, `locked ↑`, total unchanged |
| **Settlement** (`buy_settle`) | Trade fills | `buy_settle` / debit | `locked ↓`, `total ↓`, available unchanged |
| **Release** (`unlock`) | Order cancelled/expired | `unlock` / credit | `locked ↓`, `available ↑`, total unchanged |
| **Sell credit** (`sell_settle`) | Seller receives proceeds | `sell_settle` / credit | `available ↑`, `total ↑` |

The hold/settlement split is critical: `available_balance` reflects only unencumbered funds. A user with a pending buy order sees their available balance reduced immediately (the hold), but their total balance only decreases when the trade actually settles.

---

## Accounting Flows

### Buy Order Placement

```
User places buy order for 1,000 GS$

reserveBuyOrderFunds(userId, orderId, "1000")
→ lockFunds(GS, 1000, entryType=buy_hold)

Before:  available=10000  locked=0    total=10000
After:   available=9000   locked=1000 total=10000
```

### Order Cancelled or Expired

```
Order is cancelled — release the full reserved amount

releaseBuyOrderFunds(userId, orderId, "1000", "cancelled")
→ unlockFunds(GS, 1000, entryType=unlock)

Before:  available=9000   locked=1000 total=10000
After:   available=10000  locked=0    total=10000
```

### Matched Trade (Full Fill)

```
Order fills completely at the reserved price

settleMatchedTrade(tradeId, buyOrderId, sellOrderId,
  buyerUserId, sellerUserId, grossAmountGS="1000", releaseAmount="0")

Buyer side:
  applyConsumeLocked(1000)      → locked ↓1000, total ↓1000
  → buy_settle ledger entry

  Before:  available=9000   locked=1000 total=10000
  After:   available=9000   locked=0    total=9000

Seller side:
  applyCredit(1000)             → available ↑1000, total ↑1000
  → sell_settle ledger entry

  Before:  available=10000  locked=0  total=10000
  After:   available=11000  locked=0  total=11000
```

### Partial Fill with Remainder Release

```
Order reserved 1,000 GS$, fills for 700 GS$ — 300 excess to release

settleMatchedTrade(..., grossAmountGS="700", releaseAmount="300")

Step 1: applyConsumeLocked(700)  → locked ↓700, total ↓700
  → buy_settle ledger entry

Step 2: applyUnlock(300)         → locked ↓300, available ↑300
  → unlock ledger entry

Net buyer result:
  Before:  available=9000   locked=1000 total=10000
  After:   available=9300   locked=0    total=9300

Seller receives 700 GS$ (sell_settle credit)
```

---

## How `consumeLockedFunds` Works

This is a new wallet operation added in Phase 2. It permanently converts a hold into a real spend:

```
locked_balance    -= amount   (hold consumed)
total_balance     -= amount   (net asset leaves the wallet)
available_balance   unchanged (never touched — funds were already locked)
```

This is different from both:
- `debitWallet` — which reduces `available_balance` (for immediate, unreserved spends)
- `unlockFunds` — which moves locked → available without reducing total

The DB-level `CHECK` constraint (`total_balance = available_balance + locked_balance`) enforces correctness at the storage layer.

---

## Atomicity Guarantee (Buyer/Seller Consistency)

`settleMatchedTrade` wraps all buyer and seller operations in a single `db.transaction()`. This means:

- Buyer's locked is consumed AND seller is credited in the same database transaction
- If any step fails, the entire transaction rolls back
- There is no possible state where the buyer is debited but the seller is not credited, or vice versa

### Deadlock Prevention

When two wallets must both be locked, they are always acquired in **ascending wallet ID order**. This eliminates the possibility of lock cycles between concurrent settlements on overlapping user pairs:

```typescript
const [lowId, highId] = [buyerWalletId, sellerWalletId].sort((a, b) => a - b);
const lowWallet  = await tx.select()...WHERE id = lowId  FOR UPDATE;
const highWallet = await tx.select()...WHERE id = highId FOR UPDATE;
```

---

## Idempotency

`settleMatchedTrade` cannot double-settle the same trade. Before opening the transaction, it checks whether a `buy_settle` ledger entry with `reference_type='trade'` and `reference_id=tradeId` already exists. If found, it returns immediately with `idempotent: true` and makes no changes. Safe to call multiple times.

---

## Ledger Audit Trail

Every settlement produces clearly labelled, immutable ledger entries with `reference_type` and `reference_id` set:

| Scenario | entry_type | reference_type | reference_id |
|---|---|---|---|
| Buy order placed | `buy_hold` | `order` | orderId |
| Order cancelled | `unlock` | `order` | orderId |
| Trade fills (buyer) | `buy_settle` | `trade` | tradeId |
| Partial fill excess | `unlock` | `order` | buyOrderId |
| Trade fills (seller) | `sell_settle` | `trade` | tradeId |

To audit all activity for a specific trade: query `wallet_ledger_entries WHERE reference_type = 'trade' AND reference_id = '<tradeId>'`.

---

## Services

**File:** `server/domains/trade-settlement/service.ts`

| Function | Description |
|---|---|
| `reserveBuyOrderFunds(params)` | Locks GS$ when a buy order is placed (`buy_hold`) |
| `releaseBuyOrderFunds(params)` | Unlocks GS$ on cancellation/expiry/partial remainder |
| `settleMatchedTrade(params)` | Atomically settles buyer+seller in one transaction |

**File:** `server/domains/wallet/service.ts` (Phase 2 addition)

| Function | Description |
|---|---|
| `consumeLockedFunds(params)` | Permanently deducts from `locked_balance` and `total_balance` |

---

## Admin Endpoints (Internal Only)

These endpoints are admin-authenticated and exist solely for architecture validation. They are not exposed in any user-facing interface.

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/admin/trades/reserve-buy` | Manually reserve GS$ for a buy order |
| `POST` | `/api/admin/trades/release-buy` | Release reserved GS$ from a buy order |
| `POST` | `/api/admin/trades/settle` | Manually settle a trade between buyer and seller |

**reserve-buy body:**
```json
{ "userId": "...", "orderId": "order-001", "reserveAmount": "500", "assetId": "faker" }
```

**release-buy body:**
```json
{ "userId": "...", "orderId": "order-001", "releaseAmount": "200", "reason": "cancelled" }
```

**settle body:**
```json
{
  "tradeId": "trade-001",
  "buyOrderId": "order-001", "sellOrderId": "order-002",
  "buyerUserId": "...", "sellerUserId": "...",
  "assetId": "faker", "quantity": 10, "executionPrice": "50",
  "grossAmountGS": "500", "releaseAmount": "0"
}
```

---

## Current Limitations (Pre-Phase 3)

| Feature | Status |
|---|---|
| GS$ settlement | Implemented |
| USDC settlement | Not implemented |
| Platform fee deduction | Not implemented (Phase 3) |
| Player earnings distribution | Not implemented (Phase 3) |
| Seller receives gross amount | Yes — no fee taken from seller proceeds yet |
| Integration with TradeExecutor | Not wired — settlement layer is ready to be called |
| Order book / matching engine | Unchanged — this layer only handles accounting |
| Frontend wallet display | Not implemented — balances readable via API |

### What Phase 3 (Fee Engine) Will Add

After settlement, the Fee Engine will:
1. Deduct platform fee from buyer's consumed amount or seller's proceeds
2. Distribute player creator royalty to the player's fee balance
3. Record `fee_platform` and `fee_player` ledger entries
4. The `sellerReceives = grossAmountGS - fees` instead of the current gross pass-through

The settlement service is structured to accommodate this cleanly — the fee deduction will happen inside the same `db.transaction()` before the `sell_settle` credit.

# Prediction Markets — Sprint 2: Market Resolution & Settlement

## Overview

Sprint 2 (settlement) adds the ability for admins to resolve a binary prediction market
and immediately settle all open positions with auditable wallet/ledger operations.

**Entry point:** `POST /api/predictions/markets/:id/resolve`  
**Auth:** Admin-only (`isAdminOnly` middleware)  
**Service function:** `predictionService.resolveAndSettleMarket()`

---

## Resolution Entry Point

```
POST /api/predictions/markets/:id/resolve
Content-Type: application/json
X-Admin-Session: required

{
  "winningOutcomeId":  1,              // Required — must belong to the market
  "resolutionSource":  "manual_admin", // Optional — origin of resolution decision
  "note":              "FURIA 2-0"     // Optional — human-readable note
}
```

**Market eligibility:** Market must be in `"locked"` status to be resolved.  
Attempting to resolve an `"open"` or `"draft"` market returns a 422 error.  
Resolving an already-`"settled"` market returns `duplicate: true` immediately (idempotent).  
Resolving an already-`"resolved"` market re-runs settlement for any unsettled positions (partial retry path).

---

## Settlement Algorithm

```
A  Validate market exists + status ∈ {locked, resolved}
B  Validate winningOutcomeId belongs to market
C  If status == "resolved" AND resolvedOutcomeId differs → reject (cannot re-resolve)
D  If status == "locked":
     markOutcomeAsWinner(winningOutcomeId)
     updateMarketStatus(locked → resolved, { resolveAt, resolvedOutcomeId })
E  Fetch all active positions for market
F  For each position:
     i   findSettlementByPositionId(positionId) → skip if exists
     ii  isWinner = (position.outcomeId === winningOutcomeId)
     iii grossPayout = isWinner ? quantity * 1.0 : 0.0
     iv  fees        = 0.0 (Sprint 2)
     v   netPayout   = grossPayout - fees
     vi  walletLedgerRef = "pred_settle_pos_{positionId}"
     vii consumeLockedFunds(costBasis)  — all positions
     viii if isWinner: creditWallet(netPayout)
     ix  INSERT prediction_settlements row
     x   updatePositionStatus → "settled" (with payout, payoutAt, realizedPnl)
G  updateMarketStatus(resolved → settled, { settledAt })
H  Return ResolveAndSettleResult
```

---

## Payout Formula (Binary, Sprint 2)

```
grossPayout (winner) = quantity × 1.00 GS$    (1 share = 1 GS$ at resolution)
grossPayout (loser)  = 0.00 GS$

fees        = 0.00 GS$                          (rake deferred to Sprint 3)

netPayout   = grossPayout − fees
realizedPnl = netPayout − costBasis             (profit/loss for the position)
```

**Assumptions:**
- Binary markets only (Sprint 2). Multi-outcome / scalar markets are excluded.
- No platform rake in Sprint 2. A fee deduction hook is already present in the code
  (`fees = 0.000000`) and is ready to be wired to a platform fee calculation in Sprint 3.
- Each winning share pays exactly 1.00 GS$ regardless of market price at entry.
  This is a fixed-payout model, not a true pari-mutuel system.
  True pari-mutuel (pool total / winner pool share) is deferred to Sprint 3.

---

## Wallet / Ledger Integration

### Operations per position

| Position | Wallet Operation | Entry Type | Direction | Amount |
|---|---|---|---|---|
| All | `consumeLockedFunds(costBasis)` | `buy_settle` | debit | costBasis |
| Winner only | `creditWallet(netPayout)` | `sell_settle` | credit | netPayout |

### Ledger reference traceability

| Field | Value |
|---|---|
| `referenceType` | `"prediction_settlement"` |
| `referenceId` | `"pred_settle_pos_{positionId}"` |
| `ledgerReferenceId` (on settlement row) | `"pred_settle_pos_{positionId}"` |

Both wallet ledger entries (consume + credit) share the same `referenceId`,
linking them to the same settlement event. The `prediction_settlements.ledger_reference_id`
column records the same value so any settlement row can be traced back to the wallet ledger.

### Example ledger entries (from live smoke test)

```
entry_type  | direction | amount    | currency | reference_type        | reference_id
buy_settle  | debit     | 7.000000  | GS       | prediction_settlement | pred_settle_pos_1
sell_settle | credit    | 14.000000 | GS       | prediction_settlement | pred_settle_pos_1
```

---

## Idempotency Safeguards

Three layers of protection prevent double-settlement:

1. **Market-level gate**: If `market.status === "settled"`, return `duplicate: true` immediately
   with the existing summary. No wallet operations are replayed.

2. **Position-level read-before-write**: `findSettlementByPositionId(positionId)` is called
   before each position is processed. If a settlement row already exists, the position is
   skipped (`skipped: true`) and counted in `positionsSkipped`.

3. **DB unique index (partial)**: Applied at route startup:
   ```sql
   CREATE UNIQUE INDEX IF NOT EXISTS pred_settlements_position_unique
   ON prediction_settlements (position_id)
   WHERE position_id IS NOT NULL;
   ```
   This is the final safety net — concurrent calls that pass the read-before-write check
   simultaneously will fail at the DB level with a `23505` unique violation,
   which is caught and treated as a skip.

4. **Re-resolve conflict guard**: If the market is already `"resolved"` (partial retry case)
   and `winningOutcomeId` differs from `market.resolvedOutcomeId`, the call is rejected with 422.

---

## Market Status Rules After Settlement

| State | Market status | Position status | position.payout | position.realizedPnl |
|---|---|---|---|---|
| During resolution | `resolved` | `active` | null | null |
| After full settlement | `settled` | `settled` | netPayout | netPayout − costBasis |
| Loser positions | `settled` | `settled` | `0.000000` | `0 − costBasis` |

---

## Position and Market Status Flow

```
Market:    open → [locked] → resolved → settled
Position:  active ──────────────────→ settled
```

The `locked` status is required before resolution.
If a market is `open`, first call:
```
POST /api/predictions/markets/:id/transition  { "targetStatus": "locked" }
```

---

## Example Request / Response

### Successful resolve

```
POST /api/predictions/markets/1/resolve
{ "winningOutcomeId": 1, "resolutionSource": "manual_admin", "note": "FURIA 2-0 NAVI" }

200 OK
{
  "marketId": 1,
  "winningOutcomeId": 1,
  "status": "settled",
  "duplicate": false,
  "positionsSettled": 1,
  "positionsSkipped": 0,
  "totalWinnerPayout": "14.000000",
  "totalStakeConsumed": "7.000000",
  "settlements": [
    {
      "positionId": 1,
      "userId": "fbd8cb9f-...",
      "outcomeId": 1,
      "isWinner": true,
      "costBasis": "7.000000",
      "grossPayout": "14.000000",
      "fees": "0.000000",
      "netPayout": "14.000000",
      "walletLedgerRef": "pred_settle_pos_1",
      "settlementId": 1,
      "skipped": false
    }
  ]
}
```

### Duplicate resolve (market already settled)

```
POST /api/predictions/markets/1/resolve
{ "winningOutcomeId": 1 }

200 OK
{
  "marketId": 1,
  "winningOutcomeId": 1,
  "status": "settled",
  "duplicate": true,
  "positionsSettled": 0,
  "positionsSkipped": 1,
  "totalWinnerPayout": "14.000000",
  "totalStakeConsumed": "0.000000",
  "settlements": []
}
```

### Invalid outcome for market

```
POST /api/predictions/markets/1/resolve
{ "winningOutcomeId": 9999 }

422 Unprocessable Entity
{ "message": "Outcome #9999 does not belong to market #1." }
```

### Market not found

```
POST /api/predictions/markets/9999/resolve
{ "winningOutcomeId": 1 }

422 Unprocessable Entity
{ "message": "Prediction market not found." }
```

### Market not eligible for resolution

```
POST /api/predictions/markets/2/resolve   (market status = "open")
{ "winningOutcomeId": 3 }

422 Unprocessable Entity
{ "message": "Market cannot be resolved from status 'open'. Must be 'locked'." }
```

### Unauthorized (non-admin)

```
POST /api/predictions/markets/1/resolve
{ "winningOutcomeId": 1 }

403 Forbidden
{ "message": "Forbidden" }
```

---

## Files Created / Modified

| File | Change |
|---|---|
| `server/domains/prediction/service.ts` | Added `resolveAndSettleMarket()` |
| `server/domains/prediction/routes.ts` | Added `POST /markets/:id/resolve`; DB unique index at startup |
| `server/domains/prediction/validators.ts` | Added `resolveMarketSchema` |
| `server/domains/prediction/types.ts` | Added `ResolveMarketInput`, `PositionSettlementRecord`, `ResolveAndSettleResult` |
| `server/domains/prediction/repository.ts` | Added `findActivePositionsByMarket`, `findSettlementByPositionId`, `updatePositionStatus` |
| `docs/architecture/prediction-sprint2-settlement.md` | This document |

---

## Remaining TODOs (Sprint 3)

1. **Platform rake**: Deduct fee from winners before `creditWallet`.
   Fee rate stored per-market (`predictionMarkets.fee_rate` — column TBD).
   Separate `fee_platform` ledger entry per winner for revenue reporting.

2. **Cancellation**: `POST /api/predictions/markets/:id/cancel`
   For each active position: `walletService.unlockFunds(costBasis)` + settlement row with
   `grossPayout=0`, `netPayout=0`, `entryType="refund"`.

3. **Auto-lock job**: Cron/background task that transitions `open → locked` when `closeAt` elapses.
   Prevents new orders from being placed after market close time.

4. **True pari-mutuel payout**: Replace the fixed 1.00-per-share formula with
   `poolTotal / winnerPoolShare × ownedShares`. Requires accurate `predictionMarketStats.poolTotal`
   and per-outcome `poolShare` tracking (both already written in Sprint 2 order placement).

5. **Loser refund partial-payback option**: Some market types offer loser partial refund
   (e.g., 10% back). Wire `refund` entry type if needed.

6. **Realtime broadcasting**: Emit a WebSocket event on settlement completion
   so frontend positions update in real-time without polling.

7. **Admin audit log**: Record who resolved the market, when, and with what `resolutionSource` + `note`.
   Currently logged to console only.

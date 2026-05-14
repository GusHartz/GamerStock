# Prediction Markets — Sprint 2: Order Placement

## Overview

Sprint 2 implements the first real transactional foundation for Prediction Markets.
Users can now place prediction orders with funds locked from their GS$ wallet.

---

## Order Placement Flow

```
POST /api/predictions/orders
```

### Step-by-step

| Step | What happens | Atomic? |
|------|-------------|---------|
| 1 | **Idempotency check** — query `prediction_orders.idempotency_key` (UNIQUE); if found, return existing order | DB read |
| 2 | **Market validation** — market must exist, status = `open`, `closeAt` not elapsed | — |
| 3 | **Outcome validation** — outcome must belong to the market | — |
| 4 | **Amount validation** — `quantity > 0`, `price ∈ (0,1)`, `totalValue = quantity × price ≥ minStake` | — |
| 5 | **Create "pending" order** — inserts `prediction_orders` with `status = pending`; UNIQUE on `idempotency_key` prevents concurrent duplicates | DB tx |
| 6 | **Lock funds** — `walletService.lockFunds({ entryType: "lock", referenceType: "prediction_order", referenceId: orderId })` | Wallet tx (SELECT FOR UPDATE) |
| 7 | **Fill order + upsert position** — `status → filled`; update or create `prediction_positions` | DB ops |
| 8 | **Pool + snapshot** (best-effort, fire-and-forget) — increment `prediction_markets.pool_total`, `prediction_outcomes.pool_share`, insert `prediction_price_snapshots` | async |

---

## Wallet Lock Behavior

| Field | Value |
|-------|-------|
| `entryType` | `"lock"` |
| `direction` | `"debit"` (moves from available_balance → locked_balance) |
| `referenceType` | `"prediction_order"` |
| `referenceId` | `String(order.id)` |
| `description` | `"Prediction bet lock: {qty} shares @ {price} {currency} — market #{id}, outcome #{id}"` |

The `walletLedgerRef` stored in `prediction_positions` is `pred_ord_{orderId}` — links the
position projection back to the wallet ledger entry.

---

## Position Projection

`prediction_positions` is a **PROJECTION** of filled orders, not the financial source of truth
(the wallet ledger is). Fields updated on each fill:

| Field | Value |
|-------|-------|
| `quantity` | cumulative shares held |
| `cost_basis` | cumulative GS$ locked |
| `avg_price` | `cost_basis / quantity` (recalculated on each fill) |
| `stake` | same as `cost_basis` (legacy field retained for Sprint 1 compat) |
| `wallet_ledger_ref` | most recent `pred_ord_{id}` reference |
| `status` | `active` (until settlement) |

---

## Order Status State Machine (Sprint 2)

```
pending   →  filled    (wallet lock succeeded + position upserted)
pending   →  failed    (wallet lock failed — insufficient funds or error)
filled    →  (future: cancelled, settled)
```

---

## Idempotency

Client sends an idempotency key:
- **Header**: `Idempotency-Key: <key>` (takes precedence)
- **Body**: `idempotencyKey: "<key>"`
- **Auto-generated** if neither is provided (using `nanoid(24)`)

The `prediction_orders.idempotency_key` column has a UNIQUE constraint. A duplicate key
returns the original order result with `duplicate: true` in the response (HTTP 200 instead
of 201).

---

## Endpoint

### `POST /api/predictions/orders`

**Auth**: User session required

**Request body**:
```json
{
  "marketId":  1,
  "outcomeId": 1,
  "quantity":  "10.000000",
  "price":     "0.500000",
  "currency":  "GS",
  "idempotencyKey": "optional-client-key"
}
```

**Success (201)**:
```json
{
  "orderId":         42,
  "positionId":      7,
  "totalValue":      "5.000000",
  "currency":        "GS",
  "walletLedgerRef": "pred_ord_42",
  "status":          "filled",
  "idempotencyKey":  "pred_abc123...",
  "duplicate":       false
}
```

**Duplicate replay (200)**:
```json
{
  "orderId":         42,
  "positionId":      7,
  "totalValue":      "5.000000",
  "currency":        "GS",
  "walletLedgerRef": "pred_ord_42",
  "status":          "filled",
  "idempotencyKey":  "optional-client-key",
  "duplicate":       true
}
```

**Error responses**:

| HTTP | Scenario |
|------|----------|
| 400 | Validation error (invalid quantity/price format, missing fields) |
| 401 | Not authenticated |
| 422 | Market not open / expired / outcome mismatch / insufficient funds / stake out of bounds |
| 500 | Unexpected server error |

---

## New Endpoints in Sprint 2

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/predictions/orders` | User | Place a prediction order (wallet-locked) |
| `GET`  | `/api/predictions/me/orders` | User | List caller's prediction orders |

---

## Atomicity Limitations (Sprint 2)

Steps 5 (order insert) and 6 (wallet lock) run in separate database transactions —
the same pattern used by the existing trading domain. A failure between steps 6 and 7
would leave funds locked with the order in `pending` state. These are reconcilable via:

- `wallet_ledger_entries` where `reference_type = 'prediction_order'`
- `prediction_orders` where `status = 'pending'` and age > threshold

Full two-phase commit atomicity is deferred to Sprint 3.

---

## What Remains for Sprint 3+

- **Settlement engine**: `consumeLockedFunds` + `creditWallet` pro-rata per winner
- **Cancellation refunds**: `unlockFunds` per active position
- **Auto-lock job**: background task to transition `open → locked` when `closeAt` elapses
- **Sell-side**: netting positions (requires matching engine design)
- **Frontend UI**: order placement form, position viewer, market page

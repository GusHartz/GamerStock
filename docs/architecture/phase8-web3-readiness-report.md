# Phase 8 — Web3 Readiness Report

**Date:** 2026-03-09  
**Status:** ✅ Complete — server boots clean, bridge registered, zero breaking changes

---

## Objective

Create the `server/web3/` layer — a set of pure interface contracts, typed models, and an event-driven bridge that positions GamerStock to integrate blockchain infrastructure in future phases, without coupling the current Web2 core to any external dependency.

**Principle:** Web2-first, Web3-ready. Core services never import from `server/web3/`. Web3 listens via the event bus.

---

## Directory Structure Created

```
server/web3/
  interfaces/
    wallet-link-adapter.ts         ← Wallet linking contract
    treasury-settlement-adapter.ts ← Fee payout/settlement contract
    asset-mirror-adapter.ts        ← On-chain event mirroring contract
  models/
    external-identity.ts           ← External wallet identity model
    wallet-link.ts                 ← Wallet link record + nonce model
  services/
    web3-event-bridge.ts           ← Event bus observer + adapter injection
  index.ts                         ← Public API
```

---

## Interfaces Created

### `WalletLinkAdapter`

Defines the contract for linking an external wallet to a GamerStock user account.

| Method | Responsibility |
|---|---|
| `requestLink(req)` | Generate a nonce for the user to sign |
| `confirmLink(confirmation)` | Verify the signed nonce, persist the WalletLink |
| `unlink(userId, walletAddress)` | Remove a linked wallet |
| `listLinkedWallets(userId)` | Return all active wallet links for a user |
| `isWalletLinked(address)` | Check if a wallet is already linked to any user |

**Future implementations:** MetaMask / WalletConnect (SIWE), Privy embedded wallets, Magic Link.

---

### `TreasurySettlementAdapter`

Defines the contract for settling accumulated player fees from `playerFeeBalance` to on-chain wallets.

| Method | Responsibility |
|---|---|
| `queuePayout(params)` | Create a settlement intent record (pre-submission) |
| `markSettled(intentId, txHash)` | Confirm on-chain tx is finalized |
| `markFailed(intentId, reason)` | Record tx failure |
| `getSettlementStatus(intentId)` | Check current payout status |
| `listPendingPayouts(userId)` | List all unresolved intents for a user |
| `estimateGasCost(amount, chainId)` | Inform users of expected gas cost |

**How it connects to GamerStock treasury:** `playerFeeBalance` (PostgreSQL) is the authoritative source. Settlement reads from it, creates an intent, submits on-chain, marks resolved. The PostgreSQL balance is the off-chain record; the on-chain transfer is the settlement.

---

### `AssetMirrorAdapter`

Defines the contract for recording GamerStock in-game events on a public ledger. This is provable event logging, not full tokenization.

| Method | Responsibility |
|---|---|
| `mirrorTrade(params)` | Record a buy/sell on-chain (immutable audit trail) |
| `mirrorTreasuryCredit(params)` | Record fee credit on-chain |
| `mirrorSeasonReward(params)` | Record Arena season rewards for provability |
| `getMirrorStatus(mirrorId)` | Check if a mirror event was confirmed |
| `isActive()` | Health check — returns false until implementation is injected |

---

## Models Created

### `ExternalIdentity`

Represents a verified external identity linked to a GamerStock user. Broader than a wallet — supports EVM, Solana, Privy, Magic, and future providers.

Key fields: `id`, `userId`, `provider` (EVM/SOLANA/PRIVY/MAGIC), `externalAddress`, `chainId`, `status` (PENDING/ACTIVE/REVOKED/SUSPENDED), `verifiedAt`.

Utility functions: `normalizeAddress()`, `looksLikeEvmAddress()`, `looksLikeSolanaAddress()`.

**Phase 8:** Code model only. No `external_identities` table yet.

---

### `WalletLink`

The persisted result of a successful `WalletLinkAdapter.confirmLink()` call. Represents a confirmed, active wallet-to-user binding.

Key fields: `id`, `userId`, `walletAddress`, `chainId`, `isPrimary`, `status` (ACTIVE/REVOKED), `linkedAt`.

Also includes `WalletLinkNonce` — the short-lived challenge record for the SIWE handshake.

Utility functions: `buildSiweMessage()` (EIP-4361 format), `generateLinkNonce()`.

**Phase 8:** Code model only. No `wallet_links` table yet.

---

## Events Observed by the Web3EventBridge

The bridge registers four handlers on the event bus (Phase 7):

| Handler name | Event | Current behavior | Phase 9+ behavior |
|---|---|---|---|
| `web3:mirror-trade` | `TradeExecuted` | Observation / debug log | Call `assetMirrorAdapter.mirrorTrade()` |
| `web3:mirror-fee` | `FeeCaptured` | Observation / debug log | Call `mirrorTreasuryCredit()`, optionally `queuePayout()` above threshold |
| `web3:mirror-xp` | `ArenaXpGranted` | Observation / debug log | Call `mirrorSeasonReward()` for season-triggered rewards |
| `web3:observe-valuation` | `ValuationUpdated` | Observation / debug log | Feed on-chain oracle price updates when confidence is high |

All handlers are `emitBackground()` consumers — errors are caught, never propagated to the core request path.

---

## How Future Integrations Will Work

### Wallet Linking Flow (Phase 9+)

```
1. POST /api/user/wallet/link-request  → calls walletLinkAdapter.requestLink()
                                         → returns { nonce, expiresAt }
2. Frontend: user signs nonce with wallet (SIWE for EVM)
3. POST /api/user/wallet/link-confirm  → calls walletLinkAdapter.confirmLink()
                                         → verifies signature
                                         → persists WalletLink row in DB
4. User now has a linked wallet visible in their profile
```

**Core unchanged:** No auth changes. No session changes. Wallet is additive metadata on the user record.

---

### Treasury Settlement Flow (Phase 9+)

```
GamerStock trade executes
  → feeLedger row inserted
  → playerFeeBalance incremented (existing, unchanged)

FeeCaptured event emitted (Phase 7/8 bridge observes)
  → if playerFee >= AUTO_SETTLEMENT_THRESHOLD_GS:
      → treasurySettlementAdapter.queuePayout()
      → creates settlement_intents row
      
Settlement worker (cron/manual):
  → reads pending intents
  → constructs on-chain ERC-20 transfer
  → broadcasts tx
  → calls markSettled(intentId, txHash) on confirmation
  → or markFailed(intentId, reason) on revert
```

**Core unchanged:** `playerFeeBalance` remains the authoritative off-chain record. On-chain transfer is settlement, not the source of truth.

---

### Asset Mirroring Flow (Phase 9+)

```
Trade executes in GamerStock
  → TradeExecuted event emitted
  → web3:mirror-trade handler fires
  → assetMirrorAdapter.mirrorTrade() submits on-chain event
  → mirror_events row created with txHash + status
```

**Key distinction:** Mirroring is write-only event logging. It does NOT change who owns shares inside GamerStock. The canonical ownership record is PostgreSQL `riotPositions`. On-chain mirror is a provability layer.

---

## Schema Changes Required (Phase 9+)

No schema changes in Phase 8. Future tables needed:

| Table | Purpose |
|---|---|
| `external_identities` | Stores linked wallet addresses per user |
| `wallet_links` | Active confirmed wallet bindings |
| `wallet_link_nonces` | Short-lived challenge nonces (TTL: ~10 min) |
| `settlement_intents` | Pending/confirmed/failed payout intents |
| `mirror_events` | On-chain event submission records |

---

## Bootstrap — `server/index.ts`

```typescript
registerAllHandlers();   // Phase 7 — domain event handlers
registerWeb3Bridge();    // Phase 8 — web3 observer (after event handlers)
```

Boot log output (confirmed live):
```
[Web3Bridge] Event bridge registered (observation mode, no adapters active).
```

---

## Adapter Injection API

```typescript
import { setWeb3Adapters } from "./web3";

// Called when concrete implementations are available:
setWeb3Adapters({
  walletLink: new EvmWalletLinkAdapter(viemClient),
  treasury: new UsdcSettlementAdapter(viemClient),
  mirror: new PolygonMirrorAdapter(viemClient),
});
```

Until `setWeb3Adapters()` is called, all adapter references are `null` and handlers skip adapter calls silently. The bridge runs in pure observation mode — zero impact on performance or behavior.

---

## What Still Needs to Be Done for a Real Web3 Implementation

| Item | Description | Phase |
|---|---|---|
| Concrete `WalletLinkAdapter` | Implement EVM SIWE verification (viem `verifyMessage` or ethers `recoverAddress`) | Phase 9 |
| Concrete `TreasurySettlementAdapter` | Implement ERC-20 USDC transfer via viem + Base/Polygon | Phase 9 |
| Concrete `AssetMirrorAdapter` | Implement on-chain event submission (custom event contract or TheGraph) | Phase 10 |
| DB schema | Add `wallet_links`, `external_identities`, `settlement_intents`, `mirror_events` tables | Phase 9 |
| Routes | Add wallet linking endpoints (`/api/user/wallet/*`) | Phase 9 |
| FeeCaptured emitter | Wire `FeeCaptured` event emission in `tradeExecutor.ts` (deferred from Phase 7) | Phase 8.5 |
| Frontend | Wallet connect button, linked wallets page, payout status | Phase 10 |
| Chain selection | Multi-chain support (Base, Polygon, Ethereum mainnet) | Phase 10 |
| Key management | Signer key for treasury payouts (AWS KMS or similar) | Phase 9 |

---

## No Breaking Changes — Confirmation

- ✅ No schema changes
- ✅ No DB changes
- ✅ No API route changes
- ✅ No core service changes (trading, valuation, arena untouched)
- ✅ No frontend changes
- ✅ Bridge handlers are fire-and-forget, errors isolated
- ✅ Server boots clean, zero startup errors
- ✅ `[Web3Bridge] Event bridge registered (observation mode, no adapters active).` confirmed in boot log

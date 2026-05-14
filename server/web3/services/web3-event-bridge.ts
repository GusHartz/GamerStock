/**
 * Web3EventBridge — Domain Event Observer
 *
 * Listens to the GamerStock internal event bus (Phase 7) and prepares
 * extension points for future on-chain actions.
 *
 * ─── Current mode (Phase 8): OBSERVATION ONLY ────────────────────────────────
 * All handlers observe events and structure the data that would be sent
 * to Web3 adapters. No on-chain calls are made. No external network calls.
 *
 * ─── Future mode (Phase 9+): ACTIVE BRIDGING ─────────────────────────────────
 * When concrete adapter implementations are provided (e.g., an EVM adapter
 * backed by viem/ethers), the bridge will:
 *   - Call assetMirrorAdapter.mirrorTrade() on TradeExecuted
 *   - Call assetMirrorAdapter.mirrorTreasuryCredit() on FeeCaptured
 *   - Call assetMirrorAdapter.mirrorSeasonReward() on ArenaXpGranted
 *   - Call treasurySettlementAdapter.queuePayout() on FeeCaptured (above threshold)
 *
 * ─── Extension points ─────────────────────────────────────────────────────────
 * Call Web3EventBridge.setAdapters() to inject real implementations.
 * Until then, no-op stubs are used and events are logged (if EVENTS_DEBUG).
 *
 * ─── Why event-driven? ────────────────────────────────────────────────────────
 * The core trading, valuation, and arena services never import from server/web3/.
 * Web3 is opt-in via the event bus. Removing Web3 support means removing this
 * bridge registration — no core code changes needed.
 */

import { eventBus } from "../../events/event-bus";
import type {
  TradeExecutedEvent,
  FeeCapturedEvent,
  ArenaXpGrantedEvent,
  ValuationUpdatedEvent,
} from "../../events/domain-events";
import type { WalletLinkAdapter } from "../interfaces/wallet-link-adapter";
import type { TreasurySettlementAdapter } from "../interfaces/treasury-settlement-adapter";
import type { AssetMirrorAdapter } from "../interfaces/asset-mirror-adapter";

// ─── Config ──────────────────────────────────────────────────────────────────

/**
 * Minimum player fee accumulation (in GS tokens) before auto-settlement is triggered.
 * Phase 9+: this threshold will trigger queuePayout() from FeeCaptured events.
 */
const AUTO_SETTLEMENT_THRESHOLD_GS = 10.0;

// ─── Adapter registry ────────────────────────────────────────────────────────

let walletLinkAdapter: WalletLinkAdapter | null = null;
let treasuryAdapter: TreasurySettlementAdapter | null = null;
let mirrorAdapter: AssetMirrorAdapter | null = null;

/**
 * Inject real adapter implementations.
 * Call this from server/index.ts once concrete implementations are available.
 * Safe to call with partial adapter sets — unset adapters skip their actions.
 */
export function setWeb3Adapters(adapters: {
  walletLink?: WalletLinkAdapter;
  treasury?: TreasurySettlementAdapter;
  mirror?: AssetMirrorAdapter;
}): void {
  if (adapters.walletLink) walletLinkAdapter = adapters.walletLink;
  if (adapters.treasury) treasuryAdapter = adapters.treasury;
  if (adapters.mirror) mirrorAdapter = adapters.mirror;
  console.log("[Web3Bridge] Adapters registered:", {
    walletLink: !!walletLinkAdapter,
    treasury: !!treasuryAdapter,
    mirror: !!mirrorAdapter,
  });
}

export function getWeb3Adapters() {
  return {
    walletLink: walletLinkAdapter,
    treasury: treasuryAdapter,
    mirror: mirrorAdapter,
    isActive: !!(walletLinkAdapter || treasuryAdapter || mirrorAdapter),
  };
}

// ─── Event handlers ──────────────────────────────────────────────────────────

async function onTradeExecuted(event: TradeExecutedEvent): Promise<void> {
  const { tradeId, userId, puuid, type, shares, executionPrice, source } = event.payload;

  if (process.env.EVENTS_DEBUG === "true") {
    console.debug(
      `[Web3Bridge] TradeExecuted observed — tradeId=${tradeId} user=${userId} ` +
      `puuid=${puuid} type=${type} shares=${shares} price=${executionPrice.toFixed(4)} source=${source}`
    );
  }

  // Phase 9+: mirror trade on-chain
  if (mirrorAdapter) {
    try {
      await mirrorAdapter.mirrorTrade({
        tradeId,
        userId,
        puuid,
        type,
        shares,
        executionPrice,
        occurredAt: event.occurredAt,
      });
    } catch (err: any) {
      console.error(`[Web3Bridge] mirrorTrade failed for tradeId=${tradeId}:`, err?.message);
    }
  }
}

async function onFeeCaptured(event: FeeCapturedEvent): Promise<void> {
  const { tradeId, assetId, feeTotal, platformFee, playerFee, notional } = event.payload;

  if (process.env.EVENTS_DEBUG === "true") {
    console.debug(
      `[Web3Bridge] FeeCaptured observed — tradeId=${tradeId} assetId=${assetId} ` +
      `playerFee=${playerFee.toFixed(6)} platformFee=${platformFee.toFixed(6)}`
    );
  }

  // Phase 9+: mirror treasury credit and optionally queue payout
  if (mirrorAdapter) {
    try {
      await mirrorAdapter.mirrorTreasuryCredit({
        assetId,
        playerFee,
        platformFee,
        tradeId,
        occurredAt: event.occurredAt,
      });
    } catch (err: any) {
      console.error(`[Web3Bridge] mirrorTreasuryCredit failed for tradeId=${tradeId}:`, err?.message);
    }
  }

  // Phase 9+: auto-settlement trigger
  // if (treasuryAdapter && playerFee >= AUTO_SETTLEMENT_THRESHOLD_GS) {
  //   await treasuryAdapter.queuePayout({ ... });
  // }
}

async function onArenaXpGranted(event: ArenaXpGrantedEvent): Promise<void> {
  const { userId, xpAmount, reason, triggeredBy } = event.payload;

  if (process.env.EVENTS_DEBUG === "true") {
    console.debug(
      `[Web3Bridge] ArenaXpGranted observed — user=${userId} xp=${xpAmount} ` +
      `reason=${reason} triggeredBy=${triggeredBy}`
    );
  }

  // Phase 9+: mirror season rewards on-chain
  // if (mirrorAdapter && triggeredBy === "season") {
  //   await mirrorAdapter.mirrorSeasonReward({ userId, ... });
  // }
}

async function onValuationUpdated(event: ValuationUpdatedEvent): Promise<void> {
  const { puuid, fairValueGS, divergencePct, confidenceScore } = event.payload;

  if (process.env.EVENTS_DEBUG === "true") {
    console.debug(
      `[Web3Bridge] ValuationUpdated observed — puuid=${puuid} ` +
      `fv=${fairValueGS.toFixed(4)} div=${divergencePct.toFixed(2)}% conf=${confidenceScore.toFixed(2)}`
    );
  }

  // Phase 9+: use valuation data to update on-chain oracle price feeds
  // if high confidence and significant divergence, trigger oracle update
  // if (mirrorAdapter && confidenceScore > 0.8 && Math.abs(divergencePct) > 20) {
  //   await mirrorAdapter.mirrorValuationOracle({ puuid, fairValueGS, ... });
  // }
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

let registered = false;

/**
 * Register the Web3EventBridge handlers on the event bus.
 * Must be called once at startup, after registerAllHandlers() in server/events/index.ts.
 * Idempotent — safe to call multiple times.
 */
export function registerWeb3Bridge(): void {
  if (registered) return;
  registered = true;

  eventBus.on("TradeExecuted",    "web3:mirror-trade",      onTradeExecuted);
  eventBus.on("FeeCaptured",      "web3:mirror-fee",        onFeeCaptured);
  eventBus.on("ArenaXpGranted",   "web3:mirror-xp",         onArenaXpGranted);
  eventBus.on("ValuationUpdated", "web3:observe-valuation", onValuationUpdated);

  console.log("[Web3Bridge] Event bridge registered (observation mode, no adapters active).");
}

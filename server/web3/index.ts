/**
 * server/web3 — Public API for the GamerStock Web3-readiness layer.
 *
 * This module exposes interfaces, models, and the event bridge for
 * future Web3 integration. Nothing here touches blockchain directly.
 *
 * ─── Design principle ────────────────────────────────────────────────────────
 * Core GamerStock services (trading, valuation, arena) NEVER import from
 * server/web3/. Web3 listens via the event bus — it is opt-in infrastructure.
 *
 * ─── Activation ──────────────────────────────────────────────────────────────
 * Call registerWeb3Bridge() in server/index.ts to connect the bridge to the
 * event bus. Call setWeb3Adapters() to inject real implementations when ready.
 *
 * ─── Current status (Phase 8) ────────────────────────────────────────────────
 * Observation mode only. No on-chain calls. No external network requests.
 * All adapters are interface contracts — no implementations yet.
 */

export { registerWeb3Bridge, setWeb3Adapters, getWeb3Adapters } from "./services/web3-event-bridge";

export type { WalletLinkAdapter, LinkRequest, LinkConfirmation, WalletLinkResult } from "./interfaces/wallet-link-adapter";
export type { TreasurySettlementAdapter, PayoutIntent, SettlementRecord, SettlementStatus } from "./interfaces/treasury-settlement-adapter";
export type { AssetMirrorAdapter, MirrorResult, MirrorStatus } from "./interfaces/asset-mirror-adapter";

export type { ExternalIdentity, ExternalIdentityCreateInput, ExternalIdentityProvider, ExternalIdentityStatus } from "./models/external-identity";
export { normalizeAddress, looksLikeEvmAddress, looksLikeSolanaAddress } from "./models/external-identity";

export type { WalletLink, WalletLinkNonce, WalletLinkCreateInput, WalletLinkStatus } from "./models/wallet-link";
export { buildSiweMessage, generateLinkNonce } from "./models/wallet-link";

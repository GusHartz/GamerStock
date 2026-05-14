/**
 * server/simulation/synthetic-market — Public barrel export.
 */

export { SYNTHETIC_PLAYERS } from "./synthetic-players";
export type { SyntheticPlayer, Archetype } from "./synthetic-players";

export { computeSnapshot, computePriceHistory } from "./performance-engine";
export type { PerformanceSnapshot, PriceHistory } from "./performance-engine";

export { computeValuation, buildDiscoverySignals } from "./valuation-engine";
export type { ValuationResult, DiscoverySignal } from "./valuation-engine";

export {
  buildTerminalReadModel,
  buildPlayerHistory,
  buildPlayerDetail,
} from "./synthetic-read-model";
export type {
  SyntheticMarketRow,
  SyntheticTapeTick,
  SyntheticTerminalReadModel,
} from "./synthetic-read-model";

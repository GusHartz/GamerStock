/**
 * server/simulation — Public API for the GamerStock simulation layer.
 *
 * Everything simulation/sandbox-related exports from here.
 * Core market and trading code must NOT import simulation modules directly —
 * use this index or the SimulationMarketService façade.
 *
 * ─── What lives here ──────────────────────────────────────────────────────────
 * players/name-generator.ts         Summoner name generation + vault migration
 * players/dummy-player-generator.ts Synthetic player records for seeding
 * bots/bot-trader.ts                100-bot simulation system
 * services/simulation-market-service.ts  Operational façade
 *
 * ─── What does NOT live here ──────────────────────────────────────────────────
 * Real player data (riotAssets, riotPlayers) → server/integrations/
 * Market pricing / AMM → server/services/ammPricing.ts
 * Trade execution → server/services/tradeExecutor.ts
 * Canonical market sync → server/market-core/
 */

export { generateSummonerNames, runAliasMigration } from "./players/name-generator";
export { generateDummyPlayers } from "./players/dummy-player-generator";
export type { DummyPlayer } from "./players/dummy-player-generator";

export {
  buildTerminalReadModel,
  buildPlayerHistory,
  buildPlayerDetail,
  SYNTHETIC_PLAYERS,
} from "./synthetic-market/index";
export type {
  SyntheticPlayer,
  SyntheticMarketRow,
  SyntheticTerminalReadModel,
} from "./synthetic-market/index";
export {
  startBotSimulator,
  stopBotSimulator,
  isBotSimulatorRunning,
  getBotMetrics,
  seedBots,
  setBotConfig,
  getBotConfig,
} from "./bots/bot-trader";
export { simulationMarketService, SimulationMarketService } from "./services/simulation-market-service";
export type { SandboxSeedResult } from "./services/simulation-market-service";

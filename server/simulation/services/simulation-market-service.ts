/**
 * SimulationMarketService — Façade for sandbox/simulation operations.
 *
 * Centralises:
 * - Synthetic player seeding (vault population)
 * - Bot lifecycle management
 * - Simulation status reporting
 *
 * This service is the single entry point for anything that creates or manages
 * synthetic market participants. Core market/trading code should never call
 * dummy-player-generator or bot-trader directly — go through this façade.
 */

import { generateDummyPlayers } from "../players/dummy-player-generator";
import {
  startBotSimulator,
  stopBotSimulator,
  isBotSimulatorRunning,
  getBotMetrics,
  seedBots,
  setBotConfig,
  getBotConfig,
} from "../bots/bot-trader";

export interface SandboxSeedResult {
  seeded: boolean;
  playerCount: number;
  message: string;
}

export class SimulationMarketService {
  /**
   * Generate the initial set of synthetic players for the sandbox vault system.
   * Returns structured player records ready to be inserted via storage layer.
   * Does NOT perform the DB insert itself — caller owns persistence.
   */
  generateSandboxPlayers(count = 1000) {
    return generateDummyPlayers(count);
  }

  /** Seed 100 bot users + portfolios + profiles into the DB. */
  async seedBots() {
    return seedBots();
  }

  /** Start the bot trading loop. Idempotent — safe to call multiple times. */
  async startBots() {
    return startBotSimulator();
  }

  /** Stop the bot trading loop. */
  stopBots() {
    return stopBotSimulator();
  }

  /** True if the bot simulator is currently running. */
  isBotsRunning() {
    return isBotSimulatorRunning();
  }

  /** Runtime metrics: trade count, volume, bot count. */
  async getBotMetrics() {
    return getBotMetrics();
  }

  /** Update bot trading parameters at runtime. */
  configureBots(opts: { intervalMs?: number; batchSizeMin?: number; batchSizeMax?: number }) {
    return setBotConfig(opts);
  }

  /** Current bot config. */
  getBotConfig() {
    return getBotConfig();
  }
}

export const simulationMarketService = new SimulationMarketService();

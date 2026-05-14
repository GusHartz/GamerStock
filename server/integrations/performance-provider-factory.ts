/**
 * PerformanceProvider Factory
 *
 * Selects the active provider based on:
 *   1. PERFORMANCE_PROVIDER env var (overrides everything — useful for testing)
 *      Values: "riot" | "synthetic"
 *   2. Market mode from app_config table (REAL_RIOT_NA1 → riot, SANDBOX → synthetic)
 *   3. Default: "riot" (conservative — maintains current production behaviour)
 *
 * Instances are NOT cached intentionally so market mode changes take effect
 * without restarting the server.  Each provider is lightweight (no persistent
 * state), so instantiation cost is negligible.
 */

import { getMarketMode } from "../app-config";
import { RiotPerformanceProvider } from "./riot/performance-provider";
import { SyntheticPerformanceProvider } from "./synthetic/performance-provider";
import type { PerformanceProvider } from "./interfaces/performance-provider";

export async function getPerformanceProvider(): Promise<PerformanceProvider> {
  const envOverride = process.env.PERFORMANCE_PROVIDER?.toLowerCase();

  if (envOverride === "synthetic") {
    return new SyntheticPerformanceProvider();
  }

  if (envOverride === "riot") {
    return new RiotPerformanceProvider();
  }

  const mode = await getMarketMode();

  if (mode === "SANDBOX") {
    return new SyntheticPerformanceProvider();
  }

  return new RiotPerformanceProvider();
}

export type { PerformanceProvider };

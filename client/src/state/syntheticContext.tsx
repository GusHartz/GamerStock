import { createContext, useContext } from "react";
import type { MarketRow } from "@/state/terminalStore";

// ─── Synthetic Market Types ────────────────────────────────────────────────

export type SyntheticRow = {
  id: string;
  displayName: string;
  summonerTag: string;
  role: string;
  archetype: string;
  region: string;
  lastTradePrice: string;
  bidPrice: string;
  askPrice: string;
  spreadPct: string;
  volume24h: string;
  change24h: number;
  momentum: string;
  pviScore: number;
  winRate: number;
  leaguePoints: number;
  fairValue: number;
  divergencePct: number;
  signal: string;
  biography: string;
  strengths: string[];
  weaknesses: string[];
};

export type SyntheticTick = {
  id: string;
  playerId: string;
  displayName: string;
  type: "BUY" | "SELL";
  shares: number;
  pricePerShare: string;
  executedAt: string;
  trader: string;
};

export type DiscoverySignal = {
  playerId: string;
  displayName: string;
  type: "UNDERVALUED_GEM" | "BREAKOUT_CANDIDATE" | "MOMENTUM_SURGE" | "MEAN_REVERSION" | "HOT_STREAK";
  headline: string;
  detail: string;
  magnitude: number;
  currentPrice: number;
  fairValue: number;
};

export type SyntheticTerminalModel = {
  generatedAt: string;
  playerCount: number;
  rows: SyntheticRow[];
  tape: SyntheticTick[];
  discovery: DiscoverySignal[];
  index: {
    overall: number;
    topTwenty: number;
    breadth: { gainers: number; losers: number; flat: number };
    avgMomentum: number;
    assetCount: number;
    updatedAt: string;
  };
};

// ─── Synthetic Context ─────────────────────────────────────────────────────

export type SyntheticCtxValue = {
  model: SyntheticTerminalModel | null;
  isSyntheticMode: boolean;
  selectedSynth: SyntheticRow | null;
  setSelectedSynth: (row: SyntheticRow | null) => void;
};

export const SyntheticContext = createContext<SyntheticCtxValue>({
  model: null,
  isSyntheticMode: false,
  selectedSynth: null,
  setSelectedSynth: () => {},
});

export function useSynthetic() {
  return useContext(SyntheticContext);
}

// ─── Helpers ───────────────────────────────────────────────────────────────

export function synthToMarketRow(s: SyntheticRow): MarketRow {
  return {
    id: -parseInt(s.id.replace("syn-", ""), 10),
    assetUid: `synthetic:lol:NA1:${s.id}`,
    displayName: s.displayName,
    lastTradePrice: s.lastTradePrice,
    price24hAgo: (parseFloat(s.lastTradePrice) / (1 + s.change24h / 100)).toFixed(2),
    volume24h: s.volume24h,
    momentum: s.momentum,
    bidPrice: s.bidPrice,
    askPrice: s.askPrice,
    spreadPct: s.spreadPct,
    market: { provider: "synthetic", game: "lol", region: "NA1", scope: "DEMO" },
  };
}

export function isSyntheticAsset(asset: MarketRow | null): boolean {
  return asset !== null && (asset.id < 0 || asset.assetUid?.startsWith("synthetic:"));
}

export function synthIdFromAsset(asset: MarketRow): string {
  if (asset.assetUid?.startsWith("synthetic:")) {
    return asset.assetUid.split(":").slice(3).join(":");
  }
  const n = Math.abs(asset.id);
  return `syn-${String(n).padStart(3, "0")}`;
}

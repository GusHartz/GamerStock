/**
 * server/simulation/synthetic-market/synthetic-read-model.ts
 *
 * Assembles the complete terminal read model for synthetic market mode.
 * Called by the /api/synthetic/terminal endpoint.
 */

import { SYNTHETIC_PLAYERS, type SyntheticPlayer } from "./synthetic-players";
import { computeSnapshot, computePriceHistory, type PerformanceSnapshot, type PriceHistory } from "./performance-engine";
import { computeValuation, buildDiscoverySignals, type ValuationResult, type DiscoverySignal } from "./valuation-engine";

export type SyntheticMarketRow = {
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

export type SyntheticTapeTick = {
  id: string;
  playerId: string;
  displayName: string;
  type: "BUY" | "SELL";
  shares: number;
  pricePerShare: string;
  executedAt: string;
  trader: string;
};

export type SyntheticTerminalReadModel = {
  generatedAt: string;
  playerCount: number;
  rows: SyntheticMarketRow[];
  tape: SyntheticTapeTick[];
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

const BOT_NAMES = [
  "AlphaWolf", "BetaTrader", "CryptoGhost", "DeltaBot", "EsportsFund",
  "FalconCap", "GammaHedge", "HypeBot", "IronVault", "JumpDesk",
  "KryptoFish", "LeverageKing", "MomoBot", "NightOwl", "OmegaPlay",
];

function seededRandom(seed: number): number {
  const x = Math.sin(seed + 1) * 10000;
  return x - Math.floor(x);
}

function playerSeed(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    const c = id.charCodeAt(i);
    hash = (hash << 5) - hash + c;
    hash |= 0;
  }
  return Math.abs(hash);
}

function buildTape(
  players: SyntheticPlayer[],
  snapshots: Map<string, PerformanceSnapshot>,
  now: number
): SyntheticTapeTick[] {
  const ticks: SyntheticTapeTick[] = [];
  const bucketMin = Math.floor(now / (60 * 1000));

  for (let i = 29; i >= 0; i--) {
    const bucket = bucketMin - i;
    const playerIdx = Math.floor(seededRandom(bucket * 13) * players.length);
    const player = players[playerIdx];
    const snap = snapshots.get(player.id);
    if (!snap) continue;

    const isBuy = seededRandom(bucket * 7) > 0.45;
    const shares = 1 + Math.floor(seededRandom(bucket * 11) * 15);
    const priceVariance = 1 + (seededRandom(bucket * 5) - 0.5) * 0.004;
    const price = snap.price * priceVariance;
    const botIdx = Math.floor(seededRandom(bucket * 3) * BOT_NAMES.length);
    const ts = new Date(now - i * 60 * 1000 - Math.floor(seededRandom(bucket * 9) * 55000)).toISOString();

    ticks.push({
      id: `syn-tape-${bucket}-${i}`,
      playerId: player.id,
      displayName: player.displayName,
      type: isBuy ? "BUY" : "SELL",
      shares,
      pricePerShare: price.toFixed(2),
      executedAt: ts,
      trader: BOT_NAMES[botIdx],
    });
  }

  return ticks.sort((a, b) => new Date(b.executedAt).getTime() - new Date(a.executedAt).getTime());
}

function buildIndex(
  rows: SyntheticMarketRow[],
  now: string
) {
  const gainers = rows.filter((r) => r.change24h > 1).length;
  const losers = rows.filter((r) => r.change24h < -1).length;
  const flat = rows.length - gainers - losers;
  const overall = rows.reduce((s, r) => s + r.change24h, 0) / (rows.length || 1);

  const top20 = [...rows].sort((a, b) => b.volume24h.localeCompare(a.volume24h)).slice(0, 20);
  const topTwenty = top20.reduce((s, r) => s + r.change24h, 0) / (top20.length || 1);

  const avgMomentum = rows.reduce((s, r) => s + parseFloat(r.momentum), 0) / (rows.length || 1);

  return {
    overall: parseFloat(overall.toFixed(2)),
    topTwenty: parseFloat(topTwenty.toFixed(2)),
    breadth: { gainers, losers, flat },
    avgMomentum: parseFloat(avgMomentum.toFixed(6)),
    assetCount: rows.length,
    updatedAt: now,
  };
}

export function buildTerminalReadModel(now: number = Date.now()): SyntheticTerminalReadModel {
  const snapshots = new Map<string, PerformanceSnapshot>();
  const valuations = new Map<string, ValuationResult>();

  for (const player of SYNTHETIC_PLAYERS) {
    const snap = computeSnapshot(player, now);
    snapshots.set(player.id, snap);
    const val = computeValuation(player, snap, now);
    valuations.set(player.id, val);
  }

  const rows: SyntheticMarketRow[] = SYNTHETIC_PLAYERS.map((player) => {
    const snap = snapshots.get(player.id)!;
    const val = valuations.get(player.id)!;

    return {
      id: player.id,
      displayName: player.displayName,
      summonerTag: player.summonerTag,
      role: player.role,
      archetype: player.archetype,
      region: player.region,
      lastTradePrice: snap.price.toFixed(2),
      bidPrice: snap.bidPrice.toFixed(2),
      askPrice: snap.askPrice.toFixed(2),
      spreadPct: snap.spreadPct.toFixed(4),
      volume24h: snap.volume24h.toFixed(0),
      change24h: snap.change24h,
      momentum: snap.momentum.toFixed(6),
      pviScore: snap.pviScore,
      winRate: snap.winRate,
      leaguePoints: player.leaguePoints,
      fairValue: val.fairValue,
      divergencePct: val.divergencePct,
      signal: val.signal,
      biography: player.biography,
      strengths: player.strengths,
      weaknesses: player.weaknesses,
    };
  });

  const tape = buildTape(SYNTHETIC_PLAYERS, snapshots, now);

  const discovery = buildDiscoverySignals(
    SYNTHETIC_PLAYERS,
    snapshots,
    valuations,
    now
  );

  const updatedAt = new Date(now).toISOString();
  const index = buildIndex(rows, updatedAt);

  return {
    generatedAt: updatedAt,
    playerCount: rows.length,
    rows,
    tape,
    discovery,
    index,
  };
}

export function buildPlayerHistory(
  playerId: string,
  tf: "24h" | "7d" | "30d",
  now: number = Date.now()
): PriceHistory[] | null {
  const player = SYNTHETIC_PLAYERS.find((p) => p.id === playerId);
  if (!player) return null;
  return computePriceHistory(player, tf, now);
}

export function buildPlayerDetail(
  playerId: string,
  now: number = Date.now()
): (SyntheticMarketRow & { valuation: ValuationResult }) | null {
  const player = SYNTHETIC_PLAYERS.find((p) => p.id === playerId);
  if (!player) return null;

  const snap = computeSnapshot(player, now);
  const val = computeValuation(player, snap, now);

  const row: SyntheticMarketRow = {
    id: player.id,
    displayName: player.displayName,
    summonerTag: player.summonerTag,
    role: player.role,
    archetype: player.archetype,
    region: player.region,
    lastTradePrice: snap.price.toFixed(2),
    bidPrice: snap.bidPrice.toFixed(2),
    askPrice: snap.askPrice.toFixed(2),
    spreadPct: snap.spreadPct.toFixed(4),
    volume24h: snap.volume24h.toFixed(0),
    change24h: snap.change24h,
    momentum: snap.momentum.toFixed(6),
    pviScore: snap.pviScore,
    winRate: snap.winRate,
    leaguePoints: player.leaguePoints,
    fairValue: val.fairValue,
    divergencePct: val.divergencePct,
    signal: val.signal,
    biography: player.biography,
    strengths: player.strengths,
    weaknesses: player.weaknesses,
  };

  return { ...row, valuation: val };
}

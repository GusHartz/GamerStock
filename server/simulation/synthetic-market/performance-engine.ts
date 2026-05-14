/**
 * server/simulation/synthetic-market/performance-engine.ts
 *
 * Deterministic performance simulation engine.
 * Uses seeded pseudo-random based on player ID + time bucket.
 */

import type { SyntheticPlayer } from "./synthetic-players";

export type PerformanceSnapshot = {
  playerId: string;
  timestamp: number;
  price: number;
  bidPrice: number;
  askPrice: number;
  spreadPct: number;
  volume24h: number;
  change24h: number;
  momentum: number;
  pviScore: number;
  winRate: number;
};

export type PriceHistory = {
  t: string;
  p: number;
};

function seededRandom(seed: number): number {
  const x = Math.sin(seed + 1) * 10000;
  return x - Math.floor(x);
}

function playerSeed(playerId: string): number {
  let hash = 0;
  for (let i = 0; i < playerId.length; i++) {
    const c = playerId.charCodeAt(i);
    hash = (hash << 5) - hash + c;
    hash |= 0;
  }
  return Math.abs(hash);
}

function timeBucket(now: number, bucketMs: number): number {
  return Math.floor(now / bucketMs);
}

export function computeSnapshot(player: SyntheticPlayer, now: number = Date.now()): PerformanceSnapshot {
  const seed = playerSeed(player.id);
  const bucket5m = timeBucket(now, 5 * 60 * 1000);
  const bucket24h = timeBucket(now, 24 * 60 * 60 * 1000);

  const noise5m = (seededRandom(seed + bucket5m) - 0.5) * 2 * player.volatility;
  const noise24h = (seededRandom(seed + bucket24h * 7) - 0.5) * 2 * player.volatility * 4;

  const price = Math.max(5, player.basePrice * (1 + noise5m));
  const price24hAgo = Math.max(5, player.basePrice * (1 + noise24h));
  const change24h = ((price - price24hAgo) / price24hAgo) * 100;

  const spread = price * 0.002 * (0.8 + seededRandom(seed + bucket5m + 1) * 0.4);
  const bidPrice = price - spread / 2;
  const askPrice = price + spread / 2;
  const spreadPct = (askPrice - bidPrice) / price * 100;

  const volumeBase = 1200 + seededRandom(seed * 3) * 8000;
  const volumeNoise = seededRandom(seed + bucket24h * 3) * volumeBase * 0.3;
  const volume24h = Math.round(volumeBase + volumeNoise);

  const momentumNoise = (seededRandom(seed + bucket5m * 2) - 0.5) * 0.01;
  const momentum = player.momentum + momentumNoise;

  const pviNoise = (seededRandom(seed + bucket24h * 5) - 0.5) * 8;
  const pviScore = Math.min(99, Math.max(10, player.pviBase + pviNoise));

  const winRateNoise = (seededRandom(seed + bucket24h * 11) - 0.5) * 4;
  const winRate = Math.min(75, Math.max(45, player.winRate + winRateNoise));

  return {
    playerId: player.id,
    timestamp: now,
    price: parseFloat(price.toFixed(2)),
    bidPrice: parseFloat(bidPrice.toFixed(2)),
    askPrice: parseFloat(askPrice.toFixed(2)),
    spreadPct: parseFloat(spreadPct.toFixed(4)),
    volume24h,
    change24h: parseFloat(change24h.toFixed(2)),
    momentum: parseFloat(momentum.toFixed(6)),
    pviScore: parseFloat(pviScore.toFixed(1)),
    winRate: parseFloat(winRate.toFixed(1)),
  };
}

export function computePriceHistory(player: SyntheticPlayer, tf: "24h" | "7d" | "30d", now: number = Date.now()): PriceHistory[] {
  const seed = playerSeed(player.id);
  const points = tf === "24h" ? 48 : tf === "7d" ? 42 : 30;
  const intervalMs = tf === "24h" ? 30 * 60 * 1000 : tf === "7d" ? 4 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;

  const history: PriceHistory[] = [];
  let walkPrice = player.basePrice;

  for (let i = points; i >= 0; i--) {
    const ts = now - i * intervalMs;
    const bucket = Math.floor(ts / intervalMs);
    const step = (seededRandom(seed + bucket) - 0.48) * player.volatility * 2;
    walkPrice = Math.max(5, walkPrice * (1 + step));

    history.push({
      t: new Date(ts).toISOString(),
      p: parseFloat(walkPrice.toFixed(2)),
    });
  }

  return history;
}

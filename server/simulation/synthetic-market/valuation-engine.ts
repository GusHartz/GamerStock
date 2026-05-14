/**
 * server/simulation/synthetic-market/valuation-engine.ts
 *
 * Fair value calculation and discovery engine for synthetic players.
 * Generates: fair value, divergence %, discovery signals, and breakout candidates.
 */

import type { SyntheticPlayer } from "./synthetic-players";
import type { PerformanceSnapshot } from "./performance-engine";

export type ValuationResult = {
  playerId: string;
  fairValue: number;
  divergencePct: number;
  isUndervalued: boolean;
  confidence: number;
  pviComponents: {
    recentPerformance: number;
    consistency: number;
    historicalSkill: number;
    activityScore: number;
  };
  signal: "STRONG_BUY" | "BUY" | "HOLD" | "SELL" | "STRONG_SELL";
  signalReason: string;
  breakoutProbability: number;
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

export function computeValuation(
  player: SyntheticPlayer,
  snap: PerformanceSnapshot,
  now: number = Date.now()
): ValuationResult {
  const seed = playerSeed(player.id);
  const dayBucket = Math.floor(now / (24 * 60 * 60 * 1000));

  const recentPerf = Math.min(100, Math.max(0,
    player.pviBase * 0.8 + seededRandom(seed + dayBucket) * 20
  ));
  const consistency = Math.min(100, Math.max(0,
    85 - player.volatility * 500 + seededRandom(seed + dayBucket * 3) * 15
  ));
  const historicalSkill = Math.min(100, Math.max(0,
    (player.leaguePoints / 2000) * 70 + seededRandom(seed + dayBucket * 7) * 30
  ));
  const activityScore = Math.min(100, Math.max(0,
    55 + seededRandom(seed + dayBucket * 11) * 45
  ));

  const pviComposite =
    recentPerf * 0.35 +
    consistency * 0.25 +
    historicalSkill * 0.25 +
    activityScore * 0.15;

  const fairValue = parseFloat((pviComposite * 3.2 + 10).toFixed(2));

  const divergencePct = parseFloat(
    (((snap.price - fairValue) / fairValue) * 100).toFixed(2)
  );

  const isUndervalued = divergencePct < -5;

  const confidence = parseFloat(
    Math.min(0.99, Math.max(0.3,
      0.5 + consistency / 200 + historicalSkill / 300
    )).toFixed(2)
  );

  const breakoutSeed = seededRandom(seed + dayBucket * 17);
  const breakoutProbability = parseFloat(
    Math.min(0.9, Math.max(0.05,
      breakoutSeed * 0.4 + (snap.momentum > 0 ? 0.15 : 0) + (isUndervalued ? 0.1 : 0)
    )).toFixed(2)
  );

  let signal: ValuationResult["signal"];
  let signalReason: string;

  if (divergencePct < -20) {
    signal = "STRONG_BUY";
    signalReason = `Trading ${Math.abs(divergencePct).toFixed(1)}% below fair value with strong fundamentals`;
  } else if (divergencePct < -8) {
    signal = "BUY";
    signalReason = `Undervalued relative to PVI-implied fair value`;
  } else if (divergencePct > 20) {
    signal = "STRONG_SELL";
    signalReason = `Trading ${divergencePct.toFixed(1)}% above fair value — stretched valuation`;
  } else if (divergencePct > 8) {
    signal = "SELL";
    signalReason = `Premium to fair value; consider trimming position`;
  } else {
    signal = "HOLD";
    signalReason = `Price within ${Math.abs(divergencePct).toFixed(1)}% of fair value`;
  }

  return {
    playerId: player.id,
    fairValue,
    divergencePct,
    isUndervalued,
    confidence,
    pviComponents: {
      recentPerformance: parseFloat(recentPerf.toFixed(1)),
      consistency: parseFloat(consistency.toFixed(1)),
      historicalSkill: parseFloat(historicalSkill.toFixed(1)),
      activityScore: parseFloat(activityScore.toFixed(1)),
    },
    signal,
    signalReason,
    breakoutProbability,
  };
}

const DISCOVERY_HEADLINES = {
  UNDERVALUED_GEM: [
    "Hidden gem trading below intrinsic value",
    "Fundamentals say buy — market hasn't caught up",
    "PVI-implied value signals strong discount",
  ],
  BREAKOUT_CANDIDATE: [
    "Building momentum toward breakout",
    "Technical pattern suggests imminent move",
    "Rising volume with price compression",
  ],
  MOMENTUM_SURGE: [
    "Momentum accelerating — early entry window",
    "Sustained upward drift detected",
    "Multi-session momentum building",
  ],
  MEAN_REVERSION: [
    "Extended below fair value — reversion likely",
    "Historically mean-reverts from this level",
    "Oversold relative to peer group",
  ],
  HOT_STREAK: [
    "Win streak igniting price discovery",
    "Performance tier surged — price lagging",
    "Positive PVI revision cycle underway",
  ],
};

function pickHeadline(type: DiscoverySignal["type"], seed: number, bucket: number): string {
  const arr = DISCOVERY_HEADLINES[type];
  const idx = Math.floor(seededRandom(seed + bucket) * arr.length);
  return arr[idx];
}

export function buildDiscoverySignals(
  players: SyntheticPlayer[],
  snapshots: Map<string, PerformanceSnapshot>,
  valuations: Map<string, ValuationResult>,
  now: number = Date.now()
): DiscoverySignal[] {
  const dayBucket = Math.floor(now / (24 * 60 * 60 * 1000));
  const signals: DiscoverySignal[] = [];

  for (const player of players) {
    const snap = snapshots.get(player.id);
    const val = valuations.get(player.id);
    if (!snap || !val) continue;

    const seed = playerSeed(player.id);
    let type: DiscoverySignal["type"] | null = null;
    let magnitude = 0;

    if (val.divergencePct < -12 && val.confidence > 0.65) {
      type = "UNDERVALUED_GEM";
      magnitude = Math.abs(val.divergencePct);
    } else if (val.breakoutProbability > 0.65 && snap.momentum > 0.005) {
      type = "BREAKOUT_CANDIDATE";
      magnitude = val.breakoutProbability * 100;
    } else if (snap.momentum > 0.008) {
      type = "MOMENTUM_SURGE";
      magnitude = snap.momentum * 1000;
    } else if (val.divergencePct < -8 && snap.change24h < -3) {
      type = "MEAN_REVERSION";
      magnitude = Math.abs(val.divergencePct);
    } else if (snap.change24h > 5 && val.pviComponents.recentPerformance > 75) {
      type = "HOT_STREAK";
      magnitude = snap.change24h;
    }

    if (type) {
      const headline = pickHeadline(type, seed, dayBucket);
      signals.push({
        playerId: player.id,
        displayName: player.displayName,
        type,
        headline,
        detail: val.signalReason,
        magnitude: parseFloat(magnitude.toFixed(2)),
        currentPrice: snap.price,
        fairValue: val.fairValue,
      });
    }
  }

  return signals.sort((a, b) => b.magnitude - a.magnitude).slice(0, 8);
}

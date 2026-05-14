/**
 * Market Signals Engine
 * Generates data-driven signals from real asset metrics.
 * All thresholds are calibrated against actual GamerStock dataset distributions.
 */

export interface MarketSignal {
  id: string;
  type: "bullish" | "neutral" | "bearish";
  label: string;
  reason?: string;
}

export interface NewsSignalContext {
  direction: "bullish" | "neutral" | "bearish";
  strength: number;
  label: string;
  reason?: string;
}

interface SignalInputs {
  lastTradePrice: number;
  price24hAgo: number;
  momentum: number;
  volume24h: number;
  winrate: number;
  leaguePoints: number;
  wins: number;
  losses: number;
  confidenceScore: number | null;
  fairValueGS: number | null;
  divergencePct: number | null;
  fundamentalPrice: number | null;
  newsContext?: NewsSignalContext | null;
}

function pct(a: number, b: number): number {
  if (b === 0) return 0;
  return ((a - b) / b) * 100;
}

function buildPriceChangeSignal(inputs: SignalInputs): MarketSignal | null {
  const { lastTradePrice, price24hAgo } = inputs;
  if (price24hAgo <= 0 || lastTradePrice <= 0) return null;
  const change = pct(lastTradePrice, price24hAgo);
  if (Math.abs(change) < 0.5) return null;

  if (change >= 12) return {
    id: "price_surge",
    type: "bullish",
    label: "Sharp price rally today",
    reason: `+${change.toFixed(1)}% in the last 24h`,
  };
  if (change >= 4) return {
    id: "price_up",
    type: "bullish",
    label: "Positive price movement today",
    reason: `+${change.toFixed(1)}% in the last 24h`,
  };
  if (change <= -12) return {
    id: "price_drop",
    type: "bearish",
    label: "Sharp price decline today",
    reason: `${change.toFixed(1)}% in the last 24h`,
  };
  if (change <= -4) return {
    id: "price_down",
    type: "bearish",
    label: "Price declining today",
    reason: `${change.toFixed(1)}% in the last 24h`,
  };
  return {
    id: "price_stable",
    type: "neutral",
    label: "Price stable today",
    reason: `${change >= 0 ? "+" : ""}${change.toFixed(1)}% over 24h`,
  };
}

function buildMomentumSignal(inputs: SignalInputs): MarketSignal | null {
  const { momentum } = inputs;
  if (momentum >= 15) return {
    id: "momentum_strong",
    type: "bullish",
    label: "Strong bullish momentum",
    reason: `Momentum index at ${momentum.toFixed(1)}`,
  };
  if (momentum >= 5) return {
    id: "momentum_positive",
    type: "bullish",
    label: "Positive short-term momentum",
    reason: `Momentum index at ${momentum.toFixed(1)}`,
  };
  if (momentum <= -3) return {
    id: "momentum_weak",
    type: "bearish",
    label: "Momentum fading",
    reason: `Momentum index at ${momentum.toFixed(1)}`,
  };
  if (momentum >= -1 && momentum < 2) return null;
  return {
    id: "momentum_neutral",
    type: "neutral",
    label: "Stable momentum",
    reason: `Momentum index near zero`,
  };
}

function buildVolumeSignal(inputs: SignalInputs): MarketSignal | null {
  const { volume24h } = inputs;
  if (volume24h >= 6000) return {
    id: "volume_high",
    type: "bullish",
    label: "High trading activity",
    reason: `${volume24h.toFixed(0)} shares traded today`,
  };
  if (volume24h >= 2500) return {
    id: "volume_elevated",
    type: "neutral",
    label: "Elevated trading volume",
    reason: `${volume24h.toFixed(0)} shares traded today`,
  };
  if (volume24h < 80) return {
    id: "volume_thin",
    type: "neutral",
    label: "Thin trading activity",
    reason: `Low volume may affect price reliability`,
  };
  return null;
}

function buildPerformanceSignal(inputs: SignalInputs): MarketSignal | null {
  const { winrate, leaguePoints, wins, losses } = inputs;
  const matches = wins + losses;
  if (matches === 0) return null;

  if (winrate >= 65) return {
    id: "perf_exceptional",
    type: "bullish",
    label: "Exceptional win rate",
    reason: `${winrate.toFixed(1)}% win rate over ${matches} matches`,
  };
  if (winrate >= 58) return {
    id: "perf_strong",
    type: "bullish",
    label: "Above-average performance",
    reason: `${winrate.toFixed(1)}% win rate`,
  };
  if (winrate < 52) return {
    id: "perf_below",
    type: "bearish",
    label: "Below-average win rate",
    reason: `${winrate.toFixed(1)}% win rate`,
  };
  if (leaguePoints >= 1800) return {
    id: "perf_elite",
    type: "bullish",
    label: "Elite competitive rank",
    reason: `${leaguePoints} LP`,
  };
  return {
    id: "perf_steady",
    type: "neutral",
    label: "Steady performance",
    reason: `${winrate.toFixed(1)}% win rate`,
  };
}

function buildConfidenceSignal(inputs: SignalInputs): MarketSignal | null {
  const { confidenceScore } = inputs;
  if (confidenceScore === null) return {
    id: "confidence_unknown",
    type: "neutral",
    label: "Confidence still building",
    reason: "Not enough data for valuation model",
  };
  if (confidenceScore >= 0.75) return {
    id: "confidence_high",
    type: "neutral",
    label: "High model confidence",
    reason: `Confidence score: ${(confidenceScore * 100).toFixed(0)}%`,
  };
  if (confidenceScore >= 0.45) return {
    id: "confidence_moderate",
    type: "neutral",
    label: "Moderate valuation confidence",
    reason: `Confidence score: ${(confidenceScore * 100).toFixed(0)}%`,
  };
  return {
    id: "confidence_low",
    type: "neutral",
    label: "Limited data confidence",
    reason: `Confidence score: ${(confidenceScore * 100).toFixed(0)}% — interpret signals carefully`,
  };
}

function buildNewsSignal(inputs: SignalInputs): MarketSignal | null {
  const ctx = inputs.newsContext;
  if (!ctx || ctx.direction === "neutral" || ctx.strength < 0.1) return null;

  if (ctx.direction === "bullish" && ctx.strength >= 0.3) {
    return {
      id: "news_bullish",
      type: "bullish",
      label: ctx.label || "Positive news catalyst",
      reason: ctx.reason ?? `Bullish esports narrative (strength ${(ctx.strength * 100).toFixed(0)}%)`,
    };
  }
  if (ctx.direction === "bearish" && ctx.strength >= 0.3) {
    return {
      id: "news_bearish",
      type: "bearish",
      label: ctx.label || "Negative news development",
      reason: ctx.reason ?? `Bearish esports narrative (strength ${(ctx.strength * 100).toFixed(0)}%)`,
    };
  }
  return null;
}

function rankSignals(signals: MarketSignal[]): MarketSignal[] {
  const priority: Record<string, number> = {
    price_surge: 10,
    price_drop: 10,
    momentum_strong: 9,
    momentum_weak: 9,
    price_up: 8,
    price_down: 8,
    perf_exceptional: 7,
    perf_below: 7,
    news_bullish: 6,
    news_bearish: 6,
    volume_high: 6,
    perf_strong: 6,
    perf_elite: 5,
    volume_elevated: 4,
    momentum_positive: 4,
    momentum_neutral: 3,
    perf_steady: 3,
    volume_thin: 3,
    price_stable: 2,
    confidence_high: 2,
    confidence_moderate: 1,
    confidence_low: 5,
    confidence_unknown: 5,
  };
  return [...signals].sort((a, b) => (priority[b.id] ?? 0) - (priority[a.id] ?? 0));
}

export function buildMarketSignals(inputs: SignalInputs): MarketSignal[] {
  const candidates: MarketSignal[] = [
    buildPriceChangeSignal(inputs),
    buildMomentumSignal(inputs),
    buildPerformanceSignal(inputs),
    buildVolumeSignal(inputs),
    buildNewsSignal(inputs),
    buildConfidenceSignal(inputs),
  ].filter((s): s is MarketSignal => s !== null);

  const ranked = rankSignals(candidates);

  const result = ranked.slice(0, 4);

  if (result.length === 0) {
    return [{
      id: "limited_data",
      type: "neutral",
      label: "Limited market data",
      reason: "Not enough trading activity to generate signals",
    }];
  }

  return result;
}

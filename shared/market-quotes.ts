function clamp(val: number, min: number, max: number) {
  return Math.min(Math.max(val, min), max);
}

export function computeQuotes(mid: number, momentum: number, volume24h: number) {
  const base = 0.012;
  const vol = clamp(Math.abs(momentum) / 10, 0, 0.02);
  const liq = clamp(volume24h / 100000, 0, 0.008);
  const spreadPct = clamp(base + vol - liq, 0.006, 0.03);
  const bidPrice = mid * (1 - spreadPct / 2);
  const askPrice = mid * (1 + spreadPct / 2);
  return { bidPrice, askPrice, spreadPct };
}

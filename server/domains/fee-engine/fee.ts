// ─── Pure Fee Calculation ─────────────────────────────────────────────────────
// No side effects, no DB calls. Import and use anywhere.
//
// Fee schedule (GamerStock Phase 3):
//   Total:    2.00%   (200 bps)  — default; overridden by assetMarkets.feeBps
//   Platform: 1.20%  (60% split)
//   Player:   0.50%  (25% split)
//   Liquidity: 0.30% (15% split)
//
// The split ratios are FIXED regardless of the feeBps override.
// Only the total rate scales — proportions stay 60/25/15.
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_FEE_BPS = 200;

// Split weights (must sum to exactly 1.0)
const PLATFORM_WEIGHT  = 0.60;
const PLAYER_WEIGHT    = 0.25;
const LIQUIDITY_WEIGHT = 0.15;

export interface FeeBreakdown {
  feeBps:       number;
  notional:     number;
  feeTotal:     number;
  platformFee:  number;
  playerFee:    number;
  liquidityFee: number;
}

/**
 * Compute fee breakdown for a given notional value.
 *
 * @param notional  - Gross trade value (price × quantity).
 * @param feeBps    - Total fee in basis points. Defaults to DEFAULT_FEE_BPS (200).
 *                    Callers should pass assetMarkets.feeBps when available.
 */
export function computeFee(notional: number, feeBps: number = DEFAULT_FEE_BPS): FeeBreakdown {
  const feeTotal    = notional * feeBps / 10000;
  const platformFee  = feeTotal * PLATFORM_WEIGHT;
  const playerFee    = feeTotal * PLAYER_WEIGHT;
  const liquidityFee = feeTotal * LIQUIDITY_WEIGHT;

  return { feeBps, notional, feeTotal, platformFee, playerFee, liquidityFee };
}

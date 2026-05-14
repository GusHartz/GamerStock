/**
 * PVI Engine — Pure math functions for the 3-layer valuation model.
 *
 * Layer 1: PVI (Player Value Index, 0-100) — pure esports metric, never changed by trades
 * Layer 2: Fair Value (GS$) — derived from PVI, represents what the player "should" be worth
 * Layer 3: Market Price — AMM/trade-driven, subject to gravity + Performance Anchor Engine
 *
 * All functions here are pure (no DB calls, no side effects).
 *
 * === CALIBRATION HISTORY ===
 * v1: FAIR_VALUE_MAX=500  → structural divergence -85% to -93% on all 300 assets (broke gravity)
 * v2: FAIR_VALUE_MAX=30   → divergences now ±15-30%, gravity works, PAE enabled
 */

// ─── Tuning Constants ────────────────────────────────────────────────────────

export const PVI_CONFIG = {
  EMA_ALPHA: 0.18,          // smoothing factor for pviFinal (was 0.20, slightly more stable)

  // ── Gravity (per-trade pull toward fair value) ────────────────────────────
  // Now meaningful since Fair Value is calibrated to match market price range ($10-30).
  // Divergences are ±15-35%, not -90% like before.
  GRAVITY_FACTOR: 0.0025,         // was 0.0015; +67% (live market recalibration v3)
  MAX_TICK_MOVE: 0.006,           // was 0.005; slightly larger per-tick nudge allowed
  STRUCTURAL_DIVERGENCE_THRESHOLD: -70, // true safety valve only (e.g. data errors)

  // ── Fair Value curve ──────────────────────────────────────────────────────
  // RECALIBRATED: was MAX=500, SCALE=495 → produced $140-298 fair values vs $14-22 market prices
  // Now: MAX=30, SCALE=25 → produces $9-30 fair values matching actual trading range
  // Formula: MIN + (pviAdjusted/100)^POWER * SCALE
  // PVI 57 (avg) → $5 + 0.57^1.5 × 25 = $15.7  ← close to avg market price $18
  // PVI 70       → $5 + 0.70^1.5 × 25 = $19.6
  // PVI 80       → $5 + 0.80^1.5 × 25 = $22.9
  // PVI 100      → $5 + 1.00^1.5 × 25 = $30.0
  FAIR_VALUE_MIN: 5,
  FAIR_VALUE_MAX: 30,
  FAIR_VALUE_SCALE: 25,           // FAIR_VALUE_MAX - FAIR_VALUE_MIN
  FAIR_VALUE_POWER: 1.5,          // power curve; higher = more differentiation at the top

  // ── Performance Anchor Engine (PAE) ──────────────────────────────────────
  // Structural gravity applied to ALL assets every market tick (15s).
  // Unlike per-trade gravity, PAE is a batch force on the full market.
  // Ensures market price converges to fair value in the medium term.
  //
  // Three bands based on |divergencePct|:
  //   < PERF_ANCHOR_BAND_WEAK → weak anchor (asset near fair value)
  //   < PERF_ANCHOR_BAND_STRONG → moderate anchor
  //   ≥ PERF_ANCHOR_BAND_STRONG → strong anchor (asset far from fair value)
  PERF_ANCHOR_BAND_WEAK: 8,       // |div| < 8% → weak pull
  PERF_ANCHOR_BAND_STRONG: 25,    // |div| ≥ 25% → strong pull
  PERF_ANCHOR_FACTOR_WEAK: 0.0008,     // was 0.0003; 2.7× stronger (live market recalibration v3)
  PERF_ANCHOR_FACTOR_MODERATE: 0.0020, // was 0.0008; 2.5× stronger
  PERF_ANCHOR_FACTOR_STRONG: 0.0040,   // was 0.0016; 2.5× stronger
  PERF_ANCHOR_MAX_MOVE: 0.010,         // was 0.006; allow ±1.0% per tick from PAE
  PERF_ANCHOR_MIN_CONFIDENCE: 0.30,    // skip anchor if confidence too low

  // ── Performance windows ───────────────────────────────────────────────────
  RECENT_WINDOW: 20,
  CONSISTENCY_WINDOW: 20,
  MIN_CONFIDENCE_MATCHES: 3,
  ACTIVITY_HALF_LIFE_DAYS: 30,

  // ── Arbitrage / bot signal thresholds ────────────────────────────────────
  DIVERGENCE_BUY_THRESHOLD: -12,  // buy when moderately undervalued (was -40)
  DIVERGENCE_SELL_THRESHOLD: 8,   // sell when moderately overvalued (was 10)
  CONFIDENCE_LOW_THRESHOLD: 0.30,
  NEUTRAL_PVI: 50,

  // ── Momentum ──────────────────────────────────────────────────────────────
  MOMENTUM_DECAY: 0.90,           // was 0.95; 10% per 15s tick (faster decay)

  // ── Inactivity decay (applied to RecentPerformance in valuationJob) ─────
  // Explicit decay separate from ActivityScore — models "relevance decay" for idle players.
  // Thresholds: 0-24h no penalty; 24-48h light; 48-72h moderate; >72h growing with floor
  INACTIVITY_GRACE_DAYS: 1,        // no decay until 1 full day inactive
  INACTIVITY_LIGHT_FACTOR: 0.05,   // rate of decay per day in [1,2) range → -5% per day
  INACTIVITY_MODERATE_FACTOR: 0.08,// rate of decay per day in [2,3) range → -8% per day
  INACTIVITY_HEAVY_FACTOR: 0.04,   // rate of decay per day above 3 days → -4% per day
  INACTIVITY_FLOOR: 0.75,          // floor multiplier (max 25% decay on RecentPerformance)

  // ── FairValue change cap (per valuation run) ──────────────────────────────
  // Prevents a single batch from moving fair value by more than this amount ($GS).
  // Smooths out large revaluations from new match data.
  FAIR_VALUE_MAX_DELTA: 1.5,       // max ±$1.50 per valuation update

  // ── Bot behavior thresholds (centralized) ────────────────────────────────
  TREND_BUY_MOMENTUM: 12,
  TREND_SELL_MOMENTUM: 18,        // was 20; sell on exhaustion sooner
  DAILY_OVEREXTENSION_PCT: 12.0,  // was 15; tighter trigger
  PROFIT_TAKE_PCT: 0.06,          // was 0.08; take profit sooner
  VALUE_SELL_THRESHOLD: 1.08,     // was 1.10; sell when 8% above reference

  // ── Fundamental seller bot thresholds ────────────────────────────────────
  FUNDAMENTAL_SELL_DIV_THRESHOLD: 8,   // sell when market >8% above fair value
  FUNDAMENTAL_BUY_DIV_THRESHOLD: -10,  // buy when market >10% below fair value
};

// ─── Basic Math ──────────────────────────────────────────────────────────────

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function clampZ(z: number): number {
  return clamp(z, -3, 3);
}

export function emaUpdate(previous: number, current: number, alpha: number): number {
  return previous * (1 - alpha) + current * alpha;
}

export function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function normalizeTo100(value: number, min: number, max: number): number {
  if (max <= min) return 50;
  return clamp(((value - min) / (max - min)) * 100, 0, 100);
}

// ─── Inactivity Decay ─────────────────────────────────────────────────────────

/**
 * Computes a decay multiplier [0.75, 1.0] applied to RecentPerformance
 * when a player has been inactive.
 *
 * Tiers (separate from ActivityScore — this is a direct penalty on recent perf):
 *   0–1 day:  multiplier = 1.00 (grace period, no penalty)
 *   1–2 days: multiplier = 1.00 → 0.95 (light, -5%/day)
 *   2–3 days: multiplier = 0.95 → 0.87 (moderate, -8%/day)
 *   >3 days:  multiplier = 0.87 → FLOOR (heavy, -4%/day, floor=0.75)
 *
 * @param daysSinceLastMatch number of days since the player's last recorded match
 * @returns multiplier in [INACTIVITY_FLOOR, 1.0]
 */
export function computeInactivityDecayFactor(daysSinceLastMatch: number): number {
  const cfg = PVI_CONFIG;

  if (daysSinceLastMatch < cfg.INACTIVITY_GRACE_DAYS) {
    return 1.0;
  }

  if (daysSinceLastMatch < 2) {
    // Light decay: 1.0 → 0.95 over [1, 2) days
    return 1.0 - cfg.INACTIVITY_LIGHT_FACTOR * (daysSinceLastMatch - 1);
  }

  if (daysSinceLastMatch < 3) {
    // Moderate decay: 0.95 → 0.87 over [2, 3) days
    return 0.95 - cfg.INACTIVITY_MODERATE_FACTOR * (daysSinceLastMatch - 2);
  }

  // Heavy decay: 0.87 → floor with -4%/day, floor = INACTIVITY_FLOOR
  const extraDays = daysSinceLastMatch - 3;
  return Math.max(cfg.INACTIVITY_FLOOR, 0.87 - cfg.INACTIVITY_HEAVY_FACTOR * extraDays);
}

// ─── MPS (Match Performance Score, 0-100) ────────────────────────────────────

export function computeMPS(rawMatchScore: number, scaleFactor = 10): number {
  return clamp(50 + (rawMatchScore / scaleFactor) * 50, 0, 100);
}

export function ppToMPS(pp: number): number {
  return clamp(pp, 0, 100);
}

// ─── PVI Components ──────────────────────────────────────────────────────────

export function computeRecentPerformance(
  matchScores: number[],
  window = PVI_CONFIG.RECENT_WINDOW,
): number {
  const recent = matchScores.slice(-window);
  if (recent.length === 0) return PVI_CONFIG.NEUTRAL_PVI;

  let ema = recent[0];
  for (let i = 1; i < recent.length; i++) {
    ema = emaUpdate(ema, recent[i], PVI_CONFIG.EMA_ALPHA);
  }
  return clamp(ema, 0, 100);
}

export function computeConsistencyScore(
  matchScores: number[],
  window = PVI_CONFIG.CONSISTENCY_WINDOW,
): number {
  const recent = matchScores.slice(-window);
  if (recent.length < 2) return 50;
  const sd = stdDev(recent);
  return clamp(100 - (sd / 30) * 100, 0, 100);
}

export function computeHistoricalSkill(
  matchScores: number[],
  matchTimestampsMs: number[],
  nowMs = Date.now(),
): number {
  if (matchScores.length === 0) return PVI_CONFIG.NEUTRAL_PVI;

  const HALF_LIFE_MS = 90 * 24 * 60 * 60 * 1000;
  let weightedSum = 0;
  let totalWeight = 0;

  for (let i = 0; i < matchScores.length; i++) {
    const ageMs = nowMs - (matchTimestampsMs[i] ?? nowMs);
    const weight = Math.exp(-ageMs / HALF_LIFE_MS);
    weightedSum += matchScores[i] * weight;
    totalWeight += weight;
  }

  return totalWeight > 0 ? clamp(weightedSum / totalWeight, 0, 100) : PVI_CONFIG.NEUTRAL_PVI;
}

export function computeActivityScore(
  matchCount7d: number,
  matchCount30d: number,
  daysSinceLastMatch: number,
): number {
  const recencyScore = clamp(100 - (daysSinceLastMatch / 30) * 100, 0, 100);
  const weeklyVolumeScore = clamp((matchCount7d / 7) * 100, 0, 100);
  const monthlyVolumeScore = clamp((matchCount30d / 30) * 100, 0, 100);
  return clamp(
    recencyScore * 0.40 + weeklyVolumeScore * 0.40 + monthlyVolumeScore * 0.20,
    0,
    100,
  );
}

export function computeConfidenceScore(
  totalMatchCount: number,
  daysSinceLastMatch: number,
  hasRoleData: boolean,
): number {
  const sampleFactor = clamp(totalMatchCount / 20, 0, 1);
  const recencyFactor = clamp(1 - daysSinceLastMatch / 60, 0, 1);
  const roleFactor = hasRoleData ? 1.0 : 0.75;
  return clamp(sampleFactor * 0.40 + recencyFactor * 0.40 + roleFactor * 0.20, 0, 1);
}

// ─── PVI Computation ─────────────────────────────────────────────────────────

export interface PVIComponents {
  recentPerformance: number;
  consistencyScore: number;
  historicalSkill: number;
  activityScore: number;
  confidenceScore: number;
}

/**
 * PVI_raw: Weights — recentPerf 40%, consistency 20%, historicalSkill 25%, activity 15%
 * NOTE: recentPerformance is the dominant driver (40%) to make performance-led pricing work.
 */
export function computePVIRaw(components: PVIComponents): number {
  const { recentPerformance, consistencyScore, historicalSkill, activityScore } = components;
  return clamp(
    recentPerformance * 0.40 +
    consistencyScore * 0.20 +
    historicalSkill * 0.25 +
    activityScore * 0.15,
    0,
    100,
  );
}

export function computePVIAdjusted(pviFinal: number, confidenceScore: number): number {
  const neutralWeight = clamp(1 - confidenceScore, 0, 1);
  return clamp(
    pviFinal * confidenceScore + PVI_CONFIG.NEUTRAL_PVI * neutralWeight,
    0,
    100,
  );
}

// ─── Fair Value ───────────────────────────────────────────────────────────────

/**
 * FairValue in GS$: converts PVI_adjusted (0-100) to a price target.
 *
 * CALIBRATED to match actual market price range ($5-30):
 *   Formula: MIN + (pviAdjusted/100)^POWER * SCALE
 *   PVI 50 → ~$13.84  |  PVI 70 → ~$19.64  |  PVI 100 → $30.00
 *
 * This calibration ensures divergence (market - fair) is ±20-35% instead of
 * -90% (which was caused by the old MAX=500 formula and broke all gravity).
 */
export function computeFairValue(pviAdjusted: number): number {
  const normalized = clamp(pviAdjusted / 100, 0, 1);
  const fairValue = PVI_CONFIG.FAIR_VALUE_MIN + Math.pow(normalized, PVI_CONFIG.FAIR_VALUE_POWER) * PVI_CONFIG.FAIR_VALUE_SCALE;
  return clamp(fairValue, PVI_CONFIG.FAIR_VALUE_MIN, PVI_CONFIG.FAIR_VALUE_MAX);
}

// ─── Divergence ───────────────────────────────────────────────────────────────

/**
 * Divergence %: how far Market Price has strayed from Fair Value.
 * Positive = overvalued (market > fair) → bots should SELL
 * Negative = undervalued (market < fair) → bots should BUY
 */
export function computeDivergence(marketPrice: number, fairValue: number): number {
  if (fairValue <= 0) return 0;
  return ((marketPrice - fairValue) / fairValue) * 100;
}

// ─── Per-Trade Gravity ────────────────────────────────────────────────────────

/**
 * GravityPct: fractional price adjustment applied after each trade.
 * Pulls price toward fair value. Works correctly now that FV is calibrated.
 *
 * STRUCTURAL GUARD: Divergence below STRUCTURAL_DIVERGENCE_THRESHOLD (-70%)
 * indicates a data error, not a real signal. Return 0 in this zone.
 */
export function computeGravityPct(divergencePct: number): number {
  if (divergencePct < PVI_CONFIG.STRUCTURAL_DIVERGENCE_THRESHOLD) {
    return 0;
  }
  const raw = -(divergencePct / 100) * PVI_CONFIG.GRAVITY_FACTOR;
  return clamp(raw, -PVI_CONFIG.MAX_TICK_MOVE, PVI_CONFIG.MAX_TICK_MOVE);
}

// ─── Performance Anchor Engine (PAE) ─────────────────────────────────────────

/**
 * Compute the PAE anchor factor for a given divergence percentage.
 * This is applied to ALL assets every market tick as a structural convergence force.
 *
 * Returns a fractional price adjustment (positive = nudge up, negative = nudge down).
 * The sign is automatically determined by the direction of divergence.
 *
 * Three bands:
 *   abs(div) < WEAK band  → WEAK factor (asset near fair value, light touch)
 *   abs(div) < STRONG band → MODERATE factor
 *   abs(div) ≥ STRONG band → STRONG factor (far from fair value, stronger correction)
 */
export function computePerformanceAnchorPct(divergencePct: number, confidenceScore: number): number {
  if (confidenceScore < PVI_CONFIG.PERF_ANCHOR_MIN_CONFIDENCE) return 0;
  if (divergencePct < PVI_CONFIG.STRUCTURAL_DIVERGENCE_THRESHOLD) return 0;

  const absDivPct = Math.abs(divergencePct);
  let factor: number;

  if (absDivPct < PVI_CONFIG.PERF_ANCHOR_BAND_WEAK) {
    factor = PVI_CONFIG.PERF_ANCHOR_FACTOR_WEAK;
  } else if (absDivPct < PVI_CONFIG.PERF_ANCHOR_BAND_STRONG) {
    factor = PVI_CONFIG.PERF_ANCHOR_FACTOR_MODERATE;
  } else {
    factor = PVI_CONFIG.PERF_ANCHOR_FACTOR_STRONG;
  }

  const raw = -(divergencePct / 100) * factor;
  return clamp(raw, -PVI_CONFIG.PERF_ANCHOR_MAX_MOVE, PVI_CONFIG.PERF_ANCHOR_MAX_MOVE);
}

// ─── Trade Impact ────────────────────────────────────────────────────────────

export function computeTradeImpact(shares: number, supply: number): number {
  if (supply <= 0) return 1;
  return clamp(shares / supply, 0, 1);
}

/**
 * Role-Based Performance Engine v2
 *
 * Computes a 3-component composite MatchScore (0-100) from:
 *   - RoleRelativeScore (60%): z-score vs Challenger baseline for that role
 *   - SelfTrendScore   (25%): current match vs player's own recent EMA
 *   - ContextScore     (15%): win/loss + match duration weight
 *
 * This replaces the previous flat PP computation (absolute normalization).
 *
 * Pipeline:
 *   Match data
 *   → RoleRelativeScore (z-score, 0-100)
 *   → SelfTrendScore    (vs own EMA, 0-100)
 *   → ContextScore      (win+duration, 0-100)
 *   → CompositeMatchScore (weighted, 0-100)
 *   → RecentPerformance (EMA-smoothed, 0-100)
 *   → PVI → FairValue → Market gravity
 */

import { db } from "../db";
import { roleBaselines, roleMetricWeights, playerMatchMetrics, performanceScores } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";

// ─── Centralized Config ───────────────────────────────────────────────────────

export const PERF_ENGINE_CONFIG = {
  // ── Composite MatchScore weights ─────────────────────────────────────────
  ROLE_RELATIVE_WEIGHT: 0.60,   // How player compares to Challenger baseline of the role
  SELF_TREND_WEIGHT: 0.25,      // How player compares to their own recent form
  CONTEXT_WEIGHT: 0.15,         // Win/loss + match duration signal

  // ── Match-level EMA smoothing ────────────────────────────────────────────
  // Applied when storing performanceScores.emaScore (z-score EMA, legacy use)
  EMA_ALPHA: 0.22,              // was 0.25; slightly more smoothing per match
  MAX_EMA_STEP: 12,             // max EMA shift per game on 0-100 scale (prevents outlier explosion)

  // ── SelfTrend signal ─────────────────────────────────────────────────────
  // SelfTrendScore = 50 + (currentRRS - prevEma) * AMPLIFIER
  // Amplifier > 1 makes trend signal more sensitive; < 1 dampens it
  SELF_TREND_AMPLIFIER: 1.5,    // e.g. +10 pts above own avg → STS = 65 (+15)
  SELF_TREND_WINDOW: 10,        // number of recent games used to compute player EMA for comparison

  // ── ContextScore ─────────────────────────────────────────────────────────
  WIN_BONUS: 8,                 // added to base 50 on a win
  SHORT_GAME_PENALTY: -5,       // game < SHORT_GAME_MIN: less meaningful/competitive
  LONG_GAME_BONUS: 3,           // game > LONG_GAME_MIN: more competitive, longer test
  SHORT_GAME_MIN: 20,           // minutes
  LONG_GAME_MIN: 35,            // minutes

  // ── Z-score scaling ───────────────────────────────────────────────────────
  // The raw weighted z-score is multiplied by this to spread into [-10, +10]
  // Then mapped to [0, 100] via computeRoleRelativeScore
  Z_SCORE_SCALE: 4,             // unchanged from v1
  Z_SCORE_MAX: 10,              // clamp boundary
};

// ─── Role Detection ───────────────────────────────────────────────────────────

export type PlayerRole = "TOP" | "JUNGLE" | "MID" | "ADC" | "SUPPORT";

const POSITION_MAP: Record<string, PlayerRole> = {
  TOP: "TOP",
  JUNGLE: "JUNGLE",
  MIDDLE: "MID",
  MID: "MID",
  BOTTOM: "ADC",
  ADC: "ADC",
  UTILITY: "SUPPORT",
  SUPPORT: "SUPPORT",
};

export function detectRole(
  teamPosition?: string,
  individualPosition?: string,
): PlayerRole {
  const candidates = [teamPosition, individualPosition].filter(Boolean);
  for (const pos of candidates) {
    const mapped = POSITION_MAP[(pos || "").toUpperCase()];
    if (mapped) return mapped;
  }
  return "MID";
}

// ─── Metric Extraction ────────────────────────────────────────────────────────

export interface MatchParticipant {
  kills: number;
  deaths: number;
  assists: number;
  totalDamageDealtToChampions: number;
  goldEarned: number;
  visionScore: number;
  totalMinionsKilled: number;
  neutralMinionsKilled: number;
  wardsPlaced: number;
  wardsKilled: number;
  win: boolean;
}

export function extractMetrics(
  role: PlayerRole,
  p: MatchParticipant,
  teamKills: number,
  durationMin: number,
): Record<string, number> {
  const cs = (p.totalMinionsKilled || 0) + (p.neutralMinionsKilled || 0);
  const csPerMin = durationMin > 0 ? cs / durationMin : 0;
  const dpm = durationMin > 0 ? (p.totalDamageDealtToChampions || 0) / durationMin : 0;
  const kda = (p.kills + p.assists) / Math.max(1, p.deaths);
  const killParticipation = teamKills > 0 ? (p.kills + p.assists) / teamKills : 0;
  const deathsPerMin = durationMin > 0 ? p.deaths / durationMin : 0;
  const assistRate = (p.kills + p.assists) > 0 ? p.assists / (p.kills + p.assists) : 0;
  const wardClearRate = (p.wardsPlaced + p.wardsKilled) > 0
    ? p.wardsKilled / (p.wardsPlaced + p.wardsKilled)
    : 0;
  const win = p.win ? 1 : 0;

  switch (role) {
    case "TOP":
      return { cs_per_min: csPerMin, damage_per_min: dpm, kill_participation: killParticipation, deaths_per_min: deathsPerMin, win };
    case "JUNGLE":
      return { kill_participation: killParticipation, vision_score: p.visionScore || 0, cs_per_min: csPerMin, deaths_per_min: deathsPerMin, win };
    case "MID":
      return { damage_per_min: dpm, cs_per_min: csPerMin, kill_participation: killParticipation, kda, win };
    case "ADC":
      return { damage_per_min: dpm, cs_per_min: csPerMin, kill_participation: killParticipation, deaths_per_min: deathsPerMin, win };
    case "SUPPORT":
      return { vision_score: p.visionScore || 0, kill_participation: killParticipation, ward_clear_rate: wardClearRate, assist_rate: assistRate, win };
  }
}

// ─── Challenger Baselines (Defaults) ─────────────────────────────────────────

interface BaselineEntry { mean: number; std: number }

const DEFAULT_BASELINES: Record<string, Record<string, BaselineEntry>> = {
  TOP: {
    cs_per_min:        { mean: 8.5,   std: 1.2  },
    damage_per_min:    { mean: 600,   std: 120  },
    kill_participation:{ mean: 0.50,  std: 0.12 },
    deaths_per_min:    { mean: 0.20,  std: 0.08 },
    win:               { mean: 0.55,  std: 0.20 },
  },
  JUNGLE: {
    kill_participation:{ mean: 0.68,  std: 0.10 },
    vision_score:      { mean: 45,    std: 12   },
    cs_per_min:        { mean: 5.5,   std: 1.0  },
    deaths_per_min:    { mean: 0.18,  std: 0.07 },
    win:               { mean: 0.55,  std: 0.20 },
  },
  MID: {
    damage_per_min:    { mean: 600,   std: 120  },
    cs_per_min:        { mean: 8.0,   std: 1.1  },
    kill_participation:{ mean: 0.62,  std: 0.10 },
    kda:               { mean: 3.5,   std: 1.5  },
    win:               { mean: 0.55,  std: 0.20 },
  },
  ADC: {
    damage_per_min:    { mean: 720,   std: 95   },
    cs_per_min:        { mean: 9.5,   std: 1.0  },
    kill_participation:{ mean: 0.65,  std: 0.09 },
    deaths_per_min:    { mean: 0.18,  std: 0.08 },
    win:               { mean: 0.55,  std: 0.20 },
  },
  SUPPORT: {
    vision_score:      { mean: 82,    std: 11.4 },
    kill_participation:{ mean: 0.72,  std: 0.10 },
    ward_clear_rate:   { mean: 0.55,  std: 0.15 },
    assist_rate:       { mean: 0.80,  std: 0.12 },
    win:               { mean: 0.55,  std: 0.20 },
  },
};

const DEFAULT_WEIGHTS: Record<string, Record<string, number>> = {
  TOP:     { cs_per_min: 0.25, damage_per_min: 0.25, kill_participation: 0.20, deaths_per_min: -0.05, win: 0.25 },
  JUNGLE:  { kill_participation: 0.30, vision_score: 0.15, cs_per_min: 0.15, deaths_per_min: -0.05, win: 0.35 },
  MID:     { damage_per_min: 0.30, cs_per_min: 0.20, kill_participation: 0.20, kda: 0.05, win: 0.25 },
  ADC:     { damage_per_min: 0.30, cs_per_min: 0.20, kill_participation: 0.20, deaths_per_min: -0.05, win: 0.25 },
  SUPPORT: { vision_score: 0.30, kill_participation: 0.20, ward_clear_rate: 0.15, assist_rate: 0.10, win: 0.25 },
};

// ─── Baseline Loading ─────────────────────────────────────────────────────────

const baselineCache = new Map<string, { data: Record<string, BaselineEntry>; expiresAt: number }>();
const weightCache = new Map<string, { data: Record<string, number>; expiresAt: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000;

export async function loadBaselines(game: string, role: string): Promise<Record<string, BaselineEntry>> {
  const key = `${game}:${role}`;
  const cached = baselineCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  const rows = await db
    .select()
    .from(roleBaselines)
    .where(and(eq(roleBaselines.game, game), eq(roleBaselines.role, role)));

  const data: Record<string, BaselineEntry> = { ...DEFAULT_BASELINES[role] };
  for (const row of rows) {
    data[row.metric] = { mean: parseFloat(row.meanValue), std: parseFloat(row.stdDev) };
  }

  baselineCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}

export async function loadWeights(game: string, role: string): Promise<Record<string, number>> {
  const key = `${game}:${role}`;
  const cached = weightCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  const rows = await db
    .select()
    .from(roleMetricWeights)
    .where(and(eq(roleMetricWeights.game, game), eq(roleMetricWeights.role, role)));

  const data: Record<string, number> = { ...(DEFAULT_WEIGHTS[role] || {}) };
  for (const row of rows) {
    data[row.metric] = parseFloat(row.weight);
  }

  weightCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}

// ─── Z-Score (vs Challenger baseline) ────────────────────────────────────────

export function computeZScore(value: number, mean: number, std: number): number {
  if (std <= 0) return 0;
  const z = (value - mean) / std;
  return Math.max(-5, Math.min(5, z));
}

/**
 * Raw z-score match score in [-10, +10]:
 *   0   = exactly at Challenger average for this role
 *  +5   = 1.25σ above Challenger average
 * -10   = 2.5σ below Challenger average
 */
export async function computeMatchScore(
  metrics: Record<string, number>,
  role: PlayerRole,
  game: string,
): Promise<number> {
  const baselines = await loadBaselines(game, role);
  const weights = await loadWeights(game, role);

  let score = 0;
  for (const [metric, value] of Object.entries(metrics)) {
    const baseline = baselines[metric];
    const weight = weights[metric];
    if (!baseline || weight === undefined) continue;
    const z = computeZScore(value, baseline.mean, baseline.std);
    score += z * weight;
  }

  const cfg = PERF_ENGINE_CONFIG;
  score = score * cfg.Z_SCORE_SCALE;
  return Math.max(-cfg.Z_SCORE_MAX, Math.min(cfg.Z_SCORE_MAX, score));
}

// ─── Component 1: RoleRelativeScore (0-100) ───────────────────────────────────

/**
 * Converts the raw z-score match score to 0-100.
 *
 * Mapping:
 *   z = 0   (at Challenger avg)   → 50
 *   z = +10 (far above avg)       → 100
 *   z = -10 (far below avg)       → 0
 *
 * A Challenger-level "average" game gives exactly 50.
 * A bad game by Challenger standards gives < 50 even if stats look "okay" in isolation.
 */
export function computeRoleRelativeScore(rawZScore: number): number {
  return Math.max(0, Math.min(100, 50 + (rawZScore / PERF_ENGINE_CONFIG.Z_SCORE_MAX) * 50));
}

// ─── Component 2: SelfTrendScore (0-100) ─────────────────────────────────────

/**
 * Compares the current match RoleRelativeScore against the player's own recent EMA.
 *
 * Behavior:
 *   - currentRRS > prevEma  → player above their own form → STS > 50 (positive trend)
 *   - currentRRS < prevEma  → player below their own form → STS < 50 (decelerating)
 *   - currentRRS = prevEma  → STS = 50 (neutral)
 *
 * Amplifier makes the trend signal more sensitive.
 *
 * @param currentRRS  RoleRelativeScore for this match (0-100)
 * @param prevEma     Player's recent performance EMA before this match (0-100)
 */
export function computeSelfTrendScore(currentRRS: number, prevEma: number): number {
  const delta = currentRRS - prevEma;
  const amplified = delta * PERF_ENGINE_CONFIG.SELF_TREND_AMPLIFIER;
  return Math.max(0, Math.min(100, 50 + amplified));
}

// ─── Component 3: ContextScore (0-100) ───────────────────────────────────────

/**
 * Lightweight contextual signal — win/loss + match duration.
 * Low weight (15%) so it never dominates.
 *
 * Short games (<20min) are less meaningful; long games (>35min) are more competitive.
 */
export function computeContextScore(won: boolean, durationMin: number): number {
  const cfg = PERF_ENGINE_CONFIG;
  let score = 50;
  if (won) score += cfg.WIN_BONUS;
  if (durationMin < cfg.SHORT_GAME_MIN) score += cfg.SHORT_GAME_PENALTY;
  else if (durationMin >= cfg.LONG_GAME_MIN) score += cfg.LONG_GAME_BONUS;
  return Math.max(0, Math.min(100, score));
}

// ─── Composite Match Score (0-100) ────────────────────────────────────────────

/**
 * Final MatchScore: weighted blend of the 3 components.
 *
 * MatchScore = RRS × 0.60 + STS × 0.25 + CTX × 0.15
 *
 * Interpretation:
 *   50  = exactly at Challenger average, no improvement trend, draw-ish game
 *   70  = moderately above Challenger average with improving trend
 *   85+ = elite performance, clearly improving
 *   30  = below average performance with declining trend
 */
export function computeCompositeMatchScore(rrs: number, sts: number, ctx: number): number {
  const cfg = PERF_ENGINE_CONFIG;
  return Math.max(0, Math.min(100,
    rrs * cfg.ROLE_RELATIVE_WEIGHT +
    sts * cfg.SELF_TREND_WEIGHT +
    ctx * cfg.CONTEXT_WEIGHT,
  ));
}

// ─── EMA (match-level) ────────────────────────────────────────────────────────

/** Legacy: EMA on z-score space ([-10,+10]) for performanceScores table. */
export function applyEMA(previousEma: number, matchScore: number, alpha = PERF_ENGINE_CONFIG.EMA_ALPHA): number {
  return previousEma * (1 - alpha) + matchScore * alpha;
}

/**
 * EMA with per-step clamp — prevents a single outlier match from jumping the EMA
 * by more than MAX_EMA_STEP points (on a 0-100 scale).
 *
 * @param prevEma    Previous EMA value (0-100)
 * @param newScore   New match score (0-100)
 * @param alpha      EMA smoothing factor
 * @param maxStep    Max change per step (default from config)
 */
export function applyEMAWithClamp(
  prevEma: number,
  newScore: number,
  alpha = PERF_ENGINE_CONFIG.EMA_ALPHA,
  maxStep = PERF_ENGINE_CONFIG.MAX_EMA_STEP,
): number {
  const unclamped = prevEma * (1 - alpha) + newScore * alpha;
  const delta = unclamped - prevEma;
  const clampedDelta = Math.max(-maxStep, Math.min(maxStep, delta));
  return Math.max(0, Math.min(100, prevEma + clampedDelta));
}

/** Performance impact on price from z-score EMA: ±1.5% max. */
export function computePerformanceImpact(emaScore: number): number {
  const impact = emaScore * 0.0015;
  return Math.max(-0.015, Math.min(0.015, impact));
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

export async function getLatestEma(assetId: string): Promise<number> {
  const [row] = await db
    .select({ emaScore: performanceScores.emaScore })
    .from(performanceScores)
    .where(eq(performanceScores.assetId, assetId))
    .orderBy(desc(performanceScores.createdAt))
    .limit(1);
  return row ? parseFloat(row.emaScore) : 0;
}

export async function storeMatchPerformance(
  assetId: string,
  matchId: string,
  role: PlayerRole,
  metrics: Record<string, number>,
  matchScore: number,
  emaScore: number,
  game = "LOL",
): Promise<void> {
  await db
    .insert(playerMatchMetrics)
    .values({ assetId, matchId, game, role, metricsJson: metrics })
    .onConflictDoNothing();

  await db
    .insert(performanceScores)
    .values({
      assetId,
      matchId,
      role,
      matchScore: matchScore.toFixed(4),
      emaScore: emaScore.toFixed(4),
    });
}

// ─── Seed defaults ────────────────────────────────────────────────────────────

let seedDone = false;

export async function seedDefaultBaselines(): Promise<void> {
  if (seedDone) return;
  seedDone = true;

  const [existing] = await db.select({ count: sql<number>`count(*)::int` }).from(roleBaselines);
  if (Number(existing?.count) > 0) {
    console.log("[PerfEngine] Baselines already seeded, skipping.");
    return;
  }

  const rows = [];
  for (const [role, metrics] of Object.entries(DEFAULT_BASELINES)) {
    for (const [metric, { mean, std }] of Object.entries(metrics)) {
      rows.push({
        game: "LOL",
        queue: "RANKED_SOLO",
        tier: "CHALLENGER",
        role,
        metric,
        meanValue: mean.toFixed(4),
        stdDev: std.toFixed(4),
        sampleSize: 0,
      });
    }
  }

  await db.insert(roleBaselines).values(rows).onConflictDoNothing();

  const weightRows = [];
  for (const [role, weights] of Object.entries(DEFAULT_WEIGHTS)) {
    for (const [metric, weight] of Object.entries(weights)) {
      weightRows.push({ game: "LOL", role, metric, weight: weight.toFixed(4) });
    }
  }
  await db.insert(roleMetricWeights).values(weightRows).onConflictDoNothing();

  console.log(`[PerfEngine] Seeded ${rows.length} baselines and ${weightRows.length} weights.`);
}

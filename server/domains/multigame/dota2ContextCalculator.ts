// ─── Dota2 Context Calculator ─────────────────────────────────────────────────
// Computes ContextScore for a match based on situational factors.
//
// Formula:
//   ContextScore =
//     0.35 × MatchDifficulty     (neutral 50 when no signal)
//     0.20 × MatchLengthFit      (how well the metrics suit the game length)
//     0.20 × ObjectiveLeverage   (objective contribution signals)
//     0.15 × WinLossContext       (win = 55, loss = 45)
//     0.10 × RoleExpectationFit   (coherence between metrics and detected role)
//
// Design:
//   - No external DB calls — pure function
//   - All sub-scores 0–100
//   - Neutral baseline = 50 when signal is absent
//   - Intentionally bounded so ContextScore never dominates PerformanceScore
// ─────────────────────────────────────────────────────────────────────────────

import type { DetectedRole, DurationBucket } from "@shared/schema";
import type { DerivedMetricMap }             from "./dota2MetricDeriver";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MatchContextInput {
  role:          DetectedRole;
  durationBucket: DurationBucket | null;
  won:           boolean;
  isRanked:      boolean;
  metrics:       DerivedMetricMap;
  /** RoleRelativeScore from Fase 5 — used as proxy for role coherence */
  roleRelativeScore: number;
}

export interface ContextScoreResult {
  contextScore:        number;   // 0–100
  matchDifficulty:     number;
  matchLengthFit:      number;
  objectiveLeverage:   number;
  winLossContext:       number;
  roleExpectationFit:  number;
}

// ── Sub-score calculators ─────────────────────────────────────────────────────

/**
 * MatchDifficulty:
 * We don't have MMR of opponents in this phase. Use a conservative neutral 50.
 * Slight adjustments: if the player won AND had negative role relative score,
 * difficulty was likely high → bump to 60. Vice-versa: won comfortably → 40.
 */
function calcMatchDifficulty(won: boolean, roleRelativeScore: number): number {
  // roleRelativeScore < 45 = below-average game
  if (won && roleRelativeScore < 45) return 65;   // won despite bad game → harder
  if (!won && roleRelativeScore > 60) return 60;  // lost despite good game → harder
  if (won && roleRelativeScore > 60)  return 40;  // won and played well → easier
  return 50; // neutral default
}

/**
 * MatchLengthFit:
 * Some metrics (GPM, net_worth) are naturally lower in short games and
 * higher in long games. Score how well the metrics fit the game length.
 * Farm-heavy metrics are more impressive in SHORT games, support metrics
 * are more consistent across durations.
 */
function calcMatchLengthFit(
  durationBucket: DurationBucket | null,
  role:           DetectedRole,
  metrics:        DerivedMetricMap,
): number {
  if (!durationBucket) return 50;

  const gpm = metrics.gpm ?? 0;
  const tfp = metrics.teamfight_participation ?? 0;

  // Carry roles benefit from longer games (more farm time) → SHORT games with
  // high GPM are extra impressive
  if ((role === "P1" || role === "P2") && durationBucket === "SHORT" && gpm > 400) {
    return 65;
  }
  // Support roles in long games typically have more impact
  if ((role === "P4" || role === "P5") && durationBucket === "LONG" && tfp > 0.5) {
    return 60;
  }
  // Medium is the "normal" expectation → neutral
  if (durationBucket === "MEDIUM") return 52;

  return 50;
}

/**
 * ObjectiveLeverage:
 * Measures how much the player contributed to objectives.
 * Primary signals: tower_damage, teamfight_participation, deward_count.
 */
function calcObjectiveLeverage(
  role:    DetectedRole,
  metrics: DerivedMetricMap,
): number {
  const towerDmg  = metrics.tower_damage ?? 0;
  const tfp       = metrics.teamfight_participation ?? 0;
  const dewards   = metrics.deward_count ?? 0;
  const obsWards  = metrics.observer_wards ?? 0;

  let score = 50; // neutral

  // Tower damage contribution
  if (towerDmg > 5000) score += 12;
  else if (towerDmg > 2000) score += 6;
  else if (towerDmg > 500) score += 3;

  // Teamfight participation
  if (tfp > 0.7)       score += 10;
  else if (tfp > 0.5)  score += 5;
  else if (tfp < 0.3)  score -= 5;

  // Support: ward and deward signals
  if (role === "P4" || role === "P5") {
    if (obsWards >= 6) score += 8;
    else if (obsWards >= 3) score += 4;
    if (dewards >= 4) score += 6;
    else if (dewards >= 2) score += 3;
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * WinLossContext:
 * Simple: win = 55, loss = 45. Neutral lean — never dominates.
 * A win is a mild positive signal, a loss is a mild negative signal.
 * The player's individual performance (captured by other sub-scores) matters more.
 */
function calcWinLossContext(won: boolean): number {
  return won ? 55 : 45;
}

/**
 * RoleExpectationFit:
 * Measures coherence between the player's metrics and the detected role.
 * We use RoleRelativeScore as the primary proxy: a high RRS means the player
 * performed in line with role expectations. Scale it into a 0–100 range
 * with a mild non-linear curve so very high RSS is recognized but doesn't
 * dominate (the weight is only 0.10).
 *
 * Additional signal: deward/ward presence for support roles.
 */
function calcRoleExpectationFit(
  role:              DetectedRole,
  metrics:           DerivedMetricMap,
  roleRelativeScore: number,
): number {
  // Primary: RRS already captures role-specific performance
  // Map RRS linearly to [30, 80] range (mild scaling)
  const base = 30 + (roleRelativeScore / 100) * 50;

  let bonus = 0;

  // Carry: last_hits and GPM signal
  if (role === "P1") {
    const lh  = metrics.last_hits ?? 0;
    const gpm = metrics.gpm ?? 0;
    if (lh > 200 && gpm > 500) bonus += 10;
    else if (lh > 100 && gpm > 400) bonus += 5;
  }

  // Mid: kills + hero damage
  if (role === "P2") {
    const kills = metrics.kills ?? 0;
    const hd    = metrics.hero_damage ?? 0;
    if (kills > 8 && hd > 25000) bonus += 10;
    else if (kills > 5 && hd > 15000) bonus += 5;
  }

  // Support: wards + assists
  if (role === "P4" || role === "P5") {
    const obs  = metrics.observer_wards ?? 0;
    const sen  = metrics.sentry_wards ?? 0;
    const asst = metrics.assists ?? 0;
    if ((obs + sen) >= 6 && asst >= 10) bonus += 10;
    else if ((obs + sen) >= 3 && asst >= 6) bonus += 5;
  }

  return Math.max(0, Math.min(100, base + bonus));
}

// ── Main calculator ───────────────────────────────────────────────────────────

/**
 * Calculate the full ContextScore and all sub-components.
 */
export function calculateContextScore(input: MatchContextInput): ContextScoreResult {
  const { role, durationBucket, won, metrics, roleRelativeScore } = input;

  const matchDifficulty    = calcMatchDifficulty(won, roleRelativeScore);
  const matchLengthFit     = calcMatchLengthFit(durationBucket, role, metrics);
  const objectiveLeverage  = calcObjectiveLeverage(role, metrics);
  const winLossContext      = calcWinLossContext(won);
  const roleExpectationFit = calcRoleExpectationFit(role, metrics, roleRelativeScore);

  const contextScore =
    0.35 * matchDifficulty   +
    0.20 * matchLengthFit    +
    0.20 * objectiveLeverage +
    0.15 * winLossContext    +
    0.10 * roleExpectationFit;

  return {
    contextScore:       parseFloat(Math.max(0, Math.min(100, contextScore)).toFixed(4)),
    matchDifficulty:    parseFloat(matchDifficulty.toFixed(4)),
    matchLengthFit:     parseFloat(matchLengthFit.toFixed(4)),
    objectiveLeverage:  parseFloat(objectiveLeverage.toFixed(4)),
    winLossContext:      parseFloat(winLossContext.toFixed(4)),
    roleExpectationFit: parseFloat(roleExpectationFit.toFixed(4)),
  };
}

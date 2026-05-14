// ─── Dota2 Role Detector ─────────────────────────────────────────────────────
// Determines the Dota2 role (P1–P5) for a match from parsed metrics.
//
// Priority chain:
//   A. PROVIDER  — use OpenDota's lane_role field if valid (1–5)
//   B. HEURISTIC — GS scoring model based on farm/support indicators
//   C. FALLBACK  — return UNKNOWN with low confidence
//
// Source → role_source, confidence → role_confidence (0.0–1.0)
// ─────────────────────────────────────────────────────────────────────────────
import type { DetectedRole, RoleSource } from "@shared/schema";
import type { ParsedMatchMetrics } from "./dota2MatchParser";

// ── Output type ───────────────────────────────────────────────────────────────

export interface RoleDetectionResult {
  detectedRole:   DetectedRole;
  roleSource:     RoleSource;
  roleConfidence: number;  // 0.0–1.0
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Minimum confidence threshold for a role to be considered "certain". */
export const ROLE_CONFIDENCE_THRESHOLD = 0.40;

/** Map from OpenDota lane_role integer → GS P-position label */
const PROVIDER_LANE_ROLE_MAP: Record<number, DetectedRole> = {
  1: "P1",  // Safe Lane (carry)
  2: "P2",  // Mid Lane
  3: "P3",  // Off Lane
  4: "P4",  // Soft Support
  5: "P5",  // Hard Support
};

// ── Provider-based detection ──────────────────────────────────────────────────

/**
 * Attempt to use the provider's lane_role value.
 * Returns null if the value is absent or not in the valid 1–5 range.
 */
function detectFromProvider(
  metrics: ParsedMatchMetrics,
): RoleDetectionResult | null {
  const laneRole = metrics.providerLaneRole;
  if (laneRole == null || laneRole < 1 || laneRole > 5) return null;
  const role = PROVIDER_LANE_ROLE_MAP[laneRole];
  if (!role) return null;

  // Reduce confidence for roaming players — their lane role is less definitive
  const confidence = metrics.isRoaming ? 0.75 : 0.90;

  return { detectedRole: role, roleSource: "PROVIDER", roleConfidence: confidence };
}

// ── Heuristic-based detection ─────────────────────────────────────────────────

interface RoleScore {
  role:  DetectedRole;
  score: number;
}

/**
 * Score-based heuristics derived from observed Dota2 role patterns.
 *
 * Each indicator contributes a positive or negative signal.
 * Final score is normalized to confidence via a sigmoid-like transform.
 */
function scoreRole(m: ParsedMatchMetrics): RoleScore[] {
  const gpm         = m.gpm          ?? 0;
  const xpm         = m.xpm          ?? 0;
  const lastHits    = m.lastHits     ?? 0;
  const netWorth    = m.netWorth     ?? 0;
  const heroDamage  = m.heroDamage   ?? 0;
  const towerDmg    = m.towerDamage  ?? 0;
  const obsPlaced   = m.obsPlaced    ?? 0;
  const senPlaced   = m.senPlaced    ?? 0;
  const assists     = m.assists      ?? 0;
  const kills       = m.kills        ?? 0;
  const deaths      = m.deaths       ?? 0;
  const healing     = m.heroHealing  ?? 0;
  const stunDur     = m.stunDuration ?? 0;

  const scores: Record<DetectedRole, number> = {
    P1: 0, P2: 0, P3: 0, P4: 0, P5: 0, UNKNOWN: 0,
  };

  // ── P1 signals (farming carry) ─────────────────────────────────────────────
  if (gpm > 600)      scores.P1 += 3;
  if (gpm > 500)      scores.P1 += 2;
  if (gpm > 400)      scores.P1 += 1;
  if (lastHits > 200) scores.P1 += 3;
  if (lastHits > 150) scores.P1 += 2;
  if (lastHits > 100) scores.P1 += 1;
  if (netWorth > 20000) scores.P1 += 2;
  if (netWorth > 15000) scores.P1 += 1;
  if (obsPlaced <= 2) scores.P1 += 1;    // carries rarely ward
  if (heroDamage > 20000) scores.P1 += 1;
  if (towerDmg > 3000) scores.P1 += 1;

  // ── P2 signals (mid laner) ─────────────────────────────────────────────────
  if (xpm > 650)      scores.P2 += 3;
  if (xpm > 550)      scores.P2 += 2;
  if (xpm > 450)      scores.P2 += 1;
  if (gpm > 450 && gpm <= 600) scores.P2 += 2;
  if (heroDamage > 25000) scores.P2 += 2;
  if (heroDamage > 18000) scores.P2 += 1;
  if (kills > 8)      scores.P2 += 2;
  if (kills > 5)      scores.P2 += 1;
  if (towerDmg > 5000) scores.P2 += 1;
  if (lastHits > 100 && lastHits <= 200) scores.P2 += 1;

  // ── P3 signals (offlaner) ─────────────────────────────────────────────────
  if (gpm > 350 && gpm <= 500) scores.P3 += 2;
  if (heroDamage > 20000) scores.P3 += 2;
  if (heroDamage > 15000) scores.P3 += 1;
  if (stunDur > 20)   scores.P3 += 2;   // offlaners often have CC
  if (stunDur > 10)   scores.P3 += 1;
  if (deaths > 4)     scores.P3 += 1;   // offlaners tend to die more
  if (obsPlaced <= 3) scores.P3 += 1;
  if (towerDmg > 2000) scores.P3 += 1;
  if (assists > 8)    scores.P3 += 1;   // offlaners fight a lot

  // ── P4 signals (soft support / roaming support) ────────────────────────────
  if (assists > 15)   scores.P4 += 3;
  if (assists > 10)   scores.P4 += 2;
  if (assists > 7)    scores.P4 += 1;
  if (obsPlaced >= 4) scores.P4 += 2;
  if (obsPlaced >= 2) scores.P4 += 1;
  if (m.isRoaming)    scores.P4 += 2;
  if (gpm < 400 && gpm > 200) scores.P4 += 1;
  if (healing > 1000) scores.P4 += 1;
  if (stunDur > 5)    scores.P4 += 1;

  // ── P5 signals (hard support) ─────────────────────────────────────────────
  if (senPlaced >= 5) scores.P5 += 3;
  if (senPlaced >= 3) scores.P5 += 2;
  if (obsPlaced >= 6) scores.P5 += 2;
  if (obsPlaced >= 4) scores.P5 += 1;
  if (assists > 12)   scores.P5 += 2;
  if (gpm < 300)      scores.P5 += 2;   // hard supports have very low farm
  if (gpm < 350)      scores.P5 += 1;
  if (netWorth < 8000) scores.P5 += 2;
  if (netWorth < 12000) scores.P5 += 1;
  if (lastHits < 30)  scores.P5 += 2;
  if (healing > 2000) scores.P5 += 1;
  if (deaths > 5)     scores.P5 += 1;   // hard supports often die to save cores

  return (Object.entries(scores) as [DetectedRole, number][])
    .filter(([k]) => k !== "UNKNOWN")
    .map(([role, score]) => ({ role, score }));
}

/**
 * Convert a raw score into a 0–1 confidence value using a soft-max approach.
 * Returns 0 if all scores are equal or all zero.
 */
function scoreToConfidence(scores: RoleScore[]): number {
  const top = scores[0];
  const second = scores[1];
  if (!top || top.score <= 0) return 0;
  if (!second || second.score <= 0) return Math.min(0.85, 0.5 + top.score / 20);
  // Margin between top and second determines confidence
  const margin = (top.score - second.score) / Math.max(1, top.score);
  return Math.min(0.85, 0.3 + margin * 0.6);
}

function detectFromHeuristics(
  metrics: ParsedMatchMetrics,
): RoleDetectionResult {
  const scores = scoreRole(metrics).sort((a, b) => b.score - a.score);
  const top = scores[0];

  if (!top || top.score === 0) {
    return { detectedRole: "UNKNOWN", roleSource: "FALLBACK", roleConfidence: 0.2 };
  }

  const confidence = scoreToConfidence(scores);

  return {
    detectedRole:   top.role,
    roleSource:     "HEURISTIC",
    roleConfidence: parseFloat(confidence.toFixed(4)),
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Detect the Dota2 role from parsed match metrics.
 *
 * Priority: PROVIDER lane_role → HEURISTIC scoring → FALLBACK UNKNOWN.
 */
export function detectRole(metrics: ParsedMatchMetrics): RoleDetectionResult {
  // A. Provider signal
  const providerResult = detectFromProvider(metrics);
  if (providerResult) return providerResult;

  // B. Heuristics
  return detectFromHeuristics(metrics);
}

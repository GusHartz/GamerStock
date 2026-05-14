// ─── Dota2 Confidence Calculator ─────────────────────────────────────────────
// Fase 7: ConfidenceScore 0..1 that qualifies the valuation.
//
// Formula:
//   ConfidenceScore = 0.35 * SampleConfidence
//                   + 0.25 * RoleConfidence
//                   + 0.20 * DataCompleteness
//                   + 0.20 * RankStability
//
// Proxies used (documented):
//   SampleConfidence  = clamp(sample_size / 30, 0, 1)
//     → 30+ eligible matches → full confidence. Source: latest eligibility snapshot.
//   RoleConfidence    = avg(role_confidence) from recent eligible analytics (up to 20).
//     → Fallback: role_detectability from latest snapshot (0..1).
//   DataCompleteness  = data_completeness from latest eligibility snapshot (already 0..1).
//   RankStability     = rank_signal bucket proxy:
//       immortal/divine → 1.00, ancient → 0.85, legend → 0.75, archon → 0.65,
//       crusader → 0.55, guardian → 0.45, herald → 0.35, unknown → 0.50.
//     Rationale: higher-rank players tend to play more consistently and more ranked games.
//
// Note: all weights sum to 1.0.
// ─────────────────────────────────────────────────────────────────────────────

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ConfidenceInput {
  sampleSize:        number;   // from player_eligibility_snapshots
  dataCompleteness:  number;   // from player_eligibility_snapshots (0..1)
  roleDetectability: number;   // from player_eligibility_snapshots (0..1) — fallback
  rankSignal:        string | null;

  // Recent per-match role_confidence values (from player_match_analytics)
  recentRoleConfidences: number[];  // empty → use roleDetectability fallback
}

export interface ConfidenceResult {
  confidenceScore:  number;  // 0..1
  sampleConfidence: number;
  roleConfidence:   number;
  dataCompleteness: number;
  rankStability:    number;
  proxyFlags: {
    roleConfidenceProxy:  boolean;
    rankStabilityProxy:   boolean;
  };
}

// ── Rank signal → stability mapping ──────────────────────────────────────────

const RANK_STABILITY_MAP: Record<string, number> = {
  immortal:   1.00,
  divine:     1.00,
  ancient:    0.85,
  legend:     0.75,
  archon:     0.65,
  crusader:   0.55,
  guardian:   0.45,
  herald:     0.35,
};

function rankStabilityFromSignal(signal: string | null): number {
  if (!signal) return 0.50;
  const normalized = signal.toLowerCase().trim();
  // "immortal_1", "divine_3" etc → strip digits
  const base = normalized.replace(/[_\s][0-9]+$/, "");
  return RANK_STABILITY_MAP[base] ?? RANK_STABILITY_MAP[normalized] ?? 0.50;
}

// ── Weights ───────────────────────────────────────────────────────────────────

const W_SAMPLE_CONFIDENCE = 0.35;
const W_ROLE_CONFIDENCE   = 0.25;
const W_DATA_COMPLETENESS = 0.20;
const W_RANK_STABILITY    = 0.20;

const SAMPLE_FULL_THRESHOLD = 30;  // 30+ matches → sampleConfidence = 1.0

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

// ── Public function ───────────────────────────────────────────────────────────

export function calculateConfidenceScore(input: ConfidenceInput): ConfidenceResult {
  const sampleConfidence = clamp(input.sampleSize / SAMPLE_FULL_THRESHOLD, 0, 1);

  const useRoleProxy = input.recentRoleConfidences.length === 0;
  let roleConfidence: number;
  if (!useRoleProxy) {
    const sum = input.recentRoleConfidences.reduce((a, b) => a + b, 0);
    roleConfidence = clamp(sum / input.recentRoleConfidences.length, 0, 1);
  } else {
    roleConfidence = clamp(input.roleDetectability, 0, 1);
  }

  const dataCompleteness = clamp(input.dataCompleteness, 0, 1);

  const useRankProxy = !input.rankSignal;
  const rankStability = rankStabilityFromSignal(input.rankSignal);

  const confidenceScore = parseFloat(
    (
      W_SAMPLE_CONFIDENCE * sampleConfidence +
      W_ROLE_CONFIDENCE   * roleConfidence   +
      W_DATA_COMPLETENESS * dataCompleteness +
      W_RANK_STABILITY    * rankStability
    ).toFixed(4),
  );

  return {
    confidenceScore:  clamp(confidenceScore, 0, 1),
    sampleConfidence: parseFloat(sampleConfidence.toFixed(4)),
    roleConfidence:   parseFloat(roleConfidence.toFixed(4)),
    dataCompleteness: parseFloat(dataCompleteness.toFixed(4)),
    rankStability:    parseFloat(rankStability.toFixed(4)),
    proxyFlags: {
      roleConfidenceProxy: useRoleProxy,
      rankStabilityProxy:  useRankProxy,
    },
  };
}

// ── MMR proxy from rank signal ────────────────────────────────────────────────
// Used by InitialValue bootstrap when no exact MMR is available.

const RANK_MMR_MAP: Record<string, number> = {
  immortal:  7500,
  divine:    6200,
  ancient:   5200,
  legend:    4200,
  archon:    3200,
  crusader:  2200,
  guardian:  1200,
  herald:     500,
};

export function estimateMmrFromRankSignal(rankSignal: string | null): { mmr: number; isProxy: boolean } {
  if (!rankSignal) return { mmr: 3000, isProxy: true };
  const normalized = rankSignal.toLowerCase().trim().replace(/[_\s][0-9]+$/, "");
  const mmr = RANK_MMR_MAP[normalized] ?? RANK_MMR_MAP[rankSignal.toLowerCase()] ?? 3000;
  return { mmr, isProxy: true };
}

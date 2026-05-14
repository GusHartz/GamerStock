// ─── CS2 Confidence Calculator ────────────────────────────────────────────────
// Fase 3 (CS2): ConfidenceScore 0..1 that qualifies the CS2 valuation.
//
// Formula:
//   ConfidenceScore = 0.35 * sampleConfidence
//                   + 0.25 * signalConfidence
//                   + 0.20 * dataCompleteness
//                   + 0.20 * stabilityScore
//
// Note: weights sum to 1.0 — same structure as Dota2 for pipeline parity.
//
// CS2-specific semantics (differs from Dota2):
//
//   sampleConfidence:
//     clamp(sampleSize / 50, 0, 1)
//     CS2 needs more games than Dota2 to establish stable stats (50 vs 30).
//     Rationale: CS2 competitive rounds are shorter, but variance is higher;
//                50 games is a more reliable threshold for FPS players.
//
//   signalConfidence  [replaces roleConfidence from Dota2]:
//     CS2 does NOT have defined positional roles (unlike Dota2's carry/support).
//     Instead, we measure the *quality* of the available rank signal:
//       • null rankSignal       → 0.40  (neutral; no rank info)
//       • unrecognised string   → 0.50  (some rank data, tier unknown)
//       • recognised tier       → 0.65  (rank maps to our tier table)
//     Rationale: rank tiers in CS2 are relatively transparent — a known tier
//     gives us a reliable signal about the player's skill ceiling.
//
//   dataCompleteness:
//     Directly from snapshot.dataCompleteness (0..1). Same as Dota2.
//
//   stabilityScore:
//     CS2 rank → stability mapping (different tiers from Dota2 MMR bands).
//     Higher-tier players tend to maintain consistent performance → higher stability.
//     Valve Competitive tiers (highest → lowest):
//       global_elite → supreme → legendary_eagle_master → legendary_eagle →
//       distinguished_master_guardian → master_guardian_elite → ...
//     FACEIT levels (faceit_10 is highest):
//       faceit_10, faceit_9 ... faceit_1
//
// Note: all defaults are conservative to avoid inflation at onboarding time
// when no data is available (all-zero snapshot).
//
// At onboarding (sampleSize=0, rankSignal=null, dataCompleteness=0):
//   confidenceScore ≈ 0.35*0 + 0.25*0.40 + 0.20*0 + 0.20*0.50 = 0.20
//   → Correctly reflects low confidence before any data collection.
// ─────────────────────────────────────────────────────────────────────────────

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Cs2ConfidenceInput {
  /** From player_eligibility_snapshots. 0 at onboarding (no CS2 match data yet). */
  sampleSize:        number;
  /** From player_eligibility_snapshots.data_completeness (0..1). */
  dataCompleteness:  number;
  /**
   * From player_eligibility_snapshots.rank_signal.
   * Can be a Valve competitive rank string (e.g. "global_elite"), a FACEIT level
   * string (e.g. "faceit_10"), or null if unavailable.
   */
  rankSignal:        string | null;
}

export interface Cs2ConfidenceResult {
  /** Overall confidence score (0..1). */
  confidenceScore:   number;
  sampleConfidence:  number;
  /** Rank signal quality (replaces roleConfidence from Dota2; CS2 has no positional roles). */
  signalConfidence:  number;
  dataCompleteness:  number;
  stabilityScore:    number;
  proxyFlags: {
    /** Always true in V1 — signalConfidence is derived from rankSignal, not per-match data. */
    signalConfidenceProxy: boolean;
    /** True when rankSignal is null (no rank data available). */
    rankStabilityProxy:    boolean;
  };
}

// ── Rank signal → stability mapping ──────────────────────────────────────────
// Valve Competitive ranks (highest → lowest):

const CS2_STABILITY_MAP: Record<string, number> = {
  // ── Valve Competitive ────────────────────────────────────────────────────
  global_elite:                  1.00,
  supreme_master_first_class:    0.95,
  legendary_eagle_master:        0.88,
  legendary_eagle:               0.80,
  distinguished_master_guardian: 0.72,
  master_guardian_elite:         0.65,
  double_agent:                  0.58,    // "Double Agent" = MG2 colloquial name
  master_guardian_2:             0.58,
  master_guardian_1:             0.50,
  gold_nova_4:                   0.44,
  gold_nova_3:                   0.38,
  gold_nova_2:                   0.33,
  gold_nova_1:                   0.28,
  silver_elite_master:           0.24,
  silver_elite:                  0.21,
  silver_4:                      0.18,
  silver_3:                      0.15,
  silver_2:                      0.12,
  silver_1:                      0.10,
  // ── FACEIT levels ────────────────────────────────────────────────────────
  faceit_10:                     1.00,
  faceit_9:                      0.92,
  faceit_8:                      0.84,
  faceit_7:                      0.76,
  faceit_6:                      0.68,
  faceit_5:                      0.60,
  faceit_4:                      0.52,
  faceit_3:                      0.44,
  faceit_2:                      0.36,
  faceit_1:                      0.28,
};

/** Normalised rank signal → stability score (0..1). */
function stabilityFromRankSignal(signal: string | null): { score: number; isProxy: boolean } {
  if (!signal) return { score: 0.50, isProxy: true };

  const normalised = signal.toLowerCase().trim().replace(/\s+/g, "_");

  // Direct table lookup
  if (CS2_STABILITY_MAP[normalised] !== undefined) {
    return { score: CS2_STABILITY_MAP[normalised], isProxy: false };
  }

  // "faceit_N" pattern not in table (e.g. "faceit_11" — future-proof)
  const faceitMatch = normalised.match(/^faceit_(\d+)$/);
  if (faceitMatch) {
    const level = Math.min(10, Math.max(1, parseInt(faceitMatch[1], 10)));
    return { score: 0.10 + (level / 10) * 0.90, isProxy: false };
  }

  // Unknown string — some data present but tier unrecognised
  return { score: 0.45, isProxy: true };
}

/** Signal confidence based on rankSignal quality (replaces roleConfidence in Dota2). */
function signalConfidenceFromRankSignal(signal: string | null): number {
  if (!signal) return 0.40;                                         // no rank data
  const normalised = signal.toLowerCase().trim().replace(/\s+/g, "_");
  if (CS2_STABILITY_MAP[normalised] !== undefined) return 0.65;    // known tier
  if (/^faceit_\d+$/.test(normalised)) return 0.65;                // FACEIT level
  return 0.50;                                                      // unrecognised string
}

// ── Weights ───────────────────────────────────────────────────────────────────

const W_SAMPLE_CONFIDENCE  = 0.35;
const W_SIGNAL_CONFIDENCE  = 0.25;   // replaces W_ROLE_CONFIDENCE in Dota2
const W_DATA_COMPLETENESS  = 0.20;
const W_STABILITY_SCORE    = 0.20;

/** More games needed for CS2 than Dota2 to establish stable stats. */
const SAMPLE_FULL_THRESHOLD = 50;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

// ── Public function ───────────────────────────────────────────────────────────

/**
 * Compute the CS2 confidence score from a player's eligibility snapshot.
 *
 * Fully defensive: never throws, returns sensible defaults for any null/zero input.
 * Safe to call at onboarding time when no match data exists yet.
 */
export function calculateCs2ConfidenceScore(input: Cs2ConfidenceInput): Cs2ConfidenceResult {
  const sampleConfidence = clamp(input.sampleSize / SAMPLE_FULL_THRESHOLD, 0, 1);
  const signalConf       = signalConfidenceFromRankSignal(input.rankSignal);
  const dataCompleteness = clamp(input.dataCompleteness, 0, 1);
  const { score: stabilityScore, isProxy: rankStabilityProxy } = stabilityFromRankSignal(input.rankSignal);

  const confidenceScore = parseFloat(
    (
      W_SAMPLE_CONFIDENCE * sampleConfidence +
      W_SIGNAL_CONFIDENCE * signalConf       +
      W_DATA_COMPLETENESS * dataCompleteness +
      W_STABILITY_SCORE   * stabilityScore
    ).toFixed(4),
  );

  return {
    confidenceScore:  clamp(confidenceScore, 0, 1),
    sampleConfidence: parseFloat(sampleConfidence.toFixed(4)),
    signalConfidence: parseFloat(signalConf.toFixed(4)),
    dataCompleteness: parseFloat(dataCompleteness.toFixed(4)),
    stabilityScore:   parseFloat(stabilityScore.toFixed(4)),
    proxyFlags: {
      signalConfidenceProxy: true,       // always a proxy in V1 (no per-match role data)
      rankStabilityProxy,
    },
  };
}

// ── Rank normalization for valuation ─────────────────────────────────────────
// Used by cs2ValuationService to convert rankSignal → 0..1 for initial value.

const CS2_RANK_NORM_MAP: Record<string, number> = {
  global_elite:                  1.00,
  supreme_master_first_class:    0.93,
  legendary_eagle_master:        0.84,
  legendary_eagle:               0.75,
  distinguished_master_guardian: 0.67,
  master_guardian_elite:         0.59,
  double_agent:                  0.52,
  master_guardian_2:             0.52,
  master_guardian_1:             0.44,
  gold_nova_4:                   0.38,
  gold_nova_3:                   0.32,
  gold_nova_2:                   0.27,
  gold_nova_1:                   0.22,
  silver_elite_master:           0.18,
  silver_elite:                  0.15,
  silver_4:                      0.12,
  silver_3:                      0.09,
  silver_2:                      0.07,
  silver_1:                      0.05,
  faceit_10:                     1.00,
  faceit_9:                      0.90,
  faceit_8:                      0.80,
  faceit_7:                      0.70,
  faceit_6:                      0.60,
  faceit_5:                      0.50,
  faceit_4:                      0.40,
  faceit_3:                      0.30,
  faceit_2:                      0.20,
  faceit_1:                      0.10,
};

/**
 * Normalise a CS2 rank signal to a 0..1 score for use in the valuation formula.
 * Returns a neutral 0.30 when rankSignal is null (no rank data yet).
 */
export function normaliseCs2RankSignal(rankSignal: string | null): { normValue: number; isProxy: boolean } {
  if (!rankSignal) return { normValue: 0.30, isProxy: true };

  const normalised = rankSignal.toLowerCase().trim().replace(/\s+/g, "_");

  if (CS2_RANK_NORM_MAP[normalised] !== undefined) {
    return { normValue: CS2_RANK_NORM_MAP[normalised], isProxy: false };
  }

  // FACEIT level not in map
  const faceitMatch = normalised.match(/^faceit_(\d+)$/);
  if (faceitMatch) {
    const level = Math.min(10, Math.max(1, parseInt(faceitMatch[1], 10)));
    return { normValue: level / 10, isProxy: false };
  }

  return { normValue: 0.35, isProxy: true };   // unknown string → slightly below neutral
}

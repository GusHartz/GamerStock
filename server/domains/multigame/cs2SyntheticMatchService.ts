// ─── CS2 Synthetic Match Service ──────────────────────────────────────────────
// Generates synthetic match records from CS2 stats deltas and runs the EMA.
//
// Problem being solved:
//   Valve's Steam API only provides lifetime career totals — no per-match history.
//   To keep the valuation engine active between Steam API key activations and
//   to support platform-bootstrapped players, we derive "synthetic" match events
//   from the delta between consecutive stats snapshots.
//
// Synthetic match derivation formula:
//   kd            = deltaKills / max(deltaDeaths, 1)
//   winRate       = deltaWins / deltaMatches         (0..1)
//   headshotRate  = deltaHeadshots / max(deltaKills, 1)
//
//   performanceScore =
//     0.40 × kdNorm        (K/D mapped to 0..1)
//   + 0.30 × headshotRate  (naturally 0..1)
//   + 0.30 × winRate       (naturally 0..1)
//
//   kdNorm = clamp((kd − 0.3) / (2.0 − 0.3), 0, 1)   ← mirrors cs2MatchSyncService range
//
// When deltaMatches > 1 we generate up to MAX_SYNTH_PER_SYNC rows, each
// carrying the same proportional averages (mean performance for the period).
// EMA is applied once per sync using the average performanceScore across all
// generated synthetic matches — NOT once per row.
//
// Streak detection:
//   Looks at the last STREAK_WINDOW synthetic matches for this asset.
//   ≥ STREAK_MIN consecutive wins  → +0.005 × streakLen bonus (capped at +0.05)
//   ≥ STREAK_MIN consecutive losses → -0.005 × streakLen penalty (capped at -0.05)
// ─────────────────────────────────────────────────────────────────────────────

import { db }                     from "../../db";
import { desc, eq }               from "drizzle-orm";
import { cs2SyntheticMatch }      from "@shared/schema/multigame";
import type { Cs2StatsDelta }     from "./cs2DeltaEngine";
import type { Cs2SyntheticMatch } from "@shared/schema/multigame";

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_SYNTH_PER_SYNC = 10;   // cap rows per sync (prevents spam on large deltas)
const STREAK_WINDOW      = 10;   // last N synthetic matches to check for streak
const STREAK_MIN         = 3;    // minimum consecutive same-outcome to count as streak
const STREAK_BONUS_RATE  = 0.005;
const STREAK_MAX         = 0.05;

const KD_NORM_MIN = 0.3;
const KD_NORM_MAX = 2.0;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SyntheticMatchResult {
  matchesGenerated:    number;
  avgPerformanceScore: number;
  streakBonus:         number;
  streakPenalty:       number;
  rows:                Cs2SyntheticMatch[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function kdNorm(kd: number): number {
  return clamp((kd - KD_NORM_MIN) / (KD_NORM_MAX - KD_NORM_MIN), 0, 1);
}

function computePerfScore(kd: number, headshotRate: number, winRate: number): number {
  return clamp(
    0.40 * kdNorm(kd) +
    0.30 * headshotRate +
    0.30 * winRate,
    0, 1,
  );
}

// ── Streak detection ──────────────────────────────────────────────────────────

async function detectStreak(assetId: number): Promise<{ bonus: number; penalty: number }> {
  const recent = await db
    .select({ win: cs2SyntheticMatch.win })
    .from(cs2SyntheticMatch)
    .where(eq(cs2SyntheticMatch.assetId, assetId))
    .orderBy(desc(cs2SyntheticMatch.createdAt))
    .limit(STREAK_WINDOW);

  if (recent.length < STREAK_MIN) return { bonus: 0, penalty: 0 };

  let winStreak = 0;
  let lossStreak = 0;

  for (const r of recent) {
    if (r.win) { if (lossStreak > 0) break; winStreak++; }
    else        { if (winStreak  > 0) break; lossStreak++; }
  }

  const bonus   = winStreak  >= STREAK_MIN ? clamp(winStreak  * STREAK_BONUS_RATE, 0, STREAK_MAX) : 0;
  const penalty = lossStreak >= STREAK_MIN ? clamp(lossStreak * STREAK_BONUS_RATE, 0, STREAK_MAX) : 0;

  if (bonus > 0)   console.log(`[CS2Synth] Win streak=${winStreak} → bonus=+${bonus.toFixed(4)}`);
  if (penalty > 0) console.log(`[CS2Synth] Loss streak=${lossStreak} → penalty=-${penalty.toFixed(4)}`);

  return { bonus, penalty };
}

// ── Main ──────────────────────────────────────────────────────────────────────

/**
 * Generate and persist synthetic match records from a stats delta.
 * Returns the generated rows + the average performance score for EMA input.
 *
 * @param assetId   The CS2 asset ID
 * @param delta     Computed by cs2DeltaEngine.computeCs2StatsDelta
 */
export async function generateSyntheticMatches(
  assetId: number,
  delta:   Cs2StatsDelta,
): Promise<SyntheticMatchResult> {
  if (!delta.isValid || delta.deltaMatches <= 0) {
    return { matchesGenerated: 0, avgPerformanceScore: 0, streakBonus: 0, streakPenalty: 0, rows: [] };
  }

  // ── Derive period averages ───────────────────────────────────────────────
  const kd            = delta.deltaKills / Math.max(delta.deltaDeaths, 1);
  const winRate       = delta.deltaWins  / delta.deltaMatches;
  const headshotRate  = delta.deltaHeadshots / Math.max(delta.deltaKills, 1);
  const perfScore     = computePerfScore(kd, headshotRate, winRate);

  // Number of synthetic rows: min(deltaMatches, MAX_SYNTH_PER_SYNC)
  const count = Math.min(delta.deltaMatches, MAX_SYNTH_PER_SYNC);

  // ── Distribute wins across rows ───────────────────────────────────────────
  // e.g. deltaWins=3, count=5 → first 3 rows are wins, next 2 are losses
  const winsToDistribute = Math.round(winRate * count);

  // ── Detect streak from existing history (before inserting new rows) ────────
  const { bonus: streakBonus, penalty: streakPenalty } = await detectStreak(assetId);

  // ── Insert synthetic match rows ───────────────────────────────────────────
  const rows: Cs2SyntheticMatch[] = [];

  for (let i = 0; i < count; i++) {
    const win = i < winsToDistribute;
    const [row] = await db.insert(cs2SyntheticMatch).values({
      assetId,
      deltaMatches:    delta.deltaMatches,
      performanceScore: perfScore.toFixed(6),
      kd:              kd.toFixed(4),
      win,
      headshotRate:    headshotRate.toFixed(6),
      rawValueBefore:  null,
      rawValueAfter:   null,
      playerValueAfter: null,
      alphaUsed:       null,
    }).returning();
    rows.push(row);
  }

  console.log(
    `[CS2Synth] Generated ${count} synthetic matches for assetId=${assetId} — ` +
    `deltaMatches=${delta.deltaMatches} kd=${kd.toFixed(2)} ` +
    `wr=${(winRate * 100).toFixed(0)}% hs%=${(headshotRate * 100).toFixed(0)}% ` +
    `perfScore=${perfScore.toFixed(4)}`,
  );

  return {
    matchesGenerated:    count,
    avgPerformanceScore: perfScore,
    streakBonus,
    streakPenalty,
    rows,
  };
}

/**
 * Update the rawValueBefore, rawValueAfter, playerValueAfter, alphaUsed
 * on the synthetic match rows after EMA is applied.
 */
export async function annotateCs2SyntheticMatchRows(
  rowIds:          number[],
  rawValueBefore:  number,
  rawValueAfter:   number,
  playerValueAfter: number,
  alphaUsed:       number,
): Promise<void> {
  if (rowIds.length === 0) return;
  for (const id of rowIds) {
    await db
      .update(cs2SyntheticMatch)
      .set({
        rawValueBefore:   rawValueBefore.toFixed(4),
        rawValueAfter:    rawValueAfter.toFixed(4),
        playerValueAfter: playerValueAfter.toFixed(4),
        alphaUsed:        alphaUsed.toFixed(4),
      })
      .where(eq(cs2SyntheticMatch.id, id));
  }
}

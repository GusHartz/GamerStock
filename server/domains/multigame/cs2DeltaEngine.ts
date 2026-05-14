// ─── CS2 Delta Engine ─────────────────────────────────────────────────────────
// Computes the delta between two consecutive CS2 stats snapshots.
//
// Career stats from Steam are lifetime aggregates — they only grow.
// The delta represents what happened between two sync calls:
//   "the player played N new matches since the last snapshot."
//
// Rules:
//   - If deltaMatches <= 0  → no new matches detected → no-op signal
//   - If any delta is negative (corrupted data) → treat as no-op
//   - All fields are non-negative integers in the result
// ─────────────────────────────────────────────────────────────────────────────

import type { Cs2StatsSnapshot } from "@shared/schema/multigame";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Cs2StatsDelta {
  deltaMatches:   number;
  deltaKills:     number;
  deltaDeaths:    number;
  deltaWins:      number;
  deltaHeadshots: number;
  deltaRounds:    number;
  /** true when deltaMatches > 0 and all deltas are internally consistent. */
  isValid:        boolean;
  /** Human-readable reason when isValid = false. */
  reason?:        string;
}

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * Compute the delta between a previous and current snapshot.
 *
 * @param prev  The earlier snapshot (or null for first-ever sync)
 * @param curr  The most recently saved snapshot
 */
export function computeCs2StatsDelta(
  prev: Cs2StatsSnapshot | null,
  curr: Cs2StatsSnapshot,
): Cs2StatsDelta {

  // First sync ever — no previous snapshot to diff against
  if (!prev) {
    return {
      deltaMatches:   0,
      deltaKills:     0,
      deltaDeaths:    0,
      deltaWins:      0,
      deltaHeadshots: 0,
      deltaRounds:    0,
      isValid:        false,
      reason:         "FIRST_SYNC — no previous snapshot to diff against",
    };
  }

  const deltaMatches   = curr.matches   - prev.matches;
  const deltaKills     = curr.kills     - prev.kills;
  const deltaDeaths    = curr.deaths    - prev.deaths;
  const deltaWins      = curr.wins      - prev.wins;
  const deltaHeadshots = curr.headshots - prev.headshots;
  const deltaRounds    = curr.rounds    - prev.rounds;

  // No new matches
  if (deltaMatches <= 0) {
    return {
      deltaMatches:   0,
      deltaKills:     0,
      deltaDeaths:    0,
      deltaWins:      0,
      deltaHeadshots: 0,
      deltaRounds:    0,
      isValid:        false,
      reason:         `NO_NEW_MATCHES — deltaMatches=${deltaMatches}`,
    };
  }

  // Sanity: kills/deaths/rounds can't decrease on a legitimate account
  if (deltaKills < 0 || deltaDeaths < 0 || deltaRounds < 0 || deltaWins < 0) {
    return {
      deltaMatches:   0,
      deltaKills:     0,
      deltaDeaths:    0,
      deltaWins:      0,
      deltaHeadshots: 0,
      deltaRounds:    0,
      isValid:        false,
      reason:         `CORRUPT_DELTA — kills=${deltaKills} deaths=${deltaDeaths} wins=${deltaWins} rounds=${deltaRounds}`,
    };
  }

  return {
    deltaMatches,
    deltaKills,
    deltaDeaths,
    deltaWins,
    deltaHeadshots: Math.max(deltaHeadshots, 0),  // HS can be 0 without issue
    deltaRounds,
    isValid:        true,
  };
}

// ─── Dota2 Metric Configuration ──────────────────────────────────────────────
// Canonical weight tables and inversion flags per role.
// This is the ONLY place where weights/inversion are defined — both the
// baseline seeder and the score calculator read from here.
//
// Design decisions:
//   - Derived metrics (kill_participation, death_control, etc.) are computed
//     at score-calculation time from raw ParsedMatchMetrics fields.
//   - camps_stacked and save_or_utility are marked POSSIBLY_MISSING — if their
//     raw value is null the weight redistributes automatically.
// ─────────────────────────────────────────────────────────────────────────────

import type { DetectedRole, Dota2MetricName } from "@shared/schema";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MetricWeightEntry {
  metric:     Dota2MetricName;
  weight:     number;         // 0..1, sum per role = 1.0
  isInverted: boolean;        // true → lower value = better (deaths, etc.)
}

export type RoleWeightMap = Map<Dota2MetricName, MetricWeightEntry>;

// ── Role weight definitions ───────────────────────────────────────────────────
// Source of truth — populated into performance_metric_weights on first rebuild.

const P1_WEIGHTS: MetricWeightEntry[] = [
  { metric: "gpm",                   weight: 0.20, isInverted: false },
  { metric: "xpm",                   weight: 0.10, isInverted: false },
  { metric: "last_hits",             weight: 0.15, isInverted: false },
  { metric: "net_worth",             weight: 0.15, isInverted: false },
  { metric: "hero_damage",           weight: 0.15, isInverted: false },
  { metric: "tower_damage",          weight: 0.10, isInverted: false },
  { metric: "death_control",         weight: 0.10, isInverted: false }, // derived: 1/(deaths+1)
  { metric: "teamfight_participation", weight: 0.05, isInverted: false },
];

const P2_WEIGHTS: MetricWeightEntry[] = [
  { metric: "gpm",                   weight: 0.18, isInverted: false },
  { metric: "xpm",                   weight: 0.12, isInverted: false },
  { metric: "hero_damage",           weight: 0.18, isInverted: false },
  { metric: "kills",                 weight: 0.10, isInverted: false },
  { metric: "assists",               weight: 0.10, isInverted: false },
  { metric: "death_control",         weight: 0.10, isInverted: false },
  { metric: "tower_damage",          weight: 0.10, isInverted: false },
  { metric: "teamfight_participation", weight: 0.12, isInverted: false },
];

const P3_WEIGHTS: MetricWeightEntry[] = [
  { metric: "gpm",                   weight: 0.12, isInverted: false },
  { metric: "xpm",                   weight: 0.08, isInverted: false },
  { metric: "hero_damage",           weight: 0.12, isInverted: false },
  { metric: "teamfight_participation", weight: 0.15, isInverted: false },
  { metric: "kill_participation",    weight: 0.15, isInverted: false }, // derived: (k+a)/(teamKills+ε)
  { metric: "tower_damage",          weight: 0.10, isInverted: false },
  { metric: "death_control",         weight: 0.10, isInverted: false },
  { metric: "assists",               weight: 0.10, isInverted: false },
  { metric: "stun_duration",         weight: 0.08, isInverted: false },
];

const P4_WEIGHTS: MetricWeightEntry[] = [
  { metric: "assists",               weight: 0.15, isInverted: false },
  { metric: "kill_participation",    weight: 0.15, isInverted: false },
  { metric: "teamfight_participation", weight: 0.12, isInverted: false },
  { metric: "observer_wards",        weight: 0.12, isInverted: false },
  { metric: "deward_count",          weight: 0.10, isInverted: false }, // derived: obs_kills + sen_kills
  { metric: "stun_duration",         weight: 0.10, isInverted: false },
  { metric: "camps_stacked",         weight: 0.08, isInverted: false }, // may be missing → redistribute
  { metric: "gpm",                   weight: 0.08, isInverted: false },
  { metric: "save_or_utility",       weight: 0.10, isInverted: false }, // proxy: hero_healing
];

const P5_WEIGHTS: MetricWeightEntry[] = [
  { metric: "observer_wards",        weight: 0.18, isInverted: false },
  { metric: "sentry_wards",          weight: 0.12, isInverted: false },
  { metric: "assists",               weight: 0.15, isInverted: false },
  { metric: "kill_participation",    weight: 0.15, isInverted: false },
  { metric: "teamfight_participation", weight: 0.12, isInverted: false },
  { metric: "deward_count",          weight: 0.10, isInverted: false },
  { metric: "death_efficiency",      weight: 0.08, isInverted: false }, // derived: assists/max(deaths,1)
  { metric: "gpm",                   weight: 0.05, isInverted: false },
  { metric: "save_or_utility",       weight: 0.05, isInverted: false },
];

// ── Registry ──────────────────────────────────────────────────────────────────

const ROLE_WEIGHTS: Record<string, MetricWeightEntry[]> = {
  P1: P1_WEIGHTS,
  P2: P2_WEIGHTS,
  P3: P3_WEIGHTS,
  P4: P4_WEIGHTS,
  P5: P5_WEIGHTS,
};

export function getWeightsForRole(role: DetectedRole): MetricWeightEntry[] {
  return ROLE_WEIGHTS[role] ?? [];
}

export function getWeightMapForRole(role: DetectedRole): RoleWeightMap {
  const map: RoleWeightMap = new Map();
  for (const entry of getWeightsForRole(role)) {
    map.set(entry.metric, entry);
  }
  return map;
}

/** All roles that have weight configurations (excludes UNKNOWN). */
export const SCORED_ROLES: DetectedRole[] = ["P1", "P2", "P3", "P4", "P5"];

/** Current weight config version. Increment when weights change. */
export const WEIGHT_CONFIG_VERSION = 1;

/** Metrics that may genuinely be missing from the API (no proxy fallback). */
export const POSSIBLY_MISSING_METRICS: Set<Dota2MetricName> = new Set<Dota2MetricName>([
  "camps_stacked",   // Not always present in OpenDota detail
]);

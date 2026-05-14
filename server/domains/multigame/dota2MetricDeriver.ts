// ─── Dota2 Metric Deriver ─────────────────────────────────────────────────────
// Derives composite/virtual metrics from raw ParsedMatchMetrics.
// These values feed the Fase 5 score calculator as if they were direct metrics.
//
// All derivations return null when the required raw inputs are missing.
// ─────────────────────────────────────────────────────────────────────────────

import type { ParsedMatchMetrics } from "./dota2MatchParser";
import type { Dota2MetricName } from "@shared/schema";

export type DerivedMetricMap = Partial<Record<Dota2MetricName, number | null>>;

// ── Individual derivations ────────────────────────────────────────────────────

/**
 * death_control = 1 / (deaths + 1)
 * Range: 1.0 (0 deaths) → 0.5 (1 death) → 0.17 (5 deaths)
 * Higher is better — no inversion needed.
 */
function deriveDeathControl(m: ParsedMatchMetrics): number | null {
  if (m.deaths == null) return null;
  return 1 / (m.deaths + 1);
}

/**
 * death_efficiency = assists / max(deaths, 1)
 * Used as P5 proxy for "support value per death taken".
 */
function deriveDeathEfficiency(m: ParsedMatchMetrics): number | null {
  if (m.assists == null || m.deaths == null) return null;
  return m.assists / Math.max(m.deaths, 1);
}

/**
 * kill_participation = (kills + assists) / max(teamKills, 1)
 * We don't have teamKills from the parser, so we use (kills + assists) as a
 * normalized proxy. This loses absolute context but is consistent across all
 * players in the cohort, so z-score normalization removes the bias.
 *
 * Approximate: (kills + assists) / 30 caps at 1.0 for extreme games.
 * Not perfect but deterministic — all baselines see the same formula.
 */
function deriveKillParticipation(m: ParsedMatchMetrics): number | null {
  if (m.kills == null || m.assists == null) return null;
  // Use (k+a)/30 as approximation. 30 ≈ typical team kill count.
  return Math.min(1.0, (m.kills + m.assists) / 30);
}

/**
 * deward_count = observer_kills + sentry_kills
 * Total enemy wards destroyed.
 */
function deriveDewardCount(m: ParsedMatchMetrics): number | null {
  // Need at least one of them
  if (m.obsPlaced == null && m.senPlaced == null) return null;
  // obsPlaced and senPlaced are the fields we have from the parser.
  // OpenDota also has observer_kills/sentry_kills but they map to separate
  // parser fields. We'll use obsPlaced/senPlaced as a proxy for now since
  // observer_kills/sentry_kills may not always be populated.
  // When the enriched parser exposes them directly this can be improved.
  return (m.obsPlaced ?? 0) + (m.senPlaced ?? 0);
}

/**
 * save_or_utility = hero_healing proxy.
 * True save actions (linkens proc, etc.) aren't tracked by OpenDota in a
 * single field. We use hero_healing as the best available proxy.
 */
function deriveSaveOrUtility(m: ParsedMatchMetrics): number | null {
  if (m.heroHealing == null) return null;
  return m.heroHealing;
}

/**
 * observer_wards = obs_placed (direct rename for config alignment)
 */
function deriveObserverWards(m: ParsedMatchMetrics): number | null {
  return m.obsPlaced ?? null;
}

/**
 * sentry_wards = sen_placed (direct rename for config alignment)
 */
function deriveSentryWards(m: ParsedMatchMetrics): number | null {
  return m.senPlaced ?? null;
}

/**
 * stun_duration = stunDuration field (pass-through with config name alignment)
 */
function deriveStunDuration(m: ParsedMatchMetrics): number | null {
  return m.stunDuration ?? null;
}

/**
 * camps_stacked — not available in OpenDota detail payload in a consistent way.
 * Returns null always → will trigger weight redistribution.
 */
function deriveCampsStacked(_m: ParsedMatchMetrics): number | null {
  return null;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Derive all Fase 5 metric values from raw parsed match metrics.
 * Returns a map with null where a metric is unavailable.
 * Baseline raw metrics (gpm, xpm, etc.) are also re-emitted for convenience.
 */
export function deriveAllMetrics(m: ParsedMatchMetrics): DerivedMetricMap {
  return {
    gpm:                    m.gpm ?? null,
    xpm:                    m.xpm ?? null,
    last_hits:              m.lastHits ?? null,
    net_worth:              m.netWorth ?? null,
    hero_damage:            m.heroDamage ?? null,
    tower_damage:           m.towerDamage ?? null,
    kills:                  m.kills ?? null,
    assists:                m.assists ?? null,
    teamfight_participation: m.teamfightParticipation ?? null,

    // Derived
    death_control:          deriveDeathControl(m),
    death_efficiency:       deriveDeathEfficiency(m),
    kill_participation:     deriveKillParticipation(m),
    deward_count:           deriveDewardCount(m),
    observer_wards:         deriveObserverWards(m),
    sentry_wards:           deriveSentryWards(m),
    stun_duration:          deriveStunDuration(m),
    save_or_utility:        deriveSaveOrUtility(m),
    camps_stacked:          deriveCampsStacked(m),
  };
}

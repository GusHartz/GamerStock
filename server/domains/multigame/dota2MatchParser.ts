// ─── Dota2 Match Parser ───────────────────────────────────────────────────────
// Pure function layer: extracts structured analytics from an OpenDota full
// match detail payload for a specific player (identified by accountId32).
//
// Design:
//   - No DB calls — purely transforms raw JSON
//   - Returns null for fields that are genuinely absent (not defaulted to 0)
//   - Distinguishes "missing" from "zero" for completeness scoring
//   - All outputs feed into the role detector and eligibility classifier
// ─────────────────────────────────────────────────────────────────────────────
import type { OpenDotaMatchDetail, OpenDotaMatchPlayer } from "./providers/openDotaClient";
import type { DurationBucket } from "@shared/schema";

// ── Output types ──────────────────────────────────────────────────────────────

export interface ParsedMatchMetrics {
  /** Hero played in this match */
  heroId:                number | null;
  /** Match duration in seconds */
  duration:              number | null;
  /** Kills */
  kills:                 number | null;
  /** Deaths */
  deaths:                number | null;
  /** Assists */
  assists:               number | null;
  /** Gold per minute */
  gpm:                   number | null;
  /** XP per minute */
  xpm:                   number | null;
  /** Net worth at match end */
  netWorth:              number | null;
  /** Raw hero damage dealt */
  heroDamage:            number | null;
  /** Raw tower damage dealt */
  towerDamage:           number | null;
  /** Last hits */
  lastHits:              number | null;
  /** Creep denies */
  denies:                number | null;
  /** Hero healing done */
  heroHealing:           number | null;
  /** Observer wards placed */
  obsPlaced:             number | null;
  /** Sentry wards placed */
  senPlaced:             number | null;
  /** Total stun duration applied (seconds) */
  stunDuration:          number | null;
  /** Teamfight participation score 0–1 */
  teamfightParticipation: number | null;
  /** Whether the player was roaming */
  isRoaming:             boolean | null;
  /** OpenDota lane_role value (1–5) */
  providerLaneRole:      number | null;
  /** Whether the match was ranked (lobby_type === 7) */
  isRanked:              boolean;
  /** Radiant team won */
  radiantWin:            boolean;
  /** Player was on Radiant side */
  isRadiant:             boolean;
  /** Player won the match */
  won:                   boolean;
  /** Lobby type integer */
  lobbyType:             number;
  /** Game mode integer */
  gameMode:              number;
}

export interface ParseResult {
  metrics:            ParsedMatchMetrics;
  durationBucket:     DurationBucket;
  /** Metrics that were expected but missing in the payload */
  missingMetrics:     string[];
  /** Completeness fraction 0.0–1.0 */
  dataCompleteness:   number;
  /** Context metadata for storage */
  contextFields: {
    matchId:          number;
    startTime:        number;
    lobbyType:        number;
    gameMode:         number;
    duration:         number;
    radiantWin:       boolean;
    playerSlot:       number;
  };
}

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Core metrics that must be present for a match to be analytically eligible.
 * Missing any of these → MISSING_REQUIRED_METRICS.
 */
const REQUIRED_METRIC_KEYS: (keyof ParsedMatchMetrics)[] = [
  "heroId", "kills", "deaths", "assists", "gpm", "xpm",
];

/**
 * Optional metrics — used for completeness scoring but not hard requirements.
 */
const OPTIONAL_METRIC_KEYS: (keyof ParsedMatchMetrics)[] = [
  "netWorth", "heroDamage", "towerDamage", "lastHits", "denies",
  "heroHealing", "obsPlaced", "senPlaced", "stunDuration",
  "teamfightParticipation",
];

// ── Duration bucketing ────────────────────────────────────────────────────────

export function getDurationBucket(durationSeconds: number): DurationBucket {
  if (durationSeconds < 1500) return "SHORT";   // < 25 minutes
  if (durationSeconds < 2700) return "MEDIUM";  // 25–45 minutes
  return "LONG";                                 // > 45 minutes
}

// ── Slot → side helper ────────────────────────────────────────────────────────

function isRadiantSlot(playerSlot: number): boolean {
  return playerSlot < 128;
}

// ── Core parser ───────────────────────────────────────────────────────────────

/**
 * Parse a full OpenDota match detail for the given player (accountId32).
 * Returns null if the player is not found in the match players array.
 */
export function parseMatchDetail(
  detail:       OpenDotaMatchDetail,
  accountId32:  string,
): ParseResult | null {
  const accountIdNum = parseInt(accountId32, 10);

  // Find the player row in the match
  const playerRow: OpenDotaMatchPlayer | undefined =
    detail.players.find(p => p.account_id === accountIdNum);

  if (!playerRow) return null;

  const isRadiant = isRadiantSlot(playerRow.player_slot);
  const won       = detail.radiant_win === isRadiant;
  const isRanked  = detail.lobby_type === 7;

  const metrics: ParsedMatchMetrics = {
    heroId:                 playerRow.hero_id         ?? null,
    duration:               detail.duration           ?? null,
    kills:                  playerRow.kills           ?? null,
    deaths:                 playerRow.deaths          ?? null,
    assists:                playerRow.assists         ?? null,
    gpm:                    playerRow.gold_per_min    ?? null,
    xpm:                    playerRow.xp_per_min      ?? null,
    netWorth:               playerRow.net_worth       ?? null,
    heroDamage:             playerRow.hero_damage     ?? null,
    towerDamage:            playerRow.tower_damage    ?? null,
    lastHits:               playerRow.last_hits       ?? null,
    denies:                 playerRow.denies          ?? null,
    heroHealing:            playerRow.hero_healing    ?? null,
    obsPlaced:              playerRow.obs_placed      ?? null,
    senPlaced:              playerRow.sen_placed      ?? null,
    stunDuration:           playerRow.stuns           ?? null,
    teamfightParticipation: playerRow.teamfight_participation ?? null,
    isRoaming:              playerRow.is_roaming      ?? null,
    providerLaneRole:       playerRow.lane_role       ?? null,
    isRanked,
    radiantWin:             detail.radiant_win,
    isRadiant,
    won,
    lobbyType:              detail.lobby_type,
    gameMode:               detail.game_mode,
  };

  // ── Completeness scoring ─────────────────────────────────────────────────────
  const allKeys = [...REQUIRED_METRIC_KEYS, ...OPTIONAL_METRIC_KEYS];
  const missingMetrics: string[] = allKeys.filter(k => metrics[k] == null);
  const dataCompleteness = 1 - missingMetrics.length / allKeys.length;

  const durationBucket: DurationBucket = getDurationBucket(detail.duration ?? 0);

  return {
    metrics,
    durationBucket,
    missingMetrics,
    dataCompleteness,
    contextFields: {
      matchId:    detail.match_id,
      startTime:  detail.start_time,
      lobbyType:  detail.lobby_type,
      gameMode:   detail.game_mode,
      duration:   detail.duration,
      radiantWin: detail.radiant_win,
      playerSlot: playerRow.player_slot,
    },
  };
}

/**
 * Check whether a parsed result has all required metrics.
 */
export function hasRequiredMetrics(parsed: ParseResult): boolean {
  return REQUIRED_METRIC_KEYS.every(k => parsed.metrics[k] != null);
}

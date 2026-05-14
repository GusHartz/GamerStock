// ─── OpenDota API Client ──────────────────────────────────────────────────────
// Wraps the OpenDota public REST API (https://api.opendota.com/api).
// No API key required. Rate limit: ~60 req/min on free tier.
//
// OpenDota uses a 32-bit account ID derived from the 64-bit SteamID:
//   accountId32 = SteamID64 - 76561197960265728
// ─────────────────────────────────────────────────────────────────────────────

const OPENDOTA_BASE = "https://api.opendota.com/api";
const STEAM_ID_OFFSET = BigInt("76561197960265728");

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OpenDotaMatchSummary {
  match_id:       number;
  player_slot:    number;
  radiant_win:    boolean;
  hero_id:        number;
  start_time:     number;   // Unix timestamp (seconds)
  duration:       number;   // Seconds
  game_mode:      number;
  lobby_type:     number;
  kills:          number;
  deaths:         number;
  assists:        number;
  gold_per_min:   number;
  xp_per_min:     number;
  last_hits:      number;
  party_size:     number | null;
  average_rank?:  number | null;
}

export interface OpenDotaPlayerInfo {
  rank_tier:          number | null;
  leaderboard_rank:   number | null;
  profile: {
    account_id:   number;
    personaname:  string | null;
    name:         string | null;
    avatar:       string | null;
    avatarfull:   string | null;
  };
}

export interface OpenDotaMatchDetail {
  match_id:           number;
  radiant_win:        boolean;
  duration:           number;
  pre_game_duration:  number;
  start_time:         number;
  match_seq_num:      number;
  game_mode:          number;
  lobby_type:         number;
  players:            OpenDotaMatchPlayer[];
}

export interface OpenDotaMatchPlayer {
  account_id:               number;
  player_slot:              number;
  hero_id:                  number;
  kills:                    number;
  deaths:                   number;
  assists:                  number;
  gold_per_min:             number;
  xp_per_min:               number;
  last_hits:                number;
  denies:                   number;
  hero_damage:              number;
  tower_damage:             number;
  hero_healing:             number;
  net_worth:                number;

  // Fase 4 additions — present in full match detail, absent in summary list
  lane_role:                number | null;  // 1=safelane 2=mid 3=offlane 4=soft-support 5=hard-support
  is_roaming:               boolean | null;
  obs_placed:               number | null;  // observer wards placed
  sen_placed:               number | null;  // sentry wards placed
  stuns:                    number | null;  // total stun duration seconds
  teamfight_participation:  number | null;  // 0.0–1.0
  observer_kills:           number | null;
  sentry_kills:             number | null;
  actions_per_min:          number | null;
  life_state_dead:          number | null;  // ticks dead (proxy for deaths impact)

  // Nullable — may be absent for bot slots or anonymous players
  personaname:              string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Convert a 64-bit Steam ID (string) to an OpenDota 32-bit account ID (string).
 * Throws if the input is not a valid numeric SteamID64.
 */
export function steamId64ToAccountId32(steamId64: string): string {
  try {
    const id64 = BigInt(steamId64);
    const id32 = id64 - STEAM_ID_OFFSET;
    if (id32 < BigInt(0)) throw new Error("negative");
    return id32.toString();
  } catch {
    throw new Error(`Invalid SteamID64: "${steamId64}"`);
  }
}

/**
 * Map a Dota 2 lobby_type integer to a human-readable queue label.
 * lobby_type 7 is the standard ranked matchmaking queue.
 */
export function lobbyTypeToQueueLabel(lobbyType: number): string {
  const map: Record<number, string> = {
    0:  "normal",
    1:  "practice",
    2:  "tournament",
    3:  "tutorial",
    4:  "coop_bots",
    5:  "ranked_team",
    6:  "ranked_solo",
    7:  "ranked",
    8:  "1v1_mid",
    9:  "battle_cup",
  };
  return map[lobbyType] ?? `lobby_${lobbyType}`;
}

/**
 * Map a Dota 2 rank_tier integer to a human-readable bucket string.
 *   1x = Herald, 2x = Guardian, 3x = Crusader, 4x = Archon,
 *   5x = Legend, 6x = Ancient, 7x = Divine, 80 = Immortal
 */
export function rankTierToBucket(rankTier: number | null | undefined): string | null {
  if (rankTier == null || rankTier === 0) return null;
  if (rankTier >= 80) return "Immortal";
  const tier = Math.floor(rankTier / 10);
  const tierNames: Record<number, string> = {
    1: "Herald", 2: "Guardian", 3: "Crusader",
    4: "Archon", 5: "Legend", 6: "Ancient", 7: "Divine",
  };
  const star = rankTier % 10;
  const base = tierNames[tier];
  if (!base) return null;
  return star > 0 ? `${base} ${star}` : base;
}

// ── HTTP ──────────────────────────────────────────────────────────────────────

async function openDotaFetch<T>(path: string): Promise<T> {
  const url = `${OPENDOTA_BASE}${path}`;
  console.log(`[OpenDota] GET ${url}`);

  const res = await fetch(url, {
    headers: { "Accept": "application/json" },
    signal: AbortSignal.timeout(15_000),
  });

  if (res.status === 429) {
    throw new Error("OPENDOTA_RATE_LIMITED");
  }
  if (!res.ok) {
    throw new Error(`OPENDOTA_HTTP_${res.status}: ${path}`);
  }

  return res.json() as Promise<T>;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch recent match summaries for a player.
 * Returns the provider's match list (up to `limit`, max ~500 via /matches endpoint).
 * Uses /players/{id}/recentMatches for ≤20 and /players/{id}/matches for more.
 */
export async function fetchPlayerMatches(
  accountId32: string,
  limit: number = 50,
): Promise<OpenDotaMatchSummary[]> {
  if (limit <= 20) {
    return openDotaFetch<OpenDotaMatchSummary[]>(
      `/players/${accountId32}/recentMatches`,
    );
  }

  const params = new URLSearchParams({
    limit:       String(Math.min(limit, 500)),
    significant: "0",
    project:     [
      "match_id","player_slot","radiant_win","hero_id","start_time",
      "duration","game_mode","lobby_type","kills","deaths","assists",
      "gold_per_min","xp_per_min","last_hits","party_size","average_rank",
    ].join(","),
  });

  return openDotaFetch<OpenDotaMatchSummary[]>(
    `/players/${accountId32}/matches?${params.toString()}`,
  );
}

/**
 * Fetch the full detail payload for a single match.
 * Typically called for PROCESSING_PENDING → DETAIL_FETCHED promotion.
 */
export async function fetchMatchDetail(
  matchId: string | number,
): Promise<OpenDotaMatchDetail> {
  return openDotaFetch<OpenDotaMatchDetail>(`/matches/${matchId}`);
}

/**
 * Fetch player profile info, including current rank_tier.
 */
export async function fetchPlayerInfo(
  accountId32: string,
): Promise<OpenDotaPlayerInfo> {
  return openDotaFetch<OpenDotaPlayerInfo>(`/players/${accountId32}`);
}

/**
 * Check whether the player profile is visible on OpenDota.
 * Returns false if the account is private / not found (HTTP 404 or null profile).
 */
export async function isPlayerProfilePublic(accountId32: string): Promise<boolean> {
  try {
    const info = await fetchPlayerInfo(accountId32);
    return info?.profile?.account_id != null;
  } catch {
    return false;
  }
}

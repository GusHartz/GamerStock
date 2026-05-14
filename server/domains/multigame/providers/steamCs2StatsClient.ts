// ─── Steam CS2 Stats Client ────────────────────────────────────────────────────
// Fetches aggregate career stats for a CS2 player via the Steam Web API.
//
// Endpoint:
//   GET https://api.steampowered.com/ISteamUserStats/GetUserStatsForGame/v0002/
//     ?appid=730
//     &steamid={steamId64}
//     &key={STEAM_WEB_API_KEY}
//
// Requires the `STEAM_WEB_API_KEY` environment variable.
// STEAM_WEB_API_KEY must be exactly 32 characters (alphanumeric hex string).
// If the key is absent or invalid, the client returns a NO_API_KEY error.
//
// Design notes:
//   - This returns AGGREGATE lifetime stats, not per-match data.
//   - CS2 (appid=730) uses the same endpoint that worked for CS:GO.
//     Valve has maintained backward-compatibility for public profiles.
//   - For private profiles, the API returns 403 / empty stats.
//     The caller should mark the profile as PRIVATE_PROFILE.
//   - No per-match history is available via the public Steam API for CS2.
//     Per-match sync would require FACEIT API or a third-party provider.
//
// CS2 stat keys (from Valve's IPlayerStats interface, appid=730):
//   total_kills, total_deaths, total_kills_headshot, total_time_played,
//   total_wins, total_rounds_played, total_matches_played,
//   total_shots_fired, total_shots_hit, total_money_earned, ...
// ─────────────────────────────────────────────────────────────────────────────

const STEAM_API_BASE       = "https://api.steampowered.com";
const CS2_APP_ID           = 730;
const VALID_KEY_LENGTH     = 32;

// ── Types ──────────────────────────────────────────────────────────────────────

/** Raw stat item from the Steam API response. */
interface SteamStatEntry {
  name:  string;
  value: number;
}

/** Raw Steam API response shape. */
interface SteamUserStatsResponse {
  playerstats?: {
    steamID:   string;
    gameName?: string;
    stats?:    SteamStatEntry[];
    success?:  boolean;
  };
}

/** CS2 aggregate career stats extracted from the Steam response. */
export interface Cs2CareerStats {
  steamId:            string;
  totalKills:         number;
  totalDeaths:        number;
  totalHeadshots:     number;
  totalWins:          number;
  totalMatchesPlayed: number;
  totalRoundsPlayed:  number;
  totalShotsFired:    number;
  totalShotsHit:      number;
  totalTimePlayed:    number;
  /** Accuracy = totalShotsHit / totalShotsFired (0..1, null if 0 shots). */
  accuracy:           number | null;
  /** K/D ratio = kills / max(deaths, 1). */
  kdRatio:            number;
  /** Headshot% = headshots / max(kills, 1). */
  headshotPct:        number;
  /** Win rate = wins / max(matches, 1). */
  winRate:            number;
  /** Kills per round = kills / max(rounds, 1). A core FPS impact metric. */
  avgKillsPerRound:   number;
}

export type Cs2StatsError =
  | "NO_API_KEY"
  | "INVALID_API_KEY"
  | "PRIVATE_PROFILE"
  | "PROVIDER_ERROR"
  | "EMPTY_STATS";

export type Cs2StatsResult =
  | { ok: true;  stats: Cs2CareerStats }
  | { ok: false; error: Cs2StatsError; message: string };

// ── API Key validation ─────────────────────────────────────────────────────────

/**
 * Validates the STEAM_WEB_API_KEY environment variable.
 *
 * Rules:
 *   1. Must exist (not empty / undefined)
 *   2. Must be a string
 *   3. Must be exactly 32 characters (Valve Steam Web API keys are 32-char hex)
 *
 * Returns the validated key or throws with code INVALID_STEAM_API_KEY.
 */
export function validateSteamApiKey(): { valid: true; key: string } | { valid: false; error: Cs2StatsError; message: string } {
  const raw = process.env.STEAM_WEB_API_KEY;

  if (!raw || typeof raw !== "string" || raw.trim() === "") {
    console.error("[SteamClient] INVALID_STEAM_API_KEY — key is missing or empty.");
    return {
      valid:   false,
      error:   "NO_API_KEY",
      message: "STEAM_WEB_API_KEY is not configured. Set this env var to enable CS2 stats sync.",
    };
  }

  const key = raw.trim();

  if (key.length !== VALID_KEY_LENGTH) {
    console.error(
      `[SteamClient] INVALID_STEAM_API_KEY — expected ${VALID_KEY_LENGTH} chars, got ${key.length}. ` +
      `Re-enter the key in Secrets (only the 32-character hex string, no extra whitespace).`
    );
    return {
      valid:   false,
      error:   "INVALID_API_KEY",
      message: `Steam API key has invalid length: ${key.length} chars (expected exactly ${VALID_KEY_LENGTH}). Please re-enter the key.`,
    };
  }

  return { valid: true, key };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function extractStat(stats: SteamStatEntry[], key: string): number {
  return stats.find(s => s.name === key)?.value ?? 0;
}

function buildCareerStats(steamId: string, raw: SteamStatEntry[]): Cs2CareerStats {
  const kills   = extractStat(raw, "total_kills");
  const deaths  = extractStat(raw, "total_deaths");
  const hs      = extractStat(raw, "total_kills_headshot");
  const wins    = extractStat(raw, "total_wins");
  const matches = extractStat(raw, "total_matches_played");
  const rounds  = extractStat(raw, "total_rounds_played");
  const fired   = extractStat(raw, "total_shots_fired");
  const hit     = extractStat(raw, "total_shots_hit");
  const time    = extractStat(raw, "total_time_played");

  return {
    steamId,
    totalKills:         kills,
    totalDeaths:        deaths,
    totalHeadshots:     hs,
    totalWins:          wins,
    totalMatchesPlayed: matches,
    totalRoundsPlayed:  rounds,
    totalShotsFired:    fired,
    totalShotsHit:      hit,
    totalTimePlayed:    time,
    accuracy:           fired > 0 ? parseFloat((hit / fired).toFixed(4)) : null,
    kdRatio:            parseFloat((kills / Math.max(deaths, 1)).toFixed(4)),
    headshotPct:        parseFloat((hs    / Math.max(kills, 1)).toFixed(4)),
    winRate:            parseFloat((wins  / Math.max(matches, 1)).toFixed(4)),
    avgKillsPerRound:   parseFloat((kills / Math.max(rounds, 1)).toFixed(4)),
  };
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Fetch aggregate CS2 career stats for a player by their SteamID64.
 *
 * Returns a typed result union — never throws to the caller.
 * The caller is responsible for graceful degradation on error.
 *
 * Validation sequence:
 *   1. STEAM_WEB_API_KEY must exist and be exactly 32 characters → NO_API_KEY / INVALID_API_KEY
 *   2. HTTP 403 from Steam → PRIVATE_PROFILE (key forbidden OR profile private)
 *   3. Other HTTP error → PROVIDER_ERROR
 *   4. No stats in response → EMPTY_STATS
 *   5. Stats present → ok: true
 */
export async function fetchCs2CareerStats(steamId64: string): Promise<Cs2StatsResult> {
  // ── Step 1: Validate API key ───────────────────────────────────────────────
  const keyResult = validateSteamApiKey();
  if (!keyResult.valid) {
    return { ok: false, error: keyResult.error, message: keyResult.message };
  }
  const apiKey = keyResult.key;

  console.log(`[SteamClient] Fetching CS2 stats for steamId=${steamId64} …`);

  const url = new URL(`${STEAM_API_BASE}/ISteamUserStats/GetUserStatsForGame/v0002/`);
  url.searchParams.set("key",     apiKey);
  url.searchParams.set("steamid", steamId64);
  url.searchParams.set("appid",   String(CS2_APP_ID));

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: { "Accept": "application/json" },
      signal:  AbortSignal.timeout(10_000),
    });
  } catch (err: any) {
    console.error(`[SteamClient] PROVIDER_ERROR — network failure: ${err?.message}`);
    return {
      ok: false,
      error: "PROVIDER_ERROR",
      message: `Steam API request failed: ${err?.message ?? "network error"}`,
    };
  }

  // ── Step 2: Handle HTTP errors ────────────────────────────────────────────
  // Steam returns 403 for:
  //   a) Private CS2 stats (profile is set to private)
  //   b) Invalid API key ("Forbidden — verify your key parameter")
  // Steam returns 400 for:
  //   a) The player has no stats for this game (hasn't played CS2, or game not owned)
  //   b) Bad parameter format
  if (response.status === 403) {
    const body = await response.text().catch(() => "");
    const isKeyError = body.toLowerCase().includes("verify your") || body.toLowerCase().includes("key=");
    if (isKeyError) {
      console.error(
        `[SteamClient] STEAM_API_FORBIDDEN — Steam rejected the API key. ` +
        `Please verify STEAM_WEB_API_KEY is a valid 32-char Steam Web API key.`
      );
    } else {
      console.warn(
        `[SteamClient] PRIVATE_PROFILE — Steam profile ${steamId64} has private CS2 stats. ` +
        `Player must set Game Details to Public in Steam privacy settings.`
      );
    }
    return {
      ok: false,
      error: "PRIVATE_PROFILE",
      message: isKeyError
        ? `Steam API key rejected (Forbidden). Verify STEAM_WEB_API_KEY is correct.`
        : `Steam profile ${steamId64} is private or CS2 stats are hidden.`,
    };
  }

  if (response.status === 400) {
    // 400 = no stats for this game — player hasn't played CS2 or game not in library.
    // This is NOT a key error — treat as EMPTY_STATS.
    console.warn(
      `[SteamClient] EMPTY_STATS (400) — steamId=${steamId64} has no CS2 stats. ` +
      `Account may not own CS2 or has 0 hours played.`
    );
    return {
      ok: false,
      error: "EMPTY_STATS",
      message: `Steam account ${steamId64} has no CS2 stats (HTTP 400). The account may not own or have played CS2.`,
    };
  }

  if (!response.ok) {
    console.error(`[SteamClient] PROVIDER_ERROR — HTTP ${response.status}`);
    return {
      ok: false,
      error: "PROVIDER_ERROR",
      message: `Steam API returned HTTP ${response.status}`,
    };
  }

  // ── Step 3: Parse response ─────────────────────────────────────────────────
  let body: SteamUserStatsResponse;
  try {
    body = await response.json() as SteamUserStatsResponse;
  } catch {
    console.error(`[SteamClient] PROVIDER_ERROR — response was not valid JSON`);
    return {
      ok: false,
      error: "PROVIDER_ERROR",
      message: "Steam API response was not valid JSON.",
    };
  }

  const stats = body?.playerstats?.stats;
  if (!stats || stats.length === 0) {
    console.warn(`[SteamClient] EMPTY_STATS — no CS2 stats for steamId=${steamId64}`);
    return {
      ok: false,
      error: "EMPTY_STATS",
      message: `No CS2 stats found for steamId ${steamId64}. Profile may be private or player has no CS2 history.`,
    };
  }

  // ── Step 4: Build and return career stats ──────────────────────────────────
  const career = buildCareerStats(steamId64, stats);
  console.log(
    `[SteamClient] OK — steamId=${steamId64} kills=${career.totalKills} deaths=${career.totalDeaths} ` +
    `matches=${career.totalMatchesPlayed} kd=${career.kdRatio} hs%=${career.headshotPct} wr=${career.winRate}`
  );
  return { ok: true, stats: career };
}

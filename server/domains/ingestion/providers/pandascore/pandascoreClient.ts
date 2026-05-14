// ─── PandaScore HTTP Client ───────────────────────────────────────────────────
// Responsibility: raw HTTP access to the PandaScore API.
// No normalisation logic lives here — only fetch + typed response.
// ─────────────────────────────────────────────────────────────────────────────

// ── Minimal local types for fields we actually use ────────────────────────────

export interface PandaScoreVideogame {
  id:   number;
  name: string;
  slug: string;
}

export interface PandaScoreTeamRef {
  id:        number;
  name:      string;
  acronym:   string | null;
  location:  string | null;
  slug:      string;
  image_url: string | null;
}

export interface PandaScoreOpponent {
  type:     "Team" | "Player";
  opponent: PandaScoreTeamRef;
}

export interface PandaScoreLeague {
  id:   number;
  name: string;
  slug: string;
}

export interface PandaScoreSerie {
  id:   number;
  name: string;
  slug: string;
}

export interface PandaScoreTournament {
  id:   number;
  name: string;
  slug: string;
}

export interface PandaScoreWinner {
  id:   number | null;
  type: "Team" | "Player" | null;
}

export interface PandaScoreMatch {
  id:                    number;
  name:                  string;
  status:                string;       // "not_started" | "running" | "finished" | "cancelled" | …
  rescheduled:           boolean;
  begin_at:              string | null;
  scheduled_at:          string | null;
  original_scheduled_at: string | null;
  videogame:             PandaScoreVideogame | null;
  league:                PandaScoreLeague | null;
  serie:                 PandaScoreSerie | null;
  tournament:            PandaScoreTournament | null;
  opponents:             PandaScoreOpponent[];
  winner:                PandaScoreWinner | null;
  results:               Array<{ team_id: number; score: number }>;
}

// ── Request params ────────────────────────────────────────────────────────────

export interface PandaScoreMatchListParams {
  videogame?: string;
  page?:      number;
  perPage?:   number;
}

// ── Client ────────────────────────────────────────────────────────────────────

export class PandaScoreClient {
  private readonly apiKey:  string | null;
  private readonly baseUrl: string;

  constructor() {
    // Key validation is deferred to request time so importing this module
    // (and constructing the ingestion singleton) never throws at boot.
    // Matches the lazy-validation pattern used by Riot/Steam/CS2 clients.
    this.apiKey  = process.env.PANDASCORE_API_KEY ?? null;
    this.baseUrl = process.env.PANDASCORE_BASE_URL ?? "https://api.pandascore.co";
  }

  // ── Private HTTP helper ───────────────────────────────────────────────────

  private async request<T>(
    path: string,
    params: PandaScoreMatchListParams = {}
  ): Promise<T> {
    if (!this.apiKey) {
      throw new Error(
        "PandaScoreClient: PANDASCORE_API_KEY is not set. " +
        "Set it in the environment to enable PandaScore ingestion.",
      );
    }

    const url = new URL(`${this.baseUrl}${path}`);

    if (params.videogame) url.searchParams.set("videogame", params.videogame);
    if (params.page)      url.searchParams.set("page",      String(params.page));
    if (params.perPage)   url.searchParams.set("per_page",  String(params.perPage));

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept:        "application/json",
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "(unreadable body)");
      throw new Error(
        `PandaScoreClient: HTTP ${response.status} from ${path} — ${body}`
      );
    }

    return response.json() as Promise<T>;
  }

  // ── Public methods ────────────────────────────────────────────────────────

  getUpcomingMatches(params?: PandaScoreMatchListParams): Promise<PandaScoreMatch[]> {
    return this.request<PandaScoreMatch[]>("/matches/upcoming", params);
  }

  getRunningMatches(params?: PandaScoreMatchListParams): Promise<PandaScoreMatch[]> {
    return this.request<PandaScoreMatch[]>("/matches/running", params);
  }

  getPastMatches(params?: PandaScoreMatchListParams): Promise<PandaScoreMatch[]> {
    return this.request<PandaScoreMatch[]>("/matches/past", params);
  }

  /**
   * Fetch a single match by its PandaScore numeric ID.
   * Throws if the match is not found (HTTP 404) or on any other HTTP error.
   */
  getMatchById(matchId: string | number): Promise<PandaScoreMatch> {
    return this.request<PandaScoreMatch>(`/matches/${encodeURIComponent(String(matchId))}`);
  }
}

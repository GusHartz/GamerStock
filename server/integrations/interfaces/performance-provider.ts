/**
 * PerformanceProvider — canonical interface for player performance data.
 *
 * Decouples the GamerStock core from any specific data source (Riot API,
 * synthetic simulation, future game integrations).
 *
 * Implementing classes must NOT mutate market state or execute trades.
 * This interface is strictly read-oriented, plus two explicit ops methods
 * (syncPlayers / runPerformanceBatch) that are safe to call from admin endpoints.
 *
 * ─── Boundary notes ───────────────────────────────────────────────────────────
 * This interface intentionally covers BOTH "player registry" reads (getPlayers,
 * getLeaderboard) and "performance data" reads (getFundamentals, getScore, etc.)
 * because both originate from the same provider source (Riot API or synthetic).
 *
 * A future `PlayerRegistryReader` split is recommended (Phase 5C) if a game
 * integration needs to separate its player listing pipeline from its performance
 * scoring pipeline. For now, one interface per provider is the right tradeoff.
 *
 * ─── What does NOT belong here ────────────────────────────────────────────────
 * - Engine-internal state: roleBaselines, roleMetricWeights, playerMatchMetrics
 *   These are internal to the performance scoring pipeline and should not cross
 *   the provider boundary. Routes that read them query the DB directly.
 * - Market mutations: AMM pricing, trade execution, market state updates.
 * - Admin bulk exports / raw match detail — these bypass the provider boundary.
 */

// ─── Auxiliary Types ──────────────────────────────────────────────────────────

export interface PlayerRecord {
  puuid: string;
  displayName: string;
  leaguePoints: number;
  wins: number;
  losses: number;
  winrate: number;
  lastSyncedAt: Date | null;
}

/**
 * LeaderboardEntry — player listing with asset pricing fields.
 * Numeric fields intentionally kept as `string` to match the raw Postgres
 * numeric type and preserve existing API payload shape exactly.
 */
export interface LeaderboardEntry {
  puuid: string;
  gameName: string;
  tagLine: string;
  leaguePoints: number;
  wins: number;
  losses: number;
  winrate: string;
  lastTradePrice: string;
  price24hAgo: string;
  volume24h: string;
  momentum: string;
  lastSyncedAt: Date;
  updatedAt: Date;
}

export interface PlayerFundamentals {
  puuid: string;
  wins: number;
  losses: number;
  winrate: number;
  leaguePoints: number;
  momentum: number;
  recentPerformance: number | null;
  consistencyScore: number | null;
  historicalSkill: number | null;
  activityScore: number | null;
  pviRaw: number | null;
  pviFinal: number | null;
  fairValueGS: number | null;
  divergencePct: number | null;
  confidence: number | null;
  lastMatchPulse: number | null;
}

export interface PerformanceScore {
  puuid: string;
  matchId: string;
  role: string;
  matchScore: number;
  emaScore: number;
  recordedAt: Date;
}

export interface MatchSummary {
  matchId: string;
  puuid: string;
  gameStartTimestamp: number | null;
  teamPosition: string | null;
  perfScore: number | null;
  processedAt: Date;
}

export interface SyncResult {
  inserted: number;
  updated: number;
  total: number;
}

export interface PerfBatchResult {
  processed: number;
  errors: number;
}

// ─── Interface ────────────────────────────────────────────────────────────────

export interface PerformanceProvider {
  readonly providerName: string;
  readonly game: string;

  getPlayers(options?: { search?: string; limit?: number }): Promise<PlayerRecord[]>;
  getPlayerCount(): Promise<number>;
  getLeaderboard(limit?: number): Promise<LeaderboardEntry[]>;

  getPlayerFundamentals(puuid: string): Promise<PlayerFundamentals | null>;
  getLatestPerformanceScore(puuid: string): Promise<PerformanceScore | null>;
  getRecentMatchSummaries(puuid: string, limit?: number): Promise<MatchSummary[]>;

  syncPlayers(): Promise<SyncResult>;
  runPerformanceBatch(): Promise<PerfBatchResult>;
}

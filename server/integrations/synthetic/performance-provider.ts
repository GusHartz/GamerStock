/**
 * SyntheticPerformanceProvider
 *
 * Implements PerformanceProvider using the sandbox vault system.
 * Designed for use when:
 *  - the Riot API key is not yet approved
 *  - running in SANDBOX market mode
 *  - integration testing without live API dependencies
 *
 * Coverage is intentionally minimal at Phase 5A:
 *  - getPlayers / getPlayerCount → reads from `vaults` table
 *  - getPlayerFundamentals → maps vault fields to fundamentals shape
 *  - getLatestPerformanceScore → not available (returns null)
 *  - getRecentMatchSummaries → not available (returns [])
 *  - syncPlayers / runPerformanceBatch → no-ops (sandbox data is seeded separately)
 *
 * Future phases can wire up synthetic match generation here.
 */

import { db } from "../../db";
import { vaults } from "@shared/schema";
import { sql, ilike } from "drizzle-orm";
import type {
  PerformanceProvider,
  PlayerRecord,
  PlayerFundamentals,
  LeaderboardEntry,
  PerformanceScore,
  MatchSummary,
  SyncResult,
  PerfBatchResult,
} from "../interfaces/performance-provider";

export class SyntheticPerformanceProvider implements PerformanceProvider {
  readonly providerName = "synthetic";
  readonly game = "league-of-legends";

  async getPlayers(options?: { search?: string; limit?: number }): Promise<PlayerRecord[]> {
    const query = db
      .select()
      .from(vaults)
      .orderBy(sql`${vaults.performanceIndex} DESC`);

    const rows = options?.search
      ? await db
          .select()
          .from(vaults)
          .where(ilike(vaults.playerAlias, `%${options.search}%`))
          .orderBy(sql`${vaults.performanceIndex} DESC`)
          .limit(options.limit ?? 500)
      : await query.limit(options?.limit ?? 500);

    return rows.map((v) => ({
      puuid: `synthetic:vault:${v.id}`,
      displayName: v.playerAlias,
      leaguePoints: 0,
      wins: 0,
      losses: 0,
      winrate: parseFloat(String(v.winrate)),
      lastSyncedAt: v.updatedAt,
    }));
  }

  async getPlayerCount(): Promise<number> {
    const [result] = await db.select({ count: sql<number>`count(*)` }).from(vaults);
    return Number(result.count);
  }

  async getLeaderboard(limit = 300): Promise<LeaderboardEntry[]> {
    const rows = await db
      .select()
      .from(vaults)
      .orderBy(sql`${vaults.performanceIndex} DESC`)
      .limit(limit);

    return rows.map((v) => ({
      puuid: `synthetic:vault:${v.id}`,
      gameName: v.playerAlias,
      tagLine: "",
      leaguePoints: 0,
      wins: 0,
      losses: 0,
      winrate: String(v.winrate),
      lastTradePrice: String(v.lastTradePrice),
      price24hAgo: String(v.price24hAgo),
      volume24h: String(v.volume24h),
      momentum: String(v.momentum),
      lastSyncedAt: v.updatedAt,
      updatedAt: v.updatedAt,
    }));
  }

  async getPlayerFundamentals(puuid: string): Promise<PlayerFundamentals | null> {
    const vaultIdMatch = puuid.match(/^synthetic:vault:(\d+)$/);
    if (!vaultIdMatch) return null;

    const id = parseInt(vaultIdMatch[1], 10);
    const [vault] = await db.select().from(vaults).where(sql`${vaults.id} = ${id}`).limit(1);
    if (!vault) return null;

    const winrate = parseFloat(String(vault.winrate));
    const perfIndex = parseFloat(String(vault.performanceIndex));
    const momentum = parseFloat(String(vault.momentum));

    return {
      puuid,
      wins: 0,
      losses: 0,
      winrate,
      leaguePoints: 0,
      momentum,
      recentPerformance: perfIndex,
      consistencyScore: null,
      historicalSkill: null,
      activityScore: null,
      pviRaw: null,
      pviFinal: null,
      fairValueGS: parseFloat(String(vault.lastTradePrice)),
      divergencePct: null,
      confidence: null,
      lastMatchPulse: null,
    };
  }

  async getLatestPerformanceScore(_puuid: string): Promise<PerformanceScore | null> {
    return null;
  }

  async getRecentMatchSummaries(_puuid: string, _limit = 10): Promise<MatchSummary[]> {
    return [];
  }

  async syncPlayers(): Promise<SyncResult> {
    console.log("[SyntheticProvider] syncPlayers is a no-op in SANDBOX mode.");
    return { inserted: 0, updated: 0, total: 0 };
  }

  async runPerformanceBatch(): Promise<PerfBatchResult> {
    console.log("[SyntheticProvider] runPerformanceBatch is a no-op in SANDBOX mode.");
    return { processed: 0, errors: 0 };
  }
}

/**
 * RiotPerformanceProvider
 *
 * Implements PerformanceProvider backed by the Riot API integration.
 * Delegates to the existing riot-sync.ts and riot-perf.ts modules so
 * that no behaviour changes — this is purely an adapter layer.
 */

import { db } from "../../db";
import {
  riotAssets,
  riotMatchCache,
  performanceScores,
  assetValuationState,
} from "@shared/schema";
import { eq, desc, sql } from "drizzle-orm";
import { syncChallengerNA1, getRiotPlayers, getRiotPlayerCount } from "../../riot-sync";
import { runPerfPricingJob } from "../../riot-perf";
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

export class RiotPerformanceProvider implements PerformanceProvider {
  readonly providerName = "riot-na1";
  readonly game = "league-of-legends";

  async getPlayers(options?: { search?: string; limit?: number }): Promise<PlayerRecord[]> {
    const rows = await getRiotPlayers(options?.search);
    const limited = options?.limit ? rows.slice(0, options.limit) : rows;
    return limited.map((r) => ({
      puuid: r.puuid ?? r.summonerId,
      displayName: r.summonerName ?? "",
      leaguePoints: r.leaguePoints ?? 0,
      wins: r.wins ?? 0,
      losses: r.losses ?? 0,
      winrate: r.winrate ?? 0,
      lastSyncedAt: r.updatedAt ?? null,
    }));
  }

  async getPlayerCount(): Promise<number> {
    return getRiotPlayerCount();
  }

  async getLeaderboard(limit = 300): Promise<LeaderboardEntry[]> {
    const rows = await db
      .select()
      .from(riotAssets)
      .orderBy(desc(riotAssets.leaguePoints))
      .limit(limit);

    return rows.map((r) => ({
      puuid: r.puuid,
      gameName: r.gameName,
      tagLine: r.tagLine,
      leaguePoints: r.leaguePoints,
      wins: r.wins,
      losses: r.losses,
      winrate: r.winrate,
      lastTradePrice: r.lastTradePrice,
      price24hAgo: r.price24hAgo,
      volume24h: r.volume24h,
      momentum: r.momentum,
      lastSyncedAt: r.lastSyncedAt,
      updatedAt: r.updatedAt,
    }));
  }

  async getPlayerFundamentals(puuid: string): Promise<PlayerFundamentals | null> {
    const [asset] = await db
      .select({
        wins: riotAssets.wins,
        losses: riotAssets.losses,
        winrate: riotAssets.winrate,
        leaguePoints: riotAssets.leaguePoints,
        momentum: riotAssets.momentum,
      })
      .from(riotAssets)
      .where(eq(riotAssets.puuid, puuid))
      .limit(1);

    if (!asset) return null;

    const [valuation] = await db
      .select({
        recentPerformance: assetValuationState.recentPerformance,
        consistencyScore: assetValuationState.consistencyScore,
        historicalSkill: assetValuationState.historicalSkill,
        activityScore: assetValuationState.activityScore,
        pviRaw: assetValuationState.pviRaw,
        pviFinal: assetValuationState.pviFinal,
        fairValueGS: assetValuationState.fairValueGS,
        divergencePct: assetValuationState.divergencePct,
        confidenceScore: assetValuationState.confidenceScore,
        lastMatchPulse: assetValuationState.lastMatchPulse,
      })
      .from(assetValuationState)
      .where(eq(assetValuationState.puuid, puuid))
      .limit(1);

    const wins = asset.wins ?? 0;
    const losses = asset.losses ?? 0;
    const games = wins + losses;

    return {
      puuid,
      wins,
      losses,
      winrate: games > 0 ? (wins / games) * 100 : parseFloat(String(asset.winrate || "0")),
      leaguePoints: asset.leaguePoints ?? 0,
      momentum: parseFloat(String(asset.momentum || "0")),
      recentPerformance: valuation ? parseFloat(String(valuation.recentPerformance)) : null,
      consistencyScore: valuation ? parseFloat(String(valuation.consistencyScore)) : null,
      historicalSkill: valuation ? parseFloat(String(valuation.historicalSkill)) : null,
      activityScore: valuation ? parseFloat(String(valuation.activityScore)) : null,
      pviRaw: valuation ? parseFloat(String(valuation.pviRaw)) : null,
      pviFinal: valuation ? parseFloat(String(valuation.pviFinal)) : null,
      fairValueGS: valuation ? parseFloat(String(valuation.fairValueGS)) : null,
      divergencePct: valuation ? parseFloat(String(valuation.divergencePct)) : null,
      confidence: valuation ? parseFloat(String(valuation.confidenceScore)) : null,
      lastMatchPulse: valuation ? parseFloat(String(valuation.lastMatchPulse)) : null,
    };
  }

  async getLatestPerformanceScore(puuid: string): Promise<PerformanceScore | null> {
    const [row] = await db
      .select()
      .from(performanceScores)
      .where(eq(performanceScores.assetId, puuid))
      .orderBy(desc(performanceScores.createdAt))
      .limit(1);

    if (!row) return null;

    return {
      puuid,
      matchId: row.matchId,
      role: row.role,
      matchScore: parseFloat(row.matchScore),
      emaScore: parseFloat(row.emaScore),
      recordedAt: row.createdAt,
    };
  }

  async getRecentMatchSummaries(puuid: string, limit = 10): Promise<MatchSummary[]> {
    const rows = await db
      .select({
        matchId: riotMatchCache.matchId,
        puuid: riotMatchCache.puuid,
        gameStartTimestamp: riotMatchCache.gameStartTimestamp,
        teamPosition: riotMatchCache.teamPosition,
        perfScore: riotMatchCache.perfScore,
        processedAt: riotMatchCache.processedAt,
      })
      .from(riotMatchCache)
      .where(eq(riotMatchCache.puuid, puuid))
      .orderBy(desc(riotMatchCache.processedAt))
      .limit(limit);

    return rows.map((r) => ({
      matchId: r.matchId,
      puuid: r.puuid,
      gameStartTimestamp: r.gameStartTimestamp ?? null,
      teamPosition: r.teamPosition ?? null,
      perfScore: r.perfScore !== null && r.perfScore !== undefined ? parseFloat(String(r.perfScore)) : null,
      processedAt: r.processedAt,
    }));
  }

  async syncPlayers(): Promise<SyncResult> {
    return syncChallengerNA1();
  }

  async runPerformanceBatch(): Promise<PerfBatchResult> {
    return runPerfPricingJob();
  }
}

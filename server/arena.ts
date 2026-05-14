import { db } from "./db";
import { arenaProfiles, arenaUserStats, arenaEvents } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { computeRank, computeTraderStyle, XP_PER_TRADE, XP_PER_PROFITABLE_SELL } from "@shared/arena-config";
import { processAchievements } from "./services/achievementsService";
import { getActiveSeason, applyTradeToSeasonStats } from "./services/seasonsService";

export interface ArenaTradeInput {
  userId: string;
  tradeType: "BUY" | "SELL";
  realizedPnl?: number;
  pnlPct?: number;
  meta?: Record<string, unknown>;
}

export async function updateArenaOnTrade(input: ArenaTradeInput): Promise<void> {
  const { userId, tradeType, realizedPnl, pnlPct, meta } = input;

  try {
    let isComeback = false;

    const updatedStats = await db.transaction(async (tx) => {
      await tx
        .insert(arenaUserStats)
        .values({
          userId,
          xpTotal: 0,
          rank: "Bronze",
          realizedProfitTotal: "0",
          tradesTotal: 0,
          winTrades: 0,
          lossTrades: 0,
          winStreakCurrent: 0,
          winStreakBest: 0,
          lossStreakCurrent: 0,
          updatedAt: new Date(),
        })
        .onConflictDoNothing();

      const [stats] = await tx.select().from(arenaUserStats).where(eq(arenaUserStats.userId, userId));

      let xpGain = XP_PER_TRADE;
      const eventsToInsert: { userId: string; type: string; xpDelta: number; metaJson: unknown }[] = [
        { userId, type: "TRADE_EXECUTED", xpDelta: XP_PER_TRADE, metaJson: { tradeType, ...meta } },
      ];

      let newRealizedProfit = parseFloat(stats.realizedProfitTotal ?? "0");
      let newWins = stats.winTrades;
      let newLosses = stats.lossTrades;
      let newBest = stats.bestTradePnl != null ? parseFloat(stats.bestTradePnl) : null;
      let newWorst = stats.worstTradePnl != null ? parseFloat(stats.worstTradePnl) : null;

      let newWinStreak = stats.winStreakCurrent ?? 0;
      let newLossStreak = stats.lossStreakCurrent ?? 0;
      let newBestWinStreak = stats.winStreakBest ?? 0;
      const previousLossStreak = newLossStreak;

      if (tradeType === "SELL" && realizedPnl !== undefined) {
        newRealizedProfit += realizedPnl;

        if (realizedPnl > 0) {
          newWins += 1;
          xpGain += XP_PER_PROFITABLE_SELL;
          eventsToInsert.push({
            userId,
            type: "PROFITABLE_TRADE",
            xpDelta: XP_PER_PROFITABLE_SELL,
            metaJson: { realizedPnl, pnlPct, ...meta },
          });
          if (previousLossStreak >= 3) {
            isComeback = true;
          }
          newWinStreak += 1;
          newLossStreak = 0;
        } else if (realizedPnl < 0) {
          newLosses += 1;
          newWinStreak = 0;
          newLossStreak += 1;
        }

        newBestWinStreak = Math.max(newBestWinStreak, newWinStreak);
        if (newBest === null || realizedPnl > newBest) newBest = realizedPnl;
        if (newWorst === null || realizedPnl < newWorst) newWorst = realizedPnl;
      }

      const newXp = stats.xpTotal + xpGain;
      const newRank = computeRank(newXp);
      const newTradesTotal = (stats.tradesTotal ?? 0) + 1;

      if (newRank !== stats.rank) {
        eventsToInsert.push({
          userId,
          type: "RANK_UP",
          xpDelta: 0,
          metaJson: { oldRank: stats.rank, newRank },
        });
      }

      const newTraderStyle = computeTraderStyle({
        tradesTotal: newTradesTotal,
        winTrades: newWins,
        lossTrades: newLosses,
        realizedProfitTotal: newRealizedProfit.toFixed(6),
        winStreakBest: newBestWinStreak,
        bestTradePnl: newBest !== null ? newBest.toFixed(6) : null,
      });

      await tx
        .update(arenaUserStats)
        .set({
          xpTotal: newXp,
          rank: newRank,
          realizedProfitTotal: newRealizedProfit.toFixed(6),
          tradesTotal: sql`${arenaUserStats.tradesTotal} + 1`,
          winTrades: newWins,
          lossTrades: newLosses,
          bestTradePnl: newBest !== null ? newBest.toFixed(6) : null,
          worstTradePnl: newWorst !== null ? newWorst.toFixed(6) : null,
          winStreakCurrent: newWinStreak,
          winStreakBest: newBestWinStreak,
          lossStreakCurrent: newLossStreak,
          traderStyle: newTraderStyle,
          updatedAt: new Date(),
        })
        .where(eq(arenaUserStats.userId, userId));

      for (const ev of eventsToInsert) {
        await tx.insert(arenaEvents).values(ev);
      }

      return {
        userId,
        xpTotal: newXp,
        rank: newRank,
        realizedProfitTotal: newRealizedProfit.toFixed(6),
        tradesTotal: newTradesTotal,
        winTrades: newWins,
        lossTrades: newLosses,
        bestTradePnl: newBest !== null ? newBest.toFixed(6) : null,
        worstTradePnl: newWorst !== null ? newWorst.toFixed(6) : null,
        winStreakCurrent: newWinStreak,
        winStreakBest: newBestWinStreak,
        lossStreakCurrent: newLossStreak,
        updatedAt: new Date(),
      };
    });

    await processAchievements(userId, {
      stats: updatedStats,
      pnlPct: tradeType === "SELL" ? pnlPct : undefined,
      isComeback,
    }).catch((err) => {
      console.error(`[Arena] Achievement processing error for userId=${userId}:`, err);
    });

    // Season stats update (non-critical)
    try {
      const season = await getActiveSeason();
      if (season) {
        await applyTradeToSeasonStats(season.id, userId, {
          tradeType,
          realizedPnl: realizedPnl ?? 0,
          pnlPct: pnlPct ?? null,
        });
      }
    } catch (err) {
      console.error(`[Arena] Season stats update error for userId=${userId}:`, err);
    }
  } catch (err) {
    console.error(`[Arena] Failed to update stats for userId=${userId}:`, err);
  }
}

export async function getOrCreateArenaProfile(userId: string) {
  const [existing] = await db.select().from(arenaProfiles).where(eq(arenaProfiles.userId, userId));
  if (existing) return existing;

  const [created] = await db
    .insert(arenaProfiles)
    .values({ userId, updatedAt: new Date() })
    .onConflictDoNothing()
    .returning();

  return created ?? null;
}

export async function getOrCreateArenaStats(userId: string) {
  await db
    .insert(arenaUserStats)
    .values({
      userId,
      xpTotal: 0,
      rank: "Bronze",
      realizedProfitTotal: "0",
      tradesTotal: 0,
      winTrades: 0,
      lossTrades: 0,
      winStreakCurrent: 0,
      winStreakBest: 0,
      lossStreakCurrent: 0,
      updatedAt: new Date(),
    })
    .onConflictDoNothing();

  const [stats] = await db.select().from(arenaUserStats).where(eq(arenaUserStats.userId, userId));
  return stats;
}

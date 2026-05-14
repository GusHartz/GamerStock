import { db } from "../db";
import {
  arenaSeasons,
  arenaUserSeasonStats,
  arenaSeasonLeaderboardSnapshot,
  arenaBadges,
  userBadges,
  arenaProfiles,
  users,
  seasonRewards,
  seasonRewardDistributions,
  arenaChallenges,
  type ArenaSeason,
  type SeasonReward,
  type ArenaChallenge,
} from "../../shared/schema";
import { eq, and, desc, sql, or, gte, lte } from "drizzle-orm";
import { RANK_THRESHOLDS } from "../../shared/arena-config";

export function computeRankFromXp(xp: number): string {
  let rank = "Bronze";
  for (const t of RANK_THRESHOLDS) {
    if (xp >= t.minXp) rank = t.rank;
  }
  return rank;
}

export async function getActiveSeason(): Promise<ArenaSeason | null> {
  const [season] = await db
    .select()
    .from(arenaSeasons)
    .where(eq(arenaSeasons.status, "active"))
    .limit(1);
  return season ?? null;
}

export async function ensureUserSeasonStats(seasonId: number, userId: string) {
  await db
    .insert(arenaUserSeasonStats)
    .values({
      seasonId,
      userId,
      xpSeason: 0,
      rankSeason: "Bronze",
      realizedProfitSeason: "0",
      tradesSeason: 0,
      winTradesSeason: 0,
      lossTradesSeason: 0,
      winStreakCurrentSeason: 0,
      winStreakBestSeason: 0,
      lossStreakCurrentSeason: 0,
      updatedAt: new Date(),
    })
    .onConflictDoNothing();
}

export async function applyTradeToSeasonStats(
  seasonId: number,
  userId: string,
  payload: {
    tradeType: "BUY" | "SELL";
    realizedPnl: number;
    pnlPct?: number | null;
  }
) {
  await ensureUserSeasonStats(seasonId, userId);

  const [stats] = await db
    .select()
    .from(arenaUserSeasonStats)
    .where(
      and(
        eq(arenaUserSeasonStats.seasonId, seasonId),
        eq(arenaUserSeasonStats.userId, userId)
      )
    );

  if (!stats) return;

  let xpGain = 10;
  let newWins = stats.winTradesSeason;
  let newLosses = stats.lossTradesSeason;
  let newProfit = parseFloat(stats.realizedProfitSeason ?? "0");
  let newWinStreak = stats.winStreakCurrentSeason;
  let newLossStreak = stats.lossStreakCurrentSeason;
  let newBestWinStreak = stats.winStreakBestSeason;
  let newBest =
    stats.bestTradePnlSeason != null
      ? parseFloat(stats.bestTradePnlSeason)
      : null;
  let newWorst =
    stats.worstTradePnlSeason != null
      ? parseFloat(stats.worstTradePnlSeason)
      : null;

  if (payload.tradeType === "SELL") {
    newProfit += payload.realizedPnl;
    if (payload.realizedPnl > 0) {
      newWins++;
      xpGain += 30;
      newWinStreak++;
      newLossStreak = 0;
    } else if (payload.realizedPnl < 0) {
      newLosses++;
      newWinStreak = 0;
      newLossStreak++;
    }
    newBestWinStreak = Math.max(newBestWinStreak, newWinStreak);
    if (newBest === null || payload.realizedPnl > newBest)
      newBest = payload.realizedPnl;
    if (newWorst === null || payload.realizedPnl < newWorst)
      newWorst = payload.realizedPnl;
  }

  const newXp = (stats.xpSeason ?? 0) + xpGain;
  const newRank = computeRankFromXp(newXp);

  await db
    .update(arenaUserSeasonStats)
    .set({
      xpSeason: newXp,
      rankSeason: newRank,
      realizedProfitSeason: newProfit.toFixed(6),
      tradesSeason: stats.tradesSeason + 1,
      winTradesSeason: newWins,
      lossTradesSeason: newLosses,
      winStreakCurrentSeason: newWinStreak,
      winStreakBestSeason: newBestWinStreak,
      lossStreakCurrentSeason: newLossStreak,
      bestTradePnlSeason: newBest !== null ? newBest.toFixed(6) : null,
      worstTradePnlSeason: newWorst !== null ? newWorst.toFixed(6) : null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(arenaUserSeasonStats.seasonId, seasonId),
        eq(arenaUserSeasonStats.userId, userId)
      )
    );
}

const BADGE_SEED = [
  {
    code: "S1_CHAMPION",
    name: "Season 1 Champion",
    description: "#1 overall profit for the season",
    iconKey: "crown",
    rarity: "legendary",
  },
  {
    code: "S1_ELITE_TRADER",
    name: "Elite Trader",
    description: "Top 1% profit for the season",
    iconKey: "diamond",
    rarity: "epic",
  },
  {
    code: "S1_MASTER_TRADER",
    name: "Master Trader",
    description: "Top 10% profit for the season",
    iconKey: "shield-diamond",
    rarity: "rare",
  },
  {
    code: "S1_RANKED_TRADER",
    name: "Ranked Trader",
    description: "Top 25% profit for the season",
    iconKey: "shield",
    rarity: "common",
  },
  {
    code: "S1_PROFIT_ELITE",
    name: "Profit Elite",
    description: "Top 1% realized profit for the season",
    iconKey: "chart-up",
    rarity: "epic",
  },
  {
    code: "S1_XP_ELITE",
    name: "XP Elite",
    description: "Top 1% XP earner for the season",
    iconKey: "bolt",
    rarity: "epic",
  },
  {
    code: "S1_SHARPSHOOTER",
    name: "Sharpshooter",
    description: "Top 1% win rate for the season (min 20 trades)",
    iconKey: "target",
    rarity: "epic",
  },
  {
    code: "S1_PARTICIPANT",
    name: "Season 1 Participant",
    description: "Completed 10+ trades in Season 1",
    iconKey: "ticket",
    rarity: "common",
  },
];

export async function seedBadges() {
  for (const badge of BADGE_SEED) {
    await db
      .insert(arenaBadges)
      .values(badge)
      .onConflictDoNothing();
  }
}

async function awardBadge(
  userId: string,
  badgeCode: string,
  meta: Record<string, unknown>
) {
  await db
    .insert(userBadges)
    .values({ userId, badgeCode, metaJson: meta, awardedAt: new Date() })
    .onConflictDoNothing();
}

export async function closeSeasonAndDistributeBadges(seasonId: number) {
  // Deduplication guard — if we already distributed for this season, skip badge awarding
  const existingDist = await db
    .select({ id: seasonRewardDistributions.id })
    .from(seasonRewardDistributions)
    .where(eq(seasonRewardDistributions.seasonId, seasonId))
    .limit(1);

  const alreadyDistributed = existingDist.length > 0;

  const allStats = await db
    .select()
    .from(arenaUserSeasonStats)
    .where(eq(arenaUserSeasonStats.seasonId, seasonId));

  if (allStats.length === 0) {
    await db
      .update(arenaSeasons)
      .set({ status: "closed", updatedAt: new Date() })
      .where(eq(arenaSeasons.id, seasonId));
    return { distributed: false, reason: "no_stats" };
  }

  if (alreadyDistributed) {
    await db
      .update(arenaSeasons)
      .set({ status: "closed", updatedAt: new Date() })
      .where(eq(arenaSeasons.id, seasonId));
    return { distributed: false, reason: "already_distributed" };
  }

  const byProfit = [...allStats].sort(
    (a, b) =>
      parseFloat(b.realizedProfitSeason ?? "0") -
      parseFloat(a.realizedProfitSeason ?? "0")
  );
  const byXp = [...allStats].sort((a, b) => b.xpSeason - a.xpSeason);
  const byWinRate = allStats
    .filter((s) => s.winTradesSeason + s.lossTradesSeason >= 20)
    .sort((a, b) => {
      const wra = a.winTradesSeason / (a.winTradesSeason + a.lossTradesSeason);
      const wrb = b.winTradesSeason / (b.winTradesSeason + b.lossTradesSeason);
      return wrb - wra;
    });

  const TOP_N = 1000;

  const snapshots: Array<{
    seasonId: number;
    metric: string;
    userId: string;
    rankPosition: number;
    value: string;
  }> = [];

  byProfit.slice(0, TOP_N).forEach((s, i) => {
    snapshots.push({
      seasonId,
      metric: "realizedProfit",
      userId: s.userId,
      rankPosition: i + 1,
      value: s.realizedProfitSeason ?? "0",
    });
  });
  byXp.slice(0, TOP_N).forEach((s, i) => {
    snapshots.push({
      seasonId,
      metric: "xp",
      userId: s.userId,
      rankPosition: i + 1,
      value: String(s.xpSeason),
    });
  });
  byWinRate.slice(0, TOP_N).forEach((s, i) => {
    const total = s.winTradesSeason + s.lossTradesSeason;
    const wr = total > 0 ? s.winTradesSeason / total : 0;
    snapshots.push({
      seasonId,
      metric: "winRate",
      userId: s.userId,
      rankPosition: i + 1,
      value: wr.toFixed(6),
    });
  });

  if (snapshots.length > 0) {
    for (const snap of snapshots) {
      await db.insert(arenaSeasonLeaderboardSnapshot).values(snap);
    }
  }

  const totalEligible = byProfit.filter((s) => s.tradesSeason >= 1).length;
  const totalWinRateEligible = byWinRate.length;

  for (let i = 0; i < byProfit.length; i++) {
    const s = byProfit[i];
    const rank = i + 1;
    const percentile = rank / totalEligible;

    if (s.tradesSeason >= 10) {
      await awardBadge(s.userId, "S1_PARTICIPANT", {
        seasonId,
        tradesSeason: s.tradesSeason,
      });
    }

    if (rank === 1) {
      await awardBadge(s.userId, "S1_CHAMPION", {
        seasonId,
        metric: "realizedProfit",
        rankPosition: rank,
        totalEligible,
        percentile,
      });
    }
    if (percentile <= 0.01) {
      await awardBadge(s.userId, "S1_ELITE_TRADER", {
        seasonId,
        metric: "realizedProfit",
        rankPosition: rank,
        totalEligible,
        percentile,
      });
      await awardBadge(s.userId, "S1_PROFIT_ELITE", {
        seasonId,
        metric: "realizedProfit",
        rankPosition: rank,
        totalEligible,
        percentile,
      });
    } else if (percentile <= 0.1) {
      await awardBadge(s.userId, "S1_MASTER_TRADER", {
        seasonId,
        metric: "realizedProfit",
        rankPosition: rank,
        totalEligible,
        percentile,
      });
    } else if (percentile <= 0.25) {
      await awardBadge(s.userId, "S1_RANKED_TRADER", {
        seasonId,
        metric: "realizedProfit",
        rankPosition: rank,
        totalEligible,
        percentile,
      });
    }
  }

  for (let i = 0; i < byXp.length; i++) {
    const s = byXp[i];
    const rank = i + 1;
    const percentile = rank / byXp.length;
    if (percentile <= 0.01) {
      await awardBadge(s.userId, "S1_XP_ELITE", {
        seasonId,
        metric: "xp",
        rankPosition: rank,
        totalEligible: byXp.length,
        percentile,
      });
    }
  }

  for (let i = 0; i < byWinRate.length; i++) {
    const s = byWinRate[i];
    const rank = i + 1;
    const percentile = rank / totalWinRateEligible;
    if (percentile <= 0.01) {
      await awardBadge(s.userId, "S1_SHARPSHOOTER", {
        seasonId,
        metric: "winRate",
        rankPosition: rank,
        totalEligible: totalWinRateEligible,
        percentile,
      });
    }
  }

  // Record all awarded distributions for deduplication / audit
  const distributionRecords: {
    seasonId: number;
    userId: string;
    badgeCode: string;
    finalRank: number | null;
    metaJson: Record<string, unknown>;
  }[] = [];

  for (let i = 0; i < byProfit.length; i++) {
    const s = byProfit[i];
    const rank = i + 1;
    const percentile = rank / totalEligible;
    if (s.tradesSeason >= 10) {
      distributionRecords.push({ seasonId, userId: s.userId, badgeCode: "S1_PARTICIPANT", finalRank: rank, metaJson: { tradesSeason: s.tradesSeason } });
    }
    if (rank === 1) {
      distributionRecords.push({ seasonId, userId: s.userId, badgeCode: "S1_CHAMPION", finalRank: rank, metaJson: { metric: "realizedProfit", percentile } });
    }
    if (percentile <= 0.01) {
      distributionRecords.push({ seasonId, userId: s.userId, badgeCode: "S1_ELITE_TRADER", finalRank: rank, metaJson: { metric: "realizedProfit", percentile } });
      distributionRecords.push({ seasonId, userId: s.userId, badgeCode: "S1_PROFIT_ELITE", finalRank: rank, metaJson: { metric: "realizedProfit", percentile } });
    } else if (percentile <= 0.1) {
      distributionRecords.push({ seasonId, userId: s.userId, badgeCode: "S1_MASTER_TRADER", finalRank: rank, metaJson: { metric: "realizedProfit", percentile } });
    } else if (percentile <= 0.25) {
      distributionRecords.push({ seasonId, userId: s.userId, badgeCode: "S1_RANKED_TRADER", finalRank: rank, metaJson: { metric: "realizedProfit", percentile } });
    }
  }

  for (let i = 0; i < byXp.length; i++) {
    const s = byXp[i];
    const rank = i + 1;
    const percentile = rank / byXp.length;
    if (percentile <= 0.01) {
      distributionRecords.push({ seasonId, userId: s.userId, badgeCode: "S1_XP_ELITE", finalRank: rank, metaJson: { metric: "xp", percentile } });
    }
  }

  for (let i = 0; i < byWinRate.length; i++) {
    const s = byWinRate[i];
    const rank = i + 1;
    const percentile = rank / totalWinRateEligible;
    if (percentile <= 0.01) {
      distributionRecords.push({ seasonId, userId: s.userId, badgeCode: "S1_SHARPSHOOTER", finalRank: rank, metaJson: { metric: "winRate", percentile } });
    }
  }

  for (const rec of distributionRecords) {
    await db
      .insert(seasonRewardDistributions)
      .values(rec)
      .onConflictDoNothing();
  }

  await db
    .update(arenaSeasons)
    .set({ status: "closed", updatedAt: new Date() })
    .where(eq(arenaSeasons.id, seasonId));

  return { distributed: true, totalRecords: distributionRecords.length };
}

// ─── Season Rewards CRUD ──────────────────────────────────────────────────────

export async function getSeasonRewards(seasonId: number): Promise<SeasonReward[]> {
  return db
    .select()
    .from(seasonRewards)
    .where(eq(seasonRewards.seasonId, seasonId))
    .orderBy(seasonRewards.rankMin);
}

export async function addSeasonReward(data: {
  seasonId: number;
  rankMin: number;
  rankMax: number;
  badgeCode: string;
  label?: string;
}): Promise<SeasonReward> {
  const [row] = await db
    .insert(seasonRewards)
    .values(data)
    .returning();
  return row;
}

export async function deleteSeasonReward(rewardId: number) {
  await db.delete(seasonRewards).where(eq(seasonRewards.id, rewardId));
}

// ─── Challenges ───────────────────────────────────────────────────────────────

export async function getActiveChallenges(): Promise<ArenaChallenge[]> {
  const now = new Date();
  return db
    .select()
    .from(arenaChallenges)
    .where(and(
      eq(arenaChallenges.status, "active"),
      lte(arenaChallenges.startsAt, now),
    ))
    .orderBy(arenaChallenges.endsAt);
}

export async function getAllChallenges(): Promise<ArenaChallenge[]> {
  return db
    .select()
    .from(arenaChallenges)
    .orderBy(desc(arenaChallenges.createdAt));
}

export async function createChallenge(data: {
  title: string;
  description: string;
  type: string;
  target: number;
  rewardXp: number;
  startsAt: Date;
  endsAt: Date;
  status?: string;
}): Promise<ArenaChallenge> {
  const [row] = await db
    .insert(arenaChallenges)
    .values({ ...data, status: data.status ?? "active" })
    .returning();
  return row;
}

export async function deleteChallenge(challengeId: number) {
  await db.delete(arenaChallenges).where(eq(arenaChallenges.id, challengeId));
}

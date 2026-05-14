import type { Express, RequestHandler } from "express";
import { db } from "../../db";
import draftRouter from "../../modules/draft/draft.routes";
import { z } from "zod";
import { RANK_THRESHOLDS } from "@shared/arena-config";
import { getOrCreateArenaProfile, getOrCreateArenaStats } from "../../arena";
import { getCatalog, getUserAchievements, computeProgress } from "../../services/achievementsService";
import {
  getActiveSeason,
  getSeasonRewards,
  getActiveChallenges,
} from "../../services/seasonsService";
import { followUser, unfollowUser, isFollowing, getFollowing, getFollowers, getFollowCounts } from "../../services/followService";
import { challengeDuel, acceptDuel, rejectDuel, getUserDuels, DUEL_DURATIONS } from "../../services/duelService";
import {
  arenaProfiles,
  arenaUserStats,
  arenaBadges,
  userBadges,
  userAchievements,
  arenaSeasons,
  arenaUserSeasonStats,
  users,
  portfolios,
  arenaEvents,
} from "@shared/schema";
import { eq, desc, and, or, gte, sql as sqlExpr } from "drizzle-orm";

const isAuthenticated: RequestHandler = (req: any, res, next) => {
  if (req.session?.isAdmin || req.session?.userId) return next();
  if (typeof req.isAuthenticated === "function" && req.isAuthenticated()) return next();
  return res.status(401).json({ message: "Unauthorized" });
};

const isAdminOnly: RequestHandler = (req: any, res, next) => {
  if (req.session?.isAdmin) return next();
  return res.status(403).json({ message: "Admin only" });
};

function handleArenaError(label: string, err: any, res: any) {
  const msg = String(err?.message ?? "");
  if (msg.includes("does not exist") || msg.includes("relation") || msg.includes("no such table")) {
    console.error(`[Arena] Missing table or migration in production (${label}). Run POST /api/admin/arena/bootstrap`);
    return res.status(500).json({ message: "Arena not initialized in this environment. Ask admin to run bootstrap." });
  }
  console.error(`[Arena] ${label} error:`, err);
  res.status(500).json({ message: "Internal server error" });
}

export function registerArenaRoutes(app: Express): void {
  app.get("/api/arena/me", isAuthenticated, async (req: any, res) => {
    try {
      const userId: string = (req.user as any)?.claims?.sub || (req.user as any)?.id || req.session.userId;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const [profile, stats] = await Promise.all([
        getOrCreateArenaProfile(userId),
        getOrCreateArenaStats(userId),
      ]);

      res.json({ profile, stats, rankThresholds: RANK_THRESHOLDS });
    } catch (e) {
      handleArenaError("GET /api/arena/me", e, res);
    }
  });

  app.patch("/api/arena/me", isAuthenticated, async (req: any, res) => {
    try {
      const userId: string = (req.user as any)?.claims?.sub || (req.user as any)?.id || req.session.userId;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const schema = z.object({
        avatarUrl: z.string().url().optional().or(z.literal("")),
        avatarId: z.string().optional(),
        bio: z.string().max(280).optional(),
      });
      const { avatarUrl, avatarId, bio } = schema.parse(req.body);

      const setFields: Record<string, unknown> = { updatedAt: new Date() };
      if (avatarUrl !== undefined) setFields.avatarUrl = avatarUrl;
      if (avatarId !== undefined) setFields.avatarId = avatarId;
      if (bio !== undefined) setFields.bio = bio;

      await db.insert(arenaProfiles)
        .values({ userId, avatarUrl: avatarUrl ?? null, avatarId: avatarId ?? "avatar_01", bio: bio ?? null, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: arenaProfiles.userId,
          set: setFields,
        });

      const [updated] = await db.select().from(arenaProfiles).where(eq(arenaProfiles.userId, userId));
      res.json({ profile: updated });
    } catch (e) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: e.errors[0].message });
      console.error("[Arena] PATCH /api/arena/me error:", e);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/arena/user-badges", isAuthenticated, async (req: any, res) => {
    try {
      const userId: string = (req.user as any)?.claims?.sub || (req.user as any)?.id || req.session.userId;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const badges = await db
        .select({
          code: arenaBadges.code,
          name: arenaBadges.name,
          description: arenaBadges.description,
          iconKey: arenaBadges.iconKey,
          rarity: arenaBadges.rarity,
          awardedAt: userBadges.awardedAt,
          metaJson: userBadges.metaJson,
        })
        .from(userBadges)
        .innerJoin(arenaBadges, eq(userBadges.badgeCode, arenaBadges.code))
        .where(eq(userBadges.userId, userId))
        .orderBy(userBadges.awardedAt);

      res.json({ badges });
    } catch (e) {
      handleArenaError("GET /api/arena/user-badges", e, res);
    }
  });

  app.get("/api/arena/profile", isAuthenticated, async (req: any, res) => {
    try {
      const userId: string = (req.user as any)?.claims?.sub || (req.user as any)?.id || req.session.userId;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const [profile, stats] = await Promise.all([
        getOrCreateArenaProfile(userId),
        getOrCreateArenaStats(userId),
      ]);

      const allStats = await db
        .select({ userId: arenaUserStats.userId, xpTotal: arenaUserStats.xpTotal })
        .from(arenaUserStats)
        .orderBy(desc(arenaUserStats.xpTotal));

      const globalRankIdx = allStats.findIndex((s) => s.userId === userId);
      const globalRank = globalRankIdx >= 0 ? globalRankIdx + 1 : null;
      const totalUsers = allStats.length;

      const portfolio = await db
        .select({ balance: portfolios.balance })
        .from(portfolios)
        .where(eq(portfolios.userId, userId))
        .limit(1);

      const portfolioBalance = portfolio[0] ? parseFloat(portfolio[0].balance as string) : 0;

      const badges = await db
        .select({
          code: arenaBadges.code,
          name: arenaBadges.name,
          description: arenaBadges.description,
          iconKey: arenaBadges.iconKey,
          rarity: arenaBadges.rarity,
          awardedAt: userBadges.awardedAt,
        })
        .from(userBadges)
        .innerJoin(arenaBadges, eq(userBadges.badgeCode, arenaBadges.code))
        .where(eq(userBadges.userId, userId))
        .orderBy(userBadges.awardedAt);

      const traderStyle = stats.traderStyle || null;

      res.json({
        profile,
        stats,
        rankThresholds: RANK_THRESHOLDS,
        globalRank,
        totalUsers,
        portfolioBalance,
        badges,
        traderStyle,
      });
    } catch (e) {
      handleArenaError("GET /api/arena/profile", e, res);
    }
  });

  app.get("/api/arena/achievements/me", isAuthenticated, async (req: any, res) => {
    try {
      const userId: string =
        (req.user as any)?.claims?.sub ||
        (req.user as any)?.id ||
        req.session?.userId;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const [catalog, userUnlocked, stats, unlockCountsRows, totalUsersResult] = await Promise.all([
        getCatalog(),
        getUserAchievements(userId),
        getOrCreateArenaStats(userId),
        db.select({
          achievementCode: userAchievements.achievementCode,
          cnt: sqlExpr<number>`count(*)::int`,
        }).from(userAchievements).groupBy(userAchievements.achievementCode),
        db.select({ cnt: sqlExpr<number>`count(*)::int` }).from(arenaUserStats),
      ]);

      const unlockCountMap = new Map(unlockCountsRows.map((r) => [r.achievementCode, r.cnt]));
      const totalArenaUsers = Math.max(1, (totalUsersResult[0] as any)?.cnt ?? 1);

      const unlockedMap = new Map(userUnlocked.map((u) => [u.achievementCode, u]));

      // Compute distinct trade days for DAILY_TRADER_3 progress
      const distinctDaysResult = await db.execute(
        sqlExpr`SELECT COUNT(DISTINCT date_trunc('day', created_at AT TIME ZONE 'UTC'))::int AS cnt
                FROM arena_events
                WHERE user_id = ${userId}
                  AND type = 'TRADE_EXECUTED'
                  AND created_at >= NOW() - INTERVAL '30 days'`
      );
      const distinctTradeDays = parseInt((distinctDaysResult.rows[0] as any)?.cnt ?? "0");

      const statsSnapshot = {
        userId: stats.userId,
        xpTotal: stats.xpTotal ?? 0,
        rank: stats.rank ?? "Bronze",
        realizedProfitTotal: stats.realizedProfitTotal ?? "0",
        tradesTotal: stats.tradesTotal ?? 0,
        winTrades: stats.winTrades ?? 0,
        lossTrades: stats.lossTrades ?? 0,
        winStreakCurrent: (stats as any).winStreakCurrent ?? 0,
        winStreakBest: (stats as any).winStreakBest ?? 0,
        lossStreakCurrent: (stats as any).lossStreakCurrent ?? 0,
      };

      const items = catalog.map((item) => {
        const unlockedEntry = unlockedMap.get(item.code);
        const status = unlockedEntry ? "unlocked" : "locked";
        const progress = status === "locked"
          ? computeProgress(item.code, statsSnapshot, { distinctTradeDays })
          : null;
        const unlockedCount = unlockCountMap.get(item.code) ?? 0;
        const unlockPercentage = parseFloat(((unlockedCount / totalArenaUsers) * 100).toFixed(1));
        return {
          code: item.code,
          name: item.name,
          description: item.description,
          iconKey: item.iconKey,
          rarity: item.rarity,
          xpReward: item.xpReward,
          status,
          unlockedAt: unlockedEntry?.unlockedAt ?? null,
          progress,
          unlockPercentage,
          unlockedByCount: unlockedCount,
          totalUsers: totalArenaUsers,
        };
      });

      const unlockedCount = items.filter((i) => i.status === "unlocked").length;

      res.json({ total: catalog.length, unlockedCount, items });
    } catch (e) {
      handleArenaError("GET /api/arena/achievements/me", e, res);
    }
  });

  app.get("/api/arena/leaderboards", isAuthenticated, async (req: any, res) => {
    try {
      const VALID_METRICS = ["xp", "realizedProfit", "winRate"] as const;
      const metric = ((req.query.metric as string) ?? "xp").trim();

      if (!VALID_METRICS.includes(metric as any)) {
        return res.status(400).json({ message: "metric must be one of: xp, realizedProfit, winRate" });
      }

      const scope = ((req.query.scope as string) ?? "allTime").trim();
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 50));
      const minTrades = Math.max(0, parseInt(req.query.minTrades as string) || 20);
      const offset = (page - 1) * pageSize;

      if (scope === "season") {
        let seasonId = req.query.seasonId ? parseInt(req.query.seasonId as string) : null;
        if (!seasonId) {
          const active = await getActiveSeason();
          if (!active) return res.status(404).json({ message: "No active season" });
          seasonId = active.id;
        }

        const [season] = await db.select().from(arenaSeasons).where(eq(arenaSeasons.id, seasonId));
        if (!season) return res.status(404).json({ message: "Season not found" });

        const winRateFilter = metric === "winRate"
          ? gte(sqlExpr<number>`(${arenaUserSeasonStats.winTradesSeason} + ${arenaUserSeasonStats.lossTradesSeason})`, minTrades)
          : undefined;

        let orderCols: any[];
        if (metric === "xp") {
          orderCols = [desc(arenaUserSeasonStats.xpSeason)];
        } else if (metric === "realizedProfit") {
          orderCols = [desc(sqlExpr`cast(${arenaUserSeasonStats.realizedProfitSeason} as numeric)`)];
        } else {
          orderCols = [
            desc(sqlExpr`case when (${arenaUserSeasonStats.winTradesSeason} + ${arenaUserSeasonStats.lossTradesSeason}) > 0 then ${arenaUserSeasonStats.winTradesSeason}::float / (${arenaUserSeasonStats.winTradesSeason} + ${arenaUserSeasonStats.lossTradesSeason}) else 0 end`),
          ];
        }

        const baseQuery = db
          .select({
            userId: arenaUserSeasonStats.userId,
            rankSeason: arenaUserSeasonStats.rankSeason,
            xpSeason: arenaUserSeasonStats.xpSeason,
            realizedProfitSeason: arenaUserSeasonStats.realizedProfitSeason,
            tradesSeason: arenaUserSeasonStats.tradesSeason,
            winTradesSeason: arenaUserSeasonStats.winTradesSeason,
            lossTradesSeason: arenaUserSeasonStats.lossTradesSeason,
            avatarUrl: arenaProfiles.avatarUrl,
            displayName: users.displayName,
          })
          .from(arenaUserSeasonStats)
          .leftJoin(arenaProfiles, eq(arenaProfiles.userId, arenaUserSeasonStats.userId))
          .leftJoin(users, eq(users.id, arenaUserSeasonStats.userId));

        const countBase = db
          .select({ count: sqlExpr<number>`count(*)::int` })
          .from(arenaUserSeasonStats);

        const whereCondition = winRateFilter 
          ? and(eq(arenaUserSeasonStats.seasonId, seasonId), winRateFilter)
          : eq(arenaUserSeasonStats.seasonId, seasonId);

        const [rows, countResult] = await Promise.all([
          baseQuery.where(whereCondition).orderBy(...orderCols).limit(pageSize).offset(offset),
          countBase.where(whereCondition),
        ]);

        const total = (countResult[0] as any)?.count ?? 0;

        const items = rows.map((row: any, idx: number) => {
          const totalGames = row.winTradesSeason + row.lossTradesSeason;
          const winRate = totalGames > 0 ? ((row.winTradesSeason / totalGames) * 100).toFixed(1) : "0.0";
          const username = row.displayName || `Trader#${row.userId.slice(-4).toUpperCase()}`;
          return {
            rankPosition: offset + idx + 1,
            userId: row.userId,
            username,
            avatarUrl: row.avatarUrl ?? null,
            rank: row.rankSeason,
            xpTotal: row.xpSeason,
            realizedProfitTotal: row.realizedProfitSeason,
            winRate,
            tradesTotal: row.tradesSeason,
            winTrades: row.winTradesSeason,
            lossTrades: row.lossTradesSeason,
          };
        });

        return res.json({
          scope: "season",
          season: { id: season.id, name: season.name, status: season.status },
          metric,
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
          items,
        });
      }

      // allTime (default)
      const winRateFilter = metric === "winRate" ? gte(arenaUserStats.tradesTotal, minTrades) : undefined;

      const selectFields = {
        userId: arenaUserStats.userId,
        rank: arenaUserStats.rank,
        xpTotal: arenaUserStats.xpTotal,
        realizedProfitTotal: arenaUserStats.realizedProfitTotal,
        tradesTotal: arenaUserStats.tradesTotal,
        winTrades: arenaUserStats.winTrades,
        lossTrades: arenaUserStats.lossTrades,
        updatedAt: arenaUserStats.updatedAt,
        avatarUrl: arenaProfiles.avatarUrl,
        avatarId: arenaProfiles.avatarId,
        displayName: users.displayName,
      };

      let orderCols: any[];
      if (metric === "xp") {
        orderCols = [desc(arenaUserStats.xpTotal), desc(arenaUserStats.updatedAt)];
      } else if (metric === "realizedProfit") {
        orderCols = [
          desc(sqlExpr`cast(${arenaUserStats.realizedProfitTotal} as numeric)`),
          desc(arenaUserStats.updatedAt),
        ];
      } else {
        orderCols = [
          desc(arenaUserStats.winTrades),
          desc(sqlExpr`(${arenaUserStats.winTrades} + ${arenaUserStats.lossTrades})`),
          desc(arenaUserStats.updatedAt),
        ];
      }

      const rowsQuery = db
        .select(selectFields)
        .from(arenaUserStats)
        .leftJoin(arenaProfiles, eq(arenaProfiles.userId, arenaUserStats.userId))
        .leftJoin(users, eq(users.id, arenaUserStats.userId));

      const countQuery = db
        .select({ count: sqlExpr<number>`count(*)::int` })
        .from(arenaUserStats);

      const [rows, countResult] = await Promise.all([
        winRateFilter
          ? rowsQuery.where(winRateFilter).orderBy(...orderCols).limit(pageSize).offset(offset)
          : rowsQuery.orderBy(...orderCols).limit(pageSize).offset(offset),
        winRateFilter
          ? countQuery.where(winRateFilter)
          : countQuery,
      ]);

      const total = (countResult[0] as any)?.count ?? 0;

      const items = rows.map((row: any, idx: number) => {
        const totalGames = row.winTrades + row.lossTrades;
        const winRate = totalGames > 0 ? ((row.winTrades / totalGames) * 100).toFixed(1) : "0.0";
        const username = row.displayName || `Trader#${row.userId.slice(-4).toUpperCase()}`;
        return {
          rankPosition: offset + idx + 1,
          userId: row.userId,
          username,
          avatarUrl: row.avatarUrl ?? null,
          avatarId: row.avatarId ?? "avatar_01",
          rank: row.rank,
          xpTotal: row.xpTotal,
          realizedProfitTotal: row.realizedProfitTotal,
          winRate,
          tradesTotal: row.tradesTotal,
          winTrades: row.winTrades,
          lossTrades: row.lossTrades,
        };
      });

      res.json({
        scope: "allTime",
        season: null,
        metric,
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        items,
      });
    } catch (e) {
      handleArenaError("GET /api/arena/leaderboards", e, res);
    }
  });

  app.get("/api/arena/user-rank", isAuthenticated, async (req: any, res) => {
    try {
      const userId: string = (req.user as any)?.claims?.sub || (req.user as any)?.id || req.session?.userId;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const stats = await getOrCreateArenaStats(userId);
      const [profile] = await db.select({ displayName: users.displayName, avatarUrl: arenaProfiles.avatarUrl })
        .from(users)
        .leftJoin(arenaProfiles, eq(arenaProfiles.userId, users.id))
        .where(eq(users.id, userId));

      const posResult = await db.execute(
        sqlExpr`SELECT COUNT(*)::int + 1 AS position FROM arena_user_stats WHERE xp_total > ${stats.xpTotal}`
      );
      const rankPosition = parseInt((posResult.rows[0] as any)?.position ?? "1");
      const username = profile?.displayName || `Trader#${userId.slice(-4).toUpperCase()}`;

      res.json({
        userId,
        username,
        avatarUrl: profile?.avatarUrl ?? null,
        rankPosition,
        xp: stats.xpTotal,
        rankName: stats.rank,
      });
    } catch (e) {
      handleArenaError("GET /api/arena/user-rank", e, res);
    }
  });

  app.get("/api/arena/rival", isAuthenticated, async (req: any, res) => {
    try {
      const userId: string = (req.user as any)?.claims?.sub || (req.user as any)?.id || req.session?.userId;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const stats = await getOrCreateArenaStats(userId);
      const [profile] = await db.select({ displayName: users.displayName, avatarUrl: arenaProfiles.avatarUrl })
        .from(users)
        .leftJoin(arenaProfiles, eq(arenaProfiles.userId, users.id))
        .where(eq(users.id, userId));

      const posResult = await db.execute(
        sqlExpr`SELECT COUNT(*)::int + 1 AS position FROM arena_user_stats WHERE xp_total > ${stats.xpTotal}`
      );
      const rankPosition = parseInt((posResult.rows[0] as any)?.position ?? "1");
      const username = profile?.displayName || `Trader#${userId.slice(-4).toUpperCase()}`;

      if (rankPosition === 1) {
        return res.json({
          isUserLeader: true,
          currentUser: { userId, username, avatarUrl: profile?.avatarUrl ?? null, rankPosition, xp: stats.xpTotal, rankName: stats.rank },
          rival: null,
          xpDifference: 0,
        });
      }

      const rivalRows = await db.execute(
        sqlExpr`
          SELECT s.user_id, s.xp_total, s.rank,
                 u.display_name, p.avatar_url
          FROM arena_user_stats s
          LEFT JOIN users u ON u.id = s.user_id
          LEFT JOIN arena_profiles p ON p.user_id = s.user_id
          WHERE s.xp_total > ${stats.xpTotal}
          ORDER BY s.xp_total ASC
          LIMIT 1
        `
      );
      const rivalRow = rivalRows.rows[0] as any;
      if (!rivalRow) {
        return res.json({
          isUserLeader: true,
          currentUser: { userId, username, avatarUrl: profile?.avatarUrl ?? null, rankPosition, xp: stats.xpTotal, rankName: stats.rank },
          rival: null,
          xpDifference: 0,
        });
      }

      const rivalUsername = rivalRow.display_name || `Trader#${(rivalRow.user_id as string).slice(-4).toUpperCase()}`;
      const rivalPosResult = await db.execute(
        sqlExpr`SELECT COUNT(*)::int + 1 AS position FROM arena_user_stats WHERE xp_total > ${rivalRow.xp_total}`
      );
      const rivalPosition = parseInt((rivalPosResult.rows[0] as any)?.position ?? "1");

      res.json({
        isUserLeader: false,
        currentUser: { userId, username, avatarUrl: profile?.avatarUrl ?? null, rankPosition, xp: stats.xpTotal, rankName: stats.rank },
        rival: {
          userId: rivalRow.user_id,
          username: rivalUsername,
          avatarUrl: rivalRow.avatar_url ?? null,
          rankPosition: rivalPosition,
          xp: parseInt(rivalRow.xp_total),
          rankName: rivalRow.rank,
        },
        xpDifference: parseInt(rivalRow.xp_total) - stats.xpTotal,
      });
    } catch (e) {
      handleArenaError("GET /api/arena/rival", e, res);
    }
  });

  app.get("/api/arena/activity", isAuthenticated, async (req: any, res) => {
    try {
      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));

      const rows = await db.execute(
        sqlExpr`
          SELECT ae.id, ae.user_id, ae.type, ae.xp_delta, ae.meta_json, ae.created_at,
                 u.display_name, p.avatar_url
          FROM arena_events ae
          LEFT JOIN users u ON u.id = ae.user_id
          LEFT JOIN arena_profiles p ON p.user_id = ae.user_id
          WHERE ae.type IN ('ACHIEVEMENT_UNLOCKED', 'RANK_UP', 'PROFITABLE_TRADE', 'TRADE_EXECUTED')
          ORDER BY ae.created_at DESC
          LIMIT ${limit}
        `
      );

      const items = (rows.rows as any[])
        .filter((r) => {
          const type = r.type as string;
          if (type === "TRADE_EXECUTED") return false;
          if (type === "PROFITABLE_TRADE") {
            const meta = r.meta_json as any;
            return meta && parseFloat(meta.realizedPnl ?? "0") >= 10;
          }
          return true;
        })
        .map((r) => ({
          id: r.id,
          userId: r.user_id,
          username: r.display_name || `Trader#${(r.user_id as string).slice(-4).toUpperCase()}`,
          avatarUrl: r.avatar_url ?? null,
          activityType: r.type,
          metadata: r.meta_json ?? {},
          xpDelta: r.xp_delta,
          createdAt: r.created_at,
        }));

      res.json({ items });
    } catch (e) {
      handleArenaError("GET /api/arena/activity", e, res);
    }
  });

  app.get("/api/arena/seasons", isAuthenticated, async (_req, res) => {
    try {
      const [activeSeason, allSeasons] = await Promise.all([
        getActiveSeason(),
        db.select().from(arenaSeasons).orderBy(desc(arenaSeasons.startsAt)),
      ]);
      res.json({ activeSeason: activeSeason ?? null, seasons: allSeasons });
    } catch (e) {
      handleArenaError("GET /api/arena/seasons", e, res);
    }
  });

  app.get("/api/arena/seasons/me", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub || req.user?.id || req.session?.userId;

      let seasonId = req.query.seasonId ? parseInt(req.query.seasonId as string) : null;
      let season: typeof arenaSeasons.$inferSelect | null = null;

      if (seasonId) {
        const [s] = await db.select().from(arenaSeasons).where(eq(arenaSeasons.id, seasonId));
        season = s ?? null;
      } else {
        season = await getActiveSeason();
      }

      if (!season) {
        return res.status(404).json({ message: "No active season" });
      }

      const [stats] = await db
        .select()
        .from(arenaUserSeasonStats)
        .where(
          and(
            eq(arenaUserSeasonStats.seasonId, season.id),
            eq(arenaUserSeasonStats.userId, userId)
          )
        );

      const posResult = await db.execute(
        sqlExpr`SELECT COUNT(*)::int + 1 AS position FROM arena_user_season_stats WHERE season_id = ${season.id} AND realized_profit_season > ${stats?.realizedProfitSeason || "0"}`
      );
      const rankPosition = parseInt((posResult.rows[0] as any)?.position ?? "1");

      res.json({
        season: { id: season.id, name: season.name, status: season.status },
        stats: stats ?? null,
        rankPosition,
      });
    } catch (e) {
      handleArenaError("GET /api/arena/seasons/me", e, res);
    }
  });

  app.get("/api/arena/seasons/:seasonId/rewards", async (req, res) => {
    try {
      const seasonId = parseInt(req.params.seasonId);
      const rewards = await getSeasonRewards(seasonId);
      res.json({ rewards });
    } catch (e) {
      handleArenaError("GET /api/arena/seasons/:seasonId/rewards", e, res);
    }
  });

  app.get("/api/arena/challenges", async (_req, res) => {
    try {
      const challenges = await getActiveChallenges();
      res.json({ challenges });
    } catch (e) {
      handleArenaError("GET /api/arena/challenges", e, res);
    }
  });

  app.post("/api/arena/follow", isAuthenticated, async (req: any, res) => {
    try {
      const followerUserId = req.user?.claims?.sub || req.user?.id || req.session?.userId;
      if (!followerUserId) return res.status(401).json({ message: "Unauthorized" });
      const { followedUserId } = req.body;
      if (!followedUserId) return res.status(400).json({ message: "followedUserId required" });
      const result = await followUser(followerUserId, followedUserId);
      res.json(result);
    } catch (e: any) {
      res.status(400).json({ message: e.message || "Failed to follow user" });
    }
  });

  app.delete("/api/arena/follow", isAuthenticated, async (req: any, res) => {
    try {
      const followerUserId = req.user?.claims?.sub || req.user?.id || req.session?.userId;
      if (!followerUserId) return res.status(401).json({ message: "Unauthorized" });
      const { followedUserId } = req.body;
      if (!followedUserId) return res.status(400).json({ message: "followedUserId required" });
      await unfollowUser(followerUserId, followedUserId);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ message: e.message || "Failed to unfollow user" });
    }
  });

  app.get("/api/arena/following", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub || req.user?.id || req.session?.userId;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const following = await getFollowing(userId);
      res.json({ following });
    } catch (e) {
      handleArenaError("GET /api/arena/following", e, res);
    }
  });

  app.get("/api/arena/trader/:username", isAuthenticated, async (req: any, res) => {
    try {
      const myUserId = req.user?.claims?.sub || req.user?.id || req.session?.userId;
      const { username } = req.params;

      const [trader] = await db
        .select({
          id: users.id,
          displayName: users.displayName,
          firstName: users.firstName,
          avatarId: arenaProfiles.avatarId,
          avatarUrl: arenaProfiles.avatarUrl,
          bio: arenaProfiles.bio,
          rank: arenaUserStats.rank,
          xpTotal: arenaUserStats.xpTotal,
          traderStyle: arenaUserStats.traderStyle,
          realizedProfitTotal: arenaUserStats.realizedProfitTotal,
          tradesTotal: arenaUserStats.tradesTotal,
          winTrades: arenaUserStats.winTrades,
          lossTrades: arenaUserStats.lossTrades,
          winStreakBest: arenaUserStats.winStreakBest,
        })
        .from(users)
        .leftJoin(arenaProfiles, eq(arenaProfiles.userId, users.id))
        .leftJoin(arenaUserStats, eq(arenaUserStats.userId, users.id))
        .where(
          or(
            eq(users.displayName, username),
            eq(users.id, username) // Support ID lookup too
          )
        )
        .limit(1);

      if (!trader) return res.status(404).json({ message: "Trader not found" });

      const [following, counts] = await Promise.all([
        isFollowing(myUserId, trader.id),
        getFollowCounts(trader.id),
      ]);

      res.json({
        trader: {
          ...trader,
          username: trader.displayName || trader.firstName || `Trader#${trader.id.slice(0, 4)}`,
          following,
          followerCount: counts.followers,
          followingCount: counts.following,
        },
      });
    } catch (e) {
      handleArenaError("GET /api/arena/trader/:username", e, res);
    }
  });

  app.post("/api/arena/duel/challenge", isAuthenticated, async (req: any, res) => {
    try {
      const challengerUserId = req.user?.claims?.sub || req.user?.id || req.session?.userId;
      if (!challengerUserId) return res.status(401).json({ message: "Unauthorized" });
      const { opponentUserId, durationDays, metric } = req.body;
      if (!opponentUserId || !durationDays) return res.status(400).json({ message: "opponentUserId and durationDays are required" });
      const duel = await challengeDuel(challengerUserId, opponentUserId, Number(durationDays), metric);
      res.json({ duel });
    } catch (e: any) {
      console.error("POST /api/arena/duel/challenge error:", e);
      res.status(400).json({ message: e.message || "Internal server error" });
    }
  });

  app.post("/api/arena/duel/accept", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub || req.user?.id || req.session?.userId;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const { duelId } = req.body;
      if (!duelId) return res.status(400).json({ message: "duelId is required" });
      const duel = await acceptDuel(Number(duelId), userId);
      res.json({ duel });
    } catch (e: any) {
      console.error("POST /api/arena/duel/accept error:", e);
      res.status(400).json({ message: e.message || "Internal server error" });
    }
  });

  app.post("/api/arena/duel/reject", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub || req.user?.id || req.session?.userId;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const { duelId } = req.body;
      if (!duelId) return res.status(400).json({ message: "duelId is required" });
      const duel = await rejectDuel(Number(duelId), userId);
      res.json({ duel });
    } catch (e: any) {
      console.error("POST /api/arena/duel/reject error:", e);
      res.status(400).json({ message: e.message || "Internal server error" });
    }
  });

  app.get("/api/arena/duels", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub || req.user?.id || req.session?.userId;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const duels = await getUserDuels(userId);
      res.json({ ...duels, availableDurations: DUEL_DURATIONS });
    } catch (e: any) {
      console.error("GET /api/arena/duels error:", e);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ─── Draft API ───────────────────────────────────────────────────────────────
  app.use("/api/draft", isAuthenticated, draftRouter);
}

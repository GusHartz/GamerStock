import { db } from "../db";
import { achievementsCatalog, userAchievements, arenaUserStats, arenaEvents, arenaBadges, userBadges } from "@shared/schema";
import { eq, sql, inArray } from "drizzle-orm";
import { computeRank } from "@shared/arena-config";

export interface StatsSnapshot {
  userId: string;
  xpTotal: number;
  rank: string;
  realizedProfitTotal: string;
  tradesTotal: number;
  winTrades: number;
  lossTrades: number;
  winStreakCurrent: number;
  winStreakBest: number;
  lossStreakCurrent: number;
}

export interface ProcessContext {
  stats: StatsSnapshot;
  pnlPct?: number;
  isComeback?: boolean;
}

export interface ProgressInfo {
  current: number;
  target: number;
  label: string;
}

// ===== Achievement → Badge mapping =====
// Each achievement that deserves a visible profile badge
const ACHIEVEMENT_BADGE_MAP: Record<string, { code: string; name: string; description: string; iconKey: string; rarity: string }> = {
  FIRST_TRADE:    { code: "ACH_FIRST_TRADE",    name: "First Blood",    description: "Completed your first trade.",             iconKey: "sword",    rarity: "common"    },
  TEN_TRADES:     { code: "ACH_TEN_TRADES",      name: "Getting Started",description: "Completed 10 trades.",                    iconKey: "rocket",   rarity: "common"    },
  HUNDRED_TRADES: { code: "ACH_HUNDRED_TRADES",  name: "Grinder",        description: "Completed 100 trades.",                   iconKey: "fire",     rarity: "rare"      },
  FIRST_PROFIT:   { code: "ACH_FIRST_PROFIT",    name: "Green Candle",   description: "Won your first profitable trade.",         iconKey: "chart",    rarity: "common"    },
  BIG_WIN_20PCT:  { code: "ACH_BIG_WIN_20PCT",   name: "Big Win",        description: "Made a trade with 20%+ profit.",          iconKey: "trophy",   rarity: "rare"      },
  PROFIT_100:     { code: "ACH_PROFIT_100",       name: "First $100",     description: "Reached $100 in realized profit.",         iconKey: "money",    rarity: "common"    },
  PROFIT_1000:    { code: "ACH_PROFIT_1000",      name: "Four Digits",    description: "Reached $1,000 in realized profit.",       iconKey: "diamond",  rarity: "epic"      },
  THREE_WINS_ROW: { code: "ACH_THREE_WINS_ROW",  name: "Hot Streak",     description: "Won 3 trades in a row.",                   iconKey: "streak",   rarity: "rare"      },
  COMEBACK_KID:   { code: "ACH_COMEBACK_KID",    name: "Comeback Kid",   description: "Won a trade after 3 consecutive losses.",  iconKey: "comeback", rarity: "epic"      },
  DAILY_TRADER_3: { code: "ACH_DAILY_TRADER_3",  name: "3-Day Trader",   description: "Traded on 3 different days.",              iconKey: "calendar", rarity: "rare"      },
};

export async function seedAchievementBadges(): Promise<void> {
  try {
    for (const badge of Object.values(ACHIEVEMENT_BADGE_MAP)) {
      await db
        .insert(arenaBadges)
        .values({ code: badge.code, name: badge.name, description: badge.description, iconKey: badge.iconKey, rarity: badge.rarity })
        .onConflictDoNothing();
    }
  } catch (err) {
    console.error("[Achievements] Failed to seed achievement badges:", err);
  }
}

/** One-time backfill: award user_badges for any user_achievements that don't yet have a badge record */
export async function backfillAchievementBadges(): Promise<void> {
  try {
    await seedAchievementBadges();

    const achievementCodes = Object.keys(ACHIEVEMENT_BADGE_MAP);
    const rows = await db
      .select({ userId: userAchievements.userId, achievementCode: userAchievements.achievementCode, unlockedAt: userAchievements.unlockedAt })
      .from(userAchievements)
      .where(inArray(userAchievements.achievementCode, achievementCodes));

    // Get existing user_badges to avoid duplicates
    const badgeCodes = achievementCodes.map((c) => ACHIEVEMENT_BADGE_MAP[c].code);
    const existingBadges = await db
      .select({ userId: userBadges.userId, badgeCode: userBadges.badgeCode })
      .from(userBadges)
      .where(inArray(userBadges.badgeCode, badgeCodes));

    const existingSet = new Set(existingBadges.map((b) => `${b.userId}:${b.badgeCode}`));

    let inserted = 0;
    for (const row of rows) {
      const badge = ACHIEVEMENT_BADGE_MAP[row.achievementCode];
      if (!badge) continue;
      const key = `${row.userId}:${badge.code}`;
      if (existingSet.has(key)) continue;
      try {
        await db.insert(userBadges).values({ userId: row.userId, badgeCode: badge.code, awardedAt: row.unlockedAt, metaJson: { sourceType: "achievement", achievementCode: row.achievementCode } }).onConflictDoNothing();
        existingSet.add(key);
        inserted++;
      } catch {
        // skip duplicates silently
      }
    }
    if (inserted > 0) console.log(`[Achievements] Backfilled ${inserted} achievement badge(s).`);
  } catch (err) {
    console.error("[Achievements] Backfill error:", err);
  }
}

// ===== Catalog Seed Data =====
const CATALOG_SEED = [
  {
    code: "FIRST_TRADE",
    name: "First Blood",
    description: "Complete your first trade.",
    iconKey: "sword",
    rarity: "common",
    xpReward: 50,
    sortOrder: 10,
  },
  {
    code: "TEN_TRADES",
    name: "Getting Started",
    description: "Complete 10 trades.",
    iconKey: "rocket",
    rarity: "common",
    xpReward: 100,
    sortOrder: 20,
  },
  {
    code: "HUNDRED_TRADES",
    name: "Grinder",
    description: "Complete 100 trades.",
    iconKey: "fire",
    rarity: "rare",
    xpReward: 300,
    sortOrder: 30,
  },
  {
    code: "FIRST_PROFIT",
    name: "Green Candle",
    description: "Win your first profitable trade.",
    iconKey: "chart",
    rarity: "common",
    xpReward: 100,
    sortOrder: 40,
  },
  {
    code: "BIG_WIN_20PCT",
    name: "Big Win",
    description: "Make a trade with 20%+ profit.",
    iconKey: "trophy",
    rarity: "rare",
    xpReward: 250,
    sortOrder: 50,
  },
  {
    code: "PROFIT_100",
    name: "First $100",
    description: "Reach $100 in realized profit.",
    iconKey: "money",
    rarity: "common",
    xpReward: 150,
    sortOrder: 60,
  },
  {
    code: "PROFIT_1000",
    name: "Four Digits",
    description: "Reach $1,000 in realized profit.",
    iconKey: "diamond",
    rarity: "epic",
    xpReward: 500,
    sortOrder: 70,
  },
  {
    code: "THREE_WINS_ROW",
    name: "Hot Streak",
    description: "Win 3 trades in a row.",
    iconKey: "streak",
    rarity: "rare",
    xpReward: 250,
    sortOrder: 80,
  },
  {
    code: "COMEBACK_KID",
    name: "Comeback Kid",
    description: "Win a trade after 3 consecutive losses.",
    iconKey: "comeback",
    rarity: "epic",
    xpReward: 400,
    sortOrder: 90,
  },
  {
    code: "DAILY_TRADER_3",
    name: "3-Day Trader",
    description: "Trade on 3 different days.",
    iconKey: "calendar",
    rarity: "rare",
    xpReward: 300,
    sortOrder: 100,
  },
] as const;

export async function seedCatalog(): Promise<void> {
  try {
    const now = new Date();
    for (const item of CATALOG_SEED) {
      await db
        .insert(achievementsCatalog)
        .values({ ...item, createdAt: now, updatedAt: now })
        .onConflictDoNothing();
    }
    console.log("[Achievements] Catalog seeded.");
  } catch (err) {
    console.error("[Achievements] Failed to seed catalog:", err);
  }
}

export function computeProgress(
  code: string,
  stats: StatsSnapshot,
  extraCtx: { distinctTradeDays?: number } = {}
): ProgressInfo | null {
  const profit = parseFloat(stats.realizedProfitTotal ?? "0");
  switch (code) {
    case "FIRST_TRADE":
      return { current: Math.min(stats.tradesTotal, 1), target: 1, label: "Trades" };
    case "TEN_TRADES":
      return { current: Math.min(stats.tradesTotal, 10), target: 10, label: "Trades" };
    case "HUNDRED_TRADES":
      return { current: Math.min(stats.tradesTotal, 100), target: 100, label: "Trades" };
    case "FIRST_PROFIT":
      return { current: Math.min(stats.winTrades, 1), target: 1, label: "Winning Trades" };
    case "BIG_WIN_20PCT":
      return null;
    case "PROFIT_100":
      return { current: Math.max(0, Math.min(profit, 100)), target: 100, label: "Realized Profit ($)" };
    case "PROFIT_1000":
      return { current: Math.max(0, Math.min(profit, 1000)), target: 1000, label: "Realized Profit ($)" };
    case "THREE_WINS_ROW":
      return { current: Math.min(stats.winStreakBest, 3), target: 3, label: "Win Streak" };
    case "COMEBACK_KID":
      return null;
    case "DAILY_TRADER_3":
      return {
        current: Math.min(extraCtx.distinctTradeDays ?? 0, 3),
        target: 3,
        label: "Active Trading Days",
      };
    default:
      return null;
  }
}

function meetsUnlockCriteria(
  code: string,
  stats: StatsSnapshot,
  pnlPct: number | undefined,
  isComeback: boolean,
  distinctTradeDays: number
): boolean {
  const profit = parseFloat(stats.realizedProfitTotal ?? "0");
  switch (code) {
    case "FIRST_TRADE":
      return stats.tradesTotal >= 1;
    case "TEN_TRADES":
      return stats.tradesTotal >= 10;
    case "HUNDRED_TRADES":
      return stats.tradesTotal >= 100;
    case "FIRST_PROFIT":
      return stats.winTrades >= 1;
    case "BIG_WIN_20PCT":
      return pnlPct !== undefined && pnlPct >= 0.2;
    case "PROFIT_100":
      return profit >= 100;
    case "PROFIT_1000":
      return profit >= 1000;
    case "THREE_WINS_ROW":
      return stats.winStreakBest >= 3;
    case "COMEBACK_KID":
      return isComeback;
    case "DAILY_TRADER_3":
      return distinctTradeDays >= 3;
    default:
      return false;
  }
}

async function getDistinctTradeDays(userId: string): Promise<number> {
  try {
    const result = await db.execute(
      sql`SELECT COUNT(DISTINCT date_trunc('day', created_at AT TIME ZONE 'UTC'))::int AS cnt
          FROM arena_events
          WHERE user_id = ${userId}
            AND type = 'TRADE_EXECUTED'
            AND created_at >= NOW() - INTERVAL '30 days'`
    );
    return parseInt((result.rows[0] as any)?.cnt ?? "0");
  } catch {
    return 0;
  }
}

export async function processAchievements(userId: string, ctx: ProcessContext): Promise<void> {
  const { stats, pnlPct, isComeback = false } = ctx;

  const [catalog, unlocked, distinctTradeDays] = await Promise.all([
    db.select().from(achievementsCatalog).orderBy(achievementsCatalog.sortOrder),
    db
      .select({ code: userAchievements.achievementCode })
      .from(userAchievements)
      .where(eq(userAchievements.userId, userId)),
    getDistinctTradeDays(userId),
  ]);

  const unlockedSet = new Set(unlocked.map((u) => u.code));

  const newUnlocks: typeof catalog = [];
  for (const item of catalog) {
    if (unlockedSet.has(item.code)) continue;
    if (meetsUnlockCriteria(item.code, stats, pnlPct, isComeback, distinctTradeDays)) {
      newUnlocks.push(item);
    }
  }

  if (newUnlocks.length === 0) return;

  const now = new Date();
  for (const catalogItem of newUnlocks) {
    try {
      await db
        .insert(userAchievements)
        .values({
          userId,
          achievementCode: catalogItem.code,
          unlockedAt: now,
          metaJson: {
            triggeredBy: pnlPct !== undefined ? "SELL" : "TRADE",
            pnlPct: pnlPct ?? null,
            isComeback,
          },
          createdAt: now,
        })
        .onConflictDoNothing();

      console.log(`[Achievements] Unlocked ${catalogItem.code} for user ${userId} (+${catalogItem.xpReward} XP)`);

      // Award a corresponding badge in user_badges
      const badgeDef = ACHIEVEMENT_BADGE_MAP[catalogItem.code];
      if (badgeDef) {
        try {
          await db
            .insert(arenaBadges)
            .values({ code: badgeDef.code, name: badgeDef.name, description: badgeDef.description, iconKey: badgeDef.iconKey, rarity: badgeDef.rarity })
            .onConflictDoNothing();
          await db
            .insert(userBadges)
            .values({ userId, badgeCode: badgeDef.code, awardedAt: now, metaJson: { sourceType: "achievement", achievementCode: catalogItem.code } })
            .onConflictDoNothing();
        } catch (badgeErr) {
          console.warn(`[Achievements] Failed to award badge ${badgeDef.code} for ${userId}:`, badgeErr);
        }
      }

      if (catalogItem.xpReward > 0) {
        const [currentStats] = await db
          .select({ xpTotal: arenaUserStats.xpTotal })
          .from(arenaUserStats)
          .where(eq(arenaUserStats.userId, userId));
        if (currentStats) {
          const newXp = (currentStats.xpTotal ?? 0) + catalogItem.xpReward;
          const newRank = computeRank(newXp);
          await db
            .update(arenaUserStats)
            .set({ xpTotal: newXp, rank: newRank, updatedAt: new Date() })
            .where(eq(arenaUserStats.userId, userId));
          await db.insert(arenaEvents).values({
            userId,
            type: "ACHIEVEMENT_UNLOCKED",
            xpDelta: catalogItem.xpReward,
            metaJson: { achievementCode: catalogItem.code, achievementName: catalogItem.name },
            createdAt: now,
          });
        }
      }
    } catch (err) {
      console.warn(`[Achievements] Skipping duplicate unlock: ${catalogItem.code} for ${userId}`, err);
    }
  }
}

export async function getUserAchievements(userId: string) {
  return db
    .select()
    .from(userAchievements)
    .where(eq(userAchievements.userId, userId));
}

export async function getCatalog() {
  return db.select().from(achievementsCatalog).orderBy(achievementsCatalog.sortOrder);
}

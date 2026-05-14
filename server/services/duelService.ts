import { db } from "../db";
import {
  arenaDuels,
  arenaUserStats,
  arenaEvents,
  users,
  arenaProfiles,
  type ArenaDuel,
} from "../../shared/schema";
import { eq, and, or, desc, lte } from "drizzle-orm";
import { updateArenaOnTrade } from "../arena";

export const DUEL_DURATIONS = [3, 7, 14] as const;
export const DUEL_METRICS = ["highest_profit"] as const;

export interface DuelWithUsers extends ArenaDuel {
  challengerUsername: string;
  challengerAvatarId: string | null;
  challengerRank: string | null;
  opponentUsername: string;
  opponentAvatarId: string | null;
  opponentRank: string | null;
}

async function getUserDisplayName(userId: string): Promise<string> {
  const [u] = await db.select({ displayName: users.displayName, firstName: users.firstName }).from(users).where(eq(users.id, userId)).limit(1);
  return u?.displayName || u?.firstName || `Trader#${userId.slice(0, 4)}`;
}

async function enrichDuel(duel: ArenaDuel): Promise<DuelWithUsers> {
  const [cUser, oUser, cProfile, oProfile, cStats, oStats] = await Promise.all([
    db.select({ displayName: users.displayName, firstName: users.firstName }).from(users).where(eq(users.id, duel.challengerUserId)).limit(1),
    db.select({ displayName: users.displayName, firstName: users.firstName }).from(users).where(eq(users.id, duel.opponentUserId)).limit(1),
    db.select({ avatarId: arenaProfiles.avatarId }).from(arenaProfiles).where(eq(arenaProfiles.userId, duel.challengerUserId)).limit(1),
    db.select({ avatarId: arenaProfiles.avatarId }).from(arenaProfiles).where(eq(arenaProfiles.userId, duel.opponentUserId)).limit(1),
    db.select({ rank: arenaUserStats.rank }).from(arenaUserStats).where(eq(arenaUserStats.userId, duel.challengerUserId)).limit(1),
    db.select({ rank: arenaUserStats.rank }).from(arenaUserStats).where(eq(arenaUserStats.userId, duel.opponentUserId)).limit(1),
  ]);
  return {
    ...duel,
    challengerUsername: cUser[0]?.displayName || cUser[0]?.firstName || `Trader#${duel.challengerUserId.slice(0, 4)}`,
    challengerAvatarId: cProfile[0]?.avatarId ?? null,
    challengerRank: cStats[0]?.rank ?? null,
    opponentUsername: oUser[0]?.displayName || oUser[0]?.firstName || `Trader#${duel.opponentUserId.slice(0, 4)}`,
    opponentAvatarId: oProfile[0]?.avatarId ?? null,
    opponentRank: oStats[0]?.rank ?? null,
  };
}

export async function challengeDuel(
  challengerUserId: string,
  opponentUserId: string,
  durationDays: number,
  metric: string = "highest_profit"
): Promise<ArenaDuel> {
  if (challengerUserId === opponentUserId) {
    throw new Error("Cannot challenge yourself");
  }
  if (!DUEL_DURATIONS.includes(durationDays as any)) {
    throw new Error(`Invalid duration. Choose one of: ${DUEL_DURATIONS.join(", ")} days`);
  }

  // Guard: no duplicate pending challenges between same pair
  const existing = await db
    .select({ id: arenaDuels.id })
    .from(arenaDuels)
    .where(
      and(
        eq(arenaDuels.challengerUserId, challengerUserId),
        eq(arenaDuels.opponentUserId, opponentUserId),
        eq(arenaDuels.status, "pending")
      )
    )
    .limit(1);

  if (existing.length > 0) {
    throw new Error("A pending challenge already exists against this opponent");
  }

  const [duel] = await db
    .insert(arenaDuels)
    .values({
      challengerUserId,
      opponentUserId,
      metric,
      durationDays,
      status: "pending",
    })
    .returning();

  return duel;
}

export async function acceptDuel(duelId: number, opponentUserId: string): Promise<ArenaDuel> {
  const [duel] = await db.select().from(arenaDuels).where(eq(arenaDuels.id, duelId)).limit(1);
  if (!duel) throw new Error("Duel not found");
  if (duel.opponentUserId !== opponentUserId) throw new Error("You are not the opponent in this duel");
  if (duel.status !== "pending") throw new Error("Duel is not pending");

  // Capture starting stat snapshots for both parties
  const [cStats, oStats] = await Promise.all([
    db.select({ xpTotal: arenaUserStats.xpTotal, realizedProfitTotal: arenaUserStats.realizedProfitTotal, winTrades: arenaUserStats.winTrades, lossTrades: arenaUserStats.lossTrades }).from(arenaUserStats).where(eq(arenaUserStats.userId, duel.challengerUserId)).limit(1),
    db.select({ xpTotal: arenaUserStats.xpTotal, realizedProfitTotal: arenaUserStats.realizedProfitTotal, winTrades: arenaUserStats.winTrades, lossTrades: arenaUserStats.lossTrades }).from(arenaUserStats).where(eq(arenaUserStats.userId, duel.opponentUserId)).limit(1),
  ]);

  const now = new Date();
  const endDate = new Date(now.getTime() + duel.durationDays * 24 * 60 * 60 * 1000);

  const [updated] = await db
    .update(arenaDuels)
    .set({
      status: "active",
      startDate: now,
      endDate,
      challengerSnapshot: {
        xpTotal: cStats[0]?.xpTotal ?? 0,
        realizedProfitTotal: cStats[0]?.realizedProfitTotal ?? "0",
        winTrades: cStats[0]?.winTrades ?? 0,
        lossTrades: cStats[0]?.lossTrades ?? 0,
        snapshotAt: now.toISOString(),
      },
      opponentSnapshot: {
        xpTotal: oStats[0]?.xpTotal ?? 0,
        realizedProfitTotal: oStats[0]?.realizedProfitTotal ?? "0",
        winTrades: oStats[0]?.winTrades ?? 0,
        lossTrades: oStats[0]?.lossTrades ?? 0,
        snapshotAt: now.toISOString(),
      },
    })
    .where(eq(arenaDuels.id, duelId))
    .returning();

  return updated;
}

export async function rejectDuel(duelId: number, opponentUserId: string): Promise<ArenaDuel> {
  const [duel] = await db.select().from(arenaDuels).where(eq(arenaDuels.id, duelId)).limit(1);
  if (!duel) throw new Error("Duel not found");
  if (duel.opponentUserId !== opponentUserId) throw new Error("You are not the opponent in this duel");
  if (duel.status !== "pending") throw new Error("Duel is not in a pending state");

  const [updated] = await db
    .update(arenaDuels)
    .set({ status: "rejected" })
    .where(eq(arenaDuels.id, duelId))
    .returning();

  return updated;
}

export async function getUserDuels(userId: string): Promise<{
  active: DuelWithUsers[];
  pendingReceived: DuelWithUsers[];
  pendingSent: DuelWithUsers[];
  history: DuelWithUsers[];
}> {
  const all = await db
    .select()
    .from(arenaDuels)
    .where(
      or(
        eq(arenaDuels.challengerUserId, userId),
        eq(arenaDuels.opponentUserId, userId)
      )
    )
    .orderBy(desc(arenaDuels.createdAt));

  const enriched = await Promise.all(all.map(enrichDuel));

  return {
    active: enriched.filter((d) => d.status === "active"),
    pendingReceived: enriched.filter((d) => d.status === "pending" && d.opponentUserId === userId),
    pendingSent: enriched.filter((d) => d.status === "pending" && d.challengerUserId === userId),
    history: enriched.filter((d) => d.status === "completed" || d.status === "rejected" || d.status === "cancelled"),
  };
}

export async function resolveExpiredDuels(): Promise<void> {
  const now = new Date();

  // Find all active duels where endDate has passed
  const expiredDuels = await db
    .select()
    .from(arenaDuels)
    .where(
      and(
        eq(arenaDuels.status, "active"),
        lte(arenaDuels.endDate, now)
      )
    );

  for (const duel of expiredDuels) {
    try {
      await resolveDuel(duel);
    } catch (err) {
      console.error(`[DuelResolver] Failed to resolve duel ${duel.id}:`, err);
    }
  }
}

async function resolveDuel(duel: ArenaDuel): Promise<void> {
  // Get current stats for both users
  const [cStats, oStats] = await Promise.all([
    db.select({ xpTotal: arenaUserStats.xpTotal, realizedProfitTotal: arenaUserStats.realizedProfitTotal }).from(arenaUserStats).where(eq(arenaUserStats.userId, duel.challengerUserId)).limit(1),
    db.select({ xpTotal: arenaUserStats.xpTotal, realizedProfitTotal: arenaUserStats.realizedProfitTotal }).from(arenaUserStats).where(eq(arenaUserStats.userId, duel.opponentUserId)).limit(1),
  ]);

  const cSnap = duel.challengerSnapshot as Record<string, any> | null;
  const oSnap = duel.opponentSnapshot as Record<string, any> | null;

  // Calculate profit delta during duel window
  const cCurrentProfit = parseFloat(String(cStats[0]?.realizedProfitTotal ?? "0"));
  const oCurrentProfit = parseFloat(String(oStats[0]?.realizedProfitTotal ?? "0"));
  const cSnapProfit = parseFloat(String(cSnap?.realizedProfitTotal ?? "0"));
  const oSnapProfit = parseFloat(String(oSnap?.realizedProfitTotal ?? "0"));

  const cDeltaProfit = cCurrentProfit - cSnapProfit;
  const oDeltaProfit = oCurrentProfit - oSnapProfit;

  let winnerUserId: string | null = null;
  let loserUserId: string | null = null;
  let resultType: "winner" | "draw" = "draw";

  if (Math.abs(cDeltaProfit - oDeltaProfit) < 0.01) {
    // Tie
    resultType = "draw";
    winnerUserId = null;
    loserUserId = null;
  } else if (cDeltaProfit > oDeltaProfit) {
    winnerUserId = duel.challengerUserId;
    loserUserId = duel.opponentUserId;
    resultType = "winner";
  } else {
    winnerUserId = duel.opponentUserId;
    loserUserId = duel.challengerUserId;
    resultType = "winner";
  }

  const finalChallengerSnapshot = {
    ...(cSnap ?? {}),
    finalProfit: cDeltaProfit,
    finalXpGained: (cStats[0]?.xpTotal ?? 0) - (cSnap?.xpTotal ?? 0),
  };
  const finalOpponentSnapshot = {
    ...(oSnap ?? {}),
    finalProfit: oDeltaProfit,
    finalXpGained: (oStats[0]?.xpTotal ?? 0) - (oSnap?.xpTotal ?? 0),
  };

  await db
    .update(arenaDuels)
    .set({
      status: "completed",
      winnerUserId,
      resultType,
      resolvedAt: new Date(),
      challengerSnapshot: finalChallengerSnapshot,
      opponentSnapshot: finalOpponentSnapshot,
    })
    .where(eq(arenaDuels.id, duel.id));

  // Award XP — winner +200 XP, loser +50 XP (or 75 each for draw)
  if (winnerUserId && loserUserId) {
    const loserUsername = loserUserId === duel.challengerUserId
      ? await getUserDisplayName(duel.challengerUserId)
      : await getUserDisplayName(duel.opponentUserId);

    // Insert DUEL_WIN event for winner
    await db.insert(arenaEvents).values({
      userId: winnerUserId,
      type: "DUEL_WIN",
      xpDelta: 200,
      metaJson: {
        opponentUserId: loserUserId,
        opponentUsername: loserUsername,
        metric: duel.metric,
        winnerProfit: winnerUserId === duel.challengerUserId ? cDeltaProfit : oDeltaProfit,
        loserProfit: loserUserId === duel.challengerUserId ? cDeltaProfit : oDeltaProfit,
      },
    });

    // Update XP for winner (+200) using safe Drizzle sql helper
    const { sql: sqlExpr } = await import("drizzle-orm");
    await db
      .update(arenaUserStats)
      .set({ xpTotal: sqlExpr`${arenaUserStats.xpTotal} + 200` })
      .where(eq(arenaUserStats.userId, winnerUserId));

    await db
      .update(arenaUserStats)
      .set({ xpTotal: sqlExpr`${arenaUserStats.xpTotal} + 50` })
      .where(eq(arenaUserStats.userId, loserUserId));

  } else if (resultType === "draw") {
    const { sql: sqlExpr } = await import("drizzle-orm");
    // Draw: both get 75 XP
    await db
      .update(arenaUserStats)
      .set({ xpTotal: sqlExpr`${arenaUserStats.xpTotal} + 75` })
      .where(eq(arenaUserStats.userId, duel.challengerUserId));
    await db
      .update(arenaUserStats)
      .set({ xpTotal: sqlExpr`${arenaUserStats.xpTotal} + 75` })
      .where(eq(arenaUserStats.userId, duel.opponentUserId));
  }

  console.log(`[DuelResolver] Resolved duel #${duel.id}: ${resultType} — winner=${winnerUserId ?? "draw"} challenger_profit=${cDeltaProfit.toFixed(2)} opponent_profit=${oDeltaProfit.toFixed(2)}`);
}

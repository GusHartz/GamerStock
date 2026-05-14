import { db } from "../db";
import {
  arenaTraderFollows,
  arenaProfiles,
  arenaUserStats,
  users,
  type ArenaTraderFollow,
} from "../../shared/schema";
import { eq, and, desc } from "drizzle-orm";

export interface FollowingEntry {
  userId: string;
  username: string;
  avatarId: string | null;
  avatarUrl: string | null;
  rankName: string;
  traderStyle: string | null;
  followedAt: Date;
}

export async function followUser(followerUserId: string, followedUserId: string): Promise<{ ok: boolean; already: boolean }> {
  if (followerUserId === followedUserId) {
    throw new Error("Cannot follow yourself");
  }
  try {
    await db
      .insert(arenaTraderFollows)
      .values({ followerUserId, followedUserId })
      .onConflictDoNothing();
    return { ok: true, already: false };
  } catch {
    return { ok: true, already: true };
  }
}

export async function unfollowUser(followerUserId: string, followedUserId: string): Promise<void> {
  await db
    .delete(arenaTraderFollows)
    .where(
      and(
        eq(arenaTraderFollows.followerUserId, followerUserId),
        eq(arenaTraderFollows.followedUserId, followedUserId)
      )
    );
}

export async function isFollowing(followerUserId: string, followedUserId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: arenaTraderFollows.id })
    .from(arenaTraderFollows)
    .where(
      and(
        eq(arenaTraderFollows.followerUserId, followerUserId),
        eq(arenaTraderFollows.followedUserId, followedUserId)
      )
    )
    .limit(1);
  return !!row;
}

export async function getFollowing(followerUserId: string): Promise<FollowingEntry[]> {
  const rows = await db
    .select({
      userId: arenaTraderFollows.followedUserId,
      followedAt: arenaTraderFollows.createdAt,
      displayName: users.displayName,
      firstName: users.firstName,
      avatarId: arenaProfiles.avatarId,
      avatarUrl: arenaProfiles.avatarUrl,
      rank: arenaUserStats.rank,
      traderStyle: arenaUserStats.traderStyle,
    })
    .from(arenaTraderFollows)
    .innerJoin(users, eq(users.id, arenaTraderFollows.followedUserId))
    .leftJoin(arenaProfiles, eq(arenaProfiles.userId, arenaTraderFollows.followedUserId))
    .leftJoin(arenaUserStats, eq(arenaUserStats.userId, arenaTraderFollows.followedUserId))
    .where(eq(arenaTraderFollows.followerUserId, followerUserId))
    .orderBy(desc(arenaTraderFollows.createdAt));

  return rows.map((r) => ({
    userId: r.userId,
    username: r.displayName || r.firstName || `Trader#${r.userId.slice(0, 4)}`,
    avatarId: r.avatarId ?? null,
    avatarUrl: r.avatarUrl ?? null,
    rankName: r.rank ?? "Bronze",
    traderStyle: r.traderStyle ?? null,
    followedAt: r.followedAt,
  }));
}

export async function getFollowers(followedUserId: string): Promise<FollowingEntry[]> {
  const rows = await db
    .select({
      userId: arenaTraderFollows.followerUserId,
      followedAt: arenaTraderFollows.createdAt,
      displayName: users.displayName,
      firstName: users.firstName,
      avatarId: arenaProfiles.avatarId,
      avatarUrl: arenaProfiles.avatarUrl,
      rank: arenaUserStats.rank,
      traderStyle: arenaUserStats.traderStyle,
    })
    .from(arenaTraderFollows)
    .innerJoin(users, eq(users.id, arenaTraderFollows.followerUserId))
    .leftJoin(arenaProfiles, eq(arenaProfiles.userId, arenaTraderFollows.followerUserId))
    .leftJoin(arenaUserStats, eq(arenaUserStats.userId, arenaTraderFollows.followerUserId))
    .where(eq(arenaTraderFollows.followedUserId, followedUserId))
    .orderBy(desc(arenaTraderFollows.createdAt));

  return rows.map((r) => ({
    userId: r.userId,
    username: r.displayName || r.firstName || `Trader#${r.userId.slice(0, 4)}`,
    avatarId: r.avatarId ?? null,
    avatarUrl: r.avatarUrl ?? null,
    rankName: r.rank ?? "Bronze",
    traderStyle: r.traderStyle ?? null,
    followedAt: r.followedAt,
  }));
}

export async function getFollowCounts(userId: string): Promise<{ following: number; followers: number }> {
  const [followingRows, followerRows] = await Promise.all([
    db
      .select({ id: arenaTraderFollows.id })
      .from(arenaTraderFollows)
      .where(eq(arenaTraderFollows.followerUserId, userId)),
    db
      .select({ id: arenaTraderFollows.id })
      .from(arenaTraderFollows)
      .where(eq(arenaTraderFollows.followedUserId, userId)),
  ]);
  return { following: followingRows.length, followers: followerRows.length };
}

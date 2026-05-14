/**
 * Draft Scoring Engine
 *
 * Scores every pick in every draft entry for a given week by looking up
 * draft_player_week_metrics, computes per-entry totals, stores breakdowns,
 * and awards Arena XP.
 *
 * PLAYER ID NOTE
 * ──────────────
 * draft_entry_picks.player_id  = riotPlayers.id  (UUID varchar)
 * draft_player_week_metrics.player_id = riotAssets.puuid (Riot PUUID string)
 *
 * Because these two player systems are disjoint datasets, the majority of
 * picks will resolve to slot_score = 0 with reason "metrics_not_found"
 * until the draft and metrics pipelines are unified.  The scoring engine
 * handles this gracefully — it never crashes on a missing metric.
 *
 * SLOT → METRIC MAPPING
 * ──────────────────────
 *   top / jungle / mid / adc / support  → weekly_performance_score
 *   breakout_player                     → breakout_score
 *   rising_star                         → rising_star_score
 *   hidden_gem                          → hidden_gem_score
 *
 * XP FORMULA
 * ──────────
 *   max_possible_score = 800
 *   xp_reward = round(clamp(total_score / 800, 0, 1) * 300)
 *   max 300 XP per week
 */

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db";
import { arenaEvents, arenaUserSeasonStats, arenaUserStats } from "@shared/schema";
import { computeRank } from "@shared/arena-config";
import { getActiveSeason, ensureUserSeasonStats } from "../../services/seasonsService";
import {
  draftEntries,
  draftEntryPicks,
  draftPlayerWeekMetrics,
  draftUserSeasonStats,
  draftWeeks,
} from "./draft.schema";

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_POSSIBLE_SCORE = 800;
const MAX_WEEKLY_XP = 300;
const ROLE_SLOTS = new Set(["top", "jungle", "mid", "adc", "support"]);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScoringJobSummary {
  weekId: string;
  entriesProcessed: number;
  entriesSkipped: number;
  picksScored: number;
  durationMs: number;
}

interface PickBreakdown {
  metric_used: string;
  matches_count: number;
  weekly_perf: number;
  pvi_delta: number;
  undervaluation: number;
  slot_score: number;
  eligible?: boolean;
  reason?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function num(v: string | number | null | undefined, fallback = 0): number {
  if (v == null) return fallback;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return isNaN(n) ? fallback : n;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function metricForSlot(
  slot: string,
  m: {
    weeklyPerformanceScore: string | null;
    breakoutScore: string | null;
    risingStarScore: string | null;
    hiddenGemScore: string | null;
  },
): { metricUsed: string; rawScore: number } {
  if (ROLE_SLOTS.has(slot)) {
    return {
      metricUsed: "weekly_performance_score",
      rawScore: num(m.weeklyPerformanceScore),
    };
  }
  if (slot === "breakout_player") {
    return { metricUsed: "breakout_score", rawScore: num(m.breakoutScore) };
  }
  if (slot === "rising_star") {
    return { metricUsed: "rising_star_score", rawScore: num(m.risingStarScore) };
  }
  if (slot === "hidden_gem") {
    return { metricUsed: "hidden_gem_score", rawScore: num(m.hiddenGemScore) };
  }
  return { metricUsed: "unknown_slot", rawScore: 0 };
}

// ─── XP Award ─────────────────────────────────────────────────────────────────

async function awardDraftXp(userId: string, xpReward: number, weekId: string): Promise<void> {
  if (xpReward <= 0) return;

  try {
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

    const [stats] = await db
      .select({ xpTotal: arenaUserStats.xpTotal })
      .from(arenaUserStats)
      .where(eq(arenaUserStats.userId, userId));

    if (!stats) return;

    const newXp = (stats.xpTotal ?? 0) + xpReward;
    const newRank = computeRank(newXp);

    await db
      .update(arenaUserStats)
      .set({ xpTotal: newXp, rank: newRank, updatedAt: new Date() })
      .where(eq(arenaUserStats.userId, userId));

    await db.insert(arenaEvents).values({
      userId,
      type: "DRAFT_SCORED",
      xpDelta: xpReward,
      metaJson: { weekId, xpReward, source: "weekly_draft" },
    });

    const season = await getActiveSeason();
    if (season) {
      await ensureUserSeasonStats(season.id, userId);
      await db
        .update(arenaUserSeasonStats)
        .set({
          xpSeason: sql`${arenaUserSeasonStats.xpSeason} + ${xpReward}`,
          rankSeason: newRank,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(arenaUserSeasonStats.seasonId, season.id),
            eq(arenaUserSeasonStats.userId, userId),
          ),
        );
    }
  } catch (err) {
    console.error(`[DraftScoring] XP award failed for userId=${userId}:`, err);
  }
}

// ─── Draft Season Stats ───────────────────────────────────────────────────────

async function updateDraftSeasonStats(
  userId: string,
  totalScore: number,
  seasonId: string,
): Promise<void> {
  try {
    const [existing] = await db
      .select()
      .from(draftUserSeasonStats)
      .where(
        and(eq(draftUserSeasonStats.userId, userId), eq(draftUserSeasonStats.seasonId, seasonId)),
      )
      .limit(1);

    if (existing) {
      const prevTotal = num(existing.draftScoreTotal);
      const prevWeeks = existing.draftWeeksPlayed;
      const newTotal = prevTotal + totalScore;
      const newWeeks = prevWeeks + 1;
      await db
        .update(draftUserSeasonStats)
        .set({
          draftScoreTotal: newTotal.toFixed(4),
          draftWeeksPlayed: newWeeks,
          avgDraftScore: (newTotal / newWeeks).toFixed(4),
        })
        .where(eq(draftUserSeasonStats.id, existing.id));
    } else {
      await db.insert(draftUserSeasonStats).values({
        userId,
        seasonId,
        draftScoreTotal: totalScore.toFixed(4),
        draftWeeksPlayed: 1,
        avgDraftScore: totalScore.toFixed(4),
      });
    }
  } catch (err) {
    console.error(`[DraftScoring] Season stats update failed for userId=${userId}:`, err);
  }
}

// ─── Core Scoring ─────────────────────────────────────────────────────────────

export async function scoreDraftWeek(weekId: string): Promise<ScoringJobSummary> {
  const jobStart = Date.now();

  const [week] = await db.select().from(draftWeeks).where(eq(draftWeeks.id, weekId)).limit(1);
  if (!week) throw new Error(`Draft week not found: ${weekId}`);

  console.log(`[DraftScoring] Scoring week ${weekId} (status=${week.status})`);

  const entries = await db
    .select()
    .from(draftEntries)
    .where(eq(draftEntries.weekId, weekId));

  if (entries.length === 0) {
    console.log(`[DraftScoring] No entries found for week ${weekId}`);
    return { weekId, entriesProcessed: 0, entriesSkipped: 0, picksScored: 0, durationMs: Date.now() - jobStart };
  }

  const entryIds = entries.map((e) => e.id);
  const allPicks = await db
    .select()
    .from(draftEntryPicks)
    .where(inArray(draftEntryPicks.draftEntryId, entryIds));

  const metricsRows = await db
    .select()
    .from(draftPlayerWeekMetrics)
    .where(eq(draftPlayerWeekMetrics.weekId, weekId));

  const metricsByPlayerId = new Map(metricsRows.map((m) => [m.playerId, m]));

  const picksByEntryId = new Map<string, (typeof allPicks)[number][]>();
  for (const pick of allPicks) {
    if (!picksByEntryId.has(pick.draftEntryId)) picksByEntryId.set(pick.draftEntryId, []);
    picksByEntryId.get(pick.draftEntryId)!.push(pick);
  }

  const seasonId = weekId;
  let entriesProcessed = 0;
  let entriesSkipped = 0;
  let picksScored = 0;

  for (const entry of entries) {
    try {
      const picks = picksByEntryId.get(entry.id) ?? [];
      if (picks.length === 0) {
        entriesSkipped++;
        continue;
      }

      const wasAlreadyScored = entry.status === "scored";
      let roleScore = 0;
      let performanceScore = 0;

      for (const pick of picks) {
        const metrics = metricsByPlayerId.get(pick.playerId) ?? null;

        let breakdown: PickBreakdown;
        let slotScore = 0;

        if (!metrics) {
          breakdown = {
            metric_used: "none",
            matches_count: 0,
            weekly_perf: 0,
            pvi_delta: 0,
            undervaluation: 0,
            slot_score: 0,
            reason: "metrics_not_found",
          };
        } else if (!metrics.eligible) {
          breakdown = {
            metric_used: "none",
            matches_count: metrics.matchesCount,
            weekly_perf: num(metrics.weeklyPerformanceScore),
            pvi_delta: num(metrics.pviDelta),
            undervaluation: num(metrics.undervaluationLevel),
            slot_score: 0,
            eligible: false,
            reason: "ineligible",
          };
        } else {
          const { metricUsed, rawScore } = metricForSlot(pick.slotType, metrics);
          slotScore = rawScore;
          breakdown = {
            metric_used: metricUsed,
            matches_count: metrics.matchesCount,
            weekly_perf: num(metrics.weeklyPerformanceScore),
            pvi_delta: num(metrics.pviDelta),
            undervaluation: num(metrics.undervaluationLevel),
            slot_score: slotScore,
            eligible: true,
          };
        }

        await db
          .update(draftEntryPicks)
          .set({
            score: slotScore.toFixed(4),
            scoreBreakdownJson: breakdown,
          })
          .where(eq(draftEntryPicks.id, pick.id));

        if (ROLE_SLOTS.has(pick.slotType)) {
          roleScore += slotScore;
        } else {
          performanceScore += slotScore;
        }

        picksScored++;
      }

      const totalScore = roleScore + performanceScore;
      const xpReward = Math.round(clamp(totalScore / MAX_POSSIBLE_SCORE, 0, 1) * MAX_WEEKLY_XP);

      await db
        .update(draftEntries)
        .set({
          totalScore: totalScore.toFixed(4),
          roleScore: roleScore.toFixed(4),
          performanceScore: performanceScore.toFixed(4),
          status: "scored",
        })
        .where(eq(draftEntries.id, entry.id));

      if (!wasAlreadyScored) {
        await awardDraftXp(entry.userId, xpReward, weekId);
        await updateDraftSeasonStats(entry.userId, totalScore, seasonId);
      }

      console.log(
        `[DraftScoring] Entry ${entry.id} | userId=${entry.userId} | total=${totalScore.toFixed(2)} role=${roleScore.toFixed(2)} perf=${performanceScore.toFixed(2)} xp=+${xpReward}`,
      );

      entriesProcessed++;
    } catch (err) {
      console.error(`[DraftScoring] Failed to score entry ${entry.id}:`, err);
      entriesSkipped++;
    }
  }

  const durationMs = Date.now() - jobStart;
  console.log(
    `[DraftScoring] Complete — entries: ${entriesProcessed} scored, ${entriesSkipped} skipped, ${picksScored} picks | ${durationMs}ms`,
  );

  return { weekId, entriesProcessed, entriesSkipped, picksScored, durationMs };
}

// ─── Current-Week Convenience ─────────────────────────────────────────────────

export async function scoreCurrentDraftWeek(): Promise<ScoringJobSummary> {
  const [week] = await db
    .select()
    .from(draftWeeks)
    .where(inArray(draftWeeks.status, ["open", "locked", "scoring"]))
    .orderBy(desc(draftWeeks.startAt))
    .limit(1);

  if (!week) throw new Error("No active draft week found (status: open/locked/scoring)");
  return scoreDraftWeek(week.id);
}

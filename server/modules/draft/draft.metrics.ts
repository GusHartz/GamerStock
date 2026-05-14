/**
 * Weekly Metrics Aggregator — Draft Performance Data
 *
 * DATA SOURCE NOTES
 * ─────────────────
 * The GamerStock platform has two separate player datasets:
 *
 *   • riotAssets (puuid PK) — 300 players synced via the full Riot match
 *     pipeline. All match records in riot_match_cache are keyed by these
 *     puuids, and asset_valuation_state stores their PVI + Fair Value.
 *     These are the ONLY players with real performance data.
 *
 *   • riotPlayers (UUID varchar PK) — a separate snapshot of the NA1
 *     Challenger ladder with no overlap with riotAssets and no associated
 *     match data.
 *
 * Consequence: draft_player_week_metrics.player_id stores riotAssets.puuid
 * (not riotPlayers.id).  The future Draft Scoring Engine must bridge these
 * two systems when joining draft_entry_picks (player_id = riotPlayers.id)
 * with metrics (player_id = riotAssets.puuid).
 *
 * HISTORICAL SNAPSHOT ASSUMPTIONS
 * ─────────────────────────────────
 * • pvi_start / pvi_end:
 *     asset_valuation_state holds only the CURRENT PVI; there is no PVI
 *     history table.  We therefore store the current pvi_adjusted as both
 *     start and end, making pvi_delta = 0 for every run until a history
 *     table is introduced.
 *
 * • fair_value_start / fair_value_end:
 *     Same limitation — only the current fair_value_gs is available.
 *     Both start and end are set to the same current value.
 *
 * • market_price_start:
 *     riotAssets.price24hAgo is used as a rough proxy for the price at
 *     the beginning of the aggregation window.  For weeks longer than 24 h
 *     this will be inaccurate; a dedicated snapshot table would fix this.
 *     market_price_end = riotAssets.lastTradePrice (current).
 *
 * WEEK WINDOW
 * ───────────
 * Only matches with game_start_timestamp ∈ [startAt, endAt] of the draft
 * week count toward the weekly metrics.  The job is fully idempotent and
 * safe to re-run as the Riot sync adds new match rows.
 */

import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { assetValuationState, riotAssets, riotMatchCache } from "@shared/schema";
import { draftPlayerWeekMetrics, draftWeeks } from "./draft.schema";

const POSITION_TO_ROLE: Record<string, string> = {
  TOP: "top",
  JUNGLE: "jungle",
  MIDDLE: "mid",
  BOTTOM: "adc",
  UTILITY: "support",
};

const RECENCY_DECAY = 0.05;
const BASELINE_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
const ELIGIBLE_MIN_MATCHES = 3;
const NEUTRAL_PERF = 50;

function num(v: string | number | null | undefined, fallback = 0): number {
  if (v == null) return fallback;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return isNaN(n) ? fallback : n;
}

function fmt(n: number): string {
  return n.toFixed(4);
}

export interface MetricsJobSummary {
  weekId: string;
  processed: number;
  eligible: number;
  skipped: number;
  durationMs: number;
  assumptions: string[];
}

// ─── Core Computation ─────────────────────────────────────────────────────────

export async function computeDraftWeekMetrics(weekId: string): Promise<MetricsJobSummary> {
  const jobStart = Date.now();

  const [week] = await db.select().from(draftWeeks).where(eq(draftWeeks.id, weekId)).limit(1);
  if (!week) throw new Error(`Draft week not found: ${weekId}`);

  const weekStartMs = week.startAt.getTime();
  const weekEndMs = week.endAt.getTime();
  const baselineStartMs = weekStartMs - BASELINE_LOOKBACK_MS;

  console.log(
    `[DraftMetrics] Week ${weekId} | ${week.startAt.toISOString()} → ${week.endAt.toISOString()}`,
  );

  const assumptions: string[] = [
    "pvi_start = pvi_end (no PVI history table; pvi_delta = 0 until history is added)",
    "fair_value_start = fair_value_end (no FV history table; both use current fair_value_gs)",
    "market_price_start = riotAssets.price24hAgo (24 h proxy; inaccurate for multi-day windows)",
    "player_id = riotAssets.puuid (riotPlayers have no match data — see module header)",
    "historical_baseline falls back to career average when no 30-day pre-week matches exist",
  ];

  const allAssets = await db.select().from(riotAssets);

  const allMatchRows = await db
    .select()
    .from(riotMatchCache)
    .orderBy(desc(riotMatchCache.gameStartTimestamp));

  const matchesByPuuid = new Map<string, (typeof allMatchRows)[number][]>();
  for (const m of allMatchRows) {
    if (!matchesByPuuid.has(m.puuid)) matchesByPuuid.set(m.puuid, []);
    matchesByPuuid.get(m.puuid)!.push(m);
  }

  const allValuations = await db.select().from(assetValuationState);
  const valuationByPuuid = new Map(allValuations.map((v) => [v.puuid, v]));

  let processed = 0;
  let eligible = 0;
  let skipped = 0;

  for (const asset of allAssets) {
    try {
      const puuid = asset.puuid;
      const allPlayerMatches = matchesByPuuid.get(puuid) ?? [];

      const weekMatches = allPlayerMatches.filter((m) => {
        const ts = num(m.gameStartTimestamp);
        return ts >= weekStartMs && ts <= weekEndMs;
      });

      const baselineMatches = allPlayerMatches.filter((m) => {
        const ts = num(m.gameStartTimestamp);
        return ts >= baselineStartMs && ts < weekStartMs;
      });

      const matchesCount = weekMatches.length;

      const perfScores = weekMatches.map((m) => num(m.perfScore, NEUTRAL_PERF));

      const avgMatchScore =
        matchesCount > 0 ? perfScores.reduce((s, v) => s + v, 0) / matchesCount : 0;

      let weeklyPerformanceScore = 0;
      if (matchesCount > 0) {
        let totalWeight = 0;
        let weightedSum = 0;
        weekMatches.forEach((m, i) => {
          const w = 1 + RECENCY_DECAY * (matchesCount - 1 - i);
          weightedSum += num(m.perfScore, NEUTRAL_PERF) * w;
          totalWeight += w;
        });
        weeklyPerformanceScore = totalWeight > 0 ? weightedSum / totalWeight : 0;
      }

      let roleCode = "flex";
      if (matchesCount > 0) {
        const roleCounts: Record<string, number> = {};
        for (const m of weekMatches) {
          const r = POSITION_TO_ROLE[m.teamPosition?.toUpperCase() ?? ""] ?? "flex";
          roleCounts[r] = (roleCounts[r] ?? 0) + 1;
        }
        const sorted = Object.entries(roleCounts).sort((a, b) => b[1] - a[1]);
        roleCode = sorted[0]?.[0] ?? "flex";
      }

      const valuation = valuationByPuuid.get(puuid) ?? null;

      const pviEnd = valuation ? num(valuation.pviAdjusted, NEUTRAL_PERF) : NEUTRAL_PERF;
      const pviStart = pviEnd;
      const pviDelta = 0;

      const fairValueEnd = valuation ? num(valuation.fairValueGS, 5) : 5;
      const fairValueStart = fairValueEnd;

      const marketPriceEnd = num(asset.lastTradePrice, 0);
      const marketPriceStart = num(asset.price24hAgo, marketPriceEnd);

      const undervaluationLevel =
        fairValueEnd > 0 ? (fairValueEnd - marketPriceEnd) / fairValueEnd : 0;

      let historicalBaseline: number;
      if (baselineMatches.length > 0) {
        historicalBaseline =
          baselineMatches.reduce((s, m) => s + num(m.perfScore, NEUTRAL_PERF), 0) /
          baselineMatches.length;
      } else if (allPlayerMatches.length > 0) {
        historicalBaseline =
          allPlayerMatches.reduce((s, m) => s + num(m.perfScore, NEUTRAL_PERF), 0) /
          allPlayerMatches.length;
      } else {
        historicalBaseline = NEUTRAL_PERF;
      }

      const breakoutScore = weeklyPerformanceScore - historicalBaseline;
      const risingStarScore = pviDelta;
      const hiddenGemScore =
        weeklyPerformanceScore + Math.max(pviDelta, 0) + Math.max(undervaluationLevel, 0);

      const isEligible = matchesCount >= ELIGIBLE_MIN_MATCHES && roleCode !== "flex";

      const [existing] = await db
        .select({ id: draftPlayerWeekMetrics.id })
        .from(draftPlayerWeekMetrics)
        .where(
          and(
            eq(draftPlayerWeekMetrics.playerId, puuid),
            eq(draftPlayerWeekMetrics.weekId, weekId),
          ),
        )
        .limit(1);

      const payload = {
        playerId: puuid,
        weekId,
        roleCode,
        matchesCount,
        avgMatchScore: fmt(avgMatchScore),
        weeklyPerformanceScore: fmt(weeklyPerformanceScore),
        pviStart: fmt(pviStart),
        pviEnd: fmt(pviEnd),
        pviDelta: fmt(pviDelta),
        fairValueStart: fmt(fairValueStart),
        fairValueEnd: fmt(fairValueEnd),
        marketPriceStart: fmt(marketPriceStart),
        marketPriceEnd: fmt(marketPriceEnd),
        undervaluationLevel: fmt(undervaluationLevel),
        breakoutScore: fmt(breakoutScore),
        risingStarScore: fmt(risingStarScore),
        hiddenGemScore: fmt(hiddenGemScore),
        eligible: isEligible,
        computedAt: new Date(),
      };

      if (existing) {
        await db
          .update(draftPlayerWeekMetrics)
          .set(payload)
          .where(eq(draftPlayerWeekMetrics.id, existing.id));
      } else {
        await db.insert(draftPlayerWeekMetrics).values(payload);
      }

      processed++;
      if (isEligible) eligible++;
    } catch (err) {
      console.error(
        `[DraftMetrics] Error processing ${asset.puuid} (${asset.gameName}):`,
        err,
      );
      skipped++;
    }
  }

  const durationMs = Date.now() - jobStart;
  console.log(
    `[DraftMetrics] Complete — processed: ${processed}, eligible: ${eligible}, skipped: ${skipped}, duration: ${durationMs}ms`,
  );

  return { weekId, processed, eligible, skipped, durationMs, assumptions };
}

// ─── Current-Week Convenience ─────────────────────────────────────────────────

export async function computeCurrentDraftWeekMetrics(): Promise<MetricsJobSummary> {
  const [week] = await db
    .select()
    .from(draftWeeks)
    .where(inArray(draftWeeks.status, ["open", "locked", "scoring"]))
    .orderBy(desc(draftWeeks.startAt))
    .limit(1);

  if (!week) throw new Error("No active draft week found (status: open/locked/scoring)");
  return computeDraftWeekMetrics(week.id);
}

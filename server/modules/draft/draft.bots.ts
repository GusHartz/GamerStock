/**
 * Draft Bot System
 *
 * 9 AI bots participate in the Weekly Performance Draft using 3 strategy archetypes:
 *   - Quant    : highest raw weekly_performance_score per slot
 *   - Value    : undervalued players with strong performance
 *   - Momentum : breakout/rising trend focused
 *
 * PLAYER ID NOTE
 * ──────────────
 * Bots select players from draft_player_week_metrics (player_id = riotAssets.puuid).
 * Picks are written directly to draft_entry_picks using the puuid, bypassing the
 * normal service-layer validation that checks riotPlayers.id.  This means the
 * scoring engine CAN resolve bot picks to metrics (metricsByPlayerId.get(puuid)).
 *
 * When no eligible metrics exist, bots fall back to riotAssets sorted by
 * league_points, assigning roles by rank order (position = slot index).
 *
 * LOCK NOTE
 * ─────────
 * Bots bypass the lockAt deadline check — admin triggers the job manually, so
 * time-of-day restrictions don't apply.  Week status must still be "open".
 */

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db";
import { users } from "@shared/models/auth";
import { riotAssets } from "@shared/schema";
import {
  draftWeeks,
  draftEntries,
  draftEntryPicks,
  draftPlayerWeekMetrics,
} from "./draft.schema";
import type { DraftPlayerWeekMetrics } from "./draft.schema";
import { getCurrentWeek, getWeekById } from "./draft.service";
import { ROLE_SLOTS, PERFORMANCE_SLOTS, REQUIRED_SLOTS } from "./draft.validators";

// ─── Bot Definitions ──────────────────────────────────────────────────────────

type BotStrategy = "quant" | "value" | "momentum";

interface BotDef {
  displayName: string;
  email: string;
  strategy: BotStrategy;
  /** 0 = always top-ranked, higher = more variation within top N */
  bias: number;
}

export const BOT_DEFS: BotDef[] = [
  { displayName: "QuantBot_01", email: "quantbot01@gamerstock.bot", strategy: "quant",    bias: 0 },
  { displayName: "QuantBot_02", email: "quantbot02@gamerstock.bot", strategy: "quant",    bias: 1 },
  { displayName: "QuantBot_03", email: "quantbot03@gamerstock.bot", strategy: "quant",    bias: 2 },
  { displayName: "ValueBot_01", email: "valuebot01@gamerstock.bot", strategy: "value",    bias: 0 },
  { displayName: "ValueBot_02", email: "valuebot02@gamerstock.bot", strategy: "value",    bias: 1 },
  { displayName: "ValueBot_03", email: "valuebot03@gamerstock.bot", strategy: "value",    bias: 2 },
  { displayName: "MomentumBot_01", email: "momentumbot01@gamerstock.bot", strategy: "momentum", bias: 0 },
  { displayName: "MomentumBot_02", email: "momentumbot02@gamerstock.bot", strategy: "momentum", bias: 1 },
  { displayName: "MomentumBot_03", email: "momentumbot03@gamerstock.bot", strategy: "momentum", bias: 2 },
];

// ─── Role Code Normalization ───────────────────────────────────────────────────

const ROLE_CODE_TO_SLOT: Record<string, string> = {
  TOP:     "top",
  JUNGLE:  "jungle",
  MIDDLE:  "mid",
  MID:     "mid",
  BOTTOM:  "adc",
  ADC:     "adc",
  UTILITY: "support",
  SUPPORT: "support",
};

function normalizeRoleCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return ROLE_CODE_TO_SLOT[raw.toUpperCase().trim()] ?? null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function num(v: string | number | null | undefined, fallback = 0): number {
  if (v == null) return fallback;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return isNaN(n) ? fallback : n;
}

/**
 * Deterministic seeded pseudo-random for a given (weekId, botName, slot).
 * LCG — not crypto-quality but reproducible per run, stable per week.
 */
function seededRandom(seed: string): () => number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  }
  let s = h >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) | 0;
    return (s >>> 0) / 0xffffffff;
  };
}

/**
 * Pick from a ranked candidate list with weighted preference toward top-ranked.
 * bias=0: 85/15 split between rank-0 and rank-1
 * bias=1: 55/30/15 split across top-3
 * bias=2: 40/25/20/10/5 split across top-5
 */
function pickFromRanked<T>(candidates: T[], bias: number, rng: () => number): T {
  if (candidates.length === 0) throw new Error("No candidates available");
  const weightSets = [
    [0.85, 0.15],
    [0.55, 0.30, 0.15],
    [0.40, 0.25, 0.20, 0.10, 0.05],
  ];
  const weights = weightSets[bias] ?? weightSets[0];
  const topN = Math.min(candidates.length, weights.length);
  const pool = candidates.slice(0, topN);
  const w = weights.slice(0, topN);
  const total = w.reduce((a, b) => a + b, 0);
  const r = rng() * total;
  let acc = 0;
  for (let i = 0; i < pool.length; i++) {
    acc += w[i];
    if (r <= acc) return pool[i];
  }
  return pool[0];
}

// ─── Strategy Scoring ─────────────────────────────────────────────────────────

/**
 * Score a candidate for a specific slot given the bot's strategy.
 * Higher = more preferred.
 */
function candidateScore(
  m: DraftPlayerWeekMetrics,
  slot: string,
  strategy: BotStrategy,
): number {
  const wps = num(m.weeklyPerformanceScore);
  const uv  = num(m.undervaluationLevel);
  const bs  = num(m.breakoutScore);
  const rs  = num(m.risingStarScore);
  const hg  = num(m.hiddenGemScore);
  const uvMult = uv > 0 ? 1.3 : 0.85;

  if ((ROLE_SLOTS as readonly string[]).includes(slot)) {
    switch (strategy) {
      case "quant":    return wps;
      case "value":    return wps * uvMult;
      case "momentum": return bs > 0 ? bs * 0.55 + wps * 0.45 : wps;
    }
  }

  switch (slot) {
    case "breakout_player":
      if (strategy === "quant")    return bs;
      if (strategy === "value")    return bs * uvMult;
      if (strategy === "momentum") return bs;
      break;
    case "rising_star":
      if (strategy === "quant")    return rs;
      if (strategy === "value")    return rs * uvMult;
      if (strategy === "momentum") return rs;
      break;
    case "hidden_gem":
      if (strategy === "quant")    return hg;
      if (strategy === "value")    return hg * (uv > 0 ? 1.5 : 0.65);
      if (strategy === "momentum") return hg > 0 ? wps * 0.5 + hg * 0.5 : wps;
      break;
  }

  return wps;
}

// ─── Ensure Bot Users ─────────────────────────────────────────────────────────

export interface EnsureBotsResult {
  created: string[];
  existing: string[];
}

export async function ensureDraftBotsExist(): Promise<EnsureBotsResult> {
  const created: string[] = [];
  const existing: string[] = [];

  for (const bot of BOT_DEFS) {
    const [found] = await db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(eq(users.email, bot.email))
      .limit(1);

    if (found) {
      existing.push(bot.displayName);
      continue;
    }

    await db.insert(users).values({
      email: bot.email,
      displayName: bot.displayName,
      firstName: bot.displayName,
      lastName: null,
      role: "user",
      isBot: true,
      emailVerified: true,
      status: "active",
    });
    created.push(bot.displayName);
  }

  return { created, existing };
}

// ─── Bot Picking Core ─────────────────────────────────────────────────────────

interface BotPick {
  slotType: string;
  playerId: string;
  roleCode: string | null;
}

interface PlayerCandidate {
  playerId: string;
  displayName: string;
  roleSlot: string | null;
  metrics: DraftPlayerWeekMetrics | null;
  fallbackScore: number;
}

async function buildCandidatePool(weekId: string): Promise<PlayerCandidate[]> {
  // Primary: eligible metrics for this week
  const metricsRows = await db
    .select()
    .from(draftPlayerWeekMetrics)
    .where(
      and(
        eq(draftPlayerWeekMetrics.weekId, weekId),
        eq(draftPlayerWeekMetrics.eligible, true),
      ),
    );

  if (metricsRows.length >= 8) {
    return metricsRows.map((m) => ({
      playerId: m.playerId,
      displayName: m.playerId.slice(0, 12),
      roleSlot: normalizeRoleCode(m.roleCode),
      metrics: m,
      fallbackScore: num(m.weeklyPerformanceScore),
    }));
  }

  // Fallback: top 300 riotAssets by league_points
  const assets = await db
    .select()
    .from(riotAssets)
    .orderBy(desc(riotAssets.leaguePoints))
    .limit(300);

  // Assign role slots by round-robin position (index mod 5)
  const roles = ["top", "jungle", "mid", "adc", "support"];
  return assets.map((a, idx) => ({
    playerId: a.puuid,
    displayName: a.gameName ?? a.puuid.slice(0, 12),
    roleSlot: roles[idx % 5],
    metrics: null,
    fallbackScore: num(a.leaguePoints),
  }));
}

function generateBotPicks(
  candidates: PlayerCandidate[],
  strategy: BotStrategy,
  bias: number,
  seed: string,
): BotPick[] {
  const rng = seededRandom(seed);
  const picks: BotPick[] = [];
  const usedPlayerIds = new Set<string>();

  // Helper: pick best candidate for a slot from a filtered + scored list
  function pickForSlot(slot: string, pool: PlayerCandidate[]): BotPick | null {
    const available = pool.filter((c) => !usedPlayerIds.has(c.playerId));
    if (available.length === 0) return null;

    const scored = available
      .map((c) => ({
        candidate: c,
        score: c.metrics
          ? candidateScore(c.metrics, slot, strategy)
          : c.fallbackScore,
      }))
      .sort((a, b) => b.score - a.score);

    const chosen = pickFromRanked(scored, bias, rng);
    usedPlayerIds.add(chosen.candidate.playerId);

    return {
      slotType: slot,
      playerId: chosen.candidate.playerId,
      roleCode: (ROLE_SLOTS as readonly string[]).includes(slot) ? slot : null,
    };
  }

  // Fill role slots — filter candidates by matching roleSlot
  for (const slot of ROLE_SLOTS) {
    const roleFiltered = candidates.filter((c) => c.roleSlot === slot);
    // If fewer than 2 candidates for this role, expand to all candidates
    const pool = roleFiltered.length >= 2 ? roleFiltered : candidates;
    const pick = pickForSlot(slot, pool);
    if (pick) picks.push(pick);
  }

  // Fill performance slots — any remaining eligible candidate
  for (const slot of PERFORMANCE_SLOTS) {
    const pick = pickForSlot(slot, candidates);
    if (pick) picks.push(pick);
  }

  // Fill any missing slots with best available (dedup fallback)
  const filledSlots = new Set(picks.map((p) => p.slotType));
  for (const slot of REQUIRED_SLOTS) {
    if (filledSlots.has(slot)) continue;
    // Use any remaining candidates without duplication constraint
    const available = candidates.filter((c) => !usedPlayerIds.has(c.playerId));
    if (available.length === 0) {
      // All candidates exhausted — allow reuse as last resort
      const any = candidates[0];
      picks.push({
        slotType: slot,
        playerId: any.playerId,
        roleCode: (ROLE_SLOTS as readonly string[]).includes(slot) ? slot : null,
      });
    } else {
      const pick = pickForSlot(slot, available);
      if (pick) picks.push(pick);
    }
    filledSlots.add(slot);
  }

  return picks;
}

// ─── Per-Bot Entry Generation ─────────────────────────────────────────────────

interface BotEntryResult {
  displayName: string;
  strategy: BotStrategy;
  status: "created" | "updated" | "skipped" | "failed";
  reason?: string;
  picksCount?: number;
}

async function generateEntryForBot(
  bot: BotDef,
  weekId: string,
  candidates: PlayerCandidate[],
): Promise<BotEntryResult> {
  try {
    const [botUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, bot.email))
      .limit(1);

    if (!botUser) {
      return { displayName: bot.displayName, strategy: bot.strategy, status: "failed", reason: "Bot user not found — run ensure first" };
    }

    // Check for existing entry
    const [existing] = await db
      .select()
      .from(draftEntries)
      .where(and(eq(draftEntries.weekId, weekId), eq(draftEntries.userId, botUser.id)))
      .limit(1);

    if (existing?.status === "locked" || existing?.status === "scored") {
      return { displayName: bot.displayName, strategy: bot.strategy, status: "skipped", reason: `Entry already ${existing.status}` };
    }

    // Create or reuse entry
    let entryId: string;
    let entryAction: "created" | "updated";

    if (existing) {
      entryId = existing.id;
      entryAction = "updated";
      // Clear existing picks to re-pick cleanly
      await db.delete(draftEntryPicks).where(eq(draftEntryPicks.draftEntryId, entryId));
    } else {
      const [created] = await db
        .insert(draftEntries)
        .values({
          weekId,
          userId: botUser.id,
          status: "draft",
          totalScore: "0",
          roleScore: "0",
          performanceScore: "0",
        })
        .returning({ id: draftEntries.id });
      entryId = created.id;
      entryAction = "created";
    }

    // Generate picks
    const seed = `${weekId}:${bot.displayName}`;
    const picks = generateBotPicks(candidates, bot.strategy, bot.bias, seed);

    if (picks.length < REQUIRED_SLOTS.length) {
      return {
        displayName: bot.displayName,
        strategy: bot.strategy,
        status: "failed",
        reason: `Only generated ${picks.length}/${REQUIRED_SLOTS.length} picks (insufficient player pool)`,
      };
    }

    // Insert picks directly (bypasses riotPlayers validation — uses puuids)
    await db.insert(draftEntryPicks).values(
      picks.map((p) => ({
        draftEntryId: entryId,
        slotType: p.slotType,
        roleCode: p.roleCode,
        playerId: p.playerId,
        score: "0",
      })),
    );

    // Lock the entry (bypasses lockAt time check for bots)
    await db
      .update(draftEntries)
      .set({ status: "locked", lockedAt: new Date() })
      .where(eq(draftEntries.id, entryId));

    return {
      displayName: bot.displayName,
      strategy: bot.strategy,
      status: entryAction,
      picksCount: picks.length,
    };
  } catch (err: any) {
    return {
      displayName: bot.displayName,
      strategy: bot.strategy,
      status: "failed",
      reason: err?.message ?? String(err),
    };
  }
}

// ─── Job Summary ──────────────────────────────────────────────────────────────

export interface BotGenerationSummary {
  weekId: string;
  botsProcessed: number;
  entriesCreated: number;
  entriesUpdated: number;
  entriesSkipped: number;
  botsFailed: number;
  byStrategy: Record<BotStrategy, { created: number; updated: number; skipped: number; failed: number }>;
  details: BotEntryResult[];
  durationMs: number;
  candidatePoolSize: number;
  usingFallback: boolean;
}

// ─── Public Job Functions ─────────────────────────────────────────────────────

export async function generateBotDraftsForWeek(weekId: string): Promise<BotGenerationSummary> {
  const start = Date.now();

  const week = await getWeekById(weekId);
  if (!week) throw new Error(`Draft week not found: ${weekId}`);
  if (week.status !== "open") {
    throw new Error(`Draft week ${weekId} is not open (status=${week.status}). Bots can only participate in open weeks.`);
  }

  // Build candidate pool once — shared across all bots for consistency
  const candidates = await buildCandidatePool(weekId);

  const eligibleCount = await db
    .select({ cnt: sql<number>`COUNT(*)` })
    .from(draftPlayerWeekMetrics)
    .where(and(eq(draftPlayerWeekMetrics.weekId, weekId), eq(draftPlayerWeekMetrics.eligible, true)))
    .then((r) => Number(r[0]?.cnt ?? 0));

  const usingFallback = eligibleCount < 8;

  const details: BotEntryResult[] = [];

  for (const bot of BOT_DEFS) {
    const result = await generateEntryForBot(bot, weekId, candidates);
    details.push(result);

    const emoji = result.status === "failed" ? "✗" : result.status === "skipped" ? "~" : "✓";
    console.log(
      `[DraftBots] ${emoji} ${result.displayName} (${result.strategy}) — ${result.status}` +
      (result.picksCount != null ? ` (${result.picksCount} picks)` : "") +
      (result.reason ? ` — ${result.reason}` : ""),
    );
  }

  const byStrategy: Record<BotStrategy, { created: number; updated: number; skipped: number; failed: number }> = {
    quant:    { created: 0, updated: 0, skipped: 0, failed: 0 },
    value:    { created: 0, updated: 0, skipped: 0, failed: 0 },
    momentum: { created: 0, updated: 0, skipped: 0, failed: 0 },
  };

  let entriesCreated = 0, entriesUpdated = 0, entriesSkipped = 0, botsFailed = 0;

  for (const d of details) {
    const s = byStrategy[d.strategy];
    if (d.status === "created") { s.created++; entriesCreated++; }
    else if (d.status === "updated") { s.updated++; entriesUpdated++; }
    else if (d.status === "skipped") { s.skipped++; entriesSkipped++; }
    else { s.failed++; botsFailed++; }
  }

  return {
    weekId,
    botsProcessed: BOT_DEFS.length,
    entriesCreated,
    entriesUpdated,
    entriesSkipped,
    botsFailed,
    byStrategy,
    details,
    durationMs: Date.now() - start,
    candidatePoolSize: candidates.length,
    usingFallback,
  };
}

export async function generateBotDraftsForCurrentWeek(): Promise<BotGenerationSummary> {
  const week = await getCurrentWeek();
  if (!week) throw new Error("No active draft week found");
  return generateBotDraftsForWeek(week.id);
}

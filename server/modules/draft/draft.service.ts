import { and, desc, inArray, eq } from "drizzle-orm";
import { db } from "../../db";
import { riotPlayers, riotAssets } from "@shared/schema";
import { draftWeeks, draftEntries, draftEntryPicks, insertDraftWeekSchema } from "./draft.schema";
import type { DraftWeek, DraftEntry, DraftEntryPick, InsertDraftWeek } from "./draft.schema";
import { DraftValidationError, REQUIRED_SLOTS, ROLE_SLOTS, validatePicksPayload } from "./draft.validators";
import type { ValidSlotType } from "./draft.validators";

export type EntryWithPicks = DraftEntry & { picks: DraftEntryPick[] };

// ─── Week ─────────────────────────────────────────────────────────────────────

export async function getCurrentWeek(): Promise<DraftWeek | null> {
  const [openWeek] = await db
    .select()
    .from(draftWeeks)
    .where(eq(draftWeeks.status, "open"))
    .orderBy(desc(draftWeeks.startAt))
    .limit(1);
  if (openWeek) return openWeek;

  const [recent] = await db
    .select()
    .from(draftWeeks)
    .where(inArray(draftWeeks.status, ["locked", "scoring", "closed"]))
    .orderBy(desc(draftWeeks.startAt))
    .limit(1);

  return recent ?? null;
}

export async function getCurrentWeekOrThrow(): Promise<DraftWeek> {
  const week = await getCurrentWeek();
  if (!week) throw new DraftValidationError("NO_WEEK", "No draft week is currently available");
  return week;
}

export async function getAllWeeks(): Promise<DraftWeek[]> {
  return db.select().from(draftWeeks).orderBy(desc(draftWeeks.startAt));
}

export async function getWeekById(weekId: string): Promise<DraftWeek | null> {
  const [week] = await db.select().from(draftWeeks).where(eq(draftWeeks.id, weekId)).limit(1);
  return week ?? null;
}

export async function createWeek(data: InsertDraftWeek): Promise<DraftWeek> {
  const parsed = insertDraftWeekSchema.parse(data);
  const [created] = await db.insert(draftWeeks).values(parsed).returning();
  return created;
}

export async function updateWeek(weekId: string, data: Partial<InsertDraftWeek>): Promise<DraftWeek> {
  const allowed: Partial<InsertDraftWeek> = {};
  if (data.game !== undefined) allowed.game = data.game;
  if (data.region !== undefined) allowed.region = data.region;
  if (data.startAt !== undefined) allowed.startAt = data.startAt;
  if (data.lockAt !== undefined) allowed.lockAt = data.lockAt;
  if (data.endAt !== undefined) allowed.endAt = data.endAt;
  if (data.status !== undefined) allowed.status = data.status;

  if (Object.keys(allowed).length === 0) {
    const existing = await getWeekById(weekId);
    if (!existing) throw new DraftValidationError("NO_WEEK", `Draft week ${weekId} not found`);
    return existing;
  }

  const [updated] = await db.update(draftWeeks).set(allowed).where(eq(draftWeeks.id, weekId)).returning();
  if (!updated) throw new DraftValidationError("NO_WEEK", `Draft week ${weekId} not found`);
  return updated;
}

export async function setWeekStatus(
  weekId: string,
  status: "open" | "locked" | "scoring" | "closed",
): Promise<DraftWeek> {
  const [updated] = await db
    .update(draftWeeks)
    .set({ status })
    .where(eq(draftWeeks.id, weekId))
    .returning();
  if (!updated) throw new DraftValidationError("NO_WEEK", `Draft week ${weekId} not found`);
  return updated;
}

// ─── Entry ────────────────────────────────────────────────────────────────────

async function getPicksForEntry(entryId: string): Promise<DraftEntryPick[]> {
  return db.select().from(draftEntryPicks).where(eq(draftEntryPicks.draftEntryId, entryId));
}

export async function getEntry(userId: string): Promise<EntryWithPicks | null> {
  const week = await getCurrentWeek();
  if (!week) return null;

  const [entry] = await db
    .select()
    .from(draftEntries)
    .where(and(eq(draftEntries.weekId, week.id), eq(draftEntries.userId, userId)))
    .limit(1);

  if (!entry) return null;
  return { ...entry, picks: await getPicksForEntry(entry.id) };
}

export async function getOrCreateEntry(userId: string): Promise<EntryWithPicks> {
  const week = await getCurrentWeekOrThrow();

  if (week.status !== "open") {
    throw new DraftValidationError("WEEK_NOT_OPEN", "Draft entries can only be created when the week is open");
  }

  const [existing] = await db
    .select()
    .from(draftEntries)
    .where(and(eq(draftEntries.weekId, week.id), eq(draftEntries.userId, userId)))
    .limit(1);

  if (existing) {
    return { ...existing, picks: await getPicksForEntry(existing.id) };
  }

  const [created] = await db
    .insert(draftEntries)
    .values({
      weekId: week.id,
      userId,
      status: "draft",
      totalScore: "0",
      roleScore: "0",
      performanceScore: "0",
    })
    .returning();

  return { ...created, picks: [] };
}

export async function updateEntryPicks(
  userId: string,
  rawPicks: unknown,
): Promise<EntryWithPicks> {
  const picks = validatePicksPayload(rawPicks);

  const week = await getCurrentWeekOrThrow();
  if (week.status !== "open") {
    throw new DraftValidationError("WEEK_NOT_OPEN", "The draft week is not open for edits");
  }

  const [entry] = await db
    .select()
    .from(draftEntries)
    .where(and(eq(draftEntries.weekId, week.id), eq(draftEntries.userId, userId)))
    .limit(1);

  if (!entry) {
    throw new DraftValidationError("NO_ENTRY", "No draft entry found. Call POST /api/draft/entry first");
  }
  if (entry.status === "locked") {
    throw new DraftValidationError("ENTRY_LOCKED", "This entry is already locked and cannot be edited");
  }

  // Validate all player IDs exist
  const playerIds = picks.map((p) => p.playerId);
  const foundPlayers = await db.select({ id: riotPlayers.id }).from(riotPlayers).where(inArray(riotPlayers.id, playerIds));
  const foundIds = new Set(foundPlayers.map((p) => p.id));
  const missing = playerIds.filter((id) => !foundIds.has(id));
  if (missing.length > 0) {
    throw new DraftValidationError("INVALID_PLAYER", `Player IDs not found: ${missing.join(", ")}`);
  }

  // Upsert picks — partial update, preserve slots not included in request
  await db.transaction(async (tx) => {
    for (const pick of picks) {
      const [existing] = await tx
        .select({ id: draftEntryPicks.id })
        .from(draftEntryPicks)
        .where(and(eq(draftEntryPicks.draftEntryId, entry.id), eq(draftEntryPicks.slotType, pick.slotType)))
        .limit(1);

      if (existing) {
        await tx.update(draftEntryPicks).set({ playerId: pick.playerId }).where(eq(draftEntryPicks.id, existing.id));
      } else {
        await tx.insert(draftEntryPicks).values({
          draftEntryId: entry.id,
          slotType: pick.slotType as ValidSlotType,
          roleCode: (ROLE_SLOTS as readonly string[]).includes(pick.slotType) ? pick.slotType : null,
          playerId: pick.playerId,
          score: "0",
        });
      }
    }
  });

  return { ...entry, picks: await getPicksForEntry(entry.id) };
}

export async function lockEntry(userId: string): Promise<EntryWithPicks> {
  const week = await getCurrentWeekOrThrow();
  if (week.status !== "open") {
    throw new DraftValidationError("WEEK_NOT_OPEN", "The draft week is not open");
  }

  const now = new Date();
  if (now > week.lockAt) {
    throw new DraftValidationError("PAST_DEADLINE", "The lock deadline has already passed");
  }

  const [entry] = await db
    .select()
    .from(draftEntries)
    .where(and(eq(draftEntries.weekId, week.id), eq(draftEntries.userId, userId)))
    .limit(1);

  if (!entry) {
    throw new DraftValidationError("NO_ENTRY", "No draft entry found. Create one first");
  }
  if (entry.status === "locked") {
    throw new DraftValidationError("ALREADY_LOCKED", "Entry is already locked");
  }

  const picks = await getPicksForEntry(entry.id);

  const filledSlots = new Set(picks.map((p) => p.slotType));
  const missingSlots = REQUIRED_SLOTS.filter((s) => !filledSlots.has(s));
  if (missingSlots.length > 0) {
    throw new DraftValidationError(
      "INCOMPLETE_ENTRY",
      `Cannot lock: missing required slots: ${missingSlots.join(", ")}`,
    );
  }

  const [locked] = await db
    .update(draftEntries)
    .set({ status: "locked", lockedAt: now })
    .where(eq(draftEntries.id, entry.id))
    .returning();

  return { ...locked, picks };
}

// ─── Players ──────────────────────────────────────────────────────────────────

export async function getDraftPlayers(limit = 300) {
  const players = await db
    .select()
    .from(riotPlayers)
    .orderBy(desc(riotPlayers.leaguePoints))
    .limit(limit);

  // Best-effort enrichment: match riotAssets by gameName ≈ summonerName
  const assets = await db
    .select()
    .from(riotAssets)
    .orderBy(desc(riotAssets.leaguePoints))
    .limit(limit);

  const assetByName = new Map(assets.map((a) => [a.gameName?.toLowerCase().trim(), a]));

  return players.map((p) => {
    const asset = assetByName.get(p.summonerName.toLowerCase().trim()) ?? null;
    return {
      id: p.id,
      displayName: p.summonerName,
      playerTag: null,
      role: null,
      team: null,
      region: p.platform,
      imageUrl: null,
      recentPerformance: null,
      pvi: null,
      fairValue: null,
      marketPrice: asset ? parseFloat(String(asset.lastTradePrice)) : null,
      tier: p.tier,
      rank: p.rank,
      leaguePoints: p.leaguePoints,
      winrate: parseFloat(String(p.winrate)),
      isEligible: true,
    };
  });
}

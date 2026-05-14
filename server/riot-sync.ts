import { db } from "./db";
import { riotPlayers, riotAssets } from "@shared/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { getRiotApiKey } from "./app-config";

const RIOT_API_BASE = "https://na1.api.riotgames.com";
const RIOT_ACCOUNT_API_BASE = "https://americas.api.riotgames.com";
const PLATFORM = "NA1";
const QUEUE = "RANKED_SOLO_5x5";

async function fetchWithRetry(url: string, retries = 3): Promise<any> {
  const apiKey = await getRiotApiKey();
  if (!apiKey) throw new Error("RIOT_API_KEY_NOT_CONFIGURED");

  for (let attempt = 1; attempt <= retries; attempt++) {
    const res = await fetch(url, {
      headers: { "X-Riot-Token": apiKey },
    });

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get("Retry-After") || "5", 10);
      console.log(`[RIOT] Rate limited. Waiting ${retryAfter}s before retry ${attempt}/${retries}...`);
      await new Promise(r => setTimeout(r, retryAfter * 1000));
      continue;
    }

    if (res.status === 403 || res.status === 401) throw new Error(`RIOT_API_KEY_UNAUTHORIZED:${res.status}`);
    if (!res.ok) throw new Error(`Riot API error: ${res.status} ${res.statusText}`);

    return res.json();
  }

  throw new Error("RIOT_API_RATE_LIMIT");
}

function splitSummonerName(name: string): { gameName: string; tagLine: string } {
  const idx = name.indexOf("#");
  if (idx === -1) return { gameName: name, tagLine: "" };
  return { gameName: name.slice(0, idx), tagLine: name.slice(idx + 1) };
}

function computeInitialPrice(lp: number, wins: number, losses: number): string {
  const games = wins + losses;
  const wr = wins / Math.max(1, games);
  const lpNorm = Math.min(1, Math.max(0, lp / 2500));
  const wrNorm = Math.min(1, Math.max(-1, (wr - 0.5) / 0.2));
  const gamesFactor = Math.min(1, Math.max(0, Math.log10(games + 1) / 3));
  let base = 8 + lpNorm * 10 + wrNorm * 3 + gamesFactor * 2;
  base = Math.min(25, Math.max(6, base));
  return base.toFixed(2);
}

export type SyncResult = {
  inserted: number;
  updated: number;
  total: number;
};

export async function syncChallengerNA1(): Promise<SyncResult> {
  console.log("[RIOT] Sync NA1 Challenger started...");

  const url = `${RIOT_API_BASE}/lol/league/v4/challengerleagues/by-queue/${QUEUE}`;
  const data = await fetchWithRetry(url);

  const rawEntries: any[] = data.entries || [];
  console.log("[RIOT] Challenger entries:", rawEntries.length);

  if (rawEntries.length > 0) {
    console.log("[RIOT] Sample entry keys:", Object.keys(rawEntries[0]));
  }

  const validRaw = rawEntries.filter(e => {
    if (!e.puuid && !e.summonerId) {
      console.warn("[RIOT] Skipping entry with no identifier:", JSON.stringify(e));
      return false;
    }
    return true;
  });

  console.log(`[RIOT] Valid entries with identifier: ${validRaw.length}`);

  // --- Check existing riot_assets (primary source of truth for names) ---
  const existingAssets = await db
    .select({ puuid: riotAssets.puuid, gameName: riotAssets.gameName, tagLine: riotAssets.tagLine })
    .from(riotAssets);
  const knownAssets = new Map(existingAssets.map(r => [r.puuid, { gameName: r.gameName, tagLine: r.tagLine }]));

  // --- Fallback: check riot_players for any existing summonerId → name mapping ---
  const existingPlayers = await db
    .select({ summonerId: riotPlayers.summonerId, summonerName: riotPlayers.summonerName })
    .from(riotPlayers)
    .where(and(eq(riotPlayers.platform, PLATFORM), eq(riotPlayers.queue, QUEUE)));
  const knownPlayers = new Map(existingPlayers.map(r => [r.summonerId, r.summonerName]));

  console.log(`[RIOT] Players already in riot_assets: ${knownAssets.size}`);

  const needsNameLookup = validRaw.filter(e => {
    const puuid: string = e.puuid || e.summonerId;
    return !knownAssets.has(puuid) && !knownPlayers.has(puuid);
  });
  console.log(`[RIOT] New players needing name lookup: ${needsNameLookup.length}`);

  const resolvedNames = new Map<string, { gameName: string; tagLine: string }>();

  for (let i = 0; i < needsNameLookup.length; i++) {
    const e = needsNameLookup[i];
    const puuid: string = e.puuid || e.summonerId;

    try {
      const accountUrl = `${RIOT_ACCOUNT_API_BASE}/riot/account/v1/accounts/by-puuid/${encodeURIComponent(puuid)}`;
      const accountData = await fetchWithRetry(accountUrl);
      const gameName: string = accountData.gameName || puuid.slice(0, 16);
      const tagLine: string = accountData.tagLine || "";
      resolvedNames.set(puuid, { gameName, tagLine });
      console.log(`[RIOT] [${i + 1}/${needsNameLookup.length}] Resolved: ${gameName}${tagLine ? "#" + tagLine : ""}`);
    } catch (err: any) {
      console.warn(`[RIOT] Could not resolve name for puuid ${puuid.slice(0, 12)}...: ${err.message}`);
      resolvedNames.set(puuid, { gameName: puuid.slice(0, 16), tagLine: "" });
    }
    await new Promise(r => setTimeout(r, 1300));
  }

  // --- Build entries with full name data ---
  const entries: Array<{
    puuid: string;
    gameName: string;
    tagLine: string;
    summonerName: string;
    leaguePoints: number;
    wins: number;
    losses: number;
    winrate: string;
    rank: string;
    tier: string;
  }> = validRaw.map(e => {
    const puuid: string = e.puuid || e.summonerId;

    let gameName: string;
    let tagLine: string;

    if (knownAssets.has(puuid)) {
      const a = knownAssets.get(puuid)!;
      gameName = a.gameName;
      tagLine = a.tagLine;
    } else if (resolvedNames.has(puuid)) {
      const r = resolvedNames.get(puuid)!;
      gameName = r.gameName;
      tagLine = r.tagLine;
    } else if (knownPlayers.has(puuid)) {
      const split = splitSummonerName(knownPlayers.get(puuid)!);
      gameName = split.gameName;
      tagLine = split.tagLine;
    } else {
      gameName = puuid.slice(0, 16);
      tagLine = "";
    }

    const summonerName = tagLine ? `${gameName}#${tagLine}` : gameName;
    const wins = e.wins ?? 0;
    const losses = e.losses ?? 0;
    const total = wins + losses;
    const winrate = total > 0 ? ((wins / total) * 100).toFixed(2) : "0.00";

    return {
      puuid,
      gameName,
      tagLine,
      summonerName,
      leaguePoints: e.leaguePoints ?? 0,
      wins,
      losses,
      winrate,
      rank: e.rank || "I",
      tier: data.tier || "CHALLENGER",
    };
  });

  console.log(`[RIOT] Valid entries to upsert: ${entries.length}`);

  let inserted = 0;
  let updated = 0;

  for (const entry of entries) {
    const isNewAsset = !knownAssets.has(entry.puuid);
    const initialPrice = isNewAsset
      ? computeInitialPrice(entry.leaguePoints, entry.wins, entry.losses)
      : "0.00";

    // --- Upsert into riot_assets ---
    // For existing: only update fundamentals (preserve price fields)
    // For new: insert with computed initial price
    await db
      .insert(riotAssets)
      .values({
        puuid: entry.puuid,
        gameName: entry.gameName,
        tagLine: entry.tagLine,
        leaguePoints: entry.leaguePoints,
        wins: entry.wins,
        losses: entry.losses,
        winrate: entry.winrate,
        lastTradePrice: initialPrice,
        price24hAgo: initialPrice,
        volume24h: "0.00",
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: riotAssets.puuid,
        set: {
          gameName: sql`excluded.game_name`,
          tagLine: sql`excluded.tag_line`,
          leaguePoints: sql`excluded.league_points`,
          wins: sql`excluded.wins`,
          losses: sql`excluded.losses`,
          winrate: sql`excluded.winrate`,
          lastSyncedAt: new Date(),
          updatedAt: new Date(),
        },
      });

    // --- Upsert into riot_players (for leaderboard API backward compat) ---
    const existingPlayer = await db
      .select({ id: riotPlayers.id })
      .from(riotPlayers)
      .where(
        and(
          eq(riotPlayers.platform, PLATFORM),
          eq(riotPlayers.queue, QUEUE),
          eq(riotPlayers.summonerId, entry.puuid)
        )
      )
      .limit(1);

    if (existingPlayer.length > 0) {
      await db
        .update(riotPlayers)
        .set({
          summonerName: entry.summonerName,
          leaguePoints: entry.leaguePoints,
          wins: entry.wins,
          losses: entry.losses,
          winrate: entry.winrate,
          tier: entry.tier,
          rank: entry.rank,
          lastSyncedAt: new Date(),
        })
        .where(eq(riotPlayers.id, existingPlayer[0].id));
      updated++;
    } else {
      await db.insert(riotPlayers).values({
        platform: PLATFORM,
        queue: QUEUE,
        summonerId: entry.puuid,
        summonerName: entry.summonerName,
        leaguePoints: entry.leaguePoints,
        wins: entry.wins,
        losses: entry.losses,
        winrate: entry.winrate,
        tier: entry.tier,
        rank: entry.rank,
        lastSyncedAt: new Date(),
      });
      inserted++;
    }

    if (isNewAsset) inserted;
    if (!isNewAsset) updated;
  }

  const result: SyncResult = { inserted, updated, total: entries.length };
  console.log(`[RIOT] Sync complete inserted=${inserted} updated=${updated} total=${entries.length}`);
  return result;
}

export async function getRiotPlayers(search?: string): Promise<typeof riotPlayers.$inferSelect[]> {
  if (search) {
    return db
      .select()
      .from(riotPlayers)
      .where(sql`lower(${riotPlayers.summonerName}) like lower(${"%" + search + "%"})`)
      .orderBy(sql`${riotPlayers.leaguePoints} DESC`);
  }
  return db.select().from(riotPlayers).orderBy(sql`${riotPlayers.leaguePoints} DESC`);
}

export async function getRiotPlayerCount(): Promise<number> {
  const [result] = await db.select({ count: sql<number>`count(*)` }).from(riotPlayers);
  return Number(result.count);
}

export async function getRiotAssetCount(): Promise<number> {
  const [result] = await db.select({ count: sql<number>`count(*)` }).from(riotAssets);
  return Number(result.count);
}

let schedulerStarted = false;

export function startRiotSyncScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  const INTERVAL_MS = 24 * 60 * 60 * 1000;

  const runSync = async () => {
    try {
      const count = await getRiotAssetCount();
      if (count === 0) {
        console.log("[RIOT] No riot_assets yet — skipping scheduled sync (trigger manually via admin to seed)");
      } else {
        await syncChallengerNA1();
      }
    } catch (err: any) {
      console.error("[RIOT] Scheduled sync failed:", err.message);
    }
    setTimeout(runSync, INTERVAL_MS);
  };

  setTimeout(runSync, INTERVAL_MS);
  console.log("[RIOT] 24h sync scheduler registered.");
}

import Parser from "rss-parser";

// ─── Base Types ───────────────────────────────────────────────────────────────
export interface NewsItem {
  id: string;
  title: string;
  summary: string | null;
  source: string;
  sourceUrl: string;
  game: string | null;
  category: string | null;
  publishedAt: string;
}

export type Sentiment = "bullish" | "neutral" | "bearish";
export type ImpactLevel = "low" | "medium" | "high";
export type EventType =
  | "roster_change"
  | "qualification"
  | "elimination"
  | "patch_meta"
  | "contract"
  | "tournament_result"
  | "generic_news"
  | "unknown";

export interface EntityTags {
  players: string[];
  teams: string[];
  tournaments: string[];
}

export interface ClassifiedNewsItem extends NewsItem {
  sentiment: Sentiment;
  impactLevel: ImpactLevel;
  eventType: EventType;
  entityTags: EntityTags;
}

export interface NewsPulse {
  newsId: string;
  direction: Sentiment;
  strength: number;
  reason: string;
  decayUntil: string;
  game: string | null;
  eventType: EventType;
  createdAt: string;
}

// ─── RSS Source Definitions ───────────────────────────────────────────────────
interface RssSource {
  name: string;
  url: string;
  game: string | null;
  category: string;
}

const RSS_SOURCES: RssSource[] = [
  {
    name: "Dot Esports",
    url: "https://dotesports.com/feed",
    game: null,
    category: "general",
  },
  {
    name: "HLTV",
    url: "https://www.hltv.org/rss/news",
    game: "cs2",
    category: "tournament",
  },
  {
    name: "Esports.gg",
    url: "https://esports.gg/feed/",
    game: null,
    category: "general",
  },
];

// ─── Game Detection ───────────────────────────────────────────────────────────
const GAME_KEYWORDS: { keywords: string[]; game: string }[] = [
  { keywords: ["league of legends", " lol ", "lck", "lcs", "lec", "msi", "worlds", "faker", "t1 ", "gen.g", "rift herald", "summoner"], game: "lol" },
  { keywords: ["valorant", "vct", "sentinels", "loud", "nrg esports"], game: "val" },
  { keywords: ["cs2", "csgo", "counter-strike", "hltv", "navi", "faze clan", "natus vincere", "astralis", "vitality"], game: "cs2" },
  { keywords: ["dota", "the international", "team secret", " og "], game: "dota2" },
  { keywords: ["fortnite", "fncs"], game: "fortnite" },
  { keywords: ["overwatch", "owl", "overwatch league"], game: "ow2" },
  { keywords: ["call of duty", "cdl", "warzone"], game: "cod" },
  { keywords: ["rocket league", "rlcs"], game: "rl" },
];

function detectGame(title: string, source: RssSource): string | null {
  if (source.game) return source.game;
  const lower = ` ${title.toLowerCase()} `;
  for (const { keywords, game } of GAME_KEYWORDS) {
    if (keywords.some((kw) => lower.includes(kw))) return game;
  }
  return null;
}

// ─── Classification Engine ────────────────────────────────────────────────────

const EVENT_TYPE_RULES: { keywords: string[]; type: EventType }[] = [
  { keywords: ["patch", "update", "meta", "rework", "buff", "nerf", "hotfix", "12.", "13.", "14."], type: "patch_meta" },
  { keywords: ["contract", "extends contract", "renew", "extension", "signed a new"], type: "contract" },
  { keywords: ["sign", "joins", "transfer", "acquire", "benched", "bench", "swap", "replace", "part ways", "departure", "leave", "drop from", "kicked"], type: "roster_change" },
  { keywords: ["qualify", "qualif", "advance to", "progress to", "book their spot", "secure their place", "make it to"], type: "qualification" },
  { keywords: ["eliminat", "knocked out", "out of", "exits", "drops out", "fails to", "unable to qualify", "relegated"], type: "elimination" },
  { keywords: ["wins", "win the", "champion", "victory", "title", "trophy", "first place", "takes home", "claim the", "sweep", "grand final"], type: "tournament_result" },
];

function inferEventType(title: string): EventType {
  const lower = title.toLowerCase();
  for (const rule of EVENT_TYPE_RULES) {
    if (rule.keywords.some((kw) => lower.includes(kw))) return rule.type;
  }
  return "generic_news";
}

const BULLISH_KEYWORDS = [
  "wins", "win the", "qualif", "advance", "champion", "victory", "title",
  "sign", "extends contract", "renew", "top", "first place", "comeback",
  "record", "dominant", "flawless", "undefeated", "retain", "secure",
  "claim", "takes home", "sweep", "best-of-five", "landmark", "breakthrough",
];

const BEARISH_KEYWORDS = [
  "eliminat", "benched", "suspend", "loses", "loss", "knocked out",
  "out of", "fail", "drop", "last place", "disband", "part ways",
  "departure", "replace", "kicked", "relegated", "unable to", "exits",
  "drops out", "penalty", "banned", "suspension",
];

function inferSentiment(title: string, eventType: EventType): Sentiment {
  const lower = title.toLowerCase();
  let bullishScore = BULLISH_KEYWORDS.filter((kw) => lower.includes(kw)).length;
  let bearishScore = BEARISH_KEYWORDS.filter((kw) => lower.includes(kw)).length;

  // Apply event type bias
  if (eventType === "tournament_result" || eventType === "qualification") bullishScore += 1;
  if (eventType === "elimination") bearishScore += 2;
  if (eventType === "roster_change") bearishScore += 0.5;
  if (eventType === "contract") bullishScore += 0.5;

  if (bullishScore > bearishScore) return "bullish";
  if (bearishScore > bullishScore) return "bearish";
  return "neutral";
}

const IMPACT_BY_EVENT: Record<EventType, ImpactLevel> = {
  tournament_result: "high",
  qualification: "high",
  elimination: "high",
  roster_change: "medium",
  contract: "medium",
  patch_meta: "low",
  generic_news: "low",
  unknown: "low",
};

function inferImpactLevel(eventType: EventType, sentiment: Sentiment): ImpactLevel {
  const base = IMPACT_BY_EVENT[eventType];
  if (base === "low" && sentiment !== "neutral") return "low";
  return base;
}

// ─── Entity Extraction V1 ─────────────────────────────────────────────────────

const KNOWN_TEAMS = [
  "T1", "Gen.G", "FaZe", "NaVi", "Natus Vincere", "Astralis", "Vitality",
  "LOUD", "Sentinels", "NRG", "G2", "Team Liquid", "Cloud9", "100 Thieves",
  "Team Spirits", "Evil Geniuses", "TSM", "Fnatic", "SK Gaming",
  "Virtus.pro", "FURIA", "FUT", "Team Secret", "OG", "Team Spirit",
];

const KNOWN_TOURNAMENTS = [
  "MSI", "Worlds", "LCS", "LCK", "LEC", "VCT", "IEM", "Major", "RLCS",
  "FNCS", "CDL", "EPL", "The International", "Katowice", "Cologne",
  "Summer Split", "Spring Split", "Winter Split", "Grand Final", "Playoffs",
];

function extractEntities(title: string): EntityTags {
  const teams: string[] = [];
  const tournaments: string[] = [];
  const lower = title.toLowerCase();

  for (const team of KNOWN_TEAMS) {
    if (lower.includes(team.toLowerCase())) teams.push(team);
  }
  for (const tournament of KNOWN_TOURNAMENTS) {
    if (lower.includes(tournament.toLowerCase())) tournaments.push(tournament);
  }

  return { players: [], teams, tournaments };
}

// ─── News Pulse ───────────────────────────────────────────────────────────────

const PULSE_DECAY_HOURS: Record<ImpactLevel, number> = {
  high: 48,
  medium: 24,
  low: 12,
};

const PULSE_STRENGTH: Record<ImpactLevel, number> = {
  high: 0.65,
  medium: 0.35,
  low: 0.15,
};

function createNewsPulse(item: ClassifiedNewsItem): NewsPulse | null {
  if (item.sentiment === "neutral" && item.impactLevel === "low") return null;

  const decayHours = PULSE_DECAY_HOURS[item.impactLevel];
  const strength = PULSE_STRENGTH[item.impactLevel];
  const decayUntil = new Date(Date.now() + decayHours * 60 * 60 * 1000).toISOString();

  const reasonParts: string[] = [];
  if (item.eventType !== "generic_news" && item.eventType !== "unknown") {
    reasonParts.push(item.eventType.replace(/_/g, " "));
  }
  if (item.entityTags.tournaments.length > 0) {
    reasonParts.push(item.entityTags.tournaments[0]);
  }
  if (item.entityTags.teams.length > 0) {
    reasonParts.push(item.entityTags.teams[0]);
  }

  const reason = reasonParts.length > 0
    ? reasonParts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" · ")
    : item.source;

  return {
    newsId: item.id,
    direction: item.sentiment,
    strength,
    reason,
    decayUntil,
    game: item.game,
    eventType: item.eventType,
    createdAt: new Date().toISOString(),
  };
}

// ─── In-Memory Pulse Store ────────────────────────────────────────────────────

const pulseStore = new Map<string, NewsPulse>();

function upsertPulse(pulse: NewsPulse) {
  pulseStore.set(pulse.newsId, pulse);
}

function pruneExpiredPulses() {
  const now = Date.now();
  for (const [id, pulse] of pulseStore.entries()) {
    if (new Date(pulse.decayUntil).getTime() < now) {
      pulseStore.delete(id);
    }
  }
}

export function getActiveNewsPulses(game?: string | null): NewsPulse[] {
  pruneExpiredPulses();
  const all = Array.from(pulseStore.values());
  if (!game) return all;
  return all.filter((p) => !p.game || p.game === game);
}

export function getAggregatePulse(game?: string | null): { direction: Sentiment; strength: number; label: string } | null {
  const pulses = getActiveNewsPulses(game);
  if (pulses.length === 0) return null;

  const now = Date.now();
  let bullish = 0;
  let bearish = 0;
  let neutral = 0;

  for (const pulse of pulses) {
    // Apply linear decay
    const created = new Date(pulse.createdAt).getTime();
    const decay = new Date(pulse.decayUntil).getTime();
    const elapsed = now - created;
    const total = decay - created;
    const decayFactor = Math.max(0, 1 - elapsed / total);
    const effectiveStrength = pulse.strength * decayFactor;

    if (pulse.direction === "bullish") bullish += effectiveStrength;
    else if (pulse.direction === "bearish") bearish += effectiveStrength;
    else neutral += effectiveStrength;
  }

  const total = bullish + bearish + neutral;
  if (total < 0.05) return null;

  if (bullish > bearish && bullish > neutral) {
    return { direction: "bullish", strength: bullish / total, label: "Positive news flow" };
  }
  if (bearish > bullish && bearish > neutral) {
    return { direction: "bearish", strength: bearish / total, label: "Negative news flow" };
  }
  return { direction: "neutral", strength: neutral / total, label: "Mixed news flow" };
}

// ─── Classification Wrapper ───────────────────────────────────────────────────

function classifyNewsItem(item: NewsItem): ClassifiedNewsItem {
  const eventType = inferEventType(item.title);
  const sentiment = inferSentiment(item.title, eventType);
  const impactLevel = inferImpactLevel(eventType, sentiment);
  const entityTags = extractEntities(item.title);
  return { ...item, sentiment, impactLevel, eventType, entityTags };
}

// ─── Fallback Seed ────────────────────────────────────────────────────────────
const FALLBACK_SEED: ClassifiedNewsItem[] = [
  {
    id: "seed_001",
    title: "T1 secures MSI 2026 qualification after defeating Gen.G in decisive series",
    summary: "T1 advances to the Mid-Season Invitational after a dominant 3-1 series win.",
    source: "LoL Esports", sourceUrl: "https://lolesports.com", game: "lol", category: "tournament",
    publishedAt: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
    sentiment: "bullish", impactLevel: "high", eventType: "qualification",
    entityTags: { players: [], teams: ["T1", "Gen.G"], tournaments: ["MSI"] },
  },
  {
    id: "seed_002",
    title: "Sentinels win VCT Americas Stage 1 opener against NRG",
    summary: "Sentinels put on a dominant performance to kick off the VCT Americas stage.",
    source: "VCT", sourceUrl: "https://valorantesports.com", game: "val", category: "tournament",
    publishedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    sentiment: "bullish", impactLevel: "high", eventType: "tournament_result",
    entityTags: { players: [], teams: ["Sentinels", "NRG"], tournaments: ["VCT"] },
  },
  {
    id: "seed_003",
    title: "NaVi sign new AWPer following iM departure",
    summary: "Natus Vincere bolster their CS2 roster ahead of the next major qualifier.",
    source: "HLTV", sourceUrl: "https://hltv.org", game: "cs2", category: "roster",
    publishedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    sentiment: "neutral", impactLevel: "medium", eventType: "roster_change",
    entityTags: { players: [], teams: ["NaVi", "Natus Vincere"], tournaments: [] },
  },
  {
    id: "seed_004",
    title: "Team Liquid announce new League of Legends roster for Summer Split",
    summary: "Liquid unveil sweeping roster changes ahead of the summer competitive season.",
    source: "Dot Esports", sourceUrl: "https://dotesports.com", game: "lol", category: "roster",
    publishedAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
    sentiment: "neutral", impactLevel: "medium", eventType: "roster_change",
    entityTags: { players: [], teams: ["Team Liquid"], tournaments: ["Summer Split"] },
  },
  {
    id: "seed_005",
    title: "LOUD retain VALORANT roster heading into VCT Americas Stage 2",
    summary: "Brazilian powerhouse LOUD keep their championship-winning lineup together.",
    source: "VCT", sourceUrl: "https://valorantesports.com", game: "val", category: "roster",
    publishedAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
    sentiment: "bullish", impactLevel: "medium", eventType: "contract",
    entityTags: { players: [], teams: ["LOUD"], tournaments: ["VCT"] },
  },
  {
    id: "seed_006",
    title: "FaZe Clan top HLTV rankings after Paris Major victory",
    summary: "FaZe cement their position as the world's best CS2 team following Major win.",
    source: "HLTV", sourceUrl: "https://hltv.org", game: "cs2", category: "rankings",
    publishedAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
    sentiment: "bullish", impactLevel: "high", eventType: "tournament_result",
    entityTags: { players: [], teams: ["FaZe"], tournaments: ["Major"] },
  },
  {
    id: "seed_007",
    title: "Worlds 2026 format revealed: 24 teams to compete in Seoul",
    summary: "Riot Games announces expanded format for the 2026 League of Legends World Championship.",
    source: "LoL Esports", sourceUrl: "https://lolesports.com", game: "lol", category: "tournament",
    publishedAt: new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString(),
    sentiment: "neutral", impactLevel: "medium", eventType: "generic_news",
    entityTags: { players: [], teams: [], tournaments: ["Worlds"] },
  },
  {
    id: "seed_008",
    title: "G2 Esports sign Mixwell for Valorant roster overhaul",
    summary: "G2 bring in veteran rifler as they rebuild their VCT EMEA squad.",
    source: "Dot Esports", sourceUrl: "https://dotesports.com", game: "val", category: "roster",
    publishedAt: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
    sentiment: "neutral", impactLevel: "medium", eventType: "roster_change",
    entityTags: { players: [], teams: ["G2"], tournaments: ["VCT"] },
  },
  {
    id: "seed_009",
    title: "Virtus.pro replace coach after group stage exit at IEM Katowice",
    summary: "VP make coaching changes following disappointing early exit at the Major.",
    source: "HLTV", sourceUrl: "https://hltv.org", game: "cs2", category: "general",
    publishedAt: new Date(Date.now() - 9 * 60 * 60 * 1000).toISOString(),
    sentiment: "bearish", impactLevel: "medium", eventType: "roster_change",
    entityTags: { players: [], teams: ["Virtus.pro"], tournaments: ["IEM", "Katowice"] },
  },
  {
    id: "seed_010",
    title: "Cloud9 advance to LCS Spring Finals with comeback victory over 100 Thieves",
    summary: "Cloud9 complete an extraordinary reverse sweep to reach the LCS championship.",
    source: "LoL Esports", sourceUrl: "https://lolesports.com", game: "lol", category: "tournament",
    publishedAt: new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString(),
    sentiment: "bullish", impactLevel: "high", eventType: "qualification",
    entityTags: { players: [], teams: ["Cloud9", "100 Thieves"], tournaments: ["LCS", "Spring Split"] },
  },
  {
    id: "seed_011",
    title: "RLCS 2026 Season kicks off with record viewership numbers",
    summary: "Rocket League esports achieves its highest-ever concurrent viewership for season opener.",
    source: "RLCS", sourceUrl: "https://rocketleague.com/esports", game: "rl", category: "general",
    publishedAt: new Date(Date.now() - 11 * 60 * 60 * 1000).toISOString(),
    sentiment: "bullish", impactLevel: "low", eventType: "generic_news",
    entityTags: { players: [], teams: [], tournaments: ["RLCS"] },
  },
  {
    id: "seed_012",
    title: "Team Spirit win The International 2026 qualifier with flawless group stage",
    summary: "Spirit dominate the European qualifier, dropping only a single map throughout.",
    source: "Dota 2 Esports", sourceUrl: "https://dotabuff.com", game: "dota2", category: "tournament",
    publishedAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
    sentiment: "bullish", impactLevel: "high", eventType: "qualification",
    entityTags: { players: [], teams: ["Team Spirit"], tournaments: ["The International"] },
  },
];

// ─── RSS Fetch + Normalize ────────────────────────────────────────────────────
const parser = new Parser({
  timeout: 8000,
  headers: {
    "User-Agent": "GamerStock-NewsBot/1.0 (+https://gamerstock.app)",
    Accept: "application/rss+xml, application/xml, text/xml, */*",
  },
  customFields: {
    item: [["media:content", "mediaContent"], ["media:thumbnail", "mediaThumbnail"]],
  },
});

function makeId(item: any, source: RssSource): string {
  const base = item.link || item.guid || item.title || Math.random().toString();
  return `rss_${source.name.replace(/\s+/g, "_").toLowerCase()}_${Buffer.from(base).toString("base64").slice(0, 16)}`;
}

function normalizeItem(item: any, source: RssSource): ClassifiedNewsItem {
  const title = (item.title ?? "").replace(/<[^>]+>/g, "").trim();
  const summary = (item.contentSnippet ?? item.summary ?? null)?.replace(/<[^>]+>/g, "").trim() || null;
  const publishedAt = item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString();
  const game = detectGame(title, source);

  const base: NewsItem = {
    id: makeId(item, source),
    title,
    summary: summary && summary.length > 200 ? summary.slice(0, 200) + "..." : summary,
    source: source.name,
    sourceUrl: item.link ?? source.url,
    game,
    category: source.category,
    publishedAt,
  };

  return classifyNewsItem(base);
}

async function fetchFromSource(source: RssSource): Promise<ClassifiedNewsItem[]> {
  const feed = await parser.parseURL(source.url);
  const items = feed.items ?? [];
  return items
    .filter((item) => item.title && item.title.trim().length > 5)
    .slice(0, 20)
    .map((item) => normalizeItem(item, source));
}

function dedupeNewsItems(items: ClassifiedNewsItem[]): ClassifiedNewsItem[] {
  const seen = new Set<string>();
  const seenTitles = new Set<string>();
  return items.filter((item) => {
    const key = item.id;
    const titleKey = item.title.toLowerCase().slice(0, 40);
    if (seen.has(key) || seenTitles.has(titleKey)) return false;
    seen.add(key);
    seenTitles.add(titleKey);
    return true;
  });
}

// ─── In-memory Cache ──────────────────────────────────────────────────────────
const CACHE_TTL_MS = 5 * 60 * 1000;          // 5 minutes for real feed
const FALLBACK_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes for fallback (retry RSS sooner)

interface NewsCache {
  items: ClassifiedNewsItem[];
  fetchedAt: number;
  fromFallback: boolean;
}

let cache: NewsCache | null = null;

async function fetchAllSources(): Promise<ClassifiedNewsItem[] | null> {
  const results = await Promise.allSettled(RSS_SOURCES.map(fetchFromSource));
  const allItems: ClassifiedNewsItem[] = [];
  let successCount = 0;

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled") {
      allItems.push(...result.value);
      successCount++;
    } else {
      console.warn(`[NewsService] RSS source "${RSS_SOURCES[i].name}" failed:`, (result.reason as Error)?.message);
    }
  }

  if (allItems.length === 0) {
    console.warn("[NewsService] All RSS sources failed — using fallback seed");
    return null;
  }

  console.log(`[NewsService] Fetched ${allItems.length} items from ${successCount}/${RSS_SOURCES.length} sources`);
  return allItems;
}

async function refreshNews(): Promise<void> {
  let items: ClassifiedNewsItem[];
  let fromFallback = false;

  try {
    const fetched = await fetchAllSources();
    if (!fetched || fetched.length === 0) {
      items = FALLBACK_SEED;
      fromFallback = true;
    } else {
      const deduped = dedupeNewsItems(fetched);
      items = deduped.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
    }
  } catch (err: any) {
    console.error("[NewsService] Unexpected error fetching news:", err?.message);
    items = FALLBACK_SEED;
    fromFallback = true;
  }

  cache = { items, fetchedAt: Date.now(), fromFallback };

  // Rebuild pulses from fresh news
  for (const item of items.slice(0, 15)) {
    if (!pulseStore.has(item.id)) {
      const pulse = createNewsPulse(item);
      if (pulse) upsertPulse(pulse);
    }
  }
}

export async function getLatestNews(limit = 25): Promise<{ items: ClassifiedNewsItem[]; fromFallback: boolean }> {
  const now = Date.now();

  if (cache) {
    const ttl = cache.fromFallback ? FALLBACK_CACHE_TTL_MS : CACHE_TTL_MS;
    if (now - cache.fetchedAt < ttl) {
      return { items: cache.items.slice(0, limit), fromFallback: cache.fromFallback };
    }
  }

  await refreshNews();

  return {
    items: (cache?.items ?? FALLBACK_SEED).slice(0, limit),
    fromFallback: cache?.fromFallback ?? true,
  };
}

export function invalidateNewsCache() {
  cache = null;
}

export async function backgroundNewsRefresh(): Promise<void> {
  console.log("[NewsService] Background refresh triggered");
  cache = null;
  await refreshNews();
  console.log(`[NewsService] Background refresh complete — ${cache?.items.length ?? 0} items, fromFallback=${cache?.fromFallback}`);
}

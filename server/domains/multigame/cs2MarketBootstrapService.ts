// ─── CS2 Market Bootstrap Service ─────────────────────────────────────────────
//
// Populates the Terminal with an initial supply of CS2 player assets
// sourced from the PandaScore /csgo/players endpoint (requires PANDASCORE_API_KEY).
//
// Design rules (mirrors dota2MarketBootstrapService pattern):
//  1. Bootstrap = one-time seed of the initial universe
//  2. Continuous operation = maintenance of EXISTING assets only
//  3. No Steam connect, no user claim flows, no auto-discovery after bootstrap
//  4. Assets created here are "house supply" owned by the platform
//
// assetUid format: "cs2:cs2:player:{pandascorePlayerId}"
//   → getAssetGame() in terminal.tsx: parts[1] = "cs2" → label "CS2" ✓
//   → Terminal ?game=cs2 filter: markets.game = "cs2" ✓
//
// Source endpoint: GET https://api.pandascore.co/csgo/players
//   Returns CS2 professional players with id, name, team metadata
//   Paginated (max 100 per page) — we fetch up to 8 pages for ~800 players
//
// Initial valuation:
//   All bootstrapped CS2 players receive a flat V1 valuation:
//     initialValue = 15.00 GS (platform baseline, same as Dota2 bootstrap)
//     playerValue  = 15.00 GS
//     confidenceScore = 0.50 (no rank signal, no match history at seed time)
//   Stored in dota2_valuation_state with game="cs2" and
//   playerProfileId=0 (platform sentinel — no real user profile).
//
// Eligibility:
//   ALL PandaScore CS2 players are eligible for initial valuation (flat baseline
//   can always be computed). The enrichment pipeline (V2 EMA from Steam sync)
//   runs after users connect their Steam accounts — not at bootstrap time.
//
// TODOs (future phases):
//   TODO [Fase 6]: Scheduled re-enrichment from PandaScore match data
//   TODO [Fase 7]: Link platform assets to user CS2 profiles when Steam ID matches
// ─────────────────────────────────────────────────────────────────────────────

import { db }                         from "../../db";
import { like, eq, count as drizzleCount } from "drizzle-orm";
import { supplyForPrice, DEFAULT_AMM_PARAMS } from "../../services/ammPricing";
import { getOrCreateMarket }          from "../../market-core/asset-registry";
import {
  assets,
  assetMarkets,
  assetMarketState,
  assetPriceSnapshots,
  dota2ValuationState,
  dota2ValueHistory,
} from "@shared/schema";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Cs2BootstrapOptions {
  /** Max players to seed total (default: 800 — mirrors Dota2 bootstrap limit). */
  limit?: number;
  /** Abort if more than this many CS2 assets already exist (default: 10). */
  skipIfExistingAbove?: number;
  /** Initial price for all assets (default: 15.00 — matches Dota2 baseline). */
  basePrice?: string;
}

export interface Cs2BootstrapResult {
  created:    number;
  skipped:    number;
  errors:     string[];
  durationMs: number;
}

export interface Cs2BootstrapStatusResult {
  totalCs2Assets:      number;
  listed:              number;
  active:              number;
  withFundamentalPrice: number;
  withLastTradePrice:  number;
  withAmmSeeded:       number;
}

// ── PandaScore player shape ───────────────────────────────────────────────────

interface PandaScorePlayer {
  id:         number;
  name:       string;          // in-game name
  first_name: string | null;
  last_name:  string | null;
  image_url:  string | null;
  current_team: {
    id:      number;
    name:    string;
    acronym: string | null;
  } | null;
  videogame?: {
    id:   number;
    name: string;
    slug: string;
  } | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PANDASCORE_BASE       = "https://api.pandascore.co";
const CS2_PLAYERS_ENDPOINT  = "/csgo/players";
const PER_PAGE              = 100;

/**
 * Platform sentinel profile ID for platform-seeded assets.
 * These assets have no real user profile — 0 is safe (no real profile uses id=0).
 */
const BOOTSTRAP_SENTINEL_PROFILE_ID = 0;

/**
 * Flat initial valuation for platform-bootstrapped CS2 assets.
 * These are "house supply" players — no real match data available at seed time.
 * Same baseline used by Dota2 bootstrap (15.00 GS).
 */
const CS2_BOOTSTRAP_BASE_PRICE   = "15.0000";
const CS2_BOOTSTRAP_CONFIDENCE   = "0.5000";
const CS2_BOOTSTRAP_SAMPLE_CONF  = "0.3000";
const CS2_BOOTSTRAP_SIGNAL_CONF  = "0.5000";   // roleConfidence slot (CS2: signalConfidence)
const CS2_BOOTSTRAP_COMPLETENESS = "0.3000";
const CS2_BOOTSTRAP_STABILITY    = "0.5000";

// ── Fetch CS2 players from PandaScore ─────────────────────────────────────────

async function fetchCs2Players(limit: number): Promise<PandaScorePlayer[]> {
  const apiKey = process.env.PANDASCORE_API_KEY;
  if (!apiKey) {
    throw new Error("CS2Bootstrap: PANDASCORE_API_KEY is not set — cannot fetch CS2 players.");
  }

  const players: PandaScorePlayer[] = [];
  const maxPages = Math.ceil(limit / PER_PAGE);

  for (let page = 1; page <= maxPages && players.length < limit; page++) {
    const url = new URL(`${PANDASCORE_BASE}${CS2_PLAYERS_ENDPOINT}`);
    url.searchParams.set("page",     String(page));
    url.searchParams.set("per_page", String(PER_PAGE));

    console.log(`[CS2Bootstrap] Fetching PandaScore page=${page} (${players.length}/${limit} so far)...`);

    let res: Response;
    try {
      res = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept:        "application/json",
        },
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err: any) {
      console.warn(`[CS2Bootstrap] Fetch page=${page} failed: ${err.message}`);
      break;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "(unreadable)");
      console.warn(`[CS2Bootstrap] PandaScore HTTP ${res.status} on page=${page}: ${body.slice(0, 120)}`);
      break;
    }

    const data = (await res.json()) as PandaScorePlayer[];
    if (!Array.isArray(data) || data.length === 0) break;

    players.push(...data);
    console.log(`[CS2Bootstrap] Page ${page} returned ${data.length} players (total so far: ${players.length})`);

    // Polite delay between pages
    if (page < maxPages && players.length < limit) {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  return players.slice(0, limit);
}

// ── Display name builder ───────────────────────────────────────────────────────

function buildCs2DisplayName(p: PandaScorePlayer): string {
  const ign = p.name?.trim();
  if (!ign) return `CS2Pro#${p.id}`;

  const teamAcro = p.current_team?.acronym?.trim();
  if (teamAcro) return `[${teamAcro}] ${ign}`;
  return ign;
}

// ── Seed a single CS2 player asset ───────────────────────────────────────────

async function seedCs2Player(
  p:        PandaScorePlayer,
  marketId: number,
  priceStr: string,
): Promise<"created" | "skipped"> {
  const pandascoreId = String(p.id);
  const assetUid     = `cs2:cs2:player:${pandascoreId}`;
  const displayName  = buildCs2DisplayName(p);
  const price        = parseFloat(priceStr);

  // ── Idempotency: skip if already exists ──────────────────────────────────
  const [existing] = await db
    .select({ id: assets.id })
    .from(assets)
    .where(eq(assets.assetUid, assetUid))
    .limit(1);

  if (existing) return "skipped";

  // ── 1. Create asset ───────────────────────────────────────────────────────
  const [asset] = await db.insert(assets).values({
    marketId,
    assetUid,
    entityType:           "player",
    externalId:           pandascoreId,
    displayName,
    symbol:               "",
    lastTradePrice:       priceStr,
    price24hAgo:          priceStr,
    fundamentalPrice:     priceStr,
    fundamentalUpdatedAt: new Date(),
    volume24h:            "0.00",
    momentum:             "0.0000",
    tradingStatus:        "ACTIVE",
    listingStatus:        "LISTED",
  } as any).returning({ id: assets.id });

  const assetId = asset.id;

  // ── 2. Seed AMM market (same params as Dota2) ─────────────────────────────
  await db.insert(assetMarkets).values({
    assetId,
    isEnabled:           true,
    floorPrice:          "5.000000",
    paramA:              "5.000000",
    paramB:              "100.000000",
    feeBps:              100,
    platformFeeSplitBps: 7000,
    playerFeeSplitBps:   3000,
  }).onConflictDoNothing();

  const supply = supplyForPrice(price, DEFAULT_AMM_PARAMS);
  await db.insert(assetMarketState).values({
    assetId,
    supply:    supply.toFixed(6),
    lastPrice: priceStr,
    version:   1,
  }).onConflictDoNothing();

  // ── 3. Initial price snapshot ─────────────────────────────────────────────
  await db.insert(assetPriceSnapshots).values({
    assetId,
    price:     priceStr,
    volume24h: "0.00",
    momentum:  "0.0000",
  });

  // ── 4. Seed initial valuation state ──────────────────────────────────────
  // Flat V1 baseline: 15.00 GS, confidence 0.50.
  // playerProfileId=0 (platform sentinel — no real user profile).
  // game="cs2" discriminator — reuses dota2_valuation_state table.
  await db.insert(dota2ValuationState).values({
    assetId,
    playerProfileId:  BOOTSTRAP_SENTINEL_PROFILE_ID,
    game:             "cs2",
    initialValue:     CS2_BOOTSTRAP_BASE_PRICE,
    rawValue:         CS2_BOOTSTRAP_BASE_PRICE,
    playerValue:      CS2_BOOTSTRAP_BASE_PRICE,
    confidenceScore:  CS2_BOOTSTRAP_CONFIDENCE,
    sampleConfidence: CS2_BOOTSTRAP_SAMPLE_CONF,
    roleConfidence:   CS2_BOOTSTRAP_SIGNAL_CONF,
    dataCompleteness: CS2_BOOTSTRAP_COMPLETENESS,
    rankStability:    CS2_BOOTSTRAP_STABILITY,
    matchesCount:     0,
    valuationVersion: 1,
  } as any).onConflictDoNothing();

  // ── 5. Mandatory BOOTSTRAP audit-trail event ──────────────────────────────
  // INV_4 invariant: every terminal asset must have at least one history event.
  // This proves the bootstrap pipeline completed and provides an audit trail.
  await db.insert(dota2ValueHistory).values({
    assetId,
    playerProfileId:  BOOTSTRAP_SENTINEL_PROFILE_ID,
    rawValueBefore:   "0.0000",
    rawValueAfter:    CS2_BOOTSTRAP_BASE_PRICE,
    playerValueAfter: CS2_BOOTSTRAP_BASE_PRICE,
    confidenceScore:  CS2_BOOTSTRAP_CONFIDENCE,
    eventType:        "BOOTSTRAP",
    metadataJson:     JSON.stringify({
      source:       "cs2_market_bootstrap",
      basePrice:    priceStr,
      pandascore_id: p.id,
      note:         "Initial platform baseline — PandaScore enrichment pending",
    }),
  } as any);

  console.log(`[CS2Bootstrap] Created uid=${assetUid} name="${displayName}" team="${p.current_team?.name ?? "–"}"`);
  return "created";
}

// ── Main bootstrap ─────────────────────────────────────────────────────────────

export async function bootstrapCs2Market(
  opts: Cs2BootstrapOptions = {},
): Promise<Cs2BootstrapResult> {
  const t0            = Date.now();
  const limit         = opts.limit ?? 800;
  const skipThreshold = opts.skipIfExistingAbove ?? 10;
  const basePrice     = opts.basePrice ?? "15.00";

  // ── Safety guard: abort if CS2 market already substantially populated ─────
  const [{ n }] = await db
    .select({ n: drizzleCount() })
    .from(assets)
    .where(like(assets.assetUid, "cs2:%"));

  const existingCount = Number(n);
  if (existingCount > skipThreshold) {
    console.log(
      `[CS2Bootstrap] Skipping — ${existingCount} CS2 assets already exist ` +
      `(threshold=${skipThreshold}).`,
    );
    return { created: 0, skipped: existingCount, errors: [], durationMs: Date.now() - t0 };
  }

  // ── Ensure CS2 market row exists ──────────────────────────────────────────
  const market = await getOrCreateMarket({
    provider:   "steam",
    game:       "cs2",
    region:     "global",
    scope:      "default",
    entityType: "player",
    externalId: "cs2-global",
    displayName: "CS2 Global",
    symbol:     "",
  });

  const marketId = market.id;

  // ── Fetch player list from PandaScore ─────────────────────────────────────
  let players: PandaScorePlayer[];
  try {
    players = await fetchCs2Players(limit);
  } catch (err: any) {
    return { created: 0, skipped: 0, errors: [`Fetch failed: ${err.message}`], durationMs: Date.now() - t0 };
  }

  if (players.length === 0) {
    console.warn("[CS2Bootstrap] No players returned from PandaScore — aborting.");
    return { created: 0, skipped: 0, errors: ["PandaScore returned 0 players"], durationMs: Date.now() - t0 };
  }

  // ── Sort: prefer players with team (better display quality) ──────────────
  players.sort((a, b) => {
    const aScore = a.current_team ? 1 : 0;
    const bScore = b.current_team ? 1 : 0;
    return bScore - aScore;
  });

  console.log(`[CS2Bootstrap] Will seed ${players.length} CS2 players (limit=${limit})`);

  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const p of players) {
    try {
      const result = await seedCs2Player(p, marketId, basePrice);
      if (result === "created") created++;
      else skipped++;
    } catch (err: any) {
      const msg = `pandascoreId=${p.id} (${p.name}): ${err.message}`;
      console.error(`[CS2Bootstrap] Error: ${msg}`);
      errors.push(msg);
    }

    // Polite inter-row delay
    await new Promise(r => setTimeout(r, 5));
  }

  const durationMs = Date.now() - t0;
  console.log(
    `[CS2Bootstrap] Done — created=${created} skipped=${skipped} ` +
    `errors=${errors.length} duration=${durationMs}ms`,
  );

  return { created, skipped, errors, durationMs };
}

// ── Status query ──────────────────────────────────────────────────────────────

export async function getCs2BootstrapStatus(): Promise<Cs2BootstrapStatusResult> {
  const rows = await db
    .select({
      id:               assets.id,
      listingStatus:    assets.listingStatus,
      tradingStatus:    assets.tradingStatus,
      fundamentalPrice: assets.fundamentalPrice,
      lastTradePrice:   assets.lastTradePrice,
    })
    .from(assets)
    .where(like(assets.assetUid, "cs2:%"));

  const totalCs2Assets = rows.length;
  const listed         = rows.filter(r => r.listingStatus === "LISTED").length;
  const active         = rows.filter(r => r.tradingStatus === "ACTIVE").length;
  const withFundamental = rows.filter(r => r.fundamentalPrice != null).length;
  const withLastTrade   = rows.filter(r => r.lastTradePrice != null).length;

  const ammRows = await db
    .select({ assetId: assetMarkets.assetId })
    .from(assetMarkets)
    .innerJoin(assets, eq(assets.id, assetMarkets.assetId))
    .where(like(assets.assetUid, "cs2:%"));

  const cs2AmmSet = new Set(ammRows.map(r => r.assetId));
  const withAmmSeeded = rows.filter(r => cs2AmmSet.has(r.id)).length;

  return {
    totalCs2Assets,
    listed,
    active,
    withFundamentalPrice: withFundamental,
    withLastTradePrice:   withLastTrade,
    withAmmSeeded,
  };
}

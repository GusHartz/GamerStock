// ─── Player Public Domain — Service ──────────────────────────────────────────
// Builds the public read model for a player asset page.
// Uses existing tables — no new schema, no sensitive data exposed.
// ─────────────────────────────────────────────────────────────────────────────
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { db } from "../../db";
import { assets, markets } from "@shared/schema/player";
import {
  playerOperatorSnapshots,
  playerActivityEvents,
  playerMissions,
  playerMoments,
} from "@shared/schema";
import { playerCardVisuals } from "@shared/schema/player-operator";
import { mediaAssets } from "@shared/schema/media";
import type {
  PlayerPublicOverview,
  TrendStatus,
  PublicMission,
  PublicMissionStatus,
  PublicMoment,
  PublicMomentStatus,
  PublicActivityEvent,
  PublicActivityType,
  PerfRange,
  PerfMetric,
  PerformanceHistoryResponse,
} from "./types";

// ── Lookups ───────────────────────────────────────────────────────────────────

const GAME_NAMES: Record<string, string> = {
  dota2: "Dota 2",
  cs2:   "Counter-Strike 2",
  lol:   "League of Legends",
  val:   "VALORANT",
};

// Map DB trend status → public TrendStatus
const DB_TREND_MAP: Record<string, TrendStatus> = {
  up:     "up",
  down:   "down",
  stable: "flat",
};

// DB activity event types that are safe to show publicly
const PUBLIC_ACTIVITY_TYPES = ["buy", "new_holder", "moment_purchase"] as const;
type DbPublicActivityType = typeof PUBLIC_ACTIVITY_TYPES[number];

// Map DB activity type → public contract type
const ACTIVITY_TYPE_MAP: Record<DbPublicActivityType, PublicActivityType> = {
  buy:              "buy",
  new_holder:       "holder_joined",
  moment_purchase:  "moment_purchase",
};

// ── Pure helpers ──────────────────────────────────────────────────────────────

function deriveTrend(momentum: string | null, price: string, price24h: string): TrendStatus {
  const mom = Number(momentum ?? 0);
  if (!isNaN(mom) && mom > 0.5)  return "up";
  if (!isNaN(mom) && mom < -0.5) return "down";
  const now = Number(price);
  const ago = Number(price24h);
  if (!isNaN(now) && !isNaN(ago) && ago > 0) {
    const pct = (now - ago) / ago;
    if (pct >  0.005) return "up";
    if (pct < -0.005) return "down";
    return "flat";
  }
  return "unknown";
}

function buildCommunityMessage(holders: number, activityCount: number): string {
  if (holders === 0 && activityCount === 0) return "Be the first to support this player.";
  if (holders === 0 && activityCount > 0)   return `Growing — ${activityCount} recent trade${activityCount !== 1 ? "s" : ""} already.`;
  if (holders === 1 && activityCount === 0)  return "1 supporter is backing this player.";
  if (holders < 10)  return `${holders} supporters are backing this player.`;
  if (activityCount > 0) {
    return `${holders.toLocaleString()} supporters — ${activityCount} recent trade${activityCount !== 1 ? "s" : ""}.`;
  }
  return `${holders.toLocaleString()} supporters are following this player's journey.`;
}

function maskUser(raw: string | null | undefined): string {
  if (!raw) return "Someone";
  // If already masked (contains ***), trust the stored value
  if (raw.includes("*")) return raw;
  // Otherwise mask: show first 2 chars + ***
  return raw.length > 2 ? `${raw.slice(0, 2)}***` : "***";
}

function activityLabel(type: DbPublicActivityType, valueLabel: string | null): string {
  switch (type) {
    case "buy":             return valueLabel ? `Picked up ${valueLabel} worth` : "Bought this player's asset";
    case "new_holder":      return "Joined as a supporter";
    case "moment_purchase": return "Bought a Moment";
    default:                return "Interacted";
  }
}

function formatValueLabel(v: string | null | undefined): string | null {
  if (!v) return null;
  const n = Number(v);
  if (isNaN(n) || n === 0) return null;
  return `${n.toFixed(2)} GS`;
}

// ── Mission builder ───────────────────────────────────────────────────────────

function mapMissionStatus(dbStatus: string): PublicMissionStatus | null {
  switch (dbStatus) {
    case "active":    return "active";
    case "completed": return "completed";
    default:          return null; // draft / expired → skip
  }
}

// ── Moment builder ────────────────────────────────────────────────────────────

function mapMomentStatus(dbStatus: string): PublicMomentStatus | null {
  switch (dbStatus) {
    case "active":   return "live";
    case "sold_out": return "sold_out";
    default:         return null; // draft → skip
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function getPlayerPublicOverview(
  assetId: number,
): Promise<PlayerPublicOverview> {
  // ── Asset + market ──────────────────────────────────────────────────────────
  const rows = await db
    .select({
      id:             assets.id,
      assetUid:       assets.assetUid,
      displayName:    assets.displayName,
      lastTradePrice: assets.lastTradePrice,
      price24hAgo:    assets.price24hAgo,
      volume24h:      assets.volume24h,
      momentum:       assets.momentum,
      game:           markets.game,
    })
    .from(assets)
    .leftJoin(markets, eq(markets.id, assets.marketId))
    .where(eq(assets.id, assetId))
    .limit(1);

  const asset = rows[0] ?? null;
  if (!asset) throw Object.assign(new Error("Asset not found"), { statusCode: 404 });

  const gameName = asset.game ? (GAME_NAMES[asset.game] ?? asset.game) : "Unknown Game";

  // ── Snapshot ────────────────────────────────────────────────────────────────
  const [snapshotRow] = await db
    .select()
    .from(playerOperatorSnapshots)
    .where(eq(playerOperatorSnapshots.assetId, assetId))
    .limit(1);

  const holdersTotal = snapshotRow ? (snapshotRow.holdersTotal ?? 0)     : 0;
  const volumeTotal  = snapshotRow ? Number(snapshotRow.volumeTotal ?? 0) : Number(asset.volume24h ?? 0);
  const trendStatus: TrendStatus = snapshotRow
    ? (DB_TREND_MAP[snapshotRow.trendStatus] ?? "unknown")
    : deriveTrend(asset.momentum, asset.lastTradePrice, asset.price24hAgo);

  // ── Mission — first active/completed mission ────────────────────────────────
  const missionRows = await db
    .select()
    .from(playerMissions)
    .where(
      and(
        eq(playerMissions.assetId, assetId),
        inArray(playerMissions.status, ["active", "completed"]),
      ),
    )
    .orderBy(desc(playerMissions.createdAt))
    .limit(1);

  let mission: PublicMission | null = null;
  if (missionRows.length > 0) {
    const m = missionRows[0];
    const publicStatus = mapMissionStatus(m.status);
    if (publicStatus) {
      mission = {
        id:          String(m.id),
        title:       m.title,
        description: m.description ?? null,
        progress:    Number(m.progressPercentage ?? 0),
        target:      Number(m.goalValue ?? 0),
        rewardLabel: null,  // rewardId exists but resolving rewards table is out of scope
        endsAt:      m.endDate ? m.endDate.toISOString() : null,
        status:      publicStatus,
      };
    }
  }

  // ── Moments — active + sold_out, ordered live first ────────────────────────
  const momentRows = await db
    .select()
    .from(playerMoments)
    .where(
      and(
        eq(playerMoments.assetId, assetId),
        inArray(playerMoments.status, ["active", "sold_out"]),
      ),
    )
    .orderBy(desc(playerMoments.status)) // "sold_out" < "active" lexicographically → active first
    .limit(6);

  const moments: PublicMoment[] = momentRows
    .map((m) => {
      const publicStatus = mapMomentStatus(m.status);
      if (!publicStatus) return null;
      return {
        id:          String(m.id),
        title:       m.title,
        description: null,
        imageUrl:    null,   // visual_asset_id resolution out of scope
        rarity:      m.rarity ?? null,
        price:       Number(m.price ?? 0),
        supply:      m.supplyTotal ?? null,
        sold:        m.supplySold ?? null,
        soldPct:     Number(m.soldPercentage ?? 0),
        status:      publicStatus,
      } satisfies PublicMoment;
    })
    .filter((x): x is PublicMoment => x !== null);

  // Sort: live first, then sold_out
  moments.sort((a, b) => {
    const rank = (s: PublicMomentStatus) => (s === "live" ? 0 : 1);
    return rank(a.status) - rank(b.status);
  });

  // ── Activity — recent public events ────────────────────────────────────────
  const activityRows = await db
    .select()
    .from(playerActivityEvents)
    .where(
      and(
        eq(playerActivityEvents.assetId, assetId),
        inArray(playerActivityEvents.type, [...PUBLIC_ACTIVITY_TYPES]),
      ),
    )
    .orderBy(desc(playerActivityEvents.createdAt))
    .limit(6);

  const activity: PublicActivityEvent[] = activityRows.map((e) => {
    const dbType = e.type as DbPublicActivityType;
    const valueLabel = formatValueLabel(e.valueNumeric);
    return {
      id:         String(e.id),
      type:       ACTIVITY_TYPE_MAP[dbType] ?? "buy",
      label:      activityLabel(dbType, valueLabel),
      maskedUser: maskUser(e.actorDisplayMasked),
      createdAt:  e.createdAt.toISOString(),
      valueLabel,
    };
  });

  const recentActivityCount = activity.length;

  // ── Card image — latest uploaded visual for this asset ───────────────────────
  const [cardImageRow] = await db
    .select({ publicUrl: mediaAssets.publicUrl })
    .from(playerCardVisuals)
    .innerJoin(mediaAssets, eq(playerCardVisuals.mediaAssetId, mediaAssets.id))
    .where(eq(playerCardVisuals.assetId, assetId))
    .orderBy(desc(playerCardVisuals.createdAt))
    .limit(1);

  const cardImageUrl = cardImageRow?.publicUrl ?? null;

  // ── Community ────────────────────────────────────────────────────────────────
  const community = {
    totalHolders: holdersTotal,
    message: buildCommunityMessage(holdersTotal, recentActivityCount),
  };

  return {
    assetId,
    assetUid: asset.assetUid,
    hero: {
      assetId,
      playerName:     asset.displayName,
      gameName,
      tagline:        null,
      status:         trendStatus !== "unknown" ? trendStatus : null,
      cardImageUrl,
      bannerImageUrl: null,
      holdersTotal,
      volumeTotal,
      unitPrice:      Number(asset.lastTradePrice ?? 10),
    },
    cta: {
      primaryLabel:   "Support Player",
      secondaryLabel: "View on Terminal",
      canSupport:     true,
    },
    socialProof: {
      holdersTotal,
      recentActivityCount,
      newSupportersLabel: holdersTotal > 0
        ? `${holdersTotal} supporter${holdersTotal !== 1 ? "s" : ""}`
        : null,
    },
    marketSignals: {
      holdersTotal,
      volumeTotal,
      trendStatus,
    },
    mission,
    moments,
    activity,
    community,
  };
}

// ── Performance History ───────────────────────────────────────────────────────

const RANGE_DAYS: Record<PerfRange, number> = { "7d": 7, "30d": 30, "90d": 90 };

/**
 * Returns daily price/volume/momentum history for a player asset.
 * Primary source: asset_price_snapshots (real market data).
 * Fallback: asset_trades daily average (for assets with no snapshot history).
 */
export async function getPlayerPublicPerformanceHistory(
  assetId: number,
  range:   PerfRange,
  metric:  PerfMetric,
): Promise<PerformanceHistoryResponse> {
  const [asset] = await db.select({ id: assets.id }).from(assets).where(eq(assets.id, assetId));
  if (!asset) {
    const err = new Error("Asset not found.") as any;
    err.statusCode = 404;
    throw err;
  }

  const days = RANGE_DAYS[range];

  // ── Query snapshots ─────────────────────────────────────────────────────────
  const colExpr =
    metric === "price"    ? sql`AVG(price::numeric)::numeric(10,4)` :
    metric === "volume"   ? sql`MAX(volume_24h::numeric)::numeric(15,2)` :
    /* momentum */          sql`AVG(momentum::numeric)::numeric(10,6)`;

  const snapResult = await db.execute(sql`
    SELECT
      DATE(recorded_at) AS date,
      ${colExpr}        AS value
    FROM asset_price_snapshots
    WHERE asset_id = ${assetId}
      AND recorded_at >= NOW() - (${days} * INTERVAL '1 day')
    GROUP BY DATE(recorded_at)
    ORDER BY date ASC
  `);

  const snapPoints = (snapResult.rows as { date: unknown; value: unknown }[]).map((r) => ({
    date:  String(r.date).slice(0, 10),
    value: Number(r.value),
  }));

  if (snapPoints.length >= 2) {
    return { assetId, metric, range, dataSource: "snapshots", points: snapPoints };
  }

  // ── Fallback: trade history (price only) ────────────────────────────────────
  if (metric === "price") {
    const tradeResult = await db.execute(sql`
      SELECT
        DATE(executed_at) AS date,
        AVG(price_per_share::numeric)::numeric(10,4) AS value
      FROM asset_trades
      WHERE asset_id = ${assetId}
        AND executed_at >= NOW() - (${days} * INTERVAL '1 day')
      GROUP BY DATE(executed_at)
      ORDER BY date ASC
    `);

    const tradePoints = (tradeResult.rows as { date: unknown; value: unknown }[]).map((r) => ({
      date:  String(r.date).slice(0, 10),
      value: Number(r.value),
    }));

    if (tradePoints.length >= 1) {
      return { assetId, metric, range, dataSource: "trades", points: tradePoints };
    }
  }

  return { assetId, metric, range, dataSource: "empty", points: [] };
}

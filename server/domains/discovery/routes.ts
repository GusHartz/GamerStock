import type { Express, RequestHandler } from "express";
import { db } from "../../db";
import { z } from "zod";
import { storage } from "../../storage";
import { api } from "@shared/routes";
import { buildMarketSignals } from "../../services/marketSignals";
import {
  assets,
  assetMarkets,
  assetMarketState,
  assetPriceSnapshots,
  assetWatchlist,
  riotAssets,
  assetValuationState,
  markets,
  users,
  vaults,
  watchlist,
} from "@shared/schema";
import { eq, desc, asc, ilike, sql as sqlExpr, or, and, gte, lt, isNotNull } from "drizzle-orm";
import { dota2ValueHistory } from "@shared/schema/multigame";

const isAuthenticated: RequestHandler = (req: any, res, next) => {
  if (req.session?.isAdmin || req.session?.userId) return next();
  if (typeof req.isAuthenticated === "function" && req.isAuthenticated()) return next();
  return res.status(401).json({ message: "Unauthorized" });
};

const isAdminOnly: RequestHandler = (req: any, res, next) => {
  if (req.session?.isAdmin) return next();
  if (req.session?.userRole === "admin") return next();
  return res.status(403).json({ message: "Forbidden" });
};

function mapToUnifiedAsset(r: {
  asset: any;
  market: any;
  riotRow?: any;
  ammState?: any;
  valuationRow?: any;
  watchlisted?: boolean;
}) {
  const price = parseFloat(String(r.asset.lastTradePrice)) || 0;
  const price24h = parseFloat(String(r.asset.price24hAgo)) || 0;
  const change24hPct = price24h > 0 ? ((price - price24h) / price24h) * 100 : null;
  const volume24h = parseFloat(String(r.asset.volume24h)) || 0;
  const momentum = parseFloat(String(r.asset.momentum)) || 0;
  const supply = parseFloat(String(r.ammState?.supply || "0")) || 0;
  const ammPrice = parseFloat(String(r.ammState?.lastPrice || "0")) || 0;
  const marketCap = supply > 0 && ammPrice > 0 ? supply * ammPrice : null;

  const lp = r.riotRow ? (r.riotRow.leaguePoints ?? 0) : null;
  const wins = r.riotRow ? (r.riotRow.wins ?? 0) : null;
  const losses = r.riotRow ? (r.riotRow.losses ?? 0) : null;
  const winrate = r.riotRow ? parseFloat(String(r.riotRow.winrate)) || 0 : null;
  const _rpRaw = r.valuationRow ? parseFloat(String(r.valuationRow.recentPerformance)) : NaN;
  const performanceScore = Number.isFinite(_rpRaw) && _rpRaw > 0 ? Math.round(_rpRaw) : null;

  const badges: string[] = [];
  if (r.market.game) badges.push(r.market.game);
  if (r.market.region) badges.push(r.market.region.toUpperCase());

  // PVI / Valuation fields (null when not yet computed)
  const fairValueGS = r.valuationRow ? parseFloat(String(r.valuationRow.fairValueGS)) || null : null;
  const pviAdjusted = r.valuationRow ? parseFloat(String(r.valuationRow.pviAdjusted)) || null : null;
  const pviRaw = r.valuationRow ? parseFloat(String(r.valuationRow.pviRaw)) || null : null;
  const pviFinal = r.valuationRow ? parseFloat(String(r.valuationRow.pviFinal)) || null : null;
  const divergencePct = r.valuationRow ? parseFloat(String(r.valuationRow.divergencePct)) : null;
  const confidenceScore = r.valuationRow ? parseFloat(String(r.valuationRow.confidenceScore)) || null : null;
  const lastMatchPulse = r.valuationRow ? parseFloat(String(r.valuationRow.lastMatchPulse)) || null : null;
  const recentPerformance = r.valuationRow ? parseFloat(String(r.valuationRow.recentPerformance)) || null : null;
  const consistencyScore = r.valuationRow ? parseFloat(String(r.valuationRow.consistencyScore)) || null : null;
  const historicalSkill = r.valuationRow ? parseFloat(String(r.valuationRow.historicalSkill)) || null : null;
  const activityScore = r.valuationRow ? parseFloat(String(r.valuationRow.activityScore)) || null : null;

  return {
    assetId: r.asset.assetUid,
    internalId: r.asset.id,
    provider: r.market.provider,
    game: r.market.game,
    assetType: r.asset.entityType,
    displayName: r.asset.displayName,
    tag: r.riotRow?.tagLine ?? null,
    region: r.market.region ?? null,
    price: price.toFixed(2),
    price24hAgo: price24h.toFixed(2),
    change24hPct: change24hPct !== null ? parseFloat(change24hPct.toFixed(2)) : null,
    volume24h: volume24h.toFixed(2),
    momentum: momentum.toFixed(4),
    marketCap: marketCap !== null ? marketCap.toFixed(2) : null,
    supply: supply.toFixed(4),
    performanceScore,
    badges,
    rawMetrics: r.riotRow ? { lp, wins, losses, winrate } : {},
    watchlisted: r.watchlisted ?? false,
    // PVI Valuation layer
    fairValueGS: fairValueGS !== null ? parseFloat(fairValueGS.toFixed(4)) : null,
    pviAdjusted: pviAdjusted !== null ? parseFloat(pviAdjusted.toFixed(2)) : null,
    pviRaw: pviRaw !== null ? parseFloat(pviRaw.toFixed(2)) : null,
    pviFinal: pviFinal !== null ? parseFloat(pviFinal.toFixed(2)) : null,
    divergencePct: divergencePct !== null ? parseFloat(divergencePct.toFixed(2)) : null,
    confidenceScore: confidenceScore !== null ? parseFloat(confidenceScore.toFixed(4)) : null,
    lastMatchPulse: lastMatchPulse !== null ? parseFloat(lastMatchPulse.toFixed(2)) : null,
    recentPerformance: recentPerformance !== null ? parseFloat(recentPerformance.toFixed(2)) : null,
    consistencyScore: consistencyScore !== null ? parseFloat(consistencyScore.toFixed(2)) : null,
    historicalSkill: historicalSkill !== null ? parseFloat(historicalSkill.toFixed(2)) : null,
    activityScore: activityScore !== null ? parseFloat(activityScore.toFixed(2)) : null,
  };
}

export function registerDiscoveryRoutes(app: Express): void {
  // ── LEGACY: Vault endpoints ──────────────────────────────────────────────────
  // FREEZE: Do not add new features to these endpoints.
  // Official path: GET /api/market/assets (Riot canonical asset registry)
  // Retirement: GET /api/vaults → remove once vault-detail page is migrated.
  // See: docs/architecture/legacy-freeze-and-retirement-plan.md

  // Get Vaults
  app.get(api.vaults.list.path, async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const options = {
        page: parseInt(req.query.page as string) || 1,
        limit: parseInt(req.query.limit as string) || 50,
        search: req.query.search as string,
        rank: req.query.rank as string,
        region: req.query.region as string,
        sort: req.query.sort as string,
        order: (req.query.order as string) === 'asc' ? 'asc' : 'desc' as any,
      };

      const result = await storage.getVaults(options);
      res.json({
        data: result.data,
        total: result.total,
        page: options.page,
        limit: options.limit,
        totalPages: Math.ceil(result.total / options.limit)
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Get Vault Details
  app.get(api.vaults.get.path, async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const vaultId = parseInt(req.params.id as string);
      const vault = await storage.getVault(vaultId);

      if (!vault) {
        return res.status(404).json({ message: "Vault not found" });
      }

      const snapshots = await storage.getVaultSnapshots(vaultId);
      
      let userPosition = null;
      if (req.isAuthenticated() && (req.user as any)?.claims?.sub) {
        const userId = (req.user as any).claims.sub;
        const portfolio = await storage.getPortfolioByUserId(userId);
        if (portfolio) {
          userPosition = await storage.getPosition(portfolio.id, vaultId);
        }
      }

      res.json({
        vault,
        snapshots,
        userPosition: userPosition || undefined
      });
    } catch (e) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Watchlist Routes
  app.get(api.watchlist.list.path, isAuthenticated, async (req, res) => {
    try {
      const userId = (req.user as any).id || (req.user as any).claims?.sub;
      if (!userId) {
        console.error("[Watchlist Error] No user ID in session");
        return res.status(401).json({ error: "Unauthorized", details: "User ID missing from session" });
      }
      const list = await storage.getWatchlist(userId);
      console.log(`[Watchlist] user=${userId} fetched \${list.length} items`);
      res.json(list);
    } catch (e) {
      console.error("[Watchlist Error] Fetch failed:", e);
      res.status(500).json({ error: "Internal server error", details: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post(api.watchlist.add.path, isAuthenticated, async (req, res) => {
    try {
      const userId = (req.user as any).id || (req.user as any).claims?.sub;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized", details: "User ID missing from session" });
      }
      
      const vaultId = Number(req.body.vaultId);
      if (!vaultId || isNaN(vaultId)) {
        console.error("[Watchlist] Invalid vaultId:", req.body);
        return res.status(400).json({ error: "Invalid request", details: "vaultId must be a number" });
      }

      console.log(`[Watchlist] user=\${userId} action=add vaultId=\${vaultId}`);
      await storage.addToWatchlist(userId, vaultId);
      const list = await storage.getWatchlist(userId);
      res.json({ success: true, items: list });
    } catch (e) {
      console.error("[Watchlist Error] Add failed:", e);
      res.status(500).json({ error: "Internal server error", details: e instanceof Error ? e.message : String(e) });
    }
  });

  app.delete(api.watchlist.remove.path, isAuthenticated, async (req, res) => {
    try {
      const userId = (req.user as any).id || (req.user as any).claims?.sub;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized", details: "User ID missing from session" });
      }
      
      const vaultId = parseInt(req.params.id as string);
      if (isNaN(vaultId)) {
        return res.status(400).json({ error: "Invalid request", details: "Invalid vault ID in URL" });
      }

      console.log(`[Watchlist] user=\${userId} action=remove vaultId=\${vaultId}`);
      await storage.removeFromWatchlist(userId, vaultId);
      const list = await storage.getWatchlist(userId);
      res.json({ success: true, items: list });
    } catch (e) {
      console.error("[Watchlist Error] Remove failed:", e);
      res.status(500).json({ error: "Internal server error", details: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/api/assets", async (req: any, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
      const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "50"), 10)));
      const offset = (page - 1) * limit;

      const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
      const game = typeof req.query.game === "string" ? req.query.game.trim() : "";
      const region = typeof req.query.region === "string" ? req.query.region.trim() : "";
      const sortField = String(req.query.sort || "lastTradePrice");
      const order = req.query.order === "asc" ? "asc" : "desc";

      const sortable: Record<string, any> = {
        price: assets.lastTradePrice,
        lastTradePrice: assets.lastTradePrice,
        volume24h: assets.volume24h,
        momentum: assets.momentum,
        displayName: assets.displayName,
        change24hPct: assets.lastTradePrice,
        marketCap: assets.lastTradePrice,
        performanceScore: riotAssets.leaguePoints,
      };
      const sortCol = sortable[sortField] ?? assets.lastTradePrice;

      // ── Terminal eligibility policy ───────────────────────────────────────────
      // Only assets that satisfy ALL four criteria appear in the player market:
      //   1. listing_status = 'LISTED'     — officially published
      //   2. trading_status = 'ACTIVE'     — trading open
      //   3. player_profile_id IS NOT NULL — linked to a real registered player
      //   4. fundamental_price IS NOT NULL — valuation has been calculated from real API data
      //
      // Dota2 criterion: player_profile + enough OpenDota matches → fundamental_price set
      // CS2 criterion:   player_profile + Steam stats fetched     → fundamental_price set
      // Orphan/bootstrap assets without player_profile are excluded regardless of price.
      const conditions: any[] = [
        eq(assets.listingStatus,   "LISTED"),
        eq(assets.tradingStatus,   "ACTIVE"),
        isNotNull(assets.playerProfileId),
        isNotNull(assets.fundamentalPrice),
      ];
      if (game) conditions.push(ilike(markets.game, `%${game}%`));
      if (region) conditions.push(ilike(markets.region, `%${region}%`));
      if (search) {
        const pattern = `%${search}%`;
        conditions.push(or(
          ilike(assets.displayName, pattern),
          ilike(assets.assetUid, pattern),
          ilike(riotAssets.tagLine, pattern),
        ));
      }
      const whereClause = and(...conditions);

      const userId = req.user?.claims?.sub ?? req.user?.id ?? req.session?.userId ?? null;

      const rows = await db
        .select({ asset: assets, market: markets, riotRow: riotAssets, ammState: assetMarketState, valuationRow: assetValuationState })
        .from(assets)
        .innerJoin(markets, eq(assets.marketId, markets.id))
        .leftJoin(riotAssets, eq(assets.externalId, riotAssets.puuid))
        .leftJoin(assetMarketState, eq(assetMarketState.assetId, assets.id))
        .leftJoin(assetValuationState, eq(assetValuationState.assetId, assets.id))
        .where(whereClause)
        .orderBy(order === "asc" ? asc(sortCol) : desc(sortCol))
        .limit(limit)
        .offset(offset);

      const [{ count }] = await db
        .select({ count: sqlExpr<number>`count(*)` })
        .from(assets)
        .innerJoin(markets, eq(assets.marketId, markets.id))
        .leftJoin(riotAssets, eq(assets.externalId, riotAssets.puuid))
        .where(whereClause);

      let watchlistedSet = new Set<number>();
      if (userId) {
        const wl = await db.select({ assetId: assetWatchlist.assetId })
          .from(assetWatchlist).where(eq(assetWatchlist.userId, userId));
        watchlistedSet = new Set(wl.map(w => w.assetId));
      }

      const total = Number(count);
      res.json({
        page,
        total,
        totalPages: Math.ceil(total / limit),
        rows: rows.map(r => mapToUnifiedAsset({ ...r, watchlisted: watchlistedSet.has(r.asset.id) })),
      });
    } catch (e) {
      console.error("[Assets] list error:", e);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/assets/search", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
      if (!q || q.length < 2) return res.json([]);
      const pattern = `%${q}%`;
      const rows = await db
        .select({ asset: assets, market: markets, riotRow: riotAssets })
        .from(assets)
        .innerJoin(markets, eq(assets.marketId, markets.id))
        .leftJoin(riotAssets, eq(assets.externalId, riotAssets.puuid))
        .where(or(ilike(assets.displayName, pattern), ilike(riotAssets.tagLine, pattern)))
        .orderBy(desc(assets.lastTradePrice))
        .limit(10);
      res.json(rows.map(r => ({
        assetId: r.asset.assetUid,
        internalId: r.asset.id,
        displayName: r.asset.displayName,
        tag: r.riotRow?.tagLine ?? null,
        game: r.market.game,
        region: r.market.region,
      })));
    } catch (e) {
      console.error("[Assets] search error:", e);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/assets/watchlist", async (req: any, res) => {
    const userId = req.user?.claims?.sub ?? req.user?.id ?? req.session?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    try {
      const rows = await db
        .select({ asset: assets, market: markets, riotRow: riotAssets, ammState: assetMarketState, valuationRow: assetValuationState })
        .from(assetWatchlist)
        .innerJoin(assets, eq(assetWatchlist.assetId, assets.id))
        .innerJoin(markets, eq(assets.marketId, markets.id))
        .leftJoin(riotAssets, eq(assets.externalId, riotAssets.puuid))
        .leftJoin(assetMarketState, eq(assetMarketState.assetId, assets.id))
        .leftJoin(assetValuationState, eq(assetValuationState.assetId, assets.id))
        .where(eq(assetWatchlist.userId, userId))
        .orderBy(desc(assetWatchlist.createdAt));
      res.json(rows.map(r => mapToUnifiedAsset({ ...r, watchlisted: true })));
    } catch (e) {
      console.error("[Assets] watchlist get error:", e);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/assets/watchlist", async (req: any, res) => {
    const userId = req.user?.claims?.sub ?? req.user?.id ?? req.session?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const { assetId } = req.body;
    if (!assetId || typeof assetId !== "number") return res.status(400).json({ message: "assetId required" });
    try {
      await db.insert(assetWatchlist).values({ userId, assetId }).onConflictDoNothing();
      res.json({ ok: true });
    } catch (e) {
      console.error("[Assets] watchlist add error:", e);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/assets/watchlist/:assetId", async (req: any, res) => {
    const userId = req.user?.claims?.sub ?? req.user?.id ?? req.session?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const assetId = parseInt(req.params.assetId, 10);
    if (isNaN(assetId)) return res.status(400).json({ message: "Invalid assetId" });
    try {
      await db.delete(assetWatchlist).where(and(eq(assetWatchlist.userId, userId), eq(assetWatchlist.assetId, assetId)));
      res.json({ ok: true });
    } catch (e) {
      console.error("[Assets] watchlist delete error:", e);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/assets/:assetUid", async (req: any, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const { assetUid } = req.params;
      const decodedUid = decodeURIComponent(assetUid);

      const [row] = await db
        .select({ asset: assets, market: markets, riotRow: riotAssets, ammState: assetMarketState, valuationRow: assetValuationState })
        .from(assets)
        .innerJoin(markets, eq(assets.marketId, markets.id))
        .leftJoin(riotAssets, eq(assets.externalId, riotAssets.puuid))
        .leftJoin(assetMarketState, eq(assetMarketState.assetId, assets.id))
        .leftJoin(assetValuationState, eq(assetValuationState.assetId, assets.id))
        .where(eq(assets.assetUid, decodedUid))
        .limit(1);

      if (!row) return res.status(404).json({ message: "Asset not found" });

      const userId = req.user?.claims?.sub ?? req.user?.id ?? req.session?.userId ?? null;
      let watchlisted = false;
      if (userId) {
        const [wl] = await db.select().from(assetWatchlist)
          .where(and(eq(assetWatchlist.userId, userId), eq(assetWatchlist.assetId, row.asset.id))).limit(1);
        watchlisted = !!wl;
      }

      const ua = mapToUnifiedAsset({ ...row, watchlisted });

      const lp = row.riotRow?.leaguePoints ?? 0;
      const wins = row.riotRow?.wins ?? 0;
      const losses = row.riotRow?.losses ?? 0;
      const winrate = parseFloat(String(row.riotRow?.winrate ?? "0")) || 0;
      const momentum = parseFloat(String(row.asset.momentum)) || 0;
      const volume24h = parseFloat(String(row.asset.volume24h)) || 0;
      const metrics = { performanceScore: ua.performanceScore, wins, losses, winrate, matches: wins + losses, leaguePoints: lp, recentTrend: momentum > 0 ? "up" : momentum < 0 ? "down" : "flat" };

      // Enrich signals with news pulse context (LoL game-level)
      let newsContext: import("../../services/marketSignals").NewsSignalContext | null = null;
      try {
        const { getAggregatePulse } = await import("../../services/newsService");
        const gameForAsset = row.asset.externalId?.includes(":lol:") ? "lol" : null;
        const aggregate = getAggregatePulse(gameForAsset);
        if (aggregate) {
          newsContext = { direction: aggregate.direction, strength: aggregate.strength, label: aggregate.label };
        }
      } catch {}

      const rawSignals = buildMarketSignals({
        lastTradePrice: parseFloat(String(row.asset.lastTradePrice)) || 0,
        price24hAgo: parseFloat(String(row.asset.price24hAgo)) || 0,
        momentum,
        volume24h,
        winrate,
        leaguePoints: lp,
        wins,
        losses,
        confidenceScore: ua.confidenceScore,
        fairValueGS: ua.fairValueGS,
        divergencePct: ua.divergencePct,
        fundamentalPrice: row.asset.fundamentalPrice ? parseFloat(String(row.asset.fundamentalPrice)) : null,
        newsContext,
      });
      const signals = rawSignals.map(s => ({
        code: s.id,
        label: s.label,
        tone: s.type === "bullish" ? "positive" : s.type === "bearish" ? "negative" : "neutral",
        type: s.type,
        reason: s.reason,
      }));

      res.json({ asset: ua, metrics, signals });
    } catch (e) {
      console.error("[Assets] detail error:", e);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/assets/:assetUid/snapshots", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const { assetUid } = req.params;
      const decodedUid = decodeURIComponent(assetUid);
      const tf = String(req.query.tf || "7d");

      const [assetRow] = await db.select({ id: assets.id }).from(assets)
        .where(eq(assets.assetUid, decodedUid)).limit(1);
      if (!assetRow) return res.status(404).json({ message: "Asset not found" });

      const limitMap: Record<string, number> = { "24h": 288, "7d": 336, "30d": 720 };
      const snapshotLimit = limitMap[tf] ?? 336;

      const snaps = await db
        .select()
        .from(assetPriceSnapshots)
        .where(eq(assetPriceSnapshots.assetId, assetRow.id))
        .orderBy(desc(assetPriceSnapshots.recordedAt))
        .limit(snapshotLimit);

      res.json({
        assetId: decodedUid,
        timeframe: tf,
        points: snaps.reverse().map(s => ({ t: s.recordedAt, p: parseFloat(String(s.price)) })),
      });
    } catch (e) {
      console.error("[Assets] snapshots error:", e);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── GET /api/assets/:assetUid/performance-history ────────────────────────────
  //
  // Returns the sporting performance timeline for a single asset.
  //
  // IMPORTANT: This is PERFORMANCE history, not PRICE history and not VALUE history.
  //   - Performance = esports sporting performance of the player (per match/per day)
  //   - Value       = algorithmic interpretation of performance (see /value-history)
  //   - Price       = market response to value (see /snapshots)
  //
  // Data source: dota2_value_history WHERE event_type = 'RECALC' AND performance_score IS NOT NULL
  //   NOTE: dota2_performance_scores is the canonical source but currently has 0 rows
  //   (match ingestion pipeline not yet running in PROD). We use dota2_value_history.RECALC
  //   as a proxy — each RECALC captures the performance_score at valuation time.
  //   This note is accurate as of Fase 3 (2026-04-06). When dota2_performance_scores
  //   has data, this endpoint should be updated to read from it instead.
  //
  // SCALE NOTE: performance_score is stored in different scales per game:
  //   - CS2:   0–1  fraction (e.g. 0.6644 = 66.44%)
  //   - Dota2: 0–100 already (e.g. 80.0000 = 80%)
  // The SQL normalises both to 0–100 output via CASE WHEN score > 1.
  // Aggregated by calendar day (UTC). Matches counted = RECALC events per day.
  // ─────────────────────────────────────────────────────────────────────────────
  app.get("/api/assets/:assetUid/performance-history", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const decodedUid = decodeURIComponent(req.params.assetUid);
      const [assetRow] = await db.select({ id: assets.id, assetUid: assets.assetUid })
        .from(assets).where(eq(assets.assetUid, decodedUid)).limit(1);
      if (!assetRow) return res.status(404).json({ message: "Asset not found" });

      const days = Math.min(parseInt(String(req.query.days ?? "90"), 10) || 90, 365);
      const since = new Date(Date.now() - days * 86400_000);

      type PerfRow = { date: string; score: string; matches: string };

      const rows = await db.execute<PerfRow>(sqlExpr`
        SELECT
          TO_CHAR(DATE_TRUNC('day', created_at), 'YYYY-MM-DD') AS date,
          AVG(CASE WHEN CAST(performance_score AS numeric) > 1
                   THEN CAST(performance_score AS numeric)
                   ELSE CAST(performance_score AS numeric) * 100
               END)::numeric(7,2) AS score,
          COUNT(*)::int                                               AS matches
        FROM dota2_value_history
        WHERE asset_id     = ${assetRow.id}
          AND event_type   = 'RECALC'
          AND performance_score IS NOT NULL
          AND created_at  >= ${since}
        GROUP BY DATE_TRUNC('day', created_at)
        ORDER BY DATE_TRUNC('day', created_at) ASC
      `);

      return res.json(
        (rows.rows as PerfRow[]).map(r => ({
          date:         r.date,
          score:        parseFloat(r.score),
          matchesCount: Number(r.matches),
          sourceType:   "VALUE_HISTORY_PROXY",
        })),
      );
    } catch (e) {
      console.error("[Assets] performance-history error:", e);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── GET /api/assets/:assetUid/value-history ───────────────────────────────
  //
  // Returns the value (fundamental estimate) timeline for a single asset.
  //
  // IMPORTANT: This is VALUE history, not PRICE history and not PERFORMANCE history.
  //   - Value       = algorithmic interpretation of performance data over time
  //   - Performance = raw sporting score (see /performance-history)
  //   - Price       = market response (see /snapshots)
  //
  // Data source: dota2_value_history (multigame — naming herdado, cobre Dota2 e CS2)
  //   NOTE: This table is named dota2_value_history but stores valuation events
  //   for ALL games (Dota2, CS2). This is a naming artifact, not a bug.
  //   Renaming → Fase 7.
  //
  // Accepts: ?days=N (default 90, max 365)
  // ─────────────────────────────────────────────────────────────────────────────
  app.get("/api/assets/:assetUid/value-history", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const decodedUid = decodeURIComponent(req.params.assetUid);
      const [assetRow] = await db.select({ id: assets.id })
        .from(assets).where(eq(assets.assetUid, decodedUid)).limit(1);
      if (!assetRow) return res.status(404).json({ message: "Asset not found" });

      const days = Math.min(parseInt(String(req.query.days ?? "90"), 10) || 90, 365);
      const since = new Date(Date.now() - days * 86400_000);

      const rows = await db
        .select({
          date:             dota2ValueHistory.createdAt,
          playerValueAfter: dota2ValueHistory.playerValueAfter,
          eventType:        dota2ValueHistory.eventType,
        })
        .from(dota2ValueHistory)
        .where(
          and(
            eq(dota2ValueHistory.assetId, assetRow.id),
            gte(dota2ValueHistory.createdAt, since),
          ),
        )
        .orderBy(asc(dota2ValueHistory.createdAt))
        .limit(500);

      return res.json(
        rows.map(r => ({
          date:             r.date,
          playerValueAfter: parseFloat(String(r.playerValueAfter)),
          eventType:        r.eventType,
        })),
      );
    } catch (e) {
      console.error("[Assets] value-history error:", e);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/waitlist", async (req, res) => {
    try {
      const waitlistSchema = z.object({
        email: z.string().email("Invalid email address"),
        discord: z.string().optional(),
      });
      
      const { email, discord } = waitlistSchema.parse(req.body);
      
      const exists = await storage.isEmailOnWaitlist(email);
      if (exists) {
        return res.status(400).json({ message: "This email is already on the waitlist." });
      }
      
      await storage.addToWaitlist({ email, discord });
      res.json({ message: "You're on the waitlist. We'll notify you when access opens." });
    } catch (e) {
      if (e instanceof z.ZodError) {
        return res.status(400).json({ message: e.errors[0].message });
      }
      console.error("[Waitlist Error]", e);
      res.status(500).json({ message: "Internal server error" });
    }
  });
}

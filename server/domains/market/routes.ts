import type { Express, RequestHandler } from "express";
import { db } from "../../db";
import { storage } from "../../storage";
import { api } from "@shared/routes";
import {
  riotAssets,
  riotTrades,
  riotPositions,
  portfolios,
  users,
  assets,
  assetPriceSnapshots,
  markets,
  assetMarkets,
  assetMarketState,
  assetTrades,
  dota2ValuationState,
  dota2PerformanceScores,
  performanceScores,
  playerOperatorAccess,
  playerOperatorSnapshots,
  playerMissions,
  playerCardVisuals,
  mediaAssets,
} from "@shared/schema";
import { getPerformanceProvider } from "../../integrations/performance-provider-factory";
import { eq, and, or, desc, asc, ilike, gte, sql as sqlExpr, inArray } from "drizzle-orm";
import { terminalBroadcaster } from "../../sse/terminalBroadcaster";
import { getMarketMode } from "../../app-config";
import { spotPrice, costToBuy, payoutToSell, priceImpactPct } from "../../services/ammPricing";
import { computeQuotes } from "@shared/market-quotes";
import { executeAssetTrade, AssetTradeError } from "../../services/assetTradeExecutor";

const isAuthenticated: RequestHandler = (req: any, res, next) => {
  if (req.session?.isAdmin || req.session?.userId) return next();
  if (typeof req.isAuthenticated === "function" && req.isAuthenticated()) return next();
  return res.status(401).json({ message: "Unauthorized" });
};

export function registerMarketRoutes(app: Express): void {
  // ============================
  // MARKET ROUTES (Legacy Sandbox — reads)
  // ============================

  // LEGACY: Get Recent Trades (sandbox)
  // FREEZE: Do not extend. Official endpoint: GET /api/riot/trades/recent
  // Retirement: remove once frontend migrates to Riot trades.
  // See: docs/architecture/legacy-freeze-and-retirement-plan.md
  app.get(api.trade.recent.path, async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const trades = await storage.getRecentTrades(20);
      res.json(trades);
    } catch (e) {
      console.error(e);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/market/stats", async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const stats = await storage.getMarketStats();
      res.json(stats);
    } catch (e) {
      console.error(e);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ============================
  // MARKET ROUTES (Real / Riot Assets)
  // ============================
  //  Riot Asset API — profile, trades, and trading

  // GET /api/riot/asset/:puuid — asset details + caller's position
  app.get("/api/riot/asset/:puuid", isAuthenticated, async (req: any, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const puuid = decodeURIComponent(req.params.puuid);
      const [asset] = await db.select().from(riotAssets).where(eq(riotAssets.puuid, puuid));
      if (!asset) return res.status(404).json({ message: "Asset not found" });

      const userId = (req.user as any).claims?.sub || (req.user as any).id;
      let position = null;
      if (userId) {
        const portfolio = await storage.getPortfolioByUserId(userId);
        if (portfolio) {
          const [pos] = await db
            .select()
            .from(riotPositions)
            .where(and(eq(riotPositions.portfolioId, portfolio.id), eq(riotPositions.puuid, puuid)));
          position = pos || null;
        }
      }

      res.json({ asset, position });
    } catch (e) {
      console.error("[RiotAsset] get error:", e);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // GET /api/riot/trades/recent — recent real user trades on Riot assets (global feed)
  app.get("/api/riot/trades/recent", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const result = await db
        .select({
          id: riotTrades.id,
          type: riotTrades.type,
          shares: riotTrades.shares,
          pricePerShare: riotTrades.pricePerShare,
          executedAt: riotTrades.executedAt,
          gameName: riotAssets.gameName,
          tagLine: riotAssets.tagLine,
          userDisplay: users.displayName,
          userEmail: users.email,
        })
        .from(riotTrades)
        .innerJoin(riotAssets, eq(riotTrades.puuid, riotAssets.puuid))
        .innerJoin(portfolios, eq(riotTrades.portfolioId, portfolios.id))
        .innerJoin(users, eq(portfolios.userId, users.id))
        .orderBy(desc(riotTrades.executedAt))
        .limit(20);

      res.json(result.map(r => ({
        id: r.id,
        type: r.type,
        shares: r.shares,
        pricePerShare: r.pricePerShare,
        executedAt: r.executedAt,
        playerName: r.tagLine ? `${r.gameName}#${r.tagLine}` : r.gameName,
        trader: r.userDisplay || (r.userEmail ? r.userEmail.split("@")[0] : "Trader"),
      })));
    } catch (e) {
      console.error("[RiotTrades] recent error:", e);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // GET /api/riot/asset/:puuid/trades — recent trades for a specific riot asset
  app.get("/api/riot/asset/:puuid/trades", isAuthenticated, async (req: any, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const puuid = decodeURIComponent(req.params.puuid);
      const trades = await db
        .select()
        .from(riotTrades)
        .where(eq(riotTrades.puuid, puuid))
        .orderBy(desc(riotTrades.executedAt))
        .limit(50);
      res.json(trades);
    } catch (e) {
      console.error("[RiotAsset] get trades error:", e);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ──────────────────────────────────────────────────────────────
  //  Terminal Market API — unified endpoint for all modes
  // ──────────────────────────────────────────────────────────────

  app.get("/api/terminal/market", isAuthenticated, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const mode = await getMarketMode();
      const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
      const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "50"), 10)));
      const search = typeof req.query.search === "string" ? req.query.search : "";
      const sortField = String(req.query.sort || (mode === "REAL_RIOT_NA1" ? "leaguePoints" : "volume24h"));
      const order = req.query.order === "asc" ? "asc" : "desc";
      const offset = (page - 1) * limit;

      if (mode === "REAL_RIOT_NA1") {
        let baseQuery = db.select().from(riotAssets);

        const sortableFields: Record<string, any> = {
          leaguePoints: riotAssets.leaguePoints,
          lastTradePrice: riotAssets.lastTradePrice,
          volume24h: riotAssets.volume24h,
          winrate: riotAssets.winrate,
          gameName: riotAssets.gameName,
        };
        const sortCol = sortableFields[sortField] ?? riotAssets.leaguePoints;

        let rows;
        let total: number;

        if (search) {
          const pattern = `%${search}%`;
          rows = await db
            .select()
            .from(riotAssets)
            .where(
              or(
                ilike(riotAssets.gameName, pattern),
                ilike(riotAssets.tagLine, pattern)
              )
            )
            .orderBy(order === "asc" ? asc(sortCol) : desc(sortCol))
            .limit(limit)
            .offset(offset);

          const [{ count }] = await db
            .select({ count: sqlExpr<number>`count(*)` })
            .from(riotAssets)
            .where(
              or(
                ilike(riotAssets.gameName, pattern),
                ilike(riotAssets.tagLine, pattern)
              )
            );
          total = Number(count);
        } else {
          rows = await db
            .select()
            .from(riotAssets)
            .orderBy(order === "asc" ? asc(sortCol) : desc(sortCol))
            .limit(limit)
            .offset(offset);

          const [{ count }] = await db
            .select({ count: sqlExpr<number>`count(*)` })
            .from(riotAssets);
          total = Number(count);
        }

        const mappedRows = rows.map(r => ({
          id: r.puuid,
          displayName: r.tagLine ? `${r.gameName}#${r.tagLine}` : r.gameName,
          playerAlias: r.tagLine ? `${r.gameName}#${r.tagLine}` : r.gameName,
          rank: "Challenger",
          region: "NA1",
          leaguePoints: r.leaguePoints,
          wins: r.wins,
          losses: r.losses,
          winrate: r.winrate,
          performanceIndex: String(r.leaguePoints),
          momentum: r.momentum ?? "0.0000",
          lastTradePrice: r.lastTradePrice,
          price24hAgo: r.price24hAgo,
          volume24h: r.volume24h,
          lastSyncedAt: r.lastSyncedAt,
          mode: "REAL_RIOT_NA1" as const,
        }));

        res.json({
          mode,
          updatedAt: new Date().toISOString(),
          page,
          total,
          totalPages: Math.ceil(total / limit),
          rows: mappedRows,
        });
      } else {
        // SANDBOX mode — use existing vault storage
        const data = await storage.getVaults({
          page,
          limit,
          search: search.length > 2 ? search : undefined,
          rank: typeof req.query.rank === "string" ? req.query.rank : undefined,
          region: typeof req.query.region === "string" ? req.query.region : undefined,
          sort: sortField,
          order,
        });

        const mappedRows = data.data.map((v: any) => ({
          ...v,
          displayName: v.playerAlias,
          mode: "SANDBOX" as const,
        }));

        res.json({
          mode,
          updatedAt: new Date().toISOString(),
          page,
          total: data.total,
          totalPages: Math.ceil(data.total / limit),
          rows: mappedRows,
        });
      }
    } catch (e) {
      console.error("[TerminalMarket] error:", e);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ──────────────────────────────────────────────────────────────
  //  Canonical Market API (multi-provider / multi-game)
  //  Read-only endpoints — public, no auth required
  // ──────────────────────────────────────────────────────────────

  // ─── Market Heatmap (Canonical) ──────────────────────────────────────────────
  app.get("/api/market/heatmap", isAuthenticated, async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const rows = await db
        .select({
          id: assets.id,
          assetUid: assets.assetUid,
          displayName: assets.displayName,
          price: assets.lastTradePrice,
          price24hAgo: assets.price24hAgo,
          volume24h: assets.volume24h,
          momentum: assets.momentum,
        })
        .from(assets)
        .orderBy(desc(assets.volume24h))
        .limit(100);

      const result = rows.map((r) => {
        const price = parseFloat(String(r.price));
        const ago = parseFloat(String(r.price24hAgo));
        const change24h = ago > 0 ? ((price - ago) / ago) * 100 : 0;
        const vol = parseFloat(String(r.volume24h));
        return {
          assetId: r.id,
          assetUid: r.assetUid,
          displayName: r.displayName,
          price: price.toFixed(2),
          change24h: parseFloat(change24h.toFixed(3)),
          volume24h: vol.toFixed(2),
          marketCap: (price * Math.max(1, vol)).toFixed(2),
          momentum: parseFloat(String(r.momentum || "0")),
        };
      });

      res.json({ items: result, updatedAt: new Date().toISOString() });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Market Index (Canonical) ─────────────────────────────────────────────────
  app.get("/api/market/index", isAuthenticated, async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const rows = await db
        .select({
          price: assets.lastTradePrice,
          price24hAgo: assets.price24hAgo,
          volume24h: assets.volume24h,
          momentum: assets.momentum,
        })
        .from(assets)
        .where(and(
          eq(assets.listingStatus, "LISTED"),
          eq(assets.tradingStatus, "ACTIVE"),
        ));

      type Row = { price: number; ago: number; vol: number; mom: number };
      const parsed: Row[] = rows.map((r) => ({
        price: parseFloat(String(r.price)),
        ago: parseFloat(String(r.price24hAgo)),
        vol: parseFloat(String(r.volume24h)),
        mom: parseFloat(String(r.momentum || "0")),
      })).filter((r) => r.ago > 0 && r.price > 0 && isFinite(r.vol));

      const totalVol = parsed.reduce((s, r) => s + r.vol, 0) || 1;

      const vwChange = parsed.reduce((s, r) => {
        const chg = ((r.price - r.ago) / r.ago) * 100;
        return s + chg * (r.vol / totalVol);
      }, 0);

      // Top 20 by volume (replaces leaguePoints weighting — game-agnostic)
      const byVol = [...parsed].sort((a, b) => b.vol - a.vol).slice(0, 20);
      const topVol = byVol.reduce((s, r) => s + r.vol, 0) || 1;
      const topIndex = byVol.reduce((s, r) => {
        const chg = ((r.price - r.ago) / r.ago) * 100;
        return s + chg * (r.vol / topVol);
      }, 0);

      const gainers = parsed.filter((r) => r.price > r.ago).length;
      const losers = parsed.filter((r) => r.price < r.ago).length;
      const avgMom = parsed.reduce((s, r) => s + r.mom, 0) / (parsed.length || 1);

      res.json({
        overall: parseFloat(vwChange.toFixed(3)),
        topTwenty: parseFloat(topIndex.toFixed(3)),
        breadth: { gainers, losers, flat: parsed.length - gainers - losers },
        avgMomentum: parseFloat(avgMom.toFixed(6)),
        assetCount: parsed.length,
        updatedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ============================
  // MARKET ROUTES (Canonical Asset Registry)
  // ============================

  app.get("/api/market/assets", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
      const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "50"), 10)));
      const offset = (page - 1) * limit;

      const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
      const provider = typeof req.query.provider === "string" ? req.query.provider.trim() : "";
      const game = typeof req.query.game === "string" ? req.query.game.trim() : "";
      const region = typeof req.query.region === "string" ? req.query.region.trim() : "";
      const scope = typeof req.query.scope === "string" ? req.query.scope.trim() : "";

      const sortField = String(req.query.sort || "lastTradePrice");
      const order = req.query.order === "asc" ? "asc" : "desc";

      const sortable: Record<string, any> = {
        lastTradePrice: assets.lastTradePrice,
        volume24h: assets.volume24h,
        momentum: assets.momentum,
        displayName: assets.displayName,
        lastSyncedAt: assets.lastSyncedAt,
        updatedAt: assets.updatedAt,
      };
      const sortCol = sortable[sortField] ?? assets.lastTradePrice;

      const conditions: any[] = [];
      if (provider) conditions.push(eq(markets.provider, provider));
      if (game) conditions.push(eq(markets.game, game));
      if (region) conditions.push(eq(markets.region, region));
      if (scope) conditions.push(eq(markets.scope, scope));
      if (search) {
        const pattern = `%${search}%`;
        conditions.push(or(
          ilike(assets.displayName, pattern),
          ilike(assets.assetUid, pattern)
        ));
      }
      const whereClause = conditions.length ? and(...conditions) : undefined;

      const rows = await db
        .select({ asset: assets, market: markets })
        .from(assets)
        .innerJoin(markets, eq(assets.marketId, markets.id))
        .where(whereClause)
        .orderBy(order === "asc" ? asc(sortCol) : desc(sortCol))
        .limit(limit)
        .offset(offset);

      const [{ count }] = await db
        .select({ count: sqlExpr<number>`count(*)` })
        .from(assets)
        .innerJoin(markets, eq(assets.marketId, markets.id))
        .where(whereClause);

      const total = Number(count);
      res.json({
        updatedAt: new Date().toISOString(),
        page,
        total,
        totalPages: Math.ceil(total / limit),
        rows: rows.map(r => {
          const mid = parseFloat(String(r.asset.lastTradePrice)) || 0;
          const momentum = parseFloat(String(r.asset.momentum)) || 0;
          const vol = parseFloat(String(r.asset.volume24h)) || 0;
          const { bidPrice, askPrice, spreadPct } = computeQuotes(mid, momentum, vol);
          return {
            id: r.asset.id,
            assetUid: r.asset.assetUid,
            displayName: r.asset.displayName,
            lastTradePrice: r.asset.lastTradePrice,
            price24hAgo: r.asset.price24hAgo,
            volume24h: r.asset.volume24h,
            momentum: r.asset.momentum,
            lastSyncedAt: r.asset.lastSyncedAt,
            fundamentalPrice: r.asset.fundamentalPrice,
            fundamentalUpdatedAt: r.asset.fundamentalUpdatedAt,
            bidPrice: bidPrice.toFixed(2),
            askPrice: askPrice.toFixed(2),
            spreadPct: (spreadPct * 100).toFixed(3),
            market: {
              provider: r.market.provider,
              game: r.market.game,
              region: r.market.region,
              scope: r.market.scope,
            },
          };
        }),
      });
    } catch (e) {
      console.error("[CanonicalMarket] list error:", e);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // GET /api/market/featured — top assets enriched with optional operator mode data.
  // Supports ?pinnedId=<assetId> to always prepend a specific asset as the first card,
  // regardless of its volume rank. The pinned asset gets full operator enrichment
  // (missions fetched even without a formal operator access record — useful for testing).
  app.get("/api/market/featured", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const limit = Math.min(50, Math.max(5, parseInt(String(req.query.limit || "50"), 10)));
      const game = typeof req.query.game === "string" && req.query.game.trim() ? req.query.game.trim() : "dota2";
      const pinnedId = req.query.pinnedId ? parseInt(String(req.query.pinnedId), 10) : null;

      type EnrichedRow = {
        id: number; assetUid: string; displayName: string; lastTradePrice: any; price24hAgo: any;
        volume24h: any; momentum: any; lastSyncedAt: any; fundamentalPrice: any; fundamentalUpdatedAt: any;
        bidPrice: string; askPrice: string; spreadPct: string;
        market: { provider: string; game: string; region: string; scope: string };
        cardImageUrl?: string | null;
        operatorMode?: { hasOperatorMode: true; followers?: number; mission?: { title: string; description: string | null; progressPct: number; participantsCount: number } };
      };

      function buildRow(r: { asset: typeof assets.$inferSelect; market: typeof markets.$inferSelect }, opMode?: EnrichedRow["operatorMode"], cardImageUrl?: string | null): EnrichedRow {
        const mid = parseFloat(String(r.asset.lastTradePrice)) || 0;
        const momentum = parseFloat(String(r.asset.momentum)) || 0;
        const vol = parseFloat(String(r.asset.volume24h)) || 0;
        const { bidPrice, askPrice, spreadPct } = computeQuotes(mid, momentum, vol);
        return {
          id: r.asset.id,
          assetUid: r.asset.assetUid,
          displayName: r.asset.displayName,
          lastTradePrice: r.asset.lastTradePrice,
          price24hAgo: r.asset.price24hAgo,
          volume24h: r.asset.volume24h,
          momentum: r.asset.momentum,
          lastSyncedAt: r.asset.lastSyncedAt,
          fundamentalPrice: r.asset.fundamentalPrice,
          fundamentalUpdatedAt: r.asset.fundamentalUpdatedAt,
          bidPrice: bidPrice.toFixed(2),
          askPrice: askPrice.toFixed(2),
          spreadPct: (spreadPct * 100).toFixed(3),
          market: { provider: r.market.provider, game: r.market.game, region: r.market.region, scope: r.market.scope },
          cardImageUrl: cardImageUrl ?? null,
          operatorMode: opMode,
        };
      }

      // 1. Fetch pinned asset (if requested), in parallel with top-volume assets.
      // The pinned asset must belong to the same game as the active filter so
      // that a Dota2 pinned asset (Skid_Row) never bleeds into a CS2 view.
      const [pinnedRows, volumeRows] = await Promise.all([
        pinnedId
          ? db.select({ asset: assets, market: markets })
              .from(assets).innerJoin(markets, eq(assets.marketId, markets.id))
              .where(and(eq(assets.id, pinnedId), eq(markets.game, game))).limit(1)
          : Promise.resolve([]),
        db.select({ asset: assets, market: markets })
          .from(assets).innerJoin(markets, eq(assets.marketId, markets.id))
          .where(eq(markets.game, game))
          .orderBy(desc(assets.volume24h))
          .limit(limit),
      ]);

      if (volumeRows.length === 0 && pinnedRows.length === 0) return res.json({ rows: [] });

      // Main pool: exclude pinnedId from volume rows to avoid duplicate
      const mainRows = pinnedId ? volumeRows.filter(r => r.asset.id !== pinnedId) : volumeRows;
      const allAssetIds = mainRows.map(r => r.asset.id);
      const lookupIds = pinnedId ? [...allAssetIds, pinnedId] : allAssetIds;

      // 2. Operator access — which assets have a claimed operator?
      const operatorAccessRows = lookupIds.length > 0
        ? await db.select({ assetId: playerOperatorAccess.assetId })
            .from(playerOperatorAccess)
            .where(inArray(playerOperatorAccess.assetId, lookupIds))
        : [];
      const operatorAssetIdSet = new Set(operatorAccessRows.map(r => r.assetId));

      // 3. For the pinned asset, also fetch missions regardless of operator access
      //    (allows testing enriched cards even before a formal claim is approved).
      const missionLookupIds = pinnedId
        ? [...new Set([...operatorAssetIdSet, pinnedId])]
        : [...operatorAssetIdSet];

      const snapshotMap = new Map<number, typeof playerOperatorSnapshots.$inferSelect>();
      const missionMap = new Map<number, typeof playerMissions.$inferSelect>();
      const cardImageMap = new Map<number, string>();

      if (missionLookupIds.length > 0) {
        const [snapshots, missions, cardImageRows] = await Promise.all([
          db.select().from(playerOperatorSnapshots).where(inArray(playerOperatorSnapshots.assetId, missionLookupIds)),
          db.select().from(playerMissions).where(
            and(inArray(playerMissions.assetId, missionLookupIds), eq(playerMissions.status, "active"))
          ).orderBy(desc(playerMissions.updatedAt)),
          db.select({ assetId: playerCardVisuals.assetId, publicUrl: mediaAssets.publicUrl })
            .from(playerCardVisuals)
            .innerJoin(mediaAssets, eq(playerCardVisuals.mediaAssetId, mediaAssets.id))
            .where(inArray(playerCardVisuals.assetId, missionLookupIds))
            .orderBy(desc(playerCardVisuals.createdAt)),
        ]);
        for (const s of snapshots) snapshotMap.set(s.assetId, s);
        for (const m of missions) { if (!missionMap.has(m.assetId)) missionMap.set(m.assetId, m); }
        for (const c of cardImageRows) { if (!cardImageMap.has(c.assetId)) cardImageMap.set(c.assetId, c.publicUrl); }
      }

      // 4. Operator mode builder
      function buildOperatorMode(assetId: number): EnrichedRow["operatorMode"] {
        const hasAccess = operatorAssetIdSet.has(assetId);
        const isPinned = assetId === pinnedId;
        const snap = snapshotMap.get(assetId);
        const mission = missionMap.get(assetId);
        // Show enrichment if: has formal access, OR is pinned and has at least a mission
        if (!hasAccess && !(isPinned && mission)) return undefined;
        return {
          hasOperatorMode: true,
          // Only show followers if snapshot exists with real data
          followers: snap && snap.holdersTotal > 0 ? snap.holdersTotal : undefined,
          mission: mission ? {
            title: mission.title,
            description: mission.description ?? null,
            progressPct: parseFloat(String(mission.progressPercentage)) || 0,
            participantsCount: mission.participantsCount,
          } : undefined,
        };
      }

      // 5. Build enriched response
      const pinnedEnriched: EnrichedRow[] = pinnedRows.length > 0
        ? [buildRow(pinnedRows[0], buildOperatorMode(pinnedRows[0].asset.id), cardImageMap.get(pinnedRows[0].asset.id) ?? null)]
        : [];
      const mainEnriched = mainRows.map(r => buildRow(r, buildOperatorMode(r.asset.id), cardImageMap.get(r.asset.id) ?? null));

      res.json({ rows: [...pinnedEnriched, ...mainEnriched] });
    } catch (e) {
      console.error("[FeaturedMarket] error:", e);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/market/assets/:id", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid asset id" });

      const [row] = await db
        .select({ asset: assets, market: markets })
        .from(assets)
        .innerJoin(markets, eq(assets.marketId, markets.id))
        .where(eq(assets.id, id))
        .limit(1);

      if (!row) return res.status(404).json({ message: "Asset not found" });
      res.json({ asset: row.asset, market: row.market });
    } catch (e) {
      console.error("[CanonicalMarket] get error:", e);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/market/assets/:id/snapshots", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid asset id" });

      const tf = (req.query.tf as string) || "24h";
      const now = new Date();
      let cutoff: Date;
      switch (tf) {
        case "7d":  cutoff = new Date(now.getTime() - 7 * 86400000); break;
        case "30d": cutoff = new Date(now.getTime() - 30 * 86400000); break;
        default:    cutoff = new Date(now.getTime() - 86400000); break;
      }

      const snaps = await db
        .select()
        .from(assetPriceSnapshots)
        .where(and(
          eq(assetPriceSnapshots.assetId, id),
          gte(assetPriceSnapshots.recordedAt, cutoff)
        ))
        .orderBy(asc(assetPriceSnapshots.recordedAt))
        .limit(1000);

      res.json({ assetId: id, snapshots: snaps, tf });
    } catch (e) {
      console.error("[CanonicalMarket] snapshots error:", e);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ──────────────────────────────────────────────────────────────
  //  AMM Quote endpoint — get price/impact before trading
  // ──────────────────────────────────────────────────────────────

  app.get("/api/riot/quote", isAuthenticated, async (req, res) => {
    try {
      const puuid = String(req.query.puuid || "");
      const type = String(req.query.type || "BUY") as "BUY" | "SELL";
      const shares = Math.max(1, parseInt(String(req.query.shares || "1"), 10));

      if (!puuid) return res.status(400).json({ message: "puuid required" });

      const [assetsRow] = await db.select({ id: assets.id, lastTradePrice: assets.lastTradePrice })
        .from(assets).where(eq(assets.externalId, puuid)).limit(1);

      if (!assetsRow) return res.status(404).json({ message: "Asset not found" });

      const [mkt] = await db.select().from(assetMarkets)
        .where(eq(assetMarkets.assetId, assetsRow.id));
      const [st] = await db.select().from(assetMarketState)
        .where(eq(assetMarketState.assetId, assetsRow.id));

      if (!mkt || !st || !mkt.isEnabled) {
        return res.json({ ammEnabled: false, message: "AMM not seeded for this asset" });
      }

      const p = {
        floorPrice: parseFloat(mkt.floorPrice),
        paramA: parseFloat(mkt.paramA),
        paramB: parseFloat(mkt.paramB),
      };
      const supply = parseFloat(st.supply);
      const currentSpot = spotPrice(supply, p);

      let notional: number;
      let avgPrice: number;
      if (type === "BUY") {
        notional = costToBuy(supply, shares, p);
        avgPrice = notional / shares;
      } else {
        if (supply < shares) {
          return res.json({ ammEnabled: true, error: "Insufficient market liquidity", supply: supply.toFixed(2) });
        }
        notional = payoutToSell(supply, shares, p);
        avgPrice = notional / shares;
      }

      const impact = priceImpactPct(supply, shares, type, p);
      const feeBpsVal = mkt.feeBps;
      const feeAmount = notional * feeBpsVal / 10000;
      const newSupply = type === "BUY" ? supply + shares : Math.max(0, supply - shares);
      const newSpot = spotPrice(newSupply, p);

      res.json({
        ammEnabled: true,
        assetId: assetsRow.id,
        type,
        shares,
        currentSpot: currentSpot.toFixed(2),
        avgPrice: avgPrice.toFixed(4),
        notional: notional.toFixed(4),
        feeAmount: feeAmount.toFixed(4),
        feeBps: feeBpsVal,
        priceImpactPct: impact.toFixed(4),
        newSpot: newSpot.toFixed(2),
        supply: supply.toFixed(2),
      });
    } catch (e) {
      console.error("[Quote] error:", e);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ──────────────────────────────────────────────────────────────
  //  CANONICAL TRADE PATH  (Fase 20)
  // ──────────────────────────────────────────────────────────────

  // GET /api/market/assets/:assetId/quote — canonical quote (replaces /api/riot/quote)
  app.get("/api/market/assets/:assetId/quote", isAuthenticated, async (req, res) => {
    try {
      const assetId = parseInt(String(req.params.assetId), 10);
      if (isNaN(assetId)) return res.status(400).json({ message: "Invalid assetId" });
      const type = String(req.query.type || "BUY") as "BUY" | "SELL";
      const shares = Math.max(1, parseInt(String(req.query.shares || "1"), 10));

      const [asset] = await db.select().from(assets).where(eq(assets.id, assetId));
      if (!asset) return res.status(404).json({ message: "Asset not found" });

      const [mkt] = await db.select().from(assetMarkets).where(eq(assetMarkets.assetId, assetId));
      const [st] = await db.select().from(assetMarketState).where(eq(assetMarketState.assetId, assetId));

      if (!mkt || !st || !mkt.isEnabled) {
        return res.json({ ammEnabled: false, message: "AMM not seeded for this asset" });
      }

      const p = {
        floorPrice: parseFloat(mkt.floorPrice),
        paramA: parseFloat(mkt.paramA),
        paramB: parseFloat(mkt.paramB),
      };
      const supply = parseFloat(st.supply);
      const currentSpot = spotPrice(supply, p);

      let notional: number;
      let avgPrice: number;
      if (type === "BUY") {
        notional = costToBuy(supply, shares, p);
        avgPrice = notional / shares;
      } else {
        if (supply < shares) {
          return res.json({ ammEnabled: true, error: "Insufficient market liquidity", supply: supply.toFixed(2) });
        }
        notional = payoutToSell(supply, shares, p);
        avgPrice = notional / shares;
      }

      const impact = priceImpactPct(supply, shares, type, p);
      const feeBpsVal = mkt.feeBps;
      const feeAmount = notional * feeBpsVal / 10000;
      const newSupply = type === "BUY" ? supply + shares : Math.max(0, supply - shares);
      const newSpot = spotPrice(newSupply, p);

      res.json({
        ammEnabled: true,
        assetId,
        type,
        shares,
        currentSpot: currentSpot.toFixed(2),
        avgPrice: avgPrice.toFixed(4),
        notional: notional.toFixed(4),
        feeAmount: feeAmount.toFixed(4),
        feeBps: feeBpsVal,
        priceImpactPct: impact.toFixed(4),
        newSpot: newSpot.toFixed(2),
        supply: supply.toFixed(2),
      });
    } catch (e) {
      console.error("[CanonicalQuote] error:", e);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // POST /api/market/assets/:assetId/trade — canonical trade execution
  app.post("/api/market/assets/:assetId/trade", isAuthenticated, async (req: any, res) => {
    try {
      const assetId = parseInt(String(req.params.assetId), 10);
      if (isNaN(assetId)) return res.status(400).json({ message: "Invalid assetId" });
      const userId = (req.user as any)?.claims?.sub || (req.user as any)?.id || req.session?.userId;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const { type, shares } = req.body;
      if (!type || !["BUY", "SELL"].includes(type)) return res.status(400).json({ message: "type must be BUY or SELL" });
      const parsedShares = parseInt(String(shares), 10);
      if (isNaN(parsedShares) || parsedShares < 1) return res.status(400).json({ message: "shares must be a positive integer" });

      const result = await executeAssetTrade({ userId, assetId, type, shares: parsedShares });
      res.json(result);
    } catch (e: any) {
      if (e instanceof AssetTradeError) {
        return res.status(e.statusCode).json({ message: e.message });
      }
      console.error("[CanonicalTrade] error:", e);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // GET /api/market/trades/recent — global recent trades feed (canonical, replaces /api/riot/trades/recent)
  app.get("/api/market/trades/recent", async (req, res) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      const limit = Math.min(50, parseInt(String(req.query.limit || "30"), 10));
      const rows = await db
        .select({
          id: assetTrades.id,
          type: assetTrades.type,
          shares: assetTrades.shares,
          pricePerShare: assetTrades.pricePerShare,
          grossValue: assetTrades.grossValue,
          executedAt: assetTrades.executedAt,
          assetId: assets.id,
          displayName: assets.displayName,
          symbol: assets.symbol,
        })
        .from(assetTrades)
        .innerJoin(assets, eq(assetTrades.assetId, assets.id))
        .orderBy(desc(assetTrades.executedAt))
        .limit(limit);

      res.json(rows.map(r => ({
        id: r.id,
        type: r.type,
        shares: r.shares,
        pricePerShare: r.pricePerShare,
        grossValue: r.grossValue,
        executedAt: r.executedAt,
        assetId: r.assetId,
        playerName: r.displayName,
        symbol: r.symbol,
      })));
    } catch (e) {
      console.error("[CanonicalTrades] recent error:", e);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // GET /api/market/assets/:assetId/fundamentals — canonical, game-agnostic fundamentals
  // For LoL assets: delegates to performance provider (same data as /api/player/fundamentals/:puuid)
  // For Dota2 assets: reads dota2ValuationState + assets.fundamentalPrice
  // For other assets: returns minimal structure from assets table
  app.get("/api/market/assets/:assetId/fundamentals", isAuthenticated, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const assetId = parseInt(String(req.params.assetId), 10);
      if (isNaN(assetId)) return res.status(400).json({ error: "Invalid assetId" });

      const [asset] = await db
        .select({
          id: assets.id,
          assetUid: assets.assetUid,
          externalId: assets.externalId,
          displayName: assets.displayName,
          lastTradePrice: assets.lastTradePrice,
          fundamentalPrice: assets.fundamentalPrice,
          momentum: assets.momentum,
          volume24h: assets.volume24h,
        })
        .from(assets)
        .where(eq(assets.id, assetId));

      if (!asset) return res.status(404).json({ error: "Asset not found" });

      const uid: string = asset.assetUid ?? "";
      const isLoL = uid.startsWith("riot:lol");
      const isDota2 = uid.startsWith("dota2:");

      if (isLoL) {
        // Delegate to existing LoL performance provider
        const puuid = uid.split(":").slice(3).join(":");
        const provider = await getPerformanceProvider();
        const fundamentals = await provider.getPlayerFundamentals(puuid);
        if (!fundamentals) return res.status(404).json({ error: "Player not found" });
        const games = fundamentals.wins + fundamentals.losses;
        return res.json({
          provider: "riot:lol",
          wins: fundamentals.wins,
          losses: fundamentals.losses,
          games,
          winRate: parseFloat(fundamentals.winrate.toFixed(1)),
          leaguePoints: fundamentals.leaguePoints,
          momentum: fundamentals.momentum,
          recentPerformance: fundamentals.recentPerformance,
          consistencyScore: fundamentals.consistencyScore,
          historicalSkill: fundamentals.historicalSkill,
          activityScore: fundamentals.activityScore,
          pviRaw: fundamentals.pviRaw,
          pviFinal: fundamentals.pviFinal,
          fairValueGS: fundamentals.fairValueGS,
          divergencePct: fundamentals.divergencePct,
          confidence: fundamentals.confidence,
          lastMatchPulse: fundamentals.lastMatchPulse,
        });
      }

      if (isDota2) {
        const [valState] = await db
          .select()
          .from(dota2ValuationState)
          .where(eq(dota2ValuationState.assetId, assetId));

        const price = parseFloat(String(asset.lastTradePrice));
        const fv = valState
          ? parseFloat(String(valState.playerValue))
          : asset.fundamentalPrice
            ? parseFloat(String(asset.fundamentalPrice))
            : null;
        const divergencePct = fv && fv > 0 ? ((price - fv) / fv) * 100 : null;
        const confidence = valState ? parseFloat(String(valState.confidenceScore)) * 100 : null;
        const recentPerf = valState?.lastPerformanceScore
          ? parseFloat(String(valState.lastPerformanceScore))
          : null;
        const matchesCount = valState?.matchesCount ?? 0;

        // Derive momentum from selfTrendScore (canonical Dota2 trend signal).
        // Normalize from 0-100 scale to a ±0.5 float range so it's compatible
        // with the LoL momentum scale and existing frontend thresholds.
        let dota2Momentum: number = parseFloat(String(asset.momentum || "0"));
        if (valState?.playerProfileId) {
          const [latestScore] = await db
            .select({ selfTrendScore: dota2PerformanceScores.selfTrendScore })
            .from(dota2PerformanceScores)
            .where(eq(dota2PerformanceScores.playerProfileId, valState.playerProfileId))
            .orderBy(desc(dota2PerformanceScores.createdAt))
            .limit(1);
          if (latestScore?.selfTrendScore != null) {
            const raw = parseFloat(String(latestScore.selfTrendScore));
            dota2Momentum = parseFloat(((raw - 50) / 100).toFixed(4));
          }
        }

        return res.json({
          provider: "dota2",
          wins: null,
          losses: null,
          games: matchesCount,
          winRate: null,
          leaguePoints: null,
          momentum: dota2Momentum,
          recentPerformance: recentPerf,
          consistencyScore: null,
          historicalSkill: null,
          activityScore: null,
          pviRaw: null,
          pviFinal: recentPerf,
          fairValueGS: fv,
          divergencePct: divergencePct ? parseFloat(divergencePct.toFixed(2)) : null,
          confidence: confidence ? parseFloat(confidence.toFixed(1)) : null,
          lastMatchPulse: null,
        });
      }

      // Fallback: minimal structure for any other asset
      const price = parseFloat(String(asset.lastTradePrice));
      const fv = asset.fundamentalPrice ? parseFloat(String(asset.fundamentalPrice)) : null;
      const divergencePct = fv && fv > 0 ? ((price - fv) / fv) * 100 : null;
      return res.json({
        provider: "canonical",
        wins: null,
        losses: null,
        games: null,
        winRate: null,
        leaguePoints: null,
        momentum: parseFloat(String(asset.momentum || "0")),
        recentPerformance: null,
        consistencyScore: null,
        historicalSkill: null,
        activityScore: null,
        pviRaw: null,
        pviFinal: null,
        fairValueGS: fv,
        divergencePct: divergencePct ? parseFloat(divergencePct.toFixed(2)) : null,
        confidence: null,
        lastMatchPulse: null,
      });
    } catch (err: any) {
      console.error("[AssetFundamentals]", err);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/market/assets/:id/performance — canonical, game-agnostic performance surface
  // Returns a unified performance shape regardless of game/provider.
  // LoL: queries performanceScores table (puuid resolved internally from assetUid).
  // Dota2: reads dota2ValuationState (lastPerformanceScore, confidenceScore, matchesCount).
  // Others: null-safe minimal shape.
  app.get("/api/market/assets/:assetId/performance", isAuthenticated, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const assetId = parseInt(String(req.params.assetId), 10);
      if (isNaN(assetId)) return res.status(400).json({ error: "Invalid assetId" });

      const [asset] = await db
        .select({
          id: assets.id,
          assetUid: assets.assetUid,
          momentum: assets.momentum,
          updatedAt: assets.updatedAt,
        })
        .from(assets)
        .where(eq(assets.id, assetId));

      if (!asset) return res.status(404).json({ error: "Asset not found" });

      const uid: string = asset.assetUid ?? "";
      const isLoL = uid.startsWith("riot:lol");
      const isDota2 = uid.startsWith("dota2:");

      const uidParts = uid.split(":");
      // e.g. "riot:lol:player:<puuid>" → game = "lol"
      // e.g. "dota2:dota2:player:<accountId>" → game = "dota2"
      const game = uidParts[1] ?? "unknown";

      if (isLoL) {
        const puuid = uidParts.slice(3).join(":");
        const [score] = await db
          .select({
            role: performanceScores.role,
            matchScore: performanceScores.matchScore,
            emaScore: performanceScores.emaScore,
            createdAt: performanceScores.createdAt,
          })
          .from(performanceScores)
          .where(eq(performanceScores.assetId, puuid))
          .orderBy(desc(performanceScores.createdAt))
          .limit(1);

        return res.json({
          assetId,
          game,
          provider: "riot:lol",
          latestPerformanceScore: score ? parseFloat(String(score.emaScore)) : null,
          trend: null,
          confidence: null,
          matchesCount: null,
          role: score?.role ?? null,
          source: "performance_scores",
          updatedAt: score?.createdAt?.toISOString() ?? asset.updatedAt.toISOString(),
        });
      }

      if (isDota2) {
        const [valState] = await db
          .select({
            lastPerformanceScore: dota2ValuationState.lastPerformanceScore,
            confidenceScore: dota2ValuationState.confidenceScore,
            matchesCount: dota2ValuationState.matchesCount,
            playerProfileId: dota2ValuationState.playerProfileId,
            updatedAt: dota2ValuationState.updatedAt,
          })
          .from(dota2ValuationState)
          .where(eq(dota2ValuationState.assetId, assetId));

        let trend: number | null = null;
        if (valState?.playerProfileId) {
          const [latestScore] = await db
            .select({ selfTrendScore: dota2PerformanceScores.selfTrendScore })
            .from(dota2PerformanceScores)
            .where(eq(dota2PerformanceScores.playerProfileId, valState.playerProfileId))
            .orderBy(desc(dota2PerformanceScores.createdAt))
            .limit(1);
          if (latestScore?.selfTrendScore != null) {
            trend = parseFloat(String(latestScore.selfTrendScore));
          }
        }

        return res.json({
          assetId,
          game,
          provider: "dota2",
          latestPerformanceScore: valState?.lastPerformanceScore != null
            ? parseFloat(String(valState.lastPerformanceScore))
            : null,
          trend,
          confidence: valState?.confidenceScore != null
            ? parseFloat((parseFloat(String(valState.confidenceScore)) * 100).toFixed(1))
            : null,
          matchesCount: valState?.matchesCount ?? null,
          role: null,
          source: "dota2_valuation_state",
          updatedAt: valState?.updatedAt?.toISOString() ?? asset.updatedAt.toISOString(),
        });
      }

      // Fallback for any other game/provider
      return res.json({
        assetId,
        game,
        provider: "canonical",
        latestPerformanceScore: null,
        trend: null,
        confidence: null,
        matchesCount: null,
        role: null,
        source: "none",
        updatedAt: asset.updatedAt.toISOString(),
      });
    } catch (err: any) {
      console.error("[AssetPerformance]", err);
      res.status(500).json({ error: err.message });
    }
  });

  // ──────────────────────────────────────────────────────────────
  //  SSE terminal stream  GET /api/terminal/stream
  // ──────────────────────────────────────────────────────────────

  app.get("/api/terminal/stream", (req: any, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const remove = terminalBroadcaster.addClient(res);

    res.write(`event: HEARTBEAT\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);

    req.on("close", () => {
      remove();
    });
  });
}

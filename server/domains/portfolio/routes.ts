import type { Express, RequestHandler } from "express";
import { db } from "../../db";
import { storage } from "../../storage";
import { api } from "@shared/routes";
import { riotPositions, riotAssets, riotTrades, assetPositions, assetTrades, assets } from "@shared/schema";
import { eq, and, desc, sql as sqlExpr } from "drizzle-orm";

const isAuthenticated: RequestHandler = (req: any, res, next) => {
  if (req.session?.isAdmin || req.session?.userId) return next();
  if (typeof req.isAuthenticated === "function" && req.isAuthenticated()) return next();
  return res.status(401).json({ message: "Unauthorized" });
};

export function registerPortfolioRoutes(app: Express): void {
  // ============================
  // PORTFOLIO ROUTES
  // ============================

  // Get Portfolio
  app.get(api.portfolio.get.path, isAuthenticated, async (req, res) => {
    try {
      const userId = (req.user as any).claims?.sub || (req.user as any).id;
      let portfolio = await storage.getPortfolioByUserId(userId);

      if (!portfolio) {
        portfolio = await storage.createPortfolio({ userId, balance: "10000.00" });
      }

      // LEGACY: Sandbox positions (positions table joined with vaults)
      // FREEZE: Do not extend sandbox position logic. New position features go in Riot positions.
      // Official path: riotPositions table → /api/portfolio (riotOut section below)
      // Retirement: remove sandboxOut merge once sandbox trading is retired.
      // Sandbox positions (positions table joined with vaults)
      const rawSandboxPositions = await storage.getPositionsByPortfolioId(portfolio.id);

      // Riot/NA1 positions (riot_positions table joined with riot_assets)
      const rawRiotPositions = await db
        .select({ pos: riotPositions, asset: riotAssets })
        .from(riotPositions)
        .innerJoin(riotAssets, eq(riotPositions.puuid, riotAssets.puuid))
        .where(and(eq(riotPositions.portfolioId, portfolio.id), sqlExpr`${riotPositions.shares} > 0`));

      // Canonical asset positions (asset_positions joined with assets)
      const rawCanonicalPositions = await db
        .select({ pos: assetPositions, asset: assets })
        .from(assetPositions)
        .innerJoin(assets, eq(assetPositions.assetId, assets.id))
        .where(and(eq(assetPositions.userId, userId), sqlExpr`${assetPositions.shares} > 0`));

      let totalHoldingsValue = 0;

      const sandboxOut = rawSandboxPositions.map(p => {
        const currentValue = p.shares * parseFloat(p.vault.lastTradePrice);
        const costBasis = p.shares * parseFloat(p.averageCost);
        const unrealizedPnL = currentValue - costBasis;
        const unrealizedPnLPercent = costBasis > 0 ? (unrealizedPnL / costBasis) * 100 : 0;
        totalHoldingsValue += currentValue;
        return {
          ...p,
          source: "SANDBOX" as const,
          displayName: p.vault.playerAlias,
          badge: p.vault.region,
          link: `/vault/${p.vaultId}`,
          marketPrice: p.vault.lastTradePrice,
          currentValue: currentValue.toFixed(2),
          unrealizedPnL: unrealizedPnL.toFixed(2),
          unrealizedPnLPercent: unrealizedPnLPercent.toFixed(2),
        };
      });

      const riotOut = rawRiotPositions.map(({ pos, asset }) => {
        const currentValue = pos.shares * parseFloat(asset.lastTradePrice);
        const costBasis = pos.shares * parseFloat(pos.averageCost);
        const unrealizedPnL = currentValue - costBasis;
        const unrealizedPnLPercent = costBasis > 0 ? (unrealizedPnL / costBasis) * 100 : 0;
        totalHoldingsValue += currentValue;
        return {
          id: pos.id,
          portfolioId: pos.portfolioId,
          shares: pos.shares,
          averageCost: pos.averageCost,
          updatedAt: pos.updatedAt,
          source: "RIOT_NA1" as const,
          puuid: pos.puuid,
          displayName: `${asset.gameName}#${asset.tagLine}`,
          badge: "NA1",
          link: `/player/${encodeURIComponent(pos.puuid)}`,
          marketPrice: asset.lastTradePrice,
          currentValue: currentValue.toFixed(2),
          unrealizedPnL: unrealizedPnL.toFixed(2),
          unrealizedPnLPercent: unrealizedPnLPercent.toFixed(2),
          riotAsset: asset,
        };
      });

      const canonicalOut = rawCanonicalPositions.map(({ pos, asset }) => {
        const currentValue = pos.shares * parseFloat(asset.lastTradePrice);
        const costBasis = pos.shares * parseFloat(pos.averageCost);
        const unrealizedPnL = currentValue - costBasis;
        const unrealizedPnLPercent = costBasis > 0 ? (unrealizedPnL / costBasis) * 100 : 0;
        totalHoldingsValue += currentValue;
        return {
          id: pos.id,
          userId: pos.userId,
          assetId: pos.assetId,
          shares: pos.shares,
          averageCost: pos.averageCost,
          updatedAt: pos.updatedAt,
          source: "CANONICAL" as const,
          displayName: asset.displayName,
          badge: asset.symbol || "",
          link: `/terminal`,
          marketPrice: asset.lastTradePrice,
          currentValue: currentValue.toFixed(2),
          unrealizedPnL: unrealizedPnL.toFixed(2),
          unrealizedPnLPercent: unrealizedPnLPercent.toFixed(2),
        };
      });

      const allPositions = [...sandboxOut, ...riotOut, ...canonicalOut];
      const totalValue = parseFloat(portfolio.balance) + totalHoldingsValue;

      res.json({
        portfolio,
        stats: {
          balance: portfolio.balance,
          totalHoldingsValue: totalHoldingsValue.toFixed(2),
          totalValue: totalValue.toFixed(2),
          realizedPnL: "0.00",
        },
        positions: allPositions,
      });

    } catch (e) {
      console.error("[Portfolio] error:", e);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // GET /api/terminal/activity/me — authenticated user's own trades (riot + canonical)
  app.get("/api/terminal/activity/me", isAuthenticated, async (req: any, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const userId = (req.user as any).claims?.sub || (req.user as any).id || req.session?.userId;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const limit = Math.min(50, parseInt(String(req.query.limit || "30"), 10));
      const portfolio = await storage.getPortfolioByUserId(userId);

      const [riotResult, canonicalResult] = await Promise.all([
        portfolio
          ? db
              .select({
                id: riotTrades.id,
                type: riotTrades.type,
                shares: riotTrades.shares,
                pricePerShare: riotTrades.pricePerShare,
                executedAt: riotTrades.executedAt,
                gameName: riotAssets.gameName,
                tagLine: riotAssets.tagLine,
                puuid: riotAssets.puuid,
              })
              .from(riotTrades)
              .innerJoin(riotAssets, eq(riotTrades.puuid, riotAssets.puuid))
              .where(eq(riotTrades.portfolioId, portfolio.id))
              .orderBy(desc(riotTrades.executedAt))
              .limit(limit)
          : Promise.resolve([]),
        db
          .select({
            id: assetTrades.id,
            type: assetTrades.type,
            shares: assetTrades.shares,
            pricePerShare: assetTrades.pricePerShare,
            executedAt: assetTrades.executedAt,
            displayName: assets.displayName,
            assetId: assets.id,
          })
          .from(assetTrades)
          .innerJoin(assets, eq(assetTrades.assetId, assets.id))
          .where(eq(assetTrades.userId, userId))
          .orderBy(desc(assetTrades.executedAt))
          .limit(limit),
      ]);

      const riotOut = riotResult.map(r => ({
        id: `riot-${r.id}`,
        type: r.type,
        shares: r.shares,
        pricePerShare: r.pricePerShare,
        executedAt: r.executedAt,
        playerName: r.tagLine ? `${r.gameName}#${r.tagLine}` : r.gameName,
        puuid: r.puuid,
        source: "RIOT_NA1",
      }));

      const canonicalOut = canonicalResult.map(r => ({
        id: `asset-${r.id}`,
        type: r.type,
        shares: r.shares,
        pricePerShare: r.pricePerShare,
        executedAt: r.executedAt,
        playerName: r.displayName,
        assetId: r.assetId,
        source: "CANONICAL",
      }));

      const combined = [...riotOut, ...canonicalOut]
        .sort((a, b) => new Date(b.executedAt).getTime() - new Date(a.executedAt).getTime())
        .slice(0, limit);

      res.json(combined);
    } catch (e) {
      console.error("[Terminal] activity/me error:", e);
      res.status(500).json({ message: "Internal server error" });
    }
  });
}

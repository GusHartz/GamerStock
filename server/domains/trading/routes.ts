import type { Express, RequestHandler } from "express";
import { db } from "../../db";
import { storage } from "../../storage";
import { api } from "@shared/routes";
import { z } from "zod";
import crypto from "crypto";
import {
  vaults,
  portfolios,
  positions,
  trades,
  assets,
  assetPriceSnapshots,
  idempotencyKeys,
  ledgerEntries,
} from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { executeRiotTrade, TradeError } from "../../services/tradeExecutor";
import { computeQuotes } from "@shared/market-quotes";
import { marketHub } from "../../ws/market-hub";
import { updateArenaOnTrade } from "../../arena";
import { generateDummyPlayers } from "../../simulation/players/dummy-player-generator";

const isAuthenticated: RequestHandler = (req: any, res, next) => {
  if (req.session?.isAdmin || req.session?.userId) return next();
  if (typeof req.isAuthenticated === "function" && req.isAuthenticated()) return next();
  return res.status(401).json({ message: "Unauthorized" });
};

export function registerTradingRoutes(app: Express): void {
  // ============================
  // LEGACY / SANDBOX ROUTES
  // ============================
  //
  // FREEZE: Do not add new features in this section.
  // These routes serve the original vault/fake-player sandbox model.
  //
  // Official trading path: executeRiotTrade() via /api/riot/trade (Riot market)
  // Official players:      /api/market/assets, /api/riot/players
  //
  // Retirement:
  //   POST /api/seed          → REMOVE once sandbox mode is not default
  //   POST /api/trade         → MIGRATE to /api/riot/trade if sandbox mode is dropped
  //   GET  /api/trades/recent → REMOVE (duplicated by /api/riot/trades/recent)
  //
  // See: docs/architecture/legacy-freeze-and-retirement-plan.md

  // Initial seed endpoint
  app.post(api.seed.execute.path, async (req, res) => {
    try {
      const { total } = await storage.getVaults({ limit: 1 });
      if (total === 0) {
        const players = generateDummyPlayers();
        for (const player of players) {
          const vault = await storage.createVault(player);
          // Create initial snapshot
          await storage.createVaultSnapshot({
            vaultId: vault.id,
            price: vault.lastTradePrice,
            performanceIndex: vault.performanceIndex
          });
        }
        res.json({ message: "Seeded 1000 players successfully." });
      } else {
        res.json({ message: "Database already seeded." });
      }
    } catch (e) {
      console.error(e);
      res.status(500).json({ message: "Failed to seed database." });
    }
  });

  // ============================
  // MARKET ROUTES (Legacy Sandbox)
  // ============================

  // Execute Trade (Sandbox)
  app.post(api.trade.execute.path, isAuthenticated, async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const userId = (req.user as any).claims?.sub || (req.user as any).id;

      // Idempotency check — auto-generate key if client doesn't send one
      const idempotencyKey = String(req.headers["idempotency-key"] || crypto.randomUUID());
      const [existing] = await db
        .select()
        .from(idempotencyKeys)
        .where(and(
          eq(idempotencyKeys.key, idempotencyKey),
          eq(idempotencyKeys.userId, userId),
          eq(idempotencyKeys.endpoint, "/api/trade"),
        ))
        .limit(1);
      if (existing) {
        return res.json(existing.response);
      }

      const { assetId: inputAssetId, vaultId: inputVaultId, type, shares } = api.trade.execute.input.parse(req.body);

      if (!inputAssetId && !inputVaultId) {
        return res.status(400).json({ message: "Either assetId or vaultId must be provided" });
      }

      // Resolve vault — prefer assetId lookup, fall back to vaultId
      let vault: typeof vaults.$inferSelect | undefined;
      if (inputAssetId) {
        const [found] = await db.select().from(vaults).where(eq(vaults.assetId, inputAssetId));
        if (!found) return res.status(400).json({ message: "Asset not tradable in sandbox (no vault mapping)" });
        vault = found;
      } else {
        vault = await storage.getVault(inputVaultId!);
        if (!vault) return res.status(404).json({ message: "Vault not found" });
      }

      const vaultId = vault.id;
      const resolvedAssetId: number | null = vault.assetId ?? null;

      let portfolio = await storage.getPortfolioByUserId(userId);
      if (!portfolio) {
        portfolio = await storage.createPortfolio({ userId, balance: "10000.00" });
      }

      const mid = parseFloat(vault.lastTradePrice);
      const vaultMomentum = parseFloat(String(vault.momentum)) || 0;
      const vaultVolume = parseFloat(String(vault.volume24h)) || 0;
      const { bidPrice, askPrice } = computeQuotes(mid, vaultMomentum, vaultVolume);
      const executionPrice = type === "BUY" ? askPrice : bidPrice;
      const grossValue = executionPrice * shares;
      const fee = grossValue * 0.02;

      let totalCost = 0;
      let newBalance = parseFloat(portfolio.balance);

      if (type === "BUY") {
        totalCost = grossValue + fee;
        if (newBalance < totalCost) {
          return res.status(400).json({ message: "Insufficient balance" });
        }
        newBalance -= totalCost;
      } else {
        const existingPos = await storage.getPosition(portfolio.id, vaultId);
        if (!existingPos || existingPos.shares < shares) {
          return res.status(400).json({ message: "Insufficient shares" });
        }
        totalCost = grossValue - fee;
        newBalance += totalCost;
      }

      console.log(`[Trade:SANDBOX] userId=${userId} portfolioId=${portfolio.id} vaultId=${vaultId} assetId=${resolvedAssetId} type=${type} shares=${shares} execPrice=${executionPrice.toFixed(4)} totalCost=${totalCost.toFixed(4)}`);

      let resultTrade: any;
      let newTotalShares = 0;
      let newAvgCost = 0;
      let prevAvgCostForArena = 0;

      await db.transaction(async (tx) => {
        // 1. Update balance
        await tx.update(portfolios)
          .set({ balance: newBalance.toFixed(2), updatedAt: new Date() })
          .where(eq(portfolios.id, portfolio!.id));

        // 2. Insert trade record (with assetId)
        [resultTrade] = await tx.insert(trades)
          .values({
            portfolioId: portfolio!.id,
            vaultId: vault!.id,
            assetId: resolvedAssetId,
            type,
            shares,
            pricePerShare: executionPrice.toFixed(2),
            totalCost: totalCost.toFixed(2),
            fee: fee.toFixed(2),
          })
          .returning();

        // 3. Upsert position (with assetId)
        const [currentPos] = await tx.select().from(positions)
          .where(and(eq(positions.portfolioId, portfolio!.id), eq(positions.vaultId, vaultId)));

        const prevShares = currentPos?.shares || 0;
        const prevAvgCost = currentPos ? parseFloat(currentPos.averageCost) : 0;
        prevAvgCostForArena = prevAvgCost;
        newTotalShares = prevShares + (type === "BUY" ? shares : -shares);
        newAvgCost = prevAvgCost;

        if (type === "BUY") {
          const prevTotal = prevShares * prevAvgCost;
          newAvgCost = newTotalShares > 0
            ? (prevTotal + executionPrice * shares) / newTotalShares
            : executionPrice;
        }

        if (newTotalShares <= 0) {
          if (currentPos) {
            await tx.delete(positions).where(eq(positions.id, currentPos.id));
          }
        } else {
          await tx.insert(positions)
            .values({ portfolioId: portfolio!.id, vaultId, assetId: resolvedAssetId, shares: newTotalShares, averageCost: newAvgCost.toFixed(2) })
            .onConflictDoUpdate({
              target: [positions.portfolioId, positions.vaultId],
              set: { shares: newTotalShares, averageCost: newAvgCost.toFixed(2), assetId: resolvedAssetId, updatedAt: new Date() },
            });
        }

        // 4. Update vault price and volume
        const newVolume = parseFloat(vault!.volume24h) + grossValue;
        await tx.update(vaults)
          .set({ lastTradePrice: executionPrice.toFixed(2), volume24h: newVolume.toFixed(2), updatedAt: new Date() })
          .where(eq(vaults.id, vaultId));

        // 5. Update canonical asset price + volume (if linked)
        if (resolvedAssetId) {
          await tx.update(assets)
            .set({
              lastTradePrice: executionPrice.toFixed(2),
              volume24h: newVolume.toFixed(2),
              updatedAt: new Date(),
            })
            .where(eq(assets.id, resolvedAssetId));
        }

        // 6. Ledger entries (shadow mode — atomic with trade)
        if (type === "BUY") {
          // Debit: user spent USD
          await tx.insert(ledgerEntries).values({
            userId,
            portfolioId: portfolio!.id,
            assetId: resolvedAssetId,
            type: "debit",
            amount: totalCost.toFixed(6),
            currency: "USD",
            referenceType: "trade",
            referenceId: resultTrade.id,
          });
          // Credit: user received shares
          await tx.insert(ledgerEntries).values({
            userId,
            portfolioId: portfolio!.id,
            assetId: resolvedAssetId,
            type: "credit",
            amount: shares.toFixed(6),
            currency: "ASSET",
            referenceType: "trade",
            referenceId: resultTrade.id,
          });
        } else {
          // Credit: user received USD
          await tx.insert(ledgerEntries).values({
            userId,
            portfolioId: portfolio!.id,
            assetId: resolvedAssetId,
            type: "credit",
            amount: totalCost.toFixed(6),
            currency: "USD",
            referenceType: "trade",
            referenceId: resultTrade.id,
          });
          // Debit: user gave up shares
          await tx.insert(ledgerEntries).values({
            userId,
            portfolioId: portfolio!.id,
            assetId: resolvedAssetId,
            type: "debit",
            amount: shares.toFixed(6),
            currency: "ASSET",
            referenceType: "trade",
            referenceId: resultTrade.id,
          });
        }
      });

      console.log(`[Trade:SANDBOX] ✓ tradeId=${resultTrade.id} newShares=${newTotalShares} avgCost=${newAvgCost.toFixed(4)} newBalance=${newBalance.toFixed(2)}`);

      // Arena stats update (non-critical, fire-and-forget)
      const sandboxRealizedPnl = type === "SELL" ? (executionPrice - prevAvgCostForArena) * shares : undefined;
      const sandboxPnlPct = (type === "SELL" && prevAvgCostForArena > 0) ? (executionPrice - prevAvgCostForArena) / prevAvgCostForArena : undefined;
      updateArenaOnTrade({ userId, tradeType: type, realizedPnl: sandboxRealizedPnl, pnlPct: sandboxPnlPct, meta: { source: "sandbox", vaultId } }).catch(() => {});

      // Snapshots outside transaction (non-critical)
      await storage.createVaultSnapshot({
        vaultId: vault!.id,
        price: executionPrice.toFixed(2),
        performanceIndex: vault!.performanceIndex,
      });

      const newVolume24h = (parseFloat(vault!.volume24h) + grossValue).toFixed(2);
      const tradeMomentum = vault!.momentum ?? "0.0000";

      if (resolvedAssetId) {
        await db.insert(assetPriceSnapshots).values({
          assetId: resolvedAssetId,
          price: executionPrice.toFixed(2),
          volume24h: newVolume24h,
          momentum: tradeMomentum,
        });

        const { bidPrice: sbBid, askPrice: sbAsk, spreadPct: sbSpread } = computeQuotes(
          executionPrice,
          parseFloat(tradeMomentum) || 0,
          parseFloat(newVolume24h) || 0,
        );
        const assetEvent = {
          type: "asset.updated",
          data: {
            assetId: resolvedAssetId,
            lastTradePrice: executionPrice.toFixed(2),
            volume24h: newVolume24h,
            momentum: tradeMomentum,
            bidPrice: sbBid.toFixed(2),
            askPrice: sbAsk.toFixed(2),
            spreadPct: (sbSpread * 100).toFixed(3),
            updatedAt: new Date().toISOString(),
          },
        };
        marketHub.publishTicker(assetEvent);
        marketHub.publishAsset(resolvedAssetId, assetEvent);
        marketHub.publishTrades({
          type: "trade.executed",
          data: {
            assetId: resolvedAssetId,
            type,
            shares,
            pricePerShare: executionPrice.toFixed(2),
            totalCost: totalCost.toFixed(2),
            fee: fee.toFixed(2),
            executedAt: new Date().toISOString(),
          },
        });
      }

      const tradeResult = {
        trade: resultTrade,
        newBalance: newBalance.toFixed(2),
        newShares: newTotalShares,
      };

      // Store idempotency record so retries return the same response
      await db.insert(idempotencyKeys).values({
        key: idempotencyKey,
        userId,
        endpoint: "/api/trade",
        response: tradeResult as any,
        status: "completed",
      }).onConflictDoNothing();

      res.json(tradeResult);

    } catch (e) {
      if (e instanceof z.ZodError) {
        return res.status(400).json({ message: e.errors[0].message });
      }
      console.error("[Trade:SANDBOX] error:", e);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ============================
  // MARKET ROUTES (Real / Riot Assets)
  // ============================

  // POST /api/riot/trade — execute BUY or SELL on a riot asset
  app.post("/api/riot/trade", isAuthenticated, async (req: any, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const userId = (req.user as any).claims?.sub || (req.user as any).id;
      const schema = z.object({
        puuid: z.string().min(1),
        type: z.enum(["BUY", "SELL"]),
        shares: z.number().int().positive(),
      });
      const { puuid, type, shares } = schema.parse(req.body);

      const result = await executeRiotTrade({ userId, puuid, type, shares, source: "MANUAL" });

      return res.json({
        tradeId: result.tradeId,
        newBalance: result.newBalance.toFixed(2),
        newShares: result.newShares,
        executionPrice: result.executionPrice.toFixed(2),
        grossValue: result.grossValue.toFixed(2),
        fee: result.fee.toFixed(2),
        feeBps: result.feeBps,
        priceImpactPct: result.priceImpact.toFixed(4),
        ammEnabled: result.ammEnabled,
      });
    } catch (e) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: e.errors[0].message });
      if (e instanceof TradeError) return res.status(e.statusCode).json({ message: e.message });
      console.error("[Trade:RIOT] error:", e);
      res.status(500).json({ message: "Internal server error" });
    }
  });
}

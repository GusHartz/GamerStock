import { db } from "../db";
import { storage } from "../storage";
import {
  assets, assetMarkets, assetMarketState,
  assetTrades, assetPositions, portfolios,
} from "@shared/schema";
import { spotPrice, costToBuy, payoutToSell, DEFAULT_AMM_PARAMS } from "./ammPricing";
import { computeQuotes } from "@shared/market-quotes";
import { updateArenaOnTrade } from "../arena";
import { terminalBroadcaster } from "../sse/terminalBroadcaster";
import { marketHub } from "../ws/market-hub";
import { eventBus, createTradeExecutedEvent, createFeeCapturedEvent } from "../events";
import { eq, and } from "drizzle-orm";
import * as walletService from "../domains/wallet/service";
import { captureTradeFees, computeFee } from "../domains/fee-engine";

export interface AssetTradeParams {
  userId: string;
  assetId: number;
  type: "BUY" | "SELL";
  shares: number;
  source?: string;
  orderId?: string;
  skipWalletSettlement?: boolean;
}

export interface AssetTradeResult {
  tradeId: number;
  executionPrice: number;
  newBalance: number;
  newShares: number;
  grossValue: number;
  fee: number;
  feeBps: number;
  priceImpact: number;
  ammEnabled: boolean;
}

export class AssetTradeError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message);
    this.name = "AssetTradeError";
  }
}

export async function executeAssetTrade(params: AssetTradeParams): Promise<AssetTradeResult> {
  const { userId, assetId, type, shares, source = "MANUAL" } = params;

  const [asset] = await db.select().from(assets).where(eq(assets.id, assetId));
  if (!asset) throw new AssetTradeError("Asset not found", 404);

  let portfolio = await storage.getPortfolioByUserId(userId);
  if (!portfolio) {
    portfolio = await storage.createPortfolio({ userId, balance: "10000.00" });
  }

  const [mkt] = await db.select().from(assetMarkets).where(eq(assetMarkets.assetId, assetId));
  const [st] = await db.select().from(assetMarketState).where(eq(assetMarketState.assetId, assetId));

  let ammConfig: typeof mkt | null = null;
  let ammState: typeof st | null = null;
  let ammParams = DEFAULT_AMM_PARAMS;
  let feeBps = 200;

  if (mkt && st && mkt.isEnabled) {
    ammConfig = mkt;
    ammState = st;
    feeBps = mkt.feeBps;
    ammParams = {
      floorPrice: parseFloat(mkt.floorPrice),
      paramA: parseFloat(mkt.paramA),
      paramB: parseFloat(mkt.paramB),
    };
  }

  const assetMomentum = parseFloat(String(asset.momentum)) || 0;
  const assetVolume = parseFloat(String(asset.volume24h)) || 0;

  let executionPrice: number;
  if (ammState) {
    const supply = parseFloat(ammState.supply);
    if (type === "BUY") {
      executionPrice = costToBuy(supply, shares, ammParams) / shares;
    } else {
      if (supply < shares) throw new AssetTradeError("Insufficient market liquidity for this sell size");
      executionPrice = payoutToSell(supply, shares, ammParams) / shares;
    }
  } else {
    const mid = parseFloat(asset.lastTradePrice);
    const { bidPrice: bid, askPrice: ask } = computeQuotes(mid, assetMomentum, assetVolume);
    executionPrice = type === "BUY" ? ask : bid;
  }

  const grossValue = executionPrice * shares;
  const fee = grossValue * feeBps / 10000;
  let totalCost = 0;
  let newBalance = parseFloat(portfolio.balance);

  if (type === "BUY") {
    totalCost = grossValue + fee;
    if (newBalance < totalCost) throw new AssetTradeError("Insufficient balance");
    newBalance -= totalCost;
  } else {
    const [pos] = await db.select()
      .from(assetPositions)
      .where(and(eq(assetPositions.userId, userId), eq(assetPositions.assetId, assetId)));
    if (!pos || pos.shares < shares) throw new AssetTradeError("Insufficient shares");
    totalCost = grossValue - fee;
    newBalance += totalCost;
  }

  if (type === "BUY" && !params.skipWalletSettlement) {
    await walletService.ensureWalletsExist(userId);
    const wSummary = await walletService.getWalletSummary(userId);
    const gsWallet = wSummary.wallets.find((w) => w.currency === "GS");
    const gsAvailable = gsWallet ? parseFloat(gsWallet.availableBalance) : 0;
    console.log("TRADE CHECK", {
      userId,
      grossValue: grossValue.toFixed(6),
      fee: fee.toFixed(6),
      totalCost: totalCost.toFixed(6),
      portfolioBalance: newBalance.toFixed(2),
      gsWalletAvailable: gsAvailable.toFixed(6),
    });
    if (!gsWallet || gsAvailable < totalCost) {
      throw new AssetTradeError("Insufficient GS$ wallet balance");
    }
  }

  console.log(`[AssetTradeExecutor:${source}] userId=${userId} assetId=${assetId} type=${type} shares=${shares} execPrice=${executionPrice.toFixed(4)}`);

  let resultTrade: any;
  let newTotalShares = 0;
  let newAvgCost = 0;
  let prevAvgCostForArena = 0;

  await db.transaction(async (tx) => {
    await tx.update(portfolios)
      .set({ balance: newBalance.toFixed(2), updatedAt: new Date() })
      .where(eq(portfolios.id, portfolio!.id));

    [resultTrade] = await tx.insert(assetTrades)
      .values({
        userId,
        assetId,
        type,
        shares,
        pricePerShare: executionPrice.toFixed(2),
        grossValue: grossValue.toFixed(2),
        fee: fee.toFixed(2),
      })
      .returning();

    const [existingPos] = await tx.select()
      .from(assetPositions)
      .where(and(eq(assetPositions.userId, userId), eq(assetPositions.assetId, assetId)));

    const prevShares = existingPos?.shares || 0;
    const prevAvgCost = existingPos ? parseFloat(existingPos.averageCost) : 0;
    prevAvgCostForArena = prevAvgCost;
    newTotalShares = type === "BUY" ? prevShares + shares : prevShares - shares;
    newAvgCost = prevAvgCost;

    if (type === "BUY") {
      const prevTotal = prevShares * prevAvgCost;
      newAvgCost = newTotalShares > 0 ? (prevTotal + executionPrice * shares) / newTotalShares : executionPrice;
    }

    if (newTotalShares <= 0) {
      if (existingPos) {
        await tx.delete(assetPositions).where(eq(assetPositions.id, existingPos.id));
      }
    } else {
      await tx.insert(assetPositions)
        .values({ userId, assetId, shares: newTotalShares, averageCost: newAvgCost.toFixed(2) })
        .onConflictDoUpdate({
          target: [assetPositions.userId, assetPositions.assetId],
          set: { shares: newTotalShares, averageCost: newAvgCost.toFixed(2), updatedAt: new Date() },
        });
    }

    const newVolume = assetVolume + grossValue;
    if (ammState) {
      const oldSupply = parseFloat(ammState.supply);
      const newSupply = type === "BUY" ? oldSupply + shares : Math.max(0, oldSupply - shares);
      const newSpotPrice = spotPrice(newSupply, ammParams);
      await tx.update(assetMarketState)
        .set({ supply: newSupply.toFixed(6), lastPrice: newSpotPrice.toFixed(6), lastUpdatedAt: new Date(), version: ammState.version + 1 })
        .where(eq(assetMarketState.assetId, assetId));

      await tx.update(assets)
        .set({ lastTradePrice: newSpotPrice.toFixed(2), volume24h: newVolume.toFixed(2), updatedAt: new Date() })
        .where(eq(assets.id, assetId));
    } else {
      await tx.update(assets)
        .set({ lastTradePrice: executionPrice.toFixed(2), volume24h: newVolume.toFixed(2), updatedAt: new Date() })
        .where(eq(assets.id, assetId));
    }

    await captureTradeFees({
      referenceType: "market_trade",
      referenceId:   resultTrade.id.toString(),
      assetDbId:     assetId,
      currency:      "GS",
      notional:      grossValue,
      feeBps,
      tx,
    });
  });

  if (!params.skipWalletSettlement) {
    if (type === "BUY") {
      await walletService.debitWallet({
        userId,
        currency: "GS",
        amount: totalCost.toFixed(6),
        entryType: "buy_settle",
        description: `Buy ${shares} shares @ ${executionPrice.toFixed(2)} GS (incl. fee ${fee.toFixed(2)})`,
        referenceType: "trade",
        referenceId: resultTrade.id.toString(),
      });
    } else {
      await walletService.creditWallet({
        userId,
        currency: "GS",
        amount: totalCost.toFixed(6),
        entryType: "sell_settle",
        description: `Sell ${shares} shares @ ${executionPrice.toFixed(2)} GS (net of fee ${fee.toFixed(2)})`,
        referenceType: "trade",
        referenceId: resultTrade.id.toString(),
      });
    }
  }

  console.log(`[AssetTradeExecutor:${source}] ✓ tradeId=${resultTrade.id} newShares=${newTotalShares} newBalance=${newBalance.toFixed(2)}`);

  const realizedPnl = type === "SELL" ? (executionPrice - prevAvgCostForArena) * shares : undefined;
  const pnlPct = (type === "SELL" && prevAvgCostForArena > 0) ? (executionPrice - prevAvgCostForArena) / prevAvgCostForArena : undefined;
  updateArenaOnTrade({ userId, tradeType: type, realizedPnl, pnlPct, meta: { source: "canonical", assetId } }).catch(() => {});

  eventBus.emitBackground(createTradeExecutedEvent({
    tradeId: resultTrade.id,
    userId,
    puuid: String(assetId),
    type,
    shares,
    executionPrice,
    grossValue,
    fee,
    source,
    realizedPnl,
    pnlPct,
  }));

  {
    const bd = computeFee(grossValue, feeBps);
    eventBus.emitBackground(createFeeCapturedEvent({
      tradeId:      resultTrade.id,
      assetId,
      notional:     grossValue,
      feeTotal:     bd.feeTotal,
      platformFee:  bd.platformFee,
      playerFee:    bd.playerFee,
      liquidityFee: bd.liquidityFee,
      currency:     "GS",
    }));
  }

  const newVolRiot = (assetVolume + grossValue).toFixed(2);
  let newSpotForBroadcast = executionPrice;

  if (ammState) {
    const newSupply = type === "BUY"
      ? parseFloat(ammState.supply) + shares
      : Math.max(0, parseFloat(ammState.supply) - shares);
    newSpotForBroadcast = spotPrice(newSupply, ammParams);
  }

  const { bidPrice: newBid, askPrice: newAsk, spreadPct: newSpread } = computeQuotes(newSpotForBroadcast, assetMomentum, parseFloat(newVolRiot));
  marketHub.publishTicker({
    type: "asset.updated",
    data: {
      assetId,
      lastTradePrice: newSpotForBroadcast.toFixed(2),
      volume24h: newVolRiot,
      bidPrice: newBid.toFixed(2),
      askPrice: newAsk.toFixed(2),
      spreadPct: (newSpread * 100).toFixed(3),
      updatedAt: new Date().toISOString(),
    },
  });
  marketHub.publishTrades({
    type: "trade.executed",
    data: { assetId, type, shares, executionPrice: newSpotForBroadcast.toFixed(2) },
  });

  terminalBroadcaster.emit({
    type: "PRICE_UPDATE",
    data: {
      assetId,
      price: newSpotForBroadcast.toFixed(2),
      change: newSpotForBroadcast - parseFloat(asset.lastTradePrice),
      ts: Date.now(),
      source,
    },
  });
  terminalBroadcaster.emit({
    type: "TRADE_TICK",
    data: { assetId, side: type, size: shares, price: newSpotForBroadcast.toFixed(2), ts: Date.now() },
  });

  const priceImpact = ammState
    ? Math.abs((newSpotForBroadcast - executionPrice) / executionPrice * 100)
    : 0;

  return {
    tradeId: resultTrade.id,
    executionPrice: newSpotForBroadcast,
    newBalance,
    newShares: newTotalShares,
    grossValue,
    fee,
    feeBps,
    priceImpact,
    ammEnabled: !!ammState,
  };
}

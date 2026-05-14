import { db } from "../db";
import { storage } from "../storage";
import {
  riotAssets, riotPositions, riotTrades, portfolios, assets,
  assetMarkets, assetMarketState,
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

export interface TradeParams {
  userId: string;
  puuid: string;
  type: "BUY" | "SELL";
  shares: number;
  source?: string;
  orderId?: string;
  /**
   * When true, the caller (e.g. triggerEngine) is responsible for wallet
   * settlement (consume_locked / credit). Set for limit orders where GS$
   * was already reserved at order creation.
   * When false (default), executeRiotTrade debits/credits the wallet directly.
   */
  skipWalletSettlement?: boolean;
}

export interface TradeResult {
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

export class TradeError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message);
    this.name = "TradeError";
  }
}

export async function executeRiotTrade(params: TradeParams): Promise<TradeResult> {
  const { userId, puuid, type, shares, source = "MANUAL" } = params;

  const [asset] = await db.select().from(riotAssets).where(eq(riotAssets.puuid, puuid));
  if (!asset) throw new TradeError("Asset not found", 404);

  let portfolio = await storage.getPortfolioByUserId(userId);
  if (!portfolio) {
    portfolio = await storage.createPortfolio({ userId, balance: "10000.00" });
  }

  const [assetsRow] = await db.select({ id: assets.id })
    .from(assets).where(eq(assets.externalId, puuid)).limit(1);

  let ammConfig: any = null;
  let ammState: any = null;
  let ammParams = DEFAULT_AMM_PARAMS;
  let feeBps = 200;

  if (assetsRow) {
    const [mkt] = await db.select().from(assetMarkets).where(eq(assetMarkets.assetId, assetsRow.id));
    const [st] = await db.select().from(assetMarketState).where(eq(assetMarketState.assetId, assetsRow.id));
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
  }

  const assetMomentum = parseFloat(String(asset.momentum)) || 0;
  const assetVolume = parseFloat(String(asset.volume24h)) || 0;

  let executionPrice: number;
  if (ammState) {
    const supply = parseFloat(ammState.supply);
    if (type === "BUY") {
      executionPrice = costToBuy(supply, shares, ammParams) / shares;
    } else {
      if (supply < shares) throw new TradeError("Insufficient market liquidity for this sell size");
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
    if (newBalance < totalCost) throw new TradeError("Insufficient balance");
    newBalance -= totalCost;
  } else {
    const [pos] = await db.select()
      .from(riotPositions)
      .where(and(eq(riotPositions.portfolioId, portfolio.id), eq(riotPositions.puuid, puuid)));
    if (!pos || pos.shares < shares) throw new TradeError("Insufficient shares");
    totalCost = grossValue - fee;
    newBalance += totalCost;
  }

  // ── GS$ wallet pre-check (immediate trades only — skipped when caller pre-locked funds) ──
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
      throw new TradeError("Insufficient GS$ wallet balance");
    }
  }

  console.log(`[TradeExecutor:${source}] userId=${userId} puuid=${puuid.slice(0, 20)}... type=${type} shares=${shares} execPrice=${executionPrice.toFixed(4)} orderId=${params.orderId ?? "none"}`);

  let resultTrade: any;
  let newTotalShares = 0;
  let newAvgCost = 0;
  let prevAvgCostForArena = 0;

  await db.transaction(async (tx) => {
    await tx.update(portfolios)
      .set({ balance: newBalance.toFixed(2), updatedAt: new Date() })
      .where(eq(portfolios.id, portfolio!.id));

    [resultTrade] = await tx.insert(riotTrades)
      .values({
        portfolioId: portfolio!.id,
        puuid,
        type,
        shares,
        pricePerShare: executionPrice.toFixed(2),
        totalCost: totalCost.toFixed(2),
        fee: fee.toFixed(2),
      })
      .returning();

    const [existingPos] = await tx.select().from(riotPositions)
      .where(and(eq(riotPositions.portfolioId, portfolio!.id), eq(riotPositions.puuid, puuid)));

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
        await tx.delete(riotPositions).where(eq(riotPositions.id, existingPos.id));
      }
    } else {
      await tx.insert(riotPositions)
        .values({ portfolioId: portfolio!.id, puuid, shares: newTotalShares, averageCost: newAvgCost.toFixed(2) })
        .onConflictDoUpdate({
          target: [riotPositions.portfolioId, riotPositions.puuid],
          set: { shares: newTotalShares, averageCost: newAvgCost.toFixed(2), updatedAt: new Date() },
        });
    }

    const newVolume = parseFloat(asset.volume24h) + grossValue;
    await tx.update(riotAssets)
      .set({ lastTradePrice: executionPrice.toFixed(2), volume24h: newVolume.toFixed(2), updatedAt: new Date() })
      .where(eq(riotAssets.puuid, puuid));

    if (ammState && assetsRow) {
      const oldSupply = parseFloat(ammState.supply);
      const newSupply = type === "BUY" ? oldSupply + shares : Math.max(0, oldSupply - shares);
      const newSpotPrice = spotPrice(newSupply, ammParams);
      await tx.update(assetMarketState)
        .set({ supply: newSupply.toFixed(6), lastPrice: newSpotPrice.toFixed(6), lastUpdatedAt: new Date(), version: ammState.version + 1 })
        .where(eq(assetMarketState.assetId, assetsRow.id));

      await tx.update(assets)
        .set({ lastTradePrice: newSpotPrice.toFixed(2), volume24h: (parseFloat(asset.volume24h) + grossValue).toFixed(2), updatedAt: new Date() })
        .where(eq(assets.id, assetsRow.id));
    }

    // ── Fee capture — runs for ALL trades regardless of AMM status ──────────
    // assetDbId is optional: playerFeeBalance is updated only when assetsRow exists.
    // Fee was already deducted from portfolio.balance via totalCost = grossValue + fee.
    await captureTradeFees({
      referenceType: "market_trade",
      referenceId:   resultTrade.id.toString(),
      assetDbId:     assetsRow?.id,
      currency:      "GS",
      notional:      grossValue,
      feeBps,
      tx,
    });
  });

  // ── GS$ wallet settlement (Phase 2.5) ─────────────────────────────────────
  // For immediate trades (skipWalletSettlement=false), debit/credit the wallet
  // here.  For limit orders, the caller (triggerEngine) handles wallet ops
  // because funds were pre-locked at order creation.
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

  console.log(`[TradeExecutor:${source}] ✓ tradeId=${resultTrade.id} newShares=${newTotalShares} newBalance=${newBalance.toFixed(2)}`);

  const riotRealizedPnl = type === "SELL" ? (executionPrice - prevAvgCostForArena) * shares : undefined;
  const riotPnlPct = (type === "SELL" && prevAvgCostForArena > 0) ? (executionPrice - prevAvgCostForArena) / prevAvgCostForArena : undefined;
  updateArenaOnTrade({ userId, tradeType: type, realizedPnl: riotRealizedPnl, pnlPct: riotPnlPct, meta: { source: "riot", puuid } }).catch(() => {});

  eventBus.emitBackground(createTradeExecutedEvent({
    tradeId: resultTrade.id,
    userId,
    puuid,
    type,
    shares,
    executionPrice,
    grossValue,
    fee,
    source,
    realizedPnl: riotRealizedPnl,
    pnlPct: riotPnlPct,
  }));

  {
    const bd = computeFee(grossValue, feeBps);
    eventBus.emitBackground(createFeeCapturedEvent({
      tradeId:      resultTrade.id,
      assetId:      assetsRow?.id ?? 0,
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
  let assetIdForBroadcast: number | undefined;

  if (ammState && assetsRow) {
    const newSupply = type === "BUY"
      ? parseFloat(ammState.supply) + shares
      : Math.max(0, parseFloat(ammState.supply) - shares);
    newSpotForBroadcast = spotPrice(newSupply, ammParams);
    assetIdForBroadcast = assetsRow.id;
  }

  const { bidPrice: newBid, askPrice: newAsk, spreadPct: newSpread } = computeQuotes(newSpotForBroadcast, assetMomentum, parseFloat(newVolRiot));
  marketHub.publishTicker({
    type: "asset.updated",
    data: {
      puuid,
      assetId: assetIdForBroadcast,
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
    data: { puuid, type, shares, executionPrice: newSpotForBroadcast.toFixed(2) },
  });

  if (assetIdForBroadcast) {
    terminalBroadcaster.emit({
      type: "PRICE_UPDATE",
      data: {
        assetId: assetIdForBroadcast,
        price: newSpotForBroadcast.toFixed(2),
        change: newSpotForBroadcast - parseFloat(asset.lastTradePrice),
        ts: Date.now(),
        source,
      },
    });
    terminalBroadcaster.emit({
      type: "TRADE_TICK",
      data: { assetId: assetIdForBroadcast, side: type, size: shares, price: newSpotForBroadcast.toFixed(2), ts: Date.now() },
    });
  }

  const priceImpact = ammState && assetsRow
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

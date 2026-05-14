/**
 * Simulation — Bot Trader
 *
 * 100-bot simulation system for the GamerStock asset market (all games).
 * Strategies: TREND_FOLLOWER, VALUE_TRADER, PROFIT_TAKER, RANDOM_TRADER,
 *             WHALE, ARBITRAGE, FUNDAMENTAL_SELLER.
 *
 * Multi-game path: operates on canonical `assets` table (covers LoL, CS2, Dota2,
 * and any future games) via `executeAssetTrade` + `assetPositions`.
 */

import { db } from "../../db";
import {
  portfolios, botProfiles,
  assetPositions, assets, assetMarkets, assetMarketState, assetValuationState,
} from "@shared/schema";
import { eq, sql, and, gt } from "drizzle-orm";
import { executeAssetTrade } from "../../services/assetTradeExecutor";
import { PVI_CONFIG } from "../../services/pviEngine";

// ─── Config (mutable via admin) ───────────────────────────────────────────────
let BOT_INTERVAL_MS = 10_000;
let BOT_BATCH_SIZE_MIN = 5;
let BOT_BATCH_SIZE_MAX = 10;

export function setBotConfig(opts: { intervalMs?: number; batchSizeMin?: number; batchSizeMax?: number }) {
  if (opts.intervalMs && opts.intervalMs >= 1000) BOT_INTERVAL_MS = opts.intervalMs;
  if (opts.batchSizeMin && opts.batchSizeMin >= 1) BOT_BATCH_SIZE_MIN = opts.batchSizeMin;
  if (opts.batchSizeMax && opts.batchSizeMax >= 1) BOT_BATCH_SIZE_MAX = opts.batchSizeMax;
}

export function getBotConfig() {
  return { intervalMs: BOT_INTERVAL_MS, batchSizeMin: BOT_BATCH_SIZE_MIN, batchSizeMax: BOT_BATCH_SIZE_MAX };
}

// ─── Strategy distribution ────────────────────────────────────────────────────
const STRATEGY_DISTRIBUTION: { strategy: string; count: number; risk: string }[] = [
  { strategy: "TREND_FOLLOWER",      count: 15, risk: "MEDIUM" },
  { strategy: "VALUE_TRADER",        count: 30, risk: "LOW" },
  { strategy: "PROFIT_TAKER",        count: 15, risk: "MEDIUM" },
  { strategy: "RANDOM_TRADER",       count: 5,  risk: "LOW" },
  { strategy: "WHALE",               count: 5,  risk: "HIGH" },
  { strategy: "ARBITRAGE",           count: 15, risk: "LOW" },
  { strategy: "FUNDAMENTAL_SELLER",  count: 15, risk: "LOW" },
];

// ─── Metrics (in-memory sliding window) ───────────────────────────────────────
interface TradeEvent { ts: number; volume: number }
const tradeEvents: TradeEvent[] = [];
let totalBotVolume24h = 0;
let volume24hResetTs = Date.now();

function recordTrade(volume: number) {
  const now = Date.now();
  tradeEvents.push({ ts: now, volume });
  totalBotVolume24h += volume;

  if (now - volume24hResetTs > 86_400_000) {
    totalBotVolume24h = volume;
    volume24hResetTs = now;
  }

  const cutoff = now - 3_600_000;
  while (tradeEvents.length > 0 && tradeEvents[0].ts < cutoff) tradeEvents.shift();
}

function tradesPerHour(): number {
  const cutoff = Date.now() - 3_600_000;
  return tradeEvents.filter(e => e.ts > cutoff).length;
}

// ─── Seeding ──────────────────────────────────────────────────────────────────
export async function seedBots(): Promise<{ seeded: number; message: string }> {
  let seeded = 0;
  const strategies: string[] = [];
  for (const { strategy, count } of STRATEGY_DISTRIBUTION) {
    for (let i = 0; i < count; i++) strategies.push(strategy);
  }

  for (let i = 1; i <= 100; i++) {
    const botId = `bot_trader_${String(i).padStart(3, "0")}`;
    const strategy = strategies[i - 1];
    const total = strategies.length;

    const [existing] = await db.select({ id: botProfiles.id })
      .from(botProfiles).where(eq(botProfiles.userId, botId)).limit(1);
    if (existing) continue;

    await db.insert(botProfiles).values({
      userId: botId,
      strategy,
      riskTolerance: STRATEGY_DISTRIBUTION.find(s => s.strategy === strategy)?.risk ?? "LOW",
    }).onConflictDoNothing();

    const [existingPortfolio] = await db.select({ id: portfolios.id })
      .from(portfolios).where(eq(portfolios.userId, botId)).limit(1);
    if (!existingPortfolio) {
      await db.insert(portfolios).values({ userId: botId, balance: "10000.00" }).onConflictDoNothing();
      seeded++;
    }

    void total;
  }

  const [countRow] = await db.select({ c: sql<number>`count(*)` }).from(botProfiles);
  const total = Number(countRow?.c ?? 0);
  return { seeded, message: `${total} bots active, ${seeded} portfolios created this run` };
}

// ─── Asset helpers (multi-game: query canonical `assets` table) ───────────────

type AssetRow = {
  id: number;
  lastTradePrice: string;
  price24hAgo: string;
  volume24h: string;
  momentum: string;
};

async function getRandomAssets(limit = 10): Promise<AssetRow[]> {
  return db.select({
    id:             assets.id,
    lastTradePrice: assets.lastTradePrice,
    price24hAgo:    assets.price24hAgo,
    volume24h:      assets.volume24h,
    momentum:       assets.momentum,
  }).from(assets)
    .where(sql`${assets.tradingStatus} = 'ACTIVE' AND ${assets.listingStatus} = 'LISTED'`)
    .orderBy(sql`random()`)
    .limit(limit);
}

type AssetWithVal = AssetRow & {
  fairValueGS:       string | null;
  divergencePct:     number | null;
  confidenceScore:   number | null;
  recentPerformance: number | null;
};

async function getAssetsWithValuation(limit = 10): Promise<AssetWithVal[]> {
  return db.select({
    id:                assets.id,
    lastTradePrice:    assets.lastTradePrice,
    price24hAgo:       assets.price24hAgo,
    volume24h:         assets.volume24h,
    momentum:          assets.momentum,
    fairValueGS:       assetValuationState.fairValueGS,
    divergencePct:     assetValuationState.divergencePct,
    confidenceScore:   assetValuationState.confidenceScore,
    recentPerformance: assetValuationState.recentPerformance,
  })
  .from(assets)
  .innerJoin(assetValuationState, eq(assetValuationState.assetId, assets.id))
  .where(sql`${assets.tradingStatus} = 'ACTIVE' AND ${assets.listingStatus} = 'LISTED'`)
  .orderBy(sql`random()`)
  .limit(limit);
}

async function getOvervaluedAssets(limit = 15) {
  return db.select({
    id:            assets.id,
    lastTradePrice: assets.lastTradePrice,
    fairValueGS:    assetValuationState.fairValueGS,
    divergencePct:  assetValuationState.divergencePct,
    confidenceScore: assetValuationState.confidenceScore,
  })
  .from(assets)
  .innerJoin(assetValuationState, eq(assetValuationState.assetId, assets.id))
  .where(sql`${assets.tradingStatus} = 'ACTIVE'
    AND CAST(${assetValuationState.divergencePct} AS NUMERIC) > ${PVI_CONFIG.FUNDAMENTAL_SELL_DIV_THRESHOLD}
    AND CAST(${assetValuationState.confidenceScore} AS NUMERIC) >= ${PVI_CONFIG.PERF_ANCHOR_MIN_CONFIDENCE}`)
  .orderBy(sql`CAST(${assetValuationState.divergencePct} AS NUMERIC) DESC`)
  .limit(limit);
}

async function getUndervaluedAssets(limit = 15) {
  return db.select({
    id:             assets.id,
    lastTradePrice: assets.lastTradePrice,
    fairValueGS:    assetValuationState.fairValueGS,
    divergencePct:  assetValuationState.divergencePct,
    confidenceScore: assetValuationState.confidenceScore,
  })
  .from(assets)
  .innerJoin(assetValuationState, eq(assetValuationState.assetId, assets.id))
  .where(sql`${assets.tradingStatus} = 'ACTIVE'
    AND CAST(${assetValuationState.divergencePct} AS NUMERIC) < ${PVI_CONFIG.FUNDAMENTAL_BUY_DIV_THRESHOLD}
    AND CAST(${assetValuationState.confidenceScore} AS NUMERIC) >= ${PVI_CONFIG.PERF_ANCHOR_MIN_CONFIDENCE}`)
  .orderBy(sql`CAST(${assetValuationState.divergencePct} AS NUMERIC) ASC`)
  .limit(limit);
}

async function getValuationByAssetId(assetId: number) {
  const [row] = await db.select().from(assetValuationState)
    .where(eq(assetValuationState.assetId, assetId)).limit(1);
  return row ?? null;
}

async function getAssetSupply(assetId: number): Promise<number | null> {
  const [st] = await db.select({ supply: assetMarketState.supply })
    .from(assetMarketState).where(eq(assetMarketState.assetId, assetId)).limit(1);
  return st ? parseFloat(st.supply) : null;
}

async function getBotPositions(userId: string) {
  return db.select().from(assetPositions)
    .where(and(eq(assetPositions.userId, userId), gt(assetPositions.shares, 0)));
}

function clampShares(shares: number, balanceUSDC: number, pricePerShare: number, isWhale: boolean): number {
  const maxPct = isWhale ? 0.10 : 0.05;
  const maxByBalance = Math.floor((balanceUSDC * maxPct) / Math.max(pricePerShare, 0.01));
  return Math.max(1, Math.min(shares, maxByBalance));
}

async function capByLiquidity(assetId: number, shares: number): Promise<number> {
  const supply = await getAssetSupply(assetId);
  if (!supply || supply <= 0) return shares;
  const maxByLiquidity = Math.max(1, Math.floor(supply * 0.02));
  return Math.min(shares, maxByLiquidity);
}

// ─── Strategy implementations ─────────────────────────────────────────────────
async function runTrendFollower(userId: string, _portfolioId: number, balance: number) {
  const assetList = await getRandomAssets(5);
  if (!assetList.length) return;

  for (const asset of assetList) {
    const momentum = parseFloat(asset.momentum ?? "0");
    const price = parseFloat(asset.lastTradePrice);
    const price24h = parseFloat(asset.price24hAgo ?? asset.lastTradePrice);
    const dailyChangePct = price24h > 0 ? ((price - price24h) / price24h) * 100 : 0;

    if (momentum > PVI_CONFIG.TREND_SELL_MOMENTUM || dailyChangePct > PVI_CONFIG.DAILY_OVEREXTENSION_PCT) {
      const positions = await getBotPositions(userId);
      const pos = positions.find(p => p.assetId === asset.id);
      if (pos && pos.shares > 0) {
        let shares = Math.min(pos.shares, Math.floor(Math.random() * 2) + 1);
        shares = await capByLiquidity(asset.id, shares);
        await executeAssetTrade({ userId, assetId: asset.id, type: "SELL", shares, source: "BOT" });
        recordTrade(shares * price);
        return;
      }
    }

    if (momentum > PVI_CONFIG.TREND_BUY_MOMENTUM && momentum <= PVI_CONFIG.TREND_SELL_MOMENTUM
        && dailyChangePct < PVI_CONFIG.DAILY_OVEREXTENSION_PCT) {
      let shares = Math.floor(Math.random() * 3) + 1;
      shares = clampShares(shares, balance, price, false);
      shares = await capByLiquidity(asset.id, shares);
      await executeAssetTrade({ userId, assetId: asset.id, type: "BUY", shares, source: "BOT" });
      recordTrade(shares * price);
      return;
    }

    if (momentum < -2) {
      const positions = await getBotPositions(userId);
      const pos = positions.find(p => p.assetId === asset.id);
      if (pos && pos.shares > 0) {
        let shares = Math.min(pos.shares, Math.floor(Math.random() * 2) + 1);
        shares = await capByLiquidity(asset.id, shares);
        await executeAssetTrade({ userId, assetId: asset.id, type: "SELL", shares, source: "BOT" });
        recordTrade(shares * price);
        return;
      }
    }
  }
}

async function runValueTrader(userId: string, _portfolioId: number, balance: number) {
  const assetList = await getAssetsWithValuation(8);
  if (!assetList.length) return;

  for (const asset of assetList) {
    const price = parseFloat(asset.lastTradePrice);
    const fairValue = parseFloat(asset.fairValueGS ?? "0");
    const divergence = Number(asset.divergencePct ?? 0);
    const confidence = Number(asset.confidenceScore ?? 0);
    const price24h = parseFloat(asset.price24hAgo ?? asset.lastTradePrice);
    const dailyChangePct = price24h > 0 ? ((price - price24h) / price24h) * 100 : 0;

    if (fairValue <= 0 || confidence < PVI_CONFIG.PERF_ANCHOR_MIN_CONFIDENCE) continue;

    if (divergence > PVI_CONFIG.FUNDAMENTAL_SELL_DIV_THRESHOLD
        || dailyChangePct > PVI_CONFIG.DAILY_OVEREXTENSION_PCT) {
      const positions = await getBotPositions(userId);
      const pos = positions.find(p => p.assetId === asset.id);
      if (pos && pos.shares > 0) {
        let shares = Math.min(pos.shares, Math.floor(Math.random() * 2) + 1);
        shares = await capByLiquidity(asset.id, shares);
        await executeAssetTrade({ userId, assetId: asset.id, type: "SELL", shares, source: "BOT" });
        recordTrade(shares * price);
        return;
      }
    }

    if (divergence < PVI_CONFIG.FUNDAMENTAL_BUY_DIV_THRESHOLD && dailyChangePct < 5) {
      let shares = Math.floor(Math.random() * 3) + 1;
      shares = clampShares(shares, balance, price, false);
      shares = await capByLiquidity(asset.id, shares);
      await executeAssetTrade({ userId, assetId: asset.id, type: "BUY", shares, source: "BOT" });
      recordTrade(shares * price);
      return;
    }
  }
}

async function runProfitTaker(userId: string, _portfolioId: number, balance: number) {
  const positions = await getBotPositions(userId);
  if (!positions.length) {
    const assetList = await getRandomAssets(5);
    if (!assetList.length) return;
    const downAsset = assetList.find(a => {
      const price = parseFloat(a.lastTradePrice);
      const ago = parseFloat(a.price24hAgo ?? a.lastTradePrice);
      return ago > 0 && price < ago;
    });
    const asset = downAsset ?? assetList[0];
    const price = parseFloat(asset.lastTradePrice);
    let shares = clampShares(2, balance, price, false);
    shares = await capByLiquidity(asset.id, shares);
    await executeAssetTrade({ userId, assetId: asset.id, type: "BUY", shares, source: "BOT" });
    recordTrade(shares * price);
    return;
  }

  for (const pos of positions) {
    const [assetRow] = await db.select({
      lastTradePrice: assets.lastTradePrice,
      price24hAgo:    assets.price24hAgo,
    }).from(assets).where(eq(assets.id, pos.assetId)).limit(1);
    if (!assetRow) continue;

    const currentPrice = parseFloat(assetRow.lastTradePrice);
    const avgCost = parseFloat(pos.averageCost);
    const gainPct = avgCost > 0 ? (currentPrice - avgCost) / avgCost : 0;
    const price24h = parseFloat(assetRow.price24hAgo ?? assetRow.lastTradePrice);
    const dailyChangePct = price24h > 0 ? ((currentPrice - price24h) / price24h) * 100 : 0;

    if ((gainPct > PVI_CONFIG.PROFIT_TAKE_PCT && pos.shares >= 2)
        || (dailyChangePct > PVI_CONFIG.DAILY_OVEREXTENSION_PCT && pos.shares >= 1)) {
      let sharesToSell = Math.max(1, Math.floor(pos.shares / 2));
      sharesToSell = await capByLiquidity(pos.assetId, sharesToSell);
      await executeAssetTrade({ userId, assetId: pos.assetId, type: "SELL", shares: sharesToSell, source: "BOT" });
      recordTrade(sharesToSell * currentPrice);
      return;
    }
  }
}

async function runRandomTrader(userId: string, _portfolioId: number, balance: number) {
  const roll = Math.random();

  if (roll < 0.40) {
    const assetList = await getRandomAssets(3);
    if (!assetList.length) return;
    const asset = assetList[0];
    const price = parseFloat(asset.lastTradePrice);
    let shares = Math.floor(Math.random() * 3) + 1;
    shares = clampShares(shares, balance, price, false);
    shares = await capByLiquidity(asset.id, shares);
    await executeAssetTrade({ userId, assetId: asset.id, type: "BUY", shares, source: "BOT" });
    recordTrade(shares * price);
  } else if (roll < 0.80) {
    const positions = await getBotPositions(userId);
    if (!positions.length) return;
    const pos = positions[Math.floor(Math.random() * positions.length)];
    if (!pos || pos.shares < 1) return;
    const [assetRow] = await db.select({ lastTradePrice: assets.lastTradePrice })
      .from(assets).where(eq(assets.id, pos.assetId)).limit(1);
    let shares = Math.min(pos.shares, Math.floor(Math.random() * 2) + 1);
    shares = await capByLiquidity(pos.assetId, shares);
    await executeAssetTrade({ userId, assetId: pos.assetId, type: "SELL", shares, source: "BOT" });
    const price = assetRow ? parseFloat(assetRow.lastTradePrice) : 0;
    recordTrade(shares * price);
  }
}

async function runWhale(userId: string, _portfolioId: number, balance: number) {
  if (Math.random() > 0.30) return;

  const assetList = await getRandomAssets(5);
  if (!assetList.length) return;

  const asset = assetList[0];
  const price = parseFloat(asset.lastTradePrice);
  const price24h = parseFloat(asset.price24hAgo ?? asset.lastTradePrice);
  const dailyChangePct = price24h > 0 ? ((price - price24h) / price24h) * 100 : 0;
  const momentum = parseFloat(asset.momentum ?? "0");

  const isOverextended = dailyChangePct > PVI_CONFIG.DAILY_OVEREXTENSION_PCT
    || momentum > PVI_CONFIG.TREND_SELL_MOMENTUM;
  const buyProbability = isOverextended ? 0.25 : 0.50;
  const type = Math.random() < buyProbability ? "BUY" : "SELL";

  if (type === "BUY") {
    let shares = Math.floor(Math.random() * 16) + 5;
    shares = clampShares(shares, balance, price, true);
    shares = await capByLiquidity(asset.id, shares);
    await executeAssetTrade({ userId, assetId: asset.id, type: "BUY", shares, source: "BOT" });
    recordTrade(shares * price);
  } else {
    const positions = await getBotPositions(userId);
    if (!positions.length) return;
    const pos = positions[Math.floor(Math.random() * positions.length)];
    if (!pos || pos.shares < 1) return;
    let shares = Math.min(pos.shares, Math.floor(Math.random() * 10) + 3);
    shares = await capByLiquidity(pos.assetId, shares);
    const [assetRow] = await db.select({ lastTradePrice: assets.lastTradePrice })
      .from(assets).where(eq(assets.id, pos.assetId)).limit(1);
    await executeAssetTrade({ userId, assetId: pos.assetId, type: "SELL", shares, source: "BOT" });
    const sellPrice = assetRow ? parseFloat(assetRow.lastTradePrice) : price;
    recordTrade(shares * sellPrice);
  }
}

async function runArbitrageTrader(userId: string, _portfolioId: number, balance: number) {
  const assetList = await getRandomAssets(10);
  if (!assetList.length) return;

  for (const asset of assetList) {
    const price = parseFloat(asset.lastTradePrice);
    const price24h = parseFloat(asset.price24hAgo ?? asset.lastTradePrice);
    const dailyChangePct = price24h > 0 ? ((price - price24h) / price24h) * 100 : 0;

    let valuation;
    try {
      valuation = await getValuationByAssetId(asset.id);
    } catch {
      valuation = null;
    }

    const divergencePct = Number(valuation?.divergencePct ?? -99);
    const isStructural = divergencePct < PVI_CONFIG.STRUCTURAL_DIVERGENCE_THRESHOLD;

    if (isStructural) {
      if (dailyChangePct > PVI_CONFIG.DAILY_OVEREXTENSION_PCT) {
        const positions = await getBotPositions(userId);
        const pos = positions.find(p => p.assetId === asset.id);
        if (pos && pos.shares >= 1) {
          let shares = Math.min(pos.shares, Math.floor(Math.random() * 2) + 1);
          shares = await capByLiquidity(asset.id, shares);
          if (shares < 1) continue;
          await executeAssetTrade({ userId, assetId: asset.id, type: "SELL", shares, source: "BOT" });
          recordTrade(shares * price);
          return;
        }
      }

      if (dailyChangePct < -5) {
        let shares = Math.floor(Math.random() * 2) + 1;
        shares = clampShares(shares, balance, price, false);
        shares = await capByLiquidity(asset.id, shares);
        if (shares < 1) continue;
        await executeAssetTrade({ userId, assetId: asset.id, type: "BUY", shares, source: "BOT" });
        recordTrade(shares * price);
        return;
      }
    } else {
      const fairValueGS = Number(valuation?.fairValueGS ?? 0);
      const confidenceScore = Number(valuation?.confidenceScore ?? 0);
      if (confidenceScore < PVI_CONFIG.CONFIDENCE_LOW_THRESHOLD || fairValueGS <= 0) continue;

      if (divergencePct < PVI_CONFIG.DIVERGENCE_BUY_THRESHOLD) {
        let shares = Math.floor(Math.random() * 3) + 1;
        shares = clampShares(shares, balance, price, false);
        shares = await capByLiquidity(asset.id, shares);
        if (shares < 1) continue;
        await executeAssetTrade({ userId, assetId: asset.id, type: "BUY", shares, source: "BOT" });
        recordTrade(shares * price);
        return;
      }

      if (divergencePct > PVI_CONFIG.DIVERGENCE_SELL_THRESHOLD) {
        const positions = await getBotPositions(userId);
        const pos = positions.find(p => p.assetId === asset.id);
        if (pos && pos.shares >= 1) {
          let shares = Math.min(pos.shares, Math.floor(Math.random() * 2) + 1);
          shares = await capByLiquidity(asset.id, shares);
          if (shares < 1) continue;
          await executeAssetTrade({ userId, assetId: asset.id, type: "SELL", shares, source: "BOT" });
          recordTrade(shares * price);
          return;
        }
      }
    }
  }
}

async function runFundamentalSeller(userId: string, _portfolioId: number, balance: number) {
  const positions = await getBotPositions(userId);
  if (positions.length > 0) {
    for (const pos of positions) {
      let valuation;
      try {
        valuation = await getValuationByAssetId(pos.assetId);
      } catch {
        continue;
      }
      if (!valuation || Number(valuation.confidenceScore) < PVI_CONFIG.PERF_ANCHOR_MIN_CONFIDENCE) continue;
      if (Number(valuation.fairValueGS) <= 0) continue;

      const divergence = Number(valuation.divergencePct);
      if (divergence > PVI_CONFIG.FUNDAMENTAL_SELL_DIV_THRESHOLD) {
        const [assetRow] = await db.select({ lastTradePrice: assets.lastTradePrice })
          .from(assets).where(eq(assets.id, pos.assetId)).limit(1);
        const price = assetRow ? parseFloat(assetRow.lastTradePrice) : 0;

        let shares = Math.min(pos.shares, Math.floor(Math.random() * 3) + 1);
        shares = await capByLiquidity(pos.assetId, shares);
        if (shares < 1) continue;

        await executeAssetTrade({ userId, assetId: pos.assetId, type: "SELL", shares, source: "BOT" });
        recordTrade(shares * price);
        return;
      }
    }
  }

  const undervalued = await getUndervaluedAssets(5);
  if (undervalued.length > 0) {
    const asset = undervalued[Math.floor(Math.random() * Math.min(3, undervalued.length))];
    const price = parseFloat(asset.lastTradePrice);
    let shares = Math.floor(Math.random() * 2) + 1;
    shares = clampShares(shares, balance, price, false);
    shares = await capByLiquidity(asset.id, shares);
    if (shares < 1) return;

    await executeAssetTrade({ userId, assetId: asset.id, type: "BUY", shares, source: "BOT" });
    recordTrade(shares * price);
    return;
  }

  const overvalued = await getOvervaluedAssets(5);
  if (overvalued.length === 0) return;

  for (const asset of overvalued) {
    const pos = positions.find(p => p.assetId === asset.id);
    if (pos && pos.shares >= 1) {
      const price = parseFloat(asset.lastTradePrice);
      let shares = Math.min(pos.shares, 2);
      shares = await capByLiquidity(pos.assetId, shares);
      if (shares < 1) continue;
      await executeAssetTrade({ userId, assetId: pos.assetId, type: "SELL", shares, source: "BOT" });
      recordTrade(shares * price);
      return;
    }
  }
}

// ─── Run a single bot ─────────────────────────────────────────────────────────
async function runBot(userId: string, strategy: string) {
  const [portfolio] = await db.select({ id: portfolios.id, balance: portfolios.balance })
    .from(portfolios).where(eq(portfolios.userId, userId)).limit(1);
  if (!portfolio) return;

  const balance = parseFloat(portfolio.balance);
  if (balance < 1) return;

  switch (strategy) {
    case "TREND_FOLLOWER":     return runTrendFollower(userId, portfolio.id, balance);
    case "VALUE_TRADER":       return runValueTrader(userId, portfolio.id, balance);
    case "PROFIT_TAKER":       return runProfitTaker(userId, portfolio.id, balance);
    case "RANDOM_TRADER":      return runRandomTrader(userId, portfolio.id, balance);
    case "WHALE":              return runWhale(userId, portfolio.id, balance);
    case "ARBITRAGE":          return runArbitrageTrader(userId, portfolio.id, balance);
    case "FUNDAMENTAL_SELLER": return runFundamentalSeller(userId, portfolio.id, balance);
  }
}

// ─── Main worker cycle ────────────────────────────────────────────────────────
async function runBotCycle() {
  try {
    const bots = await db.select({ userId: botProfiles.userId, strategy: botProfiles.strategy })
      .from(botProfiles).orderBy(sql`random()`)
      .limit(BOT_BATCH_SIZE_MAX);

    if (!bots.length) return;

    const batchSize = BOT_BATCH_SIZE_MIN + Math.floor(Math.random() * (BOT_BATCH_SIZE_MAX - BOT_BATCH_SIZE_MIN + 1));
    const batch = bots.slice(0, batchSize);

    for (const bot of batch) {
      try {
        await runBot(bot.userId, bot.strategy);
      } catch (e: any) {
        if (process.env.NODE_ENV !== "production") {
          console.debug(`[BotTrader] bot ${bot.userId} skipped: ${e?.message}`);
        }
      }
    }
  } catch (e) {
    console.error("[BotTrader] cycle error:", e);
  }
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────
let workerTimer: ReturnType<typeof setTimeout> | null = null;
let running = false;

function scheduleNext() {
  if (!running) return;
  workerTimer = setTimeout(async () => {
    await runBotCycle();
    scheduleNext();
  }, BOT_INTERVAL_MS);
}

export async function startBotSimulator() {
  if (running) return;
  running = true;
  await seedBots();
  console.log("[BotTrader] Starting bot simulator");
  scheduleNext();
}

export function stopBotSimulator() {
  running = false;
  if (workerTimer) {
    clearTimeout(workerTimer);
    workerTimer = null;
  }
  console.log("[BotTrader] Bot simulator stopped");
}

export function isBotSimulatorRunning() { return running; }

export async function getBotMetrics() {
  const [countRow] = await db.select({ c: sql<number>`count(*)` }).from(botProfiles);
  const botCount = Number(countRow?.c ?? 0);

  return {
    running,
    botCount,
    tradesPerHour: tradesPerHour(),
    totalBotVolume24h: Math.round(totalBotVolume24h * 100) / 100,
    intervalMs: BOT_INTERVAL_MS,
    batchSizeMin: BOT_BATCH_SIZE_MIN,
    batchSizeMax: BOT_BATCH_SIZE_MAX,
  };
}

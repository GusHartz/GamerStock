import { storage } from "./storage";
import { vaults, users, riotAssets, assets, assetMarkets, assetMarketState, assetValuationState } from "@shared/schema";
import { db } from "./db";
import { eq, sql } from "drizzle-orm";
import { getMarketMode } from "./app-config";
import { spotPrice, costToBuy, payoutToSell, DEFAULT_AMM_PARAMS, supplyForPrice } from "./services/ammPricing";
import { terminalBroadcaster } from "./sse/terminalBroadcaster";
import { computeQuotes } from "@shared/market-quotes";
import { computeGravityPct, computePerformanceAnchorPct, PVI_CONFIG } from "./services/pviEngine";

// ─── Momentum Decay ───────────────────────────────────────────────────────────
// Applied every tick. 10% decay per 15s prevents momentum buildup without trading signal.
async function applyMomentumDecay() {
  try {
    await db.update(riotAssets).set({
      momentum: sql`ROUND(CAST(${riotAssets.momentum} AS NUMERIC) * ${PVI_CONFIG.MOMENTUM_DECAY}, 4)`,
      updatedAt: new Date(),
    });
  } catch (err: any) {
    console.debug("[MarketMaker/MomentumDecay] skipped:", err?.message);
  }
}

// ─── Performance Anchor Engine (PAE) ─────────────────────────────────────────
/**
 * The Performance Anchor Engine is the core mechanism for "performance-led pricing".
 *
 * Every market tick (15s), it applies a structural pull toward Fair Value on ALL assets.
 * This is separate from per-trade gravity (which only fires on the one asset that traded).
 *
 * Mechanism:
 *   1. Read divergencePct and confidenceScore from asset_valuation_state (pre-computed by valuationJob)
 *   2. Compute an anchor adjustment based on divergence magnitude (3 bands)
 *   3. Batch-update riotAssets.lastTradePrice by that fractional amount
 *   4. Sync assets.lastTradePrice to match
 *   5. Update AMM supply so the bonding curve stays consistent
 *
 * Effect over time:
 *   - Assets with PVI > 60 (currently undervalued at avg $18): price drifts UP
 *   - Assets with PVI < 60 (currently overvalued at avg $18): price drifts DOWN
 *   - This creates real winners/losers based on player performance
 *
 * This force is intentionally weak per tick but cumulative over hours/days,
 * ensuring convergence without crushing short-term speculation.
 */
async function applyPerformanceAnchor() {
  try {
    // Fetch all valuation states
    const valuations = await db
      .select({
        puuid: assetValuationState.puuid,
        divergencePct: assetValuationState.divergencePct,
        confidenceScore: assetValuationState.confidenceScore,
        fairValueGS: assetValuationState.fairValueGS,
      })
      .from(assetValuationState);

    if (!valuations.length) return;

    let anchored = 0;
    let pushed_up = 0;
    let pushed_down = 0;

    for (const val of valuations) {
      const divPct = parseFloat(val.divergencePct);
      const confidence = parseFloat(val.confidenceScore);
      const fairValue = parseFloat(val.fairValueGS);

      const anchorPct = computePerformanceAnchorPct(divPct, confidence);
      if (anchorPct === 0) continue;

      // Apply to riotAssets
      const multiplier = 1.0 + anchorPct;
      await db.update(riotAssets).set({
        lastTradePrice: sql`GREATEST(
          ${PVI_CONFIG.FAIR_VALUE_MIN}::NUMERIC,
          ROUND(CAST(${riotAssets.lastTradePrice} AS NUMERIC) * ${multiplier}::NUMERIC, 2)
        )`,
        updatedAt: new Date(),
      }).where(eq(riotAssets.puuid, val.puuid));

      // Sync assets.lastTradePrice (used by drift + AMM display)
      await db.execute(sql`
        UPDATE assets a
        SET last_trade_price = ra.last_trade_price, updated_at = NOW()
        FROM riot_assets ra
        WHERE a.external_id = ra.puuid
        AND ra.puuid = ${val.puuid}
      `);

      anchored++;
      if (anchorPct > 0) pushed_up++;
      else pushed_down++;
    }

    if (anchored > 0) {
      console.log(`[PAE] Performance anchor applied: ${anchored} assets (↑${pushed_up} ↓${pushed_down})`);
    }
  } catch (err: any) {
    console.error("[PAE] Error in performance anchor:", err?.message);
  }
}

let simulatorPaused = false;

export function pauseSimulator() { simulatorPaused = true; }
export function resumeSimulator() { simulatorPaused = false; }
export function isSimulatorPaused() { return simulatorPaused; }

async function executeRealMakerTrade() {
  const riotRows = await db
    .select({
      puuid: riotAssets.puuid,
      lastTradePrice: riotAssets.lastTradePrice,
      volume24h: riotAssets.volume24h,
    })
    .from(riotAssets)
    .orderBy(sql`random()`)
    .limit(1);

  if (!riotRows || riotRows.length === 0) return;
  const asset = riotRows[0];

  const type = Math.random() > 0.5 ? "BUY" : "SELL";
  const shares = Math.floor(Math.random() * 15) + 3;

  const [assetsRow] = await db.select({ id: assets.id })
    .from(assets).where(eq(assets.externalId, asset.puuid)).limit(1);

  let executionPrice: number;
  let newSupply: number | null = null;
  let assetIdForSSE: number | null = null;

  if (assetsRow) {
    const [mkt] = await db.select().from(assetMarkets)
      .where(eq(assetMarkets.assetId, assetsRow.id));
    const [st] = await db.select().from(assetMarketState)
      .where(eq(assetMarketState.assetId, assetsRow.id));

    if (mkt && st && mkt.isEnabled) {
      const p = {
        floorPrice: parseFloat(mkt.floorPrice),
        paramA: parseFloat(mkt.paramA),
        paramB: parseFloat(mkt.paramB),
      };
      const supply = parseFloat(st.supply);

      if (type === "SELL" && supply < shares) {
        executionPrice = spotPrice(supply, p);
      } else {
        executionPrice = type === "BUY"
          ? costToBuy(supply, shares, p) / shares
          : payoutToSell(supply, shares, p) / shares;
      }

      newSupply = type === "BUY" ? supply + shares : Math.max(0, supply - shares);
      let newSpot = spotPrice(newSupply, p);

      // Per-trade gravity: small pull toward Fair Value after each trade
      let gravityPct = 0;
      let fairValueGS: number | null = null;
      try {
        const [valState] = await db
          .select({ divergencePct: assetValuationState.divergencePct, fairValueGS: assetValuationState.fairValueGS })
          .from(assetValuationState)
          .where(eq(assetValuationState.assetId, assetsRow.id))
          .limit(1);
        if (valState) {
          const divPct = parseFloat(valState.divergencePct);
          fairValueGS = parseFloat(valState.fairValueGS);
          gravityPct = computeGravityPct(divPct);
          newSpot = newSpot * (1 + gravityPct);
          if (Math.abs(gravityPct) > 0.0002) {
            console.log(`[MarketMaker/GRAVITY] assetId=${assetsRow.id} div=${divPct.toFixed(1)}% grav=${(gravityPct * 100).toFixed(3)}% fv=${fairValueGS.toFixed(2)}`);
          }
        }
      } catch (gravErr: any) {
        // Gravity is non-critical
      }

      await db.update(assetMarketState)
        .set({
          supply: newSupply.toFixed(6),
          lastPrice: newSpot.toFixed(6),
          lastUpdatedAt: new Date(),
          version: st.version + 1,
        })
        .where(eq(assetMarketState.assetId, assetsRow.id));

      await db.update(assets)
        .set({ lastTradePrice: newSpot.toFixed(2), updatedAt: new Date() })
        .where(eq(assets.id, assetsRow.id));

      executionPrice = newSpot;
      assetIdForSSE = assetsRow.id;
    } else {
      const basePrice = parseFloat(asset.lastTradePrice);
      const qty = type === "BUY" ? shares : -shares;
      executionPrice = basePrice * (1 + qty / 25000);
    }
  } else {
    const basePrice = parseFloat(asset.lastTradePrice);
    const qty = type === "BUY" ? shares : -shares;
    executionPrice = basePrice * (1 + qty / 25000);
  }

  const grossValue = Math.abs(executionPrice) * shares;
  const newVolume = parseFloat(asset.volume24h) + grossValue;

  await db
    .update(riotAssets)
    .set({
      lastTradePrice: executionPrice.toFixed(2),
      volume24h: newVolume.toFixed(2),
      updatedAt: new Date(),
    })
    .where(eq(riotAssets.puuid, asset.puuid));

  if (assetIdForSSE) {
    const oldPrice = parseFloat(asset.lastTradePrice);
    terminalBroadcaster.emit({
      type: "PRICE_UPDATE",
      data: {
        assetId: assetIdForSSE,
        price: executionPrice.toFixed(2),
        change: executionPrice - oldPrice,
        ts: Date.now(),
        source: "MARKET_MAKER",
      },
    });
    terminalBroadcaster.emit({
      type: "TRADE_TICK",
      data: {
        assetId: assetIdForSSE,
        side: type,
        size: shares,
        price: executionPrice.toFixed(2),
        ts: Date.now(),
        badge: "MM",
      },
    });
  }

  console.log(`[MarketMaker/REAL] ${type} puuid=${asset.puuid.slice(0, 8)}... qty=${shares} price_before=${parseFloat(asset.lastTradePrice).toFixed(2)} price_after=${executionPrice.toFixed(2)} amm=${!!assetIdForSSE}`);
}

async function executeSandboxMakerTrade() {
  const mmUserId = "MarketMaker";
  await db
    .insert(users)
    .values({ id: mmUserId, email: "mm@gamerstock.ai", firstName: "Market", lastName: "Maker" })
    .onConflictDoNothing();

  let portfolio = await storage.getPortfolioByUserId(mmUserId);
  if (!portfolio) {
    portfolio = await storage.createPortfolio({ userId: mmUserId, balance: "1000000.00" });
  }

  const { data: allVaults } = await storage.getVaults({ limit: 1000 });
  if (!allVaults || allVaults.length === 0) return;

  const vault = allVaults[Math.floor(Math.random() * allVaults.length)];

  const type = Math.random() > 0.5 ? "BUY" : "SELL";
  const shares = Math.floor(Math.random() * 21) + 5;

  const liquidity = 10000;
  const basePrice = parseFloat(vault.lastTradePrice);
  const qty = type === "BUY" ? shares : -shares;

  if (type === "SELL") {
    const position = await storage.getPosition(portfolio.id, vault.id);
    if (!position || position.shares < shares) {
      await storage.upsertPosition({
        portfolioId: portfolio.id,
        vaultId: vault.id,
        shares: shares + 100,
        averageCost: vault.lastTradePrice
      });
    }
  }

  const executionPrice = basePrice * (1 + qty / liquidity);
  const grossValue = executionPrice * shares;
  const fee = grossValue * 0.02;

  let newBalance = parseFloat(portfolio.balance);
  if (type === "BUY") {
    newBalance -= (grossValue + fee);
  } else {
    newBalance += (grossValue - fee);
  }
  await storage.updatePortfolioBalance(portfolio.id, newBalance.toFixed(2));

  await storage.createTrade({
    portfolioId: portfolio.id,
    vaultId: vault.id,
    type,
    shares,
    pricePerShare: executionPrice.toFixed(2),
    totalCost: (type === "BUY" ? grossValue + fee : grossValue - fee).toFixed(2),
    fee: fee.toFixed(2)
  });

  const currentPosition = await storage.getPosition(portfolio.id, vault.id);
  const newShares = (currentPosition?.shares || 0) + (type === "BUY" ? shares : -shares);
  await storage.upsertPosition({
    portfolioId: portfolio.id,
    vaultId: vault.id,
    shares: Math.max(0, newShares),
    averageCost: vault.lastTradePrice
  });

  const newVolume = parseFloat(vault.volume24h) + grossValue;
  await storage.updateVault(vault.id, {
    lastTradePrice: executionPrice.toFixed(2),
    volume24h: newVolume.toFixed(2)
  });

  await storage.createVaultSnapshot({
    vaultId: vault.id,
    price: executionPrice.toFixed(2),
    performanceIndex: vault.performanceIndex
  });

  console.log(`[MarketMaker/SANDBOX] ${type} vault_id=${vault.id} qty=${shares} price_before=${basePrice.toFixed(2)} price_after=${executionPrice.toFixed(2)}`);
}

// PAE runs every N ticks to avoid hammering the DB on every 15s cycle
let paeTickCounter = 0;
const PAE_TICK_INTERVAL = 4; // run PAE every 4 ticks = once per minute

async function executeMarketMakerTrade() {
  if (simulatorPaused) return;
  try {
    const mode = await getMarketMode();
    if (mode === "REAL_RIOT_NA1") {
      await executeRealMakerTrade();
    } else {
      await executeSandboxMakerTrade();
    }
    await applyMomentumDecay();

    // Performance Anchor Engine: runs every ~60s (every 4 × 15s ticks)
    paeTickCounter++;
    if (paeTickCounter >= PAE_TICK_INTERVAL) {
      paeTickCounter = 0;
      await applyPerformanceAnchor();
    }
  } catch (error) {
    console.error("[MarketMaker] Error executing trade:", error);
  }
}

export function startMarketSimulator() {
  console.log("Starting Market Activity Simulator (15s interval) with Performance Anchor Engine...");

  const runCycle = async () => {
    await executeMarketMakerTrade();
    setTimeout(runCycle, 15000);
  };

  runCycle();
}

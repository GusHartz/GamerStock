/**
 * Valuation Job
 *
 * Computes and persists PVI (Player Value Index) + Fair Value for each riot asset.
 * Reads from riotMatchCache (PP scores 0-100), riotPlayerState (legacy EMA),
 * and riotAssets (current market price for divergence calculation).
 *
 * Called:
 *   - After new match data is processed in riot-perf.ts
 *   - By a scheduled batch job (runValuationBatch)
 *   - Manually via admin API
 *
 * IMPORTANT: This service never modifies market prices.
 * Market price is only changed by trades and market-maker gravity.
 */

import { db } from "../db";
import {
  riotMatchCache,
  riotAssets,
  assets,
  assetMarketState,
  assetMarkets,
  assetValuationState,
} from "@shared/schema";
import { eq, desc, sql, and, gt } from "drizzle-orm";
import { eventBus, createValuationUpdatedEvent } from "../events";
import {
  ppToMPS,
  computeRecentPerformance,
  computeConsistencyScore,
  computeHistoricalSkill,
  computeActivityScore,
  computeConfidenceScore,
  computePVIRaw,
  computePVIAdjusted,
  computeFairValue,
  computeDivergence,
  computeInactivityDecayFactor,
  emaUpdate,
  clamp,
  PVI_CONFIG,
} from "./pviEngine";
import { spotPrice } from "./ammPricing";

// ─── Default fallback valuation state ────────────────────────────────────────

export function defaultValuationState() {
  return {
    recentPerformance: 50,
    consistencyScore: 50,
    historicalSkill: 50,
    activityScore: 50,
    pviRaw: 50,
    pviFinal: 50,
    pviAdjusted: 50,
    confidenceScore: 0,
    fairValueGS: 5,
    divergencePct: 0,
    lastMatchPulse: 50,
  };
}

// ─── Read valuation state with fallback ──────────────────────────────────────

export async function getValuationState(puuid: string): Promise<{
  recentPerformance: number;
  consistencyScore: number;
  historicalSkill: number;
  activityScore: number;
  pviRaw: number;
  pviFinal: number;
  pviAdjusted: number;
  confidenceScore: number;
  fairValueGS: number;
  divergencePct: number;
  lastMatchPulse: number;
}> {
  const [row] = await db
    .select()
    .from(assetValuationState)
    .where(eq(assetValuationState.puuid, puuid))
    .limit(1);

  if (!row) return defaultValuationState();

  return {
    recentPerformance: parseFloat(row.recentPerformance),
    consistencyScore: parseFloat(row.consistencyScore),
    historicalSkill: parseFloat(row.historicalSkill),
    activityScore: parseFloat(row.activityScore),
    pviRaw: parseFloat(row.pviRaw),
    pviFinal: parseFloat(row.pviFinal),
    pviAdjusted: parseFloat(row.pviAdjusted),
    confidenceScore: parseFloat(row.confidenceScore),
    fairValueGS: parseFloat(row.fairValueGS),
    divergencePct: parseFloat(row.divergencePct),
    lastMatchPulse: parseFloat(row.lastMatchPulse),
  };
}

// ─── Core: compute and persist valuation for one player ──────────────────────

export async function computeAndPersistValuation(puuid: string): Promise<void> {
  // 1. Load all match scores from riotMatchCache (PP 0-100), ordered oldest→newest
  const matchRows = await db
    .select({
      perfScore: riotMatchCache.perfScore,
      processedAt: riotMatchCache.processedAt,
    })
    .from(riotMatchCache)
    .where(eq(riotMatchCache.puuid, puuid))
    .orderBy(riotMatchCache.processedAt);

  const nowMs = Date.now();
  const scores: number[] = matchRows.map(r => parseFloat(r.perfScore));
  const timestamps: number[] = matchRows.map(r => new Date(r.processedAt).getTime());
  const totalCount = scores.length;

  // MPS conversion: PP scores are already 0-100, pass them directly
  const mpsScores = scores.map(ppToMPS);

  // 2. Compute time-related activity stats
  let daysSinceLastMatch = 999;
  let matchCount7d = 0;
  let matchCount30d = 0;
  if (matchRows.length > 0) {
    const lastMatchMs = new Date(matchRows[matchRows.length - 1].processedAt).getTime();
    daysSinceLastMatch = (nowMs - lastMatchMs) / (1000 * 60 * 60 * 24);

    const cutoff7d = nowMs - 7 * 24 * 60 * 60 * 1000;
    const cutoff30d = nowMs - 30 * 24 * 60 * 60 * 1000;
    matchCount7d = matchRows.filter(r => new Date(r.processedAt).getTime() > cutoff7d).length;
    matchCount30d = matchRows.filter(r => new Date(r.processedAt).getTime() > cutoff30d).length;
  }

  // 3. Compute PVI components
  const recentPerformance = computeRecentPerformance(mpsScores);
  const consistencyScore = computeConsistencyScore(mpsScores);
  const historicalSkill = computeHistoricalSkill(mpsScores, timestamps, nowMs);
  const activityScore = computeActivityScore(matchCount7d, matchCount30d, daysSinceLastMatch);
  const confidenceScore = computeConfidenceScore(totalCount, daysSinceLastMatch, true);

  const pviComponents = { recentPerformance, consistencyScore, historicalSkill, activityScore, confidenceScore };
  const pviRaw = computePVIRaw(pviComponents);

  // 3b. Apply explicit inactivity decay to RecentPerformance (separate from ActivityScore).
  //     This pulls RecentPerformance toward neutral (50) for idle players,
  //     directly reducing valuation prominence when the player hasn't been competing.
  const inactivityMultiplier = computeInactivityDecayFactor(daysSinceLastMatch);
  const recentPerformanceDecayed = daysSinceLastMatch >= PVI_CONFIG.INACTIVITY_GRACE_DAYS
    ? clamp(
        // Decay toward neutral (50): factor × score + (1-factor) × 50
        recentPerformance * inactivityMultiplier + PVI_CONFIG.NEUTRAL_PVI * (1 - inactivityMultiplier),
        0, 100
      )
    : recentPerformance;

  // 4. EMA-smooth pviRaw into pviFinal (load previous state for continuity)
  const [existingState] = await db
    .select({ pviFinal: assetValuationState.pviFinal, fairValueGS: assetValuationState.fairValueGS })
    .from(assetValuationState)
    .where(eq(assetValuationState.puuid, puuid))
    .limit(1);

  // Use decayed recentPerformance in PVI components
  const pviComponentsWithDecay = {
    ...pviComponents,
    recentPerformance: recentPerformanceDecayed,
  };
  const pviRawWithDecay = computePVIRaw(pviComponentsWithDecay);

  const prevPviFinal = existingState ? parseFloat(existingState.pviFinal) : pviRawWithDecay;
  const pviFinal = emaUpdate(prevPviFinal, pviRawWithDecay, PVI_CONFIG.EMA_ALPHA);

  // 5. Adjust PVI for confidence (regress toward 50 when low confidence)
  const pviAdjusted = computePVIAdjusted(pviFinal, confidenceScore);

  // 6. Compute Fair Value — with cap to prevent large single-run swings.
  const fairValueGSRaw = computeFairValue(pviAdjusted);
  const prevFairValueGS = existingState ? parseFloat(existingState.fairValueGS) : fairValueGSRaw;
  const fairValueGS = clamp(
    fairValueGSRaw,
    prevFairValueGS - PVI_CONFIG.FAIR_VALUE_MAX_DELTA,
    prevFairValueGS + PVI_CONFIG.FAIR_VALUE_MAX_DELTA,
  );

  // 7. Compute Last Match Pulse (most recent PP score, or 50 if none)
  const lastMatchPulse = mpsScores.length > 0 ? mpsScores[mpsScores.length - 1] : 50;

  // 8. Get current market price from AMM state or riotAssets fallback
  let marketPrice = fairValueGS; // default: no divergence
  const [assetRow] = await db
    .select({ id: assets.id })
    .from(assets)
    .where(eq(assets.externalId, puuid))
    .limit(1);

  if (assetRow) {
    const [mkt] = await db.select().from(assetMarkets).where(eq(assetMarkets.assetId, assetRow.id));
    const [st] = await db.select().from(assetMarketState).where(eq(assetMarketState.assetId, assetRow.id));

    if (mkt && st && mkt.isEnabled) {
      marketPrice = spotPrice(parseFloat(st.supply), {
        floorPrice: parseFloat(mkt.floorPrice),
        paramA: parseFloat(mkt.paramA),
        paramB: parseFloat(mkt.paramB),
      });
    } else {
      // Fallback to riotAssets.lastTradePrice
      const [riotRow] = await db
        .select({ lastTradePrice: riotAssets.lastTradePrice })
        .from(riotAssets)
        .where(eq(riotAssets.puuid, puuid))
        .limit(1);
      if (riotRow) marketPrice = parseFloat(riotRow.lastTradePrice);
    }
  }

  // 9. Compute divergence
  const divergencePct = computeDivergence(marketPrice, fairValueGS);

  // 10. Upsert to asset_valuation_state
  if (!assetRow) {
    // Can't store without an asset row — log and return gracefully
    console.warn(`[ValuationJob] No asset row found for puuid=${puuid.slice(0, 12)}..., skipping persist`);
    return;
  }

  await db
    .insert(assetValuationState)
    .values({
      assetId: assetRow.id,
      puuid,
      recentPerformance: recentPerformance.toFixed(4),
      consistencyScore: consistencyScore.toFixed(4),
      historicalSkill: historicalSkill.toFixed(4),
      activityScore: activityScore.toFixed(4),
      pviRaw: pviRaw.toFixed(4),
      pviFinal: pviFinal.toFixed(4),
      pviAdjusted: pviAdjusted.toFixed(4),
      confidenceScore: confidenceScore.toFixed(4),
      fairValueGS: fairValueGS.toFixed(4),
      divergencePct: divergencePct.toFixed(4),
      lastMatchPulse: lastMatchPulse.toFixed(4),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: assetValuationState.assetId,
      set: {
        puuid,
        recentPerformance: recentPerformance.toFixed(4),
        consistencyScore: consistencyScore.toFixed(4),
        historicalSkill: historicalSkill.toFixed(4),
        activityScore: activityScore.toFixed(4),
        pviRaw: pviRaw.toFixed(4),
        pviFinal: pviFinal.toFixed(4),
        pviAdjusted: pviAdjusted.toFixed(4),
        confidenceScore: confidenceScore.toFixed(4),
        fairValueGS: fairValueGS.toFixed(4),
        divergencePct: divergencePct.toFixed(4),
        lastMatchPulse: lastMatchPulse.toFixed(4),
        updatedAt: new Date(),
      },
    });

  // 11. Also mirror fairValueGS to assets.fundamentalPrice for backward compat with existing UI
  await db
    .update(assets)
    .set({ fundamentalPrice: fairValueGS.toFixed(6), fundamentalUpdatedAt: new Date() })
    .where(eq(assets.id, assetRow.id));

  console.log(
    `[ValuationJob] ${puuid.slice(0, 12)}...: ` +
    `pvi=${pviAdjusted.toFixed(1)} fv=${fairValueGS.toFixed(2)}GS(raw=${fairValueGSRaw.toFixed(2)}) ` +
    `mktPrice=${marketPrice.toFixed(2)} div=${divergencePct.toFixed(1)}% ` +
    `conf=${(confidenceScore * 100).toFixed(0)}% ` +
    `inact=${inactivityMultiplier.toFixed(2)}x(${daysSinceLastMatch.toFixed(1)}d)`,
  );

  eventBus.emitBackground(createValuationUpdatedEvent({
    puuid,
    fairValueGS,
    divergencePct,
    confidenceScore,
    recentPerformance,
  }));
}

// ─── Batch runner ─────────────────────────────────────────────────────────────

let valuationBatchRunning = false;

export async function runValuationBatch(limit = 50): Promise<{ processed: number; errors: number }> {
  if (valuationBatchRunning) {
    console.log("[ValuationJob] Batch already running, skipping.");
    return { processed: 0, errors: 0 };
  }
  valuationBatchRunning = true;
  let processed = 0;
  let errors = 0;

  try {
    // Process assets that have match cache data, prioritize those not recently valued
    const puuids = await db
      .select({ puuid: riotMatchCache.puuid })
      .from(riotMatchCache)
      .groupBy(riotMatchCache.puuid)
      .orderBy(sql`random()`)
      .limit(limit);

    for (const { puuid } of puuids) {
      try {
        await computeAndPersistValuation(puuid);
        processed++;
      } catch (err: any) {
        errors++;
        console.error(`[ValuationJob] Error for puuid=${puuid.slice(0, 12)}...: ${err.message}`);
      }
    }
  } finally {
    valuationBatchRunning = false;
  }

  console.log(`[ValuationJob] Batch complete: processed=${processed} errors=${errors}`);
  return { processed, errors };
}

// ─── Seed initial valuations for all known riot assets ───────────────────────

export async function seedInitialValuations(): Promise<void> {
  const allAssets = await db
    .select({ puuid: riotAssets.puuid })
    .from(riotAssets);

  let seeded = 0;
  for (const { puuid } of allAssets) {
    try {
      await computeAndPersistValuation(puuid);
      seeded++;
    } catch (err: any) {
      console.warn(`[ValuationJob] Seed error for ${puuid.slice(0, 12)}...: ${err.message}`);
    }
  }
  console.log(`[ValuationJob] Initial seed complete: ${seeded}/${allAssets.length} assets valued`);
}

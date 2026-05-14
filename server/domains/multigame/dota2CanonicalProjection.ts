// ─── Dota2 → Canonical Market Projection ─────────────────────────────────────
//
// This module is the ONLY place where Dota2 domain data crosses into the
// canonical market layer (assets, asset_price_snapshots).
//
// Responsibilities:
//   1. Project playerValue → assets.fundamentalPrice (always, on every call)
//   2. Seed assets.lastTradePrice = playerValue on FIRST projection only
//      (detected by fundamentalPrice IS NULL, meaning never projected before)
//   3. Seed assets.price24hAgo = playerValue on first projection (same guard)
//   4. Insert one asset_price_snapshots row on first projection only
//
// What this does NOT do:
//   - Seed AMM (asset_markets / asset_market_state) — that happens on admin approval
//   - Touch riotTrades, riotPositions, or any Riot-specific table
//   - Leak Dota2 domain tables into the canonical read path
//
// Idempotency:
//   - fundamentalPrice is always overwritten with the latest playerValue
//   - lastTradePrice / price24hAgo / snapshots are written ONCE (first projection guard)
//   - Running this multiple times is always safe
// ─────────────────────────────────────────────────────────────────────────────

import { db }                        from "../../db";
import { assets, assetPriceSnapshots } from "@shared/schema";
import { eq, isNull }                 from "drizzle-orm";

/**
 * Project a Dota2 playerValue into the canonical asset row.
 *
 * @param assetId    - canonical assets.id (not playerProfileId)
 * @param playerValue - the latest computed playerValue from dota2ValuationService
 */
export async function projectDota2ValuationToCanonical(
  assetId:     number,
  playerValue: number,
): Promise<void> {
  const priceStr = playerValue.toFixed(2);

  // ── Read current state ────────────────────────────────────────────────────
  const [current] = await db
    .select({ fundamentalPrice: assets.fundamentalPrice })
    .from(assets)
    .where(eq(assets.id, assetId))
    .limit(1);

  if (!current) {
    console.warn(`[Dota2Projection] Asset id=${assetId} not found in canonical assets table.`);
    return;
  }

  const isFirstProjection = current.fundamentalPrice === null;

  if (isFirstProjection) {
    // ── First projection: seed fundamental + market price + snapshot ────────
    await db.update(assets)
      .set({
        fundamentalPrice:    priceStr,
        fundamentalUpdatedAt: new Date(),
        lastTradePrice:       priceStr,
        price24hAgo:          priceStr,
        updatedAt:            new Date(),
      })
      .where(eq(assets.id, assetId));

    await db.insert(assetPriceSnapshots).values({
      assetId,
      price:     priceStr,
      volume24h: "0.00",
      momentum:  "0.0000",
    });

    console.log(
      `[Dota2Projection] First projection assetId=${assetId} ` +
      `playerValue=${priceStr} → fundamentalPrice + lastTradePrice + snapshot seeded`,
    );
  } else {
    // ── Subsequent projections: only refresh fundamentalPrice ─────────────
    // lastTradePrice is now driven by actual market activity — do not reset it.
    await db.update(assets)
      .set({
        fundamentalPrice:    priceStr,
        fundamentalUpdatedAt: new Date(),
        updatedAt:            new Date(),
      })
      .where(eq(assets.id, assetId));

    console.log(
      `[Dota2Projection] Update assetId=${assetId} fundamentalPrice=${priceStr}`,
    );
  }
}

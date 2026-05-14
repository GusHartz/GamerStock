import { db } from "../db";
import { markets, assets, assetPriceSnapshots } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import type { CanonicalAssetInput } from "../providers/types";

function buildAssetUid(a: CanonicalAssetInput) {
  return `${a.provider}:${a.game}:${a.entityType}:${a.externalId}`;
}

export async function getOrCreateMarket(input: CanonicalAssetInput) {
  const provider = input.provider;
  const game = input.game;
  const region = input.region ?? "global";
  const scope = input.scope ?? "default";

  const [m] = await db.select().from(markets).where(and(
    eq(markets.provider, provider),
    eq(markets.game, game),
    eq(markets.region, region),
    eq(markets.scope, scope),
  ));

  if (m) return m;

  const [created] = await db.insert(markets).values({
    provider, game, region, scope,
    isActive: true,
  }).returning();

  return created;
}

export async function upsertAssetsFromProvider(rows: CanonicalAssetInput[]) {
  const results = [];

  for (const row of rows) {
    const market = await getOrCreateMarket(row);
    const assetUid = buildAssetUid(row);

    const values = {
      marketId: market.id,
      assetUid,
      entityType: row.entityType,
      externalId: row.externalId,
      displayName: row.displayName,
      symbol: row.symbol ?? "",

      lastTradePrice: row.lastTradePrice ?? "10.00",
      price24hAgo: row.price24hAgo ?? "10.00",
      volume24h: row.volume24h ?? "0.00",
      momentum: row.momentum ?? "0.0000",

      providerJson: row.providerJson ?? null,
      lastSyncedAt: row.lastSyncedAt ?? new Date(),
      updatedAt: new Date(),
    } as const;

    const [asset] = await db.insert(assets)
      .values(values)
      .onConflictDoUpdate({
        target: [assets.assetUid],
        set: values,
      })
      .returning();

    await db.insert(assetPriceSnapshots).values({
      assetId: asset.id,
      price: asset.lastTradePrice,
      volume24h: asset.volume24h,
      momentum: asset.momentum,
    });

    results.push(asset);
  }

  return results;
}

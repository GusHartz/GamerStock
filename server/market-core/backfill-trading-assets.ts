/**
 * LEGACY — Sandbox Backfill Utility
 *
 * One-time migration utility that links vault records to canonical sandbox assets.
 * FREEZE: Do not add new backfill logic here.
 * This file exists only to repair data from the original vault-seeding phase.
 * Retirement: safe to remove once all vaults confirmed linked and sandbox mode deprecated.
 * See: docs/architecture/legacy-freeze-and-retirement-plan.md
 */
import { db } from "../db";
import { vaults, trades, positions, assets, markets } from "@shared/schema";
import { eq, isNull, and } from "drizzle-orm";
import { sql } from "drizzle-orm";

const SANDBOX_MARKET = {
  provider: "gamerstock",
  game: "lol",
  region: "SANDBOX",
  scope: "SANDBOX",
};

async function getOrCreateSandboxMarket() {
  const [existing] = await db.select().from(markets).where(
    and(
      eq(markets.provider, SANDBOX_MARKET.provider),
      eq(markets.game, SANDBOX_MARKET.game),
      eq(markets.region, SANDBOX_MARKET.region),
      eq(markets.scope, SANDBOX_MARKET.scope),
    )
  );
  if (existing) return existing;

  const [created] = await db.insert(markets).values({
    ...SANDBOX_MARKET,
    isActive: true,
  }).returning();
  return created;
}

export async function backfillTradingAssetLinks(): Promise<{
  vaultsLinked: number;
  tradesBackfilled: number;
  positionsBackfilled: number;
}> {
  const market = await getOrCreateSandboxMarket();

  const allVaults = await db.select().from(vaults);
  let vaultsLinked = 0;

  for (const vault of allVaults) {
    const assetUid = `gamerstock:lol:player:vault-${vault.id}`;

    const values = {
      marketId: market.id,
      assetUid,
      entityType: "player",
      externalId: `vault-${vault.id}`,
      displayName: vault.playerAlias,
      symbol: "",
      lastTradePrice: vault.lastTradePrice,
      price24hAgo: vault.price24hAgo ?? vault.lastTradePrice,
      volume24h: vault.volume24h ?? "0.00",
      momentum: vault.momentum ?? "0.0000",
      providerJson: null,
      lastSyncedAt: vault.updatedAt ?? new Date(),
      updatedAt: new Date(),
    } as const;

    const [asset] = await db.insert(assets)
      .values(values)
      .onConflictDoUpdate({
        target: [assets.assetUid],
        set: {
          displayName: values.displayName,
          lastTradePrice: values.lastTradePrice,
          price24hAgo: values.price24hAgo,
          volume24h: values.volume24h,
          momentum: values.momentum,
          updatedAt: new Date(),
        },
      })
      .returning();

    await db.update(vaults)
      .set({ assetId: asset.id })
      .where(eq(vaults.id, vault.id));

    vaultsLinked++;
  }

  const tradesResult = await db.execute(sql`
    UPDATE trades t
    SET asset_id = v.asset_id
    FROM vaults v
    WHERE t.vault_id = v.id
      AND t.asset_id IS NULL
      AND v.asset_id IS NOT NULL
  `);
  const tradesBackfilled = (tradesResult as any).rowCount ?? 0;

  const positionsResult = await db.execute(sql`
    UPDATE positions p
    SET asset_id = v.asset_id
    FROM vaults v
    WHERE p.vault_id = v.id
      AND p.asset_id IS NULL
      AND v.asset_id IS NOT NULL
  `);
  const positionsBackfilled = (positionsResult as any).rowCount ?? 0;

  console.log(`[Backfill] vaultsLinked=${vaultsLinked} tradesBackfilled=${tradesBackfilled} positionsBackfilled=${positionsBackfilled}`);

  return { vaultsLinked, tradesBackfilled, positionsBackfilled };
}

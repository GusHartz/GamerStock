import { db } from "../db";
import { riotAssets } from "@shared/schema";
import { desc } from "drizzle-orm";
import type { ProviderAdapter, CanonicalAssetInput } from "./types";

export const riotLolChallengerNA1Provider: ProviderAdapter = {
  name: "riot",
  game: "lol",

  async fetch(): Promise<CanonicalAssetInput[]> {
    const rows = await db.select().from(riotAssets).orderBy(desc(riotAssets.leaguePoints)).limit(300);

    return rows.map(r => {
      const region = "NA1";
      const scope = "RANKED_SOLO_5x5";
      const entityType = "player";
      const externalId = r.puuid;
      const displayName = r.tagLine ? `${r.gameName}#${r.tagLine}` : r.gameName;

      return {
        provider: "riot",
        game: "lol",
        region,
        scope,
        entityType,
        externalId,
        displayName,
        symbol: "",

        lastTradePrice: String(r.lastTradePrice),
        price24hAgo: String(r.price24hAgo),
        volume24h: String(r.volume24h),
        momentum: String(r.momentum ?? "0.0000"),

        providerJson: null,
        lastSyncedAt: r.lastSyncedAt ? new Date(r.lastSyncedAt as any) : new Date(),
      };
    });
  }
};

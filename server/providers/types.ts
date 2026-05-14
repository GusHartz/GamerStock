export type ProviderName = "riot" | "vlr" | "hltv" | string;
export type GameName = "lol" | "valorant" | "cs2" | string;
export type EntityType = "player" | "team" | "org" | string;

export type CanonicalAssetInput = {
  provider: ProviderName;
  game: GameName;
  region?: string;
  scope?: string;

  entityType: EntityType;
  externalId: string;

  displayName: string;
  symbol?: string;

  lastTradePrice?: string;
  price24hAgo?: string;
  volume24h?: string;
  momentum?: string;

  providerJson?: string | null;
  lastSyncedAt?: Date;
};

export interface ProviderAdapter {
  name: ProviderName;
  game: GameName;
  fetch(): Promise<CanonicalAssetInput[]>;
}

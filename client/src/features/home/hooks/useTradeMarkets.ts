import { useQuery } from "@tanstack/react-query";
import type { TradeMarketAssetVM } from "../types/home";

interface MarketAssetsRow {
  id:             number;
  assetUid:       string;
  displayName:    string;
  lastTradePrice: string;
  price24hAgo:    string;
  volume24h:      string;
  market: {
    provider: string;
    game:     string;
    region:   string | null;
    scope:    string;
  };
}

interface MarketAssetsResponse {
  rows: MarketAssetsRow[];
  total: number;
}

function mapRow(r: MarketAssetsRow): TradeMarketAssetVM {
  const price    = parseFloat(r.lastTradePrice) || 0;
  const price24h = parseFloat(r.price24hAgo)    || 0;
  const change24hPct = price24h > 0 ? ((price - price24h) / price24h) * 100 : null;
  return {
    id:          r.id,
    assetUid:    r.assetUid,
    displayName: r.displayName,
    price,
    change24hPct: change24hPct !== null ? parseFloat(change24hPct.toFixed(2)) : null,
    volume24h:   parseFloat(r.volume24h) || 0,
    game:        r.market.game,
    region:      r.market.region,
  };
}

export function useTradeMarkets(limit = 10) {
  return useQuery<TradeMarketAssetVM[]>({
    queryKey: ["/api/market/assets", "home-trade-rail", limit],
    queryFn: async () => {
      const res = await fetch(
        `/api/market/assets?limit=${limit}&sort=lastTradePrice&game=dota2`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error(`Failed to load trade markets: ${res.status}`);
      const data: MarketAssetsResponse = await res.json();
      return (data.rows ?? []).map(mapRow);
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
}

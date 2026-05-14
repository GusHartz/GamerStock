import { useState } from "react";
import { useParams } from "wouter";
import { usePortfolio } from "@/hooks/use-portfolio";
import { formatCurrency, formatNumber, formatPercent, formatVolume } from "@/lib/format";
import { ArrowLeft, RefreshCcw, Activity, Shield, Info, Clock, Wifi, TrendingUp, TrendingDown } from "lucide-react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { RiotAsset, RiotPosition, RiotTrade } from "@shared/schema";
import { computeQuotes } from "@shared/market-quotes";

type AssetResponse = {
  asset: RiotAsset;
  position: RiotPosition | null;
};

export default function PlayerPage() {
  const { id: rawId } = useParams();
  const puuid = rawId ? decodeURIComponent(rawId) : "";
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [tradeType, setTradeType] = useState<"BUY" | "SELL">("BUY");
  const [shares, setShares] = useState<string>("1");

  const { data: assetData, isLoading } = useQuery<AssetResponse>({
    queryKey: ["/api/riot/asset", puuid],
    queryFn: async () => {
      const res = await fetch(`/api/riot/asset/${encodeURIComponent(puuid)}`, { credentials: "include" });
      if (!res.ok) {
        const body = await res.text();
        console.error(`[player] /api/riot/asset ${res.status} — ${body.slice(0, 200)}`);
        throw new Error(`[${res.status}] ${body.slice(0, 120)}`);
      }
      return res.json();
    },
    refetchInterval: 3000,
    enabled: !!puuid,
  });

  const { data: recentTrades } = useQuery<RiotTrade[]>({
    queryKey: ["/api/riot/asset", puuid, "trades"],
    queryFn: async () => {
      const res = await fetch(`/api/riot/asset/${encodeURIComponent(puuid)}/trades`, { credentials: "include" });
      if (!res.ok) {
        const body = await res.text();
        console.error(`[player] /api/riot/asset/trades ${res.status} — ${body.slice(0, 200)}`);
        throw new Error(`[${res.status}] ${body.slice(0, 120)}`);
      }
      return res.json();
    },
    refetchInterval: 3000,
    enabled: !!puuid,
  });

  const { data: portfolio } = usePortfolio();

  const tradeMutation = useMutation({
    mutationFn: async (body: { puuid: string; type: "BUY" | "SELL"; shares: number }) => {
      const res = await apiRequest("POST", "/api/riot/trade", body);
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: `${tradeType} executed`,
        description: `${parsedShares} share${parsedShares !== 1 ? "s" : ""} at ${formatCurrency(data.executionPrice)} · New balance: ${formatCurrency(data.newBalance)}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/riot/asset", puuid] });
      queryClient.invalidateQueries({ queryKey: ["/api/riot/asset", puuid, "trades"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio"] });
      queryClient.invalidateQueries({ queryKey: ["/api/terminal/market"] });
    },
    onError: (err: any) => {
      toast({
        title: "Trade failed",
        description: err?.message || "Unknown error",
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return <div className="animate-pulse h-[60vh] bg-card rounded-2xl border border-white/5"></div>;
  }

  if (!assetData) {
    return (
      <div className="text-center py-20">
        <h2 className="text-2xl font-bold mb-4">Player not found</h2>
        <Link href="/terminal" className="text-primary hover:underline">Return to Terminal</Link>
      </div>
    );
  }

  const { asset, position } = assetData;
  const displayName = asset.tagLine ? `${asset.gameName}#${asset.tagLine}` : asset.gameName;
  const currentPrice = parseFloat(asset.lastTradePrice);
  const price24hAgo = parseFloat(asset.price24hAgo);
  const priceChange = price24hAgo > 0 ? ((currentPrice - price24hAgo) / price24hAgo) * 100 : 0;

  const momentum = parseFloat(String(asset.momentum)) || 0;
  const volume24h = parseFloat(String(asset.volume24h)) || 0;
  const { bidPrice, askPrice, spreadPct } = computeQuotes(currentPrice, momentum, volume24h);
  const fillPrice = tradeType === "BUY" ? askPrice : bidPrice;

  const parsedShares = parseInt(shares, 10) || 0;
  const subtotal = parsedShares * fillPrice;
  const fee = subtotal * 0.02;
  const totalCost = tradeType === "BUY" ? subtotal + fee : subtotal - fee;

  const handleTrade = () => {
    if (parsedShares <= 0) return;
    tradeMutation.mutate({ puuid, type: tradeType, shares: parsedShares });
  };

  return (
    <div className="flex flex-col gap-6 animate-in fade-in duration-500 pb-20">
      <Link href="/terminal" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-white transition-colors w-fit">
        <ArrowLeft className="w-4 h-4" /> Back to Terminal
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">

          {/* Header card */}
          <div className="glass-panel p-6 rounded-2xl flex flex-wrap justify-between items-end gap-6 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-violet-500/10 rounded-full mix-blend-screen filter blur-[80px] -z-10"></div>
            <div>
              <div className="flex items-center gap-3 mb-2">
                <span className="px-2.5 py-1 rounded bg-violet-500/15 text-violet-300 border border-violet-500/20 text-xs font-sans uppercase tracking-wider font-semibold flex items-center gap-1">
                  <Wifi className="w-3 h-3" /> NA1
                </span>
                <span className="px-2.5 py-1 rounded bg-primary/10 text-primary border border-primary/20 text-xs font-sans uppercase tracking-wider font-semibold">
                  Challenger
                </span>
              </div>
              <h1 className="text-3xl font-display font-bold text-white tracking-tight font-mono">{displayName}</h1>
            </div>

            <div className="text-right">
              <p className="text-sm text-muted-foreground font-medium uppercase tracking-wider mb-1">Market Price</p>
              <div className="flex items-baseline gap-3">
                <span className="text-4xl font-mono font-bold text-white tracking-tight">
                  {formatCurrency(asset.lastTradePrice)}
                </span>
                <span className={`font-mono text-sm font-medium ${priceChange >= 0 ? 'text-primary' : 'text-destructive'}`}>
                  {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}%
                </span>
              </div>
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="glass-panel p-4 rounded-xl text-center">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">LP</p>
              <p className="text-xl font-mono text-white font-bold">{asset.leaguePoints.toLocaleString()}</p>
            </div>
            <div className="glass-panel p-4 rounded-xl text-center">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Winrate</p>
              <p className="text-xl font-mono text-white">{formatNumber(asset.winrate)}%</p>
            </div>
            <div className="glass-panel p-4 rounded-xl text-center">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">W / L</p>
              <p className="text-xl font-mono">
                <span className="text-primary">{asset.wins}W</span>
                <span className="text-muted-foreground mx-1">/</span>
                <span className="text-destructive">{asset.losses}L</span>
              </p>
            </div>
            <div className="glass-panel p-4 rounded-xl text-center">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">24h Vol</p>
              <p className="text-xl font-mono text-white">{formatVolume(asset.volume24h)}</p>
            </div>
          </div>

          {/* Player profile info */}
          <div className="glass-panel p-6 rounded-2xl space-y-6">
            <h3 className="font-display font-bold text-xl text-white flex items-center gap-2">
              <Activity className="w-5 h-5 text-primary" /> Player Profile
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div className="flex justify-between border-b border-white/5 pb-2">
                  <span className="text-muted-foreground">Riot ID</span>
                  <span className="text-white font-mono">{displayName}</span>
                </div>
                <div className="flex justify-between border-b border-white/5 pb-2">
                  <span className="text-muted-foreground">Region</span>
                  <span className="text-white font-mono">NA1</span>
                </div>
                <div className="flex justify-between border-b border-white/5 pb-2">
                  <span className="text-muted-foreground">Tier</span>
                  <span className="text-white font-mono">Challenger</span>
                </div>
                <div className="flex justify-between border-b border-white/5 pb-2">
                  <span className="text-muted-foreground">League Points</span>
                  <span className="text-white font-mono">{asset.leaguePoints.toLocaleString()} LP</span>
                </div>
                <div className="flex justify-between border-b border-white/5 pb-2">
                  <span className="text-muted-foreground">Winrate</span>
                  <span className="text-white font-mono">{formatNumber(asset.winrate)}%</span>
                </div>
                <div className="flex justify-between border-b border-white/5 pb-2">
                  <span className="text-muted-foreground">Record</span>
                  <span className="font-mono">
                    <span className="text-primary">{asset.wins}W</span>
                    <span className="text-muted-foreground mx-1">/</span>
                    <span className="text-destructive">{asset.losses}L</span>
                  </span>
                </div>
                <div className="flex justify-between border-b border-white/5 pb-2">
                  <span className="text-muted-foreground">24h Price Change</span>
                  <span className={`font-mono font-bold ${priceChange >= 0 ? 'text-primary' : 'text-destructive'}`}>
                    {priceChange >= 0 ? <TrendingUp className="inline w-4 h-4 mr-1" /> : <TrendingDown className="inline w-4 h-4 mr-1" />}
                    {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}%
                  </span>
                </div>
                <div className="flex justify-between border-b border-white/5 pb-2">
                  <span className="text-muted-foreground">Last Synced</span>
                  <span className="text-muted-foreground font-mono text-xs">
                    {new Date(asset.lastSyncedAt).toLocaleString()}
                  </span>
                </div>
              </div>
              <div className="bg-violet-500/5 p-4 rounded-xl border border-violet-500/10">
                <h4 className="text-sm font-bold text-violet-300 uppercase tracking-wider mb-2 flex items-center gap-2">
                  <Wifi className="w-3.5 h-3.5" /> Live Challenger Asset
                </h4>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  This stock is backed by a real NA1 Challenger player. Prices are driven by community trading activity using a virtual liquidity model. All data is sourced from the Riot Games API.
                </p>
                <div className="mt-4 pt-4 border-t border-white/5">
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground">Price (24h ago)</span>
                    <span className="font-mono text-white">{formatCurrency(asset.price24hAgo)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Market Cap</span>
                    <span className="font-mono text-white">{formatCurrency(currentPrice * 1000)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Recent trades for this asset */}
          <div className="glass-panel p-6 rounded-2xl">
            <h3 className="font-display font-bold text-xl text-white mb-4 flex items-center gap-2">
              <Clock className="w-5 h-5 text-primary" /> Recent Trades
            </h3>
            {recentTrades && recentTrades.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse font-mono text-sm">
                  <thead>
                    <tr className="text-xs uppercase tracking-wider text-muted-foreground border-b border-white/10">
                      <th className="py-3 px-4">Type</th>
                      <th className="py-3 px-4 text-right">Shares</th>
                      <th className="py-3 px-4 text-right">Price</th>
                      <th className="py-3 px-4 text-right">Total</th>
                      <th className="py-3 px-4 text-right">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {recentTrades.map((t) => (
                      <tr key={t.id} className="hover:bg-white/[0.02]">
                        <td className={`py-3 px-4 font-bold ${t.type === "BUY" ? "text-primary" : "text-destructive"}`}>
                          {t.type}
                        </td>
                        <td className="py-3 px-4 text-right text-white">{t.shares}</td>
                        <td className="py-3 px-4 text-right text-white">{formatCurrency(t.pricePerShare)}</td>
                        <td className="py-3 px-4 text-right text-muted-foreground">{formatCurrency(t.totalCost)}</td>
                        <td className="py-3 px-4 text-right text-muted-foreground text-xs">
                          {new Date(t.executedAt).toLocaleTimeString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm text-center py-6">No trades yet. Be the first to trade this asset.</p>
            )}
          </div>
        </div>

        {/* Trade panel */}
        <div className="space-y-6">
          {/* Order Book (simulated) */}
          <div className="glass-panel p-6 rounded-2xl">
            <h3 className="font-display font-semibold text-white mb-4 flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" /> Order Book
            </h3>
            <div className="space-y-4 font-mono text-[11px]">
              <div className="space-y-1">
                <div className="flex justify-between text-muted-foreground pb-1 border-b border-white/5 mb-2">
                  <span>PRICE</span>
                  <span>SIZE</span>
                </div>
                {[...Array(5)].map((_, i) => {
                  const levelPrice = currentPrice * (1 + (5 - i) * 0.002);
                  const size = 50 + ((i * 37 + asset.leaguePoints) % 100);
                  return (
                    <div key={`sell-${i}`} className="flex justify-between text-destructive">
                      <span>{levelPrice.toFixed(2)}</span>
                      <span>{size}</span>
                    </div>
                  );
                })}
              </div>
              <div className="py-2 text-center border-y border-white/5 bg-white/5">
                <span className="text-white font-bold text-sm">${currentPrice.toFixed(2)}</span>
              </div>
              <div className="space-y-1">
                {[...Array(5)].map((_, i) => {
                  const levelPrice = currentPrice * (1 - (i + 1) * 0.002);
                  const size = 50 + (((i + 3) * 41 + asset.wins) % 100);
                  return (
                    <div key={`buy-${i}`} className="flex justify-between text-primary">
                      <span>{levelPrice.toFixed(2)}</span>
                      <span>{size}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Trade widget */}
          <div className="glass-panel p-6 rounded-2xl sticky top-24">
            <h3 className="font-display font-semibold text-xl text-white mb-6">Trade Asset</h3>

            <div className="flex p-1 bg-background rounded-lg mb-6 border border-white/5">
              <button
                data-testid="button-buy"
                onClick={() => setTradeType("BUY")}
                className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${tradeType === "BUY" ? 'bg-primary text-black shadow-lg shadow-primary/20' : 'text-muted-foreground hover:text-white'}`}
              >
                BUY
              </button>
              <button
                data-testid="button-sell"
                onClick={() => setTradeType("SELL")}
                className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${tradeType === "SELL" ? 'bg-destructive text-white shadow-lg shadow-destructive/20' : 'text-muted-foreground hover:text-white'}`}
              >
                SELL
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-muted-foreground">Shares</span>
                  {tradeType === "SELL" && (
                    <span className="text-muted-foreground">
                      Max: <span className="text-white">{position?.shares || 0}</span>
                    </span>
                  )}
                </div>
                <div className="relative">
                  <input
                    data-testid="input-shares"
                    type="number"
                    min="1"
                    step="1"
                    value={shares}
                    onChange={(e) => setShares(e.target.value)}
                    className="w-full bg-background border border-white/10 rounded-lg px-4 py-3 text-white font-mono text-lg focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground font-sans text-sm">
                    Shares
                  </span>
                </div>
              </div>

              {/* Bid/Ask quote display */}
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-primary/10 border border-primary/20 rounded-lg p-2">
                  <p className="text-[10px] text-muted-foreground uppercase mb-0.5">Bid</p>
                  <p className="text-xs font-mono font-bold text-primary" data-testid="text-bid-price">{formatCurrency(bidPrice)}</p>
                </div>
                <div className="bg-secondary/30 border border-white/5 rounded-lg p-2">
                  <p className="text-[10px] text-muted-foreground uppercase mb-0.5">Mid</p>
                  <p className="text-xs font-mono font-bold text-white">{formatCurrency(currentPrice)}</p>
                </div>
                <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-2">
                  <p className="text-[10px] text-muted-foreground uppercase mb-0.5">Ask</p>
                  <p className="text-xs font-mono font-bold text-destructive" data-testid="text-ask-price">{formatCurrency(askPrice)}</p>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground text-center">
                Spread: <span className="font-mono text-white">{(spreadPct * 100).toFixed(2)}%</span>
              </p>

              <div className="bg-secondary/30 rounded-lg p-4 space-y-3 border border-white/5">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    Fills at {tradeType === "BUY" ? "Ask" : "Bid"}
                  </span>
                  <span className={`font-mono font-semibold ${tradeType === "BUY" ? "text-destructive" : "text-primary"}`}>
                    {formatCurrency(fillPrice)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground flex items-center gap-1">Fee (2%) <Info className="w-3 h-3" /></span>
                  <span className="font-mono text-white">{formatCurrency(fee)}</span>
                </div>
                <div className="h-px w-full bg-white/10"></div>
                <div className="flex justify-between font-semibold">
                  <span className="text-white">Estimated {tradeType === "BUY" ? "Cost" : "Credit"}</span>
                  <span className="font-mono text-white">{formatCurrency(totalCost)}</span>
                </div>
              </div>

              {tradeType === "BUY" && portfolio && (
                <div className="text-center text-xs text-muted-foreground pt-2">
                  Available: <span className="font-mono text-white">{formatCurrency(portfolio.stats.balance)}</span>
                </div>
              )}

              {position && position.shares > 0 && (
                <div className="text-center text-xs text-muted-foreground">
                  You own <span className="text-white font-mono font-bold">{position.shares}</span> shares · avg{" "}
                  <span className="text-white font-mono">{formatCurrency(position.averageCost)}</span>
                </div>
              )}

              <button
                data-testid="button-execute-trade"
                onClick={handleTrade}
                disabled={
                  tradeMutation.isPending ||
                  parsedShares <= 0 ||
                  (tradeType === "SELL" && parsedShares > (position?.shares || 0))
                }
                className={`w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-2 mt-4 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed
                  ${tradeType === "BUY"
                    ? 'bg-primary text-black hover:bg-primary/90 hover:scale-[1.02] shadow-lg shadow-primary/20'
                    : 'bg-destructive text-white hover:bg-destructive/90 hover:scale-[1.02] shadow-lg shadow-destructive/20'
                  }`}
              >
                {tradeMutation.isPending
                  ? <RefreshCcw className="w-5 h-5 animate-spin" />
                  : <Shield className="w-5 h-5" />}
                {tradeType} {parsedShares || 0} Shares
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

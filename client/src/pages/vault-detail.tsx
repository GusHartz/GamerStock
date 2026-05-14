/**
 * LEGACY — Sandbox Vault Detail Page
 *
 * This page renders a single synthetic/sandbox player (vault) from the old model.
 * Do NOT add new features here.
 *
 * Official path for player detail:
 *   - /player/:puuid → pages/player.tsx (Riot canonical model)
 *   - /asset/:id    → pages/asset-detail.tsx (market asset detail)
 *
 * Retirement plan:
 *   - REDIRECT /vault/:id → /asset/:assetId once all vaults have a linked canonical asset
 *   - REMOVE this page once redirect is in place and vault-detail traffic drops to zero
 *   - See: docs/architecture/legacy-freeze-and-retirement-plan.md
 */
import { useState, useMemo } from "react";
import { useParams } from "wouter";
import { useVault, useWatchlist, useWatchlistMutation } from "@/hooks/use-vaults";
import { useTrade } from "@/hooks/use-trade";
import { usePortfolio } from "@/hooks/use-portfolio";
import { formatCurrency, formatNumber, formatPercent, formatVolume } from "@/lib/format";
import { 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  ResponsiveContainer, 
  ComposedChart, 
  Cell 
} from "recharts";
import { ArrowLeft, RefreshCcw, Activity, Shield, Info, Clock, User as UserIcon, TrendingUp } from "lucide-react";
import { Link } from "wouter";
import { StarButton } from "@/components/star-button";

export default function VaultDetailPage() {
  const { id } = useParams();
  const vaultId = parseInt(id || "0", 10);
  
  const { data: vaultData, isLoading: isLoadingVault } = useVault(vaultId, {
    refetchInterval: 3000,
  });
  const { data: portfolio } = usePortfolio();
  const { mutate: executeTrade, isPending: isTrading } = useTrade();
  
  const { data: watchlist } = useWatchlist();
  const { add: addToWatchlist, remove: removeFromWatchlist } = useWatchlistMutation();

  const [tradeType, setTradeType] = useState<"BUY" | "SELL">("BUY");
  const [shares, setShares] = useState<string>("1");
  const [timeframe, setTimeframe] = useState<"1m" | "5m" | "15m">("1m");

  const { vault, snapshots, userPosition } = vaultData || { vault: null, snapshots: [], userPosition: null };
  const currentPrice = vault ? parseFloat(vault.lastTradePrice) : 0;
  
  const candlestickData = useMemo(() => {
    if (!snapshots || snapshots.length === 0) return [];
    
    const intervalMs = timeframe === "1m" ? 60000 : timeframe === "5m" ? 300000 : 900000;
    const groups: Record<number, any[]> = {};
    
    snapshots.forEach((s: any) => {
      const time = new Date(s.recordedAt).getTime();
      const bucket = Math.floor(time / intervalMs) * intervalMs;
      if (!groups[bucket]) groups[bucket] = [];
      groups[bucket].push(s);
    });
    
    return Object.entries(groups).map(([timestamp, group]) => {
      const prices = group.map(g => parseFloat(g.price));
      const sorted = [...group].sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());
      
      const open = parseFloat(sorted[0].price);
      const close = parseFloat(sorted[sorted.length - 1].price);
      const high = Math.max(...prices);
      const low = Math.min(...prices);
      
      return {
        timestamp: parseInt(timestamp),
        open,
        high,
        low,
        close,
        displayTime: new Date(parseInt(timestamp)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        // For candlestick rendering
        bottom: Math.min(open, close),
        height: Math.abs(open - close) || 0.01,
        color: close >= open ? "hsl(var(--primary))" : "hsl(var(--destructive))",
        volume: group.length * 10, // Mock volume from trade count
      };
    }).sort((a, b) => a.timestamp - b.timestamp);
  }, [snapshots, timeframe]);

  if (isLoadingVault) {
    return <div className="animate-pulse h-[60vh] bg-card rounded-2xl border border-white/5"></div>;
  }

  if (!vaultData || !vault) {
    return (
      <div className="text-center py-20">
        <h2 className="text-2xl font-bold mb-4">Vault not found</h2>
        <Link href="/" className="text-primary hover:underline">Return to Terminal</Link>
      </div>
    );
  }

  const parsedShares = parseInt(shares, 10) || 0;
  const subtotal = parsedShares * currentPrice;
  const fee = subtotal * 0.02;
  const totalCost = subtotal + fee;

  const handleTrade = () => {
    if (parsedShares <= 0) return;
    executeTrade({
      vaultId,
      type: tradeType,
      shares: parsedShares,
    });
  };

  const momentumVal = parseFloat(vault.momentum);
  const isPositiveMomentum = momentumVal >= 0;

  return (
    <div className="flex flex-col gap-6 animate-in fade-in duration-500 pb-20">
      <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-white transition-colors w-fit">
        <ArrowLeft className="w-4 h-4" /> Back to Terminal
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="glass-panel p-6 rounded-2xl flex flex-wrap justify-between items-end gap-6 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-primary/10 rounded-full mix-blend-screen filter blur-[80px] -z-10"></div>
            <div>
              <div className="flex items-center gap-3 mb-2">
                <span className="px-2.5 py-1 rounded bg-secondary text-xs font-sans text-muted-foreground border border-white/5 uppercase tracking-wider font-semibold">
                  {vault.region}
                </span>
                <span className="px-2.5 py-1 rounded bg-primary/10 text-primary border border-primary/20 text-xs font-sans uppercase tracking-wider font-semibold">
                  {vault.rank}
                </span>
              </div>
              <div className="flex items-center gap-4">
                <h1 className="text-4xl font-display font-bold text-white tracking-tight">{vault.playerAlias}</h1>
                <StarButton 
                  vaultId={vault.id} 
                  isWatched={watchlist?.some((w: any) => w.id === vault.id)} 
                  onAdd={(id) => addToWatchlist.mutate(id)} 
                  onRemove={(id) => removeFromWatchlist.mutate(id)}
                  size={6}
                />
              </div>
            </div>

            <div className="text-right">
              <p className="text-sm text-muted-foreground font-medium uppercase tracking-wider mb-1">Market Price</p>
              <div className="flex items-baseline gap-3">
                <span className="text-4xl font-mono font-bold text-white tracking-tight">
                  {formatCurrency(vault.lastTradePrice)}
                </span>
                <span className={`font-mono text-sm font-medium ${isPositiveMomentum ? 'text-primary' : 'text-destructive'}`}>
                  {isPositiveMomentum ? '+' : ''}{formatNumber(vault.momentum)} Mo
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            <div className="glass-panel p-4 rounded-xl text-center">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Winrate</p>
              <p className="text-xl font-mono text-white">{formatNumber(vault.winrate)}%</p>
            </div>
            <div className="glass-panel p-4 rounded-xl text-center">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Perf Index</p>
              <p className="text-xl font-mono text-white">{formatNumber(vault.performanceIndex)}</p>
            </div>
            <div className="glass-panel p-4 rounded-xl text-center">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">24h Vol</p>
              <p className="text-xl font-mono text-white">{formatVolume(vault.volume24h)}</p>
            </div>
            <div className="glass-panel p-4 rounded-xl text-center">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Total Supply</p>
              <p className="text-xl font-mono text-white">1,000</p>
            </div>
            <div className="glass-panel p-4 rounded-xl text-center">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Market Cap</p>
              <p className="text-xl font-mono text-white">{formatCurrency(currentPrice * 1000)}</p>
            </div>
          </div>

          <div className="glass-panel p-6 rounded-2xl h-[500px] flex flex-col">
            <div className="flex justify-between items-center mb-6">
              <h3 className="font-display font-semibold text-lg text-white flex items-center gap-2">
                <Activity className="w-5 h-5 text-primary" /> Technical Chart
              </h3>
              <div className="flex bg-background rounded-lg p-1 border border-white/5">
                {(["1m", "5m", "15m"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTimeframe(t)}
                    className={`px-3 py-1 text-xs font-mono rounded ${timeframe === t ? 'bg-white/10 text-white' : 'text-muted-foreground hover:text-white'}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            
            <div className="flex-1 w-full font-mono text-[10px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={candlestickData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                  <XAxis 
                    dataKey="displayTime" 
                    stroke="hsl(var(--muted-foreground))"
                    tick={{fill: 'hsl(var(--muted-foreground))'}}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis 
                    yAxisId="price"
                    domain={['auto', 'auto']}
                    tickFormatter={(val) => `$${val}`}
                    stroke="hsl(var(--muted-foreground))"
                    tick={{fill: 'hsl(var(--muted-foreground))'}}
                    tickLine={false}
                    axisLine={false}
                    orientation="right"
                  />
                  <YAxis 
                    yAxisId="volume"
                    domain={[0, 'auto']}
                    hide
                  />
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px', fontSize: '12px' }}
                    itemStyle={{ color: 'hsl(var(--foreground))' }}
                    labelFormatter={(val) => `Time: ${val}`}
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0].payload;
                        return (
                          <div className="bg-card border border-border p-3 rounded-lg shadow-xl font-mono text-[11px] space-y-1">
                            <p className="text-muted-foreground mb-2">{data.displayTime}</p>
                            <p className="flex justify-between gap-4"><span>O:</span> <span className="text-white">${data.open.toFixed(2)}</span></p>
                            <p className="flex justify-between gap-4"><span>H:</span> <span className="text-white">${data.high.toFixed(2)}</span></p>
                            <p className="flex justify-between gap-4"><span>L:</span> <span className="text-white">${data.low.toFixed(2)}</span></p>
                            <p className="flex justify-between gap-4"><span>C:</span> <span className="text-white">${data.close.toFixed(2)}</span></p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  {/* Volume Bars */}
                  <Bar 
                    yAxisId="volume"
                    dataKey="volume" 
                    fill="hsl(var(--muted-foreground))" 
                    opacity={0.1}
                    barSize={20}
                  />
                  {/* Candlestick High-Low Wick */}
                  <Bar
                    yAxisId="price"
                    dataKey="high"
                    fill="transparent"
                    barSize={1}
                    background={false}
                  >
                    {candlestickData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                  {/* Candlestick Body */}
                  <Bar
                    yAxisId="price"
                    dataKey="height"
                    barSize={12}
                  >
                    {candlestickData.map((entry, index) => (
                      <Cell key={`cell-body-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 flex items-center justify-center gap-6 text-[10px] text-muted-foreground uppercase tracking-widest font-mono">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-primary"></div> Bullish
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-destructive"></div> Bearish
              </div>
              <div className="flex items-center gap-2">
                <Clock className="w-3 h-3" /> Interval: {timeframe}
              </div>
            </div>
          </div>

          <div className="glass-panel p-8 rounded-2xl space-y-8">
            <section>
              <h3 className="font-display font-bold text-2xl text-white mb-4 flex items-center gap-2">
                <UserIcon className="w-6 h-6 text-primary" /> Player Profile
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-4">
                  <div className="flex justify-between border-b border-white/5 pb-2">
                    <span className="text-muted-foreground">Player Alias</span>
                    <span className="text-white font-mono">{vault.playerAlias}</span>
                  </div>
                  <div className="flex justify-between border-b border-white/5 pb-2">
                    <span className="text-muted-foreground">Region</span>
                    <span className="text-white font-mono">{vault.region}</span>
                  </div>
                  <div className="flex justify-between border-b border-white/5 pb-2">
                    <span className="text-muted-foreground">Rank Tier</span>
                    <span className="text-white font-mono">{vault.rank}</span>
                  </div>
                  <div className="flex justify-between border-b border-white/5 pb-2">
                    <span className="text-muted-foreground">Winrate</span>
                    <span className="text-white font-mono">{formatNumber(vault.winrate)}%</span>
                  </div>
                  <div className="flex justify-between border-b border-white/5 pb-2">
                    <span className="text-muted-foreground">Performance Index</span>
                    <span className="text-white font-mono">{formatNumber(vault.performanceIndex)}</span>
                  </div>
                </div>
                <div className="bg-white/5 p-4 rounded-xl border border-white/5">
                  <h4 className="text-sm font-bold text-primary uppercase tracking-wider mb-2">Player Overview</h4>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    This player is currently competing in ranked matches and their asset value reflects historical performance and market demand. They have shown consistent growth in their respective region and maintain a competitive edge in the current meta.
                  </p>
                </div>
              </div>
            </section>

            <section>
              <h3 className="font-display font-bold text-2xl text-white mb-4 flex items-center gap-2">
                <TrendingUp className="w-6 h-6 text-primary" /> Recent Performance
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="text-xs uppercase tracking-wider text-muted-foreground border-b border-white/10">
                      <th className="py-3 px-4">Result</th>
                      <th className="py-3 px-4">KDA</th>
                      <th className="py-3 px-4">Match Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 font-mono text-sm">
                    {Array.from({ length: 10 }).map((_, i) => {
                      const isWin = Math.random() > 0.45;
                      const k = Math.floor(Math.random() * 15);
                      const d = Math.floor(Math.random() * 8) + 1;
                      const a = Math.floor(Math.random() * 15);
                      const date = new Date(Date.now() - i * 86400000).toLocaleDateString();
                      return (
                        <tr key={i} className="hover:bg-white/[0.02]">
                          <td className="py-3 px-4">
                            <span className={`font-bold ${isWin ? 'text-primary' : 'text-destructive'}`}>
                              {isWin ? 'WIN' : 'LOSS'}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-white">
                            {k} / {d} / {a}
                          </td>
                          <td className="py-3 px-4 text-muted-foreground">
                            {date}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </div>

        <div className="space-y-6">
          {/* Order Book */}
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
                  const size = Math.floor(Math.random() * 100) + 50;
                  return (
                    <div key={`sell-${i}`} className="flex justify-between text-destructive group hover:bg-destructive/5 transition-colors">
                      <span>{levelPrice.toFixed(2)}</span>
                      <span>{size}</span>
                    </div>
                  );
                })}
              </div>
              
              <div className="py-2 text-center border-y border-white/5 bg-white/5 my-2">
                <span className="text-white font-bold text-sm">${currentPrice.toFixed(2)}</span>
              </div>

              <div className="space-y-1">
                {[...Array(5)].map((_, i) => {
                  const levelPrice = currentPrice * (1 - (i + 1) * 0.002);
                  const size = Math.floor(Math.random() * 100) + 50;
                  return (
                    <div key={`buy-${i}`} className="flex justify-between text-primary group hover:bg-primary/5 transition-colors">
                      <span>{levelPrice.toFixed(2)}</span>
                      <span>{size}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

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
                    <span className="text-muted-foreground">Max: <span className="text-white">{userPosition?.shares || 0}</span></span>
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

              <div className="bg-secondary/30 rounded-lg p-4 space-y-3 border border-white/5">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Market Price</span>
                  <span className="font-mono text-white">{formatCurrency(currentPrice)}</span>
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
                  Available Buying Power: <span className="font-mono text-white">{formatCurrency(portfolio.stats.balance)}</span>
                </div>
              )}

              <button
                data-testid="button-execute-trade"
                onClick={handleTrade}
                disabled={isTrading || parsedShares <= 0 || (tradeType === "SELL" && parsedShares > (userPosition?.shares || 0))}
                className={`w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-2 mt-4 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed
                  ${tradeType === "BUY" 
                    ? 'bg-primary text-black hover:bg-primary/90 hover:scale-[1.02] shadow-lg shadow-primary/20' 
                    : 'bg-destructive text-white hover:bg-destructive/90 hover:scale-[1.02] shadow-lg shadow-destructive/20'
                  }`}
              >
                {isTrading ? <RefreshCcw className="w-5 h-5 animate-spin" /> : <Shield className="w-5 h-5" />}
                {tradeType} {parsedShares || 0} Shares
              </button>
            </div>
          </div>

          <div className="glass-panel p-6 rounded-2xl">
            <h3 className="font-display font-semibold text-white mb-4">Your Position</h3>
            {userPosition && userPosition.shares > 0 ? (
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Shares Owned</span>
                  <span className="font-mono font-bold text-white text-lg">{userPosition.shares}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Average Cost</span>
                  <span className="font-mono text-white">{formatCurrency(userPosition.averageCost)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Current Value</span>
                  <span className="font-mono text-white">{formatCurrency(userPosition.shares * currentPrice)}</span>
                </div>
                <div className="h-px w-full bg-white/10"></div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Return</span>
                  <span className={`font-mono font-bold ${parseFloat(currentPrice.toString()) >= parseFloat(userPosition.averageCost.toString()) ? 'text-primary' : 'text-destructive'}`}>
                    {formatPercent(((currentPrice - parseFloat(userPosition.averageCost.toString())) / parseFloat(userPosition.averageCost.toString())) * 100)}
                  </span>
                </div>
              </div>
            ) : (
              <div className="text-center py-6 text-muted-foreground">
                <p>No open position</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

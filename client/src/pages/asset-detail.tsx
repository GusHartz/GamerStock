import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, TrendingUp, TrendingDown, Activity, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { formatCurrency } from "@/lib/format";
import { LineChart, Line, ResponsiveContainer, Tooltip as ReTooltip, XAxis, YAxis } from "recharts";

type UnifiedAsset = {
  assetId: string;
  internalId: number;
  displayName: string;
  tag?: string | null;
  game: string;
  region?: string | null;
  price: string;
  change24hPct?: number | null;
  volume24h?: string | null;
  marketCap?: string | null;
  performanceScore?: number | null;
  watchlisted: boolean;
};

type AssetDetail = {
  asset: UnifiedAsset;
  metrics: {
    performanceScore?: number | null;
    wins?: number;
    losses?: number;
    winRate?: number;
    matches?: number;
    leaguePoints?: number;
    recentTrend?: string;
  };
  signals: { code: string; label: string; tone: string; type?: string; reason?: string }[];
};

type SnapshotResponse = { assetId: string; timeframe: string; points: { t: string; p: number }[] };

function formatChange(pct: number | null | undefined) {
  if (pct === null || pct === undefined) return { text: "—", color: "text-muted-foreground" };
  return {
    text: `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`,
    color: pct >= 0 ? "text-emerald-400" : "text-red-400",
  };
}

export default function AssetDetailPage() {
  const { assetId } = useParams<{ assetId: string }>();
  const [, navigate] = useLocation();
  const decodedId = decodeURIComponent(assetId ?? "");

  const { data, isLoading, isError } = useQuery<AssetDetail>({
    queryKey: ["/api/assets/detail", decodedId],
    queryFn: () => fetch(`/api/assets/${encodeURIComponent(decodedId)}`).then(r => r.json()),
    enabled: !!decodedId,
  });

  const { data: snapshots } = useQuery<SnapshotResponse>({
    queryKey: ["/api/assets/snapshots", decodedId, "7d"],
    queryFn: () => fetch(`/api/assets/${encodeURIComponent(decodedId)}/snapshots?tf=7d`).then(r => r.json()),
    enabled: !!decodedId,
  });

  const asset = data?.asset;
  const metrics = data?.metrics;
  const signals = data?.signals ?? [];
  const points = snapshots?.points ?? [];
  const change = formatChange(asset?.change24hPct);
  const first = points[0]?.p;
  const last = points[points.length - 1]?.p;
  const lineColor = last !== undefined && first !== undefined && last >= first ? "#10b981" : "#f87171";

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto py-8 px-4 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (isError || !asset) {
    return (
      <div className="max-w-3xl mx-auto py-20 text-center">
        <p className="text-muted-foreground mb-4">Asset not found.</p>
        <Button variant="outline" onClick={() => navigate("/assets")} data-testid="button-back-to-assets">
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Assets
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto py-6 px-4 space-y-6">
      <button
        onClick={() => navigate("/assets")}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-white transition-colors"
        data-testid="button-back-to-assets"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Assets
      </button>

      <div className="bg-white/[0.03] border border-white/10 rounded-xl p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-display font-bold text-white" data-testid="asset-detail-name">
              {asset.displayName}
              {asset.tag && <span className="text-muted-foreground text-base font-normal ml-2">#{asset.tag}</span>}
            </h1>
            <div className="flex items-center gap-2 mt-2 text-sm text-muted-foreground">
              <span>{asset.game}</span>
              {asset.region && <><span>·</span><span>{asset.region}</span></>}
            </div>
          </div>
          <div className="text-right">
            <div className="text-3xl font-mono font-bold text-white">{formatCurrency(parseFloat(asset.price))}</div>
            <div className={`text-sm font-mono mt-1 ${change.color}`}>{change.text} (24h)</div>
          </div>
        </div>
      </div>

      {points.length >= 3 && (
        <div className="bg-white/[0.03] border border-white/10 rounded-xl p-4">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">7-Day Price Chart</div>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={points}>
              <XAxis dataKey="t" hide />
              <YAxis domain={["auto", "auto"]} hide />
              <ReTooltip
                contentStyle={{ background: "#1c1f2e", border: "1px solid #2d3144", borderRadius: 6, fontSize: 11 }}
                formatter={(v: any) => [`$${parseFloat(v).toFixed(2)}`, "Price"]}
                labelFormatter={() => ""}
              />
              <Line type="monotone" dataKey="p" stroke={lineColor} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {metrics && (
        <div className="bg-white/[0.03] border border-white/10 rounded-xl p-6">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-4">Performance Metrics</div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {metrics.leaguePoints !== undefined && (
              <div>
                <div className="text-xs text-muted-foreground">League Points</div>
                <div className="text-lg font-mono font-semibold text-white mt-1">{metrics.leaguePoints} LP</div>
              </div>
            )}
            {metrics.wins !== undefined && (
              <div>
                <div className="text-xs text-muted-foreground">Wins</div>
                <div className="text-lg font-mono font-semibold text-emerald-400 mt-1">{metrics.wins}</div>
              </div>
            )}
            {metrics.losses !== undefined && (
              <div>
                <div className="text-xs text-muted-foreground">Losses</div>
                <div className="text-lg font-mono font-semibold text-red-400 mt-1">{metrics.losses}</div>
              </div>
            )}
            {metrics.matches !== undefined && (
              <div>
                <div className="text-xs text-muted-foreground">Matches</div>
                <div className="text-lg font-mono font-semibold text-white mt-1">{metrics.matches}</div>
              </div>
            )}
            {metrics.wins !== undefined && metrics.losses !== undefined && (metrics.wins + metrics.losses) > 0 && (
              <div>
                <div className="text-xs text-muted-foreground">Win Rate</div>
                <div className="text-lg font-mono font-semibold text-white mt-1">
                  {((metrics.wins / (metrics.wins + metrics.losses)) * 100).toFixed(1)}%
                </div>
              </div>
            )}
            {metrics.performanceScore !== null && metrics.performanceScore !== undefined && (
              <div>
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  Perf Score
                  <TooltipProvider delayDuration={200}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="w-3 h-3 text-zinc-500 cursor-help" data-testid="perf-score-info-icon" />
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-[220px] text-center text-xs leading-snug">
                        A 0–100 indicator of recent player performance based on match results and competitive history. Higher scores indicate stronger recent performance.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <div className="text-lg font-mono font-semibold text-white mt-1" data-testid="perf-score-value">{metrics.performanceScore}</div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="bg-white/[0.03] border border-white/10 rounded-xl p-6">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Market Signals</div>
        {signals.length === 0 ? (
          <div className="text-sm text-muted-foreground italic">No signals available</div>
        ) : (
          <div className="space-y-2">
            {signals.map(s => (
              <div
                key={s.code}
                className={`flex flex-col gap-0.5 text-sm px-3 py-2 rounded-lg border ${
                  s.tone === "positive"
                    ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-300"
                    : s.tone === "negative"
                    ? "bg-red-500/10 border-red-500/20 text-red-300"
                    : "bg-white/5 border-white/10 text-zinc-400"
                }`}
                data-testid={`signal-${s.code}`}
              >
                <div className="flex items-center gap-2">
                  {s.tone === "positive" ? <TrendingUp className="w-4 h-4 shrink-0" /> : s.tone === "negative" ? <TrendingDown className="w-4 h-4 shrink-0" /> : <Activity className="w-4 h-4 shrink-0" />}
                  <span className="font-medium">{s.label}</span>
                </div>
                {s.reason && (
                  <div className="pl-6 text-xs opacity-70">{s.reason}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-3">
        <Button
          className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
          onClick={() => {
            const puuid = asset.assetId.split(":").slice(3).join(":");
            navigate(`/?player=${puuid}`);
          }}
          data-testid="button-detail-buy"
        >
          Trade on Terminal
        </Button>
      </div>
    </div>
  );
}

import { useState, useEffect, useCallback, useRef, useReducer, Component, type ReactNode } from "react";
import { useSearch, useLocation, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { usePortfolio } from "@/hooks/use-portfolio";
import { formatCurrency } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Search, Star, TrendingUp, TrendingDown,
  ChevronUp, ChevronDown, X, AlertTriangle, Activity, Info,
  ChevronRight, Zap, ExternalLink
} from "lucide-react";
import {
  LineChart, Line, ResponsiveContainer, Tooltip as ReTooltip, XAxis, YAxis
} from "recharts";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { useTerminal } from "@/state/terminalStore";
import type { MarketRow } from "@/state/terminalStore";

type UnifiedAsset = {
  assetId: string;
  internalId: number;
  provider: string;
  game: string;
  assetType: string;
  displayName: string;
  tag?: string | null;
  region?: string | null;
  price: string;
  price24hAgo?: string | null;
  change24hPct?: number | null;
  volume24h?: string | null;
  momentum?: string | null;
  marketCap?: string | null;
  supply?: string | null;
  performanceScore?: number | null;
  badges?: string[];
  rawMetrics?: Record<string, any>;
  watchlisted: boolean;
  bidPrice?: string | null;
  askPrice?: string | null;
  spreadPct?: string | null;
  // PVI Valuation layer
  fairValueGS?: number | null;
  pviAdjusted?: number | null;
  pviRaw?: number | null;
  pviFinal?: number | null;
  divergencePct?: number | null;
  confidenceScore?: number | null;
  lastMatchPulse?: number | null;
  recentPerformance?: number | null;
  consistencyScore?: number | null;
  historicalSkill?: number | null;
  activityScore?: number | null;
};

type AssetsResponse = {
  page: number;
  total: number;
  totalPages: number;
  rows: UnifiedAsset[];
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

type SnapshotPoint = { t: string; p: number };

type AmmQuote = {
  ammEnabled: boolean;
  assetId?: number;
  type?: string;
  shares?: number;
  currentSpot?: string;
  avgPrice?: string;
  notional?: string;
  feeAmount?: string;
  feeBps?: number;
  priceImpactPct?: string;
  newSpot?: string;
  supply?: string;
};

class DrawerErrorBoundary extends Component<
  { children: ReactNode; label?: string },
  { hasError: boolean; errorMessage: string }
> {
  constructor(props: { children: ReactNode; label?: string }) {
    super(props);
    this.state = { hasError: false, errorMessage: "" };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, errorMessage: error?.message ?? "Unknown error" };
  }
  componentDidCatch(error: Error, info: any) {
    console.error("[DrawerErrorBoundary] caught in section=" + (this.props.label ?? "?") + ":", error?.message, info?.componentStack);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center gap-2 p-3 text-center rounded-lg border border-red-500/20 bg-red-500/5" data-testid={`section-error-${this.props.label ?? "unknown"}`}>
          <AlertTriangle className="w-5 h-5 text-red-400" />
          <p className="text-xs font-medium text-red-300">Something went wrong in this section{this.props.label ? ` (${this.props.label})` : ""}</p>
          <p className="text-[10px] text-muted-foreground font-mono break-all">{this.state.errorMessage}</p>
          <button
            onClick={() => this.setState({ hasError: false, errorMessage: "" })}
            className="text-xs px-3 py-1 rounded bg-white/10 hover:bg-white/20 text-white transition-colors"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

class AssetsPageErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; errorMessage: string; componentStack: string }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: "", componentStack: "" };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, errorMessage: error?.message ?? String(error) };
  }
  componentDidCatch(error: Error, info: { componentStack: string }) {
    const stack = info?.componentStack ?? "";
    console.error("[AssetsPageBoundary] CAUGHT:", error?.message, stack);
    this.setState({ componentStack: stack });
  }
  render() {
    if (this.state.hasError) {
      return (
        <div data-testid="assets-page-error-boundary" style={{ padding: 24, background: "#1a0505", border: "2px solid #ef4444", borderRadius: 8, margin: 16, fontFamily: "monospace" }}>
          <div style={{ color: "#ef4444", fontWeight: "bold", fontSize: 16, marginBottom: 8 }}>
            Assets page failed to render
          </div>
          <div data-testid="assets-page-error-message" style={{ color: "#fca5a5", fontSize: 13, marginBottom: 12, wordBreak: "break-all" }}>
            {this.state.errorMessage}
          </div>
          {this.state.componentStack && (
            <pre data-testid="assets-page-error-stack" style={{ color: "#fecaca", fontSize: 10, overflow: "auto", maxHeight: 220, background: "#100000", padding: 8, borderRadius: 4, marginBottom: 12, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
              {this.state.componentStack.slice(0, 1500)}
            </pre>
          )}
          <button
            data-testid="assets-page-error-retry"
            onClick={() => this.setState({ hasError: false, errorMessage: "", componentStack: "" })}
            style={{ background: "#ef4444", color: "white", border: "none", padding: "8px 20px", borderRadius: 4, cursor: "pointer", fontWeight: "bold" }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const GAME_FILTERS = [
  { label: "Dota 2", value: "dota2" },
  { label: "CS2",    value: "cs2"   },
];


const SORT_OPTIONS = [
  { label: "Price", value: "lastTradePrice" },
  { label: "24h Change", value: "change24hPct" },
  { label: "Volume", value: "volume24h" },
  { label: "Momentum", value: "momentum" },
  { label: "Market Cap", value: "marketCap" },
  { label: "Perf Score", value: "performanceScore" },
];

function formatVolume(v: string | number | null | undefined): string {
  if (!v) return "—";
  const n = parseFloat(String(v));
  if (isNaN(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

function formatChange(pct: number | null | undefined) {
  if (pct === null || pct === undefined) return { text: "—", color: "text-muted-foreground" };
  const color = pct >= 0 ? "text-emerald-400" : "text-red-400";
  const text = `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
  return { text, color };
}

function GameBadge({ game }: { game: string }) {
  const colors: Record<string, string> = {
    "dota2":    "bg-violet-500/20 text-violet-300 border-violet-500/30",
    "lol":      "bg-blue-500/20 text-blue-300 border-blue-500/30",
    "valorant": "bg-rose-500/20 text-rose-300 border-rose-500/30",
    "cs2":      "bg-amber-500/20 text-amber-300 border-amber-500/30",
  };
  const labels: Record<string, string> = {
    "dota2":    "Dota 2",
    "lol":      "LoL",
    "valorant": "Valorant",
    "cs2":      "CS2",
  };
  const key = game.toLowerCase();
  const cls = colors[key] || "bg-zinc-500/20 text-zinc-300 border-zinc-500/30";
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${cls}`}>
      {labels[key] ?? game}
    </span>
  );
}

function RegionBadge({ region }: { region: string }) {
  return (
    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded border bg-zinc-800/60 text-zinc-400 border-zinc-700/50">
      {region}
    </span>
  );
}

function PerfBar({ score }: { score: number | null | undefined }) {
  if (score === null || score === undefined) return <span className="text-muted-foreground text-xs">—</span>;
  const color = score >= 70 ? "bg-emerald-500" : score >= 40 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, score)}%` }} />
      </div>
      <span className="text-xs font-mono text-muted-foreground" data-testid="perf-score-value">{score}</span>
    </div>
  );
}

function MiniChart({ assetUid, tf, height = 80 }: { assetUid: string; tf: string; height?: number }) {
  const { data, isLoading } = useQuery<{ points: SnapshotPoint[] }>({
    queryKey: ["/api/assets/snapshots", assetUid, tf],
    queryFn: () => fetch(`/api/assets/${encodeURIComponent(assetUid)}/snapshots?tf=${tf}`).then(r => r.json()),
    staleTime: 60_000,
  });

  if (isLoading) return <div style={{ height }} className="flex items-center justify-center"><Skeleton className="w-full h-full" /></div>;

  // Harden: validate every point, reject malformed data
  const rawPoints = Array.isArray(data?.points) ? data.points : [];
  const validPoints = rawPoints.filter(pt => {
    if (!pt || typeof pt !== "object") return false;
    const p = safeNumber(pt.p, NaN);
    return Number.isFinite(p) && p > 0;
  }).map(pt => ({ t: String(pt.t ?? ""), p: safeNumber(pt.p, 0) }));

  if (validPoints.length < 3) {
    return <div style={{ height }} className="flex items-center justify-center text-xs text-muted-foreground" data-testid="drawer-chart-no-data">No chart data yet</div>;
  }

  const first = validPoints[0].p;
  const last = validPoints[validPoints.length - 1].p;
  const lineColor = last >= first ? "#10b981" : "#f87171";

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={validPoints}>
        <XAxis dataKey="t" hide />
        <YAxis domain={["auto", "auto"]} hide />
        {height > 50 && (
          <ReTooltip
            contentStyle={{ background: "#1c1f2e", border: "1px solid #2d3144", borderRadius: 6, fontSize: 11 }}
            formatter={(v: any) => {
              const n = safeNumber(v, 0);
              return [`$${Number.isFinite(n) ? n.toFixed(2) : "0.00"}`, "Price"];
            }}
            labelFormatter={() => ""}
          />
        )}
        <Line type="monotone" dataKey="p" stroke={lineColor} strokeWidth={1.5} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ---- Player Card (guarded by ENABLE_PLAYER_CARD) ----
const AVATAR_COUNT = 6;

function getAvatarUrl(internalId: number): string {
  const idx = (Math.abs(internalId) % AVATAR_COUNT) + 1;
  return `/player-avatars/avatar${idx}.png`;
}

function getSentiment(momentum: number, change: number): "BULLISH" | "NEUTRAL" | "BEARISH" {
  if (momentum > 10 || change > 5) return "BULLISH";
  if (momentum < -5 || change < -5) return "BEARISH";
  return "NEUTRAL";
}

function getTier(performanceScore: number, momentum: number): string {
  if (performanceScore >= 70 || momentum > 15) return "Tier 1";
  if (performanceScore >= 40 || momentum > 5) return "Tier 2";
  return "Tier 3";
}

function PlayerCard({ asset }: { asset: UnifiedAsset }) {
  useEffect(() => { console.log("[Drawer:PLAYER_CARD] mounted displayName=", asset?.displayName); }, []);

  const momentum = safeNumber(asset.momentum, 0);
  const change = safeNumber(asset.change24hPct, 0);
  const perfScore = safeNumber(asset.performanceScore, 0);
  const price = safeNumber(asset.price, 0);
  const sentiment = getSentiment(momentum, change);
  const tier = getTier(perfScore, momentum);
  const changeData = formatChange(change);
  const avatarUrl = getAvatarUrl(asset.internalId);

  const regionLabel = asset.region
    ? asset.region.replace("NA1", "NA").replace("EUW1", "EUW").replace("KR", "KR").replace("BR1", "BR")
    : "NA";

  return (
    <div
      className="relative overflow-hidden"
      style={{
        height: 248,
        width: "100%",
        borderRadius: 16,
        boxShadow: "0 0 28px rgba(16,185,129,0.18), 0 8px 32px rgba(0,0,0,0.6)",
        border: "1px solid rgba(16,185,129,0.18)",
      }}
      data-testid="player-card"
    >
      {/* Background portrait image */}
      <img
        src={avatarUrl}
        alt=""
        className="absolute inset-0 w-full h-full object-cover object-top"
        aria-hidden="true"
        style={{ filter: "saturate(0.85) brightness(0.75)" }}
      />

      {/* Gradient overlay for readability */}
      <div
        className="absolute inset-0"
        style={{
          background: "linear-gradient(to bottom, rgba(0,0,0,0.32) 0%, rgba(0,0,0,0.48) 35%, rgba(0,0,0,0.88) 72%, rgba(0,0,0,0.96) 100%)",
        }}
      />

      {/* Subtle green tint at edges */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: "radial-gradient(ellipse at 50% 110%, rgba(16,185,129,0.12) 0%, transparent 65%)",
        }}
      />

      {/* Content layer */}
      <div className="relative flex flex-col h-full p-3">

        {/* Top: Sentiment + Tier badges */}
        <div className="flex items-center gap-1.5">
          <span
            className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider border backdrop-blur-sm ${
              sentiment === "BULLISH"
                ? "bg-emerald-500/25 text-emerald-300 border-emerald-500/40"
                : sentiment === "BEARISH"
                ? "bg-red-500/25 text-red-300 border-red-500/40"
                : "bg-zinc-500/20 text-zinc-300 border-zinc-500/35"
            }`}
            data-testid="card-sentiment-badge"
          >
            {sentiment}
          </span>
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider border backdrop-blur-sm bg-amber-500/20 text-amber-300 border-amber-500/40"
            data-testid="card-tier-badge"
          >
            {tier}
          </span>
          <span className="ml-auto text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider border backdrop-blur-sm bg-violet-500/20 text-violet-300 border-violet-500/35">
            Challenger
          </span>
        </div>

        {/* Middle: Player identity */}
        <div className="flex-1 flex flex-col justify-end pb-1.5">
          <div
            className="font-display font-bold text-white leading-tight drop-shadow-lg"
            style={{ fontSize: 17 }}
            data-testid="card-player-name"
          >
            {asset.displayName}
          </div>
          <div className="text-[11px] text-zinc-300/80 font-mono mt-0.5 drop-shadow">
            {asset.game === "dota2" ? "Dota 2" : asset.game === "lol" ? "League of Legends" : asset.game.toUpperCase()} <span className="text-zinc-500">•</span> {regionLabel}
          </div>
        </div>

        {/* Mini price chart — narrow strip */}
        <div className="mb-2 -mx-1">
          <MiniChart assetUid={asset.assetId} tf="7d" height={44} />
        </div>

        {/* Bottom: Market price + 24h change */}
        <div className="flex items-end justify-between">
          <div>
            <div className="text-[8px] font-bold text-zinc-400/80 uppercase tracking-widest mb-0.5">
              Market Price
            </div>
            <div className="font-mono font-bold text-white" style={{ fontSize: 16, lineHeight: 1 }}>
              {Number.isFinite(price) ? formatCurrency(price) : "—"}
            </div>
          </div>
          <div
            className={`font-mono font-bold text-sm ${changeData?.color ?? "text-zinc-400"}`}
            data-testid="card-24h-change"
          >
            {changeData?.text ?? "—"}
          </div>
        </div>
      </div>
    </div>
  );
}

type TradeState = { side: "BUY" | "SELL" };
type TradeAction = { type: "SET_SIDE"; side: "BUY" | "SELL" };
function tradeReducer(state: TradeState, action: TradeAction): TradeState {
  if (action.type === "SET_SIDE") return { ...state, side: action.side };
  return state;
}

// ---- Step 3: Safe numeric parser — never throws, always returns finite number ----
function safeNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? n : fallback;
}

// ---- Step 8: Trade-module-level error boundary ----
class TradeModuleErrorBoundary extends Component<
  { children: ReactNode },
  { crashed: boolean }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { crashed: false };
  }
  static getDerivedStateFromError() { return { crashed: true }; }
  componentDidCatch(err: unknown) { console.error("[Trade] error boundary caught:", err); }
  render() {
    if (this.state.crashed) {
      return (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-xs text-muted-foreground italic text-center" data-testid="trade-module-error">
          Trade module failed to load
        </div>
      );
    }
    return this.props.children;
  }
}

function AssetTradeModule({ asset }: { asset: UnifiedAsset }) {
  // Step 9: Mount log — FIRST hook, before any conditional
  useEffect(() => {
    console.log("[Trade] module mounted assetId=", asset?.assetId, "price=", asset?.price);
  }, []);

  // Step 4: ALL hooks declared unconditionally at the top
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [orderType, setOrderType] = useState<"MARKET" | "LIMIT">("MARKET");
  const [quantity, setQuantity] = useState(1);
  const [limitPrice, setLimitPrice] = useState("");

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: portfolio } = usePortfolio();

  // Step 2: Compute required values (no hooks after this point that depend on guards)
  const internalId = asset?.internalId ?? 0;
  const rawPrice = safeNumber(asset?.price, 0);

  const isBuy = side === "BUY";
  const isMarket = orderType === "MARKET";

  // Step 3: All numeric values go through safeNumber
  const balance = safeNumber(portfolio?.portfolio?.balance, 10000);
  const positions: any[] = Array.isArray(portfolio?.positions) ? portfolio.positions : [];

  // Position lookup — same pattern as Terminal (canonical source, numeric assetId)
  const canonicalPos = positions.find(
    (p: any) => (p?.source === "CANONICAL" && p?.assetId === internalId) || p?.assetId === internalId
  );
  const sharesOwned = safeNumber(canonicalPos?.shares ?? canonicalPos?.quantity, 0);

  // Step 4: Clamp quantity to valid range
  const safeQty = Math.max(1, Math.floor(safeNumber(quantity, 1)));
  const safeLimitPrice = safeNumber(limitPrice, 0);

  // Step 7: Quote — same endpoint as Terminal
  const quoteEnabled = internalId > 0 && safeQty > 0 && rawPrice > 0;
  const { data: quote } = useQuery<AmmQuote>({
    queryKey: ["/api/market/assets", internalId, "quote", side, safeQty],
    queryFn: () =>
      fetch(`/api/market/assets/${internalId}/quote?type=${side}&shares=${safeQty}`, { credentials: "include" }).then(r => r.json()),
    enabled: quoteEnabled,
    staleTime: 3_000,
  });

  // Step 5: Simple local estimate — all through safeNumber
  const execPrice = safeNumber(
    quote?.ammEnabled && quote?.avgPrice ? quote.avgPrice : rawPrice,
    rawPrice
  );
  const grossValue = safeNumber(
    quote?.ammEnabled && quote?.notional ? quote.notional : execPrice * safeQty,
    execPrice * safeQty
  );
  const fee = safeNumber(quote?.ammEnabled && quote?.feeAmount ? quote.feeAmount : 0, 0);
  const netAmount = isBuy ? grossValue + fee : Math.max(0, grossValue - fee);
  const estimated = Number.isFinite(netAmount) && netAmount > 0 ? netAmount : null;

  // Trade feasibility
  const maxBuyQty = Math.max(1, Math.floor(balance / Math.max(0.01, execPrice * 1.02)));
  const maxSellQty = Math.max(0, sharesOwned);
  const canTrade = isMarket
    ? (isBuy ? balance >= (estimated ?? 0) && safeQty >= 1 : sharesOwned >= safeQty)
    : safeLimitPrice > 0 && safeQty >= 1;

  const tradeMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/market/assets/${internalId}/trade`, {
        type: side,
        shares: safeQty,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio"] });
      queryClient.invalidateQueries({ queryKey: ["/api/assets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/market/assets"] });
      toast({
        title: `${side} executed`,
        description: `${side} ${safeQty} share${safeQty !== 1 ? "s" : ""} of ${asset?.displayName ?? "asset"}`,
        duration: 3000,
      });
      setQuantity(1);
    },
    onError: (err: any) => {
      toast({ title: "Trade failed", description: err?.message ?? "Unknown error", variant: "destructive" });
    },
  });

  const orderMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/orders", {
        assetUid: asset?.assetId,
        side,
        type: "LIMIT",
        shares: safeQty,
        triggerPrice: safeLimitPrice.toFixed(2),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({ title: "Limit order placed", description: `${side} ${safeQty} @ $${safeLimitPrice.toFixed(2)}`, duration: 3000 });
      setQuantity(1);
      setLimitPrice("");
    },
    onError: (err: any) => {
      toast({ title: "Order failed", description: err?.message ?? "Unknown error", variant: "destructive" });
    },
  });

  // Step 2: Guard — after ALL hooks, before any render logic
  if (!internalId || rawPrice <= 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-xs text-muted-foreground italic text-center" data-testid="drawer-trade-guard-fail">
        Trading unavailable for this asset
      </div>
    );
  }

  // Step 9: interaction logs
  const handleSideChange = (s: "BUY" | "SELL") => {
    console.log("[Trade] side changed", s);
    setSide(s);
  };
  const handleOrderTypeChange = (t: "MARKET" | "LIMIT") => {
    console.log("[Trade] order type changed", t);
    setOrderType(t);
  };
  const handleQtyChange = (v: number) => {
    console.log("[Trade] quantity changed", v);
    setQuantity(Math.max(1, Math.floor(safeNumber(v, 1))));
  };
  const handleLimitPriceChange = (v: string) => {
    console.log("[Trade] limit price changed", v);
    setLimitPrice(v);
  };
  const handleSubmit = () => {
    console.log("[Trade] submit clicked side=", side, "type=", orderType, "qty=", safeQty);
    if (isMarket) tradeMutation.mutate();
    else orderMutation.mutate();
  };

  const ctaLabel = (): string => {
    if (isMarket) {
      if (tradeMutation.isPending) return "Executing…";
      if (!canTrade) return isBuy ? "Insufficient funds" : "No shares to sell";
      return `${side} ${safeQty} share${safeQty !== 1 ? "s" : ""}`;
    }
    if (orderMutation.isPending) return "Placing…";
    if (safeLimitPrice <= 0) return "Enter limit price";
    return "Place Limit Order";
  };

  // Step 6: Safe placeholder for limit price input
  const limitPricePlaceholder = Number.isFinite(rawPrice) && rawPrice > 0
    ? rawPrice.toFixed(2)
    : "0.00";

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden" data-testid="trade-module">
      <div className="px-3 py-2 border-b border-white/10 bg-white/[0.02]">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Trade</span>
      </div>

      <div className="p-2.5 space-y-2">
        {/* BUY / SELL toggle */}
        <div className="grid grid-cols-2 rounded-lg overflow-hidden border border-white/10">
          <button
            data-testid="drawer-ticket-buy"
            onClick={() => handleSideChange("BUY")}
            className={`py-2 text-sm font-bold transition-colors ${isBuy ? "bg-emerald-500/20 text-emerald-400 border-b-2 border-emerald-500" : "text-muted-foreground hover:text-foreground hover:bg-white/5"}`}
          >
            BUY
          </button>
          <button
            data-testid="drawer-ticket-sell"
            onClick={() => handleSideChange("SELL")}
            className={`py-2 text-sm font-bold transition-colors ${!isBuy ? "bg-rose-500/20 text-rose-400 border-b-2 border-rose-500" : "text-muted-foreground hover:text-foreground hover:bg-white/5"}`}
          >
            SELL
          </button>
        </div>

        {/* MARKET / LIMIT toggle */}
        <div className="grid grid-cols-2 gap-1">
          {(["MARKET", "LIMIT"] as const).map(mode => (
            <button
              key={mode}
              data-testid={`drawer-order-mode-${mode.toLowerCase()}`}
              onClick={() => handleOrderTypeChange(mode)}
              className={`py-1.5 rounded text-xs font-semibold transition-colors border ${
                orderType === mode
                  ? "bg-primary/20 text-primary border-primary/40"
                  : "text-muted-foreground border-white/10 hover:text-foreground hover:bg-white/5"
              }`}
            >
              {mode === "MARKET" ? "Market" : "Limit"}
            </button>
          ))}
        </div>

        {/* Limit price input — only shown for LIMIT orders */}
        {orderType === "LIMIT" && (
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Limit Price</label>
            <input
              data-testid="drawer-trigger-price-input"
              type="number"
              min={0.01}
              step={0.01}
              value={limitPrice}
              onChange={e => handleLimitPriceChange(e.target.value)}
              placeholder={limitPricePlaceholder}
              className="w-full bg-white/5 border border-white/10 rounded h-7 px-2.5 text-sm font-mono text-foreground focus:outline-none focus:border-primary"
            />
            <p className="text-[10px] text-muted-foreground/60 mt-0.5">
              {isBuy ? "Executes when price drops to or below your limit." : "Executes when price rises to or above your limit."}
            </p>
          </div>
        )}

        {/* Quantity */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-muted-foreground">Quantity</label>
            <span className="text-xs text-muted-foreground/60">
              {isBuy ? `${formatCurrency(execPrice)}/sh` : `${sharesOwned} owned`}
            </span>
          </div>
          <div className="flex items-center gap-1 mb-1.5">
            <button
              data-testid="drawer-qty-down"
              onClick={() => handleQtyChange(safeQty - 1)}
              className="w-7 h-7 rounded bg-white/5 hover:bg-white/10 text-sm font-bold text-muted-foreground hover:text-foreground flex items-center justify-center shrink-0"
            >
              −
            </button>
            <input
              data-testid="drawer-qty-input"
              type="number"
              min={1}
              value={quantity}
              onChange={e => handleQtyChange(parseInt(e.target.value) || 1)}
              className="flex-1 text-center bg-white/5 border border-white/10 rounded h-7 text-sm font-mono text-foreground focus:outline-none focus:border-primary"
            />
            <button
              data-testid="drawer-qty-up"
              onClick={() => handleQtyChange(safeQty + 1)}
              className="w-7 h-7 rounded bg-white/5 hover:bg-white/10 text-sm font-bold text-muted-foreground hover:text-foreground flex items-center justify-center shrink-0"
            >
              +
            </button>
          </div>
          <div className="grid grid-cols-4 gap-1">
            {[1, 5, 10].map(n => (
              <button
                key={n}
                data-testid={`drawer-qty-quick-${n}`}
                onClick={() => handleQtyChange(safeQty + n)}
                className="py-1 rounded text-xs font-medium bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors border border-white/5"
              >
                +{n}
              </button>
            ))}
            <button
              data-testid="drawer-qty-max"
              onClick={() => handleQtyChange(Math.max(1, isBuy ? maxBuyQty : maxSellQty))}
              className="py-1 rounded text-xs font-medium bg-white/5 hover:bg-primary/20 text-muted-foreground hover:text-primary transition-colors border border-white/5"
            >
              MAX
            </button>
          </div>
        </div>

        {/* Step 5: Estimated value panel */}
        <div className={`rounded-lg px-3 py-2.5 border ${isBuy ? "bg-emerald-500/5 border-emerald-500/15" : "bg-rose-500/5 border-rose-500/15"}`}>
          <div className="text-xs text-muted-foreground mb-0.5">
            {isBuy ? "Estimated Cost" : "Estimated Proceeds"}
          </div>
          <div className={`text-xl font-mono font-bold ${isBuy ? "text-emerald-400" : "text-rose-400"}`} data-testid="trade-estimated-value">
            {estimated !== null ? formatCurrency(estimated) : "—"}
          </div>
        </div>

        {/* Buying power / shares owned */}
        <div className="flex items-center justify-between px-0.5">
          <span className="text-xs text-muted-foreground">{isBuy ? "Buying power" : "Shares owned"}</span>
          <span className="text-xs font-mono text-muted-foreground">
            {isBuy ? formatCurrency(balance) : `${sharesOwned} sh`}
          </span>
        </div>

        {/* Submit */}
        <button
          data-testid="drawer-ticket-submit"
          onClick={handleSubmit}
          disabled={!canTrade || tradeMutation.isPending || orderMutation.isPending}
          className={`w-full py-2.5 rounded-lg text-sm font-bold transition-all ${
            isBuy
              ? "bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40 disabled:cursor-not-allowed"
              : "bg-rose-600 hover:bg-rose-500 text-white disabled:opacity-40 disabled:cursor-not-allowed"
          }`}
        >
          {ctaLabel()}
        </button>
      </div>
    </div>
  );
}

// Exported wrapper with error boundary (Step 8)
function SafeAssetTradeModule({ asset }: { asset: UnifiedAsset }) {
  return (
    <TradeModuleErrorBoundary>
      <AssetTradeModule asset={asset} />
    </TradeModuleErrorBoundary>
  );
}

// ============================================================
// STEP 2 — Global error monitor: window.onerror + visible debug box
// ============================================================
function GlobalErrorMonitor() {
  const [lastError, setLastError] = useState<{ msg: string; ts: number } | null>(null);

  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      const msg = `[GlobalError] ${event?.message ?? "unknown"} at ${event?.filename ?? "?"}:${event?.lineno ?? 0}`;
      console.error(msg, event?.error);
      setLastError({ msg, ts: Date.now() });
    };
    const onUnhandled = (event: PromiseRejectionEvent) => {
      const reason = event?.reason;
      const msg = `[UnhandledPromise] ${reason instanceof Error ? reason.message : String(reason ?? "unknown")}`;
      console.error(msg, reason);
      setLastError({ msg, ts: Date.now() });
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandled);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandled);
    };
  }, []);

  if (!lastError) return null;
  return (
    <div
      data-testid="global-error-monitor"
      style={{
        position: "fixed", bottom: 16, right: 16, zIndex: 9999,
        background: "#1a0000", border: "1px solid #ef4444", borderRadius: 6,
        padding: "10px 14px", maxWidth: 380, fontFamily: "monospace", fontSize: 11,
        color: "#fca5a5", boxShadow: "0 4px 24px rgba(239,68,68,0.35)",
      }}
    >
      <div style={{ color: "#ef4444", fontWeight: "bold", marginBottom: 4 }}>Runtime Error Detected</div>
      <div style={{ wordBreak: "break-all", marginBottom: 6 }}>{lastError.msg}</div>
      <button
        onClick={() => setLastError(null)}
        style={{ background: "transparent", border: "none", color: "#ef4444", cursor: "pointer", fontSize: 11, textDecoration: "underline" }}
      >
        Dismiss
      </button>
    </div>
  );
}

// ============================================================
// DRAWER FEATURE FLAGS — Start with ALL FALSE, enable one at a time
// Order: METRICS → SIGNALS → PLAYER_CARD → CHART → TRADE_MODULE
// ============================================================
const DRAWER_FLAGS = {
  ENABLE_ASSET_METRICS:      true,
  ENABLE_ASSET_SIGNALS:      true,
  ENABLE_PLAYER_CARD:        true,
  ENABLE_ASSET_CHART:        true,
  ENABLE_ASSET_TRADE_MODULE: true,
  ENABLE_VALUATION:          true,
} as const;

// Label used in the visible stage indicator (Step 4)
function drawerStageLabel(): string {
  const active: string[] = [];
  if (DRAWER_FLAGS.ENABLE_ASSET_METRICS)     active.push("metrics");
  if (DRAWER_FLAGS.ENABLE_ASSET_SIGNALS)     active.push("signals");
  if (DRAWER_FLAGS.ENABLE_PLAYER_CARD)       active.push("player-card");
  if (DRAWER_FLAGS.ENABLE_ASSET_CHART)       active.push("chart");
  if (DRAWER_FLAGS.ENABLE_ASSET_TRADE_MODULE) active.push("trade-module");
  return active.length === 0 ? "shell" : active.join(" · ");
}

// ---- Price Summary (always shown — shell section) ----
function DrawerPriceSummary({ asset }: { asset: UnifiedAsset }) {
  useEffect(() => { console.log("[Drawer:PRICE] mounted"); }, []);
  const price = parseFloat(String(asset?.price ?? "0")) || 0;
  const change = formatChange(asset?.change24hPct);
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="bg-white/5 rounded-lg p-2.5">
        <div className="text-[10px] text-muted-foreground mb-0.5">Current Price</div>
        <div className="text-base font-mono font-bold text-white" data-testid="drawer-price-value">
          {formatCurrency(price)}
        </div>
      </div>
      <div className="bg-white/5 rounded-lg p-2.5">
        <div className="text-[10px] text-muted-foreground mb-0.5">24h Change</div>
        <div className={`text-base font-mono font-bold ${change?.color ?? "text-muted-foreground"}`}>
          {change?.text ?? "—"}
        </div>
      </div>
      <div className="bg-white/5 rounded-lg p-2.5">
        <div className="text-[10px] text-muted-foreground mb-0.5">Volume 24h</div>
        <div className="text-sm font-mono text-white">${formatVolume(asset?.volume24h)}</div>
      </div>
      {asset?.marketCap ? (
        <div className="bg-white/5 rounded-lg p-2.5">
          <div className="text-[10px] text-muted-foreground mb-0.5">Market Cap</div>
          <div className="text-sm font-mono text-white">${formatVolume(asset.marketCap)}</div>
        </div>
      ) : null}
    </div>
  );
}

// ---- Valuation (guarded by ENABLE_VALUATION) ----
function DrawerValuation({ asset }: { asset: UnifiedAsset }) {
  const fv = asset?.fairValueGS ?? null;
  const pvi = asset?.pviAdjusted ?? null;
  const div = asset?.divergencePct ?? null;
  const conf = asset?.confidenceScore ?? null;
  const pulse = asset?.lastMatchPulse ?? null;
  const marketPrice = parseFloat(String(asset?.price ?? "0")) || 0;

  const hasData = fv !== null && pvi !== null;

  const divColor = div === null
    ? "text-muted-foreground"
    : div > 15
      ? "text-red-400"
      : div < -10
        ? "text-emerald-400"
        : "text-slate-300";

  const divLabel = div === null
    ? "N/A"
    : `${div > 0 ? "+" : ""}${div.toFixed(1)}%`;

  const confPct = conf !== null ? Math.round(conf * 100) : null;

  const pviBarWidth = pvi !== null ? Math.round(pvi) : 0;
  const pviColor = pvi === null
    ? "bg-slate-600"
    : pvi >= 70
      ? "bg-emerald-500"
      : pvi >= 40
        ? "bg-amber-500"
        : "bg-red-500";

  return (
    <div className="bg-white/5 rounded-lg p-3 space-y-2.5" data-testid="drawer-valuation">
      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
        PVI Valuation
      </div>

      {/* Row 1: Market Price | Fair Value | Divergence */}
      <div className="grid grid-cols-3 gap-2">
        <div>
          <div className="text-[9px] text-muted-foreground mb-0.5">Market Price</div>
          <div className="text-sm font-mono font-bold text-white" data-testid="val-market-price">
            {marketPrice > 0 ? `$${marketPrice.toFixed(2)}` : "—"}
          </div>
        </div>
        <div>
          <div className="text-[9px] text-muted-foreground mb-0.5">Fair Value</div>
          <div className="text-sm font-mono font-bold text-sky-300" data-testid="val-fair-value">
            {fv !== null ? `$${fv.toFixed(2)}` : "N/A"}
          </div>
        </div>
        <div>
          <div className="text-[9px] text-muted-foreground mb-0.5">Divergence</div>
          <div className={`text-sm font-mono font-bold ${divColor}`} data-testid="val-divergence">
            {divLabel}
          </div>
        </div>
      </div>

      {/* Row 2: PVI bar | Confidence | Last Pulse */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[9px] text-muted-foreground">Player Value Index</span>
          <span className="text-[10px] font-mono text-white" data-testid="val-pvi">
            {hasData ? `${pvi!.toFixed(1)} / 100` : "N/A"}
          </span>
        </div>
        {hasData && (
          <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${pviColor}`}
              style={{ width: `${pviBarWidth}%` }}
              data-testid="val-pvi-bar"
            />
          </div>
        )}

        <div className="flex justify-between items-center">
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] text-muted-foreground">Confidence</span>
            {confPct !== null && (
              <span
                className={`text-[9px] font-mono px-1.5 py-0.5 rounded-full ${
                  confPct >= 60 ? "bg-emerald-500/20 text-emerald-300" :
                  confPct >= 30 ? "bg-amber-500/20 text-amber-300" :
                  "bg-red-500/20 text-red-300"
                }`}
                data-testid="val-confidence"
              >
                {confPct}%
              </span>
            )}
            {confPct === null && <span className="text-[9px] text-muted-foreground">N/A</span>}
          </div>
          {pulse !== null && (
            <div className="flex items-center gap-1">
              <span className="text-[9px] text-muted-foreground">Last Pulse</span>
              <span className="text-[10px] font-mono text-violet-300" data-testid="val-pulse">
                {pulse.toFixed(0)}
              </span>
            </div>
          )}
        </div>
      </div>

      {!hasData && (
        <div className="text-[9px] text-muted-foreground italic">
          Valuation data not yet computed — will update after next match
        </div>
      )}
    </div>
  );
}

// ---- Metrics (guarded by ENABLE_ASSET_METRICS) ----
function DrawerMetrics({ metrics, isLoading }: { metrics: AssetDetail["metrics"] | undefined; isLoading: boolean }) {
  useEffect(() => { console.log("[Drawer:METRICS] mounted"); }, []);
  return (
    <div>
      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Performance Metrics</div>
      {isLoading ? (
        <div className="space-y-1.5">{[1, 2, 3].map(i => <Skeleton key={i} className="h-5 w-full" />)}</div>
      ) : !metrics ? (
        <div className="space-y-1.5">{[1, 2].map(i => <Skeleton key={i} className="h-5 w-full opacity-30" />)}</div>
      ) : (
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">League Points</span>
            <span className="font-mono text-white">{metrics?.leaguePoints ?? "—"} LP</span>
          </div>
          {(metrics?.wins != null && metrics?.losses != null) && (
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Win / Loss</span>
              <span className="font-mono text-white">
                <span className="text-emerald-400">{metrics.wins}W</span>{" / "}
                <span className="text-red-400">{metrics.losses}L</span>
              </span>
            </div>
          )}
          {(metrics?.wins != null && metrics?.losses != null && (metrics.wins + metrics.losses) > 0) && (
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Win Rate</span>
              <span className="font-mono text-white">
                {metrics?.winRate != null
                  ? `${(parseFloat(String(metrics.winRate)) || 0).toFixed(1)}%`
                  : `${(((metrics.wins ?? 0) / Math.max(1, (metrics.wins ?? 0) + (metrics.losses ?? 0))) * 100).toFixed(1)}%`}
              </span>
            </div>
          )}
          {metrics?.performanceScore != null && (
            <div className="flex justify-between items-center text-xs">
              <span className="text-muted-foreground flex items-center gap-1">
                Perf Score
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="w-3 h-3 text-zinc-500 cursor-help" data-testid="perf-score-info-icon" />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[200px] text-center text-xs leading-snug">
                      A 0–100 indicator of recent player performance based on match results and competitive history. Higher scores indicate stronger recent performance.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </span>
              <PerfBar score={metrics.performanceScore} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Signals (guarded by ENABLE_ASSET_SIGNALS) ----
function DrawerSignals({ signals }: { signals: AssetDetail["signals"] }) {
  useEffect(() => { console.log("[Drawer:SIGNALS] mounted count=", Array.isArray(signals) ? signals.length : 0); }, []);
  const safeSignals = Array.isArray(signals) ? signals.filter(s => s && typeof s.code === "string") : [];
  if (safeSignals.length === 0) {
    return (
      <div className="text-xs text-muted-foreground italic px-1" data-testid="drawer-signals-empty">No signals available</div>
    );
  }
  return (
    <div>
      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Market Signals</div>
      <div className="space-y-1.5">
        {safeSignals.map(s => {
          const tone = s?.tone ?? "neutral";
          const label = s?.label ?? "—";
          const code = s?.code ?? "unknown";
          const reason = s?.reason;
          return (
            <div
              key={code}
              className={`flex flex-col gap-0.5 text-xs px-2.5 py-2 rounded-md border ${
                tone === "positive"
                  ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-300"
                  : tone === "negative"
                  ? "bg-red-500/10 border-red-500/20 text-red-300"
                  : "bg-white/5 border-white/10 text-zinc-400"
              }`}
              data-testid={`signal-${code}`}
            >
              <div className="flex items-center gap-2">
                {tone === "positive" ? <TrendingUp className="w-3 h-3 shrink-0" /> : tone === "negative" ? <TrendingDown className="w-3 h-3 shrink-0" /> : <Activity className="w-3 h-3 shrink-0" />}
                <span className="font-medium">{label}</span>
              </div>
              {reason && (
                <div className="pl-5 text-[10px] opacity-70 leading-tight">{reason}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- Chart (guarded by ENABLE_ASSET_CHART) ----
function DrawerChart({ assetId, tf, setTf }: { assetId: string; tf: string; setTf: (t: string) => void }) {
  useEffect(() => { console.log("[Drawer:CHART] mounted assetId=", assetId); }, []);
  if (!assetId || typeof assetId !== "string") {
    return <div className="text-xs text-muted-foreground italic" data-testid="drawer-chart-empty">No chart data yet</div>;
  }
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Price Chart</span>
        <div className="flex gap-1">
          {["24h", "7d", "30d"].map(t => (
            <button
              key={t}
              onClick={() => setTf(t)}
              className={`text-xs px-2 py-0.5 rounded transition-colors ${tf === t ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-white"}`}
              data-testid={`button-tf-${t}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <MiniChart assetUid={assetId} tf={tf} />
    </div>
  );
}

// ---- Trade Module (guarded by ENABLE_ASSET_TRADE_MODULE) ----
function DrawerTradeModule({ asset }: { asset: UnifiedAsset }) {
  useEffect(() => { console.log("[Drawer:TRADE_MODULE] mounted assetId=", asset?.assetId, "price=", asset?.price); }, []);
  return <SafeAssetTradeModule asset={asset} />;
}

function AssetDrawer({
  asset,
  onClose,
  onToggleWatchlist,
}: {
  asset: UnifiedAsset;
  onClose: () => void;
  onToggleWatchlist: (asset: UnifiedAsset) => void;
}) {
  const [tf, setTf] = useState("7d");

  // Step 7: Explicit mount log
  useEffect(() => {
    console.log("[Drawer] mounted assetId=", asset?.assetId, "displayName=", asset?.displayName, "stage=", drawerStageLabel());
  }, [asset?.assetId]);

  const { data: detail, isLoading } = useQuery<AssetDetail>({
    queryKey: ["/api/assets/detail", asset?.assetId],
    queryFn: () => fetch(`/api/assets/${encodeURIComponent(asset.assetId)}`).then(r => r.json()),
    enabled: !!asset?.assetId,
    staleTime: 30_000,
  });

  const metrics = detail?.metrics;
  const signals = detail?.signals ?? [];

  return (
    <div className="flex flex-col h-full" data-testid="asset-drawer">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold text-white truncate max-w-[280px]" data-testid="drawer-asset-name">
            {asset?.displayName ?? "—"}
          </span>
          {/* Step 4: Visible stage indicator */}
          <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-wider" data-testid="drawer-stage-label">
            stage: {drawerStageLabel()}
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-md text-muted-foreground hover:text-white hover:bg-white/10 transition-colors shrink-0"
          data-testid="button-drawer-close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* View Card — primary CTA, always visible below header */}
      <div className="px-3 py-2.5 border-b border-white/8 shrink-0">
        <Link href={`/players/${asset.internalId}`}>
          <Button
            className="w-full bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold h-9 gap-2"
            data-testid="button-view-card"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            View Card
          </Button>
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-3 space-y-3">

          {/* Stage: ENABLE_PLAYER_CARD — always first in panel */}
          {DRAWER_FLAGS.ENABLE_PLAYER_CARD && (
            <DrawerErrorBoundary label="player-card">
              <PlayerCard asset={asset} />
            </DrawerErrorBoundary>
          )}

          {/* Shell: price summary — always visible */}
          <DrawerErrorBoundary label="price">
            <DrawerPriceSummary asset={asset} />
          </DrawerErrorBoundary>

          {/* Stage: ENABLE_VALUATION — PVI / Fair Value / Divergence */}
          {DRAWER_FLAGS.ENABLE_VALUATION && (
            <DrawerErrorBoundary label="valuation">
              <DrawerValuation asset={asset} />
            </DrawerErrorBoundary>
          )}

          {/* Stage: ENABLE_ASSET_METRICS */}
          {DRAWER_FLAGS.ENABLE_ASSET_METRICS && (
            <DrawerErrorBoundary label="metrics">
              <DrawerMetrics metrics={metrics} isLoading={isLoading} />
            </DrawerErrorBoundary>
          )}

          {/* Stage: ENABLE_ASSET_SIGNALS */}
          {DRAWER_FLAGS.ENABLE_ASSET_SIGNALS && (
            <DrawerErrorBoundary label="signals">
              <DrawerSignals signals={signals} />
            </DrawerErrorBoundary>
          )}

          {/* Stage: ENABLE_ASSET_CHART */}
          {DRAWER_FLAGS.ENABLE_ASSET_CHART && (
            <DrawerErrorBoundary label="chart">
              <DrawerChart assetId={asset?.assetId ?? ""} tf={tf} setTf={setTf} />
            </DrawerErrorBoundary>
          )}

          {/* Stage: ENABLE_ASSET_TRADE_MODULE */}
          {DRAWER_FLAGS.ENABLE_ASSET_TRADE_MODULE && (
            <DrawerErrorBoundary label="trade-module">
              <DrawerTradeModule asset={asset} />
            </DrawerErrorBoundary>
          )}

          {/* Watchlist always visible */}
          <Button
            variant="ghost"
            className={`w-full text-xs ${asset?.watchlisted ? "text-amber-400" : "text-muted-foreground"}`}
            onClick={() => onToggleWatchlist(asset)}
            data-testid="button-drawer-watchlist"
          >
            <Star className={`w-3.5 h-3.5 mr-1.5 ${asset?.watchlisted ? "fill-amber-400 text-amber-400" : ""}`} />
            {asset?.watchlisted ? "Remove from Watchlist" : "Add to Watchlist"}
          </Button>

        </div>
      </div>
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-1">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-white/5">
          <Skeleton className="w-6 h-4" />
          <Skeleton className="w-32 h-4" />
          <Skeleton className="w-16 h-4" />
          <Skeleton className="w-20 h-4 ml-auto" />
          <Skeleton className="w-16 h-4" />
          <Skeleton className="w-16 h-4" />
        </div>
      ))}
    </div>
  );
}

const PAGE_SIZE = 25;

function toMarketRow(asset: UnifiedAsset): MarketRow {
  return {
    id: asset.internalId,
    assetUid: asset.assetId,
    displayName: asset.displayName,
    lastTradePrice: asset.price,
    price24hAgo: asset.price24hAgo ?? asset.price,
    volume24h: asset.volume24h ?? "0",
    momentum: asset.momentum ?? "0",
    bidPrice: asset.bidPrice ?? asset.price,
    askPrice: asset.askPrice ?? asset.price,
    spreadPct: asset.spreadPct ?? "0",
    market: {
      provider: asset.provider,
      game: asset.game,
      region: asset.region ?? "",
      scope: "global",
    },
  };
}

function AssetsPageInner() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const searchStr = useSearch();
  const [, navigate] = useLocation();
  const { dispatch: terminalDispatch } = useTerminal();

  const urlParams = new URLSearchParams(searchStr);
  const [search, setSearch] = useState(urlParams.get("q") ?? "");
  const [debouncedSearch, setDebouncedSearch] = useState(urlParams.get("q") ?? "");
  const [game, setGame] = useState(urlParams.get("game") ?? "dota2");
  const [sort, setSort] = useState(urlParams.get("sort") ?? "lastTradePrice");
  const [order, setOrder] = useState<"asc" | "desc">(
    urlParams.get("order") === "asc" ? "asc" : "desc"
  );
  const [page, setPage] = useState(Math.max(1, parseInt(urlParams.get("page") ?? "1", 10)));
  const [selectedAsset, setSelectedAsset] = useState<UnifiedAsset | null>(null);

  const openTradeModal = useCallback((asset: UnifiedAsset) => {
    terminalDispatch({ type: "SELECT_ASSET", asset: toMarketRow(asset) });
    terminalDispatch({ type: "OPEN_TRADE_MODAL" });
  }, [terminalDispatch]);
  const autoSelectedRef = useRef(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [search]);

  useEffect(() => { setPage(1); }, [sort, order, game]);

  useEffect(() => {
    const p = new URLSearchParams();
    if (debouncedSearch) p.set("q", debouncedSearch);
    if (page > 1) p.set("page", String(page));
    if (sort !== "lastTradePrice") p.set("sort", sort);
    if (order !== "desc") p.set("order", order);
    if (game !== "dota2") p.set("game", game);
    const uid = new URLSearchParams(searchStr).get("uid");
    if (uid) p.set("uid", uid);
    navigate(`/assets${p.toString() ? `?${p}` : ""}`, { replace: true });
  }, [debouncedSearch, page, sort, order, game]);

  const { data, isLoading, isError, refetch } = useQuery<AssetsResponse>({
    queryKey: ["/api/assets", debouncedSearch, game, sort, order, page],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(PAGE_SIZE),
        sort,
        order,
        game,
        ...(debouncedSearch && { search: debouncedSearch }),
      });
      return fetch(`/api/assets?${params}`).then(r => r.json());
    },
    staleTime: 15_000,
    placeholderData: (prev) => prev,
  });

  const uidParam = new URLSearchParams(searchStr).get("uid");

  const { data: uidResolvedData } = useQuery<AssetsResponse>({
    queryKey: ["/api/assets/resolve-uid", uidParam, game],
    queryFn: () =>
      fetch(`/api/assets?game=${game}&search=${encodeURIComponent(uidParam!)}&limit=5`)
        .then(r => r.json()),
    enabled: !!uidParam && !autoSelectedRef.current,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!uidParam || autoSelectedRef.current) return;
    const rows = [
      ...(uidResolvedData?.rows ?? []),
      ...(data?.rows ?? []),
    ];
    const match = rows.find((r) => r.assetId === uidParam);
    if (match) {
      autoSelectedRef.current = true;
      setSelectedAsset(match);
    }
  }, [uidParam, data, uidResolvedData]);

  const watchlistMutation = useMutation({
    mutationFn: ({ asset, add }: { asset: UnifiedAsset; add: boolean }) => {
      if (add) {
        return apiRequest("POST", "/api/assets/watchlist", { assetId: asset.internalId });
      } else {
        return apiRequest("DELETE", `/api/assets/watchlist/${asset.internalId}`);
      }
    },
    onSuccess: (_, { asset, add }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/assets"] });
      if (selectedAsset?.internalId === asset.internalId) {
        setSelectedAsset(prev => prev ? { ...prev, watchlisted: add } : null);
      }
      toast({ title: add ? "Added to watchlist" : "Removed from watchlist", duration: 2000 });
    },
    onError: () => toast({ title: "Watchlist update failed", variant: "destructive" }),
  });

  const handleToggleWatchlist = useCallback((asset: UnifiedAsset) => {
    watchlistMutation.mutate({ asset, add: !asset.watchlisted });
  }, [watchlistMutation]);

  const handleSortClick = (col: string) => {
    if (sort === col) setOrder(o => o === "desc" ? "asc" : "desc");
    else { setSort(col); setOrder("desc"); }
  };

  const SortIcon = ({ col }: { col: string }) => {
    if (sort !== col) return <ChevronDown className="w-3 h-3 opacity-20" />;
    return order === "desc" ? <ChevronDown className="w-3 h-3 text-primary" /> : <ChevronUp className="w-3 h-3 text-primary" />;
  };

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;

  return (
    <div className="flex gap-0">
      <div className="flex flex-col flex-1 min-w-0">
        <div className="mb-6">
          <h1 className="text-2xl font-display font-bold text-white tracking-tight" data-testid="assets-page-title">
            Player Market
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Browse and trade player cards.
          </p>
        </div>

        <div className="flex flex-col gap-3 mb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              className="pl-10 bg-white/5 border-white/10 text-white placeholder:text-muted-foreground"
              placeholder="Search players or tags..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              data-testid="input-assets-search"
            />
            {search && (
              <button
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-white"
                onClick={() => setSearch("")}
                data-testid="button-clear-search"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1 border border-white/10">
              {GAME_FILTERS.map(f => (
                <button
                  key={f.value}
                  onClick={() => { setGame(f.value); setPage(1); }}
                  className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
                    game === f.value
                      ? "bg-primary text-black shadow"
                      : "text-muted-foreground hover:text-white hover:bg-white/10"
                  }`}
                  data-testid={`filter-game-${f.value || "all"}`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-muted-foreground hidden sm:block">Sort:</span>
              <select
                value={sort}
                onChange={e => { setSort(e.target.value); setOrder("desc"); }}
                className="text-xs bg-white/5 border border-white/10 rounded-md px-2 py-1.5 text-white focus:outline-none"
                data-testid="select-sort"
              >
                {SORT_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <button
                onClick={() => setOrder(o => o === "desc" ? "asc" : "desc")}
                className="p-1.5 rounded-md bg-white/5 border border-white/10 text-muted-foreground hover:text-white transition-colors"
                data-testid="button-toggle-order"
              >
                {order === "desc" ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        </div>

        <div className="bg-white/[0.02] border border-white/10 rounded-xl overflow-hidden">
          {isError ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <AlertTriangle className="w-8 h-8 text-red-400" />
              <p className="text-muted-foreground">Failed to load assets</p>
              <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-retry">Retry</Button>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10 bg-white/[0.02]">
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider w-10">#</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Asset</th>
                      <th className="hidden md:table-cell text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Game</th>
                      <th
                        className="text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-white select-none"
                        onClick={() => handleSortClick("lastTradePrice")}
                      >
                        <span className="flex items-center justify-end gap-1">Price <SortIcon col="lastTradePrice" /></span>
                      </th>
                      <th
                        className="text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-white select-none"
                        onClick={() => handleSortClick("change24hPct")}
                      >
                        <span className="flex items-center justify-end gap-1">24h <SortIcon col="change24hPct" /></span>
                      </th>
                      <th
                        className="hidden lg:table-cell text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-white select-none"
                        onClick={() => handleSortClick("volume24h")}
                      >
                        <span className="flex items-center justify-end gap-1">Volume <SortIcon col="volume24h" /></span>
                      </th>
                      <th
                        className="hidden xl:table-cell text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-white select-none"
                        onClick={() => handleSortClick("momentum")}
                      >
                        <span className="flex items-center justify-end gap-1">Momentum <SortIcon col="momentum" /></span>
                      </th>
                      <th
                        className="hidden xl:table-cell text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-white select-none"
                        onClick={() => handleSortClick("marketCap")}
                      >
                        <span className="flex items-center justify-end gap-1">Mkt Cap <SortIcon col="marketCap" /></span>
                      </th>
                      <th
                        className="hidden lg:table-cell text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-white select-none"
                        onClick={() => handleSortClick("performanceScore")}
                      >
                        <span className="flex items-center justify-end gap-1">Perf Score <SortIcon col="performanceScore" /></span>
                      </th>
                      <th className="px-4 py-3 w-20"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoading ? (
                      <tr><td colSpan={10}><TableSkeleton /></td></tr>
                    ) : rows.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="py-20 text-center text-muted-foreground" data-testid="assets-empty-state">
                          No players match your current filters.
                        </td>
                      </tr>
                    ) : rows.map((row, idx) => {
                      const change = formatChange(row.change24hPct);
                      const mom = parseFloat(String(row.momentum)) || 0;
                      const rankNum = (page - 1) * PAGE_SIZE + idx + 1;

                      return (
                        <tr
                          key={row.internalId}
                          className="border-b border-white/5 cursor-pointer transition-colors group hover:bg-white/5"
                          onClick={() => {
                            try {
                              openTradeModal(row);
                            } catch (err) {
                              console.error("[RowClick] ERROR in click handler:", err);
                            }
                          }}
                          data-testid={`row-asset-${row.internalId}`}
                        >
                          <td className="px-4 py-3 text-xs text-muted-foreground font-mono">#{rankNum}</td>
                          <td className="px-4 py-3">
                            <div className="flex flex-col gap-0.5">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-medium text-white group-hover:text-primary transition-colors" data-testid={`text-asset-name-${row.internalId}`}>
                                  {row.displayName}
                                </span>
                                {row.tag && <span className="text-xs text-zinc-500">#{row.tag}</span>}
                              </div>
                              <div className="flex items-center gap-1 md:hidden">
                                <GameBadge game={row.game} />
                                {row.region && <RegionBadge region={row.region} />}
                              </div>
                            </div>
                          </td>
                          <td className="hidden md:table-cell px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              <GameBadge game={row.game} />
                              {row.region && <RegionBadge region={row.region} />}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-white" data-testid={`text-price-${row.internalId}`}>
                            {formatCurrency(parseFloat(row.price))}
                          </td>
                          <td className={`px-4 py-3 text-right font-mono text-sm ${change.color}`} data-testid={`text-change-${row.internalId}`}>
                            {change.text}
                          </td>
                          <td className="hidden lg:table-cell px-4 py-3 text-right text-sm text-muted-foreground font-mono">
                            ${formatVolume(row.volume24h)}
                          </td>
                          <td className="hidden xl:table-cell px-4 py-3 text-right font-mono text-sm">
                            <span className={mom > 0 ? "text-emerald-400" : mom < 0 ? "text-red-400" : "text-muted-foreground"}>
                              {mom > 0 ? "+" : ""}{mom.toFixed(1)}
                            </span>
                          </td>
                          <td className="hidden xl:table-cell px-4 py-3 text-right text-sm text-muted-foreground font-mono">
                            {row.marketCap ? `$${formatVolume(row.marketCap)}` : "—"}
                          </td>
                          <td className="hidden lg:table-cell px-4 py-3">
                            <div className="flex justify-end">
                              <PerfBar score={row.performanceScore} />
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1.5" onClick={e => e.stopPropagation()}>
                              <button
                                onClick={() => handleToggleWatchlist(row)}
                                className={`p-1.5 rounded-md transition-colors ${
                                  row.watchlisted
                                    ? "text-amber-400 hover:text-amber-300"
                                    : "text-muted-foreground hover:text-amber-400 opacity-0 group-hover:opacity-100"
                                }`}
                                data-testid={`button-watchlist-${row.internalId}`}
                                title={row.watchlisted ? "Remove from watchlist" : "Add to watchlist"}
                              >
                                <Star className={`w-4 h-4 ${row.watchlisted ? "fill-amber-400" : ""}`} />
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); openTradeModal(row); }}
                                className="text-xs px-2.5 py-1.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 font-medium transition-colors opacity-0 group-hover:opacity-100"
                                data-testid={`button-trade-${row.internalId}`}
                              >
                                Trade
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {total > 0 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-white/10 bg-white/[0.02]">
                  <span className="text-xs text-muted-foreground">
                    {total.toLocaleString()} players — page {page} of {totalPages}
                  </span>
                  {totalPages > 1 && (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={page <= 1}
                        onClick={() => setPage(p => p - 1)}
                        data-testid="button-prev-page"
                      >
                        Previous
                      </Button>
                      <span className="text-xs text-muted-foreground px-2">
                        {page} / {totalPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={page >= totalPages}
                        onClick={() => setPage(p => p + 1)}
                        data-testid="button-next-page"
                      >
                        Next
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

    </div>
  );
}

export default function AssetsPage() {
  return (
    <>
      <GlobalErrorMonitor />
      <AssetsPageErrorBoundary>
        <AssetsPageInner />
      </AssetsPageErrorBoundary>
    </>
  );
}

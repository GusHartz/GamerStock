import { useState, useEffect, useRef, useMemo } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { usePortfolio } from "@/hooks/use-portfolio";
import { useGsWallet } from "@/hooks/use-wallets";
import { formatCurrency, formatPercent } from "@/lib/format";
import { apiRequest } from "@/lib/queryClient";
import { ErrorBoundary } from "@/components/error-boundary";
import {
  useTerminal,
  type MarketRow,
  type ActivityTab,
} from "@/state/terminalStore";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip as ChartTooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  Activity,
  BarChart3,
  Zap,
  Search,
  ChevronUp,
  ChevronDown,
  Wifi,
  WifiOff,
  ShoppingCart,
  LayoutGrid,
  Clock,
  User,
  Layers,
  ChevronRight,
  Gauge,
  Brain,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCw,
  Telescope,
  Sparkles,
  Target,
  Star,
  Flame,
  Info,
} from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import type { ChartTab } from "@/state/terminalStore";
import { useToast } from "@/hooks/use-toast";
import {
  SyntheticContext, useSynthetic, synthToMarketRow, isSyntheticAsset, synthIdFromAsset,
  type SyntheticRow, type SyntheticTick, type DiscoverySignal, type SyntheticTerminalModel,
  type SyntheticCtxValue,
} from "@/state/syntheticContext";
import { PremiumDemoLayout } from "@/components/terminal/PremiumDemoLayout";
import { DiscoveryHeroSection } from "@/components/terminal/DiscoveryHeroSection";

// ─── Metric tooltips ────────────────────────────────────────────────────────

const METRIC_INFO = {
  winRate: "Percentage of recent matches won by the player. Higher win rate often indicates strong consistency in competitive matches.",
  pvi: "PVI (Player Value Index) is GamerStock's composite performance score. It combines match performance, consistency, role impact and momentum. Scale: 0 – 100+.",
  lp: "LP represents the player's competitive ladder points in the Riot ranking system. Higher LP generally indicates stronger competitive standing.",
  momentum: "Momentum measures recent performance trend. It reflects whether the player is improving, stable or declining based on recent matches.",
};

function MetricInfo({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center ml-0.5 opacity-40 hover:opacity-90 transition-opacity cursor-default select-none">
          <Info className="w-3 h-3" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[220px] text-[11px] leading-relaxed">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

// ─── Constants ──────────────────────────────────────────────────────────────

// Terminal shows only Dota2 assets (the only game with a live market pipeline).
// LoL support is preserved in the backend but excluded from the Terminal UI.
const MARKET_PARAMS = {
  limit: "50",
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function extractPuuid(assetUid: string | undefined | null): string {
  if (!assetUid) return "";
  return assetUid.split(":").slice(3).join(":");
}

function getAssetGame(assetUid: string | undefined | null): string {
  if (!assetUid) return "unknown";
  const parts = assetUid.split(":");
  return parts[1] ?? "unknown";
}

function getAssetGameLabel(assetUid: string | undefined | null): string {
  const game = getAssetGame(assetUid);
  const labels: Record<string, string> = {
    lol: "LoL",
    dota2: "Dota 2",
    cs2: "CS2",
    valorant: "Valorant",
  };
  return labels[game] ?? game.toUpperCase();
}

function pct24h(row: MarketRow): number {
  const last = parseFloat(row.lastTradePrice);
  const ago = parseFloat(row.price24hAgo);
  if (!ago || ago === 0) return 0;
  return ((last - ago) / ago) * 100;
}

function fmtTime(iso: string | undefined | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}

function PctBadge({ value }: { value: number }) {
  const pos = value >= 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-semibold ${pos ? "text-emerald-400" : "text-rose-400"}`}
    >
      {pos ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      {Math.abs(value).toFixed(2)}%
    </span>
  );
}

function PanelHeader({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-3 py-2 border-b border-white/5 bg-card/50 shrink-0">
      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{children}</span>
      {action}
    </div>
  );
}

function TabBar({ tabs, active, onSelect }: {
  tabs: { id: string; label: string }[];
  active: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-white/5 bg-card/30 shrink-0">
      {tabs.map((t) => (
        <button
          key={t.id}
          data-testid={`tab-${t.id}`}
          onClick={() => onSelect(t.id)}
          className={`px-2.5 py-1 rounded text-xs font-medium transition-all duration-150 active:scale-[0.95] ${
            active === t.id
              ? "bg-primary/15 text-primary shadow-[inset_0_-1px_0_0_hsl(var(--primary)/0.4)]"
              : "text-muted-foreground hover:text-foreground/80 hover:bg-white/[0.06] active:bg-white/10"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ─── SSE Terminal Stream Hook ─────────────────────────────────────────────────

type SseEvent = {
  type: "PRICE_UPDATE" | "TRADE_TICK" | "HEARTBEAT" | "SNAPSHOT" | "ORDER_TRIGGERED" | "ORDER_EXECUTED" | "ORDER_FAILED" | "ORDER_CANCELLED";
  data: Record<string, any>;
};

function useTerminalSse(onEvent: (event: SseEvent) => void) {
  const [sseConnected, setSseConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    let destroyed = false;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let retries = 0;

    function connect() {
      if (destroyed) return;
      const es = new EventSource("/api/terminal/stream", { withCredentials: true });
      esRef.current = es;

      const makeHandler = (type: SseEvent["type"]) => (e: MessageEvent) => {
        try {
          onEventRef.current({ type, data: JSON.parse(e.data) });
        } catch { /* ignore */ }
      };

      es.addEventListener("PRICE_UPDATE", makeHandler("PRICE_UPDATE"));
      es.addEventListener("TRADE_TICK", makeHandler("TRADE_TICK"));
      es.addEventListener("HEARTBEAT", () => { setSseConnected(true); retries = 0; });
      es.addEventListener("SNAPSHOT", makeHandler("SNAPSHOT"));
      es.addEventListener("ORDER_TRIGGERED", makeHandler("ORDER_TRIGGERED"));
      es.addEventListener("ORDER_EXECUTED", makeHandler("ORDER_EXECUTED"));
      es.addEventListener("ORDER_FAILED", makeHandler("ORDER_FAILED"));
      es.addEventListener("ORDER_CANCELLED", makeHandler("ORDER_CANCELLED"));

      es.onopen = () => { setSseConnected(true); retries = 0; };
      es.onerror = () => {
        es.close();
        esRef.current = null;
        setSseConnected(false);
        if (!destroyed && retries < 10) {
          retries++;
          retryTimeout = setTimeout(connect, Math.min(30000, 2000 * retries));
        }
      };
    }

    connect();

    return () => {
      destroyed = true;
      if (retryTimeout) clearTimeout(retryTimeout);
      esRef.current?.close();
    };
  }, []);

  return sseConnected;
}

// ─── WebSocket hook ──────────────────────────────────────────────────────────

function useMarketWs(onAssetUpdate: (data: any) => void) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const retriesRef = useRef(0);

  useEffect(() => {
    let destroyed = false;
    function connect() {
      if (destroyed) return;
      const url = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws/market";
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onopen = () => {
        retriesRef.current = 0;
        setConnected(true);
        ws.send(JSON.stringify({ type: "subscribe", channel: "ticker" }));
        ws.send(JSON.stringify({ type: "subscribe", channel: "trades" }));
      };
      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type === "asset.updated" && msg.data) onAssetUpdate(msg.data);
        } catch { /* ignore */ }
      };
      ws.onclose = () => {
        wsRef.current = null;
        setConnected(false);
        if (!destroyed && retriesRef.current < 5) {
          retriesRef.current++;
          setTimeout(connect, 2000 * retriesRef.current);
        }
      };
      ws.onerror = () => ws.close();
    }
    connect();
    return () => {
      destroyed = true;
      wsRef.current?.close();
    };
  }, []);

  return connected;
}

// ─── MarketScanner ───────────────────────────────────────────────────────────

type MarketResponse = { updatedAt: string; page: number; total: number; totalPages: number; rows: MarketRow[] };

// ─── Market Intel row helpers ─────────────────────────────────────────────────

function scannerInitials(name: string): string {
  const parts = name.split(/(?=[A-Z])/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

const SCANNER_ROLE: Record<string, { label: string; cls: string; avatarCls: string }> = {
  TOP:     { label: "TOP", cls: "bg-orange-500/10 text-orange-400 border-orange-500/15", avatarCls: "bg-orange-500/15 text-orange-200 border-orange-400/20" },
  JGL:     { label: "JGL", cls: "bg-green-500/10 text-green-400 border-green-500/15",   avatarCls: "bg-green-500/15 text-green-200 border-green-400/20" },
  JUNGLE:  { label: "JGL", cls: "bg-green-500/10 text-green-400 border-green-500/15",   avatarCls: "bg-green-500/15 text-green-200 border-green-400/20" },
  MID:     { label: "MID", cls: "bg-blue-500/10 text-blue-400 border-blue-500/15",      avatarCls: "bg-blue-500/15 text-blue-200 border-blue-400/20" },
  ADC:     { label: "ADC", cls: "bg-rose-500/10 text-rose-400 border-rose-500/15",      avatarCls: "bg-rose-500/15 text-rose-200 border-rose-400/20" },
  SUPPORT: { label: "SUP", cls: "bg-purple-500/10 text-purple-400 border-purple-500/15", avatarCls: "bg-purple-500/15 text-purple-200 border-purple-400/20" },
};

type ScannerSignal = { label: string; cls: string };

function computeScannerSignal(row: MarketRow, sr: SyntheticRow | undefined, change: number): ScannerSignal | null {
  if (sr) {
    const mom = parseFloat(sr.momentum);
    if (sr.change24h > 15 && mom > 0.005)               return { label: "BREAKOUT",   cls: "bg-amber-500/15 text-amber-300 border border-amber-500/20" };
    if (sr.signal === "STRONG_BUY" && sr.divergencePct < -35) return { label: "VALUE",   cls: "bg-sky-500/15 text-sky-300 border border-sky-500/20" };
    if (sr.signal === "STRONG_BUY")                      return { label: "STRONG BUY", cls: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/20" };
    if (sr.signal === "BUY" && mom > 0.007)              return { label: "MOMENTUM",   cls: "bg-violet-500/15 text-violet-300 border border-violet-500/20" };
    if (sr.signal === "BUY")                             return { label: "BUY",        cls: "bg-primary/15 text-primary border border-primary/20" };
    return null;
  }
  const mom = parseFloat(row.momentum ?? "0");
  if (change > 12 && mom > 0.004) return { label: "BREAKOUT",  cls: "bg-amber-500/15 text-amber-300 border border-amber-500/20" };
  if (change > 4  && mom > 0)     return { label: "MOMENTUM",  cls: "bg-violet-500/15 text-violet-300 border border-violet-500/20" };
  if (change > 0  && mom > 0)     return { label: "BUY",       cls: "bg-primary/15 text-primary border border-primary/20" };
  return null;
}

const SCANNER_TAB_CONTEXT: Record<string, { sub: string }> = {
  all:       { sub: "All players by market activity" },
  gainers:   { sub: "Strongest upward movement today" },
  losers:    { sub: "Largest declines — potential entries" },
  trending:  { sub: "Highest volume in the session" },
  watchlist: { sub: "Your starred players" },
};

function MarketScanner() {
  const { state, dispatch } = useTerminal();
  const qc = useQueryClient();
  const [sort, setSort] = useState("volume24h");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [flashMap, setFlashMap] = useState<Record<number, "up" | "down">>({});

  const { data: watchlistAssets } = useQuery<{ internalId: number }[]>({
    queryKey: ["/api/assets/watchlist"],
    queryFn: async () => {
      const res = await fetch("/api/assets/watchlist", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 30000,
  });
  const watchlistIds = useMemo(
    () => new Set((watchlistAssets ?? []).map((a) => a.internalId)),
    [watchlistAssets]
  );

  useEffect(() => {
    setPage(1);
  }, [state.gameFilter]);

  const { data, isLoading } = useQuery<MarketResponse>({
    queryKey: ["/api/market/assets", page, state.search.length > 1 ? state.search : "", sort, order, state.gameFilter],
    queryFn: async () => {
      const p = new URLSearchParams({ ...MARKET_PARAMS, page: String(page), sort, order });
      if (state.search.length > 1) p.set("search", state.search);
      p.set("game", state.gameFilter === "all" ? "dota2" : state.gameFilter);
      const res = await fetch(`/api/market/assets?${p}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load market");
      return res.json();
    },
    refetchInterval: 5000,
    staleTime: 0,
  });

  const handleSseEvent = (event: SseEvent) => {
    if (event.type === "PRICE_UPDATE") {
      const { assetId, price, change } = event.data;
      if (!assetId) return;

      const direction: "up" | "down" = change >= 0 ? "up" : "down";
      setFlashMap((prev) => ({ ...prev, [assetId]: direction }));
      setTimeout(() => setFlashMap((prev) => {
        const n = { ...prev };
        delete n[assetId];
        return n;
      }), 800);

      qc.setQueriesData<MarketResponse>(
        { queryKey: ["/api/market/assets"], exact: false },
        (old) => {
          if (!old?.rows) return old;
          return {
            ...old,
            rows: old.rows.map((r) =>
              r.id === assetId ? { ...r, lastTradePrice: price } : r
            ),
          };
        }
      );

      if (state.selectedAsset?.id === assetId) {
        dispatch({ type: "PATCH_ASSET", assetId, data: { lastTradePrice: price } });
      }
    }
  };

  const sseConnected = useTerminalSse(handleSseEvent);

  const wsConnected = useMarketWs((wsData) => {
    qc.setQueriesData<MarketResponse>(
      { queryKey: ["/api/market/assets"], exact: false },
      (old) => {
        if (!old?.rows) return old;
        const { assetId, lastTradePrice, volume24h, momentum, bidPrice, askPrice, spreadPct } = wsData;
        return {
          ...old,
          rows: old.rows.map((r) =>
            r.id === assetId
              ? { ...r, lastTradePrice, volume24h, momentum, ...(bidPrice !== undefined && { bidPrice, askPrice, spreadPct }) }
              : r
          ),
        };
      }
    );
    if (state.selectedAsset?.id === wsData.assetId) {
      dispatch({
        type: "PATCH_ASSET",
        assetId: wsData.assetId,
        data: {
          lastTradePrice: wsData.lastTradePrice,
          volume24h: wsData.volume24h,
          momentum: wsData.momentum,
          ...(wsData.bidPrice !== undefined && { bidPrice: wsData.bidPrice, askPrice: wsData.askPrice, spreadPct: wsData.spreadPct }),
        },
      });
    }
  });

  const realRows = data?.rows ?? [];
  const { model: synthModel, isSyntheticMode, setSelectedSynth } = useSynthetic();

  const syntheticRowsAsMarket: MarketRow[] = useMemo(() => {
    if (!isSyntheticMode || !synthModel) return [];
    return synthModel.rows.map((r) => synthToMarketRow(r));
  }, [isSyntheticMode, synthModel]);

  const rows = isSyntheticMode ? syntheticRowsAsMarket : realRows;

  const synthLookup = useMemo(() => {
    if (!synthModel) return new Map<number, SyntheticRow>();
    return new Map(
      synthModel.rows.map((r) => [-parseInt(r.id.replace("syn-", ""), 10), r])
    );
  }, [synthModel]);

  useEffect(() => {
    if (!state.selectedAsset && rows.length > 0) {
      dispatch({ type: "SELECT_ASSET", asset: rows[0] });
      if (isSyntheticMode && synthModel) {
        setSelectedSynth(synthModel.rows[0]);
      }
    }
  }, [rows, state.selectedAsset]);

  const filteredRows = useMemo(() => {
    if (state.scannerTab === "gainers") {
      return [...rows].sort((a, b) => pct24h(b) - pct24h(a)).slice(0, 20);
    }
    if (state.scannerTab === "losers") {
      return [...rows].sort((a, b) => pct24h(a) - pct24h(b)).slice(0, 20);
    }
    if (state.scannerTab === "trending") {
      return [...rows].sort((a, b) => parseFloat(b.volume24h) - parseFloat(a.volume24h)).slice(0, 20);
    }
    if (state.scannerTab === "watchlist") {
      return rows.filter((r) => watchlistIds.has(r.id));
    }
    return rows;
  }, [rows, state.scannerTab, watchlistIds]);

  const handleSort = (field: string) => {
    if (sort === field) setOrder((o) => (o === "asc" ? "desc" : "asc"));
    else { setSort(field); setOrder("desc"); }
    setPage(1);
  };

  const scannerTabs = [
    { id: "all",       label: "All" },
    { id: "gainers",   label: "Gainers" },
    { id: "losers",    label: "Losers" },
    { id: "trending",  label: "Hot" },
    { id: "watchlist", label: "⭐ Watchlist" },
  ];

  const tabCtx = SCANNER_TAB_CONTEXT[state.scannerTab] ?? SCANNER_TAB_CONTEXT.all;

  return (
    <div className="flex flex-col h-full bg-card border-r border-white/5 overflow-hidden">
      <PanelHeader action={
        <div className="flex items-center gap-2">
          <span
            className={`flex items-center gap-1 text-xs ${sseConnected ? "text-emerald-400" : "text-amber-400"}`}
            title={sseConnected ? "AMM stream connected" : "AMM stream connecting..."}
          >
            <Zap className="w-3 h-3" />
            {sseConnected ? "AMM" : "…"}
          </span>
          <span className={`flex items-center gap-1 text-xs ${wsConnected ? "text-emerald-400" : "text-rose-400"}`}>
            {wsConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {wsConnected ? "LIVE" : "OFF"}
          </span>
        </div>
      }>
        Market Intel
      </PanelHeader>

      <TabBar
        tabs={scannerTabs}
        active={state.scannerTab}
        onSelect={(id) => dispatch({ type: "SET_SCANNER_TAB", tab: id as any })}
      />

      {/* Tab context subtitle */}
      <div className="px-3 py-1.5 border-b border-white/[0.04] bg-black/5 shrink-0">
        <p className="text-[10px] text-muted-foreground/45 leading-none">{tabCtx.sub}</p>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-[1fr_auto] px-3 py-1.5 border-b border-white/[0.06] bg-black/10 shrink-0">
        <button
          className="text-left text-[10px] text-muted-foreground/50 hover:text-muted-foreground font-semibold tracking-wider uppercase transition-colors"
          onClick={() => handleSort("gameName")}
        >
          Player{sort === "gameName" ? (order === "asc" ? " ↑" : " ↓") : ""}
        </button>
        <div className="flex items-center gap-3">
          <button
            className="text-right text-[10px] text-muted-foreground/50 hover:text-muted-foreground font-semibold tracking-wider uppercase transition-colors w-14"
            onClick={() => handleSort("lastTradePrice")}
          >
            Price{sort === "lastTradePrice" ? (order === "asc" ? " ↑" : " ↓") : ""}
          </button>
          <button
            className="text-right text-[10px] text-muted-foreground/50 hover:text-muted-foreground font-semibold tracking-wider uppercase transition-colors w-10"
            onClick={() => handleSort("volume24h")}
          >
            24h
          </button>
        </div>
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-px p-2">
            {[...Array(12)].map((_, i) => (
              <div key={i} className="h-11 bg-white/5 rounded animate-pulse" />
            ))}
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
            <Activity className="w-5 h-5 opacity-30" />
            <span className="text-xs opacity-50">No results</span>
          </div>
        ) : (
          filteredRows.map((row, index) => {
            const change = pct24h(row);
            const isSelected = state.selectedAsset?.id === row.id;
            const flash = flashMap[row.id];
            const sr = synthLookup.get(row.id);
            const role = sr?.role;
            const roleMeta = role ? SCANNER_ROLE[role] : undefined;
            const signal = computeScannerSignal(row, sr, change);
            const inits = scannerInitials(row.displayName);
            const avatarCls = roleMeta
              ? `${roleMeta.avatarCls} border`
              : isSelected
                ? "bg-primary/15 text-primary border border-primary/25"
                : "bg-white/[0.05] text-muted-foreground border border-white/[0.08]";

            return (
              <button
                key={row.id}
                data-testid={`scanner-row-${row.id}`}
                onClick={() => {
                  dispatch({ type: "SELECT_ASSET", asset: row });
                  dispatch({ type: "SET_MOBILE_TAB", tab: "chart" });
                  if (isSyntheticMode && synthModel) {
                    const sid = synthIdFromAsset(row);
                    const sr2 = synthModel.rows.find((r) => r.id === sid) ?? null;
                    setSelectedSynth(sr2);
                  }
                }}
                className={[
                  "w-full flex items-center gap-2 px-2 py-2 text-left",
                  "border-b border-white/[0.04] border-l-2",
                  "transition-all duration-150 active:scale-[0.995] active:brightness-95",
                  isSelected
                    ? "bg-primary/[0.07] border-l-primary hover:bg-primary/[0.10]"
                    : "border-l-transparent hover:bg-white/[0.04] hover:border-l-white/20",
                  flash === "up"   ? "!bg-emerald-500/[0.08]" : "",
                  flash === "down" ? "!bg-rose-500/[0.08]"    : "",
                ].join(" ")}
              >
                {/* Rank */}
                <span className="text-[10px] font-mono text-muted-foreground/30 w-4 text-right shrink-0 tabular-nums">
                  {index + 1}
                </span>

                {/* Avatar */}
                <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold transition-colors ${avatarCls}`}>
                  {inits}
                </div>

                {/* Name + metadata row */}
                <div className="min-w-0 flex-1">
                  <div className={`text-[11px] font-semibold truncate leading-tight transition-colors ${isSelected ? "text-primary" : "text-foreground"}`}>
                    {row.displayName}
                  </div>
                  <div className="flex items-center gap-1 mt-0.5">
                    {roleMeta && (
                      <span className={`inline-flex items-center px-1 py-px rounded text-[8px] font-bold border ${roleMeta.cls}`}>
                        {roleMeta.label}
                      </span>
                    )}
                    {signal && (
                      <span className={`inline-flex items-center px-1 py-px rounded text-[8px] font-bold ${signal.cls}`}>
                        {signal.label}
                      </span>
                    )}
                  </div>
                </div>

                {/* Price + change */}
                <div className="text-right shrink-0">
                  <div className={`text-xs font-mono font-semibold tabular-nums transition-colors duration-300 ${
                    flash === "up" ? "text-emerald-300" : flash === "down" ? "text-rose-300" : "text-foreground"
                  }`}>
                    {formatCurrency(parseFloat(row.lastTradePrice))}
                  </div>
                  <div className="mt-0.5">
                    <PctBadge value={change} />
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between px-3 py-1.5 border-t border-white/5 shrink-0">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-30 transition-opacity"
          >
            Prev
          </button>
          <span className="text-[10px] text-muted-foreground/50">{page} / {data.totalPages}</span>
          <button
            onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
            disabled={page === data.totalPages}
            className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-30 transition-opacity"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

// ─── PlayerHeroCard ──────────────────────────────────────────────────────────

function PlayerDetailCard() {
  const { state } = useTerminal();
  const asset = state.selectedAsset;
  const isSynth = isSyntheticAsset(asset);

  const { data: fundamentals, isLoading: fundLoading } = useQuery<FundamentalsData>({
    queryKey: ["/api/market/assets", asset?.id, "fundamentals"],
    queryFn: async () => {
      const res = await fetch(`/api/market/assets/${asset!.id}/fundamentals`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!asset?.id && !isSynth,
    staleTime: 60000,
    refetchInterval: 120000,
  });

  const { data: perfData } = useQuery<CanonicalPerf>({
    queryKey: ["/api/market/assets", asset?.id, "performance"],
    queryFn: async () => {
      const res = await fetch(`/api/market/assets/${asset!.id}/performance`, { credentials: "include" });
      if (!res.ok) return null as any;
      return res.json();
    },
    enabled: !!asset?.id && !isSynth,
    staleTime: 60000,
    refetchInterval: 120000,
  });

  if (!asset) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-8 border-b border-white/5" style={{ minHeight: "220px" }}>
        <div className="w-14 h-14 rounded-xl border-2 border-dashed border-white/10 flex items-center justify-center">
          <User className="w-6 h-6 text-muted-foreground/20" />
        </div>
        <p className="text-[10px] text-muted-foreground/30 uppercase tracking-widest">Select a player</p>
      </div>
    );
  }

  const price = parseFloat(asset.lastTradePrice);
  const price24h = parseFloat((asset as any).price24hAgo ?? "0");
  const changePct = price24h > 0 ? ((price - price24h) / price24h) * 100 : 0;
  const isUp = changePct >= 0;
  const portraitUrl = (asset as any).portraitImageUrl;
  const avatarUrl = (asset as any).avatarImageUrl;
  const displayShortName = asset.displayName.split("#")[0];
  const initial = displayShortName.charAt(0).toUpperCase();
  const role = perfData?.role ?? null;

  const fv = fundamentals?.fairValueGS ?? null;
  const fvDiff = fv && price > 0 ? ((price - fv) / fv) * 100 : null;
  const isOvervalued = fvDiff != null && fvDiff > 0;

  const momentumRaw = fundamentals?.momentum != null
    ? fundamentals.momentum
    : parseFloat(String(asset.momentum ?? "0"));
  const momentumLabel = momentumRaw > 0 ? "Bullish" : momentumRaw < 0 ? "Bearish" : "Neutral";
  const momentumColor = momentumRaw > 0 ? "text-emerald-400" : momentumRaw < 0 ? "text-rose-400" : "text-amber-400";

  let signalLabel: string | null = null;
  let signalColor = "text-emerald-400";
  let signalBg = "bg-emerald-500/20 border-emerald-500/30";
  if (fvDiff != null) {
    if (fvDiff < -20) { signalLabel = "STRONG BUY"; signalColor = "text-emerald-400"; signalBg = "bg-emerald-500/20 border-emerald-500/30"; }
    else if (fvDiff < -8) { signalLabel = "BUY"; signalColor = "text-emerald-400"; signalBg = "bg-emerald-500/15 border-emerald-500/25"; }
    else if (fvDiff > 20) { signalLabel = "STRONG SELL"; signalColor = "text-rose-400"; signalBg = "bg-rose-500/20 border-rose-500/30"; }
    else if (fvDiff > 8) { signalLabel = "SELL"; signalColor = "text-rose-400"; signalBg = "bg-rose-500/15 border-rose-500/25"; }
    else { signalLabel = "HOLD"; signalColor = "text-amber-400"; signalBg = "bg-amber-500/10 border-amber-500/20"; }
  }

  return (
    <div>
      {/* ── Identity ── */}
      <div className="p-3 flex gap-3 items-start border-b border-white/5">
        <div className="w-[68px] h-[68px] rounded-xl overflow-hidden shrink-0 border border-white/10">
          {(portraitUrl || avatarUrl) ? (
            <img src={portraitUrl || avatarUrl} className="w-full h-full object-cover object-top" alt={displayShortName} />
          ) : (
            <div className={`w-full h-full flex items-center justify-center ${isUp ? "bg-gradient-to-br from-emerald-800/70 to-emerald-950" : "bg-gradient-to-br from-rose-800/70 to-rose-950"}`}>
              <span className="text-3xl font-black text-white/80">{initial}</span>
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0 pt-0.5">
          <div className="text-base font-black text-foreground uppercase tracking-tight leading-none mb-1.5">{displayShortName}</div>
          <div className="flex flex-wrap gap-1 mb-1.5">
            {role && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-primary/15 border border-primary/25 text-primary uppercase tracking-wide">{role}</span>
            )}
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-white/[0.06] border border-white/10 text-muted-foreground/60 uppercase tracking-wide">SPLITPUSHER</span>
          </div>
          <div className="text-[10px] text-muted-foreground/40 font-mono truncate">{asset.displayName}</div>
        </div>
      </div>

      {/* ── Market Price ── */}
      <div className="px-3 py-2.5 border-b border-white/5">
        <div className="text-[10px] text-muted-foreground/40 uppercase tracking-widest mb-1">Market Price</div>
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-baseline gap-1.5">
              <div className="text-[28px] font-black font-mono text-foreground tracking-tight leading-none">{formatCurrency(price)}</div>
              <span className="text-[10px] font-bold text-muted-foreground/40 uppercase tracking-wider">GS$</span>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-xs font-semibold flex items-center gap-1 ${isUp ? "text-emerald-400" : "text-rose-400"}`}>
                {isUp ? "▲" : "▼"} {Math.abs(changePct).toFixed(2)}% 24h
              </span>
              <span className="text-[9px] text-muted-foreground/25 font-mono">USDC pricing soon</span>
            </div>
          </div>
          {signalLabel && (
            <span className={`mt-1 text-[10px] font-black px-2 py-1 rounded border tracking-wider shrink-0 ${signalBg} ${signalColor}`}>
              {signalLabel}
            </span>
          )}
        </div>
      </div>

      {/* ── Fair Value vs Market Price ── */}
      {fv != null && fvDiff != null && (
        <div className="px-3 py-2.5 border-b border-white/5">
          <div className="text-[10px] text-muted-foreground/40 uppercase tracking-widest mb-2">Fair Value vs Market Price</div>
          <div className={`rounded-lg border p-2.5 ${isOvervalued ? "bg-rose-500/[0.04] border-rose-500/15" : "bg-emerald-500/[0.04] border-emerald-500/15"}`}>
            <div className="flex items-end justify-between gap-2 mb-2.5">
              <div>
                <div className="text-[10px] text-muted-foreground/50 mb-0.5">Fair Value</div>
                <div className="flex items-baseline gap-1">
                  <div className="text-base font-mono font-bold text-foreground">{formatCurrency(fv)}</div>
                  <span className="text-[9px] text-muted-foreground/35 font-mono">GS$</span>
                </div>
              </div>
              <div className={`text-xs font-bold px-2 py-1 rounded ${isOvervalued ? "bg-rose-500/15 text-rose-400" : "bg-emerald-500/15 text-emerald-400"}`}>
                {isOvervalued ? "▲" : "▼"} {Math.abs(fvDiff).toFixed(1)}%
              </div>
              <div className="text-right">
                <div className="text-[10px] text-muted-foreground/50 mb-0.5">Market</div>
                <div className="flex items-baseline gap-1 justify-end">
                  <div className="text-base font-mono font-bold text-foreground">{formatCurrency(price)}</div>
                  <span className="text-[9px] text-muted-foreground/35 font-mono">GS$</span>
                </div>
              </div>
            </div>
            <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden mb-1.5">
              <div
                className={`h-full rounded-full transition-all ${isOvervalued ? "bg-rose-500/60" : "bg-emerald-500/60"}`}
                style={{ width: `${Math.max(5, Math.min(95, isOvervalued ? 50 + Math.min(45, Math.abs(fvDiff)) : 50 - Math.min(45, Math.abs(fvDiff)))).toFixed(0)}%` }}
              />
            </div>
            <div className={`text-center text-[10px] font-semibold ${isOvervalued ? "text-rose-400/70" : "text-emerald-400/70"}`}>
              {isOvervalued ? "Trading above fair value" : "Trading below fair value"}
            </div>
          </div>
        </div>
      )}

      {/* ── Performance Metrics ── */}
      <div className="px-3 py-2.5 border-b border-white/5">
        <div className="text-[10px] text-muted-foreground/40 uppercase tracking-widest mb-2">Performance Metrics</div>
        {fundLoading ? (
          <div className="grid grid-cols-2 gap-2">
            {[...Array(4)].map((_, i) => <div key={i} className="h-[58px] bg-white/[0.04] rounded-lg animate-pulse" />)}
          </div>
        ) : fundamentals ? (
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-white/[0.03] border border-white/[0.07] p-2.5">
              <div className="text-[9px] text-muted-foreground/40 uppercase tracking-widest mb-1 flex items-center">Win Rate <MetricInfo text={METRIC_INFO.winRate} /></div>
              <div className={`text-lg font-mono font-black leading-none ${(fundamentals.winRate ?? 0) >= 55 ? "text-emerald-400" : (fundamentals.winRate ?? 0) < 50 ? "text-rose-400" : "text-foreground"}`}>
                {fundamentals.winRate != null ? `${fundamentals.winRate.toFixed(1)}%` : "—"}
              </div>
            </div>
            <div className="rounded-lg bg-white/[0.03] border border-white/[0.07] p-2.5">
              <div className="text-[9px] text-muted-foreground/40 uppercase tracking-widest mb-1 flex items-center">Perf Score <MetricInfo text={METRIC_INFO.pvi} /></div>
              <div className={`text-lg font-mono font-black leading-none ${(fundamentals.pviFinal ?? 50) >= 60 ? "text-emerald-400" : (fundamentals.pviFinal ?? 50) < 40 ? "text-rose-400" : "text-foreground"}`}>
                {fundamentals.pviFinal?.toFixed(1) ?? "—"}<span className="text-[10px] text-muted-foreground/40 font-normal">/100</span>
              </div>
            </div>
            {fundamentals.leaguePoints != null ? (
              <div className="rounded-lg bg-white/[0.03] border border-white/[0.07] p-2.5">
                <div className="text-[9px] text-muted-foreground/40 uppercase tracking-widest mb-1 flex items-center">LP <MetricInfo text={METRIC_INFO.lp} /></div>
                <div className="text-lg font-mono font-black leading-none text-primary">
                  {fundamentals.leaguePoints.toLocaleString()}
                </div>
              </div>
            ) : fundamentals.games != null ? (
              <div className="rounded-lg bg-white/[0.03] border border-white/[0.07] p-2.5">
                <div className="text-[9px] text-muted-foreground/40 uppercase tracking-widest mb-1">Matches</div>
                <div className="text-lg font-mono font-black leading-none text-primary">
                  {fundamentals.games}
                </div>
              </div>
            ) : null}
            <div className="rounded-lg bg-white/[0.03] border border-white/[0.07] p-2.5">
              <div className="text-[9px] text-muted-foreground/40 uppercase tracking-widest mb-1 flex items-center">Momentum <MetricInfo text={METRIC_INFO.momentum} /></div>
              <div className={`text-lg font-mono font-black leading-none ${momentumColor}`}>
                {momentumLabel}
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {[...Array(4)].map((_, i) => <div key={i} className="h-[58px] bg-white/[0.04] rounded-lg" />)}
          </div>
        )}
      </div>

      {/* ── Player Profile ── */}
      <div className="px-3 py-2.5 border-b border-white/5">
        <div className="text-[10px] text-muted-foreground/40 uppercase tracking-widest mb-1.5">Player Profile</div>
        <p className="text-xs text-muted-foreground/60 leading-relaxed mb-2">
          Professional esports player.{fundamentals && (fundamentals.winRate ?? 0) >= 55 ? " Maintains an elite win rate above 55%." : ""}
        </p>
        <div className="flex flex-wrap gap-1">
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.05] border border-white/[0.09] text-muted-foreground/50">{getAssetGameLabel(asset.assetUid)}</span>
          {role && <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 border border-primary/20 text-primary/60">{role}</span>}
          {fundamentals && (fundamentals.winRate ?? 0) >= 55 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400/70">High Win Rate</span>
          )}
          {(fundamentals?.pviFinal ?? 0) >= 60 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400/70">High Perf</span>
          )}
          {isUp && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400/70">Trending Up</span>}
        </div>
      </div>
    </div>
  );
}

// ─── QuickBuyPanel ───────────────────────────────────────────────────────────

function QuickBuyPanel() {
  const { state } = useTerminal();
  const asset = state.selectedAsset;
  const { availableBalance: gsBalance, isLoading: walletLoading } = useGsWallet();

  if (!asset) {
    return (
      <div className="px-4 py-3 border-b border-white/5 bg-card/20 flex items-center justify-center" style={{ minHeight: "88px" }}>
        <span className="text-[10px] text-muted-foreground/30">—</span>
      </div>
    );
  }

  const execPrice = parseFloat(asset.askPrice ?? asset.lastTradePrice);
  const estimatedCost = execPrice * 1.02;
  const balance = gsBalance ?? 0;
  const canAfford = gsBalance !== null && balance >= estimatedCost;

  return (
    <div className="px-3 py-3 border-b border-white/5 bg-card/20">
      <div className="flex items-start justify-between mb-2.5 gap-2">
        <div>
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground/50 mb-0.5">Estimated Cost</div>
          <div className="text-sm font-bold font-mono text-foreground">{formatCurrency(estimatedCost)}</div>
          <div className="text-[10px] text-muted-foreground/35">1 share + fee</div>
        </div>
        <div className="text-right">
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground/50 mb-0.5">Buying Power</div>
          <div className="text-sm font-bold font-mono text-foreground" data-testid="quickbuy-buying-power">
            {walletLoading || gsBalance === null ? <span className="animate-pulse opacity-50">…</span> : formatCurrency(balance)}
          </div>
          <div className={`text-[10px] ${canAfford ? "text-emerald-400/60" : "text-rose-400/60"}`}>
            {canAfford ? "✓ Sufficient" : "✗ Insufficient"}
          </div>
        </div>
      </div>
      <button
        data-testid="quick-buy-1share"
        disabled={!canAfford}
        className={`w-full py-2 rounded-lg text-sm font-bold transition-all active:scale-[0.99] ${canAfford ? "bg-emerald-500 hover:bg-emerald-400 text-black" : "bg-white/[0.06] text-muted-foreground/40 cursor-not-allowed"}`}
      >
        BUY 1 share
      </button>
    </div>
  );
}

// ─── PlayerMarketGrid ────────────────────────────────────────────────────────

function PlayerMarketGrid() {
  const { state, dispatch } = useTerminal();
  const gf = state.gameFilter;

  const { data: trending } = useQuery<MarketResponse>({
    queryKey: ["/api/market/assets/grid/trending", gf],
    queryFn: async () => {
      const p = new URLSearchParams({ ...MARKET_PARAMS, limit: "8", sort: "volume24h", order: "desc" });
      p.set("game", gf === "all" ? "dota2" : gf);
      const res = await fetch(`/api/market/assets?${p}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 20000,
    refetchInterval: 30000,
  });

  const { data: popular } = useQuery<MarketResponse>({
    queryKey: ["/api/market/assets/grid/popular", gf],
    queryFn: async () => {
      const p = new URLSearchParams({ ...MARKET_PARAMS, limit: "8", sort: "momentum", order: "desc" });
      p.set("game", gf === "all" ? "dota2" : gf);
      const res = await fetch(`/api/market/assets?${p}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 20000,
    refetchInterval: 30000,
  });

  const { data: undervalued } = useQuery<MarketResponse>({
    queryKey: ["/api/market/assets/grid/undervalued", gf],
    queryFn: async () => {
      const p = new URLSearchParams({ ...MARKET_PARAMS, limit: "8", sort: "lastTradePrice", order: "asc" });
      p.set("game", gf === "all" ? "dota2" : gf);
      const res = await fetch(`/api/market/assets?${p}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 20000,
    refetchInterval: 30000,
  });

  const { isSyntheticMode: gridSyntheticMode } = useSynthetic();
  const selectAsset = (row: MarketRow) => {
    dispatch({ type: "SELECT_ASSET", asset: row });
    if (!gridSyntheticMode) dispatch({ type: "OPEN_TRADE_MODAL" });
  };

  const renderSkeletons = () =>
    Array.from({ length: 6 }).map((_, i) => (
      <div key={i} className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.03] last:border-0">
        <div className="w-8 h-8 rounded-full bg-white/[0.05] animate-pulse shrink-0" />
        <div className="flex-1 space-y-1.5">
          <div className="h-2.5 bg-white/[0.05] rounded animate-pulse w-20" />
          <div className="h-1.5 bg-white/[0.04] rounded animate-pulse w-12" />
        </div>
        <div className="space-y-1.5 text-right">
          <div className="h-2.5 bg-white/[0.05] rounded animate-pulse w-12" />
          <div className="h-1.5 bg-white/[0.04] rounded animate-pulse w-8" />
        </div>
      </div>
    ));

  const renderRow = (row: MarketRow) => {
    const change = pct24h(row);
    const positive = change >= 0;
    const avatarUrl = (row as any).avatarImageUrl;
    const shortName = row.displayName.split("#")[0];
    const tagLabel = row.displayName.includes("#") ? `#${row.displayName.split("#")[1]}` : getAssetGameLabel(row.assetUid);
    return (
      <button
        key={row.id}
        data-testid={`grid-row-${row.id}`}
        onClick={() => selectAsset(row)}
        className="flex items-center gap-3 w-full px-4 py-3 hover:bg-white/[0.04] active:bg-white/[0.07] transition-colors border-b border-white/[0.03] last:border-0 text-left group"
      >
        <div className="w-8 h-8 rounded-full shrink-0 overflow-hidden border border-white/[0.10] bg-white/[0.05] flex items-center justify-center transition-all group-hover:border-white/[0.18]">
          {avatarUrl
            ? <img src={avatarUrl} className="w-full h-full object-cover" alt="" />
            : <span className="text-[11px] font-bold text-muted-foreground/50">{shortName.charAt(0).toUpperCase()}</span>
          }
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-foreground/90 truncate leading-tight group-hover:text-white transition-colors">{shortName}</div>
          <div className="text-[10px] text-muted-foreground/35 leading-tight mt-0.5 font-mono">{tagLabel}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[13px] font-bold font-mono text-foreground tabular-nums leading-tight">
            {formatCurrency(parseFloat(row.lastTradePrice))}
          </div>
          <div className={`text-[11px] font-semibold tabular-nums mt-0.5 ${positive ? "text-emerald-400" : "text-rose-400"}`}>
            {positive ? "+" : ""}{change.toFixed(1)}%
          </div>
        </div>
      </button>
    );
  };

  const columns = [
    { title: "Trending Players", icon: <Flame className="w-3 h-3" />, key: "trending", data: trending?.rows },
    { title: "Popular", icon: <TrendingUp className="w-3 h-3" />, key: "popular", data: popular?.rows },
    { title: "Undervalued", icon: <Target className="w-3 h-3" />, key: "undervalued", data: undervalued?.rows },
  ];

  return (
    <div className="border-t border-white/[0.06]">
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-white/[0.06] bg-card/30">
        <BarChart3 className="w-3.5 h-3.5 text-primary/60" />
        <span className="text-[11px] font-bold tracking-[0.14em] uppercase text-foreground/70">Player Market</span>
        <Link
          href="/assets"
          className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-white/[0.07] text-[9px] font-mono font-bold uppercase tracking-wider text-muted-foreground/45 hover:text-cyan-400 hover:border-cyan-900/60 transition-colors"
          data-testid="link-terminal-assets"
        >
          <LayoutGrid className="w-2.5 h-2.5" />
          All Players
        </Link>
      </div>
      <div className="grid grid-cols-3 divide-x divide-white/[0.04]">
        {columns.map((col) => (
          <div key={col.key} className="flex flex-col">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/[0.04] bg-black/10 shrink-0">
              <span className="text-primary/45">{col.icon}</span>
              <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground/50 truncate">{col.title}</span>
            </div>
            <div className="flex flex-col">
              {!col.data ? renderSkeletons() : col.data.map((row) => renderRow(row))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── AssetChartSummary ───────────────────────────────────────────────────────

type TF = "24h" | "7d" | "30d";
const TF_LABELS: Record<TF, string> = { "24h": "24H", "7d": "7D", "30d": "30D" };

function fmtChartTime(iso: string | undefined | null, tf: TF): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    if (tf === "24h") return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

type CanonicalPerf = {
  assetId: number;
  game: string;
  provider: string;
  latestPerformanceScore: number | null;
  trend: number | null;
  confidence: number | null;
  matchesCount: number | null;
  role: string | null;
  source: string;
  updatedAt: string;
};

function PerformanceChip({ assetId }: { assetId: number | undefined }) {
  const { data: perf } = useQuery<CanonicalPerf>({
    queryKey: ["/api/market/assets", assetId, "performance"],
    queryFn: async () => {
      const res = await fetch(`/api/market/assets/${assetId}/performance`, { credentials: "include" });
      if (!res.ok) return null as any;
      return res.json();
    },
    enabled: !!assetId,
    staleTime: 60000,
    refetchInterval: 120000,
  });

  if (!perf || perf.latestPerformanceScore == null) return null;

  const score = perf.latestPerformanceScore;
  const isLoL = perf.game === "lol";
  const isDota2 = perf.game === "dota2";

  if (isLoL) {
    const sigmaStr = `${score >= 0 ? "+" : ""}${score.toFixed(2)}σ`;
    const color = score > 0.5 ? "text-emerald-400" : score < -0.5 ? "text-rose-400" : "text-muted-foreground";
    const bgColor = score > 0.5 ? "bg-emerald-500/10 border-emerald-500/20" : score < -0.5 ? "bg-rose-500/10 border-rose-500/20" : "bg-white/5 border-white/10";
    const tooltip = perf.role
      ? `Performance: ${Math.abs(score).toFixed(2)} std deviations ${score >= 0 ? "above" : "below"} Challenger avg — ${perf.role}`
      : `Performance score: ${score.toFixed(2)}σ`;
    return (
      <div title={tooltip} data-testid="performance-score-chip" className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-mono cursor-help ${bgColor} ${color}`}>
        <span>Perf</span>
        <span className="font-bold">{sigmaStr}</span>
        <span className="text-muted-foreground text-[10px]">vs Chall</span>
      </div>
    );
  }

  if (isDota2) {
    const pct = Math.min(100, Math.max(0, score));
    const color = pct >= 60 ? "text-emerald-400" : pct < 40 ? "text-rose-400" : "text-muted-foreground";
    const bgColor = pct >= 60 ? "bg-emerald-500/10 border-emerald-500/20" : pct < 40 ? "bg-rose-500/10 border-rose-500/20" : "bg-white/5 border-white/10";
    const tooltip = `Dota2 performance score: ${pct.toFixed(1)}/100${perf.confidence != null ? ` (confidence: ${perf.confidence.toFixed(0)}%)` : ""}`;
    return (
      <div title={tooltip} data-testid="performance-score-chip" className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-mono cursor-help ${bgColor} ${color}`}>
        <span>Perf</span>
        <span className="font-bold">{pct.toFixed(1)}</span>
        <span className="text-muted-foreground text-[10px]">/100</span>
      </div>
    );
  }

  return null;
}

function AssetHeroHeader({ tf, setTf }: { tf: TF; setTf: (t: TF) => void }) {
  const { state } = useTerminal();
  const { selectedSynth } = useSynthetic();
  const asset = state.selectedAsset;
  const isSynth = isSyntheticAsset(asset);
  const synthId = isSynth && asset ? synthIdFromAsset(asset) : null;

  const { data: snapData } = useQuery({
    queryKey: isSynth
      ? ["/api/synthetic/player", synthId, "history", tf]
      : ["/api/market/assets", asset?.id, "snapshots", tf],
    queryFn: async () => {
      if (isSynth && synthId) {
        const res = await fetch(`/api/synthetic/player/${synthId}/history?tf=${tf}`, { credentials: "include" });
        if (!res.ok) throw new Error("Failed to load synthetic chart");
        const data = await res.json() as { playerId: string; tf: string; snapshots: { t: string; p: number }[] };
        return { assetId: synthId, snapshots: data.snapshots.map((s) => ({ price: String(s.p), recordedAt: s.t })), tf };
      }
      const res = await fetch(`/api/market/assets/${asset!.id}/snapshots?tf=${tf}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load chart");
      return res.json() as Promise<{ assetId: number; snapshots: any[]; tf: string }>;
    },
    enabled: !!asset,
    refetchInterval: isSynth ? 30000 : 15000,
    staleTime: 5000,
  });

  const changePct = useMemo(() => {
    const snaps = snapData?.snapshots ?? [];
    if (!snaps.length || !asset) return null;
    const refPrice = parseFloat(snaps[0].price);
    const currentPrice = parseFloat(asset.lastTradePrice);
    return refPrice > 0 ? ((currentPrice - refPrice) / refPrice) * 100 : null;
  }, [snapData, asset]);

  const sr = isSynth ? selectedSynth : null;
  const synthFv = sr?.fairValue ?? null;
  const synthDivPct = sr?.divergencePct ?? null;
  const currentPrice = asset ? parseFloat(asset.lastTradePrice) : 0;
  const synthUpside = synthFv !== null && currentPrice > 0
    ? ((synthFv - currentPrice) / currentPrice) * 100
    : null;
  const synthSignalLabel = sr?.signal ?? null;
  const synthRole = sr?.role ?? null;

  if (!asset) {
    return (
      <div className="relative border-b border-white/5 shrink-0 px-4 py-3 flex items-center gap-3">
        <div className="w-7 h-7 rounded-full bg-white/[0.04] border border-white/[0.06] flex items-center justify-center shrink-0">
          <BarChart3 className="w-3.5 h-3.5 text-muted-foreground/25" />
        </div>
        <span className="text-sm text-muted-foreground/40">No player selected</span>
      </div>
    );
  }

  return (
    <div className="relative border-b border-white/5 shrink-0 overflow-hidden bg-card/50">
      {/* Gradient wash */}
      <div className="absolute inset-0 bg-gradient-to-r from-primary/[0.05] via-transparent to-transparent pointer-events-none" />

      {/* Player identity + price */}
      <div className="relative px-4 pt-3 pb-2.5">
        <div className="flex items-start justify-between gap-3">
          {/* Avatar — prepared for portraitImageUrl / avatarImageUrl bind */}
          <div className="w-9 h-9 rounded-full shrink-0 border border-white/10 bg-white/[0.05] flex items-center justify-center overflow-hidden mt-0.5">
            {(asset as any).avatarImageUrl
              ? <img src={(asset as any).avatarImageUrl} className="w-full h-full object-cover" alt="" />
              : <span className="text-sm font-bold text-muted-foreground/40 uppercase leading-none">{asset.displayName.charAt(0)}</span>
            }
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[17px] font-bold text-foreground leading-tight truncate">
              {asset.displayName}
            </h2>
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              {synthRole && SCANNER_ROLE[synthRole] && (
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${SCANNER_ROLE[synthRole].cls}`}>
                  {SCANNER_ROLE[synthRole].label}
                </span>
              )}
              <span className="text-[10px] text-muted-foreground/55">{getAssetGameLabel(asset.assetUid)}</span>
              {synthSignalLabel && (
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                  synthSignalLabel.includes("STRONG")
                    ? "bg-emerald-500/12 border-emerald-500/25 text-emerald-400"
                    : synthSignalLabel.includes("BUY")
                    ? "bg-primary/12 border-primary/25 text-primary"
                    : "bg-white/[0.06] border-white/10 text-muted-foreground"
                }`}>
                  {synthSignalLabel.replace(/_/g, " ")}
                </span>
              )}
              <PerformanceChip assetId={asset.id} />
            </div>
          </div>
          <div className="text-right shrink-0">
            <div data-testid="chart-price" className="text-[22px] font-bold font-mono text-foreground leading-tight tabular-nums">
              {formatCurrency(currentPrice)}
            </div>
            <div className="flex items-center justify-end gap-1.5 mt-0.5">
              {changePct !== null ? <PctBadge value={changePct} /> : <span className="text-xs text-muted-foreground">—</span>}
              <span className="text-[10px] text-muted-foreground/45">{TF_LABELS[tf]}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Opportunity summary strip (synthetic mode) */}
      {synthFv !== null && (
        <div className="relative px-4 pb-3">
          <div className="grid grid-cols-3 gap-1.5">
            <div className="rounded-lg bg-white/[0.04] border border-white/[0.06] px-2.5 py-1.5 text-center">
              <div className="text-[9px] text-muted-foreground/50 uppercase tracking-wider mb-0.5">Fair Value</div>
              <div className="text-xs font-mono font-bold text-foreground">{formatCurrency(synthFv)}</div>
            </div>
            <div className={`rounded-lg border px-2.5 py-1.5 text-center ${
              synthDivPct !== null && synthDivPct < -15
                ? "bg-emerald-500/[0.06] border-emerald-500/20"
                : "bg-white/[0.04] border-white/[0.06]"
            }`}>
              <div className="text-[9px] text-muted-foreground/50 uppercase tracking-wider mb-0.5">Discount</div>
              <div className={`text-xs font-mono font-bold ${
                synthDivPct !== null && synthDivPct < -15 ? "text-emerald-400" : "text-foreground"
              }`}>
                {synthDivPct !== null ? `${Math.abs(synthDivPct).toFixed(1)}%` : "—"}
              </div>
            </div>
            <div className={`rounded-lg border px-2.5 py-1.5 text-center ${
              synthUpside !== null && synthUpside > 10
                ? "bg-emerald-500/[0.06] border-emerald-500/20"
                : "bg-white/[0.04] border-white/[0.06]"
            }`}>
              <div className="text-[9px] text-muted-foreground/50 uppercase tracking-wider mb-0.5">Upside</div>
              <div className={`text-xs font-mono font-bold ${
                synthUpside !== null && synthUpside > 10 ? "text-emerald-400" : "text-foreground"
              }`}>
                {synthUpside !== null ? `+${synthUpside.toFixed(1)}%` : "—"}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bid / Ask / Spread + TF selector */}
      <div className="relative flex items-center gap-3 px-4 py-2 border-t border-white/[0.05]">
        <div className="flex items-center gap-3 text-xs shrink-0">
          <div>
            <span className="text-[9px] text-muted-foreground/40 uppercase tracking-wide mr-1">Bid</span>
            <span className="font-mono text-rose-400">{formatCurrency(parseFloat(asset.bidPrice ?? "0"))}</span>
          </div>
          <div>
            <span className="text-[9px] text-muted-foreground/40 uppercase tracking-wide mr-1">Ask</span>
            <span className="font-mono text-emerald-400">{formatCurrency(parseFloat(asset.askPrice ?? "0"))}</span>
          </div>
          <div>
            <span className="text-[9px] text-muted-foreground/40 uppercase tracking-wide mr-1">Spd</span>
            <span className="font-mono text-foreground/70">{parseFloat(asset.spreadPct ?? "0").toFixed(2)}%</span>
          </div>
        </div>
        <div className="flex-1" />
        <div className="flex gap-0.5 shrink-0">
          {(["24h", "7d", "30d"] as TF[]).map((t) => (
            <button
              key={t}
              data-testid={`tf-${t}`}
              onClick={() => setTf(t)}
              className={`px-2 py-0.5 text-xs rounded transition-all duration-150 active:scale-[0.93] ${
                tf === t
                  ? "bg-primary/20 text-primary ring-1 ring-primary/20"
                  : "text-muted-foreground hover:text-foreground/80 hover:bg-white/[0.06] active:bg-white/10"
              }`}
            >
              {TF_LABELS[t]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function AssetChartSummary({ tf = "24h" }: { tf?: TF }) {
  const { state } = useTerminal();
  const asset = state.selectedAsset;
  const isSynth = isSyntheticAsset(asset);
  const synthId = isSynth && asset ? synthIdFromAsset(asset) : null;

  const { data: snapData, isLoading: loadingSnaps } = useQuery({
    queryKey: isSynth
      ? ["/api/synthetic/player", synthId, "history", tf]
      : ["/api/market/assets", asset?.id, "snapshots", tf],
    queryFn: async () => {
      if (isSynth && synthId) {
        const res = await fetch(`/api/synthetic/player/${synthId}/history?tf=${tf}`, { credentials: "include" });
        if (!res.ok) throw new Error("Failed to load synthetic chart");
        const data = await res.json() as { playerId: string; tf: string; snapshots: { t: string; p: number }[] };
        return { assetId: synthId, snapshots: data.snapshots.map((s) => ({ price: s.p, recordedAt: s.t })), tf };
      }
      const res = await fetch(`/api/market/assets/${asset!.id}/snapshots?tf=${tf}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load chart");
      return res.json() as Promise<{ assetId: number; snapshots: any[]; tf: string }>;
    },
    enabled: !!asset,
    refetchInterval: isSynth ? 30000 : 15000,
  });

  const { chartData, referencePrice, changePct } = useMemo(() => {
    const snaps = snapData?.snapshots ?? [];
    if (!snaps.length || !asset) return { chartData: [], referencePrice: null, changePct: null };

    const data = snaps.map((s: any) => ({
      t: fmtChartTime(s.recordedAt, tf),
      p: parseFloat(s.price),
      ts: s.recordedAt,
    }));

    const refPrice = data[0].p;
    const currentPrice = parseFloat(asset.lastTradePrice);
    const pct = refPrice > 0 ? ((currentPrice - refPrice) / refPrice) * 100 : 0;

    return { chartData: data, referencePrice: refPrice, changePct: pct };
  }, [snapData, tf, asset]);

  const validPrices = chartData.map((d) => d.p).filter((p) => isFinite(p) && !isNaN(p));
  const priceMin = validPrices.length ? Math.min(...validPrices) * 0.995 : 0;
  const priceMax = validPrices.length ? Math.max(...validPrices) * 1.005 : 0;
  const positive = (changePct ?? 0) >= 0;
  const strokeColor = positive ? "#34d399" : "#f87171";
  if (!asset) {
    return (
      <div className="flex flex-col h-full bg-card/50 border-r border-white/5 items-center justify-center gap-3 p-4">
        <div className="w-14 h-14 rounded-full bg-white/[0.04] border border-white/[0.06] flex items-center justify-center">
          <BarChart3 className="w-6 h-6 text-muted-foreground/25" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-muted-foreground/50">No player selected</p>
          <p className="text-xs text-muted-foreground/30 mt-1">Choose a player from the scanner to view the chart</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-card/50 overflow-hidden">
      {/* Chart */}
      <div className="flex-1 min-h-0 p-2">
        {loadingSnaps ? (
          <div className="h-full rounded-lg bg-gradient-to-b from-white/[0.04] to-white/[0.02] animate-pulse" />
        ) : chartData.length < 2 ? (
          <div className="h-full flex flex-col items-center justify-center gap-2">
            <Activity className="w-5 h-5 text-muted-foreground/25" />
            <p className="text-[11px] text-muted-foreground/40 text-center">Price snapshots accumulating…</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={strokeColor} stopOpacity={0.25} />
                  <stop offset="95%" stopColor={strokeColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="t" tick={{ fill: "#6b7280", fontSize: 9 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis
                domain={[priceMin, priceMax]}
                tick={{ fill: "#6b7280", fontSize: 9 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `$${v.toFixed(2)}`}
                width={48}
              />
              <ChartTooltip
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, padding: "6px 10px" }}
                labelStyle={{ color: "#9ca3af", fontSize: 10, marginBottom: 2 }}
                itemStyle={{ color: "#f3f4f6", fontSize: 11 }}
                formatter={(v: any, _name: string, props: any) => {
                  const price = v as number;
                  const ref = referencePrice;
                  const chg = ref && ref > 0 ? ((price - ref) / ref * 100) : null;
                  return [
                    <span key="p">
                      {formatCurrency(price)}
                      {chg !== null && (
                        <span style={{ color: chg >= 0 ? "#34d399" : "#f87171", marginLeft: 6, fontSize: 10 }}>
                          {chg >= 0 ? "+" : ""}{chg.toFixed(2)}%
                        </span>
                      )}
                    </span>,
                    "Price"
                  ];
                }}
              />
              {referencePrice !== null && (
                <ReferenceLine
                  y={referencePrice}
                  stroke="#6b7280"
                  strokeDasharray="4 3"
                  strokeWidth={1}
                  label={{ value: `${TF_LABELS[tf]} ref`, position: "insideTopRight", fontSize: 8, fill: "#6b7280" }}
                />
              )}
              <Area type="monotone" dataKey="p" stroke={strokeColor} strokeWidth={1.5} fill="url(#priceGrad)" dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-px border-t border-white/5 shrink-0 bg-white/5">
        {[
          { label: "Momentum", value: `${parseFloat(asset.momentum ?? "0").toFixed(3)}` },
          { label: "Vol 24h", value: `${parseFloat(asset.volume24h ?? "0").toFixed(0)}` },
          { label: `${TF_LABELS[tf]} ref`, value: referencePrice !== null ? formatCurrency(referencePrice) : "—" },
          { label: "Market", value: asset?.market?.region ?? "—" },
        ].map((s) => (
          <div key={s.label} className="bg-card px-3 py-2 transition-colors duration-150 hover:bg-white/[0.03]">
            <div className="text-[10px] text-muted-foreground/70 mb-0.5 uppercase tracking-wide">{s.label}</div>
            <div className="text-xs font-mono font-semibold text-foreground">{s.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── TradeTicket ─────────────────────────────────────────────────────────────

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
  error?: string;
  message?: string;
};

type OrderMode = "MARKET" | "LIMIT" | "STOP_LOSS" | "TAKE_PROFIT";

const ORDER_MODE_LABELS: Record<OrderMode, string> = {
  MARKET: "Market",
  LIMIT: "Limit",
  STOP_LOSS: "Stop Loss",
  TAKE_PROFIT: "Take Profit",
};

function TradeTicket() {
  const { state, dispatch } = useTerminal();
  const asset = state.selectedAsset;
  const { toast } = useToast();
  const qc = useQueryClient();
  const [qty, setQty] = useState("1");
  const [orderMode, setOrderMode] = useState<"MARKET" | "LIMIT">("MARKET");
  const [triggerPrice, setTriggerPrice] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [tradeSuccess, setTradeSuccess] = useState(false);
  const { data: portfolio } = usePortfolio();

  const parsedQty = Math.max(0, parseInt(qty, 10) || 0);
  const parsedTriggerPrice = parseFloat(triggerPrice.replace(",", ".")) || 0;
  const priceInvalid = triggerPrice !== "" && parsedTriggerPrice === 0;
  const isBuy = state.side === "BUY";

  const tradeMutation = useMutation({
    mutationFn: async (body: { type: "BUY" | "SELL"; shares: number }) =>
      apiRequest("POST", `/api/market/assets/${asset!.id}/trade`, body),
    onSuccess: () => {
      setTradeSuccess(true);
      setTimeout(() => setTradeSuccess(false), 1800);
      toast({ title: "Trade executed", description: `${state.side} order filled` });
      setQty("1");
      qc.invalidateQueries({ queryKey: ["/api/market/assets"], exact: false });
      qc.invalidateQueries({ queryKey: ["/api/portfolio"] });
      qc.invalidateQueries({ queryKey: ["/api/market/trades/recent"] });
      qc.invalidateQueries({ queryKey: ["/api/terminal/activity/me"] });
      if (asset) qc.invalidateQueries({ queryKey: ["/api/market/assets", asset.id, "snapshots"] });
    },
    onError: (err: any) => {
      const raw = err?.message ?? "Unknown error";
      const m = raw.match(/\{"message":"([^"]+)"\}/);
      toast({ title: "Trade failed", description: m ? m[1] : raw, variant: "destructive" });
    },
  });

  const orderMutation = useMutation({
    mutationFn: async (body: Record<string, any>) => apiRequest("POST", "/api/orders", body),
    onSuccess: () => {
      toast({ title: "Order placed", description: `Limit ${state.side} order created` });
      setQty("1");
      setTriggerPrice("");
      qc.invalidateQueries({ queryKey: ["/api/orders/me"] });
    },
    onError: (err: any) => {
      const raw = err?.message ?? "Unknown error";
      const m = raw.match(/\{"message":"([^"]+)"\}/);
      toast({ title: "Order failed", description: m ? m[1] : raw, variant: "destructive" });
    },
  });

  const { data: quote, isLoading: quoteLoading } = useQuery<AmmQuote>({
    queryKey: ["/api/market/assets", asset?.id, "quote", state.side, parsedQty],
    queryFn: async () => {
      if (!asset?.id || parsedQty < 1) return { ammEnabled: false };
      const params = new URLSearchParams({ type: state.side, shares: String(parsedQty) });
      const res = await fetch(`/api/market/assets/${asset.id}/quote?${params}`, { credentials: "include" });
      if (!res.ok) return { ammEnabled: false };
      return res.json();
    },
    enabled: !!asset && parsedQty >= 1,
    staleTime: 1000,
    refetchInterval: 3000,
  });

  const execPrice = isBuy
    ? parseFloat(asset?.askPrice ?? asset?.lastTradePrice ?? "0")
    : parseFloat(asset?.bidPrice ?? asset?.lastTradePrice ?? "0");

  const ammNotional = quote?.ammEnabled && quote?.notional ? parseFloat(quote.notional) : null;
  const ammFee = quote?.ammEnabled && quote?.feeAmount ? parseFloat(quote.feeAmount) : null;
  const ammImpact = quote?.ammEnabled && quote?.priceImpactPct ? parseFloat(quote.priceImpactPct) : null;
  const ammAvgPrice = quote?.ammEnabled && quote?.avgPrice ? parseFloat(quote.avgPrice) : null;

  const gross = ammNotional ?? parsedQty * execPrice;
  const fee = ammFee ?? gross * 0.02;
  const total = isBuy ? gross + fee : gross - fee;
  const balance = parseFloat(portfolio?.portfolio?.balance ?? "0");

  const canonicalPosition = portfolio?.positions?.find(
    (p: any) => p.source === "CANONICAL" && p.assetId === asset?.id
  );
  const sharesOwned = canonicalPosition?.shares ?? 0;

  const isMarket = orderMode === "MARKET";
  const canTrade = asset && parsedQty > 0 && (isBuy ? balance >= total : sharesOwned >= parsedQty);
  const canPlaceOrder = asset && parsedQty > 0 && parsedTriggerPrice > 0;

  const maxQty = isBuy
    ? execPrice > 0 ? Math.floor(balance / (execPrice * 1.02)) : 0
    : sharesOwned;

  const adjustQty = (delta: number) =>
    setQty((q) => String(Math.max(1, (parseInt(q) || 0) + delta)));

  const handleSubmit = () => {
    if (!asset) return;
    if (isMarket) {
      if (!canTrade) return;
      tradeMutation.mutate({ type: state.side, shares: parsedQty });
    } else {
      if (!canPlaceOrder) return;
      orderMutation.mutate({
        assetId: asset.id,
        mode: "CANONICAL",
        orderType: "LIMIT",
        side: state.side,
        triggerPrice: parsedTriggerPrice,
        quantity: parsedQty,
        timeInForce: "GTC",
      });
    }
  };

  if (!asset) {
    return (
      <div className="flex flex-col h-full bg-card items-center justify-center gap-3 p-6">
        <div className="w-14 h-14 rounded-full bg-white/[0.04] border border-white/[0.06] flex items-center justify-center">
          <ShoppingCart className="w-6 h-6 text-muted-foreground/25" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-muted-foreground/50">No player selected</p>
          <p className="text-xs text-muted-foreground/30 mt-1">Pick a player from the scanner to open the trade ticket</p>
        </div>
      </div>
    );
  }

  const ctaLabel = () => {
    if (isMarket) {
      if (tradeMutation.isPending) return "Executing…";
      if (!canTrade) return isBuy ? "Insufficient funds" : "Insufficient shares";
      return `${state.side} ${parsedQty} share${parsedQty !== 1 ? "s" : ""}`;
    }
    if (orderMutation.isPending) return "Placing…";
    if (!parsedTriggerPrice) return "Enter limit price";
    return `Place Limit Order`;
  };

  return (
    <div className="flex flex-col h-full bg-card overflow-hidden">
      <PanelHeader>Trade Ticket</PanelHeader>

      <div className="flex-1 overflow-y-auto">
        <div className="p-2.5 space-y-2">

          {/* Asset */}
          <div className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg bg-white/5 border border-white/5">
            <div className="min-w-0">
              <div className="text-sm font-bold text-foreground truncate">{asset.displayName}</div>
              <div className="text-xs text-muted-foreground font-mono">
                {quote?.ammEnabled
                  ? <span className="text-primary/80">AMM ⚡</span>
                  : null}
                {" "}{formatCurrency(parseFloat(asset.lastTradePrice))}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-xs text-muted-foreground">
                <span className="text-rose-400/80">{formatCurrency(parseFloat(asset.bidPrice ?? "0"))}</span>
                <span className="text-muted-foreground/40 mx-1">/</span>
                <span className="text-emerald-400/80">{formatCurrency(parseFloat(asset.askPrice ?? "0"))}</span>
              </div>
              <div className="text-xs text-muted-foreground/50">{parseFloat(asset.spreadPct ?? "0").toFixed(2)}% spread</div>
            </div>
          </div>

          {/* Side toggle */}
          <div className="grid grid-cols-2 rounded-lg overflow-hidden border border-white/10">
            <button
              data-testid="ticket-buy"
              onClick={() => dispatch({ type: "SET_SIDE", side: "BUY" })}
              className={`py-2 text-sm font-bold transition-all duration-150 active:brightness-90 active:scale-[0.99] ${isBuy ? "bg-emerald-500/20 text-emerald-400 border-b-2 border-emerald-500" : "text-muted-foreground hover:text-foreground hover:bg-white/[0.06]"}`}
            >
              BUY
            </button>
            <button
              data-testid="ticket-sell"
              onClick={() => dispatch({ type: "SET_SIDE", side: "SELL" })}
              className={`py-2 text-sm font-bold transition-all duration-150 active:brightness-90 active:scale-[0.99] ${!isBuy ? "bg-rose-500/20 text-rose-400 border-b-2 border-rose-500" : "text-muted-foreground hover:text-foreground hover:bg-white/[0.06]"}`}
            >
              SELL
            </button>
          </div>

          {/* Order Type */}
          <div className="grid grid-cols-2 rounded-lg overflow-hidden border border-white/10">
            {(["MARKET", "LIMIT"] as const).map((mode) => (
              <button
                key={mode}
                data-testid={`order-mode-${mode.toLowerCase()}`}
                onClick={() => setOrderMode(mode)}
                className={`py-1.5 text-xs font-semibold transition-all duration-150 active:scale-[0.99] ${
                  orderMode === mode
                    ? "bg-primary/15 text-primary border-b-2 border-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-white/[0.06]"
                }`}
              >
                {mode === "MARKET" ? "Market" : "Limit"}
              </button>
            ))}
          </div>

          {/* Limit price (LIMIT only) */}
          {orderMode === "LIMIT" && (
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Limit Price</label>
              <input
                data-testid="trigger-price-input"
                type="text"
                inputMode="decimal"
                value={triggerPrice}
                onChange={(e) => setTriggerPrice(e.target.value)}
                placeholder={parseFloat(asset?.lastTradePrice ?? "0").toFixed(2)}
                className={`w-full bg-white/5 border rounded h-8 px-2.5 text-sm font-mono text-foreground focus:outline-none ${priceInvalid ? "border-rose-500/60 focus:border-rose-500" : "border-white/10 focus:border-primary"}`}
              />
              {priceInvalid ? (
                <p className="text-xs text-rose-400/80 mt-0.5">Enter a valid price (e.g. 14.50)</p>
              ) : (
                <p className="text-xs text-muted-foreground/60 mt-0.5">
                  {isBuy ? "Executes when price drops to or below your limit." : "Executes when price rises to or above your limit."}
                </p>
              )}
            </div>
          )}

          {/* Quantity */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-muted-foreground">Quantity</label>
              <span className="text-xs text-muted-foreground/60">{isBuy ? `${formatCurrency(execPrice)}/sh` : `${sharesOwned} owned`}</span>
            </div>
            <div className="flex items-center gap-1 mb-1.5">
              <button
                data-testid="ticket-qty-down"
                onClick={() => adjustQty(-1)}
                className="w-7 h-7 rounded bg-white/5 hover:bg-white/10 active:bg-white/[0.18] active:scale-[0.92] text-sm font-bold text-muted-foreground hover:text-foreground flex items-center justify-center shrink-0 transition-all duration-100"
              >
                −
              </button>
              <input
                data-testid="ticket-qty-input"
                type="number"
                min={1}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                className="flex-1 text-center bg-white/5 border border-white/10 rounded h-7 text-sm font-mono text-foreground focus:outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/20 transition-all"
              />
              <button
                data-testid="ticket-qty-up"
                onClick={() => adjustQty(1)}
                className="w-7 h-7 rounded bg-white/5 hover:bg-white/10 active:bg-white/[0.18] active:scale-[0.92] text-sm font-bold text-muted-foreground hover:text-foreground flex items-center justify-center shrink-0 transition-all duration-100"
              >
                +
              </button>
            </div>
            {/* Quick quantity buttons */}
            <div className="flex gap-1">
              {[1, 5, 10].map((n) => (
                <button
                  key={n}
                  data-testid={`ticket-qty-quick-${n}`}
                  onClick={() => adjustQty(n)}
                  className="flex-1 py-1 rounded text-xs text-muted-foreground bg-white/5 hover:bg-white/10 active:bg-white/[0.16] active:scale-[0.96] hover:text-foreground transition-all duration-100 border border-white/5"
                >
                  +{n}
                </button>
              ))}
              <button
                data-testid="ticket-qty-max"
                onClick={() => maxQty > 0 && setQty(String(maxQty))}
                disabled={maxQty <= 0}
                className="flex-1 py-1 rounded text-xs font-semibold text-muted-foreground bg-white/5 hover:bg-white/10 active:bg-white/[0.16] active:scale-[0.96] hover:text-foreground transition-all duration-100 border border-white/5 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                MAX
              </button>
            </div>
          </div>

          {/* Estimated summary — visually emphasized */}
          <div className={`rounded-lg border px-3 py-2 ${isBuy ? "bg-emerald-500/5 border-emerald-500/15" : "bg-rose-500/5 border-rose-500/15"}`}>
            <div className="text-xs text-muted-foreground mb-0.5">{isBuy ? "Estimated Cost" : "Estimated Proceeds"}</div>
            <div className={`text-xl font-mono font-bold ${isBuy ? "text-emerald-400" : "text-rose-400"}`}>
              {quoteLoading ? <span className="text-base text-muted-foreground">…</span> : formatCurrency(total)}
            </div>
            {quote?.ammEnabled && ammImpact !== null && Math.abs(ammImpact) > 2 && (
              <div className="flex items-center gap-1 mt-1 text-xs text-amber-400">
                <Zap className="w-3 h-3 shrink-0" />
                High impact: {ammImpact.toFixed(2)}%
              </div>
            )}
          </div>

          {/* Balance info */}
          <div className="flex justify-between text-xs px-0.5">
            <span className="text-muted-foreground">{isBuy ? "Buying power" : "Shares owned"}</span>
            <span className={`font-mono ${isBuy && balance < total ? "text-rose-400" : "text-foreground"}`}>
              {isBuy ? formatCurrency(balance) : `${sharesOwned} sh`}
            </span>
          </div>

          {/* CTA button */}
          <button
            data-testid="ticket-submit"
            onClick={handleSubmit}
            disabled={(isMarket ? (!canTrade || tradeMutation.isPending) : (!canPlaceOrder || orderMutation.isPending)) || tradeSuccess}
            className={`w-full py-2.5 rounded-lg font-bold text-sm transition-all duration-200 active:scale-[0.99] disabled:cursor-not-allowed ${
              tradeSuccess
                ? "bg-emerald-500/30 text-emerald-300 ring-1 ring-emerald-500/40 opacity-100"
                : isBuy
                  ? "bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-black disabled:opacity-40"
                  : "bg-rose-500 hover:bg-rose-400 active:bg-rose-600 text-white disabled:opacity-40"
            }`}
          >
            {tradeSuccess ? (
              <span className="flex items-center justify-center gap-1.5">
                <span className="text-base leading-none">✓</span> Executed
              </span>
            ) : (tradeMutation.isPending || orderMutation.isPending) ? (
              <span className="flex items-center justify-center gap-1.5">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                {ctaLabel()}
              </span>
            ) : ctaLabel()}
          </button>

          {/* Trade Details — collapsible */}
          <div className="rounded-lg border border-white/5 overflow-hidden">
            <button
              data-testid="ticket-details-toggle"
              onClick={() => setDetailsOpen((v) => !v)}
              className="w-full flex items-center justify-between px-2.5 py-1.5 bg-white/3 hover:bg-white/5 transition-colors text-xs text-muted-foreground"
            >
              <span className="font-medium">Trade Details</span>
              <ChevronRight className={`w-3.5 h-3.5 transition-transform ${detailsOpen ? "rotate-90" : ""}`} />
            </button>
            {detailsOpen && (
              <div className="px-2.5 py-2 space-y-1.5 text-xs bg-white/2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Exec price</span>
                  <span className="font-mono text-foreground">
                    {quoteLoading ? "…" : ammAvgPrice ? formatCurrency(ammAvgPrice) : formatCurrency(execPrice)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Shares</span>
                  <span className="font-mono text-foreground">{parsedQty}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Gross value</span>
                  <span className="font-mono text-foreground">{formatCurrency(gross)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Fee {quote?.ammEnabled && quote?.feeBps ? `(${(quote.feeBps / 100).toFixed(1)}%)` : "(2%)"}
                  </span>
                  <span className="font-mono text-muted-foreground">{formatCurrency(fee)}</span>
                </div>
                {quote?.ammEnabled && ammImpact !== null && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Price impact</span>
                    <span className={`font-mono ${Math.abs(ammImpact) > 1 ? "text-amber-400" : "text-muted-foreground"}`}>
                      {ammImpact.toFixed(3)}%
                    </span>
                  </div>
                )}
                {quote?.ammEnabled && quote?.newSpot && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">New spot</span>
                    <span className="font-mono text-foreground">{formatCurrency(parseFloat(quote.newSpot))}</span>
                  </div>
                )}
                {quote?.ammEnabled && quote?.supply && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Market supply</span>
                    <span className="font-mono text-muted-foreground">{parseFloat(quote.supply).toFixed(0)} sh</span>
                  </div>
                )}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

// ─── CompactTradeBox ─────────────────────────────────────────────────────────

function CompactTradeBox() {
  const { state, dispatch } = useTerminal();
  const asset = state.selectedAsset;
  const { toast } = useToast();
  const qc = useQueryClient();
  const [qty, setQty] = useState("1");
  const [orderMode, setOrderMode] = useState<"MARKET" | "LIMIT">("MARKET");
  const [triggerPrice, setTriggerPrice] = useState("");
  const [tradeSuccess, setTradeSuccess] = useState(false);
  const { data: portfolio } = usePortfolio();

  const parsedQty = Math.max(0, parseInt(qty, 10) || 0);
  const parsedTriggerPrice = parseFloat(triggerPrice.replace(",", ".")) || 0;
  const priceInvalid = triggerPrice !== "" && parsedTriggerPrice === 0;
  const isBuy = state.side === "BUY";
  const isMarket = orderMode === "MARKET";

  const tradeMutation = useMutation({
    mutationFn: async (body: { type: "BUY" | "SELL"; shares: number }) =>
      apiRequest("POST", `/api/market/assets/${asset!.id}/trade`, body),
    onSuccess: () => {
      setTradeSuccess(true);
      setTimeout(() => setTradeSuccess(false), 1800);
      toast({ title: "Trade executed", description: `${state.side} order filled` });
      setQty("1");
      qc.invalidateQueries({ queryKey: ["/api/market/assets"], exact: false });
      qc.invalidateQueries({ queryKey: ["/api/portfolio"] });
      qc.invalidateQueries({ queryKey: ["/api/market/trades/recent"] });
      qc.invalidateQueries({ queryKey: ["/api/terminal/activity/me"] });
      if (asset) qc.invalidateQueries({ queryKey: ["/api/market/assets", asset.id, "snapshots"] });
    },
    onError: (err: any) => {
      const raw = err?.message ?? "Unknown error";
      const m = raw.match(/\{"message":"([^"]+)"\}/);
      toast({ title: "Trade failed", description: m ? m[1] : raw, variant: "destructive" });
    },
  });

  const orderMutation = useMutation({
    mutationFn: async (body: Record<string, any>) => apiRequest("POST", "/api/orders", body),
    onSuccess: () => {
      toast({ title: "Order placed", description: `Limit ${state.side} order created` });
      setQty("1");
      setTriggerPrice("");
      qc.invalidateQueries({ queryKey: ["/api/orders/me"] });
    },
    onError: (err: any) => {
      const raw = err?.message ?? "Unknown error";
      const m = raw.match(/\{"message":"([^"]+)"\}/);
      toast({ title: "Order failed", description: m ? m[1] : raw, variant: "destructive" });
    },
  });

  const { data: quote } = useQuery<AmmQuote>({
    queryKey: ["/api/market/assets", asset?.id, "quote", state.side, parsedQty],
    queryFn: async () => {
      if (!asset?.id || parsedQty < 1) return { ammEnabled: false };
      const params = new URLSearchParams({ type: state.side, shares: String(parsedQty) });
      const res = await fetch(`/api/market/assets/${asset.id}/quote?${params}`, { credentials: "include" });
      if (!res.ok) return { ammEnabled: false };
      return res.json();
    },
    enabled: !!asset && parsedQty >= 1,
    staleTime: 1000,
    refetchInterval: 3000,
  });

  if (!asset) {
    return (
      <div className="mx-3 my-3 rounded-xl border border-white/[0.07] bg-white/[0.025] flex flex-col items-center justify-center gap-2 py-6">
        <ShoppingCart className="w-5 h-5 text-muted-foreground/20" />
        <p className="text-xs text-muted-foreground/35 text-center">Select a player to trade</p>
      </div>
    );
  }

  const execPrice = isBuy
    ? parseFloat(asset.askPrice ?? asset.lastTradePrice ?? "0")
    : parseFloat(asset.bidPrice ?? asset.lastTradePrice ?? "0");

  const ammNotional = quote?.ammEnabled && quote?.notional ? parseFloat(quote.notional) : null;
  const ammFee = quote?.ammEnabled && quote?.feeAmount ? parseFloat(quote.feeAmount) : null;
  const gross = ammNotional ?? parsedQty * execPrice;
  const fee = ammFee ?? gross * 0.02;
  const total = isBuy ? gross + fee : gross - fee;
  const balance = parseFloat(portfolio?.portfolio?.balance ?? "0");
  const canonicalPosition = portfolio?.positions?.find(
    (p: any) => p.source === "CANONICAL" && p.assetId === asset?.id
  );
  const sharesOwned = canonicalPosition?.shares ?? 0;
  const canTrade = parsedQty > 0 && (isBuy ? balance >= total : sharesOwned >= parsedQty);
  const canPlaceOrder = parsedQty > 0 && parsedTriggerPrice > 0;
  const isPending = tradeMutation.isPending || orderMutation.isPending;
  const canSubmit = isMarket ? (canTrade && !isPending) : (canPlaceOrder && !isPending);

  const adjustQty = (delta: number) =>
    setQty((q) => String(Math.max(1, (parseInt(q) || 0) + delta)));

  const handleSubmit = () => {
    if (isMarket) {
      if (!canTrade) return;
      tradeMutation.mutate({ type: state.side, shares: parsedQty });
    } else {
      if (!canPlaceOrder) return;
      orderMutation.mutate({
        assetId: asset.id,
        mode: "CANONICAL",
        orderType: "LIMIT",
        side: state.side,
        triggerPrice: parsedTriggerPrice,
        quantity: parsedQty,
        timeInForce: "GTC",
      });
    }
  };

  const ctaLabel = () => {
    if (tradeSuccess) return "✓ Executed";
    if (isPending) return "Processing…";
    if (isMarket) {
      if (!canTrade) return isBuy ? "Insufficient funds" : "Insufficient shares";
      return `${state.side} ${parsedQty} share${parsedQty !== 1 ? "s" : ""}`;
    }
    if (!parsedTriggerPrice) return "Enter limit price";
    return "Place Limit Order";
  };

  return (
    <div className="mx-3 my-3 rounded-xl border border-white/[0.07] bg-white/[0.025] overflow-hidden">
      <div className="p-3 space-y-2.5">

        {/* BUY / SELL */}
        <div className="grid grid-cols-2 rounded-lg overflow-hidden border border-white/10">
          <button
            data-testid="ticket-buy"
            onClick={() => dispatch({ type: "SET_SIDE", side: "BUY" })}
            className={`py-2 text-sm font-bold transition-all duration-150 active:scale-[0.99] ${isBuy ? "bg-emerald-500/20 text-emerald-400 border-b-2 border-emerald-500" : "text-muted-foreground hover:text-foreground hover:bg-white/[0.06]"}`}
          >
            BUY
          </button>
          <button
            data-testid="ticket-sell"
            onClick={() => dispatch({ type: "SET_SIDE", side: "SELL" })}
            className={`py-2 text-sm font-bold transition-all duration-150 active:scale-[0.99] ${!isBuy ? "bg-rose-500/20 text-rose-400 border-b-2 border-rose-500" : "text-muted-foreground hover:text-foreground hover:bg-white/[0.06]"}`}
          >
            SELL
          </button>
        </div>

        {/* Trading Currency */}
        <div className="flex items-center justify-between px-0.5">
          <span className="text-[9px] text-muted-foreground/40 uppercase tracking-widest font-medium">Trading Currency</span>
          <div className="flex items-center rounded-md border border-white/10 overflow-hidden">
            <div
              data-testid="compact-currency-gs"
              className="px-2.5 py-0.5 text-[9px] font-black bg-primary/15 text-primary border-r border-white/10 tracking-wide"
            >
              GS$
            </div>
            <div
              data-testid="compact-currency-usdc"
              title="USDC trading coming soon"
              className="px-2.5 py-0.5 text-[9px] font-black text-muted-foreground/25 tracking-wide cursor-not-allowed"
            >
              USDC
            </div>
          </div>
        </div>

        {/* Market / Limit */}
        <div className="grid grid-cols-2 rounded-lg overflow-hidden border border-white/10">
          {(["MARKET", "LIMIT"] as const).map((mode) => (
            <button
              key={mode}
              data-testid={`compact-order-mode-${mode.toLowerCase()}`}
              onClick={() => setOrderMode(mode)}
              className={`py-1.5 text-xs font-semibold transition-all duration-150 active:scale-[0.99] ${
                orderMode === mode
                  ? "bg-primary/15 text-primary border-b-2 border-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/[0.06]"
              }`}
            >
              {mode === "MARKET" ? "Market" : "Limit"}
            </button>
          ))}
        </div>

        {/* Quantity */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">Quantity</span>
            <span className="text-[10px] text-muted-foreground/50 font-mono">
              {isBuy ? `${formatCurrency(execPrice)}/sh` : `${sharesOwned} owned`}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              data-testid="compact-qty-down"
              onClick={() => adjustQty(-1)}
              className="w-8 h-8 rounded bg-white/5 hover:bg-white/10 active:bg-white/[0.18] active:scale-[0.92] text-base font-bold text-muted-foreground hover:text-foreground flex items-center justify-center shrink-0 transition-all duration-100"
            >
              −
            </button>
            <input
              data-testid="compact-qty-input"
              type="number"
              min={1}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="flex-1 text-center bg-white/5 border border-white/10 rounded h-8 text-sm font-mono text-foreground focus:outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/20 transition-all"
            />
            <button
              data-testid="compact-qty-up"
              onClick={() => adjustQty(1)}
              className="w-8 h-8 rounded bg-white/5 hover:bg-white/10 active:bg-white/[0.18] active:scale-[0.92] text-base font-bold text-muted-foreground hover:text-foreground flex items-center justify-center shrink-0 transition-all duration-100"
            >
              +
            </button>
          </div>
        </div>

        {/* Limit Price (conditional) */}
        {!isMarket && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">Limit Price</label>
              <span className="text-[9px] text-muted-foreground/35 font-mono">GS$</span>
            </div>
            <input
              data-testid="compact-trigger-price"
              type="text"
              inputMode="decimal"
              value={triggerPrice}
              onChange={(e) => setTriggerPrice(e.target.value)}
              placeholder={parseFloat(asset.lastTradePrice).toFixed(2)}
              className={`w-full bg-white/5 border rounded h-8 px-2.5 text-sm font-mono text-foreground focus:outline-none ${priceInvalid ? "border-rose-500/60 focus:border-rose-500" : "border-white/10 focus:border-primary"}`}
            />
            {priceInvalid && (
              <p className="text-[10px] text-rose-400/80 mt-0.5">Enter a valid price (e.g. 14.50)</p>
            )}
          </div>
        )}

        {/* Estimated cost — single compact line */}
        <div className="flex items-center justify-between text-xs px-0.5">
          <span className="text-muted-foreground/50">{isBuy ? "Est. cost" : "Est. proceeds"}</span>
          <div className="flex items-baseline gap-1">
            <span className={`font-mono font-semibold ${isBuy ? "text-emerald-400/80" : "text-rose-400/80"}`}>
              {formatCurrency(total)}
            </span>
            <span className="text-[9px] text-muted-foreground/35 font-mono">GS$</span>
          </div>
        </div>

        {/* Submit */}
        <button
          data-testid="compact-submit"
          onClick={handleSubmit}
          disabled={!canSubmit || tradeSuccess}
          className={`w-full py-2.5 rounded-lg font-bold text-sm transition-all duration-200 active:scale-[0.99] disabled:cursor-not-allowed ${
            tradeSuccess
              ? "bg-emerald-500/30 text-emerald-300 ring-1 ring-emerald-500/40"
              : isBuy
                ? "bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-black disabled:opacity-40"
                : "bg-rose-500 hover:bg-rose-400 active:bg-rose-600 text-white disabled:opacity-40"
          }`}
        >
          {isPending ? (
            <span className="flex items-center justify-center gap-1.5">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              {ctaLabel()}
            </span>
          ) : ctaLabel()}
        </button>

      </div>
    </div>
  );
}

// ─── PositionsPanel ──────────────────────────────────────────────────────────

function PositionsPanel() {
  const { dispatch } = useTerminal();
  const { data: portfolio, isLoading } = usePortfolio();

  const openPositions = useMemo(
    () => (portfolio?.positions ?? []).filter((p: any) => p.source === "CANONICAL" || p.source === "RIOT_NA1"),
    [portfolio]
  );

  return (
    <div className="flex flex-col h-full bg-card border-r border-white/5 overflow-hidden">
      <PanelHeader action={
        <span className="text-xs text-muted-foreground font-mono">
          {formatCurrency(parseFloat(portfolio?.portfolio?.balance ?? "0"))} cash
        </span>
      }>
        Positions
      </PanelHeader>
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-1 p-2">{[...Array(4)].map((_, i) => <div key={i} className="h-10 bg-white/5 rounded animate-pulse" />)}</div>
        ) : openPositions.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground">No open positions</div>
        ) : (
          openPositions.map((pos: any) => {
            const pnl = parseFloat(pos.unrealizedPnL);
            const pnlPct = parseFloat(pos.unrealizedPnLPercent);
            return (
              <div key={pos.id} data-testid={`position-${pos.id}`} className="px-3 py-2 border-b border-white/5 hover:bg-white/5 transition-colors">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-xs font-semibold text-foreground truncate max-w-[100px]">{pos.displayName}</span>
                  <span className={`text-xs font-mono font-semibold ${pnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                    {pnl >= 0 ? "+" : ""}{formatCurrency(pnl)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{pos.shares} sh @ {formatCurrency(parseFloat(pos.averageCost))}</span>
                  <PctBadge value={pnlPct} />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── MarketActivityFeed ──────────────────────────────────────────────────────

type TradeRow = { id: number; type: string; shares: number; pricePerShare: string; executedAt: string; playerName: string; trader?: string; puuid?: string };

function MarketActivityFeed() {
  const { state, dispatch } = useTerminal();

  const { data: globalTrades, isLoading: loadingGlobal } = useQuery<TradeRow[]>({
    queryKey: ["/api/market/trades/recent"],
    queryFn: async () => {
      const res = await fetch("/api/market/trades/recent", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load activity");
      return res.json();
    },
    refetchInterval: 5000,
  });

  const { data: myTrades, isLoading: loadingMine } = useQuery<TradeRow[]>({
    queryKey: ["/api/terminal/activity/me"],
    queryFn: async () => {
      const res = await fetch("/api/terminal/activity/me", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load my trades");
      return res.json();
    },
    refetchInterval: 5000,
    enabled: state.activityTab === "mine",
  });

  const isLoading = state.activityTab === "recent" ? loadingGlobal : loadingMine;
  const rows = state.activityTab === "recent" ? (globalTrades ?? []) : (myTrades ?? []);

  return (
    <div className="flex flex-col h-full bg-card/50 border-r border-white/5 overflow-hidden">
      <PanelHeader>Activity</PanelHeader>
      <TabBar
        tabs={[{ id: "recent", label: "Global" }, { id: "mine", label: "Mine" }]}
        active={state.activityTab}
        onSelect={(id) => dispatch({ type: "SET_ACTIVITY_TAB", tab: id as any })}
      />
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-1 p-2">{[...Array(6)].map((_, i) => <div key={i} className="h-8 bg-white/5 rounded animate-pulse" />)}</div>
        ) : rows.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground">
            {state.activityTab === "mine" ? "No trades yet — make your first trade!" : "No recent activity"}
          </div>
        ) : (
          rows.map((t) => (
            <div
              key={t.id}
              data-testid={`activity-row-${t.id}`}
              className="flex items-center gap-2 px-3 py-2 border-b border-white/5 hover:bg-white/5 transition-colors"
            >
              <span className={`text-xs font-bold w-7 shrink-0 ${t.type === "BUY" ? "text-emerald-400" : "text-rose-400"}`}>
                {t.type === "BUY" ? "B" : "S"}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-foreground truncate">{t.playerName}</div>
                {t.trader && <div className="text-xs text-muted-foreground">{t.trader}</div>}
              </div>
              <div className="text-right shrink-0">
                <div className="text-xs font-mono text-foreground">{t.shares}×{formatCurrency(parseFloat(t.pricePerShare))}</div>
                <div className="text-xs text-muted-foreground">{fmtTime(t.executedAt)}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── LiquidityPanel ──────────────────────────────────────────────────────────

function LiquidityPanel() {
  const { state, dispatch } = useTerminal();
  const asset = state.selectedAsset;

  if (!asset) {
    return (
      <div className="flex flex-col h-full bg-card items-center justify-center gap-2 p-4">
        <Layers className="w-8 h-8 text-muted-foreground/30" />
        <p className="text-xs text-muted-foreground text-center">Liquidity data appears when a player is selected</p>
      </div>
    );
  }

  const mid = parseFloat(asset.lastTradePrice);
  const bid = parseFloat(asset.bidPrice ?? "0");
  const ask = parseFloat(asset.askPrice ?? "0");
  const spreadPct = parseFloat(asset.spreadPct ?? "0");
  const momentum = parseFloat(asset.momentum ?? "0");

  const levels = [
    { label: "Ask +3%", price: ask * 1.03, depth: 8, side: "ask" },
    { label: "Ask +2%", price: ask * 1.02, depth: 15, side: "ask" },
    { label: "Ask +1%", price: ask * 1.01, depth: 30, side: "ask" },
    { label: "Ask", price: ask, depth: 60, side: "ask" },
    { label: "Bid", price: bid, depth: 60, side: "bid" },
    { label: "Bid −1%", price: bid * 0.99, depth: 30, side: "bid" },
    { label: "Bid −2%", price: bid * 0.98, depth: 15, side: "bid" },
    { label: "Bid −3%", price: bid * 0.97, depth: 8, side: "bid" },
  ];

  return (
    <div className="flex flex-col h-full bg-card overflow-hidden">
      <PanelHeader>Liquidity</PanelHeader>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Spread indicator */}
        <div className="rounded-lg bg-white/3 border border-white/5 p-2.5">
          <div className="text-xs text-muted-foreground mb-2">Spread</div>
          <div className="flex justify-between text-xs font-mono mb-1.5">
            <span className="text-rose-400">{formatCurrency(bid)}</span>
            <span className="text-muted-foreground">{spreadPct.toFixed(3)}%</span>
            <span className="text-emerald-400">{formatCurrency(ask)}</span>
          </div>
          <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-rose-500 via-white/20 to-emerald-500 rounded-full"
              style={{ width: "100%", marginLeft: "auto", marginRight: "auto" }}
            />
          </div>
        </div>

        {/* Momentum */}
        <div className="rounded-lg bg-white/3 border border-white/5 p-2.5">
          <div className="text-xs text-muted-foreground mb-1">Momentum Score</div>
          <div className={`text-lg font-mono font-bold ${momentum > 0 ? "text-emerald-400" : momentum < 0 ? "text-rose-400" : "text-muted-foreground"}`}>
            {momentum > 0 ? "+" : ""}{momentum.toFixed(4)}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {momentum > 0.005 ? "Strong upward drift" : momentum < -0.005 ? "Strong downward drift" : "Neutral drift"}
          </div>
        </div>

        {/* Depth ladder */}
        <div className="rounded-lg bg-white/3 border border-white/5 overflow-hidden">
          <div className="px-2.5 py-1.5 border-b border-white/5 text-xs text-muted-foreground font-medium">
            Depth Ladder
          </div>
          {levels.map((lvl) => (
            <div
              key={lvl.label}
              className={`relative flex items-center justify-between px-2.5 py-1 border-b border-white/5 last:border-0 ${lvl.label === "Ask" || lvl.label === "Bid" ? "bg-white/5" : ""}`}
            >
              <div
                className={`absolute inset-y-0 ${lvl.side === "ask" ? "right-0" : "left-0"} opacity-15 ${lvl.side === "ask" ? "bg-emerald-500" : "bg-rose-500"}`}
                style={{ width: `${lvl.depth}%` }}
              />
              <span className={`text-xs z-10 ${lvl.side === "ask" ? "text-emerald-400" : "text-rose-400"}`}>{lvl.label}</span>
              <span className="text-xs font-mono text-foreground z-10">{formatCurrency(lvl.price)}</span>
            </div>
          ))}
        </div>

        {/* Quick actions */}
        <div className="grid grid-cols-2 gap-1.5">
          <button
            data-testid="quick-buy"
            onClick={() => { dispatch({ type: "SET_SIDE", side: "BUY" }); dispatch({ type: "OPEN_TICKET" }); }}
            className="py-2 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 text-xs font-bold transition-colors border border-emerald-500/20"
          >
            Quick Buy
          </button>
          <button
            data-testid="quick-sell"
            onClick={() => { dispatch({ type: "SET_SIDE", side: "SELL" }); dispatch({ type: "OPEN_TICKET" }); }}
            className="py-2 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-400 text-xs font-bold transition-colors border border-rose-500/20"
          >
            Quick Sell
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── OpenOrdersPanel ─────────────────────────────────────────────────────────

type TriggerOrderRow = {
  id: string;
  assetId: string;
  orderType: string;
  side: string;
  triggerPrice: string;
  quantity: number;
  status: string;
  createdAt: string;
};

function OpenOrdersPanel() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading, refetch } = useQuery<{ orders: TriggerOrderRow[] }>({
    queryKey: ["/api/orders/me"],
    queryFn: async () => {
      const res = await fetch("/api/orders/me?status=OPEN", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load orders");
      return res.json();
    },
    refetchInterval: 10000,
    staleTime: 5000,
  });

  const cancelMutation = useMutation({
    mutationFn: async (orderId: string) => apiRequest("POST", `/api/orders/${orderId}/cancel`, {}),
    onSuccess: () => {
      toast({ title: "Order cancelled" });
      qc.invalidateQueries({ queryKey: ["/api/orders/me"] });
    },
    onError: (err: any) => {
      toast({ title: "Cancel failed", description: err?.message ?? "Unknown error", variant: "destructive" });
    },
  });

  useTerminalSse((event) => {
    if (["ORDER_TRIGGERED", "ORDER_EXECUTED", "ORDER_FAILED", "ORDER_CANCELLED"].includes(event.type)) {
      refetch();
      const d = event.data;
      const label = d.assetId?.split(":")?.slice(3, 4).join("") ?? d.orderId ?? "Order";
      if (event.type === "ORDER_EXECUTED") {
        toast({ title: `Order Executed`, description: `${d.side} ${d.qty} shares filled @ $${parseFloat(d.fillPrice ?? "0").toFixed(2)}` });
      } else if (event.type === "ORDER_TRIGGERED") {
        toast({ title: `Order Triggered`, description: `${d.orderType} triggered at $${parseFloat(d.currentPrice ?? "0").toFixed(2)}` });
      } else if (event.type === "ORDER_FAILED") {
        toast({ title: `Order Failed`, description: d.error ?? "Execution error", variant: "destructive" });
      }
    }
  });

  const orders = data?.orders ?? [];

  const typeLabel: Record<string, string> = {
    LIMIT: "Limit",
    STOP_LOSS: "Stop",
    TAKE_PROFIT: "T/P",
  };

  return (
    <div className="flex flex-col bg-card overflow-hidden h-full">
      <PanelHeader>
        Open Orders
        {orders.length > 0 && (
          <span className="ml-1.5 bg-primary/20 text-primary text-xs font-bold rounded-full px-1.5 py-0.5">
            {orders.length}
          </span>
        )}
      </PanelHeader>
      <div className={`${orders.length === 0 ? "flex-none" : "flex-1 overflow-y-auto"}`}>
        {isLoading ? (
          <div className="px-3 py-2 text-xs text-muted-foreground">Loading…</div>
        ) : orders.length === 0 ? (
          <div className="px-3 py-2 text-xs text-muted-foreground/50">No open orders</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/5 text-muted-foreground">
                <th className="text-left px-3 py-1.5">Type</th>
                <th className="text-left px-2 py-1.5">Side</th>
                <th className="text-right px-2 py-1.5">Trigger</th>
                <th className="text-right px-2 py-1.5">Qty</th>
                <th className="px-2 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} data-testid={`order-row-${order.id}`} className="border-b border-white/5 hover:bg-white/3">
                  <td className="px-3 py-1.5 font-medium text-foreground">
                    {typeLabel[order.orderType] ?? order.orderType}
                  </td>
                  <td className={`px-2 py-1.5 font-semibold ${order.side === "BUY" ? "text-emerald-400" : "text-rose-400"}`}>
                    {order.side}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-foreground">
                    ${parseFloat(order.triggerPrice).toFixed(2)}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-muted-foreground">
                    {order.quantity}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <button
                      data-testid={`cancel-order-${order.id}`}
                      onClick={() => cancelMutation.mutate(order.id)}
                      disabled={cancelMutation.isPending}
                      className="text-rose-400/70 hover:text-rose-400 transition-colors text-xs font-medium"
                    >
                      Cancel
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── MomentumIndex ────────────────────────────────────────────────────────────

type MarketIndexData = {
  overall: number;
  topTwenty: number;
  breadth: { gainers: number; losers: number; flat: number };
  avgMomentum: number;
  assetCount: number;
  updatedAt: string;
};

// ─── LastActivityPulse ────────────────────────────────────────────────────────

function LastActivityPulse() {
  const { data: trades } = useQuery<TradeRow[]>({
    queryKey: ["/api/market/trades/recent"],
    queryFn: async () => {
      const res = await fetch("/api/market/trades/recent", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 5000,
    staleTime: 0,
  });

  const items = trades ?? [];

  if (items.length === 0) {
    return <div className="h-8 border-b border-white/[0.04] bg-black/15 shrink-0" />;
  }

  const doubled = [...items, ...items];
  const speed = Math.max(25, items.length * 3.5);

  return (
    <div className="flex items-center h-8 border-b border-white/[0.04] bg-black/20 shrink-0 overflow-hidden">
      {/* Left label */}
      <div className="flex items-center gap-2 pl-4 pr-3.5 shrink-0 border-r border-white/[0.06] h-full bg-black/10">
        <span className="relative flex h-1.5 w-1.5 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-50" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
        </span>
        <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-muted-foreground/40">Live</span>
      </div>
      {/* Ticker */}
      <div className="flex-1 overflow-hidden min-w-0">
        <div
          className="flex items-center whitespace-nowrap"
          style={{ animation: `ticker-scroll ${speed}s linear infinite`, willChange: "transform" }}
        >
          {doubled.map((t, i) => {
            const isBuy = t.type === "BUY";
            return (
              <span key={`${t.id}-${i}`} className="inline-flex items-center gap-2 px-5">
                <span className={`text-[9px] font-bold tracking-wide ${isBuy ? "text-emerald-400" : "text-rose-400"}`}>
                  {isBuy ? "BUY" : "SELL"}
                </span>
                <span className="text-[10px] font-medium text-foreground/60">
                  {t.playerName.split("#")[0]}
                </span>
                <span className="text-[10px] font-mono text-muted-foreground/35 tabular-nums">
                  {t.shares}× {formatCurrency(parseFloat(t.pricePerShare))}
                </span>
                <span className="text-white/[0.06] text-[8px]">│</span>
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MomentumIndex() {
  const { data, isLoading } = useQuery<MarketIndexData>({
    queryKey: ["/api/market/index"],
    queryFn: async () => {
      const res = await fetch("/api/market/index", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    refetchInterval: 30000,
    staleTime: 20000,
  });

  if (isLoading || !data) {
    return (
      <div className="flex items-center gap-3 h-8 px-3 border-b border-white/5 bg-black/20">
        {[...Array(4)].map((_, i) => <div key={i} className="h-4 w-20 bg-white/5 rounded animate-pulse" />)}
      </div>
    );
  }

  const overallColor = data.overall > 0 ? "text-emerald-400" : data.overall < 0 ? "text-rose-400" : "text-muted-foreground";
  const topColor = data.topTwenty > 0 ? "text-emerald-400" : data.topTwenty < 0 ? "text-rose-400" : "text-muted-foreground";
  const breadthRatio = data.breadth.gainers / (data.assetCount || 1);

  return (
    <div className="flex items-center gap-4 h-8 px-3 border-b border-white/5 bg-black/20 shrink-0 overflow-x-auto">
      <div className="flex items-center gap-1.5 shrink-0">
        <Gauge className="w-3 h-3 text-primary/70" />
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-mono">Momentum Index</span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <span className="text-[10px] text-muted-foreground">Market</span>
        <span data-testid="momentum-index-overall" className={`text-xs font-mono font-bold ${overallColor}`}>
          {data.overall > 0 ? "+" : ""}{data.overall.toFixed(2)}%
        </span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <span className="text-[10px] text-muted-foreground">Top-20</span>
        <span data-testid="momentum-index-top20" className={`text-xs font-mono font-bold ${topColor}`}>
          {data.topTwenty > 0 ? "+" : ""}{data.topTwenty.toFixed(2)}%
        </span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="text-[10px] text-muted-foreground">Breadth</span>
        <span className="text-xs font-mono text-emerald-400">{data.breadth.gainers}▲</span>
        <span className="text-xs font-mono text-muted-foreground">{data.breadth.flat}◆</span>
        <span className="text-xs font-mono text-rose-400">{data.breadth.losers}▼</span>
      </div>
      <div className="hidden sm:flex flex-1 max-w-[100px] h-1.5 rounded-full bg-rose-500/30 overflow-hidden shrink-0">
        <div className="h-full bg-emerald-500/80 rounded-full transition-all" style={{ width: `${(breadthRatio * 100).toFixed(1)}%` }} />
      </div>
    </div>
  );
}

// ─── PlayerFundamentals ───────────────────────────────────────────────────────

type FundamentalsData = {
  provider?: string;
  wins: number | null;
  losses: number | null;
  games: number | null;
  winRate: number | null;
  leaguePoints: number | null;
  momentum: number | null;
  recentPerformance: number | null;
  consistencyScore: number | null;
  historicalSkill: number | null;
  activityScore: number | null;
  pviRaw: number | null;
  pviFinal: number | null;
  fairValueGS: number | null;
  divergencePct: number | null;
  confidence: number | null;
  lastMatchPulse: number | null;
};

function ScoreBar({ label, value, color = "bg-primary" }: { label: string; value: number | null; color?: string }) {
  const pct = value != null ? Math.min(100, Math.max(0, value)) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono font-bold text-foreground">{value != null ? value.toFixed(1) : "—"}</span>
      </div>
      <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function PlayerFundamentals() {
  const { state } = useTerminal();
  const asset = state.selectedAsset;
  const isSynth = isSyntheticAsset(asset);
  const synthId = isSynth && asset ? synthIdFromAsset(asset) : null;

  const { data: realData, isLoading: realLoading } = useQuery<FundamentalsData>({
    queryKey: ["/api/market/assets", asset?.id, "fundamentals"],
    queryFn: async () => {
      const res = await fetch(`/api/market/assets/${asset!.id}/fundamentals`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load fundamentals");
      return res.json();
    },
    enabled: !!asset?.id && !isSynth,
    staleTime: 60000,
    refetchInterval: 120000,
  });

  const { data: synthDetail, isLoading: synthLoading } = useQuery<SyntheticRow & { valuation: any }>({
    queryKey: ["/api/synthetic/player", synthId],
    queryFn: async () => {
      const res = await fetch(`/api/synthetic/player/${synthId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load synthetic player");
      return res.json();
    },
    enabled: isSynth && !!synthId,
    staleTime: 30000,
    refetchInterval: 60000,
  });

  if (!asset) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-3 p-6 bg-card">
        <Brain className="w-10 h-10 text-muted-foreground/20" />
        <p className="text-xs text-muted-foreground text-center">Select a player to view fundamentals</p>
      </div>
    );
  }

  if (isSynth) {
    if (synthLoading) {
      return (
        <div className="flex flex-col h-full p-4 gap-3">
          {[...Array(8)].map((_, i) => <div key={i} className="h-6 bg-white/5 rounded animate-pulse" />)}
        </div>
      );
    }
    if (!synthDetail) {
      return (
        <div className="flex flex-col h-full items-center justify-center gap-2 p-4">
          <p className="text-xs text-muted-foreground">No fundamentals data</p>
        </div>
      );
    }
    const price = parseFloat(synthDetail.lastTradePrice);
    const fv = synthDetail.fairValue;
    const fvDiff = synthDetail.divergencePct;
    const isOvervalued = fvDiff > 0;
    const val = synthDetail.valuation;

    return (
      <div className="flex flex-col h-full overflow-y-auto bg-card">
        <div className="px-3 py-2 border-b border-white/5 shrink-0">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-foreground">{synthDetail.displayName}</span>
            <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400">DEMO</span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1 leading-snug">{synthDetail.biography}</p>
        </div>

        <div className="p-3 space-y-4">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg bg-white/3 border border-white/5 p-2 text-center">
              <div className="text-[10px] text-muted-foreground mb-0.5 flex items-center justify-center">Win Rate <MetricInfo text={METRIC_INFO.winRate} /></div>
              <div className={`text-sm font-mono font-bold ${synthDetail.winRate >= 55 ? "text-emerald-400" : synthDetail.winRate < 50 ? "text-rose-400" : "text-foreground"}`}>
                {synthDetail.winRate.toFixed(1)}%
              </div>
            </div>
            <div className="rounded-lg bg-white/3 border border-white/5 p-2 text-center">
              <div className="text-[10px] text-muted-foreground mb-0.5 flex items-center justify-center">LP <MetricInfo text={METRIC_INFO.lp} /></div>
              <div className="text-sm font-mono font-bold text-primary">{synthDetail.leaguePoints.toLocaleString()}</div>
              <div className="text-[10px] text-muted-foreground">Challenger</div>
            </div>
            <div className="rounded-lg bg-white/3 border border-white/5 p-2 text-center">
              <div className="text-[10px] text-muted-foreground mb-0.5 flex items-center justify-center">PVI Score <MetricInfo text={METRIC_INFO.pvi} /></div>
              <div className={`text-sm font-mono font-bold ${synthDetail.pviScore >= 60 ? "text-emerald-400" : synthDetail.pviScore < 40 ? "text-rose-400" : "text-foreground"}`}>
                {synthDetail.pviScore.toFixed(1)}
              </div>
              <div className="text-[10px] text-muted-foreground">/ 100</div>
            </div>
          </div>

          <div className={`rounded-lg border p-2.5 ${isOvervalued ? "bg-rose-500/[0.04] border-rose-500/15" : "bg-emerald-500/[0.04] border-emerald-500/15"}`}>
            <div className="text-[9px] text-muted-foreground/55 uppercase tracking-wider mb-2">Fair Value vs Market Price</div>
            <div className="flex items-end justify-between gap-3 mb-2">
              <div>
                <div className="text-[9px] text-muted-foreground/50 mb-0.5">Fair Value</div>
                <div className="text-base font-mono font-bold text-foreground">${fv.toFixed(2)}</div>
              </div>
              <div className={`text-xs font-bold px-2 py-1 rounded ${isOvervalued ? "bg-rose-500/15 text-rose-400" : "bg-emerald-500/15 text-emerald-400"}`}>
                {isOvervalued ? "▲" : "▼"} {Math.abs(fvDiff).toFixed(1)}%
              </div>
              <div className="text-right">
                <div className="text-[9px] text-muted-foreground/50 mb-0.5">Market</div>
                <div className="text-base font-mono font-bold text-foreground">${price.toFixed(2)}</div>
              </div>
            </div>
            <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
              <div
                className={`h-full rounded-full ${isOvervalued ? "bg-rose-500/60" : "bg-emerald-500/60"}`}
                style={{ width: `${Math.max(5, Math.min(95, 100 - Math.abs(fvDiff))).toFixed(0)}%` }}
              />
            </div>
            <div className={`text-center mt-1.5 text-[10px] font-semibold ${isOvervalued ? "text-rose-400/70" : "text-emerald-400/70"}`}>
              {isOvervalued ? "Trading above fair value" : "Trading below fair value"}
            </div>
          </div>

          {val && (
            <div className="space-y-2.5">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">PVI Components</div>
              <ScoreBar label="Recent Performance" value={val.pviComponents?.recentPerformance ?? null} color="bg-blue-500" />
              <ScoreBar label="Consistency" value={val.pviComponents?.consistency ?? null} color="bg-purple-500" />
              <ScoreBar label="Historical Skill" value={val.pviComponents?.historicalSkill ?? null} color="bg-amber-500" />
              <ScoreBar label="Activity Score" value={val.pviComponents?.activityScore ?? null} color="bg-emerald-500" />
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-white/3 border border-white/5 p-2">
              <div className="text-[10px] text-muted-foreground mb-0.5">Signal</div>
              <div className={`text-xs font-mono font-bold ${synthDetail.signal.includes("BUY") ? "text-emerald-400" : synthDetail.signal.includes("SELL") ? "text-rose-400" : "text-amber-400"}`}>
                {synthDetail.signal}
              </div>
            </div>
            <div className="rounded-lg bg-white/3 border border-white/5 p-2">
              <div className="text-[10px] text-muted-foreground mb-0.5">Archetype</div>
              <div className="text-xs font-mono font-bold text-foreground truncate">
                {synthDetail.archetype.replace(/_/g, " ")}
              </div>
            </div>
          </div>

          <div className="rounded-lg bg-white/3 border border-white/5 p-2.5">
            <div className="text-[10px] text-muted-foreground mb-1.5 uppercase tracking-wider">Strengths</div>
            <div className="flex flex-wrap gap-1">
              {synthDetail.strengths.map((s) => (
                <span key={s} className="px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-[10px] text-emerald-400">{s}</span>
              ))}
            </div>
          </div>

          <div className="rounded-lg bg-white/3 border border-white/5 p-2.5">
            <div className="text-[10px] text-muted-foreground mb-1.5 uppercase tracking-wider">Weaknesses</div>
            <div className="flex flex-wrap gap-1">
              {synthDetail.weaknesses.map((w) => (
                <span key={w} className="px-1.5 py-0.5 rounded bg-rose-500/10 border border-rose-500/20 text-[10px] text-rose-400">{w}</span>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const isLoading = realLoading;
  const data = realData;

  if (isLoading) {
    return (
      <div className="flex flex-col h-full p-4 gap-3">
        {[...Array(8)].map((_, i) => <div key={i} className="h-6 bg-white/5 rounded animate-pulse" />)}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-2 p-4">
        <p className="text-xs text-muted-foreground">No fundamentals data</p>
      </div>
    );
  }

  const price = parseFloat(asset.lastTradePrice);
  const fv = data.fairValueGS;
  const fvDiff = fv && price > 0 ? ((price - fv) / fv) * 100 : null;
  const isOvervalued = fvDiff != null && fvDiff > 0;

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-card">
      <div className="px-3 py-2 border-b border-white/5 shrink-0">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-foreground">{asset.displayName}</span>
          <span className="text-xs text-muted-foreground font-mono">{getAssetGameLabel(asset.assetUid)}</span>
        </div>
      </div>

      <div className="p-3 space-y-4">
        {/* Record & LP */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg bg-white/3 border border-white/5 p-2 text-center">
            <div className="text-[10px] text-muted-foreground mb-0.5 flex items-center justify-center">Win Rate <MetricInfo text={METRIC_INFO.winRate} /></div>
            <div className={`text-sm font-mono font-bold ${(data.winRate ?? 0) >= 55 ? "text-emerald-400" : (data.winRate ?? 0) < 50 ? "text-rose-400" : "text-foreground"}`}>
              {data.winRate != null ? `${data.winRate.toFixed(1)}%` : "—"}
            </div>
            <div className="text-[10px] text-muted-foreground">{data.wins ?? "—"}W / {data.losses ?? "—"}L</div>
          </div>
          {data.leaguePoints != null ? (
            <div className="rounded-lg bg-white/3 border border-white/5 p-2 text-center">
              <div className="text-[10px] text-muted-foreground mb-0.5 flex items-center justify-center">LP <MetricInfo text={METRIC_INFO.lp} /></div>
              <div className="text-sm font-mono font-bold text-primary">{data.leaguePoints.toLocaleString()}</div>
              <div className="text-[10px] text-muted-foreground">LoL</div>
            </div>
          ) : (
            <div className="rounded-lg bg-white/3 border border-white/5 p-2 text-center">
              <div className="text-[10px] text-muted-foreground mb-0.5">Matches</div>
              <div className="text-sm font-mono font-bold text-primary">{data.games ?? "—"}</div>
              <div className="text-[10px] text-muted-foreground">played</div>
            </div>
          )}
          <div className="rounded-lg bg-white/3 border border-white/5 p-2 text-center">
            <div className="text-[10px] text-muted-foreground mb-0.5 flex items-center justify-center">Perf Score <MetricInfo text={METRIC_INFO.pvi} /></div>
            <div className={`text-sm font-mono font-bold ${(data.pviFinal ?? 50) >= 60 ? "text-emerald-400" : (data.pviFinal ?? 50) < 40 ? "text-rose-400" : "text-foreground"}`}>
              {data.pviFinal?.toFixed(1) ?? "—"}
            </div>
            <div className="text-[10px] text-muted-foreground">/ 100</div>
          </div>
        </div>

        {/* Fair Value */}
        {fv != null && fvDiff != null && (
          <div className={`rounded-lg border p-2.5 ${isOvervalued ? "bg-rose-500/[0.04] border-rose-500/15" : "bg-emerald-500/[0.04] border-emerald-500/15"}`}>
            <div className="text-[9px] text-muted-foreground/55 uppercase tracking-wider mb-2">Fair Value vs Market Price</div>
            <div className="flex items-end justify-between gap-3 mb-2">
              <div>
                <div className="text-[9px] text-muted-foreground/50 mb-0.5">Fair Value</div>
                <div className="text-base font-mono font-bold text-foreground">${fv.toFixed(2)}</div>
              </div>
              <div className={`text-xs font-bold px-2 py-1 rounded ${isOvervalued ? "bg-rose-500/15 text-rose-400" : "bg-emerald-500/15 text-emerald-400"}`}>
                {isOvervalued ? "▲" : "▼"} {Math.abs(fvDiff).toFixed(1)}%
              </div>
              <div className="text-right">
                <div className="text-[9px] text-muted-foreground/50 mb-0.5">Market</div>
                <div className="text-base font-mono font-bold text-foreground">${price.toFixed(2)}</div>
              </div>
            </div>
            <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
              <div
                className={`h-full rounded-full ${isOvervalued ? "bg-rose-500/60" : "bg-emerald-500/60"}`}
                style={{ width: `${Math.max(5, Math.min(95, 100 - Math.abs(fvDiff))).toFixed(0)}%` }}
              />
            </div>
            <div className={`text-center mt-1.5 text-[10px] font-semibold ${isOvervalued ? "text-rose-400/70" : "text-emerald-400/70"}`}>
              {isOvervalued ? "Trading above fair value" : "Trading below fair value"}
            </div>
          </div>
        )}

        {/* PVI Components */}
        <div className="space-y-2.5">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">PVI Components</div>
          <ScoreBar label="Recent Performance" value={data.recentPerformance} color="bg-blue-500" />
          <ScoreBar label="Consistency" value={data.consistencyScore} color="bg-purple-500" />
          <ScoreBar label="Historical Skill" value={data.historicalSkill} color="bg-amber-500" />
          <ScoreBar label="Activity Score" value={data.activityScore} color="bg-emerald-500" />
        </div>

        {/* Momentum & Confidence */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-white/3 border border-white/5 p-2">
            <div className="text-[10px] text-muted-foreground mb-0.5 flex items-center">Momentum <MetricInfo text={METRIC_INFO.momentum} /></div>
            <div className={`text-sm font-mono font-bold ${(data.momentum ?? 0) > 0 ? "text-emerald-400" : (data.momentum ?? 0) < 0 ? "text-rose-400" : "text-muted-foreground"}`}>
              {data.momentum != null ? `${data.momentum > 0 ? "+" : ""}${data.momentum.toFixed(4)}` : "—"}
            </div>
          </div>
          <div className="rounded-lg bg-white/3 border border-white/5 p-2">
            <div className="text-[10px] text-muted-foreground mb-0.5">Confidence</div>
            <div className="text-sm font-mono font-bold text-foreground">
              {data.confidence != null ? `${(data.confidence * 100).toFixed(0)}%` : "—"}
            </div>
          </div>
        </div>

        {/* Divergence */}
        {data.divergencePct != null && (
          <div className="rounded-lg bg-white/3 border border-white/5 p-2.5">
            <div className="text-[10px] text-muted-foreground mb-1">Price Divergence from Fair Value</div>
            <div className={`text-sm font-mono font-bold ${Math.abs(data.divergencePct) > 25 ? "text-amber-400" : "text-foreground"}`}>
              {data.divergencePct > 0 ? "+" : ""}{data.divergencePct.toFixed(2)}%
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {Math.abs(data.divergencePct) > 25 ? "⚠ High divergence — potential mean reversion" : "Within normal range"}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── TradeTape ────────────────────────────────────────────────────────────────

function TradeTape() {
  const { state, dispatch } = useTerminal();
  const prevIdsRef = useRef<Set<number>>(new Set());
  const [flashIds, setFlashIds] = useState<Set<number>>(new Set());

  const { data: globalTrades, isLoading: loadingGlobal } = useQuery<TradeRow[]>({
    queryKey: ["/api/market/trades/recent"],
    queryFn: async () => {
      const res = await fetch("/api/market/trades/recent", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load activity");
      return res.json();
    },
    refetchInterval: 4000,
  });

  const { data: myTrades, isLoading: loadingMine } = useQuery<TradeRow[]>({
    queryKey: ["/api/terminal/activity/me"],
    queryFn: async () => {
      const res = await fetch("/api/terminal/activity/me", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load my trades");
      return res.json();
    },
    refetchInterval: 5000,
    enabled: state.activityTab === "mine",
  });

  const isLoading = state.activityTab === "recent" ? loadingGlobal : loadingMine;
  const rows = state.activityTab === "recent" ? (globalTrades ?? []) : (myTrades ?? []);

  useEffect(() => {
    const newIds = new Set<number>();
    rows.forEach((r) => {
      if (!prevIdsRef.current.has(r.id)) newIds.add(r.id);
    });
    if (newIds.size > 0) {
      setFlashIds(newIds);
      const t = setTimeout(() => setFlashIds(new Set()), 800);
      prevIdsRef.current = new Set(rows.map((r) => r.id));
      return () => clearTimeout(t);
    }
    prevIdsRef.current = new Set(rows.map((r) => r.id));
  }, [rows]);

  function sizeTier(total: number): { label: string; color: string } {
    if (total >= 500) return { label: "XL", color: "text-amber-400" };
    if (total >= 200) return { label: "LG", color: "text-sky-400" };
    if (total >= 100) return { label: "MD", color: "text-slate-300" };
    return { label: "SM", color: "text-muted-foreground" };
  }

  return (
    <div className="flex flex-col h-full bg-card/50 border-r border-white/5 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/5 shrink-0">
        <div className="flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-primary/70" />
          <span className="text-xs font-semibold text-foreground">Trade Tape</span>
        </div>
        <div className="flex items-center gap-1">
          {[{ id: "recent", label: "Global" }, { id: "mine", label: "Mine" }].map((t) => (
            <button
              key={t.id}
              data-testid={`trade-tape-tab-${t.id}`}
              onClick={() => dispatch({ type: "SET_ACTIVITY_TAB", tab: t.id as ActivityTab })}
              className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${state.activityTab === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto font-mono">
        {isLoading ? (
          <div className="space-y-px p-1">{[...Array(8)].map((_, i) => <div key={i} className="h-7 bg-white/5 rounded animate-pulse" />)}</div>
        ) : rows.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground">
            {state.activityTab === "mine" ? "No trades yet" : "Waiting for trades…"}
          </div>
        ) : (
          rows.map((t) => {
            const total = t.shares * parseFloat(t.pricePerShare);
            const tier = sizeTier(total);
            const isBuy = t.type === "BUY";
            const isNew = flashIds.has(t.id);
            return (
              <div
                key={t.id}
                data-testid={`trade-tape-row-${t.id}`}
                className={`flex items-center gap-2 px-2 py-1 border-b border-white/[0.04] transition-all duration-300 ${isBuy ? "hover:bg-emerald-500/5" : "hover:bg-rose-500/5"} ${isNew ? (isBuy ? "bg-emerald-500/15" : "bg-rose-500/15") : ""}`}
              >
                {isBuy ? (
                  <ArrowUpRight className="w-3 h-3 text-emerald-400 shrink-0" />
                ) : (
                  <ArrowDownRight className="w-3 h-3 text-rose-400 shrink-0" />
                )}
                <span className={`text-[10px] font-bold w-14 truncate ${isBuy ? "text-emerald-400" : "text-rose-400"}`}>
                  {t.playerName}
                </span>
                <span className="text-[10px] text-muted-foreground w-5 shrink-0">{t.shares}x</span>
                <span className={`text-[10px] font-bold flex-1 text-right ${isBuy ? "text-emerald-300" : "text-rose-300"}`}>
                  ${parseFloat(t.pricePerShare).toFixed(2)}
                </span>
                <span className={`text-[10px] w-6 text-right shrink-0 ${tier.color}`}>{tier.label}</span>
                <span className="text-[9px] text-muted-foreground w-10 text-right shrink-0">{fmtTime(t.executedAt)}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── DiscoveryPanel ───────────────────────────────────────────────────────────

const DISCOVERY_ICONS: Record<string, React.ReactNode> = {
  UNDERVALUED_GEM: <Star className="w-3.5 h-3.5 text-emerald-400 shrink-0" />,
  BREAKOUT_CANDIDATE: <Target className="w-3.5 h-3.5 text-sky-400 shrink-0" />,
  MOMENTUM_SURGE: <Flame className="w-3.5 h-3.5 text-amber-400 shrink-0" />,
  MEAN_REVERSION: <RefreshCw className="w-3.5 h-3.5 text-purple-400 shrink-0" />,
  HOT_STREAK: <Sparkles className="w-3.5 h-3.5 text-rose-400 shrink-0" />,
};

const DISCOVERY_BADGE_COLORS: Record<string, string> = {
  UNDERVALUED_GEM: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400",
  BREAKOUT_CANDIDATE: "bg-sky-500/10 border-sky-500/20 text-sky-400",
  MOMENTUM_SURGE: "bg-amber-500/10 border-amber-500/20 text-amber-400",
  MEAN_REVERSION: "bg-purple-500/10 border-purple-500/20 text-purple-400",
  HOT_STREAK: "bg-rose-500/10 border-rose-500/20 text-rose-400",
};

const DISCOVERY_LABELS: Record<string, string> = {
  UNDERVALUED_GEM: "Gem",
  BREAKOUT_CANDIDATE: "Breakout",
  MOMENTUM_SURGE: "Momentum",
  MEAN_REVERSION: "Reversion",
  HOT_STREAK: "Hot",
};

function DiscoveryPanel() {
  const { model, isSyntheticMode, setSelectedSynth } = useSynthetic();
  const { dispatch } = useTerminal();

  if (!isSyntheticMode || !model) {
    return (
      <div className="flex flex-col h-full bg-card overflow-hidden">
        <PanelHeader>Discovery</PanelHeader>
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center space-y-2">
            <Telescope className="w-8 h-8 text-muted-foreground/20 mx-auto" />
            <p className="text-xs text-muted-foreground">Discovery signals appear in demo mode</p>
          </div>
        </div>
      </div>
    );
  }

  const signals = model.discovery;

  return (
    <div className="flex flex-col h-full bg-card overflow-hidden">
      <PanelHeader action={
        <span className="text-[10px] text-purple-400 font-mono px-1.5 py-0.5 rounded bg-purple-500/10 border border-purple-500/20">DEMO</span>
      }>
        Discovery
      </PanelHeader>

      {/* Market micro-index */}
      <div className="grid grid-cols-3 gap-px bg-white/5 border-b border-white/5 shrink-0">
        {[
          { label: "Market", value: `${model.index.overall >= 0 ? "+" : ""}${model.index.overall.toFixed(2)}%`, color: model.index.overall >= 0 ? "text-emerald-400" : "text-rose-400" },
          { label: "Gainers", value: String(model.index.breadth.gainers), color: "text-emerald-400" },
          { label: "Losers", value: String(model.index.breadth.losers), color: "text-rose-400" },
        ].map((s) => (
          <div key={s.label} className="bg-card px-2 py-1.5 text-center">
            <div className="text-[9px] text-muted-foreground">{s.label}</div>
            <div className={`text-xs font-mono font-bold ${s.color}`}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {signals.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground">No active signals</div>
        ) : (
          <div className="divide-y divide-white/5">
            {signals.map((sig) => {
              const badgeClass = DISCOVERY_BADGE_COLORS[sig.type] ?? "bg-white/10 text-muted-foreground";
              return (
                <button
                  key={sig.playerId}
                  onClick={() => {
                    const row = model.rows.find((r) => r.id === sig.playerId);
                    if (row) {
                      setSelectedSynth(row);
                      dispatch({ type: "SELECT_ASSET", asset: synthToMarketRow(row) });
                      dispatch({ type: "SET_CHART_TAB", tab: "fundamentals" });
                    }
                  }}
                  className="w-full text-left px-3 py-2.5 hover:bg-white/5 transition-colors group"
                >
                  <div className="flex items-start gap-2">
                    {DISCOVERY_ICONS[sig.type]}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                        <span className="text-xs font-semibold text-foreground">{sig.displayName}</span>
                        <span className={`text-[9px] font-bold px-1 py-0.5 rounded border ${badgeClass}`}>
                          {DISCOVERY_LABELS[sig.type]}
                        </span>
                        <span className="text-[10px] text-muted-foreground font-mono ml-auto">${sig.currentPrice.toFixed(2)}</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground leading-snug line-clamp-2">{sig.headline}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[9px] text-muted-foreground">FV: <span className="text-foreground font-mono">${sig.fairValue.toFixed(2)}</span></span>
                        {sig.currentPrice < sig.fairValue && (
                          <span className="text-[9px] text-emerald-400 font-mono">
                            +{(((sig.fairValue - sig.currentPrice) / sig.currentPrice) * 100).toFixed(1)}% upside
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-t border-white/5 px-3 py-2 shrink-0">
        <p className="text-[9px] text-muted-foreground/60 text-center">
          Signals are simulated. Connect a Riot account to trade real assets.
        </p>
      </div>
    </div>
  );
}

// ─── SyntheticTradeTape ───────────────────────────────────────────────────────

function SyntheticTradeTape() {
  const { model } = useSynthetic();
  const ticks = model?.tape ?? [];

  function sizeTier(total: number): { label: string; color: string } {
    if (total >= 500) return { label: "XL", color: "text-amber-400" };
    if (total >= 200) return { label: "LG", color: "text-sky-400" };
    if (total >= 100) return { label: "MD", color: "text-slate-300" };
    return { label: "SM", color: "text-muted-foreground" };
  }

  return (
    <div className="flex flex-col h-full bg-card/50 border-r border-white/5 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/5 shrink-0">
        <div className="flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-purple-400/70" />
          <span className="text-xs font-semibold text-foreground">Demo Tape</span>
        </div>
        <span className="text-[10px] text-purple-400 font-mono px-1.5 py-0.5 rounded bg-purple-500/10 border border-purple-500/20">DEMO</span>
      </div>
      <div className="flex-1 overflow-y-auto font-mono">
        {ticks.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground">No demo trades yet</div>
        ) : (
          ticks.map((t) => {
            const total = t.shares * parseFloat(t.pricePerShare);
            const tier = sizeTier(total);
            const isBuy = t.type === "BUY";
            return (
              <div
                key={t.id}
                className={`flex items-center gap-2 px-2 py-1 border-b border-white/[0.04] ${isBuy ? "hover:bg-emerald-500/5" : "hover:bg-rose-500/5"}`}
              >
                {isBuy ? (
                  <ArrowUpRight className="w-3 h-3 text-emerald-400 shrink-0" />
                ) : (
                  <ArrowDownRight className="w-3 h-3 text-rose-400 shrink-0" />
                )}
                <span className={`text-[10px] font-bold w-14 truncate ${isBuy ? "text-emerald-400" : "text-rose-400"}`}>
                  {t.displayName}
                </span>
                <span className="text-[10px] text-muted-foreground w-5 shrink-0">{t.shares}x</span>
                <span className={`text-[10px] font-bold flex-1 text-right ${isBuy ? "text-emerald-300" : "text-rose-300"}`}>
                  ${parseFloat(t.pricePerShare).toFixed(2)}
                </span>
                <span className={`text-[10px] w-6 text-right shrink-0 ${tier.color}`}>{tier.label}</span>
                <span className="text-[9px] text-muted-foreground w-10 text-right shrink-0">{fmtTime(t.executedAt)}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── DemoBadge ────────────────────────────────────────────────────────────────

function DemoBadge() {
  const { isSyntheticMode } = useSynthetic();
  if (!isSyntheticMode) return null;

  return (
    <span className="flex items-center gap-1 px-2 py-1 rounded-md bg-violet-500/12 border border-violet-500/25 text-[9px] font-bold text-violet-400 tracking-widest uppercase shrink-0">
      <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
      Demo
    </span>
  );
}

// ─── Mobile Tabs ─────────────────────────────────────────────────────────────

function MobileNav() {
  const { state, dispatch } = useTerminal();
  const { data: ordersData } = useQuery<{ orders: TriggerOrderRow[] }>({
    queryKey: ["/api/orders/me"],
    queryFn: async () => {
      const res = await fetch("/api/orders/me?status=OPEN", { credentials: "include" });
      if (!res.ok) return { orders: [] };
      return res.json();
    },
    staleTime: 10000,
  });
  const openOrderCount = ordersData?.orders?.length ?? 0;
  const tabs = [
    { id: "scanner", label: "Scan", icon: <Search className="w-4 h-4" /> },
    { id: "chart", label: "Chart", icon: <BarChart3 className="w-4 h-4" /> },
    { id: "trade", label: "Trade", icon: <Zap className="w-4 h-4" /> },
    { id: "orders", label: "Orders", icon: <Clock className="w-4 h-4" />, badge: openOrderCount > 0 ? openOrderCount : null },
    { id: "activity", label: "Feed", icon: <Activity className="w-4 h-4" /> },
  ];
  return (
    <div className="flex border-t border-white/5 bg-card shrink-0 md:hidden">
      {tabs.map((t) => (
        <button
          key={t.id}
          data-testid={`mobile-tab-${t.id}`}
          onClick={() => dispatch({ type: "SET_MOBILE_TAB", tab: t.id as any })}
          className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-xs transition-colors ${
            state.mobileTab === t.id ? "text-primary" : "text-muted-foreground"
          }`}
        >
          <div className="relative">
            {t.icon}
            {"badge" in t && t.badge ? (
              <span className="absolute -top-1.5 -right-1.5 bg-primary text-primary-foreground text-xs font-bold rounded-full w-3.5 h-3.5 flex items-center justify-center">
                {t.badge}
              </span>
            ) : null}
          </div>
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ─── Terminal Page ────────────────────────────────────────────────────────────

export default function TerminalPage() {
  const { state, dispatch } = useTerminal();
  const [selectedSynth, setSelectedSynth] = useState<SyntheticRow | null>(null);

  const { data: marketData } = useQuery<{ total: number }>({
    queryKey: ["/api/market/assets", "count-check"],
    queryFn: async () => {
      const p = new URLSearchParams({ limit: "1" });
      const res = await fetch(`/api/market/assets?${p}`, { credentials: "include" });
      if (!res.ok) return { total: 0 };
      return res.json();
    },
    staleTime: 60000,
    refetchInterval: 60000,
  });

  const realTotal = marketData?.total ?? null;
  const isMarketLoading = realTotal === null;
  const isSyntheticMode = realTotal === 0;

  const { data: synthModel } = useQuery<SyntheticTerminalModel>({
    queryKey: ["/api/synthetic/terminal"],
    queryFn: async () => {
      const res = await fetch("/api/synthetic/terminal", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load synthetic market");
      return res.json();
    },
    enabled: isSyntheticMode,
    staleTime: 30000,
    refetchInterval: 60000,
  });

  const synthCtxValue: SyntheticCtxValue = useMemo(() => ({
    model: synthModel ?? null,
    isSyntheticMode,
    selectedSynth,
    setSelectedSynth,
  }), [synthModel, isSyntheticMode, selectedSynth]);

  return (
    <SyntheticContext.Provider value={synthCtxValue}>
        <div className="flex flex-col h-full">

          {/* ── Control bar ── */}
          <div className="flex items-center gap-3 px-4 py-2 border-b border-white/5 bg-card/95 shrink-0">
            <div className="flex items-center gap-1">
              {(["all", "dota2", "cs2"] as const).map((g) => {
                const labels: Record<string, string> = { all: "All Games", dota2: "Dota 2", cs2: "CS2" };
                const active = state.gameFilter === g;
                return (
                  <button
                    key={g}
                    data-testid={`game-filter-${g}`}
                    onClick={() => dispatch({ type: "SET_GAME_FILTER", gameFilter: g })}
                    className={`text-xs rounded-full px-2.5 py-1 transition-colors border ${
                      active
                        ? "bg-primary/15 border-primary/40 text-primary font-semibold"
                        : "bg-white/[0.04] border-white/8 text-muted-foreground/70 hover:text-muted-foreground hover:bg-white/[0.07]"
                    }`}
                  >
                    {labels[g]}
                  </button>
                );
              })}
              <span className="ml-1 text-xs bg-white/[0.04] border border-white/8 rounded-full px-2.5 py-1 text-muted-foreground/70">
                {isSyntheticMode ? "Demo" : "Live"}
              </span>
            </div>

            <div className="flex-1" />
            <DemoBadge />
          </div>

          {/* ── Desktop: Loading gate — neither layout mounts until marketData resolves ── */}
          {isMarketLoading && (
            <div className="hidden md:flex flex-1 items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                <span className="text-xs text-muted-foreground/50 tracking-widest uppercase">Loading market…</span>
              </div>
            </div>
          )}

          {/* Momentum Index strip (desktop only, real mode only) */}
          {!isMarketLoading && !isSyntheticMode && (
            <div className="hidden md:block">
              <ErrorBoundary label="Momentum Index" fallback={<div className="h-8 border-b border-white/5 bg-black/10" />}>
                <MomentumIndex />
              </ErrorBoundary>
            </div>
          )}

          {/* ── Desktop: Premium Demo Layout ── */}
          {!isMarketLoading && isSyntheticMode && (
            <div className="hidden md:flex flex-1 overflow-hidden">
              <ErrorBoundary label="Premium Demo">
                <PremiumDemoLayout />
              </ErrorBoundary>
            </div>
          )}

          {/* ── Desktop: Home Layout ── */}
          {!isMarketLoading && !isSyntheticMode && (
            <div className="hidden md:flex flex-col flex-1 overflow-hidden min-h-0">
              {/* ── Last Activity Pulse strip ── */}
              <ErrorBoundary label="Pulse" fallback={<div className="h-7 border-b border-white/[0.04] shrink-0" />}>
                <LastActivityPulse />
              </ErrorBoundary>

              {/* ── Scrollable content: Featured + Market Grid ── */}
              <div className="flex-1 overflow-y-auto min-h-0">
                <ErrorBoundary label="Discovery">
                  <DiscoveryHeroSection />
                </ErrorBoundary>
                <ErrorBoundary label="Player Market">
                  <PlayerMarketGrid />
                </ErrorBoundary>
              </div>
            </div>
          )}

          {/* ── Mobile panels ── */}
          <div className="flex md:hidden flex-1 overflow-hidden flex-col">
            <div className="flex-1 overflow-hidden">
              {state.mobileTab === "scanner" && <ErrorBoundary label="Scanner"><MarketScanner /></ErrorBoundary>}
              {state.mobileTab === "chart" && <ErrorBoundary label="Chart"><AssetChartSummary /></ErrorBoundary>}
              {state.mobileTab === "trade" && (
                <ErrorBoundary label="Trade Ticket">
                  {isMarketLoading ? (
                    <div className="flex flex-col items-center justify-center h-full gap-3">
                      <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                    </div>
                  ) : isSyntheticMode ? (
                    <div className="flex flex-col items-center justify-center h-full gap-3 p-6">
                      <Sparkles className="w-8 h-8 text-purple-400" />
                      <p className="text-sm text-purple-300 font-medium text-center">Demo Mode — Trading Disabled</p>
                      <p className="text-xs text-muted-foreground text-center">Connect a Riot account to trade real assets</p>
                    </div>
                  ) : <TradeTicket />}
                </ErrorBoundary>
              )}
              {state.mobileTab === "orders" && <ErrorBoundary label="Orders"><OpenOrdersPanel /></ErrorBoundary>}
              {state.mobileTab === "activity" && (
                <ErrorBoundary label="Trade Tape">
                  {isMarketLoading ? null : isSyntheticMode ? <SyntheticTradeTape /> : <TradeTape />}
                </ErrorBoundary>
              )}
            </div>
            <MobileNav />
          </div>

        </div>

    </SyntheticContext.Provider>
  );
}

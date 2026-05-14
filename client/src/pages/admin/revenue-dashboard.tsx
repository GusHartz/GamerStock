import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminLayout } from "./layout";
import { isPredictEnabled } from "@/lib/featureFlags";
import { motion } from "framer-motion";
import {
  TrendingUp, TrendingDown, Wallet, Users, Droplets, Activity,
  ArrowUpRight, ArrowDownRight, DollarSign, BarChart2, CheckCircle2,
  AlertTriangle, XCircle, Sliders, Info,
} from "lucide-react";
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip as RechTooltip,
  ResponsiveContainer, Legend,
} from "recharts";

// ─── Types ────────────────────────────────────────────────────────────────────

type PeriodMetrics = {
  tradeCount: number; grossVolume: number; totalFees: number;
  platformRevenue: number; playerPool: number; liquidityPool: number;
  activeTraders: number; activePlayers: number; averageTradeSize: number;
  effectiveTakeRate: number; feeYield: number; revenuePerTrader: number;
  revenuePerTrade: number; volumePerActiveTrader: number;
  volumePerActivePlayer: number; tradesPerActiveTrader: number;
  liquidityRatio: number; concentrationRatio: number; annualizedRunRate: number;
};
type TrendPoint  = { bucket: string; grossVolume: number; platformRevenue: number; totalFees: number; tradeCount: number };
type TopPlayer   = { assetId: number; displayName: string; volume: number; tradeCount: number; share: number; rank: number };
type Conc        = { top1Pct: number; top5Pct: number; top10Pct: number; longTailPct: number };
type EngineBreakdownSide = { current: PeriodMetrics; previous: PeriodMetrics | null };
type IntelData   = {
  period: string; currency: string; comparisonAvailable: boolean;
  engine?: string;
  current: PeriodMetrics; previous: PeriodMetrics | null;
  trend: TrendPoint[]; topPlayers: TopPlayer[];
  concentration: Conc; liqBalance: number;
  breakdown?: { trade: EngineBreakdownSide; prediction: EngineBreakdownSide };
};
type FeeCapture = {
  id: number; referenceType: string; referenceId: string; assetId: number | null;
  currency: string; notional: string; feeTotal: string;
  platformFee: string; playerFee: string; liquidityFee: string; createdAt: string;
};
type WalletActivity = {
  walletType: string; currency: string; direction: "credit"|"debit";
  amount: string; balanceAfter: string; description: string|null; createdAt: string;
};
type TreasuryData = {
  period: string;
  systemWallets: { walletType: string; currency: string; balance: string; periodDelta: string }[];
  periodMetrics:  { currency: string; tradeCount: number; grossVolume: string; feeTotal: string; platformFee: string; playerFee: string; liquidityFee: string }[];
  recentFeeCaptures: FeeCapture[];
  recentWalletActivity: WalletActivity[];
};

// ─── Constants ────────────────────────────────────────────────────────────────

const PERIODS = [
  { key: "today", label: "Today" }, { key: "7d", label: "7d" },
  { key: "30d", label: "30d" }, { key: "90d", label: "90d" }, { key: "all", label: "All Time" },
] as const;

const TABS = [
  { key: "overview",   label: "Overview" },
  { key: "health",     label: "Market Health" },
  { key: "analytics",  label: "Revenue Analytics" },
  { key: "valuation",  label: "Valuation" },
] as const;

// Centralised health thresholds — adjust to tune diagnostics
const HT = {
  liquidityRatio:     { healthy: 0.5,  warning: 0.2 },
  concentrationRatio: { healthy: 0.4,  warning: 0.65 },
  avgTradeSize:       { healthy: 10,   warning: 2 },
  tradesPerTrader:    { healthy: 3,    warning: 1.2 },
  activePlayers:      { healthy: 20,   warning: 5 },
};

const CC = { vol: "#3b82f6", rev: "#8b5cf6", fees: "#f59e0b", traders: "#10b981", players: "#06b6d4" };

// ─── Formatters ───────────────────────────────────────────────────────────────

const fc = (v: number, compact = false) => {
  if (isNaN(v) || v == null) return "—";
  if (compact) {
    if (v >= 1_000_000) return `$${(v/1_000_000).toFixed(2)}M`;
    if (v >= 1_000)     return `$${(v/1_000).toFixed(1)}K`;
  }
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
};
const fp = (v: number, d = 2) => `${(v * 100).toFixed(d)}%`;
const fn = (v: number, d = 0) => v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtBucket = (b: string, p: string) => {
  if (!b) return "";
  const d = new Date(b);
  return p === "today"
    ? `${d.getUTCHours().toString().padStart(2,"0")}:00`
    : `${d.getUTCMonth()+1}/${d.getUTCDate()}`;
};
const relTime = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60)    return `${Math.floor(s)}s ago`;
  if (s < 3600)  return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
};
const walletLabel = (t: string) =>
  t === "platform_revenue" ? "Platform Revenue" : t === "player_pool" ? "Player Pool" : "Liquidity Pool";

// ─── Reusable UI ──────────────────────────────────────────────────────────────

function Sk({ className="" }: { className?: string }) {
  return <div className={`bg-white/5 rounded-lg animate-pulse ${className}`} />;
}

function SectionSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {Array.from({ length: 6 }).map((_,i) => <Sk key={i} className="h-28" />)}
      </div>
      <Sk className="h-52" /><Sk className="h-52" />
    </div>
  );
}

function Delta({ curr, prev }: { curr: number; prev: number | null | undefined }) {
  if (prev == null || prev === 0) return null;
  const d = curr - prev, pct = (d / prev) * 100, pos = d >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-mono font-semibold ${pos ? "text-emerald-400" : "text-rose-400"}`}>
      {pos ? <ArrowUpRight className="w-3 h-3"/> : <ArrowDownRight className="w-3 h-3"/>}
      {pos ? "+" : ""}{pct.toFixed(1)}%
    </span>
  );
}

function KpiCard({ label, value, sub, curr, prev, icon: Icon, color="text-white", delay=0 }: {
  label: string; value: string; sub?: string;
  curr?: number; prev?: number | null;
  icon?: any; color?: string; delay?: number;
}) {
  return (
    <motion.div initial={{ opacity:0, y:12 }} animate={{ opacity:1, y:0 }} transition={{ delay }}
      className="bg-card border border-white/10 rounded-2xl p-4 flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        {Icon && <Icon className="w-3.5 h-3.5 text-muted-foreground/40" />}
      </div>
      <div className={`text-xl font-display font-bold tracking-tight leading-none ${color}`}>{value}</div>
      <div className="flex items-center justify-between min-h-[16px]">
        {sub && <span className="text-[11px] text-muted-foreground font-mono">{sub}</span>}
        {curr != null && prev != null && <Delta curr={curr} prev={prev} />}
      </div>
    </motion.div>
  );
}

function ChartCard({ title, children, className="" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-card border border-white/10 rounded-2xl p-4 ${className}`}>
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">{title}</div>
      {children}
    </div>
  );
}

const tooltipStyle = {
  contentStyle: { background:"#12121f", border:"1px solid rgba(255,255,255,0.08)", borderRadius:8, fontSize:11 },
  labelStyle: { color:"#9ca3af" },
};

function MiniTrend({ data, period, dataKey, color }: { data: TrendPoint[]; period: string; dataKey: keyof TrendPoint; color: string }) {
  const formatted = data.map(d => ({ ...d, label: fmtBucket(d.bucket, period) }));
  return (
    <ResponsiveContainer width="100%" height={100}>
      <AreaChart data={formatted} margin={{ top:2, right:2, bottom:0, left:0 }}>
        <defs>
          <linearGradient id={`g-${color.replace("#","")}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.3} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey={String(dataKey)} stroke={color} strokeWidth={1.5}
          fill={`url(#g-${color.replace("#","")})`} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ─── Health Indicator ─────────────────────────────────────────────────────────

type HealthStatus = "healthy" | "warning" | "risk";

function healthStatus(val: number, thresholds: { healthy: number; warning: number }, lowerIsBetter = false): HealthStatus {
  if (!lowerIsBetter) {
    if (val >= thresholds.healthy) return "healthy";
    if (val >= thresholds.warning) return "warning";
    return "risk";
  } else {
    if (val <= thresholds.healthy) return "healthy";
    if (val <= thresholds.warning) return "warning";
    return "risk";
  }
}

function HealthDot({ status }: { status: HealthStatus }) {
  const cls = status === "healthy" ? "text-emerald-400" : status === "warning" ? "text-amber-400" : "text-rose-400";
  const Icon = status === "healthy" ? CheckCircle2 : status === "warning" ? AlertTriangle : XCircle;
  return <Icon className={`w-4 h-4 ${cls}`} />;
}

// ─── Tab 1: Overview ──────────────────────────────────────────────────────────

function OverviewTab({ intel, treasury, period, currency, engine }: {
  intel: IntelData; treasury: TreasuryData | undefined; period: string; currency: string; engine: string;
}) {
  const isPrediction = engine === "prediction";
  const isAll        = engine === "all";
  const c = intel.current;
  const p = intel.previous;
  const currLabel = currency === "all" ? "All" : currency === "GS" ? "GS$" : "USDC";

  const feeSplitTotal = c.platformRevenue + c.playerPool + c.liquidityPool;
  const feeSplitData = feeSplitTotal > 0 ? [
    { name: "Platform", value: c.platformRevenue, pct: c.platformRevenue / feeSplitTotal, color: "#8b5cf6" },
    { name: "Player Pool", value: c.playerPool, pct: c.playerPool / feeSplitTotal, color: "#10b981" },
    { name: "Liquidity", value: c.liquidityPool, pct: c.liquidityPool / feeSplitTotal, color: "#06b6d4" },
  ] : [];

  const feeCaptures = treasury?.recentFeeCaptures ?? [];
  const walletActivity = treasury?.recentWalletActivity ?? [];

  return (
    <div className="flex flex-col gap-5">
      {/* Prediction engine note: gross volume is best-effort */}
      {isPrediction && (
        <div className="flex items-start gap-2 bg-cyan-500/8 border border-cyan-500/20 rounded-xl p-3">
          <Info className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
          <p className="text-xs text-cyan-300/80">
            <strong>Prediction Market engine.</strong> Revenue = <code className="font-mono text-[11px]">SUM(prediction_settlements.fees)</code>.
            Gross Volume = <code className="font-mono text-[11px]">SUM(prediction_orders.total_value WHERE status=&apos;filled&apos;)</code> — shows $0 if no filled orders exist yet.
            "Active Markets" = distinct markets that have had settlements.
          </p>
        </div>
      )}
      {isAll && intel.breakdown && (
        <div className="flex items-start gap-2 bg-violet-500/8 border border-violet-500/20 rounded-xl p-3">
          <Info className="w-4 h-4 text-violet-400 shrink-0 mt-0.5" />
          <p className="text-xs text-violet-300/80">
            <strong>Combined view.</strong> Revenue and fees are summed across both Trade Market and Prediction Market engines.
            See breakdown below.
          </p>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <KpiCard
          label={isPrediction ? "Gross Volume (Orders)" : "Gross Volume"}
          value={isPrediction && c.grossVolume === 0 ? "—" : fc(c.grossVolume, true)}
          sub={isPrediction ? `${fn(c.tradeCount)} settlements` : `${fn(c.tradeCount)} trades`}
          curr={c.grossVolume} prev={p?.grossVolume} color="text-blue-400" icon={TrendingUp} delay={0} />
        <KpiCard label="Platform Revenue" value={fc(c.platformRevenue, true)} sub={`${fp(c.effectiveTakeRate)} take rate`}
          curr={c.platformRevenue} prev={p?.platformRevenue} color="text-violet-400" icon={DollarSign} delay={0.04} />
        <KpiCard label="Total Fees" value={fc(c.totalFees, true)} sub={`${fp(c.feeYield)} yield`}
          curr={c.totalFees} prev={p?.totalFees} color="text-amber-400" icon={Wallet} delay={0.08} />
        <KpiCard label="Active Traders" value={fn(c.activeTraders)} sub={`${fn(c.tradesPerActiveTrader,1)} ${isPrediction ? "settlements" : "trades"}/trader`}
          curr={c.activeTraders} prev={p?.activeTraders} color="text-emerald-400" icon={Users} delay={0.12} />
        <KpiCard
          label={isPrediction ? "Active Markets" : "Active Players"}
          value={fn(c.activePlayers)}
          sub={isPrediction ? "distinct markets settled" : `${fc(c.volumePerActivePlayer,true)} vol/player`}
          curr={c.activePlayers} prev={p?.activePlayers} color="text-cyan-400" icon={Activity} delay={0.16} />
        {isPrediction ? (
          <KpiCard label="Revenue / Settlement" value={fc(c.revenuePerTrade)}
            sub="platform fee per settlement" color="text-pink-400" icon={DollarSign} delay={0.20} />
        ) : (
          <KpiCard label="Liquidity Pool" value={fc(intel.liqBalance, true)} sub={`${fp(c.liquidityRatio)} ratio`}
            color="text-sky-400" icon={Droplets} delay={0.20} />
        )}
      </div>

      {/* Fee Split — only for trade/all engines (prediction has no player/liquidity split) */}
      {!isPrediction && feeSplitTotal > 0 && (
        <div className="bg-card border border-white/10 rounded-2xl p-4">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Fee Distribution — {currLabel}</div>
          <div className="flex h-3 rounded-full overflow-hidden gap-0.5 mb-3">
            {feeSplitData.map(s => (
              <div key={s.name} style={{ width: `${s.pct*100}%`, background: s.color }} className="transition-all" />
            ))}
          </div>
          <div className="grid grid-cols-3 gap-3">
            {feeSplitData.map(s => (
              <div key={s.name} className="flex flex-col gap-0.5">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full" style={{ background: s.color }} />
                  <span className="text-xs text-muted-foreground">{s.name}</span>
                </div>
                <div className="text-sm font-mono font-bold" style={{ color: s.color }}>{fc(s.value, true)}</div>
                <div className="text-[10px] text-muted-foreground">{fp(s.pct)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Trend Charts */}
      {intel.trend.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {!isPrediction && (
            <ChartCard title="Gross Volume Trend">
              <MiniTrend data={intel.trend} period={period} dataKey="grossVolume" color={CC.vol} />
            </ChartCard>
          )}
          <ChartCard title="Platform Revenue Trend">
            <MiniTrend data={intel.trend} period={period} dataKey="platformRevenue" color={CC.rev} />
          </ChartCard>
          <ChartCard title={isPrediction ? "Settlements Trend" : "Active Trades Trend"}>
            <MiniTrend data={intel.trend} period={period} dataKey="tradeCount" color={CC.traders} />
          </ChartCard>
          {isPrediction && (
            <ChartCard title="Total Fees Trend">
              <MiniTrend data={intel.trend} period={period} dataKey="totalFees" color={CC.fees} />
            </ChartCard>
          )}
        </div>
      )}

      {/* Engine Breakdown — only for "all" engine */}
      {isAll && intel.breakdown && (
        <div className="bg-card border border-white/10 rounded-2xl p-4">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">Revenue Breakdown by Engine</div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {[
              { label: "Trade Market", data: intel.breakdown.trade, color: "#3b82f6", badge: "TRADE" },
              ...(isPredictEnabled() ? [{ label: "Prediction Market", data: intel.breakdown.prediction, color: "#8b5cf6", badge: "PREDICT" }] : []),
            ].map(({ label, data, color, badge }) => (
              <div key={badge} className="rounded-xl border border-white/8 p-3 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-white/80">{label}</span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white/70 border border-white/10"
                    style={{ background: `${color}20`, color }}>{badge}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { k: "Platform Revenue", v: fc(data.current.platformRevenue, true), color: "#8b5cf6" },
                    { k: "Total Fees",        v: fc(data.current.totalFees, true),      color: "#f59e0b" },
                    { k: "Gross Volume",      v: badge === "PREDICT" && data.current.grossVolume === 0 ? "—" : fc(data.current.grossVolume, true), color: "#3b82f6" },
                    { k: "Active Users",      v: fn(data.current.activeTraders),         color: "#10b981" },
                  ].map(item => (
                    <div key={item.k} className="flex flex-col gap-0.5">
                      <span className="text-[10px] text-muted-foreground">{item.k}</span>
                      <span className="text-sm font-mono font-bold" style={{ color: item.color }}>{item.v}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Operational Tables — only for trade/all engines */}
      {!isPrediction && (
        <>
          <FeeCapturesTable rows={feeCaptures} />
          <WalletActivityTable rows={walletActivity} />
        </>
      )}
    </div>
  );
}

// ─── Tab 2: Market Health ─────────────────────────────────────────────────────

function MarketHealthTab({ intel, period, engine }: { intel: IntelData; period: string; engine: string }) {
  const isPrediction = engine === "prediction";
  const c = intel.current;
  const p = intel.previous;

  const diagItems = [
    {
      label: "Liquidity Ratio",
      desc:  "Liquidity pool balance vs gross volume",
      value: fp(c.liquidityRatio),
      status: healthStatus(c.liquidityRatio, HT.liquidityRatio),
    },
    {
      label: "Concentration Risk",
      desc:  "Top-10 player share of total volume",
      value: fp(c.concentrationRatio),
      status: healthStatus(c.concentrationRatio, HT.concentrationRatio, true),
    },
    {
      label: "Avg Trade Size",
      desc:  "Average notional per trade",
      value: fc(c.averageTradeSize),
      status: healthStatus(c.averageTradeSize, HT.avgTradeSize),
    },
    {
      label: "Trades / Trader",
      desc:  "Repeat trading activity",
      value: fn(c.tradesPerActiveTrader, 1),
      status: healthStatus(c.tradesPerActiveTrader, HT.tradesPerTrader),
    },
    {
      label: isPrediction ? "Active Markets" : "Active Players",
      desc:  isPrediction ? "Distinct markets with settlements" : "Distinct traded assets",
      value: fn(c.activePlayers),
      status: healthStatus(c.activePlayers, HT.activePlayers),
    },
  ];

  const concData = [
    { name: "Top 1",  value: intel.concentration.top1Pct,                fill: "#8b5cf6" },
    { name: "Top 2-5", value: intel.concentration.top5Pct - intel.concentration.top1Pct, fill: "#3b82f6" },
    { name: "Top 6-10", value: intel.concentration.top10Pct - intel.concentration.top5Pct, fill: "#06b6d4" },
    { name: "Long Tail", value: intel.concentration.longTailPct, fill: "#10b981" },
  ];

  const topBarData = intel.topPlayers.slice(0, 15).map(p => ({
    name: p.displayName.length > 12 ? p.displayName.slice(0,10) + ".." : p.displayName,
    volume: p.volume,
    share:  +(p.share * 100).toFixed(1),
  }));

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <KpiCard label="Avg Trade Size" value={fc(c.averageTradeSize)} curr={c.averageTradeSize} prev={p?.averageTradeSize}
          color="text-white" icon={BarChart2} delay={0} />
        <KpiCard label="Trades / Active Trader" value={fn(c.tradesPerActiveTrader,1)} curr={c.tradesPerActiveTrader} prev={p?.tradesPerActiveTrader}
          color="text-white" icon={Activity} delay={0.04} />
        <KpiCard label="Volume / Active Trader" value={fc(c.volumePerActiveTrader, true)} curr={c.volumePerActiveTrader} prev={p?.volumePerActiveTrader}
          color="text-emerald-400" icon={Users} delay={0.08} />
        <KpiCard label={isPrediction ? "Vol / Active Market" : "Volume / Active Player"} value={fc(c.volumePerActivePlayer, true)} curr={c.volumePerActivePlayer} prev={p?.volumePerActivePlayer}
          color="text-cyan-400" icon={Activity} delay={0.12} />
        <KpiCard label="Liquidity Ratio" value={fp(c.liquidityRatio)} curr={c.liquidityRatio} prev={p?.liquidityRatio}
          color="text-sky-400" icon={Droplets} delay={0.16} />
        <KpiCard label="Concentration Ratio (Top 10)" value={fp(c.concentrationRatio)} curr={c.concentrationRatio} prev={p?.concentrationRatio}
          color="text-amber-400" icon={BarChart2} delay={0.20} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {topBarData.length > 0 && (
          <ChartCard title={isPrediction ? "Fees by Market — Top 15" : "Volume by Player — Top 15"}>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={topBarData} margin={{ top:4, right:8, bottom:48, left:0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="name" tick={{ fontSize:9, fill:"#6b7280" }} axisLine={false} tickLine={false}
                  angle={-40} textAnchor="end" interval={0} />
                <YAxis tick={{ fontSize:10, fill:"#6b7280" }} axisLine={false} tickLine={false} width={40}
                  tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : `${v}`} />
                <RechTooltip {...tooltipStyle} formatter={(v: any, n: string) => [n === "share" ? `${v}%` : fc(v), n]} />
                <Bar dataKey="volume" name="Volume" fill={CC.vol} radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        )}

        <ChartCard title="Volume Concentration Distribution">
          <div className="flex flex-col gap-3 pt-2">
            {concData.map(c => (
              <div key={c.name} className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-16 shrink-0">{c.name}</span>
                <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width:`${c.value*100}%`, background: c.fill }} />
                </div>
                <span className="text-xs font-mono text-white/70 w-12 text-right">{(c.value*100).toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </ChartCard>
      </div>

      {/* Health Diagnostics */}
      <div className="bg-card border border-white/10 rounded-2xl p-4">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">Market Health Diagnostics</div>
        <div className="flex flex-col divide-y divide-white/5">
          {diagItems.map(d => (
            <div key={d.label} className="flex items-center justify-between py-3">
              <div className="flex items-center gap-3">
                <HealthDot status={d.status} />
                <div>
                  <div className="text-sm font-medium text-white">{d.label}</div>
                  <div className="text-xs text-muted-foreground">{d.desc}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-mono font-bold text-white">{d.value}</span>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                  d.status === "healthy" ? "bg-emerald-500/15 text-emerald-400" :
                  d.status === "warning" ? "bg-amber-500/15 text-amber-400" :
                  "bg-rose-500/15 text-rose-400"
                }`}>
                  {d.status.toUpperCase()}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Tab 3: Revenue Analytics ─────────────────────────────────────────────────

const ANNUALIZE: Record<string, number> = { today: 365, "7d": 365/7, "30d": 12, "90d": 4, all: 0 };
const FORECAST_ASSUMPTIONS = { conservative: 0.03, base: 0.05, aggressive: 0.08 };
const HORIZON_DAYS = { "30d": 30, "90d": 90, "12m": 365 };

function RevenueAnalyticsTab({ intel, period, engine }: { intel: IntelData; period: string; engine: string }) {
  const isPrediction = engine === "prediction";
  const c = intel.current;
  const p = intel.previous;
  const annMult = ANNUALIZE[period] ?? 0;
  const arr = c.platformRevenue * annMult;

  const compRows: { label: string; curr: number; prev: number | null; fmt: (v:number)=>string }[] = [
    { label: "Gross Volume",    curr: c.grossVolume,    prev: p?.grossVolume,    fmt: v => fc(v,true) },
    { label: "Trades",          curr: c.tradeCount,     prev: p?.tradeCount,     fmt: fn },
    { label: "Total Fees",      curr: c.totalFees,      prev: p?.totalFees,      fmt: v => fc(v,true) },
    { label: "Platform Revenue",curr: c.platformRevenue,prev: p?.platformRevenue,fmt: v => fc(v,true) },
    { label: "Player Pool",     curr: c.playerPool,     prev: p?.playerPool,     fmt: v => fc(v,true) },
    { label: "Liquidity Pool",  curr: c.liquidityPool,  prev: p?.liquidityPool,  fmt: v => fc(v,true) },
    { label: "Active Traders",  curr: c.activeTraders,  prev: p?.activeTraders,  fmt: fn },
    { label: isPrediction ? "Active Markets" : "Active Players", curr: c.activePlayers, prev: p?.activePlayers, fmt: fn },
    { label: "Avg Trade Size",  curr: c.averageTradeSize, prev: p?.averageTradeSize, fmt: fc },
  ];

  function forecastRevenue(days: number, growthPct: number) {
    const dailyRev = c.platformRevenue / (
      period === "today" ? 1 : period === "7d" ? 7 : period === "30d" ? 30 : period === "90d" ? 90 : 180
    );
    return dailyRev * days * (1 + growthPct);
  }

  const horizons = [
    { label: "30 days",  days: 30 },
    { label: "90 days",  days: 90 },
    { label: "12 months",days: 365 },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <KpiCard label="Net Platform Revenue" value={fc(c.platformRevenue, true)} curr={c.platformRevenue} prev={p?.platformRevenue}
          color="text-violet-400" icon={DollarSign} delay={0} />
        <KpiCard label="Effective Take Rate" value={fp(c.effectiveTakeRate)} curr={c.effectiveTakeRate} prev={p?.effectiveTakeRate}
          sub="Platform rev / gross vol" color="text-white" icon={BarChart2} delay={0.04} />
        <KpiCard label="Fee Yield" value={fp(c.feeYield)} curr={c.feeYield} prev={p?.feeYield}
          sub="Total fees / gross vol" color="text-amber-400" icon={Wallet} delay={0.08} />
        <KpiCard label="Revenue / Trader" value={fc(c.revenuePerTrader)} curr={c.revenuePerTrader} prev={p?.revenuePerTrader}
          color="text-emerald-400" icon={Users} delay={0.12} />
        <KpiCard label="Revenue / Trade" value={fc(c.revenuePerTrade)} curr={c.revenuePerTrade} prev={p?.revenuePerTrade}
          color="text-white" icon={Activity} delay={0.16} />
        <KpiCard label="Annualized Run Rate" value={annMult > 0 ? fc(arr, true) : "N/A"}
          sub={annMult > 0 ? `${annMult.toFixed(1)}× multiplier` : "No annualization for All Time"}
          color="text-sky-400" icon={TrendingUp} delay={0.20} />
      </div>

      {/* Comparative Analysis Table */}
      {p && (
        <div className="bg-card border border-white/10 rounded-2xl p-4">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">
            Period Comparison — Current vs Previous Equivalent Period
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground border-b border-white/5">
                  <th className="text-left pb-2 pr-4 font-medium">Metric</th>
                  <th className="text-right pb-2 pr-4 font-medium">Current</th>
                  <th className="text-right pb-2 pr-4 font-medium">Previous</th>
                  <th className="text-right pb-2 pr-4 font-medium">Δ Absolute</th>
                  <th className="text-right pb-2 font-medium">Δ %</th>
                </tr>
              </thead>
              <tbody>
                {compRows.map(r => {
                  const diff = r.prev != null ? r.curr - r.prev : null;
                  const diffPct = r.prev != null && r.prev !== 0 ? (diff! / r.prev) * 100 : null;
                  const pos = diff != null && diff >= 0;
                  return (
                    <tr key={r.label} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors">
                      <td className="py-2 pr-4 text-white/80 font-medium">{r.label}</td>
                      <td className="py-2 pr-4 text-right font-mono text-white">{r.fmt(r.curr)}</td>
                      <td className="py-2 pr-4 text-right font-mono text-muted-foreground">{r.prev != null ? r.fmt(r.prev) : "—"}</td>
                      <td className={`py-2 pr-4 text-right font-mono ${pos ? "text-emerald-400" : "text-rose-400"}`}>
                        {diff != null ? `${pos?"+":""}${r.fmt(diff)}` : "—"}
                      </td>
                      <td className={`py-2 text-right font-mono ${pos ? "text-emerald-400" : "text-rose-400"}`}>
                        {diffPct != null ? `${pos?"+":""}${diffPct.toFixed(1)}%` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Forecast Block */}
      <div className="bg-card border border-white/10 rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-4">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Revenue Forecast</div>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20 font-medium">
            PROJECTED MODEL
          </span>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Based on current-period run rate. Growth assumptions: Conservative +3%/period, Base +5%/period, Aggressive +8%/period.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground border-b border-white/5">
                <th className="text-left pb-2 pr-4 font-medium">Horizon</th>
                <th className="text-right pb-2 pr-4 font-medium text-white/40">Conservative</th>
                <th className="text-right pb-2 pr-4 font-medium text-white/70">Base</th>
                <th className="text-right pb-2 font-medium text-white">Aggressive</th>
              </tr>
            </thead>
            <tbody>
              {horizons.map(h => (
                <tr key={h.label} className="border-b border-white/5 last:border-0">
                  <td className="py-2 pr-4 font-medium text-white/80">{h.label}</td>
                  <td className="py-2 pr-4 text-right font-mono text-white/40 italic">{fc(forecastRevenue(h.days, FORECAST_ASSUMPTIONS.conservative), true)}</td>
                  <td className="py-2 pr-4 text-right font-mono text-white/70 italic">{fc(forecastRevenue(h.days, FORECAST_ASSUMPTIONS.base), true)}</td>
                  <td className="py-2 text-right font-mono text-emerald-400 italic">{fc(forecastRevenue(h.days, FORECAST_ASSUMPTIONS.aggressive), true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Tab 4: Valuation ─────────────────────────────────────────────────────────

type ValuationAssumptions = {
  conservativeMultiple: number; baseMultiple: number; aggressiveMultiple: number;
  monthlyVolumeGrowth: number; traderGrowth: number;
  revenueRetention: number; takeRateAssumption: number;
  projectionHorizon: number;
};

function buildValuationCurve(annRev: number, assumptions: ValuationAssumptions) {
  const months = Array.from({ length: assumptions.projectionHorizon + 1 }, (_, i) => i);
  const growthRate = assumptions.monthlyVolumeGrowth / 100;
  return months.map(m => {
    const rev = annRev * Math.pow(1 + growthRate, m) * (assumptions.revenueRetention / 100);
    return {
      month: m,
      conservative: rev * assumptions.conservativeMultiple,
      base:         rev * assumptions.baseMultiple,
      aggressive:   rev * assumptions.aggressiveMultiple,
    };
  });
}

function SliderRow({ label, value, min, max, step, unit, onChange }: {
  label: string; value: number; min: number; max: number; step: number; unit?: string; onChange: (v:number)=>void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-xs font-mono font-bold text-white">{value}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-violet-500" />
    </div>
  );
}

function ValuationTab({ intel, period }: { intel: IntelData; period: string }) {
  const [assump, setAssump] = useState<ValuationAssumptions>({
    conservativeMultiple: 8, baseMultiple: 12, aggressiveMultiple: 18,
    monthlyVolumeGrowth: 5, traderGrowth: 3,
    revenueRetention: 85, takeRateAssumption: 2.0,
    projectionHorizon: 24,
  });

  const annMult = ANNUALIZE[period] ?? 0;
  const annRev = intel.current.platformRevenue * (annMult > 0 ? annMult : 1);
  const adjRev = annRev * (assump.revenueRetention / 100);

  const valCons = adjRev * assump.conservativeMultiple;
  const valBase = adjRev * assump.baseMultiple;
  const valAgg  = adjRev * assump.aggressiveMultiple;

  const curve = useMemo(() => buildValuationCurve(annRev, assump), [annRev, assump]);
  const curveFormatted = curve.map(p => ({ ...p, label: p.month === 0 ? "Now" : `M${p.month}` }));

  const c = intel.current;

  const investorItems = [
    { label: "Gross Volume",   ok: c.grossVolume > 0,      warn: c.grossVolume < 100 },
    { label: "Platform Revenue",ok: c.platformRevenue > 0, warn: c.platformRevenue < 10 },
    { label: "Revenue Growth",  ok: intel.previous != null && c.platformRevenue > (intel.previous?.platformRevenue ?? 0), warn: intel.previous == null },
    { label: "Active Traders",  ok: c.activeTraders >= 5,  warn: c.activeTraders < 20 },
    { label: "Liquidity Health",ok: c.liquidityRatio >= 0.2, warn: c.liquidityRatio < 0.5 },
    { label: "Concentration Risk", ok: c.concentrationRatio <= 0.65, warn: c.concentrationRatio > 0.4 },
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* Scenario Note */}
      <div className="flex items-start gap-2 bg-amber-500/8 border border-amber-500/20 rounded-xl p-3">
        <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-300/80">
          This tab presents a <strong>scenario-based internal model</strong>. All valuations are illustrative projections 
          derived from current revenue metrics and adjustable assumptions. They do not constitute a financial statement, 
          offer, or external disclosure.
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Annualized Revenue" value={annMult > 0 ? fc(annRev, true) : fc(annRev, true)+" (est)"}
          sub={annMult > 0 ? `${annMult.toFixed(1)}× run rate` : "All-time estimate"} color="text-white" icon={TrendingUp} delay={0} />
        <KpiCard label="Conservative Val." value={fc(valCons, true)} sub={`${assump.conservativeMultiple}× multiple`}
          color="text-white/60" icon={BarChart2} delay={0.04} />
        <KpiCard label="Base Valuation" value={fc(valBase, true)} sub={`${assump.baseMultiple}× multiple`}
          color="text-violet-400" icon={BarChart2} delay={0.08} />
        <KpiCard label="Aggressive Val." value={fc(valAgg, true)} sub={`${assump.aggressiveMultiple}× multiple`}
          color="text-emerald-400" icon={BarChart2} delay={0.12} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Assumptions Panel */}
        <div className="bg-card border border-white/10 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-4">
            <Sliders className="w-3.5 h-3.5 text-muted-foreground" />
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Model Assumptions</div>
          </div>
          <div className="flex flex-col gap-4">
            <SliderRow label="Conservative Multiple" value={assump.conservativeMultiple} min={2} max={15} step={0.5} unit="×"
              onChange={v => setAssump(a => ({...a, conservativeMultiple: v}))} />
            <SliderRow label="Base Multiple" value={assump.baseMultiple} min={5} max={30} step={0.5} unit="×"
              onChange={v => setAssump(a => ({...a, baseMultiple: v}))} />
            <SliderRow label="Aggressive Multiple" value={assump.aggressiveMultiple} min={10} max={50} step={1} unit="×"
              onChange={v => setAssump(a => ({...a, aggressiveMultiple: v}))} />
            <SliderRow label="Monthly Volume Growth" value={assump.monthlyVolumeGrowth} min={0} max={30} step={0.5} unit="%"
              onChange={v => setAssump(a => ({...a, monthlyVolumeGrowth: v}))} />
            <SliderRow label="Revenue Retention" value={assump.revenueRetention} min={50} max={100} step={1} unit="%"
              onChange={v => setAssump(a => ({...a, revenueRetention: v}))} />
            <SliderRow label="Projection Horizon" value={assump.projectionHorizon} min={6} max={36} step={6} unit=" mo"
              onChange={v => setAssump(a => ({...a, projectionHorizon: v}))} />
          </div>
        </div>

        {/* Scenario Table */}
        <div className="bg-card border border-white/10 rounded-2xl p-4 flex flex-col gap-4">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Scenario Summary</div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground border-b border-white/5">
                <th className="text-left pb-2 pr-3 font-medium">Scenario</th>
                <th className="text-right pb-2 pr-3 font-medium">Ann. Revenue</th>
                <th className="text-right pb-2 pr-3 font-medium">Multiple</th>
                <th className="text-right pb-2 font-medium">Implied Val.</th>
              </tr>
            </thead>
            <tbody>
              {[
                { s: "Conservative", rev: adjRev, mult: assump.conservativeMultiple, val: valCons, color: "text-white/60" },
                { s: "Base",         rev: adjRev, mult: assump.baseMultiple,         val: valBase, color: "text-violet-400" },
                { s: "Aggressive",   rev: adjRev, mult: assump.aggressiveMultiple,   val: valAgg,  color: "text-emerald-400" },
              ].map(r => (
                <tr key={r.s} className="border-b border-white/5 last:border-0">
                  <td className={`py-2.5 pr-3 font-semibold ${r.color}`}>{r.s}</td>
                  <td className="py-2.5 pr-3 text-right font-mono text-white/70">{fc(r.rev, true)}</td>
                  <td className="py-2.5 pr-3 text-right font-mono text-white/70">{r.mult}×</td>
                  <td className={`py-2.5 text-right font-mono font-bold ${r.color}`}>{fc(r.val, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="text-[10px] text-muted-foreground/50 italic mt-auto">
            Retention-adjusted: revenue × {assump.revenueRetention}%
          </div>
        </div>
      </div>

      {/* Valuation Curve Chart */}
      <ChartCard title="Projected Valuation Scenarios — Dashed lines indicate modeled future values">
        <div className="flex items-center gap-3 mb-3">
          {[
            { label:"Conservative", color:"#6b7280" },
            { label:"Base", color:"#8b5cf6" },
            { label:"Aggressive", color:"#10b981" },
          ].map(l => (
            <div key={l.label} className="flex items-center gap-1.5">
              <div className="w-6 h-0 border-t-2 border-dashed" style={{ borderColor: l.color }} />
              <span className="text-[10px] text-muted-foreground">{l.label}</span>
            </div>
          ))}
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={curveFormatted} margin={{ top:4, right:12, bottom:0, left:0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="label" tick={{ fontSize:10, fill:"#6b7280" }} axisLine={false} tickLine={false}
              interval={Math.max(0, Math.floor(assump.projectionHorizon / 8) - 1)} />
            <YAxis tick={{ fontSize:10, fill:"#6b7280" }} axisLine={false} tickLine={false} width={48}
              tickFormatter={v => v >= 1_000_000 ? `$${(v/1_000_000).toFixed(0)}M` : v >= 1_000 ? `$${(v/1_000).toFixed(0)}K` : `$${v}`} />
            <RechTooltip {...tooltipStyle} formatter={(v:any) => [fc(v,true), ""]} />
            <Line dataKey="conservative" name="Conservative" stroke="#6b7280" strokeWidth={1.5} dot={false} strokeDasharray="5 3" />
            <Line dataKey="base"         name="Base"         stroke="#8b5cf6" strokeWidth={2}   dot={false} strokeDasharray="5 3" />
            <Line dataKey="aggressive"   name="Aggressive"   stroke="#10b981" strokeWidth={1.5} dot={false} strokeDasharray="5 3" />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Investor Readiness */}
      <div className="bg-card border border-white/10 rounded-2xl p-4">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">Investor Readiness Indicators</div>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {investorItems.map(item => {
            const status: HealthStatus = item.ok && !item.warn ? "healthy" : item.ok ? "warning" : "risk";
            return (
              <div key={item.label} className="flex items-center gap-2 bg-white/3 rounded-xl p-3">
                <HealthDot status={status} />
                <span className="text-xs text-white/80 font-medium">{item.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Preserved Operational Tables (Tab 1) ─────────────────────────────────────

function FeeCapturesTable({ rows }: { rows: FeeCapture[] }) {
  const fmt4 = (v: string) => { const n = parseFloat(v); return isNaN(n) ? "—" : n.toFixed(4); };
  return (
    <div className="bg-card border border-white/10 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm font-semibold text-white">Recent Fee Captures</div>
        <span className="text-xs text-muted-foreground">{rows.length} entries</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground border-b border-white/5">
              {["Ref","Type","Ccy","Notional","Fee Total","Platform","Player","Liquidity","Time"].map(h => (
                <th key={h} className={`pb-2 pr-3 font-medium ${h==="Ref"||h==="Type"?"text-left":"text-right"} last:pr-0`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} data-testid={`fee-capture-row-${r.id}`}
                className="border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors">
                <td className="py-2 pr-3 font-mono text-white/80">{r.referenceId}{r.assetId && <span className="ml-1 text-muted-foreground/40">#{r.assetId}</span>}</td>
                <td className="py-2 pr-3">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                    r.referenceType==="market_trade"?"bg-blue-500/10 text-blue-400":
                    r.referenceType==="limit_trade" ?"bg-amber-500/10 text-amber-400":
                    "bg-white/5 text-muted-foreground"}`}>{r.referenceType}</span>
                </td>
                <td className="py-2 pr-3 text-right"><span className={`text-[10px] font-mono font-semibold ${r.currency==="GS"?"text-violet-400":"text-emerald-400"}`}>{r.currency}</span></td>
                <td className="py-2 pr-3 text-right font-mono text-white/70">{fmt4(r.notional)}</td>
                <td className="py-2 pr-3 text-right font-mono text-yellow-400">{fmt4(r.feeTotal)}</td>
                <td className="py-2 pr-3 text-right font-mono text-violet-400/80">{fmt4(r.platformFee)}</td>
                <td className="py-2 pr-3 text-right font-mono text-emerald-400/80">{fmt4(r.playerFee)}</td>
                <td className="py-2 pr-3 text-right font-mono text-cyan-400/80">{fmt4(r.liquidityFee)}</td>
                <td className="py-2 text-right text-muted-foreground">{relTime(r.createdAt)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={9} className="py-6 text-center text-muted-foreground">No fee captures yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WalletActivityTable({ rows }: { rows: WalletActivity[] }) {
  const fmt4 = (v: string) => { const n = parseFloat(v); return isNaN(n) ? "—" : n.toFixed(4); };
  return (
    <div className="bg-card border border-white/10 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm font-semibold text-white">System Wallet Activity</div>
        <span className="text-xs text-muted-foreground">{rows.length} entries</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground border-b border-white/5">
              {["Wallet","Ccy","Dir","Amount","Balance After","Description","Time"].map(h => (
                <th key={h} className={`pb-2 pr-3 font-medium ${h==="Wallet"||h==="Description"?"text-left":"text-right"} last:pr-0`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} data-testid={`wallet-activity-row-${i}`}
                className="border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors">
                <td className="py-2 pr-3 font-medium text-white/80">{walletLabel(r.walletType)}</td>
                <td className="py-2 pr-3 text-right"><span className={`text-[10px] font-mono font-semibold ${r.currency==="GS"?"text-violet-400":"text-emerald-400"}`}>{r.currency}</span></td>
                <td className="py-2 pr-3 text-right">
                  <span className={`inline-flex items-center gap-0.5 ${r.direction==="credit"?"text-emerald-400":"text-rose-400"}`}>
                    {r.direction==="credit"?<TrendingUp className="w-3 h-3"/>:<TrendingDown className="w-3 h-3"/>}
                    {r.direction}
                  </span>
                </td>
                <td className="py-2 pr-3 text-right font-mono text-white/70">{fmt4(r.amount)}</td>
                <td className="py-2 pr-3 text-right font-mono text-white/50">{fmt4(r.balanceAfter)}</td>
                <td className="py-2 pr-3 text-muted-foreground max-w-[140px] truncate">{r.description ?? "—"}</td>
                <td className="py-2 text-right text-muted-foreground">{relTime(r.createdAt)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={7} className="py-6 text-center text-muted-foreground">No wallet activity yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Filter Bar ───────────────────────────────────────────────────────────────

function FilterBar({ period, currency, comparison, viewMode, engine, onPeriod, onCurrency, onComparison, onViewMode, onEngine }: {
  period: string; currency: string; comparison: string; viewMode: string; engine: string;
  onPeriod: (v:string)=>void; onCurrency: (v:string)=>void;
  onComparison: (v:string)=>void; onViewMode: (v:string)=>void; onEngine: (v:string)=>void;
}) {
  function Seg({ value, active, onClick, children }: { value:string; active:boolean; onClick:()=>void; children:React.ReactNode }) {
    return (
      <button onClick={onClick}
        className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-all ${
          active ? "bg-violet-500 text-white shadow-md shadow-violet-500/20" : "text-muted-foreground hover:text-white"
        }`}>
        {children}
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="revenue-filter-bar">
      {/* Engine toggle — primary filter */}
      <div className="flex items-center gap-0.5 bg-white/5 rounded-xl p-1" data-testid="engine-selector">
        {[{k:"trade",l:"Trade"},{k:"prediction",l:"Predict"},{k:"all",l:"All"}]
          .filter(e => e.k !== "prediction" || isPredictEnabled())
          .map(e => (
            <Seg key={e.k} value={e.k} active={engine===e.k} onClick={() => onEngine(e.k)}>
              {e.l}
            </Seg>
          ))}
      </div>
      {/* Currency */}
      <div className="flex items-center gap-0.5 bg-white/5 rounded-xl p-1">
        {["GS","USDC","all"].map(c => (
          <Seg key={c} value={c} active={currency===c} onClick={() => onCurrency(c)}>
            {c==="all" ? "All" : c==="GS" ? "GS$" : "USDC"}
          </Seg>
        ))}
      </div>
      {/* Period */}
      <div className="flex items-center gap-0.5 bg-white/5 rounded-xl p-1" data-testid="period-selector">
        {PERIODS.map(p => (
          <Seg key={p.key} value={p.key} active={period===p.key} onClick={() => onPeriod(p.key)}>
            {p.label}
          </Seg>
        ))}
      </div>
      {/* Comparison */}
      <div className="flex items-center gap-0.5 bg-white/5 rounded-xl p-1">
        {[{k:"none",l:"No Comparison"},{k:"prev",l:"vs Prev Period"}].map(c => (
          <Seg key={c.k} value={c.k} active={comparison===c.k} onClick={() => onComparison(c.k)}>
            {c.l}
          </Seg>
        ))}
      </div>
      {/* View Mode */}
      <div className="flex items-center gap-0.5 bg-white/5 rounded-xl p-1">
        {[{k:"snapshot",l:"Snapshot"},{k:"trend",l:"Trend"},{k:"projection",l:"Projection"}].map(v => (
          <Seg key={v.k} value={v.k} active={viewMode===v.k} onClick={() => onViewMode(v.k)}>
            {v.l}
          </Seg>
        ))}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminRevenueDashboardPage() {
  const [period,     setPeriod]     = useState<string>("7d");
  const [currency,   setCurrency]   = useState<string>("GS");
  const [comparison, setComparison] = useState<string>("none");
  const [viewMode,   setViewMode]   = useState<string>("snapshot");
  const [activeTab,  setActiveTab]  = useState<string>("overview");
  const [engine,     setEngine]     = useState<string>("trade");

  // New intelligence endpoint
  const { data: intel, isLoading: intelLoading, error: intelError } = useQuery<IntelData>({
    queryKey: ["/api/admin/accounting/revenue-intelligence", period, currency, comparison, engine],
    queryFn: () => fetch(
      `/api/admin/accounting/revenue-intelligence?period=${period}&currency=${currency}&comparison=${comparison}&engine=${engine}`,
      { credentials: "include" }
    ).then(r => r.json()),
    refetchInterval: 30000,
    staleTime: 10000,
  });

  // Legacy treasury endpoint — only used for Tab 1 operational tables + treasury cards
  const { data: treasury } = useQuery<TreasuryData>({
    queryKey: ["/api/admin/accounting/treasury-dashboard", period],
    queryFn: () => fetch(`/api/admin/accounting/treasury-dashboard?period=${period}`, { credentials: "include" }).then(r => r.json()),
    refetchInterval: 30000,
    staleTime: 10000,
  });

  const PERIOD_LABEL: Record<string,string> = { today:"Today", "7d":"Last 7 Days", "30d":"Last 30 Days", "90d":"Last 90 Days", all:"All Time" };

  return (
    <AdminLayout>
      <div className="flex flex-col gap-5">

        {/* Header */}
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-display font-bold text-white">Revenue Intelligence</h2>
          <p className="text-sm text-muted-foreground">CFO-grade platform financials, market health, and valuation modeling.</p>
        </div>

        {/* Filter Bar */}
        <FilterBar
          period={period} currency={currency} comparison={comparison} viewMode={viewMode} engine={engine}
          onPeriod={setPeriod} onCurrency={setCurrency}
          onComparison={setComparison} onViewMode={setViewMode} onEngine={setEngine}
        />

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-white/8">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setActiveTab(t.key)}
              data-testid={`tab-${t.key}`}
              className={`px-4 py-2.5 text-sm font-medium transition-all border-b-2 -mb-px ${
                activeTab === t.key
                  ? "border-violet-500 text-white"
                  : "border-transparent text-muted-foreground hover:text-white"
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Period Label */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground/60">Period:</span>
          <span className="text-xs font-semibold text-white/70">{PERIOD_LABEL[period]}</span>
          {comparison === "prev" && period !== "all" && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-400 border border-violet-500/20">
              vs Previous Equivalent Period
            </span>
          )}
          {period === "all" && comparison === "prev" && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-muted-foreground">
              No comparison available for All Time
            </span>
          )}
        </div>

        {/* Content */}
        {intelLoading ? (
          <SectionSkeleton />
        ) : intelError || !intel ? (
          <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-6 text-red-400 text-sm">
            Failed to load revenue intelligence data. Ensure you are signed in as admin.
          </div>
        ) : (
          <>
            {activeTab === "overview"   && <OverviewTab intel={intel} treasury={treasury} period={period} currency={currency} engine={engine} />}
            {activeTab === "health"     && <MarketHealthTab intel={intel} period={period} engine={engine} />}
            {activeTab === "analytics"  && <RevenueAnalyticsTab intel={intel} period={period} engine={engine} />}
            {activeTab === "valuation"  && <ValuationTab intel={intel} period={period} />}
          </>
        )}
      </div>
    </AdminLayout>
  );
}

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  AreaChart, Area, XAxis, YAxis,
  Tooltip as ChartTooltip, ResponsiveContainer,
} from "recharts";
import {
  TrendingUp, TrendingDown, Lock, BarChart3,
  Zap, Activity, Star, Flame, Target,
} from "lucide-react";
import { useSynthetic, synthToMarketRow } from "@/state/syntheticContext";
import { useTerminal } from "@/state/terminalStore";
import { SignalBadge } from "./SignalBadge";
import { PlayerAvatar, roleColor } from "./PlayerAvatar";
import { DiscoveryHeroSection } from "./DiscoveryHeroSection";
import type { SyntheticRow } from "@/state/syntheticContext";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtPrice(v: string | number) {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return `$${n.toFixed(2)}`;
}

function fmtPct(v: number, sign = true) {
  return `${sign && v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

// ─── Synth Sparkline ─────────────────────────────────────────────────────────

function SynthSparkline({ playerId, isPositive }: { playerId: string; isPositive: boolean }) {
  const { data, isLoading } = useQuery<{ snapshots: Array<{ t: string; p: number }> }>({
    queryKey: ["/api/synthetic/player/history", playerId],
    queryFn: async () => {
      const res = await fetch(`/api/synthetic/player/${playerId}/history?tf=24h`, { credentials: "include" });
      if (!res.ok) return { snapshots: [] };
      return res.json();
    },
    staleTime: 30000,
    refetchInterval: 60000,
  });

  const snapshots = data?.snapshots ?? [];

  if (isLoading || snapshots.length < 2) {
    return (
      <div className="h-[100px] flex items-center justify-center">
        <div className="flex gap-1">
          {[3, 5, 4, 6, 3, 5, 4].map((h, i) => (
            <div key={i} className="w-1 bg-white/10 rounded-sm animate-pulse" style={{ height: h * 4 }} />
          ))}
        </div>
      </div>
    );
  }

  const color = isPositive ? "#34d399" : "#f43f5e";
  const gradId = `grad-${playerId.replace(/[^a-z0-9]/gi, "")}`;

  return (
    <ResponsiveContainer width="100%" height={100}>
      <AreaChart data={snapshots} margin={{ top: 4, right: 2, bottom: 0, left: 2 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.22} />
            <stop offset="95%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <XAxis dataKey="t" hide />
        <YAxis domain={["auto", "auto"]} hide />
        <ChartTooltip
          contentStyle={{ background: "#0f0f1a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, fontSize: 10, padding: "4px 8px" }}
          formatter={(v: number) => [fmtPrice(v), "Price"]}
          labelFormatter={(label: string) => {
            try { return new Date(label).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
            catch { return ""; }
          }}
        />
        <Area type="monotone" dataKey="p" stroke={color} strokeWidth={1.5} fill={`url(#${gradId})`} dot={false} animationDuration={400} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ─── Market List Row ──────────────────────────────────────────────────────────

function MarketListRow({ row, onSelect, isSelected, rank }: {
  row: SyntheticRow;
  onSelect: (r: SyntheticRow) => void;
  isSelected: boolean;
  rank?: number;
}) {
  const isPos = row.change24h >= 0;
  const rc = roleColor(row.role);
  const initials = row.displayName.slice(0, 2).toUpperCase();

  return (
    <button
      onClick={() => onSelect(row)}
      className={`group w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-all duration-150 rounded-lg
        ${isSelected
          ? "bg-white/[0.08] border border-white/[0.12]"
          : "hover:bg-white/[0.05] border border-transparent"
        }`}
    >
      {rank !== undefined && (
        <span className="text-[10px] text-zinc-600 w-3 shrink-0 font-mono">{rank}</span>
      )}
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ring-1 ring-white/10"
        style={{ background: `${rc}22`, color: rc }}
      >
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-semibold text-white truncate leading-none">{row.displayName}</div>
        <div className="flex items-center gap-1 mt-0.5">
          <span className="text-[9px] font-medium px-1 py-px rounded"
            style={{ background: `${rc}18`, color: rc }}>
            {row.role}
          </span>
          <SignalBadge signal={row.signal} size="xs" />
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-xs font-mono font-semibold text-white">{fmtPrice(row.lastTradePrice)}</div>
        <div className={`text-[10px] font-bold ${isPos ? "text-emerald-400" : "text-rose-400"}`}>
          {fmtPct(row.change24h)}
        </div>
      </div>
    </button>
  );
}

// ─── Market Board ─────────────────────────────────────────────────────────────

function MarketBoard({ title, icon, subtitle, rows, onSelect, selectedId, accentColor }: {
  title: string;
  icon: React.ReactNode;
  subtitle: string;
  rows: SyntheticRow[];
  onSelect: (r: SyntheticRow) => void;
  selectedId: string | undefined;
  accentColor: string;
}) {
  return (
    <div
      className="rounded-xl border border-white/[0.07] overflow-hidden flex flex-col"
      style={{ background: "linear-gradient(180deg, rgba(10,10,20,0.85) 0%, rgba(6,6,14,0.95) 100%)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/[0.06]"
        style={{ borderTop: `2px solid ${accentColor}` }}>
        <div className="flex items-center gap-1.5">
          <span style={{ color: accentColor }}>{icon}</span>
          <span className="text-[10px] font-bold text-zinc-300 uppercase tracking-wider">{title}</span>
        </div>
        <span className="text-[9px] text-zinc-600">{subtitle}</span>
      </div>
      {/* Rows */}
      <div className="p-1 flex-1">
        {rows.map((r, i) => (
          <MarketListRow
            key={r.id}
            row={r}
            onSelect={onSelect}
            isSelected={selectedId === r.id}
            rank={i + 1}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Player Ticket Panel (Right Rail) ─────────────────────────────────────────

function PlayerTicketPanel() {
  const { selectedSynth, model } = useSynthetic();
  const s = selectedSynth;

  if (!s) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06] shrink-0">
          <span className="text-[10px] font-bold text-zinc-500 tracking-widest uppercase">Player Ticket</span>
          <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold bg-violet-500/15 border border-violet-500/25 text-violet-400">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
            DEMO
          </span>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
          <div className="w-14 h-14 rounded-full bg-white/[0.04] border border-white/[0.06] flex items-center justify-center">
            <BarChart3 className="w-6 h-6 text-zinc-700" />
          </div>
          <p className="text-sm font-semibold text-zinc-500">Select a player</p>
          <p className="text-xs text-zinc-600 leading-relaxed">Click any card or list row to view their full market analysis</p>
        </div>
      </div>
    );
  }

  const isPos = s.change24h >= 0;
  const rc = roleColor(s.role);
  const divNeg = s.divergencePct < 0;
  const divAbs = Math.abs(s.divergencePct);

  const discoverySignal = model?.discovery.find(d => d.playerId === s.id);

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06] shrink-0">
        <span className="text-[10px] font-bold text-zinc-500 tracking-widest uppercase">Player Ticket</span>
        <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold bg-violet-500/15 border border-violet-500/25 text-violet-400">
          <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
          DEMO
        </span>
      </div>

      {/* ── Player Identity ── */}
      <div className="relative px-4 py-4 border-b border-white/[0.06] shrink-0 overflow-hidden">
        <div className="absolute inset-0 opacity-[0.12]"
          style={{ background: `radial-gradient(ellipse at 90% 50%, ${rc}, transparent 65%)` }} />
        <div className="relative flex items-center gap-3">
          <PlayerAvatar name={s.displayName} role={s.role} size="xl" />
          <div className="flex-1 min-w-0">
            <div className="text-[22px] font-black text-white leading-tight tracking-tight truncate">{s.displayName}</div>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className="text-xs font-semibold px-2 py-0.5 rounded"
                style={{ background: `${rc}20`, color: rc, border: `1px solid ${rc}35` }}>
                {s.role}
              </span>
              <span className="text-[10px] text-zinc-500">{s.archetype.replace(/_/g, " ")}</span>
            </div>
            <div className="text-[10px] text-zinc-600 mt-0.5 font-mono">{s.summonerTag}</div>
          </div>
        </div>
      </div>

      {/* ── Price + Signal ── */}
      <div className="px-4 py-3.5 border-b border-white/[0.06] shrink-0">
        <div className="flex items-end justify-between mb-3">
          <div>
            <div className="text-[9px] text-zinc-600 uppercase tracking-wider mb-0.5">Market Price</div>
            <div className="text-3xl font-black font-mono text-white leading-none tabular-nums">{fmtPrice(s.lastTradePrice)}</div>
            <div className={`flex items-center gap-1 mt-1 ${isPos ? "text-emerald-400" : "text-rose-400"}`}>
              {isPos ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
              <span className="text-sm font-bold">{fmtPct(s.change24h)} 24h</span>
            </div>
          </div>
          <div className="text-right">
            <SignalBadge signal={s.signal} size="md" glow />
          </div>
        </div>

        {/* ── Fair Value vs Market — visual comparison ── */}
        <div className={`rounded-lg border p-2.5 ${divNeg ? "bg-emerald-500/[0.04] border-emerald-500/15" : "bg-rose-500/[0.04] border-rose-500/15"}`}>
          <div className="text-[9px] text-zinc-600 uppercase tracking-wider mb-2">Fair Value vs Market Price</div>
          <div className="flex items-end justify-between gap-3 mb-2">
            <div>
              <div className="text-[9px] text-zinc-600 mb-0.5">Fair Value</div>
              <div className="text-base font-mono font-bold text-white">{fmtPrice(s.fairValue)}</div>
            </div>
            <div className={`text-xs font-bold px-2 py-1 rounded ${divNeg ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400"}`}>
              {divNeg ? "▼" : "▲"} {divAbs.toFixed(1)}%
            </div>
            <div className="text-right">
              <div className="text-[9px] text-zinc-600 mb-0.5">Market</div>
              <div className="text-base font-mono font-bold text-white">{fmtPrice(s.lastTradePrice)}</div>
            </div>
          </div>
          <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
            <div
              className={`h-full rounded-full ${divNeg ? "bg-emerald-500/60" : "bg-rose-500/60"}`}
              style={{ width: `${Math.max(5, Math.min(95, 100 - divAbs)).toFixed(0)}%` }}
            />
          </div>
          <div className={`text-center mt-1.5 text-[10px] font-semibold ${divNeg ? "text-emerald-400/60" : "text-rose-400/60"}`}>
            {divNeg ? "Trading below fair value" : "Trading above fair value"}
          </div>
        </div>
      </div>

      {/* ── 24h Chart ── */}
      <div className="px-2 pt-3 pb-1 border-b border-white/[0.06] shrink-0">
        <div className="flex items-center justify-between px-2 mb-1">
          <span className="text-[9px] text-zinc-600 uppercase tracking-widest">24h Chart</span>
          <span className="text-[9px] font-mono text-zinc-600">
            {s.bidPrice} / {s.askPrice}
          </span>
        </div>
        <SynthSparkline playerId={s.id} isPositive={isPos} />
      </div>

      {/* ── Metrics ── */}
      <div className="px-4 py-3.5 border-b border-white/[0.06] shrink-0">
        <div className="text-[9px] text-zinc-600 uppercase tracking-widest mb-2.5">Performance Metrics</div>
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: "Win Rate", value: `${s.winRate.toFixed(1)}%`, highlight: s.winRate > 55 },
            { label: "PVI Score", value: `${s.pviScore.toFixed(1)}/100`, highlight: s.pviScore > 65 },
            { label: "LP", value: s.leaguePoints.toLocaleString(), highlight: false },
            { label: "Momentum", value: parseFloat(s.momentum) > 0 ? "Bullish" : "Bearish", highlight: parseFloat(s.momentum) > 0 },
          ].map((m) => (
            <div key={m.label} className="rounded-lg bg-white/[0.03] border border-white/[0.07] px-3 py-2">
              <div className="text-[9px] text-zinc-600 uppercase tracking-wide">{m.label}</div>
              <div className={`text-sm font-bold mt-0.5 font-mono ${m.highlight ? "text-emerald-400" : "text-zinc-300"}`}>
                {m.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Discovery Signal / Bio ── */}
      <div className="px-4 py-3.5 border-b border-white/[0.06] shrink-0">
        <div className="text-[9px] text-zinc-600 uppercase tracking-widest mb-2">
          {discoverySignal ? "Discovery Signal" : "Player Profile"}
        </div>
        {discoverySignal && (
          <div className="mb-2.5 p-2.5 rounded-lg border"
            style={{ background: "rgba(139,92,246,0.06)", borderColor: "rgba(139,92,246,0.2)" }}>
            <div className="text-[10px] font-bold text-violet-300 mb-0.5">{discoverySignal.headline}</div>
            <div className="text-[10px] text-zinc-400 leading-snug">{discoverySignal.detail}</div>
          </div>
        )}
        <p className="text-xs text-zinc-400 leading-relaxed">{s.biography}</p>
        {s.strengths.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {s.strengths.slice(0, 3).map((str, i) => (
              <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">{str}</span>
            ))}
          </div>
        )}
        {s.weaknesses.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {s.weaknesses.slice(0, 2).map((w, i) => (
              <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-rose-500/10 border border-rose-500/20 text-rose-400">{w}</span>
            ))}
          </div>
        )}
      </div>

      {/* ── Demo CTA ── */}
      <div className="px-4 py-4 shrink-0">
        <div className="rounded-xl border border-white/[0.08] p-4 text-center space-y-2"
          style={{ background: "linear-gradient(135deg, rgba(20,20,40,0.8), rgba(10,10,20,0.9))" }}>
          <Lock className="w-5 h-5 text-zinc-600 mx-auto" />
          <p className="text-xs font-semibold text-zinc-400">Trading disabled in Demo Mode</p>
          <p className="text-[10px] text-zinc-600 leading-snug">Connect a Riot account to trade real Challenger players with live price discovery</p>
        </div>
      </div>
    </div>
  );
}

// ─── Demo Tape Strip ──────────────────────────────────────────────────────────

function DemoTapeStrip() {
  const { model } = useSynthetic();
  const tape = model?.tape ?? [];

  if (tape.length === 0) return null;

  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-1.5 mb-2.5">
        <Activity className="w-3 h-3 text-zinc-600" />
        <div className="text-[9px] text-zinc-600 uppercase tracking-widest">Live Activity</div>
      </div>
      <div className="space-y-1">
        {tape.slice(0, 5).map((t) => {
          const isBuy = t.type === "BUY";
          return (
            <div key={t.id} className="flex items-center gap-2 py-1">
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded font-mono w-7 text-center
                ${isBuy ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/25" : "bg-rose-500/15 text-rose-400 border border-rose-500/25"}`}>
                {t.type === "BUY" ? "B" : "S"}
              </span>
              <span className="text-[10px] font-semibold text-zinc-300 w-20 truncate">{t.displayName}</span>
              <span className="text-[10px] font-mono text-zinc-500">{t.shares}x @ ${parseFloat(t.pricePerShare).toFixed(2)}</span>
              <span className="text-[9px] text-zinc-600 ml-auto font-mono truncate">{t.trader}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Premium Demo Layout (root) ───────────────────────────────────────────────

export function PremiumDemoLayout() {
  const { model, selectedSynth, setSelectedSynth } = useSynthetic();
  const { dispatch } = useTerminal();

  const handleSelect = (row: SyntheticRow) => {
    setSelectedSynth(row);
    dispatch({ type: "SELECT_ASSET", asset: synthToMarketRow(row) });
  };

  const rows = model?.rows ?? [];
  const idx = model?.index;

  const trendingRows = useMemo(
    () => [...rows].sort((a, b) => parseFloat(b.volume24h) - parseFloat(a.volume24h)).slice(0, 7),
    [rows]
  );

  const moverRows = useMemo(
    () => [...rows].sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h)).slice(0, 7),
    [rows]
  );

  const undervaluedRows = useMemo(
    () => [...rows]
      .filter(r => r.signal === "STRONG_BUY" || r.signal === "BUY")
      .sort((a, b) => a.divergencePct - b.divergencePct)
      .slice(0, 7),
    [rows]
  );

  if (!model) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="flex gap-1">
            {[4, 6, 5, 7, 4, 6, 5].map((h, i) => (
              <div key={i} className="w-1.5 bg-white/10 rounded-sm animate-pulse" style={{ height: h * 5 }} />
            ))}
          </div>
          <span className="text-xs text-zinc-600">Loading synthetic market…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 overflow-hidden">

      {/* ── Left / Center: scrollable content ── */}
      <div className="flex-1 overflow-y-auto min-w-0">

        {/* ── Featured Opportunities (new cinematic cards) ── */}
        <DiscoveryHeroSection />

        {/* ── Market Index strip ── */}
        {idx && (
          <div className="flex items-center gap-4 px-4 py-2.5 border-b border-white/[0.05] bg-black/20 text-[10px] shrink-0">
            <div className="flex items-center gap-1.5">
              <span className="w-1 h-3 rounded-full bg-gradient-to-b from-cyan-400 to-violet-500" />
              <span className="text-zinc-500 font-mono uppercase tracking-widest text-[9px]">Market</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-zinc-500">Overall</span>
              <span className={`font-mono font-bold ${idx.overall >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                {idx.overall >= 0 ? "+" : ""}{idx.overall.toFixed(2)}%
              </span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-zinc-500">Gainers</span>
              <span className="text-emerald-400 font-mono font-bold">{idx.breadth.gainers}▲</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-zinc-500">Losers</span>
              <span className="text-rose-400 font-mono font-bold">{idx.breadth.losers}▼</span>
            </div>
            <div className="flex-1 max-w-[80px] h-1 rounded-full bg-rose-500/20 overflow-hidden ml-auto">
              <div
                className="h-full bg-emerald-500/70 rounded-full"
                style={{ width: `${((idx.breadth.gainers / (idx.assetCount || 1)) * 100).toFixed(0)}%` }}
              />
            </div>
          </div>
        )}

        {/* ── Player Market Boards ── */}
        <div className="px-4 py-4">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-1 h-4 rounded-full bg-gradient-to-b from-amber-400 to-orange-500" />
            <span className="text-[10px] font-black text-zinc-300 uppercase tracking-[0.14em]">Player Market</span>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <MarketBoard
              title="Top Movers"
              icon={<Flame className="w-3 h-3" />}
              subtitle="by 24h change"
              rows={moverRows}
              onSelect={handleSelect}
              selectedId={selectedSynth?.id}
              accentColor="#f59e0b"
            />
            <MarketBoard
              title="Trending"
              icon={<Activity className="w-3 h-3" />}
              subtitle="by volume"
              rows={trendingRows}
              onSelect={handleSelect}
              selectedId={selectedSynth?.id}
              accentColor="#22d3ee"
            />
            <MarketBoard
              title="Undervalued"
              icon={<Star className="w-3 h-3" />}
              subtitle="below fair value"
              rows={undervaluedRows}
              onSelect={handleSelect}
              selectedId={selectedSynth?.id}
              accentColor="#a78bfa"
            />
          </div>
        </div>

        {/* ── Demo Activity Tape ── */}
        <div className="mx-4 mb-4 rounded-xl border border-white/[0.07] overflow-hidden"
          style={{ background: "linear-gradient(180deg, rgba(8,8,18,0.85) 0%, rgba(5,5,12,0.95) 100%)" }}>
          <DemoTapeStrip />
        </div>

      </div>

      {/* ── Right: Player Ticket ── */}
      <div
        className="w-[340px] xl:w-[380px] shrink-0 border-l border-white/[0.06] overflow-hidden flex flex-col"
        style={{ background: "linear-gradient(180deg, rgba(6,6,14,0.98) 0%, rgba(4,4,10,1) 100%)" }}
      >
        <PlayerTicketPanel />
      </div>

    </div>
  );
}

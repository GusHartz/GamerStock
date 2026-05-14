import { useState, useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { AdminLayout } from "./layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  LineChart, Line, BarChart, Bar, ComposedChart,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine, Area,
} from "recharts";
import {
  FlaskConical, Play, TrendingUp, TrendingDown, Activity,
  DollarSign, BarChart3, ArrowUpDown, Loader2, Download, Zap,
  BotIcon, HeartPulse, CheckCircle2, AlertTriangle, XCircle,
  Info, Bug, Layers, Settings,
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface SimStep {
  step: number;
  matchNumber: number;
  dayLabel: string;
  matchScore: number;
  recentPerformance: number;
  pvi: number;
  fairValue: number;
  marketPrice: number;
  divergencePct: number;
  netTokens: number;
  buyTokens: number;
  sellTokens: number;
  momentum: number;
  inactivityPenalty: number;
  // v2 decomposition
  externalBuyVolume: number;
  externalSellVolume: number;
  botBuyVolume: number;
  botSellVolume: number;
  botNetFlow: number;
  tradeImpactContribution: number;
  anchorContribution: number;
  volatility: number;
}

interface SimSummary {
  initialMarketPrice: number;
  finalMarketPrice: number;
  initialFairValue: number;
  finalFairValue: number;
  totalReturnPct: number;
  avgMatchScore: number;
  avgNetTokens: number;
  finalDivergencePct: number;
  positiveSteps: number;
  negativeSteps: number;
  totalSteps: number;
  // v2
  avgDivergence: number;
  maxDivergence: number;
  avgStepVolatility: number;
  totalTradeImpactContribution: number;
  totalAnchorContribution: number;
  totalBuyImpact: number;
  totalSellImpact: number;
  totalBotBuyVolume: number;
  totalBotSellVolume: number;
  totalBotNetFlow: number;
  totalExternalBuyVolume: number;
  totalExternalSellVolume: number;
  netExternalFlow: number;
  healthScore: number;
}

interface ConfigSnapshot {
  role: string;
  days: number;
  matchesPerDay: number;
  baseScore: number;
  performancePattern: string;
  marketPattern: string;
  botIntensity: string;
  botCountUsed: number;
  botIntervalUsed: string;
  botBatchMinUsed: number;
  botBatchMaxUsed: number;
  botRoleWeightsUsed: Record<string, number>;
  emaEnabled: boolean;
  inactivityDecayEnabled: boolean;
  performanceAnchorEnabled: boolean;
  anchorStrengthUsed: string;
  anchorMultiplierUsed: number;
  fairValueFormulaUsed: string;
  fairValueExponentUsed: number;
  fairValueModeUsed: string;
  manualFairValueUsed: number | null;
  liquidityDepthUsed: string;
  priceImpactFormulaUsed: string;
  anchorEngineVersion?: string;
  initialSupplyUsed?: number;
}

interface ExecutionFlags {
  useRealBotEngine: boolean;
  useRealFairValueEngine: boolean;
  useRealPriceEngine: boolean;
  useRealAnchorLogic: boolean;
  fairValueMode: string;
  anchorStrength: string;
  fvCurveExponent: number;
  botBehaviorMode: string;
}

interface DebugInfo {
  firstSteps: SimStep[];
  lastSteps: SimStep[];
  botRoleBreakdown: Record<string, { buy: number; sell: number }>;
  configWarnings: string[];
}

interface SimResult {
  summary: SimSummary;
  timeline: SimStep[];
  configSnapshot: ConfigSnapshot;
  executionFlags: ExecutionFlags;
  debugInfo?: DebugInfo;
}

interface SimConfig {
  role: string;
  days: number;
  matchesPerDay: number;
  performancePattern: string;
  marketPattern: string;
  botIntensity: string;
  useInactivityDecay: boolean;
  useSmoothing: boolean;
  usePerformanceAnchor: boolean;
  initialMatchScore: number;
  // v2 advanced
  fairValueMode: string;
  manualFairValue: number;
  anchorStrength: string;
  fvCurveExponent: number;
  botBehaviorMode: string;
  debugMode: boolean;
}

interface StressScenarioResult {
  scenario: string;
  description: string;
  performancePattern: string;
  marketPattern: string;
  finalPrice: number;
  finalFairValue: number;
  maxDivergence: number;
  priceVolatility: number;
  totalReturn: number;
  healthStatus: "Healthy" | "Moderate" | "Unstable";
  healthScore: number;
  error: string | null;
}

interface StressTestResult {
  results: StressScenarioResult[];
}

// ─── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: SimConfig = {
  role: "adc",
  days: 2,
  matchesPerDay: 8,
  performancePattern: "random",
  marketPattern: "balanced",
  botIntensity: "medium",
  useInactivityDecay: true,
  useSmoothing: true,
  usePerformanceAnchor: true,
  initialMatchScore: 55,
  fairValueMode: "real",
  manualFairValue: 15,
  anchorStrength: "medium",
  fvCurveExponent: 1.5,
  botBehaviorMode: "reworked",
  debugMode: false,
};

const CHART_COLORS = {
  marketPrice: "#60a5fa",
  fairValue: "#f59e0b",
  matchScore: "#a78bfa",
  recentPerf: "#34d399",
  pvi: "#fb923c",
  buy: "#34d399",
  sell: "#f87171",
  net: "#60a5fa",
  divergence: "#f59e0b",
  tradeImpact: "#60a5fa",
  anchor: "#a78bfa",
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number, decimals = 2) {
  if (!isFinite(n) || isNaN(n)) return "—";
  return n.toFixed(decimals);
}

function computeAlgorithmHealth(timeline: SimStep[], summary: SimSummary) {
  if (!timeline.length) return null;
  const divAbs = timeline.map(t => Math.abs(t.divergencePct ?? 0));
  const maxDiv = Math.max(...divAbs, 0);
  const avgDiv = divAbs.reduce((a, b) => a + b, 0) / divAbs.length;
  const prices = timeline.map(t => t.marketPrice ?? 0);
  const priceChanges = prices.slice(1).map((p, i) => prices[i] > 0 ? Math.abs((p - prices[i]) / prices[i]) * 100 : 0);
  const avgVolatility = priceChanges.length ? priceChanges.reduce((a, b) => a + b, 0) / priceChanges.length : 0;

  const score = summary.healthScore ?? Math.round(Math.max(0, Math.min(100,
    100 - maxDiv * 1.1 - avgVolatility * 3.5 - Math.abs(summary.finalDivergencePct) * 0.4
  )));

  let label: "Healthy" | "Moderate" | "Unstable";
  if (score >= 70)      { label = "Healthy"; }
  else if (score >= 40) { label = "Moderate"; }
  else                  { label = "Unstable"; }

  return { label, score, maxDiv, avgDiv, avgVolatility };
}

function computeBotBehavior(timeline: SimStep[]) {
  if (!timeline.length) return null;
  const totalBotBuys  = timeline.reduce((s, t) => s + (t.botBuyVolume  ?? t.buyTokens  ?? 0), 0);
  const totalBotSells = timeline.reduce((s, t) => s + (t.botSellVolume ?? t.sellTokens ?? 0), 0);
  const totalExtBuys  = timeline.reduce((s, t) => s + (t.externalBuyVolume  ?? 0), 0);
  const totalExtSells = timeline.reduce((s, t) => s + (t.externalSellVolume ?? 0), 0);
  const netPosition   = totalBotBuys - totalBotSells;
  const ratio         = totalBotSells > 0 ? totalBotBuys / totalBotSells : totalBotBuys > 0 ? 999 : 1;
  const avgTradeSize  = timeline.length > 0 ? (totalBotBuys + totalBotSells) / (timeline.length * 2) : 0;
  const dominantSide  = netPosition > 0 ? "Buy" : netPosition < 0 ? "Sell" : "Neutral";
  return { totalBotBuys, totalBotSells, netPosition, ratio, avgTradeSize, dominantSide, totalExtBuys, totalExtSells };
}

function exportJSON(result: SimResult) {
  const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = `gamerstock-sim-${Date.now()}.json`; a.click();
  URL.revokeObjectURL(url);
}

function exportCSV(result: SimResult) {
  const headers = [
    "step","dayLabel","matchNumber","matchScore","recentPerformance","pvi",
    "fairValue","marketPrice","divergencePct",
    "buyTokens","sellTokens","netTokens",
    "externalBuyVolume","externalSellVolume","botBuyVolume","botSellVolume","botNetFlow",
    "tradeImpactContribution","anchorContribution","momentum","volatility","inactivityPenalty",
  ];
  const rows = result.timeline.map(t => headers.map(h => (t as any)[h] ?? "").join(","));
  const configRows = [
    "", "# Config Snapshot",
    ...Object.entries(result.configSnapshot ?? {}).map(([k, v]) => `# ${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`),
    "", "# Execution Flags",
    ...Object.entries(result.executionFlags ?? {}).map(([k, v]) => `# ${k}: ${v}`),
    "", "# Summary",
    ...Object.entries(result.summary ?? {}).map(([k, v]) => `# ${k}: ${v}`),
    "", "# Timeline",
  ];
  const csv = [...configRows, headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = `gamerstock-sim-${Date.now()}.csv`; a.click();
  URL.revokeObjectURL(url);
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function SummaryCard({ label, value, sub, positive }: { label: string; value: string; sub?: string; positive?: boolean }) {
  return (
    <Card className="bg-[#0F1623] border-white/10">
      <CardContent className="pt-4 pb-4">
        <p className="text-xs text-muted-foreground uppercase tracking-widest mb-1">{label}</p>
        <p className={`text-2xl font-mono font-bold ${positive === true ? "text-emerald-400" : positive === false ? "text-red-400" : "text-white"}`}>
          {value}
        </p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function HealthStatusBadge({ status }: { status: "Healthy" | "Moderate" | "Unstable" }) {
  const cfg = {
    Healthy:  { color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20", icon: CheckCircle2 },
    Moderate: { color: "text-yellow-400",  bg: "bg-yellow-500/10 border-yellow-500/20",   icon: AlertTriangle },
    Unstable: { color: "text-red-400",     bg: "bg-red-500/10 border-red-500/20",          icon: XCircle },
  }[status];
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${cfg.color} ${cfg.bg}`}>
      <Icon className="w-3.5 h-3.5" />{status}
    </span>
  );
}

function FlagPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono border ${
      ok ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" : "text-red-400 bg-red-500/10 border-red-500/20"
    }`}>
      {ok ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}{label}
    </span>
  );
}

function PressureTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#0F1623] border border-white/10 rounded-lg px-3 py-2 text-xs">
      <p className="text-muted-foreground mb-1.5">Step {label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.fill ?? p.stroke }}>
          {p.name}: <span className="font-mono">{fmt(p.value, 2)}</span>
        </p>
      ))}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminMarketLabPage() {
  const { toast } = useToast();
  const [config, setConfig] = useState<SimConfig>(DEFAULT_CONFIG);
  const [result, setResult] = useState<SimResult | null>(null);
  const [stressResult, setStressResult] = useState<StressTestResult | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const simulate = useMutation({
    mutationFn: async (cfg: SimConfig) => {
      const res = await apiRequest("POST", "/api/admin/market-lab/simulate", cfg);
      if (!res.ok) { const d = await res.json(); throw new Error(d.message ?? "Simulation failed"); }
      return res.json() as Promise<SimResult>;
    },
    onSuccess: (data) => {
      setResult(data);
      setStressResult(null);
      toast({ title: "Simulation complete", description: `${data.timeline.length} steps computed.` });
    },
    onError: (e: any) => toast({ title: "Simulation failed", description: e.message, variant: "destructive" }),
  });

  const stressTest = useMutation({
    mutationFn: async () => {
      const body = {
        role: config.role, days: config.days, matchesPerDay: config.matchesPerDay,
        useInactivityDecay: config.useInactivityDecay, useSmoothing: config.useSmoothing,
        usePerformanceAnchor: config.usePerformanceAnchor,
      };
      const res = await apiRequest("POST", "/api/admin/market-lab/stress-test", body);
      if (!res.ok) { const d = await res.json(); throw new Error(d.message ?? "Stress test failed"); }
      return res.json() as Promise<StressTestResult>;
    },
    onSuccess: (data) => {
      setStressResult(data);
      toast({ title: "Stress test complete", description: `${data.results.length} scenarios analyzed.` });
    },
    onError: (e: any) => toast({ title: "Stress test failed", description: e.message, variant: "destructive" }),
  });

  const set = <K extends keyof SimConfig>(key: K, val: SimConfig[K]) =>
    setConfig(prev => ({ ...prev, [key]: val }));

  const summary  = result?.summary;
  const timeline = result?.timeline ?? [];

  const health      = useMemo(() => result ? computeAlgorithmHealth(timeline, result.summary) : null, [result]);
  const botBehavior = useMemo(() => computeBotBehavior(timeline), [timeline]);

  return (
    <AdminLayout>
      <div className="flex flex-col gap-6">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-violet-500/30 to-blue-600/30 border border-violet-500/30 flex items-center justify-center">
            <FlaskConical className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white font-display">Market Lab <span className="text-xs text-violet-400 font-normal ml-1">v2</span></h2>
            <p className="text-sm text-muted-foreground">Algorithm Validation Suite — simulate, decompose, and calibrate the GamerStock pricing engine</p>
          </div>
        </div>

        {/* ── Config Panel ───────────────────────────────────────────────── */}
        <Card className="bg-[#0F1623] border-white/10">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-white flex items-center gap-2">
              <Activity className="w-4 h-4 text-violet-400" />
              Simulation Configuration
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* Core params */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground uppercase tracking-wider">Role</Label>
                <Select value={config.role} onValueChange={v => set("role", v)}>
                  <SelectTrigger data-testid="select-role" className="bg-black/30 border-white/10 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["top", "jungle", "mid", "adc", "support"].map(r => (
                      <SelectItem key={r} value={r}>{r.toUpperCase()}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground uppercase tracking-wider">Days: {config.days}</Label>
                <Slider data-testid="slider-days" min={1} max={7} step={1} value={[config.days]} onValueChange={([v]) => set("days", v)} className="mt-3" />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground uppercase tracking-wider">Matches/Day: {config.matchesPerDay}</Label>
                <Slider data-testid="slider-mpd" min={1} max={16} step={1} value={[config.matchesPerDay]} onValueChange={([v]) => set("matchesPerDay", v)} className="mt-3" />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground uppercase tracking-wider">Base Score: {config.initialMatchScore}</Label>
                <Slider data-testid="slider-score" min={10} max={90} step={5} value={[config.initialMatchScore]} onValueChange={([v]) => set("initialMatchScore", v)} className="mt-3" />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground uppercase tracking-wider">Performance Pattern</Label>
                <Select value={config.performancePattern} onValueChange={v => set("performancePattern", v)}>
                  <SelectTrigger data-testid="select-perf-pattern" className="bg-black/30 border-white/10 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["random", "improving", "declining", "volatile", "stable"].map(p => (
                      <SelectItem key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground uppercase tracking-wider">Market Pressure</Label>
                <Select value={config.marketPattern} onValueChange={v => set("marketPattern", v)}>
                  <SelectTrigger data-testid="select-market-pattern" className="bg-black/30 border-white/10 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="balanced">Balanced</SelectItem>
                    <SelectItem value="buy_heavy">Buy Heavy</SelectItem>
                    <SelectItem value="sell_heavy">Sell Heavy</SelectItem>
                    <SelectItem value="oscillating">Oscillating</SelectItem>
                    <SelectItem value="volatile">Volatile</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground uppercase tracking-wider">Bot Intensity</Label>
                <Select value={config.botIntensity} onValueChange={v => set("botIntensity", v)}>
                  <SelectTrigger data-testid="select-bot-intensity" className="bg-black/30 border-white/10 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-3 col-span-1">
                <Label className="text-xs text-muted-foreground uppercase tracking-wider block">Engine Options</Label>
                <div className="flex items-center gap-2">
                  <Switch data-testid="toggle-smoothing" checked={config.useSmoothing} onCheckedChange={v => set("useSmoothing", v)} />
                  <span className="text-xs text-white">EMA Smoothing</span>
                </div>
                <div className="flex items-center gap-2">
                  <Switch data-testid="toggle-inactivity" checked={config.useInactivityDecay} onCheckedChange={v => set("useInactivityDecay", v)} />
                  <span className="text-xs text-white">Inactivity Decay</span>
                </div>
                <div className="flex items-center gap-2">
                  <Switch data-testid="toggle-anchor" checked={config.usePerformanceAnchor} onCheckedChange={v => set("usePerformanceAnchor", v)} />
                  <span className="text-xs text-white">Performance Anchor</span>
                </div>
              </div>
            </div>

            {/* Advanced Controls toggle */}
            <div className="mt-5 pt-4 border-t border-white/5">
              <button
                data-testid="toggle-advanced"
                onClick={() => setShowAdvanced(v => !v)}
                className="flex items-center gap-2 text-xs text-violet-400 hover:text-violet-300 transition-colors"
              >
                <Settings className="w-3.5 h-3.5" />
                {showAdvanced ? "Hide" : "Show"} Advanced Controls
              </button>
            </div>

            {/* Advanced Controls */}
            {showAdvanced && (
              <div className="mt-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-5 p-4 rounded-xl bg-white/3 border border-white/8">
                {/* Bot Behavior Mode */}
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wider">Bot Behavior</Label>
                  <Select value={config.botBehaviorMode} onValueChange={v => set("botBehaviorMode", v)}>
                    <SelectTrigger data-testid="select-bot-mode" className="bg-black/30 border-white/10 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="reworked">Reworked (Role-Based)</SelectItem>
                      <SelectItem value="legacy">Legacy (Synthetic)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground">Reworked: divergence-aware 5-role model</p>
                </div>

                {/* Fair Value Mode */}
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wider">FV Mode</Label>
                  <Select value={config.fairValueMode} onValueChange={v => set("fairValueMode", v)}>
                    <SelectTrigger data-testid="select-fv-mode" className="bg-black/30 border-white/10 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="real">Real (updates with PVI)</SelectItem>
                      <SelectItem value="frozen">Frozen (fixed at start)</SelectItem>
                      <SelectItem value="manual">Manual (constant)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground">Isolate price engine from valuation</p>
                </div>

                {/* Manual FV (only when mode=manual) */}
                {config.fairValueMode === "manual" && (
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground uppercase tracking-wider">Manual FV: ${config.manualFairValue}</Label>
                    <Slider data-testid="slider-manual-fv" min={5} max={30} step={0.5} value={[config.manualFairValue]} onValueChange={([v]) => set("manualFairValue", v)} className="mt-3" />
                  </div>
                )}

                {/* Anchor Strength */}
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wider">Anchor Strength</Label>
                  <Select value={config.anchorStrength} onValueChange={v => set("anchorStrength", v)}>
                    <SelectTrigger data-testid="select-anchor" className="bg-black/30 border-white/10 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="off">Off (0×)</SelectItem>
                      <SelectItem value="weak">Weak (0.4×)</SelectItem>
                      <SelectItem value="medium">Medium (1.0×)</SelectItem>
                      <SelectItem value="strong">Strong (2.5×)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground">PAE pull toward fair value</p>
                </div>

                {/* FV Curve Exponent */}
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wider">FV Curve Exponent</Label>
                  <Select value={String(config.fvCurveExponent)} onValueChange={v => set("fvCurveExponent", parseFloat(v))}>
                    <SelectTrigger data-testid="select-fv-exp" className="bg-black/30 border-white/10 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1.25">1.25 — Flatter curve</SelectItem>
                      <SelectItem value="1.35">1.35 — Moderate</SelectItem>
                      <SelectItem value="1.50">1.50 — Default (steeper)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground">FV = 5 + (pvi/100)^x × 25</p>
                </div>

                {/* Debug Mode */}
                <div className="space-y-3">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wider block">Debug</Label>
                  <div className="flex items-center gap-2">
                    <Switch data-testid="toggle-debug" checked={config.debugMode} onCheckedChange={v => set("debugMode", v)} />
                    <span className="text-xs text-white">Debug Mode</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">Exposes first/last 5 steps + bot role breakdown</p>
                </div>
              </div>
            )}

            {/* Action row */}
            <div className="flex items-center gap-3 mt-6 pt-4 border-t border-white/5 flex-wrap">
              <Button
                data-testid="button-run-simulation"
                onClick={() => simulate.mutate(config)}
                disabled={simulate.isPending || stressTest.isPending}
                className="bg-violet-600 hover:bg-violet-700 text-white px-8"
              >
                {simulate.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Running…</>
                ) : (
                  <><Play className="w-4 h-4 mr-2" />Run Simulation</>
                )}
              </Button>

              <Button
                data-testid="button-run-stress-test"
                onClick={() => stressTest.mutate()}
                disabled={stressTest.isPending || simulate.isPending}
                variant="outline"
                className="border-orange-500/40 text-orange-400 hover:bg-orange-500/10 px-6"
              >
                {stressTest.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Testing…</>
                ) : (
                  <><Zap className="w-4 h-4 mr-2" />Run Stress Test</>
                )}
              </Button>

              <span className="text-xs text-muted-foreground ml-1">
                {config.days * config.matchesPerDay} matches · {config.botBehaviorMode === "reworked" ? "Role-based bots" : "Legacy synthetic"} · FV: {config.fairValueMode} · Anchor: {config.anchorStrength}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* ── Simulation Results ─────────────────────────────────────────── */}
        {result && summary && (
          <>
            {/* Algorithm Health */}
            {health && (
              <Card className="bg-[#0F1623] border-white/10" data-testid="section-algorithm-health">
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-center gap-6 flex-wrap">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                        health.label === "Healthy"  ? "bg-emerald-500/15 border border-emerald-500/20" :
                        health.label === "Moderate" ? "bg-yellow-500/15 border border-yellow-500/20" :
                        "bg-red-500/15 border border-red-500/20"
                      }`}>
                        <HeartPulse className={`w-5 h-5 ${
                          health.label === "Healthy" ? "text-emerald-400" : health.label === "Moderate" ? "text-yellow-400" : "text-red-400"
                        }`} />
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wider">Algorithm Health</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <HealthStatusBadge status={health.label} />
                          <span className={`text-2xl font-mono font-bold ${
                            health.label === "Healthy" ? "text-emerald-400" : health.label === "Moderate" ? "text-yellow-400" : "text-red-400"
                          }`}>{health.score}/100</span>
                        </div>
                      </div>
                    </div>
                    <div className="h-8 w-px bg-white/10 hidden md:block" />
                    <div className="flex items-center gap-6 text-sm flex-wrap">
                      <div>
                        <p className="text-xs text-muted-foreground">Max Divergence</p>
                        <p className={`font-mono font-semibold ${health.maxDiv > 30 ? "text-red-400" : health.maxDiv > 15 ? "text-yellow-400" : "text-emerald-400"}`}>
                          {fmt(health.maxDiv, 1)}%
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Avg Divergence</p>
                        <p className="font-mono font-semibold text-white">{fmt(summary.avgDivergence ?? health.avgDiv, 1)}%</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Price Volatility</p>
                        <p className={`font-mono font-semibold ${health.avgVolatility > 5 ? "text-red-400" : health.avgVolatility > 2 ? "text-yellow-400" : "text-emerald-400"}`}>
                          {fmt(health.avgVolatility, 2)}% avg/step
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Final Divergence</p>
                        <p className={`font-mono font-semibold ${Math.abs(summary.finalDivergencePct) > 20 ? "text-red-400" : "text-white"}`}>
                          {summary.finalDivergencePct >= 0 ? "+" : ""}{fmt(summary.finalDivergencePct, 1)}%
                        </p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Execution Flags */}
            {result.executionFlags && (
              <div className="flex flex-wrap items-center gap-2 px-1">
                <span className="text-xs text-muted-foreground mr-1">Engine:</span>
                <FlagPill ok={result.executionFlags.useRealBotEngine}      label="Real Bots" />
                <FlagPill ok={result.executionFlags.useRealFairValueEngine} label="Real FV Engine" />
                <FlagPill ok={result.executionFlags.useRealPriceEngine}    label="Real Price Engine" />
                <FlagPill ok={result.executionFlags.useRealAnchorLogic}    label="Anchor Logic" />
                <span className="text-xs text-muted-foreground ml-2">
                  FV: <span className="text-white font-mono">{result.executionFlags.fairValueMode}</span>
                  {" · "}Anchor: <span className="text-white font-mono">{result.executionFlags.anchorStrength}</span>
                  {" · "}Exp: <span className="text-white font-mono">{result.executionFlags.fvCurveExponent}</span>
                  {" · "}Bot: <span className="text-white font-mono">{result.executionFlags.botBehaviorMode}</span>
                </span>
              </div>
            )}

            {/* Summary Cards */}
            <div data-testid="section-summary">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Simulation Summary</h3>
                {timeline.length > 0 && (
                  <div className="flex items-center gap-2" data-testid="section-export">
                    <Button data-testid="button-export-json" variant="ghost" size="sm" onClick={() => exportJSON(result)} className="text-xs text-muted-foreground hover:text-white gap-1.5">
                      <Download className="w-3.5 h-3.5" />JSON
                    </Button>
                    <Button data-testid="button-export-csv" variant="ghost" size="sm" onClick={() => exportCSV(result)} className="text-xs text-muted-foreground hover:text-white gap-1.5">
                      <Download className="w-3.5 h-3.5" />CSV
                    </Button>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                <SummaryCard label="Initial Price" value={`$${fmt(summary.initialMarketPrice)}`} />
                <SummaryCard label="Final Price"   value={`$${fmt(summary.finalMarketPrice)}`}  positive={summary.finalMarketPrice >= summary.initialMarketPrice} />
                <SummaryCard label="Total Return"  value={`${summary.totalReturnPct >= 0 ? "+" : ""}${fmt(summary.totalReturnPct)}%`} positive={summary.totalReturnPct >= 0} />
                <SummaryCard label="Initial FV"    value={`$${fmt(summary.initialFairValue)}`} />
                <SummaryCard label="Final FV"      value={`$${fmt(summary.finalFairValue)}`} />
                <SummaryCard label="Final Divergence" value={`${summary.finalDivergencePct >= 0 ? "+" : ""}${fmt(summary.finalDivergencePct)}%`} positive={Math.abs(summary.finalDivergencePct) < 10} />
                <SummaryCard label="Avg Divergence" value={`${fmt(summary.avgDivergence ?? 0, 1)}%`} positive={(summary.avgDivergence ?? 100) < 10} />
                <SummaryCard label="Max Divergence" value={`${fmt(summary.maxDivergence ?? 0, 1)}%`} positive={(summary.maxDivergence ?? 100) < 15} />
                <SummaryCard label="Avg Match Score" value={fmt(summary.avgMatchScore, 1)} sub="out of 100" />
                <SummaryCard label="Avg Volatility" value={`${fmt(summary.avgStepVolatility ?? 0, 2)}% /step`} />
                <SummaryCard label="Positive Steps" value={`${summary.positiveSteps}`} sub={`of ${summary.totalSteps}`} positive={summary.positiveSteps > summary.negativeSteps} />
                <SummaryCard label="Negative Steps" value={`${summary.negativeSteps}`} sub={`of ${summary.totalSteps}`} positive={summary.negativeSteps < summary.positiveSteps} />
              </div>
            </div>

            {/* ── Contribution Decomposition ────────────────────────────── */}
            <Card className="bg-[#0F1623] border-white/10" data-testid="section-contribution">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-white flex items-center gap-2">
                  <Layers className="w-4 h-4 text-violet-400" />
                  Contribution Decomposition
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Trade Impact</p>
                    <p className={`text-xl font-mono font-bold ${(summary.totalTradeImpactContribution ?? 0) >= 0 ? "text-blue-400" : "text-red-400"}`}>
                      {(summary.totalTradeImpactContribution ?? 0) >= 0 ? "+" : ""}${fmt(summary.totalTradeImpactContribution ?? 0)}
                    </p>
                    <p className="text-xs text-muted-foreground">net flow + gravity</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Buy Impact</p>
                    <p className="text-xl font-mono font-bold text-emerald-400">
                      +${fmt(summary.totalBuyImpact ?? 0)}
                    </p>
                    <p className="text-xs text-muted-foreground">price up from buys</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Sell Impact</p>
                    <p className="text-xl font-mono font-bold text-red-400">
                      {fmt(summary.totalSellImpact ?? 0)}$
                    </p>
                    <p className="text-xs text-muted-foreground">price down from sells</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Anchor Total</p>
                    <p className={`text-xl font-mono font-bold ${(summary.totalAnchorContribution ?? 0) >= 0 ? "text-violet-400" : "text-red-400"}`}>
                      {(summary.totalAnchorContribution ?? 0) >= 0 ? "+" : ""}${fmt(summary.totalAnchorContribution ?? 0)}
                    </p>
                    <p className="text-xs text-muted-foreground">dynamic convergence force</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Bot Buy / Sell</p>
                    <p className="text-xl font-mono font-bold">
                      <span className="text-emerald-400">{summary.totalBotBuyVolume ?? 0}</span>
                      <span className="text-muted-foreground mx-1">/</span>
                      <span className="text-red-400">{summary.totalBotSellVolume ?? 0}</span>
                    </p>
                    <p className={`text-xs font-mono ${(summary.totalBotNetFlow ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      Net: {(summary.totalBotNetFlow ?? 0) >= 0 ? "+" : ""}{summary.totalBotNetFlow ?? 0}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Ext Buy / Sell</p>
                    <p className="text-xl font-mono font-bold">
                      <span className="text-emerald-400">{summary.totalExternalBuyVolume ?? 0}</span>
                      <span className="text-muted-foreground mx-1">/</span>
                      <span className="text-red-400">{summary.totalExternalSellVolume ?? 0}</span>
                    </p>
                    <p className={`text-xs font-mono ${(summary.netExternalFlow ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      Net: {(summary.netExternalFlow ?? 0) >= 0 ? "+" : ""}{summary.netExternalFlow ?? 0}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* ── Charts ──────────────────────────────────────────────── */}
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Simulation Analytics</h3>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

                {/* Chart 1: Market Price vs Fair Value */}
                <Card className="bg-[#0F1623] border-white/10" data-testid="chart-price-fv">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-white flex items-center gap-2">
                      <DollarSign className="w-4 h-4 text-blue-400" />
                      Market Price vs Fair Value
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={220}>
                      <LineChart data={timeline} margin={{ top: 5, right: 12, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff0f" />
                        <XAxis dataKey="step" tick={{ fill: "#6b7280", fontSize: 10 }} />
                        <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} tickFormatter={v => `$${v}`} domain={["auto", "auto"]} width={44} />
                        <Tooltip
                          contentStyle={{ background: "#0F1623", border: "1px solid #ffffff1a", borderRadius: 6, fontSize: 12 }}
                          labelStyle={{ color: "#9ca3af" }}
                          formatter={(v: number, name: string) => [`$${fmt(v)}`, name]}
                        />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Line type="monotone" dataKey="marketPrice" stroke={CHART_COLORS.marketPrice} dot={false} strokeWidth={2} name="Market Price" />
                        <Line type="monotone" dataKey="fairValue"   stroke={CHART_COLORS.fairValue}   dot={false} strokeWidth={2} strokeDasharray="5 3" name="Fair Value" />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                {/* Chart 2: Match Performance */}
                <Card className="bg-[#0F1623] border-white/10" data-testid="chart-perf">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-white flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-violet-400" />
                      Match Performance
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={220}>
                      <LineChart data={timeline} margin={{ top: 5, right: 12, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff0f" />
                        <XAxis dataKey="step" tick={{ fill: "#6b7280", fontSize: 10 }} />
                        <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} domain={[0, 100]} width={36} />
                        <Tooltip
                          contentStyle={{ background: "#0F1623", border: "1px solid #ffffff1a", borderRadius: 6, fontSize: 12 }}
                          labelStyle={{ color: "#9ca3af" }}
                          formatter={(v: number, name: string) => [fmt(v, 1), name]}
                        />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <ReferenceLine y={50} stroke="#ffffff20" strokeDasharray="4 4" />
                        <Line type="monotone" dataKey="matchScore"       stroke={CHART_COLORS.matchScore} dot={false} strokeWidth={2} name="Match Score" />
                        <Line type="monotone" dataKey="recentPerformance" stroke={CHART_COLORS.recentPerf} dot={false} strokeWidth={2} name="Recent Perf" />
                        <Line type="monotone" dataKey="pvi"              stroke={CHART_COLORS.pvi}        dot={false} strokeWidth={1.5} strokeDasharray="4 2" name="PVI" />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                {/* Chart 3: Market Pressure */}
                <Card className="bg-[#0F1623] border-white/10" data-testid="chart-flow">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-white flex items-center gap-2">
                      <ArrowUpDown className="w-4 h-4 text-emerald-400" />
                      Market Pressure (Buy / Sell / Net)
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={220}>
                      <ComposedChart data={timeline} margin={{ top: 5, right: 12, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff0f" />
                        <XAxis dataKey="step" tick={{ fill: "#6b7280", fontSize: 10 }} />
                        <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} width={36} />
                        <Tooltip content={<PressureTooltip />} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <ReferenceLine y={0} stroke="#ffffff30" />
                        <Bar dataKey="buyTokens"  fill={CHART_COLORS.buy}  name="Buy Volume"  opacity={0.75} maxBarSize={20} />
                        <Bar dataKey="sellTokens" fill={CHART_COLORS.sell} name="Sell Volume" opacity={0.75} maxBarSize={20} />
                        <Line type="monotone" dataKey="netTokens" stroke={CHART_COLORS.net} strokeWidth={2} dot={false} name="Net Flow" />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                {/* Chart 4: Divergence */}
                <Card className="bg-[#0F1623] border-white/10" data-testid="chart-divergence">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-white flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-yellow-400" />
                      Price Divergence %
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={220}>
                      <LineChart data={timeline} margin={{ top: 5, right: 12, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff0f" />
                        <XAxis dataKey="step" tick={{ fill: "#6b7280", fontSize: 10 }} />
                        <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} tickFormatter={v => `${v}%`} width={44} />
                        <Tooltip
                          contentStyle={{ background: "#0F1623", border: "1px solid #ffffff1a", borderRadius: 6, fontSize: 12 }}
                          labelStyle={{ color: "#9ca3af" }}
                          formatter={(v: number, name: string) => [`${fmt(v, 1)}%`, name]}
                        />
                        <ReferenceLine y={0}   stroke="#ffffff30" strokeDasharray="4 4" />
                        <ReferenceLine y={15}  stroke="#f59e0b30" strokeDasharray="4 4" label={{ value: "+15%", fill: "#f59e0b60", fontSize: 9 }} />
                        <ReferenceLine y={-15} stroke="#f59e0b30" strokeDasharray="4 4" label={{ value: "−15%", fill: "#f59e0b60", fontSize: 9 }} />
                        <Line type="monotone" dataKey="divergencePct" stroke={CHART_COLORS.divergence} dot={false} strokeWidth={2} name="Divergence %" />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                {/* Chart 5: Anchor vs Trade Impact */}
                <Card className="bg-[#0F1623] border-white/10 lg:col-span-2" data-testid="chart-anchor-vs-impact">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-white flex items-center gap-2">
                      <Zap className="w-4 h-4 text-orange-400" />
                      Anchor Contribution vs Trade Impact Contribution
                      <span className="text-xs text-muted-foreground font-normal ml-1">(per-step price change in GS$)</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={200}>
                      <ComposedChart data={timeline} margin={{ top: 5, right: 12, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff0f" />
                        <XAxis dataKey="step" tick={{ fill: "#6b7280", fontSize: 10 }} />
                        <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} tickFormatter={v => `$${v.toFixed(2)}`} width={56} />
                        <Tooltip
                          contentStyle={{ background: "#0F1623", border: "1px solid #ffffff1a", borderRadius: 6, fontSize: 12 }}
                          labelStyle={{ color: "#9ca3af" }}
                          formatter={(v: number, name: string) => [`$${fmt(v, 4)}`, name]}
                        />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <ReferenceLine y={0} stroke="#ffffff20" />
                        <Bar dataKey="tradeImpactContribution" fill={CHART_COLORS.tradeImpact} name="Trade Impact" opacity={0.75} maxBarSize={20} />
                        <Line type="monotone" dataKey="anchorContribution" stroke={CHART_COLORS.anchor} strokeWidth={2} dot={false} name="Anchor Contribution" />
                      </ComposedChart>
                    </ResponsiveContainer>
                    <p className="text-[10px] text-muted-foreground mt-2">
                      Bars show net price change from buy/sell flow + gravity. Line shows PAE anchor correction.
                      When anchor cancels trade impact, convergence is working correctly.
                    </p>
                  </CardContent>
                </Card>
              </div>
            </div>

            {/* ── Config Snapshot ───────────────────────────────────────── */}
            {result.configSnapshot && (
              <Card className="bg-[#0F1623] border-white/10" data-testid="section-config-snapshot">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-white flex items-center gap-2">
                    <Info className="w-4 h-4 text-blue-400" />
                    Simulation Config Snapshot
                    <span className="text-xs text-muted-foreground font-normal ml-1">exact parameters used by the engine</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-2 text-xs">
                    {[
                      { k: "Role",               v: result.configSnapshot.role.toUpperCase() },
                      { k: "Days",               v: result.configSnapshot.days },
                      { k: "Matches/Day",        v: result.configSnapshot.matchesPerDay },
                      { k: "Base Score",         v: result.configSnapshot.baseScore },
                      { k: "Performance Pattern",v: result.configSnapshot.performancePattern },
                      { k: "Market Pattern",     v: result.configSnapshot.marketPattern },
                      { k: "Bot Intensity",      v: result.configSnapshot.botIntensity },
                      { k: "Bot Count (roles)",  v: result.configSnapshot.botCountUsed },
                      { k: "Bot Interval",       v: result.configSnapshot.botIntervalUsed },
                      { k: "EMA Smoothing",      v: result.configSnapshot.emaEnabled ? "ON" : "OFF" },
                      { k: "Inactivity Decay",   v: result.configSnapshot.inactivityDecayEnabled ? "ON" : "OFF" },
                      { k: "Performance Anchor", v: result.configSnapshot.performanceAnchorEnabled ? "ON" : "OFF" },
                      { k: "Anchor Engine",      v: result.configSnapshot.anchorEngineVersion ?? "v2-pae" },
                      { k: "Anchor Strength",    v: result.configSnapshot.anchorStrengthUsed },
                      { k: "Anchor Multiplier",  v: `${result.configSnapshot.anchorMultiplierUsed}×` },
                      { k: "Initial Supply",     v: result.configSnapshot.initialSupplyUsed != null ? Math.round(result.configSnapshot.initialSupplyUsed) : "150 (legacy)" },
                      { k: "FV Formula",         v: result.configSnapshot.fairValueFormulaUsed },
                      { k: "FV Exponent",        v: result.configSnapshot.fairValueExponentUsed },
                      { k: "FV Mode",            v: result.configSnapshot.fairValueModeUsed },
                      { k: "Manual FV",          v: result.configSnapshot.manualFairValueUsed != null ? `$${result.configSnapshot.manualFairValueUsed}` : "n/a" },
                      { k: "Liquidity Depth",    v: result.configSnapshot.liquidityDepthUsed },
                      { k: "Price Impact",       v: result.configSnapshot.priceImpactFormulaUsed },
                    ].map(({ k, v }) => (
                      <div key={k} className="flex flex-col gap-0.5 py-1 border-b border-white/5">
                        <span className="text-muted-foreground text-[10px] uppercase tracking-wider">{k}</span>
                        <span className="text-white font-mono text-xs">{String(v)}</span>
                      </div>
                    ))}
                  </div>
                  {/* Bot role weights */}
                  <div className="mt-3 pt-3 border-t border-white/5">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Bot Role Weights</p>
                    <div className="flex flex-wrap gap-3">
                      {Object.entries(result.configSnapshot.botRoleWeightsUsed).map(([role, weight]) => (
                        <div key={role} className="flex items-center gap-1.5 text-xs">
                          <span className="text-muted-foreground capitalize">{role.replace("_", " ")}:</span>
                          <span className="text-white font-mono font-semibold">{(Number(weight) * 100).toFixed(0)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* ── Match Simulation Log ──────────────────────────────────── */}
            <Card className="bg-[#0F1623] border-white/10" data-testid="table-timeline">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-white flex items-center gap-2">
                  <Activity className="w-4 h-4 text-blue-400" />
                  Match Simulation Log
                  <Badge variant="outline" className="ml-2 text-xs border-white/10 text-muted-foreground">
                    {timeline.length} steps
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-[#0F1623] z-10">
                      <tr className="border-b border-white/10 text-muted-foreground">
                        {["Match","Day","Score","RecentPerf","PVI","Fair Value","Mkt Price","Div%","ExtBuy","ExtSell","BotBuy","BotSell","Net","Anchor$","Impact$","Momentum"].map(h => (
                          <th key={h} className="px-2 py-2.5 text-left font-medium tracking-wider whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {timeline.map((row) => (
                        <tr key={row.step} data-testid={`row-step-${row.step}`} className="border-b border-white/5 hover:bg-white/3 transition-colors">
                          <td className="px-2 py-1.5 font-mono text-muted-foreground">{row.step}</td>
                          <td className="px-2 py-1.5 text-muted-foreground whitespace-nowrap">{row.dayLabel} M{row.matchNumber}</td>
                          <td className={`px-2 py-1.5 font-mono font-medium ${row.matchScore >= 60 ? "text-emerald-400" : row.matchScore < 45 ? "text-red-400" : "text-white"}`}>
                            {fmt(row.matchScore, 1)}
                          </td>
                          <td className="px-2 py-1.5 font-mono text-purple-300">{fmt(row.recentPerformance, 1)}</td>
                          <td className="px-2 py-1.5 font-mono text-orange-300">{fmt(row.pvi, 1)}</td>
                          <td className="px-2 py-1.5 font-mono text-yellow-400">${fmt(row.fairValue)}</td>
                          <td className="px-2 py-1.5 font-mono text-blue-400 font-semibold">${fmt(row.marketPrice)}</td>
                          <td className={`px-2 py-1.5 font-mono ${Math.abs(row.divergencePct) > 20 ? "text-red-400" : Math.abs(row.divergencePct) < 8 ? "text-emerald-400" : "text-yellow-400"}`}>
                            {row.divergencePct >= 0 ? "+" : ""}{fmt(row.divergencePct, 1)}%
                          </td>
                          <td className="px-2 py-1.5 font-mono text-emerald-400/70">{row.externalBuyVolume ?? "—"}</td>
                          <td className="px-2 py-1.5 font-mono text-red-400/70">{row.externalSellVolume ?? "—"}</td>
                          <td className="px-2 py-1.5 font-mono text-emerald-400">{row.botBuyVolume ?? "—"}</td>
                          <td className="px-2 py-1.5 font-mono text-red-400">{row.botSellVolume ?? "—"}</td>
                          <td className={`px-2 py-1.5 font-mono ${row.netTokens >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                            {row.netTokens >= 0 ? "+" : ""}{row.netTokens}
                          </td>
                          <td className={`px-2 py-1.5 font-mono text-[10px] ${(row.anchorContribution ?? 0) >= 0 ? "text-violet-400" : "text-rose-400"}`}>
                            {(row.anchorContribution ?? 0) >= 0 ? "+" : ""}{fmt(row.anchorContribution ?? 0, 3)}
                          </td>
                          <td className={`px-2 py-1.5 font-mono text-[10px] ${(row.tradeImpactContribution ?? 0) >= 0 ? "text-blue-400" : "text-red-400"}`}>
                            {(row.tradeImpactContribution ?? 0) >= 0 ? "+" : ""}{fmt(row.tradeImpactContribution ?? 0, 3)}
                          </td>
                          <td className={`px-2 py-1.5 font-mono ${row.momentum >= 0 ? "text-emerald-300" : "text-red-300"}`}>
                            {row.momentum >= 0 ? "+" : ""}{fmt(row.momentum, 3)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* ── Bot Behavior ──────────────────────────────────────────── */}
            {botBehavior && (
              <Card className="bg-[#0F1623] border-white/10" data-testid="section-bot-behavior">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-white flex items-center gap-2">
                    <BotIcon className="w-4 h-4 text-cyan-400" />
                    Bot Behavior
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
                    <div className="space-y-0.5">
                      <p className="text-xs text-muted-foreground uppercase tracking-wider">Bot Buys</p>
                      <p className="text-xl font-mono font-bold text-emerald-400">{botBehavior.totalBotBuys}</p>
                      <p className="text-xs text-muted-foreground">tokens bought</p>
                    </div>
                    <div className="space-y-0.5">
                      <p className="text-xs text-muted-foreground uppercase tracking-wider">Bot Sells</p>
                      <p className="text-xl font-mono font-bold text-red-400">{botBehavior.totalBotSells}</p>
                      <p className="text-xs text-muted-foreground">tokens sold</p>
                    </div>
                    <div className="space-y-0.5">
                      <p className="text-xs text-muted-foreground uppercase tracking-wider">External Buys</p>
                      <p className="text-xl font-mono font-bold text-emerald-400/60">{botBehavior.totalExtBuys}</p>
                      <p className="text-xs text-muted-foreground">market pressure</p>
                    </div>
                    <div className="space-y-0.5">
                      <p className="text-xs text-muted-foreground uppercase tracking-wider">Bot/Sell Ratio</p>
                      <p className={`text-xl font-mono font-bold ${botBehavior.ratio > 1.2 ? "text-emerald-400" : botBehavior.ratio < 0.8 ? "text-red-400" : "text-white"}`}>
                        {botBehavior.ratio === 999 ? "∞" : fmt(botBehavior.ratio, 2)}×
                      </p>
                      <p className="text-xs text-muted-foreground">bot buy ÷ sell</p>
                    </div>
                    <div className="space-y-0.5">
                      <p className="text-xs text-muted-foreground uppercase tracking-wider">Dominant Pressure</p>
                      <span className={`inline-block mt-1 text-sm font-semibold px-2 py-0.5 rounded-full border ${
                        botBehavior.dominantSide === "Buy"  ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" :
                        botBehavior.dominantSide === "Sell" ? "text-red-400 bg-red-500/10 border-red-500/20" :
                        "text-muted-foreground bg-white/5 border-white/10"
                      }`}>{botBehavior.dominantSide}</span>
                    </div>
                  </div>

                  {(botBehavior.ratio > 2 || botBehavior.ratio < 0.5) && (
                    <div className="mb-3 px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-xs text-yellow-400">
                      {botBehavior.ratio > 2 ? "⚠ Heavy bot buy bias — may amplify upward divergence" : "⚠ Heavy bot sell bias — may amplify downward divergence"}
                    </div>
                  )}

                  <div data-testid="chart-bot-activity">
                    <p className="text-xs text-muted-foreground mb-2">Bot vs External Activity per Step</p>
                    <ResponsiveContainer width="100%" height={130}>
                      <BarChart data={timeline} margin={{ top: 0, right: 8, left: 0, bottom: 0 }} barSize={4}>
                        <XAxis dataKey="step" tick={false} height={4} />
                        <YAxis tick={{ fill: "#6b7280", fontSize: 9 }} width={28} />
                        <Tooltip
                          contentStyle={{ background: "#0F1623", border: "1px solid #ffffff1a", borderRadius: 6, fontSize: 11 }}
                          formatter={(v: number, name: string) => [v, name]}
                        />
                        <Legend wrapperStyle={{ fontSize: 10 }} />
                        <Bar dataKey="botBuyVolume"  fill={CHART_COLORS.buy}  name="Bot Buy"  opacity={0.9} />
                        <Bar dataKey="botSellVolume" fill={CHART_COLORS.sell} name="Bot Sell" opacity={0.9} />
                        <Bar dataKey="externalBuyVolume"  fill="#34d39940" name="Ext Buy"  opacity={0.7} />
                        <Bar dataKey="externalSellVolume" fill="#f8717140" name="Ext Sell" opacity={0.7} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* ── Debug Panel ────────────────────────────────────────────── */}
            {result.debugInfo && (
              <Card className="bg-[#0F1623] border-yellow-500/20" data-testid="section-debug">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-yellow-400 flex items-center gap-2">
                    <Bug className="w-4 h-4" />
                    Debug Mode Output
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {/* Config warnings */}
                  {result.debugInfo.configWarnings.length > 0 && (
                    <div className="mb-4 space-y-1">
                      <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Config Warnings</p>
                      {result.debugInfo.configWarnings.map((w, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs text-yellow-400 bg-yellow-500/10 px-3 py-1.5 rounded border border-yellow-500/20">
                          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />{w}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Bot role breakdown */}
                  <div className="mb-4">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Bot Role Breakdown (cumulative)</p>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                      {Object.entries(result.debugInfo.botRoleBreakdown).map(([role, data]) => (
                        <div key={role} className="bg-white/3 rounded-lg p-2.5 border border-white/5">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">{role.replace("_", " ")}</p>
                          <p className="text-xs font-mono"><span className="text-emerald-400">B:{data.buy}</span> / <span className="text-red-400">S:{data.sell}</span></p>
                          <p className={`text-[10px] font-mono ${data.buy - data.sell >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                            Net: {data.buy - data.sell >= 0 ? "+" : ""}{data.buy - data.sell}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* First + last 5 steps */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">First 5 Steps</p>
                      <div className="space-y-1">
                        {result.debugInfo.firstSteps.map(s => (
                          <div key={s.step} className="text-xs font-mono text-muted-foreground bg-white/3 rounded px-2 py-1">
                            S{s.step}: MP=${fmt(s.marketPrice)} FV=${fmt(s.fairValue)} Div={fmt(s.divergencePct, 1)}% Anchor={fmt(s.anchorContribution ?? 0, 4)}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Last 5 Steps</p>
                      <div className="space-y-1">
                        {result.debugInfo.lastSteps.map(s => (
                          <div key={s.step} className="text-xs font-mono text-muted-foreground bg-white/3 rounded px-2 py-1">
                            S{s.step}: MP=${fmt(s.marketPrice)} FV=${fmt(s.fairValue)} Div={fmt(s.divergencePct, 1)}% Anchor={fmt(s.anchorContribution ?? 0, 4)}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {/* ── Stress Test Results ────────────────────────────────────────── */}
        {stressResult && (
          <Card className="bg-[#0F1623] border-white/10" data-testid="section-stress-results">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-white flex items-center gap-2">
                <Zap className="w-4 h-4 text-orange-400" />
                Stress Test Results
                <Badge variant="outline" className="ml-2 text-xs border-white/10 text-muted-foreground">4 scenarios</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10 bg-white/3 text-muted-foreground text-xs">
                      <th className="px-4 py-3 text-left font-medium">Scenario</th>
                      <th className="px-4 py-3 text-right font-medium">Final Price</th>
                      <th className="px-4 py-3 text-right font-medium">Final FV</th>
                      <th className="px-4 py-3 text-right font-medium">Max Div</th>
                      <th className="px-4 py-3 text-right font-medium">Volatility</th>
                      <th className="px-4 py-3 text-right font-medium">Total Return</th>
                      <th className="px-4 py-3 text-right font-medium">Health</th>
                      <th className="px-4 py-3 text-right font-medium">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stressResult.results.map((sc, i) => (
                      <tr key={i} data-testid={`row-stress-${i + 1}`} className="border-b border-white/5 hover:bg-white/3 transition-colors">
                        <td className="px-4 py-3">
                          <p className="font-medium text-white text-xs">{sc.scenario}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{sc.description}</p>
                          {sc.error && <p className="text-xs text-red-400 mt-0.5">Error: {sc.error}</p>}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-blue-400 font-semibold">{sc.error ? "—" : `$${fmt(sc.finalPrice)}`}</td>
                        <td className="px-4 py-3 text-right font-mono text-yellow-400">{sc.error ? "—" : `$${fmt(sc.finalFairValue)}`}</td>
                        <td className={`px-4 py-3 text-right font-mono ${sc.maxDivergence > 30 ? "text-red-400" : sc.maxDivergence > 15 ? "text-yellow-400" : "text-emerald-400"}`}>
                          {sc.error ? "—" : `${fmt(sc.maxDivergence, 1)}%`}
                        </td>
                        <td className={`px-4 py-3 text-right font-mono ${sc.priceVolatility > 5 ? "text-red-400" : sc.priceVolatility > 2 ? "text-yellow-400" : "text-emerald-400"}`}>
                          {sc.error ? "—" : `${fmt(sc.priceVolatility, 2)}%`}
                        </td>
                        <td className={`px-4 py-3 text-right font-mono font-semibold ${sc.totalReturn >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                          {sc.error ? "—" : `${sc.totalReturn >= 0 ? "+" : ""}${fmt(sc.totalReturn, 1)}%`}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {sc.error ? <span className="text-red-400 text-xs">Error</span> : <HealthStatusBadge status={sc.healthStatus} />}
                        </td>
                        <td className={`px-4 py-3 text-right font-mono font-bold ${sc.healthScore >= 70 ? "text-emerald-400" : sc.healthScore >= 40 ? "text-yellow-400" : "text-red-400"}`}>
                          {sc.error ? "—" : sc.healthScore}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-3 border-t border-white/5 flex flex-wrap gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />Healthy = MaxDiv &lt;20%, Volatility &lt;3%</span>
                <span className="flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5 text-yellow-400" />Moderate = MaxDiv &lt;40%, Volatility &lt;8%</span>
                <span className="flex items-center gap-1"><XCircle className="w-3.5 h-3.5 text-red-400" />Unstable = beyond those thresholds</span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Empty state ─────────────────────────────────────────────────── */}
        {!result && !stressResult && !simulate.isPending && !stressTest.isPending && (
          <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
            <FlaskConical className="w-10 h-10 mb-4 opacity-30" />
            <p className="text-sm">Configure a scenario above and click <strong className="text-white">Run Simulation</strong> to see results.</p>
            <p className="text-xs mt-2 opacity-70">Or use <strong className="text-orange-400">Run Stress Test</strong> to benchmark all 4 canonical scenarios at once.</p>
            <p className="text-xs mt-1 opacity-50">New in v2: role-based bots, contribution decomposition, anchor vs impact chart, debug mode.</p>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}

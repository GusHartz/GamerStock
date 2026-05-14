// ─── PerformanceChartSection ──────────────────────────────────────────────────
// Market performance chart for the Player Public Page.
// Shows daily price/volume/momentum history with a range selector.
// Data comes from GET /api/player-public/:assetId/performance-history.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from "recharts";
import { TrendingUp, BarChart2, Activity, AlertCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

type PerfRange  = "7d" | "30d" | "90d";
type PerfMetric = "price" | "volume" | "momentum";
type DataSource = "snapshots" | "trades" | "empty";

interface PerfPoint { date: string; value: number }

interface PerformanceHistoryResponse {
  assetId:    number;
  metric:     PerfMetric;
  range:      PerfRange;
  dataSource: DataSource;
  points:     PerfPoint[];
}

// ── Config ────────────────────────────────────────────────────────────────────

const RANGES: { label: string; value: PerfRange }[] = [
  { label: "7D",  value: "7d"  },
  { label: "30D", value: "30d" },
  { label: "90D", value: "90d" },
];

const METRICS: { label: string; value: PerfMetric; Icon: React.ComponentType<{ className?: string }> }[] = [
  { label: "Price",    value: "price",    Icon: TrendingUp },
  { label: "Volume",   value: "volume",   Icon: BarChart2  },
  { label: "Momentum", value: "momentum", Icon: Activity   },
];

const METRIC_FORMAT: Record<PerfMetric, (v: number) => string> = {
  price:    (v) => `${v.toFixed(2)} GS`,
  volume:   (v) => v >= 1000 ? `${(v / 1000).toFixed(1)}K GS` : `${v.toFixed(0)} GS`,
  momentum: (v) => `${(v * 100).toFixed(3)}%`,
};

const CHART_COLOR: Record<PerfMetric, string> = {
  price:    "#3b82f6",
  volume:   "#8b5cf6",
  momentum: "#10b981",
};

// ── Custom Tooltip ────────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label, metric }: {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
  metric: PerfMetric;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#0f1117] border border-white/15 rounded-lg px-3 py-2 text-xs shadow-xl">
      <p className="text-white/40 mb-0.5">{label}</p>
      <p className="text-white font-semibold">{METRIC_FORMAT[metric](payload[0].value)}</p>
    </div>
  );
}

// ── Empty / Error / Loading ───────────────────────────────────────────────────

function EmptyState({ metric }: { metric: PerfMetric }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 h-40 text-center">
      <div className="p-3 rounded-xl bg-white/5">
        <BarChart2 className="w-6 h-6 text-white/20" />
      </div>
      <div>
        <p className="text-sm text-white/30">No {metric} history yet</p>
        <p className="text-xs text-white/20 mt-0.5">Data will appear once the asset becomes active</p>
      </div>
    </div>
  );
}

function ErrorState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 h-40 text-center">
      <AlertCircle className="w-6 h-6 text-white/20" />
      <p className="text-sm text-white/30">Could not load chart data</p>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center h-40">
      <Loader2 className="w-6 h-6 text-white/20 animate-spin" />
    </div>
  );
}

// ── Date formatting ───────────────────────────────────────────────────────────

function formatDateLabel(dateStr: string, range: PerfRange): string {
  const d = new Date(dateStr + "T00:00:00Z");
  if (range === "7d") {
    return d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

// ── Source note ───────────────────────────────────────────────────────────────

function SourceNote({ source }: { source: DataSource }) {
  if (source === "snapshots") return null;
  if (source === "trades") {
    return (
      <p className="text-xs text-white/25 mt-2">
        Based on trade activity — snapshot history not yet available for this asset.
      </p>
    );
  }
  return null;
}

// ── Chart ─────────────────────────────────────────────────────────────────────

function PerfChart({ points, metric, range }: { points: PerfPoint[]; metric: PerfMetric; range: PerfRange }) {
  const color = CHART_COLOR[metric];
  const gradientId = `perf-grad-${metric}`;

  // Pad the Y domain slightly for better visual
  const values = points.map((p) => p.value);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const pad    = (maxVal - minVal) * 0.15 || 0.5;
  const yMin   = Math.max(0, minVal - pad);
  const yMax   = maxVal + pad;

  const chartData = points.map((p) => ({
    date:    formatDateLabel(p.date, range),
    rawDate: p.date,
    value:   p.value,
  }));

  // Tick density
  const tickCount = range === "7d" ? 7 : range === "30d" ? 8 : 9;

  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={color} stopOpacity={0.25} />
            <stop offset="95%" stopColor={color} stopOpacity={0}    />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
          tickCount={tickCount}
        />
        <YAxis
          domain={[yMin, yMax]}
          tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          width={45}
          tickFormatter={(v) => METRIC_FORMAT[metric](v).split(" ")[0]}
        />
        <Tooltip content={<ChartTooltip metric={metric} />} />
        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          dot={false}
          activeDot={{ r: 4, fill: color, strokeWidth: 0 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Main section ──────────────────────────────────────────────────────────────

interface PerformanceChartSectionProps {
  assetId: number;
}

export function PerformanceChartSection({ assetId }: PerformanceChartSectionProps) {
  const [range,  setRange]  = useState<PerfRange>("30d");
  const [metric, setMetric] = useState<PerfMetric>("price");

  const { data, isLoading, isError } = useQuery<PerformanceHistoryResponse>({
    queryKey: ["/api/player-public", String(assetId), "performance-history", range, metric],
    queryFn: async () => {
      const res = await fetch(
        `/api/player-public/${assetId}/performance-history?range=${range}&metric=${metric}`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? "Failed to load chart");
      }
      return res.json();
    },
    staleTime: 60_000,
  });

  const hasData = (data?.points?.length ?? 0) >= 2;

  return (
    <div
      className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-4"
      data-testid="performance-chart-section"
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-white" data-testid="perf-chart-title">
            Market Performance
          </h2>
          <p className="text-xs text-white/35 mt-0.5">Asset price evolution over time</p>
        </div>

        {/* Range selector */}
        <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1" data-testid="perf-range-selector">
          {RANGES.map(({ label, value }) => (
            <button
              key={value}
              onClick={() => setRange(value)}
              className={cn(
                "text-xs px-2.5 py-1 rounded-md transition-colors font-medium",
                range === value
                  ? "bg-white/15 text-white"
                  : "text-white/40 hover:text-white/70",
              )}
              data-testid={`perf-range-${value}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Metric selector */}
      <div className="flex gap-2" data-testid="perf-metric-selector">
        {METRICS.map(({ label, value, Icon }) => (
          <button
            key={value}
            onClick={() => setMetric(value)}
            className={cn(
              "flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors font-medium",
              metric === value
                ? "border-white/25 bg-white/10 text-white"
                : "border-white/8 text-white/35 hover:text-white/60 hover:border-white/15",
            )}
            data-testid={`perf-metric-${value}`}
          >
            <Icon className="w-3 h-3" />
            {label}
          </button>
        ))}
      </div>

      {/* Chart area */}
      <div data-testid="perf-chart-area">
        {isLoading && <LoadingState />}
        {isError   && <ErrorState />}
        {!isLoading && !isError && !hasData && <EmptyState metric={metric} />}
        {!isLoading && !isError &&  hasData && (
          <PerfChart points={data!.points} metric={metric} range={range} />
        )}
      </div>

      {/* Source note */}
      {data && <SourceNote source={data.dataSource} />}
    </div>
  );
}

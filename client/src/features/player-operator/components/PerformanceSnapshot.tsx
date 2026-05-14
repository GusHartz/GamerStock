import { TrendingUp, TrendingDown, Minus, AlertCircle, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { usePerformanceSnapshot } from "../hooks/use-operator";

// ── KPI tile ──────────────────────────────────────────────────────────────────

function KpiTile({
  label,
  value,
  delta,
  isMock = false,
  testId,
}: {
  label: string;
  value: string;
  delta: number;
  isMock?: boolean;
  testId?: string;
}) {
  const isPos = delta > 0;
  const isNeg = delta < 0;
  return (
    <div
      className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-1.5"
      data-testid={testId}
    >
      <p className="text-xs text-white/40 uppercase tracking-wider font-medium">{label}</p>
      <p className={cn("text-xl font-bold", isMock ? "text-white/30" : "text-white")}>
        {isMock ? "—" : value}
      </p>
      <div className="flex items-center gap-1">
        {isMock ? (
          <span className="text-xs text-white/20">no data yet</span>
        ) : delta === 0 ? (
          <span className="flex items-center gap-1 text-xs text-white/40">
            <Minus className="w-3 h-3" />
            —
          </span>
        ) : isPos ? (
          <span className="flex items-center gap-1 text-xs text-emerald-400">
            <TrendingUp className="w-3 h-3" />
            +{delta.toFixed(1)}%
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs text-red-400">
            <TrendingDown className="w-3 h-3" />
            {delta.toFixed(1)}%
          </span>
        )}
      </div>
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SnapshotSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="h-24 bg-white/5 rounded-xl animate-pulse" />
      ))}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  assetId: number;
}

export function PerformanceSnapshot({ assetId }: Props) {
  const { data, isLoading, isError, dataUpdatedAt } = usePerformanceSnapshot(assetId);

  const isAllZero = data &&
    data.earningsTotal === 0 &&
    data.holdersTotal === 0 &&
    data.volumeTotal === 0;

  return (
    <section id="performance-snapshot" className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white/70 uppercase tracking-wider">
          Performance Snapshot
        </h2>
        {dataUpdatedAt > 0 && (
          <span className="text-xs text-white/30 flex items-center gap-1">
            <RefreshCw className="w-3 h-3" />
            {new Date(dataUpdatedAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      {isLoading && <SnapshotSkeleton />}

      {isError && (
        <div className="flex items-center gap-2 text-sm text-red-400 p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          Failed to load performance data.
        </div>
      )}

      {data && (
        <>
          {isAllZero && (
            <div className="text-xs text-white/30 bg-white/5 rounded-lg px-3 py-2 border border-white/10">
              No performance data yet — KPIs will populate as trading activity accumulates.
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiTile
              label="Earnings"
              value={`$${data.earningsTotal.toLocaleString()}`}
              delta={data.earningsDelta}
              isMock={isAllZero ?? false}
              testId="kpi-earnings"
            />
            <KpiTile
              label="Holders"
              value={data.holdersTotal.toLocaleString()}
              delta={data.holdersDelta}
              isMock={isAllZero ?? false}
              testId="kpi-holders"
            />
            <KpiTile
              label="Conversion"
              value={`${data.conversionRate.toFixed(1)}%`}
              delta={data.conversionDelta}
              isMock={isAllZero ?? false}
              testId="kpi-conversion"
            />
            <KpiTile
              label="Volume (24h)"
              value={`$${data.volumeTotal.toLocaleString()}`}
              delta={data.volumeDelta}
              isMock={false}
              testId="kpi-volume"
            />
          </div>

          {data.alerts && data.alerts.length > 0 && (
            <div className="space-y-2">
              {data.alerts.map((alert, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 text-sm text-yellow-300 bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-3 py-2"
                  data-testid={`snapshot-alert-${i}`}
                >
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {alert}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

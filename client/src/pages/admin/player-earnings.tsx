import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminLayout } from "./layout";
import {
  Coins, TrendingUp, Users, Hash, ChevronDown, ChevronRight,
  ArrowUpRight, Clock, CheckCircle2, Circle, Activity,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Badge } from "@/components/ui/badge";

// ─── Types ────────────────────────────────────────────────────────────────────

type TopEarner = {
  assetId: number;
  currency: string;
  accruedBalance: string;
  updatedAt: string;
  displayName: string | null;
  assetUid: string | null;
  periodEarnings: string;
  periodEntryCount: number;
  payoutReady: boolean;
};

type PeriodSummary = {
  totalEarned: string;
  assetCount: number;
  entryCount: number;
};

type ActivityRow = {
  id: number;
  assetId: number;
  currency: string;
  direction: "credit" | "debit";
  amount: string;
  balanceAfter: string;
  referenceType: string;
  referenceId: string;
  createdAt: string;
  displayName: string | null;
};

type DashboardData = {
  period: string;
  currency: string;
  payoutThresholds: Record<string, number>;
  topEarners: TopEarner[];
  periodSummary: PeriodSummary;
  recentActivity: ActivityRow[];
};

type LedgerRow = {
  id: number;
  assetId: number;
  currency: string;
  direction: "credit" | "debit";
  amount: string;
  balanceAfter: string;
  referenceType: string;
  referenceId: string;
  createdAt: string;
};

type AssetDetail = {
  balance: TopEarner | null;
  ledger: LedgerRow[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PERIODS = [
  { key: "today", label: "Today" },
  { key: "7d",    label: "7 Days" },
  { key: "30d",   label: "30 Days" },
  { key: "all",   label: "All Time" },
] as const;

function fmt(v: string | number, dp = 4): string {
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (isNaN(n)) return "0." + "0".repeat(dp);
  return n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function fmtAmount(amount: string, currency: string): string {
  return `${fmt(amount)} ${currency}`;
}

function relativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60)    return `${Math.floor(diff)}s ago`;
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function shortName(displayName: string | null): string {
  if (!displayName) return "Unknown";
  const parts = displayName.split("#");
  return parts[0].trim();
}

// ─── Summary Stat Card ────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color,
  delay,
}: {
  icon: typeof Coins;
  label: string;
  value: string;
  sub?: string;
  color: string;
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="bg-card border border-white/10 rounded-2xl p-5 flex flex-col gap-3"
    >
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${color}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div>
        <div className="text-2xl font-display font-bold text-white tracking-tight">{value}</div>
        <div className="text-sm text-muted-foreground mt-0.5">{label}</div>
        {sub && <div className="text-xs text-muted-foreground/60 mt-0.5">{sub}</div>}
      </div>
    </motion.div>
  );
}

// ─── Inline Ledger Expand ─────────────────────────────────────────────────────

function AssetLedgerExpand({ assetId, currency }: { assetId: number; currency: string }) {
  const { data, isLoading } = useQuery<AssetDetail>({
    queryKey: ["/api/admin/accounting/player-earnings", assetId, currency],
    queryFn: async () => {
      const r = await fetch(`/api/admin/accounting/player-earnings/${assetId}?currency=${currency}`);
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
  });

  if (isLoading) {
    return (
      <div className="px-4 py-3 text-xs text-muted-foreground/60 flex items-center gap-2">
        <Clock className="w-3.5 h-3.5 animate-spin" />
        Loading ledger…
      </div>
    );
  }

  const rows = data?.ledger ?? [];

  return (
    <div className="bg-background/50 border-t border-white/5 overflow-x-auto">
      {rows.length === 0 ? (
        <div className="px-4 py-3 text-xs text-muted-foreground/50">No ledger entries.</div>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground/60 border-b border-white/5">
              <th className="text-left px-4 py-2 font-medium">ID</th>
              <th className="text-left px-4 py-2 font-medium">Dir</th>
              <th className="text-right px-4 py-2 font-medium">Amount</th>
              <th className="text-right px-4 py-2 font-medium">Balance After</th>
              <th className="text-left px-4 py-2 font-medium">Reference</th>
              <th className="text-right px-4 py-2 font-medium">Time</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className="border-b border-white/5 last:border-0 hover:bg-white/5 transition-colors"
                data-testid={`ledger-row-${row.id}`}
              >
                <td className="px-4 py-2 font-mono text-muted-foreground/60">{row.id}</td>
                <td className="px-4 py-2">
                  <span className={`font-medium ${row.direction === "credit" ? "text-emerald-400" : "text-rose-400"}`}>
                    {row.direction}
                  </span>
                </td>
                <td className="px-4 py-2 font-mono text-right text-white">
                  {fmtAmount(row.amount, row.currency)}
                </td>
                <td className="px-4 py-2 font-mono text-right text-muted-foreground/80">
                  {fmt(row.balanceAfter, 6)}
                </td>
                <td className="px-4 py-2 font-mono text-muted-foreground/60">
                  {row.referenceType}:{row.referenceId}
                </td>
                <td className="px-4 py-2 text-right text-muted-foreground/60">
                  {relativeTime(row.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─── Top Earners Table Row ────────────────────────────────────────────────────

function EarnerRow({
  earner,
  rank,
  currency,
  payoutThreshold,
  delay,
}: {
  earner: TopEarner;
  rank: number;
  currency: string;
  payoutThreshold: number;
  delay: number;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <motion.tr
        initial={{ opacity: 0, x: -8 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay }}
        className="border-b border-white/5 hover:bg-white/[0.03] transition-colors cursor-pointer"
        onClick={() => setExpanded((p) => !p)}
        data-testid={`earner-row-${earner.assetId}`}
      >
        <td className="px-4 py-3 w-10 text-center">
          {expanded
            ? <ChevronDown className="w-4 h-4 text-muted-foreground/60 mx-auto" />
            : <ChevronRight className="w-4 h-4 text-muted-foreground/60 mx-auto" />
          }
        </td>
        <td className="px-4 py-3 text-center text-sm font-mono text-muted-foreground/60 w-10">
          {rank}
        </td>
        <td className="px-4 py-3">
          <div className="text-sm font-medium text-white">{shortName(earner.displayName)}</div>
          <div className="text-xs text-muted-foreground/50 font-mono mt-0.5">{earner.assetId}</div>
        </td>
        <td className="px-4 py-3 text-right font-mono text-white">
          {fmt(earner.accruedBalance, 4)}
          <span className="ml-1.5 text-xs text-muted-foreground/50">{currency}</span>
        </td>
        <td className="px-4 py-3 text-right font-mono">
          {parseFloat(earner.periodEarnings) > 0 ? (
            <span className="text-emerald-400">
              +{fmt(earner.periodEarnings, 4)}
              <span className="ml-1 text-xs text-emerald-400/60">{currency}</span>
            </span>
          ) : (
            <span className="text-muted-foreground/40">—</span>
          )}
        </td>
        <td className="px-4 py-3 text-right">
          <span className="font-mono text-sm text-muted-foreground/70" data-testid={`period-entries-${earner.assetId}`}>
            {earner.periodEntryCount}
          </span>
        </td>
        <td className="px-4 py-3 text-center">
          {earner.payoutReady ? (
            <span
              className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400"
              title={`Accrued ≥ ${payoutThreshold} ${currency} payout threshold`}
              data-testid={`payout-ready-${earner.assetId}`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              Ready
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/40">
              <Circle className="w-3 h-3" />
              Pending
            </span>
          )}
        </td>
        <td className="px-4 py-3 text-center">
          <button
            className="text-xs px-2.5 py-1 rounded-lg border border-white/10 text-muted-foreground/50 cursor-not-allowed"
            title="Payout not yet implemented"
            disabled
            onClick={(e) => e.stopPropagation()}
            data-testid={`queue-payout-${earner.assetId}`}
          >
            Queue Payout
          </button>
        </td>
      </motion.tr>

      <AnimatePresence>
        {expanded && (
          <tr>
            <td colSpan={8} className="p-0">
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.18 }}
                style={{ overflow: "hidden" }}
              >
                <AssetLedgerExpand assetId={earner.assetId} currency={currency} />
              </motion.div>
            </td>
          </tr>
        )}
      </AnimatePresence>
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminPlayerEarningsPage() {
  const [period, setPeriod]     = useState<string>("7d");
  const [currency, setCurrency] = useState<"GS" | "USDC">("GS");

  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ["/api/admin/accounting/player-earnings-dashboard", period, currency],
    queryFn: async () => {
      const r = await fetch(
        `/api/admin/accounting/player-earnings-dashboard?period=${period}&currency=${currency}`,
      );
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    refetchInterval: 30_000,
  });

  const summary         = data?.periodSummary;
  const topEarners      = data?.topEarners ?? [];
  const recentActivity  = data?.recentActivity ?? [];
  const payoutThreshold = data?.payoutThresholds?.[currency] ?? (currency === "GS" ? 10 : 1);
  const readyCount      = topEarners.filter((e) => e.payoutReady).length;

  const periodLabel = PERIODS.find((p) => p.key === period)?.label ?? period;

  return (
    <AdminLayout>
      <div className="flex flex-col gap-6">

        {/* ── Header + controls ─────────────────────────────────────────────── */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-display font-bold text-white tracking-tight">
              Player Earnings
            </h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Accrued player pool distributions — payout threshold: {payoutThreshold} {currency}
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* Period selector */}
            <div
              className="flex items-center gap-0.5 bg-card border border-white/10 rounded-xl p-1"
              data-testid="period-selector"
            >
              {PERIODS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => setPeriod(p.key)}
                  data-testid={`period-btn-${p.key}`}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-200 ${
                    period === p.key
                      ? "bg-violet-600 text-white shadow-sm"
                      : "text-muted-foreground hover:text-white"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Currency tabs */}
            <div
              className="flex items-center gap-0.5 bg-card border border-white/10 rounded-xl p-1"
              data-testid="currency-selector"
            >
              {(["GS", "USDC"] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => setCurrency(c)}
                  data-testid={`currency-btn-${c}`}
                  className={`px-3 py-1.5 text-xs font-semibold font-mono rounded-lg transition-all duration-200 ${
                    currency === c
                      ? "bg-emerald-600 text-white shadow-sm"
                      : "text-muted-foreground hover:text-white"
                  }`}
                >
                  {c === "GS" ? "GS$" : "USDC"}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Summary stats ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            icon={Coins}
            label={`Total earned (${periodLabel})`}
            value={`${fmt(summary?.totalEarned ?? "0")} ${currency}`}
            color="bg-emerald-500/15 text-emerald-400"
            delay={0}
          />
          <StatCard
            icon={Users}
            label="Players earning"
            value={String(summary?.assetCount ?? 0)}
            sub={`${periodLabel} window`}
            color="bg-violet-500/15 text-violet-400"
            delay={0.04}
          />
          <StatCard
            icon={CheckCircle2}
            label="Payout ready"
            value={String(readyCount)}
            sub={`≥ ${payoutThreshold} ${currency} accrued`}
            color={readyCount > 0 ? "bg-emerald-500/15 text-emerald-400" : "bg-white/5 text-muted-foreground/60"}
            delay={0.08}
          />
        </div>

        {/* ── Top earners table ─────────────────────────────────────────────── */}
        <div className="bg-card border border-white/10 rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/8">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-400" />
              <span className="text-sm font-semibold text-white">Top Earners</span>
              <span className="text-xs text-muted-foreground/60">by accrued balance</span>
            </div>
            <Badge variant="outline" className="text-xs font-mono border-white/15 text-muted-foreground/60">
              {topEarners.length} players
            </Badge>
          </div>

          {isLoading ? (
            <div className="p-8 text-center text-sm text-muted-foreground/60">
              <Clock className="w-5 h-5 mx-auto mb-2 animate-spin" />
              Loading earnings data…
            </div>
          ) : topEarners.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground/50">
              No earnings yet in {currency}.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="top-earners-table">
                <thead>
                  <tr className="text-xs text-muted-foreground/60 border-b border-white/5">
                    <th className="px-4 py-3 w-10" />
                    <th className="px-4 py-3 w-10 text-center font-medium">#</th>
                    <th className="px-4 py-3 text-left font-medium">Player</th>
                    <th className="px-4 py-3 text-right font-medium">All-Time Balance</th>
                    <th className="px-4 py-3 text-right font-medium">Period Earnings</th>
                    <th className="px-4 py-3 text-right font-medium">Period Entries</th>
                    <th className="px-4 py-3 text-center font-medium">Status</th>
                    <th className="px-4 py-3 text-center font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {topEarners.map((earner, i) => (
                    <EarnerRow
                      key={earner.assetId}
                      earner={earner}
                      rank={i + 1}
                      currency={currency}
                      payoutThreshold={payoutThreshold}
                      delay={i * 0.025}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Recent earnings activity ───────────────────────────────────────── */}
        <div className="bg-card border border-white/10 rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/8">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-violet-400" />
              <span className="text-sm font-semibold text-white">Recent Earnings Activity</span>
            </div>
            <Badge variant="outline" className="text-xs font-mono border-white/15 text-muted-foreground/60">
              Latest {recentActivity.length}
            </Badge>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground/60 border-b border-white/5">
                  <th className="px-4 py-3 text-left font-medium">Player</th>
                  <th className="px-4 py-3 text-center font-medium">Currency</th>
                  <th className="px-4 py-3 text-center font-medium">Dir</th>
                  <th className="px-4 py-3 text-right font-medium">Amount</th>
                  <th className="px-4 py-3 text-right font-medium">Balance After</th>
                  <th className="px-4 py-3 text-left font-medium">Reference</th>
                  <th className="px-4 py-3 text-right font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {recentActivity.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground/50">
                      No activity yet.
                    </td>
                  </tr>
                ) : (
                  recentActivity.map((row, i) => (
                    <motion.tr
                      key={row.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: i * 0.015 }}
                      className="border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors"
                      data-testid={`activity-row-${row.id}`}
                    >
                      <td className="px-4 py-2.5">
                        <span className="text-sm text-white">{shortName(row.displayName)}</span>
                        <span className="ml-1.5 text-xs text-muted-foreground/40 font-mono">{row.assetId}</span>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span
                          className={`text-xs font-mono font-semibold px-1.5 py-0.5 rounded border ${
                            row.currency === "GS"
                              ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/10"
                              : "border-cyan-500/30 text-cyan-400 bg-cyan-500/10"
                          }`}
                          data-testid={`activity-currency-${row.id}`}
                        >
                          {row.currency === "GS" ? "GS$" : "USDC"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {row.direction === "credit" ? (
                          <ArrowUpRight className="w-4 h-4 text-emerald-400 mx-auto" />
                        ) : (
                          <ArrowUpRight className="w-4 h-4 text-rose-400 mx-auto rotate-180" />
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-white">
                        {fmt(row.amount, 6)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-muted-foreground/70">
                        {fmt(row.balanceAfter, 6)}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground/50">
                        {row.referenceType}:{row.referenceId}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs text-muted-foreground/60">
                        {relativeTime(row.createdAt)}
                      </td>
                    </motion.tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </AdminLayout>
  );
}

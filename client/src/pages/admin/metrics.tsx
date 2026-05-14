import { useQuery } from "@tanstack/react-query";
import { AdminLayout } from "./layout";
import { formatCurrency, formatNumber } from "@/lib/format";
import { Users, Activity, DollarSign, Zap, TrendingUp, BarChart3 } from "lucide-react";
import { motion } from "framer-motion";

type Metrics = {
  totalUsers: number;
  totalTrades: number;
  totalVolume: string;
  activeUsers24h: number;
};

function MetricCard({ label, value, subLabel, icon: Icon, color, delay = 0 }: {
  label: string;
  value: string;
  subLabel?: string;
  icon: any;
  color: string;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="bg-card border border-white/10 rounded-2xl p-6 flex flex-col gap-4"
    >
      <div className="flex items-start justify-between">
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${color}`}>
          <Icon className="w-5 h-5" />
        </div>
        <TrendingUp className="w-4 h-4 text-muted-foreground/40" />
      </div>
      <div>
        <div className="text-3xl font-display font-bold text-white tracking-tight" data-testid={`metric-${label.toLowerCase().replace(/\s+/g, "-")}`}>
          {value}
        </div>
        <div className="text-sm text-muted-foreground mt-1">{label}</div>
        {subLabel && <div className="text-xs text-muted-foreground/60 mt-0.5">{subLabel}</div>}
      </div>
    </motion.div>
  );
}

export default function AdminMetricsPage() {
  const { data, isLoading } = useQuery<Metrics>({
    queryKey: ["/api/admin/metrics"],
    refetchInterval: 30000,
  });

  const cards = [
    {
      label: "Total Users",
      value: isLoading ? "—" : formatNumber(data?.totalUsers ?? 0),
      subLabel: "Registered accounts",
      icon: Users,
      color: "bg-violet-500/15 text-violet-400",
    },
    {
      label: "Total Trades",
      value: isLoading ? "—" : formatNumber(data?.totalTrades ?? 0),
      subLabel: "All-time executions",
      icon: Activity,
      color: "bg-primary/15 text-primary",
    },
    {
      label: "Total Market Volume",
      value: isLoading ? "—" : formatCurrency(data?.totalVolume ?? "0"),
      subLabel: "All-time trade value",
      icon: DollarSign,
      color: "bg-emerald-500/15 text-emerald-400",
    },
    {
      label: "Active Users (24h)",
      value: isLoading ? "—" : formatNumber(data?.activeUsers24h ?? 0),
      subLabel: "Users who traded recently",
      icon: Zap,
      color: "bg-yellow-500/15 text-yellow-400",
    },
  ];

  return (
    <AdminLayout>
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <BarChart3 className="w-4 h-4" />
          <span>Platform-wide metrics — refreshes every 30 seconds</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {cards.map((card, i) => (
            <MetricCard key={card.label} {...card} delay={i * 0.08} />
          ))}
        </div>

        {!isLoading && data && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.35 }}
            className="grid md:grid-cols-3 gap-4"
          >
            <div className="bg-card border border-white/10 rounded-xl p-5 md:col-span-2">
              <h3 className="font-semibold text-white mb-4 text-sm">Platform Overview</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between py-2 border-b border-white/5">
                  <span className="text-muted-foreground text-sm">Average trades per user</span>
                  <span className="text-white font-mono text-sm">
                    {data.totalUsers > 0 ? (data.totalTrades / data.totalUsers).toFixed(1) : "0"}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-white/5">
                  <span className="text-muted-foreground text-sm">Average volume per trade</span>
                  <span className="text-white font-mono text-sm">
                    {data.totalTrades > 0 ? formatCurrency((parseFloat(data.totalVolume) / data.totalTrades).toFixed(2)) : "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-white/5">
                  <span className="text-muted-foreground text-sm">24h activity rate</span>
                  <span className="text-white font-mono text-sm">
                    {data.totalUsers > 0 ? `${((data.activeUsers24h / data.totalUsers) * 100).toFixed(1)}%` : "0%"}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-muted-foreground text-sm">Average balance per user</span>
                  <span className="text-white font-mono text-sm">
                    {data.totalUsers > 0 ? formatCurrency((parseFloat(data.totalVolume) / data.totalUsers).toFixed(2)) : "—"}
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-card border border-white/10 rounded-xl p-5">
              <h3 className="font-semibold text-white mb-4 text-sm">Quick Stats</h3>
              <div className="flex flex-col gap-3">
                <div className="text-center py-3 bg-white/3 rounded-lg border border-white/5">
                  <div className="text-2xl font-bold font-display text-violet-400">{data.totalUsers}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Total Users</div>
                </div>
                <div className="text-center py-3 bg-white/3 rounded-lg border border-white/5">
                  <div className="text-2xl font-bold font-display text-primary">{data.activeUsers24h}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Active Today</div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </div>
    </AdminLayout>
  );
}

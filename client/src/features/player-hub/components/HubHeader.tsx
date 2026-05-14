import { User, Star, Clock, AlertCircle, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import type { HubOverview } from "../hooks/use-player-hub";

interface Props {
  overview: HubOverview;
}

function StatCard({
  label, value, icon: Icon, accent,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  accent?: string;
}) {
  return (
    <div
      data-testid={`hub-stat-${label.toLowerCase().replace(/\s/g, "-")}`}
      className="flex flex-col gap-1 bg-white/5 rounded-xl p-4 border border-white/10"
    >
      <div className={cn("flex items-center gap-2 text-xs font-medium uppercase tracking-wider", accent ?? "text-white/50")}>
        <Icon className="w-3.5 h-3.5" />
        {label}
      </div>
      <div className="text-2xl font-bold text-white">{value}</div>
    </div>
  );
}

export function HubHeader({ overview }: Props) {
  const { player, summary } = overview;

  return (
    <div className="space-y-4">
      {/* Player identity */}
      <div className="flex items-center gap-4">
        <div
          className="w-14 h-14 rounded-full bg-white/10 border border-white/20 flex items-center justify-center flex-shrink-0 overflow-hidden"
          data-testid="hub-avatar"
        >
          {player.avatarUrl ? (
            <img src={player.avatarUrl} alt={player.displayName} className="w-full h-full object-cover" />
          ) : (
            <User className="w-6 h-6 text-white/40" />
          )}
        </div>
        <div>
          <h1 className="text-xl font-bold text-white" data-testid="hub-display-name">
            {player.displayName}
          </h1>
          <p className="text-sm text-white/50">Player Hub · Creator Mode</p>
        </div>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total Assets" value={summary.totalAssets} icon={Layers} />
        <StatCard
          label="Operator Ready"
          value={summary.operatorReadyAssets}
          icon={Star}
          accent="text-emerald-400"
        />
        <StatCard
          label="Pending Claims"
          value={summary.pendingClaims}
          icon={Clock}
          accent={summary.pendingClaims > 0 ? "text-yellow-400" : undefined}
        />
        <StatCard
          label="Pending Requests"
          value={summary.pendingRequests}
          icon={AlertCircle}
          accent={summary.pendingRequests > 0 ? "text-blue-400" : undefined}
        />
      </div>
    </div>
  );
}

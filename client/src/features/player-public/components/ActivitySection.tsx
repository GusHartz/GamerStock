// ─── ActivitySection ──────────────────────────────────────────────────────────
// Renders recent public activity for a player asset.
// Readable, social proof feel — not a log or a chat.
// ─────────────────────────────────────────────────────────────────────────────
import { TrendingUp, Users, Gem, Activity } from "lucide-react";
import { cn } from "@/lib/utils";

interface PublicActivityEvent {
  id:          string;
  type:        "buy" | "support" | "moment_purchase" | "holder_joined";
  label:       string;
  maskedUser:  string;
  createdAt:   string;
  valueLabel:  string | null;
}

// ── Type config ───────────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<
  PublicActivityEvent["type"],
  { Icon: React.ComponentType<{ className?: string }>; iconCls: string; bgCls: string }
> = {
  buy:              { Icon: TrendingUp, iconCls: "text-blue-400",    bgCls: "bg-blue-500/10 border-blue-500/20"    },
  support:          { Icon: Users,      iconCls: "text-emerald-400", bgCls: "bg-emerald-500/10 border-emerald-500/20" },
  holder_joined:    { Icon: Users,      iconCls: "text-emerald-400", bgCls: "bg-emerald-500/10 border-emerald-500/20" },
  moment_purchase:  { Icon: Gem,        iconCls: "text-amber-400",   bgCls: "bg-amber-500/10 border-amber-500/20"  },
};

// ── Relative time ─────────────────────────────────────────────────────────────

function relativeTime(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60)  return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60)  return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24)    return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7)      return `${days}d ago`;
  return new Date(isoDate).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── ActivityRow ───────────────────────────────────────────────────────────────

function ActivityRow({ event }: { event: PublicActivityEvent }) {
  const cfg = TYPE_CONFIG[event.type] ?? TYPE_CONFIG.buy;
  const EventIcon = cfg.Icon;

  return (
    <li
      className="flex items-center gap-3 py-2.5"
      data-testid={`activity-row-${event.id}`}
    >
      <div className={cn("p-1.5 rounded-lg border flex-shrink-0", cfg.bgCls)}>
        <EventIcon className={cn("w-3.5 h-3.5", cfg.iconCls)} />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm text-white/80 leading-tight">
          <span className="font-medium text-white/90" data-testid={`activity-user-${event.id}`}>
            {event.maskedUser}
          </span>{" "}
          <span className="text-white/50">{event.label}</span>
          {event.valueLabel && (
            <span className="ml-1 text-white/40 text-xs">({event.valueLabel})</span>
          )}
        </p>
      </div>

      <time
        dateTime={event.createdAt}
        className="text-xs text-white/25 flex-shrink-0 tabular-nums"
        data-testid={`activity-time-${event.id}`}
      >
        {relativeTime(event.createdAt)}
      </time>
    </li>
  );
}

// ── ActivitySection ───────────────────────────────────────────────────────────

interface ActivitySectionProps {
  activity: PublicActivityEvent[];
}

export function ActivitySection({ activity }: ActivitySectionProps) {
  if (activity.length === 0) {
    return (
      <div
        className="border border-dashed border-white/10 rounded-2xl px-6 py-6 flex items-center gap-3"
        data-testid="public-activity-empty"
      >
        <Activity className="w-5 h-5 text-white/15 flex-shrink-0" />
        <p className="text-sm text-white/20">No recent activity yet.</p>
      </div>
    );
  }

  return (
    <section
      className="bg-white/5 border border-white/10 rounded-2xl px-6 py-4 space-y-1"
      data-testid="public-activity"
    >
      <h2 className="text-xs font-semibold text-white/50 uppercase tracking-wider pb-2">
        Recent Activity
      </h2>
      <ul className="divide-y divide-white/5">
        {activity.map((event) => (
          <ActivityRow key={event.id} event={event} />
        ))}
      </ul>
    </section>
  );
}

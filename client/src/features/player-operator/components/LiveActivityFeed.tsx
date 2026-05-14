import { Clock, AlertCircle, Activity } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useLiveActivity } from "../hooks/use-operator";

// ── Event type badge ──────────────────────────────────────────────────────────

function EventTypeBadge({ type }: { type: string }) {
  const map: Record<string, string> = {
    buy:       "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
    sell:      "bg-red-500/20 text-red-300 border-red-500/30",
    trade:     "bg-blue-500/20 text-blue-300 border-blue-500/30",
    mission:   "bg-purple-500/20 text-purple-300 border-purple-500/30",
    hold:      "bg-white/10 text-white/50 border-white/20",
    view:      "bg-white/5 text-white/30 border-white/10",
  };
  return (
    <Badge className={cn("border text-xs font-mono capitalize flex-shrink-0", map[type] ?? map.hold)}>
      {type}
    </Badge>
  );
}

// ── Format relative time ──────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString();
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  assetId: number;
}

export function LiveActivityFeed({ assetId }: Props) {
  const { data: events, isLoading, isError } = useLiveActivity(assetId);

  return (
    <section id="live-activity" className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white/70 uppercase tracking-wider">Live Activity</h2>
        {events && events.length > 0 && (
          <span className="text-xs text-white/30 flex items-center gap-1">
            <Activity className="w-3 h-3" />
            Live · 10s
          </span>
        )}
      </div>

      {isLoading && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-10 bg-white/5 rounded-lg animate-pulse" />
          ))}
        </div>
      )}

      {isError && (
        <div className="flex items-center gap-2 text-sm text-red-400 p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
          <AlertCircle className="w-4 h-4" />
          Failed to load activity.
        </div>
      )}

      {events && events.length === 0 && (
        <div className="flex flex-col items-center justify-center py-8 gap-2 bg-white/3 border border-white/10 rounded-xl">
          <Clock className="w-8 h-8 text-white/20" />
          <p className="text-sm text-white/40">No activity yet</p>
        </div>
      )}

      {events && events.length > 0 && (
        <div className="bg-white/3 border border-white/10 rounded-xl divide-y divide-white/5" data-testid="activity-feed">
          {events.map((ev) => (
            <div
              key={ev.id}
              className="flex items-center gap-3 px-4 py-3"
              data-testid={`activity-event-${ev.id}`}
            >
              <EventTypeBadge type={ev.type} />
              <span className="text-sm text-white/70 flex-1 min-w-0 truncate">
                {ev.actorDisplayMasked ?? "Anonymous"}
              </span>
              {ev.valueNumeric !== null && (
                <span className="text-sm font-medium text-emerald-400 flex-shrink-0">
                  {ev.valueNumeric.toLocaleString()} GS
                </span>
              )}
              <span className="text-xs text-white/25 flex-shrink-0 ml-2">
                {relativeTime(ev.createdAt)}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

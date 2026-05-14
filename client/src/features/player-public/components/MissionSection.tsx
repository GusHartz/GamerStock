// ─── MissionSection ───────────────────────────────────────────────────────────
// Renders the active mission for a player asset on the public page.
// Hidden when mission is null.
// ─────────────────────────────────────────────────────────────────────────────
import { Target, Clock, CheckCircle2, Hourglass } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface PublicMission {
  id:          string;
  title:       string;
  description: string | null;
  progress:    number | null;
  target:      number | null;
  rewardLabel: string | null;
  endsAt:      string | null;
  status:      "active" | "completed" | "upcoming";
}

const STATUS_CONFIG = {
  active:    { label: "Live",      Icon: Target,       cls: "bg-blue-500/20 text-blue-300 border-blue-500/30" },
  completed: { label: "Completed", Icon: CheckCircle2, cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" },
  upcoming:  { label: "Coming Soon", Icon: Hourglass,  cls: "bg-amber-500/20 text-amber-300 border-amber-500/30" },
} as const;

function formatEndsAt(isoDate: string): string {
  const d = new Date(isoDate);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 0)   return "Ended";
  if (diffDays === 0) return "Ends today";
  if (diffDays === 1) return "Ends tomorrow";
  return `${diffDays} days left`;
}

interface MissionSectionProps {
  mission: PublicMission;
}

export function MissionSection({ mission }: MissionSectionProps) {
  const cfg = STATUS_CONFIG[mission.status];
  const StatusIcon = cfg.Icon;
  const progress = Math.min(100, Math.max(0, mission.progress ?? 0));
  const isCompleted = mission.status === "completed";

  return (
    <section
      className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4"
      data-testid="public-mission"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className={cn(
            "p-2 rounded-xl border",
            isCompleted
              ? "bg-emerald-500/10 border-emerald-500/20"
              : "bg-blue-500/10 border-blue-500/20",
          )}>
            <StatusIcon className={cn("w-4 h-4", isCompleted ? "text-emerald-400" : "text-blue-400")} />
          </div>
          <div>
            <p className="text-xs text-white/40 uppercase tracking-wider font-medium">Mission</p>
            <h3
              className="text-base font-semibold text-white leading-tight mt-0.5"
              data-testid="mission-title"
            >
              {mission.title}
            </h3>
          </div>
        </div>
        <Badge className={cn("border text-xs flex-shrink-0", cfg.cls)}>
          {cfg.label}
        </Badge>
      </div>

      {/* Description */}
      {mission.description && (
        <p className="text-sm text-white/50 leading-relaxed" data-testid="mission-description">
          {mission.description}
        </p>
      )}

      {/* Progress bar */}
      {mission.progress !== null && (
        <div className="space-y-2" data-testid="mission-progress">
          <div className="flex items-center justify-between text-xs text-white/40">
            <span>Progress</span>
            <span className={cn("font-semibold", isCompleted ? "text-emerald-400" : "text-white/70")}>
              {progress.toFixed(0)}%
            </span>
          </div>
          <div className="h-2 bg-white/10 rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500",
                isCompleted
                  ? "bg-emerald-500"
                  : progress >= 75
                  ? "bg-blue-400"
                  : "bg-blue-600",
              )}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Footer meta */}
      <div className="flex flex-wrap items-center gap-4 pt-1">
        {mission.target !== null && mission.target > 0 && (
          <div className="text-xs text-white/40">
            Goal:{" "}
            <span className="text-white/60 font-medium">{mission.target.toLocaleString()}</span>
          </div>
        )}
        {mission.rewardLabel && (
          <div className="text-xs text-amber-400/80">
            🎁 {mission.rewardLabel}
          </div>
        )}
        {mission.endsAt && (
          <div className="flex items-center gap-1 text-xs text-white/35">
            <Clock className="w-3 h-3" />
            {formatEndsAt(mission.endsAt)}
          </div>
        )}
      </div>
    </section>
  );
}

/** Shown when mission is null — lightweight, non-distracting placeholder */
export function MissionEmptyState() {
  return (
    <div
      className="border border-dashed border-white/10 rounded-2xl px-6 py-6 flex items-center gap-3"
      data-testid="public-mission-empty"
    >
      <Target className="w-5 h-5 text-white/15 flex-shrink-0" />
      <p className="text-sm text-white/20">No active mission right now. Check back soon.</p>
    </div>
  );
}

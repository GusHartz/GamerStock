import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status:     string;
  className?: string;
  compact?:   boolean;
}

const STATUS_MAP: Record<string, { label: string; classes: string; pulse?: boolean }> = {
  open:      { label: "LIVE",      classes: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",   pulse: true  },
  locked:    { label: "LOCKED",    classes: "bg-amber-500/15   text-amber-400   border-amber-500/25"                   },
  settling:  { label: "SETTLING",  classes: "bg-violet-500/15  text-violet-400  border-violet-500/25"                  },
  settled:   { label: "SETTLED",   classes: "bg-zinc-800/60    text-zinc-500    border-zinc-700/40"                    },
  cancelled: { label: "CANCELLED", classes: "bg-rose-950/50    text-rose-500    border-rose-800/30"                    },
};

export function StatusBadge({ status, className, compact }: StatusBadgeProps) {
  const cfg = STATUS_MAP[status] ?? { label: status.toUpperCase(), classes: "bg-zinc-800/60 text-zinc-500 border-zinc-700/40" };

  return (
    <span
      data-testid={`status-badge-${status}`}
      className={cn(
        "inline-flex items-center gap-1 border font-mono font-bold tracking-widest uppercase",
        compact ? "px-1.5 py-[2px] text-[9px] rounded" : "px-2 py-[3px] text-[10px] rounded-md",
        cfg.classes,
        className
      )}
    >
      {cfg.pulse && (
        <span className="relative flex h-1.5 w-1.5 flex-none">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
        </span>
      )}
      {cfg.label}
    </span>
  );
}

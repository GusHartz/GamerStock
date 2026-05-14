import { cn } from "@/lib/utils";

interface ProbabilityBarProps {
  yesPct:     number;
  height?:    "sm" | "md" | "lg";
  className?: string;
  showLabels?: boolean;
}

const HEIGHT_MAP = { sm: "h-[3px]", md: "h-1", lg: "h-[5px]" };

export function ProbabilityBar({ yesPct, height = "md", className, showLabels = false }: ProbabilityBarProps) {
  const clamped = Math.max(1, Math.min(99, yesPct));
  const noPct   = 100 - clamped;

  return (
    <div className={cn("w-full", className)} data-testid="probability-bar">
      {showLabels && (
        <div className="flex justify-between items-center mb-1.5">
          <span className="text-[10px] font-mono font-semibold tracking-wider text-cyan-400">
            YES {clamped}%
          </span>
          <span className="text-[10px] font-mono font-semibold tracking-wider text-rose-400">
            {noPct}% NO
          </span>
        </div>
      )}

      <div className={cn(
        "w-full rounded-full bg-white/[0.06] overflow-hidden flex gap-[1px]",
        HEIGHT_MAP[height]
      )}>
        <div
          className={cn(
            "rounded-l-full transition-all duration-500",
            "bg-cyan-500",
            height === "lg" && "shadow-[0_0_8px_rgba(6,182,212,0.5)]",
            height === "md" && "shadow-[0_0_4px_rgba(6,182,212,0.35)]",
          )}
          style={{ width: `${clamped}%` }}
        />
        <div
          className={cn(
            "rounded-r-full flex-1 transition-all duration-500 bg-rose-600/70",
          )}
          style={{ width: `${noPct}%` }}
        />
      </div>
    </div>
  );
}

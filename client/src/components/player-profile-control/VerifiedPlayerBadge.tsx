import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  playerName?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function VerifiedPlayerBadge({ playerName, size = "md", className }: Props) {
  const sizes = {
    sm: { wrap: "gap-1 px-2 py-0.5 text-xs", icon: "w-3 h-3" },
    md: { wrap: "gap-1.5 px-3 py-1 text-sm", icon: "w-3.5 h-3.5" },
    lg: { wrap: "gap-2 px-4 py-1.5 text-base", icon: "w-4 h-4" },
  };
  const s = sizes[size];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-semibold",
        "bg-emerald-500/10 border border-emerald-500/30 text-emerald-300",
        "shadow-[0_0_12px_rgba(16,185,129,0.15)]",
        s.wrap,
        className,
      )}
    >
      <ShieldCheck className={cn(s.icon, "text-emerald-400")} />
      Verified Player
      {playerName && <span className="text-white/60 font-normal ml-1">· {playerName}</span>}
    </span>
  );
}

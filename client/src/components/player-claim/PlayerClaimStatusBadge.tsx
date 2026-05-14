import { cn } from "@/lib/utils";
import type { ClaimStatus } from "@/hooks/use-player-claim";
import { Clock, CheckCircle2, XCircle, ShieldOff } from "lucide-react";

interface Props {
  status: ClaimStatus;
  size?: "sm" | "md";
}

const CONFIG: Record<ClaimStatus, {
  label: string;
  icon: React.ElementType;
  className: string;
}> = {
  pending: {
    label: "Under Review",
    icon: Clock,
    className: "bg-amber-500/15 border-amber-500/30 text-amber-300",
  },
  approved: {
    label: "Verified",
    icon: CheckCircle2,
    className: "bg-emerald-500/15 border-emerald-500/30 text-emerald-300",
  },
  rejected: {
    label: "Rejected",
    icon: XCircle,
    className: "bg-rose-500/15 border-rose-500/30 text-rose-300",
  },
  revoked: {
    label: "Revoked",
    icon: ShieldOff,
    className: "bg-zinc-500/15 border-zinc-500/30 text-zinc-400",
  },
};

export function PlayerClaimStatusBadge({ status, size = "md" }: Props) {
  const cfg = CONFIG[status];
  const Icon = cfg.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-medium",
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm",
        cfg.className,
      )}
    >
      <Icon className={size === "sm" ? "w-3 h-3" : "w-3.5 h-3.5"} />
      {cfg.label}
    </span>
  );
}

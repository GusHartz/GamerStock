import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";

interface MarketTimerProps {
  closeAt:  string | null;
  status:   string;
  className?: string;
}

function formatRemaining(closeAt: string): string {
  const diff = new Date(closeAt).getTime() - Date.now();
  if (diff <= 0) return "Closing";

  const totalMins = Math.floor(diff / 60_000);
  if (totalMins < 60) return `${totalMins}m`;

  const hrs  = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hrs < 24) return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;

  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h`;
}

export function MarketTimer({ closeAt, status, className }: MarketTimerProps) {
  if (status !== "open" || !closeAt) {
    return (
      <span data-testid="market-timer-closed" className={cn("text-[11px] font-mono text-muted-foreground", className)}>
        {status === "locked" ? "Market locked" : status === "settled" ? "Settled" : status === "cancelled" ? "Cancelled" : "Closed"}
      </span>
    );
  }

  return (
    <span data-testid="market-timer-live" className={cn("inline-flex items-center gap-1 text-[11px] font-mono text-muted-foreground", className)}>
      <Clock className="w-3 h-3" />
      Closes in {formatRemaining(closeAt)}
    </span>
  );
}

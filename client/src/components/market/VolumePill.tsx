import { cn } from "@/lib/utils";

interface VolumePillProps {
  currency:   string;
  amount?:    number | null;
  className?: string;
}

function formatAmount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

export function VolumePill({ currency, amount, className }: VolumePillProps) {
  if (amount == null) return null;

  return (
    <span
      data-testid="volume-pill"
      className={cn("inline-flex items-center gap-1 text-[10px] font-mono text-zinc-500 bg-white/[0.04] px-2 py-0.5 rounded border border-white/[0.06]", className)}
    >
      <span className="text-zinc-600">{currency}</span>
      <span>{formatAmount(amount)}</span>
      <span className="text-zinc-600">vol</span>
    </span>
  );
}

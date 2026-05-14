import { cn } from "@/lib/utils";

interface PriceChipProps {
  side:       "yes" | "no";
  price:      number | null;
  className?: string;
  size?:      "sm" | "md";
}

export function PriceChip({ side, price, className, size = "sm" }: PriceChipProps) {
  const isYes = side === "yes";

  const yesClasses = "bg-cyan-950/80 text-cyan-300 border-cyan-500/25 shadow-[0_0_8px_-2px_rgba(6,182,212,0.25)]";
  const noClasses  = "bg-rose-950/80 text-rose-300 border-rose-500/25";

  const sizeClasses = size === "md"
    ? "px-3 py-1 text-[13px]"
    : "px-2 py-[3px] text-[11px]";

  const display = price != null
    ? `${isYes ? "YES" : "NO"} $${price.toFixed(2)}`
    : `${isYes ? "YES" : "NO"} —`;

  return (
    <span
      data-testid={`price-chip-${side}`}
      className={cn(
        "inline-flex items-center rounded border font-mono font-bold tracking-wide",
        isYes ? yesClasses : noClasses,
        sizeClasses,
        className
      )}
    >
      {display}
    </span>
  );
}

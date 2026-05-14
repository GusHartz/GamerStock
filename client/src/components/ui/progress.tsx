import { cn } from "@/lib/utils"

interface ProgressProps {
  value?: number | null
  className?: string
  style?: React.CSSProperties
  "data-testid"?: string
}

function Progress({ value, className, style, ...rest }: ProgressProps) {
  const clamped = Math.min(100, Math.max(0, value ?? 0))
  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn(
        "relative w-full overflow-hidden rounded-full bg-secondary",
        className,
      )}
      style={style}
      {...rest}
    >
      <div
        className="h-full rounded-full transition-all duration-500 ease-out"
        style={{
          width: `${clamped}%`,
          backgroundColor: "var(--progress-color, hsl(var(--primary)))",
        }}
      />
    </div>
  )
}

export { Progress }

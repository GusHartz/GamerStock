type SignalBadgeProps = {
  signal: string;
  size?: "xs" | "sm" | "md" | "lg";
  glow?: boolean;
};

type SignalCfg = { label: string; color: string; bg: string; glow: string };

const SIGNAL_CONFIG: Record<string, SignalCfg> = {
  STRONG_BUY: {
    label: "STRONG BUY",
    color: "text-emerald-300",
    bg: "bg-emerald-500/15 border-emerald-500/40",
    glow: "shadow-[0_0_14px_rgba(52,211,153,0.30)]",
  },
  BUY: {
    label: "BUY",
    color: "text-emerald-400",
    bg: "bg-emerald-500/10 border-emerald-500/30",
    glow: "shadow-[0_0_8px_rgba(52,211,153,0.20)]",
  },
  HOLD: {
    label: "HOLD",
    color: "text-amber-400",
    bg: "bg-amber-500/10 border-amber-500/30",
    glow: "",
  },
  SELL: {
    label: "SELL",
    color: "text-rose-400",
    bg: "bg-rose-500/10 border-rose-500/30",
    glow: "shadow-[0_0_8px_rgba(244,63,94,0.20)]",
  },
  STRONG_SELL: {
    label: "STRONG SELL",
    color: "text-rose-300",
    bg: "bg-rose-500/15 border-rose-500/40",
    glow: "shadow-[0_0_14px_rgba(244,63,94,0.30)]",
  },
  BREAKOUT_CANDIDATE: {
    label: "BREAKOUT",
    color: "text-cyan-300",
    bg: "bg-cyan-500/15 border-cyan-500/40",
    glow: "shadow-[0_0_14px_rgba(6,182,212,0.30)]",
  },
  MOMENTUM_SURGE: {
    label: "SURGE",
    color: "text-orange-300",
    bg: "bg-orange-500/15 border-orange-500/40",
    glow: "shadow-[0_0_14px_rgba(249,115,22,0.30)]",
  },
  UNDERVALUED_GEM: {
    label: "GEM",
    color: "text-violet-300",
    bg: "bg-violet-500/15 border-violet-500/40",
    glow: "shadow-[0_0_14px_rgba(139,92,246,0.30)]",
  },
  HOT_STREAK: {
    label: "HOT STREAK",
    color: "text-amber-300",
    bg: "bg-amber-500/15 border-amber-500/40",
    glow: "shadow-[0_0_10px_rgba(251,191,36,0.25)]",
  },
  MEAN_REVERSION: {
    label: "REVERSION",
    color: "text-sky-300",
    bg: "bg-sky-500/15 border-sky-500/35",
    glow: "",
  },
};

const SIZE_CLASSES: Record<string, string> = {
  xs: "text-[9px] px-1.5 py-0.5 tracking-wide",
  sm: "text-[10px] px-2 py-0.5 tracking-wide",
  md: "text-xs px-2.5 py-1 tracking-wider",
  lg: "text-sm px-3 py-1 tracking-wider",
};

export function SignalBadge({ signal, size = "sm", glow = false }: SignalBadgeProps) {
  const cfg: SignalCfg = SIGNAL_CONFIG[signal] ?? {
    label: signal.replace(/_/g, " "),
    color: "text-zinc-400",
    bg: "bg-zinc-500/10 border-zinc-500/25",
    glow: "",
  };
  return (
    <span
      className={`inline-flex items-center font-bold rounded border ${cfg.color} ${cfg.bg} ${SIZE_CLASSES[size]} ${glow ? cfg.glow : ""}`}
    >
      {cfg.label}
    </span>
  );
}

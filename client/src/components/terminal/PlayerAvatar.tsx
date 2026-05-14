type RoleCfg = { abbr: string; from: string; to: string; border: string; text: string };

const ROLE_CONFIG: Record<string, RoleCfg> = {
  TOP:     { abbr: "T", from: "#92400e", to: "#1c0a00", border: "rgba(245,158,11,0.35)", text: "#fbbf24" },
  JUNGLE:  { abbr: "J", from: "#065f46", to: "#012015", border: "rgba(52,211,153,0.35)", text: "#34d399" },
  MID:     { abbr: "M", from: "#155e75", to: "#042030", border: "rgba(34,211,238,0.35)", text: "#22d3ee" },
  ADC:     { abbr: "A", from: "#9f1239", to: "#200010", border: "rgba(251,113,133,0.35)", text: "#fb7185" },
  SUPPORT: { abbr: "S", from: "#3730a3", to: "#0d0b2a", border: "rgba(129,140,248,0.35)", text: "#818cf8" },
};

export type PlayerAvatarSize = "sm" | "md" | "lg" | "xl";

const SIZE_MAP: Record<PlayerAvatarSize, { px: number; fontSize: number; radius: number }> = {
  sm: { px: 28, fontSize: 10, radius: 6 },
  md: { px: 40, fontSize: 14, radius: 8 },
  lg: { px: 56, fontSize: 20, radius: 10 },
  xl: { px: 72, fontSize: 26, radius: 12 },
};

type PlayerAvatarProps = {
  name: string;
  role: string;
  size?: PlayerAvatarSize;
  className?: string;
};

export function PlayerAvatar({ name, role, size = "md", className = "" }: PlayerAvatarProps) {
  const cfg = ROLE_CONFIG[role] ?? { abbr: "?", from: "#3f3f46", to: "#18181b", border: "rgba(161,161,170,0.3)", text: "#a1a1aa" };
  const s = SIZE_MAP[size];

  return (
    <div
      className={`shrink-0 flex items-center justify-center font-bold select-none ${className}`}
      style={{
        width: s.px,
        height: s.px,
        borderRadius: s.radius,
        background: `linear-gradient(135deg, ${cfg.from}, ${cfg.to})`,
        border: `1px solid ${cfg.border}`,
        color: cfg.text,
        fontSize: s.fontSize,
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 12px rgba(0,0,0,0.4)`,
      }}
    >
      {cfg.abbr}
    </div>
  );
}

export function roleColor(role: string): string {
  return ROLE_CONFIG[role]?.text ?? "#a1a1aa";
}

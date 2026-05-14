import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface GlassPanelProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  hoverable?: boolean;
  glow?: boolean;
  "data-testid"?: string;
}

export function GlassPanel({ children, className, onClick, hoverable, glow, "data-testid": testId }: GlassPanelProps) {
  return (
    <div
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "rounded-xl border border-white/[0.06] bg-[#0B0F1E]/80 backdrop-blur-sm",
        "shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_8px_32px_-8px_rgba(0,0,0,0.9)]",
        hoverable && [
          "transition-all duration-200 cursor-pointer",
          "hover:border-white/[0.12] hover:bg-[#0D1226]/90",
          "hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_12px_40px_-8px_rgba(0,0,0,0.95)]",
          "hover:-translate-y-px",
        ],
        glow && "ring-1 ring-cyan-500/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_0_0_1px_rgba(6,182,212,0.08),0_8px_32px_-8px_rgba(0,0,0,0.9)]",
        className
      )}
    >
      {children}
    </div>
  );
}

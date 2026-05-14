import { ReactNode } from "react";
import { Link } from "wouter";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface SectionHeaderProps {
  title:         string;
  subtitle?:     string;
  icon?:         ReactNode;
  viewAllHref?:  string;
  viewAllLabel?: string;
  className?:    string;
}

export function SectionHeader({ title, subtitle, icon, viewAllHref, viewAllLabel = "View all", className }: SectionHeaderProps) {
  return (
    <div className={cn("flex items-center justify-between mb-4", className)}>
      <div className="flex items-center gap-2.5">
        {icon && (
          <span className="text-cyan-400 w-4 h-4 flex items-center justify-center">{icon}</span>
        )}
        <div>
          <h2 className="text-[13px] font-bold text-white uppercase tracking-wider leading-none">{title}</h2>
          {subtitle && <p className="text-[11px] text-zinc-500 mt-1">{subtitle}</p>}
        </div>
      </div>
      {viewAllHref && (
        <Link
          href={viewAllHref}
          data-testid={`link-view-all-${title.toLowerCase().replace(/\s+/g, "-")}`}
          className="flex items-center gap-0.5 text-[11px] font-medium text-zinc-500 hover:text-cyan-400 transition-colors"
        >
          {viewAllLabel}
          <ChevronRight className="w-3 h-3" />
        </Link>
      )}
    </div>
  );
}

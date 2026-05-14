import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Inbox,
  CalendarCheck,
  Layers,
  ImageIcon,
  ChevronRight,
  ArrowLeft,
  Clock,
} from "lucide-react";

const NAV = [
  { href: "/admin/predict",       label: "Overview",        icon: LayoutDashboard, exact: true },
  { href: "/admin/ingestion",     label: "Ingestion Queue", icon: Inbox },
  { href: "/admin/events",        label: "Events",          icon: CalendarCheck },
  { href: "/admin/display-queue", label: "Display Queue",   icon: Layers },
  { href: "/admin/media",         label: "Media Library",   icon: ImageIcon },
  { href: "/admin/history",       label: "History",         icon: Clock },
];

interface Props {
  children: ReactNode;
  title: string;
  subtitle?: string;
  breadcrumb?: string;
}

export function PredictAdminLayout({ children, title, subtitle, breadcrumb }: Props) {
  const [location] = useLocation();

  return (
    <div className="flex gap-0 min-h-[calc(100vh-160px)] -mx-4 md:-mx-6 lg:-mx-8 -mt-2">

      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside className="w-56 shrink-0 border-r border-white/[0.07] bg-[#080c17]/60 flex flex-col">

        {/* Domain label */}
        <div className="px-4 pt-5 pb-4 border-b border-white/[0.07]">
          <div className="text-[10px] font-mono text-cyan-400 uppercase tracking-widest font-semibold mb-0.5">
            Predict Admin
          </div>
          <div className="text-[11px] text-muted-foreground">Ingestion · Events · Queue</div>
        </div>

        {/* Nav links */}
        <nav className="flex flex-col gap-0.5 p-2 flex-1">
          {NAV.map(({ href, label, icon: Icon, exact }) => {
            const active = exact
              ? location === href
              : location === href || location.startsWith(href + "/");
            return (
              <Link
                key={href}
                href={href}
                data-testid={`predict-nav-${label.toLowerCase().replace(/\s+/g, "-")}`}
                className={`
                  flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium
                  transition-all duration-150 select-none
                  ${active
                    ? "bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 shadow-[0_0_12px_-4px_#06b6d4]/30"
                    : "text-muted-foreground hover:text-white hover:bg-white/[0.04] border border-transparent"}
                `}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Back to main admin */}
        <div className="p-2 border-t border-white/[0.07]">
          <Link
            href="/admin/users"
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-muted-foreground hover:text-white hover:bg-white/[0.04] transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Admin
          </Link>
        </div>
      </aside>

      {/* ── Main content ─────────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        {/* Page header */}
        <div className="sticky top-0 z-10 bg-[#080c17]/80 backdrop-blur border-b border-white/[0.07] px-6 py-3 flex items-center gap-2">
          <span className="text-xs font-mono text-cyan-400/70">Predict</span>
          <ChevronRight className="w-3 h-3 text-muted-foreground/40" />
          {breadcrumb && (
            <>
              <span className="text-xs text-muted-foreground">{breadcrumb}</span>
              <ChevronRight className="w-3 h-3 text-muted-foreground/40" />
            </>
          )}
          <span className="text-xs font-medium text-white">{title}</span>
        </div>

        <div className="p-6 flex flex-col gap-6">
          {subtitle && (
            <div>
              <h1 className="text-xl font-display font-bold text-white">{title}</h1>
              <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}

// ── Reusable sub-components ──────────────────────────────────────────────────

interface SectionCardProps {
  title: string;
  description?: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function AdminSectionCard({ title, description, children, action, className = "" }: SectionCardProps) {
  return (
    <div className={`bg-card border border-white/[0.08] rounded-xl overflow-hidden ${className}`}>
      <div className="flex items-start justify-between px-5 py-4 border-b border-white/[0.06]">
        <div>
          <div className="text-sm font-semibold text-white">{title}</div>
          {description && <div className="text-xs text-muted-foreground mt-0.5">{description}</div>}
        </div>
        {action && <div>{action}</div>}
      </div>
      {children && <div className="px-5 py-4">{children}</div>}
    </div>
  );
}

interface EmptyStateProps {
  icon?: ReactNode;
  message: string;
  hint?: string;
}

export function AdminEmptyState({ icon, message, hint }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      {icon && <div className="text-muted-foreground/30">{icon}</div>}
      <div className="text-sm font-medium text-muted-foreground">{message}</div>
      {hint && <div className="text-xs text-muted-foreground/60">{hint}</div>}
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
  "data-testid"?: string;
}

export function AdminStatCard({ label, value, sub, accent = "cyan", "data-testid": testId }: StatCardProps) {
  const colorMap: Record<string, string> = {
    cyan:   "text-cyan-400 bg-cyan-500/10 border-cyan-500/20",
    amber:  "text-amber-400 bg-amber-500/10 border-amber-500/20",
    green:  "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    violet: "text-violet-400 bg-violet-500/10 border-violet-500/20",
    red:    "text-red-400 bg-red-500/10 border-red-500/20",
  };
  return (
    <div
      data-testid={testId}
      className={`border rounded-xl p-5 flex flex-col gap-2 ${colorMap[accent] ?? colorMap.cyan}`}
    >
      <div className="text-xs font-mono uppercase tracking-widest opacity-70">{label}</div>
      <div className="text-3xl font-display font-bold">{value}</div>
      {sub && <div className="text-xs opacity-60">{sub}</div>}
    </div>
  );
}

// ── Pill badge ───────────────────────────────────────────────────────────────

const statusColors: Record<string, string> = {
  pending_review: "bg-amber-500/15 text-amber-300 border-amber-500/25",
  approved:       "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
  rejected:       "bg-red-500/15 text-red-300 border-red-500/25",
  published:      "bg-cyan-500/15 text-cyan-300 border-cyan-500/25",
  archived:       "bg-slate-500/15 text-slate-400 border-slate-500/25",
  needs_edit:     "bg-violet-500/15 text-violet-300 border-violet-500/25",
  scheduled:      "bg-blue-500/15 text-blue-300 border-blue-500/25",
  live:           "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  finished:       "bg-slate-500/15 text-slate-400 border-slate-500/25",
};

export function StatusBadge({ status }: { status: string }) {
  const color = statusColors[status] ?? "bg-white/5 text-muted-foreground border-white/10";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${color}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

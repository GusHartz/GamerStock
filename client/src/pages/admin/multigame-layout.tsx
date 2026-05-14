import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft, FileSearch, Inbox, Activity } from "lucide-react";

const NAV = [
  { href: "/admin/multigame/ops",               label: "Ops Summary",        icon: Activity   },
  { href: "/admin/multigame/claims",             label: "Claims",             icon: FileSearch },
  { href: "/admin/multigame/assets-under-review", label: "Assets Under Review", icon: Inbox    },
];

interface Props {
  children: ReactNode;
  title:    string;
  subtitle?: string;
}

export function MultigameAdminLayout({ children, title, subtitle }: Props) {
  const [location] = useLocation();

  return (
    <div className="flex gap-0 min-h-[calc(100vh-160px)] -mx-4 md:-mx-6 lg:-mx-8 -mt-2">

      {/* Sidebar */}
      <aside className="w-56 shrink-0 border-r border-white/[0.07] bg-[#080c17]/60 flex flex-col">
        <div className="px-4 pt-5 pb-4 border-b border-white/[0.07]">
          <div className="text-[10px] font-mono text-cyan-400 uppercase tracking-widest font-semibold mb-0.5">
            Multigame Admin
          </div>
          <div className="text-[11px] text-muted-foreground">Claims · Ownership · Listings</div>
        </div>

        <nav className="flex flex-col gap-0.5 p-2 flex-1">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = location === href || location.startsWith(href + "/");
            return (
              <Link
                key={href}
                href={href}
                data-testid={`multigame-nav-${label.toLowerCase().replace(/\s+/g, "-")}`}
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

      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0">
        <div className="px-6 pt-5 pb-4 border-b border-white/[0.07] bg-[#090d1a]/40">
          <h1 className="text-base font-semibold text-white">{title}</h1>
          {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
        <div className="flex-1 p-6">
          {children}
        </div>
      </main>
    </div>
  );
}

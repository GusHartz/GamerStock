import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Users, Activity, Shield, FlaskConical, TrendingUp, Coins, CalendarCheck, Clock, Gamepad2 } from "lucide-react";
import { isPredictEnabled } from "@/lib/featureFlags";

const PREDICT_PREFIXES = ["/admin/predict", "/admin/ingestion", "/admin/events", "/admin/display-queue", "/admin/media"];

const ALL_ADMIN_TABS = [
  { href: "/admin/users",          label: "Users",          icon: Users,         predict: false },
  { href: "/admin/revenue",        label: "Revenue",        icon: TrendingUp,    predict: false },
  { href: "/admin/player-earnings",label: "Player Earnings",icon: Coins,         predict: false },
  { href: "/admin/market",         label: "Markets",        icon: Activity,      predict: false },
  { href: "/admin/market-lab",     label: "Market Lab",     icon: FlaskConical,  predict: false },
  { href: "/admin/predict",        label: "Predict",        icon: CalendarCheck, predict: true  },
  { href: "/admin/history",        label: "History",        icon: Clock,         predict: true  },
  { href: "/admin/multigame",      label: "Multigame",      icon: Gamepad2,      predict: false },
];

export function AdminLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const predictEnabled = isPredictEnabled();
  const adminTabs = ALL_ADMIN_TABS.filter((t) => !t.predict || predictEnabled);

  return (
    <div className="flex flex-col gap-6 animate-in fade-in duration-500 pb-20">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-violet-500 to-purple-700 flex items-center justify-center shadow-lg shadow-violet-500/20">
          <Shield className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-display font-bold text-white tracking-tight">Admin Dashboard</h1>
          <p className="text-muted-foreground text-sm">Platform management and monitoring</p>
        </div>
      </div>

      <div className="flex items-center gap-1 border-b border-white/10 pb-0">
        {adminTabs.map((tab) => {
          const isActive =
            tab.href === "/admin/predict"
              ? PREDICT_PREFIXES.some((p) => location === p || location.startsWith(p + "/"))
              : location === tab.href || location.startsWith(tab.href + "/");
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              data-testid={`admin-tab-${tab.label.toLowerCase().replace(/\s+/g, "-")}`}
              className={`
                flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-all duration-200
                ${isActive
                  ? "border-violet-500 text-violet-400"
                  : "border-transparent text-muted-foreground hover:text-white hover:border-white/20"}
              `}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </Link>
          );
        })}
      </div>

      <div>{children}</div>
    </div>
  );
}

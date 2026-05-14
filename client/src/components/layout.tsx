import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Activity, Briefcase, LogOut, User as UserIcon, Star, Shield, Settings, Target, Layers } from "lucide-react";
import logoImg from "@assets/ChatGPT_Image_3_de_mar._de_2026__11_48_14-removebg-preview_1773185791880.png";
import { BuildBadge } from "@/components/build-badge";
import { formatCurrency } from "@/lib/format";
import { useGsWallet } from "@/hooks/use-wallets";
import { MarketPulseTicker } from "@/features/home/components/MarketPulseTicker";
import { ErrorBoundary } from "@/components/error-boundary";
import { isPredictEnabled } from "@/lib/featureFlags";

interface LayoutProps {
  children: ReactNode;
  noPadding?: boolean;
}

export function Layout({ children, noPadding = false }: LayoutProps) {
  const [location] = useLocation();
  const { user, logout, isLoggingOut } = useAuth();
  const { availableBalance: gsBalance } = useGsWallet();

  const navLinks: { href: string; label: string; icon: any; activePrefix?: string; activePrefixes?: string[] }[] = [
    // Predictions nav item is only shown when the Predict module is enabled
    ...(isPredictEnabled() ? [{ href: "/predictions", label: "Predictions", icon: Target, activePrefix: "/predictions" }] : []),
    { href: "/terminal",    label: "Terminal",    icon: Activity, activePrefix: "/terminal" },
    { href: "/portfolio",   label: "Portfolio",   icon: Briefcase },
    { href: "/player-hub",  label: "Creator",     icon: Layers,   activePrefixes: ["/player-hub", "/player-operator"] },
    ...(user?.role === "admin" ? [{ href: "/admin", label: "Admin", icon: Shield }] : []),
  ];

  const displayLabel = user?.displayName || user?.email?.split("@")[0] || "Trader";

  return (
    <div className="h-screen overflow-hidden bg-background flex flex-col font-sans">
      {/* Top Navigation — shrink-0 ensures it never compresses */}
      <header className="shrink-0 w-full border-b border-white/10 bg-background/80 backdrop-blur-lg z-50">
        <div className="max-w-[1600px] mx-auto px-4 h-[72px] flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center group cursor-pointer">
              <img src={logoImg} alt="GamerStock" className="h-10 md:h-16 w-auto object-contain" />
            </Link>

            <nav className="hidden md:flex items-center gap-1">
              {navLinks.map((link) => {
                const isActive = location === link.href ||
                  (link.activePrefixes
                    ? link.activePrefixes.some((p) => location.startsWith(p))
                    : link.activePrefix
                    ? location.startsWith(link.activePrefix)
                    : link.href !== "/" && location.startsWith(link.href));
                const Icon = link.icon;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`
                      flex items-center gap-2 px-4 py-2 rounded-md font-medium text-sm transition-all duration-200
                      ${isActive
                        ? 'bg-white/10 text-white shadow-inner'
                        : 'text-muted-foreground hover:bg-white/5 hover:text-white'}
                    `}
                  >
                    <Icon className="w-4 h-4" />
                    {link.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-4">
            {gsBalance !== null && (
              <div className="hidden sm:flex flex-col items-end mr-4">
                <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Buying Power</span>
                <span className="text-sm font-mono font-bold text-white" data-testid="header-buying-power">
                  {formatCurrency(gsBalance)}
                </span>
              </div>
            )}

            <div className="h-8 w-px bg-white/10 hidden sm:block"></div>

            <div className="flex items-center gap-2">
              <div
                className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-secondary/50 border border-white/5"
                data-testid="user-display-name"
              >
                <UserIcon className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium text-white max-w-[120px] truncate">
                  {displayLabel}
                </span>
              </div>
              <Link
                href="/settings/player-identity"
                title="Settings"
                className="p-2 rounded-full text-muted-foreground hover:text-white hover:bg-white/10 transition-colors"
              >
                <Settings className="w-4 h-4" />
              </Link>
              <button
                onClick={() => logout()}
                disabled={isLoggingOut}
                data-testid="button-logout"
                className="p-2 rounded-full text-muted-foreground hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50"
                title="Sign out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Market Pulse — only mounted when Predict module is enabled */}
      {isPredictEnabled() && (
        <div className="shrink-0 w-full" data-testid="layout-ticker-strip">
          <ErrorBoundary label="Market Pulse" fallback={<div className="h-8 w-full bg-black/40 border-b border-white/5" />}>
            <MarketPulseTicker />
          </ErrorBoundary>
        </div>
      )}

      {/* Main Content — flex-1 + min-h-0 ensures it fills exactly remaining space.
          overflow-y-auto on scrollable pages; overflow-hidden on terminal (noPadding). */}
      <main
        className={`flex-1 min-h-0 w-full max-w-[1600px] mx-auto ${
          noPadding ? "p-0 overflow-hidden" : "p-4 md:p-6 lg:p-8 overflow-y-auto"
        }`}
      >
        {children}
      </main>

      {/* Footer — shrink-0 keeps it pinned to the bottom without affecting main height */}
      {!noPadding && (
        <footer className="shrink-0 w-full border-t border-white/5 py-1 flex justify-end px-4">
          <BuildBadge />
        </footer>
      )}
    </div>
  );
}

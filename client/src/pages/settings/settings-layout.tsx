import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { KeyRound } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/settings/security", label: "Security", icon: KeyRound },
];

export function SettingsLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();

  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      <nav className="flex gap-1 mb-8 border-b border-white/10 pb-1">
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            data-testid={`settings-nav-${label.toLowerCase()}`}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 rounded-t-md text-sm font-medium transition-all",
              location === href
                ? "text-white border-b-2 border-primary -mb-px"
                : "text-white/50 hover:text-white/80 hover:bg-white/5",
            )}
          >
            <Icon className="w-4 h-4" />
            {label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}

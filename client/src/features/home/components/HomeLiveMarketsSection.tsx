import { Activity, ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { HomeLiveMarketCard } from "./HomeLiveMarketCard";
import type { MarketCardVM } from "../types/home";

interface HomeLiveMarketsSectionProps {
  markets: MarketCardVM[];
}

export function HomeLiveMarketsSection({ markets }: HomeLiveMarketsSectionProps) {
  return (
    <section data-testid="home-live-markets-section">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-[11px] font-bold uppercase tracking-widest text-white/80">Live Markets</span>
        </div>
        <Link
          href="/predictions"
          className="flex items-center gap-1 text-[11px] font-medium text-zinc-500 hover:text-cyan-400 transition-colors"
        >
          Live Markets
          <ArrowRight className="w-3 h-3" />
        </Link>
      </div>

      {markets.length === 0 ? (
        <div className="p-8 text-center rounded-xl border border-white/[0.05] bg-white/[0.02]">
          <Activity className="w-5 h-5 text-zinc-700 mx-auto mb-2" />
          <p className="text-sm text-zinc-600">No additional live markets right now.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {markets.slice(0, 3).map(m => (
            <HomeLiveMarketCard key={m.marketId} market={m} />
          ))}
        </div>
      )}
    </section>
  );
}

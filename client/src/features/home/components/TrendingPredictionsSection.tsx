import { Activity } from "lucide-react";
import { SectionHeader } from "@/components/market/SectionHeader";
import { PredictionCard } from "@/components/market/PredictionCard";
import { GlassPanel } from "@/components/market/GlassPanel";
import type { MarketCardVM } from "../types/home";

interface TrendingPredictionsSectionProps {
  markets: MarketCardVM[];
}

export function TrendingPredictionsSection({ markets }: TrendingPredictionsSectionProps) {
  return (
    <section data-testid="trending-predictions-section">
      <SectionHeader
        title="Live Markets"
        icon={<Activity className="w-4 h-4" />}
        viewAllHref="/predictions"
        viewAllLabel="Live Markets"
      />

      {markets.length === 0 ? (
        <GlassPanel className="p-8 text-center">
          <p className="text-sm text-muted-foreground">No trending markets at the moment.</p>
          <p className="text-xs text-zinc-600 mt-1">Markets will appear here as trading activity increases.</p>
        </GlassPanel>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {markets.map(m => (
            <PredictionCard key={m.marketId} market={m} />
          ))}
        </div>
      )}
    </section>
  );
}

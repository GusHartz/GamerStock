import { Calendar } from "lucide-react";
import { EventSpotlightCard } from "./EventSpotlightCard";
import { MarketMoversList } from "./MarketMoversList";
import { TrendingTopicsList } from "./TrendingTopicsList";
import { EsportsNewsList } from "./EsportsNewsList";
import type { UpcomingEventVM } from "../types/home";

interface RightSidebarProps {
  spotlightEvent: UpcomingEventVM | null;
}

export function RightSidebar({ spotlightEvent }: RightSidebarProps) {
  return (
    <aside data-testid="right-sidebar" className="flex flex-col gap-4">
      {/* Upcoming Events — section label mirrors the "LIVE MARKETS" label in the left column */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Calendar className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-[11px] font-bold uppercase tracking-widest text-white/80">
            Upcoming Event
          </span>
        </div>
        <EventSpotlightCard event={spotlightEvent} />
      </div>

      {/* Market Movers */}
      <MarketMoversList />

      {/* Trending Topics */}
      <TrendingTopicsList />

      {/* Esports News */}
      <EsportsNewsList />
    </aside>
  );
}

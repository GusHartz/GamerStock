import { useMemo } from "react";
import { useHomeData } from "../hooks/useHomeData";
import { mapHomeResponseToVM, mapApiMarketToCardVM } from "../mappers/mapHomeResponseToVM";
import { HomeSkeleton } from "../components/HomeSkeleton";
import { HomeErrorState } from "../components/HomeErrorState";

import { HomeHeroSection } from "../components/HomeHeroSection";
import { LiveMatchHero } from "../components/LiveMatchHero";
import { HomeUpcomingPanel } from "../components/HomeUpcomingPanel";
import { HomeFeaturedRow } from "../components/HomeFeaturedRow";
import { HomeTradeMarketsRail } from "../components/HomeTradeMarketsRail";
import type { MarketCardVM } from "../types/home";

export default function HomePage() {
  // isError is intentionally omitted: useHomeData never surfaces Predict errors
  // as fatal — it returns SAFE_HOME_FALLBACK instead. HomeErrorState is only
  // shown when the VM itself cannot be constructed (structural/type failure).
  const { data, isLoading, refetch } = useHomeData();

  const vm = useMemo(
    () => (data ? mapHomeResponseToVM(data) : null),
    [data]
  );

  /**
   * Backend-resolved market for the editorial hero event.
   * Preferred over marketsByEventId because the backend explicitly fetches
   * the first open/locked market for the hero's eventId, even when that
   * market falls outside the top-N live/trending lists.
   */
  const heroMarketVM = useMemo<MarketCardVM | null>(() => {
    const hm = data?.publicSurfaces?.heroMarket;
    if (!hm) return null;
    return mapApiMarketToCardVM(hm);
  }, [data]);

  /**
   * First live prediction market from the curated queue.
   * Used as the LiveMatchHero fallback when there is no editorial hero.
   */
  const heroMarket = useMemo<MarketCardVM | null>(() => {
    const lp = data?.publicSurfaces?.livePredictions;
    if (!lp?.length) return null;
    return mapApiMarketToCardVM(lp[0]);
  }, [data]);

  /**
   * Correlation map: eventId → first live MarketCardVM.
   * Built from ALL available market sources so that any surface (hero, featured,
   * upcoming) can find its corresponding tradeable market regardless of which
   * API array it appears in.
   */
  const marketsByEventId = useMemo<Map<number, MarketCardVM>>(() => {
    const map = new Map<number, MarketCardVM>();
    // Primary: live + trending markets (rich context, already fetched)
    const sources = [
      ...(data?.publicSurfaces?.livePredictions ?? []),
      ...(data?.liveMatches                     ?? []),
      ...(data?.trendingPredictions             ?? []),
    ];
    for (const raw of sources) {
      if (raw.event?.eventId != null && !map.has(raw.event.eventId)) {
        map.set(raw.event.eventId, mapApiMarketToCardVM(raw));
      }
    }
    // Editorial enrichment: fill any event IDs not already covered by live/trending.
    // Include hero so its eventId is also reachable via the fallback map.
    const heroEd = data?.publicSurfaces?.hero ? [data.publicSurfaces.hero] : [];
    const editorialSources = [
      ...heroEd,
      ...(data?.publicSurfaces?.featuredEvents          ?? []),
      ...(data?.publicSurfaces?.upcomingEventsEditorial ?? []),
    ];
    for (const editorial of editorialSources) {
      const eid = editorial.event?.eventId;
      if (eid != null && !map.has(eid) && editorial.market) {
        map.set(eid, mapApiMarketToCardVM(editorial.market));
      }
    }
    return map;
  }, [data]);

  if (isLoading) return <HomeSkeleton />;

  // Only show error state for structural failures (vm could not be built).
  // Predict endpoint errors are absorbed by useHomeData and never reach here.
  if (!vm) {
    return (
      <HomeErrorState
        onRetry={() => refetch()}
      />
    );
  }

  return (
    <div data-testid="home-page" className="relative space-y-5 pb-10">
      {/* Atmospheric background glows */}
      <div className="pointer-events-none absolute -inset-8 -z-10 overflow-hidden">
        <div className="absolute top-0 left-1/4 w-[700px] h-[400px] bg-cyan-950/35 rounded-full blur-[100px]" />
        <div className="absolute top-60 right-0 w-[400px] h-[300px] bg-blue-950/30 rounded-full blur-[80px]" />
        <div className="absolute top-[30%] left-0 w-[300px] h-[200px] bg-indigo-950/20 rounded-full blur-[60px]" />
      </div>

      {/* ── TOP ROW: Hero + Upcoming side-by-side ─────────────────────────── */}
      <div className="flex flex-col lg:flex-row gap-4 items-stretch">
        {/* Hero priority:
            1. Editorial queue hero (publicSurfaces.hero) always wins → HomeHeroSection.
               HomeHeroSection shows the two-panel BUY buttons when marketsByEventId
               contains a market for the hero event (hasTrade=true), or falls back to
               the "View Markets" CTA when no market is linked. The expanded
               marketsByEventId covers livePredictions + liveMatches + trendingPredictions
               so the lookup succeeds regardless of which API array the market arrives in.
            2. Fall back to LiveMatchHero(livePredictions[0]) only when no editorial hero. */}
        {vm.heroEvent ? (
          <HomeHeroSection
            event={vm.heroEvent}
            heroMarket={heroMarketVM}
            marketsByEventId={marketsByEventId}
          />
        ) : heroMarket ? (
          <LiveMatchHero market={heroMarket} />
        ) : (
          <div
            className="flex-1 min-w-0 rounded-xl border border-white/[0.05] bg-white/[0.01] flex items-center justify-center"
            style={{ minHeight: "300px" }}
          >
            <p className="text-sm text-zinc-700">No featured event scheduled</p>
          </div>
        )}

        <HomeUpcomingPanel events={vm.upcomingEvents} />
      </div>

      {/* ── FEATURED ROW ──────────────────────────────────────────────────── */}
      {vm.featuredEvents.length > 0 && (
        <HomeFeaturedRow events={vm.featuredEvents} marketsByEventId={marketsByEventId} />
      )}

      {/* ── TRADE MARKETS RAIL ────────────────────────────────────────────── */}
      <HomeTradeMarketsRail />
    </div>
  );
}

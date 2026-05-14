import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Calendar, Clock, ChevronRight } from "lucide-react";
import { useTradeCard } from "@/features/trade/TradeCardContext";
import { isPredictEnabled } from "@/lib/featureFlags";
import type { UpcomingEventVM } from "../types/home";
import { getUpcomingTimeLabel } from "@/utils/upcomingTimeLabel";

const GAME_TAG: Record<string, { label: string; color: string; dot: string }> = {
  lol:   { label: "LoL",         color: "text-[#C89B3C]", dot: "bg-[#C89B3C]" },
  val:   { label: "Valorant",    color: "text-[#FF4655]", dot: "bg-[#FF4655]" },
  cs2:   { label: "CS2",         color: "text-[#E8AE50]", dot: "bg-[#E8AE50]" },
  dota2: { label: "Dota 2",      color: "text-[#BF3B3A]", dot: "bg-[#BF3B3A]" },
  ow2:   { label: "Overwatch 2", color: "text-[#F99E1A]", dot: "bg-[#F99E1A]" },
};

/**
 * Ticks every 60 seconds so countdown labels stay accurate without
 * triggering a full data refetch.
 */
function useMinuteTicker(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  return tick;
}

interface UpcomingRowProps {
  event: UpcomingEventVM;
  index: number;
}

function UpcomingRow({ event, index }: UpcomingRowProps) {
  useMinuteTicker();
  const { open } = useTradeCard();

  const tag  = GAME_TAG[event.game];
  const name = event.eventName
    ?? (event.teamAName && event.teamBName ? `${event.teamAName} vs ${event.teamBName}` : null)
    ?? event.tournamentName
    ?? "Event";

  const market   = event.market ?? null;
  // hasTrade is gated on the feature flag: when Predict is off, rows render
  // without trade actions and without navigation to Predict routes.
  const hasTrade = isPredictEnabled() && market != null && (market.yesId != null || market.noId != null);
  const fallbackHref = event.firstMarketSlug
    ? `/predictions/markets/${event.firstMarketSlug}`
    : `/predictions?event=${event.eventId}`;

  const timeLabel = getUpcomingTimeLabel(event.startsAt);

  function handleClick() {
    if (!hasTrade || !market) return;
    const sideALabel = event.teamAName ?? "YES";
    const sideBLabel = event.teamBName ?? "NO";
    if (market.yesId != null) {
      open({
        type: "prediction",
        marketId: market.marketId,
        sideId: market.yesId,
        sideLabel: sideALabel,
        price: market.yesPrice != null ? String(market.yesPrice) : "0.5",
        action: "BUY",
        question: market.question,
        sideColor: "cyan",
      });
    } else if (market.noId != null) {
      open({
        type: "prediction",
        marketId: market.marketId,
        sideId: market.noId,
        sideLabel: sideBLabel,
        price: market.noPrice != null ? String(market.noPrice) : "0.5",
        action: "BUY",
        question: market.question,
        sideColor: "rose",
      });
    }
  }

  const rowInner = (
    <>
      {/* Index */}
      <span className="flex-none w-4 text-[11px] font-mono text-zinc-700 text-center">
        {index + 1}
      </span>

      {/* Main info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          {tag && (
            <>
              <span className={`w-1.5 h-1.5 rounded-full flex-none ${tag.dot}`} />
              <span className={`text-[10px] font-mono font-bold ${tag.color}`}>{tag.label}</span>
            </>
          )}
          {event.tournamentName && (
            <span className="text-[10px] font-mono text-zinc-600 truncate">{event.tournamentName}</span>
          )}
        </div>
        <p
          data-testid={`text-upcoming-name-${event.eventId}`}
          className="text-[13px] font-semibold text-white/85 leading-tight group-hover:text-white transition-colors truncate"
        >
          {name}
        </p>
      </div>

      {/* Right area: time + chevron */}
      <div
        data-testid={`text-upcoming-time-${event.eventId}`}
        className="flex-none flex items-center gap-1 text-[11px] font-mono text-zinc-500"
      >
        <Clock className="w-2.5 h-2.5 text-zinc-600" />
        <span>{timeLabel}</span>
      </div>
      <ChevronRight className="w-3 h-3 text-zinc-700 flex-none group-hover:text-zinc-500 transition-colors" />
    </>
  );

  const rowClass = "group flex items-center gap-3 px-3 py-2.5 rounded-lg border border-transparent hover:border-white/[0.06] hover:bg-white/[0.025] transition-all duration-150";

  if (hasTrade) {
    return (
      <div
        role="button"
        tabIndex={0}
        data-testid={`upcoming-row-${event.eventId}`}
        onClick={handleClick}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleClick(); } }}
        className={`${rowClass} cursor-pointer`}
      >
        {rowInner}
      </div>
    );
  }

  // When Predict is disabled, render as a non-interactive div to avoid
  // navigating to Predict routes (/predictions/markets/... or /predictions?event=...).
  if (!isPredictEnabled()) {
    return (
      <div data-testid={`upcoming-row-${event.eventId}`} className={rowClass}>
        {rowInner}
      </div>
    );
  }

  return (
    <Link
      href={fallbackHref}
      data-testid={`upcoming-row-${event.eventId}`}
      className={rowClass}
    >
      {rowInner}
    </Link>
  );
}

interface HomeUpcomingPanelProps {
  events: UpcomingEventVM[];
}

export function HomeUpcomingPanel({ events }: HomeUpcomingPanelProps) {
  return (
    <section data-testid="home-upcoming-panel" className="w-full lg:w-[300px] xl:w-[320px] flex-none">
      {/* Section header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Calendar className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-[11px] font-bold uppercase tracking-widest text-white/80">Upcoming</span>
        </div>
        {isPredictEnabled() && (
          <Link
            href="/predictions"
            className="flex items-center gap-1 text-[11px] font-medium text-zinc-500 hover:text-cyan-400 transition-colors"
          >
            View all
            <ChevronRight className="w-3 h-3" />
          </Link>
        )}
      </div>

      {/* Events list */}
      <div
        className="rounded-xl border border-white/[0.06] overflow-hidden"
        style={{ background: "linear-gradient(180deg, #080C18 0%, #060A14 100%)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 8px 32px -8px rgba(0,0,0,0.9)" }}
      >
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 px-4 text-center">
            <Calendar className="w-5 h-5 text-zinc-700" />
            <p className="text-xs text-zinc-600">No upcoming events scheduled</p>
          </div>
        ) : (
          <div className="py-1.5">
            {events.slice(0, 6).map((ev, i) => (
              <UpcomingRow key={ev.eventId} event={ev} index={i} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

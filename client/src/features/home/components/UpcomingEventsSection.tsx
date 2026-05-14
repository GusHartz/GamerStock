import { Calendar, ChevronRight } from "lucide-react";
import { Link } from "wouter";
import { SectionHeader } from "@/components/market/SectionHeader";
import { GlassPanel } from "@/components/market/GlassPanel";
import { useTradeCard } from "@/features/trade/TradeCardContext";
import type { UpcomingEventVM } from "../types/home";

const GAME_TAG: Record<string, { label: string; color: string }> = {
  lol:   { label: "LoL",   color: "text-[#C89B3C]" },
  val:   { label: "VAL",   color: "text-[#FF4655]" },
  cs2:   { label: "CS2",   color: "text-[#E8AE50]" },
  dota2: { label: "Dota2", color: "text-[#BF3B3A]" },
  ow2:   { label: "OW2",   color: "text-[#F99E1A]" },
};

function formatEventDate(startsAt: string | null): string {
  if (!startsAt) return "TBD";
  const d = new Date(startsAt);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

interface UpcomingEventRowProps {
  event: UpcomingEventVM;
}

function UpcomingEventRow({ event }: UpcomingEventRowProps) {
  const { open } = useTradeCard();

  const tag  = GAME_TAG[event.game];
  const name = event.eventName ?? [event.teamAName, event.teamBName].filter(Boolean).join(" vs ") ?? "Upcoming Match";

  const market    = event.market ?? null;
  const hasTrade  = market != null && (market.yesId != null || market.noId != null);
  const fallbackHref = event.firstMarketSlug
    ? `/predictions/markets/${event.firstMarketSlug}`
    : `/predictions?event=${event.eventId}`;

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

  const inner = (
    <GlassPanel hoverable className="px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-white/[0.06] border border-white/[0.07] flex items-center justify-center flex-none">
            <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <p
              data-testid={`text-event-name-${event.eventId}`}
              className="text-sm font-medium text-white truncate"
            >
              {name}
            </p>
            <div className="flex items-center gap-2 mt-0.5">
              {tag && <span className={`text-[10px] font-mono font-semibold ${tag.color}`}>{tag.label}</span>}
              {event.tournamentName && (
                <span className="text-[10px] text-muted-foreground truncate">{event.tournamentName}</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-none">
          <span className="text-[11px] font-mono text-muted-foreground whitespace-nowrap">
            {formatEventDate(event.startsAt)}
          </span>
          <ChevronRight className="w-3.5 h-3.5 text-zinc-600" />
        </div>
      </div>
    </GlassPanel>
  );

  if (hasTrade) {
    return (
      <div
        role="button"
        tabIndex={0}
        data-testid={`link-upcoming-event-${event.eventId}`}
        onClick={handleClick}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleClick(); } }}
        className="block cursor-pointer"
      >
        {inner}
      </div>
    );
  }

  return (
    <Link
      href={fallbackHref}
      data-testid={`link-upcoming-event-${event.eventId}`}
    >
      {inner}
    </Link>
  );
}

interface UpcomingEventsSectionProps {
  events: UpcomingEventVM[];
}

export function UpcomingEventsSection({ events }: UpcomingEventsSectionProps) {
  return (
    <section data-testid="upcoming-events-section">
      <SectionHeader
        title="Upcoming Events"
        subtitle="Scheduled matches with prediction markets"
        icon={<Calendar className="w-4 h-4" />}
        viewAllHref="/predictions"
      />

      {events.length === 0 ? (
        <GlassPanel className="p-6 text-center">
          <p className="text-sm text-muted-foreground">No upcoming events scheduled.</p>
        </GlassPanel>
      ) : (
        <div className="space-y-2">
          {events.map(e => (
            <UpcomingEventRow key={e.eventId} event={e} />
          ))}
        </div>
      )}
    </section>
  );
}

import { Calendar, ChevronRight, Clock, Zap } from "lucide-react";
import { Link } from "wouter";
import type { UpcomingEventVM } from "../types/home";
import { getUpcomingTimeLabel } from "@/utils/upcomingTimeLabel";

const GAME_TAG: Record<string, { label: string; color: string; dot: string }> = {
  lol:   { label: "LoL",         color: "text-[#C89B3C]", dot: "bg-[#C89B3C]" },
  val:   { label: "Valorant",    color: "text-[#FF4655]", dot: "bg-[#FF4655]" },
  cs2:   { label: "CS2",         color: "text-[#E8AE50]", dot: "bg-[#E8AE50]" },
  dota2: { label: "Dota 2",      color: "text-[#BF3B3A]", dot: "bg-[#BF3B3A]" },
  ow2:   { label: "Overwatch 2", color: "text-[#F99E1A]", dot: "bg-[#F99E1A]" },
};

interface EventSpotlightCardProps {
  event: UpcomingEventVM | null;
}

export function EventSpotlightCard({ event }: EventSpotlightCardProps) {
  if (!event) {
    return (
      <div
        data-testid="event-spotlight-empty"
        className="rounded-xl border border-white/[0.06] bg-[#0B0F1E]/80 p-4"
        style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04),0 8px 32px -8px rgba(0,0,0,0.9)" }}
      >
        <div className="flex flex-col gap-2 py-8 items-center text-center">
          <Calendar className="w-5 h-5 text-zinc-700" />
          <p className="text-xs text-zinc-600">No upcoming events</p>
        </div>
      </div>
    );
  }

  const tag        = GAME_TAG[event.game];
  const name       = event.eventName ?? [event.teamAName, event.teamBName].filter(Boolean).join(" vs ") ?? "Event";
  const marketHref = event.firstMarketSlug
    ? `/predictions/markets/${event.firstMarketSlug}`
    : `/predictions?event=${event.eventId}`;

  const hasImage = !!event.imageUrl;

  return (
    <div
      data-testid={`event-spotlight-${event.eventId}`}
      className="overflow-hidden rounded-xl border border-white/[0.07]"
      style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05),0 8px 32px -8px rgba(0,0,0,0.9)" }}
    >
      {/* Hero image / background area — taller than before */}
      <div
        className="relative flex flex-col justify-end overflow-hidden"
        style={{
          minHeight: "148px",
          ...(hasImage
            ? { backgroundImage: `url(${event.imageUrl})`, backgroundSize: "cover", backgroundPosition: "center 20%" }
            : { background: "linear-gradient(135deg, #05090F 0%, #080E1A 40%, #060A14 100%)" }
          ),
        }}
      >
        {/* Overlays */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {hasImage ? (
            <>
              <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/55 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#0B0F1E] to-transparent" />
            </>
          ) : (
            <>
              <div className="absolute -top-10 -left-10 w-[250px] h-[150px] bg-cyan-800/25 rounded-full blur-[50px]" />
              <div className="absolute top-0 right-0 w-[150px] h-[100px] bg-blue-900/20 rounded-full blur-[40px]" />
              <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-[#0B0F1E] to-transparent" />
            </>
          )}
          {/* Scanline */}
          <div
            className="absolute inset-0 opacity-[0.02]"
            style={{
              backgroundImage: "repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(255,255,255,1) 2px,rgba(255,255,255,1) 3px)",
              backgroundSize: "100% 4px",
            }}
          />
        </div>

        {/* Text overlay */}
        <div className="relative z-10 px-4 pb-4 pt-3">
          {tag && (
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${tag.dot}`} />
              <span className={`text-[10px] font-mono font-bold ${tag.color} uppercase tracking-wider`}>{tag.label}</span>
            </div>
          )}
          <p
            data-testid={`text-spotlight-name-${event.eventId}`}
            className="text-[16px] font-black text-white leading-tight tracking-tight"
          >
            {name}
          </p>
          {event.tournamentName && (
            <p className="text-[11px] text-zinc-400 mt-0.5 font-mono">{event.tournamentName}</p>
          )}
          <p className="text-[11px] text-zinc-500 mt-1">Markets Opening soon</p>
        </div>
      </div>

      {/* Info strip */}
      <div className="bg-[#0B0F1E]/90 border-t border-white/[0.05] px-4 py-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] font-mono">
          <Clock className="w-3 h-3 text-zinc-600" />
          <span className="text-zinc-400">{getUpcomingTimeLabel(event.startsAt)}</span>
        </div>

        <div className="flex items-center gap-1.5 text-[10px] font-mono text-zinc-600">
          <Zap className="w-2.5 h-2.5 text-cyan-700" />
          <span>markets avail.</span>
        </div>

        <Link
          href={marketHref}
          data-testid={`link-spotlight-view-${event.eventId}`}
          className="flex items-center gap-0.5 text-[11px] font-bold text-cyan-400 hover:text-cyan-300 transition-colors"
        >
          Markets
          <ChevronRight className="w-3 h-3" />
        </Link>
      </div>
    </div>
  );
}

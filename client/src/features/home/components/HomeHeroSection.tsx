import { Link } from "wouter";
import { Calendar, Clock } from "lucide-react";
import { useTradeCard } from "@/features/trade/TradeCardContext";
import { abbreviateTeam } from "@/utils/abbreviateTeam";
import { getMatchTimeLabel } from "@/utils/upcomingTimeLabel";
import { isPredictEnabled } from "@/lib/featureFlags";
import type { UpcomingEventVM, MarketCardVM } from "../types/home";

const GAME_SHORT: Record<string, string> = {
  lol: "LoL", val: "VAL", cs2: "CS2", dota2: "Dota2", ow2: "OW2",
};

const GAME_COLOR: Record<string, string> = {
  lol: "#C89B3C", val: "#FF4655", cs2: "#E8AE50", dota2: "#BF3B3A", ow2: "#F99E1A",
};


interface HomeHeroSectionProps {
  event:             UpcomingEventVM;
  heroMarket?:       MarketCardVM | null;
  marketsByEventId?: Map<number, MarketCardVM>;
}

export function HomeHeroSection({ event, heroMarket, marketsByEventId }: HomeHeroSectionProps) {
  const { open } = useTradeCard();

  const hasTeams  = !!(event.teamAName && event.teamBName);
  const title     = hasTeams
    ? `${event.teamAName} vs ${event.teamBName}`
    : event.eventName ?? event.tournamentName ?? "Upcoming Event";
  const gameLabel = GAME_SHORT[event.game] ?? event.game?.toUpperCase() ?? "";
  const gameColor = GAME_COLOR[event.game] ?? "#06B6D4";

  // Priority: explicit heroMarket (backend-resolved for this event)
  //         → event.market (carried through VM from editorial enrichment)
  //         → marketsByEventId lookup (live/trending fallback map)
  //         → null
  const firstMarket = heroMarket ?? event.market ?? marketsByEventId?.get(event.eventId) ?? null;
  // hasTrade is also gated on the feature flag: when Predict is disabled no
  // trade buttons or market links are rendered, keeping the card purely visual.
  const hasTrade    = isPredictEnabled() && firstMarket != null && (firstMarket.yesId != null || firstMarket.noId != null);
  const sideALabel  = hasTeams ? (event.teamAName ?? "YES") : "YES";
  const sideBLabel  = hasTeams ? (event.teamBName ?? "NO")  : "NO";
  const sideAAbbrev = abbreviateTeam(sideALabel) || sideALabel.slice(0, 3).toUpperCase();
  const sideBAbbrev = abbreviateTeam(sideBLabel) || sideBLabel.slice(0, 3).toUpperCase();

  const bgStyle: React.CSSProperties = event.imageUrl
    ? { backgroundImage: `url(${event.imageUrl})`, backgroundSize: "cover", backgroundPosition: "center 20%" }
    : { background: "linear-gradient(135deg, #04080F 0%, #060E1C 40%, #07101E 70%, #050810 100%)" };

  function openSide(which: "A" | "B", e?: React.MouseEvent) {
    if (!firstMarket) return;
    e?.stopPropagation();
    if (which === "A") {
      if (!firstMarket.yesId) return;
      open({ type: "prediction", marketId: firstMarket.marketId, sideId: firstMarket.yesId, sideLabel: sideALabel, price: firstMarket.yesPrice != null ? String(firstMarket.yesPrice) : "0.5", action: "BUY", question: firstMarket.question, sideColor: "cyan" });
    } else {
      if (!firstMarket.noId) return;
      open({ type: "prediction", marketId: firstMarket.marketId, sideId: firstMarket.noId, sideLabel: sideBLabel, price: firstMarket.noPrice != null ? String(firstMarket.noPrice) : "0.5", action: "BUY", question: firstMarket.question, sideColor: "rose" });
    }
  }

  function handleCardClick() {
    if (!hasTrade || !firstMarket) return;
    if (firstMarket.yesId) openSide("A"); else openSide("B");
  }

  return (
    <section
      data-testid={`home-hero-section-${event.eventId}`}
      className="flex-1 min-w-0 flex flex-col"
    >
      <div
        role={hasTrade ? "button" : undefined}
        tabIndex={hasTrade ? 0 : undefined}
        onClick={hasTrade ? handleCardClick : undefined}
        onKeyDown={hasTrade ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleCardClick(); } } : undefined}
        className={`
          flex-1 relative rounded-xl overflow-hidden border border-white/[0.07] select-none
          transition-all duration-150
          ${hasTrade ? "cursor-pointer hover:border-white/[0.13]" : ""}
        `}
        style={{
          ...bgStyle,
          minHeight: "300px",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05), 0 24px 80px -12px rgba(0,0,0,0.95)",
        }}
      >
        {/* Overlays */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {event.imageUrl
            ? <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/60 to-black/20" />
            : (
              <>
                <div className="absolute -top-20 -left-10 w-[500px] h-[300px] bg-cyan-900/20 rounded-full blur-[80px]" />
                <div className="absolute top-0 right-0 w-[300px] h-[220px] bg-blue-900/15 rounded-full blur-[60px]" />
              </>
            )
          }
          <div className="absolute bottom-0 inset-x-0 h-28 bg-gradient-to-t from-black/85 to-transparent" />
        </div>

        {/* Content */}
        <div className="absolute inset-0 z-10 p-5 sm:p-6 flex flex-col gap-4">

          {/* Game + tournament */}
          <div className="flex items-center gap-2.5">
            <span
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-mono font-bold uppercase tracking-wider border"
              style={{ color: gameColor, borderColor: `${gameColor}40`, background: `${gameColor}15` }}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: gameColor }} />
              {gameLabel}
            </span>
            {event.tournamentName && (
              <span className="text-[11px] font-mono text-zinc-500 truncate">{event.tournamentName}</span>
            )}
          </div>

          {/* Title */}
          <div className="flex-1 flex flex-col justify-center gap-2">
            <h2
              data-testid={`text-hero-title-${event.eventId}`}
              className="text-[28px] sm:text-[34px] font-black text-white font-display tracking-tight leading-[1.0]"
            >
              {title}
            </h2>
            {event.startsAt && (
              <div className="flex items-center gap-1.5 text-[12px] font-mono text-zinc-500">
                <Clock className="w-3 h-3 text-zinc-600" />
                <span>{getMatchTimeLabel(event.startsAt)}</span>
              </div>
            )}
          </div>

          {/* CTA area */}
          {hasTrade && firstMarket ? (
            /* Two large side options */
            <div className="flex items-stretch gap-3">
              <div
                onClick={firstMarket.yesId ? (e) => openSide("A", e) : undefined}
                className={`flex-1 flex flex-col gap-1 px-4 py-3 rounded-xl border-2 border-cyan-600/40 bg-cyan-950/50 transition-all duration-100 ${firstMarket.yesId ? "cursor-pointer hover:bg-cyan-950/80 hover:border-cyan-500/55 active:scale-[0.98]" : ""}`}
              >
                <span className="text-[11px] font-mono text-cyan-500/80 uppercase tracking-wider">{sideALabel}</span>
                <div className="flex items-baseline gap-2">
                  <span className="text-[20px] font-black font-mono text-cyan-300">{sideAAbbrev}</span>
                  <span className="text-[15px] font-bold font-mono text-cyan-400/80">
                    {firstMarket.yesPrice != null ? `${(firstMarket.yesPrice * 100).toFixed(0)}¢` : "—"}
                  </span>
                </div>
              </div>
              <div
                onClick={firstMarket.noId ? (e) => openSide("B", e) : undefined}
                className={`flex-1 flex flex-col gap-1 px-4 py-3 rounded-xl border-2 border-rose-700/40 bg-rose-950/50 transition-all duration-100 ${firstMarket.noId ? "cursor-pointer hover:bg-rose-950/80 hover:border-rose-600/55 active:scale-[0.98]" : ""}`}
              >
                <span className="text-[11px] font-mono text-rose-400/80 uppercase tracking-wider">{sideBLabel}</span>
                <div className="flex items-baseline gap-2">
                  <span className="text-[20px] font-black font-mono text-rose-400">{sideBAbbrev}</span>
                  <span className="text-[15px] font-bold font-mono text-rose-400/80">
                    {firstMarket.noPrice != null ? `${(firstMarket.noPrice * 100).toFixed(0)}¢` : "—"}
                  </span>
                </div>
              </div>
            </div>
          ) : isPredictEnabled() ? (
            /* No live market — navigate to predictions (only when Predict is enabled) */
            <Link
              href={`/predictions?event=${event.eventId}`}
              className="self-start inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg font-bold text-[13px] text-black transition-all duration-150 hover:brightness-110 active:scale-[0.98]"
              style={{ background: "linear-gradient(135deg, #00E5A0 0%, #00C87A 100%)" }}
              onClick={(e) => e.stopPropagation()}
            >
              View Markets
            </Link>
          ) : null}
        </div>

        {/* FEATURED badge */}
        <div className="absolute top-4 right-4 z-20">
          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-mono font-bold uppercase tracking-wider text-white border border-white/10 bg-white/[0.05]">
            <Calendar className="w-2.5 h-2.5 text-cyan-400" />
            FEATURED
          </span>
        </div>
      </div>
    </section>
  );
}

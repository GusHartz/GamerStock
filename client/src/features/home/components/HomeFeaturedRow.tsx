import { Link } from "wouter";
import { Star, Clock, ArrowRight } from "lucide-react";
import { useTradeCard } from "@/features/trade/TradeCardContext";
import { abbreviateTeam } from "@/utils/abbreviateTeam";
import { getMatchTimeLabel } from "@/utils/upcomingTimeLabel";
import { isPredictEnabled } from "@/lib/featureFlags";
import type { FeaturedEventVM, MarketCardVM } from "../types/home";

const GAME_SHORT: Record<string, string> = {
  lol: "LoL", val: "VAL", cs2: "CS2", dota2: "Dota2", ow2: "OW2",
};

const GAME_COLOR: Record<string, string> = {
  lol:   "#C89B3C", val:   "#FF4655", cs2:   "#E8AE50",
  dota2: "#BF3B3A", ow2:   "#F99E1A",
};

interface FeaturedCardProps {
  event:            FeaturedEventVM;
  marketsByEventId?: Map<number, MarketCardVM>;
}

function FeaturedCard({ event, marketsByEventId }: FeaturedCardProps) {
  const { open } = useTradeCard();

  const hasTeams = !!(event.teamAName && event.teamBName);
  const title    = hasTeams
    ? `${event.teamAName} vs ${event.teamBName}`
    : event.eventName ?? event.tournamentName ?? "Event";
  const gameColor = GAME_COLOR[event.game] ?? "#06B6D4";
  const gameLabel = GAME_SHORT[event.game] ?? event.game?.toUpperCase() ?? "";

  // Priority: market carried directly on the VM (editorial-resolved) → fallback map
  const firstMarket = event.market ?? marketsByEventId?.get(event.eventId) ?? null;
  // hasTrade is gated on the feature flag: when Predict is off, cards render
  // without trade actions and without navigation to Predict routes.
  const hasTrade    = isPredictEnabled() && firstMarket != null && (firstMarket.yesId != null || firstMarket.noId != null);

  const sideAId    = firstMarket?.yesId ?? null;
  const sideBId    = firstMarket?.noId ?? null;
  const sideALabel = hasTeams ? (event.teamAName ?? "YES") : "YES";
  const sideBLabel = hasTeams ? (event.teamBName ?? "NO")  : "NO";
  const sideAAbbrev = abbreviateTeam(sideALabel) || sideALabel.slice(0, 3).toUpperCase();
  const sideBAbbrev = abbreviateTeam(sideBLabel) || sideBLabel.slice(0, 3).toUpperCase();

  const href = event.firstMarketSlug
    ? `/predictions/markets/${event.firstMarketSlug}`
    : `/predictions?event=${event.eventId}`;

  const bgStyle: React.CSSProperties = event.imageUrl
    ? { backgroundImage: `url(${event.imageUrl})`, backgroundSize: "cover", backgroundPosition: "center 20%" }
    : { background: "linear-gradient(135deg, #060B18 0%, #080F1E 60%, #060A14 100%)" };

  function openSide(which: "A" | "B", e?: React.MouseEvent) {
    if (!firstMarket) return;
    e?.stopPropagation();
    if (which === "A") {
      if (!sideAId) return;
      open({ type: "prediction", marketId: firstMarket.marketId, sideId: sideAId, sideLabel: sideALabel, price: firstMarket.yesPrice != null ? String(firstMarket.yesPrice) : "0.5", action: "BUY", question: firstMarket.question, sideColor: "cyan" });
    } else {
      if (!sideBId) return;
      open({ type: "prediction", marketId: firstMarket.marketId, sideId: sideBId, sideLabel: sideBLabel, price: firstMarket.noPrice != null ? String(firstMarket.noPrice) : "0.5", action: "BUY", question: firstMarket.question, sideColor: "rose" });
    }
  }

  function handleClick() {
    if (!hasTrade || !firstMarket) return;
    if (sideAId) openSide("A"); else openSide("B");
  }

  const cardContent = (
    <div
      className="relative w-full rounded-xl overflow-hidden border border-white/[0.06] hover:border-white/[0.12] transition-all duration-200"
      style={{ ...bgStyle, minHeight: "160px", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 8px 24px -8px rgba(0,0,0,0.9)" }}
    >
      {/* Overlay */}
      <div className="absolute inset-0 pointer-events-none">
        {event.imageUrl
          ? <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/65 to-black/30" />
          : <div className="absolute -top-8 -left-8 w-[200px] h-[120px] rounded-full blur-[50px]" style={{ background: `${gameColor}22` }} />
        }
        <div className="absolute bottom-0 inset-x-0 h-20 bg-gradient-to-t from-black/90 to-transparent" />
      </div>

      {/* Game badge */}
      <div className="absolute top-3 left-3 z-10">
        <span
          className="inline-flex items-center gap-1 px-1.5 py-[3px] rounded text-[9px] font-mono font-bold uppercase tracking-wider border"
          style={{ color: gameColor, borderColor: `${gameColor}40`, background: `${gameColor}15` }}
        >
          <span className="w-1 h-1 rounded-full" style={{ background: gameColor }} />
          {gameLabel}
        </span>
      </div>

      {/* Curation label */}
      {event.curationLabel && (
        <div className="absolute top-3 right-3 z-10">
          <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-wider">{event.curationLabel}</span>
        </div>
      )}

      {/* Content */}
      <div className="absolute inset-x-0 bottom-0 z-10 px-3.5 pb-3 pt-6">
        <p
          data-testid={`text-featured-title-${event.eventId}`}
          className="text-[14px] font-black text-white leading-tight"
        >
          {title}
        </p>

        {/* Start time — always visible */}
        <div
          data-testid={`text-featured-time-${event.eventId}`}
          className="flex items-center gap-1 mt-1 text-[10px] font-mono text-zinc-500"
        >
          <Clock className="w-2.5 h-2.5 shrink-0" />
          <span>{getMatchTimeLabel(event.startsAt)}</span>
        </div>

        {hasTrade && firstMarket ? (
          /* Live market side options */
          <div className="flex items-center gap-2 mt-2">
            <div
              onClick={sideAId ? (e) => openSide("A", e) : undefined}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-cyan-700/35 bg-cyan-950/50 transition-all duration-100 ${sideAId ? "cursor-pointer hover:bg-cyan-950/80 hover:border-cyan-600/55 active:scale-[0.97]" : ""}`}
            >
              <span className="text-[11px] font-mono font-black text-cyan-300">{sideAAbbrev}</span>
              <span className="text-[11px] font-mono text-cyan-400/80">
                {firstMarket.yesPrice != null ? `${(firstMarket.yesPrice * 100).toFixed(0)}¢` : "—"}
              </span>
            </div>
            <div
              onClick={sideBId ? (e) => openSide("B", e) : undefined}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-rose-800/35 bg-rose-950/50 transition-all duration-100 ${sideBId ? "cursor-pointer hover:bg-rose-950/80 hover:border-rose-700/55 active:scale-[0.97]" : ""}`}
            >
              <span className="text-[11px] font-mono font-black text-rose-400">{sideBAbbrev}</span>
              <span className="text-[11px] font-mono text-rose-400/80">
                {firstMarket.noPrice != null ? `${(firstMarket.noPrice * 100).toFixed(0)}¢` : "—"}
              </span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );

  if (hasTrade) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleClick(); } }}
        data-testid={`featured-card-${event.eventId}`}
        className="cursor-pointer select-none active:scale-[0.99] transition-transform duration-100"
      >
        {cardContent}
      </div>
    );
  }

  // When Predict is disabled, render as a non-interactive div to avoid
  // navigating to Predict routes (/predictions/markets/... or /predictions?event=...).
  if (!isPredictEnabled()) {
    return (
      <div data-testid={`featured-card-${event.eventId}`}>
        {cardContent}
      </div>
    );
  }

  return (
    <Link href={href} data-testid={`featured-card-${event.eventId}`}>
      {cardContent}
    </Link>
  );
}

const FEATURED_LIMIT = 4;

interface HomeFeaturedRowProps {
  events:            FeaturedEventVM[];
  marketsByEventId?: Map<number, MarketCardVM>;
}

export function HomeFeaturedRow({ events, marketsByEventId }: HomeFeaturedRowProps) {
  const visible = events.slice(0, FEATURED_LIMIT);
  if (visible.length === 0) return null;

  return (
    <section data-testid="home-featured-row">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Star className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-[11px] font-bold uppercase tracking-widest text-white/80">Featured</span>
        </div>
        {isPredictEnabled() && (
          <Link
            href="/predictions"
            className="flex items-center gap-1 text-[11px] font-medium text-zinc-500 hover:text-cyan-400 transition-colors"
          >
            Browse all
            <ArrowRight className="w-3 h-3" />
          </Link>
        )}
      </div>

      <div
        data-testid="featured-row-grid"
        className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3"
      >
        {visible.map(ev => (
          <FeaturedCard key={ev.queueId} event={ev} marketsByEventId={marketsByEventId} />
        ))}
      </div>
    </section>
  );
}

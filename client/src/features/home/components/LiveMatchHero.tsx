import { Link } from "wouter";
import { ArrowRight, Activity } from "lucide-react";
import { useTradeCard } from "@/features/trade/TradeCardContext";
import { abbreviateTeam } from "@/utils/abbreviateTeam";
import { MarketTimer } from "@/components/market/MarketTimer";
import { isPredictEnabled } from "@/lib/featureFlags";
import type { MarketCardVM } from "../types/home";

const GAME_SHORT: Record<string, string> = {
  lol: "LoL", val: "VAL", cs2: "CS2", dota2: "Dota2", ow2: "OW2",
  r6: "R6", cod: "COD", "cod-mw": "COD",
};

interface LiveMatchHeroProps {
  market: MarketCardVM;
}

/**
 * LiveMatchHero — large hero card for the first live prediction market.
 * Clicking anywhere on the card opens the trade overlay.
 * No "Trade Market" CTA. No team logos panel. Two large side options.
 */
export function LiveMatchHero({ market }: LiveMatchHeroProps) {
  const { open } = useTradeCard();

  const hasTeams   = !!(market.teamAName && market.teamBName);
  const sideAId    = market.yesId;
  const sideBId    = market.noId;
  const sideALabel = hasTeams ? market.teamAName! : "YES";
  const sideBLabel = hasTeams ? market.teamBName! : "NO";
  const sideAAbbrev = abbreviateTeam(sideALabel) || sideALabel.slice(0, 3).toUpperCase();
  const sideBAbbrev = abbreviateTeam(sideBLabel) || sideBLabel.slice(0, 3).toUpperCase();
  // hasTrade is gated on the feature flag: when Predict is off the card
  // renders as a purely visual element with no clickable trade surfaces.
  const hasTrade   = isPredictEnabled() && (sideAId != null || sideBId != null);

  const gameLabel = market.game ? (GAME_SHORT[market.game] ?? market.game.toUpperCase()) : null;
  const metaLine  = [gameLabel, market.tournamentName].filter(Boolean).join(" · ");
  const title     = hasTeams
    ? `${market.teamAName} vs ${market.teamBName}`
    : market.question;

  const bgStyle: React.CSSProperties = market.backgroundImageUrl
    ? { backgroundImage: `url(${market.backgroundImageUrl})`, backgroundSize: "cover", backgroundPosition: "center 20%" }
    : { background: "linear-gradient(135deg, #04080F 0%, #060E1C 40%, #07101E 70%, #050810 100%)" };

  function openSide(which: "A" | "B", e?: React.MouseEvent) {
    e?.stopPropagation();
    if (which === "A") {
      if (!sideAId) return;
      open({ type: "prediction", marketId: market.marketId, sideId: sideAId, sideLabel: sideALabel, price: market.yesPrice != null ? String(market.yesPrice) : "0.5", action: "BUY", question: market.question, sideColor: "cyan" });
    } else {
      if (!sideBId) return;
      open({ type: "prediction", marketId: market.marketId, sideId: sideBId, sideLabel: sideBLabel, price: market.noPrice != null ? String(market.noPrice) : "0.5", action: "BUY", question: market.question, sideColor: "rose" });
    }
  }

  function handleCardClick() {
    if (!hasTrade) return;
    if (sideAId) openSide("A"); else openSide("B");
  }

  return (
    <section className="flex-1 min-w-0" data-testid={`live-match-hero-${market.marketId}`}>
      {/* Section header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-[11px] font-bold uppercase tracking-widest text-white/80">Live Now</span>
        </div>
        {isPredictEnabled() && (
          <Link
            href="/predictions"
            className="flex items-center gap-1 text-[11px] font-medium text-zinc-500 hover:text-cyan-400 transition-colors"
            data-testid="link-live-markets-all"
          >
            All markets
            <ArrowRight className="w-3 h-3" />
          </Link>
        )}
      </div>

      {/* Hero card — click anywhere to open overlay */}
      <div
        role={hasTrade ? "button" : undefined}
        tabIndex={hasTrade ? 0 : undefined}
        onClick={hasTrade ? handleCardClick : undefined}
        onKeyDown={hasTrade ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleCardClick(); } } : undefined}
        className={`
          relative rounded-xl overflow-hidden border border-white/[0.07] select-none
          transition-all duration-150
          ${hasTrade ? "cursor-pointer hover:border-white/[0.13]" : ""}
        `}
        style={{
          ...bgStyle,
          minHeight: "280px",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05), 0 24px 80px -12px rgba(0,0,0,0.95)",
        }}
      >
        {/* Overlays */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {market.backgroundImageUrl
            ? <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/65 to-black/25" />
            : (
              <>
                <div className="absolute -top-20 -left-10 w-[500px] h-[300px] bg-cyan-900/20 rounded-full blur-[80px]" />
                <div className="absolute top-0 right-0 w-[300px] h-[220px] bg-blue-900/15 rounded-full blur-[60px]" />
              </>
            )
          }
          <div
            className="absolute inset-0 opacity-[0.02]"
            style={{
              backgroundImage: "repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(255,255,255,1) 2px,rgba(255,255,255,1) 3px)",
              backgroundSize: "100% 4px",
            }}
          />
          <div className="absolute bottom-0 inset-x-0 h-28 bg-gradient-to-t from-black/80 to-transparent" />
        </div>

        {/* Content */}
        <div className="relative z-10 p-5 sm:p-6 flex flex-col gap-4" style={{ minHeight: "280px" }}>

          {/* Status + meta */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider text-white border border-emerald-600/50 bg-emerald-950/70">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              LIVE
            </span>
            {metaLine && (
              <span className="text-[11px] font-mono text-zinc-500">{metaLine}</span>
            )}
            <div className="ml-auto">
              <MarketTimer status={market.status} closeAt={market.closeAt} className="text-[11px] text-zinc-500 font-mono" />
            </div>
          </div>

          {/* Matchup title */}
          <div className="flex-1">
            <h2
              data-testid={`text-hero-title-${market.marketId}`}
              className="text-[26px] sm:text-[34px] font-black text-white font-display tracking-tight leading-[1.0]"
            >
              {title}
            </h2>
            {hasTeams && market.question && (
              <p className="text-[13px] text-white/45 mt-2 leading-snug line-clamp-1">{market.question}</p>
            )}
          </div>

          {/* ── Two large side option panels ──────────────────────────────── */}
          <div className="flex items-stretch gap-3">
            {/* Side A */}
            <div
              data-testid={`hero-side-a-${market.marketId}`}
              onClick={sideAId ? (e) => openSide("A", e) : undefined}
              className={`flex-1 flex flex-col gap-1 px-4 py-3 rounded-xl border-2 border-cyan-600/40 bg-cyan-950/50 transition-all duration-100 ${sideAId ? "cursor-pointer hover:bg-cyan-950/80 hover:border-cyan-500/55 active:scale-[0.98]" : ""}`}
            >
              <span className="text-[11px] font-mono text-cyan-500/80 uppercase tracking-wider">{sideALabel}</span>
              <div className="flex items-baseline gap-2">
                <span className="text-[22px] font-black font-mono text-cyan-300">{sideAAbbrev}</span>
                <span className="text-[16px] font-bold font-mono text-cyan-400/80">
                  {market.yesPrice != null ? `${(market.yesPrice * 100).toFixed(0)}¢` : "—"}
                </span>
              </div>
            </div>

            {/* Side B */}
            <div
              data-testid={`hero-side-b-${market.marketId}`}
              onClick={sideBId ? (e) => openSide("B", e) : undefined}
              className={`flex-1 flex flex-col gap-1 px-4 py-3 rounded-xl border-2 border-rose-700/40 bg-rose-950/50 transition-all duration-100 ${sideBId ? "cursor-pointer hover:bg-rose-950/80 hover:border-rose-600/55 active:scale-[0.98]" : ""}`}
            >
              <span className="text-[11px] font-mono text-rose-400/80 uppercase tracking-wider">{sideBLabel}</span>
              <div className="flex items-baseline gap-2">
                <span className="text-[22px] font-black font-mono text-rose-400">{sideBAbbrev}</span>
                <span className="text-[16px] font-bold font-mono text-rose-400/80">
                  {market.noPrice != null ? `${(market.noPrice * 100).toFixed(0)}¢` : "—"}
                </span>
              </div>
            </div>
          </div>

          {hasTrade && (
            <p className="text-[10px] font-mono text-zinc-700 text-center">tap a team to trade</p>
          )}
        </div>
      </div>
    </section>
  );
}

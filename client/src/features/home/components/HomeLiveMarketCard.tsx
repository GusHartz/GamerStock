import { Clock } from "lucide-react";
import { useTradeCard } from "@/features/trade/TradeCardContext";
import { abbreviateTeam } from "@/utils/abbreviateTeam";
import { MarketTimer } from "@/components/market/MarketTimer";
import { getMatchTimeLabel } from "@/utils/upcomingTimeLabel";
import type { MarketCardVM } from "../types/home";

/**
 * HomeLiveMarketCard — click anywhere to open trade overlay.
 * Displays matchup title + two prominent side options.
 * No navigation, no "Trade Market" CTA.
 */
export function HomeLiveMarketCard({ market }: { market: MarketCardVM }) {
  const { open } = useTradeCard();

  const hasTeams   = !!(market.teamAName && market.teamBName);
  const sideAId    = market.yesId;
  const sideBId    = market.noId;
  const sideALabel = hasTeams ? market.teamAName! : "YES";
  const sideBLabel = hasTeams ? market.teamBName! : "NO";
  const sideAAbbrev = abbreviateTeam(sideALabel) || sideALabel.slice(0, 3).toUpperCase();
  const sideBAbbrev = abbreviateTeam(sideBLabel) || sideBLabel.slice(0, 3).toUpperCase();
  const hasTrade   = sideAId != null || sideBId != null;

  const gameShort: Record<string, string> = {
    lol: "LoL", val: "VAL", cs2: "CS2", dota2: "Dota2", ow2: "OW2",
    r6: "R6", cod: "COD", "cod-mw": "COD",
  };
  const gameLabel = market.game ? (gameShort[market.game] ?? market.game.toUpperCase()) : null;
  const metaLine  = [gameLabel, market.tournamentName].filter(Boolean).join(" · ");
  const title     = hasTeams
    ? `${market.teamAName} vs ${market.teamBName}`
    : market.question;

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

  function handleClick() {
    if (!hasTrade) return;
    if (sideAId) openSide("A"); else openSide("B");
  }

  return (
    <div
      role={hasTrade ? "button" : undefined}
      tabIndex={hasTrade ? 0 : undefined}
      onClick={hasTrade ? handleClick : undefined}
      onKeyDown={hasTrade ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleClick(); } } : undefined}
      data-testid={`home-live-market-card-${market.marketId}`}
      className={`
        flex flex-col rounded-xl border border-white/[0.07] bg-[#07090F] overflow-hidden
        transition-all duration-150 select-none h-full
        ${hasTrade ? "cursor-pointer hover:border-white/[0.14] hover:bg-[#090C14] active:scale-[0.99]" : ""}
      `}
      style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 4px 20px -4px rgba(0,0,0,0.8)" }}
    >
      {/* ── Meta bar ────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 px-3.5 pt-3 pb-2">
        <span className="text-[10px] font-mono text-zinc-600 truncate flex-1">{metaLine || "Prediction"}</span>
        {market.status === "open" && (
          <span className="flex-none flex items-center gap-1 text-[9px] font-mono font-bold text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            LIVE
          </span>
        )}
        {market.status === "locked" && (
          <span className="flex-none text-[9px] font-mono font-bold text-amber-400">LOCKED</span>
        )}
      </div>

      {/* ── Matchup title ────────────────────────────────────────────────── */}
      <div className="px-3.5 pb-2.5 flex-1">
        <p
          data-testid={`text-live-market-title-${market.marketId}`}
          className="text-[14px] font-bold text-white leading-tight line-clamp-2"
        >
          {title}
        </p>
        <div className="mt-1.5 flex items-center gap-2.5 text-[10px] font-mono text-zinc-500">
          <span className="flex items-center gap-1">
            <Clock className="w-2.5 h-2.5 shrink-0" />
            <span data-testid={`text-live-market-time-${market.marketId}`}>
              {getMatchTimeLabel(market.startsAt)}
            </span>
          </span>
          <MarketTimer status={market.status} closeAt={market.closeAt} className="text-[10px] text-zinc-600" />
        </div>
      </div>

      {/* ── Side options ─────────────────────────────────────────────────── */}
      <div className="px-3 pb-3 flex items-center gap-2">
        <div
          data-testid={`side-a-live-${market.marketId}`}
          onClick={sideAId ? (e) => openSide("A", e) : undefined}
          className={`flex-1 flex items-center justify-between px-3 py-2.5 rounded-lg border border-cyan-700/35 bg-cyan-950/40 transition-all duration-100 ${sideAId ? "cursor-pointer hover:bg-cyan-950/75 hover:border-cyan-600/55 active:scale-[0.97]" : ""}`}
          style={{ minHeight: "44px" }}
        >
          <span className="text-[13px] font-mono font-black text-cyan-300">{sideAAbbrev}</span>
          <span className="text-[13px] font-mono font-bold text-cyan-400/80">
            {market.yesPrice != null ? `${(market.yesPrice * 100).toFixed(0)}¢` : "—"}
          </span>
        </div>
        <div
          data-testid={`side-b-live-${market.marketId}`}
          onClick={sideBId ? (e) => openSide("B", e) : undefined}
          className={`flex-1 flex items-center justify-between px-3 py-2.5 rounded-lg border border-rose-800/35 bg-rose-950/40 transition-all duration-100 ${sideBId ? "cursor-pointer hover:bg-rose-950/75 hover:border-rose-700/55 active:scale-[0.97]" : ""}`}
          style={{ minHeight: "44px" }}
        >
          <span className="text-[13px] font-mono font-black text-rose-400">{sideBAbbrev}</span>
          <span className="text-[13px] font-mono font-bold text-rose-400/80">
            {market.noPrice != null ? `${(market.noPrice * 100).toFixed(0)}¢` : "—"}
          </span>
        </div>
      </div>
    </div>
  );
}

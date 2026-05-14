import { useTradeCard } from "@/features/trade/TradeCardContext";
import { abbreviateTeam } from "@/utils/abbreviateTeam";
import { MarketTimer } from "./MarketTimer";
import type { MarketCardVM } from "@/features/home/types/home";

interface PredictionCardProps {
  market:     MarketCardVM;
  className?: string;
}

const GAME_LABEL: Record<string, string> = {
  lol: "LOL", val: "VAL", valorant: "VAL", cs2: "CS2",
  dota2: "DOTA2", ow2: "OW2", r6: "R6", cod: "COD", "cod-mw": "COD", kog: "KOG",
};

const GAME_COLOR: Record<string, string> = {
  lol:      "text-cyan-400 border-cyan-500/25 bg-cyan-950/40",
  val:      "text-red-400 border-red-500/25 bg-red-950/40",
  valorant: "text-red-400 border-red-500/25 bg-red-950/40",
  cs2:      "text-amber-400 border-amber-500/25 bg-amber-950/40",
  dota2:    "text-red-500 border-red-600/25 bg-red-950/40",
  ow2:      "text-orange-400 border-orange-500/25 bg-orange-950/40",
  r6:       "text-blue-400 border-blue-500/25 bg-blue-950/40",
  cod:      "text-green-400 border-green-500/25 bg-green-950/40",
  "cod-mw": "text-green-400 border-green-500/25 bg-green-950/40",
  kog:      "text-violet-400 border-violet-500/25 bg-violet-950/40",
};

export function PredictionCard({ market, className }: PredictionCardProps) {
  const { open } = useTradeCard();

  const hasTeams  = !!(market.teamAName && market.teamBName);
  const sideAId   = market.yesId;
  const sideBId   = market.noId;
  const sideALabel = hasTeams ? market.teamAName! : "YES";
  const sideBLabel = hasTeams ? market.teamBName! : "NO";
  const sideAAbbrev = abbreviateTeam(sideALabel) || sideALabel.slice(0, 3).toUpperCase();
  const sideBAbbrev = abbreviateTeam(sideBLabel) || sideBLabel.slice(0, 3).toUpperCase();
  const hasTrade  = sideAId != null || sideBId != null;

  const gameKey   = market.game?.toLowerCase() ?? null;
  const gameLabel = gameKey ? (GAME_LABEL[gameKey] ?? gameKey.toUpperCase()) : null;
  const gameColor = gameKey ? (GAME_COLOR[gameKey] ?? "text-zinc-400 border-zinc-700/40 bg-zinc-900/40") : null;
  const tournament = market.tournamentName ?? market.eventName ?? null;
  const title = hasTeams
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

  function handleCardClick() {
    if (!hasTrade) return;
    // Background click — default to whichever side exists first
    if (sideAId) openSide("A"); else openSide("B");
  }

  return (
    <div
      role={hasTrade ? "button" : undefined}
      tabIndex={hasTrade ? 0 : undefined}
      onClick={hasTrade ? handleCardClick : undefined}
      onKeyDown={hasTrade ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleCardClick(); } } : undefined}
      data-testid={`prediction-card-${market.marketId}`}
      className={`
        flex flex-col rounded-xl border border-white/[0.07] bg-[#07090F] overflow-hidden
        transition-all duration-150 select-none
        ${hasTrade ? "cursor-pointer hover:border-white/[0.14] hover:bg-[#090C14] active:scale-[0.99]" : ""}
        ${className ?? ""}
      `}
      style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 4px 16px -4px rgba(0,0,0,0.8)" }}
    >
      {/* ── Meta bar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 px-3.5 pt-3 pb-2.5">
        <div className="flex items-center gap-1.5 min-w-0">
          {gameLabel && gameColor && (
            <span className={`inline-flex items-center px-1.5 py-[2px] rounded border text-[9px] font-mono font-bold tracking-wider flex-none ${gameColor}`}>
              {gameLabel}
            </span>
          )}
          {tournament && (
            <span className="text-[10px] font-mono text-zinc-600 truncate">{tournament}</span>
          )}
        </div>
        {/* Status indicator */}
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

      {/* ── Matchup title + context ──────────────────────────────────────── */}
      <div className="px-3.5 pb-3">
        <p
          data-testid={`text-question-${market.marketId}`}
          className="text-[14px] font-bold text-white leading-tight line-clamp-2"
        >
          {title}
        </p>
        <div className="flex items-center gap-1.5 mt-1.5 text-[10px] font-mono text-zinc-600">
          <MarketTimer status={market.status} closeAt={market.closeAt} className="text-[10px] text-zinc-600" />
        </div>
      </div>

      {/* ── Side options ─────────────────────────────────────────────────── */}
      <div className="px-3 pb-3 flex items-center gap-2">
        {/* Side A */}
        <div
          data-testid={`side-a-${market.marketId}`}
          onClick={sideAId ? (e) => openSide("A", e) : undefined}
          className={`flex-1 flex items-center justify-between px-3 py-2.5 rounded-lg border border-cyan-700/35 bg-cyan-950/40 transition-all duration-100 ${sideAId ? "cursor-pointer hover:bg-cyan-950/75 hover:border-cyan-600/55 active:scale-[0.97]" : ""}`}
          style={{ minHeight: "44px" }}
        >
          <span className="text-[13px] font-mono font-black text-cyan-300">{sideAAbbrev}</span>
          <span className="text-[13px] font-mono font-bold text-cyan-400/80">
            {market.yesPrice != null ? `${(market.yesPrice * 100).toFixed(0)}¢` : "—"}
          </span>
        </div>

        {/* Side B */}
        <div
          data-testid={`side-b-${market.marketId}`}
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

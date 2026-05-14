import { Link } from "wouter";
import type { HotPlayerVM } from "../types/home";

interface HomeHotPlayerCardProps {
  player: HotPlayerVM;
}

export function HomeHotPlayerCard({ player }: HomeHotPlayerCardProps) {
  const isPositive = player.change24h >= 0;
  const changeStr  = `${isPositive ? "+" : ""}${player.change24h.toFixed(1)}%`;
  const changeClass = isPositive
    ? "text-emerald-400 bg-emerald-950/70 border-emerald-800/50"
    : "text-rose-400 bg-rose-950/70 border-rose-800/50";

  const bgStyle = player.imageUrl
    ? { backgroundImage: `url(${player.imageUrl})`, backgroundSize: "cover", backgroundPosition: "center top" }
    : { background: player.bgGradient ?? "linear-gradient(160deg, #071525 0%, #040D18 100%)" };

  const abbrev = player.name.slice(0, 4).toUpperCase();

  return (
    <Link
      href={`/player/${player.slug}`}
      data-testid={`hot-player-card-${player.id}`}
    >
      <div
        className="relative w-[158px] flex-none rounded-xl overflow-hidden cursor-pointer group border border-white/[0.06] hover:border-cyan-700/30 transition-all duration-200"
        style={{ height: "192px", ...bgStyle }}
      >
        {/* Atmospheric glow orb — top center */}
        <div className="absolute -top-6 left-1/2 -translate-x-1/2 w-24 h-24 rounded-full blur-[32px] opacity-60 pointer-events-none"
          style={{ background: isPositive ? "rgba(6,182,212,0.25)" : "rgba(244,63,94,0.20)" }} />

        {/* Large faded decorative abbrev — background art */}
        {!player.imageUrl && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none overflow-hidden">
            <span
              className="font-black text-white/[0.04] leading-none font-display select-none"
              style={{ fontSize: "90px", letterSpacing: "-0.04em", marginTop: "-8px" }}
            >
              {abbrev}
            </span>
          </div>
        )}

        {/* Dark overlay — bottom-heavy */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/96 via-black/45 to-transparent pointer-events-none" />

        {/* Scan-line texture */}
        <div
          className="absolute inset-0 opacity-[0.025] pointer-events-none"
          style={{ backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(255,255,255,1) 3px, rgba(255,255,255,1) 4px)", backgroundSize: "100% 5px" }}
        />

        {/* Change badge — top right */}
        <div className="absolute top-2.5 right-2.5 z-10">
          <span
            data-testid={`text-player-change-${player.id}`}
            className={`text-[10px] font-mono font-bold px-1.5 py-[3px] rounded border ${changeClass}`}
          >
            {changeStr}
          </span>
        </div>

        {/* Player info — bottom */}
        <div className="absolute bottom-0 inset-x-0 z-10 px-3 pb-3">
          <p
            data-testid={`text-player-name-${player.id}`}
            className="text-[15px] font-black text-white leading-none font-display tracking-tight group-hover:text-cyan-100 transition-colors"
          >
            {player.name}
          </p>
          <p
            data-testid={`text-player-price-${player.id}`}
            className="text-[13px] font-mono font-semibold text-white/75 mt-0.5"
          >
            ${player.price.toFixed(2)}
          </p>
          <p className="text-[10px] font-mono text-zinc-600 mt-0.5">
            {player.volumeLabel}
          </p>
        </div>
      </div>
    </Link>
  );
}

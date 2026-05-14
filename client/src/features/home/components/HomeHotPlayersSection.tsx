import { Users, ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { HomeHotPlayerCard } from "./HomeHotPlayerCard";
import type { HotPlayerVM } from "../types/home";

interface HomeHotPlayersSectionProps {
  players: HotPlayerVM[];
}

export function HomeHotPlayersSection({ players }: HomeHotPlayersSectionProps) {
  return (
    <section data-testid="home-hot-players-section">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Users className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-[11px] font-bold uppercase tracking-widest text-white/80">Hot Players</span>
        </div>
        <Link
          href="/assets"
          className="flex items-center gap-1 text-[11px] font-medium text-zinc-500 hover:text-cyan-400 transition-colors"
        >
          View All
          <ArrowRight className="w-3 h-3" />
        </Link>
      </div>

      {players.length === 0 ? (
        <div className="p-8 text-center rounded-xl border border-white/[0.05] bg-white/[0.02]">
          <Users className="w-5 h-5 text-zinc-700 mx-auto mb-2" />
          <p className="text-sm text-zinc-600">Player data loading…</p>
        </div>
      ) : (
        <div
          data-testid="hot-players-scroll"
          className="flex gap-3 overflow-x-auto pb-2"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          {players.map(p => (
            <HomeHotPlayerCard key={p.id} player={p} />
          ))}
        </div>
      )}
    </section>
  );
}

import { Flame, ArrowUpRight } from "lucide-react";
import { Link } from "wouter";
import { SectionHeader } from "@/components/market/SectionHeader";
import { GlassPanel } from "@/components/market/GlassPanel";

const PLACEHOLDER_PLAYERS = [
  { initials: "DK",  name: "donk",    tag: "+6.8%",  up: true,  gradient: "from-cyan-800 to-cyan-950"    },
  { initials: "JQ",  name: "JohnQt",  tag: "+10.6%", up: true,  gradient: "from-violet-800 to-violet-950" },
  { initials: "JK",  name: "jkaem",   tag: "+9.9%",  up: true,  gradient: "from-emerald-800 to-emerald-950" },
  { initials: "DL",  name: "Doublelift", tag: "+5.2%", up: true, gradient: "from-amber-800 to-amber-950"  },
  { initials: "ZT",  name: "ZETA",    tag: "+99%",   up: true,  gradient: "from-rose-800 to-rose-950"     },
];

export function HotPlayersSection() {
  return (
    <section data-testid="hot-players-section">
      <SectionHeader
        title="Hot Players"
        icon={<Flame className="w-4 h-4" />}
        viewAllHref="/assets"
        viewAllLabel="View All"
      />

      <GlassPanel className="p-4">
        {/* Placeholder player cards row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mb-4">
          {PLACEHOLDER_PLAYERS.map((p, i) => (
            <div
              key={i}
              data-testid={`skeleton-player-avatar-${i}`}
              className="flex flex-col items-center gap-2 p-3 rounded-lg bg-white/[0.03] border border-white/[0.05] hover:border-white/[0.09] transition-colors cursor-default"
            >
              <div className={`w-12 h-12 rounded-full bg-gradient-to-br ${p.gradient} flex items-center justify-center border border-white/[0.08]`}>
                <span className="text-[12px] font-black text-white">{p.initials}</span>
              </div>
              <p className="text-[11px] font-semibold text-white/80 truncate w-full text-center">{p.name}</p>
              <span className={`text-[10px] font-mono font-bold ${p.up ? "text-emerald-400" : "text-rose-400"}`}>
                {p.tag}
              </span>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-white/[0.04]">
          <p className="text-[11px] text-zinc-600">Player discovery calibrating — live signals coming soon</p>
          <Link
            href="/assets"
            className="flex items-center gap-1 text-[11px] font-semibold text-cyan-400 hover:text-cyan-300 transition-colors"
          >
            Browse players
            <ArrowUpRight className="w-3 h-3" />
          </Link>
        </div>
      </GlassPanel>
    </section>
  );
}

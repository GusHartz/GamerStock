import { BarChart3, TrendingUp, TrendingDown } from "lucide-react";
import { GlassPanel } from "@/components/market/GlassPanel";

const PLACEHOLDER_MOVERS = [
  { initials: "LF",  name: "Leaf",    team: "EEL",   change: "+21.2%", delta: "+$1.18K", dir: "up"   },
  { initials: "BR",  name: "Brolan",  team: "EEI",   change: "+16.1%", delta: "+$8.5K",  dir: "up"   },
  { initials: "D9",  name: "donk",    team: "SPIRIT", change: "+6.8%",  delta: "+$1.3K",  dir: "up"   },
  { initials: "JQ",  name: "JohnQt",  team: "MGAEI", change: "-4.2%",  delta: "-$0.9K",  dir: "down" },
];

const COLOR_MAP = [
  "from-cyan-700 to-cyan-900",
  "from-violet-700 to-violet-900",
  "from-emerald-700 to-emerald-900",
  "from-amber-700 to-amber-900",
];

export function MarketMoversList() {
  return (
    <GlassPanel data-testid="market-movers-list">
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center gap-2 mb-3.5">
          <BarChart3 className="w-3.5 h-3.5 text-zinc-600" />
          <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Market Movers</p>
          <span className="ml-auto text-[9px] font-mono text-zinc-700 bg-white/[0.03] px-1.5 py-[2px] rounded border border-white/[0.04]">
            Indicative
          </span>
        </div>

        <div className="space-y-1.5">
          {PLACEHOLDER_MOVERS.map((m, i) => (
            <div
              key={i}
              data-testid={`market-mover-row-${i}`}
              className="flex items-center gap-3 py-1.5 rounded-lg hover:bg-white/[0.03] px-1 transition-colors cursor-default"
            >
              {/* Avatar */}
              <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${COLOR_MAP[i % COLOR_MAP.length]} flex items-center justify-center flex-none`}>
                <span className="text-[10px] font-black text-white tracking-tight">{m.initials}</span>
              </div>

              {/* Name + team */}
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-semibold text-white/90 leading-none">{m.name}</p>
                <p className="text-[10px] text-zinc-600 font-mono mt-0.5">{m.team}</p>
              </div>

              {/* Change */}
              <div className={`text-right flex-none ${m.dir === "up" ? "text-emerald-400" : "text-rose-400"}`}>
                <div className="flex items-center gap-0.5 justify-end">
                  {m.dir === "up"
                    ? <TrendingUp className="w-3 h-3" />
                    : <TrendingDown className="w-3 h-3" />}
                  <span className="text-[12px] font-bold font-mono">{m.change}</span>
                </div>
                <p className="text-[10px] font-mono text-zinc-600">{m.delta}</p>
              </div>
            </div>
          ))}
        </div>

        <p className="text-[10px] text-zinc-700 mt-3 text-center font-mono">Live player movers — coming soon</p>
      </div>
    </GlassPanel>
  );
}

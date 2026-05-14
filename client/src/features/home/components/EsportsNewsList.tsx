import { Radio, ChevronRight } from "lucide-react";
import { GlassPanel } from "@/components/market/GlassPanel";

const HEADLINES = [
  { id: "1", text: "T1 reaches back-to-back Worlds Finals",         tag: "LoL", time: "2h ago",  impact: "high"   },
  { id: "2", text: "Cloud9 acquires new IGL ahead of Major",        tag: "CS2", time: "4h ago",  impact: "medium" },
  { id: "3", text: "FURIA advances to IEM Cologne semifinals",      tag: "CS2", time: "6h ago",  impact: "high"   },
  { id: "4", text: "Sentinels sign former LOUD entry-fragger",      tag: "VAL", time: "1d ago",  impact: "medium" },
];

const TAG_CONFIG: Record<string, { color: string; bg: string }> = {
  LoL: { color: "text-[#C89B3C]", bg: "bg-[#C89B3C]/10" },
  CS2: { color: "text-[#E8AE50]", bg: "bg-[#E8AE50]/10" },
  VAL: { color: "text-[#FF4655]", bg: "bg-[#FF4655]/10" },
};

const IMPACT_DOT: Record<string, string> = {
  high:   "bg-cyan-400",
  medium: "bg-zinc-600",
  low:    "bg-zinc-700",
};

export function EsportsNewsList() {
  return (
    <GlassPanel data-testid="esports-news-list">
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center gap-2 mb-3.5">
          <Radio className="w-3.5 h-3.5 text-zinc-600" />
          <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Esports News</p>
        </div>

        <div className="space-y-0">
          {HEADLINES.map((h, i) => {
            const cfg = TAG_CONFIG[h.tag] ?? { color: "text-zinc-500", bg: "bg-zinc-800/30" };
            return (
              <div
                key={h.id}
                data-testid={`news-headline-${h.id}`}
                className={`flex items-start gap-3 py-2.5 group cursor-default ${i < HEADLINES.length - 1 ? "border-b border-white/[0.04]" : ""}`}
              >
                <span className={`w-1 h-1 rounded-full flex-none mt-2 ${IMPACT_DOT[h.impact]}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] text-white/75 group-hover:text-white/95 transition-colors leading-snug">
                    {h.text}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-[9px] font-mono font-bold px-1.5 py-[1px] rounded ${cfg.color} ${cfg.bg}`}>
                      {h.tag}
                    </span>
                    <span className="text-[10px] text-zinc-700 font-mono">{h.time}</span>
                  </div>
                </div>
                <ChevronRight className="w-3 h-3 text-zinc-700 flex-none mt-0.5 group-hover:text-zinc-500 transition-colors" />
              </div>
            );
          })}
        </div>
      </div>
    </GlassPanel>
  );
}

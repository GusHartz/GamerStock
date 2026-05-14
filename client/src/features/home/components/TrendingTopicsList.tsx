import { TrendingUp, ChevronRight } from "lucide-react";
import { GlassPanel } from "@/components/market/GlassPanel";

const PLACEHOLDER_TOPICS = [
  { id: "1", text: "NAVI vs FURIA",          sub: "Match in session",           time: "10m ago" },
  { id: "2", text: "donk MVP odds rising",   sub: "Probability shift detected", time: "26m ago" },
  { id: "3", text: "IEM Cologne markets soon", sub: "Markets opening in 2h",    time: "32m ago" },
];

const TOPIC_AVATAR: Record<string, string> = {
  "1": "from-blue-800 to-blue-950",
  "2": "from-cyan-800 to-cyan-950",
  "3": "from-amber-800 to-amber-950",
};

export function TrendingTopicsList() {
  return (
    <GlassPanel data-testid="trending-topics-list">
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center gap-2 mb-3.5">
          <TrendingUp className="w-3.5 h-3.5 text-zinc-600" />
          <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Trending Topics</p>
        </div>

        <div className="space-y-0">
          {PLACEHOLDER_TOPICS.map((t, i) => (
            <div
              key={t.id}
              data-testid={`trending-topic-${t.id}`}
              className={`flex items-center gap-3 py-2.5 group cursor-default ${i < PLACEHOLDER_TOPICS.length - 1 ? "border-b border-white/[0.04]" : ""}`}
            >
              {/* Avatar circle */}
              <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${TOPIC_AVATAR[t.id]} flex items-center justify-center flex-none border border-white/[0.06]`}>
                <TrendingUp className="w-3 h-3 text-white/50" />
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-semibold text-white/85 group-hover:text-white transition-colors leading-none truncate">
                  {t.text}
                </p>
                <p className="text-[10px] text-zinc-600 font-mono mt-0.5">{t.time} · {t.sub}</p>
              </div>

              <ChevronRight className="w-3 h-3 text-zinc-700 flex-none group-hover:text-zinc-400 transition-colors" />
            </div>
          ))}
        </div>
      </div>
    </GlassPanel>
  );
}

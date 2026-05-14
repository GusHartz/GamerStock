import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Zap } from "lucide-react";
import type { HomeApiResponse, PulseMessageVM } from "../types/home";
import { buildPulseMessages } from "../mappers/mapHomeResponseToVM";
import { isPredictEnabled } from "@/lib/featureFlags";

const TYPE_COLOR: Record<PulseMessageVM["type"], string> = {
  live:   "text-emerald-400",
  price:  "text-cyan-400",
  volume: "text-amber-400",
  info:   "text-zinc-500",
};

const TYPE_DOT: Record<PulseMessageVM["type"], string> = {
  live:   "bg-emerald-500",
  price:  "bg-cyan-500",
  volume: "bg-amber-500",
  info:   "bg-zinc-600",
};

function PulseItem({ msg }: { msg: PulseMessageVM }) {
  return (
    <span
      data-testid={`pulse-item-${msg.id}`}
      className="inline-flex items-center gap-2 px-4 select-none"
    >
      <span className={`w-1.5 h-1.5 rounded-full flex-none ${TYPE_DOT[msg.type]}`} />
      <span className={`text-[11px] font-mono whitespace-nowrap ${TYPE_COLOR[msg.type]}`}>
        {msg.text}
      </span>
    </span>
  );
}

/**
 * MarketPulseTicker — self-fetching live market signal strip.
 *
 * Fetches /api/predictions/home via TanStack Query (shared cache).
 * When rendered on the Home page the cache is already warm so no
 * extra request is made. On all other pages it fetches independently.
 *
 * Self-protection: returns null and disables all fetching when
 * VITE_PREDICT_ENABLED=false. This guards against accidental imports
 * even if the parent layout skips rendering this component.
 */
export function MarketPulseTicker() {
  const [paused, setPaused] = useState(false);

  // Always call hooks unconditionally (React rules), but gate the query
  // and the render output on the feature flag.
  const predictEnabled = isPredictEnabled();

  const { data } = useQuery<HomeApiResponse>({
    queryKey:        ["/api/predictions/home"],
    staleTime:       30_000,
    // Do not fetch or poll when Predict is disabled
    enabled:         predictEnabled,
    refetchInterval: predictEnabled ? 60_000 : false,
  });

  // Guard: do not render anything when Predict module is off
  if (!predictEnabled) return null;

  const messages: PulseMessageVM[] = data ? buildPulseMessages(data) : [];

  const displayItems = messages.length > 0
    ? [...messages, ...messages]
    : [{ id: "empty", text: "Loading market signals…", type: "info" as const }];

  const duration = Math.max(20, displayItems.length * 4);

  return (
    <div
      data-testid="market-pulse-ticker"
      className="h-8 w-full bg-black/50 border-b border-white/[0.06] overflow-hidden flex items-center relative"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* Label */}
      <div className="flex-none flex items-center gap-1.5 pl-3 pr-2.5 border-r border-white/[0.08] h-full bg-black/60 z-10">
        <div className="relative flex items-center">
          <span className="absolute w-1.5 h-1.5 rounded-full bg-cyan-500 animate-ping opacity-60" />
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
        </div>
        <Zap className="w-3 h-3 text-cyan-400" />
        <span className="text-[10px] font-mono font-semibold uppercase tracking-widest text-cyan-400">Markets</span>
      </div>

      {/* Scroll track */}
      <div className="flex-1 overflow-hidden relative">
        <div
          className="inline-flex items-center"
          style={{
            animation: paused
              ? `ticker-scroll ${duration}s linear infinite paused`
              : `ticker-scroll ${duration}s linear infinite`,
          }}
        >
          {displayItems.map((msg, i) => (
            <span key={`${msg.id}_${i}`} className="inline-flex items-center">
              <PulseItem msg={msg} />
              <span className="text-zinc-700 text-[10px]" aria-hidden="true">◆</span>
            </span>
          ))}
        </div>
      </div>

      {/* Right fade */}
      <div className="absolute right-0 top-0 h-full w-16 bg-gradient-to-l from-black/70 to-transparent pointer-events-none z-10" />
    </div>
  );
}

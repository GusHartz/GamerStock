import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Radio } from "lucide-react";

interface NewsItem {
  id: string;
  title: string;
  summary: string | null;
  source: string;
  sourceUrl: string;
  game: string | null;
  category: string | null;
  publishedAt: string;
  sentiment?: "bullish" | "neutral" | "bearish";
  impactLevel?: "low" | "medium" | "high";
  eventType?: string;
  entityTags?: { players: string[]; teams: string[]; tournaments: string[] };
}

const GAME_BADGE: Record<string, { label: string; color: string }> = {
  lol:     { label: "LoL",    color: "text-[#C89B3C]" },
  val:     { label: "VAL",    color: "text-[#FF4655]" },
  cs2:     { label: "CS2",    color: "text-[#E8AE50]" },
  dota2:   { label: "Dota2",  color: "text-[#BF3B3A]" },
  fortnite:{ label: "FN",     color: "text-[#00C6E0]" },
  ow2:     { label: "OW2",    color: "text-[#F99E1A]" },
  cod:     { label: "CoD",    color: "text-[#82B541]" },
  rl:      { label: "RL",     color: "text-[#1FBEF2]" },
};

const SENTIMENT_DOT: Record<"bullish" | "neutral" | "bearish", string> = {
  bullish: "bg-emerald-500",
  bearish: "bg-red-500",
  neutral: "bg-zinc-600",
};

function GameBadge({ game }: { game: string | null }) {
  if (!game) return null;
  const badge = GAME_BADGE[game];
  if (!badge) return null;
  return (
    <span className={`font-mono font-semibold text-[10px] tracking-wider ${badge.color} opacity-90`}>
      [{badge.label}]
    </span>
  );
}

function SentimentDot({ sentiment }: { sentiment?: "bullish" | "neutral" | "bearish" }) {
  if (!sentiment || sentiment === "neutral") return null;
  const cls = SENTIMENT_DOT[sentiment];
  return <span className={`inline-block w-1.5 h-1.5 rounded-full flex-none ${cls}`} title={sentiment} />;
}

function TickerItem({ item }: { item: NewsItem }) {
  const hasUrl = item.sourceUrl && item.sourceUrl.startsWith("http");

  const content = (
    <span className="flex items-center gap-2 px-5 select-none group cursor-pointer">
      <SentimentDot sentiment={item.sentiment} />
      <GameBadge game={item.game} />
      <span className="text-[11px] font-medium text-zinc-300 group-hover:text-white transition-colors leading-none whitespace-nowrap max-w-[420px] truncate">
        {item.title}
      </span>
      <span className="text-[10px] text-zinc-600 whitespace-nowrap hidden sm:inline">
        · {item.source}
      </span>
    </span>
  );

  if (hasUrl) {
    return (
      <a
        href={item.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center"
        data-testid={`ticker-item-${item.id}`}
      >
        {content}
      </a>
    );
  }

  return (
    <span
      className="inline-flex items-center"
      data-testid={`ticker-item-${item.id}`}
    >
      {content}
    </span>
  );
}

function TickerSeparator() {
  return (
    <span className="inline-flex items-center px-1 text-zinc-700 text-[10px] select-none" aria-hidden="true">
      ◆
    </span>
  );
}

export function NewsTicker() {
  const [paused, setPaused] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, isError } = useQuery<{ items: NewsItem[]; fromFallback: boolean }>({
    queryKey: ["/api/news/latest"],
    staleTime: 30 * 1000,          // consider fresh for only 30s
    refetchInterval: 60 * 1000,   // refetch every 60 seconds
    refetchIntervalInBackground: true, // keep polling even when tab is unfocused
  });

  const items = data?.items ?? [];

  if (isLoading) {
    return (
      <div className="h-8 w-full bg-black/40 border-b border-white/5 flex items-center px-4">
        <span className="text-[11px] text-zinc-600 font-mono animate-pulse">Loading market pulse...</span>
      </div>
    );
  }

  if (isError || items.length === 0) {
    return (
      <div className="h-8 w-full bg-black/40 border-b border-white/5 flex items-center px-4 gap-3">
        <div className="flex items-center gap-1.5 text-zinc-600">
          <Radio className="w-3 h-3" />
          <span className="text-[10px] font-mono uppercase tracking-widest">Pulse</span>
        </div>
        <span className="text-[11px] text-zinc-700">No live news available right now</span>
      </div>
    );
  }

  const displayItems = [...items, ...items];

  return (
    <div
      className="h-8 w-full bg-black/50 border-b border-white/[0.06] overflow-hidden flex items-center relative"
      data-testid="news-ticker"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* Left label */}
      <div className="flex-none flex items-center gap-1.5 pl-3 pr-2 border-r border-white/10 h-full bg-black/60 z-10">
        <div className="relative flex items-center">
          <span className={`absolute w-1.5 h-1.5 rounded-full ${data?.fromFallback ? "bg-amber-500" : "bg-emerald-500"} animate-ping opacity-75`} />
          <span className={`w-1.5 h-1.5 rounded-full ${data?.fromFallback ? "bg-amber-400" : "bg-emerald-400"}`} />
        </div>
        <span className={`text-[10px] font-mono font-semibold uppercase tracking-widest ${data?.fromFallback ? "text-amber-400" : "text-emerald-400"}`}>
          Pulse
        </span>
      </div>

      {/* Scrolling track */}
      <div className="flex-1 overflow-hidden relative">
        <div
          ref={trackRef}
          className="inline-flex items-center whitespace-nowrap"
          style={{
            animation: paused
              ? "ticker-scroll 60s linear infinite paused"
              : "ticker-scroll 60s linear infinite",
          }}
        >
          {displayItems.map((item, i) => (
            <span key={`${item.id}_${i}`} className="inline-flex items-center">
              <TickerItem item={item} />
              <TickerSeparator />
            </span>
          ))}
        </div>
      </div>

      {/* Right fade gradient */}
      <div className="absolute right-0 top-0 h-full w-16 bg-gradient-to-l from-black/70 to-transparent pointer-events-none z-10" />
    </div>
  );
}

import { useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Target, Gem, Zap, Flame, Star, TrendingUp, TrendingDown, Sparkles, Users, Flag } from "lucide-react";

import { useTerminal, type MarketRow } from "@/state/terminalStore";
import {
  useSynthetic,
  type SyntheticRow,
  synthToMarketRow,
  isSyntheticAsset,
  synthIdFromAsset,
} from "@/state/syntheticContext";
import { formatCurrency } from "@/lib/format";
import portrait0 from "@assets/ChatGPT_Image_10_de_mar._de_2026,_19_17_14_1773181307311.png";
import portrait1 from "@assets/ChatGPT_Image_10_de_mar._de_2026,_19_18_25_1773181312756.png";
import portrait2 from "@assets/ChatGPT_Image_10_de_mar._de_2026,_19_17_33_1773181317033.png";
import portrait3 from "@assets/ChatGPT_Image_10_de_mar._de_2026,_19_17_23_1773181322231.png";

const PORTRAITS = [portrait0, portrait1, portrait2, portrait3];

// ─── Exclusive creator badge ──────────────────────────────────────────────────
// Skid_Row is the pilot creator for the Creator Economy MVP.
// TODO: generalise into a playerBadges map (assetId → badge config) when more
//       special designations are needed.
const PLAYER_ONE_ASSET_ID = 449643;

// ─── Types ────────────────────────────────────────────────────────────────────

type OperatorEnrichment = {
  hasOperatorMode: true;
  followers?: number;
  mission?: {
    title: string;
    description: string | null;
    progressPct: number;
    participantsCount: number;
  };
};

type FeaturedAssetRow = MarketRow & { operatorMode?: OperatorEnrichment; cardImageUrl?: string | null };
type FeaturedResponse = { rows: FeaturedAssetRow[] };

type CategoryKey = "breakout" | "hidden_gem" | "undervalued" | "momentum" | "community_rising";

type FeaturedCard = {
  id: number | string;
  displayName: string;
  role?: string;
  initials: string;
  price: number;
  change: number;
  volume: string;
  category: CategoryKey;
  signal: string;
  row: MarketRow | null;
  operatorMode?: OperatorEnrichment;
  cardImageUrl?: string | null;
};

// ─── Category visual config ───────────────────────────────────────────────────

const CAT: Record<
  CategoryKey,
  {
    badge: string;
    badgeCls: string;
    signalCls: string;
    dotCls: string;
    stripeCls: string;
    borderCls: string;
    hoverBorderCls: string;
    glowShadow: string;
    hoverGlowShadow: string;
    gradientFrom: string;
    icon: React.ReactNode;
    accentColor: string;
    confidenceBase: number;
  }
> = {
  breakout: {
    badge: "Breakout",
    badgeCls: "bg-amber-500/20 border border-amber-400/40 text-amber-300",
    signalCls: "text-amber-400",
    dotCls: "bg-amber-400",
    stripeCls: "bg-gradient-to-r from-amber-400 to-orange-400",
    borderCls: "border-amber-500/20",
    hoverBorderCls: "group-hover:border-amber-400/50",
    glowShadow: "shadow-[0_0_0_1px_rgba(245,158,11,0.12),0_8px_24px_rgba(245,158,11,0.08)]",
    hoverGlowShadow: "group-hover:shadow-[0_0_0_1px_rgba(245,158,11,0.35),0_12px_32px_rgba(245,158,11,0.22)]",
    gradientFrom: "from-amber-950/80",
    icon: <Zap className="w-3.5 h-3.5" />,
    accentColor: "#f59e0b",
    confidenceBase: 74,
  },
  hidden_gem: {
    badge: "Hidden Gem",
    badgeCls: "bg-emerald-500/20 border border-emerald-400/40 text-emerald-300",
    signalCls: "text-emerald-400",
    dotCls: "bg-emerald-400",
    stripeCls: "bg-gradient-to-r from-emerald-400 to-teal-400",
    borderCls: "border-emerald-500/20",
    hoverBorderCls: "group-hover:border-emerald-400/50",
    glowShadow: "shadow-[0_0_0_1px_rgba(16,185,129,0.12),0_8px_24px_rgba(16,185,129,0.08)]",
    hoverGlowShadow: "group-hover:shadow-[0_0_0_1px_rgba(16,185,129,0.35),0_12px_32px_rgba(16,185,129,0.22)]",
    gradientFrom: "from-emerald-950/80",
    icon: <Gem className="w-3.5 h-3.5" />,
    accentColor: "#10b981",
    confidenceBase: 66,
  },
  undervalued: {
    badge: "Undervalued",
    badgeCls: "bg-sky-500/20 border border-sky-400/40 text-sky-300",
    signalCls: "text-sky-400",
    dotCls: "bg-sky-400",
    stripeCls: "bg-gradient-to-r from-sky-400 to-blue-400",
    borderCls: "border-sky-500/20",
    hoverBorderCls: "group-hover:border-sky-400/50",
    glowShadow: "shadow-[0_0_0_1px_rgba(14,165,233,0.12),0_8px_24px_rgba(14,165,233,0.08)]",
    hoverGlowShadow: "group-hover:shadow-[0_0_0_1px_rgba(14,165,233,0.35),0_12px_32px_rgba(14,165,233,0.22)]",
    gradientFrom: "from-sky-950/80",
    icon: <Target className="w-3.5 h-3.5" />,
    accentColor: "#0ea5e9",
    confidenceBase: 70,
  },
  momentum: {
    badge: "Momentum",
    badgeCls: "bg-violet-500/20 border border-violet-400/40 text-violet-300",
    signalCls: "text-violet-400",
    dotCls: "bg-violet-400",
    stripeCls: "bg-gradient-to-r from-violet-400 to-purple-400",
    borderCls: "border-violet-500/20",
    hoverBorderCls: "group-hover:border-violet-400/50",
    glowShadow: "shadow-[0_0_0_1px_rgba(139,92,246,0.12),0_8px_24px_rgba(139,92,246,0.08)]",
    hoverGlowShadow: "group-hover:shadow-[0_0_0_1px_rgba(139,92,246,0.35),0_12px_32px_rgba(139,92,246,0.22)]",
    gradientFrom: "from-violet-950/80",
    icon: <Flame className="w-3.5 h-3.5" />,
    accentColor: "#8b5cf6",
    confidenceBase: 79,
  },
  community_rising: {
    badge: "Rising",
    badgeCls: "bg-pink-500/20 border border-pink-400/40 text-pink-300",
    signalCls: "text-pink-400",
    dotCls: "bg-pink-400",
    stripeCls: "bg-gradient-to-r from-pink-400 to-rose-400",
    borderCls: "border-pink-500/20",
    hoverBorderCls: "group-hover:border-pink-400/50",
    glowShadow: "shadow-[0_0_0_1px_rgba(236,72,153,0.12),0_8px_24px_rgba(236,72,153,0.08)]",
    hoverGlowShadow: "group-hover:shadow-[0_0_0_1px_rgba(236,72,153,0.35),0_12px_32px_rgba(236,72,153,0.22)]",
    gradientFrom: "from-pink-950/80",
    icon: <Star className="w-3.5 h-3.5" />,
    accentColor: "#ec4899",
    confidenceBase: 61,
  },
};

// ─── Role / Utilities ─────────────────────────────────────────────────────────

const ROLE_LABEL: Record<string, string> = {
  TOP: "Top",
  JGL: "Jungle",
  JUNGLE: "Jungle",
  MID: "Mid",
  ADC: "ADC",
  SUPPORT: "Support",
};

function toInitials(name: string): string {
  const base = name.split("#")[0];
  const parts = base.trim().split(/(?=[A-Z])|[\s_-]/).filter(Boolean);
  if (parts.length === 1) return base.slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function pct24h(row: MarketRow): number {
  const last = parseFloat(row.lastTradePrice);
  const ago = parseFloat(row.price24hAgo);
  if (!ago || ago === 0) return 0;
  return ((last - ago) / ago) * 100;
}

function compactSignal(cat: CategoryKey, change: number, volume?: string): string {
  switch (cat) {
    case "breakout":      return change > 15 ? "Surge detected" : change > 7 ? "Price acceleration" : "Breakout setup";
    case "hidden_gem":    return "Low exposure";
    case "undervalued":   return "Fair value gap";
    case "momentum":      return "Strong momentum";
    case "community_rising": return volume ? "Top volume" : "Rising volume";
  }
}

function computeConfidence(category: CategoryKey, change: number): number {
  const base = CAT[category].confidenceBase;
  const boost = Math.min(15, Math.abs(change) * 0.6);
  return Math.min(95, Math.round(base + boost));
}

function formatVolume(vol: string): string {
  const n = parseFloat(vol);
  if (isNaN(n)) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(Math.round(n));
}

// ─── Confidence Bar ───────────────────────────────────────────────────────────

function OpportunityConfidenceBar({ score, color }: { score: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[9px] text-white/35 font-mono uppercase tracking-wider whitespace-nowrap">Conf.</span>
      <div className="flex-1 h-[3px] rounded-full bg-white/[0.07] overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${score}%`, backgroundColor: color, opacity: 0.8 }}
        />
      </div>
      <span className="text-[10px] font-mono font-bold tabular-nums w-8 text-right" style={{ color }}>
        {score}%
      </span>
    </div>
  );
}

// ─── Signal Badge ─────────────────────────────────────────────────────────────

function OpportunitySignalBadge({ cat }: { cat: typeof CAT[CategoryKey] }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-bold tracking-wide uppercase backdrop-blur-md ${cat.badgeCls}`}
    >
      {cat.icon}
      {cat.badge}
    </span>
  );
}

// ─── Discovery Card ───────────────────────────────────────────────────────────

function DiscoveryCard({
  card,
  cardIndex,
  isSelected,
  onSelect,
}: {
  card: FeaturedCard;
  cardIndex: number;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const cat = CAT[card.category];
  const isPositive = card.change >= 0;
  const roleLabel = card.role ? (ROLE_LABEL[card.role] ?? card.role) : "Player";
  const displayShort = card.displayName.split("#")[0];
  const confidence = computeConfidence(card.category, card.change);
  const volStr = formatVolume(card.volume);

  const handleClick = useCallback(() => {
    if (typeof window !== "undefined" && (window as any).__gsTrack) {
      (window as any).__gsTrack("featured_card_click", {
        playerId: card.id,
        signalType: card.category,
        price: card.price,
        cardPosition: cardIndex,
        section: "featured_opportunities",
      });
    }
    onSelect();
  }, [card, cardIndex, onSelect]);

  return (
    <button
      onClick={handleClick}
      data-testid={`featured-card-${card.id}`}
      className={[
        "group relative flex flex-col rounded-xl overflow-hidden text-left cursor-pointer",
        "border transition-all duration-250 ease-out",
        "hover:-translate-y-1.5 active:scale-[0.98]",
        cat.glowShadow,
        cat.hoverGlowShadow,
        isSelected ? "border-white/30" : `${cat.borderCls} ${cat.hoverBorderCls}`,
        "min-w-[230px] flex-1",
      ].join(" ")}
      style={{ background: "linear-gradient(180deg,#0d1117 0%,#0a0d13 100%)" }}
    >
      {/* ── Hero Image Zone ~65% of card ── */}
      <div className="relative h-[230px] shrink-0 overflow-hidden bg-[#080c13]">
        <img
          src={card.cardImageUrl ?? PORTRAITS[cardIndex % 4]}
          alt={displayShort}
          className="absolute inset-0 w-full h-full object-cover object-top select-none transition-transform duration-350 group-hover:scale-[1.04]"
          draggable={false}
          loading="eager"
        />

        {/* Gradient overlays */}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/35 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/30 to-transparent" />

        {/* Signal accent stripe at top */}
        <div className={`absolute top-0 inset-x-0 h-[2px] ${cat.stripeCls}`} />

        {/* AI Signal Badge + optional exclusive badge — top left, stacked */}
        <div className="absolute top-3.5 left-3.5 flex flex-col gap-1.5">
          <OpportunitySignalBadge cat={cat} />

          {/* PLAYER ONE — exclusive badge, only rendered for Skid_Row */}
          {card.id === PLAYER_ONE_ASSET_ID && (
            <span className="inline-flex items-center gap-1 self-start px-1.5 py-[3px] rounded text-[9px] font-black tracking-[0.14em] uppercase bg-amber-950/70 border border-amber-400/50 text-amber-300 backdrop-blur-md shadow-[0_0_10px_rgba(251,191,36,0.18)]">
              <Star className="w-2.5 h-2.5 fill-amber-400 text-amber-400 shrink-0" />
              Player One
            </span>
          )}
        </div>

        {/* 24h change — top right */}
        <div className="absolute top-3.5 right-3.5">
          <span
            className={`inline-flex items-center gap-0.5 text-[11px] font-mono font-bold tabular-nums px-2 py-0.5 rounded-md bg-black/50 backdrop-blur-md border border-white/[0.06] ${
              isPositive ? "text-emerald-300" : "text-rose-300"
            }`}
          >
            {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {isPositive ? "+" : ""}{card.change.toFixed(2)}%
          </span>
        </div>

        {/* Player name + role pinned to bottom */}
        <div className="absolute bottom-0 inset-x-0 px-4 pb-3">
          <div
            className={`text-[15px] font-bold leading-tight truncate transition-colors ${
              isSelected ? "text-primary" : "text-white"
            }`}
          >
            {displayShort}
          </div>
          <div className="text-[10px] text-white/40 leading-none mt-0.5 font-medium tracking-wide">
            {roleLabel} · NA1
          </div>
        </div>
      </div>

      {/* ── Content Zone ── */}
      <div
        className={`flex flex-col gap-2.5 px-4 py-3.5 flex-1 transition-colors ${
          isSelected ? "bg-white/[0.04]" : "bg-transparent group-hover:bg-white/[0.03]"
        }`}
      >
        {/* ── Variant: Standard ── */}
        {!card.operatorMode && (
          <>
            {/* Price + Trade badge row */}
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="text-[18px] font-mono font-bold text-foreground tabular-nums block leading-none">
                  {formatCurrency(card.price)}
                </span>
                <span className={`text-[9px] font-medium ${cat.signalCls} opacity-80 mt-0.5 block`}>
                  {card.signal}
                </span>
              </div>
              <span
                className={`shrink-0 mt-0.5 text-[9px] font-mono uppercase tracking-wider px-2 py-1 rounded-md border ${
                  isSelected
                    ? "border-primary/30 text-primary bg-primary/10"
                    : "border-white/[0.06] text-white/30 group-hover:text-white/60 group-hover:border-white/[0.12]"
                } transition-colors`}
              >
                {isSelected ? "Selected" : "Trade"}
              </span>
            </div>
            <OpportunityConfidenceBar score={confidence} color={cat.accentColor} />
          </>
        )}

        {/* ── Variant: Enriched (Creator Economy) ── */}
        {card.operatorMode && (
          <>
            {/* 1. Supporters — prominent, first element */}
            <div className="flex items-center gap-1.5">
              <Users className="w-3 h-3 shrink-0 text-white/35" />
              <span className="text-[11px] font-semibold text-white/55">
                {(card.operatorMode.followers ?? 0).toLocaleString()} supporters
              </span>
            </div>

            {/* 2. Mission */}
            {card.operatorMode.mission ? (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-1.5">
                  <Flag className="w-2.5 h-2.5 shrink-0 text-white/25" />
                  <span className="text-[9px] text-white/40 truncate leading-none">
                    {card.operatorMode.mission.title}
                  </span>
                  <span className="ml-auto text-[9px] font-mono tabular-nums" style={{ color: cat.accentColor }}>
                    {Math.round(card.operatorMode.mission.progressPct)}%
                  </span>
                </div>
                <div className="h-[2px] rounded-full bg-white/[0.07] overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(100, card.operatorMode.mission.progressPct)}%`,
                      backgroundColor: cat.accentColor,
                      opacity: 0.75,
                    }}
                  />
                </div>
              </div>
            ) : (
              <OpportunityConfidenceBar score={confidence} color={cat.accentColor} />
            )}

            {/* 3. Price */}
            <div>
              <span className="text-[18px] font-mono font-bold text-foreground tabular-nums block leading-none">
                {formatCurrency(card.price)}
              </span>
            </div>
          </>
        )}

        {/* Volume row — shared, no "Creator" label for enriched cards */}
        <div className="flex items-center gap-1.5 border-t border-white/[0.05] pt-2">
          <span className="text-[9px] text-white/25 font-mono uppercase tracking-wider">Vol</span>
          <span className={`text-[10px] font-mono font-semibold tabular-nums ${isPositive ? "text-emerald-400/65" : "text-rose-400/65"}`}>
            {isPositive ? "▲" : "▼"} {volStr}
          </span>
          <div className="flex-1" />
          {!card.operatorMode && (
            <span className={`w-1.5 h-1.5 rounded-full ${cat.dotCls} opacity-60`} />
          )}
        </div>
      </div>
    </button>
  );
}

// ─── Scoring functions (synthetic) ───────────────────────────────────────────

function scoreBreakout(r: SyntheticRow): number {
  if (r.change24h <= 0) return -Infinity;
  const mom = parseFloat(r.momentum);
  if (mom <= 0) return -Infinity;
  const boost = r.signal.includes("BUY") ? 1.3 : 0.9;
  return r.change24h * mom * boost * (r.pviScore / 100);
}

function scoreHiddenGem(r: SyntheticRow): number {
  if (r.pviScore < 55 || r.divergencePct > -15) return -Infinity;
  const volPenalty = Math.log10(Math.max(1, parseFloat(r.volume24h)));
  return (Math.abs(r.divergencePct) * (r.pviScore / 100)) / volPenalty;
}

function scoreUndervalued(r: SyntheticRow): number {
  if (r.divergencePct > -20 || r.pviScore < 52) return -Infinity;
  if (!r.signal.includes("BUY")) return -Infinity;
  return Math.abs(r.divergencePct) * (r.pviScore / 100);
}

function scoreMomentum(r: SyntheticRow): number {
  const mom = parseFloat(r.momentum);
  if (mom <= 0) return -Infinity;
  return mom * (r.pviScore / 100) * (r.leaguePoints / 1000);
}

function scoreCommunityRising(r: SyntheticRow): number {
  return parseFloat(r.volume24h);
}

const SYNTH_PRIORITY: Array<{ key: CategoryKey; score: (r: SyntheticRow) => number }> = [
  { key: "breakout",         score: scoreBreakout },
  { key: "hidden_gem",       score: scoreHiddenGem },
  { key: "undervalued",      score: scoreUndervalued },
  { key: "momentum",         score: scoreMomentum },
  { key: "community_rising", score: scoreCommunityRising },
];

const REAL_PRIORITY: Array<{ key: CategoryKey; sort: (r: MarketRow) => number }> = [
  { key: "breakout",         sort: (r) => pct24h(r) },
  { key: "momentum",         sort: (r) => parseFloat(r.momentum) },
  { key: "community_rising", sort: (r) => parseFloat(r.volume24h) },
  { key: "hidden_gem",       sort: (r) => parseFloat(r.volume24h) / Math.max(1, parseFloat(r.lastTradePrice)) },
  { key: "undervalued",      sort: (r) => 1 / Math.max(0.01, parseFloat(r.lastTradePrice)) },
];

// ─── Card builders ────────────────────────────────────────────────────────────

function synthCard(catKey: CategoryKey, r: SyntheticRow): FeaturedCard {
  const row = synthToMarketRow(r);
  return {
    id: r.id,
    displayName: r.displayName,
    role: r.role,
    initials: toInitials(r.displayName),
    price: parseFloat(r.lastTradePrice),
    change: r.change24h,
    volume: r.volume24h,
    category: catKey,
    signal: compactSignal(catKey, r.change24h, r.volume24h),
    row,
  };
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function DiscoveryHeroSection() {
  const { state, dispatch } = useTerminal();
  const { model: synthModel, isSyntheticMode, setSelectedSynth } = useSynthetic();

  const gameFilter = state.gameFilter;

  // ── PINNED CREATOR CARD ───────────────────────────────────────────────────────
  // Pins Skid_Row (asset id 449643, Dota2) as the first featured card to surface
  // the enriched Creator Economy operator-mode card. Only injected when the active
  // game filter is "dota2" or "all" — never when viewing CS2 or another game.
  // The server also enforces game matching on the pinned asset as defence-in-depth.
  // ─────────────────────────────────────────────────────────────────────────────
  const PINNED_CREATOR_ASSET_ID = 449643; // Skid_Row — Dota2 test pilot
  const PINNED_CREATOR_GAME     = "dota2";

  // Resolve the API game param: "all" means fetch top dota2 assets for featured.
  const resolvedGame = gameFilter === "all" ? "dota2" : gameFilter;

  // Only inject pinnedId when the active game matches the pinned asset's game.
  const shouldPin = resolvedGame === PINNED_CREATOR_GAME;

  const { data } = useQuery<FeaturedResponse>({
    queryKey: ["/api/market/featured", resolvedGame, shouldPin ? PINNED_CREATOR_ASSET_ID : null],
    queryFn: async () => {
      const p = new URLSearchParams({ limit: "50" });
      p.set("game", resolvedGame);
      if (shouldPin) p.set("pinnedId", String(PINNED_CREATOR_ASSET_ID));
      const res = await fetch(`/api/market/featured?${p}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !isSyntheticMode,
    staleTime: 15000,
    refetchInterval: 30000,
  });

  const cards: FeaturedCard[] = useMemo(() => {
    if (isSyntheticMode && synthModel && synthModel.rows.length > 0) {
      const rows = synthModel.rows;
      const seen = new Set<string>();
      const result: FeaturedCard[] = [];

      for (const { key, score } of SYNTH_PRIORITY) {
        if (result.length >= 5) break;
        const best = [...rows]
          .filter((r) => !seen.has(r.id))
          .map((r) => ({ r, s: score(r) }))
          .filter(({ s }) => isFinite(s))
          .sort((a, b) => b.s - a.s)[0]?.r;
        if (!best) continue;
        seen.add(best.id);
        result.push(synthCard(key, best));
      }

      return result;
    }

    const rows = (data?.rows ?? []) as FeaturedAssetRow[];
    if (rows.length === 0) return [];

    const seen = new Set<number>();
    return REAL_PRIORITY.map(({ key, sort }) => {
      const pick = [...rows].sort((a, b) => sort(b) - sort(a)).find((r) => !seen.has(r.id));
      if (!pick) return null;
      seen.add(pick.id);
      const change = pct24h(pick);
      return {
        id: pick.id,
        displayName: pick.displayName,
        initials: toInitials(pick.displayName),
        price: parseFloat(pick.lastTradePrice),
        change,
        volume: pick.volume24h,
        category: key,
        signal: compactSignal(key, change, pick.volume24h),
        row: pick,
        operatorMode: pick.operatorMode,
        cardImageUrl: pick.cardImageUrl ?? null,
      } as FeaturedCard;
    }).filter(Boolean) as FeaturedCard[];
  }, [data, isSyntheticMode, synthModel]);

  if (cards.length === 0) return null;

  const selectedId = state.selectedAsset?.id ?? null;

  return (
    <div className="shrink-0 border-b border-white/[0.06]">
      {/* ── Section header ── */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-primary/70" />
            <span className="text-[11px] font-bold text-foreground/85 uppercase tracking-[0.14em]">
              Featured Opportunities
            </span>
          </div>
          <p className="text-[9px] text-muted-foreground/40 mt-1 leading-none pl-[1.4rem]">
            AI-scored · refreshes every 30s
          </p>
        </div>
        <span className="text-[9px] text-muted-foreground/35 bg-white/[0.04] border border-white/[0.06] px-2.5 py-1 rounded-full font-mono tracking-wide">
          {cards.length} picks
        </span>
      </div>

      {/* ── Card row — horizontal scroll on mobile, 5-col grid on desktop ── */}
      <div className="flex gap-2 px-4 pb-4 overflow-x-auto scrollbar-none snap-x snap-mandatory md:overflow-visible md:snap-none">
        {cards.map((card, idx) => (
          <div key={card.id} className="snap-start shrink-0 md:shrink md:flex-1 w-[230px] md:w-auto">
            <DiscoveryCard
              card={card}
              cardIndex={idx}
              isSelected={card.row !== null && card.row.id === selectedId}
              onSelect={() => {
                if (!card.row) return;
                dispatch({ type: "SELECT_ASSET", asset: card.row });
                if (isSyntheticMode && synthModel) {
                  const sid = isSyntheticAsset(card.row) ? synthIdFromAsset(card.row) : null;
                  const sr = sid ? synthModel.rows.find((r) => r.id === sid) ?? null : null;
                  setSelectedSynth(sr);
                } else {
                  dispatch({ type: "OPEN_TRADE_MODAL" });
                }
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

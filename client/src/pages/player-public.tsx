// ─── Player Public Page ───────────────────────────────────────────────────────
// Public-facing asset page for a player. No authentication required.
// Route: /players/:assetId
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  TrendingUp, TrendingDown, Minus, Users, BarChart2,
  Zap, ExternalLink, AlertCircle, Loader2, ShieldCheck, Info,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis,
  Tooltip as ReTooltip, ResponsiveContainer,
} from "recharts";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { MissionSection, MissionEmptyState } from "@/features/player-public/components/MissionSection";
import { MomentsSection } from "@/features/player-public/components/MomentsSection";
import { ActivitySection } from "@/features/player-public/components/ActivitySection";
import { CommunitySection } from "@/features/player-public/components/CommunitySection";
import { PerformanceChartSection } from "@/features/player-public/components/PerformanceChartSection";
import { BuyFlowModal } from "@/features/buy-flow/BuyFlowModal";

// ── Types ─────────────────────────────────────────────────────────────────────

type TrendStatus = "up" | "down" | "flat" | "unknown";

type PerfHistoryPoint = { date: string; score: number; matchesCount: number; sourceType: string };
type ValueHistoryPoint = { date: string; playerValueAfter: number; eventType: string };

interface PublicMission {
  id: string; title: string; description: string | null;
  progress: number | null; target: number | null; rewardLabel: string | null;
  endsAt: string | null; status: "active" | "completed" | "upcoming";
}
interface PublicMoment {
  id: string; title: string; description: string | null; imageUrl: string | null;
  rarity: string | null; price: number | null; supply: number | null;
  sold: number | null; soldPct: number | null; status: "live" | "sold_out" | "upcoming";
}
interface PublicActivityEvent {
  id: string; type: "buy" | "support" | "moment_purchase" | "holder_joined";
  label: string; maskedUser: string; createdAt: string; valueLabel: string | null;
}

interface PlayerPublicOverview {
  assetId: number;
  assetUid: string;
  hero: {
    assetId: number; playerName: string; gameName: string;
    tagline: string | null; status: string | null;
    cardImageUrl: string | null; bannerImageUrl: string | null;
    holdersTotal: number; volumeTotal: number;
    unitPrice: number;
  };
  cta:          { primaryLabel: string; secondaryLabel: string | null; canSupport: boolean };
  socialProof:  { holdersTotal: number; recentActivityCount: number; newSupportersLabel: string | null };
  marketSignals: { holdersTotal: number; volumeTotal: number; trendStatus: TrendStatus };
  mission:   PublicMission | null;
  moments:   PublicMoment[];
  activity:  PublicActivityEvent[];
  community: { totalHolders: number; message: string };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatVolume(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M GS`;
  if (v >= 1_000)     return `${(v / 1_000).toFixed(1)}K GS`;
  return `${v.toFixed(2)} GS`;
}

const TREND_CONFIG: Record<TrendStatus, {
  label: string;
  cls: string;
  Icon: React.ComponentType<{ className?: string }>;
}> = {
  up:      { label: "Trending Up",   cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30", Icon: TrendingUp   },
  down:    { label: "Trending Down", cls: "bg-red-500/20 text-red-300 border-red-500/30",             Icon: TrendingDown },
  flat:    { label: "Stable",        cls: "bg-white/10 text-white/50 border-white/20",                Icon: Minus        },
  unknown: { label: "—",             cls: "bg-white/5 text-white/30 border-white/10",                 Icon: Minus        },
};

// ── Card visual / placeholder ─────────────────────────────────────────────────

function CardVisual({
  cardImageUrl, playerName, gameName,
}: { cardImageUrl: string | null; playerName: string; gameName: string }) {
  if (cardImageUrl) {
    return (
      <img src={cardImageUrl} alt={`${playerName} player card`}
        className="w-full h-full object-cover" data-testid="hero-card-image" />
    );
  }
  const hue = [...playerName].reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-3 select-none"
      style={{ background: `radial-gradient(ellipse at 60% 40%, hsl(${hue},55%,25%) 0%, hsl(${(hue + 200) % 360},40%,10%) 100%)` }}
      data-testid="hero-card-placeholder">
      <svg viewBox="0 0 80 92" className="w-16 h-16 opacity-40" fill="none" aria-hidden>
        <path d="M40 2 L78 22 L78 70 L40 90 L2 70 L2 22 Z"
          stroke="white" strokeWidth="2" strokeLinejoin="round" fill="white" fillOpacity="0.06" />
        <circle cx="40" cy="46" r="16" stroke="white" strokeWidth="1.5" strokeOpacity="0.4" />
      </svg>
      <span className="text-xs text-white/30 tracking-widest uppercase font-mono">{gameName}</span>
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl p-6" data-testid={testId}>
      {children}
    </div>
  );
}

// ── Hero ──────────────────────────────────────────────────────────────────────

function PriceChange({ unitPrice }: { unitPrice: number }) {
  const formatted = unitPrice >= 1000
    ? `${(unitPrice / 1000).toFixed(1)}K`
    : unitPrice.toFixed(2);
  return (
    <div className="flex flex-col" data-testid="hero-price-block">
      <span className="text-xs text-white/40 uppercase tracking-wider font-medium">Price</span>
      <span className="text-3xl font-bold text-white font-mono leading-tight">
        {formatted}
        <span className="text-lg text-white/50 ml-1">GS</span>
      </span>
    </div>
  );
}

function HeroBlock({
  data,
  onSupportClick,
}: {
  data: PlayerPublicOverview;
  onSupportClick: () => void;
}) {
  const { hero, marketSignals } = data;
  const trend = TREND_CONFIG[marketSignals.trendStatus];
  const TIcon = trend.Icon;
  const hue   = [...hero.playerName].reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;

  return (
    <div
      className="relative rounded-2xl overflow-hidden border border-white/10"
      style={{
        background: `linear-gradient(135deg, hsl(${hue},45%,10%) 0%, hsl(${(hue + 200) % 360},30%,6%) 100%)`,
        minHeight: 300,
      }}
      data-testid="public-hero"
    >
      {/* Ambient glow */}
      <div className="absolute inset-0 opacity-25 pointer-events-none"
        style={{ background: `radial-gradient(ellipse at 75% 40%, hsl(${hue},65%,35%), transparent 65%)` }} />

      {/* Top accent line matching Terminal card */}
      <div className="absolute top-0 left-0 right-0 h-[2px]"
        style={{ background: `linear-gradient(90deg, transparent, hsl(${hue},70%,55%), transparent)` }} />

      <div className="relative z-10 flex flex-col sm:flex-row gap-6 p-6 sm:p-8">
        {/* Card image — bigger and more premium */}
        <div
          className="flex-shrink-0 w-40 h-56 sm:w-52 sm:h-72 rounded-xl overflow-hidden shadow-2xl"
          style={{ boxShadow: `0 20px 60px hsl(${hue},60%,20%)/50%, 0 0 0 1px rgba(255,255,255,0.08)` }}
          data-testid="hero-card-visual"
        >
          <CardVisual cardImageUrl={hero.cardImageUrl} playerName={hero.playerName} gameName={hero.gameName} />
        </div>

        {/* Identity + stats */}
        <div className="flex flex-col justify-between gap-4 flex-1 py-1">
          <div className="space-y-3">
            {/* Game + trend badges */}
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="bg-white/8 text-white/55 border-white/12 text-xs uppercase tracking-wider px-2 py-0.5">
                {hero.gameName}
              </Badge>
              <Badge className={cn("border text-xs gap-1 px-2 py-0.5", trend.cls)}>
                <TIcon className="w-3 h-3" />
                {trend.label}
              </Badge>
            </div>

            {/* Player name — hero-scale */}
            <h1 className="text-3xl sm:text-5xl font-bold text-white tracking-tight leading-none" data-testid="hero-player-name">
              {hero.playerName}
            </h1>

            {hero.tagline && (
              <p className="text-sm text-white/45 max-w-sm leading-relaxed" data-testid="hero-tagline">
                {hero.tagline}
              </p>
            )}
          </div>

          {/* Price + metrics row */}
          <div className="flex flex-wrap items-end gap-6 mt-2">
            <PriceChange unitPrice={hero.unitPrice} />

            <div className="flex flex-wrap gap-4">
              <div className="flex flex-col" data-testid="hero-holders-block">
                <span className="text-xs text-white/40 uppercase tracking-wider font-medium">Supporters</span>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Users className="w-3.5 h-3.5 text-white/40" />
                  <span className="text-base font-semibold text-white">{hero.holdersTotal.toLocaleString()}</span>
                </div>
              </div>
              <div className="flex flex-col" data-testid="hero-volume-block">
                <span className="text-xs text-white/40 uppercase tracking-wider font-medium">Volume</span>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <BarChart2 className="w-3.5 h-3.5 text-white/40" />
                  <span className="text-base font-semibold text-white">{formatVolume(hero.volumeTotal)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* CTAs */}
          <div className="flex gap-3 mt-1 flex-wrap">
            <Button
              className="bg-white text-black hover:bg-white/90 gap-2 font-semibold px-5"
              onClick={onSupportClick}
              data-testid="hero-support-btn"
            >
              <Zap className="w-4 h-4" />
              Trade Player
            </Button>
            <Link href={`/terminal?search=${encodeURIComponent(hero.playerName)}`}>
              <Button
                variant="outline"
                className="border-white/20 text-white/55 hover:text-white hover:border-white/40 gap-2"
                data-testid="hero-terminal-btn"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                View in Terminal
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Social Proof ──────────────────────────────────────────────────────────────

function SocialProofBlock({ data }: { data: PlayerPublicOverview }) {
  const { socialProof } = data;
  return (
    <Section testId="public-social-proof">
      <div className="flex flex-wrap gap-6">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20">
            <Users className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-white" data-testid="social-proof-holders">
              {socialProof.holdersTotal.toLocaleString()}
            </p>
            <p className="text-xs text-white/40 uppercase tracking-wider">Supporters</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-white" data-testid="social-proof-activity">
              {socialProof.recentActivityCount}
            </p>
            <p className="text-xs text-white/40 uppercase tracking-wider">Recent trades</p>
          </div>
        </div>
        {socialProof.newSupportersLabel && (
          <div className="flex items-center">
            <p className="text-sm text-white/40" data-testid="social-proof-label">
              {socialProof.newSupportersLabel} backing this player
            </p>
          </div>
        )}
      </div>
    </Section>
  );
}

// ── Market Signals ────────────────────────────────────────────────────────────

function MarketSignalsBlock({ data }: { data: PlayerPublicOverview }) {
  const { marketSignals } = data;
  const trend = TREND_CONFIG[marketSignals.trendStatus];
  const TrendIcon = trend.Icon;
  return (
    <Section testId="public-market-signals">
      <h2 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-4">Market Signals</h2>
      <div className="flex flex-wrap gap-6">
        <div>
          <p className="text-xs text-white/40 uppercase tracking-wider mb-1">Supporters</p>
          <p className="text-xl font-bold text-white" data-testid="market-holders">
            {marketSignals.holdersTotal.toLocaleString()}
          </p>
        </div>
        <div>
          <p className="text-xs text-white/40 uppercase tracking-wider mb-1">Volume</p>
          <p className="text-xl font-bold text-white" data-testid="market-volume">
            {formatVolume(marketSignals.volumeTotal)}
          </p>
        </div>
        <div>
          <p className="text-xs text-white/40 uppercase tracking-wider mb-1">Trend</p>
          <Badge className={cn("border gap-1 mt-0.5", trend.cls)} data-testid="market-trend">
            <TrendIcon className="w-3 h-3" />
            {trend.label}
          </Badge>
        </div>
      </div>
    </Section>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PlayerPublicPage() {
  const { assetId } = useParams<{ assetId: string }>();
  const queryClient = useQueryClient();
  const [isBuyModalOpen, setIsBuyModalOpen] = useState(false);

  const overviewKey = ["/api/player-public", assetId, "overview"];

  const { data, isLoading, isError, error } = useQuery<PlayerPublicOverview>({
    queryKey: overviewKey,
    queryFn: async () => {
      const res = await fetch(`/api/player-public/${assetId}/overview`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? "Failed to load player page");
      }
      return res.json();
    },
    enabled: !!assetId,
    retry: false,
  });

  const { data: perfHistory } = useQuery<PerfHistoryPoint[]>({
    queryKey: ["/api/assets/performance-history", data?.assetUid],
    queryFn: () =>
      fetch(`/api/assets/${encodeURIComponent(data!.assetUid)}/performance-history?days=90`).then(r => r.json()),
    enabled: !!data?.assetUid,
  });

  const { data: valueHistory } = useQuery<ValueHistoryPoint[]>({
    queryKey: ["/api/assets/value-history", data?.assetUid],
    queryFn: () =>
      fetch(`/api/assets/${encodeURIComponent(data!.assetUid)}/value-history?days=90`).then(r => r.json()),
    enabled: !!data?.assetUid,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0a0b0f] flex items-center justify-center" data-testid="player-public-loading">
        <Loader2 className="w-8 h-8 text-white/30 animate-spin" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="min-h-screen bg-[#0a0b0f] flex flex-col items-center justify-center gap-4 px-4" data-testid="player-public-error">
        <AlertCircle className="w-10 h-10 text-red-400/60" />
        <p className="text-white/60 text-center max-w-xs">
          {(error as Error)?.message ?? "Player not found."}
        </p>
        <Link href="/terminal">
          <Button variant="outline" className="border-white/20 text-white/60 hover:text-white mt-2">
            Back to Terminal
          </Button>
        </Link>
      </div>
    );
  }

  const buyContext = {
    mode:       "support" as const,
    assetId:    data.assetId,
    playerName: data.hero.playerName,
    gameName:   data.hero.gameName,
    priceHint:  data.hero.unitPrice,
  };

  return (
    <div className="min-h-screen bg-[#0a0b0f] text-white" data-testid="player-public-page">
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-5">

        {/* 1. Hero — CTA wired to buy modal */}
        <HeroBlock
          data={data}
          onSupportClick={() => setIsBuyModalOpen(true)}
        />

        {/* 2. Social Proof */}
        <SocialProofBlock data={data} />

        {/* 3. Market Signals */}
        <MarketSignalsBlock data={data} />

        {/* 4. Mission */}
        {data.mission ? (
          <MissionSection mission={data.mission} />
        ) : (
          <MissionEmptyState />
        )}

        {/* 5. Moments */}
        <MomentsSection moments={data.moments} />

        {/* 6. Activity */}
        <ActivitySection activity={data.activity} />

        {/* 7. Performance Chart (market: price/volume/momentum) */}
        <PerformanceChartSection assetId={data.assetId} />

        {/* 7b. Performance Score History (Timeline 1: Esports sporting results) */}
        <Section testId="section-perf-score-history">
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-xs font-semibold text-white/50 uppercase tracking-wider">Performance Score History</h2>
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="w-3 h-3 text-white/30 cursor-help" data-testid="perf-score-history-info" />
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[260px] text-center text-xs leading-snug">
                  Esports performance score (0–100) over time. Reflects the player's sporting results —
                  not market price or trading activity.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          {Array.isArray(perfHistory) && perfHistory.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={140}>
                <AreaChart data={perfHistory}>
                  <defs>
                    <linearGradient id="ppPerfGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" hide />
                  <YAxis domain={[0, 100]} hide />
                  <ReTooltip
                    contentStyle={{ background: "#0f1117", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, fontSize: 11 }}
                    formatter={(v: any) => [`${parseFloat(v).toFixed(1)}`, "Perf Score"]}
                    labelFormatter={(label: string) => label}
                  />
                  <Area type="monotone" dataKey="score" stroke="#6366f1" strokeWidth={2} fill="url(#ppPerfGrad)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
              <p className="text-xs text-white/20 mt-2">
                Last 90 days · {perfHistory.length} data point{perfHistory.length !== 1 ? "s" : ""} · Esports performance only
              </p>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 h-28 text-center" data-testid="perf-score-history-empty">
              <BarChart2 className="w-5 h-5 text-white/15" />
              <p className="text-sm text-white/30">No performance score history yet</p>
              <p className="text-xs text-white/20">Data appears once match ingestion is active</p>
            </div>
          )}
        </Section>

        {/* 7c. Algorithmic Value History (Timeline 2: Model output) */}
        {Array.isArray(valueHistory) && valueHistory.length > 0 && (
          <Section testId="section-value-history">
            <div className="flex items-center gap-2 mb-4">
              <h2 className="text-xs font-semibold text-white/50 uppercase tracking-wider">Algorithmic Value History</h2>
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="w-3 h-3 text-white/30 cursor-help" data-testid="value-history-info" />
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[260px] text-center text-xs leading-snug">
                    The fundamental value estimate derived from performance data. This is the algorithmic
                    model output — not the market price.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <ResponsiveContainer width="100%" height={120}>
              <AreaChart data={valueHistory}>
                <defs>
                  <linearGradient id="ppValueGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#10b981" stopOpacity={0.20} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" hide />
                <YAxis domain={["auto", "auto"]} hide />
                <ReTooltip
                  contentStyle={{ background: "#0f1117", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, fontSize: 11 }}
                  formatter={(v: any) => [`${parseFloat(v).toFixed(2)} GS`, "Value"]}
                  labelFormatter={() => ""}
                />
                <Area type="monotone" dataKey="playerValueAfter" stroke="#10b981" strokeWidth={1.5} fill="url(#ppValueGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
            <p className="text-xs text-white/20 mt-2">
              Last 90 days · {valueHistory.length} event{valueHistory.length !== 1 ? "s" : ""} · Algorithmic value only — not market price
            </p>
          </Section>
        )}

        {/* 8. Community */}
        <CommunitySection community={data.community} playerName={data.hero.playerName} />

      </div>

      {/* Buy Flow Modal */}
      <BuyFlowModal
        context={buyContext}
        isOpen={isBuyModalOpen}
        onClose={() => setIsBuyModalOpen(false)}
        onSuccessRefetch={() => {
          queryClient.invalidateQueries({ queryKey: overviewKey });
        }}
      />
    </div>
  );
}

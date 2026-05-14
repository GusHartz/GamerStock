import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Clock, Users, TrendingUp, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useTradeCard } from "@/features/trade/TradeCardContext";
import { abbreviateTeam } from "@/utils/abbreviateTeam";

// ── Types ─────────────────────────────────────────────────────────────────────

interface DetailOutcomeCard {
  outcomeId:          number;
  code:               string | null;
  label:              string;
  description:        string | null;
  isWinner:           boolean;
  poolShare:          string;
  impliedProbability: string | null;
  payoutValue:        string | null;
  sortOrder:          number;
}

interface MarketDetailResponse {
  marketId:          number;
  uid:               string;
  slug:              string | null;
  question:          string;
  description:       string | null;
  status:            string;
  marketType:        string;
  currency:          string;
  openAt:            string | null;
  closeAt:           string | null;
  resolveAt:         string | null;
  settledAt:         string | null;
  resolvedOutcomeId: number | null;
  createdAt:         string;
  event: {
    eventId:        number;
    game:           string;
    tournamentName: string | null;
    eventName:      string | null;
    teamAName:      string | null;
    teamBName:      string | null;
    startsAt:       string | null;
    eventStatus:    string;
  } | null;
  outcomes:         DetailOutcomeCard[];
  stats: {
    volume24h:    string;
    traders24h:   number;
    lastPriceYes: string | null;
    lastPriceNo:  string | null;
    updatedAt:    string | null;
  } | null;
  positionCounts: {
    active: number;
    settled: number;
    cancelled: number;
    total: number;
  };
  availableActions: string[];
  userCanTrade:     boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatVolume(v: string): string {
  const n = parseFloat(v || "0");
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

function formatCloseAt(closeAt: string | null): string {
  if (!closeAt) return "No deadline";
  const d = new Date(closeAt);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  if (diffMs < 0) return "Closed";
  const diffHrs = Math.floor(diffMs / 3_600_000);
  if (diffHrs < 1) return "< 1h left";
  if (diffHrs < 24) return `${diffHrs}h left`;
  const diffDays = Math.floor(diffHrs / 24);
  return `${diffDays}d left`;
}

function statusColor(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "open":     return "default";
    case "locked":   return "secondary";
    case "resolved": return "outline";
    case "settled":  return "outline";
    default:         return "secondary";
  }
}

function outcomePrice(outcome: DetailOutcomeCard, stats: MarketDetailResponse["stats"]): number {
  if (!stats) return 0.5;
  const p = outcome.sortOrder === 0 ? stats.lastPriceYes : stats.lastPriceNo;
  return p ? parseFloat(p) : 0.5;
}

// ── Probability bar ──────────────────────────────────────────────────────────

function ProbBar({ prob }: { prob: number }) {
  const pct = Math.round(prob * 100);
  return (
    <div className="w-full h-2 rounded-full bg-muted overflow-hidden" aria-label={`${pct}% probability`}>
      <div
        className="h-full rounded-full bg-primary transition-all"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// ── Outcome card ─────────────────────────────────────────────────────────────

interface OutcomeCardProps {
  outcome:    DetailOutcomeCard;
  market:     MarketDetailResponse;
  onTrade:    (action: "BUY" | "SELL") => void;
  canTrade:   boolean;
}

function OutcomeCard({ outcome, market, onTrade, canTrade }: OutcomeCardProps) {
  const price = outcomePrice(outcome, market.stats);
  const prob  = parseFloat(outcome.impliedProbability ?? String(price));
  const pct   = Math.round(prob * 100);

  const isWinner = outcome.isWinner;
  const isResolved = ["resolved", "settled"].includes(market.status);

  return (
    <div
      className={`rounded-xl border p-4 space-y-3 transition-colors ${
        isResolved && isWinner
          ? "border-green-500/60 bg-green-500/5"
          : isResolved && !isWinner
          ? "border-border/50 opacity-60"
          : "border-border bg-card hover:border-border/80"
      }`}
      data-testid={`outcome-card-${outcome.outcomeId}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-sm leading-tight truncate" data-testid={`outcome-label-${outcome.outcomeId}`}>
            {outcome.label}
          </p>
          {isResolved && isWinner && (
            <span className="text-xs text-green-500 font-medium">Winner</span>
          )}
        </div>
        <span
          className="shrink-0 text-xl font-bold tabular-nums"
          data-testid={`outcome-prob-${outcome.outcomeId}`}
        >
          {pct}%
        </span>
      </div>

      <ProbBar prob={prob} />

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Price: {(price * 100).toFixed(0)}¢</span>
        <span>Pool: {(parseFloat(outcome.poolShare) * 100).toFixed(0)}%</span>
      </div>

      {canTrade && (
        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            className="flex-1 text-xs"
            onClick={() => onTrade("BUY")}
            data-testid={`btn-buy-${outcome.outcomeId}`}
          >
            Buy {abbreviateTeam(outcome.label)}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1 text-xs"
            onClick={() => onTrade("SELL")}
            data-testid={`btn-sell-${outcome.outcomeId}`}
          >
            Sell
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function MarketDetailSkeleton() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
      <Skeleton className="h-5 w-24" />
      <div className="space-y-2">
        <Skeleton className="h-7 w-4/5" />
        <Skeleton className="h-5 w-2/5" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 rounded-lg" />)}
      </div>
      <div className="space-y-3">
        {[0, 1].map((i) => <Skeleton key={i} className="h-36 rounded-xl" />)}
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function PredictionsMarketPage() {
  const { idOrSlug } = useParams<{ idOrSlug: string }>();
  const [, navigate]  = useLocation();
  const { open: openTrade } = useTradeCard();

  const { data: market, isLoading, isError } = useQuery<MarketDetailResponse>({
    queryKey: ["/api/predictions/markets", idOrSlug, "detail"],
    queryFn: async () => {
      const res = await fetch(`/api/predictions/markets/${idOrSlug}/detail`, {
        credentials: "include",
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to load market");
      }
      return res.json();
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
    enabled: !!idOrSlug,
  });

  // ── Error / Loading states ──────────────────────────────────────────────────

  if (isLoading) return <MarketDetailSkeleton />;

  if (isError || !market) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center space-y-4">
        <AlertCircle className="h-10 w-10 mx-auto text-muted-foreground" />
        <p className="text-muted-foreground">Market not found or failed to load.</p>
        <Button variant="outline" onClick={() => navigate("/predictions")} data-testid="btn-back-error">
          Back to Markets
        </Button>
      </div>
    );
  }

  // ── Derived ─────────────────────────────────────────────────────────────────

  const vol24h    = formatVolume(market.stats?.volume24h ?? "0");
  const traders   = market.stats?.traders24h ?? 0;
  const timeLeft  = formatCloseAt(market.closeAt);
  const canTrade  = market.userCanTrade;

  const eventContext = market.event
    ? [market.event.teamAName, market.event.teamBName].filter(Boolean).join(" vs ") ||
      market.event.eventName ||
      market.event.tournamentName
    : null;

  // ── Trade handler ───────────────────────────────────────────────────────────

  function handleTrade(outcome: DetailOutcomeCard, action: "BUY" | "SELL") {
    const price = outcomePrice(outcome, market!.stats);
    openTrade({
      type:      "prediction",
      marketId:  market!.marketId,
      sideId:    outcome.outcomeId,
      sideLabel: outcome.label,
      price:     String(price),
      action,
      question:  market!.question,
    });
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6" data-testid="market-detail-page">

      {/* Back link */}
      <button
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => navigate("/predictions")}
        data-testid="btn-back"
      >
        <ArrowLeft className="h-4 w-4" />
        Markets
      </button>

      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={statusColor(market.status)} className="capitalize" data-testid="status-badge">
            {market.status}
          </Badge>
          {market.event?.game && (
            <Badge variant="outline" className="text-xs uppercase" data-testid="game-badge">
              {market.event.game}
            </Badge>
          )}
        </div>

        <h1 className="text-xl font-bold leading-snug" data-testid="market-question">
          {market.question}
        </h1>

        {eventContext && (
          <p className="text-sm text-muted-foreground" data-testid="event-context">
            {eventContext}
          </p>
        )}
        {market.event?.tournamentName && (
          <p className="text-xs text-muted-foreground" data-testid="tournament-name">
            {market.event.tournamentName}
          </p>
        )}
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border bg-card px-3 py-2 text-center" data-testid="stat-volume">
          <div className="flex items-center justify-center gap-1 text-muted-foreground mb-0.5">
            <TrendingUp className="h-3.5 w-3.5" />
            <span className="text-xs">Volume</span>
          </div>
          <p className="font-semibold text-sm">{vol24h}</p>
        </div>

        <div className="rounded-lg border bg-card px-3 py-2 text-center" data-testid="stat-traders">
          <div className="flex items-center justify-center gap-1 text-muted-foreground mb-0.5">
            <Users className="h-3.5 w-3.5" />
            <span className="text-xs">Traders</span>
          </div>
          <p className="font-semibold text-sm">{traders}</p>
        </div>

        <div className="rounded-lg border bg-card px-3 py-2 text-center" data-testid="stat-time">
          <div className="flex items-center justify-center gap-1 text-muted-foreground mb-0.5">
            <Clock className="h-3.5 w-3.5" />
            <span className="text-xs">Closes</span>
          </div>
          <p className="font-semibold text-sm truncate">{timeLeft}</p>
        </div>
      </div>

      {/* Outcome cards */}
      <div className="space-y-3">
        {market.outcomes.map((outcome) => (
          <OutcomeCard
            key={outcome.outcomeId}
            outcome={outcome}
            market={market}
            canTrade={canTrade}
            onTrade={(action) => handleTrade(outcome, action)}
          />
        ))}
      </div>

      {/* Not tradeable notice */}
      {!canTrade && (
        <p className="text-center text-sm text-muted-foreground" data-testid="no-trade-notice">
          {market.status === "open"
            ? "Trading window has closed for this market."
            : `This market is ${market.status} and no longer accepting trades.`}
        </p>
      )}

      {/* Description */}
      {market.description && (
        <div className="rounded-lg border bg-card/50 px-4 py-3" data-testid="market-description">
          <p className="text-sm text-muted-foreground leading-relaxed">{market.description}</p>
        </div>
      )}

    </div>
  );
}

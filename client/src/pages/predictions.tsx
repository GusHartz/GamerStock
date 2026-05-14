import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Target, ChevronLeft, ChevronRight, SlidersHorizontal } from "lucide-react";
import { PredictionCard } from "@/components/market/PredictionCard";
import type { MarketCardVM } from "@/features/home/types/home";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ── Local API shapes (mirrors BrowseMarketsResponse from server) ──────────────

interface BrowseOutcome {
  outcomeId:          number;
  code:               string | null;
  label:              string;
  isWinner:           boolean;
  impliedProbability: string | null;
}

interface BrowseCard {
  marketId:    number;
  uid:         string;
  slug:        string | null;
  question:    string;
  status:      string;
  currency:    string;
  closeAt:     string | null;
  resolveAt:   string | null;
  settledAt:   string | null;
  event: {
    game:           string;
    tournamentName: string | null;
    eventName:      string | null;
    teamAName:      string | null;
    teamBName:      string | null;
    startsAt:       string | null;
  } | null;
  outcomes: BrowseOutcome[];
  stats: {
    volume24h:    string;
    traders24h:   number;
    lastPriceYes: string | null;
    lastPriceNo:  string | null;
  } | null;
  userHasPosition: boolean;
}

interface BrowseTabCounts {
  all:      number;
  live:     number;
  upcoming: number;
  resolved: number;
}

interface BrowseResponse {
  page:    number;
  limit:   number;
  total:   number;
  tab:     string | null;
  counts:  BrowseTabCounts;
  markets: BrowseCard[];
}

// ── Mapper: BrowseCard → MarketCardVM ─────────────────────────────────────────

function toVM(card: BrowseCard): MarketCardVM {
  const yesOutcome = card.outcomes.find(o => o.code === "yes" || o.code === "TEAM_A") ?? card.outcomes[0] ?? null;
  const noOutcome  = card.outcomes.find(o => o.code === "no"  || o.code === "TEAM_B") ?? card.outcomes[1] ?? null;

  const yesProb = yesOutcome?.impliedProbability != null
    ? parseFloat(yesOutcome.impliedProbability) * 100
    : null;

  const yesPrice = card.stats?.lastPriceYes != null
    ? parseFloat(card.stats.lastPriceYes)
    : null;

  const noPrice = card.stats?.lastPriceNo != null
    ? parseFloat(card.stats.lastPriceNo)
    : null;

  return {
    marketId:       card.marketId,
    slug:           card.slug,
    question:       card.question,
    status:         card.status,
    currency:       card.currency,
    closeAt:        card.closeAt,
    yesPrice,
    noPrice,
    yesProb,
    teamAName:      card.event?.teamAName      ?? null,
    teamBName:      card.event?.teamBName      ?? null,
    tournamentName: card.event?.tournamentName ?? null,
    eventName:      card.event?.eventName      ?? null,
    game:           card.event?.game           ?? null,
    startsAt:       card.event?.startsAt       ?? null,
    yesId:          yesOutcome?.outcomeId      ?? null,
    noId:           noOutcome?.outcomeId       ?? null,
  };
}

// ── Constants ─────────────────────────────────────────────────────────────────

type BrowseTab  = "all" | "live" | "upcoming" | "resolved";
type BrowseSort = "closing_soon" | "newest" | "volume_desc";

const VALID_TABS: BrowseTab[] = ["all", "live", "upcoming", "resolved"];

const TABS: { value: BrowseTab; label: string; countKey: keyof BrowseTabCounts }[] = [
  { value: "all",      label: "All",      countKey: "all" },
  { value: "live",     label: "Live",     countKey: "live" },
  { value: "upcoming", label: "Upcoming", countKey: "upcoming" },
  { value: "resolved", label: "Resolved", countKey: "resolved" },
];

const GAME_OPTIONS: { value: string; label: string }[] = [
  { value: "all",      label: "All Games" },
  { value: "lol",      label: "League of Legends" },
  { value: "valorant", label: "Valorant" },
  { value: "cs2",      label: "CS2" },
  { value: "dota2",    label: "Dota 2" },
  { value: "ow2",      label: "Overwatch 2" },
  { value: "cod-mw",   label: "Call of Duty" },
  { value: "r6",       label: "Rainbow Six" },
];

const SORT_OPTIONS: { value: BrowseSort; label: string }[] = [
  { value: "newest",       label: "Newest" },
  { value: "closing_soon", label: "Closing Soon" },
  { value: "volume_desc",  label: "Most Volume" },
];

const PAGE_LIMIT = 20;

// ── URL helpers ───────────────────────────────────────────────────────────────

function readTabFromUrl(): BrowseTab {
  const p = new URLSearchParams(window.location.search);
  const t = p.get("tab") as BrowseTab | null;
  return t && VALID_TABS.includes(t) ? t : "all";
}

function pushParams(params: Record<string, string | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) p.set(k, v);
  }
  const qs = p.toString();
  const next = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  window.history.replaceState(null, "", next);
}

// ── Empty state messages ──────────────────────────────────────────────────────

const EMPTY_MSG: Record<BrowseTab, string> = {
  all:      "No markets available right now. Check back soon.",
  live:     "There are no live markets right now. Check back soon.",
  upcoming: "No upcoming markets scheduled yet.",
  resolved: "No resolved markets to show.",
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function PredictionsPage() {
  const [tab,  setTab]  = useState<BrowseTab>(readTabFromUrl);
  const [game, setGame] = useState<string>("all");
  const [sort, setSort] = useState<BrowseSort | "">("");
  const [page, setPage] = useState(1);

  // Sync URL whenever tab/game/sort/page changes
  useEffect(() => {
    pushParams({
      tab:  tab !== "all" ? tab : undefined,
      game: game !== "all" ? game : undefined,
      sort: sort || undefined,
      page: page > 1 ? String(page) : undefined,
    });
  }, [tab, game, sort, page]);

  const queryGame = game === "all" ? undefined : game;
  const querySort = sort || undefined;

  const queryKey = [
    "/api/predictions/browse",
    { tab, game: queryGame, sort: querySort, page },
  ] as const;

  const params = new URLSearchParams({
    tab,
    page:  String(page),
    limit: String(PAGE_LIMIT),
    ...(queryGame ? { game: queryGame } : {}),
    ...(querySort ? { sort: querySort } : {}),
  });

  const { data, isLoading, isError } = useQuery<BrowseResponse>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(`/api/predictions/browse?${params}`);
      if (!res.ok) throw new Error("Failed to fetch markets");
      return res.json();
    },
    staleTime: 30_000,
  });

  const vms       = useMemo(() => (data?.markets ?? []).map(toVM), [data?.markets]);
  const counts    = data?.counts;
  const totalPages = data ? Math.ceil(data.total / PAGE_LIMIT) : 0;

  function handleTabChange(next: BrowseTab) {
    setTab(next);
    setSort("");
    setPage(1);
  }

  function handleGameChange(next: string) {
    setGame(next);
    setPage(1);
  }

  function handleSortChange(next: BrowseSort) {
    setSort(next);
    setPage(1);
  }

  return (
    <div className="min-h-full bg-background pb-12">
      {/* Page header */}
      <div className="border-b border-white/[0.06] bg-black/20 backdrop-blur-sm mb-6">
        <div className="max-w-[1600px] mx-auto px-4 py-5">
          <div className="flex items-center gap-2 mb-1">
            <Target className="w-5 h-5 text-cyan-400" />
            <h1 className="text-lg font-semibold text-white">Predictions</h1>
          </div>
          <p className="text-xs text-zinc-500">Browse and trade on esports prediction markets</p>
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto px-4">
        {/* Tabs + Filters row */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          {/* Tabs — All / Live / Upcoming / Resolved */}
          <div
            className="flex items-center gap-1 p-1 bg-white/[0.04] border border-white/[0.06] rounded-lg w-fit"
            data-testid="predictions-tabs"
          >
            {TABS.map(t => {
              const count = counts?.[t.countKey];
              const isActive = tab === t.value;
              return (
                <button
                  key={t.value}
                  data-testid={`tab-${t.value}`}
                  onClick={() => handleTabChange(t.value)}
                  className={`
                    flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium
                    transition-all duration-150
                    ${isActive
                      ? "bg-white/10 text-white shadow-inner"
                      : "text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.04]"}
                  `}
                >
                  {t.label}
                  {count != null && (
                    <span className={`
                      text-[10px] font-mono px-1 rounded
                      ${isActive ? "bg-white/10 text-zinc-300" : "text-zinc-700"}
                    `}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Filters */}
          <div className="flex items-center gap-2" data-testid="predictions-filters">
            <SlidersHorizontal className="w-3.5 h-3.5 text-zinc-600 hidden sm:block" />

            <Select value={game} onValueChange={handleGameChange}>
              <SelectTrigger
                data-testid="select-game"
                className="h-8 w-[150px] text-xs bg-white/[0.04] border-white/[0.08] text-zinc-300"
              >
                <SelectValue placeholder="All Games" />
              </SelectTrigger>
              <SelectContent>
                {GAME_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={sort} onValueChange={v => handleSortChange(v as BrowseSort)}>
              <SelectTrigger
                data-testid="select-sort"
                className="h-8 w-[140px] text-xs bg-white/[0.04] border-white/[0.08] text-zinc-300"
              >
                <SelectValue placeholder="Sort by…" />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Results count */}
        {!isLoading && !isError && data && (
          <p className="text-xs text-zinc-600 mb-4" data-testid="text-results-count">
            {data.total === 0
              ? "No markets found"
              : `${data.total} market${data.total !== 1 ? "s" : ""} found`}
          </p>
        )}

        {/* Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-[200px] rounded-xl bg-white/[0.04]" />
            ))}
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <Target className="w-10 h-10 text-zinc-700 mb-3" />
            <p className="text-zinc-400 font-medium mb-1">Failed to load markets</p>
            <p className="text-zinc-600 text-sm">Please try again later.</p>
          </div>
        ) : vms.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <Target className="w-10 h-10 text-zinc-700 mb-3" />
            <p className="text-zinc-400 font-medium mb-1">No markets found</p>
            <p className="text-zinc-600 text-sm">{EMPTY_MSG[tab]}</p>
          </div>
        ) : (
          <div
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
            data-testid="predictions-grid"
          >
            {vms.map(vm => (
              <PredictionCard
                key={vm.marketId}
                market={vm}
                className="block h-full"
              />
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div
            className="flex items-center justify-center gap-3 mt-8"
            data-testid="predictions-pagination"
          >
            <Button
              variant="outline"
              size="sm"
              data-testid="button-prev-page"
              disabled={page <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
              className="h-8 px-3 text-xs bg-white/[0.04] border-white/[0.08] text-zinc-300 hover:bg-white/[0.08] hover:text-white disabled:opacity-30"
            >
              <ChevronLeft className="w-3.5 h-3.5 mr-1" />
              Prev
            </Button>

            <span className="text-xs text-zinc-500" data-testid="text-page-info">
              Page {page} of {totalPages}
            </span>

            <Button
              variant="outline"
              size="sm"
              data-testid="button-next-page"
              disabled={page >= totalPages}
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              className="h-8 px-3 text-xs bg-white/[0.04] border-white/[0.08] text-zinc-300 hover:bg-white/[0.08] hover:text-white disabled:opacity-30"
            >
              Next
              <ChevronRight className="w-3.5 h-3.5 ml-1" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

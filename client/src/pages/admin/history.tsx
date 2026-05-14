import { PredictAdminLayout, AdminSectionCard, AdminEmptyState, StatusBadge } from "./predict-layout";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useState } from "react";
import {
  Clock, Search, RefreshCw, ChevronRight, Filter, X,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type HistoryEventItem = {
  eventId:            number;
  title:              string;
  game:               string;
  tournamentName:     string | null;
  startsAt:           string | null;
  eventStatus:        string;
  marketCount:        number;
  resolvedCount:      number;
  poolTotalSum:       string | null;
  latestMarketUpdate: string | null;
  eventUpdatedAt:     string;
};

type HistoryListResponse = {
  data:   HistoryEventItem[];
  total:  number;
  limit:  number;
  offset: number;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const EVENT_STATUSES = ["scheduled", "live", "finished", "cancelled", "postponed"];
const GAMES = ["lol", "csgo", "valorant", "dota2", "r6", "rl", "fifa", "cod"];

function fmt(n: string | null): string {
  if (!n) return "—";
  const v = parseFloat(n);
  if (isNaN(v)) return "—";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return v.toFixed(0);
}

function fmtDate(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString();
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminHistoryPage() {
  const [search,      setSearch]      = useState("");
  const [eventStatus, setEventStatus] = useState("");
  const [game,        setGame]        = useState("");

  const params = new URLSearchParams();
  if (search.trim())  params.set("search",      search.trim());
  if (eventStatus)    params.set("eventStatus", eventStatus);
  if (game)           params.set("game",        game);
  params.set("limit", "50");

  const queryKey = `/api/admin/predictions/history?${params.toString()}`;

  const { data, isLoading, refetch, isFetching } = useQuery<HistoryListResponse>({
    queryKey: [queryKey],
  });

  const items = data?.data ?? [];
  const total = data?.total ?? 0;

  function resetFilters() {
    setSearch("");
    setEventStatus("");
    setGame("");
  }

  const hasFilters = search || eventStatus || game;

  return (
    <PredictAdminLayout
      title="History"
      subtitle="Resolved, finished, and cancelled prediction events with market distribution"
    >

      {/* Filters */}
      <AdminSectionCard title="Filters" description="Narrow the event list">
        <div className="flex flex-wrap items-center gap-3">

          {/* Search */}
          <div className="flex items-center gap-2 bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-1.5 min-w-[200px]">
            <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <input
              data-testid="input-search-history"
              type="text"
              placeholder="Search event title…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-transparent text-sm text-white placeholder:text-muted-foreground outline-none flex-1"
            />
          </div>

          {/* Event status */}
          <div className="flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-muted-foreground" />
            <select
              data-testid="select-event-status-filter"
              value={eventStatus}
              onChange={(e) => setEventStatus(e.target.value)}
              className="rounded-md border border-white/10 bg-white/[0.04] text-sm text-white px-2.5 py-1.5 focus:outline-none"
            >
              <option value="">All statuses</option>
              {EVENT_STATUSES.map((s) => (
                <option key={s} value={s} className="capitalize">{s}</option>
              ))}
            </select>
          </div>

          {/* Game */}
          <select
            data-testid="select-game-filter"
            value={game}
            onChange={(e) => setGame(e.target.value)}
            className="rounded-md border border-white/10 bg-white/[0.04] text-sm text-white px-2.5 py-1.5 focus:outline-none"
          >
            <option value="">All games</option>
            {GAMES.map((g) => (
              <option key={g} value={g} className="uppercase">{g.toUpperCase()}</option>
            ))}
          </select>

          {/* Reset */}
          {hasFilters && (
            <button
              data-testid="button-reset-filters"
              onClick={resetFilters}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-white transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              Reset
            </button>
          )}

          {/* Refresh */}
          <button
            data-testid="button-refresh-history"
            onClick={() => refetch()}
            disabled={isFetching}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-xs text-muted-foreground hover:text-white transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </AdminSectionCard>

      {/* Table */}
      <AdminSectionCard
        title="Events"
        description={isLoading ? "Loading…" : `${total} result${total === 1 ? "" : "s"}`}
      >
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="w-5 h-5 text-cyan-400 animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <AdminEmptyState
            icon={<Clock className="w-10 h-10" />}
            message="No events match these filters"
            hint="Events with published markets appear here regardless of event status"
          />
        ) : (
          <>
            {/* Column headers */}
            <div className="hidden md:grid grid-cols-[1fr_80px_90px_60px_60px_90px_90px_32px] gap-3 pb-2 border-b border-white/[0.06]">
              {["Event", "Game", "Status", "Markets", "Settled", "Volume", "Updated", ""].map((h) => (
                <span key={h} className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">{h}</span>
              ))}
            </div>

            <div className="flex flex-col divide-y divide-white/[0.05]">
              {items.map((item) => (
                <Link key={item.eventId} href={`/admin/history/${item.eventId}`}>
                  <div
                    data-testid={`row-history-${item.eventId}`}
                    className="grid grid-cols-1 md:grid-cols-[1fr_80px_90px_60px_60px_90px_90px_32px] gap-2 md:gap-3 items-center py-3 hover:bg-white/[0.02] transition-colors cursor-pointer -mx-5 px-5"
                  >
                    {/* Event */}
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-white truncate">{item.title}</div>
                      {item.tournamentName && (
                        <div className="text-[11px] text-muted-foreground truncate">{item.tournamentName}</div>
                      )}
                    </div>

                    {/* Game */}
                    <span className="text-xs font-mono text-muted-foreground uppercase">{item.game}</span>

                    {/* Status */}
                    <div><StatusBadge status={item.eventStatus} /></div>

                    {/* Markets */}
                    <span data-testid={`text-market-count-${item.eventId}`} className="text-sm text-white font-mono">
                      {item.marketCount}
                    </span>

                    {/* Settled */}
                    <span data-testid={`text-resolved-count-${item.eventId}`} className="text-sm font-mono">
                      <span className={item.resolvedCount > 0 ? "text-emerald-400" : "text-muted-foreground"}>
                        {item.resolvedCount}
                      </span>
                    </span>

                    {/* Volume */}
                    <span data-testid={`text-volume-${item.eventId}`} className="text-sm font-mono text-cyan-300/80">
                      {fmt(item.poolTotalSum)}
                    </span>

                    {/* Updated */}
                    <span className="text-xs text-muted-foreground">
                      {fmtDate(item.latestMarketUpdate ?? item.eventUpdatedAt)}
                    </span>

                    {/* Arrow */}
                    <ChevronRight className="w-4 h-4 text-muted-foreground/40 shrink-0" />
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}
      </AdminSectionCard>

    </PredictAdminLayout>
  );
}

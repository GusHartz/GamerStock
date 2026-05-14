import { useState, useMemo } from "react";
import { Link } from "wouter";
import {
  Briefcase, TrendingUp, TrendingDown,
  Lock, Activity, BarChart2, ShieldCheck,
  Clock, CheckCircle, XCircle, Wallet,
  ArrowUpRight, ArrowDownRight,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { usePortfolio } from "@/hooks/use-portfolio";
import { useTradeCard } from "@/features/trade/TradeCardContext";
import { useTerminal, type MarketRow } from "@/state/terminalStore";
import { formatCurrency } from "@/lib/format";
import { abbreviateTeam } from "@/utils/abbreviateTeam";
import { isPredictEnabled } from "@/lib/featureFlags";

// ─── Local types ─────────────────────────────────────────────────────────────

type WalletRow = {
  currency: string;
  availableBalance: string;
  lockedBalance: string;
  totalBalance: string;
};

type WalletSummary = {
  userId: string;
  wallets: WalletRow[];
};

// Mirrors server/domains/prediction/types.ts (read-only shapes for the UI)

interface HeldOutcome {
  positionId:    number;
  outcomeId:     number;
  outcomeCode:   string | null;
  outcomeLabel:  string;
  quantity:      string | null;
  avgPrice:      string | null;
  costBasis:     string | null;
  status:        string;
  currentPrice:  string | null;
  marketValue:   string | null;
  unrealizedPnl: string | null;
  pricedAt:      string | null;
}

interface ActiveMarketGroup {
  marketId:          number;
  marketSlug:        string | null;
  marketTitle:       string;
  marketStatus:      string;
  currency:          string;
  closeAt:           string | null;
  userCanTrade:      boolean;
  event: {
    game:           string;
    tournamentName: string | null;
    teamAName:      string | null;
    teamBName:      string | null;
  } | null;
  outcomesHeld:      HeldOutcome[];
  totalQuantity:     number;
  totalCostBasis:    string;
  unrealizedPnl:     string | null;
  totalMarketValue:  string | null;
  hasPartialPricing: boolean;
}

interface PredictionSummary {
  activeMarkets:     number;
  activePositions:   number;
  openExposure:      string;
  realizedPnl:       string;
  totalPayout:       string;
  unrealizedPnl:     string | null;
  hasPartialPricing: boolean;
  currency:          string;
}

interface PredictionPortfolioResponse {
  summary:               PredictionSummary;
  activeMarketPositions: ActiveMarketGroup[];
  meta: { isEmpty: boolean; generatedAt: string };
}

interface HistoryCard {
  positionId:      number;
  marketId:        number;
  marketTitle:     string;
  outcome: { outcomeId: number; code: string | null; label: string } | null;
  quantity:        string | null;
  avgPrice:        string | null;
  costBasis:       string | null;
  status:          string;
  payout:          string | null;
  realizedPnl:     string | null;
  payoutAt:        string | null;
  marketSettledAt: string | null;
  createdAt:       string;
}

// ─── Data hooks ───────────────────────────────────────────────────────────────

function useWallets() {
  return useQuery<WalletSummary>({
    queryKey: ["/api/wallets/me"],
    queryFn: async () => {
      const res = await fetch("/api/wallets/me", { credentials: "include" });
      if (!res.ok) return { userId: "", wallets: [] };
      return res.json();
    },
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
}

function usePredictionPortfolio() {
  const predictEnabled = isPredictEnabled();
  return useQuery<PredictionPortfolioResponse | null>({
    queryKey: ["/api/predictions/me/portfolio"],
    queryFn: async () => {
      const res = await fetch("/api/predictions/me/portfolio", { credentials: "include" });
      if (res.status === 401 || res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to load prediction portfolio");
      return res.json();
    },
    enabled:         predictEnabled,
    staleTime:       15_000,
    refetchInterval: predictEnabled ? 30_000 : false,
  });
}

function usePredictionHistory() {
  const predictEnabled = isPredictEnabled();
  return useQuery<{ positions: HistoryCard[] }>({
    queryKey: ["/api/predictions/me/history"],
    queryFn: async () => {
      const res = await fetch("/api/predictions/me/history", { credentials: "include" });
      if (!res.ok) return { positions: [] };
      return res.json();
    },
    enabled:   predictEnabled,
    staleTime: 20_000,
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function gs(amount: string | number | null | undefined): string {
  const n = typeof amount === "string" ? parseFloat(amount) : (amount ?? 0);
  if (isNaN(n)) return "GS$ 0.00";
  return `GS$ ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pnlColor(val: string | number | null | undefined, pos: string, neg: string, zero: string = pos): string {
  const n = typeof val === "string" ? parseFloat(val) : (val ?? 0);
  if (isNaN(n) || n === 0) return zero;
  return n > 0 ? pos : neg;
}

function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function marketStatusBadge(status: string) {
  const map: Record<string, { label: string; cls: string }> = {
    open:      { label: "LIVE",     cls: "text-emerald-400 border-emerald-500/30 bg-emerald-950/40" },
    locked:    { label: "LOCKED",   cls: "text-amber-400 border-amber-500/30 bg-amber-950/40" },
    resolved:  { label: "RESOLVED", cls: "text-cyan-400 border-cyan-500/30 bg-cyan-950/40" },
    settled:   { label: "SETTLED",  cls: "text-zinc-400 border-zinc-600/30 bg-zinc-900/40" },
    cancelled: { label: "VOID",     cls: "text-rose-400 border-rose-500/30 bg-rose-950/40" },
  };
  const v = map[status] ?? { label: status.toUpperCase(), cls: "text-zinc-500 border-zinc-700/30 bg-zinc-900/30" };
  return (
    <span className={`inline-flex items-center px-1.5 py-[2px] rounded text-[9px] font-mono font-bold border ${v.cls}`}>
      {v.label}
    </span>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, icon: Icon, color = "text-white", testId,
}: {
  label: string; value: string; sub?: string;
  icon?: React.FC<{ className?: string }>; color?: string; testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className="glass-panel rounded-2xl p-4 flex flex-col gap-2 relative overflow-hidden"
    >
      <div className="absolute -top-4 -right-4 w-16 h-16 rounded-full blur-2xl pointer-events-none bg-white/[0.02]" />
      <div className="flex items-center gap-1.5 text-zinc-500">
        {Icon && <Icon className="w-3 h-3 shrink-0" />}
        <span className="text-[10px] font-bold uppercase tracking-widest">{label}</span>
      </div>
      <p className={`font-mono font-bold text-xl leading-tight ${color}`}>{value}</p>
      {sub && <p className="text-[10px] text-zinc-600">{sub}</p>}
    </div>
  );
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return <div className={`bg-white/[0.05] rounded animate-pulse ${className}`} />;
}

// ─── Empty state ─────────────────────────────────────────────────────────────

function EmptyState({ icon: Icon, title, body, href, linkLabel }: {
  icon: React.FC<{ className?: string }>;
  title: string; body: string;
  href?: string; linkLabel?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="w-14 h-14 rounded-2xl bg-zinc-900 border border-white/[0.06] flex items-center justify-center">
        <Icon className="w-7 h-7 text-zinc-600" />
      </div>
      <div>
        <p className="text-sm font-semibold text-zinc-400">{title}</p>
        <p className="text-[12px] text-zinc-600 mt-0.5 max-w-xs">{body}</p>
      </div>
      {href && linkLabel && (
        <Link href={href} className="mt-1 text-xs font-semibold text-cyan-400 hover:underline">
          {linkLabel} →
        </Link>
      )}
    </div>
  );
}

// ─── Tab button ───────────────────────────────────────────────────────────────

function Tab({ active, onClick, children, count }: {
  active: boolean; onClick: () => void; children: React.ReactNode; count?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-4 py-2 text-[12px] font-bold rounded-lg transition-all ${
        active
          ? "bg-white/[0.08] text-white"
          : "text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.04]"
      }`}
    >
      {children}
      {count != null && count > 0 && (
        <span className={`text-[10px] font-black px-1.5 py-[1px] rounded-full ${active ? "bg-cyan-500/20 text-cyan-400" : "bg-white/[0.06] text-zinc-500"}`}>
          {count}
        </span>
      )}
    </button>
  );
}

// ─── Side label resolver ──────────────────────────────────────────────────────
// Prefer team abbreviation when the stored outcomeLabel is a generic code ("yes"/"no").
// Falls back to the raw label when the label is already a meaningful name.

function resolveSideLabel(
  outcomeCode: string | null,
  outcomeLabel: string,
  event: ActiveMarketGroup["event"],
): string {
  const isGeneric = ["yes", "no", "team_a", "team_b"].includes((outcomeLabel ?? "").toLowerCase());
  if (isGeneric && event) {
    if ((outcomeCode?.toLowerCase() === "yes" || outcomeCode === "TEAM_A") && event.teamAName) {
      return abbreviateTeam(event.teamAName) || outcomeLabel;
    }
    if ((outcomeCode?.toLowerCase() === "no" || outcomeCode === "TEAM_B") && event.teamBName) {
      return abbreviateTeam(event.teamBName) || outcomeLabel;
    }
  }
  // Label already meaningful (e.g. team name) — abbreviate if long, else keep as-is
  const abbrev = abbreviateTeam(outcomeLabel);
  return abbrev || outcomeLabel;
}

// ─── Prediction positions table ───────────────────────────────────────────────

function PredictionPositionsTable({ groups }: { groups: ActiveMarketGroup[] }) {
  const { open } = useTradeCard();

  if (groups.length === 0) {
    return (
      <EmptyState
        icon={BarChart2}
        title="No open prediction positions"
        body="Browse live markets and place your first trade to get started."
        href="/predictions"
        linkLabel="Browse markets"
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => {
        const gameShort: Record<string, string> = { lol: "LOL", val: "VAL", cs2: "CS2", dota2: "DOTA2", ow2: "OW2", r6: "R6", cod: "COD" };
        const game = group.event?.game ? (gameShort[group.event.game] ?? group.event.game.toUpperCase()) : null;
        const matchup = group.event?.teamAName && group.event?.teamBName
          ? `${group.event.teamAName} vs ${group.event.teamBName}`
          : group.marketTitle;
        const tournament = group.event?.tournamentName ?? null;

        return (
          <div
            key={group.marketId}
            data-testid={`prediction-market-group-${group.marketId}`}
            className="rounded-xl border border-white/[0.07] bg-[#07090F] overflow-hidden"
          >
            {/* Market header */}
            <div className="flex items-center gap-2.5 px-4 py-3 border-b border-white/[0.05] bg-white/[0.02]">
              {game && (
                <span className="text-[9px] font-mono font-black tracking-widest text-zinc-500 border border-zinc-700/40 bg-zinc-900/60 px-1.5 py-[2px] rounded">
                  {game}
                </span>
              )}
              <span className="text-[13px] font-bold text-white truncate flex-1" title={matchup}>{matchup}</span>
              {tournament && <span className="text-[10px] font-mono text-zinc-600 truncate max-w-[140px]">{tournament}</span>}
              {marketStatusBadge(group.marketStatus)}
              {group.userCanTrade && (
                <span className="text-[9px] font-mono text-emerald-500">tradable</span>
              )}
            </div>

            {/* Outcomes */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse whitespace-nowrap">
                <thead>
                  <tr className="border-b border-white/[0.04]">
                    {["Side", "Shares", "Avg Cost", "Current", "Value", "Unrealized PnL", ""].map((h, i) => (
                      <th key={i} className={`px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-zinc-600 ${i > 0 ? "text-right" : ""}`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.03]">
                  {group.outcomesHeld.map((outcome) => {
                    const qty    = parseFloat(outcome.quantity ?? "0");
                    const avg    = parseFloat(outcome.avgPrice ?? "0");
                    const curr   = outcome.currentPrice != null ? parseFloat(outcome.currentPrice) : null;
                    const val    = outcome.marketValue != null ? parseFloat(outcome.marketValue) : null;
                    const upnl   = outcome.unrealizedPnl != null ? parseFloat(outcome.unrealizedPnl) : null;
                    const canBuy  = group.userCanTrade;
                    const canSell = group.userCanTrade && qty > 0;

                    return (
                      <tr key={outcome.positionId} data-testid={`row-prediction-position-${outcome.positionId}`} className="hover:bg-white/[0.02] transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full flex-none ${outcome.outcomeCode === "yes" || outcome.outcomeCode === "TEAM_A" ? "bg-cyan-400" : "bg-rose-400"}`} />
                            <span className="text-[13px] font-semibold text-white font-mono">
                              {resolveSideLabel(outcome.outcomeCode, outcome.outcomeLabel, group.event)}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-[13px] text-white" data-testid={`text-shares-${outcome.positionId}`}>
                          {qty.toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-[13px] text-zinc-400">
                          {(avg * 100).toFixed(0)}¢
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-[13px] text-white">
                          {curr != null ? `${(curr * 100).toFixed(0)}¢` : "—"}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-[13px] text-white font-medium">
                          {val != null ? gs(val) : "—"}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-[13px]">
                          {upnl != null ? (
                            <span className={`font-bold ${pnlColor(upnl, "text-emerald-400", "text-rose-400", "text-zinc-500")}`}>
                              {upnl >= 0 ? "+" : ""}{gs(upnl)}
                            </span>
                          ) : (
                            <span className="text-zinc-600">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              data-testid={`button-buy-more-${outcome.positionId}`}
                              disabled={!canBuy}
                              onClick={() => open({
                                type:      "prediction",
                                marketId:  group.marketId,
                                sideId:    outcome.outcomeId,
                                sideLabel: resolveSideLabel(outcome.outcomeCode, outcome.outcomeLabel, group.event),
                                price:     outcome.currentPrice ?? outcome.avgPrice ?? "0.5",
                                action:    "BUY",
                                question:  group.marketTitle,
                              })}
                              className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-cyan-300 border border-cyan-700/40 bg-cyan-950/40 hover:bg-cyan-950/70 disabled:opacity-25 disabled:cursor-not-allowed transition-all"
                            >
                              Buy
                            </button>
                            <button
                              data-testid={`button-sell-${outcome.positionId}`}
                              disabled={!canSell}
                              onClick={() => open({
                                type:      "prediction",
                                marketId:  group.marketId,
                                sideId:    outcome.outcomeId,
                                sideLabel: resolveSideLabel(outcome.outcomeCode, outcome.outcomeLabel, group.event),
                                price:     outcome.currentPrice ?? outcome.avgPrice ?? "0.5",
                                action:    "SELL",
                                question:  group.marketTitle,
                              })}
                              className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-rose-400 border border-rose-800/40 bg-rose-950/40 hover:bg-rose-950/70 disabled:opacity-25 disabled:cursor-not-allowed transition-all"
                            >
                              Sell
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Market footer: aggregates */}
            {group.outcomesHeld.length > 1 && (
              <div className="flex items-center gap-4 px-4 py-2.5 border-t border-white/[0.04] bg-white/[0.01]">
                <span className="text-[10px] text-zinc-600 font-mono">Total cost: <span className="text-zinc-400">{gs(group.totalCostBasis)}</span></span>
                {group.totalMarketValue && (
                  <span className="text-[10px] text-zinc-600 font-mono">Market value: <span className="text-zinc-300">{gs(group.totalMarketValue)}</span></span>
                )}
                {group.unrealizedPnl && (
                  <span className={`text-[10px] font-mono font-bold ${pnlColor(group.unrealizedPnl, "text-emerald-400", "text-rose-400", "text-zinc-500")}`}>
                    uPnL: {parseFloat(group.unrealizedPnl) >= 0 ? "+" : ""}{gs(group.unrealizedPnl)}
                    {group.hasPartialPricing && <span className="text-zinc-600 font-normal"> (partial)</span>}
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Terminal positions table ─────────────────────────────────────────────────

function TerminalPositionsTable({ positions }: { positions: any[] }) {
  const { dispatch } = useTerminal();

  if (positions.length === 0) {
    return (
      <EmptyState
        icon={BarChart2}
        title="No Terminal positions"
        body="Trade player shares in the Terminal to build your positions."
        href="/terminal"
        linkLabel="Open Terminal"
      />
    );
  }

  return (
    <div className="rounded-xl border border-white/[0.07] bg-[#07090F] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse whitespace-nowrap">
          <thead>
            <tr className="border-b border-white/[0.04] bg-white/[0.02]">
              {["Player", "Shares", "Avg Cost", "Market Price", "Value", "Unrealized PnL", ""].map((h, i) => (
                <th key={i} className={`px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-zinc-600 ${i > 0 ? "text-right" : ""}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.03]">
            {positions.map((pos: any, idx: number) => {
              const pnl         = parseFloat(pos.unrealizedPnL ?? pos.unrealizedPnl ?? "0");
              const displayName = pos.displayName ?? pos.vault?.playerAlias ?? "Unknown";
              const badge       = String(pos.badge ?? pos.vault?.region ?? "—").toUpperCase().slice(0, 3);
              const marketPrice = pos.marketPrice ?? pos.vault?.lastTradePrice ?? "0";
              const shares      = parseFloat(pos.shares ?? "0");
              const avgCost     = parseFloat(pos.averageCost ?? "0");
              const costBasis   = shares * avgCost;
              const pnlPct      = costBasis > 0 ? (pnl / costBasis) * 100 : 0;
              const pnlCls      = pnlColor(pnl, "text-emerald-400", "text-rose-400", "text-zinc-500");
              const canTrade    = !!pos.assetId;

              const handleTrade = () => {
                if (!canTrade) return;
                const row: MarketRow = {
                  id: pos.assetId,
                  assetUid: pos.assetUid ?? "",
                  displayName,
                  lastTradePrice: marketPrice,
                  price24hAgo: marketPrice,
                  volume24h: "0",
                  momentum: "0",
                  bidPrice: marketPrice,
                  askPrice: marketPrice,
                  spreadPct: "0",
                  market: {
                    provider: "terminal",
                    game: "—",
                    region: pos.vault?.region ?? "—",
                    scope: "player",
                  },
                };
                dispatch({ type: "SELECT_ASSET", asset: row });
                dispatch({ type: "OPEN_TRADE_MODAL", side: "SELL" });
              };

              return (
                <tr
                  key={`terminal-${pos.id ?? pos.vaultId ?? idx}`}
                  data-testid={`row-terminal-position-${pos.id}`}
                  className="transition-colors"
                >
                  {/* Player cell */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-violet-950/60 border border-violet-500/20 flex items-center justify-center text-[9px] font-black font-mono text-violet-400 flex-none">
                        {badge}
                      </div>
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-white truncate max-w-[160px] leading-tight">{displayName}</p>
                        <p className="text-[10px] text-zinc-600 leading-tight mt-0.5">Player · {badge}</p>
                      </div>
                    </div>
                  </td>

                  {/* Shares */}
                  <td className="px-4 py-3 text-right font-mono text-[13px] text-white">{shares}</td>

                  {/* Avg Cost */}
                  <td className="px-4 py-3 text-right font-mono text-[13px] text-zinc-400">{formatCurrency(avgCost)}</td>

                  {/* Market Price */}
                  <td className="px-4 py-3 text-right font-mono text-[13px] text-white">{formatCurrency(marketPrice)}</td>

                  {/* Value */}
                  <td className="px-4 py-3 text-right font-mono text-[13px] text-white font-medium">{formatCurrency(pos.currentValue)}</td>

                  {/* Unrealized PnL — value + % */}
                  <td className="px-4 py-3 text-right font-mono text-[13px]">
                    <div className={`font-bold flex flex-col items-end gap-0 ${pnlCls}`}>
                      <span className="flex items-center gap-1 leading-tight">
                        {pnl >= 0 ? <ArrowUpRight className="w-3 h-3 shrink-0" /> : <ArrowDownRight className="w-3 h-3 shrink-0" />}
                        {pnl >= 0 ? "+" : ""}{formatCurrency(pos.unrealizedPnL ?? pos.unrealizedPnl)}
                      </span>
                      {costBasis > 0 && (
                        <span className="text-[10px] opacity-60 font-semibold">
                          {pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(1)}%
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Trade button — only clickable element in the row */}
                  <td className="px-4 py-3 text-right">
                    <button
                      data-testid={`button-trade-${pos.id}`}
                      onClick={handleTrade}
                      disabled={!canTrade}
                      className="px-3 py-1.5 rounded-lg text-[11px] font-bold border border-white/[0.08] text-white/50 hover:text-cyan-400 hover:border-cyan-700/40 hover:bg-cyan-950/30 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      Trade
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── History table ────────────────────────────────────────────────────────────

function HistoryTable({ items }: { items: HistoryCard[] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={Clock}
        title="No history yet"
        body="Completed and cancelled positions will appear here."
      />
    );
  }

  return (
    <div className="rounded-xl border border-white/[0.07] bg-[#07090F] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse whitespace-nowrap">
          <thead>
            <tr className="border-b border-white/[0.04] bg-white/[0.02]">
              {["Market", "Side", "Shares", "Cost Basis", "Payout", "Realized PnL", "Status", "Date"].map((h, i) => (
                <th key={i} className={`px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-zinc-600 ${i > 0 ? "text-right" : ""}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.03]">
            {items.map((item) => {
              const pnl    = item.realizedPnl != null ? parseFloat(item.realizedPnl) : null;
              const payout = item.payout != null ? parseFloat(item.payout) : null;
              const date   = formatDate(item.payoutAt ?? item.marketSettledAt ?? item.createdAt);

              return (
                <tr key={item.positionId} data-testid={`row-history-${item.positionId}`} className="hover:bg-white/[0.02] transition-colors">
                  <td className="px-4 py-3 max-w-[220px]">
                    <p className="text-[13px] font-semibold text-white truncate" title={item.marketTitle}>{item.marketTitle}</p>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded border ${
                      item.outcome?.code === "yes" || item.outcome?.code === "TEAM_A"
                        ? "text-cyan-300 border-cyan-700/35 bg-cyan-950/40"
                        : "text-rose-400 border-rose-800/35 bg-rose-950/40"
                    }`}>
                      {item.outcome?.label ?? item.outcome?.code?.toUpperCase() ?? "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-[13px] text-zinc-300">
                    {item.quantity != null ? parseFloat(item.quantity).toFixed(2) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-[13px] text-zinc-400">
                    {item.costBasis != null ? gs(item.costBasis) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-[13px] text-white">
                    {payout != null ? gs(payout) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-[13px]">
                    {pnl != null ? (
                      <span className={`font-bold ${pnlColor(pnl, "text-emerald-400", "text-rose-400", "text-zinc-500")}`}>
                        {pnl >= 0 ? "+" : ""}{gs(pnl)}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">{marketStatusBadge(item.status)}</td>
                  <td className="px-4 py-3 text-right font-mono text-[12px] text-zinc-500">{date}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Settlements table ────────────────────────────────────────────────────────

function SettlementsTable({ items }: { items: HistoryCard[] }) {
  const settled = items.filter(i => i.status === "settled");

  if (settled.length === 0) {
    return (
      <EmptyState
        icon={CheckCircle}
        title="No settlements yet"
        body="When prediction markets resolve, your payouts will appear here."
      />
    );
  }

  return (
    <div className="rounded-xl border border-white/[0.07] bg-[#07090F] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse whitespace-nowrap">
          <thead>
            <tr className="border-b border-white/[0.04] bg-white/[0.02]">
              {["Market", "Winning Side", "Shares Settled", "Gross Payout", "Realized PnL", "Settled At"].map((h, i) => (
                <th key={i} className={`px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-zinc-600 ${i > 0 ? "text-right" : ""}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.03]">
            {settled.map((item) => {
              const pnl    = item.realizedPnl != null ? parseFloat(item.realizedPnl) : null;
              const payout = item.payout != null ? parseFloat(item.payout) : null;
              const date   = formatDate(item.payoutAt ?? item.marketSettledAt);

              return (
                <tr key={item.positionId} data-testid={`row-settlement-${item.positionId}`} className="hover:bg-white/[0.02] transition-colors">
                  <td className="px-4 py-3 max-w-[220px]">
                    <p className="text-[13px] font-semibold text-white truncate" title={item.marketTitle}>{item.marketTitle}</p>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded border ${
                      item.outcome?.code === "yes" || item.outcome?.code === "TEAM_A"
                        ? "text-cyan-300 border-cyan-700/35 bg-cyan-950/40"
                        : "text-rose-400 border-rose-800/35 bg-rose-950/40"
                    }`}>
                      {item.outcome?.label ?? item.outcome?.code?.toUpperCase() ?? "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-[13px] text-zinc-300">
                    {item.quantity != null ? parseFloat(item.quantity).toFixed(2) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-[13px] text-white font-medium">
                    {payout != null ? gs(payout) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-[13px]">
                    {pnl != null ? (
                      <span className={`font-bold flex items-center justify-end gap-1 ${pnlColor(pnl, "text-emerald-400", "text-rose-400", "text-zinc-500")}`}>
                        {pnl >= 0 ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                        {pnl >= 0 ? "+" : ""}{gs(pnl)}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-[12px] text-zinc-500">{date}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

type MainTab = "positions" | "history" | "settlements";
type PosFilter = "all" | "predictions" | "terminal";

export default function PortfolioPage() {
  const [mainTab,   setMainTab]   = useState<MainTab>("positions");
  const [posFilter, setPosFilter] = useState<PosFilter>("all");

  const { data: walletData,   isLoading: walletLoading }    = useWallets();
  const { data: predPortfolio, isLoading: predLoading }     = usePredictionPortfolio();
  const { data: historyData,  isLoading: historyLoading }   = usePredictionHistory();
  const { data: terminalData, isLoading: terminalLoading }  = usePortfolio();

  // ── GS wallet ──────────────────────────────────────────────────────────────
  const gsWallet = walletData?.wallets.find(w => w.currency === "GS") ?? {
    availableBalance: "0", lockedBalance: "0", totalBalance: "0",
  };
  const gsAvail  = parseFloat(gsWallet.availableBalance);
  const gsLocked = parseFloat(gsWallet.lockedBalance);
  const gsTotal  = parseFloat(gsWallet.totalBalance);

  // ── Prediction summary ─────────────────────────────────────────────────────
  const summary      = predPortfolio?.summary;
  const predGroups   = predPortfolio?.activeMarketPositions ?? [];
  const historyItems = historyData?.positions ?? [];

  // ── Terminal positions ─────────────────────────────────────────────────────
  const terminalPositions = useMemo(
    () => (terminalData?.positions as any[]) ?? [],
    [terminalData]
  );

  // ── Counts for tabs ────────────────────────────────────────────────────────
  const predCount     = predGroups.length;
  const terminalCount = terminalPositions.length;
  const historyCount  = historyItems.length;
  const settledCount  = historyItems.filter(h => h.status === "settled").length;

  // ── Stat computations ──────────────────────────────────────────────────────
  // Total equity = GS total + open exposure (indicative; wallet is source of truth)
  const openExposure = parseFloat(summary?.openExposure ?? "0");
  const totalEquity  = gsTotal + openExposure;

  const isLoading = walletLoading || predLoading;

  if (isLoading) {
    return (
      <div className="flex flex-col gap-8 pb-20">
        <Skeleton className="h-9 w-48" />
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-72" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 animate-in fade-in duration-500 pb-24">

      {/* ─── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-white tracking-tight">Portfolio</h1>
          <p className="text-zinc-500 text-sm mt-0.5">
            Manage your positions across Prediction Markets and Terminal.
          </p>
        </div>
        {summary && !predPortfolio?.meta.isEmpty && (
          <div className="flex items-center gap-1.5 text-[10px] font-mono text-zinc-600 mt-1 shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            {summary.activeMarkets} active market{summary.activeMarkets !== 1 ? "s" : ""}
          </div>
        )}
      </div>

      {/* ─── Summary cards ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatCard
          testId="stat-gs-available"
          icon={Wallet}
          label="Buying Power"
          value={gs(gsAvail)}
          color="text-cyan-200"
        />
        <StatCard
          testId="stat-gs-locked"
          icon={Lock}
          label="GS Locked"
          value={gs(gsLocked)}
          color={gsLocked > 0 ? "text-amber-300" : "text-zinc-500"}
          sub={gsLocked > 0 ? "in open orders/positions" : undefined}
        />
        <StatCard
          testId="stat-total-equity"
          icon={ShieldCheck}
          label="Total Value"
          value={gs(totalEquity)}
          color="text-white"
          sub="wallet + open exposure"
        />
        <StatCard
          testId="stat-open-exposure"
          icon={Briefcase}
          label="Open Exposure"
          value={gs(openExposure)}
          color="text-white"
          sub={`${summary?.activePositions ?? 0} position${(summary?.activePositions ?? 0) !== 1 ? "s" : ""}`}
        />
        <StatCard
          testId="stat-realized-pnl"
          icon={summary && parseFloat(summary.realizedPnl) >= 0 ? TrendingUp : TrendingDown}
          label="Realized PnL"
          value={(() => {
            const v = parseFloat(summary?.realizedPnl ?? "0");
            return `${v >= 0 ? "+" : ""}${gs(v)}`;
          })()}
          color={pnlColor(summary?.realizedPnl ?? "0", "text-emerald-400", "text-rose-400", "text-zinc-500")}
        />
        <StatCard
          testId="stat-unrealized-pnl"
          icon={Activity}
          label="Unrealized PnL"
          value={(() => {
            if (summary?.unrealizedPnl == null) return "—";
            const v = parseFloat(summary.unrealizedPnl);
            return `${v >= 0 ? "+" : ""}${gs(v)}`;
          })()}
          color={summary?.unrealizedPnl != null
            ? pnlColor(summary.unrealizedPnl, "text-emerald-400", "text-rose-400", "text-zinc-500")
            : "text-zinc-600"}
          sub={summary?.hasPartialPricing ? "indicative (partial)" : summary?.unrealizedPnl != null ? "indicative" : undefined}
        />
      </div>

      {/* ─── Main tabs ───────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 border-b border-white/[0.06] pb-0">
        <Tab active={mainTab === "positions"} onClick={() => setMainTab("positions")} count={predCount + terminalCount}>
          Open Positions
        </Tab>
        <Tab active={mainTab === "history"} onClick={() => setMainTab("history")} count={historyCount}>
          History
        </Tab>
        <Tab active={mainTab === "settlements"} onClick={() => setMainTab("settlements")} count={settledCount}>
          Settlements
        </Tab>
      </div>

      {/* ─── Open Positions tab ──────────────────────────────────────────── */}
      {mainTab === "positions" && (
        <div className="flex flex-col gap-4">
          {/* Sub-filter */}
          <div className="flex items-center gap-1">
            {(["all", ...(isPredictEnabled() ? ["predictions"] : []), "terminal"] as PosFilter[]).map(f => (
              <button
                key={f}
                onClick={() => setPosFilter(f)}
                className={`px-3 py-1 rounded-lg text-[11px] font-bold transition-all capitalize ${
                  posFilter === f
                    ? "bg-white/[0.07] text-white"
                    : "text-zinc-600 hover:text-zinc-400"
                }`}
              >
                {f === "all" ? `All (${isPredictEnabled() ? predCount + terminalCount : terminalCount})` : f === "predictions" ? `Predictions (${predCount})` : `Terminal (${terminalCount})`}
              </button>
            ))}
          </div>

          {/* Predictions section — only rendered when Predict feature is enabled */}
          {isPredictEnabled() && (posFilter === "all" || posFilter === "predictions") && (
            <div>
              {posFilter === "all" && (predCount > 0 || terminalCount > 0) && (
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">Prediction Markets</span>
                  <div className="flex-1 h-px bg-white/[0.04]" />
                </div>
              )}
              <PredictionPositionsTable groups={predGroups} />
            </div>
          )}

          {/* Terminal section */}
          {(posFilter === "all" || posFilter === "terminal") && (
            <div>
              {posFilter === "all" && terminalCount > 0 && (
                <div className="flex items-center gap-2 mb-3 mt-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">Terminal · Player Shares</span>
                  <div className="flex-1 h-px bg-white/[0.04]" />
                  <Link href="/terminal" className="text-[10px] text-zinc-600 hover:text-cyan-400 transition-colors">Terminal →</Link>
                </div>
              )}
              {!terminalLoading && <TerminalPositionsTable positions={terminalPositions} />}
              {terminalLoading && <Skeleton className="h-32" />}
            </div>
          )}
        </div>
      )}

      {/* ─── History tab ─────────────────────────────────────────────────── */}
      {mainTab === "history" && (
        <div>
          {historyLoading
            ? <Skeleton className="h-48" />
            : <HistoryTable items={historyItems} />
          }
        </div>
      )}

      {/* ─── Settlements tab ─────────────────────────────────────────────── */}
      {mainTab === "settlements" && (
        <div>
          {historyLoading
            ? <Skeleton className="h-48" />
            : <SettlementsTable items={historyItems} />
          }
        </div>
      )}
    </div>
  );
}

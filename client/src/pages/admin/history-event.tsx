import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { PredictAdminLayout, AdminSectionCard, StatusBadge } from "./predict-layout";
import { ArrowLeft, RefreshCw, Trophy, Coins, Users, TrendingUp, CheckCircle2, XCircle } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type MarketHistoryItem = {
  marketId:          number;
  question:          string;
  status:            string;
  poolTotal:         string;
  resolvedOutcomeId: number | null;
  winnerLabel:       string | null;
  settledAt:         string | null;
  updatedAt:         string;
  settledPositions:  number;
  totalGrossPayout:  string | null;
  totalNetPayout:    string | null;
};

type SettlementSummary = {
  totalSettledPositions:  number;
  totalGrossPayout:       string | null;
  totalNetPayout:         string | null;
  latestSettlementAt:     string | null;
  cancelledPositionCount: number;
};

type EventHistorySummary = {
  event: {
    id:             number;
    uid:            string;
    title:          string;
    game:           string;
    region:         string | null;
    tournamentName: string | null;
    eventName:      string | null;
    teamAName:      string | null;
    teamBName:      string | null;
    startsAt:       string | null;
    status:         string;
    externalRef:    string | null;
    createdAt:      string;
    updatedAt:      string;
  };
  markets:           MarketHistoryItem[];
  settlementSummary: SettlementSummary;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="text-[11px] font-mono text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className="text-sm text-white font-medium">
        {value ?? <span className="text-muted-foreground/50 italic">—</span>}
      </div>
    </div>
  );
}

function fmtNum(n: string | null | undefined, decimals = 2): string {
  if (!n) return "—";
  const v = parseFloat(n);
  if (isNaN(v)) return "—";
  return v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  return new Date(s).toLocaleString();
}

function StatCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="flex items-start gap-3 p-4 rounded-xl border border-white/[0.07] bg-white/[0.02]">
      <div className={`mt-0.5 ${accent ?? "text-muted-foreground"}`}>{icon}</div>
      <div>
        <div className="text-[11px] font-mono text-muted-foreground uppercase tracking-wider">{label}</div>
        <div className={`text-lg font-bold mt-0.5 ${accent ?? "text-white"}`}>{value}</div>
      </div>
    </div>
  );
}

// ── Market Row ────────────────────────────────────────────────────────────────

function MarketRow({ m }: { m: MarketHistoryItem }) {
  const isTerminal = ["settled", "resolved", "cancelled"].includes(m.status);
  return (
    <div
      data-testid={`row-market-${m.marketId}`}
      className="flex flex-col sm:flex-row sm:items-center gap-3 py-4 border-b border-white/[0.05] last:border-0"
    >
      {/* Question */}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-white">{m.question}</div>
        <div className="flex flex-wrap items-center gap-2 mt-1">
          <span className="text-xs font-mono text-muted-foreground">#{m.marketId}</span>
          <span className="text-muted-foreground/30">·</span>
          <span className="text-xs text-muted-foreground">Pool: {fmtNum(m.poolTotal)} GS</span>
          {m.settledAt && (
            <>
              <span className="text-muted-foreground/30">·</span>
              <span className="text-xs text-muted-foreground">Settled {new Date(m.settledAt).toLocaleDateString()}</span>
            </>
          )}
        </div>
      </div>

      {/* Winner / Result */}
      <div className="flex items-center gap-3 shrink-0">
        {m.winnerLabel ? (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
            <Trophy className="w-3 h-3 text-emerald-400" />
            <span className="text-xs text-emerald-300 font-medium">{m.winnerLabel}</span>
          </div>
        ) : isTerminal ? (
          <span className="text-xs text-muted-foreground/50 italic">
            {m.status === "cancelled" ? "Cancelled (no winner)" : "No winner recorded"}
          </span>
        ) : null}

        {/* Settlement micro-summary */}
        {m.settledPositions > 0 && (
          <div className="text-[11px] font-mono text-muted-foreground">
            {m.settledPositions} settled · {fmtNum(m.totalNetPayout)} net
          </div>
        )}

        <StatusBadge status={m.status} />
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminHistoryEventPage() {
  const { eventId } = useParams<{ eventId: string }>();

  const { data, isLoading, isError } = useQuery<EventHistorySummary>({
    queryKey: ["/api/admin/predictions/events", eventId, "history-summary"],
    queryFn: async () => {
      const res = await fetch(`/api/admin/predictions/events/${eventId}/history-summary`, {
        credentials: "include",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load history summary");
      return json;
    },
    enabled: !!eventId,
  });

  if (isLoading) {
    return (
      <PredictAdminLayout title="Loading…" breadcrumb="History">
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="w-6 h-6 text-cyan-400 animate-spin" />
        </div>
      </PredictAdminLayout>
    );
  }

  if (isError || !data) {
    return (
      <PredictAdminLayout title="Not Found" breadcrumb="History">
        <div className="text-center py-20 text-muted-foreground">
          Event #{eventId} not found or failed to load.
        </div>
      </PredictAdminLayout>
    );
  }

  const { event: ev, markets, settlementSummary: ss } = data;
  const hasSettlements = ss.totalSettledPositions > 0;

  return (
    <PredictAdminLayout title={`#${ev.id}`} subtitle={ev.title} breadcrumb="History">

      {/* Back */}
      <div className="flex items-center justify-between">
        <Link href="/admin/history">
          <button
            data-testid="button-back-to-history"
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-white transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to history
          </button>
        </Link>
        <div className="flex items-center gap-2">
          <StatusBadge status={ev.status} />
          <span className="text-xs font-mono text-muted-foreground/50">{ev.uid}</span>
        </div>
      </div>

      {/* Settlement Summary */}
      <AdminSectionCard
        title="Distribution Summary"
        description="Aggregated payout and settlement data across all markets in this event"
      >
        {!hasSettlements ? (
          <p className="text-sm text-muted-foreground/60 italic py-2">
            No settlements recorded for this event yet.
            {markets.length === 0 ? " No markets found." : " Markets may still be pending resolution."}
          </p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              icon={<Users className="w-4 h-4" />}
              label="Settled Positions"
              value={ss.totalSettledPositions.toString()}
              accent="text-emerald-400"
            />
            <StatCard
              icon={<TrendingUp className="w-4 h-4" />}
              label="Gross Payouts"
              value={fmtNum(ss.totalGrossPayout) + " GS"}
              accent="text-cyan-400"
            />
            <StatCard
              icon={<Coins className="w-4 h-4" />}
              label="Net Payouts"
              value={fmtNum(ss.totalNetPayout) + " GS"}
              accent="text-violet-400"
            />
            <StatCard
              icon={<XCircle className="w-4 h-4" />}
              label="Cancelled (Refunds)"
              value={ss.cancelledPositionCount.toString()}
              accent="text-amber-400"
            />
          </div>
        )}

        {ss.latestSettlementAt && (
          <p className="mt-3 text-[11px] text-muted-foreground/50 font-mono">
            Latest settlement: {fmtDate(ss.latestSettlementAt)}
          </p>
        )}
      </AdminSectionCard>

      {/* Event Metadata */}
      <AdminSectionCard title="Event Metadata" description="Core fields of the prediction event">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
          <Field label="Title"        value={ev.title} />
          <Field label="Game"         value={ev.game} />
          <Field label="Region"       value={ev.region} />
          <Field label="Tournament"   value={ev.tournamentName} />
          <Field label="Event Name"   value={ev.eventName} />
          <Field label="Status"       value={ev.status} />
          <Field label="Team A"       value={ev.teamAName} />
          <Field label="Team B"       value={ev.teamBName} />
          <Field label="Starts At"    value={ev.startsAt ? new Date(ev.startsAt).toLocaleString() : null} />
          <Field label="External Ref" value={ev.externalRef} />
          <Field label="Created"      value={new Date(ev.createdAt).toLocaleString()} />
          <Field label="Updated"      value={new Date(ev.updatedAt).toLocaleString()} />
        </div>
      </AdminSectionCard>

      {/* Markets */}
      <AdminSectionCard
        title={`Markets (${markets.length})`}
        description="All prediction markets linked to this event — status, winner, and settlement"
      >
        {markets.length === 0 ? (
          <p className="text-sm text-muted-foreground/60 italic py-4 text-center">
            No markets linked to this event.
          </p>
        ) : (
          <div className="flex flex-col">
            {/* Column header */}
            <div className="hidden sm:grid grid-cols-[1fr_auto] gap-4 pb-2 border-b border-white/[0.06]">
              <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Market / Pool</span>
              <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider text-right">Winner · Settlement</span>
            </div>

            {markets.map((m) => (
              <MarketRow key={m.marketId} m={m} />
            ))}
          </div>
        )}
      </AdminSectionCard>

      {/* Quick links */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <Link href={`/admin/events/${ev.id}`} className="hover:text-white transition-colors flex items-center gap-1">
          <CheckCircle2 className="w-3.5 h-3.5" /> View Event Detail
        </Link>
        <span className="text-muted-foreground/20">·</span>
        <span className="text-muted-foreground/40 italic">
          Note: gross/net payout figures derive from prediction_settlements rows.
          Cancelled positions are counted as refund proxies (wallet ledger confirms exact refund amounts).
        </span>
      </div>

    </PredictAdminLayout>
  );
}

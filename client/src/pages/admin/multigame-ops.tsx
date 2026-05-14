import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MultigameAdminLayout } from "./multigame-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiRequest } from "@/lib/queryClient";
import {
  RefreshCw,
  Activity,
  Users,
  FileCheck,
  AlertTriangle,
  Layers,
  ShieldCheck,
  TrendingUp,
  Zap,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type OpsSummary = {
  connectedAccounts: {
    total: number;
    byProviderGame:       Array<{ providerGroup: string; game: string | null; count: number }>;
    byVerificationStatus: Array<{ verificationStatus: string | null; count: number }>;
  };
  claims: {
    total:             number;
    byGameAndStatus:   Array<{ game: string | null; claimStatus: string | null; count: number }>;
    autoApprovedCount: number;
    manualPendingCount: number;
    rejectedCount:     number;
  };
  assets: {
    total:            number;
    byGameAndListing: Array<{ game: string | null; listingStatus: string | null; count: number }>;
    underReviewCount: number;
    listedCount:      number;
  };
  ownedAssets: {
    activeCount: number;
    byGame:      Array<{ game: string | null; count: number }>;
  };
  verificationEvents: {
    total:        number;
    byStatus:     Array<{ status: string | null; count: number }>;
    failedCount:  number;
    verifiedCount: number;
  };
  generatedAt: string;
};

type Troubleshooting = {
  recentVerificationFailures:   any[];
  pendingClaimsWithActiveOwner: any[];
  oldestPendingClaims:          any[];
  assetsWithOpenSubmission:     any[];
  generatedAt: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const GAME_LABEL: Record<string, string> = {
  dota2: "Dota2", cs2: "CS2", lol: "LoL", valorant: "VAL",
};
const gameLabel = (g: string | null) => (g ? (GAME_LABEL[g] ?? g) : "–");

function StatusDot({ status }: { status: string | null }) {
  const colors: Record<string, string> = {
    VERIFIED:     "bg-emerald-400",
    FAILED:       "bg-red-400",
    INITIATED:    "bg-yellow-400",
    REVOKED:      "bg-zinc-500",
    APPROVED:     "bg-emerald-400",
    AUTO_APPROVED: "bg-cyan-400",
    PENDING:      "bg-yellow-400",
    UNDER_REVIEW: "bg-blue-400",
    REJECTED:     "bg-red-400",
    CANCELLED:    "bg-zinc-500",
    LISTED:       "bg-emerald-400",
    ACTIVE:       "bg-emerald-400",
    DRAFT:        "bg-zinc-500",
  };
  const cls = colors[status ?? ""] ?? "bg-zinc-500";
  return <span className={`inline-block w-2 h-2 rounded-full ${cls} mr-1.5`} />;
}

function MetricCard({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ElementType;
  label: string;
  value: number | string;
  sub?: string;
  accent?: string;
}) {
  return (
    <Card className="bg-white/[0.03] border-white/[0.08]">
      <CardContent className="pt-5 pb-4 px-5">
        <div className="flex items-center gap-2 mb-3">
          <Icon className={`w-4 h-4 ${accent ?? "text-white/40"}`} />
          <span className="text-xs text-white/40 font-medium uppercase tracking-wider">{label}</span>
        </div>
        <div className="text-2xl font-bold text-white tabular-nums">{value}</div>
        {sub && <div className="text-xs text-white/30 mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function BreakdownTable({
  rows,
  cols,
  title,
}: {
  rows: any[];
  cols: Array<{ key: string; label: string; dot?: boolean; game?: boolean }>;
  title?: string;
}) {
  if (!rows.length) {
    return (
      <div className="text-xs text-white/30 px-3 py-2">
        {title && <span className="block text-white/40 font-medium mb-2">{title}</span>}
        No data.
      </div>
    );
  }
  return (
    <div>
      {title && <div className="text-xs text-white/40 font-semibold uppercase tracking-wider px-1 mb-2">{title}</div>}
      <div className="rounded-lg border border-white/[0.07] overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-white/[0.07] bg-white/[0.02]">
              {cols.map(c => (
                <th key={c.key} className="px-3 py-2 text-left font-medium text-white/40">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] transition-colors">
                {cols.map(c => (
                  <td key={c.key} className="px-3 py-2 text-white/70">
                    {c.game
                      ? gameLabel(r[c.key])
                      : c.dot
                      ? <><StatusDot status={r[c.key]} />{r[c.key] ?? "–"}</>
                      : r[c.key] ?? "–"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AlertRow({ label, count, severity }: { label: string; count: number; severity: "warn" | "error" | "info" }) {
  const colors = {
    warn:  "bg-amber-500/10 border-amber-500/20 text-amber-300",
    error: "bg-red-500/10 border-red-500/20 text-red-300",
    info:  "bg-blue-500/10 border-blue-500/20 text-blue-300",
  };
  return (
    <div className={`flex items-center justify-between px-3 py-2 rounded-lg border ${colors[severity]}`}>
      <span className="text-xs font-medium">{label}</span>
      <Badge className={`${colors[severity]} text-xs font-bold`}>{count}</Badge>
    </div>
  );
}

// ── Dota2 Bootstrap Panel ──────────────────────────────────────────────────────

type Dota2BootstrapStatus = {
  totalDota2Assets: number;
  listed: number;
  active: number;
  withFundamentalPrice: number;
  withLastTradePrice: number;
  withAmmSeeded: number;
};

type StepResult = { ok: boolean; msg: string } | null;

function Dota2BootstrapPanel() {
  const qc = useQueryClient();

  const statusQuery = useQuery<Dota2BootstrapStatus>({
    queryKey: ["/api/admin/dota2/bootstrap-status"],
    refetchInterval: 10_000,
  });

  const [stepResults, setStepResults] = useState<Record<string, StepResult>>({});
  const setStep = (key: string, result: StepResult) =>
    setStepResults(prev => ({ ...prev, [key]: result }));

  const makeStep = (key: string, path: string, body?: object) =>
    useMutation({
      mutationFn: () => apiRequest("POST", path, body),
      onSuccess: () => {
        setStep(key, { ok: true, msg: "Done" });
        qc.invalidateQueries({ queryKey: ["/api/admin/dota2/bootstrap-status"] });
      },
      onError: (e: any) => setStep(key, { ok: false, msg: e?.message ?? "Failed" }),
    });

  const bootstrapMut    = makeStep("bootstrap",   "/api/admin/dota2/bootstrap-market",      { limit: 800, activeOnly: false, basePrice: "15.00", force: false });
  const valSeedMut      = makeStep("valSeed",      "/api/admin/valuation/seed");
  const valRunMut       = makeStep("valRun",       "/api/admin/valuation/run");
  const backfillMut     = makeStep("backfill",     "/api/admin/trading/backfill-asset-links");
  const ammSeedMut      = makeStep("ammSeed",      "/api/admin/amm/seed");

  const st = statusQuery.data;
  const busy = bootstrapMut.isPending || valSeedMut.isPending || valRunMut.isPending
              || backfillMut.isPending || ammSeedMut.isPending;

  function StepBtn({
    label, mut, stepKey, disabled,
  }: { label: string; mut: ReturnType<typeof makeStep>; stepKey: string; disabled?: boolean }) {
    const res = stepResults[stepKey];
    return (
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="text-xs border-white/10 bg-white/[0.03] hover:bg-white/[0.07] text-white/70 min-w-[180px] justify-start"
          disabled={mut.isPending || !!disabled}
          onClick={() => { setStep(stepKey, null); mut.mutate(); }}
          data-testid={`btn-dota2-${stepKey}`}
        >
          {mut.isPending
            ? <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> Running…</>
            : <><Zap className="w-3 h-3 mr-1.5 text-amber-400" /> {label}</>}
        </Button>
        {res && (
          res.ok
            ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            : <span className="flex items-center gap-1 text-xs text-red-400">
                <XCircle className="w-4 h-4 shrink-0" /> {res.msg}
              </span>
        )}
      </div>
    );
  }

  return (
    <Card className="bg-white/[0.03] border-white/[0.08]">
      <CardHeader className="pb-2 pt-4 px-5">
        <CardTitle className="text-xs text-white/60 flex items-center gap-2">
          <Zap className="w-3.5 h-3.5 text-amber-400" />
          Dota2 Asset Bootstrap
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-5 space-y-4">
        {/* Status row */}
        <div className="flex flex-wrap gap-3 text-xs">
          {([
            ["Assets",    st?.totalDota2Assets, "text-white/60"],
            ["Listed",    st?.listed,           "text-emerald-400"],
            ["Priced",    st?.withFundamentalPrice, "text-cyan-400"],
            ["AMM Ready", st?.withAmmSeeded,    "text-violet-400"],
          ] as [string, number | undefined, string][]).map(([label, val, cls]) => (
            <div key={label} className="flex items-center gap-1.5 bg-white/[0.04] rounded-md px-2.5 py-1">
              <span className="text-white/30">{label}</span>
              <span className={`font-bold tabular-nums ${cls}`}>{val ?? "–"}</span>
            </div>
          ))}
          {statusQuery.isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-white/20 self-center" />}
        </div>

        {/* Steps */}
        <div className="space-y-2">
          <div className="text-[10px] text-white/30 uppercase tracking-widest font-semibold mb-1">
            Run pipeline in order →
          </div>
          <StepBtn label="1. Bootstrap Players (OpenDota)"  mut={bootstrapMut}  stepKey="bootstrap" />
          <StepBtn label="2. Seed Valuations"               mut={valSeedMut}    stepKey="valSeed"   disabled={busy && !bootstrapMut.isPending} />
          <StepBtn label="3. Run Valuation Job"             mut={valRunMut}     stepKey="valRun"    disabled={busy && !valSeedMut.isPending} />
          <StepBtn label="4. Backfill Asset Links"          mut={backfillMut}   stepKey="backfill"  disabled={busy && !valRunMut.isPending} />
          <StepBtn label="5. Seed AMM"                      mut={ammSeedMut}    stepKey="ammSeed"   disabled={busy && !backfillMut.isPending} />
        </div>

        <p className="text-[10px] text-white/20 leading-relaxed">
          Step 1 fetches up to 800 Dota2 players from OpenDota (no API key needed). Safe to re-run — idempotent.
        </p>
      </CardContent>
    </Card>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminMultigameOpsPage() {
  const summaryQuery = useQuery<OpsSummary>({
    queryKey: ["/api/admin/multigame/ops-summary"],
    refetchInterval: 60_000,
  });

  const troubleQuery = useQuery<Troubleshooting>({
    queryKey: ["/api/admin/multigame/troubleshooting"],
    refetchInterval: 60_000,
  });

  const s = summaryQuery.data;
  const t = troubleQuery.data;
  const isLoading = summaryQuery.isLoading || troubleQuery.isLoading;

  if (isLoading) {
    return (
      <MultigameAdminLayout title="Ops Summary" subtitle="Multi-game operations & observability">
        <div className="flex items-center justify-center h-48 text-white/30">
          <RefreshCw className="w-5 h-5 animate-spin mr-2" />
          Loading metrics…
        </div>
      </MultigameAdminLayout>
    );
  }

  // Build per-game ownership map
  const ownershipByGame = s?.ownedAssets.byGame ?? [];
  const activeOwnerMap: Record<string, number> = {};
  for (const r of ownershipByGame) activeOwnerMap[r.game ?? "–"] = r.count;

  // Build connected accounts by provider+game table
  const accountRows = (s?.connectedAccounts.byProviderGame ?? [])
    .sort((a, b) => (a.game ?? "").localeCompare(b.game ?? ""));

  // Build verification status table
  const verifStatusRows = (s?.connectedAccounts.byVerificationStatus ?? [])
    .sort((a, b) => (a.verificationStatus ?? "").localeCompare(b.verificationStatus ?? ""));

  // Build claims breakdown
  const claimsRows = (s?.claims.byGameAndStatus ?? [])
    .sort((a, b) => (a.game ?? "").localeCompare(b.game ?? ""));

  // Build assets breakdown
  const assetRows = (s?.assets.byGameAndListing ?? [])
    .sort((a, b) => (a.game ?? "").localeCompare(b.game ?? ""));

  // Verification events
  const verifEventRows = (s?.verificationEvents.byStatus ?? [])
    .sort((a, b) => (a.status ?? "").localeCompare(b.status ?? ""));

  return (
    <MultigameAdminLayout title="Ops Summary" subtitle="Multi-game operations & observability">
      <div className="space-y-6 max-w-5xl py-4">

        {/* ── Dota2 Bootstrap ────────────────────────────────────────────── */}
        <section>
          <div className="text-[10px] text-white/30 uppercase tracking-widest font-semibold mb-3">
            Dota2 Bootstrap
          </div>
          <Dota2BootstrapPanel />
        </section>

        {/* ── Metric cards ───────────────────────────────────────────────── */}
        <section>
          <div className="text-[10px] text-white/30 uppercase tracking-widest font-semibold mb-3">
            Overview
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <MetricCard
              icon={Users}
              label="Accounts"
              value={s?.connectedAccounts.total ?? 0}
              accent="text-cyan-400"
            />
            <MetricCard
              icon={ShieldCheck}
              label="Verified"
              value={
                (s?.connectedAccounts.byVerificationStatus ?? [])
                  .filter(r => r.verificationStatus === "VERIFIED")
                  .reduce((n, r) => n + r.count, 0)
              }
              accent="text-emerald-400"
            />
            <MetricCard
              icon={FileCheck}
              label="Claims"
              value={s?.claims.total ?? 0}
              accent="text-violet-400"
            />
            <MetricCard
              icon={TrendingUp}
              label="Auto-approved"
              value={s?.claims.autoApprovedCount ?? 0}
              accent="text-cyan-400"
            />
            <MetricCard
              icon={Layers}
              label="Owned assets"
              value={s?.ownedAssets.activeCount ?? 0}
              accent="text-emerald-400"
            />
            <MetricCard
              icon={Activity}
              label="Under review"
              value={s?.assets.underReviewCount ?? 0}
              accent="text-amber-400"
            />
          </div>
        </section>

        {/* ── Breakdowns ─────────────────────────────────────────────────── */}
        <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">

          {/* Connected accounts by provider+game */}
          <Card className="bg-white/[0.03] border-white/[0.08]">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm text-white/70 flex items-center gap-2">
                <Users className="w-3.5 h-3.5 text-cyan-400" />
                Connected Accounts by Game
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <BreakdownTable
                rows={accountRows}
                cols={[
                  { key: "providerGroup", label: "Provider" },
                  { key: "game", label: "Game", game: true },
                  { key: "count", label: "Count" },
                ]}
              />
            </CardContent>
          </Card>

          {/* Verification status */}
          <Card className="bg-white/[0.03] border-white/[0.08]">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm text-white/70 flex items-center gap-2">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                Verification Status
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <BreakdownTable
                rows={verifStatusRows}
                cols={[
                  { key: "verificationStatus", label: "Status", dot: true },
                  { key: "count", label: "Count" },
                ]}
              />
            </CardContent>
          </Card>

          {/* Claims by game+status */}
          <Card className="bg-white/[0.03] border-white/[0.08]">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm text-white/70 flex items-center gap-2">
                <FileCheck className="w-3.5 h-3.5 text-violet-400" />
                Claims by Game & Status
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-3">
              <BreakdownTable
                rows={claimsRows}
                cols={[
                  { key: "game", label: "Game", game: true },
                  { key: "claimStatus", label: "Status", dot: true },
                  { key: "count", label: "Count" },
                ]}
              />
              <div className="flex gap-2 flex-wrap pt-1">
                <Badge className="bg-cyan-500/10 text-cyan-300 border-cyan-500/20 border text-xs">
                  Auto-approved: {s?.claims.autoApprovedCount ?? 0}
                </Badge>
                <Badge className="bg-amber-500/10 text-amber-300 border-amber-500/20 border text-xs">
                  Pending review: {s?.claims.manualPendingCount ?? 0}
                </Badge>
                <Badge className="bg-red-500/10 text-red-300 border-red-500/20 border text-xs">
                  Rejected: {s?.claims.rejectedCount ?? 0}
                </Badge>
              </div>
            </CardContent>
          </Card>

          {/* Assets by game+listing */}
          <Card className="bg-white/[0.03] border-white/[0.08]">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm text-white/70 flex items-center gap-2">
                <Layers className="w-3.5 h-3.5 text-amber-400" />
                Assets by Game & Listing Status
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <BreakdownTable
                rows={assetRows}
                cols={[
                  { key: "game", label: "Game", game: true },
                  { key: "listingStatus", label: "Listing", dot: true },
                  { key: "count", label: "Count" },
                ]}
              />
            </CardContent>
          </Card>

          {/* Owned assets by game */}
          <Card className="bg-white/[0.03] border-white/[0.08]">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm text-white/70 flex items-center gap-2">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                Active Ownership by Game
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <BreakdownTable
                rows={ownershipByGame}
                cols={[
                  { key: "game", label: "Game", game: true },
                  { key: "count", label: "Active owners" },
                ]}
              />
            </CardContent>
          </Card>

          {/* Verification events */}
          <Card className="bg-white/[0.03] border-white/[0.08]">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm text-white/70 flex items-center gap-2">
                <Activity className="w-3.5 h-3.5 text-blue-400" />
                Verification Events
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <BreakdownTable
                rows={verifEventRows}
                cols={[
                  { key: "status", label: "Status", dot: true },
                  { key: "count", label: "Count" },
                ]}
              />
              <div className="text-xs text-white/30 mt-2">
                Total events: {s?.verificationEvents.total ?? 0}
              </div>
            </CardContent>
          </Card>

        </section>

        {/* ── Troubleshooting ─────────────────────────────────────────────── */}
        <section>
          <div className="text-[10px] text-white/30 uppercase tracking-widest font-semibold mb-3 flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3 text-amber-400" />
            Troubleshooting Alerts
          </div>

          <div className="space-y-2 mb-4">
            <AlertRow
              label="Ownership conflicts (open claim on asset with active owner)"
              count={t?.pendingClaimsWithActiveOwner?.length ?? 0}
              severity="error"
            />
            <AlertRow
              label="Pending claims waiting for review"
              count={t?.oldestPendingClaims?.length ?? 0}
              severity="warn"
            />
            <AlertRow
              label="Assets in review queue (UNDER_REVIEW listing)"
              count={t?.assetsWithOpenSubmission?.length ?? 0}
              severity="info"
            />
            <AlertRow
              label="Recent verification failures"
              count={t?.recentVerificationFailures?.length ?? 0}
              severity={(t?.recentVerificationFailures?.length ?? 0) > 0 ? "error" : "info"}
            />
          </div>

          {/* Ownership conflicts detail */}
          {(t?.pendingClaimsWithActiveOwner?.length ?? 0) > 0 && (
            <Card className="bg-red-500/[0.04] border-red-500/20 mb-3">
              <CardHeader className="pb-2 pt-3 px-4">
                <CardTitle className="text-xs text-red-300 flex items-center gap-2">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Ownership Conflicts — require manual resolution
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <BreakdownTable
                  rows={t?.pendingClaimsWithActiveOwner ?? []}
                  cols={[
                    { key: "id", label: "Claim ID" },
                    { key: "game", label: "Game", game: true },
                    { key: "assetId", label: "Asset ID" },
                    { key: "claimStatus", label: "Status", dot: true },
                    { key: "ownerUserId", label: "Active Owner" },
                    { key: "requestedByUserId", label: "Claimant" },
                  ]}
                />
              </CardContent>
            </Card>
          )}

          {/* Recent verification failures */}
          {(t?.recentVerificationFailures?.length ?? 0) > 0 && (
            <Card className="bg-white/[0.03] border-white/[0.08] mb-3">
              <CardHeader className="pb-2 pt-3 px-4">
                <CardTitle className="text-xs text-white/60 flex items-center gap-2">
                  <ShieldCheck className="w-3.5 h-3.5 text-red-400" />
                  Recent Verification Failures (last 10)
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <BreakdownTable
                  rows={t?.recentVerificationFailures ?? []}
                  cols={[
                    { key: "id", label: "ID" },
                    { key: "providerGroup", label: "Provider" },
                    { key: "game", label: "Game", game: true },
                    { key: "status", label: "Status", dot: true },
                    { key: "createdAt", label: "At" },
                  ]}
                />
              </CardContent>
            </Card>
          )}

          {/* Assets under review */}
          {(t?.assetsWithOpenSubmission?.length ?? 0) > 0 && (
            <Card className="bg-white/[0.03] border-white/[0.08]">
              <CardHeader className="pb-2 pt-3 px-4">
                <CardTitle className="text-xs text-white/60 flex items-center gap-2">
                  <Layers className="w-3.5 h-3.5 text-amber-400" />
                  Assets Awaiting Listing Review
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <BreakdownTable
                  rows={t?.assetsWithOpenSubmission ?? []}
                  cols={[
                    { key: "assetId", label: "Asset ID" },
                    { key: "game", label: "Game", game: true },
                    { key: "displayName", label: "Name" },
                    { key: "listingStatus", label: "Status", dot: true },
                  ]}
                />
              </CardContent>
            </Card>
          )}
        </section>

        {/* Footer */}
        <div className="text-xs text-white/20 text-right pt-2">
          Generated: {s?.generatedAt ? new Date(s.generatedAt).toLocaleTimeString() : "–"} ·
          Auto-refreshes every 60s
        </div>
      </div>
    </MultigameAdminLayout>
  );
}

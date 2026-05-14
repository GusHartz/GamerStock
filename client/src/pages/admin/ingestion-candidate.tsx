import { useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PredictAdminLayout, AdminSectionCard, StatusBadge } from "./predict-layout";
import { RefreshCw, ArrowLeft, Loader2, CheckCircle2, XCircle, AlertCircle, Archive, Send } from "lucide-react";
import { Link } from "wouter";
import { useState } from "react";

// ── Types ────────────────────────────────────────────────────────────────────

type Candidate = {
  id: number;
  matchTitle: string | null;
  gameCode: string;
  source: string;
  sourceEventId: string;
  sourceSeriesId: string | null;
  sourceLeagueId: string | null;
  sourceTournamentId: string | null;
  reviewStatus: string;
  visibilityState: string;
  normalizedStatus: string | null;
  teamAName: string | null;
  teamBName: string | null;
  teamAExternalRef: string | null;
  teamBExternalRef: string | null;
  leagueName: string | null;
  tournamentName: string | null;
  scheduledStartAt: string | null;
  dedupeKey: string;
  confidenceScore: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewNotes: string | null;
  rawPayload: unknown;
  normalizedPayload: unknown;
  createdAt: string;
  updatedAt: string;
};

// ── State machine — mirrors backend ALLOWED_TRANSITIONS ───────────────────────
// pending_review: [approved, rejected, needs_edit]
// needs_edit:     [approved, rejected]
// approved:       [archived] + publish via publication service
// rejected:       [archived]
// published, archived: terminal

function canApprove(s: string)   { return s === "pending_review" || s === "needs_edit"; }
function canReject(s: string)    { return s === "pending_review" || s === "needs_edit"; }
function canNeedsEdit(s: string) { return s === "pending_review"; }
function canArchive(s: string)   { return s === "approved" || s === "rejected"; }
function canPublish(s: string)   { return s === "approved"; }

// ── Helpers ──────────────────────────────────────────────────────────────────

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

// ── Invalidation helper ───────────────────────────────────────────────────────

function invalidateCandidates(id: number) {
  queryClient.invalidateQueries({ queryKey: [`/api/admin/ingestion/candidates/${id}`] });
  queryClient.invalidateQueries({
    predicate: (q) =>
      typeof q.queryKey[0] === "string" &&
      (q.queryKey[0] as string).startsWith("/api/admin/ingestion/candidates") &&
      q.queryKey[0] !== `/api/admin/ingestion/candidates/${id}`,
  });
  // Dashboard stat queries
  queryClient.invalidateQueries({
    predicate: (q) =>
      typeof q.queryKey[0] === "string" &&
      (q.queryKey[0] as string).includes("reviewStatus"),
  });
}

function invalidateEvents() {
  queryClient.invalidateQueries({
    predicate: (q) =>
      typeof q.queryKey[0] === "string" &&
      (q.queryKey[0] as string).startsWith("/api/predictions/events"),
  });
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminCandidateDetailPage() {
  const params = useParams<{ candidateId: string }>();
  const id = Number(params.candidateId);
  const { toast } = useToast();

  const [notes, setNotes]               = useState("");
  const [activeAction, setActiveAction] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery<{ data: Candidate }>({
    queryKey: [`/api/admin/ingestion/candidates/${id}`],
    enabled: !!id && !isNaN(id),
  });

  const c = data?.data;

  // ── Shared fetch helper — extracts clean error messages from JSON bodies ──

  async function adminPost(path: string, body: Record<string, unknown>) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? json.message ?? `HTTP ${res.status}`);
    return json;
  }

  // ── Shared mutation factory ──────────────────────────────────────────────

  function useReviewMutation(action: string) {
    return useMutation({
      mutationFn: () =>
        adminPost(`/api/admin/ingestion/candidates/${id}/${action}`, {
          reviewedBy:  "admin",
          reviewNotes: notes.trim() || undefined,
        }),
      onMutate:  () => setActiveAction(action),
      onSuccess: (data) => {
        setActiveAction(null);
        toast({ title: data.message ?? `Action "${action}" applied` });
        invalidateCandidates(id);
        setNotes("");
      },
      onError: (err: Error) => {
        setActiveAction(null);
        toast({ title: err.message ?? "Action failed", variant: "destructive" });
      },
    });
  }

  // ── Publish mutation (different endpoint + response shape) ───────────────

  const publishMutation = useMutation({
    mutationFn: () =>
      adminPost(`/api/admin/ingestion/candidates/${id}/publish`, {
        publishedBy: "admin",
        notes:       notes.trim() || undefined,
      }),
    onMutate:  () => setActiveAction("publish"),
    onSuccess: (data) => {
      setActiveAction(null);
      toast({ title: data.message ?? `Candidate #${id} published` });
      invalidateCandidates(id);
      invalidateEvents();
      setNotes("");
    },
    onError: (err: Error) => {
      setActiveAction(null);
      toast({ title: err.message ?? "Publish failed", variant: "destructive" });
    },
  });

  const approveMutation    = useReviewMutation("approve");
  const rejectMutation     = useReviewMutation("reject");
  const needsEditMutation  = useReviewMutation("needs-edit");
  const archiveMutation    = useReviewMutation("archive");

  const isAnyPending = activeAction !== null;

  // ── Loading / error states ───────────────────────────────────────────────

  if (isLoading) {
    return (
      <PredictAdminLayout title="Loading…" breadcrumb="Ingestion">
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="w-6 h-6 text-cyan-400 animate-spin" />
        </div>
      </PredictAdminLayout>
    );
  }

  if (isError || !c) {
    return (
      <PredictAdminLayout title="Not Found" breadcrumb="Ingestion">
        <div className="text-center py-20 text-muted-foreground">
          Candidate #{id} not found.
        </div>
      </PredictAdminLayout>
    );
  }

  const title = c.matchTitle ?? `${c.teamAName ?? "?"} vs ${c.teamBName ?? "?"}`;

  const ACTIONS: {
    key:     string;
    label:   string;
    icon:    React.ElementType;
    color:   string;
    enabled: boolean;
    run:     () => void;
  }[] = [
    {
      key:     "approve",
      label:   "Approve",
      icon:    CheckCircle2,
      color:   "bg-emerald-500/10 text-emerald-300 border-emerald-500/25 hover:bg-emerald-500/20",
      enabled: canApprove(c.reviewStatus),
      run:     () => approveMutation.mutate(),
    },
    {
      key:     "reject",
      label:   "Reject",
      icon:    XCircle,
      color:   "bg-red-500/10 text-red-300 border-red-500/25 hover:bg-red-500/20",
      enabled: canReject(c.reviewStatus),
      run:     () => rejectMutation.mutate(),
    },
    {
      key:     "needs-edit",
      label:   "Needs Edit",
      icon:    AlertCircle,
      color:   "bg-violet-500/10 text-violet-300 border-violet-500/25 hover:bg-violet-500/20",
      enabled: canNeedsEdit(c.reviewStatus),
      run:     () => needsEditMutation.mutate(),
    },
    {
      key:     "archive",
      label:   "Archive",
      icon:    Archive,
      color:   "bg-slate-500/10 text-slate-300 border-slate-500/25 hover:bg-slate-500/20",
      enabled: canArchive(c.reviewStatus),
      run:     () => archiveMutation.mutate(),
    },
    {
      key:     "publish",
      label:   "Publish",
      icon:    Send,
      color:   "bg-cyan-500/10 text-cyan-300 border-cyan-500/25 hover:bg-cyan-500/20",
      enabled: canPublish(c.reviewStatus),
      run:     () => publishMutation.mutate(),
    },
  ];

  const isTerminal = c.reviewStatus === "published" || c.reviewStatus === "archived";

  return (
    <PredictAdminLayout title={`#${c.id}`} subtitle={title} breadcrumb="Ingestion">

      {/* Back + status bar */}
      <div className="flex items-center justify-between">
        <Link href="/admin/ingestion">
          <button
            data-testid="button-back-to-ingestion"
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-white transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to queue
          </button>
        </Link>
        <div className="flex items-center gap-2">
          <StatusBadge status={c.reviewStatus} />
          {c.normalizedStatus && <StatusBadge status={c.normalizedStatus} />}
        </div>
      </div>

      {/* Match Info */}
      <AdminSectionCard title="Match Info" description="Core event fields mapped from the source">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
          <Field label="Match Title"  value={c.matchTitle} />
          <Field label="Game"         value={c.gameCode} />
          <Field label="Team A"       value={c.teamAName} />
          <Field label="Team B"       value={c.teamBName} />
          <Field label="League"       value={c.leagueName} />
          <Field label="Tournament"   value={c.tournamentName} />
          <Field label="Scheduled At" value={c.scheduledStartAt ? new Date(c.scheduledStartAt).toLocaleString() : null} />
          <Field label="Status"       value={c.normalizedStatus} />
          <Field label="Confidence"   value={c.confidenceScore ?? undefined} />
        </div>
      </AdminSectionCard>

      {/* Source Metadata */}
      <AdminSectionCard title="Source Metadata" description="Raw identifiers from the external provider">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
          <Field label="Source"        value={c.source} />
          <Field label="Source Event"  value={c.sourceEventId} />
          <Field label="Source Series" value={c.sourceSeriesId} />
          <Field label="Source League" value={c.sourceLeagueId} />
          <Field label="Tournament ID" value={c.sourceTournamentId} />
          <Field label="Team A Ref"    value={c.teamAExternalRef} />
          <Field label="Team B Ref"    value={c.teamBExternalRef} />
          <Field label="Dedupe Key"    value={c.dedupeKey} />
        </div>
      </AdminSectionCard>

      {/* Review Actions */}
      <AdminSectionCard
        title="Review Actions"
        description={
          isTerminal
            ? `This candidate is ${c.reviewStatus} — no further actions available`
            : "Apply a status transition. Optionally add notes before clicking an action."
        }
      >
        {/* Notes field */}
        {!isTerminal && (
          <div className="mb-4">
            <label className="text-[11px] font-mono text-muted-foreground uppercase tracking-wider mb-1.5 block">
              Review Notes (optional)
            </label>
            <textarea
              data-testid="input-review-notes"
              rows={2}
              placeholder="Add a short note visible in the audit log…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={isAnyPending}
              className="w-full bg-white/[0.03] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white placeholder:text-muted-foreground/50 outline-none resize-none focus:border-cyan-500/40 transition-colors disabled:opacity-50"
            />
          </div>
        )}

        {/* Action buttons */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {ACTIONS.map(({ key, label, icon: Icon, color, enabled, run }) => {
            const isThis = activeAction === key;
            return (
              <button
                key={key}
                data-testid={`button-review-${key}`}
                disabled={!enabled || isAnyPending}
                onClick={run}
                className={`
                  flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium
                  transition-all duration-150
                  ${enabled && !isAnyPending ? `${color} cursor-pointer` : "opacity-25 cursor-not-allowed bg-white/[0.02] text-muted-foreground border-white/[0.06]"}
                `}
              >
                {isThis
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Icon className="w-4 h-4" />
                }
                {label}
              </button>
            );
          })}
        </div>

        {/* Last review info */}
        {c.reviewedAt && (
          <div className="mt-4 pt-4 border-t border-white/[0.06] flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Last reviewed: {new Date(c.reviewedAt).toLocaleString()}</span>
            {c.reviewedBy && <span>by <span className="text-white/70">{c.reviewedBy}</span></span>}
            {c.reviewNotes && <span className="italic text-muted-foreground/70">"{c.reviewNotes}"</span>}
          </div>
        )}
      </AdminSectionCard>

      {/* Raw Payload Preview */}
      <AdminSectionCard title="Raw Payload Preview" description="JSON from source provider">
        <pre
          data-testid="raw-payload-preview"
          className="text-[11px] font-mono text-muted-foreground bg-black/30 border border-white/[0.06] rounded-lg p-4 overflow-auto max-h-64 leading-relaxed"
        >
          {JSON.stringify(c.rawPayload, null, 2)}
        </pre>
      </AdminSectionCard>

      {/* Audit footer */}
      <div className="flex flex-wrap gap-6 text-xs text-muted-foreground font-mono">
        <span>created: {new Date(c.createdAt).toLocaleString()}</span>
        <span>updated: {new Date(c.updatedAt).toLocaleString()}</span>
        <span>visibility: {c.visibilityState}</span>
      </div>

    </PredictAdminLayout>
  );
}

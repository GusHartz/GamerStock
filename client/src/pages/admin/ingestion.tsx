import { PredictAdminLayout, AdminSectionCard, AdminEmptyState, StatusBadge } from "./predict-layout";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Link } from "wouter";
import { Inbox, Filter, Search, RefreshCw, ChevronRight, CheckCheck, Send, Zap } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

type Candidate = {
  id: number;
  matchTitle: string | null;
  gameCode: string;
  source: string;
  reviewStatus: string;
  normalizedStatus: string | null;
  teamAName: string | null;
  teamBName: string | null;
  scheduledStartAt: string | null;
};

type BulkResult = {
  message:       string;
  totalSelected: number;
  processed:     number;
  approved?:     number;
  published?:    number;
  skipped:       number;
  failed:        number;
};

const STATUS_FILTERS = ["all", "pending_review", "approved", "needs_edit", "rejected", "published", "archived"];

// ── HTTP helper ────────────────────────────────────────────────────────────────

async function bulkPost(path: string, body: Record<string, unknown>): Promise<BulkResult> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? json.message ?? "Bulk request failed");
  return json as BulkResult;
}

// ── Toast summary helper ───────────────────────────────────────────────────────

function toastBulkResult(toast: ReturnType<typeof useToast>["toast"], result: BulkResult) {
  const lines: string[] = [];
  if (result.approved  !== undefined) lines.push(`${result.approved} approved`);
  if (result.published !== undefined) lines.push(`${result.published} published`);
  if (result.skipped   > 0)          lines.push(`${result.skipped} skipped`);
  if (result.failed    > 0)          lines.push(`${result.failed} failed`);

  toast({
    title:       result.message,
    description: lines.join(" · ") || `${result.totalSelected} candidates processed`,
    variant:     result.failed > 0 ? "destructive" : "default",
  });
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminIngestionPage() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState("pending_review");
  const [search, setSearch]             = useState("");

  const params = new URLSearchParams();
  if (statusFilter !== "all") params.set("reviewStatus", statusFilter);
  if (search.trim())          params.set("search", search.trim());
  params.set("limit", "50");

  const queryKey = `/api/admin/ingestion/candidates?${params.toString()}`;

  const { data, isLoading, refetch, isFetching } = useQuery<{
    data: Candidate[];
    total: number;
  }>({
    queryKey: [queryKey],
  });

  const candidates = data?.data ?? [];
  const total      = data?.total ?? 0;

  // ── Build the filter scope sent to bulk endpoints ──
  const currentFilters: Record<string, string> = {};
  if (statusFilter !== "all") currentFilters.reviewStatus = statusFilter;
  if (search.trim())          currentFilters.search = search.trim();

  function invalidateCandidates() {
    queryClient.invalidateQueries({
      predicate: (q) =>
        typeof q.queryKey[0] === "string" &&
        (q.queryKey[0] as string).startsWith("/api/admin/ingestion/candidates"),
    });
  }

  // ── Approve All ──
  const approveMutation = useMutation({
    mutationFn: () =>
      bulkPost("/api/admin/ingestion/candidates/bulk/approve", { filters: currentFilters }),
    onSuccess: (result) => {
      toastBulkResult(toast, result);
      invalidateCandidates();
    },
    onError: (err: Error) => toast({ title: "Approve All failed", description: err.message, variant: "destructive" }),
  });

  // ── Publish Approved ──
  const publishMutation = useMutation({
    mutationFn: () =>
      bulkPost("/api/admin/ingestion/candidates/bulk/publish-approved", { filters: currentFilters }),
    onSuccess: (result) => {
      toastBulkResult(toast, result);
      invalidateCandidates();
    },
    onError: (err: Error) => toast({ title: "Publish Approved failed", description: err.message, variant: "destructive" }),
  });

  // ── Approve + Publish All ──
  const approvePublishMutation = useMutation({
    mutationFn: () =>
      bulkPost("/api/admin/ingestion/candidates/bulk/approve-and-publish", { filters: currentFilters }),
    onSuccess: (result) => {
      toastBulkResult(toast, result);
      invalidateCandidates();
    },
    onError: (err: Error) => toast({ title: "Approve + Publish failed", description: err.message, variant: "destructive" }),
  });

  const anyBulkPending =
    approveMutation.isPending ||
    publishMutation.isPending ||
    approvePublishMutation.isPending;

  return (
    <PredictAdminLayout
      title="Ingestion Queue"
      subtitle="Candidates fetched from external sources awaiting review"
    >

      {/* Filter bar */}
      <AdminSectionCard title="Filters" description="Narrow the candidate list">
        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="flex items-center gap-2 bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-1.5 min-w-[200px]">
            <Search className="w-3.5 h-3.5 text-muted-foreground" />
            <input
              data-testid="input-search-candidates"
              type="text"
              placeholder="Search match title…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-transparent text-sm text-white placeholder:text-muted-foreground outline-none flex-1"
            />
          </div>

          {/* Status pills */}
          <div className="flex items-center gap-1 flex-wrap">
            <Filter className="w-3.5 h-3.5 text-muted-foreground mr-1" />
            {STATUS_FILTERS.map((s) => (
              <button
                key={s}
                data-testid={`filter-status-${s}`}
                onClick={() => setStatusFilter(s)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all ${
                  statusFilter === s
                    ? "bg-cyan-500/15 text-cyan-300 border-cyan-500/25"
                    : "bg-white/[0.03] text-muted-foreground border-white/[0.07] hover:text-white"
                }`}
              >
                {s === "all" ? "All" : s.replace(/_/g, " ")}
              </button>
            ))}
          </div>

          {/* Refresh */}
          <button
            data-testid="button-refresh-candidates"
            onClick={() => refetch()}
            disabled={isFetching}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-xs text-muted-foreground hover:text-white transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </AdminSectionCard>

      {/* Bulk Actions */}
      <AdminSectionCard
        title="Bulk Actions"
        description={
          Object.keys(currentFilters).length > 0
            ? `Operates on currently filtered set (${total} candidates)`
            : `Operates on the default eligible set for each action`
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <button
            data-testid="button-bulk-approve"
            onClick={() => approveMutation.mutate()}
            disabled={anyBulkPending}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs font-medium hover:bg-emerald-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {approveMutation.isPending
              ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              : <CheckCheck className="w-3.5 h-3.5" />}
            Approve All
          </button>

          <button
            data-testid="button-bulk-publish-approved"
            onClick={() => publishMutation.mutate()}
            disabled={anyBulkPending}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 text-xs font-medium hover:bg-cyan-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {publishMutation.isPending
              ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              : <Send className="w-3.5 h-3.5" />}
            Publish Approved
          </button>

          <button
            data-testid="button-bulk-approve-and-publish"
            onClick={() => approvePublishMutation.mutate()}
            disabled={anyBulkPending}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-500/10 border border-violet-500/20 text-violet-300 text-xs font-medium hover:bg-violet-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {approvePublishMutation.isPending
              ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              : <Zap className="w-3.5 h-3.5" />}
            Approve + Publish All
          </button>

          {anyBulkPending && (
            <span className="text-[11px] text-muted-foreground/60 ml-1 italic">Processing…</span>
          )}
        </div>
      </AdminSectionCard>

      {/* Results */}
      <AdminSectionCard
        title="Candidates"
        description={isLoading ? "Loading…" : `${total} result${total === 1 ? "" : "s"}`}
      >
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="w-5 h-5 text-cyan-400 animate-spin" />
          </div>
        ) : candidates.length === 0 ? (
          <AdminEmptyState
            icon={<Inbox className="w-10 h-10" />}
            message="No candidates match these filters"
            hint={statusFilter === "pending_review" ? "The ingestion scheduler runs every 15 min" : undefined}
          />
        ) : (
          <div className="flex flex-col divide-y divide-white/[0.05]">
            {candidates.map((c) => (
              <Link key={c.id} href={`/admin/ingestion/${c.id}`}>
                <div
                  data-testid={`row-candidate-${c.id}`}
                  className="flex items-center gap-4 py-3 hover:bg-white/[0.02] transition-colors cursor-pointer -mx-5 px-5"
                >
                  {/* Title */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white truncate">
                      {c.matchTitle ?? `${c.teamAName ?? "?"} vs ${c.teamBName ?? "?"}`}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs font-mono text-muted-foreground uppercase">{c.gameCode}</span>
                      <span className="text-muted-foreground/30">·</span>
                      <span className="text-xs text-muted-foreground">{c.source}</span>
                      {c.scheduledStartAt && (
                        <>
                          <span className="text-muted-foreground/30">·</span>
                          <span className="text-xs text-muted-foreground">
                            {new Date(c.scheduledStartAt).toLocaleDateString()}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Badges */}
                  <div className="flex items-center gap-2 shrink-0">
                    {c.normalizedStatus && <StatusBadge status={c.normalizedStatus} />}
                    <StatusBadge status={c.reviewStatus} />
                    <ChevronRight className="w-4 h-4 text-muted-foreground/40" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </AdminSectionCard>

    </PredictAdminLayout>
  );
}

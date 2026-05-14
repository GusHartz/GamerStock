import { useAuth } from "@/hooks/use-auth";
import { Loader2, Clock, InboxIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { HubHeader } from "@/features/player-hub/components/HubHeader";
import { RequestForm } from "@/features/player-hub/components/RequestForm";
import { DiscoveredAssetsSection } from "@/features/player-hub/components/DiscoveredAssetsSection";
import {
  useHubOverview,
  useHubAssetRequests,
} from "@/features/player-hub/hooks/use-player-hub";

// ── Request status badge ──────────────────────────────────────────────────────

function RequestStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending:     { label: "Pending",     cls: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30" },
    under_review:{ label: "In Review",   cls: "bg-blue-500/20 text-blue-300 border-blue-500/30"      },
    approved:    { label: "Approved",    cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" },
    rejected:    { label: "Rejected",    cls: "bg-red-500/20 text-red-400 border-red-500/30"         },
    ingested:    { label: "Ingested",    cls: "bg-purple-500/20 text-purple-300 border-purple-500/30" },
  };
  const s = map[status] ?? { label: status, cls: "bg-white/10 text-white/50 border-white/20" };
  return <Badge className={cn("border text-xs", s.cls)}>{s.label}</Badge>;
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyRequests() {
  return (
    <div
      className="flex flex-col items-center justify-center py-8 text-center gap-2"
      data-testid="empty-requests"
    >
      <InboxIcon className="w-8 h-8 text-white/20" />
      <p className="text-sm text-white/40">No asset requests yet.</p>
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white/80 uppercase tracking-wider">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PlayerHubPage() {
  const { user, isLoading: authLoading } = useAuth();
  const overviewQuery = useHubOverview();
  const requestsQuery = useHubAssetRequests();

  if (authLoading || (overviewQuery.isFetching && !overviewQuery.data)) {
    return (
      <div className="flex items-center justify-center py-32" data-testid="hub-loading">
        <Loader2 className="w-6 h-6 animate-spin text-white/40" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center py-32" data-testid="hub-unauthorized">
        <p className="text-white/50 text-sm">Sign in to access your Player Hub.</p>
      </div>
    );
  }

  const overview = overviewQuery.data;
  const requests = requestsQuery.data?.requests ?? [];

  return (
    <div className="bg-background text-foreground">
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">

        {/* ── Header / Player Summary ── */}
        {overview ? (
          <HubHeader overview={overview} />
        ) : overviewQuery.isError ? (
          <div className="text-red-400 text-sm" data-testid="hub-overview-error">
            Failed to load hub overview.
          </div>
        ) : (
          <div className="h-32 bg-white/5 rounded-xl animate-pulse" />
        )}

        {/* ── Discovered Assets (primary creator experience) ── */}
        <DiscoveredAssetsSection />

        {/* ── Asset Request Center ── */}
        <Section title="Request Missing Asset">
          <RequestForm />
        </Section>

        {/* ── Request History ── */}
        <Section title="Request History">
          {requestsQuery.isLoading ? (
            <div className="h-24 bg-white/5 rounded-xl animate-pulse" />
          ) : requestsQuery.isError ? (
            <div className="text-red-400 text-sm py-4" data-testid="requests-error">
              Failed to load request history.
            </div>
          ) : requests.length > 0 ? (
            <div className="space-y-2" data-testid="request-history-list">
              {requests.map((req) => (
                <div
                  key={req.id}
                  data-testid={`request-row-${req.id}`}
                  className="flex items-center justify-between gap-4 bg-white/5 border border-white/10 rounded-lg px-4 py-3"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">
                      {req.gameName} — {req.externalUsername ?? req.externalAccountRef ?? "Unknown account"}
                    </p>
                    <p className="text-xs text-white/40 flex items-center gap-1 mt-0.5">
                      <Clock className="w-3 h-3" />
                      {new Date(req.createdAt).toLocaleDateString()}
                      {req.platform && ` · ${req.platform}`}
                    </p>
                    {req.reviewNotes && (
                      <p className="text-xs text-white/50 mt-1 italic">{req.reviewNotes}</p>
                    )}
                  </div>
                  <RequestStatusBadge status={req.status} />
                </div>
              ))}
            </div>
          ) : (
            <EmptyRequests />
          )}
        </Section>

      </div>
    </div>
  );
}

import { PredictAdminLayout, AdminSectionCard, AdminEmptyState, StatusBadge } from "./predict-layout";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { CalendarCheck, RefreshCw, ChevronRight } from "lucide-react";

type PredictionEvent = {
  id: number;
  uid: string;
  title: string;
  game: string;
  status: string;
  tournamentName: string | null;
  teamAName: string | null;
  teamBName: string | null;
  startsAt: string | null;
  externalRef: string | null;
  createdAt: string;
};

export default function AdminEventsPage() {
  const { data, isLoading, refetch, isFetching } = useQuery<{ events: PredictionEvent[]; total: number }>({
    queryKey: ["/api/predictions/events"],
  });

  const events = data?.events ?? [];

  return (
    <PredictAdminLayout
      title="Published Events"
      subtitle="Prediction events created from approved candidates"
    >
      <AdminSectionCard
        title="Events"
        description={isLoading ? "Loading…" : `${data?.total ?? events.length} event${(data?.total ?? events.length) === 1 ? "" : "s"}`}
        action={
          <button
            data-testid="button-refresh-events"
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-xs text-muted-foreground hover:text-white transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
        }
      >
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="w-5 h-5 text-cyan-400 animate-spin" />
          </div>
        ) : events.length === 0 ? (
          <AdminEmptyState
            icon={<CalendarCheck className="w-10 h-10" />}
            message="No published events yet"
            hint="Approve and publish candidates from the Ingestion Queue"
          />
        ) : (
          <div className="flex flex-col divide-y divide-white/[0.05]">
            {events.map((ev) => (
              <Link key={ev.id} href={`/admin/events/${ev.id}`}>
                <div
                  data-testid={`row-event-${ev.id}`}
                  className="flex items-center gap-4 py-3 hover:bg-white/[0.02] transition-colors cursor-pointer -mx-5 px-5"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white truncate">{ev.title}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs font-mono text-muted-foreground uppercase">{ev.game}</span>
                      {ev.tournamentName && (
                        <>
                          <span className="text-muted-foreground/30">·</span>
                          <span className="text-xs text-muted-foreground truncate max-w-[160px]">{ev.tournamentName}</span>
                        </>
                      )}
                      {ev.startsAt && (
                        <>
                          <span className="text-muted-foreground/30">·</span>
                          <span className="text-xs text-muted-foreground">{new Date(ev.startsAt).toLocaleDateString()}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusBadge status={ev.status} />
                    <span className="text-xs font-mono text-muted-foreground/50">#{ev.id}</span>
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

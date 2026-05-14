import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PredictAdminLayout, AdminSectionCard, AdminStatCard } from "./predict-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Inbox, CalendarCheck, Layers, ImageIcon, AlertTriangle, ChevronDown,
  ArrowRight, FileImage, ExternalLink, Play, Loader2, ShoppingCart,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type CandidateList = {
  data: {
    id: number;
    matchTitle: string | null;
    teamAName: string | null;
    teamBName: string | null;
    gameCode: string;
    reviewStatus: string;
    createdAt: string;
  }[];
  total: number;
};

type PredictionEvent = {
  id: number;
  title: string;
  game: string;
  status: string;
  teamAName: string | null;
  teamBName: string | null;
  createdAt: string;
};

type EventList  = { events: PredictionEvent[]; total: number };
type QueueItem  = { id: number; surface: string; isActive: boolean; entityId: number; label: string | null };
type QueueList  = { data: QueueItem[]; total: number };
type MediaAsset = { id: number; fileName: string; publicUrl: string; fileSize: number; createdAt: string };
type MediaList  = { data: MediaAsset[]; total: number };

type DraftMarketItem = {
  marketId: number;
  uid: string;
  slug: string | null;
  question: string;
  marketType: string;
  status: string;
  createdAt: string;
  eventId: number | null;
  eventTitle: string | null;
  teamAName: string | null;
  teamBName: string | null;
  startsAt: string | null;
  game: string | null;
  outcomes: { id: number; label: string; code: string | null }[];
};
type DraftMarketList = { ok: boolean; total: number; items: DraftMarketItem[] };

// ─── Constants ────────────────────────────────────────────────────────────────

const SURFACES = ["hero", "predictions", "featured", "upcoming"] as const;

const SURFACE_META: Record<string, { label: string; accent: string }> = {
  hero:        { label: "Hero",        accent: "text-emerald-400" },
  predictions: { label: "Predictions", accent: "text-violet-400" },
  featured:    { label: "Featured",    accent: "text-amber-400" },
  upcoming:    { label: "Upcoming",    accent: "text-sky-400" },
};

const SECTIONS = [
  {
    href:   "/admin/ingestion",
    icon:   Inbox,
    label:  "Ingestion Queue",
    desc:   "Review, approve and reject events fetched from PandaScore and other sources.",
    accent: "text-amber-400",
    bg:     "bg-amber-500/10",
  },
  {
    href:   "/admin/events",
    icon:   CalendarCheck,
    label:  "Published Events",
    desc:   "Browse and manage prediction events that have been approved and published.",
    accent: "text-cyan-400",
    bg:     "bg-cyan-500/10",
  },
  {
    href:   "/admin/display-queue",
    icon:   Layers,
    label:  "Display Queue",
    desc:   "Curate which events appear on each surface (home, hero, predictions, featured).",
    accent: "text-violet-400",
    bg:     "bg-violet-500/10",
  },
  {
    href:   "/admin/media",
    icon:   ImageIcon,
    label:  "Media Library",
    desc:   "Upload and manage images, thumbnails, and assets for events and predictions.",
    accent: "text-emerald-400",
    bg:     "bg-emerald-500/10",
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function fmtBytes(n: number): string {
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

function statusColor(s: string): string {
  switch (s) {
    case "pending_review": return "text-amber-400 bg-amber-500/10";
    case "approved":       return "text-emerald-400 bg-emerald-500/10";
    case "needs_edit":     return "text-red-400 bg-red-500/10";
    case "published":      return "text-cyan-400 bg-cyan-500/10";
    case "open":           return "text-emerald-400 bg-emerald-500/10";
    default:               return "text-muted-foreground bg-white/[0.05]";
  }
}

function StatusPill({ status }: { status: string }) {
  return (
    <span className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded ${statusColor(status)}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function SkeletonRows({ n = 4 }: { n?: number }) {
  return (
    <>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 py-2.5 border-b border-white/[0.04] last:border-0 animate-pulse">
          <div className="w-6 h-3 bg-white/[0.06] rounded shrink-0" />
          <div className="flex-1 h-3 bg-white/[0.04] rounded" />
          <div className="w-20 h-4 bg-white/[0.04] rounded" />
          <div className="w-12 h-3 bg-white/[0.04] rounded hidden sm:block" />
        </div>
      ))}
    </>
  );
}

// ─── Section: Recent Candidates ───────────────────────────────────────────────

function RecentCandidates() {
  const { data, isLoading } = useQuery<CandidateList>({
    queryKey: ["/api/admin/ingestion/candidates?limit=6"],
    staleTime: 30_000,
  });

  const rows = data?.data ?? [];

  return (
    <AdminSectionCard
      title="Recent Candidates"
      description="Latest events from the ingestion pipeline"
      action={
        <Link href="/admin/ingestion">
          <button className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-white transition-colors">
            View all <ExternalLink className="w-3 h-3" />
          </button>
        </Link>
      }
    >
      {isLoading && <SkeletonRows n={4} />}
      {!isLoading && rows.length === 0 && (
        <p className="text-xs text-muted-foreground/50 italic py-4 text-center">No candidates yet</p>
      )}
      {rows.map((c) => (
        <Link key={c.id} href={`/admin/ingestion/${c.id}`}>
          <div
            data-testid={`row-candidate-${c.id}`}
            className="flex items-center gap-3 py-2.5 border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] cursor-pointer transition-colors rounded px-1 -mx-1"
          >
            <span className="text-[10px] font-mono text-muted-foreground/40 w-6 shrink-0 text-right">#{c.id}</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-white truncate">
                {c.matchTitle ?? (c.teamAName && c.teamBName ? `${c.teamAName} vs ${c.teamBName}` : `Candidate #${c.id}`)}
              </p>
              <p className="text-[10px] font-mono text-muted-foreground/40">{c.gameCode}</p>
            </div>
            <StatusPill status={c.reviewStatus} />
            <span className="text-[10px] text-muted-foreground/40 shrink-0 hidden sm:block">{fmtRelative(c.createdAt)}</span>
          </div>
        </Link>
      ))}
    </AdminSectionCard>
  );
}

// ─── Section: Recent Published Events ────────────────────────────────────────

function RecentPublishedEvents() {
  const { data, isLoading } = useQuery<EventList>({
    queryKey: ["/api/predictions/events"],
    staleTime: 30_000,
  });

  const rows = (data?.events ?? []).slice(0, 6);

  return (
    <AdminSectionCard
      title="Recent Published Events"
      description="Latest prediction events in the system"
      action={
        <Link href="/admin/events">
          <button className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-white transition-colors">
            View all <ExternalLink className="w-3 h-3" />
          </button>
        </Link>
      }
    >
      {isLoading && <SkeletonRows n={4} />}
      {!isLoading && rows.length === 0 && (
        <p className="text-xs text-muted-foreground/50 italic py-4 text-center">No published events yet</p>
      )}
      {rows.map((ev) => (
        <Link key={ev.id} href={`/admin/events/${ev.id}`}>
          <div
            data-testid={`row-event-${ev.id}`}
            className="flex items-center gap-3 py-2.5 border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] cursor-pointer transition-colors rounded px-1 -mx-1"
          >
            <span className="text-[10px] font-mono text-muted-foreground/40 w-6 shrink-0 text-right">#{ev.id}</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-white truncate">{ev.title}</p>
              <p className="text-[10px] font-mono text-muted-foreground/40">{ev.game}</p>
            </div>
            <StatusPill status={ev.status} />
            <span className="text-[10px] text-muted-foreground/40 shrink-0 hidden sm:block">{fmtRelative(ev.createdAt)}</span>
          </div>
        </Link>
      ))}
    </AdminSectionCard>
  );
}

// ─── Section: Queue by Surface ────────────────────────────────────────────────

function QueueBySurface() {
  const { data, isLoading } = useQuery<QueueList>({
    queryKey: ["/api/admin/display-queue?isActive=true&limit=200"],
    staleTime: 30_000,
  });

  const items = data?.data ?? [];

  const surfaceCounts = SURFACES.reduce<Record<string, number>>((acc, s) => {
    acc[s] = items.filter((i) => i.surface === s).length;
    return acc;
  }, {});

  return (
    <AdminSectionCard
      title="Queue by Surface"
      description="Active slots per editorial surface"
      action={
        <Link href="/admin/display-queue">
          <button className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-white transition-colors">
            Manage <ExternalLink className="w-3 h-3" />
          </button>
        </Link>
      }
    >
      {isLoading ? (
        <div className="grid grid-cols-2 gap-2 animate-pulse">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 bg-white/[0.04] rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {SURFACES.map((s) => {
            const meta  = SURFACE_META[s];
            const count = surfaceCounts[s] ?? 0;
            return (
              <div
                key={s}
                data-testid={`queue-surface-${s}`}
                className="flex flex-col gap-1 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3"
              >
                <span className={`text-[10px] font-mono font-semibold ${meta.accent}`}>{meta.label}</span>
                <span className="text-2xl font-bold text-white leading-none">{count}</span>
                <span className="text-[10px] text-muted-foreground/50">active slots</span>
              </div>
            );
          })}
        </div>
      )}
    </AdminSectionCard>
  );
}

// ─── Section: Recent Media ────────────────────────────────────────────────────

function RecentMedia() {
  const { data, isLoading } = useQuery<MediaList>({
    queryKey: ["/api/admin/media?limit=6"],
    staleTime: 30_000,
  });

  const assets = data?.data ?? [];

  return (
    <AdminSectionCard
      title="Recent Uploads"
      description="Latest images in the media library"
      action={
        <Link href="/admin/media">
          <button className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-white transition-colors">
            Library <ExternalLink className="w-3 h-3" />
          </button>
        </Link>
      }
    >
      {isLoading && (
        <div className="grid grid-cols-3 gap-2 animate-pulse">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="aspect-video bg-white/[0.04] rounded-lg" />
          ))}
        </div>
      )}
      {!isLoading && assets.length === 0 && (
        <div className="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground/30">
          <FileImage className="w-7 h-7" />
          <p className="text-xs italic">No uploads yet</p>
        </div>
      )}
      {!isLoading && assets.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {assets.map((a) => (
            <div
              key={a.id}
              data-testid={`thumb-media-${a.id}`}
              className="group relative rounded-lg border border-white/[0.06] overflow-hidden bg-black/20"
            >
              <img
                src={a.publicUrl}
                alt={a.fileName}
                className="w-full aspect-video object-cover group-hover:scale-105 transition-transform duration-300"
                loading="lazy"
              />
              <div className="absolute bottom-0 left-0 right-0 bg-black/70 px-1.5 py-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <p className="text-[9px] text-white/80 truncate">{a.fileName}</p>
                <p className="text-[9px] text-white/50">{fmtBytes(a.fileSize)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </AdminSectionCard>
  );
}

// ─── Section: Draft Markets ──────────────────────────────────────────────────

function DraftMarkets() {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(true);
  const { data, isLoading, isError, refetch } = useQuery<DraftMarketList>({
    queryKey: ["/api/predictions/admin/markets/drafts"],
    staleTime: 30_000,
  });

  const openMutation = useMutation({
    mutationFn: async (marketId: number) => {
      const res = await apiRequest("POST", `/api/predictions/markets/${marketId}/open`);
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.message ?? "Failed to open market");
      }
      return res.json();
    },
    onSuccess: (_d, marketId) => {
      toast({ title: `Market #${marketId} opened`, description: "Status changed to OPEN — now tradeable." });
      queryClient.invalidateQueries({ queryKey: ["/api/predictions/admin/markets/drafts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/predictions/home"] });
    },
    onError: (err: any) => {
      toast({ title: "Failed to open market", description: err.message, variant: "destructive" });
    },
  });

  const backfillMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/predictions/admin/markets/backfill-queue");
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.message ?? "Backfill failed");
      }
      return res.json() as Promise<{ ok: boolean; created: number; opened: number; skipped: number; errors: number }>;
    },
    onSuccess: (d) => {
      toast({
        title: "Queue backfill complete",
        description: `Created ${d.created} • Opened ${d.opened} • Skipped ${d.skipped} • Errors ${d.errors}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/predictions/admin/markets/drafts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/predictions/home"] });
    },
    onError: (err: any) => {
      toast({ title: "Backfill failed", description: err.message, variant: "destructive" });
    },
  });

  const items = data?.items ?? [];

  return (
    <AdminSectionCard
      title="Draft Markets"
      description="Markets waiting to be opened for trading"
      action={
        <div className="flex items-center gap-2">
          <button
            onClick={() => backfillMutation.mutate()}
            disabled={backfillMutation.isPending}
            className="flex items-center gap-1 text-[11px] text-amber-400 hover:text-amber-200 disabled:opacity-50 transition-colors font-medium"
            data-testid="button-backfill-queue"
          >
            {backfillMutation.isPending ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Play className="w-3 h-3" />
            )}
            Backfill Queue
          </button>
          <span className="text-muted-foreground/30 text-[10px]">|</span>
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-white transition-colors"
            data-testid="button-refresh-drafts"
          >
            Refresh
          </button>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-white transition-colors"
            data-testid="button-toggle-drafts"
          >
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expanded ? "" : "-rotate-90"}`} />
          </button>
        </div>
      }
    >
      {!expanded ? null : (<>
      {isLoading && <SkeletonRows n={3} />}
      {!isLoading && isError && (
        <div className="flex flex-col items-center justify-center py-8 gap-2 text-red-400/60">
          <AlertTriangle className="w-7 h-7" />
          <p className="text-xs italic">Failed to load draft markets</p>
          <button onClick={() => refetch()} className="text-[11px] underline hover:text-white transition-colors" data-testid="button-retry-drafts">Retry</button>
        </div>
      )}
      {!isLoading && !isError && items.length === 0 && (
        <div className="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground/30">
          <ShoppingCart className="w-7 h-7" />
          <p className="text-xs italic">No draft markets</p>
        </div>
      )}
      {items.map((item) => {
        const teams = item.teamAName && item.teamBName
          ? `${item.teamAName} vs ${item.teamBName}`
          : null;
        const scheduledLabel = item.startsAt
          ? new Date(item.startsAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
          : null;

        return (
          <div
            key={item.marketId}
            data-testid={`row-draft-market-${item.marketId}`}
            className="flex items-center gap-3 py-2.5 border-b border-white/[0.04] last:border-0 px-1 -mx-1"
          >
            <span className="text-[10px] font-mono text-muted-foreground/40 w-6 shrink-0 text-right">#{item.marketId}</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-white truncate">{teams ?? item.eventTitle ?? item.question}</p>
              <div className="flex items-center gap-2 mt-0.5">
                {item.game && (
                  <span className="text-[10px] font-mono text-muted-foreground/40">{item.game}</span>
                )}
                {scheduledLabel && (
                  <span className="text-[10px] text-muted-foreground/40">{scheduledLabel}</span>
                )}
                {item.outcomes.length > 0 && (
                  <span className="text-[10px] text-muted-foreground/30">
                    {item.outcomes.map((o) => o.label).join(" / ")}
                  </span>
                )}
              </div>
            </div>
            <Badge variant="outline" className="text-[10px] font-mono text-amber-400 border-amber-500/20 bg-amber-500/10 shrink-0">
              DRAFT
            </Badge>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2.5 text-xs border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
              disabled={openMutation.isPending}
              onClick={() => openMutation.mutate(item.marketId)}
              data-testid={`button-open-market-${item.marketId}`}
            >
              {openMutation.isPending ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <>
                  <Play className="w-3 h-3 mr-1" />
                  Open
                </>
              )}
            </Button>
          </div>
        );
      })}
      </>)}
    </AdminSectionCard>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function AdminPredictDashboard() {

  // Stat queries — limit=1 so the server returns minimal data, we only need `total`
  const { data: pendingData,   isLoading: loadingPending }   = useQuery<CandidateList>({
    queryKey: ["/api/admin/ingestion/candidates?reviewStatus=pending_review&limit=1"],
    staleTime: 30_000,
  });
  const { data: approvedData,  isLoading: loadingApproved }  = useQuery<CandidateList>({
    queryKey: ["/api/admin/ingestion/candidates?reviewStatus=approved&limit=1"],
    staleTime: 30_000,
  });
  const { data: needsEditData, isLoading: loadingNeedsEdit } = useQuery<CandidateList>({
    queryKey: ["/api/admin/ingestion/candidates?reviewStatus=needs_edit&limit=1"],
    staleTime: 30_000,
  });
  const { data: eventsData,    isLoading: loadingEvents }    = useQuery<EventList>({
    queryKey: ["/api/predictions/events"],
    staleTime: 30_000,
  });
  const { data: queueData,     isLoading: loadingQueue }     = useQuery<QueueList>({
    queryKey: ["/api/admin/display-queue?isActive=true&limit=1"],
    staleTime: 30_000,
  });
  const { data: mediaData,     isLoading: loadingMedia }     = useQuery<MediaList>({
    queryKey: ["/api/admin/media?limit=1"],
    staleTime: 30_000,
  });
  const { data: draftsData,    isLoading: loadingDrafts }    = useQuery<DraftMarketList>({
    queryKey: ["/api/predictions/admin/markets/drafts"],
    staleTime: 30_000,
  });

  function fmt(loading: boolean, value?: number): string {
    if (loading) return "…";
    return value !== undefined ? String(value) : "—";
  }

  return (
    <PredictAdminLayout
      title="Overview"
      subtitle="Predict domain — ingestion, events and editorial ops"
    >

      {/* ── 6 live stat cards ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
        <AdminStatCard
          data-testid="stat-pending-review"
          label="Pending Review"
          value={fmt(loadingPending, pendingData?.total)}
          sub="awaiting action"
          accent="amber"
        />
        <AdminStatCard
          data-testid="stat-approved"
          label="Approved"
          value={fmt(loadingApproved, approvedData?.total)}
          sub="ready to publish"
          accent="green"
        />
        <AdminStatCard
          data-testid="stat-needs-edit"
          label="Needs Edit"
          value={fmt(loadingNeedsEdit, needsEditData?.total)}
          sub="flagged for revision"
          accent="red"
        />
        <AdminStatCard
          data-testid="stat-published"
          label="Published"
          value={fmt(loadingEvents, eventsData?.total ?? eventsData?.events?.length)}
          sub="live prediction events"
          accent="cyan"
        />
        <AdminStatCard
          data-testid="stat-active-queue"
          label="Active Queue"
          value={fmt(loadingQueue, queueData?.total)}
          sub="slots across surfaces"
          accent="violet"
        />
        <AdminStatCard
          data-testid="stat-media-assets"
          label="Media Assets"
          value={fmt(loadingMedia, mediaData?.total)}
          sub="uploaded images"
          accent="cyan"
        />
        <AdminStatCard
          data-testid="stat-draft-markets"
          label="Draft Markets"
          value={fmt(loadingDrafts, draftsData?.total)}
          sub="awaiting open"
          accent="amber"
        />
      </div>

      {/* ── Recent Candidates (2/3) + Queue by Surface (1/3) ─────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <RecentCandidates />
        </div>
        <QueueBySurface />
      </div>

      {/* ── Recent Events (2/3) + Recent Media (1/3) ──────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <RecentPublishedEvents />
        </div>
        <RecentMedia />
      </div>

      {/* ── Draft Markets ───────────────────────────────────────────────── */}
      <DraftMarkets />

      {/* ── Quick access module cards ─────────────────────────────────────── */}
      <AdminSectionCard title="Quick Access" description="Jump directly to each operational module">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {SECTIONS.map(({ href, icon: Icon, label, desc, accent, bg }) => (
            <Link key={href} href={href}>
              <div
                data-testid={`section-card-${label.toLowerCase().replace(/\s+/g, "-")}`}
                className="group border border-white/[0.08] rounded-xl p-4 hover:border-white/20 hover:bg-white/[0.03] transition-all duration-200 cursor-pointer"
              >
                <div className="flex items-start gap-3">
                  <div className={`w-9 h-9 rounded-lg ${bg} flex items-center justify-center shrink-0`}>
                    <Icon className={`w-[18px] h-[18px] ${accent}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-white mb-0.5">{label}</div>
                    <div className="text-xs text-muted-foreground leading-relaxed">{desc}</div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground/30 group-hover:text-white/60 transition-colors shrink-0 mt-0.5" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      </AdminSectionCard>

    </PredictAdminLayout>
  );
}

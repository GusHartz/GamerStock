import { useState } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { PredictAdminLayout, AdminSectionCard, StatusBadge } from "./predict-layout";
import {
  RefreshCw, ArrowLeft, ImageIcon, Link2, Loader2, AlertCircle,
  FileImage, CheckCircle2, Activity, Layers,
} from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";

// ─── Types ────────────────────────────────────────────────────────────────────

type PredictionEvent = {
  id: number;
  uid: string;
  title: string;
  game: string;
  region: string | null;
  eventType: string;
  status: string;
  tournamentName: string | null;
  eventName: string | null;
  teamAName: string | null;
  teamBName: string | null;
  startsAt: string | null;
  externalRef: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

type MediaAsset = {
  id: number;
  fileName: string;
  publicUrl: string;
  mimeType: string;
  fileSize: number;
  assetType: string;
  createdAt: string;
};

type EventMediaLink = {
  id: number;
  predictionEventId: number;
  mediaAssetId: number;
  usageType: string;
  sortOrder: number;
  createdAt: string;
  asset: MediaAsset | null;
};

type QueueItem = {
  id: number;
  surface: string;
  position: number;
  isActive: boolean;
  endsAt: string | null;
  startsAt: string | null;
  curationLabel: string | null;
};

type LibraryResponse = { data: MediaAsset[]; total: number };
type EventMediaResponse = { data: EventMediaLink[]; total: number };
type QueueResponse = { data: QueueItem[]; total: number };

// ─── Transition map (mirrors backend logic) ───────────────────────────────────

const EVENT_TRANSITIONS: Record<string, string[]> = {
  scheduled: ["live", "cancelled", "postponed", "finished"],
  live:      ["finished", "cancelled"],
  postponed: ["scheduled", "cancelled"],
  finished:  [],
  cancelled: [],
};

const STATUS_LABELS: Record<string, string> = {
  scheduled: "Scheduled",
  live:      "Live",
  finished:  "Finished",
  cancelled: "Cancelled",
  postponed: "Postponed",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

async function adminPost(path: string, body: unknown) {
  const res = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? json.message ?? "Request failed");
  return json;
}

const USAGE_TYPES = ["card", "hero", "thumbnail", "banner"] as const;
type UsageType = typeof USAGE_TYPES[number];

// ─── Event Status Section ─────────────────────────────────────────────────────

function EventStatusSection({ event, onSuccess }: { event: PredictionEvent; onSuccess: () => void }) {
  const { toast } = useToast();
  const allowed = EVENT_TRANSITIONS[event.status] ?? [];
  const [selected, setSelected] = useState<string>("");

  const mutation = useMutation({
    mutationFn: (newStatus: string) =>
      adminPost(`/api/predictions/events/${event.id}/status`, { status: newStatus }),
    onSuccess: (data) => {
      toast({
        title: "Status updated",
        description: `Event #${event.id}: ${data.previousStatus} → ${data.newStatus}`,
      });
      setSelected("");
      onSuccess();
    },
    onError: (err: Error) =>
      toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  const isTerminal = allowed.length === 0;

  return (
    <div className="space-y-4">
      {/* Current status */}
      <div className="flex items-center gap-3">
        <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Current</span>
        <StatusBadge status={event.status} />
        {isTerminal && (
          <span className="text-[11px] text-muted-foreground/50 italic">terminal — no further transitions</span>
        )}
      </div>

      {/* Transition controls */}
      {!isTerminal && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider shrink-0">Transition to</span>

          <select
            data-testid="select-event-status"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            disabled={mutation.isPending}
            className="rounded-md border border-white/10 bg-white/[0.04] text-sm text-white px-3 py-1.5 focus:outline-none focus:border-cyan-400/50 disabled:opacity-40"
          >
            <option value="">— select new status —</option>
            {allowed.map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s] ?? s}</option>
            ))}
          </select>

          <button
            data-testid="button-update-event-status"
            onClick={() => selected && mutation.mutate(selected)}
            disabled={!selected || mutation.isPending}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-cyan-500 hover:bg-cyan-400 text-black text-xs font-semibold disabled:opacity-40 transition-colors"
          >
            {mutation.isPending
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <CheckCircle2 className="w-3.5 h-3.5" />}
            {mutation.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      )}

      {/* Allowed transitions info */}
      {!isTerminal && (
        <p className="text-[11px] text-muted-foreground/50">
          Allowed from <strong className="text-muted-foreground">{event.status}</strong>:{" "}
          {allowed.map((s) => STATUS_LABELS[s] ?? s).join(", ")}.
          Changing event status does not automatically affect markets.
        </p>
      )}
    </div>
  );
}

// ─── Event Queue Section ──────────────────────────────────────────────────────

const SURFACE_ORDER = ["hero", "featured", "predictions", "upcoming"];

function EventQueueSection({ eventId }: { eventId: number }) {
  const { data, isLoading, isError } = useQuery<QueueResponse>({
    queryKey: ["/api/admin/display-queue", { entityId: eventId }],
    queryFn: async () => {
      const res = await fetch(
        `/api/admin/display-queue?entityType=event&entityId=${eventId}&limit=20`,
        { credentials: "include" }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load queue status");
      return json;
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading queue…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center gap-2 text-red-400 text-sm">
        <AlertCircle className="w-4 h-4" /> Failed to load queue status
      </div>
    );
  }

  const items = data?.data ?? [];

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground/40">
        <Layers className="w-8 h-8" />
        <p className="text-sm italic">Not in any display queue surface</p>
      </div>
    );
  }

  const sorted = [...items].sort(
    (a, b) => SURFACE_ORDER.indexOf(a.surface) - SURFACE_ORDER.indexOf(b.surface)
  );

  return (
    <div className="flex flex-col gap-2">
      {sorted.map((item) => (
        <div
          key={item.id}
          data-testid={`queue-slot-${item.id}`}
          className={`flex items-center justify-between px-4 py-2.5 rounded-lg border ${
            item.isActive
              ? "bg-emerald-500/5 border-emerald-500/15"
              : "bg-white/[0.02] border-white/[0.06] opacity-60"
          }`}
        >
          <div className="flex items-center gap-3">
            <Activity className={`w-3.5 h-3.5 ${item.isActive ? "text-emerald-400" : "text-muted-foreground/40"}`} />
            <div>
              <span className="text-sm font-medium text-white capitalize">{item.surface}</span>
              <span className="ml-2 text-xs font-mono text-muted-foreground">#{item.position}</span>
              {item.curationLabel && (
                <span className="ml-2 text-[11px] text-cyan-400/70 italic">"{item.curationLabel}"</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 text-[11px] shrink-0">
            {item.endsAt && (
              <span className="text-muted-foreground">
                until {new Date(item.endsAt).toLocaleDateString()}
              </span>
            )}
            <span
              className={`font-medium ${item.isActive ? "text-emerald-400" : "text-muted-foreground/50"}`}
            >
              {item.isActive ? "Active" : "Inactive"}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Event Media Section ──────────────────────────────────────────────────────

function EventMediaSection({ eventId }: { eventId: number }) {
  const [selectedAssetId, setSelectedAssetId] = useState<number | null>(null);
  const [usageType, setUsageType] = useState<UsageType>("card");
  const { toast } = useToast();

  const mediaQuery = useQuery<EventMediaResponse>({
    queryKey: ["/api/admin/media/events", String(eventId)],
    queryFn: async () => {
      const res = await fetch(`/api/admin/media/events/${eventId}`, { credentials: "include" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load event media");
      return json;
    },
  });

  const libraryQuery = useQuery<LibraryResponse>({
    queryKey: ["/api/admin/media"],
  });

  const attachMutation = useMutation({
    mutationFn: () =>
      adminPost(`/api/admin/media/events/${eventId}`, {
        mediaAssetId: selectedAssetId,
        usageType,
      }),
    onSuccess: (data) => {
      toast({ title: "Attached", description: data.message });
      setSelectedAssetId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/media/events", String(eventId)] });
    },
    onError: (err: Error) => {
      toast({ title: "Attach failed", description: err.message, variant: "destructive" });
    },
  });

  const eventMedia = mediaQuery.data?.data ?? [];
  const library    = libraryQuery.data?.data ?? [];

  return (
    <div className="space-y-5">
      {/* Attached media */}
      <div>
        <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-3">Attached Assets</p>
        {mediaQuery.isLoading && (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        )}
        {mediaQuery.isError && (
          <div className="flex items-center gap-2 text-red-400 text-sm">
            <AlertCircle className="w-4 h-4" /> Failed to load event media
          </div>
        )}
        {!mediaQuery.isLoading && !mediaQuery.isError && eventMedia.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground/40 gap-2">
            <FileImage className="w-8 h-8" />
            <p className="text-xs italic">No media attached yet</p>
          </div>
        )}
        {eventMedia.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {eventMedia.map((link) => (
              <div
                key={link.id}
                data-testid={`card-event-media-${link.id}`}
                className="rounded-lg border border-white/[0.07] bg-white/[0.03] overflow-hidden"
              >
                {link.asset ? (
                  <img
                    src={link.asset.publicUrl}
                    alt={link.asset.fileName}
                    className="w-full aspect-video object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full aspect-video bg-white/[0.03] flex items-center justify-center">
                    <ImageIcon className="w-5 h-5 text-muted-foreground/30" />
                  </div>
                )}
                <div className="p-2">
                  <p className="text-[10px] truncate text-white/70">{link.asset?.fileName ?? "—"}</p>
                  <span className="text-[10px] font-mono text-cyan-400/70">{link.usageType}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Attach form */}
      <div className="border-t border-white/[0.06] pt-5">
        <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-3">Attach Asset from Library</p>
        {libraryQuery.isLoading ? (
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading library…
          </div>
        ) : library.length === 0 ? (
          <p className="text-xs text-muted-foreground/50 italic">
            No assets in library.{" "}
            <Link href="/admin/media" className="text-cyan-400 hover:underline">Upload media first.</Link>
          </p>
        ) : (
          <div className="flex flex-col sm:flex-row gap-3">
            <select
              data-testid="select-media-asset"
              value={selectedAssetId ?? ""}
              onChange={(e) => setSelectedAssetId(e.target.value ? Number(e.target.value) : null)}
              className="flex-1 rounded-md border border-white/10 bg-white/[0.04] text-sm text-white px-3 py-2 focus:outline-none focus:border-cyan-400/50"
            >
              <option value="">— select asset —</option>
              {library.map((a) => (
                <option key={a.id} value={a.id}>
                  #{a.id} · {a.fileName}
                </option>
              ))}
            </select>

            <select
              data-testid="select-usage-type"
              value={usageType}
              onChange={(e) => setUsageType(e.target.value as UsageType)}
              className="rounded-md border border-white/10 bg-white/[0.04] text-sm text-white px-3 py-2 focus:outline-none focus:border-cyan-400/50"
            >
              {USAGE_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>

            <button
              data-testid="button-attach-media"
              onClick={() => attachMutation.mutate()}
              disabled={!selectedAssetId || attachMutation.isPending}
              className="flex items-center gap-1.5 px-4 py-2 text-xs rounded-md bg-cyan-500 hover:bg-cyan-400 text-black font-semibold disabled:opacity-40 transition-colors"
            >
              {attachMutation.isPending
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Link2 className="w-3.5 h-3.5" />}
              {attachMutation.isPending ? "Attaching…" : "Attach"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminEventDetailPage() {
  const params = useParams<{ eventId: string }>();
  const id = params.eventId;

  const { data, isLoading, isError, refetch } = useQuery<{ event: PredictionEvent }>({
    queryKey: ["/api/predictions/events", id],
    enabled: !!id,
  });

  const ev = data?.event;

  if (isLoading) {
    return (
      <PredictAdminLayout title="Loading…" breadcrumb="Events">
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="w-6 h-6 text-cyan-400 animate-spin" />
        </div>
      </PredictAdminLayout>
    );
  }

  if (isError || !ev) {
    return (
      <PredictAdminLayout title="Not Found" breadcrumb="Events">
        <div className="text-center py-20 text-muted-foreground">Event #{id} not found.</div>
      </PredictAdminLayout>
    );
  }

  function handleStatusUpdate() {
    queryClient.invalidateQueries({ queryKey: ["/api/predictions/events", id] });
    refetch();
  }

  return (
    <PredictAdminLayout title={`#${ev.id}`} subtitle={ev.title} breadcrumb="Events">

      {/* Back + status */}
      <div className="flex items-center justify-between">
        <Link href="/admin/events">
          <button
            data-testid="button-back-to-events"
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-white transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to events
          </button>
        </Link>
        <div className="flex items-center gap-2">
          <StatusBadge status={ev.status} />
          <span className="text-xs font-mono text-muted-foreground/50">{ev.uid}</span>
        </div>
      </div>

      {/* Lifecycle Control */}
      <AdminSectionCard
        title="Event Lifecycle"
        description="Manually advance or terminate the event status"
      >
        <EventStatusSection event={ev} onSuccess={handleStatusUpdate} />
      </AdminSectionCard>

      {/* Event Metadata */}
      <AdminSectionCard title="Event Metadata" description="Core fields of the prediction event">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
          <Field label="Title"       value={ev.title} />
          <Field label="Event Name"  value={ev.eventName} />
          <Field label="Game"        value={ev.game} />
          <Field label="Region"      value={ev.region} />
          <Field label="Event Type"  value={ev.eventType} />
          <Field label="Status"      value={ev.status} />
          <Field label="Team A"      value={ev.teamAName} />
          <Field label="Team B"      value={ev.teamBName} />
          <Field label="Starts At"   value={ev.startsAt ? new Date(ev.startsAt).toLocaleString() : null} />
          <Field label="Tournament"  value={ev.tournamentName} />
          <Field label="External Ref" value={ev.externalRef} />
        </div>
      </AdminSectionCard>

      {/* Publication Info */}
      <AdminSectionCard title="Publication Info" description="How and when this event was created">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
          <Field label="UID"         value={ev.uid} />
          <Field label="Created"     value={new Date(ev.createdAt).toLocaleString()} />
          <Field label="Updated"     value={new Date(ev.updatedAt).toLocaleString()} />
          {ev.metadata && (
            <Field label="Source"    value={String((ev.metadata as any).source ?? "—")} />
          )}
          {ev.metadata && (
            <Field label="Candidate" value={(ev.metadata as any).candidateId ? `#${(ev.metadata as any).candidateId}` : null} />
          )}
        </div>
      </AdminSectionCard>

      {/* Display Queue Status */}
      <AdminSectionCard
        title="Display Queue Status"
        description="Surfaces where this event is currently queued — active and inactive slots"
      >
        <EventQueueSection eventId={ev.id} />
      </AdminSectionCard>

      {/* Media */}
      <AdminSectionCard
        title="Media"
        description="Images and assets attached to this event — pick from the library or go upload new ones"
      >
        <EventMediaSection eventId={ev.id} />
      </AdminSectionCard>

      {/* Source metadata */}
      {ev.metadata && (
        <AdminSectionCard title="Source Metadata" description="Raw ingestion context">
          <pre className="text-[11px] font-mono text-muted-foreground bg-black/30 border border-white/[0.06] rounded-lg p-4 overflow-auto max-h-48 leading-relaxed">
            {JSON.stringify(ev.metadata, null, 2)}
          </pre>
        </AdminSectionCard>
      )}

    </PredictAdminLayout>
  );
}

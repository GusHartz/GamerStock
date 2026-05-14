import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { queryClient } from "@/lib/queryClient";
import { PredictAdminLayout, AdminSectionCard, AdminEmptyState } from "./predict-layout";
import { useToast } from "@/hooks/use-toast";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Layers, RefreshCw, ArrowUp, ArrowDown, Ban, Plus, Trash2, Pencil,
  ExternalLink, CheckCircle2, XCircle,
} from "lucide-react";

// ── Constants ─────────────────────────────────────────────────────────────────

const SURFACES = ["hero", "predictions", "featured", "upcoming"] as const;
type Surface = (typeof SURFACES)[number];

const surfaceColors: Record<Surface, string> = {
  hero:        "bg-violet-500/10 text-violet-300 border-violet-500/20",
  predictions: "bg-amber-500/10 text-amber-300 border-amber-500/20",
  featured:    "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
  upcoming:    "bg-blue-500/10 text-blue-300 border-blue-500/20",
};

const QUEUE_KEY = "/api/admin/display-queue?limit=200";

// ── Types ─────────────────────────────────────────────────────────────────────

type QueueItem = {
  id: number;
  entityType: string;
  entityId: number;
  surface: string;
  position: number;
  isActive: boolean;
  curationLabel: string | null;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type PredictionEvent = {
  id:             number;
  title:          string;
  game:           string;
  status:         string;
  startsAt:       string | null;
  teamAName:      string | null;
  teamBName:      string | null;
  eventName:      string | null;
  tournamentName: string | null;
};

// ── Event label helpers ───────────────────────────────────────────────────────

function formatGameLabel(game: string): string {
  const g = game.toLowerCase();
  if (g === "csgo" || g === "cs2" || g === "cs-go") return "CS2";
  if (g === "lol")                                   return "LoL";
  if (g === "valorant" || g === "val")               return "VAL";
  if (g === "dota2")                                 return "DOTA2";
  if (g === "r6")                                    return "R6";
  if (g === "rl")                                    return "RL";
  if (g === "cod")                                   return "CoD";
  if (g === "fifa")                                  return "FIFA";
  return game.toUpperCase();
}

function formatEventDate(startsAt: string | null | undefined): string {
  if (!startsAt) return "No date";
  const d = new Date(startsAt);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mn = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()} ${hh}:${mn}`;
}

function formatEventInfo(ev: PredictionEvent): string {
  if (ev.teamAName && ev.teamBName) return `${ev.teamAName} vs ${ev.teamBName}`;
  if (ev.title)                     return ev.title;
  if (ev.eventName)                 return ev.eventName;
  if (ev.tournamentName)            return ev.tournamentName;
  return `Event #${ev.id}`;
}

function formatEventLabel(ev: PredictionEvent): string {
  return `${formatGameLabel(ev.game)} - ${formatEventDate(ev.startsAt)} - ${formatEventInfo(ev)}`;
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function queueFetch(
  path: string,
  method: string,
  body?: Record<string, unknown>,
): Promise<any> {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: "include",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as any).error ?? (json as any).message ?? "Request failed");
  return json;
}

function invalidateQueue() {
  queryClient.invalidateQueries({
    predicate: (q) =>
      typeof q.queryKey[0] === "string" &&
      (q.queryKey[0] as string).startsWith("/api/admin/display-queue"),
  });
  queryClient.invalidateQueries({ queryKey: ["/api/predictions/home"] });
}

// ── datetime-local helpers ────────────────────────────────────────────────────

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  return iso.slice(0, 16);
}

function fromDatetimeLocal(val: string): string | null {
  if (!val) return null;
  return new Date(val).toISOString();
}

// ── Queue item editor Sheet ───────────────────────────────────────────────────

type EditorProps = {
  item: QueueItem | null;
  ev: PredictionEvent | undefined;
  onClose: () => void;
  onSaved: () => void;
};

function QueueItemEditor({ item, ev, onClose, onSaved }: EditorProps) {
  const [, navigate] = useLocation();
  const { toast }    = useToast();

  const [label,    setLabel]    = useState(item?.curationLabel ?? "");
  const [isActive, setIsActive] = useState(item?.isActive ?? true);
  const [startsAt, setStartsAt] = useState(toDatetimeLocal(item?.startsAt ?? null));
  const [endsAt,   setEndsAt]   = useState(toDatetimeLocal(item?.endsAt   ?? null));

  const updateMutation = useMutation({
    mutationFn: () =>
      queueFetch(`/api/admin/display-queue/${item!.id}`, "PATCH", {
        curationLabel: label.trim() || null,
        isActive,
        startsAt: fromDatetimeLocal(startsAt),
        endsAt:   fromDatetimeLocal(endsAt),
        updatedBy: "admin",
      }),
    onSuccess: (json) => {
      toast({ title: json.message ?? "Queue item saved" });
      invalidateQueue();
      onSaved();
    },
    onError: (err: Error) => toast({ title: err.message, variant: "destructive" }),
  });

  if (!item) return null;

  const isEvent  = item.entityType === "event" || item.entityType === "prediction_event";
  const dirty    = (label.trim() || null) !== (item.curationLabel ?? null) ||
                   isActive !== item.isActive ||
                   toDatetimeLocal(item.startsAt) !== startsAt ||
                   toDatetimeLocal(item.endsAt)   !== endsAt;

  return (
    <div className="flex flex-col gap-5">

      {/* ── Linked event info ── */}
      <div className="rounded-lg border border-white/[0.07] bg-white/[0.03] px-4 py-3 flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-wider mb-1">
            {item.entityType} #{item.entityId}
          </div>
          <div className="text-sm font-medium text-white leading-snug truncate">
            {ev ? formatEventInfo(ev) : `Entity #${item.entityId}`}
          </div>
          {ev && (
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[10px] font-mono text-muted-foreground/50 uppercase">
                {formatGameLabel(ev.game)}
              </span>
              <span className="text-[10px] text-muted-foreground/40">
                {formatEventDate(ev.startsAt)}
              </span>
            </div>
          )}
        </div>
        {isEvent && (
          <button
            data-testid={`button-open-event-${item.id}`}
            onClick={() => { onClose(); navigate(`/admin/events/${item.entityId}`); }}
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 text-xs font-medium hover:bg-cyan-500/20 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Open Event
          </button>
        )}
      </div>

      {/* ── Read-only placement info ── */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-wider">Surface</label>
          <div className={`inline-flex items-center px-2.5 py-1.5 rounded-lg border text-xs font-semibold uppercase tracking-wider w-fit ${
            surfaceColors[item.surface as Surface] ?? "bg-white/[0.04] text-muted-foreground border-white/[0.08]"
          }`}>
            {item.surface}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-wider">Position</label>
          <div className="text-sm font-mono text-white/70 py-1.5">#{item.position}</div>
        </div>
      </div>

      <div className="h-px bg-white/[0.05]" />

      {/* ── Editable: curation label ── */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-wider">
          Editorial Label <span className="normal-case opacity-50">(optional)</span>
        </label>
        <input
          data-testid={`input-edit-label-${item.id}`}
          type="text"
          placeholder="Custom display label…"
          maxLength={255}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="bg-card border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
        />
        <p className="text-[10px] text-muted-foreground/40">
          Overrides the event title shown on this surface. Leave blank to use the event name.
        </p>
      </div>

      {/* ── Editable: active toggle ── */}
      <div className="flex items-center justify-between rounded-lg border border-white/[0.07] px-4 py-3">
        <div>
          <div className="text-sm font-medium text-white">Active</div>
          <div className="text-[11px] text-muted-foreground/50 mt-0.5">
            Inactive items are hidden from the public surface
          </div>
        </div>
        <button
          data-testid={`button-toggle-active-${item.id}`}
          onClick={() => setIsActive((v) => !v)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
            isActive
              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-300 hover:bg-emerald-500/20"
              : "bg-white/[0.04] border-white/[0.08] text-muted-foreground hover:bg-white/[0.08]"
          }`}
        >
          {isActive
            ? <><CheckCircle2 className="w-3.5 h-3.5" /> Active</>
            : <><XCircle className="w-3.5 h-3.5" /> Inactive</>
          }
        </button>
      </div>

      {/* ── Editable: visibility window ── */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-wider">
            Visible From <span className="normal-case opacity-50">(optional)</span>
          </label>
          <input
            data-testid={`input-edit-starts-${item.id}`}
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            className="bg-card border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-cyan-500/50 [color-scheme:dark]"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-wider">
            Visible Until <span className="normal-case opacity-50">(optional)</span>
          </label>
          <input
            data-testid={`input-edit-ends-${item.id}`}
            type="datetime-local"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            className="bg-card border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-cyan-500/50 [color-scheme:dark]"
          />
        </div>
      </div>

      {/* ── Save ── */}
      <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/[0.05]">
        <button
          data-testid={`button-cancel-edit-${item.id}`}
          onClick={onClose}
          className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-white hover:bg-white/[0.05] transition-colors"
        >
          Cancel
        </button>
        <button
          data-testid={`button-save-edit-${item.id}`}
          onClick={() => updateMutation.mutate()}
          disabled={!dirty || updateMutation.isPending}
          className="flex items-center gap-2 px-5 py-2 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 text-sm font-medium hover:bg-cyan-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {updateMutation.isPending
            ? <RefreshCw className="w-4 h-4 animate-spin" />
            : null
          }
          Save Changes
        </button>
      </div>
    </div>
  );
}

// ── Queue item row ────────────────────────────────────────────────────────────

type ItemRowProps = {
  item: QueueItem;
  prevPos: number | null;
  nextPos: number | null;
  ev: PredictionEvent | undefined;
  pendingKey: string | null;
  onEdit: (item: QueueItem) => void;
  onReorder: (id: number, pos: number) => void;
  onDeactivate: (id: number) => void;
  onDelete: (id: number) => void;
};

function QueueItemRow({
  item, prevPos, nextPos, ev,
  pendingKey, onEdit, onReorder, onDeactivate, onDelete,
}: ItemRowProps) {
  const busy           = pendingKey !== null;
  const isReordering   = pendingKey === `${item.id}:reorder`;
  const isDeactivating = pendingKey === `${item.id}:deactivate`;
  const isDeleting     = pendingKey === `${item.id}:delete`;

  return (
    <div
      data-testid={`queue-item-${item.id}`}
      className={`flex flex-col gap-1.5 border rounded-lg px-3 py-2.5 transition-all ${
        item.isActive
          ? "bg-card border-white/[0.07]"
          : "bg-transparent border-white/[0.04] opacity-50"
      }`}
    >
      {/* Info */}
      <div className="flex items-start gap-2">
        <span className="shrink-0 text-[10px] font-mono text-muted-foreground/50 mt-0.5 w-4 text-right">
          {item.position}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-white truncate leading-tight">
            {item.curationLabel ?? (ev ? formatEventInfo(ev) : `Event #${item.entityId}`)}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            {ev && (
              <span className="text-[10px] font-mono text-muted-foreground/60 uppercase">
                {formatGameLabel(ev.game)}
              </span>
            )}
            {ev && (
              <span className="text-[10px] text-muted-foreground/40">
                {formatEventDate(ev.startsAt)}
              </span>
            )}
            <span className={`text-[10px] px-1 py-px rounded font-medium ${
              item.isActive
                ? "bg-emerald-500/10 text-emerald-400"
                : "bg-white/[0.04] text-muted-foreground/50"
            }`}>
              {item.isActive ? "active" : "inactive"}
            </span>
          </div>
        </div>
        <span className="text-[10px] font-mono text-muted-foreground/30 shrink-0">#{item.entityId}</span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-0.5 pt-1 border-t border-white/[0.04]">
        <button
          data-testid={`button-moveup-${item.id}`}
          onClick={() => onReorder(item.id, prevPos!)}
          disabled={prevPos === null || busy}
          title="Move up"
          className="flex items-center justify-center w-6 h-6 rounded hover:bg-white/[0.06] text-muted-foreground/50 hover:text-white transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
        >
          {isReordering ? <RefreshCw className="w-2.5 h-2.5 animate-spin" /> : <ArrowUp className="w-2.5 h-2.5" />}
        </button>

        <button
          data-testid={`button-movedown-${item.id}`}
          onClick={() => onReorder(item.id, nextPos!)}
          disabled={nextPos === null || busy}
          title="Move down"
          className="flex items-center justify-center w-6 h-6 rounded hover:bg-white/[0.06] text-muted-foreground/50 hover:text-white transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
        >
          {isReordering ? <RefreshCw className="w-2.5 h-2.5 animate-spin" /> : <ArrowDown className="w-2.5 h-2.5" />}
        </button>

        <span className="flex-1" />

        <button
          data-testid={`button-edit-${item.id}`}
          onClick={() => onEdit(item)}
          disabled={busy}
          title="Edit"
          className="flex items-center justify-center w-6 h-6 rounded hover:bg-cyan-500/10 text-muted-foreground/50 hover:text-cyan-400 transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
        >
          <Pencil className="w-2.5 h-2.5" />
        </button>

        {item.isActive && (
          <button
            data-testid={`button-deactivate-${item.id}`}
            onClick={() => onDeactivate(item.id)}
            disabled={busy}
            title="Deactivate"
            className="flex items-center justify-center w-6 h-6 rounded hover:bg-amber-500/10 text-muted-foreground/50 hover:text-amber-400 transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
          >
            {isDeactivating ? <RefreshCw className="w-2.5 h-2.5 animate-spin" /> : <Ban className="w-2.5 h-2.5" />}
          </button>
        )}

        <button
          data-testid={`button-delete-${item.id}`}
          onClick={() => onDelete(item.id)}
          disabled={busy}
          title="Remove"
          className="flex items-center justify-center w-6 h-6 rounded hover:bg-red-500/10 text-muted-foreground/50 hover:text-red-400 transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
        >
          {isDeleting ? <RefreshCw className="w-2.5 h-2.5 animate-spin" /> : <Trash2 className="w-2.5 h-2.5" />}
        </button>
      </div>
    </div>
  );
}

// ── Surface column ────────────────────────────────────────────────────────────

type ColumnProps = {
  surface: Surface;
  items: QueueItem[];
  eventsMap: Record<number, PredictionEvent>;
  pendingKey: string | null;
  onEdit: (item: QueueItem) => void;
  onReorder: (id: number, pos: number) => void;
  onDeactivate: (id: number) => void;
  onDelete: (id: number) => void;
};

function SurfaceColumn({ surface, items, eventsMap, pendingKey, onEdit, onReorder, onDeactivate, onDelete }: ColumnProps) {
  const active   = items.filter((i) => i.isActive).sort((a, b) => a.position - b.position);
  const inactive = items.filter((i) => !i.isActive).sort((a, b) => a.position - b.position);

  return (
    <div className="flex flex-col gap-2">
      <div className={`flex items-center justify-between px-3 py-2 rounded-lg border text-xs font-semibold uppercase tracking-widest ${surfaceColors[surface]}`}>
        <span>{surface}</span>
        <span className="font-mono opacity-60">{active.length} active</span>
      </div>

      {active.length === 0 && inactive.length === 0 ? (
        <div className="flex items-center justify-center py-6 border border-dashed border-white/[0.08] rounded-lg text-muted-foreground/40 text-xs">
          empty
        </div>
      ) : (
        <>
          {active.map((item, idx) => (
            <QueueItemRow
              key={item.id}
              item={item}
              ev={eventsMap[item.entityId]}
              prevPos={idx > 0 ? active[idx - 1].position : null}
              nextPos={idx < active.length - 1 ? active[idx + 1].position : null}
              pendingKey={pendingKey}
              onEdit={onEdit}
              onReorder={onReorder}
              onDeactivate={onDeactivate}
              onDelete={onDelete}
            />
          ))}
          {inactive.map((item) => (
            <QueueItemRow
              key={item.id}
              item={item}
              ev={eventsMap[item.entityId]}
              prevPos={null}
              nextPos={null}
              pendingKey={pendingKey}
              onEdit={onEdit}
              onReorder={onReorder}
              onDeactivate={onDeactivate}
              onDelete={onDelete}
            />
          ))}
        </>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminDisplayQueuePage() {
  const { toast } = useToast();

  const { data: qData, isLoading: qLoading, refetch, isFetching } = useQuery<{
    data: QueueItem[];
    total: number;
  }>({
    queryKey: [QUEUE_KEY],
  });

  const { data: evData } = useQuery<{ events: PredictionEvent[] }>({
    queryKey: ["/api/predictions/events"],
  });

  const items     = qData?.data ?? [];
  const events    = evData?.events ?? [];
  const eventsMap = Object.fromEntries(events.map((e) => [e.id, e]));

  // ── Add form state ──
  const [addEventId, setAddEventId] = useState("");
  const [addSurface, setAddSurface] = useState<Surface>("hero");
  const [addPosition, setAddPosition] = useState("");
  const [addLabel, setAddLabel]     = useState("");

  // ── Per-action pending key (format: "${id}:action") ──
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  // ── Editor sheet state ──
  const [editingItem, setEditingItem] = useState<QueueItem | null>(null);

  // ── Add mutation ──
  const addMutation = useMutation({
    mutationFn: () =>
      queueFetch("/api/admin/display-queue", "POST", {
        entityId:  Number(addEventId),
        surface:   addSurface,
        ...(addPosition ? { position: Number(addPosition) } : {}),
        ...(addLabel    ? { curationLabel: addLabel }       : {}),
        createdBy: "admin",
      }),
    onSuccess: (json) => {
      toast({ title: json.message ?? "Added to queue" });
      setAddEventId("");
      setAddPosition("");
      setAddLabel("");
      invalidateQueue();
    },
    onError: (err: Error) => toast({ title: err.message, variant: "destructive" }),
  });

  // ── Reorder mutation ──
  const reorderMutation = useMutation({
    mutationFn: ({ id, position }: { id: number; position: number }) =>
      queueFetch(`/api/admin/display-queue/${id}/reorder`, "POST", { position, updatedBy: "admin" }),
    onMutate: ({ id }) => setPendingKey(`${id}:reorder`),
    onSuccess: (json) => { toast({ title: json.message ?? "Reordered" }); invalidateQueue(); },
    onError:   (err: Error) => toast({ title: err.message, variant: "destructive" }),
    onSettled: () => setPendingKey(null),
  });

  // ── Deactivate mutation ──
  const deactivateMutation = useMutation({
    mutationFn: (id: number) =>
      queueFetch(`/api/admin/display-queue/${id}/deactivate`, "POST", { updatedBy: "admin" }),
    onMutate:  (id) => setPendingKey(`${id}:deactivate`),
    onSuccess: (json) => { toast({ title: json.message ?? "Deactivated" }); invalidateQueue(); },
    onError:   (err: Error) => toast({ title: err.message, variant: "destructive" }),
    onSettled: () => setPendingKey(null),
  });

  // ── Delete mutation ──
  const deleteMutation = useMutation({
    mutationFn: (id: number) => queueFetch(`/api/admin/display-queue/${id}`, "DELETE"),
    onMutate:  (id) => setPendingKey(`${id}:delete`),
    onSuccess: (json) => { toast({ title: json.message ?? "Removed" }); invalidateQueue(); },
    onError:   (err: Error) => toast({ title: err.message, variant: "destructive" }),
    onSettled: () => setPendingKey(null),
  });

  const isAnyPending = pendingKey !== null || addMutation.isPending;
  const canAdd       = !!addEventId && !isAnyPending;

  const itemsBySurface = SURFACES.reduce<Record<Surface, QueueItem[]>>((acc, s) => {
    acc[s] = items.filter((i) => i.surface === s);
    return acc;
  }, {} as Record<Surface, QueueItem[]>);

  const editingEv = editingItem ? eventsMap[editingItem.entityId] : undefined;

  return (
    <PredictAdminLayout
      title="Display Queue"
      subtitle="Curate events across editorial surfaces"
    >
      {/* ── Queue item editor sheet ── */}
      <Sheet open={!!editingItem} onOpenChange={(open) => { if (!open) setEditingItem(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-md bg-background border-white/[0.08] overflow-y-auto">
          <SheetHeader className="mb-5">
            <SheetTitle className="text-white">Edit Queue Item</SheetTitle>
            <SheetDescription className="text-muted-foreground/60 text-sm">
              Adjust editorial settings for this placement. Use "Open Event" to edit the event itself.
            </SheetDescription>
          </SheetHeader>
          <QueueItemEditor
            key={editingItem?.id}
            item={editingItem}
            ev={editingEv}
            onClose={() => setEditingItem(null)}
            onSaved={() => setEditingItem(null)}
          />
        </SheetContent>
      </Sheet>

      {/* ── Add to Queue ── */}
      <AdminSectionCard
        title="Add to Queue"
        description="Choose a published prediction event and a target surface"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-mono text-muted-foreground uppercase tracking-wider">Event *</label>
            <select
              data-testid="select-add-event"
              value={addEventId}
              onChange={(e) => setAddEventId(e.target.value)}
              disabled={isAnyPending}
              className="bg-card border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-cyan-500/50 disabled:opacity-50"
            >
              <option value="">— select event —</option>
              {events.map((ev) => (
                <option key={ev.id} value={String(ev.id)}>
                  {formatEventLabel(ev)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-mono text-muted-foreground uppercase tracking-wider">Surface *</label>
            <select
              data-testid="select-add-surface"
              value={addSurface}
              onChange={(e) => setAddSurface(e.target.value as Surface)}
              disabled={isAnyPending}
              className="bg-card border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-cyan-500/50 disabled:opacity-50"
            >
              {SURFACES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-mono text-muted-foreground uppercase tracking-wider">
              Position <span className="normal-case opacity-50">(optional)</span>
            </label>
            <input
              data-testid="input-add-position"
              type="number"
              min={1}
              placeholder="auto"
              value={addPosition}
              onChange={(e) => setAddPosition(e.target.value)}
              disabled={isAnyPending}
              className="bg-card border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-cyan-500/50 disabled:opacity-50"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-mono text-muted-foreground uppercase tracking-wider">
              Label <span className="normal-case opacity-50">(optional)</span>
            </label>
            <input
              data-testid="input-add-label"
              type="text"
              placeholder="editorial label"
              maxLength={255}
              value={addLabel}
              onChange={(e) => setAddLabel(e.target.value)}
              disabled={isAnyPending}
              className="bg-card border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-cyan-500/50 disabled:opacity-50"
            />
          </div>
        </div>

        <div className="flex justify-end mt-4 pt-3 border-t border-white/[0.05]">
          <button
            data-testid="button-add-to-queue"
            onClick={() => addMutation.mutate()}
            disabled={!canAdd}
            className="flex items-center gap-2 px-5 py-2 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 text-sm font-medium hover:bg-cyan-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {addMutation.isPending
              ? <RefreshCw className="w-4 h-4 animate-spin" />
              : <Plus className="w-4 h-4" />
            }
            Add to Queue
          </button>
        </div>
      </AdminSectionCard>

      {/* ── Surfaces grid ── */}
      <AdminSectionCard
        title="Surfaces"
        description={
          isAnyPending && !addMutation.isPending
            ? "Applying change…"
            : `${items.length} item${items.length !== 1 ? "s" : ""} across ${SURFACES.length} surfaces`
        }
        action={
          <button
            data-testid="button-refresh-queue"
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-xs text-muted-foreground hover:text-white transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
        }
      >
        {qLoading ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="w-5 h-5 text-cyan-400 animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <AdminEmptyState
            icon={<Layers className="w-10 h-10" />}
            message="Display queue is empty"
            hint="Use the form above to add a published event to a surface"
          />
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {SURFACES.map((s) => (
              <SurfaceColumn
                key={s}
                surface={s}
                items={itemsBySurface[s]}
                eventsMap={eventsMap}
                pendingKey={pendingKey}
                onEdit={setEditingItem}
                onReorder={(id, pos) => reorderMutation.mutate({ id, position: pos })}
                onDeactivate={(id) => deactivateMutation.mutate(id)}
                onDelete={(id) => deleteMutation.mutate(id)}
              />
            ))}
          </div>
        )}
      </AdminSectionCard>
    </PredictAdminLayout>
  );
}

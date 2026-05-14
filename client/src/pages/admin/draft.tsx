import { useState } from "react";
import { AdminLayout } from "./layout";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  CalendarDays, Plus, Lock, Unlock, X, Edit2, ChevronDown, ChevronUp,
  Clock, CheckCircle, AlertTriangle, RefreshCw,
} from "lucide-react";

interface DraftWeek {
  id: string;
  game: string;
  region: string;
  startAt: string;
  lockAt: string;
  endAt: string;
  status: "open" | "locked" | "scoring" | "closed";
  createdAt: string;
}

const STATUS_STYLES: Record<string, string> = {
  open: "text-emerald-400 bg-emerald-400/10 border-emerald-400/30",
  locked: "text-amber-400 bg-amber-400/10 border-amber-400/30",
  scoring: "text-sky-400 bg-sky-400/10 border-sky-400/30",
  closed: "text-muted-foreground bg-white/5 border-white/10",
};

const STATUS_ICONS: Record<string, typeof CheckCircle> = {
  open: Unlock,
  locked: Lock,
  scoring: RefreshCw,
  closed: X,
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZoneName: "short",
  });
}

function fmtDateInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localToUtcIso(localDt: string) {
  return new Date(localDt).toISOString();
}

const GAMES = ["league_of_legends", "valorant", "cs2"] as const;
const REGIONS = ["NA", "EUW", "EUNE", "KR", "BR", "LAN", "LAS", "OCE", "TR", "RU"] as const;
const STATUSES = ["open", "locked", "scoring", "closed"] as const;

// ─── Create / Edit Form ───────────────────────────────────────────────────────
function WeekForm({
  initial,
  onCancel,
  onSaved,
}: {
  initial?: DraftWeek;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const isEdit = !!initial;

  const now = new Date();
  const defaultStart = fmtDateInput(initial?.startAt ?? now.toISOString());
  const defaultLock = fmtDateInput(initial?.lockAt ?? new Date(now.getTime() + 7 * 86400_000).toISOString());
  const defaultEnd = fmtDateInput(initial?.endAt ?? new Date(now.getTime() + 8 * 86400_000).toISOString());

  const [game, setGame] = useState(initial?.game ?? "league_of_legends");
  const [region, setRegion] = useState(initial?.region ?? "NA");
  const [startAt, setStartAt] = useState(defaultStart);
  const [lockAt, setLockAt] = useState(defaultLock);
  const [endAt, setEndAt] = useState(defaultEnd);
  const [status, setStatus] = useState<string>(initial?.status ?? "open");

  const mutation = useMutation({
    mutationFn: async () => {
      const body = {
        game,
        region,
        startAt: localToUtcIso(startAt),
        lockAt: localToUtcIso(lockAt),
        endAt: localToUtcIso(endAt),
        status,
      };
      if (isEdit) {
        const res = await apiRequest("PATCH", `/api/draft/admin/weeks/${initial!.id}`, body);
        if (!res.ok) { const e = await res.json(); throw new Error(e.message || "Update failed"); }
        return res.json();
      } else {
        const res = await apiRequest("POST", "/api/draft/admin/weeks", body);
        if (!res.ok) { const e = await res.json(); throw new Error(e.message || "Create failed"); }
        return res.json();
      }
    },
    onSuccess: () => {
      toast({ title: isEdit ? "Draft week updated" : "Draft week created", variant: "default" });
      qc.invalidateQueries({ queryKey: ["/api/draft/admin/weeks"] });
      onSaved();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const inputCls = "w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500 transition";
  const selectCls = inputCls + " appearance-none";
  const labelCls = "block text-xs text-muted-foreground mb-1";

  return (
    <div className="bg-white/[0.03] border border-white/10 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">{isEdit ? "Edit Draft Week" : "Create Draft Week"}</h3>
        <button onClick={onCancel} className="text-muted-foreground hover:text-white transition">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Game</label>
          <select data-testid="input-game" className={selectCls} value={game} onChange={(e) => setGame(e.target.value)}>
            {GAMES.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Region</label>
          <select data-testid="input-region" className={selectCls} value={region} onChange={(e) => setRegion(e.target.value)}>
            {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={labelCls}>Start (local time)</label>
          <input data-testid="input-start-at" type="datetime-local" className={inputCls} value={startAt} onChange={(e) => setStartAt(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Lock (local time)</label>
          <input data-testid="input-lock-at" type="datetime-local" className={inputCls} value={lockAt} onChange={(e) => setLockAt(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>End (local time)</label>
          <input data-testid="input-end-at" type="datetime-local" className={inputCls} value={endAt} onChange={(e) => setEndAt(e.target.value)} />
        </div>
      </div>

      <div>
        <label className={labelCls}>Initial Status</label>
        <select data-testid="input-status" className={selectCls} value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="flex gap-2 pt-1">
        <Button
          data-testid="button-save-week"
          size="sm"
          className="bg-violet-600 hover:bg-violet-700 text-white"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
        >
          {mutation.isPending ? <RefreshCw className="w-3 h-3 mr-1 animate-spin" /> : null}
          {isEdit ? "Save Changes" : "Create Week"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} className="text-muted-foreground">
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const Icon = STATUS_ICONS[status] ?? Clock;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${STATUS_STYLES[status] ?? "text-muted-foreground bg-white/5 border-white/10"}`}>
      <Icon className="w-3 h-3" />
      {status}
    </span>
  );
}

// ─── Transition buttons ───────────────────────────────────────────────────────
function TransitionButtons({
  week,
  onDone,
}: {
  week: DraftWeek;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  function useTransition(targetStatus: string, endpoint: string) {
    return useMutation({
      mutationFn: async () => {
        const res = await apiRequest("POST", endpoint, {});
        if (!res.ok) { const e = await res.json(); throw new Error(e.message || `Failed to set ${targetStatus}`); }
        return res.json();
      },
      onSuccess: () => {
        toast({ title: `Week set to "${targetStatus}"` });
        qc.invalidateQueries({ queryKey: ["/api/draft/admin/weeks"] });
        onDone();
      },
      onError: (err: Error) => {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      },
    });
  }

  const openMut = useTransition("open", `/api/draft/admin/weeks/${week.id}/open`);
  const lockMut = useTransition("locked", `/api/draft/admin/weeks/${week.id}/lock`);
  const closeMut = useTransition("closed", `/api/draft/admin/weeks/${week.id}/close`);

  const isPending = openMut.isPending || lockMut.isPending || closeMut.isPending;

  return (
    <div className="flex gap-1.5 flex-wrap">
      {week.status !== "open" && (
        <Button
          data-testid={`button-open-${week.id}`}
          size="sm"
          variant="outline"
          className="h-7 text-xs border-emerald-400/30 text-emerald-400 hover:bg-emerald-400/10"
          onClick={() => openMut.mutate()}
          disabled={isPending}
        >
          <Unlock className="w-3 h-3 mr-1" /> Open
        </Button>
      )}
      {week.status !== "locked" && (
        <Button
          data-testid={`button-lock-${week.id}`}
          size="sm"
          variant="outline"
          className="h-7 text-xs border-amber-400/30 text-amber-400 hover:bg-amber-400/10"
          onClick={() => lockMut.mutate()}
          disabled={isPending}
        >
          <Lock className="w-3 h-3 mr-1" /> Lock
        </Button>
      )}
      {week.status !== "closed" && (
        <Button
          data-testid={`button-close-${week.id}`}
          size="sm"
          variant="outline"
          className="h-7 text-xs border-white/20 text-muted-foreground hover:text-white hover:bg-white/5"
          onClick={() => closeMut.mutate()}
          disabled={isPending}
        >
          <X className="w-3 h-3 mr-1" /> Close
        </Button>
      )}
    </div>
  );
}

// ─── Current week card ────────────────────────────────────────────────────────
function CurrentWeekCard({ week }: { week: DraftWeek }) {
  const [editing, setEditing] = useState(false);
  const qc = useQueryClient();

  if (editing) {
    return (
      <WeekForm
        initial={week}
        onCancel={() => setEditing(false)}
        onSaved={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="bg-white/[0.03] border border-violet-500/30 rounded-xl p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-violet-500/20 to-purple-700/20 border border-violet-500/20 flex items-center justify-center">
            <CalendarDays className="w-4 h-4 text-violet-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-white">{week.game} · {week.region}</span>
              <StatusBadge status={week.status} />
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 font-mono">{week.id}</p>
          </div>
        </div>
        <Button
          data-testid="button-edit-current-week"
          size="sm"
          variant="ghost"
          className="text-muted-foreground hover:text-white"
          onClick={() => setEditing(true)}
        >
          <Edit2 className="w-3.5 h-3.5 mr-1" /> Edit
        </Button>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3 text-xs">
        <div>
          <p className="text-muted-foreground">Start</p>
          <p className="text-white mt-0.5">{fmtDate(week.startAt)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Lock Deadline</p>
          <p className="text-white mt-0.5">{fmtDate(week.lockAt)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">End</p>
          <p className="text-white mt-0.5">{fmtDate(week.endAt)}</p>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-white/10">
        <TransitionButtons week={week} onDone={() => {}} />
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function AdminDraftPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAllWeeks, setShowAllWeeks] = useState(false);
  const qc = useQueryClient();

  const weeksQuery = useQuery<{ weeks: DraftWeek[] }>({
    queryKey: ["/api/draft/admin/weeks"],
    refetchInterval: 15_000,
  });

  const weeks = weeksQuery.data?.weeks ?? [];
  const currentWeek = weeks.find((w) => w.status === "open") ?? weeks[0] ?? null;
  const displayedWeeks = showAllWeeks ? weeks : weeks.slice(0, 10);

  return (
    <AdminLayout>
      <div className="space-y-6 max-w-5xl">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Draft Week Management</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Create and manage Weekly Performance Draft windows
            </p>
          </div>
          <Button
            data-testid="button-new-week"
            size="sm"
            className="bg-violet-600 hover:bg-violet-700 text-white"
            onClick={() => { setShowCreate(true); setEditingId(null); }}
          >
            <Plus className="w-4 h-4 mr-1" /> New Draft Week
          </Button>
        </div>

        {showCreate && (
          <WeekForm
            onCancel={() => setShowCreate(false)}
            onSaved={() => setShowCreate(false)}
          />
        )}

        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Current Active Week
          </h3>
          {weeksQuery.isLoading ? (
            <div className="bg-white/[0.03] border border-white/10 rounded-xl p-8 flex items-center justify-center">
              <RefreshCw className="w-5 h-5 text-muted-foreground animate-spin" />
            </div>
          ) : currentWeek ? (
            <CurrentWeekCard key={currentWeek.id} week={currentWeek} />
          ) : (
            <div className="bg-white/[0.03] border border-amber-500/20 rounded-xl p-6 flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
              <div>
                <p className="text-sm text-white font-medium">No active draft week</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Create a new draft week to allow users to submit picks.
                </p>
              </div>
            </div>
          )}
        </section>

        <section>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              All Draft Weeks ({weeks.length})
            </h3>
            {weeksQuery.isFetching && (
              <RefreshCw className="w-3.5 h-3.5 text-muted-foreground animate-spin" />
            )}
          </div>

          {weeks.length === 0 && !weeksQuery.isLoading ? (
            <div className="text-center py-10 text-muted-foreground text-sm bg-white/[0.02] rounded-xl border border-white/10">
              No draft weeks found. Create one above to get started.
            </div>
          ) : (
            <div className="rounded-xl border border-white/10 overflow-hidden">
              <table className="w-full text-sm" data-testid="table-draft-weeks">
                <thead>
                  <tr className="border-b border-white/10 bg-white/[0.03]">
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Game / Region</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Start</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Lock</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">End</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Status</th>
                    <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedWeeks.map((week, idx) => (
                    editingId === week.id ? (
                      <tr key={week.id}>
                        <td colSpan={6} className="px-4 py-3">
                          <WeekForm
                            initial={week}
                            onCancel={() => setEditingId(null)}
                            onSaved={() => setEditingId(null)}
                          />
                        </td>
                      </tr>
                    ) : (
                      <tr
                        key={week.id}
                        data-testid={`row-week-${week.id}`}
                        className={`border-b border-white/5 transition-colors hover:bg-white/[0.02] ${idx % 2 === 0 ? "" : "bg-white/[0.01]"}`}
                      >
                        <td className="px-4 py-3">
                          <div className="text-white font-medium">{week.game}</div>
                          <div className="text-xs text-muted-foreground">{week.region}</div>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDate(week.startAt)}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDate(week.lockAt)}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDate(week.endAt)}</td>
                        <td className="px-4 py-3"><StatusBadge status={week.status} /></td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1.5 flex-wrap">
                            <Button
                              data-testid={`button-edit-${week.id}`}
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs text-muted-foreground hover:text-white"
                              onClick={() => { setEditingId(week.id); setShowCreate(false); }}
                            >
                              <Edit2 className="w-3 h-3 mr-1" /> Edit
                            </Button>
                            <TransitionButtons week={week} onDone={() => {}} />
                          </div>
                        </td>
                      </tr>
                    )
                  ))}
                </tbody>
              </table>

              {weeks.length > 10 && (
                <div className="border-t border-white/10 px-4 py-2 flex justify-center">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-xs text-muted-foreground hover:text-white"
                    onClick={() => setShowAllWeeks((v) => !v)}
                    data-testid="button-toggle-all-weeks"
                  >
                    {showAllWeeks ? (
                      <><ChevronUp className="w-3.5 h-3.5 mr-1" /> Show fewer</>
                    ) : (
                      <><ChevronDown className="w-3.5 h-3.5 mr-1" /> Show all {weeks.length} weeks</>
                    )}
                  </Button>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </AdminLayout>
  );
}

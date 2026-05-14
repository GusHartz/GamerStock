import { useState } from "react";
import { AdminLayout } from "./layout";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle, AlertTriangle, RefreshCw, Zap, Database, Code2,
  Calendar, Play, X, Trash2, Plus, Trophy, Clock,
} from "lucide-react";

interface VersionInfo {
  buildId: string;
  buildTime: string | null;
  environment: string;
}

interface DiagnosticsResult {
  env: string;
  healthy: boolean;
  tables: Record<string, boolean>;
  columns: Record<string, boolean>;
  seedStatus: { achievementsCatalogCount: number; badgesCount: number };
  suggestedFixes: string[];
}

interface Season {
  id: number;
  name: string;
  startsAt: string;
  endsAt: string;
  status: "upcoming" | "active" | "closed";
}

interface SeasonListResponse {
  activeSeasonId: number | null;
  seasons: Season[];
}

function fmt(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

const STATUS_COLORS: Record<string, string> = {
  active: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
  upcoming: "text-sky-400 bg-sky-400/10 border-sky-400/20",
  closed: "text-muted-foreground bg-white/5 border-white/10",
};

// ──────────────────────────────────────────────────────────
// Create Season Modal
// ──────────────────────────────────────────────────────────
function CreateSeasonModal({
  nextSeasonNumber,
  onClose,
  onCreated,
}: {
  nextSeasonNumber: number;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(`Season ${nextSeasonNumber}`);
  const [durationDays, setDurationDays] = useState(90);
  const [setActive, setSetActive] = useState(true);

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/arena/seasons", {
        name,
        durationDays,
        setActive,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to create season");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: `${name} created${setActive ? " and activated" : ""}` });
      onCreated();
      onClose();
    },
    onError: (e: Error) => {
      toast({ title: e.message, variant: "destructive" });
    },
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-[#0D1117] border border-white/10 rounded-xl shadow-2xl p-6 flex flex-col gap-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Trophy className="w-4 h-4 text-primary" />
            Create Season
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground font-medium">Season Name</label>
            <input
              data-testid="input-season-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-primary"
              placeholder="Season 1"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground font-medium">Duration (days)</label>
            <input
              data-testid="input-season-duration"
              type="number"
              min={1}
              value={durationDays}
              onChange={(e) => setDurationDays(parseInt(e.target.value) || 90)}
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-primary"
            />
            <span className="text-[10px] text-muted-foreground">
              Starts now — ends {new Date(Date.now() + durationDays * 86400000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </span>
          </div>

          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input
              data-testid="toggle-activate-immediately"
              type="checkbox"
              checked={setActive}
              onChange={(e) => setSetActive(e.target.checked)}
              className="w-4 h-4 accent-primary"
            />
            <span className="text-sm text-white">Activate immediately</span>
            <span className="text-[10px] text-muted-foreground">(closes current active season)</span>
          </label>
        </div>

        <div className="flex gap-2 pt-1">
          <Button
            variant="outline"
            className="flex-1"
            onClick={onClose}
            disabled={createMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            data-testid="button-create-season-confirm"
            className={`flex-1 ${setActive ? "bg-emerald-600 hover:bg-emerald-700" : "bg-violet-600 hover:bg-violet-700"} text-white`}
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending || !name.trim()}
          >
            {createMutation.isPending ? "Creating..." : setActive ? "Create & Activate" : "Create (upcoming)"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Season Console
// ──────────────────────────────────────────────────────────
function SeasonConsole() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  const { data, isLoading, refetch } = useQuery<SeasonListResponse>({
    queryKey: ["/api/admin/arena/seasons"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/arena/seasons");
      return res.json();
    },
    staleTime: 30_000,
  });

  const activateMutation = useMutation({
    mutationFn: async (seasonId: number) => {
      const res = await apiRequest("POST", `/api/admin/arena/seasons/${seasonId}/activate`, {});
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: (_, seasonId) => {
      toast({ title: `Season ${seasonId} activated` });
      refetch();
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const closeMutation = useMutation({
    mutationFn: async (seasonId: number) => {
      const res = await apiRequest("POST", `/api/admin/arena/seasons/${seasonId}/close`, {});
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: (_, seasonId) => {
      toast({ title: `Season ${seasonId} closed — badges distributed` });
      refetch();
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (seasonId: number) => {
      const res = await apiRequest("DELETE", `/api/admin/arena/seasons/${seasonId}`);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: (_, seasonId) => {
      toast({ title: `Season ${seasonId} deleted` });
      refetch();
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const activeSeason = data?.seasons.find((s) => s.id === data.activeSeasonId);
  const nextSeasonNumber = (data?.seasons.length ?? 0) + 1;
  const isPending = activateMutation.isPending || closeMutation.isPending || deleteMutation.isPending;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Trophy className="w-4 h-4 text-amber-400" />
            Season Console
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">Create, activate, and close seasons</p>
        </div>
        <Button
          data-testid="button-create-season"
          size="sm"
          className="gap-1.5 bg-violet-600 hover:bg-violet-700 text-white text-xs"
          onClick={() => setShowCreate(true)}
        >
          <Plus className="w-3.5 h-3.5" />
          New Season
        </Button>
      </div>

      {/* Active Season Card */}
      {activeSeason && (
        <div className="flex items-start justify-between gap-3 p-4 rounded-xl bg-emerald-400/5 border border-emerald-400/20">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-400/10 flex items-center justify-center shrink-0">
              <Play className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <p className="text-xs text-emerald-400 font-medium uppercase tracking-wider">Active Season</p>
              <p className="text-sm font-semibold text-white" data-testid="active-season-name">{activeSeason.name}</p>
              <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {fmt(activeSeason.startsAt)} — {fmt(activeSeason.endsAt)}
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="text-xs border-red-400/30 text-red-400 hover:bg-red-400/10 hover:border-red-400/50 shrink-0"
            data-testid={`button-close-season-${activeSeason.id}`}
            disabled={isPending}
            onClick={() => {
              if (window.confirm(`Close "${activeSeason.name}"? This will distribute badges and snapshot leaderboards. This cannot be undone.`)) {
                closeMutation.mutate(activeSeason.id);
              }
            }}
          >
            Close Season
          </Button>
        </div>
      )}

      {!activeSeason && !isLoading && (
        <div className="p-4 rounded-xl bg-white/5 border border-white/10 text-sm text-muted-foreground text-center">
          No active season — create one below
        </div>
      )}

      {/* Season Table */}
      {isLoading ? (
        <div className="text-xs text-muted-foreground">Loading seasons...</div>
      ) : data && data.seasons.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Name</th>
                <th className="text-left px-4 py-2.5 text-muted-foreground font-medium hidden sm:table-cell">Start</th>
                <th className="text-left px-4 py-2.5 text-muted-foreground font-medium hidden sm:table-cell">End</th>
                <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Status</th>
                <th className="text-right px-4 py-2.5 text-muted-foreground font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.seasons.map((season) => (
                <tr
                  key={season.id}
                  data-testid={`row-season-${season.id}`}
                  className="border-b border-white/5 last:border-0 hover:bg-white/5 transition-colors"
                >
                  <td className="px-4 py-3 text-white font-medium">{season.name}</td>
                  <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{fmt(season.startsAt)}</td>
                  <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{fmt(season.endsAt)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${STATUS_COLORS[season.status] ?? ""}`}>
                      {season.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      {season.status === "upcoming" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2.5 text-[11px] gap-1 text-sky-400 border-sky-400/30 hover:bg-sky-400/10"
                          data-testid={`button-activate-season-${season.id}`}
                          disabled={isPending}
                          onClick={() => activateMutation.mutate(season.id)}
                        >
                          <Play className="w-3 h-3" />
                          Activate
                        </Button>
                      )}
                      {season.status === "active" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2.5 text-[11px] gap-1 text-red-400 border-red-400/30 hover:bg-red-400/10"
                          data-testid={`button-close-season-row-${season.id}`}
                          disabled={isPending}
                          onClick={() => {
                            if (window.confirm(`Close "${season.name}"? This distributes badges and cannot be undone.`)) {
                              closeMutation.mutate(season.id);
                            }
                          }}
                        >
                          Close
                        </Button>
                      )}
                      {season.status === "closed" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-red-400 hover:bg-red-400/10"
                          data-testid={`button-delete-season-${season.id}`}
                          disabled={isPending}
                          title="Delete season"
                          onClick={() => {
                            if (window.confirm(`Delete "${season.name}"? This is permanent.`)) {
                              deleteMutation.mutate(season.id);
                            }
                          }}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-xs text-muted-foreground text-center py-4">No seasons found</div>
      )}

      {showCreate && (
        <CreateSeasonModal
          nextSeasonNumber={nextSeasonNumber}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            refetch();
            queryClient.invalidateQueries({ queryKey: ["/api/arena/seasons"] });
          }}
        />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Main Page
// ──────────────────────────────────────────────────────────
export default function AdminArenaPage() {
  const { toast } = useToast();
  const [diagResult, setDiagResult] = useState<DiagnosticsResult | null>(null);
  const [bootstrapResult, setBootstrapResult] = useState<any | null>(null);

  const { data: version } = useQuery<VersionInfo>({
    queryKey: ["/api/version"],
    staleTime: Infinity,
  });

  const diagMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("GET", "/api/admin/arena/diagnostics");
      return res.json();
    },
    onSuccess: (data) => {
      setDiagResult(data);
      toast({ title: data.healthy ? "Arena is healthy" : "Issues found — see results below" });
    },
    onError: () => toast({ title: "Diagnostics failed", variant: "destructive" }),
  });

  const bootstrapMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/arena/bootstrap", {
        seed: true,
        createSeason1: false,
        activateSeason1: false,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setBootstrapResult(data);
      toast({ title: "Bootstrap complete — run diagnostics to verify" });
    },
    onError: () => toast({ title: "Bootstrap failed", variant: "destructive" }),
  });

  const tableEntries = diagResult ? Object.entries(diagResult.tables) : [];
  const presentTables = tableEntries.filter(([, ok]) => ok).map(([k]) => k);

  return (
    <AdminLayout>
      <div className="flex flex-col gap-8 max-w-3xl">
        <div>
          <h2 className="text-lg font-semibold text-white">Arena Management</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Diagnostics, bootstrap, and season lifecycle controls.
          </p>
        </div>

        {/* Season Console */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-5">
          <SeasonConsole />
        </div>

        {/* Diagnostics & Bootstrap */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-5 flex flex-col gap-5">
          <div>
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Database className="w-4 h-4 text-violet-400" />
              Diagnostics & Bootstrap
            </h3>
            <p className="text-xs text-muted-foreground mt-1">Verify DB schema and seed data. Safe to run in production.</p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              className="gap-2"
              data-testid="button-run-diagnostics"
              onClick={() => diagMutation.mutate()}
              disabled={diagMutation.isPending}
            >
              <Database className="w-4 h-4" />
              {diagMutation.isPending ? "Running..." : "Run Diagnostics"}
            </Button>
            <Button
              className="gap-2 bg-violet-600 hover:bg-violet-700 text-white"
              data-testid="button-bootstrap-arena"
              onClick={() => {
                if (window.confirm("Run Arena bootstrap? Creates missing tables, seeds achievements & badges. Safe to run multiple times.")) {
                  bootstrapMutation.mutate();
                }
              }}
              disabled={bootstrapMutation.isPending}
            >
              <Zap className="w-4 h-4" />
              {bootstrapMutation.isPending ? "Running..." : "Bootstrap Arena"}
            </Button>
          </div>

          {diagResult && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2">
                {diagResult.healthy
                  ? <CheckCircle className="w-5 h-5 text-emerald-400" />
                  : <AlertTriangle className="w-5 h-5 text-amber-400" />}
                <span className="text-sm font-semibold text-white">
                  {diagResult.healthy ? "Arena is healthy" : "Issues detected"}
                </span>
                <span className="ml-auto text-xs text-muted-foreground font-mono">{diagResult.env}</span>
              </div>

              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
                  Tables ({presentTables.length}/{tableEntries.length})
                </p>
                <div className="grid grid-cols-2 gap-1">
                  {tableEntries.map(([table, ok]) => (
                    <div key={table} className="flex items-center gap-2 text-xs">
                      <span className={ok ? "text-emerald-400" : "text-red-400"}>{ok ? "✓" : "✗"}</span>
                      <span className={ok ? "text-white/80" : "text-red-300"}>{table}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Seed Status</p>
                <div className="grid grid-cols-2 gap-1 text-xs">
                  <span className="text-muted-foreground">Achievements Catalog</span>
                  <span className={diagResult.seedStatus.achievementsCatalogCount > 0 ? "text-emerald-400" : "text-red-400"}>
                    {diagResult.seedStatus.achievementsCatalogCount} entries
                  </span>
                  <span className="text-muted-foreground">Arena Badges</span>
                  <span className={diagResult.seedStatus.badgesCount > 0 ? "text-emerald-400" : "text-red-400"}>
                    {diagResult.seedStatus.badgesCount} entries
                  </span>
                </div>
              </div>

              {diagResult.suggestedFixes.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Suggested Actions</p>
                  <ul className="flex flex-col gap-1">
                    {diagResult.suggestedFixes.map((fix, i) => (
                      <li key={i} className="text-xs text-amber-300 flex items-start gap-2">
                        <RefreshCw className="w-3 h-3 mt-0.5 shrink-0" />
                        {fix}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <details>
                <summary className="text-xs text-muted-foreground cursor-pointer hover:text-white">View raw JSON</summary>
                <pre className="mt-2 text-[10px] font-mono text-muted-foreground bg-black/30 rounded-lg p-3 overflow-auto max-h-48 whitespace-pre-wrap break-all">
                  {JSON.stringify(diagResult, null, 2)}
                </pre>
              </details>
            </div>
          )}

          {bootstrapResult && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Zap className="w-4 h-4 text-violet-400" />
                <span className="text-sm font-semibold text-white">Bootstrap Result</span>
              </div>
              <pre className="text-[10px] font-mono text-muted-foreground bg-black/30 rounded-lg p-3 overflow-auto max-h-48 whitespace-pre-wrap break-all">
                {JSON.stringify(bootstrapResult, null, 2)}
              </pre>
            </div>
          )}
        </div>

        {/* Build Info */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Code2 className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold text-white">Build Info</h3>
          </div>
          {version ? (
            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              <span className="text-muted-foreground">Build ID</span>
              <span className="text-white" data-testid="version-build-id">{version.buildId}</span>
              <span className="text-muted-foreground">Build Time</span>
              <span className="text-white">{version.buildTime ?? "—"}</span>
              <span className="text-muted-foreground">Environment</span>
              <span className="text-white">{version.environment}</span>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Loading...</p>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}

// ─── Moments Engine Block ─────────────────────────────────────────────────────
// Lists all moments for the asset and provides create / edit / relaunch flows.
// Exported with forwardRef so the TopBar can scroll here via a button.
// ─────────────────────────────────────────────────────────────────────────────
import { forwardRef, useState } from "react";
import { Loader2, Zap, Plus, Pencil, RefreshCcw, ChevronDown, ChevronUp, Gem } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  useMoments,
  useCreateMoment,
  useUpdateMoment,
  useRelaunchMoment,
} from "../hooks/use-operator";
import type { OperatorMomentView } from "../hooks/use-operator";

// ── Types ─────────────────────────────────────────────────────────────────────

interface MomentsEngineProps {
  assetId: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const RARITIES = ["common", "rare", "epic", "legendary"] as const;
const STATUSES = ["draft", "active", "sold_out"] as const;

const RARITY_COLORS: Record<string, string> = {
  common:    "bg-slate-500/20 text-slate-300 border-slate-500/30",
  rare:      "bg-blue-500/20 text-blue-300 border-blue-500/30",
  epic:      "bg-purple-500/20 text-purple-300 border-purple-500/30",
  legendary: "bg-amber-500/20 text-amber-300 border-amber-500/30",
};

const STATUS_COLORS: Record<string, string> = {
  draft:    "bg-slate-500/20 text-slate-400 border-slate-500/30",
  active:   "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  sold_out: "bg-red-500/20 text-red-400 border-red-500/30",
};

// ── Blank form state ──────────────────────────────────────────────────────────

const BLANK_FORM = {
  title: "",
  rarity: "common" as string,
  price: "",
  supplyTotal: "",
  status: "draft" as string,
};

// ── Subcomponent: Create Form ─────────────────────────────────────────────────

function CreateMomentForm({
  assetId,
  onCancel,
}: {
  assetId: number;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const createMoment = useCreateMoment(assetId);
  const [form, setForm] = useState(BLANK_FORM);

  function set(key: keyof typeof BLANK_FORM, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || !form.price || !form.supplyTotal) {
      toast({ title: "Fill in all required fields", variant: "destructive" });
      return;
    }
    try {
      await createMoment.mutateAsync({
        title: form.title.trim(),
        rarity: form.rarity,
        price: Number(form.price),
        supplyTotal: Number(form.supplyTotal),
        status: form.status,
      });
      toast({ title: "Moment created" });
      onCancel();
    } catch (err: any) {
      toast({ title: err.message ?? "Failed to create moment", variant: "destructive" });
    }
  }

  return (
    <form onSubmit={handleSubmit} className="border border-white/10 rounded-lg p-4 space-y-4 bg-white/5">
      <p className="text-sm font-semibold text-white">New Moment</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <Label className="text-xs text-white/60 mb-1 block">Title *</Label>
          <Input
            data-testid="input-moment-title"
            placeholder="e.g. Clutch Final Round"
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
          />
        </div>

        <div>
          <Label className="text-xs text-white/60 mb-1 block">Rarity *</Label>
          <Select value={form.rarity} onValueChange={(v) => set("rarity", v)}>
            <SelectTrigger data-testid="select-moment-rarity" className="bg-white/5 border-white/10 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RARITIES.map((r) => (
                <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs text-white/60 mb-1 block">Status</Label>
          <Select value={form.status} onValueChange={(v) => set("status", v)}>
            <SelectTrigger data-testid="select-moment-status" className="bg-white/5 border-white/10 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="active">Active</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs text-white/60 mb-1 block">Price (GS) *</Label>
          <Input
            data-testid="input-moment-price"
            type="number"
            min={0}
            step={0.01}
            placeholder="49.90"
            value={form.price}
            onChange={(e) => set("price", e.target.value)}
            className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
          />
        </div>

        <div>
          <Label className="text-xs text-white/60 mb-1 block">Supply *</Label>
          <Input
            data-testid="input-moment-supply"
            type="number"
            min={1}
            step={1}
            placeholder="100"
            value={form.supplyTotal}
            onChange={(e) => set("supplyTotal", e.target.value)}
            className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
          />
        </div>
      </div>

      <div className="flex gap-2 justify-end">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} data-testid="btn-moment-create-cancel">
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={createMoment.isPending}
          data-testid="btn-moment-create-submit"
        >
          {createMoment.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
          Create Moment
        </Button>
      </div>
    </form>
  );
}

// ── Subcomponent: Relaunch Form ───────────────────────────────────────────────

function RelaunchForm({
  moment,
  assetId,
  onCancel,
}: {
  moment: OperatorMomentView;
  assetId: number;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const relaunch = useRelaunchMoment(assetId);
  const [price, setPrice] = useState(String(moment.price));
  const [supply, setSupply] = useState("50");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!price || !supply) {
      toast({ title: "Fill in price and supply", variant: "destructive" });
      return;
    }
    try {
      await relaunch.mutateAsync({
        momentId: moment.momentId,
        price: Number(price),
        supplyTotal: Number(supply),
      });
      toast({ title: `"${moment.title}" relaunched` });
      onCancel();
    } catch (err: any) {
      toast({ title: err.message ?? "Relaunch failed", variant: "destructive" });
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 border-t border-white/10 pt-3 space-y-3">
      <p className="text-xs font-semibold text-amber-400">Relaunch — set new price and supply</p>
      <div className="flex gap-2">
        <div className="flex-1">
          <Label className="text-xs text-white/50 mb-1 block">Price (GS)</Label>
          <Input
            data-testid={`input-relaunch-price-${moment.momentId}`}
            type="number"
            min={0}
            step={0.01}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="bg-white/5 border-white/10 text-white h-8 text-sm"
          />
        </div>
        <div className="flex-1">
          <Label className="text-xs text-white/50 mb-1 block">New Supply</Label>
          <Input
            data-testid={`input-relaunch-supply-${moment.momentId}`}
            type="number"
            min={1}
            step={1}
            value={supply}
            onChange={(e) => setSupply(e.target.value)}
            className="bg-white/5 border-white/10 text-white h-8 text-sm"
          />
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          className="h-7 text-xs"
          disabled={relaunch.isPending}
          data-testid={`btn-relaunch-submit-${moment.momentId}`}
        >
          {relaunch.isPending && <Loader2 className="w-3 h-3 animate-spin mr-1" />}
          Relaunch
        </Button>
      </div>
    </form>
  );
}

// ── Subcomponent: Edit Form ───────────────────────────────────────────────────

function EditMomentForm({
  moment,
  assetId,
  onCancel,
}: {
  moment: OperatorMomentView;
  assetId: number;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const updateMoment = useUpdateMoment(assetId);
  const [form, setForm] = useState({
    title: moment.title,
    rarity: moment.rarity as string,
    price: String(moment.price),
    supplyTotal: String(moment.supplyTotal),
    status: moment.status as string,
  });

  function set(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await updateMoment.mutateAsync({
        momentId: moment.momentId,
        title: form.title,
        rarity: form.rarity,
        price: Number(form.price),
        supplyTotal: Number(form.supplyTotal),
        status: form.status,
      });
      toast({ title: "Moment updated" });
      onCancel();
    } catch (err: any) {
      toast({ title: err.message ?? "Update failed", variant: "destructive" });
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 border-t border-white/10 pt-3 space-y-3">
      <p className="text-xs font-semibold text-white/70">Edit Moment</p>
      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2">
          <Label className="text-xs text-white/50 mb-1 block">Title</Label>
          <Input
            data-testid={`input-edit-moment-title-${moment.momentId}`}
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            className="bg-white/5 border-white/10 text-white h-8 text-sm"
          />
        </div>
        <div>
          <Label className="text-xs text-white/50 mb-1 block">Rarity</Label>
          <Select value={form.rarity} onValueChange={(v) => set("rarity", v)}>
            <SelectTrigger className="bg-white/5 border-white/10 text-white h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RARITIES.map((r) => (
                <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-white/50 mb-1 block">Status</Label>
          <Select value={form.status} onValueChange={(v) => set("status", v)}>
            <SelectTrigger className="bg-white/5 border-white/10 text-white h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-white/50 mb-1 block">Price (GS)</Label>
          <Input
            data-testid={`input-edit-price-${moment.momentId}`}
            type="number"
            min={0}
            step={0.01}
            value={form.price}
            onChange={(e) => set("price", e.target.value)}
            className="bg-white/5 border-white/10 text-white h-8 text-sm"
          />
        </div>
        <div>
          <Label className="text-xs text-white/50 mb-1 block">Supply</Label>
          <Input
            data-testid={`input-edit-supply-${moment.momentId}`}
            type="number"
            min={1}
            step={1}
            value={form.supplyTotal}
            onChange={(e) => set("supplyTotal", e.target.value)}
            className="bg-white/5 border-white/10 text-white h-8 text-sm"
          />
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          className="h-7 text-xs"
          disabled={updateMoment.isPending}
          data-testid={`btn-edit-moment-submit-${moment.momentId}`}
        >
          {updateMoment.isPending && <Loader2 className="w-3 h-3 animate-spin mr-1" />}
          Save
        </Button>
      </div>
    </form>
  );
}

// ── Subcomponent: Moment Card ─────────────────────────────────────────────────

function MomentCard({
  moment,
  assetId,
}: {
  moment: OperatorMomentView;
  assetId: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<"view" | "edit" | "relaunch">("view");

  const soldPct = moment.soldPercentage;
  const soldBar = Math.min(100, Math.max(0, soldPct));

  return (
    <div
      className="border border-white/10 rounded-lg p-4 bg-white/5 space-y-3"
      data-testid={`card-moment-${moment.momentId}`}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Gem className="w-3.5 h-3.5 text-white/40 flex-shrink-0" />
            <span className="font-medium text-sm text-white truncate" data-testid={`text-moment-title-${moment.momentId}`}>
              {moment.title}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <Badge className={`text-xs border capitalize ${RARITY_COLORS[moment.rarity] ?? ""}`} data-testid={`text-moment-rarity-${moment.momentId}`}>
              {moment.rarity}
            </Badge>
            <Badge className={`text-xs border ${STATUS_COLORS[moment.status] ?? ""}`} data-testid={`text-moment-status-${moment.momentId}`}>
              {moment.status.replace("_", " ")}
            </Badge>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="w-7 h-7 flex-shrink-0"
          onClick={() => { setExpanded(!expanded); if (mode !== "view") setMode("view"); }}
          data-testid={`btn-moment-expand-${moment.momentId}`}
        >
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </Button>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <p className="text-xs text-white/40">Price</p>
          <p className="text-sm font-semibold text-white" data-testid={`text-moment-price-${moment.momentId}`}>
            {moment.price.toFixed(2)} GS
          </p>
        </div>
        <div>
          <p className="text-xs text-white/40">Supply</p>
          <p className="text-sm font-semibold text-white" data-testid={`text-moment-supply-${moment.momentId}`}>
            {moment.supplySold}/{moment.supplyTotal}
          </p>
        </div>
        <div>
          <p className="text-xs text-white/40">Revenue</p>
          <p className="text-sm font-semibold text-white" data-testid={`text-moment-revenue-${moment.momentId}`}>
            {moment.revenueGenerated > 0 ? `${moment.revenueGenerated.toFixed(0)} GS` : "—"}
          </p>
        </div>
      </div>

      {/* Progress bar */}
      <div>
        <div className="flex justify-between items-center mb-1">
          <span className="text-xs text-white/40">Sold</span>
          <span className="text-xs text-white/60" data-testid={`text-moment-sold-pct-${moment.momentId}`}>
            {soldPct.toFixed(1)}%
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all"
            style={{ width: `${soldBar}%` }}
          />
        </div>
      </div>

      {/* Velocity */}
      {moment.salesVelocity > 0 && (
        <p className="text-xs text-white/40">
          Velocity: {moment.salesVelocity.toFixed(1)} sales/day
        </p>
      )}

      {/* Expanded actions */}
      {expanded && mode === "view" && (
        <div className="flex gap-2 pt-1 border-t border-white/10">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 h-7 text-xs border-white/10 hover:bg-white/10"
            onClick={() => setMode("edit")}
            data-testid={`btn-moment-edit-${moment.momentId}`}
          >
            <Pencil className="w-3 h-3 mr-1" /> Edit
          </Button>
          {(moment.status === "sold_out" || moment.status === "active") && (
            <Button
              variant="outline"
              size="sm"
              className="flex-1 h-7 text-xs border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
              onClick={() => setMode("relaunch")}
              data-testid={`btn-moment-relaunch-${moment.momentId}`}
            >
              <RefreshCcw className="w-3 h-3 mr-1" /> Relaunch
            </Button>
          )}
        </div>
      )}

      {expanded && mode === "edit" && (
        <EditMomentForm
          moment={moment}
          assetId={assetId}
          onCancel={() => setMode("view")}
        />
      )}

      {expanded && mode === "relaunch" && (
        <RelaunchForm
          moment={moment}
          assetId={assetId}
          onCancel={() => setMode("view")}
        />
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export const MomentsEngine = forwardRef<HTMLElement, MomentsEngineProps>(
  function MomentsEngine({ assetId }, ref) {
    const { data: moments, isLoading, isError } = useMoments(assetId);
    const [showCreate, setShowCreate] = useState(false);

    return (
      <section ref={ref} className="space-y-4" data-testid="section-moments-engine">
        {/* Block header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-400" />
            <h2 className="text-sm font-semibold text-white">Moments Engine</h2>
            {moments && moments.length > 0 && (
              <Badge className="text-xs border border-white/10 bg-white/5 text-white/50">
                {moments.length}
              </Badge>
            )}
          </div>
          {!showCreate && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs border-white/10 hover:bg-white/10"
              onClick={() => setShowCreate(true)}
              data-testid="btn-create-moment"
            >
              <Plus className="w-3 h-3 mr-1" /> New Moment
            </Button>
          )}
        </div>

        {/* Create form */}
        {showCreate && (
          <CreateMomentForm
            assetId={assetId}
            onCancel={() => setShowCreate(false)}
          />
        )}

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center gap-2 text-white/40 text-sm py-4" data-testid="moments-loading">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Loading moments…</span>
          </div>
        )}

        {/* Error */}
        {isError && (
          <p className="text-sm text-red-400 py-2" data-testid="moments-error">
            Could not load moments.
          </p>
        )}

        {/* Empty state */}
        {!isLoading && !isError && moments && moments.length === 0 && (
          <div
            className="border border-dashed border-white/10 rounded-lg py-8 text-center space-y-2"
            data-testid="moments-empty"
          >
            <Gem className="w-8 h-8 text-white/20 mx-auto" />
            <p className="text-sm text-white/40">No moments yet</p>
            <p className="text-xs text-white/25">Create your first moment to start generating direct revenue from fans.</p>
            <Button
              size="sm"
              variant="outline"
              className="mt-2 border-white/10 hover:bg-white/10 text-xs"
              onClick={() => setShowCreate(true)}
              data-testid="btn-create-first-moment"
            >
              <Plus className="w-3 h-3 mr-1" /> Create First Moment
            </Button>
          </div>
        )}

        {/* Moments list */}
        {!isLoading && !isError && moments && moments.length > 0 && (
          <div className="space-y-3">
            {moments.map((m) => (
              <MomentCard key={m.momentId} moment={m} assetId={assetId} />
            ))}
          </div>
        )}
      </section>
    );
  },
);

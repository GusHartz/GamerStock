import { useState, forwardRef } from "react";
import {
  Target, Loader2, CheckCircle2, AlertCircle, Edit3,
  PlusCircle, Clock, Calendar, XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useMission, useCreateMission, useUpdateMission } from "../hooks/use-operator";
import type { OperatorMissionView } from "../hooks/use-operator";

const MISSION_TYPES = [
  { value: "growth_holders", label: "Grow Holders" },
  { value: "buy_volume",     label: "Buy Volume"   },
  { value: "activity",       label: "Activity"     },
  { value: "unlock_moment",  label: "Unlock Moment"},
] as const;

// ── Progress bar ──────────────────────────────────────────────────────────────

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="h-2 bg-white/10 rounded-full overflow-hidden">
      <div
        className="h-full bg-emerald-500 rounded-full transition-all"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// ── Mission status badge ──────────────────────────────────────────────────────

function MissionStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active:    "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
    completed: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    expired:   "bg-white/10 text-white/40 border-white/20",
    draft:     "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  };
  return (
    <Badge className={cn("border text-xs capitalize", map[status] ?? map.draft)}>
      {status}
    </Badge>
  );
}

// ── Mission create/edit form ──────────────────────────────────────────────────

interface FormProps {
  assetId: number;
  existing?: OperatorMissionView;
  onCancel: () => void;
}

function MissionForm({ assetId, existing, onCancel }: FormProps) {
  const { toast } = useToast();
  const createMission = useCreateMission(assetId);
  const updateMission = useUpdateMission(assetId);

  const [type, setType] = useState<string>(existing?.type ?? "growth_holders");
  const [title, setTitle] = useState(existing?.title ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [goalValue, setGoalValue] = useState(String(existing?.goalValue ?? ""));
  const [endDate, setEndDate] = useState(
    existing?.endDate ? existing.endDate.slice(0, 10) : "",
  );

  const isPending = createMission.isPending || updateMission.isPending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const goal = Number(goalValue);
    if (!title.trim()) {
      toast({ title: "Title required", variant: "destructive" });
      return;
    }
    if (isNaN(goal) || goal <= 0) {
      toast({ title: "Goal must be a positive number", variant: "destructive" });
      return;
    }

    if (existing) {
      updateMission.mutate(
        { missionId: existing.id, title, description: description || undefined, goalValue: goal, endDate: endDate || undefined },
        {
          onSuccess: () => {
            toast({ title: "Mission updated" });
            onCancel();
          },
          onError: (err: any) => {
            toast({ title: "Update failed", description: err.message, variant: "destructive" });
          },
        },
      );
    } else {
      createMission.mutate(
        { type, title, description: description || undefined, goalValue: goal, endDate: endDate || undefined },
        {
          onSuccess: () => {
            toast({ title: "Mission created" });
            onCancel();
          },
          onError: (err: any) => {
            toast({ title: "Creation failed", description: err.message, variant: "destructive" });
          },
        },
      );
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" data-testid="mission-form">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {!existing && (
          <div className="space-y-1.5">
            <Label className="text-xs text-white/60">Mission Type *</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="bg-white/5 border-white/20 text-white" data-testid="select-mission-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MISSION_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className={cn("space-y-1.5", !existing && "sm:col-span-1")}>
          <Label className="text-xs text-white/60">Goal *</Label>
          <Input
            type="number"
            min="1"
            value={goalValue}
            onChange={(e) => setGoalValue(e.target.value)}
            placeholder="e.g. 500"
            className="bg-white/5 border-white/20 text-white placeholder:text-white/30"
            data-testid="input-mission-goal"
          />
        </div>

        <div className={cn("space-y-1.5", "sm:col-span-2")}>
          <Label className="text-xs text-white/60">Title *</Label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Road to 500 holders"
            className="bg-white/5 border-white/20 text-white placeholder:text-white/30"
            data-testid="input-mission-title"
          />
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-xs text-white/60">Description</Label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the mission for your community…"
            className="bg-white/5 border-white/20 text-white placeholder:text-white/30 resize-none"
            rows={2}
            data-testid="textarea-mission-description"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-white/60 flex items-center gap-1"><Calendar className="w-3 h-3" />End Date</Label>
          <Input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="bg-white/5 border-white/20 text-white"
            data-testid="input-mission-end-date"
          />
        </div>
      </div>

      <div className="flex gap-3">
        <Button
          type="submit"
          disabled={isPending}
          className="bg-white text-black hover:bg-white/90 gap-2"
          data-testid="btn-save-mission"
        >
          {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
          {existing ? "Save Changes" : "Create Mission"}
        </Button>
        <Button type="button" variant="ghost" className="text-white/50" onClick={onCancel} data-testid="btn-cancel-mission">
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ── Active mission view ───────────────────────────────────────────────────────

function ActiveMissionView({
  mission,
  assetId,
}: {
  mission: OperatorMissionView;
  assetId: number;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const updateMission = useUpdateMission(assetId);

  function handleClose() {
    updateMission.mutate(
      { missionId: mission.id, status: "completed" },
      {
        onSuccess: () => toast({ title: "Mission completed" }),
        onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
      },
    );
  }

  if (editing) {
    return (
      <div className="bg-white/5 border border-white/10 rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Edit3 className="w-4 h-4 text-white/60" />
          <h3 className="text-sm font-semibold text-white">Edit Mission</h3>
        </div>
        <MissionForm assetId={assetId} existing={mission} onCancel={() => setEditing(false)} />
      </div>
    );
  }

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-5 space-y-4" data-testid="active-mission-view">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-bold text-white" data-testid="mission-title">{mission.title}</p>
            <MissionStatusBadge status={mission.status} />
          </div>
          {mission.description && (
            <p className="text-xs text-white/50 mt-1">{mission.description}</p>
          )}
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <Button
            size="sm"
            variant="ghost"
            className="text-white/50 hover:text-white gap-1 h-7 text-xs"
            onClick={() => setEditing(true)}
            data-testid="btn-edit-mission"
          >
            <Edit3 className="w-3 h-3" />
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-red-400/60 hover:text-red-400 gap-1 h-7 text-xs"
            onClick={handleClose}
            disabled={updateMission.isPending}
            data-testid="btn-close-mission"
          >
            <XCircle className="w-3 h-3" />
            Close
          </Button>
        </div>
      </div>

      {/* Progress */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-white/50">
          <span>{mission.currentValue.toLocaleString()} / {mission.goalValue.toLocaleString()}</span>
          <span>{mission.progressPercentage.toFixed(0)}%</span>
        </div>
        <ProgressBar value={mission.currentValue} max={mission.goalValue} />
      </div>

      {/* Meta */}
      <div className="flex items-center gap-4 text-xs text-white/30">
        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {mission.participantsCount} participants
        </span>
        {mission.endDate && (
          <span className="flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            Ends {new Date(mission.endDate).toLocaleDateString()}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  assetId: number;
}

export const MissionControl = forwardRef<HTMLElement, Props>(function MissionControl({ assetId }, ref) {
  const { data: mission, isLoading, isError } = useMission(assetId);
  const [creating, setCreating] = useState(false);

  return (
    <section id="mission-control" ref={ref} className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white/70 uppercase tracking-wider">Mission Control</h2>
        {!mission && !creating && !isLoading && (
          <Button
            size="sm"
            variant="outline"
            className="border-white/20 text-white/70 hover:bg-white/5 gap-1.5 h-7 text-xs"
            onClick={() => setCreating(true)}
            data-testid="btn-new-mission"
          >
            <PlusCircle className="w-3 h-3" />
            New Mission
          </Button>
        )}
      </div>

      {isLoading && <div className="h-32 bg-white/5 rounded-xl animate-pulse" />}

      {isError && (
        <div className="flex items-center gap-2 text-sm text-red-400 p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
          <AlertCircle className="w-4 h-4" />
          Failed to load mission data.
        </div>
      )}

      {!isLoading && !isError && !mission && !creating && (
        <div className="flex flex-col items-center justify-center py-10 gap-3 bg-white/3 border border-white/10 rounded-xl">
          <Target className="w-10 h-10 text-white/20" />
          <p className="text-sm text-white/40">No active mission</p>
          <p className="text-xs text-white/25 max-w-xs text-center">
            Create a mission to rally your community around a goal — holders, volume, or activity milestones.
          </p>
          <Button
            size="sm"
            className="bg-white text-black hover:bg-white/90 mt-1"
            onClick={() => setCreating(true)}
            data-testid="btn-create-first-mission"
          >
            Create Mission
          </Button>
        </div>
      )}

      {creating && !mission && (
        <div className="bg-white/5 border border-white/10 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <PlusCircle className="w-4 h-4 text-white/60" />
            <h3 className="text-sm font-semibold text-white">New Mission</h3>
          </div>
          <MissionForm assetId={assetId} onCancel={() => setCreating(false)} />
        </div>
      )}

      {mission && <ActiveMissionView mission={mission} assetId={assetId} />}
    </section>
  );
});

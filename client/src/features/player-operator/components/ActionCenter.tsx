import { useState } from "react";
import {
  Zap, AlertCircle, CheckCircle2, Loader2,
  ChevronRight, TrendingUp, MessageCircle, Target,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useActionCenter, useTriggerAction } from "../hooks/use-operator";
import type { OperatorAction } from "../hooks/use-operator";

// ── Priority badge ────────────────────────────────────────────────────────────

function PriorityBadge({ priority }: { priority: string }) {
  const map: Record<string, string> = {
    high:   "bg-red-500/20 text-red-300 border-red-500/30",
    medium: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
    low:    "bg-white/10 text-white/50 border-white/20",
  };
  return (
    <Badge className={cn("border text-xs capitalize", map[priority] ?? map.medium)}>
      {priority}
    </Badge>
  );
}

// ── Action type icon ──────────────────────────────────────────────────────────

function ActionIcon({ type }: { type: string }) {
  const icons: Record<string, React.ElementType> = {
    message: MessageCircle,
    mission: Target,
    moment:  Zap,
  };
  const Icon = icons[type] ?? ChevronRight;
  return <Icon className="w-4 h-4 text-white/60" />;
}

// ── Individual action card ────────────────────────────────────────────────────

function ActionCard({
  action,
  assetId,
}: {
  action: OperatorAction;
  assetId: number;
}) {
  const { toast } = useToast();
  const triggerMutation = useTriggerAction(assetId);
  const [triggered, setTriggered] = useState(false);

  function handleTrigger() {
    triggerMutation.mutate(action.actionId, {
      onSuccess: () => {
        setTriggered(true);
        toast({ title: "Action triggered", description: action.title });
      },
      onError: (err: any) => {
        toast({ title: "Failed to trigger", description: err.message, variant: "destructive" });
      },
    });
  }

  return (
    <div
      className={cn(
        "bg-white/5 border border-white/10 rounded-xl p-4 space-y-3 transition-opacity",
        triggered && "opacity-50",
      )}
      data-testid={`action-card-${action.actionId}`}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
          <ActionIcon type={action.type} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-white">{action.title}</p>
            <PriorityBadge priority={action.priority} />
          </div>
          <p className="text-xs text-white/50 mt-1">{action.reason}</p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1 text-xs text-emerald-400/80">
          <TrendingUp className="w-3 h-3" />
          <span>{action.expectedImpact}</span>
        </div>

        {triggered ? (
          <div className="flex items-center gap-1 text-xs text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Done
          </div>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="border-white/20 text-white/70 hover:bg-white/5 gap-1 text-xs h-7"
            onClick={handleTrigger}
            disabled={triggerMutation.isPending}
            data-testid={`btn-trigger-action-${action.actionId}`}
          >
            {triggerMutation.isPending ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
            Apply
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  assetId: number;
}

export function ActionCenter({ assetId }: Props) {
  const { data: actions, isLoading, isError } = useActionCenter(assetId);

  return (
    <section id="action-center" className="space-y-3">
      <h2 className="text-sm font-semibold text-white/70 uppercase tracking-wider">Action Center</h2>

      {isLoading && (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-28 bg-white/5 rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {isError && (
        <div className="flex items-center gap-2 text-sm text-red-400 p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
          <AlertCircle className="w-4 h-4" />
          Failed to load recommendations.
        </div>
      )}

      {actions && actions.length === 0 && (
        <div className="flex flex-col items-center justify-center py-8 text-center gap-2 bg-white/3 border border-white/10 rounded-xl">
          <CheckCircle2 className="w-8 h-8 text-white/20" />
          <p className="text-sm text-white/40">No recommended actions right now.</p>
          <p className="text-xs text-white/25">Keep growing — recommendations appear as activity accumulates.</p>
        </div>
      )}

      {actions && actions.length > 0 && (
        <div className="space-y-3" data-testid="action-center-list">
          {actions.slice(0, 5).map((action) => (
            <ActionCard key={action.actionId} action={action} assetId={assetId} />
          ))}
        </div>
      )}
    </section>
  );
}

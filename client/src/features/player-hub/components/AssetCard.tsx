import { useLocation } from "wouter";
import {
  TrendingUp, TrendingDown, Minus, Star, Clock, XCircle,
  ArrowRight, Shield, Ban, Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useClaimAssetFromHub } from "../hooks/use-player-hub";
import type { HubAssetView } from "../hooks/use-player-hub";

// ── Claim status badge ────────────────────────────────────────────────────────

function ClaimBadge({ status }: { status: string | null }) {
  if (!status) return null;
  const map: Record<string, { label: string; cls: string; icon: React.ElementType }> = {
    approved:  { label: "Approved",  cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30", icon: Star    },
    pending:   { label: "Pending",   cls: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",   icon: Clock   },
    rejected:  { label: "Rejected",  cls: "bg-red-500/20 text-red-400 border-red-500/30",            icon: XCircle },
    revoked:   { label: "Revoked",   cls: "bg-white/10 text-white/40 border-white/20",               icon: Ban     },
  };
  const s = map[status] ?? { label: status, cls: "bg-white/10 text-white/50 border-white/20", icon: Shield };
  const Icon = s.icon;
  return (
    <Badge className={cn("border gap-1 text-xs", s.cls)}>
      <Icon className="w-3 h-3" />
      {s.label}
    </Badge>
  );
}

// ── Asset price status ────────────────────────────────────────────────────────

function AssetStatusBadge({ status }: { status: HubAssetView["status"] }) {
  const map = {
    trending:  { icon: TrendingUp,   cls: "text-emerald-400", label: "Trending"  },
    stable:    { icon: Minus,         cls: "text-white/50",    label: "Stable"    },
    declining: { icon: TrendingDown,  cls: "text-red-400",     label: "Declining" },
  };
  const s = map[status];
  const Icon = s.icon;
  return (
    <span className={cn("flex items-center gap-1 text-xs", s.cls)}>
      <Icon className="w-3 h-3" />
      {s.label}
    </span>
  );
}

// ── Card ──────────────────────────────────────────────────────────────────────

interface Props {
  asset: HubAssetView;
}

export function AssetCard({ asset }: Props) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const claimMutation = useClaimAssetFromHub(asset.assetId);

  function handleOpenOperator() {
    navigate(`/player-operator/${asset.assetId}`);
  }

  function handleClaim() {
    claimMutation.mutate(
      { assetUid: asset.assetUid },
      {
        onSuccess: (data) => {
          if (data.message) {
            toast({ title: "Claim submitted", description: data.message });
          }
        },
        onError: (err: any) => {
          toast({ title: "Claim failed", description: err.message, variant: "destructive" });
        },
      },
    );
  }

  return (
    <div
      data-testid={`asset-card-${asset.assetId}`}
      className={cn(
        "border rounded-xl p-4 flex flex-col gap-3 transition-colors",
        asset.canOpenOperator
          ? "bg-emerald-950/20 border-emerald-500/25 hover:border-emerald-400/40"
          : "bg-white/5 border-white/10 hover:border-white/20",
      )}
    >
      {/* Game + name */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs text-white/40 uppercase tracking-wider font-medium">{asset.gameName}</p>
          <p className="text-sm font-semibold text-white leading-tight mt-0.5" data-testid={`asset-name-${asset.assetId}`}>
            {asset.cardName}
          </p>
          <p className="text-xs text-white/30 mt-0.5">#{asset.assetId}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <AssetStatusBadge status={asset.status} />
          {asset.canOpenOperator && (
            <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-400 uppercase tracking-wider">
              <Zap className="w-3 h-3" />
              Operator Ready
            </span>
          )}
        </div>
      </div>

      {/* Price + claim status */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-white">
          ${asset.lastTradePrice.toFixed(2)}
        </span>
        <ClaimBadge status={asset.claimStatus} />
      </div>

      {/* CTAs */}
      <div className="flex gap-2 mt-auto">
        {asset.canOpenOperator ? (
          <Button
            size="sm"
            className="flex-1 bg-white text-black hover:bg-white/90 gap-1"
            onClick={handleOpenOperator}
            data-testid={`btn-open-operator-${asset.assetId}`}
          >
            Open Operator
            <ArrowRight className="w-3 h-3" />
          </Button>
        ) : asset.claimStatus === "pending" ? (
          <Button
            size="sm"
            variant="outline"
            className="flex-1 border-white/20 text-white/60 cursor-not-allowed"
            disabled
            data-testid={`btn-pending-claim-${asset.assetId}`}
          >
            <Clock className="w-3 h-3 mr-1" />
            Claim Pending
          </Button>
        ) : asset.canClaim ? (
          <Button
            size="sm"
            variant="outline"
            className="flex-1 border-blue-500/40 text-blue-300 hover:bg-blue-500/10"
            onClick={handleClaim}
            disabled={claimMutation.isPending}
            data-testid={`btn-claim-${asset.assetId}`}
          >
            <Shield className="w-3 h-3 mr-1" />
            {claimMutation.isPending ? "Claiming…" : "Claim Asset"}
          </Button>
        ) : (
          <Button size="sm" variant="ghost" className="flex-1 text-white/30 cursor-not-allowed" disabled>
            Unavailable
          </Button>
        )}
      </div>
    </div>
  );
}

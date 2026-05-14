import { Link } from "wouter";
import {
  ArrowLeft, User, TrendingUp, TrendingDown, Minus,
  Target, Image, MessageCircle, Zap, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { OperatorPlayerInfo } from "../hooks/use-operator";

interface Props {
  player: OperatorPlayerInfo;
  assetId: number;
  onCreateMission: () => void;
  onCreateMoment: () => void;
  onEditCard: () => void;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string; icon: React.ElementType }> = {
    trending:  { label: "Trending",  cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30", icon: TrendingUp   },
    stable:    { label: "Stable",    cls: "bg-white/10 text-white/60 border-white/20",                icon: Minus        },
    declining: { label: "Declining", cls: "bg-red-500/20 text-red-300 border-red-500/30",             icon: TrendingDown },
    up:        { label: "Trending",  cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30", icon: TrendingUp   },
    down:      { label: "Declining", cls: "bg-red-500/20 text-red-300 border-red-500/30",             icon: TrendingDown },
  };
  const s = map[status] ?? map.stable;
  const Icon = s.icon;
  return (
    <Badge className={cn("border gap-1 text-xs", s.cls)}>
      <Icon className="w-3 h-3" />
      {s.label}
    </Badge>
  );
}

export function TopBar({ player, assetId, onCreateMission, onCreateMoment, onEditCard }: Props) {
  return (
    <div className="bg-white/3 border border-white/10 rounded-xl p-4 space-y-4">
      {/* Breadcrumb + identity */}
      <div className="flex items-start gap-3">
        <Link href="/player-hub">
          <button
            className="mt-1 text-white/40 hover:text-white/80 transition-colors"
            data-testid="link-back-to-hub"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
        </Link>

        <div className="flex-1 min-w-0">
          {/* Breadcrumb */}
          <div className="flex items-center gap-1 text-xs text-white/30 mb-1.5">
            <Link href="/player-hub">
              <span className="hover:text-white/60 transition-colors cursor-pointer">Player Hub</span>
            </Link>
            <ChevronRight className="w-3 h-3" />
            <span className="text-white/50">Operator Mode</span>
          </div>

          {/* Player identity */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-white/10 border border-white/20 flex items-center justify-center flex-shrink-0 overflow-hidden">
              {player.avatarUrl ? (
                <img src={player.avatarUrl} alt={player.playerName} className="w-full h-full object-cover" />
              ) : (
                <User className="w-4 h-4 text-white/40" />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-base font-bold text-white truncate" data-testid="text-player-name">
                  {player.playerName}
                </h1>
                <StatusBadge status={player.status} />
                <Badge className="bg-white/10 text-white/50 border border-white/20 text-xs">
                  Operator Mode
                </Badge>
              </div>
              <p className="text-xs text-white/30 mt-0.5">Asset #{assetId}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          className="bg-white text-black hover:bg-white/90 gap-1.5"
          onClick={onCreateMission}
          data-testid="btn-create-mission"
        >
          <Target className="w-3.5 h-3.5" />
          Create Mission
        </Button>

        <Button
          size="sm"
          variant="outline"
          className="border-white/20 text-white/80 hover:bg-white/5 gap-1.5"
          onClick={onEditCard}
          data-testid="btn-edit-card"
        >
          <Image className="w-3.5 h-3.5" />
          Edit Card
        </Button>

        <Button
          size="sm"
          variant="ghost"
          className="text-white/30 gap-1.5 cursor-not-allowed"
          disabled
          data-testid="btn-send-message"
          title="Coming soon"
        >
          <MessageCircle className="w-3.5 h-3.5" />
          Message
          <span className="text-[10px] text-white/20 ml-0.5">soon</span>
        </Button>

        <Button
          size="sm"
          variant="outline"
          className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10 gap-1.5"
          onClick={onCreateMoment}
          data-testid="btn-topbar-create-moment"
        >
          <Zap className="w-3.5 h-3.5" />
          Moment
        </Button>
      </div>
    </div>
  );
}

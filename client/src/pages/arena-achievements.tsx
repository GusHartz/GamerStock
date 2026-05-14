import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertCircle, Lock, CheckCircle } from "lucide-react";
import { formatCurrency } from "@/lib/format";

interface ProgressInfo {
  current: number;
  target: number;
  label: string;
}

interface AchievementItem {
  code: string;
  name: string;
  description: string;
  iconKey: string;
  rarity: "common" | "rare" | "epic" | "legendary";
  xpReward: number;
  status: "locked" | "unlocked";
  unlockedAt: string | null;
  progress: ProgressInfo | null;
  unlockPercentage: number;
  unlockedByCount: number;
  totalUsers: number;
}

interface AchievementsResponse {
  total: number;
  unlockedCount: number;
  items: AchievementItem[];
}

const ICON_MAP: Record<string, string> = {
  sword: "⚔️",
  rocket: "🚀",
  fire: "🔥",
  chart: "📈",
  trophy: "🏆",
  money: "💰",
  diamond: "💎",
  streak: "⚡",
  comeback: "🔄",
  calendar: "📅",
  star: "⭐",
};

const RARITY_STYLES: Record<string, { border: string; badge: string; label: string }> = {
  common: {
    border: "border-white/10",
    badge: "bg-slate-500/20 text-slate-300 border-slate-500/30",
    label: "Common",
  },
  rare: {
    border: "border-blue-500/30",
    badge: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    label: "Rare",
  },
  epic: {
    border: "border-purple-500/30",
    badge: "bg-purple-500/20 text-purple-300 border-purple-500/30",
    label: "Epic",
  },
  legendary: {
    border: "border-yellow-500/40",
    badge: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
    label: "Legendary",
  },
};

function ArenaTabNav() {
  return (
    <div className="flex gap-1 p-1 bg-secondary/30 border border-white/10 rounded-lg w-fit flex-wrap">
      <Link href="/arena/profile">
        <button
          data-testid="tab-arena-profile"
          className="px-4 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-white hover:bg-white/5 transition-all"
        >
          My Profile
        </button>
      </Link>
      <Link href="/arena/leaderboards">
        <button
          data-testid="tab-arena-leaderboards"
          className="px-4 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-white hover:bg-white/5 transition-all"
        >
          Leaderboards
        </button>
      </Link>
      <button
        data-testid="tab-arena-achievements"
        className="px-4 py-1.5 rounded-md text-sm font-medium bg-white/10 text-white shadow-inner transition-all"
      >
        Achievements
      </button>
      <Link href="/arena/seasons">
        <button
          data-testid="tab-arena-seasons"
          className="px-4 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-white hover:bg-white/5 transition-all"
        >
          Seasons
        </button>
      </Link>
      <Link href="/arena/draft">
        <button
          data-testid="tab-arena-draft"
          className="px-4 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-white hover:bg-white/5 transition-all"
        >
          Weekly Draft
        </button>
      </Link>
    </div>
  );
}

function ProgressBar({ current, target }: { current: number; target: number }) {
  const pct = Math.min(100, target > 0 ? (current / target) * 100 : 0);
  return (
    <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{
          width: `${pct}%`,
          background: "linear-gradient(90deg, hsl(var(--primary)), #10b981)",
        }}
      />
    </div>
  );
}

function formatProgressValue(label: string, value: number): string {
  if (label.includes("Profit")) return formatCurrency(value);
  return value.toLocaleString();
}

function AchievementCard({ item }: { item: AchievementItem }) {
  const rarityStyle = RARITY_STYLES[item.rarity] ?? RARITY_STYLES.common;
  const icon = ICON_MAP[item.iconKey] ?? "🏅";
  const isUnlocked = item.status === "unlocked";

  return (
    <Card
      data-testid={`card-achievement-${item.code}`}
      className={`border transition-all duration-200 ${
        isUnlocked
          ? `${rarityStyle.border} bg-secondary/40 shadow-sm`
          : "border-white/5 bg-secondary/20 opacity-70"
      }`}
    >
      <CardContent className="pt-4 pb-4 px-4 flex flex-col gap-2.5 h-full">
        {/* Icon + Name row */}
        <div className="flex items-start gap-3">
          <div
            className={`text-2xl w-10 h-10 flex items-center justify-center rounded-lg flex-shrink-0 ${
              isUnlocked ? "bg-white/8" : "bg-white/4 grayscale"
            }`}
          >
            {icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`font-semibold text-sm ${isUnlocked ? "text-white" : "text-muted-foreground"}`}
                data-testid={`text-achievement-name-${item.code}`}
              >
                {item.name}
              </span>
              <Badge
                data-testid={`badge-rarity-${item.code}`}
                className={`text-[10px] px-1.5 py-0 h-4 border font-medium ${rarityStyle.badge}`}
              >
                {rarityStyle.label}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              {item.description}
            </p>
          </div>
        </div>

        {/* Unlock percentage */}
        {item.totalUsers > 0 && (
          <div
            className="text-xs text-muted-foreground/70"
            data-testid={`text-unlock-pct-${item.code}`}
          >
            Unlocked by <span className="text-muted-foreground font-semibold">{item.unlockPercentage.toFixed(1)}%</span> of traders
          </div>
        )}

        {/* XP reward */}
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">XP Reward</span>
          <span className="font-mono font-semibold text-primary">+{item.xpReward} XP</span>
        </div>

        {/* Status */}
        {isUnlocked ? (
          <div
            className="flex items-center gap-1.5 text-xs text-emerald-400"
            data-testid={`status-achievement-${item.code}`}
          >
            <CheckCircle className="w-3.5 h-3.5" />
            <span>
              Unlocked{" "}
              {item.unlockedAt
                ? new Date(item.unlockedAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })
                : ""}
            </span>
          </div>
        ) : item.progress ? (
          <div className="space-y-1.5" data-testid={`progress-achievement-${item.code}`}>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{item.progress.label}</span>
              <span className="font-mono">
                {formatProgressValue(item.progress.label, item.progress.current)} /{" "}
                {formatProgressValue(item.progress.label, item.progress.target)}
              </span>
            </div>
            <ProgressBar current={item.progress.current} target={item.progress.target} />
          </div>
        ) : (
          <div
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
            data-testid={`status-achievement-${item.code}`}
          >
            <Lock className="w-3.5 h-3.5" />
            <span>Locked</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function ArenaAchievementsPage() {
  const { data, isLoading, isError, refetch } = useQuery<AchievementsResponse>({
    queryKey: ["/api/arena/achievements/me"],
    queryFn: async () => {
      const res = await fetch("/api/arena/achievements/me", { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<AchievementsResponse>;
    },
    staleTime: 30_000,
  });

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Tab nav */}
      <ArenaTabNav />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1
            className="text-2xl font-bold text-white font-display"
            data-testid="heading-arena-achievements"
          >
            Achievements
          </h1>
          <p className="text-sm text-muted-foreground">
            Complete milestones to earn XP and climb the ranks
          </p>
        </div>
        {data && (
          <div
            className="text-right"
            data-testid="text-achievements-count"
          >
            <span className="text-2xl font-bold text-primary font-mono">
              {data.unlockedCount}
            </span>
            <span className="text-muted-foreground text-sm"> / {data.total}</span>
            <p className="text-xs text-muted-foreground">Unlocked</p>
          </div>
        )}
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-16" data-testid="spinner-achievements">
          <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      )}

      {/* Error */}
      {isError && (
        <Card className="bg-secondary/30 border-red-500/30">
          <CardContent className="pt-6 pb-6 text-center space-y-3" data-testid="error-achievements">
            <AlertCircle className="w-8 h-8 mx-auto text-red-400" />
            <p className="text-red-400 font-semibold text-sm">Failed to load achievements</p>
            <Button size="sm" variant="outline" onClick={() => refetch()} data-testid="button-achievements-retry">
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Grid */}
      {!isLoading && !isError && data && (
        <div
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
          data-testid="grid-achievements"
        >
          {data.items.map((item) => (
            <AchievementCard key={item.code} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

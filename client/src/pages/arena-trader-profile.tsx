import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import {
  Users,
  UserPlus,
  UserCheck,
  Swords,
  Trophy,
  TrendingUp,
  Target,
  Zap,
  Star,
  Award,
  CalendarDays,
  AlertCircle,
  ExternalLink,
  Shield,
  TrendingDown,
  Crown,
  Gem,
  Flame,
  Rocket,
  DollarSign,
  RotateCcw,
  Medal,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { RANK_COLORS } from "@shared/arena-config";
import { getAvatarUrl } from "@/lib/avatars";
import { formatCurrency } from "@/lib/format";

interface PublicTraderProfile {
  userId: string;
  username: string;
  avatarId: string | null;
  avatarUrl: string | null;
  bio: string | null;
  rankName: string;
  xp: number;
  globalRank: number | null;
  portfolioValue: number;
  totalRealizedProfit: number;
  winRate: number;
  totalTrades: number;
  bestTrade: number | null;
  worstTrade: number | null;
  traderStyle: string | null;
  badges: Array<{
    code: string;
    name: string;
    description: string;
    iconKey: string;
    rarity: string;
    awardedAt: string;
  }>;
  seasonStats: {
    seasonXp: number;
    seasonProfit: number;
    seasonTrades: number;
    seasonWinRate: number;
  } | null;
  relationship: { isSelf: boolean; isFollowing: boolean };
}

const BADGE_ICONS: Record<string, React.ReactNode> = {
  // Season-reward icons
  crown:          <Crown className="w-5 h-5" />,
  diamond:        <Gem className="w-5 h-5" />,
  "shield-diamond": <Shield className="w-5 h-5" />,
  shield:         <Shield className="w-5 h-5" />,
  "chart-up":     <TrendingUp className="w-5 h-5" />,
  bolt:           <Zap className="w-5 h-5" />,
  ticket:         <Medal className="w-5 h-5" />,
  // Achievement-based icons
  sword:          <Swords className="w-5 h-5" />,
  rocket:         <Rocket className="w-5 h-5" />,
  fire:           <Flame className="w-5 h-5" />,
  chart:          <TrendingUp className="w-5 h-5" />,
  trophy:         <Trophy className="w-5 h-5" />,
  money:          <DollarSign className="w-5 h-5" />,
  streak:         <Zap className="w-5 h-5" />,
  comeback:       <RotateCcw className="w-5 h-5" />,
  calendar:       <CalendarDays className="w-5 h-5" />,
  // Generic fallbacks
  flame:          <Flame className="w-5 h-5" />,
  target:         <Target className="w-5 h-5" />,
  award:          <Award className="w-5 h-5" />,
  star:           <Star className="w-5 h-5" />,
};

const RARITY_CLASSES: Record<string, string> = {
  legendary: "text-yellow-300 border-yellow-500/40 bg-yellow-500/10",
  epic: "text-purple-300 border-purple-500/40 bg-purple-500/10",
  rare: "text-blue-300 border-blue-500/40 bg-blue-500/10",
  common: "text-muted-foreground border-white/20 bg-white/5",
};

function BadgeCard({ badge }: { badge: PublicTraderProfile["badges"][0] }) {
  const rarityClass = RARITY_CLASSES[badge.rarity as keyof typeof RARITY_CLASSES] || RARITY_CLASSES.common;
  const icon = BADGE_ICONS[badge.iconKey] || <Award className="w-5 h-5" />;

  return (
    <div
      data-testid={`card-badge-${badge.code}`}
      className="flex flex-col items-center gap-2 p-4 rounded-2xl border border-white/8 bg-card text-center"
    >
      <div
        className={`w-12 h-12 rounded-full flex items-center justify-center border ${rarityClass}`}
      >
        {icon}
      </div>
      <div>
        <div className="text-sm font-bold text-white" data-testid={`text-badge-name-${badge.code}`}>
          {badge.name}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">{badge.description}</div>
        <span
          className={`inline-block mt-1.5 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${rarityClass}`}
        >
          {badge.rarity}
        </span>
      </div>
    </div>
  );
}

function ArenaTabNav() {
  const pathname = typeof window !== "undefined" ? window.location.pathname : "";
  const navLinks = [
    { href: "/arena/profile", label: "My Profile", testId: "tab-arena-profile" },
    { href: "/arena/leaderboards", label: "Leaderboards", testId: "tab-arena-leaderboards" },
    { href: "/arena/achievements", label: "Achievements", testId: "tab-arena-achievements" },
    { href: "/arena/seasons", label: "Seasons", testId: "tab-arena-seasons" },
  ];

  return (
    <div className="flex gap-1 p-1 bg-white/4 border border-white/8 rounded-xl w-fit flex-wrap">
      {navLinks.map(({ href, label, testId }) => {
        const active = pathname === href || pathname.startsWith(href);
        return active ? (
          <button key={href} data-testid={testId} className="px-4 py-1.5 rounded-lg text-sm font-semibold bg-white/10 text-white shadow-inner">
            {label}
          </button>
        ) : (
          <Link key={href} href={href}>
            <button data-testid={testId} className="px-4 py-1.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-white hover:bg-white/5 transition-all">
              {label}
            </button>
          </Link>
        );
      })}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  sub,
  testId,
  valueColor,
}: {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
  sub?: string;
  testId?: string;
  valueColor?: string;
}) {
  return (
    <div
      data-testid={testId}
      className="rounded-2xl border border-white/8 bg-card p-5 transition-shadow"
    >
      <div className="flex items-center gap-2 mb-3">
        {icon && <span className="opacity-60">{icon}</span>}
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      </div>
      <div
        className="font-mono font-bold leading-none text-xl sm:text-2xl"
        style={valueColor ? { color: valueColor } : undefined}
      >
        {value}
      </div>
      {sub && <div className="mt-2 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

export default function ArenaTraderProfilePage() {
  const [, params] = useRoute("/arena/trader/:username");
  const username = params?.username;
  const { toast } = useToast();
  const [isDuelModalOpen, setIsDuelModalOpen] = useState(false);

  const { data: trader, isLoading, error } = useQuery<PublicTraderProfile>({
    queryKey: ["/api/arena/trader", username],
    queryFn: async () => {
      const res = await fetch(`/api/arena/trader/${username}`);
      if (!res.ok) {
        if (res.status === 404) throw new Error("Trader not found");
        throw new Error("Failed to fetch trader profile");
      }
      return res.json();
    },
    enabled: !!username,
  });

  const followMutation = useMutation({
    mutationFn: async () => {
      const method = trader?.relationship.isFollowing ? "DELETE" : "POST";
      return apiRequest(method, "/api/arena/follow", { targetUserId: trader?.userId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/arena/trader", username] });
      toast({
        title: trader?.relationship.isFollowing ? "Unfollowed trader" : "Following trader",
      });
    },
    onError: () => {
      toast({
        title: "Action failed",
        variant: "destructive",
      });
    },
  });

  const duelMutation = useMutation({
    mutationFn: async (durationDays: number) => {
      return apiRequest("POST", "/api/arena/duel/challenge", {
        opponentUserId: trader?.userId,
        durationDays,
        metric: "highest_profit",
      });
    },
    onSuccess: () => {
      setIsDuelModalOpen(false);
      toast({
        title: "Challenge sent!",
        description: `You have challenged ${trader?.username} to a duel.`,
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Challenge failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-10 h-10 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !trader) {
    return (
      <div className="max-w-4xl mx-auto space-y-6" data-testid="page-trader-profile">
        <ArenaTabNav />
        <Card className="bg-secondary/30 border-white/10">
          <CardContent className="flex flex-col items-center justify-center py-12 gap-3">
            <AlertCircle className="w-10 h-10 text-muted-foreground/30" />
            <p className="text-white font-medium">Trader not found</p>
            <Link href="/arena/leaderboards">
              <Button variant="outline">Back to Leaderboards</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const rankColor = RANK_COLORS[trader.rankName] || "#9CA3AF";
  const avatarUrl = trader.avatarId ? getAvatarUrl(trader.avatarId) : (trader.avatarUrl || getAvatarUrl(null));

  return (
    <div className="max-w-4xl mx-auto space-y-6" data-testid="page-trader-profile">
      <ArenaTabNav />

      {/* Header Profile Card */}
      <Card className="bg-card border-white/8 p-6 overflow-hidden relative">
        <div className="flex flex-col md:flex-row gap-6 items-start relative z-10">
          <div className="relative flex-shrink-0">
            <img
              src={avatarUrl}
              alt={trader.username}
              data-testid="img-trader-avatar"
              className="w-24 h-24 rounded-full object-cover bg-white/5 border-2"
              style={{ borderColor: rankColor, boxShadow: `0 0 20px ${rankColor}30` }}
            />
          </div>

          <div className="flex-1 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-bold text-white" data-testid="text-trader-username">
                {trader.username}
              </h1>
              <Badge
                data-testid="badge-trader-rank"
                style={{
                  backgroundColor: `${rankColor}20`,
                  color: rankColor,
                  borderColor: `${rankColor}40`,
                }}
                className="font-bold border"
              >
                <Shield className="w-3 h-3 mr-1" />
                {trader.rankName}
              </Badge>
              {trader.traderStyle && (
                <Badge variant="outline" className="border-primary/30 text-primary">
                  <Swords className="w-3 h-3 mr-1" />
                  {trader.traderStyle}
                </Badge>
              )}
            </div>

            {trader.bio && (
              <p className="text-muted-foreground text-sm max-w-2xl">{trader.bio}</p>
            )}

            {!trader.relationship.isSelf && (
              <div className="flex gap-3">
                <Button
                  data-testid="button-follow-trader"
                  variant={trader.relationship.isFollowing ? "outline" : "default"}
                  onClick={() => followMutation.mutate()}
                  disabled={followMutation.isPending}
                  className="gap-2"
                >
                  {trader.relationship.isFollowing ? (
                    <>
                      <UserCheck className="w-4 h-4" />
                      Following
                    </>
                  ) : (
                    <>
                      <UserPlus className="w-4 h-4" />
                      Follow Trader
                    </>
                  )}
                </Button>
                <Button
                  data-testid="button-challenge-trader"
                  variant="secondary"
                  className="gap-2"
                  onClick={() => setIsDuelModalOpen(true)}
                >
                  <Swords className="w-4 h-4" />
                  Challenge Duel
                </Button>
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" data-testid="section-trader-stats">
        <StatCard
          label="Global Rank"
          value={trader.globalRank ? `#${trader.globalRank}` : "N/A"}
          icon={<Trophy className="w-4 h-4 text-yellow-400" />}
          sub={`Total XP: ${trader.xp.toLocaleString()}`}
        />
        <StatCard
          label="Portfolio Value"
          value={formatCurrency(trader.portfolioValue)}
          icon={<TrendingUp className="w-4 h-4 text-blue-400" />}
        />
        <StatCard
          label="Total Profit"
          value={formatCurrency(trader.totalRealizedProfit)}
          valueColor={trader.totalRealizedProfit >= 0 ? "#4ade80" : "#f87171"}
          icon={trader.totalRealizedProfit >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
        />
        <StatCard
          label="Win Rate"
          value={`${trader.winRate}%`}
          icon={<Target className="w-4 h-4 text-purple-400" />}
          sub={`${trader.totalTrades} Total Trades`}
        />
      </div>

      {/* Best/Worst Trades */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {trader.bestTrade !== null && (
          <StatCard
            label="Best Trade"
            value={formatCurrency(trader.bestTrade)}
            valueColor="#4ade80"
            icon={<TrendingUp className="w-4 h-4" />}
          />
        )}
        {trader.worstTrade !== null && (
          <StatCard
            label="Worst Trade"
            value={formatCurrency(trader.worstTrade)}
            valueColor="#f87171"
            icon={<TrendingDown className="w-4 h-4" />}
          />
        )}
      </div>

      {/* Season Stats */}
      {trader.seasonStats && (
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">Current Season</span>
            <div className="flex-1 h-px bg-white/6" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Season XP"
              value={trader.seasonStats.seasonXp.toLocaleString()}
              icon={<Zap className="w-4 h-4 text-yellow-400" />}
            />
            <StatCard
              label="Season Profit"
              value={formatCurrency(trader.seasonStats.seasonProfit)}
              valueColor={trader.seasonStats.seasonProfit >= 0 ? "#4ade80" : "#f87171"}
              icon={<TrendingUp className="w-4 h-4 text-blue-400" />}
            />
            <StatCard
              label="Season Win Rate"
              value={`${trader.seasonStats.seasonWinRate}%`}
              icon={<Target className="w-4 h-4 text-purple-400" />}
            />
            <StatCard
              label="Season Trades"
              value={trader.seasonStats.seasonTrades}
              icon={<Swords className="w-4 h-4 text-muted-foreground" />}
            />
          </div>
        </section>
      )}

      {/* Badges Section */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">Trader Badges</span>
          <div className="flex-1 h-px bg-white/6" />
        </div>
        {trader.badges.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {trader.badges.map((badge) => (
              <BadgeCard key={badge.code} badge={badge} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 py-8 rounded-2xl border border-white/8 bg-card/50 text-center">
            <Medal className="w-8 h-8 text-muted-foreground/50" />
            <div>
              <p className="text-sm font-medium text-white/60">No badges unlocked yet</p>
              <p className="text-xs text-muted-foreground mt-0.5">Badges are earned through trading achievements</p>
            </div>
          </div>
        )}
      </section>

      {/* Duel Challenge Modal */}
      <Dialog open={isDuelModalOpen} onOpenChange={setIsDuelModalOpen}>
        <DialogContent className="bg-card border-white/10 sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Swords className="w-5 h-5 text-primary" />
              Challenge {trader.username} to a Duel
            </DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-6">
            <div className="space-y-3">
              <label className="text-sm font-medium text-muted-foreground">Duration</label>
              <div className="grid grid-cols-3 gap-2">
                {[3, 7, 14].map((days) => (
                  <Button
                    key={days}
                    variant="outline"
                    className="border-white/10 hover:bg-white/5"
                    onClick={() => duelMutation.mutate(days)}
                    disabled={duelMutation.isPending}
                  >
                    {days} Days
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Metric</label>
              <div className="p-3 bg-white/5 rounded-lg border border-white/10 flex items-center justify-between">
                <span className="text-white font-medium">Highest Profit</span>
                <Badge variant="secondary">Required</Badge>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsDuelModalOpen(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

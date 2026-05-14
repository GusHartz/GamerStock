import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CalendarDays,
  Trophy,
  TrendingUp,
  Zap,
  Target,
  AlertCircle,
  Clock,
  Gift,
  Swords,
  ChevronRight,
} from "lucide-react";
import { RANK_COLORS } from "@shared/arena-config";
import { formatCurrency } from "@/lib/format";

interface Season {
  id: number;
  name: string;
  startsAt: string;
  endsAt: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface SeasonsResponse {
  activeSeason: Season | null;
  seasons: Season[];
}

interface SeasonMeResponse {
  season: Season;
  stats: {
    seasonId: number;
    userId: string;
    xpSeason: number;
    rankSeason: string;
    realizedProfitSeason: string;
    tradesSeason: number;
    winTradesSeason: number;
    lossTradesSeason: number;
    bestTradePnlSeason: string | null;
    worstTradePnlSeason: string | null;
    winStreakCurrentSeason: number;
    winStreakBestSeason: number;
    lossStreakCurrentSeason: number;
  };
}

interface SeasonReward {
  id: number;
  seasonId: number;
  rankMin: number;
  rankMax: number;
  badgeCode: string;
  label: string | null;
  createdAt: string;
}

interface SeasonRewardsResponse {
  rewards: SeasonReward[];
}

interface ArenaChallenge {
  id: number;
  title: string;
  description: string;
  type: string;
  target: number;
  rewardXp: number;
  startsAt: string;
  endsAt: string;
  status: string;
}

interface ChallengesResponse {
  challenges: ArenaChallenge[];
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatCountdown(endsAt: string): string {
  const now = Date.now();
  const end = new Date(endsAt).getTime();
  const diff = end - now;
  if (diff <= 0) return "Ended";
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  if (days > 0) return `${days}d ${hours}h remaining`;
  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}h ${mins}m remaining`;
}

function statusBadge(status: string) {
  if (status === "active")
    return (
      <Badge className="text-xs bg-green-500/20 text-green-400 border-green-500/30 border" data-testid="badge-season-active">
        Active
      </Badge>
    );
  if (status === "closed")
    return (
      <Badge className="text-xs bg-white/5 text-muted-foreground border-white/10 border" data-testid="badge-season-closed">
        Closed
      </Badge>
    );
  return (
    <Badge className="text-xs bg-blue-500/20 text-blue-400 border-blue-500/30 border" data-testid="badge-season-upcoming">
      Upcoming
    </Badge>
  );
}

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
      <Link href="/arena/achievements">
        <button
          data-testid="tab-arena-achievements"
          className="px-4 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-white hover:bg-white/5 transition-all"
        >
          Achievements
        </button>
      </Link>
      <button
        data-testid="tab-arena-seasons"
        className="px-4 py-1.5 rounded-md text-sm font-medium bg-white/10 text-white shadow-inner transition-all"
      >
        Seasons
      </button>
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

function StatBox({
  icon,
  label,
  value,
  color = "text-white",
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  color?: string;
  testId?: string;
}) {
  return (
    <div className="bg-white/5 rounded-lg p-3 border border-white/5">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
        {icon}
        {label}
      </div>
      <div className={`text-lg font-bold ${color}`} data-testid={testId}>
        {value}
      </div>
    </div>
  );
}

function rewardTierColor(rankMin: number, rankMax: number) {
  if (rankMin === 1 && rankMax === 1) return { bg: "from-yellow-500/20 to-yellow-600/10", border: "border-yellow-500/40", text: "text-yellow-300", icon: "🏆" };
  if (rankMin <= 3) return { bg: "from-orange-500/20 to-orange-600/10", border: "border-orange-500/40", text: "text-orange-300", icon: "🥇" };
  if (rankMin <= 10) return { bg: "from-purple-500/20 to-purple-600/10", border: "border-purple-500/40", text: "text-purple-300", icon: "💎" };
  if (rankMin <= 50) return { bg: "from-blue-500/20 to-blue-600/10", border: "border-blue-500/40", text: "text-blue-300", icon: "⚡" };
  return { bg: "from-white/10 to-white/5", border: "border-white/20", text: "text-muted-foreground", icon: "🎖️" };
}

function RewardTiersSection({ seasonId }: { seasonId: number }) {
  const { data, isLoading } = useQuery<SeasonRewardsResponse>({
    queryKey: ["/api/arena/seasons", seasonId, "rewards"],
    queryFn: async () => {
      const res = await fetch(`/api/arena/seasons/${seasonId}/rewards`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 120_000,
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-4">
        <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  const rewards = data?.rewards ?? [];

  if (rewards.length === 0) return null;

  return (
    <div className="space-y-2" data-testid="section-season-rewards">
      <div className="flex items-center gap-2">
        <Gift className="w-3.5 h-3.5 text-yellow-400" />
        <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium">
          Season Rewards
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {rewards.map((r) => {
          const style = rewardTierColor(r.rankMin, r.rankMax);
          const rangeLabel = r.rankMin === r.rankMax ? `Rank #${r.rankMin}` : `Ranks #${r.rankMin}–#${r.rankMax}`;
          return (
            <div
              key={r.id}
              className={`bg-gradient-to-br ${style.bg} border ${style.border} rounded-lg p-3 flex items-center gap-3`}
              data-testid={`card-reward-tier-${r.id}`}
            >
              <span className="text-xl leading-none">{style.icon}</span>
              <div className="min-w-0 flex-1">
                <div className={`text-sm font-semibold ${style.text} truncate`}>
                  {r.label ?? rangeLabel}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 font-mono truncate">{r.badgeCode}</div>
                <div className="text-xs text-muted-foreground/60 mt-0.5">{rangeLabel}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function challengeTypeIcon(type: string) {
  switch (type) {
    case "trades": return <Swords className="w-4 h-4 text-blue-400" />;
    case "profit": return <TrendingUp className="w-4 h-4 text-green-400" />;
    case "win_streak": return <Target className="w-4 h-4 text-orange-400" />;
    case "xp": return <Zap className="w-4 h-4 text-yellow-400" />;
    default: return <Target className="w-4 h-4 text-muted-foreground" />;
  }
}

function ChallengesSection() {
  const { data, isLoading } = useQuery<ChallengesResponse>({
    queryKey: ["/api/arena/challenges"],
    queryFn: async () => {
      const res = await fetch("/api/arena/challenges", { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 120_000,
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  const challenges = data?.challenges ?? [];

  return (
    <div className="space-y-3" data-testid="section-challenges">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500/20 to-red-600/10 border border-orange-500/30 flex items-center justify-center">
          <Swords className="w-4 h-4 text-orange-400" />
        </div>
        <div>
          <h2 className="text-base font-bold text-white">Active Challenges</h2>
          <p className="text-xs text-muted-foreground">Complete for bonus XP</p>
        </div>
      </div>

      {challenges.length === 0 ? (
        <Card className="bg-secondary/30 border-white/10" data-testid="card-no-challenges">
          <CardContent className="flex flex-col items-center justify-center py-10 gap-2">
            <Swords className="w-8 h-8 text-muted-foreground/30" />
            <p className="text-muted-foreground text-sm font-medium">No active challenges</p>
            <p className="text-xs text-muted-foreground/60">New challenges drop weekly — check back soon!</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {challenges.map((c) => (
            <Card
              key={c.id}
              className="bg-secondary/30 border-white/10 hover:border-white/20 transition-colors"
              data-testid={`card-challenge-${c.id}`}
            >
              <CardContent className="py-4 flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center flex-shrink-0">
                  {challengeTypeIcon(c.type)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-white text-sm" data-testid={`text-challenge-title-${c.id}`}>{c.title}</span>
                    {c.rewardXp > 0 && (
                      <Badge className="text-xs bg-yellow-500/15 text-yellow-400 border-yellow-500/30 border">
                        +{c.rewardXp.toLocaleString()} XP
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{c.description}</p>
                  <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground/60">
                    <span className="flex items-center gap-1">
                      <Target className="w-3 h-3" />
                      Target: {c.target.toLocaleString()}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatCountdown(c.endsAt)}
                    </span>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground/40 flex-shrink-0" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ArenaSeasonsPage() {
  const { data: seasonsData, isLoading: seasonsLoading, isError: seasonsError } = useQuery<SeasonsResponse>({
    queryKey: ["/api/arena/seasons"],
    queryFn: async () => {
      const res = await fetch("/api/arena/seasons", { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 60_000,
  });

  const hasActiveSeason = !!seasonsData?.activeSeason;

  const { data: meData, isLoading: meLoading } = useQuery<SeasonMeResponse>({
    queryKey: ["/api/arena/seasons/me"],
    queryFn: async () => {
      const res = await fetch("/api/arena/seasons/me", { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 60_000,
    enabled: hasActiveSeason,
  });

  const activeSeason = seasonsData?.activeSeason ?? null;
  const pastSeasons = seasonsData?.seasons.filter((s) => s.status === "closed") ?? [];
  const upcomingSeasons = seasonsData?.seasons.filter((s) => s.status === "upcoming") ?? [];

  const stats = meData?.stats;
  const rankColor = stats ? (RANK_COLORS[stats.rankSeason] ?? "#CD7F32") : "#CD7F32";
  const profit = stats ? parseFloat(stats.realizedProfitSeason ?? "0") : 0;
  const totalGames = stats ? stats.winTradesSeason + stats.lossTradesSeason : 0;
  const winRate =
    totalGames > 0 ? ((stats!.winTradesSeason / totalGames) * 100).toFixed(1) : "—";

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <ArenaTabNav />
      </div>

      {/* Page Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500/20 to-blue-600/10 border border-blue-500/30 flex items-center justify-center">
          <CalendarDays className="w-5 h-5 text-blue-400" />
        </div>
        <div>
          <h1
            className="text-2xl font-bold text-white font-display"
            data-testid="heading-arena-seasons"
          >
            Seasons
          </h1>
          <p className="text-sm text-muted-foreground">
            Compete in limited-time seasons for exclusive badges and rewards
          </p>
        </div>
      </div>

      {/* Loading / Error states */}
      {seasonsLoading && (
        <div className="flex justify-center py-16" data-testid="spinner-seasons">
          <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      )}

      {seasonsError && (
        <Card className="bg-secondary/30 border-white/10">
          <CardContent className="flex flex-col items-center justify-center py-12 gap-3">
            <AlertCircle className="w-8 h-8 text-red-400" />
            <p className="text-red-400 text-sm font-semibold">Failed to load seasons</p>
          </CardContent>
        </Card>
      )}

      {/* Active Season */}
      {!seasonsLoading && !seasonsError && (
        <>
          {activeSeason ? (
            <Card className="bg-secondary/30 border-green-500/30" data-testid="card-active-season">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Trophy className="w-5 h-5 text-yellow-400" />
                    <span className="text-white font-bold" data-testid="text-active-season-name">
                      {activeSeason.name}
                    </span>
                    {statusBadge(activeSeason.status)}
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <CalendarDays className="w-3.5 h-3.5" />
                    {formatDate(activeSeason.startsAt)} – {formatDate(activeSeason.endsAt)}
                  </span>
                  <span className="flex items-center gap-1 text-green-400 font-medium">
                    <Clock className="w-3.5 h-3.5" />
                    <span data-testid="text-season-countdown">
                      {formatCountdown(activeSeason.endsAt)}
                    </span>
                  </span>
                </div>

                {/* My Season Stats */}
                {meLoading && (
                  <div className="flex justify-center py-4">
                    <div className="w-6 h-6 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
                  </div>
                )}

                {!meLoading && stats && (
                  <>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium">
                        My Season Stats
                      </span>
                      <Badge
                        className="text-xs font-semibold border"
                        style={{
                          color: rankColor,
                          borderColor: `${rankColor}40`,
                          backgroundColor: `${rankColor}18`,
                        }}
                        data-testid="badge-season-rank"
                      >
                        {stats.rankSeason}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <StatBox
                        icon={<Zap className="w-3 h-3" />}
                        label="Season XP"
                        value={`${stats.xpSeason.toLocaleString()} XP`}
                        color="text-primary"
                        testId="text-season-xp"
                      />
                      <StatBox
                        icon={<TrendingUp className="w-3 h-3" />}
                        label="Profit"
                        value={`${profit >= 0 ? "+" : ""}${formatCurrency(profit)}`}
                        color={profit >= 0 ? "text-green-400" : "text-red-400"}
                        testId="text-season-profit"
                      />
                      <StatBox
                        icon={<Target className="w-3 h-3" />}
                        label="Win Rate"
                        value={winRate !== "—" ? `${winRate}%` : "—"}
                        testId="text-season-winrate"
                      />
                      <StatBox
                        icon={<Trophy className="w-3 h-3" />}
                        label="Trades"
                        value={stats.tradesSeason}
                        testId="text-season-trades"
                      />
                    </div>
                  </>
                )}

                {/* Reward Tiers for this season */}
                <RewardTiersSection seasonId={activeSeason.id} />

                {/* CTA */}
                <div className="flex gap-3 pt-1">
                  <Link href="/arena/leaderboards?scope=season">
                    <Button
                      size="sm"
                      className="gap-1.5"
                      data-testid="button-view-season-leaderboard"
                    >
                      <Trophy className="w-3.5 h-3.5" />
                      Season Leaderboard
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          ) : (
            upcomingSeasons.length === 0 && (
              <Card className="bg-secondary/30 border-white/10" data-testid="card-no-active-season">
                <CardContent className="flex flex-col items-center justify-center py-12 gap-3">
                  <CalendarDays className="w-10 h-10 text-muted-foreground/30" />
                  <p className="text-muted-foreground font-medium">No active season right now</p>
                  <p className="text-xs text-muted-foreground/60">
                    Check back soon for the next competitive season!
                  </p>
                </CardContent>
              </Card>
            )
          )}

          {/* Upcoming Seasons */}
          {upcomingSeasons.length > 0 && (
            <div className="space-y-3" data-testid="list-upcoming-seasons">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Upcoming
              </h2>
              {upcomingSeasons.map((s) => (
                <Card
                  key={s.id}
                  className="bg-secondary/30 border-blue-500/20"
                  data-testid={`card-season-${s.id}`}
                >
                  <CardContent className="py-4 flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white">{s.name}</span>
                        {statusBadge(s.status)}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Starts {formatDate(s.startsAt)}
                      </div>
                    </div>
                    <Badge className="text-xs bg-blue-500/10 text-blue-400 border-blue-500/20 border">
                      Coming Soon
                    </Badge>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Active Challenges */}
          <ChallengesSection />

          {/* Past Seasons */}
          {pastSeasons.length > 0 && (
            <div className="space-y-3" data-testid="list-past-seasons">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Past Seasons
              </h2>
              {pastSeasons.map((s) => (
                <Card
                  key={s.id}
                  className="bg-secondary/30 border-white/10"
                  data-testid={`card-season-${s.id}`}
                >
                  <CardContent className="py-4 flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white">{s.name}</span>
                        {statusBadge(s.status)}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {formatDate(s.startsAt)} – {formatDate(s.endsAt)}
                      </div>
                    </div>
                    <Link href={`/arena/leaderboards?scope=season&seasonId=${s.id}`}>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 text-xs"
                        data-testid={`button-season-results-${s.id}`}
                      >
                        <Trophy className="w-3 h-3" />
                        Results
                      </Button>
                    </Link>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* No seasons at all */}
          {!activeSeason && pastSeasons.length === 0 && upcomingSeasons.length === 0 && (
            <Card className="bg-secondary/30 border-white/10">
              <CardContent className="flex flex-col items-center justify-center py-12 gap-3">
                <CalendarDays className="w-10 h-10 text-muted-foreground/30" />
                <p className="text-muted-foreground font-medium">No seasons yet</p>
                <p className="text-xs text-muted-foreground/60">
                  Seasons will be announced soon. Stay tuned!
                </p>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

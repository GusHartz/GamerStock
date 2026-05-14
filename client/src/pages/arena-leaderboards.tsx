import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertCircle, ChevronLeft, ChevronRight, Trophy, User as UserIcon,
  CalendarDays, Swords, Activity, TrendingUp, Zap,
} from "lucide-react";
import { RANK_COLORS } from "@shared/arena-config";
import { getAvatarUrl } from "@/lib/avatars";
import { formatCurrency } from "@/lib/format";
import { useAuth } from "@/hooks/use-auth";

type Metric = "xp" | "realizedProfit" | "winRate";
type Scope = "allTime" | "season";

interface LeaderboardItem {
  rankPosition: number;
  userId: string;
  username: string;
  avatarUrl: string | null;
  avatarId?: string | null;
  rank: string;
  xpTotal: number;
  realizedProfitTotal: string;
  winRate: string;
  tradesTotal: number;
  winTrades: number;
  lossTrades: number;
}

interface LeaderboardResponse {
  scope: string;
  season: { id: number; name: string; status: string } | null;
  metric: string;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  items: LeaderboardItem[];
}

interface SeasonsResponse {
  activeSeason: { id: number; name: string; status: string } | null;
  seasons: Array<{ id: number; name: string; status: string; startsAt: string; endsAt: string }>;
}

interface UserRankResponse {
  userId: string;
  username: string;
  avatarUrl: string | null;
  rankPosition: number;
  xp: number;
  rankName: string;
}

interface RivalResponse {
  isUserLeader: boolean;
  currentUser: { userId: string; username: string; avatarUrl: string | null; avatarId?: string | null; rankPosition: number; xp: number; rankName: string };
  rival: { userId: string; username: string; avatarUrl: string | null; avatarId?: string | null; rankPosition: number; xp: number; rankName: string } | null;
  xpDifference: number;
}

interface ActivityItem {
  id: number;
  userId: string;
  username: string;
  avatarUrl: string | null;
  activityType: string;
  metadata: Record<string, any>;
  xpDelta: number;
  createdAt: string;
}

interface ActivityResponse {
  items: ActivityItem[];
}

const METRIC_TABS: { id: Metric; label: string }[] = [
  { id: "xp", label: "XP" },
  { id: "realizedProfit", label: "Profit" },
  { id: "winRate", label: "Win Rate" },
];

const MEDAL: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

function positionDisplay(pos: number) {
  return MEDAL[pos] ?? `#${pos}`;
}

function formatValue(metric: string, item: LeaderboardItem) {
  if (metric === "xp") {
    return (
      <span className="font-bold text-primary tabular-nums" data-testid={`text-lb-value-${item.userId}`}>
        {Number(item.xpTotal).toLocaleString()} XP
      </span>
    );
  }
  if (metric === "realizedProfit") {
    const v = parseFloat(item.realizedProfitTotal ?? "0");
    return (
      <span
        className={`font-bold tabular-nums ${v >= 0 ? "text-green-400" : "text-red-400"}`}
        data-testid={`text-lb-value-${item.userId}`}
      >
        {v >= 0 ? "+" : ""}
        {formatCurrency(v)}
      </span>
    );
  }
  return (
    <span className="font-bold text-white tabular-nums" data-testid={`text-lb-value-${item.userId}`}>
      {item.winRate}%
    </span>
  );
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function activityText(item: ActivityItem): string {
  const m = item.metadata ?? {};
  switch (item.activityType) {
    case "RANK_UP":
      return `${item.username} reached ${m.newRank ?? "a new rank"}`;
    case "ACHIEVEMENT_UNLOCKED":
      return `${item.username} unlocked "${m.achievementName ?? m.achievementCode ?? "an achievement"}"`;
    case "PROFITABLE_TRADE": {
      const profit = parseFloat(m.realizedPnl ?? "0");
      return `${item.username} made ${profit >= 0 ? "+" : ""}${formatCurrency(profit)} profit`;
    }
    case "DUEL_WIN":
      return `${item.username} won a duel against ${m.opponentUsername ?? "another trader"}`;
    default:
      return `${item.username} was active`;
  }
}

function activityIcon(type: string) {
  switch (type) {
    case "RANK_UP": return <Trophy className="w-3.5 h-3.5 text-yellow-400" />;
    case "ACHIEVEMENT_UNLOCKED": return <Zap className="w-3.5 h-3.5 text-purple-400" />;
    case "PROFITABLE_TRADE": return <TrendingUp className="w-3.5 h-3.5 text-green-400" />;
    case "DUEL_WIN": return <Swords className="w-3.5 h-3.5 text-red-400" />;
    default: return <Activity className="w-3.5 h-3.5 text-muted-foreground" />;
  }
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
      <button
        data-testid="tab-arena-leaderboards"
        className="px-4 py-1.5 rounded-md text-sm font-medium bg-white/10 text-white shadow-inner transition-all"
      >
        Leaderboards
      </button>
      <Link href="/arena/achievements">
        <button
          data-testid="tab-arena-achievements"
          className="px-4 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-white hover:bg-white/5 transition-all"
        >
          Achievements
        </button>
      </Link>
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

function UserAvatar({ avatarUrl, avatarId, username, size = "sm" }: { avatarUrl: string | null; avatarId?: string | null; username: string; size?: "sm" | "md" }) {
  const dim = size === "md" ? "w-9 h-9" : "w-7 h-7";
  const resolvedUrl = avatarId ? getAvatarUrl(avatarId) : avatarUrl;
  return resolvedUrl ? (
    <img src={resolvedUrl} alt={username} className={`${dim} rounded-full object-cover border border-white/10 flex-shrink-0 bg-white/5`} />
  ) : (
    <div className={`${dim} rounded-full bg-secondary flex items-center justify-center flex-shrink-0 border border-white/10`}>
      <UserIcon className={`${size === "md" ? "w-4 h-4" : "w-3.5 h-3.5"} text-muted-foreground`} />
    </div>
  );
}

function NextRivalCard({ rivalData }: { rivalData: RivalResponse }) {
  const rankColor = (name: string) => RANK_COLORS[name] ?? "#CD7F32";

  if (rivalData.isUserLeader) {
    return (
      <Card className="bg-gradient-to-br from-yellow-500/10 to-yellow-600/5 border-yellow-500/30" data-testid="card-next-rival">
        <CardContent className="p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-yellow-500/20 border border-yellow-500/30 flex items-center justify-center flex-shrink-0">
            <Trophy className="w-5 h-5 text-yellow-400" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-yellow-400/80">Next Rival</p>
            <p className="text-sm font-bold text-yellow-300">You are the current leader!</p>
            <p className="text-xs text-muted-foreground">Keep trading to defend your position</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const { currentUser, rival, xpDifference } = rivalData;
  if (!rival) return null;

  return (
    <Card className="bg-secondary/30 border-white/10" data-testid="card-next-rival">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Swords className="w-4 h-4 text-orange-400" />
          <span className="text-xs font-semibold uppercase tracking-wider text-orange-400/80">Next Rival</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <UserAvatar avatarUrl={rival.avatarUrl} avatarId={rival.avatarId} username={rival.username} size="md" />
            <div className="min-w-0">
              <p className="font-semibold text-white text-sm truncate" data-testid="text-rival-username">{rival.username}</p>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">#{rival.rankPosition}</span>
                <Badge
                  className="text-[10px] px-1.5 py-0 h-4 border font-medium"
                  style={{ color: rankColor(rival.rankName), borderColor: `${rankColor(rival.rankName)}40`, backgroundColor: `${rankColor(rival.rankName)}18` }}
                >
                  {rival.rankName}
                </Badge>
              </div>
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-xs text-muted-foreground">Rival XP</p>
            <p className="font-mono font-bold text-white text-sm" data-testid="text-rival-xp">{rival.xp.toLocaleString()} XP</p>
          </div>
        </div>
        <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />
            <span className="text-xs text-muted-foreground">
              You need{" "}
              <span className="font-bold text-orange-300" data-testid="text-rival-xp-diff">
                {xpDifference.toLocaleString()} XP
              </span>
              {" "}to surpass
            </span>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Your rank</p>
            <p className="font-mono text-xs text-muted-foreground">#{currentUser.rankPosition}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ActivityFeed({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground" data-testid="empty-activity">
        <Activity className="w-7 h-7 opacity-30" />
        <p className="text-xs">No activity yet. Start trading!</p>
      </div>
    );
  }

  return (
    <div className="space-y-0" data-testid="list-activity-feed">
      {items.map((item, idx) => (
        <div
          key={item.id}
          data-testid={`item-activity-${item.id}`}
          className={`flex items-start gap-3 px-4 py-3 ${idx < items.length - 1 ? "border-b border-white/5" : ""}`}
        >
          <div className="w-6 h-6 rounded-full bg-white/5 border border-white/8 flex items-center justify-center flex-shrink-0 mt-0.5">
            {activityIcon(item.activityType)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white/90 leading-snug">{activityText(item)}</p>
            {item.xpDelta > 0 && (
              <span className="text-xs text-primary font-mono font-semibold">+{item.xpDelta} XP</span>
            )}
          </div>
          <span className="text-xs text-muted-foreground/60 whitespace-nowrap flex-shrink-0 mt-0.5">
            {timeAgo(item.createdAt)}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function ArenaLeaderboardsPage() {
  const { user } = useAuth();
  const [metric, setMetric] = useState<Metric>("xp");
  const [page, setPage] = useState(1);
  const [scope, setScope] = useState<Scope>("allTime");
  const [seasonId, setSeasonId] = useState<number | null>(null);

  const { data: seasonsData } = useQuery<SeasonsResponse>({
    queryKey: ["/api/arena/seasons"],
    queryFn: async () => {
      const res = await fetch("/api/arena/seasons", { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 60_000,
  });

  const effectiveSeasonId = seasonId ?? seasonsData?.activeSeason?.id ?? null;

  const { data, isLoading, isError, refetch } = useQuery<LeaderboardResponse>({
    queryKey: ["/api/arena/leaderboards", metric, page, scope, effectiveSeasonId],
    queryFn: async () => {
      let url = `/api/arena/leaderboards?metric=${encodeURIComponent(metric)}&page=${page}&pageSize=50&scope=${scope}`;
      if (scope === "season" && effectiveSeasonId) {
        url += `&seasonId=${effectiveSeasonId}`;
      }
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<LeaderboardResponse>;
    },
    staleTime: 30_000,
    enabled: scope === "allTime" || (scope === "season" && effectiveSeasonId !== null),
  });

  const { data: userRankData } = useQuery<UserRankResponse>({
    queryKey: ["/api/arena/user-rank"],
    queryFn: async () => {
      const res = await fetch("/api/arena/user-rank", { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 30_000,
  });

  const { data: rivalData } = useQuery<RivalResponse>({
    queryKey: ["/api/arena/rival"],
    queryFn: async () => {
      const res = await fetch("/api/arena/rival", { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 30_000,
  });

  const { data: activityData } = useQuery<ActivityResponse>({
    queryKey: ["/api/arena/activity"],
    queryFn: async () => {
      const res = await fetch("/api/arena/activity?limit=20", { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 30_000,
  });

  const currentUserId = user?.id ?? null;
  const isUserOnPage = data?.items.some((item) => item.userId === currentUserId) ?? false;

  const handleMetricChange = (m: Metric) => {
    setMetric(m);
    setPage(1);
  };

  const handleScopeChange = (s: Scope) => {
    setScope(s);
    setPage(1);
  };

  const noActiveSeason = scope === "season" && !effectiveSeasonId && !isLoading;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <ArenaTabNav />
      </div>

      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-yellow-500/20 to-yellow-600/10 border border-yellow-500/30 flex items-center justify-center">
          <Trophy className="w-5 h-5 text-yellow-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white font-display" data-testid="heading-arena-leaderboards">
            Arena Leaderboards
          </h1>
          <p className="text-sm text-muted-foreground">Top traders ranked by performance</p>
        </div>
      </div>

      {/* Next Rival Card */}
      {rivalData && <NextRivalCard rivalData={rivalData} />}

      {/* Scope Toggle */}
      <div className="space-y-3">
        <div className="flex gap-1 p-1 bg-secondary/30 border border-white/10 rounded-lg w-fit" data-testid="toggle-scope">
          <button
            data-testid="scope-allTime"
            onClick={() => handleScopeChange("allTime")}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
              scope === "allTime"
                ? "bg-white/10 text-white shadow-inner"
                : "text-muted-foreground hover:text-white hover:bg-white/5"
            }`}
          >
            All-time
          </button>
          <button
            data-testid="scope-season"
            onClick={() => handleScopeChange("season")}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
              scope === "season"
                ? "bg-white/10 text-white shadow-inner"
                : "text-muted-foreground hover:text-white hover:bg-white/5"
            }`}
          >
            Season
          </button>
        </div>

        {/* Season context banner */}
        {scope === "season" && (
          <div className="flex items-center gap-3 flex-wrap bg-secondary/20 border border-white/10 rounded-lg px-4 py-3" data-testid="banner-season-context">
            <CalendarDays className="w-4 h-4 text-blue-400 flex-shrink-0" />
            {seasonsData && seasonsData.seasons.length > 0 ? (
              <>
                <div className="flex-1 min-w-0">
                  {(() => {
                    const selectedSeason = seasonsData.seasons.find((s) => s.id === effectiveSeasonId);
                    if (!selectedSeason) return <span className="text-sm text-muted-foreground">Select a season</span>;
                    const isActive = selectedSeason.status === "active";
                    const now = Date.now();
                    const end = new Date(selectedSeason.endsAt).getTime();
                    const diff = end - now;
                    const days = Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
                    const hours = Math.max(0, Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)));
                    const countdown = diff <= 0 ? "Ended" : days > 0 ? `${days}d ${hours}h left` : `${hours}h left`;
                    return (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-white text-sm" data-testid="text-lb-season-name">{selectedSeason.name}</span>
                        {isActive ? (
                          <Badge className="text-xs bg-green-500/20 text-green-400 border-green-500/30 border">Active</Badge>
                        ) : (
                          <Badge className="text-xs bg-white/5 text-muted-foreground border-white/10 border">Closed</Badge>
                        )}
                        {isActive && (
                          <span className="text-xs text-green-400 font-medium" data-testid="text-lb-season-countdown">{countdown}</span>
                        )}
                      </div>
                    );
                  })()}
                </div>
                <select
                  data-testid="select-season"
                  value={effectiveSeasonId ?? ""}
                  onChange={(e) => {
                    setSeasonId(e.target.value ? parseInt(e.target.value) : null);
                    setPage(1);
                  }}
                  className="bg-secondary/40 border border-white/10 text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary/50 flex-shrink-0"
                >
                  {seasonsData.seasons.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} {s.status === "active" ? "(Active)" : s.status === "closed" ? "(Closed)" : "(Upcoming)"}
                    </option>
                  ))}
                </select>
              </>
            ) : (
              <span className="text-sm text-muted-foreground">No seasons available</span>
            )}
          </div>
        )}
      </div>

      {/* Metric Tabs */}
      <div className="flex gap-2" data-testid="tabs-leaderboard-metric">
        {METRIC_TABS.map((tab) => (
          <button
            key={tab.id}
            data-testid={`tab-metric-${tab.id}`}
            onClick={() => handleMetricChange(tab.id)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-all ${
              metric === tab.id
                ? "bg-primary text-black border-primary shadow-md"
                : "bg-secondary/30 text-muted-foreground border-white/10 hover:bg-secondary/50 hover:text-white"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {noActiveSeason && (
        <Card className="bg-secondary/30 border-white/10">
          <CardContent className="flex flex-col items-center justify-center py-12 gap-3">
            <CalendarDays className="w-8 h-8 text-muted-foreground/50" />
            <p className="text-muted-foreground text-sm">No active season. Check back later!</p>
            <Link href="/arena/seasons">
              <Button variant="outline" size="sm">View Seasons</Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {!noActiveSeason && (
        <Card className="bg-secondary/30 border-white/10">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold text-white flex items-center justify-between">
              <span>
                {metric === "xp" && "Top by XP"}
                {metric === "realizedProfit" && "Top by Realized Profit"}
                {metric === "winRate" && "Top by Win Rate"}
              </span>
              {data && (
                <span className="text-xs text-muted-foreground font-normal" data-testid="text-lb-total">
                  {data.total} traders
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading && (
              <div className="flex items-center justify-center py-16" data-testid="spinner-leaderboards">
                <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
              </div>
            )}

            {isError && (
              <div className="flex flex-col items-center justify-center py-12 gap-3" data-testid="error-leaderboards">
                <AlertCircle className="w-8 h-8 text-red-400" />
                <p className="text-red-400 font-semibold text-sm">Failed to load leaderboard</p>
                <Button size="sm" variant="outline" onClick={() => refetch()} data-testid="button-lb-retry">
                  Retry
                </Button>
              </div>
            )}

            {!isLoading && !isError && data?.items.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground" data-testid="empty-leaderboards">
                <Trophy className="w-8 h-8 opacity-30" />
                <p className="text-sm">
                  {metric === "winRate"
                    ? "No traders with enough games yet (min 20 trades)"
                    : scope === "season"
                    ? "No season stats yet. Start trading!"
                    : "No traders yet. Start trading to appear here!"}
                </p>
              </div>
            )}

            {!isLoading && !isError && data && data.items.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="table-leaderboards">
                  <thead>
                    <tr className="border-b border-white/5 text-xs text-muted-foreground uppercase tracking-wider">
                      <th className="px-4 py-3 text-left w-12">Rank</th>
                      <th className="px-4 py-3 text-left">Trader</th>
                      <th className="px-4 py-3 text-left">Arena Rank</th>
                      <th className="px-4 py-3 text-right">
                        {metric === "xp" && "XP"}
                        {metric === "realizedProfit" && "Profit"}
                        {metric === "winRate" && "Win Rate"}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((item) => {
                      const rankColor = RANK_COLORS[item.rank] ?? "#CD7F32";
                      const isCurrentUser = item.userId === currentUserId;
                      return (
                        <tr
                          key={item.userId}
                          data-testid={`row-lb-${item.userId}`}
                          className={`border-b border-white/5 last:border-0 transition-colors ${
                            isCurrentUser
                              ? "bg-primary/8 border-l-2 border-l-primary"
                              : "hover:bg-white/3"
                          }`}
                          style={isCurrentUser ? { boxShadow: "inset 0 0 0 1px hsl(var(--primary) / 0.15)" } : undefined}
                        >
                          <td className="px-4 py-3 font-mono font-bold text-muted-foreground" data-testid={`text-lb-pos-${item.userId}`}>
                            {positionDisplay(item.rankPosition)}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2.5">
                              <UserAvatar avatarUrl={item.avatarUrl} avatarId={item.avatarId} username={item.username} />
                              <Link href={"/arena/trader/" + encodeURIComponent(item.username)}>
                                <span
                                  className={`font-semibold text-white hover:text-primary transition-colors cursor-pointer ${isCurrentUser ? "text-primary" : "text-white"}`}
                                  data-testid={"link-trader-" + item.userId}
                                >
                                  {item.username}
                                </span>
                              </Link>
                              {isCurrentUser && (
                                <Badge
                                  data-testid={`badge-you-${item.userId}`}
                                  className="text-[10px] px-1.5 py-0 h-4 bg-primary/20 text-primary border border-primary/40 font-bold"
                                >
                                  YOU
                                </Badge>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <Badge
                              data-testid={`badge-lb-rank-${item.userId}`}
                              className="text-xs font-semibold border"
                              style={{
                                color: rankColor,
                                borderColor: `${rankColor}40`,
                                backgroundColor: `${rankColor}18`,
                              }}
                            >
                              {item.rank}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-right">
                            {formatValue(metric, item)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Your Rank block — shown when user is not on current page */}
      {!isLoading && !isError && !isUserOnPage && userRankData && (
        <Card
          className="bg-primary/5 border-primary/20"
          data-testid="card-your-rank"
        >
          <CardContent className="p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-primary/70 mb-2">Your Rank</p>
            <div className="flex items-center gap-4">
              <div className="text-center">
                <p className="text-2xl font-mono font-bold text-white" data-testid="text-your-rank-position">
                  #{userRankData.rankPosition}
                </p>
                <p className="text-xs text-muted-foreground">Position</p>
              </div>
              <div className="w-px h-10 bg-white/10" />
              <div>
                <Link href={"/arena/trader/" + encodeURIComponent(userRankData.username)}>
                  <p className="font-semibold text-white text-sm hover:text-primary transition-colors cursor-pointer" data-testid={"link-trader-" + userRankData.userId}>
                    {userRankData.username}
                  </p>
                </Link>
                <div className="flex items-center gap-2 mt-1">
                  <Badge
                    className="text-[10px] px-1.5 py-0 h-4 border font-medium"
                    style={{
                      color: RANK_COLORS[userRankData.rankName] ?? "#CD7F32",
                      borderColor: `${RANK_COLORS[userRankData.rankName] ?? "#CD7F32"}40`,
                      backgroundColor: `${RANK_COLORS[userRankData.rankName] ?? "#CD7F32"}18`,
                    }}
                  >
                    {userRankData.rankName}
                  </Badge>
                  <span className="text-xs text-muted-foreground font-mono" data-testid="text-your-rank-xp">
                    {userRankData.xp.toLocaleString()} XP
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between" data-testid="pagination-leaderboards">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            data-testid="button-lb-prev"
            className="gap-1"
          >
            <ChevronLeft className="w-4 h-4" />
            Prev
          </Button>
          <span className="text-sm text-muted-foreground" data-testid="text-lb-pagination">
            Page {data.page} of {data.totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
            disabled={page === data.totalPages}
            data-testid="button-lb-next"
            className="gap-1"
          >
            Next
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      )}

      {/* Arena Activity Feed */}
      <Card className="bg-secondary/30 border-white/10">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-white flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            Arena Activity
          </CardTitle>
          <p className="text-xs text-muted-foreground">Recent events from the Arena</p>
        </CardHeader>
        <CardContent className="p-0 pb-2">
          {activityData ? (
            <ActivityFeed items={activityData.items} />
          ) : (
            <div className="flex items-center justify-center py-8" data-testid="spinner-activity">
              <div className="w-6 h-6 border-3 border-primary/30 border-t-primary rounded-full animate-spin" />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, getQueryFn } from "@/lib/queryClient";
import { useState, Component } from "react";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Pencil, X, Check, Trophy, TrendingUp, TrendingDown, Zap, Star,
  AlertCircle, Shield, Crown, Award, Swords, Target, Flame, Gem,
  Rocket, DollarSign, RotateCcw, CalendarDays, Medal,
} from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { formatCurrency } from "@/lib/format";
import {
  spacing, shadow, semanticColors, rankColors, RANK_ORDER, RANK_XP,
} from "@/ui/tokens";
import { AVATARS, getAvatarUrl } from "@/lib/avatars";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ArenaStats {
  userId: string;
  xpTotal: number;
  rank: string;
  realizedProfitTotal: string;
  tradesTotal: number;
  winTrades: number;
  lossTrades: number;
  bestTradePnl: string | null;
  worstTradePnl: string | null;
  winStreakBest: number;
  traderStyle: string | null;
}
interface ArenaProfile {
  userId: string;
  avatarUrl: string | null;
  avatarId: string | null;
  bio: string | null;
}
interface ArenaData {
  profile: ArenaProfile;
  stats: ArenaStats;
  rankThresholds: { rank: string; minXp: number }[];
}
interface ArenaBadge {
  code: string;
  name: string;
  description: string;
  iconKey: string;
  rarity: string;
  awardedAt: string;
}
interface ArenaProfileEnriched {
  profile: ArenaProfile;
  stats: ArenaStats;
  rankThresholds: { rank: string; minXp: number }[];
  globalRank: number | null;
  totalUsers: number;
  portfolioBalance: number;
  badges: ArenaBadge[];
  traderStyle: string | null;
}

// ─── XP helpers ──────────────────────────────────────────────────────────────

function xpForNextRank(xp: number): { nextRank: string | null; nextXp: number; progress: number; currentMinXp: number } {
  const sorted = RANK_ORDER;
  const currentIdx = [...sorted].reverse().findIndex((r) => xp >= RANK_XP[r]);
  const tierIdx = sorted.length - 1 - currentIdx;
  if (tierIdx >= sorted.length - 1) return { nextRank: null, nextXp: RANK_XP.Challenger, progress: 100, currentMinXp: RANK_XP.Challenger };
  const current = sorted[tierIdx];
  const next = sorted[tierIdx + 1];
  const minXp = RANK_XP[current];
  const nextMinXp = RANK_XP[next];
  const progress = Math.min(100, ((xp - minXp) / (nextMinXp - minXp)) * 100);
  return { nextRank: next, nextXp: nextMinXp, progress, currentMinXp: minXp };
}

// ─── Design-system primitives ─────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-center gap-3 mb-5">
        <span className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">{title}</span>
        <div className="flex-1 h-px bg-white/6" />
      </div>
      {children}
    </section>
  );
}

type StatVariant = "primary" | "secondary";

function StatCard({
  variant = "secondary", label, value, valueColor, icon, sub, "data-testid": testId,
}: {
  variant?: StatVariant; label: string; value: React.ReactNode;
  valueColor?: string; icon?: React.ReactNode; sub?: React.ReactNode; "data-testid"?: string;
}) {
  const isPrimary = variant === "primary";
  return (
    <div
      data-testid={testId}
      className={`rounded-2xl border border-white/8 bg-card transition-shadow ${isPrimary ? "p-6" : "p-5"}`}
      style={{ boxShadow: shadow.card }}
    >
      <div className="flex items-center gap-2 mb-3">
        {icon && <span className="opacity-60">{icon}</span>}
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      </div>
      <div
        className={`font-mono font-bold leading-none ${isPrimary ? "text-3xl sm:text-4xl" : "text-xl sm:text-2xl"}`}
        style={valueColor ? { color: valueColor } : undefined}
      >
        {value}
      </div>
      {sub && <div className="mt-2 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Divider() {
  return <hr className="border-white/6" />;
}

function XpProgressBar({ progress, color }: { progress: number; color: string }) {
  return (
    <div className="relative h-3 bg-white/6 rounded-full overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-700"
        style={{ width: `${progress}%`, background: `linear-gradient(90deg, ${color}80, ${color})` }}
      />
    </div>
  );
}

// ─── Trader Style Badge ───────────────────────────────────────────────────────

const STYLE_COLORS: Record<string, string> = {
  "Rookie":            "#9CA3AF",
  "Momentum Hunter":   "#60A5FA",
  "Market Sniper":     "#34D399",
  "Swing Trader":      "#A78BFA",
  "Day Trader":        "#FBBF24",
  "Hot Streak Hunter": "#F97316",
  "Risk Taker":        "#F43F5E",
  "Profit Taker":      "#10B981",
  "Contrarian":        "#8B5CF6",
};

function TraderStyleBadge({ style }: { style: string | null }) {
  if (!style) return null;
  const color = STYLE_COLORS[style] ?? "#9CA3AF";
  return (
    <span
      data-testid="badge-trader-style"
      className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full border"
      style={{ backgroundColor: `${color}18`, color, borderColor: `${color}40` }}
    >
      <Swords className="w-3 h-3" />
      {style}
    </span>
  );
}

// ─── Badge Icon Resolver ──────────────────────────────────────────────────────

const RARITY_COLORS: Record<string, string> = {
  common:    "#9CA3AF",
  rare:      "#60A5FA",
  epic:      "#A78BFA",
  legendary: "#FBBF24",
};

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

function BadgeCard({ badge }: { badge: ArenaBadge }) {
  const color = RARITY_COLORS[badge.rarity] ?? "#9CA3AF";
  const icon = BADGE_ICONS[badge.iconKey] ?? <Award className="w-5 h-5" />;
  return (
    <div
      data-testid={`card-badge-${badge.code}`}
      className="flex flex-col items-center gap-2 p-4 rounded-2xl border border-white/8 bg-card text-center"
      style={{ boxShadow: shadow.card }}
    >
      <div
        className="w-12 h-12 rounded-full flex items-center justify-center"
        style={{ backgroundColor: `${color}20`, color, border: `1.5px solid ${color}40` }}
      >
        {icon}
      </div>
      <div>
        <div className="text-sm font-bold text-white" data-testid={`text-badge-name-${badge.code}`}>
          {badge.name}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">{badge.description}</div>
        <span
          className="inline-block mt-1.5 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
          style={{ backgroundColor: `${color}18`, color }}
        >
          {badge.rarity}
        </span>
      </div>
    </div>
  );
}

// ─── Avatar Selector ──────────────────────────────────────────────────────────

function AvatarSelector({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div>
      <label className="text-xs text-muted-foreground mb-3 block font-semibold uppercase tracking-wider">
        Choose Avatar
      </label>
      <div className="grid grid-cols-5 sm:grid-cols-10 gap-2" data-testid="avatar-selector-grid">
        {AVATARS.map((avatar) => {
          const isSelected = selected === avatar.id;
          return (
            <button
              key={avatar.id}
              type="button"
              data-testid={`button-avatar-${avatar.id}`}
              title={avatar.label}
              onClick={() => onSelect(avatar.id)}
              className="group relative rounded-xl overflow-hidden transition-all focus:outline-none"
              style={{
                border: isSelected ? "2px solid #6366f1" : "2px solid transparent",
                boxShadow: isSelected ? "0 0 12px 2px #6366f160" : undefined,
              }}
            >
              <img
                src={avatar.url}
                alt={avatar.label}
                className="w-full aspect-square object-cover bg-white/5"
              />
              {isSelected && (
                <div className="absolute inset-0 flex items-center justify-center bg-primary/20">
                  <Check className="w-4 h-4 text-white drop-shadow" />
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Rank Ladder (Horizontal) ─────────────────────────────────────────────────

function RankLadderHorizontal({ currentRank, currentXp }: { currentRank: string; currentXp: number }) {
  const [hoveredRank, setHoveredRank] = useState<string | null>(null);
  return (
    <div className="w-full">
      <div className="hidden sm:block">
        <div className="relative flex items-center justify-between px-4">
          <div className="absolute top-4 left-8 right-8 h-px bg-white/10" />
          {RANK_ORDER.map((rank) => {
            const color = rankColors[rank];
            const isCurrentRank = rank === currentRank;
            const isPast = currentXp >= RANK_XP[rank] && !isCurrentRank;
            const isFuture = currentXp < RANK_XP[rank];
            const isHovered = hoveredRank === rank;
            const xpReq = RANK_XP[rank];
            return (
              <div
                key={rank}
                className="relative flex flex-col items-center gap-2 cursor-default z-10"
                onMouseEnter={() => setHoveredRank(rank)}
                onMouseLeave={() => setHoveredRank(null)}
                data-testid={`rank-node-${rank}`}
              >
                {isHovered && (
                  <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 whitespace-nowrap bg-card border border-white/10 rounded-lg px-2.5 py-1.5 text-xs shadow-xl z-20">
                    <span className="font-semibold" style={{ color }}>{rank}</span>
                    <span className="text-muted-foreground ml-1.5">
                      {xpReq === 0 ? "Start" : `${xpReq.toLocaleString()} XP`}
                    </span>
                    {isCurrentRank && <span className="ml-1.5 text-primary font-bold">← You</span>}
                  </div>
                )}
                <div
                  className="relative w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all"
                  style={{
                    borderColor: isFuture ? `${color}30` : color,
                    backgroundColor: isCurrentRank ? color : isPast ? `${color}20` : "transparent",
                    boxShadow: isCurrentRank ? `0 0 14px 3px ${color}50` : undefined,
                  }}
                >
                  {isCurrentRank && <div className="w-2.5 h-2.5 rounded-full bg-black/70" />}
                  {isPast && <Check className="w-3.5 h-3.5" style={{ color }} />}
                </div>
                <span
                  className={`text-xs font-semibold transition-colors ${
                    isCurrentRank ? "font-bold" : isFuture ? "text-muted-foreground/40" : "text-muted-foreground/70"
                  }`}
                  style={isCurrentRank ? { color } : undefined}
                >
                  {rank}
                </span>
              </div>
            );
          })}
        </div>
        <div className="mt-4 text-center text-xs text-muted-foreground">
          <span>Current: </span>
          <span className="font-bold" style={{ color: rankColors[currentRank] }}>{currentRank}</span>
          <span className="mx-2 text-white/20">·</span>
          <span>{currentXp.toLocaleString()} XP earned</span>
        </div>
      </div>
      <div className="sm:hidden space-y-2">
        {[...RANK_ORDER].reverse().map((rank) => {
          const color = rankColors[rank];
          const isCurrentRank = rank === currentRank;
          const isPast = currentXp >= RANK_XP[rank] && !isCurrentRank;
          const isFuture = currentXp < RANK_XP[rank];
          return (
            <div
              key={rank}
              data-testid={`rank-row-${rank}`}
              className={`flex items-center justify-between px-4 py-2.5 rounded-xl border transition-all ${
                isCurrentRank ? "border-white/15 bg-white/5" : "border-transparent"
              }`}
              style={isCurrentRank ? { boxShadow: `0 0 12px 0 ${color}25` } : undefined}
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-3 h-3 rounded-full border flex-shrink-0"
                  style={{
                    borderColor: isFuture ? `${color}30` : color,
                    backgroundColor: isCurrentRank ? color : isPast ? `${color}30` : "transparent",
                  }}
                />
                <span
                  className={`text-sm font-semibold ${isFuture ? "text-muted-foreground/50" : "text-foreground"}`}
                  style={isCurrentRank ? { color } : undefined}
                >
                  {rank}
                  {isCurrentRank && <span className="ml-2 text-xs font-normal opacity-70">← you</span>}
                </span>
              </div>
              <span className="text-xs text-muted-foreground font-mono">
                {RANK_XP[rank] === 0 ? "Start" : `${RANK_XP[rank].toLocaleString()} XP`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Error Boundary ───────────────────────────────────────────────────────────

class ArenaErrorBoundary extends Component<
  { children: React.ReactNode },
  { hasError: boolean; errorMsg: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMsg: "" };
  }
  static getDerivedStateFromError(err: Error) {
    return { hasError: true, errorMsg: err.message };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="max-w-3xl mx-auto">
          <div className="rounded-2xl border border-red-500/30 bg-card p-6 text-center space-y-3">
            <AlertCircle className="w-8 h-8 mx-auto text-red-400" />
            <p className="text-red-400 font-semibold">Arena failed to render</p>
            <p className="text-xs text-muted-foreground font-mono">{this.state.errorMsg}</p>
            <Button size="sm" variant="outline" onClick={() => this.setState({ hasError: false, errorMsg: "" })}>
              Retry
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Arena Sub-Nav ────────────────────────────────────────────────────────────

function ArenaNav() {
  const navLinks = [
    { href: "/arena/profile", label: "My Profile", testId: "tab-arena-profile" },
    { href: "/arena/leaderboards", label: "Leaderboards", testId: "tab-arena-leaderboards" },
    { href: "/arena/achievements", label: "Achievements", testId: "tab-arena-achievements" },
    { href: "/arena/seasons", label: "Seasons", testId: "tab-arena-seasons" },
    { href: "/arena/draft", label: "Weekly Draft", testId: "tab-arena-draft" },
  ];
  const pathname = typeof window !== "undefined" ? window.location.pathname : "";
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

// ─── Main Page ────────────────────────────────────────────────────────────────

function ArenaPageInner() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [editing, setEditing] = useState(false);
  const [draftBio, setDraftBio] = useState("");
  const [draftAvatarId, setDraftAvatarId] = useState("avatar_01");

  const { data, isLoading, isError, error, refetch } = useQuery<ArenaData | null>({
    queryKey: ["/api/arena/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: 0,
    refetchOnMount: true,
  });

  const { data: enriched } = useQuery<ArenaProfileEnriched | null>({
    queryKey: ["/api/arena/profile"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: 30_000,
    refetchOnMount: true,
    enabled: !!data,
  });

  const updateProfile = useMutation({
    mutationFn: (body: { avatarId?: string; bio?: string }) =>
      apiRequest("PATCH", "/api/arena/me", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/arena/me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/arena/profile"] });
      setEditing(false);
      toast({ title: "Profile updated" });
    },
    onError: () => toast({ title: "Failed to update profile", variant: "destructive" }),
  });

  const startEdit = () => {
    setDraftBio(data?.profile.bio ?? "");
    setDraftAvatarId(data?.profile.avatarId ?? "avatar_01");
    setEditing(true);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-10 h-10 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (isError) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return (
      <div className="max-w-3xl mx-auto">
        <div className="rounded-2xl border border-red-500/30 bg-card p-6 text-center space-y-3">
          <AlertCircle className="w-8 h-8 mx-auto text-red-400" />
          <p className="text-red-400 font-semibold">Failed to load Arena profile</p>
          <p className="text-xs text-muted-foreground font-mono">{msg.slice(0, 120)}</p>
          <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
        </div>
      </div>
    );
  }

  if (data === null) { setLocation("/login"); return null; }

  if (!data) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="rounded-2xl border border-white/8 bg-card p-6 text-center text-muted-foreground space-y-3">
          <p>Arena profile not available.</p>
          <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
        </div>
      </div>
    );
  }

  const { profile, stats } = data;
  const xp = stats.xpTotal ?? 0;
  const rank = stats.rank ?? "Bronze";
  const rankColor = rankColors[rank] ?? "#CD7F32";
  const { nextRank, nextXp, progress, currentMinXp } = xpForNextRank(xp);
  const winRate = stats.tradesTotal > 0 ? ((stats.winTrades / stats.tradesTotal) * 100).toFixed(1) : "0.0";
  const realizedProfit = parseFloat(stats.realizedProfitTotal ?? "0");
  const bestPnl = stats.bestTradePnl != null ? parseFloat(stats.bestTradePnl) : null;
  const worstPnl = stats.worstTradePnl != null ? parseFloat(stats.worstTradePnl) : null;
  const displayName = user?.displayName || user?.email?.split("@")[0] || "Trader";
  const xpToNext = nextRank ? nextXp - xp : 0;

  const avatarId = profile.avatarId ?? "avatar_01";
  const avatarUrl = getAvatarUrl(avatarId);

  const globalRank = enriched?.globalRank ?? null;
  const totalUsers = enriched?.totalUsers ?? 0;
  const portfolioBalance = enriched?.portfolioBalance ?? 0;
  const traderStyle = stats.traderStyle ?? enriched?.traderStyle ?? null;
  const badges = enriched?.badges ?? [];

  return (
    <div className="max-w-4xl mx-auto" style={{ display: "flex", flexDirection: "column", gap: `${spacing.section}px` }}>

      {/* ── Nav ── */}
      <ArenaNav />

      {/* ── A: PROFILE CARD ── */}
      <div className="rounded-2xl border border-white/8 bg-card p-6" style={{ boxShadow: shadow.card }}>

        {/* Top row: avatar + identity + edit btn */}
        <div className="flex items-start gap-5">
          {/* Avatar display */}
          <div className="relative flex-shrink-0">
            <img
              src={avatarUrl}
              alt="Arena Avatar"
              data-testid="img-arena-avatar"
              className="w-20 h-20 rounded-full object-cover bg-white/5"
              style={{ border: `2.5px solid ${rankColor}`, boxShadow: `0 0 18px 2px ${rankColor}40` }}
            />
          </div>

          {/* Identity */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <h1 className="text-2xl font-bold text-white" data-testid="text-arena-username">
                {displayName}
              </h1>
              <span
                className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full border"
                style={{ backgroundColor: `${rankColor}20`, color: rankColor, borderColor: `${rankColor}50` }}
                data-testid="badge-arena-rank"
              >
                <Shield className="w-3 h-3" />
                {rank}
              </span>
              <TraderStyleBadge style={traderStyle} />
            </div>

            {/* Bio */}
            {profile.bio && !editing && (
              <p className="text-sm text-muted-foreground mb-3" data-testid="text-arena-bio">
                {profile.bio}
              </p>
            )}

            {/* Meta row: global rank + portfolio */}
            <div className="flex items-center gap-4 flex-wrap mt-2 mb-3">
              {globalRank != null && (
                <span
                  className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"
                  data-testid="text-arena-global-rank"
                >
                  <Trophy className="w-3.5 h-3.5 text-yellow-500" />
                  Global <span className="text-white font-bold">#{globalRank}</span>
                  <span className="text-white/30">of {totalUsers}</span>
                </span>
              )}
              <span
                className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"
                data-testid="text-arena-portfolio-balance"
              >
                <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                Portfolio <span className="text-white font-bold">{formatCurrency(portfolioBalance)}</span>
              </span>
            </div>

            {/* XP Bar */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground font-mono" data-testid="text-arena-xp">
                  {xp.toLocaleString()} XP
                </span>
                {nextRank ? (
                  <span className="text-muted-foreground">
                    <span style={{ color: rankColors[nextRank] }}>{nextRank}</span>
                    {" "}in {xpToNext.toLocaleString()} XP
                  </span>
                ) : (
                  <span style={{ color: rankColors.Challenger }}>Max Rank ✓</span>
                )}
              </div>
              <XpProgressBar progress={progress} color={rankColor} />
            </div>
          </div>

          {/* Edit toggle */}
          <Button
            variant="ghost"
            size="icon"
            onClick={editing ? () => setEditing(false) : startEdit}
            data-testid="button-arena-edit"
            className="text-muted-foreground hover:text-white flex-shrink-0"
          >
            {editing ? <X className="w-4 h-4" /> : <Pencil className="w-4 h-4" />}
          </Button>
        </div>

        {/* ── Edit form ── */}
        {editing && (
          <div className="mt-5 space-y-5 border-t border-white/8 pt-5">
            <AvatarSelector
              selected={draftAvatarId}
              onSelect={(id) => setDraftAvatarId(id)}
            />
            <div>
              <label className="text-xs text-muted-foreground mb-1 block font-semibold uppercase tracking-wider">
                Bio (280 chars)
              </label>
              <Textarea
                value={draftBio}
                onChange={(e) => setDraftBio(e.target.value)}
                maxLength={280}
                placeholder="Tell the arena who you are…"
                data-testid="input-arena-bio"
                className="bg-white/5 border-white/10 resize-none"
                rows={3}
              />
            </div>
            <Button
              onClick={() => updateProfile.mutate({
                avatarId: draftAvatarId,
                bio: draftBio || undefined,
              })}
              disabled={updateProfile.isPending}
              data-testid="button-arena-save"
              size="sm"
              className="gap-2"
            >
              <Check className="w-4 h-4" />
              {updateProfile.isPending ? "Saving…" : "Save Profile"}
            </Button>
          </div>
        )}
      </div>

      {/* ── B: TRADER PERFORMANCE ── */}
      <Section title="Trader Performance">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-5">
          <StatCard
            variant="primary"
            label="Realized P&L"
            icon={<TrendingUp className="w-4 h-4" />}
            value={`${realizedProfit >= 0 ? "+" : ""}${formatCurrency(realizedProfit)}`}
            valueColor={realizedProfit >= 0 ? semanticColors.success : semanticColors.danger}
            data-testid="text-arena-realized-pnl"
          />
          <StatCard
            variant="secondary"
            label="Total Trades"
            icon={<Zap className="w-4 h-4" />}
            value={stats.tradesTotal}
            data-testid="text-arena-trades-total"
          />
          <StatCard
            variant="secondary"
            label="Win Rate"
            icon={<Trophy className="w-4 h-4" />}
            value={`${winRate}%`}
            valueColor={parseFloat(winRate) >= 50 ? semanticColors.success : semanticColors.neutral}
            sub={`${stats.winTrades}W / ${stats.lossTrades}L`}
            data-testid="text-arena-win-rate"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <StatCard
            variant="secondary"
            label="Best Trade"
            icon={<Star className="w-4 h-4 text-yellow-400" />}
            value={bestPnl != null ? `+${formatCurrency(bestPnl)}` : "—"}
            valueColor={bestPnl != null ? semanticColors.success : undefined}
            data-testid="text-arena-best-trade"
          />
          <StatCard
            variant="secondary"
            label="Worst Trade"
            icon={<TrendingDown className="w-4 h-4 text-rose-400" />}
            value={worstPnl != null ? formatCurrency(worstPnl) : "—"}
            valueColor={worstPnl != null ? semanticColors.danger : undefined}
            data-testid="text-arena-worst-trade"
          />
        </div>
      </Section>

      <Divider />

      {/* ── C: TRADER PROGRESSION ── */}
      <Section title="Trader Progression">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-5">
          <StatCard
            variant="primary"
            label="Total XP"
            icon={<Zap className="w-4 h-4 text-yellow-400" />}
            value={xp.toLocaleString()}
            valueColor={semanticColors.xp}
            data-testid="text-arena-xp-total"
          />
          <StatCard
            variant="primary"
            label="Next Rank"
            icon={<Shield className="w-4 h-4" />}
            value={nextRank ?? "Max Rank"}
            valueColor={nextRank ? rankColors[nextRank] : rankColors.Challenger}
            sub={nextRank ? `${xpToNext.toLocaleString()} XP to go` : "You've reached the top"}
          />
        </div>

        <div className="rounded-2xl border border-white/8 bg-card p-5" style={{ boxShadow: shadow.card }}>
          <div className="flex justify-between items-center mb-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Progress to {nextRank ?? "Max Rank"}
            </span>
            {nextRank ? (
              <span className="text-xs font-bold text-white/80" data-testid="text-arena-xp-remaining">
                {xpToNext.toLocaleString()} XP remaining
              </span>
            ) : (
              <span className="text-xs font-bold" style={{ color: rankColors.Challenger }}>Max Rank ✓</span>
            )}
          </div>
          <div className="flex justify-between text-xs text-muted-foreground mb-2 mt-2">
            <span>
              <span className="font-semibold" style={{ color: rankColor }}>{rank}</span>
              <span className="ml-1.5 font-mono opacity-60">{currentMinXp.toLocaleString()} XP</span>
            </span>
            {nextRank ? (
              <span>
                <span className="font-mono opacity-60">{nextXp.toLocaleString()} XP</span>
                <span className="font-semibold ml-1.5" style={{ color: rankColors[nextRank] }}>{nextRank}</span>
              </span>
            ) : (
              <span style={{ color: rankColors.Challenger }}>Challenger</span>
            )}
          </div>
          <XpProgressBar progress={progress} color={rankColor} />
          <div className="mt-2.5 flex items-center justify-between">
            <span className="text-xs text-muted-foreground font-mono" data-testid="progress-arena-xp">
              {(xp - currentMinXp).toLocaleString()} / {nextRank ? (nextXp - currentMinXp).toLocaleString() : "—"} XP in tier
            </span>
            <span className="text-xs text-muted-foreground">
              {progress.toFixed(1)}% complete
            </span>
          </div>
        </div>
      </Section>

      <Divider />

      {/* ── D: RANK LADDER ── */}
      <Section title="Rank Ladder">
        <div className="rounded-2xl border border-white/8 bg-card p-6" style={{ boxShadow: shadow.card }}>
          <RankLadderHorizontal currentRank={rank} currentXp={xp} />
        </div>
      </Section>

      {/* ── E: TRADER BADGES ── */}
      <Divider />
      <Section title="Trader Badges">
        {badges.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4" data-testid="badges-grid">
            {badges.map((badge) => (
              <BadgeCard key={badge.code} badge={badge} />
            ))}
          </div>
        ) : (
          <div
            data-testid="badges-empty-state"
            className="flex flex-col items-center justify-center gap-3 py-10 rounded-2xl border border-white/8 bg-card text-center"
            style={{ boxShadow: shadow.card }}
          >
            <div className="w-14 h-14 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
              <Medal className="w-7 h-7 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white/70" data-testid="text-badges-empty-title">No badges unlocked yet</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
                Keep trading and climbing the Arena to earn badges
              </p>
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}

export default function ArenaPage() {
  return (
    <ArenaErrorBoundary>
      <ArenaPageInner />
    </ArenaErrorBoundary>
  );
}

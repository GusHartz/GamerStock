import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  Search, Plus, X, Lock, Save, ChevronRight, AlertCircle,
  Swords, Trophy, Users, Star, Gem, TrendingUp, Shield,
  Clock, Calendar, CheckCircle,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

type SlotType =
  | "top" | "jungle" | "mid" | "adc" | "support"
  | "breakout_player" | "rising_star" | "hidden_gem";

interface DraftWeek {
  id: string;
  game: string;
  region: string;
  startAt: string;
  lockAt: string;
  endAt: string;
  status: "open" | "locked" | "scoring" | "closed";
  createdAt: string;
}

interface DraftPick {
  id: string;
  draftEntryId: string;
  slotType: string;
  roleCode: string | null;
  playerId: string;
  score: string;
  createdAt: string;
}

interface DraftEntry {
  id: string;
  weekId: string;
  userId: string;
  status: string;
  totalScore: string;
  roleScore: string;
  performanceScore: string;
  lockedAt: string | null;
  createdAt: string;
  picks: DraftPick[];
}

interface DraftPlayer {
  id: string;
  displayName: string;
  role: string | null;
  team: string | null;
  region: string;
  marketPrice: number | null;
  fairValue: number | null;
  tier: string;
  rank: string;
  leaguePoints: number;
  winrate: number;
  isEligible: boolean;
}

interface DraftWeekResponse {
  week: DraftWeek | null;
}

interface DraftEntryResponse {
  weekId: string | null;
  entry: DraftEntry | null;
}

interface DraftPlayersResponse {
  players: DraftPlayer[];
  total: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const ROLE_SLOTS: SlotType[] = ["top", "jungle", "mid", "adc", "support"];
const PERF_SLOTS: SlotType[] = ["breakout_player", "rising_star", "hidden_gem"];
const ALL_SLOTS: SlotType[] = [...ROLE_SLOTS, ...PERF_SLOTS];

interface SlotDef {
  label: string;
  description: string;
  roleFilter: string | null;
  icon: React.ReactNode;
  color: string;
}

const SLOT_DEFS: Record<SlotType, SlotDef> = {
  top: { label: "TOP", description: "Select a top laner", roleFilter: "top", icon: <Shield className="w-3.5 h-3.5" />, color: "text-blue-400 border-blue-500/30 bg-blue-500/10" },
  jungle: { label: "JUNGLE", description: "Select a jungler", roleFilter: "jungle", icon: <Swords className="w-3.5 h-3.5" />, color: "text-green-400 border-green-500/30 bg-green-500/10" },
  mid: { label: "MID", description: "Select a mid laner", roleFilter: "mid", icon: <Star className="w-3.5 h-3.5" />, color: "text-purple-400 border-purple-500/30 bg-purple-500/10" },
  adc: { label: "ADC", description: "Select a bot laner", roleFilter: "adc", icon: <TrendingUp className="w-3.5 h-3.5" />, color: "text-orange-400 border-orange-500/30 bg-orange-500/10" },
  support: { label: "SUPPORT", description: "Select a support", roleFilter: "support", icon: <Users className="w-3.5 h-3.5" />, color: "text-cyan-400 border-cyan-500/30 bg-cyan-500/10" },
  breakout_player: { label: "BREAKOUT", description: "Unexpected outperformer", roleFilter: null, icon: <TrendingUp className="w-3.5 h-3.5" />, color: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10" },
  rising_star: { label: "RISING STAR", description: "Player on the rise", roleFilter: null, icon: <Star className="w-3.5 h-3.5" />, color: "text-amber-400 border-amber-500/30 bg-amber-500/10" },
  hidden_gem: { label: "HIDDEN GEM", description: "Undervalued pick", roleFilter: null, icon: <Gem className="w-3.5 h-3.5" />, color: "text-violet-400 border-violet-500/30 bg-violet-500/10" },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtPrice(p: number | null): string {
  if (p == null) return "—";
  return `$${p.toFixed(2)}`;
}

function fmtWinrate(w: number): string {
  return `${(w * 100).toFixed(1)}%`;
}

function getInitials(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

function TierBadge({ tier }: { tier: string }) {
  const color =
    tier === "CHALLENGER" ? "bg-yellow-500/20 text-yellow-300 border-yellow-500/40" :
    tier === "GRANDMASTER" ? "bg-red-500/20 text-red-300 border-red-500/40" :
    tier === "MASTER" ? "bg-purple-500/20 text-purple-300 border-purple-500/40" :
    tier === "DIAMOND" ? "bg-blue-500/20 text-blue-300 border-blue-500/40" :
    tier === "EMERALD" ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40" :
    tier === "PLATINUM" ? "bg-teal-500/20 text-teal-300 border-teal-500/40" :
    tier === "GOLD" ? "bg-amber-500/20 text-amber-300 border-amber-500/40" :
    "bg-zinc-500/20 text-zinc-400 border-zinc-500/35";
  return (
    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${color} uppercase tracking-wider`}>
      {tier.slice(0, 4)}
    </span>
  );
}

// ─── Countdown hook ───────────────────────────────────────────────────────────

function useCountdown(lockAt: string | null): string {
  const [remaining, setRemaining] = useState<string>("");
  useEffect(() => {
    if (!lockAt) return;
    const update = () => {
      const diff = new Date(lockAt).getTime() - Date.now();
      if (diff <= 0) { setRemaining("LOCKED"); return; }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      if (d > 0) setRemaining(`${d}d ${h}h ${m}m`);
      else if (h > 0) setRemaining(`${h}h ${m}m ${s}s`);
      else setRemaining(`${m}m ${s}s`);
    };
    update();
    const int = setInterval(update, 1000);
    return () => clearInterval(int);
  }, [lockAt]);
  return remaining;
}

// ─── ArenaTabNav ──────────────────────────────────────────────────────────────

function ArenaTabNav() {
  return (
    <div className="flex gap-1 p-1 bg-secondary/30 border border-white/10 rounded-lg w-fit flex-wrap">
      <Link href="/arena/profile">
        <button data-testid="tab-arena-profile" className="px-4 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-white hover:bg-white/5 transition-all">
          My Profile
        </button>
      </Link>
      <Link href="/arena/leaderboards">
        <button data-testid="tab-arena-leaderboards" className="px-4 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-white hover:bg-white/5 transition-all">
          Leaderboards
        </button>
      </Link>
      <Link href="/arena/achievements">
        <button data-testid="tab-arena-achievements" className="px-4 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-white hover:bg-white/5 transition-all">
          Achievements
        </button>
      </Link>
      <Link href="/arena/seasons">
        <button data-testid="tab-arena-seasons" className="px-4 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-white hover:bg-white/5 transition-all">
          Seasons
        </button>
      </Link>
      <button data-testid="tab-arena-draft" className="px-4 py-1.5 rounded-md text-sm font-semibold bg-white/10 text-white shadow-inner transition-all">
        Weekly Draft
      </button>
    </div>
  );
}

// ─── DraftHeader ──────────────────────────────────────────────────────────────

function DraftHeader({ week }: { week: DraftWeek }) {
  const countdown = useCountdown(week.status === "open" ? week.lockAt : null);

  const statusStyles: Record<string, string> = {
    open: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
    locked: "bg-amber-500/20 text-amber-300 border-amber-500/40",
    scoring: "bg-blue-500/20 text-blue-300 border-blue-500/40",
    closed: "bg-zinc-500/20 text-zinc-400 border-zinc-500/35",
  };

  return (
    <div
      className="rounded-xl border border-white/8 p-5"
      style={{ background: "linear-gradient(135deg, rgba(16,185,129,0.06) 0%, rgba(13,17,23,0.95) 60%)" }}
      data-testid="draft-week-header"
    >
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full border uppercase tracking-widest ${statusStyles[week.status] ?? statusStyles.closed}`} data-testid="draft-status-badge">
              {week.status}
            </span>
            <span className="text-xs text-muted-foreground font-mono uppercase tracking-wider">
              {week.game} · {week.region}
            </span>
          </div>
          <h2 className="text-white font-bold text-lg leading-tight" data-testid="draft-week-label">
            Weekly Performance Draft
          </h2>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5">
            {[
              { label: "Starts", value: fmtDate(week.startAt), icon: <Calendar className="w-3 h-3" /> },
              { label: "Locks", value: fmtDate(week.lockAt), icon: <Lock className="w-3 h-3" /> },
              { label: "Ends", value: fmtDate(week.endAt), icon: <Clock className="w-3 h-3" /> },
            ].map(({ label, value, icon }) => (
              <div key={label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="opacity-60">{icon}</span>
                <span className="text-zinc-500">{label}:</span>
                <span className="text-zinc-300 font-mono">{value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex-shrink-0">
          {week.status === "open" && countdown ? (
            <div className="text-right" data-testid="draft-countdown">
              <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Locks in</div>
              <div className="text-xl font-mono font-bold text-emerald-400">{countdown}</div>
            </div>
          ) : week.status === "locked" ? (
            <div className="flex items-center gap-2 text-amber-400 font-semibold text-sm" data-testid="draft-locked-indicator">
              <Lock className="w-4 h-4" />
              Draft Locked
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ─── DraftSlotCard ────────────────────────────────────────────────────────────

function PlayerInitialsAvatar({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  const dim = size === "sm" ? "w-8 h-8 text-xs" : "w-10 h-10 text-sm";
  return (
    <div className={`${dim} rounded-full bg-white/8 border border-white/12 flex items-center justify-center font-bold text-zinc-300 flex-shrink-0`}>
      {getInitials(name)}
    </div>
  );
}

interface DraftSlotCardProps {
  slot: SlotType;
  player: DraftPlayer | null;
  isLocked: boolean;
  onSelect: (slot: SlotType) => void;
  onRemove: (slot: SlotType) => void;
}

function DraftSlotCard({ slot, player, isLocked, onSelect, onRemove }: DraftSlotCardProps) {
  const def = SLOT_DEFS[slot];

  if (!player) {
    return (
      <div
        className="group rounded-xl border border-dashed border-white/12 bg-white/2 p-4 flex flex-col gap-3 hover:border-white/20 hover:bg-white/4 transition-all cursor-pointer"
        onClick={() => !isLocked && onSelect(slot)}
        data-testid={`draft-slot-empty-${slot}`}
      >
        <div className="flex items-center gap-2">
          <span className={`flex items-center gap-1.5 text-[11px] font-bold px-2 py-0.5 rounded border ${def.color}`}>
            {def.icon}
            {def.label}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{def.description}</p>
        {!isLocked && (
          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs h-7 border-white/10 hover:border-white/25 hover:bg-white/5"
            onClick={(e) => { e.stopPropagation(); onSelect(slot); }}
            data-testid={`button-select-player-${slot}`}
          >
            <Plus className="w-3 h-3 mr-1" />
            Select Player
          </Button>
        )}
      </div>
    );
  }

  return (
    <div
      className="rounded-xl border border-white/10 bg-white/4 p-4 flex flex-col gap-3 hover:border-white/16 transition-all"
      style={{ boxShadow: "0 2px 12px rgba(0,0,0,0.3)" }}
      data-testid={`draft-slot-filled-${slot}`}
    >
      <div className="flex items-center justify-between">
        <span className={`flex items-center gap-1.5 text-[11px] font-bold px-2 py-0.5 rounded border ${def.color}`}>
          {def.icon}
          {def.label}
        </span>
        {!isLocked && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs text-muted-foreground hover:text-white"
              onClick={() => onSelect(slot)}
              data-testid={`button-change-player-${slot}`}
            >
              Change
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-muted-foreground hover:text-red-400"
              onClick={() => onRemove(slot)}
              data-testid={`button-remove-player-${slot}`}
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}
        {isLocked && <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />}
      </div>

      <div className="flex items-center gap-3">
        <PlayerInitialsAvatar name={player.displayName} />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-white text-sm leading-tight truncate" data-testid={`text-player-name-${slot}`}>
            {player.displayName}
          </div>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <TierBadge tier={player.tier} />
            <span className="text-[9px] font-mono text-zinc-400">{player.region}</span>
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          {player.marketPrice != null && (
            <div className="text-xs font-mono font-semibold text-emerald-400" data-testid={`text-market-price-${slot}`}>
              {fmtPrice(player.marketPrice)}
            </div>
          )}
          <div className="text-[10px] text-zinc-500 mt-0.5">
            {fmtWinrate(player.winrate)} WR
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1 border-t border-white/6 text-[10px] text-zinc-500">
        <span>{player.leaguePoints} LP</span>
        <span>·</span>
        <span>{player.rank}</span>
      </div>
    </div>
  );
}

// ─── DraftSlotsBoard ──────────────────────────────────────────────────────────

interface DraftSlotsBoardProps {
  picks: Map<string, DraftPlayer>;
  isLocked: boolean;
  onSelectSlot: (slot: SlotType) => void;
  onRemovePlayer: (slot: SlotType) => void;
}

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">{label}</span>
      <div className="flex-1 h-px bg-white/6" />
    </div>
  );
}

function DraftSlotsBoard({ picks, isLocked, onSelectSlot, onRemovePlayer }: DraftSlotsBoardProps) {
  return (
    <div className="space-y-8" data-testid="draft-slots-board">
      <div>
        <SectionLabel label="Role Picks" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {ROLE_SLOTS.map((slot) => (
            <DraftSlotCard
              key={slot}
              slot={slot}
              player={picks.get(slot) ?? null}
              isLocked={isLocked}
              onSelect={onSelectSlot}
              onRemove={onRemovePlayer}
            />
          ))}
        </div>
      </div>

      <div>
        <SectionLabel label="Performance Picks" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {PERF_SLOTS.map((slot) => (
            <DraftSlotCard
              key={slot}
              slot={slot}
              player={picks.get(slot) ?? null}
              isLocked={isLocked}
              onSelect={onSelectSlot}
              onRemove={onRemovePlayer}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── DraftPlayerPickerCard ────────────────────────────────────────────────────

interface DraftPlayerPickerCardProps {
  player: DraftPlayer;
  isSelected: boolean;
  onSelect: (player: DraftPlayer) => void;
}

function DraftPlayerPickerCard({ player, isSelected, onSelect }: DraftPlayerPickerCardProps) {
  return (
    <button
      className={`w-full text-left rounded-lg border p-3 transition-all flex items-center gap-3 group ${
        isSelected
          ? "border-emerald-500/50 bg-emerald-500/10"
          : "border-white/8 bg-white/3 hover:border-white/16 hover:bg-white/6"
      }`}
      onClick={() => onSelect(player)}
      data-testid={`player-picker-card-${player.id}`}
    >
      <PlayerInitialsAvatar name={player.displayName} size="sm" />
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm text-white truncate leading-tight">{player.displayName}</div>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          <TierBadge tier={player.tier} />
          <span className="text-[10px] text-zinc-400 font-mono">{player.region}</span>
          <span className="text-[10px] text-zinc-500">· {fmtWinrate(player.winrate)} WR</span>
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        {player.marketPrice != null ? (
          <div className="text-xs font-mono font-semibold text-emerald-400">{fmtPrice(player.marketPrice)}</div>
        ) : (
          <div className="text-xs text-zinc-600">—</div>
        )}
        <div className="text-[10px] text-zinc-500 mt-0.5">{player.leaguePoints} LP</div>
      </div>
      {isSelected && <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />}
    </button>
  );
}

// ─── DraftPlayerPicker ────────────────────────────────────────────────────────

interface DraftPlayerPickerProps {
  open: boolean;
  slotType: SlotType | null;
  players: DraftPlayer[];
  currentPicks: Map<string, DraftPlayer>;
  onSelect: (slot: SlotType, player: DraftPlayer) => void;
  onClose: () => void;
}

function DraftPlayerPicker({ open, slotType, players, currentPicks, onSelect, onClose }: DraftPlayerPickerProps) {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");

  useEffect(() => {
    if (open && slotType) {
      const def = SLOT_DEFS[slotType];
      setRoleFilter(def.roleFilter ?? "all");
      setSearch("");
    }
  }, [open, slotType]);

  const filtered = useMemo(() => {
    let list = players;
    if (roleFilter !== "all") {
      const byRole = list.filter((p) => p.role?.toLowerCase() === roleFilter);
      if (byRole.length > 0) list = byRole;
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((p) => p.displayName.toLowerCase().includes(q));
    }
    return list;
  }, [players, roleFilter, search]);

  const def = slotType ? SLOT_DEFS[slotType] : null;
  const selectedPlayerId = slotType ? currentPicks.get(slotType)?.id ?? null : null;

  const roleOptions = [
    { value: "all", label: "All" },
    { value: "top", label: "Top" },
    { value: "jungle", label: "Jungle" },
    { value: "mid", label: "Mid" },
    { value: "adc", label: "ADC" },
    { value: "support", label: "Support" },
  ];

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:w-[480px] bg-[#0D1117] border-l border-white/10 flex flex-col p-0"
        data-testid="draft-player-picker"
      >
        <SheetHeader className="px-5 pt-5 pb-4 border-b border-white/8 flex-shrink-0">
          <div className="flex items-center gap-3">
            {def && (
              <span className={`flex items-center gap-1.5 text-[11px] font-bold px-2 py-0.5 rounded border ${def.color}`}>
                {def.icon}
                {def.label}
              </span>
            )}
            <SheetTitle className="text-white text-base font-semibold">Select Player</SheetTitle>
          </div>
        </SheetHeader>

        <div className="px-4 py-3 border-b border-white/6 flex-shrink-0 space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              className="pl-9 h-8 text-sm bg-white/4 border-white/10 focus:border-white/25"
              placeholder="Search players…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="input-player-search"
            />
          </div>

          <div className="flex gap-1 flex-wrap">
            {roleOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setRoleFilter(opt.value)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${
                  roleFilter === opt.value
                    ? "bg-white/12 text-white"
                    : "text-muted-foreground hover:text-white hover:bg-white/6"
                }`}
                data-testid={`filter-role-${opt.value}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2" data-testid="draft-player-list">
          <div className="text-[10px] text-zinc-500 mb-2 font-mono">{filtered.length} players</div>
          {filtered.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              No players found
            </div>
          ) : (
            filtered.map((player) => (
              <DraftPlayerPickerCard
                key={player.id}
                player={player}
                isSelected={player.id === selectedPlayerId}
                onSelect={(p) => {
                  if (slotType) onSelect(slotType, p);
                  onClose();
                }}
              />
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── DraftActionBar ───────────────────────────────────────────────────────────

interface DraftActionBarProps {
  filledCount: number;
  isLocked: boolean;
  weekStatus: string;
  isSaving: boolean;
  isLocking: boolean;
  hasPicks: boolean;
  onSave: () => void;
  onLockClick: () => void;
}

function DraftActionBar({
  filledCount, isLocked, weekStatus, isSaving, isLocking, hasPicks, onSave, onLockClick,
}: DraftActionBarProps) {
  const canEdit = !isLocked && weekStatus === "open";
  const progressPct = (filledCount / 8) * 100;

  return (
    <div
      className="rounded-xl border border-white/8 bg-white/3 p-4 mt-2"
      data-testid="draft-action-bar"
    >
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex-1">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-muted-foreground">Draft completion</span>
            <span className="text-xs font-mono font-bold text-white" data-testid="text-draft-progress">
              {filledCount} / 8 slots filled
            </span>
          </div>
          <div className="h-1.5 bg-white/8 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${progressPct}%`,
                background: filledCount === 8
                  ? "linear-gradient(90deg, #10b981, #34d399)"
                  : "linear-gradient(90deg, #3b82f6, #6366f1)",
              }}
              data-testid="bar-draft-progress"
            />
          </div>
        </div>

        {canEdit && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-3 text-xs border-white/12 hover:border-white/25"
              onClick={onSave}
              disabled={isSaving || !hasPicks}
              data-testid="button-save-draft"
            >
              {isSaving ? (
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  Saving…
                </span>
              ) : (
                <span className="flex items-center gap-1.5">
                  <Save className="w-3 h-3" />
                  Save Draft
                </span>
              )}
            </Button>

            <Button
              size="sm"
              className="h-8 px-3 text-xs"
              style={{ background: filledCount === 8 ? "linear-gradient(135deg,#10b981,#059669)" : undefined }}
              onClick={onLockClick}
              disabled={isLocking || filledCount < 8}
              data-testid="button-lock-draft"
            >
              {isLocking ? (
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  Locking…
                </span>
              ) : (
                <span className="flex items-center gap-1.5">
                  <Lock className="w-3 h-3" />
                  Lock Draft
                </span>
              )}
            </Button>
          </div>
        )}

        {isLocked && (
          <div className="flex items-center gap-2 text-emerald-400 text-sm font-semibold flex-shrink-0" data-testid="text-draft-locked-state">
            <CheckCircle className="w-4 h-4" />
            Draft Submitted
          </div>
        )}
      </div>
    </div>
  );
}

// ─── LockConfirmModal ─────────────────────────────────────────────────────────

function LockConfirmModal({
  open, isLocking, onConfirm, onCancel,
}: { open: boolean; isLocking: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="bg-[#0D1117] border border-white/12 sm:max-w-md" data-testid="dialog-lock-confirm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <Lock className="w-4 h-4 text-amber-400" />
            Lock Your Draft?
          </DialogTitle>
          <DialogDescription className="text-zinc-400 text-sm mt-2">
            Locking your draft will make it <strong className="text-white">immutable</strong>. You will no longer be able to change your picks. Make sure all 8 slots are exactly what you want.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 mt-4">
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={isLocking}
            className="border-white/12"
            data-testid="button-lock-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            disabled={isLocking}
            className="bg-amber-500 hover:bg-amber-600 text-black font-bold"
            data-testid="button-lock-confirm"
          >
            {isLocking ? "Locking…" : "Confirm Lock"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── DraftPageInner ───────────────────────────────────────────────────────────

function DraftPageInner() {
  const { toast } = useToast();
  const [localPicks, setLocalPicks] = useState<Map<string, DraftPlayer>>(new Map());
  const [picksInitialized, setPicksInitialized] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<SlotType | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [showLockConfirm, setShowLockConfirm] = useState(false);

  // ── Queries ──
  const {
    data: weekData,
    isLoading: weekLoading,
    isError: weekError,
  } = useQuery<DraftWeekResponse | null>({
    queryKey: ["/api/draft/weeks/current"],
    queryFn: async () => {
      const res = await fetch("/api/draft/weeks/current", { credentials: "include" });
      if (res.status === 404) return { week: null };
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    staleTime: 0,
    refetchOnMount: true,
  });

  const {
    data: entryData,
    isLoading: entryLoading,
  } = useQuery<DraftEntryResponse | null>({
    queryKey: ["/api/draft/entry"],
    queryFn: async () => {
      const res = await fetch("/api/draft/entry", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 0,
    refetchOnMount: true,
  });

  const { data: playersData, isLoading: playersLoading } = useQuery<DraftPlayersResponse>({
    queryKey: ["/api/draft/players"],
    queryFn: async () => {
      const res = await fetch("/api/draft/players?limit=300", { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const week = weekData?.week ?? null;
  const entry = entryData?.entry ?? null;
  const players = playersData?.players ?? [];

  // ── Initialize local picks from server state (once) ──
  useEffect(() => {
    if (picksInitialized) return;
    if (entryData === undefined || playersData === undefined) return;
    if (players.length === 0 && !entry?.picks?.length) {
      setPicksInitialized(true);
      return;
    }
    const m = new Map<string, DraftPlayer>();
    if (entry?.picks) {
      for (const pick of entry.picks) {
        const player = players.find((p) => p.id === pick.playerId);
        if (player) m.set(pick.slotType, player);
      }
    }
    setLocalPicks(m);
    setPicksInitialized(true);
  }, [entryData, playersData, entry, players, picksInitialized]);

  const isLocked =
    entry?.status === "locked" || (week != null && week.status !== "open");

  const filledCount = localPicks.size;
  const hasPicks = filledCount > 0;

  // ── Ensure entry exists mutation (called before save/lock) ──
  const ensureEntryMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/draft/entry");
      return res.json();
    },
  });

  // ── Save mutation ──
  const saveMutation = useMutation({
    mutationFn: async () => {
      const picks = Array.from(localPicks.entries()).map(([slotType, player]) => ({
        slotType,
        playerId: player.id,
      }));
      if (picks.length === 0) return;
      if (!entry) await ensureEntryMutation.mutateAsync();
      const res = await apiRequest("PATCH", "/api/draft/entry", { picks });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/draft/entry"] });
      toast({ title: "Draft saved", description: "Your picks have been saved." });
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  // ── Lock mutation ──
  const lockMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/draft/lock");
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(body.message ?? "Lock failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/draft/entry"] });
      setShowLockConfirm(false);
      toast({ title: "Draft locked!", description: "Your draft has been submitted." });
    },
    onError: (err: Error) => {
      setShowLockConfirm(false);
      toast({ title: "Lock failed", description: err.message, variant: "destructive" });
    },
  });

  // ── Handlers ──
  const handleSelectSlot = (slot: SlotType) => {
    setSelectedSlot(slot);
    setPickerOpen(true);
  };

  const handlePickPlayer = (slot: SlotType, player: DraftPlayer) => {
    setLocalPicks((prev) => {
      const next = new Map(prev);
      next.set(slot, player);
      return next;
    });
    setPickerOpen(false);
  };

  const handleRemovePlayer = (slot: SlotType) => {
    setLocalPicks((prev) => {
      const next = new Map(prev);
      next.delete(slot);
      return next;
    });
  };

  const handleSave = () => {
    saveMutation.mutate();
  };

  const handleLockClick = () => {
    if (filledCount < 8) {
      toast({ title: "Incomplete draft", description: "Fill all 8 slots before locking.", variant: "destructive" });
      return;
    }
    setShowLockConfirm(true);
  };

  const handleLockConfirm = async () => {
    try {
      if (hasPicks) {
        const picks = Array.from(localPicks.entries()).map(([slotType, player]) => ({
          slotType, playerId: player.id,
        }));
        if (!entry) await apiRequest("POST", "/api/draft/entry");
        await apiRequest("PATCH", "/api/draft/entry", { picks });
        queryClient.invalidateQueries({ queryKey: ["/api/draft/entry"] });
      }
    } catch {
      /* non-fatal pre-lock save failure */
    }
    lockMutation.mutate();
  };

  // ── Loading ──
  const isLoading = weekLoading || entryLoading;

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        <ArenaTabNav />
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-28 w-full rounded-xl" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  // ── No active week ──
  if (!week || weekError) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        <ArenaTabNav />
        <div>
          <h1 className="text-2xl font-bold text-white">Weekly Draft</h1>
          <p className="text-muted-foreground text-sm mt-1">Pick your 8 players, compete on performance</p>
        </div>
        <div className="rounded-xl border border-white/8 bg-white/3 p-12 flex flex-col items-center gap-4 text-center" data-testid="draft-no-week">
          <AlertCircle className="w-10 h-10 text-zinc-500" />
          <div>
            <p className="text-white font-semibold">No active draft week</p>
            <p className="text-sm text-muted-foreground mt-1">Check back later for the next draft week</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6" data-testid="draft-page">
      <ArenaTabNav />

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Trophy className="w-6 h-6 text-amber-400" />
            Weekly Draft
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Pick your 8 players — compete on real performance metrics
          </p>
        </div>
      </div>

      <DraftHeader week={week} />

      {week.status !== "open" && week.status !== "locked" && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-500/20 bg-amber-500/8 px-4 py-3 text-sm text-amber-300" data-testid="draft-week-status-notice">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>
            This week is <strong>{week.status}</strong>. Editing is disabled.
          </span>
        </div>
      )}

      <div className="space-y-4">
        {!picksInitialized || playersLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-32 rounded-xl" />
            ))}
          </div>
        ) : (
          <DraftSlotsBoard
            picks={localPicks}
            isLocked={isLocked}
            onSelectSlot={handleSelectSlot}
            onRemovePlayer={handleRemovePlayer}
          />
        )}

        <DraftActionBar
          filledCount={filledCount}
          isLocked={isLocked}
          weekStatus={week.status}
          isSaving={saveMutation.isPending}
          isLocking={lockMutation.isPending}
          hasPicks={hasPicks}
          onSave={handleSave}
          onLockClick={handleLockClick}
        />
      </div>

      <DraftPlayerPicker
        open={pickerOpen}
        slotType={selectedSlot}
        players={players}
        currentPicks={localPicks}
        onSelect={handlePickPlayer}
        onClose={() => setPickerOpen(false)}
      />

      <LockConfirmModal
        open={showLockConfirm}
        isLocking={lockMutation.isPending}
        onConfirm={handleLockConfirm}
        onCancel={() => setShowLockConfirm(false)}
      />
    </div>
  );
}

// ─── Export ───────────────────────────────────────────────────────────────────

export default function ArenaDraftPage() {
  return <DraftPageInner />;
}

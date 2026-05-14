export const RANK_THRESHOLDS: { rank: string; minXp: number }[] = [
  { rank: "Challenger", minXp: 20000 },
  { rank: "Master",     minXp: 14000 },
  { rank: "Diamond",    minXp: 9000  },
  { rank: "Platinum",   minXp: 5000  },
  { rank: "Gold",       minXp: 2500  },
  { rank: "Silver",     minXp: 1000  },
  { rank: "Bronze",     minXp: 0     },
];

export function computeRank(xp: number): string {
  for (const t of RANK_THRESHOLDS) {
    if (xp >= t.minXp) return t.rank;
  }
  return "Bronze";
}

export const RANK_COLORS: Record<string, string> = {
  Bronze:     "#CD7F32",
  Silver:     "#9CA3AF",
  Gold:       "#F59E0B",
  Platinum:   "#06B6D4",
  Diamond:    "#818CF8",
  Master:     "#C084FC",
  Challenger: "#FBBF24",
};

export const XP_PER_TRADE = 10;
export const XP_PER_PROFITABLE_SELL = 30;

// ─── Avatar Catalog ───────────────────────────────────────────────────────────

export const AVATAR_CATALOG: { id: string; label: string }[] = [
  { id: "avatar_01", label: "Dragon" },
  { id: "avatar_02", label: "Wolf" },
  { id: "avatar_03", label: "Phoenix" },
  { id: "avatar_04", label: "Viper" },
  { id: "avatar_05", label: "Titan" },
  { id: "avatar_06", label: "Shadow" },
  { id: "avatar_07", label: "Frost" },
  { id: "avatar_08", label: "Blaze" },
  { id: "avatar_09", label: "Storm" },
  { id: "avatar_10", label: "Cipher" },
  { id: "avatar_11", label: "Nova" },
  { id: "avatar_12", label: "Rift" },
  { id: "avatar_13", label: "Eclipse" },
  { id: "avatar_14", label: "Nexus" },
  { id: "avatar_15", label: "Void" },
  { id: "avatar_16", label: "Apex" },
  { id: "avatar_17", label: "Ghost" },
  { id: "avatar_18", label: "Surge" },
  { id: "avatar_19", label: "Cobalt" },
  { id: "avatar_20", label: "Aurora" },
];

export const AVATAR_IDS = AVATAR_CATALOG.map((a) => a.id);

export const DEFAULT_AVATAR_ID = "avatar_01";

export function getAvatarUrl(avatarId: string | null | undefined): string {
  const id = avatarId && AVATAR_IDS.includes(avatarId) ? avatarId : DEFAULT_AVATAR_ID;
  return `https://api.dicebear.com/9.x/bottts/svg?seed=${id}&backgroundColor=1e293b,0f172a&backgroundType=solid`;
}

// ─── Trader Style Engine ──────────────────────────────────────────────────────

export interface TraderStyleStats {
  tradesTotal: number;
  winTrades: number;
  lossTrades: number;
  realizedProfitTotal: string;
  winStreakBest: number;
  bestTradePnl: string | null;
  worstTradePnl?: string | null;
}

export const TRADER_STYLES = [
  "Rookie",
  "Momentum Hunter",
  "Market Sniper",
  "Swing Trader",
  "Day Trader",
  "Hot Streak Hunter",
  "Risk Taker",
  "Profit Taker",
  "Contrarian",
] as const;

export type TraderStyle = (typeof TRADER_STYLES)[number];

export function computeTraderStyle(stats: TraderStyleStats): TraderStyle {
  const total = stats.tradesTotal ?? 0;
  if (total < 5) return "Rookie";

  const winRate = total > 0 ? stats.winTrades / total : 0;
  const profit = parseFloat(stats.realizedProfitTotal ?? "0");
  const avgProfitPerTrade = total > 0 ? profit / total : 0;
  const bestTrade = stats.bestTradePnl != null ? parseFloat(stats.bestTradePnl) : 0;

  if (stats.winStreakBest >= 5) return "Hot Streak Hunter";
  if (winRate >= 0.70) return "Market Sniper";
  if (bestTrade > 500) return "Risk Taker";
  if (avgProfitPerTrade > 50 && total >= 20) return "Profit Taker";
  if (stats.lossTrades > stats.winTrades && profit > 0) return "Contrarian";
  if (total >= 200) return "Day Trader";
  if (total >= 50) return "Swing Trader";
  return "Momentum Hunter";
}

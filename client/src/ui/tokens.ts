export const spacing = {
  section: 48,
  cardGap: 20,
  cardPadding: 22,
} as const;

export const radius = {
  card: "16px",
} as const;

export const shadow = {
  card: "0 1px 4px 0 rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.05)",
  cardHover: "0 4px 16px 0 rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08)",
} as const;

export const semanticColors = {
  success: "#34d399",
  danger:  "#f87171",
  neutral: "#9ca3af",
  xp:      "#FBBF24",
} as const;

export const rankColors: Record<string, string> = {
  Bronze:     "#CD7F32",
  Silver:     "#9CA3AF",
  Gold:       "#F59E0B",
  Platinum:   "#06B6D4",
  Diamond:    "#818CF8",
  Master:     "#C084FC",
  Challenger: "#FBBF24",
};

export const RANK_ORDER = ["Bronze", "Silver", "Gold", "Platinum", "Diamond", "Master", "Challenger"] as const;
export const RANK_XP: Record<string, number> = {
  Bronze: 0, Silver: 1000, Gold: 2500, Platinum: 5000,
  Diamond: 9000, Master: 14000, Challenger: 20000,
};

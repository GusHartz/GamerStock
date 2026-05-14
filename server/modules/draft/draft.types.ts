export type {
  DraftWeek,
  InsertDraftWeek,
  DraftEntry,
  InsertDraftEntry,
  DraftEntryPick,
  InsertDraftEntryPick,
  DraftPlayerWeekMetrics,
  InsertDraftPlayerWeekMetrics,
  DraftUserSeasonStats,
  InsertDraftUserSeasonStats,
} from "./draft.schema";

export type DraftWeekStatus = "open" | "locked" | "scoring" | "closed";

export type DraftSlotType =
  | "top"
  | "jungle"
  | "mid"
  | "adc"
  | "support"
  | "breakout_player"
  | "rising_star"
  | "hidden_gem";

export type DraftEntryStatus = "open" | "locked" | "scored";

export interface DraftScoreBreakdown {
  basePerformance: number;
  bonusMultiplier: number;
  roleBonus: number;
  specialSlotBonus: number;
  total: number;
}

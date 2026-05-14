// ─── Player Operator Domain — Types ──────────────────────────────────────────
import type {
  MissionType, MissionStatus, ActionType, ActionPriority, CardVisualStatus,
  MomentRarity, MomentStatus,
} from "@shared/schema";

// ── Service inputs ────────────────────────────────────────────────────────────

export interface CreateMissionInput {
  assetId: number;
  createdByUserId: string;
  type: MissionType;
  title: string;
  description?: string;
  goalValue: number;
  endDate?: string;
}

export interface UpdateMissionInput {
  missionId: number;
  assetId: number;
  status?: MissionStatus;
  title?: string;
  description?: string;
  goalValue?: number;
  endDate?: string;
}

export interface UpdateCardVisualInput {
  assetId: number;
  createdByUserId: string;
  templateId?: string;
  overlayConfig?: Record<string, unknown>;
  cropConfig?: Record<string, unknown>;
  status?: CardVisualStatus;
}

export interface TriggerActionInput {
  actionId: number;
  assetId: number;
  userId: string;
}

// ── Response shapes ───────────────────────────────────────────────────────────

export interface OperatorPlayerInfo {
  assetId: number;
  playerName: string;
  avatarUrl: string | null;
  bannerImageUrl: string | null;
  status: "trending" | "stable" | "declining";
  viewMode: "operator";
  isOwner: boolean;
}

export interface OperatorSnapshot {
  earningsTotal: number;
  earningsDelta: number;
  holdersTotal: number;
  holdersDelta: number;
  conversionRate: number;
  conversionDelta: number;
  volumeTotal: number;
  volumeDelta: number;
  trendStatus: "up" | "down" | "stable";
  alerts: string[];
}

export interface OperatorAction {
  actionId: string;
  type: ActionType;
  title: string;
  reason: string;
  expectedImpact: string;
  priority: ActionPriority;
}

export interface OperatorMissionView {
  id: number;
  type: MissionType;
  title: string;
  description: string | null;
  goalValue: number;
  currentValue: number;
  progressPercentage: number;
  status: MissionStatus;
  participantsCount: number;
  startDate: string;
  endDate: string | null;
}

export interface OperatorCardVisualView {
  imageUrl: string | null;
  templateId: string;
  overlayConfig: Record<string, unknown>;
  cropConfig: Record<string, unknown>;
  status: CardVisualStatus;
  lastUpdated: string;
}

export interface OperatorActivityEventView {
  id: number;
  type: string;
  actorDisplayMasked: string | null;
  valueNumeric: number | null;
  createdAt: string;
}

export interface OverviewResponse {
  player: OperatorPlayerInfo;
  snapshot: OperatorSnapshot;
  actionCenter: OperatorAction[];
  mission: OperatorMissionView | null;
  cardVisual: OperatorCardVisualView | null;
  activityPreview: OperatorActivityEventView[];
}

// ── Moment inputs ─────────────────────────────────────────────────────────────

export interface CreateMomentInput {
  assetId: number;
  createdByUserId: string;
  title: string;
  rarity: MomentRarity;
  price: number;
  supplyTotal: number;
  status?: MomentStatus;
}

export interface UpdateMomentInput {
  momentId: number;
  assetId: number;
  title?: string;
  rarity?: MomentRarity;
  price?: number;
  supplyTotal?: number;
  status?: MomentStatus;
}

export interface RelaunchMomentInput {
  momentId: number;
  assetId: number;
  price: number;
  supplyTotal: number;
}

// ── Moment response shape ─────────────────────────────────────────────────────

export interface OperatorMomentView {
  momentId: number;
  title: string;
  rarity: MomentRarity;
  price: number;
  supplyTotal: number;
  supplySold: number;
  soldPercentage: number;
  revenueGenerated: number;
  salesVelocity: number;
  status: MomentStatus;
  createdAt: string;
  updatedAt: string;
}

// ─── Player Operator Domain — Serializers ─────────────────────────────────────
// Convert raw DB rows into the API response shapes defined in types.ts.
// ─────────────────────────────────────────────────────────────────────────────
import type {
  PlayerOperatorSnapshot,
  PlayerMission,
  PlayerCardVisual,
  PlayerActivityEvent,
  PlayerMoment,
} from "@shared/schema";
import type {
  OperatorSnapshot,
  OperatorMissionView,
  OperatorCardVisualView,
  OperatorActivityEventView,
  OperatorMomentView,
} from "./types";

export function serializeSnapshot(row: PlayerOperatorSnapshot): OperatorSnapshot {
  return {
    earningsTotal: Number(row.earningsTotal),
    earningsDelta: Number(row.earningsDeltaPct),
    holdersTotal: row.holdersTotal,
    holdersDelta: row.holdersDelta,
    conversionRate: Number(row.conversionRate),
    conversionDelta: Number(row.conversionDelta),
    volumeTotal: Number(row.volumeTotal),
    volumeDelta: Number(row.volumeDelta),
    trendStatus: row.trendStatus,
    alerts: Array.isArray(row.alertsJson) ? (row.alertsJson as string[]) : [],
  };
}

export function serializeMission(row: PlayerMission): OperatorMissionView {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    description: row.description ?? null,
    goalValue: Number(row.goalValue),
    currentValue: Number(row.currentValue),
    progressPercentage: Number(row.progressPercentage),
    status: row.status,
    participantsCount: row.participantsCount,
    startDate: row.startDate.toISOString(),
    endDate: row.endDate ? row.endDate.toISOString() : null,
  };
}

export function serializeCardVisual(row: PlayerCardVisual, imageUrl: string | null = null): OperatorCardVisualView {
  return {
    imageUrl,
    templateId: row.templateId,
    overlayConfig: (row.overlayConfigJson as Record<string, unknown>) ?? {},
    cropConfig: (row.cropConfigJson as Record<string, unknown>) ?? {},
    status: row.status,
    lastUpdated: row.updatedAt.toISOString(),
  };
}

export function serializeActivityEvent(row: PlayerActivityEvent): OperatorActivityEventView {
  return {
    id: row.id,
    type: row.type,
    actorDisplayMasked: row.actorDisplayMasked ?? null,
    valueNumeric: row.valueNumeric !== null ? Number(row.valueNumeric) : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function serializeMoment(row: PlayerMoment): OperatorMomentView {
  return {
    momentId: row.id,
    title: row.title,
    rarity: row.rarity,
    price: Number(row.price),
    supplyTotal: row.supplyTotal,
    supplySold: row.supplySold,
    soldPercentage: Number(row.soldPercentage),
    revenueGenerated: Number(row.revenueGenerated),
    salesVelocity: Number(row.salesVelocity),
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ── Mock snapshot for assets that have no snapshot row yet ───────────────────
export function mockSnapshot(): OperatorSnapshot {
  return {
    earningsTotal: 0,
    earningsDelta: 0,
    holdersTotal: 0,
    holdersDelta: 0,
    conversionRate: 0,
    conversionDelta: 0,
    volumeTotal: 0,
    volumeDelta: 0,
    trendStatus: "stable",
    alerts: [],
  };
}

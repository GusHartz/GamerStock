// ─── Admin History Service ─────────────────────────────────────────────────────
// Read-only service for the admin history view.
// No mutations — only aggregated reads of existing data.
//
// Data sources used:
//   prediction_events       — event metadata + status
//   prediction_markets      — market status, poolTotal, resolvedOutcomeId, settledAt
//   prediction_outcomes     — outcome labels (for winner label)
//   prediction_settlements  — grossPayout, netPayout (settlement aggregates)
//   prediction_positions    — cancelled positions (refund proxy)
// ─────────────────────────────────────────────────────────────────────────────

import { db } from "../../db";
import {
  predictionEvents,
  predictionMarkets,
  predictionOutcomes,
  predictionSettlements,
  predictionPositions,
} from "@shared/schema";
import { eq, and, desc, sql, ilike, inArray, count } from "drizzle-orm";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface HistoryListFilters {
  eventStatus?: string;
  game?:        string;
  search?:      string;
  limit?:       number;
  offset?:      number;
}

export interface HistoryEventItem {
  eventId:            number;
  title:              string;
  game:               string;
  tournamentName:     string | null;
  startsAt:           string | null;
  eventStatus:        string;
  marketCount:        number;
  resolvedCount:      number;
  poolTotalSum:       string | null;
  latestMarketUpdate: string | null;
  eventUpdatedAt:     string;
}

export interface HistoryListResponse {
  data:   HistoryEventItem[];
  total:  number;
  limit:  number;
  offset: number;
}

export interface MarketHistoryItem {
  marketId:          number;
  question:          string;
  status:            string;
  poolTotal:         string;
  resolvedOutcomeId: number | null;
  winnerLabel:       string | null;
  settledAt:         string | null;
  updatedAt:         string;
  settledPositions:  number;
  totalGrossPayout:  string | null;
  totalNetPayout:    string | null;
}

export interface SettlementSummary {
  totalSettledPositions: number;
  totalGrossPayout:      string | null;
  totalNetPayout:        string | null;
  latestSettlementAt:    string | null;
  cancelledPositionCount: number;
}

export interface EventHistorySummary {
  event:             {
    id:              number;
    uid:             string;
    title:           string;
    game:            string;
    region:          string | null;
    tournamentName:  string | null;
    eventName:       string | null;
    teamAName:       string | null;
    teamBName:       string | null;
    startsAt:        string | null;
    status:          string;
    externalRef:     string | null;
    createdAt:       string;
    updatedAt:       string;
  };
  markets:           MarketHistoryItem[];
  settlementSummary: SettlementSummary;
}

// ── List history events ───────────────────────────────────────────────────────

export async function listHistoryEvents(
  filters: HistoryListFilters = {}
): Promise<HistoryListResponse> {
  const limit  = Math.min(filters.limit  ?? 50, 200);
  const offset = filters.offset ?? 0;

  // Build WHERE conditions for the events table
  const conditions = [];
  if (filters.eventStatus) {
    conditions.push(eq(predictionEvents.status, filters.eventStatus));
  }
  if (filters.game) {
    conditions.push(eq(predictionEvents.game, filters.game));
  }
  if (filters.search?.trim()) {
    conditions.push(ilike(predictionEvents.title, `%${filters.search.trim()}%`));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  // Main aggregation query: events + joined market counts via subquery
  // Using sql template for aggregates, then manual enrichment.
  // Step 1: get paged events
  const events = await db
    .select({
      id:             predictionEvents.id,
      title:          predictionEvents.title,
      game:           predictionEvents.game,
      tournamentName: predictionEvents.tournamentName,
      startsAt:       predictionEvents.startsAt,
      status:         predictionEvents.status,
      updatedAt:      predictionEvents.updatedAt,
    })
    .from(predictionEvents)
    .where(where)
    .orderBy(desc(predictionEvents.updatedAt))
    .limit(limit)
    .offset(offset);

  // Step 2: count total
  const [countRow] = await db
    .select({ total: count() })
    .from(predictionEvents)
    .where(where);
  const total = countRow?.total ?? 0;

  if (events.length === 0) {
    return { data: [], total, limit, offset };
  }

  const eventIds = events.map((e) => e.id);

  // Step 3: aggregate market stats per event in a single query
  const marketAgg = await db
    .select({
      eventId:            predictionMarkets.eventId,
      marketCount:        sql<number>`COUNT(*)::int`,
      resolvedCount:      sql<number>`COUNT(*) FILTER (WHERE ${predictionMarkets.status} IN ('settled','resolved','cancelled'))::int`,
      poolTotalSum:       sql<string>`COALESCE(SUM(${predictionMarkets.poolTotal})::text, '0')`,
      latestMarketUpdate: sql<string>`MAX(${predictionMarkets.updatedAt})::text`,
    })
    .from(predictionMarkets)
    .where(inArray(predictionMarkets.eventId, eventIds))
    .groupBy(predictionMarkets.eventId);

  const aggMap = new Map(marketAgg.map((r) => [r.eventId, r]));

  // Step 4: compose
  const data: HistoryEventItem[] = events.map((ev) => {
    const agg = aggMap.get(ev.id);
    return {
      eventId:            ev.id,
      title:              ev.title,
      game:               ev.game,
      tournamentName:     ev.tournamentName ?? null,
      startsAt:           ev.startsAt?.toISOString() ?? null,
      eventStatus:        ev.status,
      marketCount:        agg?.marketCount        ?? 0,
      resolvedCount:      agg?.resolvedCount      ?? 0,
      poolTotalSum:       agg?.poolTotalSum        ?? null,
      latestMarketUpdate: agg?.latestMarketUpdate  ?? null,
      eventUpdatedAt:     ev.updatedAt.toISOString(),
    };
  });

  return { data, total, limit, offset };
}

// ── Event history summary ─────────────────────────────────────────────────────

export async function getEventHistorySummary(
  eventId: number
): Promise<EventHistorySummary | null> {
  // 1. Fetch event
  const [ev] = await db
    .select()
    .from(predictionEvents)
    .where(eq(predictionEvents.id, eventId))
    .limit(1);

  if (!ev) return null;

  // 2. Fetch markets for this event
  const markets = await db
    .select({
      id:                predictionMarkets.id,
      question:          predictionMarkets.question,
      status:            predictionMarkets.status,
      poolTotal:         predictionMarkets.poolTotal,
      resolvedOutcomeId: predictionMarkets.resolvedOutcomeId,
      settledAt:         predictionMarkets.settledAt,
      updatedAt:         predictionMarkets.updatedAt,
    })
    .from(predictionMarkets)
    .where(eq(predictionMarkets.eventId, eventId))
    .orderBy(desc(predictionMarkets.updatedAt));

  if (markets.length === 0) {
    return {
      event: evToShape(ev),
      markets: [],
      settlementSummary: {
        totalSettledPositions:  0,
        totalGrossPayout:       null,
        totalNetPayout:         null,
        latestSettlementAt:     null,
        cancelledPositionCount: 0,
      },
    };
  }

  const marketIds = markets.map((m) => m.id);

  // 3. Fetch winner labels (outcomes with isWinner=true)
  const winnerRows = await db
    .select({
      marketId: predictionOutcomes.marketId,
      outcomeId: predictionOutcomes.id,
      label:    predictionOutcomes.label,
    })
    .from(predictionOutcomes)
    .where(
      and(
        inArray(predictionOutcomes.marketId, marketIds),
        eq(predictionOutcomes.isWinner, true),
      )
    );
  const winnerMap = new Map(winnerRows.map((r) => [r.marketId, r.label]));

  // 4. Settlement aggregate per market (from prediction_settlements)
  const settleAgg = await db
    .select({
      marketId:        predictionPositions.marketId,
      settledCount:    sql<number>`COUNT(${predictionSettlements.id})::int`,
      totalGross:      sql<string>`COALESCE(SUM(${predictionSettlements.grossPayout})::text, '0')`,
      totalNet:        sql<string>`COALESCE(SUM(${predictionSettlements.netPayout})::text, '0')`,
      latestSettledAt: sql<string>`MAX(${predictionSettlements.settledAt})::text`,
    })
    .from(predictionSettlements)
    .innerJoin(predictionPositions, eq(predictionPositions.id, predictionSettlements.positionId))
    .where(inArray(predictionPositions.marketId, marketIds))
    .groupBy(predictionPositions.marketId);
  const settleMap = new Map(settleAgg.map((r) => [r.marketId, r]));

  // 5. Cancelled positions count per market (proxy for refunds)
  const cancelledAgg = await db
    .select({
      marketId:       predictionPositions.marketId,
      cancelledCount: sql<number>`COUNT(*)::int`,
    })
    .from(predictionPositions)
    .where(
      and(
        inArray(predictionPositions.marketId, marketIds),
        eq(predictionPositions.status, "cancelled"),
      )
    )
    .groupBy(predictionPositions.marketId);
  const cancelledMap = new Map(cancelledAgg.map((r) => [r.marketId, r.cancelledCount]));

  // 6. Compose market list
  const marketItems: MarketHistoryItem[] = markets.map((m) => {
    const settle   = settleMap.get(m.id);
    return {
      marketId:          m.id,
      question:          m.question,
      status:            m.status,
      poolTotal:         m.poolTotal,
      resolvedOutcomeId: m.resolvedOutcomeId ?? null,
      winnerLabel:       winnerMap.get(m.id) ?? null,
      settledAt:         m.settledAt?.toISOString() ?? null,
      updatedAt:         m.updatedAt.toISOString(),
      settledPositions:  settle?.settledCount  ?? 0,
      totalGrossPayout:  settle?.totalGross     ?? null,
      totalNetPayout:    settle?.totalNet       ?? null,
    };
  });

  // 7. Overall settlement summary
  const totalSettledPositions = marketItems.reduce((s, m) => s + m.settledPositions, 0);
  const totalCancelled        = Array.from(cancelledMap.values()).reduce((s, n) => s + (n ?? 0), 0);

  const grossValues = settleAgg.map((r) => parseFloat(r.totalGross ?? "0"));
  const netValues   = settleAgg.map((r) => parseFloat(r.totalNet   ?? "0"));
  const latestTs    = settleAgg
    .map((r) => r.latestSettledAt)
    .filter((s): s is string => s !== null)
    .sort()
    .at(-1) ?? null;

  const settlementSummary: SettlementSummary = {
    totalSettledPositions,
    totalGrossPayout:       grossValues.length > 0 ? grossValues.reduce((a, b) => a + b, 0).toFixed(6) : null,
    totalNetPayout:         netValues.length  > 0 ? netValues.reduce((a, b) => a + b, 0).toFixed(6) : null,
    latestSettlementAt:     latestTs,
    cancelledPositionCount: totalCancelled,
  };

  return { event: evToShape(ev), markets: marketItems, settlementSummary };
}

// ── Shape helpers ─────────────────────────────────────────────────────────────

function evToShape(ev: typeof predictionEvents.$inferSelect) {
  return {
    id:             ev.id,
    uid:            ev.uid,
    title:          ev.title,
    game:           ev.game,
    region:         ev.region       ?? null,
    tournamentName: ev.tournamentName ?? null,
    eventName:      ev.eventName    ?? null,
    teamAName:      ev.teamAName    ?? null,
    teamBName:      ev.teamBName    ?? null,
    startsAt:       ev.startsAt?.toISOString() ?? null,
    status:         ev.status,
    externalRef:    ev.externalRef  ?? null,
    createdAt:      ev.createdAt.toISOString(),
    updatedAt:      ev.updatedAt.toISOString(),
  };
}

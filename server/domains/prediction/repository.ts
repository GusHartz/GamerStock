// ─── Prediction Markets — Repository ──────────────────────────────────────────
// Data access layer for the prediction domain.
// All DB operations go through this file — routes and service never touch `db` directly.
// ─────────────────────────────────────────────────────────────────────────────
import { db } from "../../db";
import {
  predictionEvents,
  predictionMarkets,
  predictionOutcomes,
  predictionPositions,
  predictionOrders,
  predictionSettlements,
  predictionPriceSnapshots,
  predictionMarketStats,
  predictionMarketEvents,
  predictionDisplayQueue,
  mediaAssets,
  predictionEventMedia,
  type InsertPredictionEvent,
  type InsertPredictionMarket,
  type InsertPredictionPosition,
  type InsertPredictionOrder,
  type InsertPredictionSettlement,
  type InsertPredictionPriceSnapshot,
  type InsertPredictionMarketEvent,
  type PredictionEvent,
  type PredictionMarket,
  type PredictionOutcome,
  type PredictionPosition,
  type PredictionOrder,
  type PredictionSettlement,
  type PredictionPriceSnapshot,
  type PredictionMarketStats,
  type PredictionMarketEvent,
  type PredictionDisplayQueueItem,
} from "@shared/schema";
import { eq, and, desc, asc, count, sql, inArray, isNull, isNotNull, not, gt, or } from "drizzle-orm";
import type {
  PredictionMarketListParams,
  PredictionMarketWithOutcomes,
  PredictionEventListParams,
  EnrichedPosition,
  UpcomingEventCard,
  PriceSnapshotPoint,
  MarketLifecycleEvent,
  BrowseMarketsParams,
  PredictionMarketCard,
} from "./types";
import { nanoid } from "nanoid";

// ── Slug helpers ──────────────────────────────────────────────────────────────

function generateSlug(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80)
    + `-${nanoid(6)}`;
}

// ── Events ────────────────────────────────────────────────────────────────────

async function createEvent(
  input: Omit<InsertPredictionEvent, "uid">
): Promise<PredictionEvent> {
  const [row] = await db
    .insert(predictionEvents)
    .values({ ...input, uid: `evt_${nanoid(12)}` })
    .returning();
  return row;
}

async function findEventById(id: number): Promise<PredictionEvent | null> {
  const [row] = await db
    .select()
    .from(predictionEvents)
    .where(eq(predictionEvents.id, id));
  return row ?? null;
}

async function updateEventStatus(id: number, newStatus: string): Promise<PredictionEvent | null> {
  const [updated] = await db
    .update(predictionEvents)
    .set({ status: newStatus, updatedAt: new Date() })
    .where(eq(predictionEvents.id, id))
    .returning();
  return updated ?? null;
}

async function listEvents(params: PredictionEventListParams = {}): Promise<PredictionEvent[]> {
  const { game, status, limit = 50 } = params;
  const conditions = [];
  if (game)   conditions.push(eq(predictionEvents.game, game));
  if (status) conditions.push(eq(predictionEvents.status, status));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  return db
    .select()
    .from(predictionEvents)
    .where(where)
    .orderBy(desc(predictionEvents.startsAt))
    .limit(limit);
}

// ── Markets ───────────────────────────────────────────────────────────────────

async function createMarket(
  input: Omit<InsertPredictionMarket, "uid">,
  outcomes: Array<{ label: string; code?: string; description?: string; sortOrder?: number; impliedProbability?: string; metadata?: Record<string, unknown> }>
): Promise<PredictionMarket> {
  const slug = (input as any).slug ?? generateSlug(input.question);

  const [market] = await db
    .insert(predictionMarkets)
    .values({
      ...input,
      uid:    `mkt_${nanoid(12)}`,
      slug,
      status: "draft",
    })
    .returning();

  if (outcomes.length > 0) {
    await db.insert(predictionOutcomes).values(
      outcomes.map((o, i) => ({
        marketId:           market.id,
        label:              o.label,
        code:               o.code ?? null,
        description:        o.description ?? null,
        sortOrder:          o.sortOrder ?? i,
        impliedProbability: o.impliedProbability ?? null,
        metadata:           o.metadata ?? null,
      }))
    );
  }

  // initialise stats row
  await db
    .insert(predictionMarketStats)
    .values({ marketId: market.id })
    .onConflictDoNothing();

  return market;
}

async function findMarketById(id: number): Promise<PredictionMarket | null> {
  const [row] = await db
    .select()
    .from(predictionMarkets)
    .where(eq(predictionMarkets.id, id));
  return row ?? null;
}

async function findMarketBySlug(slug: string): Promise<PredictionMarket | null> {
  const [row] = await db
    .select()
    .from(predictionMarkets)
    .where(eq(predictionMarkets.slug, slug));
  return row ?? null;
}

async function findMarketWithOutcomes(
  idOrSlug: number | string
): Promise<PredictionMarketWithOutcomes | null> {
  const market =
    typeof idOrSlug === "number"
      ? await findMarketById(idOrSlug)
      : await findMarketBySlug(idOrSlug);

  if (!market) return null;

  const [outcomes, event, statsRows] = await Promise.all([
    db
      .select()
      .from(predictionOutcomes)
      .where(eq(predictionOutcomes.marketId, market.id))
      .orderBy(asc(predictionOutcomes.sortOrder)),
    market.eventId ? findEventById(market.eventId) : Promise.resolve(null),
    db
      .select()
      .from(predictionMarketStats)
      .where(eq(predictionMarketStats.marketId, market.id))
      .limit(1),
  ]);

  return {
    ...market,
    outcomes,
    event,
    stats: statsRows[0] ?? null,
  };
}

async function listMarkets(params: PredictionMarketListParams): Promise<{
  markets: PredictionMarketWithOutcomes[];
  total:   number;
}> {
  const { status, statuses, eventId, currency, liveOnly, page = 1, limit = 20 } = params;
  const offset = (page - 1) * limit;

  const conditions = [];
  // single-status filter (mutually exclusive with statuses[])
  if (statuses && statuses.length > 0) {
    conditions.push(inArray(predictionMarkets.status, statuses));
  } else if (status) {
    conditions.push(eq(predictionMarkets.status, status));
  }
  if (eventId)  conditions.push(eq(predictionMarkets.eventId, eventId));
  if (currency) conditions.push(eq(predictionMarkets.currency, currency));
  // live-only: market must still be open to orders (closeAt in the future or unset)
  if (liveOnly) {
    conditions.push(
      or(isNull(predictionMarkets.closeAt), gt(predictionMarkets.closeAt, new Date()))!
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ value: total }]] = await Promise.all([
    db
      .select()
      .from(predictionMarkets)
      .where(where)
      .orderBy(desc(predictionMarkets.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ value: count() })
      .from(predictionMarkets)
      .where(where),
  ]);

  const markets = await Promise.all(
    rows.map(async (m) => {
      const [outcomes, event, statsRows] = await Promise.all([
        db
          .select()
          .from(predictionOutcomes)
          .where(eq(predictionOutcomes.marketId, m.id))
          .orderBy(asc(predictionOutcomes.sortOrder)),
        m.eventId ? findEventById(m.eventId) : Promise.resolve(null),
        db
          .select()
          .from(predictionMarketStats)
          .where(eq(predictionMarketStats.marketId, m.id))
          .limit(1),
      ]);
      return { ...m, outcomes, event, stats: statsRows[0] ?? null };
    })
  );

  return { markets, total: Number(total) };
}

// ── Sprint 4 Home Discovery ───────────────────────────────────────────────────
// Three lightweight queries that feed GET /api/predictions/home.
// Live + trending come from predictionMarkets (with outcome/stats joins).
// Upcoming comes from predictionEvents with a GROUP BY count of linked markets.
// ─────────────────────────────────────────────────────────────────────────────

interface HomeDataRaw {
  liveMarkets:    PredictionMarketWithOutcomes[];
  trendingMarkets: PredictionMarketWithOutcomes[];
  upcomingEvents:  UpcomingEventCard[];
}

async function getHomeData(opts: {
  liveLimit?:     number;
  trendingLimit?: number;
  upcomingLimit?: number;
} = {}): Promise<HomeDataRaw> {
  const { liveLimit = 8, trendingLimit = 8, upcomingLimit = 8 } = opts;

  // ── 1. Live markets: status=open, closeAt in the future (or unset), ordered closeAt ASC
  const liveRows = await db
    .select()
    .from(predictionMarkets)
    .where(
      and(
        eq(predictionMarkets.status, "open"),
        or(isNull(predictionMarkets.closeAt), gt(predictionMarkets.closeAt, new Date()))!
      )
    )
    .orderBy(asc(predictionMarkets.closeAt))
    .limit(liveLimit);

  // ── 2. Trending markets: open/locked/settled, joined with stats, volume24h DESC
  //    Left join so markets without a stats row still appear (volume=0 sorts last)
  const trendingRows = await db
    .select({ market: predictionMarkets, stats: predictionMarketStats })
    .from(predictionMarkets)
    .leftJoin(predictionMarketStats, eq(predictionMarketStats.marketId, predictionMarkets.id))
    .where(inArray(predictionMarkets.status, ["open", "locked", "settled"]))
    .orderBy(desc(predictionMarketStats.volume24h))
    .limit(trendingLimit);

  // ── 3. Upcoming events: scheduled events ordered by startsAt ASC
  //    Then enrich with linked-market count + first market slug via group queries.
  const upcomingEventRows = await db
    .select()
    .from(predictionEvents)
    .where(eq(predictionEvents.status, "scheduled"))
    .orderBy(asc(predictionEvents.startsAt))
    .limit(upcomingLimit);

  // ── Enrich live markets (outcomes + event + stats) ────────────────────────
  const liveMarkets = await Promise.all(
    liveRows.map(async (m) => {
      const [outcomes, event, statsRows] = await Promise.all([
        db.select().from(predictionOutcomes)
          .where(eq(predictionOutcomes.marketId, m.id))
          .orderBy(asc(predictionOutcomes.sortOrder)),
        m.eventId ? findEventById(m.eventId) : Promise.resolve(null),
        db.select().from(predictionMarketStats)
          .where(eq(predictionMarketStats.marketId, m.id))
          .limit(1),
      ]);
      return { ...m, outcomes, event, stats: statsRows[0] ?? null };
    })
  );

  // ── Enrich trending markets (outcomes + event; stats already from join) ───
  const trendingMarkets = await Promise.all(
    trendingRows.map(async (row) => {
      const m = row.market;
      const [outcomes, event] = await Promise.all([
        db.select().from(predictionOutcomes)
          .where(eq(predictionOutcomes.marketId, m.id))
          .orderBy(asc(predictionOutcomes.sortOrder)),
        m.eventId ? findEventById(m.eventId) : Promise.resolve(null),
      ]);
      return { ...m, outcomes, event, stats: row.stats ?? null };
    })
  );

  // ── Enrich upcoming events with linked market count + first slug ──────────
  let upcomingEvents: UpcomingEventCard[] = [];
  if (upcomingEventRows.length > 0) {
    const eventIds = upcomingEventRows.map((e) => e.id);

    // count of linked markets per event (any non-terminal status)
    const countRows = await db
      .select({ eventId: predictionMarkets.eventId, total: count() })
      .from(predictionMarkets)
      .where(
        and(
          inArray(predictionMarkets.eventId as any, eventIds),
          inArray(predictionMarkets.status, ["draft", "open", "locked"])
        )
      )
      .groupBy(predictionMarkets.eventId);

    // first market slug per event (ordered by createdAt ASC)
    const slugRows = await db
      .select({ eventId: predictionMarkets.eventId, slug: predictionMarkets.slug })
      .from(predictionMarkets)
      .where(inArray(predictionMarkets.eventId as any, eventIds))
      .orderBy(asc(predictionMarkets.createdAt));

    const countMap  = new Map<number, number>(countRows.map((r) => [r.eventId!, Number(r.total)]));
    const slugMap   = new Map<number, string | null>();
    for (const r of slugRows) {
      if (r.eventId != null && !slugMap.has(r.eventId)) slugMap.set(r.eventId, r.slug);
    }

    upcomingEvents = upcomingEventRows.map((e) => ({
      eventId:            e.id,
      uid:                e.uid,
      title:              e.title,
      game:               e.game,
      region:             e.region ?? null,
      tournamentName:     e.tournamentName ?? null,
      eventName:          e.eventName ?? null,
      teamAName:          e.teamAName ?? null,
      teamBName:          e.teamBName ?? null,
      startsAt:           e.startsAt ?? null,
      linkedMarketsCount: countMap.get(e.id) ?? 0,
      firstMarketSlug:    slugMap.get(e.id) ?? null,
    }));
  }

  return { liveMarkets, trendingMarkets, upcomingEvents };
}

async function updateMarketStatus(
  marketId: number,
  status:   string,
  extra:    Partial<Pick<PredictionMarket, "resolvedOutcomeId" | "resolveAt" | "settledAt">> = {}
): Promise<PredictionMarket | null> {
  const [row] = await db
    .update(predictionMarkets)
    .set({ status, updatedAt: new Date(), ...extra })
    .where(eq(predictionMarkets.id, marketId))
    .returning();
  return row ?? null;
}

async function updateMarketPool(marketId: number, additionalStake: string): Promise<void> {
  await db
    .update(predictionMarkets)
    .set({
      poolTotal: sql`${predictionMarkets.poolTotal} + ${additionalStake}::numeric`,
      updatedAt: new Date(),
    })
    .where(eq(predictionMarkets.id, marketId));
}

// ── Outcomes ──────────────────────────────────────────────────────────────────

async function findOutcomeById(id: number): Promise<PredictionOutcome | null> {
  const [row] = await db
    .select()
    .from(predictionOutcomes)
    .where(eq(predictionOutcomes.id, id));
  return row ?? null;
}

async function findOutcomesByMarket(marketId: number): Promise<PredictionOutcome[]> {
  return db
    .select()
    .from(predictionOutcomes)
    .where(eq(predictionOutcomes.marketId, marketId))
    .orderBy(asc(predictionOutcomes.sortOrder));
}

async function markOutcomeAsWinner(
  outcomeId:    number,
  payoutValue?: string
): Promise<void> {
  await db
    .update(predictionOutcomes)
    .set({ isWinner: true, ...(payoutValue ? { payoutValue } : {}) })
    .where(eq(predictionOutcomes.id, outcomeId));
}

async function updateOutcomePoolShare(
  outcomeId:       number,
  additionalStake: string
): Promise<void> {
  await db
    .update(predictionOutcomes)
    .set({
      poolShare: sql`${predictionOutcomes.poolShare} + ${additionalStake}::numeric`,
    })
    .where(eq(predictionOutcomes.id, outcomeId));
}

// ── Positions ─────────────────────────────────────────────────────────────────

async function createPosition(
  input: InsertPredictionPosition
): Promise<PredictionPosition> {
  const [row] = await db
    .insert(predictionPositions)
    .values(input)
    .returning();
  return row;
}

async function findPositionByUserMarketOutcome(
  userId:    string,
  marketId:  number,
  outcomeId: number
): Promise<PredictionPosition | null> {
  const [row] = await db
    .select()
    .from(predictionPositions)
    .where(
      and(
        eq(predictionPositions.userId, userId),
        eq(predictionPositions.marketId, marketId),
        eq(predictionPositions.outcomeId, outcomeId),
        eq(predictionPositions.status, "active"),
      )
    )
    .limit(1);
  return row ?? null;
}

async function findActivePositionsByMarket(marketId: number): Promise<PredictionPosition[]> {
  return db
    .select()
    .from(predictionPositions)
    .where(
      and(
        eq(predictionPositions.marketId, marketId),
        eq(predictionPositions.status, "active"),
      )
    );
}

async function updatePositionForOrder(
  positionId:          number,
  additionalQuantity:  string,
  additionalCostBasis: string,
  walletLedgerRef:     string,
): Promise<PredictionPosition> {
  const [row] = await db
    .update(predictionPositions)
    .set({
      quantity:  sql`COALESCE(${predictionPositions.quantity}, 0) + ${additionalQuantity}::numeric`,
      costBasis: sql`COALESCE(${predictionPositions.costBasis}, 0) + ${additionalCostBasis}::numeric`,
      avgPrice:  sql`
        (COALESCE(${predictionPositions.costBasis}, 0) + ${additionalCostBasis}::numeric)
        / (COALESCE(${predictionPositions.quantity}, 0) + ${additionalQuantity}::numeric)
      `,
      stake:     sql`COALESCE(${predictionPositions.stake}, 0) + ${additionalCostBasis}::numeric`,
      walletLedgerRef,
      updatedAt: new Date(),
    })
    .where(eq(predictionPositions.id, positionId))
    .returning();
  return row;
}

/**
 * Phase 3 SELL: Atomically reduce a position's quantity and costBasis,
 * accumulate realizedPnl, and close the position if quantity reaches 0.
 *
 * avgPrice (entry price) is intentionally unchanged — it is the weighted
 * average BUY price, not affected by sells.
 */
async function reducePositionForSell(
  positionId:       number,
  sharesToSell:     string,
  costRemoved:      string,
  realizedPnlDelta: string,
  walletLedgerRef:  string,
): Promise<PredictionPosition> {
  const [row] = await db
    .update(predictionPositions)
    .set({
      quantity:    sql`GREATEST(0, COALESCE(${predictionPositions.quantity}, 0) - ${sharesToSell}::numeric)`,
      costBasis:   sql`GREATEST(0, COALESCE(${predictionPositions.costBasis}, 0) - ${costRemoved}::numeric)`,
      stake:       sql`GREATEST(0, COALESCE(${predictionPositions.stake}, 0) - ${costRemoved}::numeric)`,
      realizedPnl: sql`COALESCE(${predictionPositions.realizedPnl}, 0) + ${realizedPnlDelta}::numeric`,
      walletLedgerRef,
      updatedAt:   new Date(),
    })
    .where(eq(predictionPositions.id, positionId))
    .returning();
  return row;
}

async function findPositionsByUser(
  userId:    string,
  marketId?: number
): Promise<PredictionPosition[]> {
  const conditions = [eq(predictionPositions.userId, userId)];
  if (marketId) conditions.push(eq(predictionPositions.marketId, marketId));
  return db
    .select()
    .from(predictionPositions)
    .where(and(...conditions))
    .orderBy(desc(predictionPositions.createdAt));
}

async function findPositionsByMarket(marketId: number): Promise<PredictionPosition[]> {
  return db
    .select()
    .from(predictionPositions)
    .where(eq(predictionPositions.marketId, marketId));
}

// ── Enriched position query (Sprint 3 Read APIs) ──────────────────────────────
// Single JOIN query: positions → markets → outcomes → events.
// Returns only positions matching the given statuses for the given user.
// No N+1 — all market/outcome/event context is resolved in one SQL pass.
async function findEnrichedPositionsByUser(
  userId:   string,
  statuses: string[]
): Promise<EnrichedPosition[]> {
  const rows = await db
    .select({
      // position
      id:          predictionPositions.id,
      userId:      predictionPositions.userId,
      marketId:    predictionPositions.marketId,
      outcomeId:   predictionPositions.outcomeId,
      quantity:    predictionPositions.quantity,
      avgPrice:    predictionPositions.avgPrice,
      costBasis:   predictionPositions.costBasis,
      stake:       predictionPositions.stake,
      currency:    predictionPositions.currency,
      status:      predictionPositions.status,
      payout:      predictionPositions.payout,
      realizedPnl: predictionPositions.realizedPnl,
      payoutAt:    predictionPositions.payoutAt,
      cancelledAt: predictionPositions.cancelledAt,
      createdAt:   predictionPositions.createdAt,
      updatedAt:   predictionPositions.updatedAt,
      // market
      marketQuestion:  predictionMarkets.question,
      marketSlug:      predictionMarkets.slug,
      marketStatus:    predictionMarkets.status,
      marketCurrency:  predictionMarkets.currency,
      marketType:      predictionMarkets.marketType,
      marketCloseAt:   predictionMarkets.closeAt,
      marketResolveAt: predictionMarkets.resolveAt,
      marketSettledAt: predictionMarkets.settledAt,
      // outcome (left join — always resolves in practice, FK is NOT NULL)
      outcomeLabel:     predictionOutcomes.label,
      outcomeCode:      predictionOutcomes.code,
      outcomeSortOrder: predictionOutcomes.sortOrder,
      // event (left join — null when market has no linked event)
      eventId:             predictionEvents.id,
      eventGame:           predictionEvents.game,
      eventTournamentName: predictionEvents.tournamentName,
      eventEventName:      predictionEvents.eventName,
      eventTeamAName:      predictionEvents.teamAName,
      eventTeamBName:      predictionEvents.teamBName,
      eventStartsAt:       predictionEvents.startsAt,
    })
    .from(predictionPositions)
    .innerJoin(predictionMarkets, eq(predictionMarkets.id, predictionPositions.marketId))
    .leftJoin(predictionOutcomes, eq(predictionOutcomes.id, predictionPositions.outcomeId))
    .leftJoin(predictionEvents, eq(predictionEvents.id, predictionMarkets.eventId))
    .where(
      and(
        eq(predictionPositions.userId, userId),
        inArray(predictionPositions.status, statuses)
      )
    )
    .orderBy(desc(predictionPositions.createdAt));

  return rows as EnrichedPosition[];
}

// ── Position counts by status (admin summary) ─────────────────────────────────
// Single GROUP BY query — cheap even at scale.
async function countPositionsByStatus(
  marketId: number
): Promise<{ status: string; count: number }[]> {
  const rows = await db
    .select({
      status: predictionPositions.status,
      count:  count(),
    })
    .from(predictionPositions)
    .where(eq(predictionPositions.marketId, marketId))
    .groupBy(predictionPositions.status);
  return rows.map(r => ({ status: r.status, count: Number(r.count) }));
}

// ── User position overlay for browse (Sprint 4.5) ────────────────────────────
// Single IN-list query bounded to the current browse page (max 100 market IDs).
// Returns a Set<number> of marketIds where the user has at least one ACTIVE
// position. Settled/cancelled positions are intentionally excluded.
// Never called with an empty marketIds array (guard is in the caller).
async function findActiveMarketIdsForUser(
  userId:    string,
  marketIds: number[]
): Promise<Set<number>> {
  const rows = await db
    .selectDistinct({ marketId: predictionPositions.marketId })
    .from(predictionPositions)
    .where(
      and(
        eq(predictionPositions.userId, userId),
        eq(predictionPositions.status, "active"),
        inArray(predictionPositions.marketId, marketIds)
      )
    );
  return new Set(rows.map(r => r.marketId));
}

async function updatePositionStatus(
  positionId: number,
  status:     string,
  extra:      Partial<Pick<PredictionPosition, "payout" | "payoutAt" | "cancelledAt" | "realizedPnl">> = {}
): Promise<void> {
  await db
    .update(predictionPositions)
    .set({ status, updatedAt: new Date(), ...extra })
    .where(eq(predictionPositions.id, positionId));
}

// ── Orders ────────────────────────────────────────────────────────────────────

async function createOrder(
  input: InsertPredictionOrder
): Promise<PredictionOrder> {
  const [row] = await db
    .insert(predictionOrders)
    .values(input)
    .returning();
  return row;
}

async function findOrderByIdempotencyKey(
  key: string
): Promise<PredictionOrder | null> {
  const [row] = await db
    .select()
    .from(predictionOrders)
    .where(eq(predictionOrders.idempotencyKey, key))
    .limit(1);
  return row ?? null;
}

async function updateOrderStatus(
  orderId: number,
  status:  string
): Promise<void> {
  await db
    .update(predictionOrders)
    .set({ status, updatedAt: new Date() })
    .where(eq(predictionOrders.id, orderId));
}

async function findOrdersByUser(
  userId:    string,
  marketId?: number
): Promise<PredictionOrder[]> {
  const conditions = [eq(predictionOrders.userId, userId)];
  if (marketId) conditions.push(eq(predictionOrders.marketId, marketId));
  return db
    .select()
    .from(predictionOrders)
    .where(and(...conditions))
    .orderBy(desc(predictionOrders.createdAt));
}

async function findOrdersByMarket(marketId: number): Promise<PredictionOrder[]> {
  return db
    .select()
    .from(predictionOrders)
    .where(eq(predictionOrders.marketId, marketId))
    .orderBy(desc(predictionOrders.createdAt));
}

// ── Settlements ───────────────────────────────────────────────────────────────

async function createSettlement(
  input: InsertPredictionSettlement
): Promise<PredictionSettlement> {
  const [row] = await db
    .insert(predictionSettlements)
    .values(input)
    .returning();
  return row;
}

async function findSettlementByPositionId(
  positionId: number
): Promise<PredictionSettlement | null> {
  const [row] = await db
    .select()
    .from(predictionSettlements)
    .where(eq(predictionSettlements.positionId, positionId))
    .limit(1);
  return row ?? null;
}

async function findSettlementsByMarket(marketId: number): Promise<PredictionSettlement[]> {
  return db
    .select()
    .from(predictionSettlements)
    .where(eq(predictionSettlements.marketId, marketId));
}

// ── Price snapshots ───────────────────────────────────────────────────────────

async function insertPriceSnapshot(
  input: InsertPredictionPriceSnapshot
): Promise<PredictionPriceSnapshot> {
  const [row] = await db
    .insert(predictionPriceSnapshots)
    .values(input)
    .returning();
  return row;
}

async function getPriceHistory(
  marketId:  number,
  outcomeId: number,
  limit:     number = 100
): Promise<PredictionPriceSnapshot[]> {
  return db
    .select()
    .from(predictionPriceSnapshots)
    .where(
      and(
        eq(predictionPriceSnapshots.marketId, marketId),
        eq(predictionPriceSnapshots.outcomeId, outcomeId)
      )
    )
    .orderBy(desc(predictionPriceSnapshots.recordedAt))
    .limit(limit);
}

// ── Auto-lock support ─────────────────────────────────────────────────────────

async function findLockableMarkets(): Promise<PredictionMarket[]> {
  const now = new Date();
  return db
    .select()
    .from(predictionMarkets)
    .where(
      and(
        eq(predictionMarkets.status, "open"),
        sql`${predictionMarkets.closeAt} IS NOT NULL`,
        sql`${predictionMarkets.closeAt} <= ${now.toISOString()}`,
      )
    );
}

// ── Provider resolution batch: markets eligible for automated resolution ──────
//
// Eligible if ALL of the following:
//   1. marketType = 'MATCH_WINNER'
//   2. status IN ('open', 'locked')
//   3. Linked event has externalRef starting with 'PANDASCORE:'
//   4. Linked event's startsAt (scheduled_at) <= now()  — match has started
//
// Returns only (marketId, eventExternalRef) — the batch service handles the rest.

export interface EligibleMarketForProviderResolution {
  marketId:        number;
  marketStatus:    string;
  eventExternalRef: string;
  eventStartsAt:   Date | null;
}

async function findMarketsEligibleForProviderResolution(
  limit = 100,
): Promise<EligibleMarketForProviderResolution[]> {
  const now = new Date();
  const rows = await db
    .select({
      marketId:         predictionMarkets.id,
      marketStatus:     predictionMarkets.status,
      eventExternalRef: predictionEvents.externalRef,
      eventStartsAt:    predictionEvents.startsAt,
    })
    .from(predictionMarkets)
    .innerJoin(predictionEvents, eq(predictionEvents.id, predictionMarkets.eventId as any))
    .where(
      and(
        inArray(predictionMarkets.status, ["open", "locked"]),
        eq(predictionMarkets.marketType, "MATCH_WINNER"),
        sql`${predictionEvents.externalRef} LIKE 'PANDASCORE:%'`,
        sql`${predictionEvents.startsAt} IS NOT NULL`,
        sql`${predictionEvents.startsAt} <= ${now.toISOString()}`,
      ),
    )
    .limit(limit);

  return rows as EligibleMarketForProviderResolution[];
}

// ── Sprint 4 Market Detail helpers ────────────────────────────────────────────

/**
 * getMarketSnapshots — all recent price snapshots for every outcome in a market.
 * Ordered recordedAt DESC so the caller always gets the freshest points first.
 * Limit defaults to 50 rows (covers ~25 ticks per outcome for a binary market).
 */
async function getMarketSnapshots(
  marketId: number,
  limit = 50
): Promise<PriceSnapshotPoint[]> {
  const rows = await db
    .select({
      outcomeId:    predictionPriceSnapshots.outcomeId,
      price:        predictionPriceSnapshots.price,
      volumeWindow: predictionPriceSnapshots.volumeWindow,
      recordedAt:   predictionPriceSnapshots.recordedAt,
    })
    .from(predictionPriceSnapshots)
    .where(eq(predictionPriceSnapshots.marketId, marketId))
    .orderBy(desc(predictionPriceSnapshots.recordedAt))
    .limit(limit);

  return rows.map((r) => ({
    outcomeId:    r.outcomeId,
    price:        r.price,
    volumeWindow: r.volumeWindow ?? null,
    recordedAt:   r.recordedAt,
  }));
}

/**
 * getRecentMarketEvents — last N lifecycle events for a market.
 * Ordered createdAt DESC (most recent first) so the detail view shows the
 * latest state change at the top of the timeline.
 * Limit defaults to 10 — enough for a readable audit strip.
 */
async function getRecentMarketEvents(
  marketId: number,
  limit = 10
): Promise<MarketLifecycleEvent[]> {
  const rows = await db
    .select({
      eventType:  predictionMarketEvents.eventType,
      fromStatus: predictionMarketEvents.fromStatus,
      toStatus:   predictionMarketEvents.toStatus,
      source:     predictionMarketEvents.source,
      note:       predictionMarketEvents.note,
      createdAt:  predictionMarketEvents.createdAt,
    })
    .from(predictionMarketEvents)
    .where(eq(predictionMarketEvents.marketId, marketId))
    .orderBy(desc(predictionMarketEvents.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    eventType:  r.eventType,
    fromStatus: r.fromStatus ?? null,
    toStatus:   r.toStatus ?? null,
    source:     r.source ?? null,
    note:       r.note ?? null,
    createdAt:  r.createdAt,
  }));
}

// ── Market stats ──────────────────────────────────────────────────────────────

async function getMarketStats(marketId: number): Promise<PredictionMarketStats | null> {
  const [row] = await db
    .select()
    .from(predictionMarketStats)
    .where(eq(predictionMarketStats.marketId, marketId));
  return row ?? null;
}

// ── Batch market stats for portfolio overlay (Sprint 4.5) ────────────────────
// One IN-list query for all distinct active-position market IDs.
// Returns a Map<marketId, PredictionMarketStats> for cheap in-process lookup.
// Never called with an empty array (caller guards).
async function getMarketStatsBatch(
  marketIds: number[]
): Promise<Map<number, PredictionMarketStats>> {
  const rows = await db
    .select()
    .from(predictionMarketStats)
    .where(inArray(predictionMarketStats.marketId, marketIds));
  return new Map(rows.map(r => [r.marketId, r]));
}

async function upsertMarketStats(
  marketId: number,
  patch:    Partial<Omit<PredictionMarketStats, "id" | "marketId">>
): Promise<void> {
  await db
    .insert(predictionMarketStats)
    .values({ marketId, ...patch })
    .onConflictDoUpdate({
      target: predictionMarketStats.marketId,
      set:    { ...patch, updatedAt: new Date() },
    });
}

// ── Telemetry: update stats on filled order ───────────────────────────────────
// Called in the best-effort block after order fill. Safe to retry — increments
// volume24h with SQL so concurrent calls don't overwrite each other.
//
// isFirstOutcome = outcome.sortOrder === 0 (YES slot in a binary market).
// Snapshot is written separately via insertPriceSnapshot.

async function recordOrderTelemetry(
  marketId:        number,
  isFirstOutcome:  boolean,    // true → update last_price_yes; false → last_price_no
  price:           string,
  totalValue:      string,     // volume_window: the order's total cost (qty × price)
): Promise<void> {
  const priceField = isFirstOutcome
    ? { lastPriceYes: price }
    : { lastPriceNo:  price };

  await db
    .insert(predictionMarketStats)
    .values({
      marketId,
      volume24h: totalValue,
      ...priceField,
    })
    .onConflictDoUpdate({
      target: predictionMarketStats.marketId,
      set: {
        // Cumulative increment — NOT a true 24h rolling window (Sprint 2 approximation).
        // A rolling window requires aggregating orders.createdAt >= now - 24h,
        // which is deferred to Sprint 3.
        volume24h:  sql`${predictionMarketStats.volume24h} + ${totalValue}::numeric`,
        ...priceField,
        updatedAt: new Date(),
      },
    });
}

// ── Market lifecycle audit events ─────────────────────────────────────────────

async function recordMarketEvent(
  input: InsertPredictionMarketEvent
): Promise<PredictionMarketEvent> {
  const [row] = await db
    .insert(predictionMarketEvents)
    .values(input)
    .returning();
  return row;
}

async function listMarketEvents(
  marketId: number
): Promise<PredictionMarketEvent[]> {
  return db
    .select()
    .from(predictionMarketEvents)
    .where(eq(predictionMarketEvents.marketId, marketId))
    .orderBy(predictionMarketEvents.createdAt);
}

// ── Sprint 4 Browse ───────────────────────────────────────────────────────────
// browseMarkets: unified paginated card list with JOIN-based game filter + sort.
// Returns PredictionMarketCard[] (compact DTO) instead of PredictionMarketWithOutcomes[]
// so the shape is stable for the product UI layer.
//
// LEFT JOINs:
//   - prediction_events: enables game filter + event context in each card
//   - prediction_market_stats: enables volume_desc sort + stats in each card
//
// Outcomes fetched in parallel (≤ limit queries) — cannot be easily inlined
// into the main SELECT without a JSON aggregation function.
// ─────────────────────────────────────────────────────────────────────────────

async function browseMarkets(params: BrowseMarketsParams): Promise<{
  cards: PredictionMarketCard[];
  total: number;
}> {
  const {
    statuses: explicitStatuses,
    liveOnly = false,
    game,
    currency,
    eventId,
    sort = "newest",
    page  = 1,
    limit = 20,
  } = params;

  const offset = (page - 1) * limit;

  // ── Browse quality gate ────────────────────────────────────────────────────
  // These conditions are always applied to the browse endpoint.
  // They exclude markets with incomplete or placeholder team/event context
  // so that the browse catalogue shows only clean, user-facing cards.
  //
  // A market must pass ALL of:
  //   1. Have a linked event (LEFT JOIN hit — predictionEvents.id IS NOT NULL)
  //   2. Have a non-empty game on that event
  //   3. teamAName exists and is not a placeholder (TBD / TBA / Unknown / "")
  //   4. teamBName exists and is not a placeholder
  //
  // Note: tournamentName and prices are NOT hard-gated — fallbacks are shown.
  const PLACEHOLDER_TEAM = ["", "TBD", "TBA", "Unknown"] as const;
  const qualityGate = [
    // 1. Event must be linked
    isNotNull(predictionEvents.id),
    // 2. Game must be set
    isNotNull(predictionEvents.game),
    sql`${predictionEvents.game} <> ''`,
    // 3. teamAName must be real
    isNotNull(predictionEvents.teamAName),
    not(inArray(predictionEvents.teamAName, [...PLACEHOLDER_TEAM])),
    // 4. teamBName must be real
    isNotNull(predictionEvents.teamBName),
    not(inArray(predictionEvents.teamBName, [...PLACEHOLDER_TEAM])),
  ];

  // ── WHERE conditions ──────────────────────────────────────────────────────
  const conditions = [...qualityGate];

  if (explicitStatuses && explicitStatuses.length === 1) {
    conditions.push(eq(predictionMarkets.status, explicitStatuses[0]));
  } else if (explicitStatuses && explicitStatuses.length > 1) {
    conditions.push(inArray(predictionMarkets.status, explicitStatuses));
  }
  if (liveOnly) {
    conditions.push(
      or(isNull(predictionMarkets.closeAt), gt(predictionMarkets.closeAt, new Date()))!
    );
  }
  if (currency) conditions.push(eq(predictionMarkets.currency, currency));
  if (eventId)  conditions.push(eq(predictionMarkets.eventId, eventId));
  // game — references the LEFT-JOINed prediction_events table
  if (game) conditions.push(eq(predictionEvents.game, game));

  const where = and(...conditions);

  // ── ORDER BY ──────────────────────────────────────────────────────────────
  // closing_soon: closeAt ASC NULLS LAST (markets with no deadline appear last)
  // volume_desc:  COALESCE(stats.volume24h, 0) DESC (markets with no stats row = 0 vol)
  // newest:       createdAt DESC (default)
  const orderBy =
    sort === "closing_soon"
      ? ([sql`${predictionMarkets.closeAt} ASC NULLS LAST`, desc(predictionMarkets.createdAt)] as const)
      : sort === "volume_desc"
        ? ([sql`COALESCE(${predictionMarketStats.volume24h}, 0) DESC`, desc(predictionMarkets.createdAt)] as const)
        : ([desc(predictionMarkets.createdAt)] as const);

  // ── Main query + count (parallel) ─────────────────────────────────────────
  const [rows, [{ value: total }]] = await Promise.all([
    db
      .select({
        // market identity
        id:                predictionMarkets.id,
        uid:               predictionMarkets.uid,
        slug:              predictionMarkets.slug,
        question:          predictionMarkets.question,
        description:       predictionMarkets.description,
        marketType:        predictionMarkets.marketType,
        currency:          predictionMarkets.currency,
        status:            predictionMarkets.status,
        openAt:            predictionMarkets.openAt,
        closeAt:           predictionMarkets.closeAt,
        resolveAt:         predictionMarkets.resolveAt,
        settledAt:         predictionMarkets.settledAt,
        eventId:           predictionMarkets.eventId,
        createdAt:         predictionMarkets.createdAt,
        // event context (LEFT JOIN — all null if no linked event)
        eventGame:           predictionEvents.game,
        eventTournamentName: predictionEvents.tournamentName,
        eventEventName:      predictionEvents.eventName,
        eventTeamAName:      predictionEvents.teamAName,
        eventTeamBName:      predictionEvents.teamBName,
        eventStartsAt:       predictionEvents.startsAt,
        // stats (LEFT JOIN — null if no stats row yet)
        statsVolume24h:    predictionMarketStats.volume24h,
        statsTraders24h:   predictionMarketStats.traders24h,
        statsLastPriceYes: predictionMarketStats.lastPriceYes,
        statsLastPriceNo:  predictionMarketStats.lastPriceNo,
      })
      .from(predictionMarkets)
      .leftJoin(predictionEvents,     eq(predictionEvents.id,      predictionMarkets.eventId))
      .leftJoin(predictionMarketStats, eq(predictionMarketStats.marketId, predictionMarkets.id))
      .where(where)
      .orderBy(...orderBy)
      .limit(limit)
      .offset(offset),
    db
      .select({ value: count() })
      .from(predictionMarkets)
      .leftJoin(predictionEvents,     eq(predictionEvents.id,      predictionMarkets.eventId))
      .leftJoin(predictionMarketStats, eq(predictionMarketStats.marketId, predictionMarkets.id))
      .where(where),
  ]);

  // ── Outcomes (N parallel queries, N ≤ limit) ──────────────────────────────
  const cards: PredictionMarketCard[] = await Promise.all(
    rows.map(async (row) => {
      const outcomes = await db
        .select()
        .from(predictionOutcomes)
        .where(eq(predictionOutcomes.marketId, row.id))
        .orderBy(asc(predictionOutcomes.sortOrder));

      return {
        marketId:    row.id,
        uid:         row.uid,
        slug:        row.slug ?? null,
        question:    row.question,
        description: row.description ?? null,
        marketType:  row.marketType,
        currency:    row.currency,
        status:      row.status,
        openAt:      row.openAt    ?? null,
        closeAt:     row.closeAt   ?? null,
        resolveAt:   row.resolveAt ?? null,
        settledAt:   row.settledAt ?? null,
        event:
          row.eventId != null && row.eventGame != null
            ? {
                eventId:        row.eventId,
                game:           row.eventGame,
                tournamentName: row.eventTournamentName ?? null,
                eventName:      row.eventEventName      ?? null,
                teamAName:      row.eventTeamAName      ?? null,
                teamBName:      row.eventTeamBName      ?? null,
                startsAt:       row.eventStartsAt       ?? null,
              }
            : null,
        outcomes: outcomes.map((o) => ({
          outcomeId:          o.id,
          code:               o.code             ?? null,
          label:              o.label,
          isWinner:           o.isWinner          ?? false,
          impliedProbability: o.impliedProbability ?? null,
        })),
        stats:
          row.statsVolume24h != null
            ? {
                volume24h:    row.statsVolume24h,
                traders24h:   row.statsTraders24h   ?? 0,
                lastPriceYes: row.statsLastPriceYes ?? null,
                lastPriceNo:  row.statsLastPriceNo  ?? null,
              }
            : null,
      };
    })
  );

  return { cards, total: Number(total) };
}

// browseTabCounts: lightweight single-query aggregation for tab badge counts.
// Applies the SAME quality gate as browseMarkets (event + game + teams).
// Accepts optional game/currency/eventId to match the active filter context.
// Returns counts for all, live, upcoming, resolved in a single SQL round-trip.
async function browseTabCounts(opts: {
  game?:     string;
  currency?: string;
  eventId?:  number;
}): Promise<{ all: number; live: number; upcoming: number; resolved: number }> {
  const PLACEHOLDER_TEAM = ["", "TBD", "TBA", "Unknown"] as const;

  const conditions = [
    isNotNull(predictionEvents.id),
    isNotNull(predictionEvents.game),
    sql`${predictionEvents.game} <> ''`,
    isNotNull(predictionEvents.teamAName),
    not(inArray(predictionEvents.teamAName, [...PLACEHOLDER_TEAM])),
    isNotNull(predictionEvents.teamBName),
    not(inArray(predictionEvents.teamBName, [...PLACEHOLDER_TEAM])),
  ];

  if (opts.game)     conditions.push(eq(predictionEvents.game, opts.game));
  if (opts.currency) conditions.push(eq(predictionMarkets.currency, opts.currency));
  if (opts.eventId)  conditions.push(eq(predictionMarkets.eventId, opts.eventId));

  const where = and(...conditions);

  const [row] = await db
    .select({
      all:      sql<number>`count(*)::int`,
      live:     sql<number>`count(*) FILTER (WHERE ${predictionMarkets.status} = 'open' AND (${predictionMarkets.closeAt} IS NULL OR ${predictionMarkets.closeAt} > now()))::int`,
      upcoming: sql<number>`count(*) FILTER (WHERE ${predictionMarkets.status} = 'draft')::int`,
      resolved: sql<number>`count(*) FILTER (WHERE ${predictionMarkets.status} IN ('settled', 'cancelled', 'resolved'))::int`,
    })
    .from(predictionMarkets)
    .leftJoin(predictionEvents, eq(predictionEvents.id, predictionMarkets.eventId))
    .where(where);

  return {
    all:      row?.all      ?? 0,
    live:     row?.live     ?? 0,
    upcoming: row?.upcoming ?? 0,
    resolved: row?.resolved ?? 0,
  };
}

// ── Home v2: Queue + Media helpers ────────────────────────────────────────────

/**
 * Batch-fetch prediction_events by ID list.
 * Returns only found rows (missing IDs silently omitted).
 */
async function findEventsByIds(ids: number[]): Promise<PredictionEvent[]> {
  if (ids.length === 0) return [];
  return db
    .select()
    .from(predictionEvents)
    .where(inArray(predictionEvents.id, ids));
}

/**
 * Fetch active queue items for a set of surfaces from prediction_display_queue.
 * Filters: is_active=true, surface IN (surfaces), ends_at IS NULL OR ends_at > now().
 * Ordered by surface ASC, position ASC.
 */
async function getQueuedSurfaces(surfaces: string[]): Promise<PredictionDisplayQueueItem[]> {
  if (surfaces.length === 0) return [];
  return db
    .select()
    .from(predictionDisplayQueue)
    .where(
      and(
        eq(predictionDisplayQueue.isActive, true),
        inArray(predictionDisplayQueue.surface, surfaces),
        or(
          isNull(predictionDisplayQueue.endsAt),
          gt(predictionDisplayQueue.endsAt, new Date()),
        )!,
      )
    )
    .orderBy(
      asc(predictionDisplayQueue.surface),
      asc(predictionDisplayQueue.position),
    );
}

/**
 * Resolve media assets for a list of prediction_event IDs.
 * Returns Map<eventId, Record<usageType, publicUrl>>.
 * For each event, only the first row per usage_type (by sort_order ASC) is kept.
 * Fallback chains (hero→banner→card→thumbnail) are applied in the service layer.
 */
async function resolveEventMediaBatch(
  eventIds: number[],
): Promise<Map<number, Record<string, string>>> {
  if (eventIds.length === 0) return new Map();
  const rows = await db
    .select({
      eventId:   predictionEventMedia.predictionEventId,
      usageType: predictionEventMedia.usageType,
      publicUrl: mediaAssets.publicUrl,
    })
    .from(predictionEventMedia)
    .innerJoin(mediaAssets, eq(mediaAssets.id, predictionEventMedia.mediaAssetId))
    .where(
      and(
        inArray(predictionEventMedia.predictionEventId, eventIds),
        eq(mediaAssets.isActive, true),
      )
    )
    .orderBy(asc(predictionEventMedia.sortOrder));

  const map = new Map<number, Record<string, string>>();
  for (const row of rows) {
    const entry = map.get(row.eventId) ?? {};
    if (!entry[row.usageType]) {
      entry[row.usageType] = row.publicUrl;
    }
    map.set(row.eventId, entry);
  }
  return map;
}

// ── Home v2: editorial event enrichment ──────────────────────────────────────

/**
 * For a batch of event IDs, return linked-market metadata:
 * linkedMarketsCount (draft/open/locked) and firstMarketSlug (oldest by createdAt).
 * Reuses the same two-query pattern as getHomeData for upcoming events.
 */
async function findEventMarketMetaByIds(
  eventIds: number[],
): Promise<Map<number, { linkedMarketsCount: number; firstMarketSlug: string | null }>> {
  if (eventIds.length === 0) return new Map();

  const [countRows, slugRows] = await Promise.all([
    db
      .select({ eventId: predictionMarkets.eventId, total: count() })
      .from(predictionMarkets)
      .where(
        and(
          inArray(predictionMarkets.eventId as any, eventIds),
          inArray(predictionMarkets.status, ["draft", "open", "locked"]),
        )
      )
      .groupBy(predictionMarkets.eventId),
    db
      .select({ eventId: predictionMarkets.eventId, slug: predictionMarkets.slug })
      .from(predictionMarkets)
      .where(inArray(predictionMarkets.eventId as any, eventIds))
      .orderBy(asc(predictionMarkets.createdAt)),
  ]);

  const countMap = new Map(countRows.map((r) => [r.eventId!, Number(r.total)]));
  const slugMap  = new Map<number, string | null>();
  for (const r of slugRows) {
    if (r.eventId != null && !slugMap.has(r.eventId)) slugMap.set(r.eventId, r.slug);
  }

  const result = new Map<number, { linkedMarketsCount: number; firstMarketSlug: string | null }>();
  for (const id of eventIds) {
    result.set(id, {
      linkedMarketsCount: countMap.get(id) ?? 0,
      firstMarketSlug:    slugMap.get(id)   ?? null,
    });
  }
  return result;
}

/**
 * For a batch of event IDs, return the first open-or-locked market per event
 * (oldest by createdAt), enriched with outcomes and stats but with event=null
 * (the service layer injects the event entity from its own eventMap).
 */
async function findTradeableMarketsByEventIds(
  eventIds: number[],
): Promise<Map<number, PredictionMarketWithOutcomes>> {
  if (eventIds.length === 0) return new Map();

  const marketRows = await db
    .select()
    .from(predictionMarkets)
    .where(
      and(
        inArray(predictionMarkets.eventId as any, eventIds),
        inArray(predictionMarkets.status, ["open", "locked"]),
      )
    )
    .orderBy(asc(predictionMarkets.createdAt));

  // Keep only the first (oldest) market per event
  const firstByEvent = new Map<number, typeof marketRows[0]>();
  for (const m of marketRows) {
    if (m.eventId != null && !firstByEvent.has(m.eventId)) firstByEvent.set(m.eventId, m);
  }
  if (firstByEvent.size === 0) return new Map();

  const winners    = Array.from(firstByEvent.values());
  const marketIds  = winners.map((m) => m.id);

  const [allOutcomes, allStats] = await Promise.all([
    db
      .select()
      .from(predictionOutcomes)
      .where(inArray(predictionOutcomes.marketId, marketIds))
      .orderBy(asc(predictionOutcomes.sortOrder)),
    db
      .select()
      .from(predictionMarketStats)
      .where(inArray(predictionMarketStats.marketId, marketIds)),
  ]);

  const outcomesByMarket = new Map<number, PredictionOutcome[]>();
  for (const o of allOutcomes) {
    const arr = outcomesByMarket.get(o.marketId) ?? [];
    arr.push(o);
    outcomesByMarket.set(o.marketId, arr);
  }
  const statsByMarket = new Map<number, PredictionMarketStats>();
  for (const s of allStats) statsByMarket.set(s.marketId, s);

  const result = new Map<number, PredictionMarketWithOutcomes>();
  for (const m of winners) {
    result.set(m.eventId!, {
      ...m,
      outcomes: outcomesByMarket.get(m.id) ?? [],
      event:    null,  // injected by service layer from eventMap
      stats:    statsByMarket.get(m.id) ?? null,
    });
  }
  return result;
}

async function findFirstMarketByEventAndType(
  eventId: number,
  marketType: string,
): Promise<PredictionMarket | null> {
  const [row] = await db
    .select()
    .from(predictionMarkets)
    .where(
      and(
        eq(predictionMarkets.eventId, eventId),
        eq(predictionMarkets.marketType, marketType),
      )
    )
    .orderBy(asc(predictionMarkets.createdAt))
    .limit(1);
  return row ?? null;
}

async function listDraftMarketsWithEvent(eventId?: number): Promise<
  Array<{
    market: PredictionMarket;
    event: PredictionEvent | null;
    outcomes: PredictionOutcome[];
  }>
> {
  const conditions = [eq(predictionMarkets.status, "draft")];
  if (eventId) conditions.push(eq(predictionMarkets.eventId, eventId));

  const draftMarkets = await db
    .select()
    .from(predictionMarkets)
    .where(and(...conditions))
    .orderBy(desc(predictionMarkets.createdAt));

  if (draftMarkets.length === 0) return [];

  const results = await Promise.all(
    draftMarkets.map(async (m) => {
      const [event, outcomes] = await Promise.all([
        m.eventId ? findEventById(m.eventId) : Promise.resolve(null),
        db
          .select()
          .from(predictionOutcomes)
          .where(eq(predictionOutcomes.marketId, m.id))
          .orderBy(asc(predictionOutcomes.sortOrder)),
      ]);
      return { market: m, event, outcomes };
    })
  );

  return results;
}

// ── Export ────────────────────────────────────────────────────────────────────

export const predictionRepository = {
  // events
  createEvent,
  findEventById,
  updateEventStatus,
  listEvents,
  // markets
  createMarket,
  findMarketById,
  findMarketBySlug,
  findMarketWithOutcomes,
  listMarkets,
  updateMarketStatus,
  updateMarketPool,
  // outcomes
  findOutcomeById,
  findOutcomesByMarket,
  markOutcomeAsWinner,
  updateOutcomePoolShare,
  // positions
  createPosition,
  findPositionByUserMarketOutcome,
  findActivePositionsByMarket,
  updatePositionForOrder,
  reducePositionForSell,
  findPositionsByUser,
  findPositionsByMarket,
  findEnrichedPositionsByUser,
  countPositionsByStatus,
  findActiveMarketIdsForUser,
  updatePositionStatus,
  // orders
  createOrder,
  findOrderByIdempotencyKey,
  updateOrderStatus,
  findOrdersByUser,
  findOrdersByMarket,
  // auto-lock
  findLockableMarkets,
  // provider resolution batch
  findMarketsEligibleForProviderResolution,
  // settlements
  createSettlement,
  findSettlementByPositionId,
  findSettlementsByMarket,
  // price snapshots
  insertPriceSnapshot,
  getPriceHistory,
  // stats + telemetry
  getMarketStats,
  getMarketStatsBatch,
  upsertMarketStats,
  recordOrderTelemetry,
  // market lifecycle audit events
  recordMarketEvent,
  listMarketEvents,
  // sprint 4 home discovery
  getHomeData,
  // sprint 4 market detail
  getMarketSnapshots,
  getRecentMarketEvents,
  // sprint 4 browse
  browseMarkets,
  browseTabCounts,
  // home v2: queue-driven surfaces + media
  findEventsByIds,
  getQueuedSurfaces,
  resolveEventMediaBatch,
  // home v2: editorial event enrichment
  findEventMarketMetaByIds,
  findTradeableMarketsByEventIds,
  // market auto-creation + admin monitoring
  findFirstMarketByEventAndType,
  listDraftMarketsWithEvent,
};

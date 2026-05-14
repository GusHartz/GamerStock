// ─── Prediction Markets — Domain Types ────────────────────────────────────────
// Internal types for the prediction domain.
// These are distinct from the permanent player-asset market types.
// ─────────────────────────────────────────────────────────────────────────────
import type {
  PredictionMarketStatus,
  PredictionPositionStatus,
  PredictionOrderStatus,
  PredictionOrderSide,
  PredictionOrderType,
  PredictionMarketType,
  PredictionEvent,
  PredictionMarket,
  PredictionOutcome,
  PredictionPosition,
  PredictionOrder,
  PredictionSettlement,
  PredictionPriceSnapshot,
  PredictionMarketStats,
} from "@shared/schema";

export type {
  PredictionMarketStatus,
  PredictionPositionStatus,
  PredictionOrderStatus,
  PredictionOrderSide,
  PredictionOrderType,
  PredictionMarketType,
  PredictionEvent,
  PredictionMarket,
  PredictionOutcome,
  PredictionPosition,
  PredictionOrder,
  PredictionSettlement,
  PredictionPriceSnapshot,
  PredictionMarketStats,
};

// ── Composite read shapes ─────────────────────────────────────────────────────

export interface PredictionMarketWithOutcomes extends PredictionMarket {
  outcomes: PredictionOutcome[];
  event:    PredictionEvent | null;
  stats:    PredictionMarketStats | null;
}

// ── Create / update payloads ──────────────────────────────────────────────────

export interface CreatePredictionEventInput {
  title:          string;
  tournamentName?: string;
  eventName?:     string;
  game?:          string;
  region?:        string;
  eventType?:     string;
  teamAName?:     string;
  teamBName?:     string;
  startsAt?:      Date;
  externalRef?:   string;
  metadata?:      Record<string, unknown>;
}

export interface CreatePredictionMarketInput {
  eventId?:         number;
  slug?:            string;
  question:         string;
  description?:     string;
  marketType?:      PredictionMarketType;
  currency?:        "GS" | "USDC";
  minStake?:        string;
  maxStake?:        string;
  openAt?:          Date;
  closeAt?:         Date;
  resolutionSource?: string;
  createdByUserId?: string;
  outcomes: Array<{
    label:              string;
    code?:              string;
    description?:       string;
    sortOrder?:         number;
    impliedProbability?: string;
    metadata?:          Record<string, unknown>;
  }>;
}

export interface TransitionMarketStatusInput {
  marketId:          number;
  targetStatus:      PredictionMarketStatus;
  resolvedOutcomeId?: number;
  actorUserId:       string;
}

// ── Sprint 1 legacy bet stub — delegates to placeOrder ────────────────────────

export interface PlacePredictionBetInput {
  userId:    string;
  marketId:  number;
  outcomeId: number;
  stake:     string;
  currency:  "GS" | "USDC";
}

// ── Phase 2: executeMarketTrade — new BUY flow (amountUsd-driven) ─────────────

/**
 * Input for the new BUY-only MARKET trade endpoint (POST /api/predictions/trades).
 *
 * Differences from PlaceOrderInput:
 *   - amountUsd is the primary input; shares are derived server-side.
 *   - Price is resolved server-side from outcome data / market stats.
 *   - sideId maps directly to outcomeId (prediction_outcome row).
 */
export interface ExecuteTradeInput {
  userId:         string;
  marketId:       number;
  /** The outcome/side the user wants to trade — maps to prediction_outcomes.id */
  sideId:         number;
  /** BUY increases position; SELL reduces an existing position (no short selling). */
  action:         "BUY" | "SELL";
  orderType:      "MARKET";
  /**
   * For BUY:  GS$ amount to spend. shares = amountUsd / executedPrice.
   * For SELL: GS$ amount of proceeds desired. sharesToSell = amountUsd / executedPrice.
   */
  amountUsd:      number;
  idempotencyKey: string;
}

export interface TradePositionSummary {
  positionId:    number;
  outcomeId:     number;
  outcomeCode:   string | null;
  outcomeLabel:  string;
  sharesHeld:    string;
  avgPrice:      string;
  costBasis:     string;
}

export interface TradeWalletSummary {
  currency:         string;
  availableBalance: string;
}

export interface ExecuteTradeResult {
  orderId:          number;
  positionId:       number;
  marketId:         number;
  sideId:           number;
  action:           "BUY" | "SELL";
  orderType:        "MARKET";
  amountUsd:        string;
  executedPrice:    string;
  shares:           string;
  status:           string;
  idempotencyKey:   string;
  duplicate:        boolean;
  /** Realized PnL for this specific trade (null on BUY; set on SELL). */
  realizedPnl:      string | null;
  position:         TradePositionSummary;
  wallet:           TradeWalletSummary;
}

// ── Sprint 2: Prediction order placement ──────────────────────────────────────

export interface PlaceOrderInput {
  userId:         string;
  marketId:       number;
  outcomeId:      number;
  side:           "buy";
  orderType:      "market";
  quantity:       string;
  price:          string;
  currency:       "GS" | "USDC";
  idempotencyKey?: string;
}

export interface PlaceOrderResult {
  orderId:         number;
  positionId:      number;
  totalValue:      string;
  currency:        string;
  walletLedgerRef: string;
  status:          string;
  idempotencyKey:  string;
  duplicate:       boolean;
}

// ── Sprint 2: Market resolution + settlement ──────────────────────────────────

export interface ResolveMarketInput {
  marketId:          number;
  winningOutcomeId:  number;
  actorUserId:       string;
  resolutionSource?: string;
  note?:             string;
}

export interface PositionSettlementRecord {
  positionId:      number;
  userId:          string;
  outcomeId:       number;
  isWinner:        boolean;
  costBasis:       string;
  grossPayout:     string;
  fees:            string;
  netPayout:       string;
  walletLedgerRef: string;
  settlementId:    number;
  skipped:         boolean;    // true when settlement row already existed (idempotent retry)
}

export interface ResolveAndSettleResult {
  marketId:          number;
  winningOutcomeId:  number;
  status:            string;   // final market status after settlement
  duplicate:         boolean;  // true if market was already fully settled
  positionsSettled:  number;
  positionsSkipped:  number;   // already-settled positions skipped on retry
  totalWinnerPayout: string;
  totalStakeConsumed: string;
  settlements:       PositionSettlementRecord[];
}

// ── Sprint 3: Market cancellation + refund ────────────────────────────────────

export interface CancelMarketInput {
  marketId:   number;
  actorUserId: string;
  reason?:    string;
  note?:      string;
}

export interface PositionCancelRecord {
  positionId:      number;
  userId:          string;
  costBasis:       string;         // amount unlocked back to user
  walletLedgerRef: string;
  settlementId:    number;         // audit row in prediction_settlements
  skipped:         boolean;        // true on idempotent retry (row already existed)
}

export interface CancelAndRefundResult {
  marketId:           number;
  status:             string;      // final market status (always "cancelled")
  duplicate:          boolean;     // true if market was already cancelled
  positionsCancelled: number;
  positionsSkipped:   number;
  totalRefunded:      string;      // sum of costBasis unlocked
  currency:           string;
  cancellations:      PositionCancelRecord[];
}

// ── Position upsert ───────────────────────────────────────────────────────────

export interface UpsertPositionParams {
  userId:             string;
  marketId:           number;
  outcomeId:          number;
  additionalQuantity: string;
  additionalCostBasis: string;
  currency:           string;
  walletLedgerRef:    string;
}

// ── Service result shapes ─────────────────────────────────────────────────────

export interface PredictionServiceResult<T = void> {
  success: boolean;
  data?:   T;
  error?:  string;
}

// ── List / pagination ─────────────────────────────────────────────────────────

export interface PredictionMarketListParams {
  status?:   PredictionMarketStatus;
  statuses?: string[];               // multi-status filter (resolved = settled|cancelled)
  eventId?:  number;
  currency?: string;
  liveOnly?: boolean;                // adds closeAt > now OR closeAt IS NULL condition
  page?:     number;
  limit?:    number;
}

// ── Product-oriented read DTOs (Sprint 3 Read APIs) ──────────────────────────
//
// These types define the public shapes returned by the product-facing read
// endpoints (live, upcoming, resolved, me/positions, me/history).
//
// The market list shape reuses PredictionMarketWithOutcomes (already rich).
// The position/history shapes are new enriched projections from a single
// SQL JOIN query (no N+1) over positions → markets → outcomes → events.

export interface PredictionMarketCard {
  marketId:    number;
  uid:         string;
  slug:        string | null;
  question:    string;
  description: string | null;
  marketType:  string;
  currency:    string;
  status:      string;
  openAt:      Date | string | null;
  closeAt:     Date | string | null;
  resolveAt:   Date | string | null;
  settledAt:   Date | string | null;
  event: {
    eventId:        number;
    game:           string;
    tournamentName: string | null;
    eventName:      string | null;
    teamAName:      string | null;
    teamBName:      string | null;
    startsAt:       Date | string | null;
  } | null;
  outcomes: Array<{
    outcomeId:          number;
    code:               string | null;
    label:              string;
    isWinner:           boolean;
    impliedProbability: string | null;
  }>;
  stats: {
    volume24h:    string;
    traders24h:   number;
    lastPriceYes: string | null;
    lastPriceNo:  string | null;
  } | null;
}

// ── Enriched position (raw JOIN result from repository) ───────────────────────

export interface EnrichedPosition {
  // position fields
  id:          number;
  userId:      string;
  marketId:    number;
  outcomeId:   number;
  quantity:    string | null;
  avgPrice:    string | null;
  costBasis:   string | null;
  stake:       string | null;
  currency:    string;
  status:      string;
  payout:      string | null;
  realizedPnl: string | null;
  payoutAt:    Date | null;
  cancelledAt: Date | null;   // Sprint 4.5 — explicit cancellation timestamp; null for legacy rows
  createdAt:   Date;
  updatedAt:   Date;
  // market join
  marketQuestion:  string;
  marketSlug:      string | null;
  marketStatus:    string;
  marketCurrency:  string;
  marketType:      string;
  marketCloseAt:   Date | null;
  marketResolveAt: Date | null;
  marketSettledAt: Date | null;
  // outcome join (left — always found in practice since FK is NOT NULL)
  outcomeLabel:     string | null;
  outcomeCode:      string | null;
  outcomeSortOrder: number | null; // 0 = first tradable slot, 1 = second slot (side-agnostic)
  // event join (left — null if market has no event)
  eventId:             number | null;
  eventGame:           string | null;
  eventTournamentName: string | null;
  eventEventName:      string | null;
  eventTeamAName:      string | null;
  eventTeamBName:      string | null;
  eventStartsAt:       Date | null;
}

// ── UserPositionCard — active positions for me/positions ──────────────────────

export interface UserPositionCard {
  positionId:   number;
  marketId:     number;
  marketTitle:  string;
  marketSlug:   string | null;
  marketStatus: string;
  marketType:   string;
  currency:     string;
  marketCloseAt: Date | string | null;
  event: {
    eventId:        number;
    game:           string;
    tournamentName: string | null;
    eventName:      string | null;
    teamAName:      string | null;
    teamBName:      string | null;
    startsAt:       Date | string | null;
  } | null;
  outcome: {
    outcomeId: number;
    code:      string | null;
    label:     string;
  } | null;
  quantity:    string | null;
  avgPrice:    string | null;
  costBasis:   string | null;
  stake:       string | null;
  status:      string;
  createdAt:   Date | string;
}

// ── UserHistoryCard — settled/cancelled positions for me/history ───────────────

export interface UserHistoryCard extends UserPositionCard {
  payout:         string | null;
  realizedPnl:    string | null;
  payoutAt:       Date | string | null;
  marketSettledAt: Date | string | null;
}

export interface PredictionMarketPage {
  markets: PredictionMarketWithOutcomes[];
  total:   number;
  page:    number;
  limit:   number;
}

export interface PredictionEventListParams {
  game?:   string;
  status?: string;
  limit?:  number;
}

// ── Sprint 3 Admin Surface ────────────────────────────────────────────────────

// Normalized envelope returned by all admin lifecycle mutation routes.
// All five mutations (open / lock / resolve / cancel / generic-transition)
// return this shape so a future admin UI can handle them uniformly.
export interface AdminMutationResponse {
  ok:             boolean;
  action:         string;         // "open" | "lock" | "resolve" | "cancel" | "transition"
  marketId:       number;
  previousStatus: string;         // status of the market BEFORE the mutation
  newStatus:      string;         // status of the market AFTER the mutation
  duplicate?:     boolean;        // true on idempotent retry of already-settled/cancelled
  // resolve-specific
  winningOutcomeId?:  number;
  positionsSettled?:  number;
  positionsSkipped?:  number;
  totalWinnerPayout?: string;
  // cancel-specific
  positionsCancelled?: number;
  totalRefunded?:      string;
  currency?:           string;
  // miscellaneous
  note?:               string;
}

// ── Sprint 4 Home Discovery Read Model ────────────────────────────────────────
//
// Lightweight card types for the GET /api/predictions/home aggregation.
// Each card is UI-ready with just enough context for a discovery/home screen.
// No heavy joins — all data comes from columns already fetched by listMarkets.

/** Shared event context block used by live and trending cards */
export interface HomeEventContext {
  eventId:        number;
  game:           string;
  tournamentName: string | null;
  eventName:      string | null;
  teamAName:      string | null;
  teamBName:      string | null;
  startsAt:       Date | string | null;
}

/** Shared stats summary used by live and trending cards */
export interface HomeStatsContext {
  volume24h:    string;
  traders24h:   number;
  lastPriceYes: string | null;
  lastPriceNo:  string | null;
}

/** Shared outcome stub used by live and trending cards */
export interface HomeOutcomeStub {
  outcomeId:  number;
  code:       string | null;
  label:      string;
  poolShare:  string;
}

/** Card for liveMatches section: open market with event + timer context */
export interface LiveMatchCard {
  marketId:  number;
  uid:       string;
  slug:      string | null;
  question:  string;
  status:    "open";
  currency:  string;
  openAt:    Date | string | null;
  closeAt:   Date | string | null;
  outcomes:  HomeOutcomeStub[];
  stats:     HomeStatsContext | null;
  event:     HomeEventContext | null;
}

/**
 * Card for trendingPredictions section.
 * Extends LiveMatchCard shape but status may be "open" | "locked" | "settled".
 * trendingLabel is a cheap derived signal — "high_volume" | "recently_settled" |
 * "action_locked" | "active".
 */
export interface TrendingCard {
  marketId:      number;
  uid:           string;
  slug:          string | null;
  question:      string;
  status:        string;
  currency:      string;
  openAt:        Date | string | null;
  closeAt:       Date | string | null;
  outcomes:      HomeOutcomeStub[];
  stats:         HomeStatsContext | null;
  event:         HomeEventContext | null;
  trendingLabel: string;
}

/** Card for upcomingEvents section: event row with linked market metadata */
export interface UpcomingEventCard {
  eventId:            number;
  uid:                string;
  title:              string;
  game:               string;
  region:             string | null;
  tournamentName:     string | null;
  eventName:          string | null;
  teamAName:          string | null;
  teamBName:          string | null;
  startsAt:           Date | string | null;
  linkedMarketsCount: number;
  firstMarketSlug:    string | null;
}

/**
 * Full home response shape for GET /api/predictions/home.
 * hotPlayers is always null — hot player discovery is owned by the player
 * domain (GET /api/riot/players) and is not part of the prediction domain.
 */
export interface PredictionHomeResponse {
  liveMatches:         LiveMatchCard[];
  trendingPredictions: TrendingCard[];
  upcomingEvents:      UpcomingEventCard[];
  hotPlayers:          null;
  generatedAt:         string;
  totalLive:           number;
  publicSurfaces:      HomePublicSurfaces;
}

// ── Home v2 — Queue-driven editorial surfaces ─────────────────────────────────
// Added in Sprint 3.5 / Home evolution.
// prediction_display_queue drives hero, featuredEvents, livePredictions,
// and upcomingEventsEditorial. Legacy fields above are preserved.

/** Resolved media URLs for a prediction_event, derived from prediction_event_media + media_assets. */
export interface EventMediaUrls {
  heroImageUrl:  string | null;   // fallback chain: hero → banner → card → thumbnail
  cardImageUrl:  string | null;   // fallback chain: card → thumbnail
  thumbnailUrl:  string | null;
}

/**
 * One curated slot from prediction_display_queue, enriched with the resolved
 * event entity and its media. Used by hero, featuredEvents, upcomingEventsEditorial.
 */
export interface EditorialEventCard {
  queueId:        number;               // prediction_display_queue.id (0 = synthetic fallback)
  surface:        string;               // the surface this item came from (or fallback sentinel)
  position:       number;
  curationLabel:  string | null;
  entityType:     string;               // "event" | "market" | …
  entityId:       number;
  event:          UpcomingEventCard | null;   // resolved prediction_event (null if not found)
  media:          EventMediaUrls;
  market:         LiveMatchCard | null;       // first open/locked market for this event (null if none)
}

/** The queue-driven surfaces block returned inside PredictionHomeResponse. */
export interface HomePublicSurfaces {
  hero:                    EditorialEventCard | null;
  heroMarket:              LiveMatchCard | null;   // first tradeable market for the hero event
  featuredEvents:          EditorialEventCard[];
  livePredictions:         LiveMatchCard[];       // open markets; queue-linked events come first
  upcomingEventsEditorial: EditorialEventCard[];
}

// ── Sprint 4 Market Detail Read Model ────────────────────────────────────────
//
// Types for GET /api/predictions/markets/:idOrSlug/detail.
// Composed from: market + outcomes + event + stats + snapshots + lifecycle events
// + position counts + availableActions + userCanTrade.

/** A single price-series tick for one outcome */
export interface PriceSnapshotPoint {
  outcomeId:    number;
  price:        string;
  volumeWindow: string | null;
  recordedAt:   Date | string;
}

/** A single row from the lifecycle audit trail */
export interface MarketLifecycleEvent {
  eventType:  string;
  fromStatus: string | null;
  toStatus:   string | null;
  source:     string | null;
  note:       string | null;
  createdAt:  Date | string;
}

/** Outcome card with all fields relevant to a detail view */
export interface DetailOutcomeCard {
  outcomeId:          number;
  code:               string | null;
  label:              string;
  description:        string | null;
  isWinner:           boolean;
  poolShare:          string;
  impliedProbability: string | null;
  payoutValue:        string | null;
  sortOrder:          number;
}

/**
 * Full market detail response — GET /api/predictions/markets/:idOrSlug/detail
 * Sections: identity · event · outcomes · stats · recentSnapshots ·
 *           recentEvents · positionCounts · availableActions · userCanTrade
 */
export interface MarketDetailResponse {
  // 1. Market identity
  marketId:          number;
  uid:               string;
  slug:              string | null;
  question:          string;
  description:       string | null;
  status:            string;
  marketType:        string;
  currency:          string;
  openAt:            Date | string | null;
  closeAt:           Date | string | null;
  resolveAt:         Date | string | null;
  settledAt:         Date | string | null;
  resolvedOutcomeId: number | null;
  createdAt:         Date | string;

  // 2. Event context
  event: {
    eventId:        number;
    game:           string;
    tournamentName: string | null;
    eventName:      string | null;
    teamAName:      string | null;
    teamBName:      string | null;
    startsAt:       Date | string | null;
    eventStatus:    string;
  } | null;

  // 3. Outcomes
  outcomes: DetailOutcomeCard[];

  // 4. Stats summary
  stats: {
    volume24h:    string;
    traders24h:   number;
    lastPriceYes: string | null;
    lastPriceNo:  string | null;
    updatedAt:    Date | string | null;
  } | null;

  // 5. Recent price snapshots (ordered recordedAt DESC, all outcomes)
  recentSnapshots: PriceSnapshotPoint[];
  snapshotLimit:   number;    // max rows fetched (50 by default)

  // 6. Lifecycle timeline (ordered createdAt DESC, last 10)
  recentEvents: MarketLifecycleEvent[];
  eventLimit:   number;       // max rows fetched (10 by default)

  // 7. Operational summary
  positionCounts: {
    active:    number;
    settled:   number;
    cancelled: number;
    total:     number;
  };
  availableActions: string[];
  userCanTrade:     boolean;  // true when status=open AND (closeAt IS NULL OR closeAt > now())
}

// ── Sprint 4 Browse Endpoint ──────────────────────────────────────────────────

export type BrowseTab  = "all" | "live" | "upcoming" | "resolved";
export type BrowseSort = "closing_soon" | "newest" | "volume_desc";

// Validated constant sets used by both the route layer and tests.
export const BROWSE_VALID_TABS     = ["all", "live", "upcoming", "resolved"] as const;
export const BROWSE_VALID_SORTS    = ["closing_soon", "newest", "volume_desc"] as const;
export const BROWSE_VALID_STATUSES = ["draft", "open", "locked", "resolved", "settled", "cancelled"] as const;

// Default sort per browse context:
//   all      → newest        (broad catalogue, most recent first)
//   live     → closing_soon  (most urgent first)
//   upcoming → newest        (latest draft first)
//   resolved → newest        (most recently resolved first)
//   explicit → newest        (no semantic ordering implied)
export const BROWSE_DEFAULT_SORT: Record<string, BrowseSort> = {
  all:      "newest",
  live:     "closing_soon",
  upcoming: "newest",
  resolved: "newest",
  explicit: "newest",
};

export interface BrowseMarketsParams {
  tab?:      BrowseTab;      // live | upcoming | resolved
  statuses?: string[];       // explicit DB statuses — takes precedence over tab
  liveOnly?: boolean;        // set by service: closeAt > now OR closeAt IS NULL
  game?:     string;         // filter by prediction_events.game; markets with no event excluded
  currency?: string;
  eventId?:  number;
  sort?:     BrowseSort;     // closing_soon | newest | volume_desc
  page?:     number;
  limit?:    number;
  // Sprint 4.5 user overlay — optional; when provided, each card receives
  // userHasPosition reflecting whether the user has an ACTIVE position in that market.
  userId?:   string;
}

// ── Browse-specific card type ─────────────────────────────────────────────────
// Extends PredictionMarketCard with a user-position overlay field.
// Only returned by GET /api/predictions/browse — not used by other endpoints,
// so the base PredictionMarketCard type remains untouched.
//
// userHasPosition semantics:
//   true  → the authenticated user has at least one ACTIVE position in this market
//   false → no active position (user may have had settled/cancelled positions)
//
// Settled and cancelled positions do NOT make this true. The field represents
// current open exposure, not historical participation.
export interface BrowseMarketCard extends PredictionMarketCard {
  userHasPosition: boolean;
}

export interface BrowseTabCounts {
  all:      number;
  live:     number;
  upcoming: number;
  resolved: number;
}

export interface BrowseMarketsResponse {
  page:   number;
  limit:  number;
  total:  number;
  tab:    BrowseTab | null;  // null when explicit statuses[] override tab
  counts: BrowseTabCounts;  // quality-gate-filtered counts per tab
  appliedFilters: {
    statuses: string[];      // effective status list applied to query (empty = all)
    game:     string | null;
    currency: string | null;
    eventId:  number | null;
    sort:     BrowseSort;
  };
  markets: BrowseMarketCard[];
}

// ── Sprint 4 / 4.5 Portfolio Response Model ──────────────────────────────────
// GET /api/predictions/me/portfolio
// Read-model composition over existing position + history data.
// Sprint 4.5 adds a mark-to-market overlay using prediction_market_stats.
// No new DB tables. No wallet coupling. UI/indicative values only.
// ─────────────────────────────────────────────────────────────────────────────

// One entry in the outcomesHeld array inside an ActiveMarketPositionGroup.
export interface HeldOutcome {
  positionId:   number;
  outcomeId:    number;
  outcomeCode:  string | null;
  outcomeLabel: string;
  quantity:     string | null;
  avgPrice:     string | null;
  costBasis:    string | null;
  status:       string;               // always "active" in this context
  // ── Sprint 4.5 mark-to-market overlay ────────────────────────────────────
  // Source: prediction_market_stats.last_price_yes / last_price_no.
  // Mapping: outcome.sortOrder === 0 → lastPriceYes (first slot);
  //          outcome.sortOrder  >  0 → lastPriceNo  (second slot).
  // Side-agnostic: works for YES/NO, Team A/Team B, or any binary pair.
  // All three are null when: market has no stats row or price slot is null.
  currentPrice:   string | null;   // indicative last traded price for this outcome
  marketValue:    string | null;   // quantity × currentPrice (2 dp)
  unrealizedPnl:  string | null;   // marketValue - costBasis (2 dp); positive = gain
  // ── Sprint 4.5 price freshness ─────────────────────────────────────────────
  // prediction_market_stats.updated_at at the time of this portfolio request.
  // null when currentPrice is null (no stats row or unrecognized outcome code).
  pricedAt:       Date | null;     // when the pricing source (stats row) was last updated
}

// Aggregated view of all active positions for a single market.
export interface ActiveMarketPositionGroup {
  marketId:    number;
  marketSlug:  string | null;
  marketTitle: string;
  marketStatus: string;
  marketType:  string;
  currency:    string;
  closeAt:     Date | string | null;
  userCanTrade: boolean;             // status=open and (closeAt is null OR closeAt > now)
  event: {
    eventId:        number;
    game:           string;
    tournamentName: string | null;
    eventName:      string | null;
    teamAName:      string | null;
    teamBName:      string | null;
    startsAt:       Date | string | null;
  } | null;
  outcomesHeld:     HeldOutcome[];
  totalQuantity:    number;          // sum of numeric quantity across outcomesHeld
  totalCostBasis:   string;          // sum(costBasis) formatted as numeric string (2 dp)
  // ── Sprint 4.5 mark-to-market overlay ────────────────────────────────────
  // Summed across outcomesHeld where unrealizedPnl is non-null.
  // If any outcome in the group has no pricing (currentPrice=null), the group
  // aggregate covers only the priced subset; hasPartialPricing=true signals this.
  unrealizedPnl:     string | null;  // sum of priced outcome unrealizedPnl (2 dp)
  totalMarketValue:  string | null;  // sum of priced outcome marketValue (2 dp)
  hasPartialPricing: boolean;        // true if any held outcome has currentPrice=null
  // ── Sprint 4.5 price freshness ─────────────────────────────────────────────
  // prediction_market_stats.updated_at for this market.
  // null when hasPartialPricing=true (some outcomes lack pricing) or no stats row.
  // Rule: conservative — if the group cannot be fully priced, pricedAt is suppressed.
  pricedAt:          Date | null;
}

// One row in the recentHistory section.
export interface RecentPredictionHistoryItem {
  positionId:   number;
  marketId:     number;
  marketTitle:  string;
  marketSlug:   string | null;
  outcomeId:    number;
  outcomeCode:  string | null;
  outcomeLabel: string;
  status:       string;              // "settled" | "cancelled"
  payout:       string | null;
  realizedPnl:  string | null;
  payoutAt:     Date | string | null;
  cancelledAt:  Date | string | null; // non-null only for cancelled; sourced from updatedAt
}

// Aggregate summary for the portfolio header.
export interface PredictionPortfolioSummary {
  activeMarkets:     number;   // distinct market count with at least 1 active position
  activePositions:   number;   // total active position rows
  settledPositions:  number;   // rows with status=settled
  cancelledPositions: number;  // rows with status=cancelled
  openExposure:      string;         // sum(costBasis) for active positions (2 dp)
  realizedPnl:       string;         // sum(realizedPnl) for settled positions only (2 dp)
  totalPayout:       string;         // sum(payout) for settled positions (2 dp)
  totalRefunded:     string;         // sum(costBasis) for cancelled positions (2 dp)
  currency:          string;         // "GS" — monomorphic in current model
  // ── Sprint 4.5 mark-to-market overlay ──────────────────────────────────────
  // Sum of unrealizedPnl across all active market groups where pricing exists.
  // null when the user has no active positions with available pricing.
  // INDICATIVE ONLY — does not affect wallet, ledger, or settlement.
  unrealizedPnl:     string | null;  // sum of group unrealizedPnl (2 dp, priced subset)
  hasPartialPricing: boolean;        // true if any active market group has partial/missing pricing
  // ── Sprint 4.5 price freshness ──────────────────────────────────────────────
  // Most recent stats.updatedAt across all fully-priced active market groups.
  // Tells the client how old the freshest price snapshot is.
  // null when no active group has a non-null pricedAt (all pricing partial or missing).
  latestPricingAt:   Date | null;
}

// Top-level portfolio response envelope.
export interface PredictionPortfolioResponse {
  summary:               PredictionPortfolioSummary;
  activeMarketPositions: ActiveMarketPositionGroup[];
  recentHistory:         RecentPredictionHistoryItem[];
  meta: {
    generatedAt:       string;   // ISO timestamp
    historyLimit:      number;   // constant — how many history rows were returned
    hasMoreHistory:    boolean;  // true if total history rows > historyLimit
    isEmpty:           boolean;  // true when user has no positions at all
  };
}

// Compact operational snapshot for the admin-summary endpoint.
export interface AdminMarketSummary {
  marketId:          number;
  uid:               string;
  slug:              string | null;
  question:          string;
  description:       string | null;
  status:            string;
  marketType:        string;
  currency:          string;
  resolvedOutcomeId: number | null;
  openAt:            Date | string | null;
  closeAt:           Date | string | null;
  resolveAt:         Date | string | null;
  settledAt:         Date | string | null;
  createdAt:         Date | string;
  event:             PredictionEvent | null;
  outcomes:          PredictionOutcome[];
  stats:             PredictionMarketStats | null;
  positionCounts: {
    active:    number;
    settled:   number;
    cancelled: number;
    total:     number;
  };
  availableActions: string[];
  recentEventsUrl:  string;      // pointer to GET /api/predictions/markets/:id/events
}

// ─── Player Public Domain — Types ────────────────────────────────────────────
// Read model for the public-facing player asset page.
// Never expose internal IDs, operational data, or claim state.
// ─────────────────────────────────────────────────────────────────────────────

export type TrendStatus = "up" | "down" | "flat" | "unknown";

// ── Hero ──────────────────────────────────────────────────────────────────────

export interface PublicHero {
  assetId:        number;
  playerName:     string;
  gameName:       string;
  tagline:        string | null;
  status:         string | null;
  cardImageUrl:   string | null;
  bannerImageUrl: string | null;
  holdersTotal:   number;
  volumeTotal:    number;
  /** lastTradePrice — used as price fallback when AMM quote is unavailable. */
  unitPrice:      number;
}

// ── CTA ───────────────────────────────────────────────────────────────────────

export interface PublicCta {
  primaryLabel:   string;
  secondaryLabel: string | null;
  canSupport:     boolean;
}

// ── Social Proof ──────────────────────────────────────────────────────────────

export interface PublicSocialProof {
  holdersTotal:        number;
  recentActivityCount: number;
  newSupportersLabel:  string | null;
}

// ── Market Signals ────────────────────────────────────────────────────────────

export interface PublicMarketSignals {
  holdersTotal: number;
  volumeTotal:  number;
  trendStatus:  TrendStatus;
}

// ── Mission ───────────────────────────────────────────────────────────────────

export type PublicMissionStatus = "active" | "completed" | "upcoming";

export interface PublicMission {
  id:           string;
  title:        string;
  description:  string | null;
  progress:     number | null;   // 0–100 percentage
  target:       number | null;   // raw goal value
  rewardLabel:  string | null;
  endsAt:       string | null;   // ISO string
  status:       PublicMissionStatus;
}

// ── Moments ───────────────────────────────────────────────────────────────────

export type PublicMomentStatus = "live" | "sold_out" | "upcoming";

export interface PublicMoment {
  id:          string;
  title:       string;
  description: string | null;
  imageUrl:    string | null;
  rarity:      string | null;
  price:       number | null;
  supply:      number | null;
  sold:        number | null;
  soldPct:     number | null;    // 0–100
  status:      PublicMomentStatus;
}

// ── Activity ──────────────────────────────────────────────────────────────────

export type PublicActivityType = "buy" | "support" | "moment_purchase" | "holder_joined";

export interface PublicActivityEvent {
  id:          string;
  type:        PublicActivityType;
  label:       string;
  maskedUser:  string;
  createdAt:   string;           // ISO string
  valueLabel:  string | null;
}

// ── Community ─────────────────────────────────────────────────────────────────

export interface PublicCommunity {
  totalHolders: number;
  message:      string;
}

// ── Performance History ───────────────────────────────────────────────────────

export type PerfRange  = "7d" | "30d" | "90d";
export type PerfMetric = "price" | "volume" | "momentum";

export interface PerfPoint {
  date:  string;   // "YYYY-MM-DD"
  value: number;
}

export type PerfDataSource = "snapshots" | "trades" | "empty";

export interface PerformanceHistoryResponse {
  assetId:    number;
  metric:     PerfMetric;
  range:      PerfRange;
  /** Where the data came from — useful for the UI to show a context note. */
  dataSource: PerfDataSource;
  points:     PerfPoint[];
}

// ── Overview (root shape) ─────────────────────────────────────────────────────

export interface PlayerPublicOverview {
  assetId:       number;
  assetUid:      string;
  hero:          PublicHero;
  cta:           PublicCta;
  socialProof:   PublicSocialProof;
  marketSignals: PublicMarketSignals;
  mission:       PublicMission | null;
  moments:       PublicMoment[];
  activity:      PublicActivityEvent[];
  community:     PublicCommunity;
}

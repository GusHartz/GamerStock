export interface HomeApiOutcomeStub {
  outcomeId: number;
  code:      string;
  label:     string;
  poolShare: string | null;
}

export interface HomeApiStats {
  lastPriceYes: string | null;
  lastPriceNo:  string | null;
}

export interface HomeApiEventContext {
  eventId:        number;
  game:           string;
  tournamentName: string | null;
  eventName:      string | null;
  teamAName:      string | null;
  teamBName:      string | null;
  startsAt:       string | null;
}

export interface HomeApiMarketCard {
  marketId:      number;
  uid:           string;
  slug:          string | null;
  question:      string;
  status:        string;
  currency:      string;
  openAt:        string | null;
  closeAt:       string | null;
  outcomes:      HomeApiOutcomeStub[];
  stats:         HomeApiStats | null;
  event:         HomeApiEventContext | null;
  trendingLabel?: string;
}

export interface HomeApiUpcomingEvent {
  eventId:        number;
  uid:            string;
  title:          string | null;
  game:           string;
  region?:        string;
  tournamentName: string | null;
  eventName:      string | null;
  teamAName:      string | null;
  teamBName:      string | null;
  startsAt:       string | null;
  linkedMarketsCount?: number;
  firstMarketSlug?:    string | null;
}

export interface HomeApiMediaUrls {
  heroImageUrl: string | null;
  cardImageUrl: string | null;
  thumbnailUrl: string | null;
}

export interface HomeApiEditorialEvent {
  queueId:       number;
  surface:       string;
  position:      number;
  curationLabel: string | null;
  entityType:    string;
  entityId:      number;
  event:         HomeApiUpcomingEvent | null;
  media:         HomeApiMediaUrls;
  market?:       HomeApiMarketCard | null;
}

export interface HomeApiPublicSurfaces {
  hero:                    HomeApiEditorialEvent | null;
  heroMarket:              HomeApiMarketCard | null;
  featuredEvents:          HomeApiEditorialEvent[];
  livePredictions:         HomeApiMarketCard[];
  upcomingEventsEditorial: HomeApiEditorialEvent[];
}

export interface HomeApiResponse {
  generatedAt:         string;
  liveMatches:         HomeApiMarketCard[];
  trendingPredictions: HomeApiMarketCard[];
  upcomingEvents:      HomeApiUpcomingEvent[];
  hotPlayers:          null;
  totalLive:           number;
  publicSurfaces?:     HomeApiPublicSurfaces;
}

export interface MarketCardVM {
  marketId:          number;
  slug:              string | null;
  question:          string;
  status:            string;
  currency:          string;
  closeAt:           string | null;
  yesPrice:          number | null;
  noPrice:           number | null;
  yesProb:           number | null;
  teamAName:         string | null;
  teamBName:         string | null;
  tournamentName:    string | null;
  eventName:         string | null;
  game:              string | null;
  startsAt:          string | null;
  trendingLabel?:    string;
  backgroundImageUrl?: string | null;
  teamALogoUrl?:     string | null;
  teamBLogoUrl?:     string | null;
  participants?:     number | null;
  volumeLabel?:      string | null;
  /** outcomeId for the YES/first side — used for click-to-trade */
  yesId:             number | null;
  /** outcomeId for the NO/second side — used for click-to-trade */
  noId:              number | null;
}

export interface UpcomingEventVM {
  eventId:          number;
  game:             string;
  tournamentName:   string | null;
  eventName:        string | null;
  teamAName:        string | null;
  teamBName:        string | null;
  startsAt:         string | null;
  firstMarketSlug?: string | null;
  imageUrl?:        string | null;
  market?:          MarketCardVM | null;
}

export interface FeaturedEventVM {
  queueId:        number;
  eventId:        number;
  game:           string;
  tournamentName: string | null;
  eventName:      string | null;
  teamAName:      string | null;
  teamBName:      string | null;
  startsAt:       string | null;
  firstMarketSlug: string | null;
  imageUrl:       string | null;
  curationLabel:  string | null;
  market?:        MarketCardVM | null;
}

export interface TradeMarketAssetVM {
  id:          number;
  assetUid:    string;
  displayName: string;
  price:       number;
  change24hPct: number | null;
  volume24h:   number;
  game:        string;
  region:      string | null;
}

export interface HotPlayerVM {
  id:          string;
  slug:        string;
  name:        string;
  price:       number;
  change24h:   number;
  volumeLabel: string;
  imageUrl:    string | null;
  bgGradient:  string | null;
}

export interface PulseMessageVM {
  id:   string;
  text: string;
  type: "price" | "volume" | "info" | "live";
}

export interface HomeViewModel {
  heroEvent:         UpcomingEventVM | null;
  upcomingEvents:    UpcomingEventVM[];
  featuredEvents:    FeaturedEventVM[];
  pulse:             PulseMessageVM[];
  generatedAt:       string;
  totalLive:         number;
}

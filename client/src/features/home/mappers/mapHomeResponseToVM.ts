import type {
  HomeApiResponse,
  HomeApiMarketCard,
  HomeApiEditorialEvent,
  HomeViewModel,
  MarketCardVM,
  UpcomingEventVM,
  FeaturedEventVM,
  PulseMessageVM,
} from "../types/home";

/**
 * Convert a raw HomeApiMarketCard (from /api/predictions/home) to MarketCardVM.
 * Preserves outcome IDs so that prediction cards can open the Trade Sheet inline.
 */
export function mapApiMarketToCardVM(m: HomeApiMarketCard): MarketCardVM {
  const yesOutcome = m.outcomes.find(o => o.code === "yes" || o.code === "TEAM_A") ?? m.outcomes[0] ?? null;
  const noOutcome  = m.outcomes.find(o => o.code === "no"  || o.code === "TEAM_B") ?? m.outcomes[1] ?? null;

  const yesPrice = m.stats?.lastPriceYes != null ? parseFloat(m.stats.lastPriceYes) : null;
  const noPrice  = m.stats?.lastPriceNo  != null ? parseFloat(m.stats.lastPriceNo)  : null;
  const yesProb  = yesPrice != null ? Math.round(yesPrice * 100) : null;

  return {
    marketId:       m.marketId,
    slug:           m.slug,
    question:       m.question,
    status:         m.status,
    currency:       m.currency,
    closeAt:        m.closeAt,
    yesPrice,
    noPrice,
    yesProb,
    teamAName:      m.event?.teamAName      ?? null,
    teamBName:      m.event?.teamBName      ?? null,
    tournamentName: m.event?.tournamentName ?? null,
    eventName:      m.event?.eventName      ?? null,
    game:           m.event?.game           ?? null,
    startsAt:       m.event?.startsAt       ?? null,
    trendingLabel:  m.trendingLabel,
    yesId:          yesOutcome?.outcomeId   ?? null,
    noId:           noOutcome?.outcomeId    ?? null,
  };
}

function editorialToUpcomingVM(ed: HomeApiEditorialEvent): UpcomingEventVM | null {
  if (!ed.event) return null;
  const ev = ed.event;
  const imgUrl = ed.media.heroImageUrl ?? ed.media.cardImageUrl ?? ed.media.thumbnailUrl ?? null;
  return {
    eventId:         ev.eventId,
    game:            ev.game,
    tournamentName:  ev.tournamentName,
    eventName:       ev.eventName,
    teamAName:       ev.teamAName,
    teamBName:       ev.teamBName,
    startsAt:        ev.startsAt,
    firstMarketSlug: ev.firstMarketSlug ?? null,
    imageUrl:        imgUrl,
    market:          ed.market ? mapApiMarketToCardVM(ed.market) : null,
  };
}

function editorialToFeaturedVM(ed: HomeApiEditorialEvent): FeaturedEventVM | null {
  if (!ed.event) return null;
  const ev = ed.event;
  const imgUrl = ed.media.heroImageUrl ?? ed.media.cardImageUrl ?? ed.media.thumbnailUrl ?? null;
  return {
    queueId:        ed.queueId,
    eventId:        ev.eventId,
    game:           ev.game,
    tournamentName: ev.tournamentName,
    eventName:      ev.eventName,
    teamAName:      ev.teamAName,
    teamBName:      ev.teamBName,
    startsAt:       ev.startsAt,
    firstMarketSlug: ev.firstMarketSlug ?? null,
    imageUrl:        imgUrl,
    curationLabel:   ed.curationLabel,
    market:          ed.market ? mapApiMarketToCardVM(ed.market) : null,
  };
}

export function buildPulseMessages(api: HomeApiResponse): PulseMessageVM[] {
  const msgs: PulseMessageVM[] = [];
  const allMarkets: HomeApiMarketCard[] = [...api.liveMatches, ...api.trendingPredictions];

  for (const m of allMarkets.slice(0, 12)) {
    const yesPrice = m.stats?.lastPriceYes ? parseFloat(m.stats.lastPriceYes) : null;
    const noPrice  = m.stats?.lastPriceNo  ? parseFloat(m.stats.lastPriceNo)  : null;

    if (yesPrice != null) {
      const prob    = Math.round(yesPrice * 100);
      const subject = m.event?.teamAName
        ? `${m.event.teamAName} win`
        : m.question.length > 50 ? m.question.slice(0, 50) + "…" : m.question;
      msgs.push({ id: `price-yes-${m.marketId}`, text: `${subject} · YES at ${prob}%`, type: "price" });
    }

    if (noPrice != null) {
      const prob    = Math.round(noPrice * 100);
      const subject = m.event?.teamBName
        ? `${m.event.teamBName} win`
        : m.question.length > 50 ? m.question.slice(0, 50) + "…" : m.question;
      msgs.push({ id: `price-no-${m.marketId}`, text: `${subject} · NO at ${prob}%`, type: "price" });
    }
  }

  if (api.liveMatches.length > 0) {
    msgs.unshift({
      id:   "live-count",
      text: `${api.liveMatches.length} LIVE market${api.liveMatches.length > 1 ? "s" : ""} open now`,
      type: "live",
    });
  }

  if (msgs.length === 0) {
    msgs.push({ id: "empty", text: "No active prediction markets at this time — check back soon", type: "info" });
  }

  return msgs;
}

export function mapHomeResponseToVM(api: HomeApiResponse): HomeViewModel {
  const ps = api.publicSurfaces;

  // ── Hero editorial event (queue "hero") ──────────────────────────────────────
  let heroEvent: UpcomingEventVM | null = null;
  if (ps?.hero) {
    heroEvent = editorialToUpcomingVM(ps.hero);
  }
  if (!heroEvent && api.upcomingEvents.length > 0) {
    const first = api.upcomingEvents[0];
    heroEvent = {
      eventId:         first.eventId,
      game:            first.game,
      tournamentName:  first.tournamentName,
      eventName:       first.eventName,
      teamAName:       first.teamAName,
      teamBName:       first.teamBName,
      startsAt:        first.startsAt,
      firstMarketSlug: first.firstMarketSlug ?? null,
      imageUrl:        null,
    };
  }

  // ── Upcoming events (queue "upcoming") ───────────────────────────────────────
  const upcomingEvents: UpcomingEventVM[] = [];
  if (ps?.upcomingEventsEditorial?.length) {
    for (const ed of ps.upcomingEventsEditorial) {
      const vm = editorialToUpcomingVM(ed);
      if (vm) upcomingEvents.push(vm);
    }
  }
  if (upcomingEvents.length === 0) {
    for (const ev of api.upcomingEvents.slice(0, 4)) {
      upcomingEvents.push({
        eventId:         ev.eventId,
        game:            ev.game,
        tournamentName:  ev.tournamentName,
        eventName:       ev.eventName,
        teamAName:       ev.teamAName,
        teamBName:       ev.teamBName,
        startsAt:        ev.startsAt,
        firstMarketSlug: ev.firstMarketSlug ?? null,
        imageUrl:        null,
      });
    }
  }

  // ── Featured events (queue "featured") ───────────────────────────────────────
  const featuredEvents: FeaturedEventVM[] = [];
  if (ps?.featuredEvents?.length) {
    for (const ed of ps.featuredEvents) {
      const vm = editorialToFeaturedVM(ed);
      if (vm) featuredEvents.push(vm);
    }
  }

  return {
    heroEvent,
    upcomingEvents,
    featuredEvents,
    pulse:       buildPulseMessages(api),
    generatedAt: api.generatedAt,
    totalLive:   api.totalLive,
  };
}

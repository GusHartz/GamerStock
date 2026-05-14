// ─── External Resolution Context Service ─────────────────────────────────────
// Read-only service that assembles the full resolution context for a
// MATCH_WINNER prediction market by correlating internal data with the
// PandaScore API.
//
// NO writes, NO wallet mutations, NO trade execution, NO settlement.
// Safe to call repeatedly — pure read + external HTTP.
// ─────────────────────────────────────────────────────────────────────────────

import { predictionRepository }    from "../repository";
import { PandaScoreClient }        from "../../ingestion/providers/pandascore/pandascoreClient";
import type { PandaScoreOpponent } from "../../ingestion/providers/pandascore/pandascoreClient";
import {
  parseExternalRef,
  isPandaScoreRef,
} from "../utils/externalRefParser";

// ── Output types ──────────────────────────────────────────────────────────────

export interface ResolutionContextOutcome {
  outcomeId:          number;
  code:               string | null;
  label:              string;
  side:               string | null;
  externalOpponentId: string | null;
}

export interface ExternalMatchResolutionContext {
  marketId:         number;
  marketSlug:       string | null;
  marketStatus:     string;

  provider:         string;
  eventExternalRef: string;
  matchId:          string;

  matchStatus:      string;
  winnerId:         number | null;
  winnerType:       string | null;

  opponents: Array<{
    id:       number;
    name:     string;
    acronym:  string | null;
    type:     string;
  }>;

  outcomes: ResolutionContextOutcome[];

  matchedWinningOutcomeId:   number | null;
  matchedWinningOutcomeCode: string | null;
}

// ── Error types ───────────────────────────────────────────────────────────────

export class ResolutionContextError extends Error {
  constructor(
    public readonly code:
      | "MARKET_NOT_FOUND"
      | "NO_EVENT"
      | "NO_EXTERNAL_REF"
      | "UNSUPPORTED_PROVIDER"
      | "PANDASCORE_ERROR",
    message: string,
  ) {
    super(message);
    this.name = "ResolutionContextError";
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

/**
 * Loads the external resolution context for a given MATCH_WINNER market.
 *
 * Steps:
 *  1. Load market + event + outcomes from the DB.
 *  2. Parse event.externalRef for PANDASCORE:<matchId>.
 *  3. Fetch the live match data from PandaScore.
 *  4. Correlate winner_id with outcome.metadata.externalOpponentId.
 *  5. Return the consolidated context — no side effects.
 *
 * Throws ResolutionContextError for domain errors (missing market, no ref, etc.)
 * Throws the underlying HTTP error from PandaScoreClient for API failures.
 */
export const getExternalMatchResolutionContext = async (
  marketId: number,
): Promise<ExternalMatchResolutionContext> => {

  // ── 1. Load internal data ───────────────────────────────────────────────
  const mwo = await predictionRepository.findMarketWithOutcomes(marketId);
  if (!mwo) {
    throw new ResolutionContextError("MARKET_NOT_FOUND", `Market #${marketId} not found`);
  }

  const event = mwo.event;
  if (!event) {
    throw new ResolutionContextError(
      "NO_EVENT",
      `Market #${marketId} has no linked prediction_event`,
    );
  }

  // ── 2. Parse externalRef ─────────────────────────────────────────────────
  const metaSourceId = (event.metadata as Record<string, unknown> | null)?.sourceEventId;
  const parsed = parseExternalRef(
    event.externalRef,
    typeof metaSourceId === "string" ? metaSourceId : null,
  );

  if (!parsed) {
    throw new ResolutionContextError(
      "NO_EXTERNAL_REF",
      `Event #${event.id} has no parseable externalRef (value: ${JSON.stringify(event.externalRef)})`,
    );
  }

  if (!isPandaScoreRef(parsed)) {
    throw new ResolutionContextError(
      "UNSUPPORTED_PROVIDER",
      `Provider "${parsed.provider}" is not supported — only PANDASCORE is handled`,
    );
  }

  // ── 3. Fetch from PandaScore ─────────────────────────────────────────────
  let psMatch;
  try {
    const client = new PandaScoreClient();
    psMatch = await client.getMatchById(parsed.matchId);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ResolutionContextError(
      "PANDASCORE_ERROR",
      `PandaScore fetch failed for matchId "${parsed.matchId}": ${msg}`,
    );
  }

  // ── 4. Map internal outcomes with their external metadata ────────────────
  const outcomes: ResolutionContextOutcome[] = mwo.outcomes.map((o) => {
    const meta = o.metadata as Record<string, unknown> | null;
    return {
      outcomeId:          o.id,
      code:               o.code,
      label:              o.label,
      side:               typeof meta?.side === "string" ? meta.side : null,
      externalOpponentId: typeof meta?.externalOpponentId === "string"
                            ? meta.externalOpponentId
                            : null,
    };
  });

  // ── 5. Infer winning outcome (if winner is known) ────────────────────────
  const winnerId = psMatch.winner?.id ?? null;
  let matchedWinningOutcomeId:   number | null = null;
  let matchedWinningOutcomeCode: string | null = null;

  if (winnerId != null) {
    const winnerIdStr = String(winnerId);
    const matched = outcomes.find(
      (o) => o.externalOpponentId === winnerIdStr,
    );
    if (matched) {
      matchedWinningOutcomeId   = matched.outcomeId;
      matchedWinningOutcomeCode = matched.code;
    }
  }

  // ── 6. Map PandaScore opponents ──────────────────────────────────────────
  const opponents = (psMatch.opponents ?? []).map((op: PandaScoreOpponent) => ({
    id:      op.opponent.id,
    name:    op.opponent.name,
    acronym: op.opponent.acronym,
    type:    op.type,
  }));

  return {
    marketId:         mwo.id,
    marketSlug:       mwo.slug,
    marketStatus:     mwo.status,

    provider:         parsed.provider,
    eventExternalRef: event.externalRef ?? `PANDASCORE:${parsed.matchId}`,
    matchId:          parsed.matchId,

    matchStatus:  psMatch.status,
    winnerId,
    winnerType:   psMatch.winner?.type ?? null,

    opponents,
    outcomes,

    matchedWinningOutcomeId,
    matchedWinningOutcomeCode,
  };
};

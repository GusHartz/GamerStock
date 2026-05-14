// ─── PandaScore Ingestion Service ─────────────────────────────────────────────
// Responsibility: orchestrate client + mapper.
// Fetches raw PandaScore matches, maps to NormalizedCandidateEvent[], and
// returns them to the caller. No persistence, no deduplication, no routing.
// ─────────────────────────────────────────────────────────────────────────────

import type { NormalizedCandidateEvent } from "../../types/normalized-candidate-event";
import { PandaScoreClient, type PandaScoreMatchListParams } from "./pandascoreClient";
import { mapPandaScoreMatchToNormalizedCandidateEvent } from "./pandascoreMapper";

// ── fetchInventory options ────────────────────────────────────────────────────

export interface FetchInventoryParams extends PandaScoreMatchListParams {
  includeUpcoming?: boolean;
  includeRunning?:  boolean;
  includePast?:     boolean;
}

// ── Service ───────────────────────────────────────────────────────────────────

export class PandaScoreIngestionService {
  private readonly client: PandaScoreClient;

  constructor(client?: PandaScoreClient) {
    // Allow injecting a custom client (e.g. in tests); defaults to env-keyed client.
    this.client = client ?? new PandaScoreClient();
  }

  // ── Individual fetch methods ──────────────────────────────────────────────

  async fetchUpcoming(
    params?: PandaScoreMatchListParams
  ): Promise<NormalizedCandidateEvent[]> {
    const raw = await this.client.getUpcomingMatches(params);
    return this.normalise(raw);
  }

  async fetchRunning(
    params?: PandaScoreMatchListParams
  ): Promise<NormalizedCandidateEvent[]> {
    const raw = await this.client.getRunningMatches(params);
    return this.normalise(raw);
  }

  async fetchPast(
    params?: PandaScoreMatchListParams
  ): Promise<NormalizedCandidateEvent[]> {
    const raw = await this.client.getPastMatches(params);
    return this.normalise(raw);
  }

  // ── Combined fetch ────────────────────────────────────────────────────────

  /**
   * Fetches from one or more endpoints according to the flags provided,
   * maps everything to NormalizedCandidateEvent, deduplicates by dedupeKey,
   * and returns the merged array.
   *
   * Default (no flags): fetches upcoming + running.
   */
  async fetchInventory(
    params: FetchInventoryParams = {}
  ): Promise<NormalizedCandidateEvent[]> {
    const {
      includeUpcoming = true,
      includeRunning  = true,
      includePast     = false,
      ...listParams
    } = params;

    const calls: Promise<NormalizedCandidateEvent[]>[] = [];

    if (includeUpcoming) calls.push(this.fetchUpcoming(listParams));
    if (includeRunning)  calls.push(this.fetchRunning(listParams));
    if (includePast)     calls.push(this.fetchPast(listParams));

    const batches    = await Promise.all(calls);
    const merged     = batches.flat();

    // Deduplicate by dedupeKey within this fetch (not against the DB).
    const seen = new Set<string>();
    return merged.filter((event) => {
      if (seen.has(event.dedupeKey)) return false;
      seen.add(event.dedupeKey);
      return true;
    });
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  /** Maps raw PandaScore matches to NormalizedCandidateEvent, dropping nulls. */
  private normalise(
    raw: Awaited<ReturnType<PandaScoreClient["getUpcomingMatches"]>>
  ): NormalizedCandidateEvent[] {
    return raw
      .map(mapPandaScoreMatchToNormalizedCandidateEvent)
      .filter((e): e is NormalizedCandidateEvent => e !== null);
  }
}

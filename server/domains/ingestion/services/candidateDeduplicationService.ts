// ─── Candidate Deduplication Service ─────────────────────────────────────────
// Responsibility: identify groups of candidates that represent the same
// real-world match event, select a canonical representative per group,
// and return a structured, auditable result.
//
// Schema note (Sprint 2 — Etapa 6):
//   prediction_event_candidates has NO dedup-persistence fields
//   (no canonicalCandidateId, duplicateOfCandidateId, dedupeStatus, etc.).
//   As a result, this service performs ANALYSIS ONLY and returns a structured
//   DeduplicationResult. No rows are updated or deleted.
//   Persistent dedup markers should be added to the schema in a future sprint.
//
// Deduplication rules (deterministic, two-pass):
//   1. Exact rule   — same dedupeKey (physically impossible in DB due to
//                     unique constraint, but useful for pre-persistence checks)
//   2. Fingerprint  — same gameCode + sorted normalised team pair +
//                     scheduledStartAt within a configurable time window
//                     (default: 120 minutes)
//
// Canonical selection: lowest database id wins (earliest ingested, stable).
// ─────────────────────────────────────────────────────────────────────────────

import type { PredictionEventCandidate } from "../../../../shared/schema/ingestion";
import { candidateRepository } from "../repository/candidateRepository";

// ── Public types ──────────────────────────────────────────────────────────────

export type DuplicateReason = "exact_dedupe_key" | "fingerprint_match";

export interface DuplicateCandidateGroup {
  /** The candidate chosen to represent the group (lowest id). */
  canonicalId:     number;
  /** All candidate IDs in the group, including the canonical. */
  allIds:          number[];
  /** IDs that are considered duplicates (allIds minus canonicalId). */
  duplicateIds:    number[];
  /** Human-readable fingerprint string that produced this group. */
  matchFingerprint: string;
  reason:          DuplicateReason;
}

export interface CanonicalCandidateDecision {
  candidateId: number;
  isCanonical: boolean;
  canonicalId: number;
  groupFingerprint: string;
  reason: DuplicateReason;
}

export interface DeduplicationResult {
  analyzedCount:                 number;
  groupsFound:                   number;
  totalDuplicatesFound:          number;
  groups:                        DuplicateCandidateGroup[];
  /**
   * Always false for Sprint 2.
   * Persistent dedup fields (canonicalCandidateId, etc.) do not exist in the
   * current schema. Add them in a future migration to enable persisted marking.
   */
  schemaSupportsPersistedDedupe: false;
  note:                          string;
}

// ── Filters ───────────────────────────────────────────────────────────────────

export interface DeduplicationFilters {
  /** Restrict analysis to a specific game (e.g. "cs2", "lol"). */
  gameCode?:         string;
  /** Max candidates to load from DB (default: 1000). */
  limit?:            number;
  /** Time window in minutes within which two matches are considered the same event. Default: 120. */
  timeWindowMinutes?: number;
}

// ── Internal fingerprinting helpers ──────────────────────────────────────────

const TWO_HOURS_MS = 120 * 60 * 1000;

/** Normalises a team name for comparison: lowercase, trim, collapse whitespace. */
function normaliseTeamName(name: string | null | undefined): string {
  if (!name) return "__unknown__";
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Returns a stable team-pair key regardless of which team is A or B.
 * Teams are sorted alphabetically so (FURIA, NAVI) === (NAVI, FURIA).
 */
function teamPairKey(a: string | null | undefined, b: string | null | undefined): string {
  const na = normaliseTeamName(a);
  const nb = normaliseTeamName(b);
  return [na, nb].sort().join("__vs__");
}

/**
 * Builds the base fingerprint for a candidate (game + teams).
 * Time is handled separately during clustering.
 */
function baseFingerprint(c: PredictionEventCandidate): string {
  return `${c.gameCode}::${teamPairKey(c.teamAName, c.teamBName)}`;
}

/**
 * Groups candidates by fingerprint, then within each fingerprint group
 * clusters by time proximity (within timeWindowMs).
 *
 * Returns only clusters with 2+ members (genuine duplicate groups).
 */
function clusterByFingerprintAndTime(
  candidates: PredictionEventCandidate[],
  timeWindowMs: number
): DuplicateCandidateGroup[] {
  // Phase 1: group by (gameCode + team pair)
  const byFingerprint = new Map<string, PredictionEventCandidate[]>();

  for (const c of candidates) {
    // Skip candidates where we cannot compute a meaningful fingerprint
    if (!c.gameCode) continue;
    const fp = baseFingerprint(c);
    const bucket = byFingerprint.get(fp) ?? [];
    bucket.push(c);
    byFingerprint.set(fp, bucket);
  }

  const groups: DuplicateCandidateGroup[] = [];

  // Phase 2: within each fingerprint group, sub-cluster by time
  for (const [fp, members] of Array.from(byFingerprint.entries())) {
    if (members.length < 2) continue; // no duplicates possible in a singleton

    // Sort by scheduledStartAt nulls-last, then by id for stability
    const withTime  = members.filter((c: PredictionEventCandidate) => c.scheduledStartAt != null);
    const noTime    = members.filter((c: PredictionEventCandidate) => c.scheduledStartAt == null);

    // Cluster timed candidates using a greedy sliding-window approach
    const timedSorted = [...withTime].sort((a: PredictionEventCandidate, b: PredictionEventCandidate) => {
      const ta = new Date(a.scheduledStartAt!).getTime();
      const tb = new Date(b.scheduledStartAt!).getTime();
      return ta - tb || a.id - b.id;
    });

    const timedClusters: PredictionEventCandidate[][] = [];
    for (const c of timedSorted) {
      const t = new Date(c.scheduledStartAt!).getTime();
      // Try to extend an existing cluster
      let placed = false;
      for (const cluster of timedClusters) {
        const clusterStart = new Date(cluster[0].scheduledStartAt!).getTime();
        if (t - clusterStart <= timeWindowMs) {
          cluster.push(c);
          placed = true;
          break;
        }
      }
      if (!placed) timedClusters.push([c]);
    }

    // Add multi-member timed clusters as duplicate groups
    for (const cluster of timedClusters) {
      if (cluster.length < 2) continue;
      const sortedIds = cluster.map((c) => c.id).sort((a, b) => a - b);
      groups.push({
        canonicalId:      sortedIds[0],
        allIds:           sortedIds,
        duplicateIds:     sortedIds.slice(1),
        matchFingerprint: fp,
        reason:           "fingerprint_match",
      });
    }

    // Candidates with no time info: group them together if there are 2+
    if (noTime.length >= 2) {
      const sortedIds = noTime.map((c) => c.id).sort((a, b) => a - b);
      groups.push({
        canonicalId:      sortedIds[0],
        allIds:           sortedIds,
        duplicateIds:     sortedIds.slice(1),
        matchFingerprint: `${fp}::no_time`,
        reason:           "fingerprint_match",
      });
    }
  }

  return groups;
}

/**
 * Detects exact dedupeKey duplicates in a pre-persistence array of candidates.
 * (In the DB this is impossible due to the unique constraint — useful for
 * validating a batch before calling upsertManyCandidates.)
 */
function detectExactDupeKeys(
  candidates: PredictionEventCandidate[]
): DuplicateCandidateGroup[] {
  const byKey = new Map<string, PredictionEventCandidate[]>();
  for (const c of candidates) {
    const bucket = byKey.get(c.dedupeKey) ?? [];
    bucket.push(c);
    byKey.set(c.dedupeKey, bucket);
  }

  const groups: DuplicateCandidateGroup[] = [];
  for (const [key, members] of Array.from(byKey.entries())) {
    if (members.length < 2) continue;
    const sortedIds = members.map((c: PredictionEventCandidate) => c.id).sort((a: number, b: number) => a - b);
    groups.push({
      canonicalId:      sortedIds[0],
      allIds:           sortedIds,
      duplicateIds:     sortedIds.slice(1),
      matchFingerprint: key,
      reason:           "exact_dedupe_key",
    });
  }
  return groups;
}

// ── Service ───────────────────────────────────────────────────────────────────

export class CandidateDeduplicationService {

  /**
   * Loads candidates from DB and identifies duplicate groups.
   * Returns groups ordered by canonicalId asc.
   */
  async findDuplicateGroups(
    filters: DeduplicationFilters = {}
  ): Promise<DuplicateCandidateGroup[]> {
    const timeWindowMs = (filters.timeWindowMinutes ?? 120) * 60 * 1000;

    const candidates = await candidateRepository.findCandidatesForAnalysis({
      gameCode: filters.gameCode,
      limit:    filters.limit,
    });

    const exactGroups       = detectExactDupeKeys(candidates);
    const fingerprintGroups = clusterByFingerprintAndTime(candidates, timeWindowMs);

    // Merge: exact-key matches take priority; remove any fingerprint group
    // that is a subset of an exact-key group (shouldn't happen in DB, but be safe).
    const exactIds = new Set(exactGroups.flatMap((g) => g.allIds));
    const uniqueFingerprintGroups = fingerprintGroups.filter(
      (g) => !g.allIds.every((id) => exactIds.has(id))
    );

    return [...exactGroups, ...uniqueFingerprintGroups].sort(
      (a, b) => a.canonicalId - b.canonicalId
    );
  }

  /**
   * Runs the full deduplication analysis and returns a structured result.
   *
   * SCHEMA LIMITATION: This service does not persist dedup decisions because
   * prediction_event_candidates lacks the required columns
   * (canonicalCandidateId, duplicateOfCandidateId, dedupeStatus).
   * Add those columns in a future migration to enable persisted marking.
   */
  async applyDeduplication(
    filters: DeduplicationFilters = {}
  ): Promise<DeduplicationResult> {
    const candidates = await candidateRepository.findCandidatesForAnalysis({
      gameCode: filters.gameCode,
      limit:    filters.limit,
    });

    const groups = await this.findDuplicateGroups(filters);

    const totalDuplicatesFound = groups.reduce(
      (sum, g) => sum + g.duplicateIds.length,
      0
    );

    return {
      analyzedCount:                candidates.length,
      groupsFound:                  groups.length,
      totalDuplicatesFound,
      groups,
      schemaSupportsPersistedDedupe: false,
      note:
        "Deduplication analysis complete. No rows were modified. " +
        "To persist canonical decisions, add canonicalCandidateId / " +
        "dedupeStatus columns to prediction_event_candidates in a future migration.",
    };
  }
}

// ── Singleton export ──────────────────────────────────────────────────────────
export const candidateDeduplicationService = new CandidateDeduplicationService();

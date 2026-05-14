/**
 * Fase 9: Dota2 Listing Eligibility Service
 *
 * Evaluates whether a player's Dota2 asset is ready for terminal listing.
 * Produces a structured, auditable readiness snapshot covering all criteria.
 *
 * Design principles:
 *   - Read-only: this service NEVER mutates state
 *   - Auditable: every check is named, thresholded, and recorded
 *   - Governance: readiness ≠ listing. Listing requires separate admin approval.
 *   - Value ≠ Price: playerValue is a fundamental estimate, not a market price
 */

import * as repo from "./repository.js";

// ── Thresholds ────────────────────────────────────────────────────────────────
// Pragmatic minimums for a reliable initial listing.
// All thresholds are named constants for auditability and future tuning.
export const LISTING_THRESHOLDS = {
  rankedMatches:      10,   // min ranked matches in eligibility snapshot
  eligibleAnalytics:  10,   // min match analytics passing eligibility
  performanceScores:  10,   // min computed performance scores
  minConfidenceScore: 0.55, // minimum ConfidenceScore (0..1)
  minPlayerValue:     0.01, // playerValue must be a positive number
} as const;

// ── Check result type ─────────────────────────────────────────────────────────
export interface ListingCheck {
  name:       string;
  pass:       boolean;
  actual:     number | string | boolean | null;
  threshold?: number | string;
  note?:      string;
}

export interface ListingReadinessSnapshot {
  assetId:     number;
  profileId:   number;
  game:        string;
  evaluatedAt: string;
  isReady:     boolean;
  failingChecks: string[];
  checks:      ListingCheck[];
  thresholds:  typeof LISTING_THRESHOLDS;
}

// ── Evaluator ─────────────────────────────────────────────────────────────────

export async function evaluateDota2ListingReadiness(
  userId: string,
): Promise<ListingReadinessSnapshot> {
  const profiles = await repo.findPlayerProfilesByUser(userId);
  const profile  = profiles.find(p => p.game === "dota2");
  if (!profile) throw Object.assign(new Error("DOTA2_PROFILE_NOT_FOUND"), { status: 404 });

  const asset = await repo.findAssetByPlayerProfileId(profile.id);
  if (!asset) throw Object.assign(new Error("DOTA2_ASSET_NOT_FOUND"), { status: 404 });

  const checks: ListingCheck[] = [];
  const n = (v: any) => parseFloat(String(v ?? 0)) || 0;

  // ── C1: Connected account (steam/dota2) ────────────────────────────────────
  const connectedAccounts = await repo.findConnectedAccountsByUser(userId);
  const steamAccount = connectedAccounts.find(
    a => a.providerGroup === "steam" || a.game === "dota2",
  );
  checks.push({
    name:   "hasConnectedSteamAccount",
    pass:   !!steamAccount,
    actual: !!steamAccount,
    note:   steamAccount ? undefined : "No Steam/Dota2 connected account found",
  });

  // ── C2: Player profile exists ─────────────────────────────────────────────
  checks.push({
    name:   "hasPlayerProfile",
    pass:   true,
    actual: profile.id,
    note:   `Profile id=${profile.id}`,
  });

  // ── C3: Asset exists ──────────────────────────────────────────────────────
  checks.push({
    name:   "hasAsset",
    pass:   true,
    actual: asset.id,
    note:   `Asset id=${asset.id} uid=${asset.assetUid}`,
  });

  // ── C4: Eligibility snapshot exists ──────────────────────────────────────
  const snap = await repo.findLatestEligibilitySnapshot(profile.id);
  checks.push({
    name:   "hasEligibilitySnapshot",
    pass:   !!snap,
    actual: snap ? snap.id : null,
    note:   snap ? `Snapshot id=${snap.id}` : "No eligibility snapshot found",
  });

  // ── C5: Ranked matches met ────────────────────────────────────────────────
  const rankedMatches = snap ? n(snap.sampleSize) : 0;
  checks.push({
    name:      "rankedMatchesMet",
    pass:      rankedMatches >= LISTING_THRESHOLDS.rankedMatches,
    actual:    rankedMatches,
    threshold: LISTING_THRESHOLDS.rankedMatches,
    note:      snap ? undefined : "Snapshot missing — counted as 0",
  });

  // ── C6: Eligible analytics met ────────────────────────────────────────────
  const eligibleAnalytics = await repo.countEligibleAnalyticsByProfile(profile.id);
  checks.push({
    name:      "eligibleAnalyticsMet",
    pass:      eligibleAnalytics >= LISTING_THRESHOLDS.eligibleAnalytics,
    actual:    eligibleAnalytics,
    threshold: LISTING_THRESHOLDS.eligibleAnalytics,
  });

  // ── C7: Performance scores met ────────────────────────────────────────────
  const performanceScoreCount = await repo.countDota2PerformanceScores(profile.id);
  checks.push({
    name:      "performanceScoresMet",
    pass:      performanceScoreCount >= LISTING_THRESHOLDS.performanceScores,
    actual:    performanceScoreCount,
    threshold: LISTING_THRESHOLDS.performanceScores,
  });

  // ── C8: Valuation state exists ────────────────────────────────────────────
  const valuation = await repo.getDota2ValuationState(asset.id);
  checks.push({
    name:   "hasValuationState",
    pass:   !!valuation,
    actual: !!valuation,
    note:   valuation ? `v${valuation.valuationVersion}` : "Run bootstrap-valuation first",
  });

  // ── C9: Confidence score meets minimum ────────────────────────────────────
  const confidenceScore = valuation ? n(valuation.confidenceScore) : 0;
  checks.push({
    name:      "confidenceScoreMet",
    pass:      valuation != null && confidenceScore >= LISTING_THRESHOLDS.minConfidenceScore,
    actual:    confidenceScore,
    threshold: LISTING_THRESHOLDS.minConfidenceScore,
    note:      !valuation ? "No valuation state — score defaults to 0" : undefined,
  });

  // ── C10: Player value exists and is positive ──────────────────────────────
  const playerValue = valuation ? n(valuation.playerValue) : 0;
  checks.push({
    name:      "hasPlayerValue",
    pass:      valuation != null && playerValue >= LISTING_THRESHOLDS.minPlayerValue,
    actual:    playerValue,
    threshold: LISTING_THRESHOLDS.minPlayerValue,
    note:      !valuation ? "No valuation state" : undefined,
  });

  const failingChecks = checks.filter(c => !c.pass).map(c => c.name);
  const isReady       = failingChecks.length === 0;

  return {
    assetId:      asset.id,
    profileId:    profile.id,
    game:         "dota2",
    evaluatedAt:  new Date().toISOString(),
    isReady,
    failingChecks,
    checks,
    thresholds: LISTING_THRESHOLDS,
  };
}

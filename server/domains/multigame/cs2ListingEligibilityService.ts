/**
 * CS2 Listing Eligibility Service (updated: Fase 3)
 *
 * Evaluates whether a player's CS2 asset is ready for terminal listing.
 * Mirrors the structure of dota2ListingEligibilityService but adapted for the
 * CS2 pipeline state.
 *
 * Design principles:
 *   - Read-only: this service NEVER mutates state
 *   - Auditable: every check is named, thresholded, and recorded
 *   - Governance: readiness ≠ listing. Listing requires separate admin approval.
 *   - Parity: same ListingCheck / ListingReadinessSnapshot shape as Dota2
 *     so the Creator Hub can render both games identically.
 *
 * Current CS2 pipeline state (Fase 3):
 *   ✓ ConnectedAccount (steam/cs2)
 *   ✓ PlayerProfile (cs2, DRAFT)
 *   ✓ Asset stub (steam:cs2:player:{steamId})
 *   ✓ EligibilitySnapshot (PENDING_DATA_COLLECTION)
 *   ✓ Confidence calculator (cs2ConfidenceCalculator — Fase 3)
 *   ✓ Initial valuation   (cs2ValuationService V1 — Fase 3)
 *   ✗ Match ingestion (no CS2 match pipeline yet — future phase)
 *
 * Checks and when they pass:
 *   C1  hasConnectedSteamAccount — steam/cs2 account linked
 *   C2  hasPlayerProfile         — CS2 profile exists
 *   C3  hasAsset                 — asset stub created
 *   C4  hasEligibilitySnapshot   — snapshot exists
 *   C5  matchDataAvailable       — sampleSize > 0 (requires match ingestion — future)
 *   C6  hasValuationState        — valuation bootstrapped via POST /api/me/cs2/bootstrap-valuation
 *   C7  confidenceScoreMet       — confidenceScore >= 0.55 (requires match data for CS2)
 *   C8  hasPlayerValue           — playerValue > 0.01 (available after bootstrap)
 */

import * as repo                        from "./repository.js";
import { calculateCs2ConfidenceScore }  from "./cs2ConfidenceCalculator.js";
import { getCs2Valuation }              from "./cs2ValuationService.js";

// ── Thresholds ────────────────────────────────────────────────────────────────
// Conservative minimums — CS2 confidence requires match data to meet the bar.
export const CS2_LISTING_THRESHOLDS = {
  minConfidenceScore: 0.55,   // minimum ConfidenceScore (0..1)
  minPlayerValue:     0.01,   // playerValue must be a positive number
} as const;

// ── Check result type ─────────────────────────────────────────────────────────
// Shared with dota2ListingEligibilityService (same shape for Hub compatibility).
export interface ListingCheck {
  name:       string;
  pass:       boolean;
  actual:     number | string | boolean | null;
  threshold?: number | string;
  note?:      string;
}

export interface Cs2ListingReadinessSnapshot {
  assetId:        number;
  profileId:      number;
  game:           "cs2";
  evaluatedAt:    string;
  isReady:        boolean;
  failingChecks:  string[];
  checks:         ListingCheck[];
  thresholds:     typeof CS2_LISTING_THRESHOLDS;
  /**
   * Human-readable summary of what's blocking listing.
   * Intended for the Creator Hub readiness panel.
   */
  blockerSummary: string;
  /**
   * Current pipeline phase for this CS2 asset.
   * Useful for rendering progress indicators in the Hub.
   *   ONBOARDING      — identity layer not complete
   *   MATCH_INGESTION — identity complete; waiting for match data + valuation
   *   VALUATION       — match data + valuation exist; confidence/value checks running
   *   READY           — all checks pass
   */
  pipelinePhase:  "ONBOARDING" | "MATCH_INGESTION" | "VALUATION" | "READY";
}

// ── Evaluator ─────────────────────────────────────────────────────────────────

function n(v: string | number | null | undefined): number {
  return parseFloat(String(v ?? 0));
}

export async function evaluateCs2ListingReadiness(
  userId: string,
): Promise<Cs2ListingReadinessSnapshot> {
  const profiles = await repo.findPlayerProfilesByUser(userId);
  const profile  = profiles.find((p: any) => p.game === "cs2");
  if (!profile) throw Object.assign(new Error("CS2_PROFILE_NOT_FOUND"), { status: 404 });

  const asset = await repo.findAssetByPlayerProfileId(profile.id);
  if (!asset) throw Object.assign(new Error("CS2_ASSET_NOT_FOUND"), { status: 404 });

  const checks: ListingCheck[] = [];

  // ── C1: Connected account (steam/cs2) ─────────────────────────────────────
  const connectedAccounts = await repo.findConnectedAccountsByUser(userId);
  const steamAccount = connectedAccounts.find(
    (a: any) => a.providerGroup === "steam" && a.game === "cs2",
  );
  checks.push({
    name:   "hasConnectedSteamAccount",
    pass:   !!steamAccount,
    actual: !!steamAccount,
    note:   steamAccount
      ? `Steam account id=${(steamAccount as any).id}, status=${(steamAccount as any).verificationStatus}`
      : "No Steam/CS2 connected account found. Run POST /api/me/cs2/connect first.",
  });

  // ── C2: Player profile exists ─────────────────────────────────────────────
  checks.push({
    name:   "hasPlayerProfile",
    pass:   true,
    actual: profile.id,
    note:   `Profile id=${profile.id}, game=cs2, status=${(profile as any).status}`,
  });

  // ── C3: Asset stub exists ─────────────────────────────────────────────────
  checks.push({
    name:   "hasAsset",
    pass:   true,
    actual: (asset as any).id,
    note:   `Asset id=${(asset as any).id}, uid=${(asset as any).assetUid}, tradingStatus=${(asset as any).tradingStatus}`,
  });

  // ── C4: Eligibility snapshot exists ──────────────────────────────────────
  const snap = await repo.findLatestEligibilitySnapshot(profile.id);
  checks.push({
    name:   "hasEligibilitySnapshot",
    pass:   !!snap,
    actual: snap ? snap.id : null,
    note:   snap
      ? `Snapshot id=${snap.id}, reasonCode=${snap.reasonCode}`
      : "No eligibility snapshot found. Run POST /api/me/cs2/connect first.",
  });

  // ── C5: Match data available ──────────────────────────────────────────────
  // CS2 match ingestion pipeline is not yet implemented.
  // sampleSize > 0 only when match data has been ingested (future phase).
  const sampleSize = snap ? (snap.sampleSize ?? 0) : 0;
  checks.push({
    name:      "matchDataAvailable",
    pass:      sampleSize > 0,
    actual:    sampleSize,
    threshold: 1,
    note:      sampleSize > 0
      ? `${sampleSize} match(es) available.`
      : "CS2 match ingestion pipeline not yet implemented. Valuation bootstrapped from rank signal only until match data arrives.",
  });

  // ── C6: Valuation state exists ────────────────────────────────────────────
  // Requires POST /api/me/cs2/bootstrap-valuation to have been called.
  // After Fase 3, this check can pass even without match data.
  let valuationState: Awaited<ReturnType<typeof getCs2Valuation>> = null;
  try {
    valuationState = await getCs2Valuation(userId);
  } catch {
    // Profile/asset missing — already caught by C2/C3 above
  }

  const hasValuationState = !!valuationState;
  checks.push({
    name:   "hasValuationState",
    pass:   hasValuationState,
    actual: hasValuationState ? valuationState!.playerValue : false,
    note:   hasValuationState
      ? `Valuation bootstrapped: initialValue=${n(valuationState!.initialValue).toFixed(2)}, playerValue=${n(valuationState!.playerValue).toFixed(2)}.`
      : "CS2 valuation not bootstrapped yet. Call POST /api/me/cs2/bootstrap-valuation.",
  });

  // ── C7: Confidence score meets minimum ────────────────────────────────────
  // After Fase 3, computed directly from the snapshot using cs2ConfidenceCalculator.
  // At onboarding with no data, confidenceScore ≈ 0.20 (below threshold).
  // Will meet threshold once match data raises sampleSize + dataCompleteness.
  let computedConfidence = 0;
  if (snap) {
    const confResult = calculateCs2ConfidenceScore({
      sampleSize:       n(snap.sampleSize),
      dataCompleteness: n(snap.dataCompleteness),
      rankSignal:       snap.rankSignal ?? null,
    });
    computedConfidence = confResult.confidenceScore;
  } else if (valuationState) {
    // Fallback: read from stored state if snapshot unavailable
    computedConfidence = n(valuationState.confidenceScore);
  }

  const confidenceMet = computedConfidence >= CS2_LISTING_THRESHOLDS.minConfidenceScore;
  checks.push({
    name:      "confidenceScoreMet",
    pass:      confidenceMet,
    actual:    parseFloat(computedConfidence.toFixed(4)),
    threshold: CS2_LISTING_THRESHOLDS.minConfidenceScore,
    note:      confidenceMet
      ? `Confidence score ${computedConfidence.toFixed(3)} meets minimum.`
      : `Confidence score ${computedConfidence.toFixed(3)} below ${CS2_LISTING_THRESHOLDS.minConfidenceScore}. Requires match data to improve sampleSize and dataCompleteness.`,
  });

  // ── C8: Player value exists and is positive ───────────────────────────────
  // After Fase 3, this can pass after bootstrapCs2Valuation is called.
  const playerValue = valuationState ? n(valuationState.playerValue) : 0;
  const hasPlayerValue = playerValue >= CS2_LISTING_THRESHOLDS.minPlayerValue;
  checks.push({
    name:      "hasPlayerValue",
    pass:      hasPlayerValue,
    actual:    parseFloat(playerValue.toFixed(4)),
    threshold: CS2_LISTING_THRESHOLDS.minPlayerValue,
    note:      hasPlayerValue
      ? `PlayerValue = ${playerValue.toFixed(2)} GS (fundamental estimate, not market price).`
      : "PlayerValue not yet computed. Call POST /api/me/cs2/bootstrap-valuation.",
  });

  const failingChecks = checks.filter(c => !c.pass).map(c => c.name);
  const isReady       = failingChecks.length === 0;

  // ── Pipeline phase ────────────────────────────────────────────────────────
  // Phase logic:
  //   ONBOARDING      — no eligibility snapshot (identity layer incomplete)
  //   MATCH_INGESTION — snapshot exists, but valuation not bootstrapped
  //   VALUATION       — valuation exists, but confidence or other checks not yet met
  //   READY           — all checks pass
  const pipelinePhase: Cs2ListingReadinessSnapshot["pipelinePhase"] =
    isReady             ? "READY"           :
    hasValuationState   ? "VALUATION"       :
    snap                ? "MATCH_INGESTION" :
                          "ONBOARDING";

  // ── Blocker summary ───────────────────────────────────────────────────────
  const blockerSummary =
    pipelinePhase === "ONBOARDING"
      ? "Steam account connection incomplete. Complete onboarding via POST /api/me/cs2/connect."
      : pipelinePhase === "MATCH_INGESTION"
      ? "Identity layer complete. Bootstrap valuation via POST /api/me/cs2/bootstrap-valuation. Match ingestion pipeline will be added in a future phase."
      : pipelinePhase === "VALUATION"
      ? `Valuation bootstrapped (playerValue=${playerValue.toFixed(2)} GS). Confidence score (${computedConfidence.toFixed(3)}) below ${CS2_LISTING_THRESHOLDS.minConfidenceScore} threshold — requires match data ingestion to improve.`
      : "All checks pass. Asset ready for admin listing review.";

  return {
    assetId:      (asset as any).id,
    profileId:    profile.id,
    game:         "cs2",
    evaluatedAt:  new Date().toISOString(),
    isReady,
    failingChecks,
    checks,
    thresholds:   CS2_LISTING_THRESHOLDS,
    blockerSummary,
    pipelinePhase,
  };
}

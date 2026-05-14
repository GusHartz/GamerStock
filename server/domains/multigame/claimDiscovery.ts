/**
 * Claim Discovery Adapters — GamerStock Multigame
 *
 * Each adapter is responsible for discovering claimable assets for a specific
 * game/provider combination. The aggregator getClaimableAssets() calls all
 * adapters and merges the results.
 *
 * Current implementation status:
 *   ✓ discoverDota2ClaimCandidates — Dota2 via Steam OpenID (since Fase 10)
 *   ○ discoverCs2ClaimCandidates   — stub (same Steam provider, future fase)
 *   ○ discoverLolClaimCandidates   — stub (Riot OAuth, future fase)
 *   ○ discoverValorantClaimCandidates — stub (Riot OAuth, future fase)
 *
 * Adding a new adapter:
 *   1. Create discoverXxxClaimCandidates(userId) returning ClaimCandidate[]
 *   2. Import it and add it to the Promise.all() in getClaimableAssets()
 *   3. Add the game's policy entry to claimPolicyConfig.ts
 *
 * Architecture notes:
 *   - Each adapter handles its own DB queries (via repo) and calls evaluateClaimPolicy()
 *     from claimPolicyEvaluator to compute policyDecision + signals.
 *   - Adapters must NEVER call each other.
 *   - The aggregator does not know which game returned which candidates.
 *   - Candidates are game-tagged, so the frontend can filter or group by game.
 */

import * as repo from "./repository";
import { evaluateClaimPolicy } from "./claimPolicyEvaluator";
import { getGamePolicy }       from "./claimPolicyConfig";

// ── Shared candidate type ─────────────────────────────────────────────────────

export interface ClaimCandidate {
  /** Game code for this candidate. */
  game:                string;
  /**
   * Asset primary key.
   * null for "virtual" candidates — the player is verified in another game
   * but has no internal asset for this game yet. addToTerminal will create it.
   */
  assetId:             number | null;
  /** Asset UID (opaque string). */
  assetUid:            string | null;
  /** Asset trading symbol (e.g. "D2_GUHARTZ"). */
  symbol:              string | null;
  /** Human-readable asset display name. */
  displayName:         string | null;
  /** Provider group used for discovery (e.g. "steam", "riot"). */
  providerGroup:       string;
  /** Verification method required (e.g. "STEAM_OPENID", "RIOT_OAUTH"). */
  verificationMethod:  string;
  /**
   * How the asset was matched to the connected account.
   *   STEAM_PROFILE_LINK — playerProfile.primaryConnectedAccountId === steamAccount.id
   *   RIOT_PROFILE_LINK  — (future) riot account directly linked at onboarding
   *   PROVIDER_ID_MATCH  — (future) providerAccountId match across accounts
   */
  matchSource:         string;
  /** Confidence level of the asset-to-account match. */
  matchConfidence:     string;
  /** Current verificationStatus of the connected account. */
  verificationStatus:  string;
  /** Connected account primary key that produced this candidate. */
  connectedAccountId:  number;
  /** Human-readable account name from the provider (e.g. Steam display name). */
  providerAccountName: string | null;
  /** Policy decision from the evaluator. */
  policyDecision:      string;
  /** Reasons for a non-AUTO_APPROVABLE decision (empty when AUTO_APPROVABLE). */
  policyReasons:       string[];
  /** Suggested approvalType for the claim record. */
  approvalType:        string;
  /** Whether this candidate can be auto-approved inline. */
  canAutoApprove:      boolean;
  /**
   * Whether the user can submit a new claim.
   * false when: not verified, hasOpenClaim, or providerGroup mismatch.
   */
  canClaim:            boolean;
  /** Whether the user already has an ACTIVE ownership link for this asset. */
  alreadyOwned:        boolean;
  /** Whether ANY user has an ACTIVE ownership link for this asset. */
  hasActiveOwner:      boolean;
  /** Whether this user has a PENDING or UNDER_REVIEW claim for this asset. */
  hasOpenClaim:        boolean;
  /** ID of the open claim (if hasOpenClaim). */
  openClaimId:         number | null;
  /** Status of the open claim (if hasOpenClaim). */
  openClaimStatus:     string | null;
}

// ── Generic Steam game discovery (STEAM_PROFILE_LINK strategy) ───────────────

/**
 * Shared Steam discovery logic for any game that uses STEAM_PROFILE_LINK.
 *
 * Currently: dota2, cs2 (both use the same Steam provider and the same matchSource).
 * Callers (discoverDota2ClaimCandidates, discoverCs2ClaimCandidates) provide the game code.
 *
 * Strategy:
 *   1. Find the user's steam+{game} ConnectedAccount.
 *   2. Find the {game} PlayerProfile (created in the same onboarding tx).
 *   3. Find the asset linked to that playerProfile.
 *   4. Compute matchConfidence based on the profile-to-account link.
 *   5. Compute signals (hasActiveOwner, hasOpenClaim, alreadyOwned).
 *   6. Evaluate policy using the central evaluator.
 *
 * matchConfidence:
 *   HIGH   — playerProfile.primaryConnectedAccountId === steamAccount.id
 *            (deterministic: same onboarding tx created both records)
 *   MEDIUM — playerProfile exists but primaryConnectedAccountId differs
 *            (rare; could happen if account was re-connected after initial onboarding)
 */
async function discoverSteamGameClaimCandidates(
  userId: string,
  game:   string,
): Promise<ClaimCandidate[]> {
  const policy = getGamePolicy(game);
  if (!policy) return [];

  // Find the user's Steam connected account for this game.
  // Primary: exact game match (e.g. dota2 account for dota2 discovery).
  // Fallback: any VERIFIED steam account — CS2 and Dota2 share the same SteamID64,
  //           so a dota2-verified account is equally valid for CS2 discovery.
  const accounts = await repo.findConnectedAccountsByUser(userId);
  const steamAccount =
    accounts.find((a: any) => a.providerGroup === "steam" && a.game === game) ??
    accounts.find(
      (a: any) =>
        a.providerGroup === "steam" &&
        (a.verificationStatus === "VERIFIED" || a.verification_status === "VERIFIED"),
    );
  if (!steamAccount) return [];

  // Find the player profile for this game (may not exist if user connected via OAuth only)
  const profiles    = await repo.findPlayerProfilesByUser(userId);
  const gameProfile = profiles.find((p: any) => p.game === game) ?? null;

  // STEAM_PROFILE_LINK: look up asset via PlayerProfile (traditional onboarding path)
  let asset: any = null;
  let matchSource = "STEAM_PROFILE_LINK";

  if (gameProfile) {
    asset = await repo.findAssetByPlayerProfileId(gameProfile.id);
  }

  // STEAM_ID_DIRECT fallback: if no asset found via profile, try finding by Steam IDs.
  // Bootstrap assets can use either accountId32 OR steamId64 as their external_id.
  // IMPORTANT: use game-scoped lookup to avoid matching an asset from a different game
  // (e.g. finding a dota2 asset when discovering cs2 for the same SteamID64).
  if (!asset) {
    const steamId64 = (steamAccount as any).providerAccountId as string | null;
    if (steamId64) {
      try {
        const accountId32 = String(BigInt(steamId64) - BigInt("76561197960265728"));

        // 1) Game-scoped accountId32 lookup
        asset = await repo.findAssetByExternalIdAndGame(accountId32, game);
        if (asset) matchSource = "STEAM_ID_DIRECT";

        // 2) Game-scoped steamId64 lookup
        if (!asset) {
          asset = await repo.findAssetByExternalIdAndGame(steamId64, game);
          if (asset) matchSource = "STEAM_ID_DIRECT";
        }

        // 3) Cross-game presence check: player exists in another game but has no
        //    {game}-specific asset yet. Return a virtual candidate so the Hub can
        //    show "Add to Terminal" and create the asset stub on demand.
        if (!asset) {
          const crossGameAsset =
            (await repo.findAssetByExternalId(accountId32)) ??
            (await repo.findAssetByExternalId(steamId64));

          if (crossGameAsset) {
            const policyResult = evaluateClaimPolicy({
              game,
              verificationStatus: (steamAccount as any).verificationStatus ?? null,
              providerGroup:      "steam",
              matchConfidence:    "HIGH",
              hasActiveOwner:     false,
              hasOpenClaim:       false,
            });

            return [
              {
                game,
                assetId:             null,
                assetUid:            `steam:${game}:player:${steamId64}`,
                symbol:              null,
                displayName:         (crossGameAsset as any).displayName ?? null,
                providerGroup:       policy.providerGroup,
                verificationMethod:  policy.verificationMethod,
                matchSource:         "STEAM_ID_DIRECT",
                matchConfidence:     "HIGH",
                verificationStatus:  (steamAccount as any).verificationStatus ?? "NOT_VERIFIED",
                connectedAccountId:  (steamAccount as any).id as number,
                providerAccountName: (steamAccount as any).providerAccountName ?? null,
                policyDecision:      policyResult.policyDecision,
                policyReasons:       policyResult.reasons,
                approvalType:        policyResult.approvalType,
                canAutoApprove:      policyResult.canAutoApprove,
                canClaim:            policyResult.canClaim,
                alreadyOwned:        false,
                hasActiveOwner:      false,
                hasOpenClaim:        false,
                openClaimId:         null,
                openClaimStatus:     null,
              },
            ];
          }
        }
      } catch {
        // non-numeric steamId64 — skip fallback
      }
    }
  }

  if (!asset) return [];

  const assetId = (asset as any).id as number;

  // Compute match confidence
  const matchConfidence: string =
    matchSource === "STEAM_ID_DIRECT"
      ? "HIGH" // direct accountId32 match is deterministic
      : gameProfile?.primaryConnectedAccountId === (steamAccount as any).id
      ? "HIGH"
      : "MEDIUM";

  // Compute ownership and claim signals
  const activeOwnerLink = await repo.findActiveAssetOwnershipLink(assetId);
  const hasActiveOwner  = !!activeOwnerLink;

  const openClaims   = await repo.findOpenDota2ClaimsByAssetAndUser(assetId, userId);
  const hasOpenClaim = openClaims.length > 0;

  const userOwnerLinks = await repo.listAssetOwnershipLinksByUser(userId);
  const alreadyOwned   = userOwnerLinks.some(
    (l: any) => l.assetId === assetId && l.status === "ACTIVE",
  );

  // Evaluate policy using the central evaluator
  const policyResult = evaluateClaimPolicy({
    game,
    verificationStatus: (steamAccount as any).verificationStatus ?? null,
    providerGroup:      "steam",
    matchConfidence,
    hasActiveOwner,
    hasOpenClaim,
  });

  return [
    {
      game,
      assetId,
      assetUid:            (asset as any).assetUid         ?? null,
      symbol:              (asset as any).symbol            ?? null,
      displayName:         (asset as any).displayName       ?? null,
      providerGroup:       policy.providerGroup,
      verificationMethod:  policy.verificationMethod,
      matchSource:         "STEAM_PROFILE_LINK",
      matchConfidence,
      verificationStatus:  (steamAccount as any).verificationStatus ?? "NOT_VERIFIED",
      connectedAccountId:  (steamAccount as any).id as number,
      providerAccountName: (steamAccount as any).providerAccountName ?? null,
      policyDecision:      policyResult.policyDecision,
      policyReasons:       policyResult.reasons,
      approvalType:        policyResult.approvalType,
      canAutoApprove:      policyResult.canAutoApprove,
      canClaim:            policyResult.canClaim && !alreadyOwned,
      alreadyOwned,
      hasActiveOwner,
      hasOpenClaim,
      openClaimId:         hasOpenClaim ? (openClaims[0] as any).id        : null,
      openClaimStatus:     hasOpenClaim ? (openClaims[0] as any).claimStatus : null,
    },
  ];
}

// ── Dota2 Discovery Adapter ───────────────────────────────────────────────────

/**
 * Discover claimable Dota2 assets for a user.
 * Delegates to the generic Steam discovery helper with game="dota2".
 */
export async function discoverDota2ClaimCandidates(
  userId: string,
): Promise<ClaimCandidate[]> {
  return discoverSteamGameClaimCandidates(userId, "dota2");
}

// ── Future adapters (stubs) ───────────────────────────────────────────────────

/**
 * Discover claimable CS2 assets for a user.
 *
 * Fase 17: Active implementation.
 * Delegates to the generic Steam discovery helper with game="cs2".
 * Requires the user to have completed the CS2 connect flow (POST /api/me/cs2/connect).
 *
 * Key multi-game property demonstrated here:
 *   - The same Steam SteamID64 is used for BOTH dota2 and cs2 accounts.
 *   - The dota2 asset and the cs2 asset are SEPARATE records (separate assetIds).
 *   - Claims and ownership are per-asset — a user can own both independently.
 *   - No conflict between dota2 and cs2 candidates in the discovery result.
 */
export async function discoverCs2ClaimCandidates(
  userId: string,
): Promise<ClaimCandidate[]> {
  return discoverSteamGameClaimCandidates(userId, "cs2");
}

/**
 * League of Legends discovery — Riot / OAuth.
 * Stub: returns empty until Riot OAuth integration is implemented.
 *
 * When ready:
 *   - Implement Riot OAuth flow (similar to Steam OpenID in steamVerificationService.ts)
 *   - Add lol ConnectedAccount with providerGroup="riot", game="lol"
 *   - Implement this function to find riot+lol accounts → playerProfiles → assets
 */
export async function discoverLolClaimCandidates(
  _userId: string,
): Promise<ClaimCandidate[]> {
  return [];
}

/**
 * Valorant discovery — Riot / OAuth.
 * Stub: returns empty until Riot OAuth integration is implemented.
 */
export async function discoverValorantClaimCandidates(
  _userId: string,
): Promise<ClaimCandidate[]> {
  return [];
}

// ── Aggregator ────────────────────────────────────────────────────────────────

/**
 * Discover all claimable assets for a user across all supported games.
 *
 * Runs all adapter discovery functions in parallel. Each adapter is independent
 * and handles its own provider logic. The aggregator simply merges results.
 *
 * To add a new game adapter:
 *   1. Implement the adapter above.
 *   2. Remove the leading comment-out below and add the function call.
 *   3. The endpoint /api/me/assets/claimable will automatically include it.
 */
export async function getClaimableAssets(
  userId: string,
): Promise<ClaimCandidate[]> {
  const results = await Promise.all([
    discoverDota2ClaimCandidates(userId),
    discoverCs2ClaimCandidates(userId),          // Fase 17: CS2 active (Steam multi-game)
    // discoverLolClaimCandidates(userId),       // uncomment when Riot OAuth ready
    // discoverValorantClaimCandidates(userId),  // uncomment when Riot OAuth ready
  ]);
  return results.flat();
}

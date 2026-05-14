// ─── Player Hub Domain — Service ──────────────────────────────────────────────
// Aggregates claim, asset, and request data into hub-level views.
// Delegates claim creation to the existing playerClaimsService.
// ─────────────────────────────────────────────────────────────────────────────
import { playerHubRepository } from "./repository";
import { playerClaimsService } from "../player-claims/service";
import { playerClaimsRepository } from "../player-claims/repository";
import { getClaimableAssets } from "../multigame/claimDiscovery";
import {
  findConnectedAccountsByUser,
  findAssetByUid,
  findOrCreateMarket,
  createAssetStub,
} from "../multigame/repository";
import { serializeHubAsset, serializeAssetRequest } from "./serializers";
import { db } from "../../db";
import { eq } from "drizzle-orm";
import { assets } from "@shared/schema/player";
import { bootstrapDota2Valuation } from "../multigame/dota2ValuationService";
import { bootstrapCs2Valuation } from "../multigame/cs2ValuationService";
import { gateTerminalPromotion } from "../terminal/invariants";
import type {
  HubOverviewResponse,
  HubAssetsResponse,
  HubAssetRequestsResponse,
  HubClaimSummary,
  HubDiscoveredAssetsResponse,
  HubDiscoveredAssetView,
  CreateAssetRequestInput,
} from "./types";

// ── Internal helpers ──────────────────────────────────────────────────────────

function buildClaimSummary(claims: Array<{ claimStatus: string }>): HubClaimSummary {
  return {
    approved: claims.filter((c) => c.claimStatus === "approved").length,
    pending: claims.filter((c) => c.claimStatus === "pending").length,
    rejected: claims.filter((c) => c.claimStatus === "rejected").length,
  };
}

/** Returns true when a string looks like a raw Steam ID (all digits, ≥7 chars). */
function isSteamId(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^\d{7,}$/.test(value.trim());
}

/**
 * Fetches the Steam persona name via Steam Community public XML profile.
 * Requires no API key. Returns null on failure.
 */
async function fetchSteamPersonaName(steamId64: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://steamcommunity.com/profiles/${steamId64}/?xml=1`,
      { signal: AbortSignal.timeout(4_000) },
    );
    if (!res.ok) return null;
    const xml = await res.text();
    const match = xml.match(/<steamID><!\[CDATA\[(.*?)\]\]><\/steamID>/);
    return match?.[1]?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * When an asset's display_name is a raw Steam ID, enriches it with the real
 * persona name from Steam and persists it to the DB.
 */
async function enrichAssetDisplayName(
  assetId: number,
  steamId64: string,
): Promise<string | null> {
  const personaName = await fetchSteamPersonaName(steamId64);
  if (!personaName || isSteamId(personaName)) return null;

  try {
    await db
      .update(assets)
      .set({ displayName: personaName })
      .where(eq(assets.id, assetId));
    console.log(`[PlayerHub] Enriched asset #${assetId} displayName → "${personaName}"`);
  } catch (err: any) {
    console.warn(`[PlayerHub] Failed to persist displayName for asset #${assetId}:`, err.message);
  }

  return personaName;
}

// ── Service ───────────────────────────────────────────────────────────────────

export const playerHubService = {

  // ── Overview ────────────────────────────────────────────────────────────────
  async getOverview(userId: string, displayName: string): Promise<HubOverviewResponse> {
    // Three-source fetch (same logic as getAssets) so totalAssets is always accurate.
    const [claims, profile, requests, profiles, ownershipLinks] = await Promise.all([
      playerHubRepository.findClaimsByUser(userId),
      playerHubRepository.findProfileByUser(userId),
      playerHubRepository.findRequestsByUser(userId),
      playerHubRepository.findAllProfilesByUser(userId),
      playerHubRepository.findActiveOwnershipLinksByUser(userId),
    ]);

    // Merge all three asset ID sources
    const claimAssetIds     = claims.map((c) => c.assetId);
    const profileAssetIds   = profiles.map((p) => p.assetId).filter((id): id is number => id !== null);
    const ownershipAssetIds = ownershipLinks.map((l) => l.assetId).filter((id): id is number => id !== null);
    const allAssetIds       = Array.from(new Set([...claimAssetIds, ...profileAssetIds, ...ownershipAssetIds]));

    const assetRows = await playerHubRepository.findAssetsByIds(allAssetIds);
    const assetMap  = new Map(assetRows.map((a) => [a.id, a]));

    // Build best-claim map (approved beats pending beats rejected)
    const claimByAsset = new Map<number, (typeof claims)[0]>();
    for (const claim of claims) {
      const existing = claimByAsset.get(claim.assetId);
      const priority = (s: string) =>
        ({ approved: 4, pending: 3, rejected: 2, revoked: 1 }[s] ?? 0);
      if (!existing || priority(claim.claimStatus) > priority(existing.claimStatus)) {
        claimByAsset.set(claim.assetId, claim);
      }
    }

    // Synthesize approved-like entries for profile-owned / ownership-link assets
    const syntheticClaim = (id: number) => ({
      id: -1, userId, assetId: id, assetUid: "",
      claimStatus: "approved" as const, evidenceNote: null,
      requestedAt: new Date(), reviewedAt: null,
      reviewedByUserId: null, reviewNotes: null, revokedAt: null,
    });
    for (const id of Array.from(new Set([...profileAssetIds, ...ownershipAssetIds]))) {
      if (!claimByAsset.has(id)) claimByAsset.set(id, syntheticClaim(id) as any);
    }

    const assetViews = allAssetIds
      .map((id) => {
        const row = assetMap.get(id);
        if (!row) return null;
        return serializeHubAsset(row, claimByAsset.get(id) ?? null);
      })
      .filter(Boolean) as ReturnType<typeof serializeHubAsset>[];

    const operatorReady   = assetViews.filter((a) => a.operatorReady).length;
    const pendingRequests = requests.filter((r) => r.status === "pending" || r.status === "under_review").length;
    const claimSummary    = buildClaimSummary(claims);

    return {
      player: {
        userId,
        displayName,
        avatarUrl:     profile?.profileImageUrl ?? null,
        bannerImageUrl: profile?.bannerUrl ?? null,
        claimSummary,
      },
      summary: {
        totalAssets:        assetViews.length,
        operatorReadyAssets: operatorReady,
        pendingClaims:      claimSummary.pending,
        pendingRequests,
      },
      assetsPreview:   assetViews.slice(0, 5),
      requestsPreview: requests.slice(0, 3).map(serializeAssetRequest),
    };
  },

  // ── Assets ──────────────────────────────────────────────────────────────────
  async getAssets(userId: string): Promise<HubAssetsResponse> {
    // Three-source ownership merge to guarantee completeness across all claim paths:
    //
    //  Source 1 — player_claims (from addToTerminal / claimAsset in the Hub flow)
    //  Source 2 — player_public_profiles (post-claim profile records)
    //  Source 3 — asset_ownership_links ACTIVE (from multigame dota2/cs2 claim-asset flow)
    //
    // Root cause of the production bug (identified 2026-04-02):
    //   POST /api/me/dota2/claim-asset writes to dota2_asset_claim_requests +
    //   asset_ownership_links but NOT to player_claims / player_public_profiles.
    //   Discovered Assets showed "In Terminal" (reads asset_ownership_links via
    //   claimDiscovery.alreadyOwned), but Asset Portfolio was empty (only read
    //   player_claims and player_public_profiles).
    //   Fix: add ownership links as a third asset source.
    const [claims, profiles, ownershipLinks] = await Promise.all([
      playerHubRepository.findClaimsByUser(userId),
      playerHubRepository.findAllProfilesByUser(userId),
      playerHubRepository.findActiveOwnershipLinksByUser(userId),
    ]);

    const claimAssetIds     = claims.map((c) => c.assetId);
    const profileAssetIds   = profiles
      .map((p) => p.assetId)
      .filter((id): id is number => id !== null);
    const ownershipAssetIds = ownershipLinks
      .map((l) => l.assetId)
      .filter((id): id is number => id !== null);

    const allAssetIds = Array.from(new Set([...claimAssetIds, ...profileAssetIds, ...ownershipAssetIds]));
    const assetRows = await playerHubRepository.findAssetsByIds(allAssetIds);
    const assetMap = new Map(assetRows.map((a) => [a.id, a]));

    // Build best-claim map (approved beats pending beats rejected)
    const claimByAsset = new Map<number, (typeof claims)[0]>();
    for (const claim of claims) {
      const existing = claimByAsset.get(claim.assetId);
      const priority = (s: string) =>
        ({ approved: 4, pending: 3, rejected: 2, revoked: 1 }[s] ?? 0);
      if (!existing || priority(claim.claimStatus) > priority(existing.claimStatus)) {
        claimByAsset.set(claim.assetId, claim);
      }
    }

    const syntheticApproved = (id: number) => ({
      id: -1, userId, assetId: id, assetUid: "",
      claimStatus: "approved" as const, evidenceNote: null,
      requestedAt: new Date(), reviewedAt: null,
      reviewedByUserId: null, reviewNotes: null, revokedAt: null,
    });

    // For profile-owned assets with no claim record, synthesize an approved-like entry.
    for (const id of Array.from(new Set(profileAssetIds))) {
      if (!claimByAsset.has(id)) claimByAsset.set(id, syntheticApproved(id) as any);
    }

    // For ownership-link assets (multigame claim-asset flow) with no claim record,
    // synthesize an approved-like entry. ACTIVE ownership links = definitively the owner.
    for (const id of Array.from(new Set(ownershipAssetIds))) {
      if (!claimByAsset.has(id)) claimByAsset.set(id, syntheticApproved(id) as any);
    }

    const assets = allAssetIds
      .map((id) => {
        const row = assetMap.get(id);
        if (!row) return null;
        return serializeHubAsset(row, claimByAsset.get(id) ?? null);
      })
      .filter(Boolean) as ReturnType<typeof serializeHubAsset>[];

    return { assets };
  },

  // ── Asset Requests ───────────────────────────────────────────────────────────
  async getAssetRequests(userId: string): Promise<HubAssetRequestsResponse> {
    const requests = await playerHubRepository.findRequestsByUser(userId);
    return {
      requests: requests.map(serializeAssetRequest),
      total: requests.length,
    };
  },

  async createAssetRequest(input: CreateAssetRequestInput) {
    // Guard: prevent duplicate pending request for same game + account ref
    if (input.externalAccountRef) {
      const existing = await playerHubRepository.findPendingRequestForUserAndGame(
        input.requestedByUserId,
        input.gameId,
        input.externalAccountRef,
      );
      if (existing) {
        throw Object.assign(
          new Error("You already have a pending request for this account and game."),
          { statusCode: 409 },
        );
      }
    }

    const row = await playerHubRepository.createRequest(input);
    return serializeAssetRequest(row);
  },

  // ── Claim (thin adapter over playerClaimsService) ────────────────────────────
  async claimAsset(userId: string, assetId: number, assetUid: string, evidenceNote?: string) {
    const result = await playerClaimsService.requestClaim({
      userId,
      assetId,
      assetUid,
      evidenceNote,
    });
    return result;
  },

  // ── Discovered Assets (Steam auto-discovery) ──────────────────────────────
  async getDiscoveredAssets(userId: string): Promise<HubDiscoveredAssetsResponse> {
    const [candidates, connectedAccounts, userClaims] = await Promise.all([
      getClaimableAssets(userId),
      findConnectedAccountsByUser(userId),
      playerClaimsRepository.findClaimsByUser(userId),
    ]);

    // Build a set of assetIds the user already has an approved claim for
    const approvedAssetIds = new Set(
      userClaims
        .filter((c) => c.claimStatus === "approved")
        .map((c) => c.assetId),
    );

    const steamAccounts = connectedAccounts.filter(
      (a: any) => a.providerGroup === "steam",
    );
    const hasSteamAccount = steamAccounts.length > 0;
    const steamAccountName =
      steamAccounts.length > 0
        ? (steamAccounts[0] as any).providerAccountName ?? null
        : null;

    const GAME_NAMES: Record<string, string> = {
      dota2: "Dota 2",
      cs2:   "Counter-Strike 2",
      lol:   "League of Legends",
    };

    // For each candidate, resolve the display name.
    // If the stored name is a raw Steam ID, fetch the real persona name from Steam.
    // Virtual candidates (assetId=null) skip the DB write — no internal asset yet.
    const enrichmentPromises = candidates.map(async (c) => {
      let resolvedName: string | null = c.displayName;

      if (isSteamId(c.displayName)) {
        // Try providerAccountName first (already on the account record)
        if (c.providerAccountName && !isSteamId(c.providerAccountName)) {
          resolvedName = c.providerAccountName;
          // Update the asset in DB so future reads are correct too — only when a real asset exists
          if (c.assetId !== null) {
            try {
              await db
                .update(assets)
                .set({ displayName: resolvedName })
                .where(eq(assets.id, c.assetId));
            } catch { /* non-fatal */ }
          }
        } else if (c.assetId !== null) {
          // Fetch from Steam community XML (no API key needed) — only for real assets.
          // IMPORTANT: use the real steamId64 from the connected account — NOT c.displayName,
          // which may be an accountId32 (shorter numeric form that the Steam XML endpoint rejects).
          const account = connectedAccounts.find((a: any) => a.id === c.connectedAccountId);
          const realSteamId64: string = (account as any)?.providerAccountId ?? c.displayName ?? "";
          resolvedName = await enrichAssetDisplayName(c.assetId, realSteamId64);
        }
      }

      // "already_added" requires a real internal asset AND an approved claim for it.
      // Virtual candidates (assetId=null) are never "already_added" — they're "available".
      // This prevents a CS2 virtual candidate from being marked "already_added" just
      // because the user has an approved claim for the Dota2 asset from the same SteamID.
      let status: HubDiscoveredAssetView["status"];
      if (c.assetId !== null && (c.alreadyOwned || approvedAssetIds.has(c.assetId))) {
        status = "already_added";
      } else if (c.hasOpenClaim) {
        status = "claim_pending";
      } else if (c.canClaim) {
        status = "available";
      } else {
        status = "unavailable";
      }

      return {
        assetId:             c.assetId,
        assetUid:            c.assetUid,
        provider:            "steam" as const,
        gameId:              c.game,
        gameName:            GAME_NAMES[c.game] ?? c.game,
        displayName:         resolvedName,
        providerAccountName: c.providerAccountName,
        status,
        canAdd:              status === "available",
        linkedAssetId:       (c.assetId !== null && (c.alreadyOwned || approvedAssetIds.has(c.assetId))) ? c.assetId : null,
        verificationStatus:  c.verificationStatus,
        matchConfidence:     c.matchConfidence,
      } satisfies HubDiscoveredAssetView;
    });

    const discoveredAssets = await Promise.all(enrichmentPromises);

    return { discoveredAssets, hasSteamAccount, steamAccountName };
  },

  // ── Add to Terminal (atomic market entry — invariant-gated) ──────────────
  //
  // Architecture:
  //   1. Create asset stub in UNDER_REVIEW/PAUSED (NOT LISTED/ACTIVE yet)
  //   2. Run valuation bootstrap synchronously (with timeout)
  //   3. Check all hard invariants via gateTerminalPromotion()
  //   4. Only promote to LISTED/ACTIVE if gate passes
  //   5. On any failure → asset stays in UNDER_REVIEW/PAUSED (reconciler monitors)
  //
  // This guarantees no asset enters the terminal as "falso pronto" (fake-ready).
  async addToTerminal(userId: string, assetId: number | null, assetUid: string) {
    let resolvedAssetId = assetId;
    let isNewStub = false;

    // Virtual candidate: assetId is null (or 0 from the route) means no internal
    // asset exists yet for this game. Create a stub in UNDER_REVIEW/PAUSED first.
    if (!resolvedAssetId) {
      // assetUid format: "steam:{game}:player:{steamId64}"
      const parts = assetUid.split(":");
      if (parts.length < 4 || parts[2] !== "player") {
        return { success: false, error: "Invalid asset UID format." };
      }
      const game      = parts[1];
      const steamId64 = parts[3];

      // Race-condition guard: another request may have already created it
      const existingByUid = await findAssetByUid(assetUid);
      if (existingByUid) {
        resolvedAssetId = existingByUid.id;
        console.log(`[PlayerHub] Reusing existing ${game} asset #${resolvedAssetId} (race guard)`);
      } else {
        // Compute accountId32 (Dota2 convention); fall back to steamId64 on failure
        let externalId = steamId64;
        try {
          externalId = String(BigInt(steamId64) - BigInt("76561197960265728"));
        } catch { /* non-numeric steamId64 */ }

        const market = await findOrCreateMarket({ provider: "steam", game });
        const stub   = await createAssetStub({
          marketId:        market.id,
          assetUid,
          entityType:      "pro_player",
          externalId,
          displayName:     steamId64,    // Store full steamId64; persona name enriched on hub load
          playerProfileId: null as any,  // nullable — no PlayerProfile created yet
          tradingStatus:   "PAUSED",
          listingStatus:   "UNDER_REVIEW",
        });
        resolvedAssetId = stub.id;
        isNewStub       = true;
        console.log(
          `[PlayerHub] Created ${game} asset stub #${resolvedAssetId} for steamId64=${steamId64} ` +
          `(UNDER_REVIEW/PAUSED — pending valuation gate)`,
        );
      }
    }

    // Guard: someone else already has an approved claim for this asset
    const existingApproved = await playerClaimsRepository.findApprovedClaimForAsset(resolvedAssetId!);
    if (existingApproved) {
      if (existingApproved.userId === userId) {
        return { success: false, error: "This asset is already in your terminal." };
      }
      return { success: false, error: "This player profile has already been claimed by another user." };
    }

    // Create the claim as immediately approved (skip pending review entirely)
    const claim = await playerClaimsRepository.createApprovedClaim({
      userId,
      assetId:  resolvedAssetId!,
      assetUid,
    });
    console.log(`[PlayerHub] Auto-approved claim #${claim.id} for userId=${userId} assetId=${resolvedAssetId}`);

    // Auto-create the public profile (same as what admin approval would do)
    const existingProfile = await playerClaimsRepository.findProfileByAsset(resolvedAssetId!);
    if (!existingProfile) {
      await playerClaimsRepository.createProfile({
        assetId:         resolvedAssetId!,
        claimedByUserId: userId,
        claimId:         claim.id,
      });
      console.log(`[PlayerHub] Auto-created public profile for assetId=${resolvedAssetId}`);
    }

    // ── Synchronous bootstrap + invariant gate ────────────────────────────────
    // For new virtual stubs (no prior valuation), run the bootstrap pipeline
    // synchronously, then check invariants before promoting to LISTED/ACTIVE.
    // For pre-existing assets (platform-seeded LISTED/ACTIVE), gate is skipped —
    // the reconciler already validates them continuously.
    const uidParts    = assetUid.split(":");
    const gameFromUid = uidParts.length >= 2 ? uidParts[1] : null;

    if (isNewStub && (gameFromUid === "dota2" || gameFromUid === "cs2")) {
      const gameLabel = gameFromUid;
      const aid       = resolvedAssetId!;
      let   bootstrapOk = false;

      const EXPECTED_SKIP_ERRORS = new Set([
        "ELIGIBILITY_SNAPSHOT_REQUIRED",
        "VALUATION_NOT_BOOTSTRAPPED",
        "DOTA2_PROFILE_NOT_FOUND",
        "CS2_PROFILE_NOT_FOUND",
        "DOTA2_ACCOUNT_NOT_CONNECTED",
        "CS2_ACCOUNT_NOT_CONNECTED",
      ]);

      try {
        const bootstrapPromise = gameLabel === "dota2"
          ? bootstrapDota2Valuation(userId)
          : bootstrapCs2Valuation(userId);

        // Timeout guard: bootstrap must complete within 30s or we keep UNDER_REVIEW
        await Promise.race([
          bootstrapPromise,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("BOOTSTRAP_TIMEOUT")), 30_000),
          ),
        ]);

        bootstrapOk = true;
        console.log(
          `[PlayerHub/AddToTerminal] ${gameLabel.toUpperCase()} bootstrap complete ` +
          `assetId=${aid} userId=${userId}`,
        );
      } catch (err: any) {
        if (EXPECTED_SKIP_ERRORS.has(err.message)) {
          console.log(
            `[PlayerHub/AddToTerminal] ${gameLabel.toUpperCase()} bootstrap skipped ` +
            `assetId=${aid}: ${err.message} — asset stays in UNDER_REVIEW`,
          );
        } else {
          console.error(
            `[PlayerHub/AddToTerminal] ${gameLabel.toUpperCase()} bootstrap failed ` +
            `assetId=${aid}: ${err.message} — asset stays in UNDER_REVIEW`,
          );
        }
      }

      // ── Invariant gate — promote only if INV_1–INV_4 all pass ──────────────
      if (bootstrapOk) {
        try {
          const gate = await gateTerminalPromotion(aid);
          if (gate.approved) {
            await db
              .update(assets)
              .set({ listingStatus: "LISTED", tradingStatus: "ACTIVE", updatedAt: new Date() })
              .where(eq(assets.id, aid));
            console.log(
              `[PlayerHub/AddToTerminal] Gate APPROVED assetId=${aid} → LISTED/ACTIVE. ` +
              `${gate.reason}`,
            );
          } else {
            console.warn(
              `[PlayerHub/AddToTerminal] Gate REJECTED assetId=${aid} — kept UNDER_REVIEW/PAUSED. ` +
              `Failing: ${gate.failingInvariants.join("; ")}. ` +
              `Reconciler will retry on next cycle.`,
            );
          }
        } catch (gateErr: any) {
          console.error(
            `[PlayerHub/AddToTerminal] Gate check error assetId=${aid}: ${gateErr.message} ` +
            `— asset stays in UNDER_REVIEW/PAUSED.`,
          );
        }
      }
      // If bootstrap was skipped or failed, the asset remains UNDER_REVIEW/PAUSED.
      // The reconciler will detect INV_1–INV_4 violations and quarantine or log.
    }

    return { success: true, claimId: claim.id, resolvedAssetId };
  },
};

/**
 * CS2 Onboarding Service — GamerStock Multigame
 *
 * Orchestrates the connect flow for a GS user linking their Steam/CS2 identity:
 *
 *   GS User
 *     → ConnectedAccount (steam + cs2, status=PENDING or VERIFIED if Steam ID already verified)
 *     → PlayerProfile    (cs2, status=DRAFT)
 *     → Asset stub       (steam market, tradingStatus=DRAFT, listingStatus=UNDER_REVIEW)
 *     → EligibilitySnapshot (isEligible=false, reasonCode=PENDING_DATA_COLLECTION)
 *
 * Design notes:
 *   - Same Steam provider as Dota2 — same SteamID64, same OpenID verification flow.
 *   - A user may have both a dota2 AND a cs2 ConnectedAccount with the same providerAccountId.
 *   - If the user's Steam ID is already VERIFIED (via their dota2 account), the cs2 account
 *     inherits VERIFIED status immediately — no second verification needed.
 *   - This preserves the principle: verification is by provider (Steam ID), not by game.
 *   - Claims and ownership are still separate by asset (cs2 asset ≠ dota2 asset).
 *   - No CS2 analytics pipeline implemented yet (no match ingestion, no performance metrics).
 *     The eligibility snapshot is created in PENDING_DATA_COLLECTION state as a placeholder.
 *
 * Fase 17: First use of the generic Steam onboarding pattern beyond Dota2.
 * Fase 18 (this revision): Fixed schema alignment — PlayerProfile uses canonicalName,
 *   EligibilitySnapshot includes all required fields (game, sampleSize, dataCompleteness,
 *   roleDetectability, rankSignal). Enriched snapshotJson for future pipeline stages.
 */

import * as repo from "./repository";
import type { ConnectedAccount, PlayerProfile, PlayerEligibilitySnapshot, Asset } from "@shared/schema";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Cs2ConnectInput {
  /** SteamID64 — the unique Steam account identifier */
  steamId:            string;
  /** Display name from Steam profile (optional) */
  steamPersonaName?:  string;
  /** Full Steam profile URL (optional) */
  steamProfileUrl?:   string;
}

export interface Cs2BootstrapResult {
  connectedAccount:    ConnectedAccount;
  playerProfile:       PlayerProfile;
  asset:               Asset;
  eligibilitySnapshot: PlayerEligibilitySnapshot;
  /**
   * true  = fresh connection (all objects created this call)
   * false = account already existed, returned as-is (idempotent reconnect)
   */
  isNew: boolean;
  /**
   * true if the new cs2 account inherited VERIFIED status from an existing dota2 steam account.
   * Means the user does NOT need to go through Steam OpenID verification again.
   */
  inheritedVerification: boolean;
}

/**
 * Minimum candidate snapshot for a CS2 player.
 * Produced at the end of onboarding. Consumed by the next pipeline stage
 * (confidence calculator / initial valuation).
 *
 * Fields intentionally match the Dota2 pattern where applicable, keeping
 * the pipeline uniform across games. Fields not yet available for CS2
 * are set to null so future stages can detect and populate them.
 */
export interface Cs2CandidateSnapshot {
  /** GamerStock asset primary key */
  assetId:             number;
  /** Opaque asset UID — "steam:cs2:player:{steamId64}" */
  assetUid:            string;
  /** Steam SteamID64 */
  externalPlayerId:    string;
  /** Steam persona name (displayName) */
  playerName:          string | null;
  game:                "cs2";
  provider:            "steam";
  /** Steam profile URL */
  profileUrl:          string | null;
  /** Avatar/card image — not available until user uploads or Steam sync */
  avatarUrl:           null;
  /** Team/organisation — not yet derivable without CS2 match data */
  teamName:            null;
  /** Region — not yet derivable without CS2 match data */
  region:              null;
  /** Onboarding phase */
  onboardingStatus:    "PENDING_DATA_COLLECTION";
  /** Verification status inherited from dota2 or set via OpenID */
  verificationStatus:  string;
  /** PlayerProfile id */
  playerProfileId:     number;
  /** EligibilitySnapshot id */
  eligibilitySnapshotId: number;
  /** Match sample size (always 0 at onboarding) */
  sampleSize:          0;
  /** ISO timestamp of onboarding */
  onboardedAt:         string;
}

// ─── Internal constants ────────────────────────────────────────────────────────

const PROVIDER_GROUP = "steam" as const;
const GAME           = "cs2"   as const;

const buildCs2AssetUid = (steamId: string): string =>
  `steam:cs2:player:${steamId}`;

// ─── Main orchestration ───────────────────────────────────────────────────────

export const connectCs2Account = async (
  userId: string,
  input: Cs2ConnectInput,
): Promise<Cs2BootstrapResult> => {

  // ── Step 1: Global dedup guard ─────────────────────────────────────────────
  // Check if this Steam ID + game=cs2 combo already exists.
  // (Same SteamID64 can exist for game=dota2 AND game=cs2 — they are separate records.)
  const existing = await repo.findConnectedAccountByProviderIdentity({
    providerGroup:     PROVIDER_GROUP,
    game:              GAME,
    providerAccountId: input.steamId,
  });

  if (existing) {
    if (existing.userId !== userId) {
      const err: any = new Error("This Steam account is already linked to another GamerStock user for CS2.");
      err.code   = "STEAM_ID_ALREADY_CLAIMED";
      err.status = 409;
      throw err;
    }

    // Same user reconnecting — return current state idempotently
    const profile       = await repo.findPlayerProfileByConnectedAccountId(existing.id);
    const assetUid      = buildCs2AssetUid(input.steamId);
    const asset         = await repo.findAssetByUid(assetUid);
    const snapshot      = profile ? await repo.findLatestEligibilitySnapshot(profile.id) : null;

    if (profile && asset && snapshot) {
      return {
        connectedAccount:      existing,
        playerProfile:         profile,
        asset,
        eligibilitySnapshot:   snapshot,
        isNew:                 false,
        inheritedVerification: false,
      };
    }
    // Partial state — fall through to create missing objects
  }

  // ── Step 2: Verification inheritance check ─────────────────────────────────
  // If the user already has a VERIFIED Steam account (dota2 or any other game),
  // the new cs2 account inherits VERIFIED status immediately.
  // This is safe: the SteamID64 ownership was already proved via OpenID.
  const allAccounts = await repo.findConnectedAccountsByUser(userId);
  const alreadyVerifiedSteamAccount = allAccounts.find(
    (a: any) =>
      a.providerGroup === PROVIDER_GROUP &&
      a.providerAccountId === input.steamId &&
      a.verificationStatus === "VERIFIED",
  );
  const inheritedVerification     = !!alreadyVerifiedSteamAccount;
  const initialVerificationStatus = inheritedVerification ? "VERIFIED" : "PENDING";

  // ── Step 3: Create ConnectedAccount ───────────────────────────────────────
  const connectedAccount = existing ?? await repo.createConnectedAccount({
    userId,
    providerGroup:       PROVIDER_GROUP,
    game:                GAME,
    providerAccountId:   input.steamId,
    providerAccountName: input.steamPersonaName ?? null,
    providerProfileUrl:  input.steamProfileUrl  ?? null,
    verificationStatus:  initialVerificationStatus as any,
    isPrimary:           false,
  } as any);

  // ── Step 4: Create PlayerProfile ──────────────────────────────────────────
  // Schema: game (required), canonicalName (required), primaryConnectedAccountId, status.
  // CS2 uses the Steam persona name as the canonical display name at onboarding.
  let playerProfile = await repo.findPlayerProfileByConnectedAccountId(connectedAccount.id);
  if (!playerProfile) {
    const canonicalName = input.steamPersonaName ?? input.steamId;
    playerProfile = await repo.createPlayerProfile({
      game:                      GAME,
      canonicalName,
      primaryConnectedAccountId: connectedAccount.id,
      status:                    "DRAFT",
    });
  }

  // ── Step 5: Ensure a steam/cs2 market exists ──────────────────────────────
  // All CS2 player assets share a single player market (mirroring Dota2).
  const cs2Market = await repo.findOrCreateMarket({
    provider: PROVIDER_GROUP,
    game:     GAME,
    region:   "global",
    scope:    "default",
  });

  // ── Step 6: Create Asset stub ──────────────────────────────────────────────
  const assetUid = buildCs2AssetUid(input.steamId);
  let asset = await repo.findAssetByUid(assetUid);
  if (!asset) {
    asset = await repo.createAssetStub({
      marketId:        cs2Market.id,
      assetUid,
      entityType:      "player",
      externalId:      input.steamId,
      displayName:     input.steamPersonaName ?? input.steamId,
      symbol:          "",
      playerProfileId: playerProfile.id,
      tradingStatus:   "DRAFT",
      listingStatus:   "UNDER_REVIEW",
    });
  }

  // ── Step 7: Create EligibilitySnapshot ────────────────────────────────────
  // CS2 has no performance analytics pipeline yet.
  // PENDING_DATA_COLLECTION is the correct initial state.
  // All schema-required fields are provided to ensure the record is valid and
  // queryable by the next pipeline stage (confidence + valuation).
  const eligibilitySnapshot = await repo.createEligibilitySnapshot({
    playerProfileId:   playerProfile.id,
    game:              GAME,
    isEligible:        false,
    reasonCode:        "PENDING_DATA_COLLECTION",
    sampleSize:        0,
    dataCompleteness:  "0.0000",
    roleDetectability: "0.0000",
    rankSignal:        null,
    snapshotJson:      JSON.stringify({
      phase:              "onboarding",
      game:               GAME,
      provider:           PROVIDER_GROUP,
      steamId:            input.steamId,
      playerName:         input.steamPersonaName ?? null,
      profileUrl:         input.steamProfileUrl  ?? null,
      verificationStatus: initialVerificationStatus,
      inheritedVerification,
      teamName:           null,
      region:             null,
      avatarUrl:          null,
      sampleSize:         0,
      onboardedAt:        new Date().toISOString(),
      note:               "CS2 initial snapshot. No match data ingested yet. Ready for confidence phase.",
    }),
  });

  return {
    connectedAccount,
    playerProfile,
    asset,
    eligibilitySnapshot,
    isNew:                 true,
    inheritedVerification,
  };
};

// ─── Candidate snapshot builder ───────────────────────────────────────────────

/**
 * Builds a structured Cs2CandidateSnapshot from the current bootstrap state.
 * Read-only — does NOT create or modify anything.
 * Returns null if the user has no CS2 account connected.
 *
 * This is the primary output consumed by the next pipeline stage:
 *   → confidence calculator
 *   → initial valuation
 *   → Creator Hub display
 *   → add to terminal
 */
export async function getCs2CandidateSnapshot(
  userId: string,
): Promise<Cs2CandidateSnapshot | null> {
  const accounts   = await repo.findConnectedAccountsByUser(userId);
  const cs2Account = accounts.find(
    (a: any) => a.providerGroup === PROVIDER_GROUP && a.game === GAME,
  ) ?? null;

  if (!cs2Account) return null;

  const steamId64     = (cs2Account as any).providerAccountId as string;
  const personaName   = (cs2Account as any).providerAccountName as string | null;
  const profileUrl    = (cs2Account as any).providerProfileUrl  as string | null;
  const verifStatus   = (cs2Account as any).verificationStatus  as string;

  const profiles = await repo.findPlayerProfilesByUser(userId);
  const profile  = profiles.find((p: any) => p.game === GAME) ?? null;
  if (!profile) return null;

  const assetUid = buildCs2AssetUid(steamId64);
  const asset    = await repo.findAssetByUid(assetUid);
  if (!asset) return null;

  const snapshot = await repo.findLatestEligibilitySnapshot(profile.id);
  if (!snapshot) return null;

  return {
    assetId:              (asset as any).id as number,
    assetUid:             assetUid,
    externalPlayerId:     steamId64,
    playerName:           personaName ?? (asset as any).displayName ?? null,
    game:                 GAME,
    provider:             PROVIDER_GROUP,
    profileUrl:           profileUrl,
    avatarUrl:            null,
    teamName:             null,
    region:               null,
    onboardingStatus:     "PENDING_DATA_COLLECTION",
    verificationStatus:   verifStatus,
    playerProfileId:      profile.id,
    eligibilitySnapshotId: snapshot.id,
    sampleSize:           0,
    onboardedAt:          (snapshot as any).createdAt?.toISOString() ?? new Date().toISOString(),
  };
}

// ─── Status inspect ───────────────────────────────────────────────────────────

export interface Cs2StatusResult {
  connected:             boolean;
  connectedAccount:      ConnectedAccount | null;
  playerProfile:         PlayerProfile | null;
  asset:                 Asset | null;
  eligibilitySnapshot:   PlayerEligibilitySnapshot | null;
  inheritedVerification: boolean;
  /** Structured candidate snapshot — null if onboarding is incomplete */
  candidateSnapshot:     Cs2CandidateSnapshot | null;
}

/**
 * Returns the current CS2 bootstrap state for a GS user.
 * Does NOT create anything — read-only inspection.
 */
export const getCs2Status = async (userId: string): Promise<Cs2StatusResult> => {
  const accounts    = await repo.findConnectedAccountsByUser(userId);
  const cs2Account  = accounts.find(
    (a: any) => a.providerGroup === PROVIDER_GROUP && a.game === GAME,
  ) ?? null;

  if (!cs2Account) {
    return {
      connected: false, connectedAccount: null, playerProfile: null,
      asset: null, eligibilitySnapshot: null, inheritedVerification: false,
      candidateSnapshot: null,
    };
  }

  const playerProfile = await repo.findPlayerProfileByConnectedAccountId(cs2Account.id);
  const assetUid      = buildCs2AssetUid((cs2Account as any).providerAccountId ?? "");
  const asset         = await repo.findAssetByUid(assetUid);
  const eligibilitySnapshot = playerProfile
    ? await repo.findLatestEligibilitySnapshot(playerProfile.id)
    : null;

  const candidateSnapshot = await getCs2CandidateSnapshot(userId);

  return {
    connected: true,
    connectedAccount:    cs2Account,
    playerProfile,
    asset,
    eligibilitySnapshot,
    inheritedVerification: false,
    candidateSnapshot,
  };
};

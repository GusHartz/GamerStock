// ─── Dota2 Onboarding Service ─────────────────────────────────────────────────
// Orchestrates the full connect flow for a GS user linking a Steam/Dota2 account:
//
//   GS User
//     → ConnectedAccount (steam + dota2, status=PENDING)
//     → PlayerProfile    (dota2,        status=DRAFT)
//     → Asset stub       (steam market, tradingStatus=DRAFT, listingStatus=UNDER_REVIEW)
//     → EligibilitySnapshot (isEligible=false, reasonCode=PENDING_DATA_COLLECTION)
//
// Rules enforced here:
//  1. ConnectedAccount stays separate from PlayerProfile
//  2. PlayerProfile stays separate from User
//  3. Asset stays separate from ConnectedAccount
//  4. Connecting does NOT auto-list or activate the asset
//  5. Duplicate providerAccountId is rejected (409 upstream) or returned (idempotent mode)
//  6. LoL assets/profiles are untouched
// ─────────────────────────────────────────────────────────────────────────────
import * as repo from "./repository";
import type { ConnectedAccount, PlayerProfile, PlayerEligibilitySnapshot, Asset } from "@shared/schema";

export interface Dota2ConnectInput {
  /** SteamID64 — the unique Steam account identifier */
  steamId:             string;
  /** Display name from Steam profile (optional) */
  steamPersonaName?:   string;
  /** Full Steam profile URL (optional) */
  steamProfileUrl?:    string;
}

export interface Dota2BootstrapResult {
  connectedAccount:    ConnectedAccount;
  playerProfile:       PlayerProfile;
  asset:               Asset;
  eligibilitySnapshot: PlayerEligibilitySnapshot;
  /**
   * true  = fresh connection (all four objects created this call)
   * false = account already existed, returned as-is (idempotent reconnect)
   */
  isNew: boolean;
}

// ─── Internal helper ──────────────────────────────────────────────────────────

const PROVIDER_GROUP = "steam" as const;
const GAME           = "dota2" as const;

/**
 * Build the canonical asset UID for a Dota2 player.
 * Format mirrors LoL: "riot:lol:player:{puuid}"
 */
const buildDota2AssetUid = (steamId: string): string =>
  `steam:dota2:player:${steamId}`;

// ─── Main orchestration function ──────────────────────────────────────────────

export const connectDota2Account = async (
  userId: string,
  input: Dota2ConnectInput,
): Promise<Dota2BootstrapResult> => {

  // ── Step 1: Global dedup guard ─────────────────────────────────────────────
  // Check whether this Steam ID is ALREADY claimed by ANY GS user.
  // If the same user is reconnecting we return their existing data (idempotent).
  // If a DIFFERENT user claims it, we reject with a specific error.
  const existing = await repo.findConnectedAccountByProviderIdentity({
    providerGroup: PROVIDER_GROUP,
    game: GAME,
    providerAccountId: input.steamId,
  });

  if (existing) {
    if (existing.userId !== userId) {
      const err: any = new Error("This Steam account is already linked to another GamerStock user.");
      err.code = "STEAM_ID_ALREADY_CLAIMED";
      err.status = 409;
      throw err;
    }

    // Same user reconnecting — return their current bootstrap state (idempotent).
    const profile   = await repo.findPlayerProfileByConnectedAccountId(existing.id);
    const assetUid  = buildDota2AssetUid(input.steamId);
    const asset     = await repo.findAssetByUid(assetUid);
    const snapshot  = profile ? await repo.findLatestEligibilitySnapshot(profile.id) : null;

    if (!profile || !asset || !snapshot) {
      // Partial state from a previous interrupted flow — fall through to creation
      // of any missing objects by continuing execution below.
      // (This recovers from partial failures without leaving orphaned records.)
    } else {
      return { connectedAccount: existing, playerProfile: profile, asset, eligibilitySnapshot: snapshot, isNew: false };
    }
  }

  // ── Step 2: Create ConnectedAccount ───────────────────────────────────────
  const connectedAccount = existing ?? await repo.createConnectedAccount({
    userId,
    providerGroup:       PROVIDER_GROUP,
    game:                GAME,
    providerAccountId:   input.steamId,
    providerAccountName: input.steamPersonaName ?? null,
    providerProfileUrl:  input.steamProfileUrl  ?? null,
    verificationStatus:  "PENDING",
    isPrimary:           true,
  });

  // ── Step 3: Create or recover PlayerProfile ────────────────────────────────
  // Only one profile allowed per connected account (partial-unique index in DB).
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

  // ── Step 4: Ensure a steam/dota2 market exists ────────────────────────────
  // All Dota2 player assets share a single "player market" for now.
  // Fase 3+ may segment by region/queue as data flows in.
  const dota2Market = await repo.findOrCreateMarket({
    provider: PROVIDER_GROUP,
    game:     GAME,
    region:   "global",
    scope:    "default",
  });

  // ── Step 5: Create or recover Asset stub ──────────────────────────────────
  // asset_uid is globally unique: steam:dota2:player:{steamId}
  // tradingStatus=DRAFT  → not tradeable yet
  // listingStatus=UNDER_REVIEW → not listed/visible in public terminal
  const assetUid = buildDota2AssetUid(input.steamId);
  let asset = await repo.findAssetByUid(assetUid);
  if (!asset) {
    asset = await repo.createAssetStub({
      marketId:        dota2Market.id,
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

  // ── Step 6: Create initial EligibilitySnapshot ────────────────────────────
  // isEligible=false, reasonCode=PENDING_DATA_COLLECTION
  // This is a point-in-time snapshot; Fase 3 will refresh it after match ingestion.
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
      phase:     "onboarding",
      steamId:   input.steamId,
      note:      "Initial snapshot. No match data ingested yet.",
    }),
  });

  return { connectedAccount, playerProfile, asset, eligibilitySnapshot, isNew: true };
};

// ─── Status inspect ───────────────────────────────────────────────────────────

export interface Dota2StatusResult {
  connected:           boolean;
  connectedAccount:    ConnectedAccount | null;
  playerProfile:       PlayerProfile | null;
  asset:               Asset | null;
  eligibilitySnapshot: PlayerEligibilitySnapshot | null;
}

/**
 * Returns the current Dota2 bootstrap state for a GS user.
 * Does NOT create anything — read-only inspection.
 */
export const getDota2Status = async (userId: string): Promise<Dota2StatusResult> => {
  const accounts = await repo.findConnectedAccountsByUser(userId);
  const dota2Account = accounts.find(
    (a) => a.providerGroup === PROVIDER_GROUP && a.game === GAME,
  ) ?? null;

  if (!dota2Account) {
    return { connected: false, connectedAccount: null, playerProfile: null, asset: null, eligibilitySnapshot: null };
  }

  const playerProfile = await repo.findPlayerProfileByConnectedAccountId(dota2Account.id);
  const assetUid      = buildDota2AssetUid(dota2Account.providerAccountId);
  const asset         = await repo.findAssetByUid(assetUid);
  const eligibilitySnapshot = playerProfile
    ? await repo.findLatestEligibilitySnapshot(playerProfile.id)
    : null;

  return {
    connected: true,
    connectedAccount:    dota2Account,
    playerProfile,
    asset,
    eligibilitySnapshot,
  };
};

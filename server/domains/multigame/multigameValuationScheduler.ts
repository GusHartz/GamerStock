// ─── Multigame Dynamic Valuation Loop ─────────────────────────────────────────
//
// Continuously updates valuation state for ALL ACTIVE/LISTED Dota2 and CS2
// assets while they are live in the Terminal.
//
// Phase 2 (2026-04-05): All assets — bulk and user-linked — go through the
// same loop. No static-price exceptions. No bulk bypass.
//
// Architecture — two asset classes, one loop:
//
//   User-linked assets (player_profile_id ≠ 0):
//   ─────────────────────────────────────────────
//   Dota2:
//     1. syncDota2Matches(userId)      → fetch new raw matches from OpenDota
//     2. updateDota2Valuation(userId)  → apply unapplied performance scores (EMA)
//        └── projectDota2ValuationToCanonical → updates fundamentalPrice
//
//   CS2:
//     1. syncCs2Stats(userId)          → fetch career stats from Steam
//        └── refreshCs2ValuationFromMatchData → V2 EMA update
//        └── projectDota2ValuationToCanonical → updates fundamentalPrice
//        └── synthetic match pipeline         → updates lastTradePrice if new matches detected
//
//   Bulk assets (player_profile_id = 0):
//   ──────────────────────────────────────
//   Dota2:
//     updateBulkDota2ValuationFromProvider(assetId, openDotaAccountId)
//       → GET /api/players/{id}/wl → winRate proxy → EMA delta
//       → RECALC event if |delta| ≥ 0.05
//       → always touches updatedAt (loop coverage tracking)
//
//   CS2:
//     updateBulkCs2ValuationFromProvider(assetId, pandascoreId)
//       → PandaScore currently 401 → returns PROVIDER_UNAVAILABLE explicitly
//       → always touches updatedAt (loop coverage tracking)
//
// Assets that cannot be processed stay in the loop — they return explicit error
// codes, never silent empty results. The reconciler quarantines assets that
// remain at baseline price after multiple cycles.
//
// Price rule enforced:
//   - This scheduler NEVER directly sets lastTradePrice
//   - It updates fundamentalPrice via the valuation services
//   - The PAE (Performance Anchor Engine) in market-maker.ts pulls
//     lastTradePrice toward fundamentalPrice every 60 seconds
//
// Safety:
//   - All per-asset errors are caught and logged — loop never aborts
//   - 300ms inter-asset delay for bulk assets (API throttling)
//   - 500ms inter-player delay for user-linked assets
//   - Warm-up: 5 minutes after boot to not compete with startup seed
//
// ─────────────────────────────────────────────────────────────────────────────

import { db }                     from "../../db";
import { assets }                 from "@shared/schema";
import { dota2ValuationState }    from "@shared/schema/multigame";
import { playerProfiles, connectedAccounts } from "@shared/schema";
import { eq, and, inArray, isNotNull, or, like } from "drizzle-orm";
import { syncDota2Matches }       from "./dota2MatchSyncService";
import { updateDota2Valuation, updateBulkDota2ValuationFromProvider } from "./dota2ValuationService";
import { syncCs2Stats }           from "./cs2MatchSyncService";
import { updateBulkCs2ValuationFromProvider } from "./cs2ValuationService";

// ── Constants ─────────────────────────────────────────────────────────────────

/** How often the valuation cycle runs (10 minutes). */
const LOOP_INTERVAL_MS = 10 * 60 * 1000;

/** Delay before first run after server boot (5 minutes). */
const WARMUP_MS = 5 * 60 * 1000;

/** Inter-player delay for user-linked assets (avoid hammering Steam/OpenDota). */
const INTER_PLAYER_DELAY_MS = 500;

/** Inter-asset delay for bulk assets (lighter API calls or no-op for CS2). */
const INTER_BULK_DELAY_MS = 300;

const SUPPORTED_GAMES = ["dota2", "cs2"] as const;

// ── Observability state (Phase 0) ─────────────────────────────────────────────
/** Timestamp of the last completed valuation cycle. Null until the first cycle finishes. */
export let lastLoopRun: Date | null = null;

/** Summary metrics from the most recent completed valuation cycle. */
export interface CycleSummary {
  totalAssetsProcessed: number;
  updatedAssets:        number;
  errors:               number;
  durationMs:           number;
  userLinked:           number;
  bulk:                 number;
  completedAt:          string;
}
export let lastCycleSummary: CycleSummary | null = null;

// ── Types ─────────────────────────────────────────────────────────────────────

interface LinkedProfile {
  profileId:     number;
  game:          string;
  userId:        string;
  canonicalName: string | null;
}

interface BulkAsset {
  id:       number;
  assetUid: string;
  game:     "dota2" | "cs2";
  playerId: string;
}

// ── Asset discovery ────────────────────────────────────────────────────────────

/**
 * Returns all player-linked profiles for Dota2 and CS2.
 * Excludes platform-sentinel profiles (primaryConnectedAccountId IS NULL).
 */
async function getLinkedProfiles(): Promise<LinkedProfile[]> {
  const rows = await db
    .select({
      profileId:     playerProfiles.id,
      game:          playerProfiles.game,
      userId:        connectedAccounts.userId,
      canonicalName: playerProfiles.canonicalName,
    })
    .from(playerProfiles)
    .innerJoin(
      connectedAccounts,
      eq(connectedAccounts.id, playerProfiles.primaryConnectedAccountId as any),
    )
    .where(
      and(
        isNotNull(playerProfiles.primaryConnectedAccountId),
        inArray(playerProfiles.game, SUPPORTED_GAMES as any),
      ),
    );

  return rows as LinkedProfile[];
}

/**
 * Returns all ACTIVE/LISTED bulk assets (player_profile_id = 0) for Dota2 and CS2.
 * These assets are not covered by the user-linked path and require a provider
 * API call (OpenDota for Dota2, PandaScore for CS2).
 */
async function getBulkActiveListedAssets(): Promise<BulkAsset[]> {
  const rows = await db
    .select({
      id:       assets.id,
      assetUid: assets.assetUid,
    })
    .from(assets)
    .innerJoin(dota2ValuationState, eq(dota2ValuationState.assetId, assets.id))
    .where(
      and(
        or(
          like(assets.assetUid, "dota2:%"),
          like(assets.assetUid, "cs2:%"),
        ),
        eq(assets.listingStatus,               "LISTED"),
        eq(assets.tradingStatus,               "ACTIVE"),
        eq(dota2ValuationState.playerProfileId, 0),
      ),
    );

  return rows.map(row => {
    const parts    = row.assetUid.split(":");
    const gameRaw  = parts[0] as "dota2" | "cs2";
    const playerId = parts[3] ?? "";
    return {
      id:       row.id,
      assetUid: row.assetUid,
      game:     gameRaw,
      playerId,
    };
  });
}

// ── User-linked processors ────────────────────────────────────────────────────

/**
 * Dota2 dynamic valuation pipeline for one user-linked player.
 *
 * Step 1: Sync new raw matches from OpenDota (idempotent).
 * Step 2: Apply any unapplied performance scores via EMA.
 */
async function processDota2Profile(userId: string, profileId: number): Promise<boolean> {
  let updated = false;
  try {
    const syncResult = await syncDota2Matches({ userId });
    if (syncResult.inserted > 0 || syncResult.updated > 0) {
      console.log(
        `[MultigameValuation] Dota2 sync profileId=${profileId} ` +
        `fetched=${syncResult.fetched} inserted=${syncResult.inserted} updated=${syncResult.updated}`,
      );
    }
  } catch (err: any) {
    if (err.message !== "DOTA2_ACCOUNT_NOT_CONNECTED") {
      console.warn(`[MultigameValuation] Dota2 sync warn profileId=${profileId}: ${err.message}`);
    }
  }

  try {
    const vResult = await updateDota2Valuation(userId);
    if (vResult.processed > 0) {
      updated = true;
      console.log(
        `[MultigameValuation] Dota2 valuation updated profileId=${profileId} ` +
        `processed=${vResult.processed} ` +
        `rawValue=${vResult.rawValueAfter.toFixed(4)} ` +
        `playerValue=${vResult.playerValueAfter.toFixed(4)} ` +
        `confidence=${vResult.confidenceScore.toFixed(4)}`,
      );
    }
  } catch (err: any) {
    if (
      err.message !== "VALUATION_NOT_BOOTSTRAPPED" &&
      err.message !== "DOTA2_ASSET_NOT_FOUND" &&
      err.message !== "DOTA2_PROFILE_NOT_FOUND"
    ) {
      console.warn(
        `[MultigameValuation] Dota2 valuation warn profileId=${profileId}: ${err.message}`,
      );
    }
  }
  return updated;
}

/**
 * CS2 dynamic valuation pipeline for one user-linked player.
 */
async function processCs2Profile(userId: string, profileId: number): Promise<boolean> {
  let updated = false;
  try {
    const syncResult = await syncCs2Stats({ userId });

    const valuationSummary = syncResult.valuation
      ? `path=${syncResult.valuation.valuationPath} playerValue=${syncResult.valuation.playerValueAfter.toFixed(4)}`
      : "skipped";

    const synthSummary = syncResult.syntheticPipeline
      ? `deltaMatches=${syncResult.syntheticPipeline.deltaMatches} ` +
        `generated=${syncResult.syntheticPipeline.matchesGenerated} ` +
        `priceAfter=${syncResult.syntheticPipeline.lastTradePriceAfter.toFixed(2)}`
      : "no-delta";

    if (syncResult.valuation) updated = true;

    console.log(
      `[MultigameValuation] CS2 sync profileId=${profileId} ` +
      `provider=${syncResult.providerStatus} ` +
      `matches=${syncResult.readiness.totalMatches} ` +
      `valuation=${valuationSummary} ` +
      `synthetic=${synthSummary}`,
    );
  } catch (err: any) {
    const knownErrors = [
      "CS2_ACCOUNT_NOT_CONNECTED",
      "CS2_PROFILE_NOT_FOUND",
      "INVALID_API_KEY",
      "NO_API_KEY",
    ];
    if (!knownErrors.includes(err.message) && !knownErrors.includes(err.code)) {
      console.warn(`[MultigameValuation] CS2 sync warn profileId=${profileId}: ${err.message}`);
    }
  }
  return updated;
}

// ── Bulk asset processors ──────────────────────────────────────────────────────

/**
 * Bulk Dota2 dynamic update via OpenDota public API.
 * Extracts openDotaAccountId from assetUid and calls the provider pipeline.
 */
async function processBulkDota2Asset(asset: BulkAsset): Promise<boolean> {
  if (!asset.playerId) {
    console.warn(`[MultigameValuation] Bulk Dota2 assetId=${asset.id} has no playerId in uid=${asset.assetUid} — skipping`);
    return false;
  }
  const result = await updateBulkDota2ValuationFromProvider(asset.id, asset.playerId);
  if (result.updated) {
    console.log(
      `[MultigameValuation] Bulk Dota2 assetId=${asset.id} RECALC ` +
      `delta=${result.delta?.toFixed(4)} ` +
      `playerValue=${result.playerValueAfter?.toFixed(4)}`,
    );
  }
  return result.updated;
}

/**
 * Bulk CS2 loop coverage — PandaScore currently unavailable (401).
 * Touches updatedAt and logs explicit PROVIDER_UNAVAILABLE result.
 */
async function processBulkCs2Asset(asset: BulkAsset): Promise<boolean> {
  if (!asset.playerId) {
    console.warn(`[MultigameValuation] Bulk CS2 assetId=${asset.id} has no playerId in uid=${asset.assetUid} — skipping`);
    return false;
  }
  const result = await updateBulkCs2ValuationFromProvider(asset.id, asset.playerId);
  if (result.reason && result.reason !== "PROVIDER_UNAVAILABLE") {
    console.warn(
      `[MultigameValuation] Bulk CS2 assetId=${asset.id} unexpected result: reason=${result.reason}`,
    );
  }
  return result.updated;
}

// ── Main cycle ────────────────────────────────────────────────────────────────

async function runValuationCycle(): Promise<void> {
  const start = Date.now();
  let totalAssetsProcessed = 0;
  let updatedAssets        = 0;
  let errors               = 0;

  // ── Phase A: User-linked assets ───────────────────────────────────────────
  let profiles: LinkedProfile[];
  try {
    profiles = await getLinkedProfiles();
  } catch (err: any) {
    console.error("[MultigameValuation] Failed to load user-linked profiles:", err.message);
    profiles = [];
  }

  for (const profile of profiles) {
    const { profileId, game, userId, canonicalName } = profile;
    try {
      let didUpdate = false;
      if (game === "dota2") {
        didUpdate = await processDota2Profile(userId, profileId);
      } else if (game === "cs2") {
        didUpdate = await processCs2Profile(userId, profileId);
      }
      totalAssetsProcessed++;
      if (didUpdate) updatedAssets++;
    } catch (err: any) {
      errors++;
      console.error(
        `[MultigameValuation] Unexpected error profileId=${profileId} ` +
        `game=${game} name=${canonicalName ?? "unknown"}: ${err.message}`,
      );
    }

    if (profiles.length > 1) {
      await new Promise(r => setTimeout(r, INTER_PLAYER_DELAY_MS));
    }
  }

  // ── Phase B: Bulk assets ──────────────────────────────────────────────────
  let bulkAssets: BulkAsset[];
  try {
    bulkAssets = await getBulkActiveListedAssets();
  } catch (err: any) {
    console.error("[MultigameValuation] Failed to load bulk assets:", err.message);
    bulkAssets = [];
  }

  for (const asset of bulkAssets) {
    try {
      let didUpdate = false;
      if (asset.game === "dota2") {
        didUpdate = await processBulkDota2Asset(asset);
      } else if (asset.game === "cs2") {
        didUpdate = await processBulkCs2Asset(asset);
      }
      totalAssetsProcessed++;
      if (didUpdate) updatedAssets++;
    } catch (err: any) {
      errors++;
      console.error(
        `[MultigameValuation] Unexpected error bulk assetId=${asset.id} ` +
        `game=${asset.game} uid=${asset.assetUid}: ${err.message}`,
      );
    }

    if (bulkAssets.length > 1) {
      await new Promise(r => setTimeout(r, INTER_BULK_DELAY_MS));
    }
  }

  lastLoopRun = new Date();
  lastCycleSummary = {
    totalAssetsProcessed,
    updatedAssets,
    errors,
    durationMs:  Date.now() - start,
    userLinked:  profiles.length,
    bulk:        bulkAssets.length,
    completedAt: lastLoopRun.toISOString(),
  };

  console.log(JSON.stringify({ type: "VALUATION_LOOP", ...lastCycleSummary }));
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

/**
 * Start the continuous multigame valuation loop.
 *
 * Processes ALL ACTIVE/LISTED Dota2 and CS2 assets every LOOP_INTERVAL_MS:
 *   - User-linked assets: via Steam / OpenDota account data
 *   - Bulk assets: via provider API (OpenDota for Dota2, PandaScore for CS2)
 *
 * All errors are caught — the loop never stops on per-asset errors.
 * Call once during server startup (server/index.ts).
 */
export function startMultigameValuationLoop(): void {
  const scheduleNext = () => setTimeout(async () => {
    await runValuationCycle().catch((err: any) => {
      console.error("[MultigameValuation] Cycle error (non-fatal):", err.message);
    });
    scheduleNext();
  }, LOOP_INTERVAL_MS);

  setTimeout(() => {
    runValuationCycle().catch((err: any) => {
      console.error("[MultigameValuation] Initial cycle error (non-fatal):", err.message);
    });
    scheduleNext();
  }, WARMUP_MS);

  console.log(
    `[BOOT] Multigame valuation loop scheduled ` +
    `(warmup=${WARMUP_MS / 60000}min, interval=${LOOP_INTERVAL_MS / 60000}min) ` +
    `[Phase 2: ALL ACTIVE/LISTED assets — bulk + user-linked]`,
  );
}

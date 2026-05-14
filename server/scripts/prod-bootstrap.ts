import "dotenv/config";
// ─── GamerStock Production Bootstrap ──────────────────────────────────────────
//
// Explicit, reproducible database bootstrap for a fresh production environment.
// Run this ONCE after `db:push` has been executed on the target database.
//
// Usage:
//   npx tsx server/scripts/prod-bootstrap.ts
//
// What it covers (all steps are idempotent — safe to re-run):
//   STEP 0  Schema sync          — runs db:push to ensure all tables exist
//   STEP 1  Canonical markets    — Riot (LoL), Sandbox, Dota2
//   STEP 2  Dota2 assets         — bootstrap ~800 players → valuations → AMM
//   STEP 3  Prediction markets   — open all draft markets
//   STEP 4  Display queue        — fill hero / featured / upcoming / predictions
//   STEP 5  State report         — print final counts for every domain
//
// This script does NOT alter product runtime behaviour.
// Nothing here runs on server startup.
// ─────────────────────────────────────────────────────────────────────────────

import { execSync } from "child_process";
import { eq, like, sql } from "drizzle-orm";

// ── DB and schema ─────────────────────────────────────────────────────────────

import { db } from "../db";
import { markets, assets, assetMarkets, assetMarketState } from "@shared/schema";
import { predictionMarkets, predictionEvents } from "../../shared/schema/prediction";
import { predictionDisplayQueue } from "../../shared/schema/ingestion";

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(step: string, msg: string) {
  console.log(`[bootstrap:${step}] ${msg}`);
}

function err(step: string, msg: string) {
  console.error(`[bootstrap:${step}] ERROR — ${msg}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 0 — Schema sync
// ─────────────────────────────────────────────────────────────────────────────

async function step0_schema() {
  log("schema", "Running db:push...");
  try {
    execSync("npm run db:push", { stdio: "inherit", timeout: 90_000 });
    log("schema", "db:push complete.");
  } catch (e: any) {
    err("schema", `db:push failed: ${e?.message}`);
    throw new Error("Schema sync failed — cannot continue.");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 — Canonical markets
// ─────────────────────────────────────────────────────────────────────────────

async function step1_markets() {
  log("markets", "Ensuring canonical markets...");
  const { getOrCreateMarket } = await import("../market-core/asset-registry");

  // Riot/LoL market is created implicitly when players are synced.
  // We call syncCanonicalMarket which fetches from the Riot API and creates
  // the market with the correct region/scope for the NA1 Challenger ladder.
  try {
    const { syncCanonicalMarket } = await import("../market-core/sync");
    const r = await syncCanonicalMarket();
    log("markets", `Riot/LoL sync: fetched=${r.fetched} upserted=${r.upserted}`);
  } catch (e: any) {
    log("markets", `Riot/LoL sync failed (non-fatal, RIOT_API_KEY may be missing): ${e?.message}`);
  }

  // Sandbox market (legacy vault system)
  await getOrCreateMarket({
    provider: "gamerstock",
    game: "lol",
    region: "SANDBOX",
    scope: "SANDBOX",
    entityType: "player",
    externalId: "sandbox",
    displayName: "Sandbox",
    symbol: "",
  });
  log("markets", "Sandbox market ensured.");

  // Dota2/Steam market
  await getOrCreateMarket({
    provider: "steam",
    game: "dota2",
    region: "global",
    scope: "default",
    entityType: "player",
    externalId: "dota2-global",
    displayName: "Dota2 Global",
    symbol: "",
  });
  log("markets", "Dota2/Steam market ensured.");

  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(markets);
  log("markets", `Done. markets table has ${n} rows.`);
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — Dota2 asset pipeline
// ─────────────────────────────────────────────────────────────────────────────

async function step2_assets() {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(assets)
    .where(like(assets.assetUid, "dota2:%"));

  if (Number(n) > 0) {
    log("assets", `${n} Dota2 assets already exist — skipping bootstrap.`);

    // Still ensure AMM rows exist for any asset missing them
    await _ensureAmm();
    return;
  }

  log("assets", "No Dota2 assets found — running full bootstrap pipeline...");

  // 2a. Bootstrap players from OpenDota
  const { bootstrapDota2Market } = await import("../domains/multigame/dota2MarketBootstrapService");
  const r = await bootstrapDota2Market({ limit: 800, activeOnly: false, basePrice: "15.00" });
  log("assets", `2a bootstrap — created=${r.created} skipped=${r.skipped} errors=${r.errors.length}`);

  if (r.created === 0 && r.skipped === 0) {
    err("assets", "No assets created — check OpenDota connectivity.");
    return;
  }

  // 2b. Seed initial valuations
  try {
    const { seedInitialValuations } = await import("../services/valuationJob");
    await seedInitialValuations();
    log("assets", "2b valuations seeded.");
  } catch (e: any) {
    err("assets", `2b valuation seed failed: ${e?.message}`);
  }

  // 2c. Run valuation batch (sets lastTradePrice)
  try {
    const { runValuationBatch } = await import("../services/valuationJob");
    await runValuationBatch();
    log("assets", "2c valuation batch complete.");
  } catch (e: any) {
    err("assets", `2c valuation batch failed: ${e?.message}`);
  }

  // 2d. Backfill trading asset links (vault ↔ asset joins)
  try {
    const { backfillTradingAssetLinks } = await import("../market-core/backfill-trading-assets");
    const res = await backfillTradingAssetLinks();
    log("assets", `2d backfill — ${JSON.stringify(res)}`);
  } catch (e: any) {
    err("assets", `2d backfill failed: ${e?.message}`);
  }

  // 2e. Seed AMM (asset_markets + asset_market_state)
  await _ensureAmm();
}

async function _ensureAmm() {
  const { supplyForPrice, DEFAULT_AMM_PARAMS } = await import("../services/ammPricing");

  const allAssets = await db
    .select({ id: assets.id, lastTradePrice: assets.lastTradePrice })
    .from(assets)
    .where(like(assets.assetUid, "dota2:%"));

  let created = 0;
  for (const asset of allAssets) {
    await db.insert(assetMarkets).values({
      assetId: asset.id,
      isEnabled: true,
      floorPrice: "5.00",
      paramA: "5.00",
      paramB: "100.00",
    }).onConflictDoNothing();

    const price = parseFloat(asset.lastTradePrice || "15");
    const supply = supplyForPrice(price, DEFAULT_AMM_PARAMS);
    await db.insert(assetMarketState).values({
      assetId: asset.id,
      supply: supply.toFixed(6),
      lastPrice: asset.lastTradePrice || "15.00",
      version: 1,
    }).onConflictDoNothing();
    created++;
  }
  log("assets", `AMM ensured for ${created} Dota2 assets.`);
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3 — Prediction markets
// ─────────────────────────────────────────────────────────────────────────────

async function step3_predictions() {
  const [{ openCount }] = await db
    .select({ openCount: sql<number>`count(*)::int` })
    .from(predictionMarkets)
    .where(eq(predictionMarkets.status, "open"));

  if (Number(openCount) > 0) {
    log("predictions", `${openCount} open markets already exist — skipping.`);
    return;
  }

  const drafts = await db
    .select({ id: predictionMarkets.id })
    .from(predictionMarkets)
    .where(eq(predictionMarkets.status, "draft"));

  if (drafts.length === 0) {
    log("predictions", "No draft markets found.");
    log("predictions", "Hint: wait for the ingestion scheduler to run (fires every 15 min),");
    log("predictions", "then re-run this script, or use the Admin → Ingestion panel to approve candidates.");
    return;
  }

  log("predictions", `Opening ${drafts.length} draft markets...`);
  const { predictionService } = await import("../domains/prediction/service");

  let opened = 0, failed = 0;
  for (const m of drafts) {
    const r = await predictionService.transitionMarketStatus({
      marketId: m.id,
      targetStatus: "open",
      actorUserId: "bootstrap",
    }).catch(() => ({ success: false }));
    if (r.success) opened++;
    else failed++;
  }

  log("predictions", `Done. opened=${opened} failed=${failed} out of ${drafts.length}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 4 — Display queue
// ─────────────────────────────────────────────────────────────────────────────

const SURFACE_SLOTS: Array<{ surface: string; count: number }> = [
  { surface: "hero",        count: 1 },
  { surface: "featured",    count: 4 },
  { surface: "upcoming",    count: 5 },
  { surface: "predictions", count: 10 },
];

async function step4_displayQueue() {
  // Check current queue
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(predictionDisplayQueue)
    .where(eq(predictionDisplayQueue.isActive, true));

  if (Number(n) > 0) {
    log("queue", `Display queue already has ${n} active entries — skipping.`);
    return;
  }

  log("queue", "Display queue is empty — filling from open-market events...");

  // Gather distinct event IDs that have open markets, ordered by event start time DESC
  const rows = await db
    .selectDistinct({
      eventId: predictionMarkets.eventId,
      startsAt: predictionEvents.startsAt,
    })
    .from(predictionMarkets)
    .leftJoin(predictionEvents, eq(predictionMarkets.eventId, predictionEvents.id))
    .where(eq(predictionMarkets.status, "open"))
    .orderBy(sql`${predictionEvents.startsAt} DESC NULLS LAST`)
    .limit(50);

  const eventIds = rows
    .map(r => r.eventId)
    .filter((id): id is number => id !== null && id !== undefined);

  if (eventIds.length === 0) {
    log("queue", "No open-market events found — skipping. Run step 3 first.");
    return;
  }

  const { displayQueueService } = await import("../domains/ingestion/services/displayQueueService");

  let cursor = 0;
  let added = 0;
  let skipped = 0;

  for (const { surface, count } of SURFACE_SLOTS) {
    let slotsFilled = 0;
    while (slotsFilled < count && cursor < eventIds.length) {
      try {
        await displayQueueService.addEventToDisplayQueue({
          entityId: eventIds[cursor],
          surface,
          createdBy: "bootstrap",
        });
        slotsFilled++;
        added++;
      } catch {
        // Duplicate guard in service — just skip
        skipped++;
      }
      cursor++;
    }
    log("queue", `  ${surface}: ${slotsFilled} event(s) added.`);
  }

  log("queue", `Done. added=${added} skipped=${skipped}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 5 — Final state report
// ─────────────────────────────────────────────────────────────────────────────

async function step5_report() {
  const [[{ mkt }], [{ ast }], [{ am }], [{ ams }], [{ pmOpen }], [{ pmDraft }], [{ pe }], [{ dq }]] =
    await Promise.all([
      db.select({ mkt: sql<number>`count(*)::int` }).from(markets),
      db.select({ ast: sql<number>`count(*)::int` }).from(assets),
      db.select({ am: sql<number>`count(*)::int` }).from(assetMarkets),
      db.select({ ams: sql<number>`count(*)::int` }).from(assetMarketState),
      db.select({ pmOpen: sql<number>`count(*)::int` }).from(predictionMarkets).where(eq(predictionMarkets.status, "open")),
      db.select({ pmDraft: sql<number>`count(*)::int` }).from(predictionMarkets).where(eq(predictionMarkets.status, "draft")),
      db.select({ pe: sql<number>`count(*)::int` }).from(predictionEvents),
      db.select({ dq: sql<number>`count(*)::int` }).from(predictionDisplayQueue).where(eq(predictionDisplayQueue.isActive, true)),
    ]);

  console.log("");
  console.log("══════════════════════════════════════════════════════");
  console.log("  GamerStock Bootstrap — Final State");
  console.log("══════════════════════════════════════════════════════");
  console.log(`  markets              ${mkt}`);
  console.log(`  assets               ${ast}`);
  console.log(`  asset_markets        ${am}`);
  console.log(`  asset_market_state   ${ams}`);
  console.log(`  prediction_events    ${pe}`);
  console.log(`  prediction_markets (open)  ${pmOpen}`);
  console.log(`  prediction_markets (draft) ${pmDraft}`);
  console.log(`  display_queue (active)     ${dq}`);
  console.log("══════════════════════════════════════════════════════");
  console.log("");

  // DEV reference (as of 2026-03-18):
  //   markets=3  assets=1019  asset_markets=718  asset_market_state=718
  //   prediction_events=260  prediction_markets(open)=28  display_queue=12
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 6 — Migrate legacy UNDER_REVIEW assets to LISTED
// ─────────────────────────────────────────────────────────────────────────────
//
// Historical bug: bootstrap services flagged dota2 assets as listing_status
// 'UNDER_REVIEW' when OpenDota returned no WL data or games-played was below
// minGames. Those assets are orphan/bootstrap-only (no player_profile_id) and
// should be visible in /assets regardless of eligibility — the eligibility
// signal is already conveyed by trading_status='PAUSED' (which keeps them
// non-tradeable but listed).
//
// This step is idempotent: subsequent runs UPDATE zero rows.

async function step6_migrateListingStatus() {
  log("listing-mig", "Migrating UNDER_REVIEW orphan assets to LISTED...");
  try {
    const result = await db.execute(sql`
      UPDATE assets
      SET listing_status = 'LISTED', updated_at = NOW()
      WHERE listing_status = 'UNDER_REVIEW'
        AND player_profile_id IS NULL
    `);
    const rowCount = (result as any).rowCount ?? 0;
    log("listing-mig", `Migrated ${rowCount} assets (UNDER_REVIEW → LISTED).`);
  } catch (e: any) {
    err("listing-mig", `Migration failed: ${e?.message}`);
    // Non-fatal — bootstrap continues.
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log("");
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║   GamerStock — Production Bootstrap                  ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log("");

  try {
    await step0_schema();
    console.log("");

    await step1_markets();
    console.log("");

    await step2_assets();
    console.log("");

    await step3_predictions();
    console.log("");

    await step4_displayQueue();
    console.log("");

    await step6_migrateListingStatus();
    console.log("");

    await step5_report();

    console.log("Bootstrap complete. Exit 0.");
    process.exit(0);
  } catch (e: any) {
    console.error("[bootstrap] Fatal error:", e?.message || e);
    process.exit(1);
  }
}

main();

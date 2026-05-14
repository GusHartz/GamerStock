import { db } from "../db";
import { markets, assets, vaults, assetMarkets, assetMarketState } from "@shared/schema";
import { dota2ValuationState } from "@shared/schema/multigame";
import { like, sql } from "drizzle-orm";
import { syncCanonicalMarket } from "./sync";
import { getOrCreateMarket, upsertAssetsFromProvider } from "./asset-registry";
import { supplyForPrice, DEFAULT_AMM_PARAMS } from "../services/ammPricing";

export async function runStartupSeed() {
  const env = process.env.NODE_ENV || "development";
  const isProd = env === "production";

  console.log(`[Seed] ── Startup Seed BEGIN (env=${env}) ──`);

  try {
    // ── 1. Riot canonical market ─────────────────────────────────────────────
    const [{ marketCount }] = await db
      .select({ marketCount: sql<number>`count(*)::int` })
      .from(markets);

    const [{ assetCount }] = await db
      .select({ assetCount: sql<number>`count(*)::int` })
      .from(assets);

    if (Number(marketCount) === 0 || Number(assetCount) === 0) {
      console.log(`[Seed] markets=${marketCount} assets=${assetCount} — running canonical sync...`);
      try {
        const result = await syncCanonicalMarket();
        console.log(`[Seed] Riot canonical sync: fetched=${result.fetched} upserted=${result.upserted}`);
      } catch (riotErr: any) {
        console.warn(`[Seed] Riot sync failed (non-fatal): ${riotErr?.message}`);
      }
    } else {
      console.log(`[Seed] markets=${marketCount} assets=${assetCount} — skip sync (already seeded)`);
    }

    // ── 2. Gamerstock SANDBOX market ─────────────────────────────────────────
    // LEGACY: This section seeds the vault/sandbox canonical assets.
    // FREEZE: Do not add new sandbox seeding logic here.
    // Retirement: remove when SANDBOX market mode is deprecated.
    // See: docs/architecture/legacy-freeze-and-retirement-plan.md
    const sandboxMarket = await getOrCreateMarket({
      provider: "gamerstock",
      game: "lol",
      region: "SANDBOX",
      scope: "SANDBOX",
      entityType: "player",
      externalId: "sandbox",
      displayName: "Sandbox",
      symbol: "",
    });

    // ── 2b. Steam / Dota2 market ──────────────────────────────────────────────
    // Required for Dota2 player asset bootstrap (dota2MarketBootstrapService).
    // Idempotent — getOrCreateMarket is a no-op if the row already exists.
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
    console.log("[Seed] Steam/Dota2 market ensured.");

    // ── 2c. Steam / CS2 market ────────────────────────────────────────────────
    // Structural foundation for CS2 player assets.
    // CS2 onboarding (cs2OnboardingService) references this market via
    // repo.findOrCreateMarket({ provider:"steam", game:"cs2", ... }).
    // Seeding it here ensures the row exists before any user triggers the flow.
    await getOrCreateMarket({
      provider: "steam",
      game: "cs2",
      region: "global",
      scope: "default",
      entityType: "player",
      externalId: "cs2-global",
      displayName: "CS2 Global",
      symbol: "",
    });
    console.log("[Seed] Steam/CS2 market ensured.");

    // ── 2d. Auto-bootstrap CS2 players if no CS2 assets exist ────────────────
    // Mirrors the Dota2 bootstrap pattern: seeds 800 CS2 pro players from
    // PandaScore (/csgo/players) with flat base price + valuation state.
    // Non-blocking — runs in background after server has started.
    const [{ cs2AssetCount }] = await db
      .select({ cs2AssetCount: sql<number>`count(*)::int` })
      .from(assets)
      .where(like(assets.assetUid, "cs2:%"));

    if (Number(cs2AssetCount) === 0) {
      if (isProd) {
        console.warn("[Seed] PROD: cs2AssetCount=0 — scheduling CS2 bootstrap. Safe on first deploy only.");
      } else {
        console.log("[Seed] No CS2 assets found — scheduling CS2 bootstrap (background)...");
      }
      runCs2BootstrapPipeline().catch(e =>
        console.error("[Seed/cs2] Bootstrap uncaught error:", e?.message || e)
      );
    } else {
      console.log(`[Seed] CS2 assets already exist (${cs2AssetCount}) — skip CS2 bootstrap.`);
    }

    // ── 3. Ensure all vaults have a linked sandbox canonical asset ────────────
    const allVaults = await db.select({ id: vaults.id, assetId: vaults.assetId }).from(vaults);
    const unlinked = allVaults.filter(v => !v.assetId);

    if (unlinked.length > 0) {
      console.log(`[Seed] Linking ${unlinked.length} unlinked vaults to sandbox assets...`);
      const rows = unlinked.map(v => ({
        provider: "gamerstock",
        game: "lol",
        region: "SANDBOX",
        scope: "SANDBOX",
        entityType: "player" as const,
        externalId: `vault-${v.id}`,
        displayName: `Vault ${v.id}`,
        symbol: "",
      }));
      await upsertAssetsFromProvider(rows);
      console.log(`[Seed] Sandbox assets upserted for ${rows.length} vaults.`);
    }

    // ── 4. Auto-bootstrap Dota2 if no assets ─────────────────────────────────
    // Non-blocking — runs in background after server has started.
    // PROD GUARD: only triggers when assetCount=0 (data-existence guard).
    if (Number(assetCount) === 0) {
      if (isProd) {
        console.warn("[Seed] PROD: assetCount=0 — scheduling Dota2 auto-bootstrap. Safe on first deploy only.");
      } else {
        console.log("[Seed] assetCount=0 detected — scheduling Dota2 auto-bootstrap (background)...");
      }
      runDota2BootstrapPipeline().catch(e =>
        console.error("[Seed/auto] Pipeline uncaught error:", e?.message || e)
      );
    } else {
      // ── 4b. Auto-enrich Dota2 valuations if assets exist but valuations are empty ──
      // This handles the case where assets were bootstrapped (basePrice=15.00) but
      // the enrichment pipeline never ran — resulting in all prices flat at 15.00
      // and dota2_valuation_state being empty (Player Ticket shows Matches=0, Win Rate=—).
      const [{ valuationCount }] = await db
        .select({ valuationCount: sql<number>`count(*)::int` })
        .from(dota2ValuationState);

      if (Number(valuationCount) === 0) {
        if (isProd) {
          console.warn("[Seed] PROD: assets exist but dota2_valuation_state is empty — scheduling enrichment. Verify this is expected.");
        } else {
          console.log("[Seed] Assets exist but dota2_valuation_state is empty — scheduling enrichment (background)...");
        }
        runDota2EnrichmentPipeline().catch(e =>
          console.error("[Seed/auto-enrich] Pipeline uncaught error:", e?.message || e)
        );
      } else {
        console.log(`[Seed] dota2_valuation_state has ${valuationCount} rows — skip enrichment.`);
      }
    }

    console.log(`[Seed] ── Startup Seed COMPLETE (env=${env}) ──`);
  } catch (err: any) {
    console.error("[Seed] Startup seed error (non-fatal):", err?.message || err);
  }
}

// ── Dota2 bootstrap pipeline ───────────────────────────────────────────────────
// Called from startup (when assetCount=0) and from the prod-bootstrap script.
// Also accessible from admin routes for manual re-seeding.
// Safe to re-run — all steps are idempotent.

export async function runDota2BootstrapPipeline() {
  console.log("[Bootstrap] === Dota2 Bootstrap Pipeline START ===");

  // Step 1: Bootstrap Dota2 players from OpenDota (no API key needed)
  try {
    const { bootstrapDota2Market } = await import("../domains/multigame/dota2MarketBootstrapService");
    const r = await bootstrapDota2Market({
      limit: 800,
      activeOnly: false,
      basePrice: "15.00",
    });
    console.log(`[Bootstrap] Step 1 done — created=${r.created} skipped=${r.skipped} errors=${r.errors.length}`);
    if (r.created === 0 && r.skipped === 0) {
      console.warn("[Bootstrap] No Dota2 assets created — aborting pipeline.");
      return false;
    }
  } catch (e: any) {
    console.error("[Bootstrap] Step 1 (bootstrap) FAILED:", e?.message);
    return false;
  }

  // Step 2: Seed initial valuations
  try {
    const { seedInitialValuations } = await import("../services/valuationJob");
    await seedInitialValuations();
    console.log("[Bootstrap] Step 2 done — valuations seeded.");
  } catch (e: any) {
    console.error("[Bootstrap] Step 2 (valuation seed) FAILED:", e?.message);
  }

  // Step 3: Run valuation batch
  try {
    const { runValuationBatch } = await import("../services/valuationJob");
    await runValuationBatch();
    console.log("[Bootstrap] Step 3 done — valuation batch run.");
  } catch (e: any) {
    console.error("[Bootstrap] Step 3 (valuation run) FAILED:", e?.message);
  }

  // Step 4: Backfill trading asset links
  try {
    const { backfillTradingAssetLinks } = await import("./backfill-trading-assets");
    const r = await backfillTradingAssetLinks();
    console.log(`[Bootstrap] Step 4 done — backfill: ${JSON.stringify(r)}`);
  } catch (e: any) {
    console.error("[Bootstrap] Step 4 (backfill) FAILED:", e?.message);
  }

  // Step 5: Seed AMM — create asset_markets + asset_market_state for every dota2 asset
  try {
    const allAssets = await db
      .select({ id: assets.id, lastTradePrice: assets.lastTradePrice })
      .from(assets)
      .where(like(assets.assetUid, "dota2:%"));

    let ammCount = 0;
    for (const asset of allAssets) {
      await db.insert(assetMarkets).values({
        assetId: asset.id,
        isEnabled: true,
        floorPrice: "5.00",
        paramA: "5.00",
        paramB: "100.00",
      }).onConflictDoNothing();

      const supply = supplyForPrice(parseFloat(asset.lastTradePrice || "15"), DEFAULT_AMM_PARAMS);
      await db.insert(assetMarketState).values({
        assetId: asset.id,
        supply: supply.toFixed(6),
        lastPrice: asset.lastTradePrice || "15.00",
        version: 1,
      }).onConflictDoNothing();
      ammCount++;
    }
    console.log(`[Bootstrap] Step 5 done — AMM seeded for ${ammCount} assets.`);
  } catch (e: any) {
    console.error("[Bootstrap] Step 5 (AMM seed) FAILED:", e?.message);
  }

  console.log("[Bootstrap] === Dota2 Bootstrap Pipeline COMPLETE ===");
  return true;
}

// ── Dota2 enrichment pipeline ─────────────────────────────────────────────────
// Called from startup when assets exist but dota2_valuation_state is empty.
// This happens when the server was deployed with pre-seeded assets (basePrice=15.00)
// but the enrichment step never ran. Runs in background — non-blocking.
// Steps:
//   1. enrichDota2Valuations in batches → fills dota2_valuation_state + updates
//      assets.fundamental_price / last_trade_price from real OpenDota MMR
//   2. enrichDota2WithRealData → updates win_rate, match count, momentum
//      (uses OpenDota public API — no API key needed)

export async function runDota2EnrichmentPipeline(): Promise<void> {
  console.log("[Enrich] === Dota2 Enrichment Pipeline START ===");

  const { enrichDota2Valuations, enrichDota2WithRealData } = await import(
    "../domains/multigame/dota2MarketBootstrapService"
  );

  // Step 1: MMR-based valuation — run in two batches of 500 to cover all assets
  const BATCH = 500;
  for (let offset = 0; offset < 1500; offset += BATCH) {
    try {
      const r = await enrichDota2Valuations({ limit: BATCH, offset, dryRun: false });
      console.log(
        `[Enrich] MMR batch offset=${offset} — processed=${r.processed} enriched=${r.enriched} noMmr=${r.noMmr} errors=${r.errors.length} (${r.durationMs}ms)`
      );
      if (r.processed === 0) break;
    } catch (e: any) {
      console.error(`[Enrich] MMR batch offset=${offset} FAILED: ${e?.message}`);
      break;
    }
  }

  // Step 2: Real data (win rate, game count, momentum) — run in batches of 100
  const REAL_BATCH = 100;
  for (let offset = 0; offset < 1500; offset += REAL_BATCH) {
    try {
      const r = await enrichDota2WithRealData({ limit: REAL_BATCH, offset, dryRun: false, minGames: 5 });
      console.log(
        `[Enrich] Real batch offset=${offset} — processed=${r.processed} enriched=${r.enriched} ineligible=${r.ineligible} noWl=${r.noWlData} (${r.durationMs}ms)`
      );
      if (r.processed === 0) break;
    } catch (e: any) {
      console.error(`[Enrich] Real batch offset=${offset} FAILED: ${e?.message}`);
      break;
    }
  }

  console.log("[Enrich] === Dota2 Enrichment Pipeline COMPLETE ===");
}

// ── CS2 bootstrap pipeline ─────────────────────────────────────────────────────
// Called from startup when no CS2 assets exist.
// Runs in background — non-blocking.
// Mirrors the Dota2 bootstrap pipeline in structure.
//
// Steps:
//   1. Fetch 800 CS2 pro players from PandaScore /csgo/players
//   2. Create assets + AMM + initial valuation state (15.00 GS baseline)
//   3. Backfill trading asset links

export async function runCs2BootstrapPipeline(): Promise<boolean> {
  console.log("[CS2Bootstrap] === CS2 Bootstrap Pipeline START ===");

  // Step 1: Bootstrap CS2 players from PandaScore
  try {
    const { bootstrapCs2Market } = await import("../domains/multigame/cs2MarketBootstrapService");
    const r = await bootstrapCs2Market({ limit: 800, basePrice: "15.00" });
    console.log(`[CS2Bootstrap] Step 1 done — created=${r.created} skipped=${r.skipped} errors=${r.errors.length} (${r.durationMs}ms)`);
    if (r.created === 0 && r.skipped === 0) {
      console.warn("[CS2Bootstrap] No CS2 assets created — aborting pipeline.");
      return false;
    }
  } catch (e: any) {
    console.error("[CS2Bootstrap] Step 1 (bootstrap) FAILED:", e?.message);
    return false;
  }

  // Step 2: Backfill trading asset links
  try {
    const { backfillTradingAssetLinks } = await import("./backfill-trading-assets");
    const r = await backfillTradingAssetLinks();
    console.log(`[CS2Bootstrap] Step 2 done — backfill: ${JSON.stringify(r)}`);
  } catch (e: any) {
    console.error("[CS2Bootstrap] Step 2 (backfill) FAILED:", e?.message);
  }

  console.log("[CS2Bootstrap] === CS2 Bootstrap Pipeline COMPLETE ===");
  return true;
}

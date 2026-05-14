// ─── Prediction Markets — Dev Seed ────────────────────────────────────────────
// Lightweight idempotent seed for local/dev environments.
// Inserts one prediction event, one binary market, and two outcomes.
//
// SAFETY RULES:
//   - All records use a unique external_ref / slug so the seed is idempotent.
//   - Does NOT touch any permanent player-asset tables.
//   - Does NOT run in production (guarded below).
//   - Isolated entirely within the prediction domain.
//
// HOW TO TRIGGER:
//   - Auto-runs at startup in development if the seed records are absent.
//   - Can be force-re-run by calling seedPredictionDevData({ force: true })
//     which deletes only the dev sample records before re-inserting.
// ─────────────────────────────────────────────────────────────────────────────
import { db } from "../../db";
import {
  predictionEvents,
  predictionMarkets,
  predictionOutcomes,
  predictionMarketStats,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

const DEV_EVENT_EXTERNAL_REF = "dev-sample-furia-vs-navi-2025";
const DEV_MARKET_SLUG        = "dev-furia-wins-match-1";

interface SeedOptions {
  force?: boolean; // delete dev sample records before re-inserting
}

export async function seedPredictionDevData(
  opts: SeedOptions = {}
): Promise<{ seeded: boolean; reason: string }> {
  // Guard: only run in development
  if (process.env.NODE_ENV === "production") {
    return { seeded: false, reason: "Skipped — production environment." };
  }

  // ── Check if already seeded ───────────────────────────────────────────────

  const [existingEvent] = await db
    .select({ id: predictionEvents.id })
    .from(predictionEvents)
    .where(eq(predictionEvents.externalRef, DEV_EVENT_EXTERNAL_REF))
    .limit(1);

  if (existingEvent && !opts.force) {
    return {
      seeded: false,
      reason: `Dev sample already present (event id=${existingEvent.id}). Pass force:true to re-seed.`,
    };
  }

  // ── Force mode: clean up previous dev sample records ─────────────────────

  if (existingEvent && opts.force) {
    const [existingMarket] = await db
      .select({ id: predictionMarkets.id })
      .from(predictionMarkets)
      .where(eq(predictionMarkets.slug, DEV_MARKET_SLUG))
      .limit(1);

    if (existingMarket) {
      // cascade deletes outcomes, stats
      await db
        .delete(predictionMarkets)
        .where(eq(predictionMarkets.id, existingMarket.id));
    }

    await db
      .delete(predictionEvents)
      .where(eq(predictionEvents.id, existingEvent.id));

    console.log("[Prediction Seed] Cleared previous dev sample records.");
  }

  // ── Insert event ──────────────────────────────────────────────────────────

  const [event] = await db
    .insert(predictionEvents)
    .values({
      uid:            `evt_${nanoid(12)}`,
      title:          "FURIA vs NAVI — ESL Pro League Season 21",
      tournamentName: "ESL Pro League Season 21",
      eventName:      "FURIA vs NAVI — Group Stage Match",
      game:           "lol",
      region:         "NA",
      eventType:      "match",
      teamAName:      "FURIA",
      teamBName:      "NAVI",
      status:         "scheduled",
      startsAt:       new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // 2 days from now
      externalRef:    DEV_EVENT_EXTERNAL_REF,
      metadata:       {
        devSample:   true,
        note:        "Sprint 1 local dev seed — safe to delete",
        seededAt:    new Date().toISOString(),
      },
    })
    .returning();

  // ── Insert market ─────────────────────────────────────────────────────────

  const [market] = await db
    .insert(predictionMarkets)
    .values({
      uid:              `mkt_${nanoid(12)}`,
      slug:             DEV_MARKET_SLUG,
      eventId:          event.id,
      question:         "Will FURIA win this match against NAVI?",
      description:      "Predict the winner of the FURIA vs NAVI group stage match. Market locks at match start.",
      marketType:       "binary",
      status:           "open",
      currency:         "GS",
      poolTotal:        "0",
      minStake:         "1.000000",
      maxStake:         "10000.000000",
      openAt:           new Date(),
      closeAt:          new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      resolutionSource: "admin",
      createdBy:        "dev-seed",
      metadata:         { devSample: true },
    })
    .returning();

  // ── Insert outcomes ───────────────────────────────────────────────────────

  const [outcomeYes, outcomeNo] = await db
    .insert(predictionOutcomes)
    .values([
      {
        marketId:  market.id,
        code:      "YES",
        label:     "Yes — FURIA wins",
        description: "FURIA wins the match.",
        sortOrder: 0,
      },
      {
        marketId:  market.id,
        code:      "NO",
        label:     "No — NAVI wins",
        description: "NAVI wins the match.",
        sortOrder: 1,
      },
    ])
    .returning();

  // ── Insert market stats row ───────────────────────────────────────────────

  await db
    .insert(predictionMarketStats)
    .values({
      marketId:     market.id,
      volume24h:    "0",
      traders24h:   0,
      lastPriceYes: "0.500000",
      lastPriceNo:  "0.500000",
    })
    .onConflictDoNothing();

  console.log(
    `[Prediction Seed] Dev sample seeded:` +
    ` eventId=${event.id} marketId=${market.id}` +
    ` slug="${market.slug}"` +
    ` outcomes=[${outcomeYes.id} YES, ${outcomeNo.id} NO]`
  );

  return {
    seeded: true,
    reason: `Dev sample inserted: event=${event.id} market=${market.id} slug=${market.slug}`,
  };
}

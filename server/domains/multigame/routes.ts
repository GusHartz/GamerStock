// ─── Multigame Domain Routes ──────────────────────────────────────────────────
// Fase 1 + Fase 2 + Fase 3 endpoints.
//
// Connected Accounts (user-scoped):
//   GET    /api/me/connected-accounts
//   POST   /api/me/connected-accounts
//   PATCH  /api/me/connected-accounts/:id
//   DELETE /api/me/connected-accounts/:id
//
// Player Profiles (user-scoped):
//   GET    /api/me/player-profiles
//   POST   /api/me/player-profiles
//
// Fase 14 — User Asset Surface:
//   GET    /api/me/assets/claimable  — candidate discovery (Steam/Dota2)
//   GET    /api/me/assets/summary    — consolidated read model
//   POST   /api/me/dota2/claims/:id/cancel — cancel PENDING or UNDER_REVIEW claim
//
// Dota2 Onboarding (user-scoped, Fase 2):
//   POST   /api/me/dota2/connect          — atomic bootstrap flow
//   GET    /api/me/dota2/status           — read-only state inspection
//   GET    /api/me/dota2/eligibility      — latest eligibility snapshot
//
// Dota2 Match Ingestion (user-scoped, Fase 3):
//   POST   /api/me/dota2/sync-matches     — sync raw match history from OpenDota
//   GET    /api/me/dota2/matches          — inspect persisted match records
//
// Dota2 Match Enrichment (user-scoped, Fase 4):
//   POST   /api/me/dota2/process-matches  — enrich + role detect + eligibility classify
//   GET    /api/me/dota2/match-analytics  — inspect processed analytics records
//
// Dota2 Baseline Engine + RoleRelativeScore (Fase 5):
//   POST   /api/admin/dota2/rebuild-baselines — admin: rebuild median/MAD cohorts
//   POST   /api/me/dota2/score-matches        — calculate RoleRelativeScore per match
//   GET    /api/me/dota2/score-components     — read persisted score components
//   POST   /api/me/dota2/compute-performance  — Fase 6: aggregate final PerformanceScore
//   GET    /api/me/dota2/performance-scores   — read persisted PerformanceScores
//
// Dota2 Valuation Pipeline (Fase 7):
//   POST   /api/me/dota2/bootstrap-valuation  — bootstrap InitialValue + ValuationState
//   POST   /api/me/dota2/update-valuation     — incremental RawValue/PlayerValue update
//   GET    /api/me/dota2/valuation            — read current valuation state
//   GET    /api/me/dota2/valuation-history    — read value history (audit trail)
//
// Terminal Assets (public):
//   GET    /api/terminal/assets
//   GET    /api/terminal/assets/:id
//   GET    /api/terminal/assets/:id/fundamentals — Fase 8 fundamentals read model
//
// Listing Workflow (Fase 9):
//   GET    /api/me/dota2/listing-readiness          — listing readiness snapshot (read-only)
//   GET    /api/admin/dota2/assets-under-review     — admin: queue of UNDER_REVIEW assets
//   POST   /api/admin/dota2/assets/:id/approve-listing — admin: ACTIVE + LISTED
//   POST   /api/admin/dota2/assets/:id/reject-listing  — admin: DRAFT + REJECTED
//
// CS2 Onboarding + Valuation (user-scoped, Fase 17+18+3):
//   POST   /api/me/cs2/connect                — atomic bootstrap flow (Steam provider)
//   GET    /api/me/cs2/status                 — read-only state inspection (+ candidateSnapshot)
//   POST   /api/me/cs2/claim-asset            — claim the user's CS2 asset
//   GET    /api/me/cs2/listing-readiness      — readiness snapshot (mirrors Dota2, Fase 18)
//   GET    /api/me/cs2/candidate-snapshot     — structured minimum snapshot for next pipeline (Fase 18)
//   POST   /api/me/cs2/bootstrap-valuation    — bootstrap/refresh initial valuation (Fase 3)
//   GET    /api/me/cs2/valuation              — read current CS2 valuation state (Fase 3)
//   GET    /api/me/cs2/valuation/history      — read CS2 value history (Fase 3)
//   POST   /api/me/cs2/sync-stats             — ingest aggregate CS2 career stats (Fase 4)
//   GET    /api/me/cs2/matches                — list CS2 match/aggregate records (Fase 4)
// ─────────────────────────────────────────────────────────────────────────────
import type { Express, RequestHandler } from "express";
import { z } from "zod";
import {
  GAMES,
  PROVIDER_GROUPS,
  VERIFICATION_STATUS_VALUES,
  PLAYER_PROFILE_STATUS_VALUES,
  assetMarkets,
  assetMarketState,
  assets,
  playerProfiles,
  connectedAccounts,
} from "@shared/schema";
import { db }                                     from "../../db";
import { eq }                                     from "drizzle-orm";
import { supplyForPrice, DEFAULT_AMM_PARAMS }     from "../../services/ammPricing";
import * as repo                       from "./repository";
import * as dota2OnboardingService    from "./dota2OnboardingService";
import * as cs2OnboardingService     from "./cs2OnboardingService";
import * as dota2MatchSyncService     from "./dota2MatchSyncService";
import * as dota2MatchEnrichmentService from "./dota2MatchEnrichmentService";
import * as dota2BaselineService        from "./dota2BaselineService";
import * as dota2PerformanceService     from "./dota2PerformanceService";
import * as dota2ValuationService       from "./dota2ValuationService";
import * as dota2ListingEligibilityService from "./dota2ListingEligibilityService";
import * as cs2ListingEligibilityService  from "./cs2ListingEligibilityService";
import * as cs2ValuationService           from "./cs2ValuationService";
import * as cs2MatchSyncService           from "./cs2MatchSyncService";
import { getClaimableAssets }             from "./claimDiscovery";
import { evaluateClaimPolicy }            from "./claimPolicyEvaluator";
import { getVerificationAdapter }         from "./verificationRegistry";
import * as dota2MarketBootstrapService  from "./dota2MarketBootstrapService";

// ── Auth middleware ────────────────────────────────────────────────────────────

const isAuthenticated: RequestHandler = (req: any, res, next) => {
  if (req.session?.isAdmin || req.session?.userId) return next();
  if (typeof req.isAuthenticated === "function" && req.isAuthenticated()) return next();
  return res.status(401).json({ message: "Unauthorized" });
};

const getUserId = (req: any): string => req.session?.userId ?? req.user?.id;
const isAdminUser = (req: any): boolean => !!(req.user?.isAdmin || req.session?.isAdmin);

// ── Validation schemas ─────────────────────────────────────────────────────────

const createConnectedAccountBody = z.object({
  providerGroup:       z.enum(PROVIDER_GROUPS),
  game:                z.enum(GAMES),
  providerAccountId:   z.string().min(1),
  providerAccountName: z.string().optional(),
  providerProfileUrl:  z.string().url().optional(),
  isPrimary:           z.boolean().optional().default(false),
});

const patchConnectedAccountBody = z.object({
  providerAccountName: z.string().optional(),
  providerProfileUrl:  z.string().url().optional(),
  verificationStatus:  z.enum(VERIFICATION_STATUS_VALUES).optional(),
  isPrimary:           z.boolean().optional(),
}).refine((b) => Object.keys(b).length > 0, { message: "At least one field required" });

const createPlayerProfileBody = z.object({
  game:                       z.enum(GAMES),
  canonicalName:              z.string().min(1).max(128),
  primaryConnectedAccountId:  z.number().int().positive().optional(),
  status:                     z.enum(PLAYER_PROFILE_STATUS_VALUES).optional().default("DRAFT"),
});

const dota2ConnectBody = z.object({
  steamId:           z.string().min(1, "steamId is required"),
  steamPersonaName:  z.string().min(1).max(128).optional(),
  steamProfileUrl:   z.string().url().optional(),
});

const terminalAssetsQuery = z.object({
  game:          z.string().optional(),
  tradingStatus: z.string().optional(),
  listingStatus: z.string().optional(),
  limit:         z.coerce.number().int().min(1).max(200).optional().default(50),
  offset:        z.coerce.number().int().min(0).optional().default(0),
});

// ── Route registration ─────────────────────────────────────────────────────────

export function registerMultigameRoutes(app: Express): void {

  // ── GET /api/me/connected-accounts ──────────────────────────────────────────
  app.get("/api/me/connected-accounts", isAuthenticated, async (req: any, res) => {
    try {
      const accounts = await repo.findConnectedAccountsByUser(getUserId(req));
      return res.json({ accounts });
    } catch (err: any) {
      console.error("[Multigame] GET /api/me/connected-accounts:", err.message);
      return res.status(500).json({ message: "Failed to fetch connected accounts." });
    }
  });

  // ── POST /api/me/connected-accounts ─────────────────────────────────────────
  app.post("/api/me/connected-accounts", isAuthenticated, async (req: any, res) => {
    const parsed = createConnectedAccountBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Validation error", errors: parsed.error.flatten() });
    }
    try {
      const account = await repo.createConnectedAccount({
        userId: getUserId(req),
        ...parsed.data,
      });
      return res.status(201).json({ account });
    } catch (err: any) {
      if (err.message?.includes("unique") || err.message?.includes("duplicate")) {
        return res.status(409).json({
          message: "A connected account with this provider + game + account ID already exists.",
        });
      }
      console.error("[Multigame] POST /api/me/connected-accounts:", err.message);
      return res.status(500).json({ message: "Failed to create connected account." });
    }
  });

  // ── PATCH /api/me/connected-accounts/:id ────────────────────────────────────
  app.patch("/api/me/connected-accounts/:id", isAuthenticated, async (req: any, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid account id." });

    const parsed = patchConnectedAccountBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Validation error", errors: parsed.error.flatten() });
    }
    try {
      const updated = await repo.updateConnectedAccount(id, getUserId(req), parsed.data);
      if (!updated) return res.status(404).json({ message: "Connected account not found." });
      return res.json({ account: updated });
    } catch (err: any) {
      console.error("[Multigame] PATCH /api/me/connected-accounts/:id:", err.message);
      return res.status(500).json({ message: "Failed to update connected account." });
    }
  });

  // ── DELETE /api/me/connected-accounts/:id ───────────────────────────────────
  app.delete("/api/me/connected-accounts/:id", isAuthenticated, async (req: any, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid account id." });
    try {
      const deleted = await repo.deleteConnectedAccount(id, getUserId(req));
      if (!deleted) return res.status(404).json({ message: "Connected account not found." });
      return res.status(204).send();
    } catch (err: any) {
      console.error("[Multigame] DELETE /api/me/connected-accounts/:id:", err.message);
      return res.status(500).json({ message: "Failed to delete connected account." });
    }
  });

  // ── GET /api/me/player-profiles ─────────────────────────────────────────────
  app.get("/api/me/player-profiles", isAuthenticated, async (req: any, res) => {
    try {
      const profiles = await repo.findPlayerProfilesByUser(getUserId(req));
      return res.json({ profiles });
    } catch (err: any) {
      console.error("[Multigame] GET /api/me/player-profiles:", err.message);
      return res.status(500).json({ message: "Failed to fetch player profiles." });
    }
  });

  // ── POST /api/me/player-profiles ────────────────────────────────────────────
  app.post("/api/me/player-profiles", isAuthenticated, async (req: any, res) => {
    const parsed = createPlayerProfileBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Validation error", errors: parsed.error.flatten() });
    }

    if (parsed.data.primaryConnectedAccountId) {
      const account = await repo.findConnectedAccountByIdForUser(
        parsed.data.primaryConnectedAccountId,
        getUserId(req),
      );
      if (!account) {
        return res.status(404).json({ message: "Connected account not found." });
      }
      if (account.game !== parsed.data.game) {
        return res.status(400).json({
          message: `Connected account game (${account.game}) does not match profile game (${parsed.data.game}).`,
        });
      }
    }

    try {
      const profile = await repo.createPlayerProfile(parsed.data);
      return res.status(201).json({ profile });
    } catch (err: any) {
      if (err.message?.includes("unique") || err.message?.includes("duplicate")) {
        return res.status(409).json({
          message: "A player profile for this connected account already exists.",
        });
      }
      console.error("[Multigame] POST /api/me/player-profiles:", err.message);
      return res.status(500).json({ message: "Failed to create player profile." });
    }
  });

  // ════════════════════════════════════════════════════════════════════════════
  //  Dota2 Onboarding  (Fase 2)
  // ════════════════════════════════════════════════════════════════════════════

  // ── POST /api/me/dota2/connect ───────────────────────────────────────────────
  // Atomic bootstrap: ConnectedAccount → PlayerProfile → Asset stub →
  //                   EligibilitySnapshot
  app.post("/api/me/dota2/connect", isAuthenticated, async (req: any, res) => {
    const parsed = dota2ConnectBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Validation error", errors: parsed.error.flatten() });
    }

    try {
      const result = await dota2OnboardingService.connectDota2Account(getUserId(req), parsed.data);
      const statusCode = result.isNew ? 201 : 200;
      return res.status(statusCode).json(result);
    } catch (err: any) {
      if (err.status === 409 || err.code === "STEAM_ID_ALREADY_CLAIMED") {
        return res.status(409).json({ message: err.message, code: err.code });
      }
      console.error("[Multigame] POST /api/me/dota2/connect:", err.message);
      return res.status(500).json({ message: "Failed to connect Dota2 account." });
    }
  });

  // ── POST /api/me/cs2/connect ──────────────────────────────────────────────────
  // Fase 17: CS2 multi-game onboarding — mirrors Dota2 connect.
  // Uses the same Steam provider: same SteamID64, same verification.
  // If the user already verified their Steam ID (via dota2), CS2 account inherits VERIFIED.
  app.post("/api/me/cs2/connect", isAuthenticated, async (req: any, res) => {
    const parsed = dota2ConnectBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Validation error", errors: parsed.error.flatten() });
    }

    try {
      const result = await cs2OnboardingService.connectCs2Account(getUserId(req), parsed.data);
      const statusCode = result.isNew ? 201 : 200;
      return res.status(statusCode).json(result);
    } catch (err: any) {
      if (err.status === 409 || err.code === "STEAM_ID_ALREADY_CLAIMED") {
        return res.status(409).json({ message: err.message, code: err.code });
      }
      console.error("[Multigame] POST /api/me/cs2/connect:", err.message);
      return res.status(500).json({ message: "Failed to connect CS2 account." });
    }
  });

  // ── GET /api/me/cs2/status ────────────────────────────────────────────────────
  // Read-only: returns current CS2 bootstrap state for the authenticated user.
  app.get("/api/me/cs2/status", isAuthenticated, async (req: any, res) => {
    try {
      const status = await cs2OnboardingService.getCs2Status(getUserId(req));
      return res.json(status);
    } catch (err: any) {
      console.error("[Multigame] GET /api/me/cs2/status:", err.message);
      return res.status(500).json({ message: "Failed to fetch CS2 status." });
    }
  });

  // ── POST /api/me/cs2/claim-asset ──────────────────────────────────────────────
  // Fase 17: Claim a CS2 asset. Mirrors /api/me/dota2/claim-asset.
  // Reuses dota2_asset_claim_requests table — game column differentiates.
  app.post("/api/me/cs2/claim-asset", isAuthenticated, async (req: any, res) => {
    const userId = getUserId(req);
    try {
      // Get CS2 account state
      const accounts   = await repo.findConnectedAccountsByUser(userId);
      const cs2Account = accounts.find(
        (a: any) => a.providerGroup === "steam" && a.game === "cs2",
      );
      if (!cs2Account) {
        return res.status(404).json({ message: "No CS2 account connected." });
      }

      const verificationStatus = (cs2Account as any).verificationStatus;
      if (verificationStatus !== "VERIFIED") {
        return res.status(403).json({ message: "Steam account not verified. Complete Steam verification first." });
      }

      // Find CS2 profile
      const profiles   = await repo.findPlayerProfilesByUser(userId);
      const cs2Profile = profiles.find((p: any) => p.game === "cs2");
      if (!cs2Profile) {
        return res.status(404).json({ message: "No CS2 player profile found." });
      }

      // Find CS2 asset
      const asset = await repo.findAssetByPlayerProfileId(cs2Profile.id);
      if (!asset) {
        return res.status(404).json({ message: "No CS2 asset stub found." });
      }
      const assetId = (asset as any).id as number;

      // Guard: already owned?
      const existingLinks = await repo.listAssetOwnershipLinksByUser(userId);
      const alreadyOwned  = existingLinks.some(
        (l: any) => l.assetId === assetId && l.status === "ACTIVE",
      );
      if (alreadyOwned) {
        return res.status(409).json({ message: "You already own this CS2 asset." });
      }

      // Guard: open claim?
      const openClaims = await repo.findOpenDota2ClaimsByAssetAndUser(assetId, userId);
      if (openClaims.length > 0) {
        return res.status(409).json({ message: "You already have an open claim for this asset." });
      }

      // Evaluate policy
      const policyResult = evaluateClaimPolicy({
        game:               "cs2",
        verificationStatus,
        providerGroup:      "steam",
        matchConfidence:    "HIGH",
        hasActiveOwner:     !!(await repo.findActiveAssetOwnershipLink(assetId)),
        hasOpenClaim:       false,
      });

      if (!policyResult.canClaim) {
        return res.status(403).json({
          message: "Claim not permitted by policy.",
          reasons: policyResult.reasons,
        });
      }

      // Insert claim (game="cs2" — same table as dota2)
      const claim = await repo.insertDota2ClaimRequest({
        userId,
        assetId,
        connectedAccountId: (cs2Account as any).id,
        game:               "cs2",
        claimStatus:        "PENDING_REVIEW",
        approvalType:       policyResult.approvalType ?? "MANUAL",
        claimEvidence:      JSON.stringify({
          steamId:        (cs2Account as any).providerAccountId,
          profileId:      cs2Profile.id,
          matchSource:    "STEAM_PROFILE_LINK",
          matchConfidence: "HIGH",
        }),
      } as any);

      // Auto-approve if policy allows
      if (policyResult.canAutoApprove) {
        const { claim: approved } = await repo.approveDota2ClaimTx(claim.id, "system:auto-policy");
        return res.status(201).json({
          claim:       approved,
          autoApproved: true,
          message:     "Claim auto-approved — you now own this CS2 asset.",
        });
      }

      return res.status(201).json({
        claim,
        autoApproved: false,
        message:      "Claim submitted for review.",
      });
    } catch (err: any) {
      console.error("[Multigame] POST /api/me/cs2/claim-asset:", err.message);
      return res.status(500).json({ message: "Failed to submit CS2 claim." });
    }
  });

  // ── GET /api/me/dota2/status ─────────────────────────────────────────────────
  // Read-only: returns current Dota2 bootstrap state for the authenticated user.
  app.get("/api/me/dota2/status", isAuthenticated, async (req: any, res) => {
    try {
      const status = await dota2OnboardingService.getDota2Status(getUserId(req));
      return res.json(status);
    } catch (err: any) {
      console.error("[Multigame] GET /api/me/dota2/status:", err.message);
      return res.status(500).json({ message: "Failed to fetch Dota2 status." });
    }
  });

  // ── GET /api/me/dota2/eligibility ────────────────────────────────────────────
  // Returns the latest eligibility snapshot for the user's Dota2 PlayerProfile.
  app.get("/api/me/dota2/eligibility", isAuthenticated, async (req: any, res) => {
    try {
      const status = await dota2OnboardingService.getDota2Status(getUserId(req));
      if (!status.connected || !status.playerProfile) {
        return res.status(404).json({ message: "No Dota2 account connected." });
      }
      const snapshots = await repo.findAllEligibilitySnapshots(status.playerProfile.id);
      return res.json({
        playerProfileId: status.playerProfile.id,
        latest: snapshots[0] ?? null,
        history: snapshots,
      });
    } catch (err: any) {
      console.error("[Multigame] GET /api/me/dota2/eligibility:", err.message);
      return res.status(500).json({ message: "Failed to fetch eligibility." });
    }
  });

  // ════════════════════════════════════════════════════════════════════════════
  //  Dota2 Match Ingestion (Fase 3)
  // ════════════════════════════════════════════════════════════════════════════

  // ── POST /api/me/dota2/sync-matches ──────────────────────────────────────────
  // Triggers a match history sync for the authenticated user's Dota2 account.
  // Idempotent: safe to call multiple times; re-syncing won't duplicate records.
  //
  // Optional body: { limit?: number }  — override fetch count (default: 50, max: 500)
  app.post("/api/me/dota2/sync-matches", isAuthenticated, async (req: any, res) => {
    const bodySchema = z.object({
      limit: z.number().int().min(1).max(500).optional(),
    });
    const parsed = bodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid body", errors: parsed.error.flatten() });
    }

    try {
      const result = await dota2MatchSyncService.syncDota2Matches({
        userId:     getUserId(req),
        fetchLimit: parsed.data.limit,
      });
      return res.status(200).json(result);
    } catch (err: any) {
      if (err.status === 404) {
        return res.status(404).json({ message: err.message });
      }
      if (err.status === 400) {
        return res.status(400).json({ message: err.message });
      }
      console.error("[Multigame] POST /api/me/dota2/sync-matches:", err.message);
      return res.status(500).json({ message: "Match sync failed." });
    }
  });

  // ── GET /api/me/dota2/matches ────────────────────────────────────────────────
  // Returns persisted raw match records for inspection.
  // Query params: ?limit=20&offset=0
  app.get("/api/me/dota2/matches", isAuthenticated, async (req: any, res) => {
    const querySchema = z.object({
      limit:  z.coerce.number().int().min(1).max(100).optional().default(20),
      offset: z.coerce.number().int().min(0).optional().default(0),
    });
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid query", errors: parsed.error.flatten() });
    }

    try {
      const result = await dota2MatchSyncService.getDota2MatchList(
        getUserId(req),
        parsed.data.limit,
        parsed.data.offset,
      );
      return res.json(result);
    } catch (err: any) {
      if (err.status === 404) {
        return res.status(404).json({ message: err.message });
      }
      console.error("[Multigame] GET /api/me/dota2/matches:", err.message);
      return res.status(500).json({ message: "Failed to fetch matches." });
    }
  });

  // ════════════════════════════════════════════════════════════════════════════
  //  Dota2 Match Enrichment (Fase 4)
  // ════════════════════════════════════════════════════════════════════════════

  // ── POST /api/me/dota2/process-matches ───────────────────────────────────────
  // Runs the enrichment pipeline: detail fetch → parse → role detect → eligibility.
  // Processes up to `limit` pending matches per call (default: 10, max: 50).
  // Idempotent: already-processed matches are skipped by findMatchesForEnrichment.
  app.post("/api/me/dota2/process-matches", isAuthenticated, async (req: any, res) => {
    const bodySchema = z.object({
      limit: z.number().int().min(1).max(50).optional(),
    });
    const parsed = bodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid body", errors: parsed.error.flatten() });
    }

    try {
      const result = await dota2MatchEnrichmentService.enrichDota2Matches({
        userId:       getUserId(req),
        processLimit: parsed.data.limit,
      });
      return res.status(200).json(result);
    } catch (err: any) {
      if (err.status === 404) return res.status(404).json({ message: err.message });
      if (err.status === 400) return res.status(400).json({ message: err.message });
      console.error("[Multigame] POST /api/me/dota2/process-matches:", err.message);
      return res.status(500).json({ message: "Match enrichment failed." });
    }
  });

  // ── GET /api/me/dota2/match-analytics ───────────────────────────────────────
  // Returns processed analytics records for inspection.
  // Query params: ?limit=20&offset=0&eligibleOnly=true
  app.get("/api/me/dota2/match-analytics", isAuthenticated, async (req: any, res) => {
    const querySchema = z.object({
      limit:       z.coerce.number().int().min(1).max(100).optional().default(20),
      offset:      z.coerce.number().int().min(0).optional().default(0),
      eligibleOnly: z.enum(["true", "false"]).optional().default("false"),
    });
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid query", errors: parsed.error.flatten() });
    }

    try {
      const result = await dota2MatchEnrichmentService.getDota2MatchAnalytics(
        getUserId(req),
        parsed.data.limit,
        parsed.data.offset,
        parsed.data.eligibleOnly === "true",
      );
      return res.json(result);
    } catch (err: any) {
      if (err.status === 404) return res.status(404).json({ message: err.message });
      console.error("[Multigame] GET /api/me/dota2/match-analytics:", err.message);
      return res.status(500).json({ message: "Failed to fetch match analytics." });
    }
  });

  // ════════════════════════════════════════════════════════════════════════════
  //  Dota2 Baseline Engine + RoleRelativeScore (Fase 5)
  // ════════════════════════════════════════════════════════════════════════════

  // ── POST /api/admin/dota2/rebuild-baselines ──────────────────────────────────
  // Admin-only: recomputes median/MAD baselines from all eligible analytics.
  // Destructive: clears existing baselines for dota2 and rebuilds from scratch.
  // Safe to call repeatedly — idempotent rebuild.
  app.post("/api/admin/dota2/rebuild-baselines", isAuthenticated, async (req: any, res) => {
    // Admin guard
    const user = req.user as any;
    if (!isAdminUser(req)) {
      return res.status(403).json({ message: "Admin access required." });
    }

    try {
      const result = await dota2BaselineService.rebuildBaselines("dota2");
      return res.status(200).json(result);
    } catch (err: any) {
      console.error("[Multigame] POST /api/admin/dota2/rebuild-baselines:", err.message);
      return res.status(500).json({ message: "Baseline rebuild failed." });
    }
  });

  // ── POST /api/me/dota2/score-matches ─────────────────────────────────────────
  // Calculate RoleRelativeScore for the player's eligible unscored matches.
  // Reads baselines from DB (must have run rebuild-baselines at least once).
  // Query param: ?limit=50 (max matches to score per call)
  app.post("/api/me/dota2/score-matches", isAuthenticated, async (req: any, res) => {
    const bodySchema = z.object({
      limit: z.number().int().min(1).max(200).optional(),
    });
    const parsed = bodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid body", errors: parsed.error.flatten() });
    }

    try {
      const result = await dota2BaselineService.scoreDota2Matches({
        userId:      getUserId(req),
        scoreLimit:  parsed.data.limit,
      });
      return res.status(200).json(result);
    } catch (err: any) {
      if (err.status === 404) return res.status(404).json({ message: err.message });
      console.error("[Multigame] POST /api/me/dota2/score-matches:", err.message);
      return res.status(500).json({ message: "Match scoring failed." });
    }
  });

  // ── GET /api/me/dota2/score-components ──────────────────────────────────────
  // Read persisted RoleRelativeScore components with full metric-level detail.
  // Query params: ?limit=20&offset=0&role=P1&applied=true|false
  app.get("/api/me/dota2/score-components", isAuthenticated, async (req: any, res) => {
    const querySchema = z.object({
      limit:  z.coerce.number().int().min(1).max(100).optional().default(20),
      offset: z.coerce.number().int().min(0).optional().default(0),
      role:   z.enum(["P1", "P2", "P3", "P4", "P5"]).optional(),
    });
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid query", errors: parsed.error.flatten() });
    }

    try {
      const result = await dota2BaselineService.getDota2ScoreComponents(
        getUserId(req),
        parsed.data.limit,
        parsed.data.offset,
        parsed.data.role,
      );
      return res.json(result);
    } catch (err: any) {
      if (err.status === 404) return res.status(404).json({ message: err.message });
      console.error("[Multigame] GET /api/me/dota2/score-components:", err.message);
      return res.status(500).json({ message: "Failed to fetch score components." });
    }
  });

  // ── POST /api/me/dota2/compute-performance ───────────────────────────────────
  // Fase 6: aggregate RoleRelativeScore + SelfTrend + ContextScore into
  // PerformanceScore for all eligible matches.
  // Body (optional): { scoreLimit: number }
  app.post("/api/me/dota2/compute-performance", isAuthenticated, async (req: any, res) => {
    const bodySchema = z.object({
      scoreLimit: z.coerce.number().int().min(1).max(200).optional().default(50),
    });
    const parsed = bodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid body", errors: parsed.error.flatten() });
    }
    try {
      const result = await dota2PerformanceService.computeDota2PerformanceScores({
        userId:     getUserId(req),
        scoreLimit: parsed.data.scoreLimit,
      });
      return res.json(result);
    } catch (err: any) {
      if (err.status === 404) return res.status(404).json({ message: err.message });
      console.error("[Multigame] POST /api/me/dota2/compute-performance:", err.message);
      return res.status(500).json({ message: "Failed to compute performance scores." });
    }
  });

  // ── GET /api/me/dota2/performance-scores ─────────────────────────────────────
  // Read persisted PerformanceScores with full audit breakdown.
  // Query params: ?limit=20&offset=0&role=P1&applied=true|false
  // applied=false → only pending (not yet used in valuation update)
  // applied=true  → already processed scores
  // omit           → all scores
  app.get("/api/me/dota2/performance-scores", isAuthenticated, async (req: any, res) => {
    const querySchema = z.object({
      limit:   z.coerce.number().int().min(1).max(100).optional().default(20),
      offset:  z.coerce.number().int().min(0).optional().default(0),
      role:    z.enum(["P1", "P2", "P3", "P4", "P5"]).optional(),
      applied: z.enum(["true", "false"]).optional().transform(v =>
        v === undefined ? undefined : v === "true"
      ),
    });
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid query", errors: parsed.error.flatten() });
    }
    try {
      const result = await dota2PerformanceService.getDota2PerformanceScores(
        getUserId(req),
        parsed.data.limit,
        parsed.data.offset,
        parsed.data.role,
        parsed.data.applied,
      );
      return res.json(result);
    } catch (err: any) {
      if (err.status === 404) return res.status(404).json({ message: err.message });
      console.error("[Multigame] GET /api/me/dota2/performance-scores:", err.message);
      return res.status(500).json({ message: "Failed to fetch performance scores." });
    }
  });

  // ── POST /api/me/dota2/bootstrap-valuation ───────────────────────────────────
  // Fase 7: compute ConfidenceScore + InitialValue, create valuation state.
  // Idempotent — safe to re-run, will overwrite with fresh calculation.
  app.post("/api/me/dota2/bootstrap-valuation", isAuthenticated, async (req: any, res) => {
    try {
      const result = await dota2ValuationService.bootstrapDota2Valuation(getUserId(req));
      return res.json(result);
    } catch (err: any) {
      if (err.status === 404) return res.status(404).json({ message: err.message });
      if (err.status === 422) return res.status(422).json({ message: err.message });
      console.error("[Multigame] POST /api/me/dota2/bootstrap-valuation:", err.message);
      return res.status(500).json({ message: "Failed to bootstrap valuation." });
    }
  });

  // ── POST /api/me/dota2/update-valuation ──────────────────────────────────────
  // Fase 7: apply performance scores to update RawValue/PlayerValue.
  // Body (optional): { scoreLimit: number }
  app.post("/api/me/dota2/update-valuation", isAuthenticated, async (req: any, res) => {
    const bodySchema = z.object({
      scoreLimit: z.coerce.number().int().min(1).max(200).optional().default(50),
    });
    const parsed = bodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid body", errors: parsed.error.flatten() });
    }
    try {
      const result = await dota2ValuationService.updateDota2Valuation(
        getUserId(req),
        { scoreLimit: parsed.data.scoreLimit },
      );
      return res.json(result);
    } catch (err: any) {
      if (err.status === 404) return res.status(404).json({ message: err.message });
      if (err.status === 422) return res.status(422).json({ message: err.message });
      console.error("[Multigame] POST /api/me/dota2/update-valuation:", err.message);
      return res.status(500).json({ message: "Failed to update valuation." });
    }
  });

  // ── GET /api/me/dota2/valuation ──────────────────────────────────────────────
  // Fase 7: read current valuation state.
  app.get("/api/me/dota2/valuation", isAuthenticated, async (req: any, res) => {
    try {
      const result = await dota2ValuationService.getDota2Valuation(getUserId(req));
      if (!result) return res.status(404).json({ message: "Valuation not bootstrapped yet." });
      return res.json(result);
    } catch (err: any) {
      if (err.status === 404) return res.status(404).json({ message: err.message });
      console.error("[Multigame] GET /api/me/dota2/valuation:", err.message);
      return res.status(500).json({ message: "Failed to fetch valuation." });
    }
  });

  // ── GET /api/me/dota2/valuation-history ──────────────────────────────────────
  // Fase 7: audit trail of all value changes.
  // Query params: ?limit=20&offset=0&eventType=BOOTSTRAP|MATCH_UPDATE|RECALC|MANUAL_ADJUSTMENT
  app.get("/api/me/dota2/valuation-history", isAuthenticated, async (req: any, res) => {
    const querySchema = z.object({
      limit:     z.coerce.number().int().min(1).max(100).optional().default(20),
      offset:    z.coerce.number().int().min(0).optional().default(0),
      eventType: z.enum(["BOOTSTRAP", "MATCH_UPDATE", "RECALC", "MANUAL_ADJUSTMENT"]).optional(),
    });
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid query", errors: parsed.error.flatten() });
    }
    try {
      const result = await dota2ValuationService.getDota2ValueHistory(
        getUserId(req),
        parsed.data.limit,
        parsed.data.offset,
        parsed.data.eventType,
      );
      return res.json(result);
    } catch (err: any) {
      if (err.status === 404) return res.status(404).json({ message: err.message });
      console.error("[Multigame] GET /api/me/dota2/valuation-history:", err.message);
      return res.status(500).json({ message: "Failed to fetch valuation history." });
    }
  });

  // ════════════════════════════════════════════════════════════════════════════
  //  Terminal Assets (public)
  // ════════════════════════════════════════════════════════════════════════════

  // ── GET /api/terminal/assets ─────────────────────────────────────────────────
  app.get("/api/terminal/assets", async (req, res) => {
    const parsed = terminalAssetsQuery.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid query params", errors: parsed.error.flatten() });
    }
    try {
      const result = await repo.listTerminalAssets(parsed.data);
      return res.json(result);
    } catch (err: any) {
      console.error("[Multigame] GET /api/terminal/assets:", err.message);
      return res.status(500).json({ message: "Failed to fetch terminal assets." });
    }
  });

  // ── GET /api/terminal/assets/:id ─────────────────────────────────────────────
  app.get("/api/terminal/assets/:id", async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid asset id." });
    try {
      const asset = await repo.findTerminalAssetById(id);
      if (!asset) return res.status(404).json({ message: "Asset not found." });
      return res.json({ asset });
    } catch (err: any) {
      console.error("[Multigame] GET /api/terminal/assets/:id:", err.message);
      return res.status(500).json({ message: "Failed to fetch asset." });
    }
  });

  // ── GET /api/terminal/assets/:id/fundamentals ────────────────────────────────
  // Fase 8 + 9: Terminal fundamentals read model.
  // Returns asset metadata + current Dota2 valuation state + pending score count
  //   + isTradable flag (Fase 9: tradingStatus=ACTIVE && listingStatus=LISTED).
  // Public endpoint — no auth required.
  app.get("/api/terminal/assets/:id/fundamentals", async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid asset id." });
    try {
      const fundamentals = await repo.findDota2AssetFundamentals(id);
      if (!fundamentals) return res.status(404).json({ message: "Asset not found." });
      // Fase 9: add computed isTradable flag
      const isTradable = (
        fundamentals.tradingStatus === "ACTIVE" &&
        fundamentals.listingStatus  === "LISTED"
      );
      return res.json({ fundamentals: { ...fundamentals, isTradable } });
    } catch (err: any) {
      console.error("[Multigame] GET /api/terminal/assets/:id/fundamentals:", err.message);
      return res.status(500).json({ message: "Failed to fetch asset fundamentals." });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // Fase 9 — Listing Workflow
  // ══════════════════════════════════════════════════════════════════════════════

  // ── GET /api/me/dota2/listing-readiness ───────────────────────────────────────
  // Returns a structured readiness snapshot evaluating whether the calling user's
  // Dota2 asset meets all criteria for terminal listing.
  // READ-ONLY — never mutates state. Run this to understand what's missing.
  //
  // Criteria evaluated (see LISTING_THRESHOLDS):
  //   hasConnectedSteamAccount, hasPlayerProfile, hasAsset,
  //   hasEligibilitySnapshot, rankedMatchesMet, eligibleAnalyticsMet,
  //   performanceScoresMet, hasValuationState, confidenceScoreMet, hasPlayerValue
  app.get("/api/me/dota2/listing-readiness", isAuthenticated, async (req: any, res) => {
    try {
      const snapshot = await dota2ListingEligibilityService.evaluateDota2ListingReadiness(
        getUserId(req),
      );
      return res.json({ readiness: snapshot });
    } catch (err: any) {
      if (err.status === 404) return res.status(404).json({ message: err.message });
      console.error("[Multigame] GET /api/me/dota2/listing-readiness:", err.message);
      return res.status(500).json({ message: "Listing readiness evaluation failed." });
    }
  });

  // ── GET /api/me/cs2/listing-readiness ────────────────────────────────────────
  // Fase 18: Read-only listing readiness snapshot for the calling user's CS2 asset.
  // Mirrors /api/me/dota2/listing-readiness — same response shape, CS2-adapted checks.
  // Most checks will return false until the match ingestion pipeline is built.
  // Returns: { readiness: Cs2ListingReadinessSnapshot }
  app.get("/api/me/cs2/listing-readiness", isAuthenticated, async (req: any, res) => {
    try {
      const snapshot = await cs2ListingEligibilityService.evaluateCs2ListingReadiness(
        getUserId(req),
      );
      return res.json({ readiness: snapshot });
    } catch (err: any) {
      if (err.status === 404) return res.status(404).json({ message: err.message });
      console.error("[Multigame] GET /api/me/cs2/listing-readiness:", err.message);
      return res.status(500).json({ message: "CS2 listing readiness evaluation failed." });
    }
  });

  // ── GET /api/me/cs2/candidate-snapshot ────────────────────────────────────────
  // Fase 18: Returns the structured Cs2CandidateSnapshot for the authenticated user.
  // This is the primary output of the CS2 onboarding phase — consumed by the next
  // pipeline stages (confidence calculator, initial valuation, Creator Hub display).
  // Returns null data if no CS2 account is connected.
  app.get("/api/me/cs2/candidate-snapshot", isAuthenticated, async (req: any, res) => {
    try {
      const snapshot = await cs2OnboardingService.getCs2CandidateSnapshot(getUserId(req));
      if (!snapshot) {
        return res.status(404).json({
          message: "No CS2 candidate snapshot found. Complete the CS2 connect flow first.",
        });
      }
      return res.json({ candidateSnapshot: snapshot });
    } catch (err: any) {
      console.error("[Multigame] GET /api/me/cs2/candidate-snapshot:", err.message);
      return res.status(500).json({ message: "Failed to fetch CS2 candidate snapshot." });
    }
  });

  // ── POST /api/me/cs2/bootstrap-valuation ──────────────────────────────────────
  // Fase 3: Bootstrap (or refresh) the CS2 initial valuation from the player's
  // eligibility snapshot. Idempotent — safe to call multiple times.
  // Returns initialValue, rawValue, playerValue, confidenceScore and audit inputs.
  app.post("/api/me/cs2/bootstrap-valuation", isAuthenticated, async (req: any, res) => {
    try {
      const result = await cs2ValuationService.bootstrapCs2Valuation(getUserId(req));
      return res.json({
        message: result.alreadyExisted
          ? "CS2 valuation refreshed."
          : "CS2 valuation bootstrapped.",
        valuation: result,
      });
    } catch (err: any) {
      const status = err.status ?? 500;
      console.error("[Multigame] POST /api/me/cs2/bootstrap-valuation:", err.message);
      return res.status(status).json({ message: err.message ?? "Failed to bootstrap CS2 valuation." });
    }
  });

  // ── GET /api/me/cs2/valuation ─────────────────────────────────────────────────
  // Fase 3: Read current CS2 valuation state. Returns null if not bootstrapped.
  app.get("/api/me/cs2/valuation", isAuthenticated, async (req: any, res) => {
    try {
      const valuation = await cs2ValuationService.getCs2Valuation(getUserId(req));
      return res.json({ valuation });
    } catch (err: any) {
      const status = err.status ?? 500;
      console.error("[Multigame] GET /api/me/cs2/valuation:", err.message);
      return res.status(status).json({ message: err.message ?? "Failed to fetch CS2 valuation." });
    }
  });

  // ── GET /api/me/cs2/valuation/history ────────────────────────────────────────
  // Fase 3: Read CS2 value history for the authenticated user.
  app.get("/api/me/cs2/valuation/history", isAuthenticated, async (req: any, res) => {
    try {
      const limit  = parseInt(String(req.query.limit  ?? "20"), 10);
      const offset = parseInt(String(req.query.offset ?? "0"),  10);
      const eventType = typeof req.query.eventType === "string" ? req.query.eventType : undefined;
      const result = await cs2ValuationService.getCs2ValueHistory(getUserId(req), limit, offset, eventType);
      return res.json(result);
    } catch (err: any) {
      const status = err.status ?? 500;
      console.error("[Multigame] GET /api/me/cs2/valuation/history:", err.message);
      return res.status(status).json({ message: err.message ?? "Failed to fetch CS2 value history." });
    }
  });

  // ── POST /api/me/cs2/sync-stats ───────────────────────────────────────────────
  // Fase 4: Ingest aggregate CS2 career stats from Steam Web API.
  // Requires STEAM_WEB_API_KEY env var; gracefully degrades if not configured.
  // Idempotent — safe to call multiple times; upserts a single career_aggregate record.
  app.post("/api/me/cs2/sync-stats", isAuthenticated, async (req: any, res) => {
    try {
      const forceRefresh = req.query.force === "true";
      const result = await cs2MatchSyncService.syncCs2Stats({
        userId: getUserId(req),
        forceRefresh,
      });
      return res.json({
        message: result.recordUpdated
          ? "CS2 stats synced and aggregate record updated."
          : "CS2 stats synced and aggregate record created.",
        result,
      });
    } catch (err: any) {
      const status = err.status ?? 500;
      console.error("[Multigame] POST /api/me/cs2/sync-stats:", err.message);
      return res.status(status).json({ message: err.message ?? "Failed to sync CS2 stats." });
    }
  });

  // ── GET /api/me/cs2/matches ────────────────────────────────────────────────
  // Fase 4: List CS2 match/aggregate records for the authenticated user.
  // In V1, at most one record exists per player (career_aggregate).
  app.get("/api/me/cs2/matches", isAuthenticated, async (req: any, res) => {
    try {
      const limit  = parseInt(String(req.query.limit  ?? "20"), 10);
      const offset = parseInt(String(req.query.offset ?? "0"),  10);
      const result = await cs2MatchSyncService.getCs2MatchList(getUserId(req), limit, offset);
      return res.json(result);
    } catch (err: any) {
      const status = err.status ?? 500;
      console.error("[Multigame] GET /api/me/cs2/matches:", err.message);
      return res.status(status).json({ message: err.message ?? "Failed to fetch CS2 matches." });
    }
  });

  // ── GET /api/admin/dota2/assets-under-review ──────────────────────────────────
  // Admin queue: all Dota2 assets with listingStatus=UNDER_REVIEW.
  // Each entry includes the latest review record (if any) for context.
  app.get("/api/admin/dota2/assets-under-review", isAuthenticated, async (req: any, res) => {
    const user = req.user as any;
    if (!isAdminUser(req)) {
      return res.status(403).json({ message: "Admin access required." });
    }
    try {
      const { hasOwner, hasValuation, verificationStatus: vsFilter } = req.query as Record<string, string | undefined>;
      const baseQueue = await repo.listDota2AssetsUnderReview();

      // Fase 13: enrich each entry with fundamentals + ownership + verification
      let queue = await Promise.all(baseQueue.map(async (item) => {
        const fundamentals = await repo.findDota2AssetFundamentals(item.assetId);
        const ownershipLink = await repo.findActiveAssetOwnershipLink(item.assetId);

        // Derive verificationStatus from playerProfile → connectedAccount chain
        let verificationStatus: string | null = null;
        if (fundamentals?.playerProfileId) {
          const profile = await repo.findPlayerProfileById(fundamentals.playerProfileId);
          if (profile?.primaryConnectedAccountId) {
            const ca = await repo.findConnectedAccountById(profile.primaryConnectedAccountId);
            verificationStatus = ca?.verificationStatus ?? null;
          }
        }

        const isTradable = fundamentals?.tradingStatus === "ACTIVE" && fundamentals?.listingStatus === "LISTED";

        return {
          ...item,
          confidenceScore:    fundamentals?.confidenceScore ?? null,
          playerValue:        fundamentals?.playerValue ?? null,
          matchesCount:       fundamentals?.matchesCount ?? null,
          isTradable,
          ownershipStatus:    ownershipLink ? "ACTIVE" : null,
          ownerUserId:        ownershipLink?.userId ?? null,
          verificationStatus,
        };
      }));

      // Post-fetch filters
      if (hasOwner === "true")       queue = queue.filter(q => !!q.ownershipStatus);
      if (hasOwner === "false")      queue = queue.filter(q => !q.ownershipStatus);
      if (hasValuation === "true")   queue = queue.filter(q => q.playerValue !== null);
      if (hasValuation === "false")  queue = queue.filter(q => q.playerValue === null);
      if (vsFilter)                  queue = queue.filter(q => q.verificationStatus === vsFilter);

      return res.json({ queue, total: queue.length });
    } catch (err: any) {
      console.error("[Multigame] GET /api/admin/dota2/assets-under-review:", err.message);
      return res.status(500).json({ message: "Failed to fetch under-review queue." });
    }
  });

  // ── POST /api/admin/dota2/assets/:id/approve-listing ─────────────────────────
  // Admin action: promote asset to ACTIVE + LISTED.
  // Creates an immutable audit record in asset_listing_reviews.
  // Body: { reasonCode?: string }
  app.post("/api/admin/dota2/assets/:id/approve-listing", isAuthenticated, async (req: any, res) => {
    const user = req.user as any;
    if (!isAdminUser(req)) {
      return res.status(403).json({ message: "Admin access required." });
    }
    const assetId = parseInt(req.params.id, 10);
    if (isNaN(assetId)) return res.status(400).json({ message: "Invalid asset id." });

    const bodySchema = z.object({
      reasonCode: z.string().max(64).optional(),
    });
    const parsed = bodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid body", errors: parsed.error.flatten() });
    }

    try {
      // Verify asset exists and is Dota2
      const asset = await repo.findTerminalAssetById(assetId);
      if (!asset) return res.status(404).json({ message: "Asset not found." });
      if (asset.game !== "dota2") {
        return res.status(400).json({ message: "Only Dota2 assets use this listing workflow." });
      }

      // Evaluate current readiness for the snapshot (read-only)
      // We store the snapshot even on admin override for auditability
      let snapshotJson = "{}";
      if (asset.playerProfileId) {
        // Best-effort: find user from playerProfileId to evaluate readiness
        // Since this is admin action, we store a minimal snapshot
        snapshotJson = JSON.stringify({
          adminOverride: true,
          assetId,
          game: asset.game,
          approvedAt: new Date().toISOString(),
          reviewedBy: user.id ?? user.username ?? "admin",
        });
      }

      // Create immutable audit record
      await repo.insertAssetListingReview({
        assetId,
        game:         "dota2",
        decision:     "APPROVED",
        reasonCode:   parsed.data.reasonCode ?? "ADMIN_APPROVED",
        snapshotJson,
        reviewedBy:   String(user.id ?? user.username ?? "admin"),
      } as any);

      // Promote asset: DRAFT → ACTIVE, UNDER_REVIEW → LISTED
      const updated = await repo.updateAssetStatus(assetId, {
        tradingStatus: "ACTIVE",
        listingStatus: "LISTED",
      });

      // ── Seed AMM if not already seeded ────────────────────────────────────
      // Uses the asset's current lastTradePrice (populated by valuation projection)
      // as the starting market price. Falls back to DEFAULT_AMM_PARAMS floor if 0.
      try {
        const [assetRow] = await db
          .select({ lastTradePrice: assets.lastTradePrice })
          .from(assets)
          .where(eq(assets.id, assetId))
          .limit(1);

        const startingPrice = Math.max(
          parseFloat(String(assetRow?.lastTradePrice ?? "0")),
          DEFAULT_AMM_PARAMS.floorPrice + 0.01,
        );

        await db.insert(assetMarkets).values({
          assetId,
          isEnabled:  true,
          floorPrice: String(DEFAULT_AMM_PARAMS.floorPrice),
          paramA:     String(DEFAULT_AMM_PARAMS.paramA),
          paramB:     String(DEFAULT_AMM_PARAMS.paramB),
        }).onConflictDoNothing();

        const supply = supplyForPrice(startingPrice, DEFAULT_AMM_PARAMS);
        await db.insert(assetMarketState).values({
          assetId,
          supply:    supply.toFixed(6),
          lastPrice: startingPrice.toFixed(2),
          version:   1,
        }).onConflictDoNothing();

        console.log(
          `[ApproveListing] AMM seeded assetId=${assetId} ` +
          `startingPrice=${startingPrice.toFixed(2)} supply=${supply.toFixed(4)}`,
        );
      } catch (ammErr: any) {
        // Non-fatal — listing is promoted even if AMM seed fails.
        // Admin can manually seed via /api/admin/amm/seed.
        console.error(`[ApproveListing] AMM seed failed for assetId=${assetId}:`, ammErr.message);
      }

      return res.json({
        message:      "Asset approved and listed.",
        assetId,
        tradingStatus: updated?.tradingStatus,
        listingStatus: updated?.listingStatus,
      });
    } catch (err: any) {
      console.error("[Multigame] POST /api/admin/dota2/assets/:id/approve-listing:", err.message);
      return res.status(500).json({ message: "Listing approval failed." });
    }
  });

  // ── POST /api/admin/dota2/assets/:id/reject-listing ──────────────────────────
  // Admin action: reject asset, setting it back to DRAFT + REJECTED.
  // Creates an immutable audit record in asset_listing_reviews.
  // Body: { reasonCode?: string }
  app.post("/api/admin/dota2/assets/:id/reject-listing", isAuthenticated, async (req: any, res) => {
    const user = req.user as any;
    if (!isAdminUser(req)) {
      return res.status(403).json({ message: "Admin access required." });
    }
    const assetId = parseInt(req.params.id, 10);
    if (isNaN(assetId)) return res.status(400).json({ message: "Invalid asset id." });

    const bodySchema = z.object({
      reasonCode: z.string().max(64).optional(),
    });
    const parsed = bodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid body", errors: parsed.error.flatten() });
    }

    try {
      const asset = await repo.findTerminalAssetById(assetId);
      if (!asset) return res.status(404).json({ message: "Asset not found." });
      if (asset.game !== "dota2") {
        return res.status(400).json({ message: "Only Dota2 assets use this listing workflow." });
      }

      const snapshotJson = JSON.stringify({
        adminOverride: true,
        assetId,
        game: asset.game,
        rejectedAt: new Date().toISOString(),
        reviewedBy: user.id ?? user.username ?? "admin",
        reasonCode: parsed.data.reasonCode ?? "ADMIN_REJECTED",
      });

      await repo.insertAssetListingReview({
        assetId,
        game:         "dota2",
        decision:     "REJECTED",
        reasonCode:   parsed.data.reasonCode ?? "ADMIN_REJECTED",
        snapshotJson,
        reviewedBy:   String(user.id ?? user.username ?? "admin"),
      } as any);

      // Revert asset: ACTIVE → DRAFT, any → REJECTED
      const updated = await repo.updateAssetStatus(assetId, {
        tradingStatus: "DRAFT",
        listingStatus: "REJECTED",
      });

      return res.json({
        message:       "Asset rejected.",
        assetId,
        tradingStatus: updated?.tradingStatus,
        listingStatus: updated?.listingStatus,
      });
    } catch (err: any) {
      console.error("[Multigame] POST /api/admin/dota2/assets/:id/reject-listing:", err.message);
      return res.status(500).json({ message: "Listing rejection failed." });
    }
  });

  // ── Fase 10: Steam OpenID 2.0 Verification ─────────────────────────────────
  //
  //   GET  /api/auth/steam          — alias for /api/auth/steam/start (used by frontend links)
  //   GET  /api/auth/steam/start    — initiate Steam OpenID 2.0 login
  //   GET  /api/auth/steam/callback — process Steam's return redirect

  /**
   * Alias for /api/auth/steam/start.
   * Fase 26: frontend uses href="/api/auth/steam" — redirect transparently.
   */
  app.get("/api/auth/steam", (req: any, res) => {
    const qs = new URLSearchParams(req.query as Record<string, string>).toString();
    res.redirect(`/api/auth/steam/start${qs ? `?${qs}` : ""}`);
  });

  /**
   * Initiate Steam OpenID 2.0 verification.
   *
   * Fase 16: Uses steamVerificationAdapter via the VerificationRegistry.
   * The adapter builds the redirect URL and INITIATED event payload.
   * This handler persists the event and performs the redirect — no provider logic inline.
   */
  app.get("/api/auth/steam/start", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ message: "Not authenticated." });

      // Store returnUrl in session so callback can redirect the user post-verification
      const returnUrl = typeof req.query.returnUrl === "string"
        ? req.query.returnUrl
        : "/";
      req.session.steamReturnUrl = returnUrl;

      // Build callback URL.
      // Priority:
      //   1. APP_URL env var (explicit override — highest priority)
      //   2. REPLIT_DEPLOYMENT=1  → production deploy → use REPLIT_DOMAINS
      //   3. REPLIT_DEV_DOMAIN    → Replit dev workspace preview URL
      //   4. req.protocol + host  → generic fallback
      const host = (() => {
        if (process.env.APP_URL) {
          return process.env.APP_URL.replace(/\/$/, "");
        }
        if (process.env.REPLIT_DEPLOYMENT === "1") {
          const primary = (process.env.REPLIT_DOMAINS ?? "").split(",")[0]?.trim();
          if (primary) return `https://${primary}`;
        }
        if (process.env.REPLIT_DEV_DOMAIN) {
          return `https://${process.env.REPLIT_DEV_DOMAIN}`;
        }
        return `${req.protocol}://${req.get("host")}`;
      })();
      const callbackUrl = `${host}/api/auth/steam/callback`;
      const realm       = host;

      console.log(`[Steam/start] baseUrl=${host} realm=${realm} callbackUrl=${callbackUrl}`);

      // Locate the user's Dota2 Steam account to record the INITIATED event
      const accounts     = await repo.findConnectedAccountsByUser(userId);
      const steamAccount = accounts.find(
        (a: any) => a.providerGroup === "steam" && a.game === "dota2",
      );

      // Get adapter from registry and produce start result
      const adapter = getVerificationAdapter("steam");
      if (steamAccount) {
        const startResult = adapter.startVerification({
          connectedAccountId: (steamAccount as any).id,
          userId,
          game:        "dota2",
          callbackUrl,
          realm,
        });
        // Persist INITIATED event (best-effort — don't block the redirect)
        await repo.insertAccountVerificationEvent(
          startResult.verificationEventPayload as any,
        );
        return res.redirect(startResult.redirectUrl);
      }

      // No steam account found yet — still redirect to Steam (account will be found in callback)
      const startResult = adapter.startVerification({
        connectedAccountId: 0, // placeholder — event skipped when no account
        userId,
        game:        "dota2",
        callbackUrl,
        realm,
      });
      return res.redirect(startResult.redirectUrl);
    } catch (err: any) {
      console.error("[Steam] GET /api/auth/steam/start:", err.message);
      return res.status(500).json({ message: "Failed to initiate Steam verification." });
    }
  });

  /**
   * Steam OpenID 2.0 callback.
   *
   * Fase 16: Delegates all provider logic to steamVerificationAdapter via the registry.
   * This handler is now responsible only for:
   *   - session lookup (userId, returnUrl)
   *   - finding the connected account
   *   - converting Express query → plain string map
   *   - persisting the event returned by the adapter
   *   - updating ConnectedAccount verificationStatus
   *   - redirecting the user
   *
   * All Steam OpenID signature verification and identity normalization is in the adapter.
   */
  app.get("/api/auth/steam/callback", async (req: any, res) => {
    const returnUrl = req.session?.steamReturnUrl ?? "/";
    const userId    = req.session?.userId as string | undefined;

    console.log(`[Steam/callback] returnTo=${req.query["openid.return_to"] ?? "n/a"} userId=${userId ?? "none"} returnUrl=${returnUrl}`);

    if (!userId) {
      return res.redirect(`${returnUrl}?steam_error=SESSION_EXPIRED`);
    }

    try {
      // Convert Express query to a plain string map (adapter expects Record<string, string>)
      const query: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.query)) {
        if (typeof v === "string") query[k] = v;
      }

      // Find the user's Dota2 ConnectedAccount
      const accounts     = await repo.findConnectedAccountsByUser(userId);
      let   steamAccount = accounts.find(
        (a: any) => a.providerGroup === "steam" && a.game === "dota2",
      ) as any;

      // Delegate to the Steam adapter via the registry.
      // Fase 26: if no steamAccount exists yet, we still verify the signature
      // (expectedProviderAccountId=null skips the identity comparison) so we can
      // extract the steamId64 and auto-create the account.
      const adapter  = getVerificationAdapter("steam");
      const cbResult = await adapter.handleCallback({
        query,
        connectedAccountId:        steamAccount?.id ?? 0,
        userId,
        game:                      "dota2",
        expectedProviderAccountId: steamAccount?.providerAccountId ?? null,
      });

      // Persist the event (VERIFIED or FAILED) from the adapter
      if (steamAccount) {
        await repo.insertAccountVerificationEvent(
          cbResult.verificationEventPayload as any,
        );
      }

      if (!cbResult.success) {
        return res.redirect(
          `${returnUrl}?steam_error=${encodeURIComponent(cbResult.errorCode ?? "UNKNOWN")}`,
        );
      }

      const verifiedSteamId64 = cbResult.normalizedIdentity?.providerAccountId ?? null;

      // Fase 26: if no ConnectedAccount existed, auto-create it now that Steam identity is proven.
      // This allows users to connect Dota2 via a single OAuth click (no manual steamId entry).
      if (!steamAccount && verifiedSteamId64) {
        try {
          const bootstrapResult = await dota2OnboardingService.connectDota2Account(userId, {
            steamId: verifiedSteamId64,
          });
          steamAccount = bootstrapResult.connectedAccount;
          console.log(`[Steam] Fase 26: auto-created ConnectedAccount for userId=${userId} steamId64=${verifiedSteamId64}`);
        } catch (autoCreateErr: any) {
          console.error("[Steam] Fase 26 auto-create failed:", autoCreateErr.message);
          return res.redirect(`${returnUrl}?steam_error=AUTO_CREATE_FAILED`);
        }
      }

      if (!steamAccount) {
        return res.redirect(`${returnUrl}?steam_error=NO_STEAM_ACCOUNT`);
      }

      // Fase 17: Update ALL Steam ConnectedAccounts (dota2, cs2, …) with
      // this SteamID64 to VERIFIED. A user proves ownership once per
      // Steam ID — the proof applies to every game they connected with that ID.
      const steamId64ToVerify = verifiedSteamId64 ?? (steamAccount as any).providerAccountId;
      if (steamId64ToVerify) {
        await repo.updateAllSteamConnectedAccountsVerificationStatus(
          userId,
          steamId64ToVerify,
          "VERIFIED",
          (steamAccount as any).providerAccountName ?? undefined,
        );
      } else {
        await repo.updateConnectedAccountVerificationStatus(
          (steamAccount as any).id,
          "VERIFIED",
          (steamAccount as any).providerAccountName ?? undefined,
        );
      }

      // Clean up session key
      delete req.session.steamReturnUrl;

      return res.redirect(`${returnUrl}?steam_verified=1`);
    } catch (err: any) {
      console.error("[Steam] GET /api/auth/steam/callback:", err.message);
      return res.redirect(`${returnUrl}?steam_error=SERVER_ERROR`);
    }
  });

  // ── Fase 10: Listing Submissions (user-scoped) ──────────────────────────────
  //
  //   POST /api/me/dota2/submit-for-review   — create submission with frozen snapshot
  //   GET  /api/me/dota2/submissions         — list user's submissions

  /**
   * Submit an asset for listing review.
   *
   * Evaluates current readiness, freezes the snapshot, and creates a submission record.
   * The asset must be in DRAFT or REJECTED state (users can re-submit after rejection).
   * Sets listingStatus → UNDER_REVIEW so the admin queue includes this asset.
   */
  app.post("/api/me/dota2/submit-for-review", isAuthenticated, async (req: any, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Not authenticated." });

    try {
      // Find the user's Dota2 player profile
      const profiles = await repo.findPlayerProfilesByUser(userId);
      const dota2Profile = profiles.find((p: any) => p.game === "dota2");
      if (!dota2Profile) {
        return res.status(404).json({ message: "No Dota2 player profile found." });
      }

      // Find the asset
      const asset = await repo.findAssetByPlayerProfileId(dota2Profile.id);
      if (!asset) {
        return res.status(404).json({ message: "No Dota2 asset found." });
      }

      // Guard: only allow submission from DRAFT or REJECTED state
      const allowedListingStatuses = ["DRAFT", "REJECTED"];
      if (!allowedListingStatuses.includes(asset.listingStatus ?? "")) {
        return res.status(409).json({
          message:       "Asset is not eligible for submission in its current state.",
          listingStatus: asset.listingStatus,
        });
      }

      // Guard: prevent duplicate open submissions (PENDING or UNDER_REVIEW)
      const existingSubmissions = await repo.listAssetListingSubmissionsByUser(userId);
      const hasOpenSubmission = existingSubmissions.some(
        s => s.assetId === asset.id &&
             (s.submissionStatus === "PENDING" || s.submissionStatus === "UNDER_REVIEW"),
      );
      if (hasOpenSubmission) {
        return res.status(409).json({
          message: "There is already an open submission for this asset. Withdraw it before re-submitting.",
        });
      }

      // Evaluate current readiness (frozen at submission time)
      // evaluateDota2ListingReadiness takes userId (string), not profileId
      const snapshot = await dota2ListingEligibilityService.evaluateDota2ListingReadiness(
        userId,
      );

      // Create the submission record
      const submission = await repo.insertAssetListingSubmission({
        assetId:               asset.id,
        playerProfileId:       dota2Profile.id,
        submittedByUserId:     userId,
        game:                  "dota2",
        submissionStatus:      "PENDING",
        readinessSnapshotJson: JSON.stringify(snapshot),
      } as any);

      // Transition asset → UNDER_REVIEW so it appears in the admin queue
      const updated = await repo.updateAssetStatus(asset.id, {
        listingStatus: "UNDER_REVIEW",
      });

      return res.status(201).json({
        message:          "Submission created.",
        submissionId:     submission.id,
        submissionStatus: submission.submissionStatus,
        listingStatus:    updated?.listingStatus,
        readinessSnapshot: snapshot,
      });
    } catch (err: any) {
      console.error("[Multigame] POST /api/me/dota2/submit-for-review:", err.message);
      return res.status(500).json({ message: "Submission failed." });
    }
  });

  /**
   * List all listing submissions made by the authenticated user.
   * Returns most recent first with the frozen readiness snapshot.
   */
  app.get("/api/me/dota2/submissions", isAuthenticated, async (req: any, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Not authenticated." });

    try {
      const submissions = await repo.listAssetListingSubmissionsByUser(userId);

      return res.json({
        submissions: submissions.map(s => ({
          id:               s.id,
          assetId:          s.assetId,
          playerProfileId:  s.playerProfileId,
          game:             s.game,
          submissionStatus: s.submissionStatus,
          readinessSnapshot: (() => {
            try { return JSON.parse(s.readinessSnapshotJson); }
            catch { return null; }
          })(),
          createdAt:        s.createdAt,
          updatedAt:        s.updatedAt,
        })),
        total: submissions.length,
      });
    } catch (err: any) {
      console.error("[Multigame] GET /api/me/dota2/submissions:", err.message);
      return res.status(500).json({ message: "Failed to list submissions." });
    }
  });

  // ── Fase 11: Submission Lifecycle — Withdraw ────────────────────────────────
  //
  //   POST /api/me/dota2/submissions/:id/withdraw

  /**
   * Withdraw an open listing submission.
   *
   * Only PENDING or UNDER_REVIEW submissions can be withdrawn.
   * After withdrawal the asset's listingStatus reverts to DRAFT so the user
   * can re-submit when ready.
   */
  app.post(
    "/api/me/dota2/submissions/:id/withdraw",
    isAuthenticated,
    async (req: any, res) => {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ message: "Not authenticated." });

      const submissionId = parseInt(req.params.id, 10);
      if (isNaN(submissionId)) return res.status(400).json({ message: "Invalid submission id." });

      try {
        // Find submission in user's list (ownership-scoped — user can only withdraw their own)
        const userSubmissions = await repo.listAssetListingSubmissionsByUser(userId);
        const target = userSubmissions.find(s => s.id === submissionId);

        if (!target) {
          return res.status(404).json({ message: "Submission not found." });
        }

        const withdrawableStatuses = ["PENDING", "UNDER_REVIEW"];
        if (!withdrawableStatuses.includes(target.submissionStatus ?? "")) {
          return res.status(409).json({
            message:          "Only PENDING or UNDER_REVIEW submissions can be withdrawn.",
            submissionStatus: target.submissionStatus,
          });
        }

        // Mark submission WITHDRAWN
        await repo.updateAssetListingSubmissionStatus(submissionId, "WITHDRAWN");

        // Revert asset to DRAFT so user can re-submit
        const updated = await repo.updateAssetStatus(target.assetId, {
          listingStatus: "DRAFT",
        });

        return res.json({
          message:          "Submission withdrawn.",
          submissionId,
          submissionStatus: "WITHDRAWN",
          listingStatus:    updated?.listingStatus,
        });
      } catch (err: any) {
        console.error("[Multigame] POST /api/me/dota2/submissions/:id/withdraw:", err.message);
        return res.status(500).json({ message: "Withdrawal failed." });
      }
    },
  );

  // ── Fase 11: Claim Flow (user-scoped) ──────────────────────────────────────
  //
  //   POST /api/me/dota2/claim-asset  — requires Steam VERIFIED account
  //   GET  /api/me/dota2/claims       — list user's claim requests

  /**
   * Submit a claim for the user's Dota2 asset.
   *
   * Requirements:
   *   - User must have a ConnectedAccount steam+dota2 with verificationStatus=VERIFIED
   *   - No open claim (PENDING or UNDER_REVIEW) for the same asset+user may exist
   *   - Evidence/reason are optional but stored for admin review
   */
  app.post("/api/me/dota2/claim-asset", isAuthenticated, async (req: any, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Not authenticated." });

    try {
      // Find the user's Dota2 ConnectedAccount — must be VERIFIED
      const accounts    = await repo.findConnectedAccountsByUser(userId);
      const steamAccount = accounts.find(
        (a: any) => a.providerGroup === "steam" && a.game === "dota2",
      );

      if (!steamAccount) {
        return res.status(404).json({ message: "No Dota2 Steam account found. Complete onboarding first." });
      }

      if (steamAccount.verificationStatus !== "VERIFIED") {
        return res.status(403).json({
          message:            "Steam account must be VERIFIED before claiming. Complete Steam OpenID verification first.",
          verificationStatus: steamAccount.verificationStatus,
        });
      }

      // Find the user's Dota2 player profile
      const profiles    = await repo.findPlayerProfilesByUser(userId);
      const dota2Profile: any = profiles.find((p: any) => p.game === "dota2") ?? null;

      // Fase 26: prefer the Fase 25 market asset (externalId=accountId32) since it is
      // the ACTIVE/LISTED asset users actually trade. The onboarding stub
      // (steam:dota2:player:{steamId64}) is a DRAFT record and should not be claimed.
      let asset: any = null;
      const steamId64 = (steamAccount as any).providerAccountId as string | null;
      if (steamId64) {
        try {
          const accountId32 = String(BigInt(steamId64) - BigInt("76561197960265728"));
          asset = await repo.findAssetByExternalId(accountId32);
        } catch {
          // non-numeric steamId64 — skip
        }
      }

      // Fallback to the asset linked via the PlayerProfile (traditional onboarding stub)
      if (!asset && dota2Profile) {
        asset = await repo.findAssetByPlayerProfileId(dota2Profile.id);
      }

      if (!asset) {
        return res.status(404).json({ message: "No Dota2 asset found for your Steam account." });
      }

      // Ensure we have a playerProfile (required by the claim schema)
      if (!dota2Profile) {
        return res.status(404).json({ message: "No Dota2 player profile found. Please reconnect your Steam account." });
      }

      // Guard: no duplicate open claims
      const openClaims = await repo.findOpenDota2ClaimsByAssetAndUser(asset.id, userId);
      if (openClaims.length > 0) {
        return res.status(409).json({
          message: "You already have an open claim for this asset.",
          claimId: openClaims[0].id,
          claimStatus: openClaims[0].claimStatus,
        });
      }

      // Optional body: reasonCode, evidenceJson
      const reasonCode  = typeof req.body?.reasonCode   === "string" ? req.body.reasonCode   : undefined;
      const evidenceRaw = req.body?.evidence !== undefined ? req.body.evidence : undefined;
      const evidenceJson = evidenceRaw !== undefined ? JSON.stringify(evidenceRaw) : undefined;

      // ── Fase 15: Hybrid model fields via centralised policy evaluator ────────
      //
      // claimOrigin = ASSISTED (user clicked Claim; asset auto-detected via connected account)
      // matchConfidence derived from onboarding link quality (HIGH when primary link matches).
      // approvalType + auto-approval decision come from evaluateClaimPolicy() in
      // claimPolicyEvaluator.ts — no inline policy logic here.
      //
      // Fase 26: when asset was found via accountId32 (no playerProfile link), treat as HIGH
      // since the steamId64 → accountId32 → externalId match is deterministic.
      const matchConfidence =
        !dota2Profile
          ? "HIGH"
          : dota2Profile.primaryConnectedAccountId === steamAccount.id
          ? "HIGH"
          : "MEDIUM";

      const activeOwnerLink = await repo.findActiveAssetOwnershipLink(asset.id);
      const hasActiveOwner  = !!activeOwnerLink;

      // Evaluate policy using the centralized evaluator (Fase 15)
      const policyResult = evaluateClaimPolicy({
        game:               "dota2",
        verificationStatus: (steamAccount as any).verificationStatus ?? null,
        providerGroup:      "steam",
        matchConfidence,
        hasActiveOwner,
        hasOpenClaim:       false, // guarded above — if there was an open claim we already returned 409
      });

      const autoApprovable = policyResult.canAutoApprove;
      const approvalType   = policyResult.approvalType;

      // Create the claim request
      const claim = await repo.insertDota2ClaimRequest({
        assetId:            asset.id,
        playerProfileId:    dota2Profile.id,
        connectedAccountId: steamAccount.id,
        requestedByUserId:  userId,
        game:               "dota2",
        claimStatus:        "PENDING",
        reasonCode:         reasonCode ?? null,
        evidenceJson:       evidenceJson ?? null,
        claimOrigin:        "ASSISTED",
        matchConfidence:    matchConfidence,
        approvalType:       approvalType,
      } as any);

      // ── Auto-approval execution ────────────────────────────────────────────
      if (autoApprovable) {
        try {
          const { claim: approved } = await repo.approveDota2ClaimTx(claim.id, "system:auto-policy");
          return res.status(201).json({
            message:      "Claim submitted and auto-approved by policy.",
            claimId:      approved.id,
            claimStatus:  approved.claimStatus,
            assetId:      approved.assetId,
            approvalType: "AUTO_POLICY",
            autoApproved: true,
          });
        } catch (autoErr: any) {
          // If auto-approve fails for any reason, fall through and return PENDING claim.
          // Admin will review normally. Do not surface the error to the user.
          console.warn("[Multigame] Auto-approval failed for claim", claim.id, autoErr.message);
        }
      }

      return res.status(201).json({
        message:      "Claim request submitted.",
        claimId:      claim.id,
        claimStatus:  claim.claimStatus,
        assetId:      claim.assetId,
        approvalType: approvalType,
        autoApproved: false,
      });
    } catch (err: any) {
      console.error("[Multigame] POST /api/me/dota2/claim-asset:", err.message);
      return res.status(500).json({ message: "Claim submission failed." });
    }
  });

  /**
   * List all claim requests submitted by the authenticated user.
   */
  app.get("/api/me/dota2/claims", isAuthenticated, async (req: any, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Not authenticated." });

    try {
      const claims = await repo.listDota2ClaimRequestsByUser(userId);
      return res.json({ claims, total: claims.length });
    } catch (err: any) {
      console.error("[Multigame] GET /api/me/dota2/claims:", err.message);
      return res.status(500).json({ message: "Failed to list claims." });
    }
  });

  // ── Fase 14: Cancel Claim (user-initiated) ───────────────────────────────────
  //
  //   POST /api/me/dota2/claims/:id/cancel

  /**
   * Cancel a Dota2 asset claim.
   *
   * The authenticated user may cancel their own PENDING or UNDER_REVIEW claim.
   * UNDER_REVIEW cancellation is allowed because the user may withdraw before admin acts;
   * the admin queue can safely ignore CANCELLED claims (policy: check status before acting).
   */
  app.post("/api/me/dota2/claims/:id/cancel", isAuthenticated, async (req: any, res) => {
    const userId  = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Not authenticated." });

    const claimId = parseInt(req.params.id, 10);
    if (isNaN(claimId)) return res.status(400).json({ message: "Invalid claim id." });

    try {
      const updated = await repo.cancelDota2ClaimRequest(claimId, userId);
      if (!updated) return res.status(404).json({ message: "Claim not found." });

      return res.json({
        message:     "Claim cancelled.",
        claimId:     updated.id,
        claimStatus: updated.claimStatus,
      });
    } catch (err: any) {
      if (err.message === "FORBIDDEN") {
        return res.status(403).json({ message: "You can only cancel your own claims." });
      }
      if (err.message?.startsWith("NOT_CANCELLABLE:")) {
        const status = err.message.split(":")[1];
        return res.status(409).json({ message: `Claim in status '${status}' cannot be cancelled.`, claimStatus: status });
      }
      console.error("[Multigame] POST /api/me/dota2/claims/:id/cancel:", err.message);
      return res.status(500).json({ message: "Cancel failed." });
    }
  });

  // ── Fase 14: Asset Surface — Claimable + Summary ────────────────────────────
  //
  //   GET /api/me/assets/claimable — candidate discovery for Dota2/Steam
  //   GET /api/me/assets/summary  — consolidated read model (accounts+owned+claims+submissions)

  /**
   * Discover claimable assets for the authenticated user.
   *
   * Fase 15: Delegates to the ClaimDiscovery aggregator (claimDiscovery.ts).
   * All game-specific logic lives in the adapter functions; the endpoint is now
   * a thin shell that calls getClaimableAssets(userId) and returns the merged results.
   *
   * Supported games (adapters registered in claimDiscovery.ts):
   *   ✓ dota2 — Steam / STEAM_OPENID   (active)
   *   ○ cs2   — Steam / STEAM_OPENID   (stub, future fase)
   *   ○ lol   — Riot  / RIOT_OAUTH     (stub, future fase)
   *
   * Each candidate includes the full signal set:
   *   providerGroup, verificationMethod, matchSource, matchConfidence,
   *   policyDecision, policyReasons, approvalType, canAutoApprove, canClaim,
   *   alreadyOwned, hasActiveOwner, hasOpenClaim
   */
  app.get("/api/me/assets/claimable", isAuthenticated, async (req: any, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Not authenticated." });

    try {
      const candidates = await getClaimableAssets(userId);
      return res.json({ candidates, total: candidates.length });
    } catch (err: any) {
      console.error("[Multigame] GET /api/me/assets/claimable:", err.message);
      return res.status(500).json({ message: "Failed to discover claimable assets." });
    }
  });

  /**
   * Consolidated read model for the user's asset surface.
   *
   * Returns:
   *   connectedAccounts — all connected accounts for the user
   *   ownedAssets       — ACTIVE ownership links enriched with fundamentals
   *   claims            — all claims with asset display info
   *   submissions       — all submissions with asset info + listing decision
   */
  app.get("/api/me/assets/summary", isAuthenticated, async (req: any, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Not authenticated." });

    try {
      // Connected accounts
      const connectedAccounts = await repo.findConnectedAccountsByUser(userId);

      // Owned assets — ACTIVE links + fundamentals
      const allOwnershipLinks = await repo.listAssetOwnershipLinksByUser(userId);
      const activeLinks       = allOwnershipLinks.filter((l: any) => l.status === "ACTIVE");
      const ownedAssets       = await Promise.all(
        activeLinks.map(async (link: any) => {
          const fundamentals = await repo.findDota2AssetFundamentals(link.assetId);
          const asset        = await repo.findTerminalAssetById(link.assetId);
          return {
            assetId:        link.assetId,
            game:           asset ? (asset as any).game : null,
            symbol:         fundamentals?.symbol   ?? (asset as any)?.symbol   ?? null,
            displayName:    fundamentals?.displayName ?? (asset as any)?.displayName ?? null,
            tradingStatus:  fundamentals?.tradingStatus ?? null,
            listingStatus:  fundamentals?.listingStatus ?? null,
            playerValue:    fundamentals?.playerValue ?? null,
            confidenceScore: fundamentals?.confidenceScore ?? null,
            isTradable:     fundamentals?.tradingStatus === "ACTIVE",
            ownershipLinkId: link.id,
            ownershipType:  link.ownershipType,
            ownedSince:     link.createdAt,
          };
        }),
      );

      // Claims — enriched with asset display info
      const rawClaims = await repo.listDota2ClaimRequestsByUser(userId);
      const claims    = await Promise.all(
        rawClaims.map(async (claim: any) => {
          const asset = await repo.findTerminalAssetById(claim.assetId);
          return {
            id:               claim.id,
            assetId:          claim.assetId,
            game:             claim.game,
            symbol:           (asset as any)?.symbol      ?? null,
            displayName:      (asset as any)?.displayName ?? null,
            claimStatus:      claim.claimStatus,
            claimOrigin:      claim.claimOrigin      ?? null,
            approvalType:     claim.approvalType     ?? null,
            matchConfidence:  claim.matchConfidence  ?? null,
            reasonCode:       claim.reasonCode       ?? null,
            reviewNotes:      claim.reviewNotes      ?? null,
            createdAt:        claim.createdAt,
            updatedAt:        claim.updatedAt,
            canCancel: ["PENDING", "UNDER_REVIEW"].includes(claim.claimStatus as string),
          };
        }),
      );

      // Submissions — enriched with asset info + latest review decision
      const rawSubmissions = await repo.listAssetListingSubmissionsByUser(userId);
      const submissions    = await Promise.all(
        rawSubmissions.map(async (sub: any) => {
          const asset = await repo.findTerminalAssetById(sub.assetId);
          return {
            id:               sub.id,
            assetId:          sub.assetId,
            game:             sub.game,
            symbol:           (asset as any)?.symbol      ?? null,
            displayName:      (asset as any)?.displayName ?? null,
            submissionStatus: sub.submissionStatus,
            listingStatus:    (asset as any)?.listingStatus ?? null,
            readinessSnapshot: (() => { try { return JSON.parse(sub.readinessSnapshotJson); } catch { return null; } })(),
            createdAt:        sub.createdAt,
            updatedAt:        sub.updatedAt,
          };
        }),
      );

      return res.json({
        connectedAccounts,
        ownedAssets,
        claims,
        submissions,
        totals: {
          connectedAccounts: connectedAccounts.length,
          ownedAssets:       ownedAssets.length,
          claims:            claims.length,
          submissions:       submissions.length,
        },
      });
    } catch (err: any) {
      console.error("[Multigame] GET /api/me/assets/summary:", err.message);
      return res.status(500).json({ message: "Failed to build asset summary." });
    }
  });

  // ── Fase 11: Admin Claim Review ─────────────────────────────────────────────
  //
  //   GET  /api/admin/dota2/claim-requests             — list claim requests
  //   POST /api/admin/dota2/claim-requests/:id/approve — approve + create link
  //   POST /api/admin/dota2/claim-requests/:id/reject  — reject with notes

  /**
   * Admin: list Dota2 asset claim requests.
   * Optional query param: ?status=PENDING|UNDER_REVIEW|APPROVED|REJECTED|CANCELLED
   */
  app.get("/api/admin/dota2/claim-requests", isAuthenticated, async (req: any, res) => {
    const user = req.user as any;
    if (!isAdminUser(req)) return res.status(403).json({ message: "Admin access required." });
    try {
      const statusFilter = typeof req.query.status === "string" ? req.query.status : undefined;
      const claims = await repo.listDota2ClaimRequestsAdmin(statusFilter);

      // Enrich with active ownership link per asset
      const enriched = await Promise.all(
        claims.map(async (c) => ({
          ...c,
          existingOwnershipLink: await repo.findActiveAssetOwnershipLink(c.assetId),
        })),
      );

      return res.json({ claims: enriched, total: enriched.length });
    } catch (err: any) {
      console.error("[Multigame] GET /api/admin/dota2/claim-requests:", err.message);
      return res.status(500).json({ message: "Failed to list claim requests." });
    }
  });

  /**
   * Admin: approve a Dota2 asset claim.
   *
   * On approval:
   *   1. Any existing ACTIVE ownership link for the asset is REVOKED
   *   2. A new ACTIVE ownership link is created
   *   3. Claim status → APPROVED
   */
  app.post(
    "/api/admin/dota2/claim-requests/:id/approve",
    isAuthenticated,
    async (req: any, res) => {
      const user    = req.user as any;
      if (!isAdminUser(req)) return res.status(403).json({ message: "Admin access required." });
      const claimId = parseInt(req.params.id, 10);
      if (isNaN(claimId)) return res.status(400).json({ message: "Invalid claim id." });

      try {
        // All four steps (load+validate, revoke old link, create new link, update
        // claim) run inside a single DB transaction via approveDota2ClaimTx.
        // If any step fails the whole tx rolls back, preserving consistency.
        const reviewedBy = String(user?.id ?? user?.username ?? "admin");
        const { claim: updatedClaim, ownershipLink } = await repo.approveDota2ClaimTx(
          claimId,
          reviewedBy,
          req.body?.reviewNotes ?? undefined,
        );

        return res.json({
          message:         "Claim approved.",
          claimId,
          claimStatus:     "APPROVED",
          ownershipLinkId: ownershipLink.id,
          reviewedBy:      updatedClaim.reviewedBy,
        });
      } catch (err: any) {
        if (err.message?.startsWith("CLAIM_NOT_FOUND")) {
          return res.status(404).json({ message: "Claim not found." });
        }
        if (err.message?.startsWith("CLAIM_NOT_APPROVABLE")) {
          const status = err.message.split(":")[1];
          return res.status(409).json({
            message:     "Claim cannot be approved in its current state.",
            claimStatus: status,
          });
        }
        console.error("[Multigame] POST /api/admin/dota2/claim-requests/:id/approve:", err.message);
        return res.status(500).json({ message: "Claim approval failed." });
      }
    },
  );

  /**
   * Admin: reject a Dota2 asset claim.
   *
   * Optionally accepts { reviewNotes } in the request body.
   * Claim status → REJECTED; no ownership link is created.
   */
  app.post(
    "/api/admin/dota2/claim-requests/:id/reject",
    isAuthenticated,
    async (req: any, res) => {
      const user    = req.user as any;
      if (!isAdminUser(req)) return res.status(403).json({ message: "Admin access required." });
      const claimId = parseInt(req.params.id, 10);
      if (isNaN(claimId)) return res.status(400).json({ message: "Invalid claim id." });

      try {
        const claim = await repo.findDota2ClaimRequest(claimId);
        if (!claim) return res.status(404).json({ message: "Claim not found." });

        const rejectableStatuses = ["PENDING", "UNDER_REVIEW"];
        if (!rejectableStatuses.includes(claim.claimStatus)) {
          return res.status(409).json({
            message:     "Claim cannot be rejected in its current state.",
            claimStatus: claim.claimStatus,
          });
        }

        const updatedClaim = await repo.updateDota2ClaimRequest(claimId, {
          claimStatus: "REJECTED",
          reviewedBy:  String(user?.id ?? user?.username ?? "admin"),
          reviewedAt:  new Date(),
          reviewNotes: req.body?.reviewNotes ?? undefined,
        });

        return res.json({
          message:     "Claim rejected.",
          claimId,
          claimStatus: "REJECTED",
          reviewedBy:  updatedClaim?.reviewedBy,
          reviewNotes: updatedClaim?.reviewNotes,
        });
      } catch (err: any) {
        console.error("[Multigame] POST /api/admin/dota2/claim-requests/:id/reject:", err.message);
        return res.status(500).json({ message: "Claim rejection failed." });
      }
    },
  );

  // ── GET /api/admin/dota2/claims ───────────────────────────────────────────
  // Fase 13: Enriched admin claims list with hybrid-model signal fields.
  // Filters: status, approvalType, matchConfidence (DB-level)
  //          verificationStatus, hasActiveOwner (post-fetch)
  app.get("/api/admin/dota2/claims", isAuthenticated, async (req: any, res) => {
    const user = req.user as any;
    if (!isAdminUser(req)) return res.status(403).json({ message: "Admin access required." });

    try {
      const { status, approvalType, matchConfidence, verificationStatus, hasActiveOwner } = req.query as Record<string, string | undefined>;

      let claims = await repo.listDota2ClaimRequestsAdminFiltered({
        claimStatus:     status,
        approvalType,
        matchConfidence,
      });

      // Post-fetch enrichment: ownership link + connected account verification status
      let enriched = await Promise.all(claims.map(async (c) => {
        const ownershipLink    = await repo.findActiveAssetOwnershipLink(c.assetId);
        const connectedAccount = await repo.findConnectedAccountById(c.connectedAccountId);
        return {
          ...c,
          existingOwnershipLink:  ownershipLink,
          verificationStatusCode: connectedAccount?.verificationStatus ?? null,
        };
      }));

      // Post-fetch filters
      if (verificationStatus) {
        enriched = enriched.filter(e => e.verificationStatusCode === verificationStatus);
      }
      if (hasActiveOwner === "true")  enriched = enriched.filter(e => !!e.existingOwnershipLink);
      if (hasActiveOwner === "false") enriched = enriched.filter(e => !e.existingOwnershipLink);

      return res.json({ claims: enriched, total: enriched.length });
    } catch (err: any) {
      console.error("[Multigame] GET /api/admin/dota2/claims:", err.message);
      return res.status(500).json({ message: "Failed to list claims." });
    }
  });

  // ── GET /api/admin/dota2/claims/:id ──────────────────────────────────────
  // Fase 13: Single claim detail with enriched context.
  app.get("/api/admin/dota2/claims/:id", isAuthenticated, async (req: any, res) => {
    const user = req.user as any;
    if (!isAdminUser(req)) return res.status(403).json({ message: "Admin access required." });

    const claimId = parseInt(req.params.id, 10);
    if (isNaN(claimId)) return res.status(400).json({ message: "Invalid claim id." });

    try {
      const claim = await repo.findDota2ClaimRequest(claimId);
      if (!claim) return res.status(404).json({ message: "Claim not found." });

      const [ownershipLink, connectedAccount] = await Promise.all([
        repo.findActiveAssetOwnershipLink(claim.assetId),
        repo.findConnectedAccountById(claim.connectedAccountId),
      ]);

      return res.json({
        claim: {
          ...claim,
          existingOwnershipLink:  ownershipLink,
          verificationStatusCode: connectedAccount?.verificationStatus ?? null,
          connectedAccount:       connectedAccount,
        },
      });
    } catch (err: any) {
      console.error("[Multigame] GET /api/admin/dota2/claims/:id:", err.message);
      return res.status(500).json({ message: "Failed to fetch claim." });
    }
  });

  // ════════════════════════════════════════════════════════════════════════════
  //  Fase 18 — Multi-Game Admin Ops & Observability
  // ════════════════════════════════════════════════════════════════════════════

  // ── GET /api/admin/multigame/ops-summary ──────────────────────────────────
  // Aggregated metrics across all games: accounts, claims, assets, ownership,
  // verification events. Powers the new "Ops Summary" admin dashboard.
  app.get("/api/admin/multigame/ops-summary", isAuthenticated, async (req: any, res) => {
    const user = req.user as any;
    if (!isAdminUser(req)) return res.status(403).json({ message: "Admin access required." });
    try {
      const summary = await repo.getMultigameOpsSummary();
      return res.json(summary);
    } catch (err: any) {
      console.error("[Multigame] GET /api/admin/multigame/ops-summary:", err.message);
      return res.status(500).json({ message: "Failed to fetch ops summary." });
    }
  });

  // ── GET /api/admin/multigame/troubleshooting ──────────────────────────────
  // Surfaces operational problems: recent verification failures, ownership
  // conflicts (open claim + active owner), stuck pending claims, review queue.
  app.get("/api/admin/multigame/troubleshooting", isAuthenticated, async (req: any, res) => {
    const user = req.user as any;
    if (!isAdminUser(req)) return res.status(403).json({ message: "Admin access required." });
    try {
      const data = await repo.getMultigameTroubleshootingData();
      return res.json(data);
    } catch (err: any) {
      console.error("[Multigame] GET /api/admin/multigame/troubleshooting:", err.message);
      return res.status(500).json({ message: "Failed to fetch troubleshooting data." });
    }
  });

  // ── GET /api/admin/multigame/claims ───────────────────────────────────────
  // Multi-game claims list with full filter support.
  // Query params: game, claimStatus, approvalType, matchConfidence, limit, offset.
  // Replaces the dota2-only endpoint for the admin multi-game UI.
  app.get("/api/admin/multigame/claims", isAuthenticated, async (req: any, res) => {
    const user = req.user as any;
    if (!isAdminUser(req)) return res.status(403).json({ message: "Admin access required." });
    try {
      const game            = typeof req.query.game            === "string" ? req.query.game            : undefined;
      const claimStatus     = typeof req.query.claimStatus     === "string" ? req.query.claimStatus     : undefined;
      const approvalType    = typeof req.query.approvalType    === "string" ? req.query.approvalType    : undefined;
      const matchConfidence = typeof req.query.matchConfidence === "string" ? req.query.matchConfidence : undefined;
      const limit           = parseInt(req.query.limit  as string, 10) || 50;
      const offset          = parseInt(req.query.offset as string, 10) || 0;

      const { claims, total } = await repo.listMultigameClaimsAdmin({
        game, claimStatus, approvalType, matchConfidence, limit, offset,
      });

      // Enrich with active ownership link per asset
      const enriched = await Promise.all(
        claims.map(async (c) => ({
          ...c,
          existingOwnershipLink: await repo.findActiveAssetOwnershipLink(c.assetId),
        })),
      );

      return res.json({ claims: enriched, total, limit, offset });
    } catch (err: any) {
      console.error("[Multigame] GET /api/admin/multigame/claims:", err.message);
      return res.status(500).json({ message: "Failed to list multi-game claims." });
    }
  });

  // ── GET /api/admin/dota2/assets/:id/admin-context ────────────────────────
  // Fase 13: Consolidated 6-section read model for admin asset panel.
  // Sections: asset, ownership, verification, valuation, listingReadiness, claimPolicy.
  app.get("/api/admin/dota2/assets/:id/admin-context", isAuthenticated, async (req: any, res) => {
    const user = req.user as any;
    if (!isAdminUser(req)) return res.status(403).json({ message: "Admin access required." });

    const assetId = parseInt(req.params.id, 10);
    if (isNaN(assetId)) return res.status(400).json({ message: "Invalid asset id." });

    try {
      // ── 1. Asset fundamentals ─────────────────────────────────────────────
      const fundamentals = await repo.findDota2AssetFundamentals(assetId);
      if (!fundamentals) return res.status(404).json({ message: "Asset not found." });

      const isTradable = fundamentals.tradingStatus === "ACTIVE" && fundamentals.listingStatus === "LISTED";

      // ── 2. Ownership ──────────────────────────────────────────────────────
      const ownershipLink = await repo.findActiveAssetOwnershipLink(assetId);

      // ── 3. Verification — via playerProfile → connectedAccount chain ─────
      let verificationSection: Record<string, any> = { hasVerification: false };
      if (fundamentals.playerProfileId) {
        const profile = await repo.findPlayerProfileById(fundamentals.playerProfileId);
        if (profile?.primaryConnectedAccountId) {
          const connectedAccount = await repo.findConnectedAccountById(profile.primaryConnectedAccountId);
          if (connectedAccount) {
            const verificationEvents = await repo.listAccountVerificationEvents(connectedAccount.id);
            verificationSection = {
              hasVerification:        true,
              connectedAccountId:     connectedAccount.id,
              providerGroup:          connectedAccount.providerGroup,
              verificationStatus:     connectedAccount.verificationStatus,
              providerAccountId:      connectedAccount.providerAccountId,
              providerAccountName:    connectedAccount.providerAccountName,
              latestVerificationEvent: verificationEvents[0] ?? null,
            };
          }
        }
      }

      // ── 4. Valuation ──────────────────────────────────────────────────────
      const valuationSection = {
        playerValue:          fundamentals.playerValue,
        confidenceScore:      fundamentals.confidenceScore,
        lastPerformanceScore: fundamentals.lastPerformanceScore,
        matchesCount:         fundamentals.matchesCount,
        sampleConfidence:     fundamentals.sampleConfidence,
        rankStability:        fundamentals.rankStability,
        dataCompleteness:     fundamentals.dataCompleteness,
        updatedAt:            fundamentals.valuationUpdatedAt,
      };

      // ── 5. Listing Readiness (best-effort via eligibility service) ────────
      let listingReadinessSection: Record<string, any> = { available: false, reason: "NO_OWNER_LINK" };
      const ownerUserId = ownershipLink?.userId ?? null;
      if (ownerUserId) {
        try {
          const { evaluateDota2ListingReadiness } = await import("./dota2ListingEligibilityService.js");
          const snap = await evaluateDota2ListingReadiness(ownerUserId);
          listingReadinessSection = {
            available:     true,
            isReady:       snap.isReady,
            failingChecks: snap.failingChecks,
            checks:        snap.checks,
            evaluatedAt:   snap.evaluatedAt,
          };
        } catch {
          listingReadinessSection = { available: false, reason: "EVALUATION_FAILED" };
        }
      }

      // ── 6. Claim / Submission / Policy ────────────────────────────────────
      const [latestClaim, latestSubmission, latestReview] = await Promise.all([
        repo.findLatestDota2ClaimByAsset(assetId),
        repo.findLatestAssetListingSubmission(assetId),
        repo.findLatestAssetListingReview(assetId),
      ]);

      // Compute policyDecision
      const vs   = (verificationSection.verificationStatus as string) ?? null;
      const mc   = latestClaim?.matchConfidence ?? null;
      const at   = latestClaim?.approvalType ?? null;
      const hasOwner = !!ownershipLink;

      let policyDecision: string;
      if (vs !== "VERIFIED") {
        policyDecision = "BLOCKED";
      } else if (mc === "HIGH" && !hasOwner && at !== "REQUIRES_REVIEW") {
        policyDecision = "AUTO_APPROVABLE";
      } else {
        policyDecision = "REQUIRES_REVIEW";
      }

      const claimPolicySection = {
        latestClaim,
        claimOrigin:     latestClaim?.claimOrigin ?? null,
        approvalType:    latestClaim?.approvalType ?? null,
        matchConfidence: latestClaim?.matchConfidence ?? null,
        policyDecision,
        latestSubmission,
        latestReview,
      };

      return res.json({
        assetId,
        asset: {
          assetId:      fundamentals.assetId,
          assetUid:     fundamentals.assetUid,
          symbol:       fundamentals.symbol,
          displayName:  fundamentals.displayName,
          game:         fundamentals.game,
          tradingStatus: fundamentals.tradingStatus,
          listingStatus: fundamentals.listingStatus,
          isTradable,
        },
        ownership: ownershipLink ? {
          hasActiveOwner: true,
          ownerUserId:    ownershipLink.userId,
          ownershipType:  ownershipLink.ownershipType,
          sourceType:     ownershipLink.sourceType,
          sourceId:       ownershipLink.sourceId,
          createdAt:      ownershipLink.createdAt,
        } : { hasActiveOwner: false },
        verification: verificationSection,
        valuation:    valuationSection,
        listingReadiness: listingReadinessSection,
        claimPolicy:  claimPolicySection,
      });
    } catch (err: any) {
      console.error("[Multigame] GET /api/admin/dota2/assets/:id/admin-context:", err.message);
      return res.status(500).json({ message: "Failed to build admin context." });
    }
  });

  // ── GET /api/admin/dota2/bootstrap-status ────────────────────────────────────
  // Returns current state of the Dota2 market (how many assets exist, etc.)
  app.get("/api/admin/dota2/bootstrap-status", isAuthenticated, async (req: any, res) => {
    if (!req.session?.isAdmin) {
      return res.status(403).json({ message: "Admin access required." });
    }
    try {
      const status = await dota2MarketBootstrapService.getBootstrapStatus();
      return res.json(status);
    } catch (err: any) {
      console.error("[Multigame] GET /api/admin/dota2/bootstrap-status:", err.message);
      return res.status(500).json({ message: "Failed to fetch bootstrap status." });
    }
  });

  // ── POST /api/admin/dota2/bootstrap-market ───────────────────────────────────
  // Seeds the Dota2 market with players from the OpenDota proPlayers endpoint.
  // Safe to call multiple times — existing assets are skipped (idempotent).
  //
  // Body (all optional):
  //   limit: number        — max players to seed (default 100)
  //   activeOnly: boolean  — only seed players with an active team (default false)
  //   basePrice: string    — initial price for all assets (default "15.00")
  //   force: boolean       — skip the safety guard threshold (default false)
  app.post("/api/admin/dota2/bootstrap-market", isAuthenticated, async (req: any, res) => {
    if (!req.session?.isAdmin) {
      return res.status(403).json({ message: "Admin access required." });
    }

    const bodySchema = z.object({
      limit:      z.number().int().min(1).max(2000).optional(),
      activeOnly: z.boolean().optional(),
      basePrice:  z.string().optional(),
      force:      z.boolean().optional(),
    });

    const parsed = bodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid body", errors: parsed.error.flatten() });
    }

    const { limit, activeOnly, basePrice, force } = parsed.data;

    try {
      const result = await dota2MarketBootstrapService.bootstrapDota2Market({
        limit,
        activeOnly,
        basePrice,
        skipIfExistingAbove: force ? 999_999 : 10,
      });
      return res.json(result);
    } catch (err: any) {
      console.error("[Multigame] POST /api/admin/dota2/bootstrap-market:", err.message);
      return res.status(500).json({ message: "Bootstrap failed.", error: err.message });
    }
  });

  // ── POST /api/admin/dota2/enrich-valuations ──────────────────────────────────
  // Fetches per-player MMR from OpenDota and applies the existing InitialValue
  // formula to update fundamentalPrice (and lastTradePrice if no real trades).
  //
  // Body (all optional):
  //   limit:  number  — max assets to process per call (default 50, max 500)
  //   offset: number  — skip first N assets for paginated runs (default 0)
  //   dryRun: boolean — compute but do not write to DB (default false)
  app.post("/api/admin/dota2/enrich-valuations", isAuthenticated, async (req: any, res) => {
    if (!req.session?.isAdmin) {
      return res.status(403).json({ message: "Admin access required." });
    }

    const bodySchema = z.object({
      limit:  z.number().int().min(1).max(500).optional(),
      offset: z.number().int().min(0).optional(),
      dryRun: z.boolean().optional(),
    });

    const parsed = bodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid body", errors: parsed.error.flatten() });
    }

    try {
      const result = await dota2MarketBootstrapService.enrichDota2Valuations(parsed.data);
      return res.json(result);
    } catch (err: any) {
      console.error("[Multigame] POST /api/admin/dota2/enrich-valuations:", err.message);
      return res.status(500).json({ message: "Enrichment failed.", error: err.message });
    }
  });

  // ── POST /api/admin/dota2/enrich-real ────────────────────────────────────────
  // Full-pipeline enrichment with REAL data:
  //   1. GET /wl          → eligibility check + real win rate + game count
  //   2. GET /players/{id} → real MMR
  //   3. GET /recentMatches → real momentum (recent form vs overall form)
  //
  // Ineligible players (no WL data or games < minGames) are PAUSED/UNDER_REVIEW.
  //
  // Body (all optional):
  //   limit:    number  — assets to process per call (default 50, max 500)
  //   offset:   number  — skip first N for pagination (default 0)
  //   dryRun:   boolean — compute but don't write (default false)
  //   minGames: number  — minimum public matches for eligibility (default 20)
  app.post("/api/admin/dota2/enrich-real", isAuthenticated, async (req: any, res) => {
    if (!req.session?.isAdmin) {
      return res.status(403).json({ message: "Admin access required." });
    }

    const bodySchema = z.object({
      limit:    z.number().int().min(1).max(500).optional(),
      offset:   z.number().int().min(0).optional(),
      dryRun:   z.boolean().optional(),
      minGames: z.number().int().min(1).max(500).optional(),
    });

    const parsed = bodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid body", errors: parsed.error.flatten() });
    }

    try {
      const result = await dota2MarketBootstrapService.enrichDota2WithRealData(parsed.data);
      return res.json(result);
    } catch (err: any) {
      console.error("[Multigame] POST /api/admin/dota2/enrich-real:", err.message);
      return res.status(500).json({ message: "Real enrichment failed.", error: err.message });
    }
  });

  // ── POST /api/admin/dota2/refill-market ──────────────────────────────────────
  // Finds eligible players from OpenDota proPlayers not yet in the DB,
  // checks WL eligibility, and seeds them until `target` ACTIVE assets is reached.
  //
  // Body (all optional):
  //   target:   number  — desired total ACTIVE+LISTED assets (default 500)
  //   minGames: number  — minimum public matches for eligibility (default 20)
  //   limit:    number  — max new candidates to check per call (default 50)
  //   dryRun:   boolean — compute but don't write (default false)
  app.post("/api/admin/dota2/refill-market", isAuthenticated, async (req: any, res) => {
    if (!req.session?.isAdmin) {
      return res.status(403).json({ message: "Admin access required." });
    }

    const bodySchema = z.object({
      target:   z.number().int().min(1).max(1000).optional(),
      minGames: z.number().int().min(1).max(500).optional(),
      limit:    z.number().int().min(1).max(200).optional(),
      dryRun:   z.boolean().optional(),
    });

    const parsed = bodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid body", errors: parsed.error.flatten() });
    }

    try {
      const result = await dota2MarketBootstrapService.refillDota2Market(parsed.data);
      return res.json(result);
    } catch (err: any) {
      console.error("[Multigame] POST /api/admin/dota2/refill-market:", err.message);
      return res.status(500).json({ message: "Refill failed.", error: err.message });
    }
  });
}

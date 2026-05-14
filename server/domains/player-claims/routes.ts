// ─── Player Claim System — Routes ─────────────────────────────────────────────
// Endpoints:
//   POST   /api/player-claims            — user submits a claim
//   GET    /api/player-claims/me         — user views their claims
//   GET    /api/player-claims/me/profile — user views their public profile
//   PATCH  /api/player-claims/:id/profile — user updates their public profile
//
//   GET    /api/admin/player-claims               — admin: list all claims
//   PATCH  /api/admin/player-claims/:id/approve   — admin: approve
//   PATCH  /api/admin/player-claims/:id/reject    — admin: reject
//   PATCH  /api/admin/player-claims/:id/revoke    — admin: revoke
//
// Market data, pricing, valuation are NOT accessible from this domain.
// ─────────────────────────────────────────────────────────────────────────────
import type { Express, RequestHandler } from "express";
import { playerClaimsService } from "./service";
import { playerClaimsRepository } from "./repository";
import { db } from "../../db";
import { assets } from "@shared/schema";
import { eq, ilike, or } from "drizzle-orm";

const isAuthenticated: RequestHandler = (req: any, res, next) => {
  if (req.session?.isAdmin || req.session?.userId) return next();
  if (typeof req.isAuthenticated === "function" && req.isAuthenticated()) return next();
  return res.status(401).json({ message: "Unauthorized" });
};

const isAdminOnly: RequestHandler = (req: any, res, next) => {
  if (req.session?.isAdmin || req.session?.userRole === "admin") return next();
  return res.status(403).json({ message: "Forbidden" });
};

export function registerPlayerClaimsRoutes(app: Express): void {

  // ── User: Submit a claim ──────────────────────────────────────────────────
  app.post("/api/player-claims", isAuthenticated, async (req: any, res) => {
    const userId = req.session.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const { assetId, assetUid, puuid, evidenceNote, verificationMethod } = req.body;
    if (!assetId || !assetUid) {
      return res.status(400).json({ message: "assetId and assetUid are required" });
    }

    // Verify asset exists
    const [assetRow] = await db.select({ id: assets.id }).from(assets).where(eq(assets.id, Number(assetId))).limit(1);
    if (!assetRow) {
      return res.status(404).json({ message: "Player asset not found" });
    }

    const result = await playerClaimsService.requestClaim({
      userId,
      assetId: Number(assetId),
      assetUid,
      puuid,
      evidenceNote,
      verificationMethod,
    });

    if (!result.success) {
      return res.status(409).json({ message: result.error });
    }

    return res.status(201).json({ success: true, claimId: result.claimId });
  });

  // ── User: View own claims ─────────────────────────────────────────────────
  app.get("/api/player-claims/me", isAuthenticated, async (req: any, res) => {
    const userId = req.session.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const claims = await playerClaimsRepository.findClaimsByUser(userId);
    return res.json({ claims });
  });

  // ── User: View own public profile ─────────────────────────────────────────
  app.get("/api/player-claims/me/profile", isAuthenticated, async (req: any, res) => {
    const userId = req.session.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const profile = await playerClaimsRepository.findProfileByUser(userId);
    if (!profile) return res.status(404).json({ message: "No approved profile found" });

    return res.json({
      profile: {
        ...profile,
        socialLinks: (() => { try { return JSON.parse(profile.socialLinksJson); } catch { return []; } })(),
      },
    });
  });

  // ── User: Update public profile ───────────────────────────────────────────
  app.patch("/api/player-claims/:id/profile", isAuthenticated, async (req: any, res) => {
    const userId = req.session.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const claimId = Number(req.params.id);
    if (isNaN(claimId)) return res.status(400).json({ message: "Invalid claim ID" });

    const { bio, profileImageUrl, bannerUrl, headline, socialLinks, teamAffiliation, isVisible } = req.body;

    const result = await playerClaimsService.updateProfile({
      claimId,
      userId,
      bio,
      profileImageUrl,
      bannerUrl,
      headline,
      socialLinks,
      teamAffiliation,
      isVisible,
    });

    if (!result.success) {
      return res.status(403).json({ message: result.error });
    }

    return res.json({ success: true });
  });

  // ── Admin: List all claims ────────────────────────────────────────────────
  app.get("/api/admin/player-claims", isAdminOnly, async (req: any, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const claims = await playerClaimsRepository.listAllClaims(status);
    return res.json({ claims, total: claims.length });
  });

  // ── Admin: Approve a claim ────────────────────────────────────────────────
  app.patch("/api/admin/player-claims/:id/approve", isAdminOnly, async (req: any, res) => {
    const adminUserId = req.session.userId || req.session.adminUsername || "admin";
    const claimId = Number(req.params.id);
    if (isNaN(claimId)) return res.status(400).json({ message: "Invalid claim ID" });

    const result = await playerClaimsService.reviewClaim({
      claimId,
      reviewedByUserId: adminUserId,
      status: "approved",
    });

    if (!result.success) {
      return res.status(409).json({ message: result.error });
    }
    return res.json({ success: true, claimId });
  });

  // ── Admin: Reject a claim ─────────────────────────────────────────────────
  app.patch("/api/admin/player-claims/:id/reject", isAdminOnly, async (req: any, res) => {
    const adminUserId = req.session.userId || req.session.adminUsername || "admin";
    const claimId = Number(req.params.id);
    if (isNaN(claimId)) return res.status(400).json({ message: "Invalid claim ID" });

    const { rejectionReason } = req.body;
    const result = await playerClaimsService.reviewClaim({
      claimId,
      reviewedByUserId: adminUserId,
      status: "rejected",
      rejectionReason,
    });

    if (!result.success) {
      return res.status(409).json({ message: result.error });
    }
    return res.json({ success: true, claimId });
  });

  // ── Admin: Revoke an approved claim ──────────────────────────────────────
  app.patch("/api/admin/player-claims/:id/revoke", isAdminOnly, async (req: any, res) => {
    const adminUserId = req.session.userId || req.session.adminUsername || "admin";
    const claimId = Number(req.params.id);
    if (isNaN(claimId)) return res.status(400).json({ message: "Invalid claim ID" });

    const result = await playerClaimsService.revokeClaim({
      claimId,
      revokedByUserId: adminUserId,
    });

    if (!result.success) {
      return res.status(409).json({ message: result.error });
    }
    return res.json({ success: true, claimId });
  });

  // ── Public: Search player assets for claim form ──────────────────────────
  // Returns canonical assets matching a display name search.
  // Used by the claim dialog to find the correct asset to claim.
  app.get("/api/player-claims/search-players", isAuthenticated, async (req: any, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (q.length < 2) return res.json({ results: [] });

    try {
      const results = await db
        .select({
          id: assets.id,
          assetUid: assets.assetUid,
          displayName: assets.displayName,
          symbol: assets.symbol,
          entityType: assets.entityType,
          lastTradePrice: assets.lastTradePrice,
        })
        .from(assets)
        .where(
          or(
            ilike(assets.displayName, `%${q}%`),
            ilike(assets.symbol, `%${q}%`),
          )
        )
        .limit(10);

      return res.json({ results });
    } catch (err: any) {
      console.error("[PlayerClaims/search] Error:", err.message);
      return res.status(500).json({ message: "Search failed" });
    }
  });

  // ── Public: View profile by asset ID ────────────────────────────────────
  app.get("/api/player-claims/profile/:assetId", async (req: any, res) => {
    const assetId = Number(req.params.assetId);
    if (isNaN(assetId)) return res.status(400).json({ message: "Invalid asset ID" });

    const profile = await playerClaimsRepository.findProfileByAsset(assetId);
    if (!profile || !profile.isVisible) {
      return res.status(404).json({ message: "No public profile for this player" });
    }

    return res.json({
      profile: {
        bio: profile.bio,
        profileImageUrl: profile.profileImageUrl,
        bannerUrl: profile.bannerUrl,
        headline: profile.headline,
        socialLinks: (() => { try { return JSON.parse(profile.socialLinksJson); } catch { return []; } })(),
        teamAffiliation: profile.teamAffiliation,
        lastUpdatedAt: profile.lastUpdatedAt,
      },
    });
  });
}

import express from "express";
import type { Express, RequestHandler } from "express";
import { createServer, type Server } from "http";
import { setupAuth, registerAuthRoutes } from "./replit_integrations/auth";
import { getSession } from "./auth/session";
import { db } from "./db";
import { users } from "@shared/schema";
import { eq, sql as sqlExpr } from "drizzle-orm";
import { runAliasMigration } from "./simulation/players/name-generator";
import { startHeartbeat } from "./sse/terminalBroadcaster";
import { seedCatalog } from "./services/achievementsService";
import { seedBadges } from "./services/seasonsService";

// ─── Domain routers ───────────────────────────────────────────────────────────
import { registerIdentityRoutes } from "./domains/identity/routes";
import { registerPlayerRoutes } from "./domains/player/routes";
import { registerPerformanceRoutes } from "./domains/performance/routes";
import { registerValuationRoutes } from "./domains/valuation/routes";
import { registerMarketRoutes } from "./domains/market/routes";
import { registerTradingRoutes } from "./domains/trading/routes";
import { registerOrdersRoutes } from "./domains/orders/routes";
import { registerPortfolioRoutes } from "./domains/portfolio/routes";
import { registerDiscoveryRoutes } from "./domains/discovery/routes";
import { registerArenaRoutes } from "./domains/arena/routes";
import { registerAdminRoutes } from "./domains/admin/routes";
import { registerNewsRoutes } from "./domains/news/routes";
import { registerSystemRoutes } from "./domains/system/routes";
import { registerSyntheticRoutes } from "./domains/synthetic/routes";
import { registerPlayerClaimsRoutes } from "./domains/player-claims/routes";
import { registerPlayerOperatorRoutes } from "./domains/player-operator/routes";
import { registerPlayerHubRoutes } from "./domains/player-hub/routes";
import { registerWalletRoutes } from "./domains/wallet/routes";
import { registerMultigameRoutes } from "./domains/multigame/routes";
import { registerTradeSettlementRoutes } from "./domains/trade-settlement/routes";
import { registerPredictionRoutes } from "./domains/prediction/routes";
import { registerPlayerPublicRoutes } from "./domains/player-public/routes";
import adminPredictionHistoryRouter from "./domains/prediction/adminHistoryRoutes";
import { isPredictEnabledServer } from "./lib/featureFlags";
import { ingestionRouter, displayQueueRouter } from "./domains/ingestion";
import mediaRouter from "./domains/media/routes";
import { serveFile } from "./domains/media/service";

// ─── Middleware helpers (used by adminAuth below) ─────────────────────────────
const isAuthenticated: RequestHandler = (req: any, res, next) => {
  if (req.session?.isAdmin || req.session?.userId) return next();
  if (typeof req.isAuthenticated === "function" && req.isAuthenticated()) return next();
  return res.status(401).json({ message: "Unauthorized" });
};

const isAdminOnly: RequestHandler = (req: any, res, next) => {
  if (req.session?.isAdmin) return next();
  if (req.session?.userRole === "admin") return next();
  return res.status(403).json({ message: "Forbidden" });
};

declare module "express-session" {
  interface SessionData {
    isAdmin: boolean;
    adminUsername: string;
    userId: string;
    userDisplayName: string;
    userEmail: string;
    userRole: string;
    mustChangePassword: boolean;
    // Fase 10: Steam OpenID 2.0 — stored across the redirect/callback round-trip
    steamReturnUrl?: string;
  }
}

// ─── Admin session gate — applied globally before all domain routes ───────────
const adminAuth = (req: any, res: any, next: any) => {
  const publicPaths = [
    "/api/admin/login",
    "/api/admin/logout",
    "/api/admin/me",
    "/api/admin/auth/reset-password",
    "/api/auth/signup",
    "/api/auth/login",
    "/api/auth/logout",
    "/api/auth/me",
    "/api/auth/forgot-password",
    "/api/auth/reset-password",
    "/api/access-requests",
    "/api/waitlist",
    "/api/login",
    "/api/callback",
    "/api/logout",
    "/api/health",
    "/api/version",
    "/api/predictions/health",
  ];
  if (publicPaths.includes(req.path)) return next();
  // Canonical market read endpoints are public (no auth required)
  if (req.path.startsWith("/api/market/")) return next();
  // Performance score endpoint is public (read-only insight data)
  if (req.path.startsWith("/api/performance/")) return next();
  // Terminal asset read endpoints are public (multigame catalog data)
  if (req.path.startsWith("/api/terminal/assets")) return next();
  // Player public page endpoints are public (no login required)
  if (req.path.startsWith("/api/player-public/")) return next();
  if (req.path.startsWith("/api/") && (req.session?.isAdmin || req.session?.userId)) return next();
  if (req.path.startsWith("/api/")) return res.status(401).json({ message: "Unauthorized" });
  return next();
};

// ─── Ensure admin user row exists at boot ─────────────────────────────────────
async function ensureAdminUser() {
  try {
    // Keep FK-safe stub for legacy references
    await db
      .insert(users)
      .values({ id: "admin", email: "admin@gamerstock.ai", firstName: "Admin", lastName: "User" })
      .onConflictDoNothing();

    // Ensure the canonical admin account has role=admin and a display name.
    // NEVER overwrite passwordHash here — that would be an auto-reset on boot.
    const bootstrapEmail = process.env.ADMIN_BOOTSTRAP_EMAIL;
    if (!bootstrapEmail) {
      throw new Error(
        "ADMIN_BOOTSTRAP_EMAIL is required to start the server. " +
        "See .env.example.",
      );
    }
    const [existing] = await db.select().from(users).where(sqlExpr`lower(${users.email}) = ${bootstrapEmail.toLowerCase()}`);
    if (existing) {
      const needsUpdate = existing.role !== "admin" || !existing.displayName;
      if (needsUpdate) {
        await db.update(users).set({
          role: "admin",
          displayName: existing.displayName || "Admin",
          updatedAt: new Date(),
        }).where(eq(users.id, existing.id));
        console.log(`[BOOT] Admin role/displayName ensured for ${bootstrapEmail}`);
      }
    } else {
      // No admin found — create one with no password (must use reset endpoint to set one)
      await db.insert(users).values({
        email: bootstrapEmail,
        displayName: "Admin",
        firstName: "Admin",
        role: "admin",
        emailVerified: false,
        status: "active",
      }).onConflictDoNothing();
      console.log(`[BOOT] Admin user created for ${bootstrapEmail} — no password set (use /api/admin/auth/reset-password to set one)`);
    }

    console.log("[BOOT] Admin user check complete.");
  } catch (err) {
    console.error("[BOOT] Failed to ensure admin user:", err);
  }
}

// ─── Main route registration entry point ──────────────────────────────────────
export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Session middleware is the foundation for both OIDC and local auth.
  // When REPL_ID is set, setupAuth boots the Replit OIDC flow (and registers
  // session internally). Otherwise we register session standalone so the local
  // /api/auth/* flow still works without Replit.
  if (process.env.REPL_ID) {
    await setupAuth(app);
    registerAuthRoutes(app);
  } else {
    app.set("trust proxy", 1);
    app.use(getSession());
    console.log("[BOOT] Replit OIDC disabled (REPL_ID unset) — local auth only");
  }

  // Ensure the admin user row exists so FK constraints on portfolios/watchlist pass
  await ensureAdminUser();

  // Seed achievements catalog (idempotent)
  await seedCatalog();

  // Seed season badges catalog (idempotent)
  await seedBadges();

  // One-time migration: rename legacy Player### aliases to realistic summoner names
  await runAliasMigration();

  // Disable caching for all API responses
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  // Admin auth middleware — gates all /api routes
  app.use(adminAuth);

  // Inject user identity into req.user for downstream route compatibility
  app.use((req: any, res, next) => {
    if (req.session?.isAdmin) {
      req.user = { id: "admin", claims: { sub: "admin" } };
    } else if (req.session?.userId) {
      req.user = { id: req.session.userId, claims: { sub: req.session.userId } };
    }
    next();
  });

  // ─── Domain route registrations ───────────────────────────────────────────────
  registerIdentityRoutes(app);
  registerPlayerRoutes(app);
  registerPerformanceRoutes(app);
  registerValuationRoutes(app);
  registerMarketRoutes(app);
  registerTradingRoutes(app);
  registerOrdersRoutes(app);
  registerPortfolioRoutes(app);
  registerDiscoveryRoutes(app);
  registerArenaRoutes(app);
  registerAdminRoutes(app);
  registerNewsRoutes(app);
  registerSystemRoutes(app);
  registerSyntheticRoutes(app);
  registerPlayerClaimsRoutes(app);
  registerPlayerHubRoutes(app);
  registerPlayerOperatorRoutes(app);
  registerWalletRoutes(app);
  registerMultigameRoutes(app);
  registerTradeSettlementRoutes(app);
  registerPredictionRoutes(app);
  registerPlayerPublicRoutes(app);

  // Prediction history admin API — /api/admin/predictions/**
  // Gate: return 503 when Predict is disabled (consistent with /api/predictions/* gate).
  app.use("/api/admin/predictions", isAuthenticated, isAdminOnly, (req: any, res: any, next: any) => {
    if (!isPredictEnabledServer()) {
      return res.status(503).json({ message: "Predictions feature is currently disabled." });
    }
    return next();
  }, adminPredictionHistoryRouter);

  // Ingestion admin review API — /api/admin/ingestion/**
  app.use("/api/admin/ingestion", ingestionRouter);

  // Display queue admin API — /api/admin/display-queue/**
  app.use("/api/admin/display-queue", displayQueueRouter);

  // Media admin API — /api/admin/media/**
  app.use("/api/admin/media", mediaRouter);

  // Serve uploaded media files — reads file bytes from the database.
  // URL pattern: /uploads/media/:storageKey
  app.get("/uploads/media/:storageKey", async (req, res) => {
    try {
      const file = await serveFile(req.params.storageKey);
      if (!file) {
        res.status(404).json({ error: "Media file not found." });
        return;
      }
      res.setHeader("Content-Type", file.mimeType);
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.setHeader("Content-Length", file.fileData.length);
      res.send(file.fileData);
    } catch (err: any) {
      res.status(500).json({ error: "Failed to serve media file." });
    }
  });

  // Start SSE heartbeat
  startHeartbeat(30000);

  return httpServer;
}

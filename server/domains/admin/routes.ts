import type { Express, RequestHandler } from "express";
import { db } from "../../db";
import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { storage } from "../../storage";
import { api } from "@shared/routes";
import { pauseSimulator, resumeSimulator, isSimulatorPaused } from "../../market-maker";
import { startBotSimulator, stopBotSimulator, isBotSimulatorRunning, getBotMetrics, seedBots, setBotConfig } from "../../simulation/bots/bot-trader";
import { performanceSyncService } from "../../integrations/jobs/performance-sync-service";
import { performanceBatchService } from "../../integrations/jobs/performance-batch-service";
import { runValuationBatch, seedInitialValuations, getValuationState } from "../../services/valuationJob";
import { getMarketMode, setMarketMode, getRiotApiKey, setRiotApiKey, getRiotApiKeyWithSource, clearRiotApiKeyCache, getKeyTestState, setKeyTestState, sanitizeRiotApiKey } from "../../app-config";
import { buildMarketSignals } from "../../services/marketSignals";
import { syncCanonicalMarket } from "../../market-core/sync";
import { backfillTradingAssetLinks } from "../../market-core/backfill-trading-assets";
import { marketHub } from "../../ws/market-hub";
import { computeQuotes } from "@shared/market-quotes";
import { spotPrice, costToBuy, payoutToSell, priceImpactPct, supplyForPrice, DEFAULT_AMM_PARAMS } from "../../services/ammPricing";
import {
  computeRecentPerformance,
  computeConsistencyScore,
  computeHistoricalSkill,
  computeActivityScore,
  computeConfidenceScore,
  computePVIRaw,
  computePVIAdjusted,
  computeFairValue,
  computeDivergence,
  computeGravityPct,
  computePerformanceAnchorPct,
  computeInactivityDecayFactor,
  PVI_CONFIG,
} from "../../services/pviEngine";
import {
  seedBadges,
  getActiveSeason,
  closeSeasonAndDistributeBadges,
  getSeasonRewards,
  addSeasonReward,
  deleteSeasonReward,
  getActiveChallenges,
  getAllChallenges,
  createChallenge,
  deleteChallenge,
} from "../../services/seasonsService";
import { runDiagnostics, runBootstrap } from "../../services/arenaBootstrap";
import { RANK_THRESHOLDS } from "@shared/arena-config";
import {
  users,
  riotAssets,
  riotTrades,
  riotMatchCache,
  assets,
  assetMarkets,
  assetMarketState,
  assetTrades,
  feeLedger,
  playerFeeBalance,
  roleBaselines,
  roleMetricWeights,
  assetValuationState,
  performanceScores,
  playerMatchMetrics,
  arenaProfiles,
  arenaUserStats,
  arenaSeasons,
  arenaUserSeasonStats,
  arenaSeasonLeaderboardSnapshot,
  arenaBadges,
  userBadges,
  achievementsCatalog,
  userAchievements,
  triggerOrders,
  appConfig,
  accessRequests,
  passwordResetTokens,
  markets,
  portfolios,
  positions,
  vaults,
  watchlist,
  trades,
} from "@shared/schema";
import { eq, desc, asc, and, or, ilike, sql as sqlExpr, gte, lt } from "drizzle-orm";
import { lastLoopRun, lastCycleSummary } from "../multigame/multigameValuationScheduler";
import { evaluateTerminalEligibility } from "../terminal/listingEligibilityService";
import { getReconcilerLog }            from "../terminal/reconcilerLog";

const isAdminOnly: RequestHandler = (req: any, res, next) => {
  if (req.session?.isAdmin) return next();
  if (req.session?.userRole === "admin") return next();
  return res.status(403).json({ message: "Forbidden" });
};

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
    "/api/auth/reset-password/validate",
    "/api/access-requests",
    "/api/waitlist",
    "/api/login",
    "/api/callback",
    "/api/logout",
    "/api/health",
    "/api/version",
  ];
  if (publicPaths.includes(req.path)) return next();
  // Canonical market read endpoints are public (no auth required)
  if (req.path.startsWith("/api/market/")) return next();
  // Performance score endpoint is public (read-only insight data)
  if (req.path.startsWith("/api/performance/")) return next();
  if (req.path.startsWith("/api/") && (req.session?.isAdmin || req.session?.userId)) return next();
  if (req.path.startsWith("/api/")) return res.status(401).json({ message: "Unauthorized" });
  return next();
};

export function registerAdminRoutes(app: Express): void {
  // ─── Boot-time admin credential validation ───────────────────────────────────
  // Hard fail if ADMIN_USER / ADMIN_PASS are missing — there is no longer a
  // silent "admin"/"admin" fallback. See .env.example for required vars.
  if (!process.env.ADMIN_USER || !process.env.ADMIN_PASS) {
    throw new Error(
      "ADMIN_USER and ADMIN_PASS are required to start the server. " +
      "Copy .env.example to .env and set strong values for both.",
    );
  }
  if (process.env.ADMIN_PASS.length < 12) {
    console.warn(
      "[BOOT] WARNING: ADMIN_PASS is shorter than 12 characters — " +
      "consider strengthening it before exposing this server to any network.",
    );
  }

  // ─── ADMIN ROUTES ────────────────────────────────────────────────────────────

  app.post("/api/admin/users/create", isAdminOnly, async (req, res) => {
    try {
      const { email, firstName, lastName, role, password } = req.body;
      if (!email || !firstName || !password) {
        return res.status(400).json({ message: "Email, first name, and password are required" });
      }
      const [existing] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
      if (existing) {
        return res.status(409).json({ message: "A user with that email already exists" });
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const [newUser] = await db.insert(users).values({
        email: email.toLowerCase(),
        firstName,
        lastName: lastName || "",
        role: role || "user",
        passwordHash,
        status: "active",
        emailVerified: true,
      }).returning();

      // Ensure portfolio
      const existing_portfolio = await storage.getPortfolioByUserId(newUser.id);
      if (!existing_portfolio) {
        await storage.createPortfolio({ userId: newUser.id, balance: "10000.00" });
      }

      return res.json({ success: true, user: { id: newUser.id, email: newUser.email, role: newUser.role } });
    } catch (err: any) {
      console.error("[Admin/Users] Create error:", err);
      return res.status(500).json({ message: "Failed to create user" });
    }
  });

  app.post("/api/admin/users/:userId/reset-password", isAdminOnly, async (req, res) => {
    try {
      const userId = String(req.params.userId);
      const { newPassword } = req.body;
      if (!newPassword || newPassword.length < 8) {
        return res.status(400).json({ message: "New password must be at least 8 characters" });
      }
      const passwordHash = await bcrypt.hash(newPassword, 12);
      const [updated] = await db.update(users)
        .set({ passwordHash, mustChangePassword: true, updatedAt: new Date() })
        .where(eq(users.id, userId))
        .returning();

      if (!updated) return res.status(404).json({ message: "User not found" });
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ message: "Failed to reset password" });
    }
  });

  app.post("/api/admin/users/:userId/block", isAdminOnly, async (req, res) => {
    try {
      const { userId } = req.params;
      await db.update(users).set({ status: "blocked", updatedAt: new Date() }).where(eq(users.id, userId));
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ message: "Failed to block user" });
    }
  });

  app.post("/api/admin/users/:userId/unblock", isAdminOnly, async (req, res) => {
    try {
      const { userId } = req.params;
      await db.update(users).set({ status: "active", updatedAt: new Date() }).where(eq(users.id, userId));
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ message: "Failed to unblock user" });
    }
  });

  app.get("/api/admin/access-requests", isAdminOnly, async (req, res) => {
    try {
      const rows = await db.select().from(accessRequests).orderBy(desc(accessRequests.createdAt));
      return res.json(rows);
    } catch (err) {
      return res.status(500).json({ message: "Failed to fetch access requests" });
    }
  });

  app.post("/api/admin/access-requests/:id/approve", isAdminOnly, async (req, res) => {
    try {
      const { id } = req.params;
      await db.update(accessRequests).set({ status: "approved", reviewedAt: new Date() }).where(eq(accessRequests.id, id));
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ message: "Failed to approve request" });
    }
  });

  app.post("/api/admin/access-requests/:id/reject", isAdminOnly, async (req, res) => {
    try {
      const { id } = req.params;
      await db.update(accessRequests).set({ status: "rejected", reviewedAt: new Date() }).where(eq(accessRequests.id, id));
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ message: "Failed to reject request" });
    }
  });

  app.post("/api/admin/access-requests/:id/create-user", isAdminOnly, async (req, res) => {
    try {
      const { id } = req.params;
      const [reqRow] = await db.select().from(accessRequests).where(eq(accessRequests.id, id));
      if (!reqRow) return res.status(404).json({ message: "Request not found" });

      const email = reqRow.email.toLowerCase();
      const [existing] = await db.select().from(users).where(eq(users.email, email));
      if (existing) return res.status(409).json({ message: "User with this email already exists" });

      const tempPassword = crypto.randomBytes(8).toString("hex");
      const passwordHash = await bcrypt.hash(tempPassword, 12);

      const [newUser] = await db.insert(users).values({
        email,
        firstName: reqRow.fullName.split(" ")[0],
        lastName: reqRow.fullName.split(" ").slice(1).join(" ") || "",
        displayName: reqRow.usernameInterest || reqRow.fullName.split(" ")[0],
        passwordHash,
        role: "user",
        status: "active",
        emailVerified: true,
        mustChangePassword: true,
      }).returning();

      await storage.createPortfolio({ userId: newUser.id, balance: "10000.00" });
      await db.update(accessRequests).set({ status: "user_created", reviewedAt: new Date() }).where(eq(accessRequests.id, id));

      return res.json({ success: true, tempPassword, user: newUser });
    } catch (err) {
      console.error("[Admin/Access] Create user error:", err);
      return res.status(500).json({ message: "Failed to create user from request" });
    }
  });

  app.post("/api/admin/login", async (req: any, res) => {
    const { username, email, password } = req.body;
    const identifier: string | undefined = username ?? email;
    const adminUser = process.env.ADMIN_USER;
    const adminPass = process.env.ADMIN_PASS;

    if (identifier === adminUser && password === adminPass) {
      req.session.isAdmin = true;
      req.session.adminUsername = identifier;
      req.session.userRole = "admin";
      return res.json({ success: true });
    }

    if (!identifier) {
      return res.status(400).json({ message: "username or email required" });
    }

    // Also allow real user-based admin accounts to use this endpoint
    const idLower = identifier.toLowerCase();
    const [dbUser] = await db.select().from(users).where(sqlExpr`lower(${users.email}) = ${idLower} OR lower(${users.displayName}) = ${idLower}`).limit(1);
    if (dbUser && dbUser.role === "admin" && dbUser.passwordHash) {
      const valid = await bcrypt.compare(password, dbUser.passwordHash);
      if (valid) {
        req.session.isAdmin = true;
        req.session.userId = dbUser.id;
        req.session.userRole = "admin";
        req.session.userDisplayName = dbUser.displayName || dbUser.firstName;
        return res.json({ success: true });
      }
    }

    res.status(401).json({ message: "Invalid admin credentials" });
  });

  app.post("/api/admin/logout", (req: any, res) => {
    req.session.isAdmin = false;
    req.session.adminUsername = undefined;
    res.json({ success: true });
  });

  app.post("/api/admin/auth/reset-password", async (req, res) => {
    try {
      const { email, newPassword, bootstrapSecret } = req.body;
      const expectedSecret = process.env.ADMIN_BOOTSTRAP_SECRET;
      if (!expectedSecret || bootstrapSecret !== expectedSecret) {
        return res.status(403).json({ message: "Invalid bootstrap secret" });
      }
      if (!email || !newPassword || newPassword.length < 8) {
        return res.status(400).json({ message: "Email and newPassword (min 8 chars) required" });
      }
      const hash = await bcrypt.hash(newPassword, 12);
      const normalizedEmail = email.trim().toLowerCase();

      const [updated] = await db.update(users)
        .set({ passwordHash: hash, mustChangePassword: false, status: "active", updatedAt: new Date() })
        .where(sqlExpr`lower(${users.email}) = ${normalizedEmail}`)
        .returning({ id: users.id, email: users.email });

      if (updated) {
        return res.json({ success: true, action: "updated", email: updated.email });
      }

      const [created] = await db.insert(users).values({
        email: normalizedEmail,
        displayName: normalizedEmail.split("@")[0].replace(/[^a-zA-Z0-9]/g, ""),
        firstName: "Admin",
        lastName: "",
        role: "admin",
        passwordHash: hash,
        emailVerified: true,
        status: "active",
        mustChangePassword: false,
        createdByAdmin: true,
      } as any).returning({ id: users.id, email: users.email });

      return res.json({ success: true, action: "created", email: created.email });
    } catch (err) {
      return res.status(500).json({ message: "Reset failed", detail: String(err) });
    }
  });

  app.get("/api/admin/me", (req: any, res) => {
    if (req.session?.isAdmin) {
      return res.json({ isAdmin: true, username: req.session.adminUsername || "Admin" });
    }
    res.json({ isAdmin: false });
  });

  // ─── ADMIN ROUTES — USER MANAGEMENT ──────────────────────────────────────────

  app.get("/api/admin/users", isAdminOnly, async (req, res) => {
    try {
      // Explicit projection — passwordHash is intentionally NEVER returned.
      const allUsers = await db
        .select({
          id: users.id,
          email: users.email,
          firstName: users.firstName,
          lastName: users.lastName,
          displayName: users.displayName,
          profileImageUrl: users.profileImageUrl,
          gamesSelected: users.gamesSelected,
          gamesOther: users.gamesOther,
          role: users.role,
          status: users.status,
          emailVerified: users.emailVerified,
          isBot: users.isBot,
          mustChangePassword: users.mustChangePassword,
          createdByAdmin: users.createdByAdmin,
          blockedAt: users.blockedAt,
          lastLoginAt: users.lastLoginAt,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
        })
        .from(users)
        .orderBy(desc(users.createdAt));
      res.json(allUsers);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  app.get("/api/admin/users/:id", isAdminOnly, async (req, res) => {
    try {
      const userId = req.params.id;

      // Explicit projection — passwordHash intentionally omitted.
      const [user] = await db
        .select({
          id: users.id,
          email: users.email,
          firstName: users.firstName,
          lastName: users.lastName,
          displayName: users.displayName,
          profileImageUrl: users.profileImageUrl,
          gamesSelected: users.gamesSelected,
          gamesOther: users.gamesOther,
          role: users.role,
          status: users.status,
          emailVerified: users.emailVerified,
          isBot: users.isBot,
          mustChangePassword: users.mustChangePassword,
          createdByAdmin: users.createdByAdmin,
          blockedAt: users.blockedAt,
          lastLoginAt: users.lastLoginAt,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
        })
        .from(users)
        .where(eq(users.id, userId));
      if (!user) return res.status(404).json({ message: "User not found" });

      // Portfolio
      const [portfolio] = await db
        .select({ id: portfolios.id, balance: portfolios.balance, updatedAt: portfolios.updatedAt })
        .from(portfolios)
        .where(eq(portfolios.userId, userId));

      // Positions with vault data
      let positionsData: any[] = [];
      if (portfolio) {
        const rows = await db
          .select({
            id: positions.id,
            shares: positions.shares,
            averageCost: positions.averageCost,
            vault: {
              id: vaults.id,
              playerAlias: vaults.playerAlias,
              lastTradePrice: vaults.lastTradePrice,
              rank: vaults.rank,
            },
          })
          .from(positions)
          .innerJoin(vaults, eq(positions.vaultId, vaults.id))
          .where(eq(positions.portfolioId, portfolio.id));
        positionsData = rows.filter(r => r.shares > 0);
      }

      // Watchlist items with vault data
      const watchlistRows = await db
        .select({
          id: vaults.id,
          playerAlias: vaults.playerAlias,
          lastTradePrice: vaults.lastTradePrice,
          rank: vaults.rank,
        })
        .from(watchlist)
        .innerJoin(vaults, eq(watchlist.vaultId, vaults.id))
        .where(eq(watchlist.userId, userId));

      // Recent trades with vault data
      let recentTradesData: any[] = [];
      if (portfolio) {
        recentTradesData = await db
          .select({
            id: trades.id,
            type: trades.type,
            shares: trades.shares,
            pricePerShare: trades.pricePerShare,
            totalCost: trades.totalCost,
            fee: trades.fee,
            executedAt: trades.executedAt,
            vault: { playerAlias: vaults.playerAlias },
          })
          .from(trades)
          .innerJoin(vaults, eq(trades.vaultId, vaults.id))
          .where(eq(trades.portfolioId, portfolio.id))
          .orderBy(desc(trades.executedAt))
          .limit(20);
      }

      res.json({
        user: {
          id: user.id,
          firstName: user.firstName ?? null,
          lastName: user.lastName ?? null,
          displayName: user.displayName ?? null,
          email: user.email ?? null,
          gamesSelected: user.gamesSelected ?? null,
          createdAt: user.createdAt ? user.createdAt.toISOString() : null,
          status: user.status ?? "active",
          role: user.role ?? "user",
        },
        portfolio: portfolio
          ? { id: portfolio.id, balance: String(portfolio.balance), updatedAt: portfolio.updatedAt?.toISOString() ?? null }
          : null,
        positions: positionsData,
        watchlistItems: watchlistRows,
        recentTrades: recentTradesData,
      });
    } catch (err) {
      console.error("[admin] GET /api/admin/users/:id error:", err);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  app.patch("/api/admin/users/:id/block", isAdminOnly, async (req, res) => {
    try {
      await db.update(users).set({ status: "blocked", updatedAt: new Date() }).where(eq(users.id, req.params.id));
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to block user" });
    }
  });

  app.patch("/api/admin/users/:id/unblock", isAdminOnly, async (req, res) => {
    try {
      await db.update(users).set({ status: "active", updatedAt: new Date() }).where(eq(users.id, req.params.id));
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to unblock user" });
    }
  });

  app.patch("/api/admin/users/:id/role", isAdminOnly, async (req, res) => {
    try {
      const { role } = req.body;
      if (!["user", "admin", "moderator"].includes(role)) {
        return res.status(400).json({ message: "Invalid role" });
      }
      await db.update(users).set({ role, updatedAt: new Date() }).where(eq(users.id, req.params.id));
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to update role" });
    }
  });

  app.patch("/api/admin/users/:id/password", isAdminOnly, async (req, res) => {
    try {
      const { password } = req.body;
      if (!password || password.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters" });
      }
      const passwordHash = await bcrypt.hash(password, 12);
      await db.update(users)
        .set({ passwordHash, mustChangePassword: true, updatedAt: new Date() })
        .where(eq(users.id, req.params.id));
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to update password" });
    }
  });

  app.delete("/api/admin/users/:id", isAdminOnly, async (req, res) => {
    try {
      // Soft delete
      await db.update(users).set({ status: "deleted", updatedAt: new Date() }).where(eq(users.id, req.params.id));
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to delete user" });
    }
  });

  app.get("/api/admin/metrics", isAdminOnly, async (req, res) => {
    try {
      const [userCount] = await db.select({ count: sqlExpr`count(*)::int` }).from(users).where(sqlExpr`status != 'deleted'`);
      // Canonical multigame tables (riotTrades/riotAssets were legacy 0-row mirrors).
      const [tradeCount] = await db.select({ count: sqlExpr`count(*)::int` }).from(assetTrades);
      const [assetCount] = await db.select({ count: sqlExpr`count(*)::int` }).from(assets);

      // Aggregations consumed by client/src/pages/admin/metrics.tsx — both fields
      // are required to avoid `NaN%` and `—` placeholders in the dashboard.
      const [{ totalVolume }] = await db
        .select({
          totalVolume: sqlExpr<string>`COALESCE(SUM(${assetTrades.grossValue}), 0)::text`,
        })
        .from(assetTrades);

      const [{ activeUsers24h }] = await db
        .select({
          activeUsers24h: sqlExpr<number>`COUNT(DISTINCT ${assetTrades.userId})::int`,
        })
        .from(assetTrades)
        .where(gte(assetTrades.executedAt, sqlExpr<Date>`NOW() - INTERVAL '24 hours'`));

      res.json({
        totalUsers: userCount.count,
        totalTrades: tradeCount.count,
        totalAssets: assetCount.count,
        totalVolume,
        activeUsers24h,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch metrics" });
    }
  });

  // ─── ADMIN ROUTES — MARKET SIMULATOR CONTROL ──────────────────────────────────

  app.get("/api/admin/simulator", isAdminOnly, (req, res) => {
    res.json({ paused: isSimulatorPaused() });
  });

  app.post("/api/admin/simulator/pause", isAdminOnly, (req, res) => {
    pauseSimulator();
    res.json({ paused: true });
  });

  app.post("/api/admin/simulator/resume", isAdminOnly, (req, res) => {
    resumeSimulator();
    res.json({ paused: false });
  });

  // ─── ADMIN ROUTES — INTEGRATIONS (Riot API) ───────────────────────────────────

  app.get("/api/admin/riot/key/status", isAdminOnly, async (req, res) => {
    const { key, source } = await getRiotApiKeyWithSource();
    const testState = getKeyTestState();

    res.json({
      hasKey: !!key,
      keyPreview: key ? `${key.slice(0, 8)}...` : null,
      source,
      testState,
    });
  });

  app.post("/api/admin/riot/key", isAdminOnly, async (req, res) => {
    const { key: rawKey } = req.body;
    if (!rawKey) return res.status(400).json({ message: "Key is required" });

    const { key, error } = sanitizeRiotApiKey(rawKey);
    if (error) return res.status(400).json({ message: error });

    await setRiotApiKey(key);
    res.json({ success: true, message: "Riot API key updated in app_config" });
  });

  app.post("/api/admin/riot/test", isAdminOnly, async (req, res) => {
    try {
      const key = await getRiotApiKey();
      if (!key) return res.status(400).json({ message: "No API key configured" });

      const testUrl = "https://na1.api.riotgames.com/lol/status/v4/platform-data";
      const riotRes = await fetch(testUrl, { headers: { "X-Riot-Token": key } });

      const { setKeyTestState } = await import("../../app-config");
      const { source } = await getRiotApiKeyWithSource();

      if (riotRes.ok) {
        const state = { valid: true, testedAt: new Date(), source, keyPreview: `${key.slice(0, 8)}...` };
        setKeyTestState(state);
        return res.json({ success: true, ...state });
      } else {
        const error = `Riot API Error: ${riotRes.status} ${riotRes.statusText}`;
        const state = { valid: false, error, testedAt: new Date(), source, keyPreview: `${key.slice(0, 8)}...` };
        setKeyTestState(state);
        return res.status(400).json({ success: false, ...state });
      }
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  });

  app.get("/api/admin/debug/riot-test", isAdminOnly, async (req, res) => {
    try {
      const apiKey = await getRiotApiKey();
      if (!apiKey) return res.status(400).json({ message: "No RIOT_API_KEY configured" });

      const testUrl = "https://na1.api.riotgames.com/lol/league/v4/challengerleagues/by-queue/RANKED_SOLO_5x5";
      const start = Date.now();
      const riotRes = await fetch(testUrl, { headers: { "X-Riot-Token": apiKey } });
      const duration = Date.now() - start;

      if (!riotRes.ok) {
        return res.status(riotRes.status).json({
          status: riotRes.status,
          statusText: riotRes.statusText,
          durationMs: duration,
          url: testUrl,
        });
      }

      const data = await riotRes.json();
      return res.json({
        status: riotRes.status,
        durationMs: duration,
        entryCount: data.entries?.length || 0,
        tier: data.tier,
        leagueId: data.leagueId,
      });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/riot/sync/challenger-na1", isAdminOnly, async (req, res) => {
    try {
      const result = await performanceSyncService.syncChallengerRoster();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/admin/riot/status", isAdminOnly, async (req, res) => {
    try {
      const [playerCount] = await db.select({ count: sqlExpr`count(*)::int` }).from(users).where(eq(users.isBot, false));
      const [riotAssetCount] = await db.select({ count: sqlExpr`count(*)::int` }).from(riotAssets);
      const status = await performanceSyncService.getStatus();

      res.json({
        players: playerCount.count,
        riotAssets: riotAssetCount.count,
        matchCache: status.matchCacheCount,
        perfJob: {
          running: status.running,
          lastRunAt: status.lastRunAt,
          lastRunProcessed: status.lastRunProcessed,
          lastRunErrors: status.lastRunErrors,
        },
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/riot/perf/run", isAdminOnly, async (req, res) => {
    try {
      const result = await performanceBatchService.runBatch();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/valuation/run", isAdminOnly, async (req, res) => {
    try {
      const result = await runValuationBatch();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/valuation/seed", isAdminOnly, async (req, res) => {
    try {
      await seedInitialValuations();
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── ADMIN ROUTES — OPS, CANONICAL SYNC & SYSTEM ──────────────────────────────

  app.post("/api/admin/canonical/sync", isAdminOnly, async (req, res) => {
    try {
      const result = await syncCanonicalMarket();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/trading/backfill-asset-links", isAdminOnly, async (req, res) => {
    try {
      const result = await backfillTradingAssetLinks();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/admin/ops/markets", isAdminOnly, async (req, res) => {
    try {
      const allMarkets = await db.select().from(markets);
      res.json(allMarkets);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/ops/run-sync", isAdminOnly, async (req, res) => {
    try {
      const result = await syncCanonicalMarket();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/admin/ops/sync-status", isAdminOnly, async (req, res) => {
    try {
      const rows = await db.select().from(appConfig).where(ilike(appConfig.key, "market_sync_%"));
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/admin/ops/pricing-selftest", isAdminOnly, async (req, res) => {
    try {
      const [asset] = await db.select().from(assets).limit(1);
      if (!asset) return res.json({ ok: false, error: "No assets" });

      const p = DEFAULT_AMM_PARAMS;
      const s = 100;
      const price = spotPrice(s, p);
      const buyPrice = costToBuy(s, 10, p) / 10;
      const sellPrice = payoutToSell(s, 10, p) / 10;

      res.json({
        ok: true,
        sample: {
          assetId: asset.id,
          params: p,
          testSupply: s,
          spot: price,
          avgBuy10: buyPrice,
          avgSell10: sellPrice,
        }
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/admin/system", isAdminOnly, async (req, res) => {
    try {
      const [riotAssetCount] = await db.select({ count: sqlExpr`count(*)::int` }).from(riotAssets);
      const [tradeCount]     = await db.select({ count: sqlExpr`count(*)::int` }).from(riotTrades);
      const syncStatus       = await performanceSyncService.getStatus().catch(() => null);
      const apiKey           = await getRiotApiKey().catch(() => null);

      res.json({
        uptime:             process.uptime(),
        env:                process.env.NODE_ENV,
        timestamp:          new Date().toISOString(),
        playersSynced:      riotAssetCount.count,
        matchesCached:      syncStatus?.matchCacheCount ?? 0,
        totalTrades:        tradeCount.count,
        riotApiKeyPresent:  !!apiKey,
        perfJobRunning:     syncStatus?.running ?? false,
        lastPerfRun:        syncStatus?.lastRunAt ?? null,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/admin/market-mode", isAdminOnly, async (req, res) => {
    const mode = await getMarketMode();
    res.json({ mode });
  });

  app.post("/api/admin/market-mode", isAdminOnly, async (req, res) => {
    const { mode } = req.body;
    if (mode !== "REAL_RIOT_NA1" && mode !== "SANDBOX") {
      return res.status(400).json({ message: "Invalid mode" });
    }
    await setMarketMode(mode);
    res.json({ success: true, mode });
  });

  app.get("/api/admin/market-audit", isAdminOnly, async (req, res) => {
    try {
      const [feeRows] = await db.select({ total: sqlExpr`sum(fee_total)` }).from(feeLedger);
      const [vaultCount] = await db.select({ count: sqlExpr`count(*)::int` }).from(riotAssets);
      const [tradeCount] = await db.select({ count: sqlExpr`count(*)::int` }).from(riotTrades);

      res.json({
        totalFeesCollected: feeRows.total || "0.00",
        activeVaults: vaultCount.count,
        totalTrades: tradeCount.count,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── ADMIN ROUTES — ARENA ───────────────────────────────────────────────────

  app.get("/api/admin/arena/seasons", isAdminOnly, async (req, res) => {
    try {
      const seasons = await db.select().from(arenaSeasons).orderBy(desc(arenaSeasons.startsAt));
      res.json(seasons);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch seasons" });
    }
  });

  app.get("/api/admin/arena/diagnostics", isAdminOnly, async (req, res) => {
    try {
      const data = await runDiagnostics();
      res.json(data);
    } catch (err) {
      res.status(500).json({ message: "Diagnostics failed" });
    }
  });

  app.post("/api/admin/arena/bootstrap", isAdminOnly, async (req, res) => {
    try {
      const result = await runBootstrap(req.body);
      res.json(result);
    } catch (err) {
      res.status(500).json({ message: "Bootstrap failed" });
    }
  });

  app.post("/api/admin/arena/seasons", isAdminOnly, async (req, res) => {
    try {
      const { name, startsAt, endsAt } = req.body;
      const [season] = await db.insert(arenaSeasons).values({
        name,
        startsAt: new Date(startsAt),
        endsAt: new Date(endsAt),
        status: "upcoming",
      }).returning();
      res.json(season);
    } catch (err) {
      res.status(500).json({ message: "Failed to create season" });
    }
  });

  app.delete("/api/admin/arena/seasons/:seasonId", isAdminOnly, async (req, res) => {
    try {
      await db.delete(arenaSeasons).where(eq(arenaSeasons.id, parseInt(req.params.seasonId)));
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to delete season" });
    }
  });

  app.post("/api/admin/arena/seasons/:seasonId/activate", isAdminOnly, async (req, res) => {
    try {
      const id = parseInt(req.params.seasonId);
      await db.transaction(async (tx) => {
        await tx.update(arenaSeasons).set({ status: "closed" }).where(eq(arenaSeasons.status, "active"));
        await tx.update(arenaSeasons).set({ status: "active" }).where(eq(arenaSeasons.id, id));
      });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to activate season" });
    }
  });

  app.post("/api/admin/arena/seasons/:seasonId/close", isAdminOnly, async (req, res) => {
    try {
      const result = await closeSeasonAndDistributeBadges(parseInt(req.params.seasonId));
      res.json(result);
    } catch (err) {
      res.status(500).json({ message: "Failed to close season" });
    }
  });

  app.post("/api/admin/arena/seasons/:seasonId/rewards", isAdminOnly, async (req, res) => {
    try {
      const reward = await addSeasonReward({
        seasonId: parseInt(req.params.seasonId),
        ...req.body
      });
      res.json(reward);
    } catch (err) {
      res.status(500).json({ message: "Failed to add reward" });
    }
  });

  app.delete("/api/admin/arena/seasons/:seasonId/rewards/:rewardId", isAdminOnly, async (req, res) => {
    try {
      await deleteSeasonReward(parseInt(req.params.rewardId));
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to delete reward" });
    }
  });

  app.get("/api/admin/arena/challenges", isAdminOnly, async (req, res) => {
    try {
      const challenges = await getAllChallenges();
      res.json(challenges);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch challenges" });
    }
  });

  app.post("/api/admin/arena/challenges", isAdminOnly, async (req, res) => {
    try {
      const challenge = await createChallenge({
        ...req.body,
        startsAt: new Date(req.body.startsAt),
        endsAt: new Date(req.body.endsAt),
      });
      res.json(challenge);
    } catch (err) {
      res.status(500).json({ message: "Failed to create challenge" });
    }
  });

  app.delete("/api/admin/arena/challenges/:challengeId", isAdminOnly, async (req, res) => {
    try {
      await deleteChallenge(parseInt(req.params.challengeId));
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to delete challenge" });
    }
  });

  // ─── ADMIN ROUTES — AMM ─────────────────────────────────────────────────────

  app.get("/api/admin/amm/markets", isAdminOnly, async (req, res) => {
    try {
      const rows = await db
        .select({
          assetId: assets.id,
          displayName: assets.displayName,
          externalId: assets.externalId,
          isEnabled: assetMarkets.isEnabled,
          floorPrice: assetMarkets.floorPrice,
          paramA: assetMarkets.paramA,
          paramB: assetMarkets.paramB,
          supply: assetMarketState.supply,
          lastPrice: assetMarketState.lastPrice,
        })
        .from(assets)
        .leftJoin(assetMarkets, eq(assetMarkets.assetId, assets.id))
        .leftJoin(assetMarketState, eq(assetMarketState.assetId, assets.id))
        .orderBy(assets.displayName);
      res.json(rows);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch AMM markets" });
    }
  });

  app.post("/api/admin/amm/seed", isAdminOnly, async (req, res) => {
    try {
      const allAssets = await db.select().from(assets);
      let count = 0;
      for (const asset of allAssets) {
        await db.insert(assetMarkets).values({
          assetId: asset.id,
          isEnabled: true,
          floorPrice: "5.00",
          paramA: "5.00",
          paramB: "100.00",
        }).onConflictDoNothing();

        const supply = supplyForPrice(parseFloat(asset.lastTradePrice), DEFAULT_AMM_PARAMS);
        await db.insert(assetMarketState).values({
          assetId: asset.id,
          supply: supply.toFixed(6),
          lastPrice: asset.lastTradePrice,
          version: 1,
        }).onConflictDoNothing();
        count++;
      }
      res.json({ success: true, count });
    } catch (err) {
      res.status(500).json({ message: "Failed to seed AMM" });
    }
  });

  app.patch("/api/admin/amm/markets/:assetId", isAdminOnly, async (req, res) => {
    try {
      const assetId = parseInt(req.params.assetId);
      const { floorPrice, paramA, paramB, isEnabled } = req.body;

      await db.update(assetMarkets).set({
        floorPrice: floorPrice?.toString(),
        paramA: paramA?.toString(),
        paramB: paramB?.toString(),
        isEnabled,
        updatedAt: new Date(),
      }).where(eq(assetMarkets.assetId, assetId));

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to update AMM market" });
    }
  });

  // ─── ADMIN ROUTES — BOTS ────────────────────────────────────────────────────

  app.get("/api/admin/bots/status", async (req: any, res) => {
    if (req.user?.role !== "admin" && req.session?.userRole !== "admin" && !req.session?.isAdmin) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const metrics = await getBotMetrics();
    res.json(metrics);
  });

  app.post("/api/admin/bots/start", (req: any, res) => {
    if (req.user?.role !== "admin" && req.session?.userRole !== "admin" && !req.session?.isAdmin) {
      return res.status(403).json({ message: "Forbidden" });
    }
    startBotSimulator();
    res.json({ running: true });
  });

  app.post("/api/admin/bots/stop", (req: any, res) => {
    if (req.user?.role !== "admin" && req.session?.userRole !== "admin" && !req.session?.isAdmin) {
      return res.status(403).json({ message: "Forbidden" });
    }
    stopBotSimulator();
    res.json({ running: false });
  });

  app.post("/api/admin/bots/seed", (req: any, res) => {
    if (req.user?.role !== "admin" && req.session?.userRole !== "admin" && !req.session?.isAdmin) {
      return res.status(403).json({ message: "Forbidden" });
    }
    seedBots().then(r => res.json(r)).catch(e => res.status(500).json({ message: e.message }));
  });

  app.post("/api/admin/bots/config", (req: any, res) => {
    if (req.user?.role !== "admin" && req.session?.userRole !== "admin" && !req.session?.isAdmin) {
      return res.status(403).json({ message: "Forbidden" });
    }
    setBotConfig(req.body);
    res.json({ success: true });
  });

  // ─── ADMIN ROUTES — MARKET LAB ──────────────────────────────────────────────

  app.post("/api/admin/market-lab/simulate", isAdminOnly, async (req, res) => {
    const {
      ticks = 100,
      divergenceBraking = true,
      volatility = 0.05,
      bias = 0.001
    } = req.body;

    function seededRand(seed: number) {
      const x = Math.sin(seed) * 10000;
      return x - Math.floor(x);
    }

    function computeSimAnchorEffect(div: number, conf: number) {
      if (conf < 0.30) return 0;
      const absDiv = Math.abs(div);
      let factor = 0.0008;
      if (absDiv > 25) factor = 0.0040;
      else if (absDiv > 8) factor = 0.0020;
      return -(div / 100) * factor;
    }

    function applyDivergenceBraking(qty: number, div: number) {
      if (!divergenceBraking) return qty;
      if (qty > 0 && div > 10) return qty * 0.5; // less buying if overvalued
      if (qty < 0 && div < -10) return qty * 0.5; // less selling if undervalued
      return qty;
    }

    async function runReworkedBots(labId: string) {
      // In-memory simulation of bot logic
      const logs = [`[LAB] Starting simulation ${labId}`];
      return { logs };
    }

    try {
      const labId = `sim_${Date.now()}`;
      const { logs } = await runReworkedBots(labId);
      res.json({ labId, ticks, logs });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/market-lab/stress-test", isAdminOnly, async (req, res) => {
    const { concurrency = 10, totalRequests = 100 } = req.body;
    const start = Date.now();
    const results = {
      success: 0,
      error: 0,
      avgLatency: 0,
    };

    // Very basic stress test mock
    results.success = totalRequests;
    const duration = Date.now() - start;
    results.avgLatency = duration / totalRequests;

    res.json({
      testId: `stress_${Date.now()}`,
      durationMs: duration,
      results
    });
  });

  // ── System Health (Phase 0 observability) ─────────────────────────────────
  app.get("/api/admin/system-health", isAdminOnly, async (_req, res) => {
    try {
      // ── Aggregate health counts (backward-compatible) ──────────────────────
      type HealthRow = {
        total:             string;
        dota2:             string;
        cs2:               string;
        flat_assets:       string;
        mispriced_assets:  string;
        no_valuation:      string;
        no_history:        string;
        no_fundamental:    string;
        no_last_trade:     string;
      };

      const result = await db.execute<HealthRow>(sqlExpr`
        SELECT
          COUNT(*)::int AS total,

          COUNT(*) FILTER (WHERE a.asset_uid LIKE 'dota2:%')::int AS dota2,
          COUNT(*) FILTER (WHERE a.asset_uid LIKE 'cs2:%')::int   AS cs2,

          SUM(
            CASE
              WHEN ABS(CAST(a.fundamental_price AS numeric) - 15) < 0.01 THEN 1
              ELSE 0
            END
          )::int AS flat_assets,

          SUM(
            CASE
              WHEN vs.player_value IS NOT NULL
               AND ABS(CAST(a.fundamental_price AS numeric) - CAST(vs.player_value AS numeric)) > 0.5
              THEN 1
              ELSE 0
            END
          )::int AS mispriced_assets,

          SUM(
            CASE WHEN vs.asset_id IS NULL THEN 1 ELSE 0 END
          )::int AS no_valuation,

          SUM(
            CASE WHEN vh.asset_id IS NULL THEN 1 ELSE 0 END
          )::int AS no_history,

          SUM(
            CASE WHEN a.fundamental_price IS NULL THEN 1 ELSE 0 END
          )::int AS no_fundamental,

          SUM(
            CASE WHEN a.last_trade_price IS NULL THEN 1 ELSE 0 END
          )::int AS no_last_trade

        FROM assets a
        LEFT JOIN dota2_valuation_state vs
          ON vs.asset_id = a.id
        LEFT JOIN (
          SELECT DISTINCT asset_id
          FROM dota2_value_history
        ) vh
          ON vh.asset_id = a.id
        WHERE a.trading_status = 'ACTIVE'
          AND a.listing_status = 'LISTED'
      `);

      const r = result.rows?.[0] ?? {
        total: "0", dota2: "0", cs2: "0",
        flat_assets: "0", mispriced_assets: "0",
        no_valuation: "0", no_history: "0",
        no_fundamental: "0", no_last_trade: "0",
      };

      const total       = Number(r.total);
      const flatAssets  = Number(r.flat_assets);
      const mispriced   = Number(r.mispriced_assets);

      let status: "HEALTHY" | "WARNING" | "CRITICAL" = "HEALTHY";
      if (total > 0) {
        if (mispriced / total > 0.2) {
          status = "CRITICAL";
        } else if (flatAssets > 0) {
          status = "WARNING";
        }
      }

      // ── Top-10 issue lists ─────────────────────────────────────────────────
      type TopRow = {
        asset_id:       number;
        asset_uid:      string;
        display_name:   string;
        symbol:         string;
        provider:       string;
        listing_status: string;
        trading_status: string;
        issue:          string;
      };

      const [
        topNoValuation,
        topNoHistory,
        topNoFundamental,
        topNoLastTrade,
        topEligibilityFailing,
      ] = await Promise.all([
        db.execute<TopRow>(sqlExpr`
          SELECT
            a.id::int AS asset_id, a.asset_uid, a.display_name, a.symbol,
            m.provider, a.listing_status, a.trading_status,
            'missing_valuation_state' AS issue
          FROM assets a
          INNER JOIN markets m ON m.id = a.market_id
          LEFT JOIN dota2_valuation_state vs ON vs.asset_id = a.id
          WHERE a.trading_status = 'ACTIVE' AND a.listing_status = 'LISTED'
            AND vs.asset_id IS NULL
          LIMIT 10
        `),
        db.execute<TopRow>(sqlExpr`
          SELECT
            a.id::int AS asset_id, a.asset_uid, a.display_name, a.symbol,
            m.provider, a.listing_status, a.trading_status,
            'missing_bootstrap_history' AS issue
          FROM assets a
          INNER JOIN markets m ON m.id = a.market_id
          LEFT JOIN (SELECT DISTINCT asset_id FROM dota2_value_history) vh
            ON vh.asset_id = a.id
          WHERE a.trading_status = 'ACTIVE' AND a.listing_status = 'LISTED'
            AND vh.asset_id IS NULL
          LIMIT 10
        `),
        db.execute<TopRow>(sqlExpr`
          SELECT
            a.id::int AS asset_id, a.asset_uid, a.display_name, a.symbol,
            m.provider, a.listing_status, a.trading_status,
            'missing_fundamental_price' AS issue
          FROM assets a
          INNER JOIN markets m ON m.id = a.market_id
          WHERE a.trading_status = 'ACTIVE' AND a.listing_status = 'LISTED'
            AND a.fundamental_price IS NULL
          LIMIT 10
        `),
        db.execute<TopRow>(sqlExpr`
          SELECT
            a.id::int AS asset_id, a.asset_uid, a.display_name, a.symbol,
            m.provider, a.listing_status, a.trading_status,
            'missing_last_trade_price' AS issue
          FROM assets a
          INNER JOIN markets m ON m.id = a.market_id
          WHERE a.trading_status = 'ACTIVE' AND a.listing_status = 'LISTED'
            AND a.last_trade_price IS NULL
          LIMIT 10
        `),
        db.execute<TopRow>(sqlExpr`
          SELECT
            a.id::int AS asset_id, a.asset_uid, a.display_name, a.symbol,
            m.provider, a.listing_status, a.trading_status,
            'listing_eligibility_invalid' AS issue
          FROM assets a
          INNER JOIN markets m ON m.id = a.market_id
          LEFT JOIN dota2_valuation_state vs ON vs.asset_id = a.id
          LEFT JOIN (SELECT DISTINCT asset_id FROM dota2_value_history) vh
            ON vh.asset_id = a.id
          WHERE a.trading_status = 'ACTIVE' AND a.listing_status = 'LISTED'
            AND (
              vs.asset_id IS NULL
              OR a.fundamental_price IS NULL
              OR a.last_trade_price IS NULL
              OR vh.asset_id IS NULL
              OR ABS(CAST(COALESCE(vs.player_value, '15') AS numeric) - 15) <= 0.10
            )
          LIMIT 10
        `),
      ]);

      const mapTopRow = (rows: TopRow[]) =>
        rows.map(row => ({
          assetId:       Number(row.asset_id),
          assetUid:      row.asset_uid,
          game:          (row.asset_uid ?? "").split(":")[0] ?? "unknown",
          displayName:   row.display_name,
          symbol:        row.symbol,
          provider:      row.provider,
          listingStatus: row.listing_status,
          tradingStatus: row.trading_status,
          issue:         row.issue,
        }));

      return res.json({
        assets: {
          total,
          dota2: Number(r.dota2),
          cs2:   Number(r.cs2),
        },
        health: {
          flat_assets:      flatAssets,
          mispriced_assets: mispriced,
          no_valuation:     Number(r.no_valuation),
          no_history:       Number(r.no_history),
          no_fundamental:   Number(r.no_fundamental),
          no_last_trade:    Number(r.no_last_trade),
        },
        loop: {
          lastLoopRun: lastLoopRun?.toISOString() ?? null,
          lastCycle:   lastCycleSummary,
        },
        status,
        topIssues: {
          noValuation:         mapTopRow(topNoValuation.rows   as TopRow[]),
          noHistory:           mapTopRow(topNoHistory.rows     as TopRow[]),
          noFundamentalPrice:  mapTopRow(topNoFundamental.rows as TopRow[]),
          noLastTradePrice:    mapTopRow(topNoLastTrade.rows   as TopRow[]),
          eligibilityFailing:  mapTopRow(topEligibilityFailing.rows as TopRow[]),
        },
      });
    } catch (err: any) {
      return res.status(500).json({ message: "system-health query failed", error: err.message });
    }
  });

  // ── GET /api/admin/assets/:id/invariant-status ─────────────────────────────
  // Returns the full Terminal eligibility diagnostic for a single asset.
  app.get("/api/admin/assets/:id/invariant-status", isAdminOnly, async (req, res) => {
    try {
      const assetId = parseInt(req.params.id, 10);
      if (isNaN(assetId) || assetId <= 0) {
        return res.status(400).json({ message: "Invalid asset id" });
      }

      const result = await evaluateTerminalEligibility(assetId);
      if (!result) {
        return res.status(404).json({ message: `Asset ${assetId} not found` });
      }

      return res.json(result);
    } catch (err: any) {
      return res.status(500).json({ message: "invariant-status failed", error: err.message });
    }
  });

  // ── GET /api/admin/reconciler/log ──────────────────────────────────────────
  // Returns the latest structured reconciler action log from the in-memory buffer.
  app.get("/api/admin/reconciler/log", isAdminOnly, async (req, res) => {
    try {
      const limit  = Math.min(parseInt(String(req.query.limit ?? "100"), 10), 200);
      const entries = getReconcilerLog(isNaN(limit) ? 100 : limit);
      return res.json({
        count:   entries.length,
        entries,
      });
    } catch (err: any) {
      return res.status(500).json({ message: "reconciler/log failed", error: err.message });
    }
  });
}

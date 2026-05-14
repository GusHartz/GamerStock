import type { Express, RequestHandler } from "express";
import { db } from "../../db";
import { storage } from "../../storage";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { users, accessRequests, passwordResetTokens } from "@shared/schema";
import { eq, and, or, sql as sqlExpr } from "drizzle-orm";
import { authorizationService } from "./services/authorization-service";
import { createWalletsForUser, ensureWalletsExist } from "../wallet/service";

const isAuthenticated: RequestHandler = (req: any, res, next) => {
  if (req.session?.isAdmin || req.session?.userId) return next();
  if (typeof req.isAuthenticated === "function" && req.isAuthenticated()) return next();
  return res.status(401).json({ message: "Unauthorized" });
};

export function registerIdentityRoutes(app: Express): void {
  // ============================
  // IDENTITY ROUTES
  // ============================
  //  User Auth endpoints (signup / login / logout / me)

  app.post("/api/auth/signup", async (req: any, res) => {
    try {
      const { name, displayName, email, password, gamesSelected, gamesOther } = req.body;
      if (!name || !displayName || !email || !password) {
        return res.status(400).json({ message: "name, displayName, email and password are required" });
      }
      if (password.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters" });
      }
      const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
      if (existing) {
        return res.status(409).json({ message: "An account with that email already exists" });
      }
      const passwordHash = await bcrypt.hash(password, 12);
      const [newUser] = await db
        .insert(users)
        .values({
          email,
          firstName: name,
          displayName,
          passwordHash,
          gamesSelected: Array.isArray(gamesSelected) ? gamesSelected : [],
          gamesOther: gamesOther || null,
          role: "user",
          emailVerified: false,
        })
        .returning();
      // Ensure the new user has a portfolio (1,000 GS$ starting balance — Phase 1)
      const existing_portfolio = await storage.getPortfolioByUserId(newUser.id);
      if (!existing_portfolio) {
        await storage.createPortfolio({ userId: newUser.id, balance: "1000.00" });
      }
      // Initialize GS$ and USDC wallets (seeds 1,000 GS$ on first creation)
      await createWalletsForUser(newUser.id).catch((e) =>
        console.error("[Wallet] Failed to init wallets for new user:", e),
      );
      req.session.userId = newUser.id;
      req.session.userDisplayName = newUser.displayName || displayName;
      req.session.userEmail = newUser.email || email;
      req.session.userRole = newUser.role || "user";
      return res.json({ success: true, user: { id: newUser.id, displayName: newUser.displayName, email: newUser.email } });
    } catch (err) {
      console.error("[AUTH] Signup error:", err);
      return res.status(500).json({ message: "Failed to create account" });
    }
  });

  app.post("/api/auth/login", async (req: any, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }

      // Accept email OR displayName (case-insensitive lookup)
      const login = email.trim().toLowerCase();
      const [user] = await db
        .select()
        .from(users)
        .where(
          or(
            sqlExpr`lower(${users.email}) = ${login}`,
            sqlExpr`lower(${users.displayName}) = ${login}`,
          )
        )
        .limit(1);

      if (!user) {
        console.warn(`[AUTH/Login] FAIL — no user found for login="${login}"`);
        return res.status(401).json({ message: "Invalid email or password" });
      }
      if (!user.passwordHash) {
        console.warn(`[AUTH/Login] FAIL — userId=${user.id} has no password hash (admin-only account or social login)`);
        return res.status(401).json({ message: "Invalid email or password" });
      }
      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        console.warn(`[AUTH/Login] FAIL — wrong password for userId=${user.id} email="${user.email}"`);
        return res.status(401).json({ message: "Invalid email or password" });
      }
      if (user.status === "blocked") {
        console.warn(`[AUTH/Login] BLOCKED — userId=${user.id} email="${user.email}"`);
        return res.status(403).json({ message: "Your account has been suspended. Please contact support." });
      }
      if (user.status === "deleted") {
        console.warn(`[AUTH/Login] DELETED — userId=${user.id} email="${user.email}"`);
        return res.status(403).json({ message: "This account no longer exists." });
      }
      if (user.status === "pending_access") {
        console.warn(`[AUTH/Login] PENDING — userId=${user.id} email="${user.email}"`);
        return res.status(403).json({ message: "Your access request is pending review." });
      }

      // Ensure portfolio exists (only creates if missing — existing users are untouched)
      const existing_portfolio = await storage.getPortfolioByUserId(user.id);
      if (!existing_portfolio) {
        await storage.createPortfolio({ userId: user.id, balance: "1000.00" });
      }
      // Backfill wallets for existing users who predate the wallet system
      ensureWalletsExist(user.id).catch((e) =>
        console.error("[Wallet] Backfill failed at login for userId:", user.id, e),
      );

      // Update last login timestamp
      await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

      req.session.userId = user.id;
      req.session.userDisplayName = user.displayName || user.firstName || email;
      req.session.userEmail = user.email || email;
      req.session.userRole = user.role || "user";
      req.session.mustChangePassword = user.mustChangePassword ?? false;
      if (user.role === "admin") req.session.isAdmin = true;

      // Explicitly save session before responding — required when saveUninitialized=false
      // to ensure the session is persisted to the store before the client reads it.
      await new Promise<void>((resolve, reject) => {
        req.session.save((err: any) => { if (err) reject(err); else resolve(); });
      });

      const mustChange = user.mustChangePassword ?? false;
      console.log(`[AUTH/Login] SUCCESS — userId=${user.id} email="${user.email}" role=${user.role} mustChangePassword=${mustChange}`);
      if (mustChange) {
        console.log(`[AUTH/Login] → mustChangePassword=true: user will be redirected to force-change screen`);
      }
      return res.json({
        success: true,
        user: { id: user.id, displayName: req.session.userDisplayName, email: user.email },
        mustChangePassword: mustChange,
      });
    } catch (err) {
      console.error("[AUTH] Login error:", err);
      return res.status(500).json({ message: "Login failed" });
    }
  });

  app.post("/api/auth/logout", (req: any, res) => {
    req.session.destroy(() => {});
    res.json({ success: true });
  });

  app.get("/api/auth/me", async (req: any, res) => {
    // Admin panel super-user session (env-var based login) — always trusted
    if (req.session?.isAdmin && !req.session?.userId) {
      return res.json({
        user: {
          id: "admin",
          displayName: req.session.adminUsername || "Admin",
          email: process.env.ADMIN_BOOTSTRAP_EMAIL || "",
          role: "admin",
        },
      });
    }

    if (req.session?.userId) {
      try {
        // Always hit the DB so the role reflects the current value, not the
        // stale value that was snapshotted into the session at login time.
        const dbUser = await storage.getUser(req.session.userId);

        if (!dbUser || dbUser.status === "deleted") {
          // User was deleted after logging in — clear session and reject
          req.session.destroy(() => {});
          return res.status(401).json({ user: null });
        }

        const freshRole: string = dbUser.role || "user";

        // Sync session so that isAdminOnly middleware stays in sync without
        // requiring a re-login after a role change.
        if (req.session.userRole !== freshRole) {
          console.log(`[Auth/me] Role sync for userId=${req.session.userId}: session="${req.session.userRole}" → db="${freshRole}"`);
          req.session.userRole = freshRole;
          req.session.isAdmin = freshRole === "admin" || !!req.session.isAdmin;
          req.session.save(() => {});
        }

        const capabilities = await authorizationService.getCapabilities(dbUser.id).catch(() => []);

        return res.json({
          user: {
            id: dbUser.id,
            displayName: dbUser.displayName || req.session.userDisplayName || dbUser.email?.split("@")[0] || "Trader",
            email: dbUser.email,
            role: freshRole,
            mustChangePassword: dbUser.mustChangePassword ?? false,
            status: dbUser.status,
          },
          capabilities,
        });
      } catch (err) {
        console.error("[Auth/me] DB lookup error:", err);
        // Fallback to session data if DB is temporarily unavailable
        return res.json({
          user: {
            id: req.session.userId,
            displayName: req.session.userDisplayName,
            email: req.session.userEmail,
            role: req.session.userRole || "user",
          },
        });
      }
    }

    return res.status(401).json({ user: null });
  });

  // ─── Public: Submit Access Request ───────────────────────────────────────────
  app.post("/api/access-requests", async (req, res) => {
    try {
      const { fullName, email, region, primaryGame, usernameInterest, note } = req.body;
      if (!fullName?.trim() || !email?.trim()) {
        return res.status(400).json({ message: "Full name and email are required" });
      }
      const emailLower = email.trim().toLowerCase();
      // Check for existing pending request
      const existing = await db.select().from(accessRequests)
        .where(and(
          sqlExpr`lower(${accessRequests.email}) = ${emailLower}`,
          eq(accessRequests.status, "pending")
        )).limit(1);
      if (existing.length > 0) {
        return res.status(409).json({ message: "An access request with this email is already pending." });
      }
      await db.insert(accessRequests).values({
        fullName: fullName.trim(),
        email: emailLower,
        region: region?.trim() || null,
        primaryGame: primaryGame?.trim() || null,
        usernameInterest: usernameInterest?.trim() || null,
        note: note?.trim() || null,
        status: "pending",
      });
      console.log(`[AccessRequest] New request from ${emailLower}`);
      return res.json({ success: true });
    } catch (e: any) {
      console.error("[AccessRequest] Error:", e);
      res.status(500).json({ message: "Failed to submit request" });
    }
  });

  // ─── Forgot Password ──────────────────────────────────────────────────────────
  app.post("/api/auth/forgot-password", async (req, res) => {
    // Always return generic success to avoid email enumeration
    const GENERIC = { success: true, message: "If that email is registered, a reset link has been generated." };
    try {
      const email = req.body?.email?.trim().toLowerCase();
      if (!email) return res.json(GENERIC);

      const [user] = await db.select().from(users)
        .where(sqlExpr`lower(${users.email}) = ${email}`)
        .limit(1);

      if (!user || user.status === "blocked" || user.status === "deleted") {
        return res.json(GENERIC);
      }

      // Generate a secure random token; only store the SHA-256 hash
      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      // Invalidate existing tokens for this user
      await db.update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(and(
          eq(passwordResetTokens.userId, user.id),
          sqlExpr`${passwordResetTokens.usedAt} IS NULL`
        ));

      await db.insert(passwordResetTokens).values({
        userId: user.id,
        tokenHash,
        expiresAt,
      });

      // Reset link is intentionally not logged or returned. In production this would
      // be sent via email; the raw token is single-use and SHA-256-hashed in the DB.
      console.log(`[ForgotPassword] Reset link generated for user`);

      return res.json(GENERIC);
    } catch (e: any) {
      console.error("[ForgotPassword] Error:", e);
      return res.json(GENERIC);
    }
  });

  // ─── Reset Password (consume token) ──────────────────────────────────────────
  app.post("/api/auth/reset-password", async (req, res) => {
    try {
      const { token, password } = req.body;
      if (!token || !password) {
        return res.status(400).json({ message: "Token and password are required" });
      }
      if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
        return res.status(400).json({ message: "Password must be at least 8 characters and include a letter and a number" });
      }

      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      const [tokenRow] = await db.select().from(passwordResetTokens)
        .where(eq(passwordResetTokens.tokenHash, tokenHash))
        .limit(1);

      if (!tokenRow) return res.status(400).json({ message: "Invalid or expired reset link" });
      if (tokenRow.usedAt) return res.status(400).json({ message: "This reset link has already been used" });
      if (new Date() > tokenRow.expiresAt) return res.status(400).json({ message: "This reset link has expired. Please request a new one." });

      const hash = await bcrypt.hash(password, 12);
      await db.update(users).set({ passwordHash: hash, mustChangePassword: false }).where(eq(users.id, tokenRow.userId));
      await db.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.id, tokenRow.id));

      console.log(`[ResetPassword] Password reset for userId=${tokenRow.userId}`);
      return res.json({ success: true });
    } catch (e: any) {
      console.error("[ResetPassword] Error:", e);
      res.status(500).json({ message: "Failed to reset password" });
    }
  });

  // ─── Validate Reset Token (GET — for page load check) ────────────────────────
  app.get("/api/auth/reset-password/validate", async (req, res) => {
    try {
      const { token } = req.query;
      if (!token || typeof token !== "string") return res.status(400).json({ valid: false, message: "No token provided" });

      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      const [tokenRow] = await db.select().from(passwordResetTokens)
        .where(eq(passwordResetTokens.tokenHash, tokenHash)).limit(1);

      if (!tokenRow) return res.json({ valid: false, message: "Invalid reset link" });
      if (tokenRow.usedAt) return res.json({ valid: false, message: "This link has already been used" });
      if (new Date() > tokenRow.expiresAt) return res.json({ valid: false, message: "This link has expired" });

      return res.json({ valid: true });
    } catch (e: any) {
      res.status(500).json({ valid: false, message: "Error validating token" });
    }
  });

  // ─── Change Password (authenticated user) ────────────────────────────────────
  app.post("/api/auth/change-password", async (req: any, res) => {
    const userId = req.session?.userId;
    if (!userId) return res.status(401).json({ message: "Not authenticated" });
    try {
      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ message: "Current and new password are required" });
      }
      if (newPassword.length < 8 || !/[a-zA-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
        return res.status(400).json({ message: "New password must be at least 8 characters with a letter and a number" });
      }

      const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!user || !user.passwordHash) return res.status(400).json({ message: "Account not found" });

      const valid = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!valid) return res.status(400).json({ message: "Current password is incorrect" });

      const hash = await bcrypt.hash(newPassword, 12);
      await db.update(users).set({ passwordHash: hash, mustChangePassword: false }).where(eq(users.id, userId));
      req.session.mustChangePassword = false;
      req.session.save(() => {});

      console.log(`[ChangePassword] Password changed for userId=${userId}`);
      return res.json({ success: true });
    } catch (e: any) {
      console.error("[ChangePassword] Error:", e);
      res.status(500).json({ message: "Failed to change password" });
    }
  });

  // ─── Force Change Password (no current password required) ────────────────────
  // Used exclusively for the must_change_password first-login flow.
  // The user already proved identity by logging in — no need to re-enter temp pwd.
  app.post("/api/auth/force-change-password", async (req: any, res) => {
    const userId = req.session?.userId;
    if (!userId) {
      console.warn(`[ForceChangePwd] Attempt without session`);
      return res.status(401).json({ message: "Not authenticated" });
    }
    try {
      const { newPassword } = req.body;
      if (!newPassword) {
        return res.status(400).json({ message: "New password is required" });
      }
      if (newPassword.length < 8 || !/[a-zA-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
        return res.status(400).json({ message: "Password must be at least 8 characters with a letter and a number" });
      }

      // Re-verify from DB that mustChangePassword is actually set (session safety)
      const [user] = await db.select({ mustChangePassword: users.mustChangePassword }).from(users).where(eq(users.id, userId)).limit(1);
      if (!user) {
        console.warn(`[ForceChangePwd] User not found userId=${userId}`);
        return res.status(404).json({ message: "Account not found" });
      }
      if (!user.mustChangePassword) {
        console.warn(`[ForceChangePwd] Attempt by userId=${userId} who does not have mustChangePassword set`);
        return res.status(403).json({ message: "Password change is not required for this account" });
      }

      const hash = await bcrypt.hash(newPassword, 12);
      await db.update(users).set({ passwordHash: hash, mustChangePassword: false }).where(eq(users.id, userId));
      req.session.mustChangePassword = false;
      await new Promise<void>((resolve, reject) => req.session.save((err: any) => err ? reject(err) : resolve()));

      console.log(`[ForceChangePwd] Initial password set for userId=${userId} — mustChangePassword cleared`);
      return res.json({ success: true });
    } catch (e: any) {
      console.error("[ForceChangePwd] Error:", e);
      res.status(500).json({ message: "Failed to set new password" });
    }
  });
}

// ─── Identity Engine v2 — Session Service ─────────────────────────────────────
// Manages the session lifecycle: population, clearing, and token generation.
// Keeps session write logic in one place — routes call these helpers.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from "crypto";
import { sessionRepository } from "../repositories/session-repository";

export const sessionService = {
  populateFromUser(
    session: Record<string, any>,
    user: {
      id: string;
      email: string | null;
      displayName: string | null;
      role: string;
      mustChangePassword: boolean;
    }
  ): void {
    session.userId = user.id;
    session.userDisplayName = user.displayName || user.email?.split("@")[0] || "Trader";
    session.userEmail = user.email;
    session.userRole = user.role;
    session.mustChangePassword = user.mustChangePassword;
    if (user.role === "admin") session.isAdmin = true;
  },

  clear(session: Record<string, any>): Promise<void> {
    return new Promise((resolve) => session.destroy(() => resolve()));
  },

  save(session: Record<string, any>): Promise<void> {
    return new Promise<void>((resolve, reject) =>
      session.save((err: any) => (err ? reject(err) : resolve()))
    );
  },

  // ── Password reset tokens ──────────────────────────────────────────────────

  async issueResetToken(userId: string): Promise<string> {
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Invalidate any existing unused tokens before issuing new one
    await sessionRepository.invalidateResetTokensForUser(userId);
    await sessionRepository.createResetToken({ userId, tokenHash, expiresAt });

    return rawToken;
  },

  hashToken(rawToken: string): string {
    return crypto.createHash("sha256").update(rawToken).digest("hex");
  },
};

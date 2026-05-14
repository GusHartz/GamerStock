// ─── Identity Engine v2 — Session / Token Repository ──────────────────────────
// Handles password-reset token lifecycle.
// Sessions themselves are managed by express-session + pg store (not here).
// ─────────────────────────────────────────────────────────────────────────────
import { eq, and, sql as sqlExpr } from "drizzle-orm";
import { db } from "../../../db";
import { passwordResetTokens } from "@shared/schema";

export const sessionRepository = {
  async invalidateResetTokensForUser(userId: string): Promise<void> {
    await db.update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(passwordResetTokens.userId, userId),
          sqlExpr`${passwordResetTokens.usedAt} IS NULL`,
        )
      );
  },

  async createResetToken(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    await db.insert(passwordResetTokens).values(input);
  },

  async findResetToken(tokenHash: string): Promise<typeof passwordResetTokens.$inferSelect | null> {
    const [row] = await db.select().from(passwordResetTokens)
      .where(eq(passwordResetTokens.tokenHash, tokenHash))
      .limit(1);
    return row ?? null;
  },

  async consumeResetToken(tokenId: number): Promise<void> {
    await db.update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(eq(passwordResetTokens.id, tokenId));
  },
};

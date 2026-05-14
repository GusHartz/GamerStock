// ─── Identity Engine v2 — Credential Repository ───────────────────────────────
// Handles password hash storage/retrieval.
// Credentials are stored inline on the users row (passwordHash column).
// This repository is a focused accessor — it never returns full user objects.
// ─────────────────────────────────────────────────────────────────────────────
import { eq } from "drizzle-orm";
import { db } from "../../../db";
import { users } from "@shared/schema";

export const credentialRepository = {
  async getHashForUser(userId: string): Promise<string | null> {
    const [row] = await db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row?.passwordHash ?? null;
  },

  async setHash(userId: string, passwordHash: string): Promise<void> {
    await db.update(users)
      .set({ passwordHash, mustChangePassword: false })
      .where(eq(users.id, userId));
  },
};

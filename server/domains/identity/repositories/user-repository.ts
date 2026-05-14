// ─── Identity Engine v2 — User Repository ─────────────────────────────────────
// Low-level DB access for user records.
// All queries go through Drizzle — never raw SQL strings.
// ─────────────────────────────────────────────────────────────────────────────
import { eq, sql as sqlExpr } from "drizzle-orm";
import { db } from "../../../db";
import { users } from "@shared/schema";
import type { IdentityUser } from "../types/identity.types";

function toIdentityUser(row: typeof users.$inferSelect): IdentityUser {
  return {
    id: row.id,
    email: row.email ?? null,
    displayName: row.displayName ?? null,
    role: row.role ?? "user",
    status: row.status ?? "active",
    mustChangePassword: row.mustChangePassword ?? false,
  };
}

export const userRepository = {
  async findById(id: string): Promise<IdentityUser | null> {
    const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return row ? toIdentityUser(row) : null;
  },

  async findByEmail(email: string): Promise<IdentityUser | null> {
    const normalized = email.trim().toLowerCase();
    const [row] = await db.select().from(users)
      .where(sqlExpr`lower(${users.email}) = ${normalized}`)
      .limit(1);
    return row ? toIdentityUser(row) : null;
  },

  async findByEmailOrDisplayName(login: string): Promise<(typeof users.$inferSelect) | null> {
    const normalized = login.trim().toLowerCase();
    const [row] = await db.select().from(users)
      .where(sqlExpr`lower(${users.email}) = ${normalized} OR lower(${users.displayName}) = ${normalized}`)
      .limit(1);
    return row ?? null;
  },

  async emailExists(email: string): Promise<boolean> {
    const normalized = email.trim().toLowerCase();
    const [row] = await db
      .select({ id: users.id })
      .from(users)
      .where(sqlExpr`lower(${users.email}) = ${normalized}`)
      .limit(1);
    return !!row;
  },

  async create(input: {
    email: string;
    firstName: string;
    displayName: string;
    passwordHash: string;
    gamesSelected: string[];
    gamesOther: string | null;
  }): Promise<typeof users.$inferSelect> {
    const [newUser] = await db.insert(users).values({
      email: input.email,
      firstName: input.firstName,
      displayName: input.displayName,
      passwordHash: input.passwordHash,
      gamesSelected: input.gamesSelected,
      gamesOther: input.gamesOther,
      role: "user",
      emailVerified: false,
      status: "active",
    }).returning();
    return newUser;
  },

  async updateLastLogin(id: string): Promise<void> {
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, id));
  },

  async updatePassword(id: string, passwordHash: string): Promise<void> {
    await db.update(users)
      .set({ passwordHash, mustChangePassword: false })
      .where(eq(users.id, id));
  },

  async syncRole(id: string, role: string): Promise<void> {
    await db.update(users).set({ role }).where(eq(users.id, id));
  },
};

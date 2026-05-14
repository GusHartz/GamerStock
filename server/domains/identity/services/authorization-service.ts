// ─── Identity Engine v2 — Authorization Service ───────────────────────────────
// Computes runtime capabilities for a user based on their claims and role.
//
// DESIGN DECISION: Capabilities, not a new "player" role.
// ──────────────────────────────────────────────────────────────────────────────
// Adding a "player" role would require role-check changes across every domain's
// middleware. Instead, we use a `capabilities` array returned by /api/auth/me
// that is computed fresh on each request (no session staleness risk).
//
// An approved player claim grants: "player_profile_control"
// Future claims/verifications will grant additional capabilities.
//
// Existing code that ignores capabilities is unaffected — fully backward-compat.
// ─────────────────────────────────────────────────────────────────────────────
import { eq, and } from "drizzle-orm";
import { db } from "../../../db";
import { playerClaims } from "@shared/schema";
import type { Capability } from "../types/identity.types";

export const authorizationService = {
  async getCapabilities(userId: string): Promise<Capability[]> {
    const capabilities: Capability[] = [];

    const [approvedClaim] = await db
      .select({ id: playerClaims.id })
      .from(playerClaims)
      .where(
        and(
          eq(playerClaims.userId, userId),
          eq(playerClaims.claimStatus, "approved"),
        )
      )
      .limit(1);

    if (approvedClaim) {
      capabilities.push("player_profile_control");
    }

    return capabilities;
  },
};

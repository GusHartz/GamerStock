// ─── Identity Engine v2 — Auth Service ────────────────────────────────────────
// Orchestrates signup and login flows using lower-level repositories and services.
// Route handlers call this; they do not contain business logic themselves.
// ─────────────────────────────────────────────────────────────────────────────
import { userRepository } from "../repositories/user-repository";
import { credentialService } from "./credential-service";
import { storage } from "../../../storage";
import type { SignupInput, LoginInput } from "../types/identity.types";

export const authService = {
  async signup(input: SignupInput): Promise<{
    success: boolean;
    user?: { id: string; displayName: string | null; email: string | null };
    error?: string;
  }> {
    if (!input.name || !input.displayName || !input.email || !input.password) {
      return { success: false, error: "name, displayName, email and password are required" };
    }

    const pwCheck = credentialService.validatePasswordStrength(input.password);
    if (!pwCheck.valid) {
      return { success: false, error: pwCheck.message };
    }

    const exists = await userRepository.emailExists(input.email);
    if (exists) {
      return { success: false, error: "An account with that email already exists" };
    }

    const passwordHash = await credentialService.hash(input.password);
    const newUser = await userRepository.create({
      email: input.email,
      firstName: input.name,
      displayName: input.displayName,
      passwordHash,
      gamesSelected: Array.isArray(input.gamesSelected) ? input.gamesSelected : [],
      gamesOther: input.gamesOther ?? null,
    });

    // Ensure portfolio exists (1,000 GS$ starting balance — Phase 1)
    const existingPortfolio = await storage.getPortfolioByUserId(newUser.id);
    if (!existingPortfolio) {
      await storage.createPortfolio({ userId: newUser.id, balance: "1000.00" });
    }

    return {
      success: true,
      user: { id: newUser.id, displayName: newUser.displayName, email: newUser.email },
    };
  },

  async login(input: LoginInput): Promise<{
    success: boolean;
    user?: {
      id: string;
      email: string | null;
      displayName: string | null;
      role: string;
      mustChangePassword: boolean;
      status: string | null;
    };
    error?: string;
    statusCode?: number;
  }> {
    const row = await userRepository.findByEmailOrDisplayName(input.emailOrDisplayName);
    if (!row) {
      return { success: false, error: "Invalid email or password", statusCode: 401 };
    }
    if (!row.passwordHash) {
      return { success: false, error: "Invalid email or password", statusCode: 401 };
    }

    const valid = await credentialService.verify(input.password, row.passwordHash);
    if (!valid) {
      return { success: false, error: "Invalid email or password", statusCode: 401 };
    }

    if (row.status === "blocked") {
      return { success: false, error: "Your account has been suspended. Please contact support.", statusCode: 403 };
    }
    if (row.status === "deleted") {
      return { success: false, error: "This account no longer exists.", statusCode: 403 };
    }
    if (row.status === "pending_access") {
      return { success: false, error: "Your access request is pending review.", statusCode: 403 };
    }

    // Ensure portfolio (only creates if missing — existing users are untouched)
    const existingPortfolio = await storage.getPortfolioByUserId(row.id);
    if (!existingPortfolio) {
      await storage.createPortfolio({ userId: row.id, balance: "1000.00" });
    }

    await userRepository.updateLastLogin(row.id);

    return {
      success: true,
      user: {
        id: row.id,
        email: row.email ?? null,
        displayName: row.displayName ?? row.firstName ?? null,
        role: row.role ?? "user",
        mustChangePassword: row.mustChangePassword ?? false,
        status: row.status ?? "active",
      },
    };
  },
};

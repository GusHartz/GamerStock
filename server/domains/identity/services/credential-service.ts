// ─── Identity Engine v2 — Credential Service ──────────────────────────────────
// All password hashing / verification logic lives here.
// bcrypt with 12 salt rounds — same as original implementation.
// ─────────────────────────────────────────────────────────────────────────────
import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

export const credentialService = {
  async hash(plaintext: string): Promise<string> {
    return bcrypt.hash(plaintext, SALT_ROUNDS);
  },

  async verify(plaintext: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plaintext, hash);
  },

  validatePasswordStrength(password: string): { valid: boolean; message?: string } {
    if (password.length < 8) {
      return { valid: false, message: "Password must be at least 8 characters" };
    }
    if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
      return { valid: false, message: "Password must include a letter and a number" };
    }
    return { valid: true };
  },
};

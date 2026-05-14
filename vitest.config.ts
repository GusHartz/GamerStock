import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    testTimeout: 30000,
    // S-18 pattern: TS entry points need explicit dotenv post-Replit migration.
    // Without this, server/db.ts:7-11 throws "DATABASE_URL must be set" before
    // any test runs.
    setupFiles: ["dotenv/config"],
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "shared"),
      "@": path.resolve(__dirname, "client/src"),
    },
  },
});

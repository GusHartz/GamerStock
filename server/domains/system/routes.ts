import type { Express } from "express";

export function registerSystemRoutes(app: Express): void {
  // ============================
  // SYSTEM ROUTES
  // ============================

  app.get("/api/version", (_req, res) => {
    res.json({
      buildId: process.env.BUILD_ID || "dev",
      buildTime: process.env.BUILD_TIME || null,
      environment: process.env.NODE_ENV || "development",
    });
  });

  app.get("/api/market/health", (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });
}

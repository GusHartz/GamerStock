import type { Express } from "express";

export function registerNewsRoutes(app: Express): void {
  // ============================
  // NEWS ROUTES
  // ============================

  // GET /api/news/latest — returns up to 25 classified esports news items
  app.get("/api/news/latest", async (_req, res) => {
    try {
      const { getLatestNews } = await import("../../services/newsService");
      const { items, fromFallback } = await getLatestNews(25);
      res.setHeader("Cache-Control", "no-cache, must-revalidate");
      res.json({ items, fromFallback, count: items.length });
    } catch (err: any) {
      console.error("[News] Error:", err?.message);
      res.status(500).json({ items: [], fromFallback: true, count: 0 });
    }
  });

  // GET /api/news/pulse — active news pulses with optional ?game= filter
  app.get("/api/news/pulse", async (req, res) => {
    try {
      const { getActiveNewsPulses, getAggregatePulse } = await import("../../services/newsService");
      const game = typeof req.query.game === "string" ? req.query.game : null;
      const pulses = getActiveNewsPulses(game);
      const aggregate = getAggregatePulse(game);
      res.setHeader("Cache-Control", "no-store");
      res.json({ pulses, aggregate, count: pulses.length });
    } catch (err: any) {
      console.error("[NewsPulse] Error:", err?.message);
      res.status(500).json({ pulses: [], aggregate: null, count: 0 });
    }
  });
}

import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  // SPA fallback — named wildcard required for path-to-regexp v8 (Express 5 / newer Express 4).
  // Registered after all API routes so Express always resolves API handlers first.
  // Extra guard: if somehow an /api path reaches here, return JSON 404 instead of HTML.
  app.get("/{*path}", (req, res) => {
    if (req.path.startsWith("/api")) {
      return res.status(404).json({ message: "API route not found" });
    }
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}

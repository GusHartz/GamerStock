import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { testDbConnection } from "./db";
import { attachMarketWs } from "./ws/market-ws";
import { registerAllHandlers } from "./events";
import { registerWeb3Bridge } from "./web3";
import { startSchedulers } from "./scheduler/index";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

// Health check registered synchronously — responds immediately at any point in startup
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, env: process.env.NODE_ENV || "unknown", time: new Date().toISOString() });
});

// Paths where the response body is NEVER logged (auth/credentials/PII).
// Matched by prefix — covers /api/admin/users, /api/admin/users/:id, etc.
const NO_BODY_LOG_PATHS = [
  "/api/auth/login",
  "/api/auth/signup",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
  "/api/auth/me",
  "/api/auth/change-password",
  "/api/auth/force-change-password",
  "/api/admin/users",
  "/api/admin/login",
  "/api/admin/auth/reset-password",
  "/api/admin/me",
  "/api/wallets",
];

// Keys redacted in any other endpoint where body IS logged.
const REDACT_KEYS = new Set([
  "password",
  "passwordHash",
  "password_hash",
  "_devResetLink",
  "resetToken",
  "token",
  "refreshToken",
  "accessToken",
  "apiKey",
  "secret",
  "bootstrapSecret",
  "newPassword",
  "currentPassword",
  "tokenHash",
]);

function redactDeep(obj: any): any {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(redactDeep);
  const out: any = {};
  for (const [k, v] of Object.entries(obj)) {
    if (REDACT_KEYS.has(k)) {
      out[k] = "[REDACTED]";
    } else {
      out[k] = redactDeep(v);
    }
  }
  return out;
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: any = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (!path.startsWith("/api")) return;

    let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;

    const skipBody = NO_BODY_LOG_PATHS.some((p) => path.startsWith(p));
    if (!skipBody && capturedJsonResponse !== undefined) {
      try {
        const redacted = redactDeep(capturedJsonResponse);
        let bodyStr = JSON.stringify(redacted);
        if (bodyStr.length > 500) {
          bodyStr = bodyStr.slice(0, 497) + "...";
        }
        logLine += ` :: ${bodyStr}`;
      } catch {
        // ignore stringify errors
      }
    }

    log(logLine);
  });

  next();
});

(async () => {
  console.log("[BOOT] GamerStock server starting...");
  console.log(`[BOOT] NODE_ENV  : ${process.env.NODE_ENV || "unknown"}`);
  console.log(`[BOOT] BUILD_ID  : ${process.env.BUILD_ID || "dev"}`);
  console.log(`[BOOT] BUILD_TIME: ${process.env.BUILD_TIME || "unknown"}`);
  console.log(`[BOOT] RIOT_API_KEY present: ${!!process.env.RIOT_API_KEY}`);

  // DB connection check — non-fatal, logged but won't block startup
  try {
    await testDbConnection();
  } catch (err: any) {
    console.error("[BOOT] DB connection check failed (non-fatal):", err?.message || err);
  }

  attachMarketWs(httpServer);
  registerAllHandlers();
  registerWeb3Bridge();
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;

    // Server-side log keeps full error (stack, SQL fragments, etc.)
    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    // Client-side message: only 4xx (intentional/validation) keep err.message.
    // 5xx in production return a generic message to avoid leaking SQL fragments,
    // internal paths, Drizzle error verbosity, ECONNREFUSED hosts, etc.
    const message =
      process.env.NODE_ENV === "production" && status >= 500
        ? "Internal Server Error"
        : err.message || "Internal Server Error";

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
    },
    () => {
      log(`serving on port ${port}`);
      console.log("[BOOT] HTTP server listening on port " + port);

      // Delegate all scheduler/job startup to the orchestration module.
      // See server/scheduler/index.ts for the full list and environment guards.
      startSchedulers().catch((e: any) => {
        console.error("[BOOT] startSchedulers() threw unexpectedly (non-fatal):", e?.message || e);
      });
    },
  );
})();

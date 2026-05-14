import session from "express-session";
import connectPg from "connect-pg-simple";
import createMemoryStore from "memorystore";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

let cached: ReturnType<typeof session> | null = null;

export function getSession(): ReturnType<typeof session> {
  if (cached) return cached;

  if (!process.env.SESSION_SECRET) {
    throw new Error(
      "SESSION_SECRET is required. Copy .env.example to .env and fill it in.",
    );
  }

  let store: session.Store;
  if (process.env.DATABASE_URL) {
    const PgStore = connectPg(session);
    store = new PgStore({
      conString: process.env.DATABASE_URL,
      createTableIfMissing: false,
      // Preserves the pre-existing replitAuth.ts behaviour of passing ms here;
      // changing units would silently alter session lifetimes in deployed envs.
      ttl: SESSION_TTL_MS,
      tableName: "sessions",
    });
  } else {
    const MemoryStore = createMemoryStore(session);
    store = new MemoryStore({
      checkPeriod: 24 * 60 * 60 * 1000,
    });
  }

  cached = session({
    secret: process.env.SESSION_SECRET,
    store,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: SESSION_TTL_MS,
      path: "/",
    },
  });

  return cached;
}

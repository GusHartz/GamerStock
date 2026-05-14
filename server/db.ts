import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// B2.9-6 — pool hardening: defaults are unsafe in production-shape traffic.
//
// Why each option:
//   max                                — cap concurrent connections (default 10
//                                        is fine for now; bump when scaling).
//   idleTimeoutMillis                  — recycle stale idle conns (Postgres can
//                                        drop them silently behind firewalls/LBs).
//   connectionTimeoutMillis            — bound new-connection attempts so the
//                                        server fails fast when DB is down.
//   statement_timeout                  — server-side kill switch for any query
//                                        running >30s (defends against B2.7-3
//                                        path-to-regexp DoS and AMM math hang).
//   idle_in_transaction_session_timeout — kill abandoned transactions that hold
//                                        locks (e.g., trade execution that died).
//   query_timeout                      — client-side mirror of statement_timeout
//                                        so the Node process also gives up.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 30_000,
  idle_in_transaction_session_timeout: 60_000,
  query_timeout: 30_000,
});
export const db = drizzle(pool, { schema });

export async function testDbConnection() {
  try {
    await pool.query("SELECT 1");
    console.log("[BOOT] Database connection: OK");
    return true;
  } catch (err) {
    console.error("[BOOT] Database connection FAILED:", err);
    return false;
  }
}

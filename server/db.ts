import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
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

import { db } from "./db";
import { appConfig } from "@shared/schema";
import { eq } from "drizzle-orm";

export type MarketMode = "REAL_RIOT_NA1" | "SANDBOX";

let _cachedMode: MarketMode | null = null;

export async function getMarketMode(): Promise<MarketMode> {
  if (_cachedMode !== null) return _cachedMode;
  const rows = await db.select().from(appConfig).where(eq(appConfig.key, "market_mode")).limit(1);
  const mode: MarketMode =
    rows.length === 0 ? "REAL_RIOT_NA1" : rows[0].value === "SANDBOX" ? "SANDBOX" : "REAL_RIOT_NA1";
  _cachedMode = mode;
  return mode;
}

export async function setMarketMode(mode: MarketMode): Promise<void> {
  await db
    .insert(appConfig)
    .values({ key: "market_mode", value: mode })
    .onConflictDoUpdate({ target: appConfig.key, set: { value: mode, updatedAt: new Date() } });
  _cachedMode = mode;
}

// ─── Riot API Key ─────────────────────────────────────────────────────────────

let _cachedRiotKey: string | null | undefined = undefined;

// Priority: admin DB key → RIOT_API_KEY env var
export async function getRiotApiKey(): Promise<string | null> {
  if (_cachedRiotKey !== undefined) return _cachedRiotKey;
  const rows = await db.select().from(appConfig).where(eq(appConfig.key, "riot_api_key")).limit(1);
  const dbKey = rows.length > 0 ? (rows[0].value || null) : null;
  _cachedRiotKey = dbKey || process.env.RIOT_API_KEY || null;
  return _cachedRiotKey;
}

// Resolve what source a key will come from (without using cache)
export async function getRiotApiKeyWithSource(): Promise<{ key: string | null; source: "admin" | "env" | "none" }> {
  const rows = await db.select().from(appConfig).where(eq(appConfig.key, "riot_api_key")).limit(1);
  const dbKey = rows.length > 0 ? (rows[0].value || null) : null;
  if (dbKey) return { key: dbKey, source: "admin" };
  const envKey = process.env.RIOT_API_KEY || null;
  if (envKey) return { key: envKey, source: "env" };
  return { key: null, source: "none" };
}

export async function setRiotApiKey(key: string): Promise<void> {
  await db
    .insert(appConfig)
    .values({ key: "riot_api_key", value: key })
    .onConflictDoUpdate({ target: appConfig.key, set: { value: key, updatedAt: new Date() } });
  _cachedRiotKey = key;
  // Reset test state when key changes
  _keyTestState = null;
  console.log(`[RiotKey] Admin key updated — len=${key.length} prefix=${key.slice(0, 8)}`);
}

export function clearRiotApiKeyCache(): void {
  _cachedRiotKey = undefined;
}

// ─── Key Test State ───────────────────────────────────────────────────────────

export type KeyTestState = {
  valid: boolean;
  error?: string;
  testedAt: Date;
  source: "admin" | "env" | "none";
  keyPreview: string;
};

let _keyTestState: KeyTestState | null = null;

export function setKeyTestState(state: KeyTestState): void {
  _keyTestState = state;
}

export function getKeyTestState(): KeyTestState | null {
  return _keyTestState;
}

// ─── Key Sanitization ─────────────────────────────────────────────────────────

export function sanitizeRiotApiKey(raw: string): { key: string; error?: string } {
  const key = raw.replace(/[\s\r\n]+/g, "");
  if (!key) return { key: "", error: "API key is empty" };
  if (!key.startsWith("RGAPI-")) return { key, error: "Key must start with RGAPI-" };
  if (key.length < 20) return { key, error: "Key is too short to be valid" };
  return { key };
}

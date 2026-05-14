/**
 * Simulation — Name Generator
 *
 * Generates realistic-looking summoner names for synthetic/sandbox players.
 * Also handles the one-time migration of legacy "Player###" vault aliases.
 *
 * Moved from server/name-generator.ts — Phase 6 simulation isolation.
 * Original path kept as a re-export shim for backward compatibility.
 */

import { db } from "../../db";
import { vaults } from "@shared/schema";
import { like, sql } from "drizzle-orm";

const PREFIXES = [
  "Frost", "Void", "Arc", "Neon", "Star", "Cyber", "Shadow", "Storm",
  "Dark", "Lunar", "Jade", "Rune", "Echo", "Apex", "Crimson", "Solar",
  "Nova", "Iron", "Crystal", "Ghost", "Moon", "Ash", "Ember", "Blaze",
  "Night", "Dawn", "Steel", "Phantom", "Toxic", "Mystic", "Hyper", "Ultra",
  "Omega", "Alpha", "Sigma", "Delta", "Nexus", "Prism", "Blazing", "Frozen",
  "Silent", "Swift", "Bold", "Brave", "Wild", "Noble", "Rogue", "Savage",
  "Infernal", "Celestial", "Azure", "Scarlet", "Golden", "Silver", "Radiant",
  "Cursed", "Ancient", "Divine", "Eternal", "Chaos", "Order", "Spectral",
  "Titan", "Fallen", "Rising", "Lost", "Hollow", "Burning", "Blazing",
  "Corrupt", "Blessed", "Damned", "Ethereal", "Mythic", "Runed", "Feral",
];

const SUFFIXES = [
  "Kitsune", "Ranger", "Warden", "Viper", "Phoenix", "Reaper", "Titan",
  "Blade", "Hunter", "Seeker", "Walker", "Slayer", "Knight", "Sage",
  "Phantom", "Specter", "Pulse", "Strike", "Storm", "Bolt", "Wave",
  "Surge", "Force", "Soul", "Fate", "Doom", "Bane", "Grace", "Glory",
  "Legacy", "Oracle", "Cipher", "Rune", "Emblem", "Wraith", "Shade",
  "Drifter", "Dancer", "Singer", "Whisper", "Howler", "Stalker", "Prowler",
  "Crusher", "Breaker", "Shatter", "Caster", "Archer", "Lancer", "Fencer",
  "Duelist", "Champion", "Warrior", "Sentinel", "Guardian", "Paladin",
  "Assassin", "Invoker", "Harbinger", "Vanquisher", "Ravager", "Conqueror",
  "Zero", "Pulse", "Vector", "Nexus", "Apex", "Vanguard", "Specter",
  "Jinx", "Hex", "Brand", "Mark", "Sigil", "Totem", "Relic", "Shard",
  "Wisp", "Comet", "Prism", "Mirage", "Illusion", "Vision", "Prophet",
];

const CONNECTORS = ["", "", "", "", "_", "X", ""];

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function generateSummonerNames(count: number): string[] {
  const used = new Set<string>();
  const names: string[] = [];

  const prefixes = shuffle(PREFIXES);
  const suffixes = shuffle(SUFFIXES);

  let attempts = 0;
  while (names.length < count && attempts < count * 10) {
    attempts++;
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
    const connector = CONNECTORS[Math.floor(Math.random() * CONNECTORS.length)];

    let name = `${prefix}${connector}${suffix}`;

    if (Math.random() < 0.4) {
      const num = Math.floor(Math.random() * 900) + 1;
      name = `${name}${num}`;
    }

    if (!used.has(name) && name.length <= 20) {
      used.add(name);
      names.push(name);
    }
  }

  while (names.length < count) {
    const n = `SummonerX${names.length + 1}`;
    if (!used.has(n)) {
      used.add(n);
      names.push(n);
    }
  }

  return names;
}

export async function runAliasMigration(): Promise<void> {
  try {
    const legacy = await db
      .select({ id: vaults.id })
      .from(vaults)
      .where(like(vaults.playerAlias, "Player%"))
      .orderBy(vaults.id);

    if (legacy.length === 0) {
      console.log("[MIGRATION] No legacy Player### aliases found. Skipping.");
      return;
    }

    console.log(`[MIGRATION] Found ${legacy.length} legacy aliases. Generating new names...`);

    const names = generateSummonerNames(legacy.length);

    const chunkSize = 100;
    for (let i = 0; i < legacy.length; i += chunkSize) {
      const chunk = legacy.slice(i, i + chunkSize);
      await Promise.all(
        chunk.map((vault, j) =>
          db
            .update(vaults)
            .set({ playerAlias: names[i + j] })
            .where(sql`${vaults.id} = ${vault.id}`)
        )
      );
    }

    console.log(`[MIGRATION] Successfully renamed ${legacy.length} vaults with realistic summoner names.`);
  } catch (err) {
    console.error("[MIGRATION] Alias migration failed:", err);
  }
}

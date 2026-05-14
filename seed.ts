import "dotenv/config";
import { db } from "./server/db";
import { vaults, vaultSnapshots, positions, trades } from "./shared/schema";
import { sql } from "drizzle-orm";

const PLAYER_PREFIXES = [
  "Void", "Lunar", "Arc", "Storm", "Echo", "Shadow", "Crimson", "Frost", "Cyber", "Jade",
  "Zenith", "Neon", "Rune", "Soul", "Mystic", "Iron", "Star", "Apex", "Nova", "Dark"
];

const PLAYER_SUFFIXES = [
  "Ranger", "Kitsune", "Blade", "Warden", "Phantom", "Drifter", "Pulse", "Slayer", "Wraith", "Knight",
  "Sage", "Viper", "Oracle", "Shogun", "Reaper", "Titan", "Specter", "Hunter", "Vanguard", "Zero"
];

const REGIONS = ["BR", "NA", "EUW", "EUNE", "KR", "LATAM", "OCE", "TR"] as const;

const RANK_DISTRIBUTION = [
  { name: "Iron", weight: 5 },
  { name: "Bronze", weight: 20 },
  { name: "Silver", weight: 30 },
  { name: "Gold", weight: 25 },
  { name: "Platinum", weight: 10 },
  { name: "Emerald", weight: 5 },
  { name: "Diamond", weight: 3 },
  { name: "Master", weight: 1.5 },
  { name: "GM", weight: 0.4 },
  { name: "Challenger", weight: 0.1 }
] as const;

function generateName(index: number) {
  const prefix = PLAYER_PREFIXES[Math.floor(Math.random() * PLAYER_PREFIXES.length)];
  const suffix = PLAYER_SUFFIXES[Math.floor(Math.random() * PLAYER_SUFFIXES.length)];
  const randomNum = Math.floor(Math.random() * 999);
  return `${prefix}${suffix}${index % 3 === 0 ? randomNum : ""}`;
}

async function seed() {
  console.log("Cleaning existing data for fresh seed...");
  await db.delete(trades);
  await db.delete(positions);
  await db.delete(vaultSnapshots);
  await db.delete(vaults);

  const players = [];
  const usedNames = new Set<string>();

  for (let i = 1; i <= 1000; i++) {
    // Generate unique name
    let name = generateName(i);
    while (usedNames.has(name)) {
      name = generateName(i + Math.floor(Math.random() * 1000));
    }
    usedNames.add(name);

    // Rank based on realistic distribution
    let rand = Math.random() * 100;
    let rank = "Bronze";
    for (const tier of RANK_DISTRIBUTION) {
      if (rand <= tier.weight) {
        rank = tier.name;
        break;
      }
      rand -= tier.weight;
    }

    // Winrate: 40-60% with rare outliers up to 70%
    let winrate;
    const wrRand = Math.random();
    if (wrRand < 0.95) {
      winrate = (40 + Math.random() * 20).toFixed(2); // 40-60
    } else {
      winrate = (60 + Math.random() * 10).toFixed(2); // 60-70
    }

    const region = REGIONS[Math.floor(Math.random() * REGIONS.length)];

    // Initial valuation logic
    const baseValue = 10000;
    const wrMultiplier = parseFloat(winrate) / 50;
    const totalValue = baseValue * wrMultiplier;
    const initialPrice = (totalValue / 1000).toFixed(2);

    players.push({
      playerAlias: name,
      rank: rank as any,
      region: region as any,
      winrate: winrate,
      performanceIndex: "100.00",
      momentum: "0.00",
      lastTradePrice: initialPrice,
      price24hAgo: initialPrice,
      volume24h: "0.00"
    });
  }

  // Batch insert
  const batchSize = 100;
  for (let i = 0; i < players.length; i += batchSize) {
    const batch = players.slice(i, i + batchSize);
    const insertedVaults = await db.insert(vaults).values(batch).returning({ 
      id: vaults.id, 
      lastTradePrice: vaults.lastTradePrice, 
      performanceIndex: vaults.performanceIndex 
    });
    
    const snapshots = insertedVaults.map(v => ({
      vaultId: v.id,
      price: v.lastTradePrice,
      performanceIndex: v.performanceIndex
    }));
    await db.insert(vaultSnapshots).values(snapshots);
  }

  console.log("Seeded 1000 realistic players successfully.");
  process.exit(0);
}

seed().catch(err => {
  console.error(err);
  process.exit(1);
});

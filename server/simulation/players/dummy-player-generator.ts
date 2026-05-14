/**
 * Simulation — Dummy Player Generator
 *
 * Generates synthetic player records for the sandbox/vault system.
 * Used by the seed endpoint to populate the vault table with 1000 fake players.
 *
 * Extracted from server/domains/trading/routes.ts — Phase 6 simulation isolation.
 */

import { generateSummonerNames } from "./name-generator";

const RANK_TIERS = [
  { name: "Bronze",     weight: 30 },
  { name: "Silver",     weight: 30 },
  { name: "Gold",       weight: 20 },
  { name: "Platinum",   weight: 10 },
  { name: "Emerald",    weight: 7 },
  { name: "Diamond",    weight: 2 },
  { name: "Master",     weight: 0.8 },
  { name: "GM",         weight: 0.1 },
  { name: "Challenger", weight: 0.1 },
];

const REGIONS = ["BR", "NA", "EUW", "EUNE", "KR", "LATAM"];

export interface DummyPlayer {
  playerAlias: string;
  rank: string;
  region: string;
  winrate: string;
  performanceIndex: string;
  momentum: string;
  lastTradePrice: string;
  volume24h: string;
}

export function generateDummyPlayers(count = 1000): DummyPlayer[] {
  const players: DummyPlayer[] = [];
  const summonerNames = generateSummonerNames(count);

  for (let i = 0; i < count; i++) {
    let rand = Math.random() * 100;
    let rank = "Bronze";
    for (const tier of RANK_TIERS) {
      if (rand <= tier.weight) {
        rank = tier.name;
        break;
      }
      rand -= tier.weight;
    }

    let winrate: string;
    if (Math.random() < 0.8) {
      winrate = (45 + Math.random() * 10).toFixed(2);
    } else {
      winrate = (35 + Math.random() * 35).toFixed(2);
    }

    const region = REGIONS[Math.floor(Math.random() * REGIONS.length)];
    const baseValue = 10000;
    const wrMultiplier = parseFloat(winrate) / 50;
    const totalValue = baseValue * wrMultiplier;
    const initialPrice = (totalValue / 1000).toFixed(2);

    players.push({
      playerAlias: summonerNames[i],
      rank: rank as any,
      region: region as any,
      winrate,
      performanceIndex: "100.00",
      momentum: "0.00",
      lastTradePrice: initialPrice,
      volume24h: "0.00",
    });
  }

  return players;
}

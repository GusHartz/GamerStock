# Phase 4 — Schema Modularization Report

**Date:** 2026-03-09  
**Status:** ✅ Complete — zero breaking changes, server boots clean

---

## Objective

Break the 973-line `shared/schema.ts` monolith into domain-specific files under `shared/schema/`, while keeping full backward compatibility through a re-export shim.

---

## Files Created

| File | Purpose |
|---|---|
| `shared/schema/auth.ts` | Users, sessions, access requests, password resets, waitlist |
| `shared/schema/player.ts` | Riot players/assets, canonical markets/assets, sandbox vaults |
| `shared/schema/performance.ts` | Role baselines, metric weights, match metrics, performance scores |
| `shared/schema/valuation.ts` | Asset valuation state (PVI / fair value) |
| `shared/schema/market.ts` | AMM state, trigger orders, price snapshots, idempotency, sync logs, news |
| `shared/schema/portfolio.ts` | Portfolios, positions, trades, riot positions/trades, ledger, relations |
| `shared/schema/discovery.ts` | Vault watchlist (legacy), canonical asset watchlist |
| `shared/schema/arena.ts` | Profiles, stats, events, achievements, seasons, badges, challenges, duels, follows, draft |
| `shared/schema/admin.ts` | Empty — no dedicated admin tables currently exist |
| `shared/schema/simulation.ts` | Bot trader profiles |
| `shared/schema/treasury.ts` | Fee ledger, player fee balances |
| `shared/schema/index.ts` | Re-exports all domain files as a single entry point |

**Total new files: 12** (11 domain files + 1 index)

---

## Table Distribution by Domain

### auth.ts
- `users` — re-exported from `shared/models/auth.ts`
- `sessions` — re-exported from `shared/models/auth.ts`
- `accessRequests` — re-exported from `shared/models/auth.ts`
- `passwordResetTokens` — re-exported from `shared/models/auth.ts`
- `waitlist` — user interest sign-ups

### player.ts
- `riotAssets` — real Riot/LoL player identities with pricing
- `riotMatchCache` — processed match performance scores
- `riotPlayerState` — EMA + daily circuit breaker state
- `riotPlayers` — raw Riot API player data
- `markets` — canonical market registry (multi-provider/game)
- `assets` — canonical tradeable assets
- `vaults` — sandbox simulated player assets
- `vaultSnapshots` — vault price history for charts
- `RankTiers`, `Regions` — enum constants

### performance.ts
- `roleBaselines` — statistical baselines per role/tier
- `roleMetricWeights` — per-role metric weight config
- `playerMatchMetrics` — raw per-match metrics for players
- `performanceScores` — computed EMA performance scores

### valuation.ts
- `assetValuationState` — PVI components + fair value per asset

### market.ts
- `appConfig` — server key-value settings
- `assetMarkets` — AMM bonding curve parameters per asset
- `assetMarketState` — AMM current supply + last price
- `assetPriceSnapshots` — canonical asset price history
- `idempotencyKeys` — duplicate trade prevention
- `marketSyncRuns` — market data sync run log
- `marketSyncStatus` — circuit breaker state per market
- `triggerOrders` — limit/stop-loss/take-profit orders
- `triggerOrderEvents` — order lifecycle audit log
- `newsEvents` — esports news items
- `assetNewsPulses` — news sentiment impact per asset

### portfolio.ts
- `portfolios` — user play-USDC balance
- `positions` — sandbox vault holdings
- `trades` — sandbox trade execution log
- `riotPositions` — real riot asset holdings
- `riotTrades` — real riot trade log
- `ledgerEntries` — immutable financial ledger
- Relations: `vaultRelations`, `portfolioRelations`, `positionRelations`, `tradeRelations`
- Types + Zod schemas: `Portfolio`, `Position`, `Trade`, `RiotPosition`, `RiotTrade`, `TradeRequest`, `TradeResponse`, `PortfolioDetailsResponse`, etc.

### discovery.ts
- `watchlist` — legacy vault-based watchlist
- `assetWatchlist` — canonical asset watchlist (per user)
- `watchlistRelations`

### arena.ts
- `arenaProfiles` — user avatar + bio
- `arenaUserStats` — XP, rank, trade history aggregates
- `arenaEvents` — XP event log
- `achievementsCatalog` — achievement definitions
- `userAchievements` — user unlocked achievements
- `arenaSeasons` — competitive season definitions
- `arenaUserSeasonStats` — per-season stats per user
- `arenaSeasonLeaderboardSnapshot` — end-of-season rankings
- `arenaBadges` — badge catalog
- `userBadges` — user awarded badges
- `seasonRewards` — reward tier config per season
- `seasonRewardDistributions` — reward distribution audit log
- `arenaChallenges` — weekly/limited-time challenges
- `arenaTraderFollows` — social follow graph
- `arenaDuels` — head-to-head trader challenges
- Draft schema re-exports (`draftWeeks`, `draftEntries`, `draftEntryPicks`, `draftPlayerWeekMetrics`, `draftUserSeasonStats`, and insert schemas)

### admin.ts
- Empty — intentionally. No admin-specific tables exist. Admin capability uses `users.role`.

### simulation.ts
- `botProfiles` — 100-bot simulation strategy/config

### treasury.ts
- `feeLedger` — platform + player fee split records
- `playerFeeBalance` — per-asset accumulated player fees

---

## Ambiguities Resolved

### 1. riotPositions / riotTrades placement
**Ambiguity:** `riotPositions` and `riotTrades` involve both player identity (puuid) and portfolio state. Could go in either `player.ts` or `portfolio.ts`.  
**Resolution:** Placed in `portfolio.ts`. These are user-portfolio entities (holdings + trade executions), not player-identity entities. The puuid is just a foreign reference, not ownership.

### 2. assets / markets placement
**Ambiguity:** Canonical `assets` and `markets` tables could belong to `market.ts` (AMM) or `player.ts` (player-as-asset registry).  
**Resolution:** Placed in `player.ts`. These tables form the canonical player-as-asset registry and are referenced as FKs by AMM tables (`assetMarkets`, `assetMarketState`) in `market.ts`. This avoids a circular dependency (`market.ts` → `player.ts`, not the reverse).

### 3. appConfig placement
**Ambiguity:** `appConfig` is a generic server settings store, not inherently a "market" concept.  
**Resolution:** Placed in `market.ts` as it is most commonly used to configure market mode (`REAL_RIOT_NA1` vs `SANDBOX`). Could be moved to a dedicated `config.ts` in future.

### 4. newsEvents / assetNewsPulses placement
**Ambiguity:** News tables relate to assets but are primarily a market signal feed.  
**Resolution:** Placed in `market.ts` alongside other market data tables.

---

## Cross-Domain Dependency Graph

```
auth.ts         → (none)
player.ts       → (none)
performance.ts  → (none)
valuation.ts    → player.ts (assets FK)
market.ts       → player.ts (assets FK), auth.ts (users FK)
portfolio.ts    → auth.ts (users FK), player.ts (vaults, assets, vaultSnapshots FKs)
discovery.ts    → auth.ts (users FK), player.ts (vaults, assets FKs)
arena.ts        → auth.ts (users FK), server/modules/draft (re-export)
simulation.ts   → auth.ts (users FK)
treasury.ts     → player.ts (assets FK)
admin.ts        → (none)
index.ts        → all of the above
```

No circular dependencies.

---

## Compatibility Strategy

`shared/schema.ts` was converted to a 6-line compatibility shim:

```ts
export * from "./schema/index";
```

All existing imports (`import { X } from "@shared/schema"`, `import * as schema from "@shared/schema"`) continue to work without modification. Drizzle's `drizzle(pool, { schema })` in `server/db.ts` picks up all exported tables and relations correctly.

---

## Confirmation: No Structural Changes to the Database

- ✅ No table names changed
- ✅ No column names or types changed
- ✅ No relations changed
- ✅ No migrations modified
- ✅ No Drizzle config modified
- ✅ No insert schemas or Zod validators changed
- ✅ Server boots clean, all endpoints respond correctly

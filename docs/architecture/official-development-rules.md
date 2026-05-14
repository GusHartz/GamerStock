# GamerStock — Official Development Rules

**Version:** Phase 9  
**Last updated:** 2026-03-09

Quick-reference guide for daily development on GamerStock.  
For the full rationale, see `legacy-freeze-and-retirement-plan.md`.

---

## The Golden Rules

### 1. New features go on the Riot canonical model
- Player data → `riotAssets`, `riotPositions`, `riotTrades`
- API endpoints → `server/domains/<domain>/routes.ts`
- Asset display → `GET /api/market/assets`, `GET /api/riot/players`
- Trade execution → `executeRiotTrade()` via `server/services/tradeExecutor.ts`

### 2. Do not add features to sandbox/vault code
Any file marked `LEGACY` or `SANDBOX ONLY` is frozen.  
If it mentions vaults, synthetic players, or `IStorage.getVaults()` — do not extend it.  
Retirement is the goal, not expansion.

### 3. Cross-domain integrations use the event bus
```typescript
// Correct
import { eventBus, createTradeExecutedEvent } from "../events";
eventBus.emitBackground(createTradeExecutedEvent({ ... }));

// Wrong — creates direct coupling between domains
import { updateArenaOnTrade } from "../arena";
```

### 4. New external data sources implement PerformanceProvider
```typescript
// Correct
class MyNewProvider implements PerformanceProvider {
  async getPlayerPerformance(puuid) { ... }
}

// Wrong — inline Riot calls scattered across domain code
const rawData = await fetch("https://riot.api/...");
```

### 5. Web3 adapters are injected, not imported
```typescript
// Correct — inject in server/index.ts
setWeb3Adapters({ walletLink: new EvmWalletLinkAdapter(...) });

// Wrong — core service importing web3 directly
import { mirrorTrade } from "../web3/adapters/evm";
```

### 6. Simulation code is isolated
```typescript
// Correct
import { startBotSimulator } from "./simulation/bots/bot-trader";

// Wrong — importing simulation from a core service
import { generateDummyPlayers } from "../simulation/players/dummy-player-generator"; // in a service
```

### 7. No direct imports from deprecated shims
```typescript
// Correct
import { runAliasMigration } from "./simulation/players/name-generator";
import { startBotSimulator } from "./simulation/bots/bot-trader";

// Wrong
import { runAliasMigration } from "./name-generator"; // deprecated shim
```

---

## File Structure Cheat Sheet

| What you're building | Where it goes |
|---|---|
| New HTTP route | `server/domains/<domain>/routes.ts` |
| New DB query (canonical) | Direct `db.select().from(riotAssets...)` in route or service |
| New scheduled job | `server/scheduler/` or `server/integrations/jobs/` |
| New cross-domain integration | Event handler in `server/events/handlers/` |
| New external data provider | `server/integrations/<name>/` implementing `PerformanceProvider` |
| New Web3 adapter | `server/web3/interfaces/` + implementation in `server/web3/adapters/` (Phase 9+) |
| New simulation behavior | `server/simulation/` only |
| New arena feature | `server/arena.ts` + `ArenaXpGranted` event for observability |
| New shared types | `shared/schema/<domain>.ts` |
| New API route path | `shared/routes.ts` |
| New React page | `client/src/pages/<name>.tsx` |
| New React hook (canonical) | `client/src/hooks/use-<name>.ts` |

---

## What NOT To Do

| Action | Reason |
|---|---|
| Add a column to `vaults` table | Table is frozen / sandbox-only |
| Add a new endpoint to `GET /api/vaults` | Legacy endpoint — retirement pending |
| Import `use-vaults.ts` in a new page | Legacy hook — use `use-riot-assets.ts` instead |
| Put business logic in route handlers | Routes are transport only — logic belongs in `server/services/` |
| Create a new `IStorage` method for vaults | Storage vault section is frozen |
| Add bot trading logic to `server/services/` | Bot code lives in `server/simulation/bots/` |
| Import `server/simulation/` from `server/services/` | Simulation must not contaminate core |
| Emit events synchronously in hot paths | Use `eventBus.emitBackground()` — never block the request |
| Create a new `@shared/schema` file outside the schema directory | Keep schema split in `shared/schema/<domain>.ts` |
| Skip the event bus for arena side-effects on trade | Phase 8: shadow mode; Phase 9+: bus is the only path |

---

## Quick Checks Before Merging

- [ ] New code does not import from `server/name-generator.ts` or `server/services/botTrader.ts`
- [ ] New code does not add to vault/sandbox routes
- [ ] New cross-domain call uses event bus, not direct import
- [ ] New file has a clear module-level comment stating purpose and layer
- [ ] No business logic added to route handlers (use services)
- [ ] No simulation code in `server/services/` or `server/domains/`
- [ ] No direct blockchain calls — use adapter injection via `setWeb3Adapters()`

---

## Reference: Official API Endpoints (Canonical)

| Purpose | Endpoint |
|---|---|
| Market assets | `GET /api/market/assets` |
| Asset detail | `GET /api/market/assets/:id` |
| Riot players | `GET /api/riot/players` |
| Player performance | `GET /api/performance/asset/:assetId/latest` |
| Recent trades | `GET /api/riot/trades/recent` |
| Execute trade | `POST /api/riot/trade` |
| Portfolio | `GET /api/portfolio` |
| Leaderboard | `GET /api/riot/leaderboard` |
| Arena profile | `GET /api/arena/profile` |
| Market index | `GET /api/market/index` |

# Phase 6 — Simulation Isolation Report

**Date:** 2026-03-09  
**Status:** ✅ Complete — server boots clean, bot simulator active, no breaking changes

---

## Objective

Isolate all simulation/sandbox elements from the official GamerStock core (player registry, performance pipeline, market, trading). Sandbox code now lives exclusively under `server/simulation/`, with clearly defined boundaries.

---

## Directory Structure Created

```
server/simulation/
  players/
    name-generator.ts        ← summoner name generation + vault alias migration
    dummy-player-generator.ts ← 1000 synthetic player record generation
  bots/
    bot-trader.ts            ← 100-bot simulation system (all 7 strategies)
  services/
    simulation-market-service.ts ← operational façade
  index.ts                   ← public API re-exports
```

---

## Files Moved / Isolated

| Original Location | New Canonical Location | Original File |
|---|---|---|
| `server/name-generator.ts` | `server/simulation/players/name-generator.ts` | Converted to re-export shim |
| `server/services/botTrader.ts` | `server/simulation/bots/bot-trader.ts` | Converted to re-export shim |
| `generateDummyPlayers()` in `server/domains/trading/routes.ts` (inline function) | `server/simulation/players/dummy-player-generator.ts` | Removed from trading domain |

---

## Re-export Shims (Backward Compatibility)

**`server/name-generator.ts`** — now contains:
```ts
export * from "./simulation/players/name-generator";
```

**`server/services/botTrader.ts`** — now contains:
```ts
export * from "../simulation/bots/bot-trader";
```

These shims ensure any future imports via the old path continue to work without error.

---

## Callers Updated to Use New Simulation Paths

| File | Before | After |
|---|---|---|
| `server/routes.ts` | `import { runAliasMigration } from "./name-generator"` | `from "./simulation/players/name-generator"` |
| `server/index.ts` | `import { startBotSimulator } from "./services/botTrader"` | `from "./simulation/bots/bot-trader"` |
| `server/domains/admin/routes.ts` | `import { ..., seedBots, setBotConfig } from "../../services/botTrader"` | `from "../../simulation/bots/bot-trader"` |
| `server/domains/trading/routes.ts` | `import { generateSummonerNames } from "../../name-generator"` + inline `generateDummyPlayers()` | `import { generateDummyPlayers } from "../../simulation/players/dummy-player-generator"` |

---

## Import Path Changes Inside Moved Files

When moving files to `server/simulation/`, all relative imports were adjusted:

**`bots/bot-trader.ts`** (from `server/services/botTrader.ts`):
- `"../db"` → `"../../db"`
- `"./tradeExecutor"` → `"../../services/tradeExecutor"`
- `"./valuationJob"` → `"../../services/valuationJob"`
- `"./pviEngine"` → `"../../services/pviEngine"`

**`players/name-generator.ts`** (from `server/name-generator.ts`):
- `"./db"` → `"../../db"`

---

## Boundary After Phase 6

```
server/
  simulation/              ← SIMULATION LAYER (everything synthetic/sandbox)
    players/               ← fake player generation
    bots/                  ← bot trading simulation
    services/              ← simulation operational façade
    index.ts               ← single public API entry point

  integrations/            ← INTEGRATION LAYER (real data providers)
    interfaces/            ← PerformanceProvider contract
    riot/                  ← Riot adapter
    synthetic/             ← Synthetic adapter (reads real vault data)
    jobs/                  ← Job services (sync, batch)

  domains/                 ← HTTP TRANSPORT LAYER (routes)
    admin/, trading/, player/, performance/, market/, ...

  services/                ← CORE SERVICES (real business logic)
    tradeExecutor, valuationJob, performanceEngine, ...

  market-core/             ← CANONICAL MARKET (AMM, sync, pricing)
```

---

## What Still Remains in Core (Intentionally)

| Item | Location | Reason |
|---|---|---|
| Vault table (sandbox player assets) | `shared/schema/player.ts` | Still used by sandbox trading flow and synthetic provider — schema change deferred |
| Vault-related storage methods | `server/storage.ts` | Used by seed endpoint in trading routes |
| Sandbox trade execution logic | `server/domains/trading/routes.ts` | Still functional sandbox trade flow — not moved to simulation in this phase (trade execution logic is core infrastructure shared by both modes) |
| `SANDBOX` market mode config | `server/app-config.ts` | Configuration boundary, not simulation code |
| `market-core/startup-seed.ts` sandbox references | References vault + sandbox canonical asset | Startup seed for canonical market — uses vaults but is market infrastructure, not simulation |

---

## Risks Remaining

| Risk | Severity | Notes |
|---|---|---|
| `server/services/botTrader.ts` is now a shim — any new code added there won't be in the canonical location | Low | Shim is clearly `@deprecated`, canonical location documented |
| `server/name-generator.ts` shim — same | Low | Same |
| `server/domains/trading/routes.ts` still contains sandbox vault trade execution | Medium | This is intentional for now — vault trading is a functional mode, not simulation noise |
| Bot simulator imports `executeRiotTrade` — creates a dependency from simulation → core service | Low | Expected: bots trade via the real trade executor. The dependency direction is simulation→core (correct). Core never imports simulation. |

---

## No Breaking Changes — Confirmation

- ✅ All API paths unchanged
- ✅ All response payloads unchanged
- ✅ Bot simulator starts on boot (`[BotTrader] Starting bot simulator` in logs)
- ✅ Vault alias migration runs on boot (`[MIGRATION] No legacy Player### aliases found. Skipping.`)
- ✅ All original import paths still work via re-export shims
- ✅ No schema changes
- ✅ No DB changes
- ✅ Server boots clean, zero startup errors

---

## Recommended Next Steps for Phase 7

1. **Remove re-export shims** — once all callers are verified to use the new simulation paths, delete `server/name-generator.ts` and the content of `server/services/botTrader.ts`.

2. **Migrate sandbox trade execution** — move vault-specific trading logic from `server/domains/trading/routes.ts` into `server/simulation/services/simulation-market-service.ts`. This would complete the trading domain cleanup.

3. **Extract vault storage from core** — `server/storage.ts` has vault CRUD methods that are purely sandbox. These could move to a `SimulationStorage` class in `server/simulation/`.

4. **Clarify `market-core/startup-seed.ts`** — the sandbox market/vault seeding references in startup seed should be conditionally gated on market mode or moved to a simulation-specific bootstrap.

5. **SimulationMarketService expansion** — the façade currently wraps bot operations. It should also wrap the sandbox seed endpoint so `trading/routes.ts` calls `simulationMarketService.generateSandboxPlayers()` (it already does via the import, but the seed endpoint handler could delegate to the façade explicitly).

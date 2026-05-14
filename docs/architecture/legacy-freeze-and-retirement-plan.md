# Legacy Freeze & Retirement Plan

**Date:** 2026-03-09  
**Status:** ✅ Freeze applied — legacy points marked, official path documented

---

## A. Executive Summary

GamerStock has completed an 8-phase architectural transformation. The platform now has a clean separation between:

| Layer | Description |
|---|---|
| **Core (official)** | Riot canonical market: real League of Legends players, AMM pricing, Riot API integration |
| **Legacy (sandbox)** | Original vault/fake-player model: 1000 synthetic players seeded from `generateDummyPlayers()` |
| **Simulation** | 100-bot trading system and player name generation (now isolated in `server/simulation/`) |
| **Compatibility shims** | Re-export files that preserve old import paths while the team migrates |

**What is frozen:** Legacy sandbox code is marked `FREEZE` and `LEGACY`. No new features may be built on top of it.

**What is the official platform:** The Riot canonical market — real players, real performance data, live AMM trading, event-driven architecture, Web3-ready adapters.

---

## B. Official Architecture Path

All new features must be built using these paths:

### Server
```
server/
  domains/          ← HTTP transport (route handlers only — no business logic)
    admin/
    discovery/
    market/
    performance/
    player/
    portfolio/
    trading/

  integrations/     ← External data providers (Riot, Synthetic adapter)
    interfaces/     ← PerformanceProvider contract
    riot/
    synthetic/
    jobs/           ← PerformanceSyncService, PerformanceBatchService

  simulation/       ← Simulation / sandbox only (isolated)
    players/
    bots/
    services/

  events/           ← Internal domain event bus (Phase 7)
    handlers/

  web3/             ← Web3 interfaces + event bridge (Phase 8)
    interfaces/
    models/
    services/

  services/         ← Core business logic (AMM, trade execution, valuation, arena)
  market-core/      ← Canonical market (sync, registry, pricing, seeding)
  ws/               ← WebSocket market hub
  sse/              ← Server-Sent Events (terminal broadcast)
  scheduler/        ← Scheduled jobs
```

### Shared
```
shared/
  schema/           ← Split domain schemas (Phase 4)
    player.ts
    market.ts
    arena.ts
    treasury.ts
    ...
  routes.ts         ← Typed API route catalog
```

### Client
```
client/src/
  pages/            ← Route pages
    arena-*.tsx     ← Official Arena pages
    asset-detail.tsx ← Official asset page
    player.tsx      ← Official player page
    assets.tsx      ← Official market browser
  hooks/
    use-riot-*.ts   ← Official data hooks (Riot market)
  components/       ← Shared UI components
```

### Rules for new features
1. New routes → `server/domains/<domain>/routes.ts`
2. New cross-domain integrations → emit an event via `server/events/`
3. New external data sources → implement `PerformanceProvider` interface in `server/integrations/`
4. New Web3 integration → implement adapter interfaces in `server/web3/interfaces/`
5. New simulation/bot behavior → `server/simulation/` only
6. Never import from `server/simulation/` in core services
7. Never import from `server/web3/` in core services (use event bus)

---

## C. Legacy Inventory

### Server-side Legacy

| File / Section | Classification | Notes |
|---|---|---|
| `server/name-generator.ts` | COMPAT SHIM | Re-exports from `server/simulation/players/name-generator.ts`. `@deprecated` marked. |
| `server/services/botTrader.ts` | COMPAT SHIM | Re-exports from `server/simulation/bots/bot-trader.ts`. `@deprecated` marked. |
| `server/storage.ts` — vault methods | LEGACY | `getVaults`, `getVault`, `getVaultSnapshots`, `createVault`, `updateVault`, `createVaultSnapshot`, `getPositionsByPortfolioId`, `getPosition`, `upsertPosition`, `createTrade`, `getRecentTrades`, `getWatchlist`, `addToWatchlist`, `removeFromWatchlist`, `isInWatchlist` |
| `server/domains/trading/routes.ts` — LEGACY/SANDBOX section | LEGACY | `POST /api/seed`, `POST /api/trade` (sandbox), `GET /api/trades/recent` (sandbox) |
| `server/domains/discovery/routes.ts` — vault endpoints | LEGACY | `GET /api/vaults` (list), `GET /api/vaults/:id` (detail), vault watchlist endpoints |
| `server/domains/market/routes.ts` — LEGACY: sandbox recent trades | LEGACY | `GET /api/trade/recent` — duplicated by `GET /api/riot/trades/recent` |
| `server/domains/portfolio/routes.ts` — sandbox positions merge | LEGACY | `sandboxOut` block merging vault positions into portfolio response |
| `server/market-core/startup-seed.ts` — Gamerstock SANDBOX market section | LEGACY | Seeds sandbox market + links vaults to canonical sandbox assets |
| `server/market-core/backfill-trading-assets.ts` | LEGACY | One-time migration utility for vault → canonical asset linking |

### Database Tables (Legacy)

| Table | Classification | Notes |
|---|---|---|
| `vaults` | SANDBOX ONLY | 1000 synthetic players. No real player data. |
| `vault_snapshots` | SANDBOX ONLY | Price history for synthetic vaults |
| `positions` | SANDBOX ONLY | Sandbox trade positions (linked to vaults, not riot_assets) |
| `trades` | SANDBOX ONLY | Sandbox trade history |

### Client-side Legacy

| File | Classification | Notes |
|---|---|---|
| `client/src/hooks/use-vaults.ts` | LEGACY | Vault data hooks (`useVaults`, `useVault`, `useWatchlist`, `useWatchlistMutation`). LEGACY comment added. |
| `client/src/pages/vault-detail.tsx` | LEGACY | Sandbox vault detail page. LEGACY comment added. |
| `client/src/pages/watchlist.tsx` | SANDBOX ONLY | Uses vault watchlist — should migrate to Riot asset watchlist |
| `client/src/components/star-button.tsx` | SANDBOX ONLY | Vault watchlist toggle component |

### API Endpoints (Legacy)

| Endpoint | Classification | Official Replacement |
|---|---|---|
| `POST /api/seed` | SANDBOX ONLY | N/A (admin-only seeding) |
| `POST /api/trade` | LEGACY | `POST /api/riot/trade` |
| `GET /api/trade/recent` | LEGACY | `GET /api/riot/trades/recent` |
| `GET /api/vaults` | LEGACY | `GET /api/market/assets` |
| `GET /api/vaults/:id` | LEGACY | `GET /api/market/assets/:id` or `GET /api/riot/players/:puuid` |

---

## D. Retirement Strategy

### KEEP TEMPORARILY (until migration complete)

| Item | Condition for removal |
|---|---|
| `server/name-generator.ts` shim | Remove once no callers use old path (currently none — all migrated in Phase 6) |
| `server/services/botTrader.ts` shim | Same — callers already updated in Phase 6 |
| `server/storage.ts` vault methods | Remove once vault-detail page migrated and vault routes removed |
| `client/src/hooks/use-vaults.ts` | Remove once vault-detail page migrated |
| `server/domains/discovery/routes.ts` vault endpoints | Remove once vault-detail frontend removed |
| `server/domains/market/routes.ts` sandbox trades | Remove once frontend migrates to `/api/riot/trades/recent` |
| `server/domains/portfolio/routes.ts` `sandboxOut` block | Remove once sandbox trading is disabled |

### MIGRATE SOON

| Item | Migration target | Effort |
|---|---|---|
| `client/src/pages/vault-detail.tsx` | Redirect `/vault/:id` → `/asset/:assetId` | Low — all vaults have linked `assetId` once seed runs |
| `client/src/pages/watchlist.tsx` | Migrate watchlist to Riot assets | Medium |
| `POST /api/trade` sandbox path | Remove sandbox branch, Riot-only | Medium |
| Portfolio `sandboxOut` block | Remove once sandbox positions drain naturally | Low |

### SANDBOX ONLY (keep for sandbox mode, never promote to core)

| Item | Notes |
|---|---|
| `vaults` table | Sandbox-only data, never expose as real player data |
| `vault_snapshots` table | Same |
| `positions` / `trades` tables | Sandbox trading history only |
| `server/market-core/startup-seed.ts` sandbox section | Sandbox market bootstrap only |
| `server/simulation/` — all files | Simulation layer — never import from core |
| `server/market-core/backfill-trading-assets.ts` | One-time utility, keep frozen |

### REMOVE LATER (safe to delete after migration)

| Item | Safe to remove when |
|---|---|
| `server/name-generator.ts` | Immediately — all callers use new path |
| `server/services/botTrader.ts` | Immediately — all callers use new path |
| `server/market-core/backfill-trading-assets.ts` | After confirming all vaults are linked |
| `GET /api/trade/recent` endpoint | After confirming frontend is on Riot trades |
| `POST /api/seed` endpoint | After confirming sandbox seeding is admin-only and can be replaced with admin tool |

---

## E. Guardrails for Future Development

These rules apply to all new work on GamerStock from Phase 9 onwards.

### Hard rules (never break)
1. **Do not add new features to vault/sandbox routes.** All new feature work uses Riot canonical model.
2. **Do not import deprecated shims** (`server/name-generator.ts`, `server/services/botTrader.ts`) in new modules. Import from the canonical location directly.
3. **Do not import from `server/simulation/` in core services.** Simulation is isolated. Core never calls simulation code.
4. **Do not import from `server/web3/` in core services.** Web3 is opt-in via event bus. Core never calls Web3 code.
5. **Do not add new methods to `IStorage` vault section.** New storage patterns use direct Drizzle queries on canonical tables.
6. **Do not add new columns to `vaults` / `positions` / `trades` sandbox tables.** These tables are frozen.

### Architecture rules
7. **New cross-domain integrations** must go through the event bus (`server/events/`), not direct service imports.
8. **New external data providers** must implement the `PerformanceProvider` interface.
9. **New Web3 adapters** must implement interface contracts in `server/web3/interfaces/`.
10. **New domain routes** belong in `server/domains/<domain>/routes.ts` — no business logic in route handlers.
11. **New scheduled jobs** go in `server/scheduler/` or `server/integrations/jobs/`.
12. **New simulation behavior** goes in `server/simulation/` — never in `server/services/` or `server/domains/`.

### Code quality rules
13. All new files must have a clear module-level comment stating their purpose and layer.
14. Any file that wraps/adapts legacy code must be clearly marked `LEGACY` or `@deprecated`.
15. New feature work must not mix sandbox data with Riot canonical data in the same query or response.

---

## F. Architecture Layer Map (Phase 9 state)

```
┌─────────────────────────────────────────────────────────────────┐
│                     CLIENT (React/Vite)                         │
│  pages/arena-* | asset-detail | player | assets | portfolio     │
│  hooks/use-riot-* | use-portfolio | use-arena                   │
│                                                                  │
│  ── LEGACY ── vault-detail | use-vaults | watchlist (vault)     │
└────────────────────────┬────────────────────────────────────────┘
                         │ HTTP / WebSocket / SSE
┌────────────────────────▼────────────────────────────────────────┐
│                   DOMAINS (HTTP Transport)                      │
│  admin | discovery | market | performance | player              │
│  portfolio | trading (riot path)                                │
│                                                                  │
│  ── LEGACY ── trading (sandbox path) | discovery (vault)        │
└──────┬──────────────────────────────────────────┬───────────────┘
       │                                          │
┌──────▼──────────┐                   ┌───────────▼──────────────┐
│  CORE SERVICES  │                   │     INTEGRATIONS         │
│  tradeExecutor  │                   │  PerformanceProvider     │
│  valuationJob   │                   │  riot/ | synthetic/      │
│  pviEngine      │                   │  jobs/                   │
│  arena          │                   └──────────────────────────┘
│  ammPricing     │
│  triggerEngine  │◄──── EVENTS ◄──── server/events/ (bus)
│  duelService    │                        │
└──────┬──────────┘                   ┌────▼─────────────────────┐
       │                              │     WEB3 (observation)   │
┌──────▼──────────┐                   │  wallet-link-adapter     │
│  MARKET CORE    │                   │  treasury-settlement     │
│  sync           │                   │  asset-mirror            │
│  asset-registry │                   │  web3-event-bridge       │
│  startup-seed   │                   └──────────────────────────┘
│  amm-params     │
└──────┬──────────┘        ┌──────────────────────────────────────┐
       │                   │        SIMULATION (isolated)         │
       │                   │  players/ | bots/ | services/        │
       │                   │  ← never imported by core            │
       │                   └──────────────────────────────────────┘
┌──────▼──────────────────────────────────────────────────────────┐
│                    DATABASE (PostgreSQL)                         │
│  CANONICAL: markets, assets, riot_assets, riot_positions,       │
│             riot_trades, asset_market_state, asset_valuation_state│
│                                                                  │
│  LEGACY/SANDBOX: vaults, vault_snapshots, positions, trades     │
└─────────────────────────────────────────────────────────────────┘
```

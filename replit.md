# GamerStock

## Overview

GamerStock is a fantasy esports trading platform designed for League of Legends. It allows users to trade "shares" (Vaults) of professional players, with prices dynamically adjusting based on in-game performance. The platform includes a live market, portfolio management, watchlists, leaderboards, and an "Arena" system for tracking user progression, achievements, and seasonal rankings. It supports both real player markets (`REAL_RIOT_NA1`) and a `SANDBOX` mode with fictional players, utilizing a virtual currency (play-USDC). Key ambitions include providing a realistic trading simulation experience, engaging users through competitive features, and leveraging advanced market mechanics like an Automated Market Maker (AMM) and a Role-Based Performance Engine to reflect real-world esports dynamics.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Monorepo Structure
The project uses a monorepo approach, separating `client` (React frontend), `server` (Express backend), `shared` (common types and schemas), `migrations` (Drizzle SQL), and `script` (build tooling).

### Frontend
-   **Technology**: React 18 with TypeScript, Vite, `wouter` for routing, and TanStack Query v5 for state management.
-   **UI/UX**: Features `shadcn/ui`, Radix UI, and Tailwind CSS, styled with a dark theme and neon palette.
-   **Components**: Recharts for data visualization, Framer Motion for animations, and React Hook Form with Zod for form handling.
-   **User Interface**: Includes a broker-style Terminal with real-time updates, Assets Explorer, Vault Detail pages, Portfolio, Watchlist, and authentication flows.
-   **Robustness**: Incorporates extensive error boundaries to enhance runtime stability.

### Backend
-   **Technology**: Express.js (Node.js, ESM).
-   **Core Services**: Manages API routes, data access, Drizzle ORM for database interactions, and market simulation logic.
-   **Real-time Capabilities**: Utilizes Server-Sent Events (SSE) for live price and trade updates.

### Data Storage
-   **Database**: PostgreSQL, managed with Drizzle ORM for schema definition, migrations, and type-safe queries.
-   **Schema**: Comprehensive database schema supports user data, market information, portfolios, trades, and detailed Arena system data including profiles, stats, events, seasons, badges, and achievements.

### Economy — Wallet & Ledger System (Phase 1)
-   **Location**: `server/domains/wallet/`, `shared/schema/wallet.ts`
-   **Tables**: `wallets` (one per user per currency), `wallet_ledger_entries` (immutable audit log)
-   **Currencies**: GS$ (internal fantasy currency, seeded 10,000 on signup) and USDC (real stablecoin placeholder, starts at 0)
-   **Principle**: Ledger is the source of truth. Wallet balance is a derived cache. All mutations pair a wallet UPDATE with a ledger INSERT.
-   **Operations**: `createWalletsForUser`, `ensureWalletsExist`, `creditWallet`, `debitWallet`, `lockFunds`, `unlockFunds`, `getWalletSummary`, `getLedgerEntries`
-   **Endpoints**: `GET /api/wallets/me`, `GET /api/wallets/me/ledger`, `GET /api/wallets/me/summary`; admin: `POST /api/admin/wallets/:userId/seed-gs`, `POST /api/admin/wallets/:userId/credit-usdc`
-   **User wiring**: `createWalletsForUser` called on signup; `ensureWalletsExist` called at login (backfill for existing users)
-   **Documentation**: `docs/economy/wallet-ledger-foundation.md`

### Economy — Player Earnings Admin Dashboard (Phase 6 — Complete 2026-03-10)
-   **Location**: `client/src/pages/admin/player-earnings.tsx`, endpoint in `server/domains/wallet/routes.ts`
-   **Endpoint**: `GET /api/admin/accounting/player-earnings-dashboard?period=today|7d|30d|all&currency=GS|USDC`
-   **Payload**: `{ period, currency, payoutThresholds: {GS:10, USDC:1}, topEarners[], periodSummary, recentActivity[] }`
-   **Top earners**: `accruedBalance` (all-time), `periodEarnings`, `periodEntryCount`, `payoutReady` (accrued ≥ payoutThreshold), `displayName` joined from assets
-   **Period summary**: `totalEarned`, `assetCount`, `entryCount` for the selected window
-   **Recent activity**: Last 25 ledger rows, all directions, joined to `assets.displayName`, with explicit `currency` column
-   **Payout readiness**: Threshold served from backend (`payoutThresholds` in payload). UI shows "Ready"/"Pending" badge and a disabled "Queue Payout" placeholder button
-   **Inline expand**: Clicking any earner row fetches full ledger history from existing `GET /api/admin/accounting/player-earnings/:assetId` endpoint
-   **Nav**: Tab "Player Earnings" (Coins icon) added to admin layout between Revenue and Market Control
-   **Route**: `/admin/player-earnings` registered in `App.tsx`
-   **Not implemented**: payout flow (balance debit, settlement state machine)

### Economy — Player Earnings Pool Distribution (Phase 5 — Complete 2026-03-10)
-   **Location**: `server/domains/player-earnings/service.ts`
-   **Tables**: `player_earnings_ledger` (immutable source of truth, idempotent), `player_earnings_balance` (projection cache with `accruedBalance = accrued unpaid earnings`)
-   **Composite PK**: `player_earnings_balance(assetId, currency)` — one row per asset × currency
-   **Idempotency**: `pel_idempotency_key UNIQUE(assetId, currency, referenceType, referenceId, direction)` on ledger — duplicate fee capture for same trade is silently skipped via `ON CONFLICT DO NOTHING`
-   **direction field**: `credit | debit` — Phase 5 writes only `credit`; `debit` reserved for future payout (not implemented)
-   **Legacy compat**: `accruePlayerEarnings()` also updates `player_fee_balance` (GS-only) for web3 adapter backward compat
-   **Wiring**: Called from `captureTradeFees()` step 3 inside the fee-engine transaction — atomic with `fee_ledger` insert and system wallet credits
-   **Admin read surface**: `GET /api/admin/accounting/player-earnings?currency=GS&limit=50` (top earners, joined to asset displayName), `GET /api/admin/accounting/player-earnings/:assetId?currency=GS` (full ledger history)
-   **Not implemented**: payout flow (balance debit, payout reference type, settlement state machine)

### Economy — Fee Engine (Phase 3 — Complete 2026-03-10)
-   **Location**: `server/domains/fee-engine/` (`index.ts`, `system-wallet.service.ts`)
-   **Tables**: `fee_ledger` (referenceType + referenceId + currency + notional + platformFee + playerFee + liquidityFee), `system_wallets` (6 rows: 3 types × 2 currencies), `system_wallet_ledger` (immutable audit log for system wallet mutations)
-   **Fee split**: 2% total (200 bps default, overrideable per `assetMarkets.feeBps`) — 60% platform_revenue / 25% player_pool / 15% liquidity_pool
-   **Scope**: Fee is captured for ALL market trades (not just AMM — fix applied: captureTradeFees moved outside `if (ammState)` block) and all limit-order settlements
-   **Seller accounting (limit orders)**: seller receives `gross - feeTotal` (net) via `settleMatchedTrade`
-   **Buyer accounting (market orders)**: buyer's portfolio.balance debited `grossValue + feeTotal`; fee routed to system wallets inside the DB transaction
-   **System wallets**: bootstrapped via `ensureSystemWalletsExist()` at startup (not linked to users table)
-   **Event**: `FeeCaptured` emitted post-transaction for every trade; observed by `treasury-event-handlers.ts`
-   **Validation endpoints** (admin only): `GET /api/admin/accounting/system-wallets`, `GET /api/admin/accounting/fee-ledger`, `GET /api/admin/accounting/reconcile-system-wallets`, `POST /api/admin/accounting/simulate-fee`
-   **Reconciliation status**: `overall_status: "OK"` — all 6 system wallets balance exactly to fee_ledger totals (GS + USDC)

### Authentication & Authorization
-   **Admin**: Username/password-based with an `isAdmin` session flag.
-   **User**: Integrated Replit OIDC via Passport.js for user authentication.
-   **Session Management**: `connect-pg-simple` stores sessions in PostgreSQL.

### Core Features
-   **Assets Explorer**: Central interface for discovering and managing assets, featuring a `UnifiedAsset` model that consolidates price, volume, performance, and market signals.
-   **AMM Market Engine**: Implements a logarithmic bonding curve for dynamic price discovery and manages market state and fees.
-   **Role-Based Performance Engine**: Adjusts asset prices by 60% based on z-score normalized real match performance, tracking player metrics and baselines.
-   **PVI Engine (v2)**: Calculates fair value of assets using a calibrated formula, influencing price gravity towards fair value.
-   **Performance Anchor Engine (PAE)**: Periodically pulls overvalued assets towards their fair value in batches.
-   **Bot Trader Simulation System**: Features 100 synthetic bot users with diverse trading strategies (e.g., `VALUE_TRADER`, `FUNDAMENTAL_SELLER`, `TREND_FOLLOWER`) to simulate market activity.
-   **Market Simulation**: The `market-maker` module simulates market activities, applying AMM pricing for `REAL_RIOT_NA1` and linear slippage for `SANDBOX`.
-   **News Impact Engine V1**: Integrates a live esports news ticker with sentiment and impact classification, affecting market signals.
-   **Terminal Upgrades**: Enhancements to the trading terminal including a Momentum Index Strip, Market Heatmap, Player Fundamentals Panel, and a real-time Trade Tape.
-   **Terminal UI Refactor (Phase 13 — Dashboard + Player Ticket)**: Desktop real-mode layout completely restructured from a 2×2 Bloomberg grid to a `gridTemplateColumns: "1fr 410px"` dashboard + sidebar. LEFT column is `overflow-y-auto` and contains: `DiscoveryHeroSection` (top), new `PlayerMarketGrid` (3-column trending/popular/undervalued player lists with avatar + name + price + change), and Positions/TradeTape strip below the fold. RIGHT sidebar (410px fixed) is a CSS grid with fixed-row allocation: 36px header ("PLAYER TICKET"), 180px `PlayerHeroCard` (portrait image slot + gradient fallback + player name + price + change + FV), 200px chart (Chart/Fundamentals toggled), auto tab/TF selector row, auto `QuickBuyPanel` (estimated cost + buying power + quick BUY button), 1fr `TradeTicket` (fills remaining height). New components in `terminal.tsx`: `PlayerHeroCard`, `QuickBuyPanel`, `PlayerMarketGrid`. Image support: `(asset as any).portraitImageUrl` and `(asset as any).avatarImageUrl` slots in both hero card and market grid rows — render image if present, elegant gradient/initial fallback otherwise. `AssetChartSummary.tf` made optional (default "24h") to fix mobile usage. Mobile layout and demo mode are unchanged.
-   **Player Claim Frontend (Phase 11c)**: Full frontend for the Player Claim System. Route `/settings/player-identity` (accessible via ⚙ gear icon in the top navbar). Settings nav with two tabs: Security | Player Identity. Components: `PlayerClaimCard` (4 UX states: no claim / pending / rejected / approved), `PlayerClaimStatusBadge`, `ClaimPlayerDialog` (player asset search + evidence note), `VerifiedPlayerBadge`, `PlayerProfileControlCard` (split view: editable public fields vs read-only market data), `EditPlayerProfileDialog` (bio, headline, images, socials, team). Hooks: `usePlayerClaims`, `usePlayerProfile`, `usePlayerAssetSearch`, `useSubmitClaim`, `useUpdateProfile`, `useActiveClaim`. `useAuth` updated to expose `capabilities: Capability[]` and `hasCapability(cap)`. New backend endpoint: `GET /api/player-claims/search-players?q=...` for asset search in claim dialog. Docs: `docs/product/player-claim-frontend-and-profile-control.md`.
-   **Identity Engine v2 (Phase 11a)**: Clean service/repository layer over the existing auth system. New modules: `server/domains/identity/types/identity.types.ts` (IdentityUser, SessionResponse, Capability types), `repositories/` (user-repository, credential-repository, session-repository), `services/` (auth-service, credential-service, session-service, authorization-service). The `/api/auth/me` response now includes a `capabilities: []` field computed dynamically from approved player claims — fully backward-compatible. Auth endpoints unchanged. Docs: `docs/architecture/identity-engine-v2.md`.
-   **Player Claim System (Phase 11b)**: Backend architecture for verified player identity linking. New domain: `server/domains/player-claims/` with repository, service, and routes. New schema: `shared/schema/claims.ts` with `player_claims` and `player_public_profiles` tables. A user can claim a player asset; upon admin approval, they gain the `player_profile_control` capability and can edit their public profile (bio, images, headline, social links, team). No new role is added — capabilities are derived from approved claims. Market data (price, supply, valuation) is never writable from this domain. Claim lifecycle: pending → approved/rejected, approved → revoked. User endpoints: POST `/api/player-claims`, GET `/api/player-claims/me`, GET/PATCH `/api/player-claims/me/profile`. Admin endpoints: GET/PATCH `/api/admin/player-claims` (list, approve, reject, revoke). Docs: `docs/product/player-claim-system-architecture.md`.
-   **Synthetic Market Engine (Phase 10)**: In-memory demo mode that activates automatically when no real Riot assets exist. 40 named synthetic players with archetypes (HYPERCARRY, TANK_ANCHOR, UTILITY_SUPPORT, ASSASSIN, VETERAN, WILDCARD, SPLITPUSHER, TEAMFIGHT_CARRY, SCALING_MAGE, ENGAGE_SUPPORT). Deterministic performance simulation (seeded by player ID + time bucket) produces prices, spreads, volume, momentum, PVI components, and a fair-value divergence signal. Valuation engine computes STRONG_BUY/BUY/HOLD/SELL/STRONG_SELL signals and breakout probabilities. Discovery engine surfaces up to 8 signals (UNDERVALUED_GEM, BREAKOUT_CANDIDATE, MOMENTUM_SURGE, MEAN_REVERSION, HOT_STREAK). 30-tick synthetic trade tape simulated per session. Terminal UI switches to demo mode: purple "Demo Mode" banner, scanner shows 40 synthetic rows, center panel gains a "Discovery" tab, trade ticket replaced with a read-only player card, trade tape shows bot-generated activity. All trading is disabled in demo mode with a clear prompt to connect a Riot account. API: GET /api/synthetic/terminal, GET /api/synthetic/player/:id, GET /api/synthetic/player/:id/history?tf=24h|7d|30d.
-   **Arena System**: Manages user progression through XP, rank tiers, achievements, and seasonal leaderboards, including an avatar system and a "Trader Style Engine." Competitive seasons include rewards and weekly challenges.
-   **Admin Market Lab v3** (`/admin/market-lab`): Full algorithm validation suite with v3 pricing engine. **Simulation** (`POST /api/admin/market-lab/simulate`) — role-based bot architecture (market_maker 35%, value 20%, trend 20%, random 15%, whale 10%) with strengthened stabilizer behavior using urgency multipliers (1.0×/2.0×/3.5× at normal/15%/25%+ divergence). **v3 Pricing Engine Fixes**: (1) FV-calibrated initial supply — starts at 92% of FV instead of fixed 150 tokens, eliminating the -37% structural undervaluation bias; (2) Dynamic nonlinear anchor (v3-dynamic) — piecewise convergence force replacing the old PAE fractional ticks: factors 0.015/0.030/0.055/0.090/0.140 at 0-5/5-10/10-15/15-25/25%+ divergence, capped at 2% of market price per step; (3) Divergence braking — same-direction flows dampened 20%/35%/50% at 15%/25%/35%+ divergence; (4) Value bot activation threshold lowered to 8% (was 10%). **SIM_CONFIG** — centralized tuning constants object (anchorFactorNear/Mild/Moderate/Strong/Emergency, maxAnchorStepPct, divergenceBrakeThreshold1/2/3, dampingFactor1/2/3, stabilizerBotBiasMild/Strong, valueBotMagnitudeScale/MaxMagnitude, initPriceToFvRatio). **Health Targets**: standard scenario (random/balanced/medium) H:65-70, AvgDiv 8-12%, MaxDiv 10-15% (was H:28-34, AvgDiv 22-34%). New params: `fairValueMode`, `anchorStrength`, `fvCurveExponent`, `botBehaviorMode`, `debugMode`. Response: `configSnapshot` (includes anchorEngineVersion:"v3-dynamic", anchorConfig, divergenceBrakeConfig, initialSupplyUsed), enhanced `summary` (totalBuyImpact, totalSellImpact, netExternalFlow added), per-step `timeline` (buyImpact, sellImpact, rawNetTokens added). Frontend: 6-card Contribution Decomposition (Trade Impact, Buy Impact, Sell Impact, Anchor Total, Bot Buy/Sell, Ext Buy/Sell), "Anchor Engine" + "Initial Supply" rows in Config Snapshot. **Live Market PAE** — also updated: PERF_ANCHOR_FACTOR_WEAK: 0.0003→0.0008, MODERATE: 0.0008→0.0020, STRONG: 0.0016→0.0040, MAX_MOVE: 0.006→0.010; GRAVITY_FACTOR: 0.0015→0.0025. **Stress Test** — also updated with FV-calibrated supply and v3 anchor.
-   **Weekly Performance Draft** — Full feature (backend + frontend):
    -   **Backend** (`server/modules/draft/`): Five Drizzle tables (`draft_weeks`, `draft_entries`, `draft_entry_picks`, `draft_player_week_metrics`, `draft_user_season_stats`). Full REST API with 6 endpoints mounted at `/api/draft/*` (auth-gated via `isAuthenticated`): GET/POST `/api/draft/entry`, PATCH `/api/draft/entry` (partial picks update), POST `/api/draft/lock` (validates all 8 slots filled), GET `/api/draft/weeks/current`, GET `/api/draft/players`. Controller uses `DraftValidationError` with typed error codes and status mapping.
    -   **Frontend** (`client/src/pages/arena-draft.tsx`): Full draft UI page at route `/arena/draft` with 8 slot cards (5 role + 3 performance), countdown timer to lock deadline, right-side player picker Sheet drawer with search+filter, save/lock flow with confirmation modal, progress bar, locked-state read-only mode. Integrated into ArenaTabNav across all arena pages (arena.tsx, arena-leaderboards.tsx, arena-achievements.tsx, arena-seasons.tsx).
    -   **Admin Draft Management** (`/admin/draft`): Admin UI for full draft week lifecycle management. Includes: Current Week Card (status badge, date display, Open/Lock/Close buttons, inline edit form), Create Draft Week Form (game, region, startAt/lockAt/endAt datetime-local inputs, initial status), All Weeks Table (paginated, 10/page, expand all, per-row Edit+Open+Lock+Close actions). All inputs datetime-local (browser local time → UTC on submit). Backend endpoints: `GET /api/draft/admin/weeks`, `POST /api/draft/admin/weeks`, `PATCH /api/draft/admin/weeks/:weekId`, `POST /api/draft/admin/weeks/:weekId/open|lock|close`. Admin tab added to `AdminLayout` nav. Route registered at `/admin/draft` in `App.tsx`.
    -   **Draft Scoring Engine** (`draft.scoring.ts`, `draft.jobs.ts`): Scores every pick in every `draft_entries` row for a given week using `draft_player_week_metrics`. Slot→metric map: top/jungle/mid/adc/support → `weekly_performance_score`; breakout_player → `breakout_score`; rising_star → `rising_star_score`; hidden_gem → `hidden_gem_score`. Ineligible or not-found picks score 0 with JSON `reason` field. Stores `score_breakdown_json` per pick. Computes `role_score`, `performance_score`, `total_score` per entry and sets `status="scored"`. XP award: `round(clamp(total_score/800, 0, 1) * 300)` max 300 XP/week — directly increments `arena_user_stats.xp_total`, updates rank, inserts `DRAFT_SCORED` arena event, updates `arenaUserSeasonStats.xp_season`. Updates `draft_user_season_stats` (running total + week count). Full idempotency: XP and season-stat updates are gated on `entry.status !== "scored"` — safe to re-run unlimited times. Manual trigger: `POST /api/draft/admin/score/current` or `POST /api/draft/admin/score/:weekId` (admin session required). Player identity note: picks use `riotPlayers.id`, metrics use `riotAssets.puuid` — currently yields `metrics_not_found` for all picks until player systems are unified.
    -   **Weekly Metrics Aggregator** (`draft.metrics.ts`, `draft.jobs.ts`): Computes and upserts `draft_player_week_metrics` for all riotAssets players keyed by `puuid`. Metrics computed: `matches_count`, `avg_match_score`, `weekly_performance_score` (recency-decay weighted, DECAY=5%/slot), `role_code` (dominant team_position in week), `pvi_start/end/delta`, `fair_value_start/end`, `market_price_start/end`, `undervaluation_level` = (FV−Price)/FV, `breakout_score` = weekly_perf − 30d-baseline (career avg fallback), `rising_star_score` = pvi_delta, `hidden_gem_score` = weekly_perf + max(pvi_delta,0) + max(underval,0), `eligible` = matches≥3 AND known role. Idempotent (select-then-update/insert with unique constraint `draft_pw_metrics_player_week_uq`). Manual trigger: `POST /api/draft/admin/metrics/current` or `POST /api/draft/admin/metrics/:weekId` (admin session required). Key assumptions documented in module header: no PVI history table (pvi_delta=0), no FV history (start=end), `market_price_start` = `price24hAgo` (24h proxy). Player identity note: `player_id` = `riotAssets.puuid` (not `riotPlayers.id`) since only riotAssets players have match data; scoring engine must bridge the two player systems when implemented.
    -   **DB**: Active draft week in `draft_weeks` (status=open, locks 2026-03-13). Schema: 5 tables with varchar UUIDs, FKs, indexes, and unique constraint on `(player_id, week_id)` in metrics table. Draft slot types: top/jungle/mid/adc/support/breakout_player/rising_star/hidden_gem.
-   **Admin User Management** (`/admin/users`): Full user management interface. Features: Role column with admin badges, status badges (Active/Blocked/Deleted). Actions per user: View profile, Block/Unblock, Make Admin/Remove Admin (PATCH `/api/admin/users/:id/role`), Reset Password (PATCH `/api/admin/users/:id/password`, bcrypt hash, min 8 chars), Soft Delete (DELETE `/api/admin/users/:id`, sets status="deleted" preserving all financial/arena data). Self-protection guards prevent admins from deleting or demoting their own account. Soft-deleted users cannot log in. Login endpoint updated to reject `status="deleted"` users.

## Architecture Refactor Status

### Phase 1 — Audit (complete)
Architecture audit docs created in `docs/architecture/`:
- `architecture-audit.md` — KEEP/REFACTOR/DEPRECATE verdict per file + 5-phase plan
- `module-inventory.md` — full table of all files with domain assignment
- `target-domain-map.md` — 14 future domain boundaries

### Phase 2 — Domain scaffolding (complete)
`server/domains/` directory created with 9 domain subdirectories, each containing an empty `routes.ts` stub:

| Domain | Stub file | Routes (when migrated) |
|---|---|---|
| `identity` | `server/domains/identity/routes.ts` | auth, access-requests, waitlist |
| `player` | `server/domains/player/routes.ts` | riot leaderboard, player list |
| `performance` | `server/domains/performance/routes.ts` | match scores, fundamentals |
| `valuation` | `server/domains/valuation/routes.ts` | PVI / fair value reads |
| `market` | `server/domains/market/routes.ts` | trade execution, AMM, orders, assets |
| `portfolio` | `server/domains/portfolio/routes.ts` | portfolio, terminal activity |
| `discovery` | `server/domains/discovery/routes.ts` | assets explorer, watchlist, snapshots |
| `arena` | `server/domains/arena/routes.ts` | XP, achievements, seasons, duels |
| `admin` | `server/domains/admin/routes.ts` | all /api/admin/* routes |

`server/routes.ts` (5,900+ lines) was transformed into an aggregator:
- All 9 domain `register*Routes(app)` stubs are imported and called at startup
- 16 `// ============================ // <DOMAIN> ROUTES // ============================` section headers added throughout the file marking domain boundaries
- All inline routes remain in place (no routes moved yet)

### Phase 3A — Initial route migration (complete)
Player (2), Performance (5), Valuation (1) routes migrated. routes.ts: 5,947 → 5,683 lines (−264 lines).

### Phase 3B — Discovery, Arena, Admin migration (complete)
Discovery (13), Arena (21), Admin (64) routes migrated in parallel — 98 routes total.
routes.ts: 5,683 → 1,964 lines (−3,719 lines). Cumulative total: 106 routes migrated, routes.ts reduced by 66.9%.

Key helpers moved:
- `mapToUnifiedAsset()` → `server/domains/discovery/routes.ts` (module-level)
- `handleArenaError()` → `server/domains/arena/routes.ts`
- `adminAuth` copied to `server/domains/admin/routes.ts` (routes.ts retains its copy for `app.use(adminAuth)`)

Remaining in `server/routes.ts` (36 routes):
- Identity/Auth, Portfolio, Legacy Market Sandbox, Riot/Terminal trading, News, System, Canonical Market, Orders/Trigger, Draft API

### Phase 3C — Complete (2026-03-09)
17 routes migrated across 4 new/populated domains:
- **Identity** (10 routes) → `server/domains/identity/routes.ts`: signup, login, logout, me, forgot-password, reset-password (×2), change-password, force-change-password, access-requests
- **Portfolio** (2 routes) → `server/domains/portfolio/routes.ts`: GET portfolio, GET terminal/activity/me
- **News** (2 routes) → `server/domains/news/routes.ts` (new file): /api/news/latest, /api/news/pulse
- **System** (2 routes) → `server/domains/system/routes.ts` (new file): /api/version, /api/market/health
- **Draft API** (1 `app.use`) → `server/domains/arena/routes.ts`: /api/draft mounted with isAuthenticated

routes.ts: 1,964 → 1,356 lines (−608 lines). Cumulative Phase 3A+B+C: 123 routes migrated, routes.ts reduced 77.2% from original 5,947 lines.

Remaining in `server/routes.ts` (20 routes — market/trading only):
- Legacy sandbox seed, trade execution, recent trades, market stats
- Riot asset/trades endpoints, terminal market state, AMM quote
- Market heatmap, index, canonical assets registry, snapshots
- SSE stream, orders (placement, list, detail, cancel)

### Phase 9 — Legacy Freeze & Retirement Plan (Complete 2026-03-09)
Final architectural phase. Identified, annotated, and documented all legacy/sandbox code. Established official development path and guardrails.

**Legacy points marked (FREEZE / LEGACY / SANDBOX ONLY):**
- `server/storage.ts` — vault interface section annotated
- `server/domains/trading/routes.ts` — sandbox section freeze notice added
- `server/domains/discovery/routes.ts` — vault list/get endpoints annotated
- `server/domains/market/routes.ts` — sandbox recent trades annotated
- `server/domains/portfolio/routes.ts` — sandboxOut merge block annotated
- `server/market-core/startup-seed.ts` — sandbox market seed section annotated
- `server/market-core/backfill-trading-assets.ts` — LEGACY header added
- `client/src/hooks/use-vaults.ts` — LEGACY header with official replacement path
- `client/src/pages/vault-detail.tsx` — LEGACY header with retirement plan
- `server/name-generator.ts` / `server/services/botTrader.ts` — already `@deprecated` from Phase 6

**Documents created:**
- `docs/architecture/legacy-freeze-and-retirement-plan.md` — executive summary, official path, full legacy inventory, retirement classification (KEEP/MIGRATE/SANDBOX ONLY/REMOVE), guardrails
- `docs/architecture/official-development-rules.md` — quick-reference rules for daily development

**Official architecture path (Phase 9+):** `server/domains/` + `server/integrations/` + `server/events/` + `server/web3/` + `server/simulation/` (isolated). Sandbox/vault model is frozen — no new features.

### Phase 8 — Web3 Readiness Layer (Complete 2026-03-09)
Created `server/web3/` — pure interface contracts and event bridge for future blockchain integration. No external deps, no schema changes, no core changes.

**Files created:**
- `server/web3/interfaces/wallet-link-adapter.ts` — wallet linking contract (requestLink, confirmLink, unlink, listLinkedWallets)
- `server/web3/interfaces/treasury-settlement-adapter.ts` — fee payout contract (queuePayout, markSettled, markFailed)
- `server/web3/interfaces/asset-mirror-adapter.ts` — on-chain event mirroring contract (mirrorTrade, mirrorTreasuryCredit, mirrorSeasonReward)
- `server/web3/models/external-identity.ts` — ExternalIdentity type + address normalization helpers
- `server/web3/models/wallet-link.ts` — WalletLink + nonce model + SIWE message builder
- `server/web3/services/web3-event-bridge.ts` — event bus observer (TradeExecuted, FeeCaptured, ArenaXpGranted, ValuationUpdated); adapter injection via setWeb3Adapters()
- `server/web3/index.ts` — public API

**Bootstrap:** `registerWeb3Bridge()` called in `server/index.ts` after `registerAllHandlers()`.
**Mode:** Observation only. No adapters active. All handler slots wired and ready for Phase 9 injection.
**Principle:** Core never imports from server/web3/. Web3 is opt-in via event bus.

### Phase 7 — Internal Domain Event Hooks (Complete 2026-03-09)
Introduced a lightweight in-memory event bus (`server/events/`) for domain decoupling.

**Files created:**
- `server/events/domain-events.ts` — typed event definitions + factory helpers (6 event types)
- `server/events/event-bus.ts` — singleton in-memory bus (synchronous fan-out, named handlers, error isolation)
- `server/events/handlers/arena-event-handlers.ts` — TradeExecuted (shadow), ArenaXpGranted
- `server/events/handlers/market-event-handlers.ts` — TradeExecuted, OrderPlaced, OrderCancelled
- `server/events/handlers/valuation-event-handlers.ts` — ValuationUpdated (active)
- `server/events/handlers/treasury-event-handlers.ts` — FeeCaptured (shadow, emitter deferred)
- `server/events/index.ts` — public API + `registerAllHandlers()`

**Emitters wired:**
- `server/services/tradeExecutor.ts` → emits `TradeExecuted` (shadow alongside direct `updateArenaOnTrade`)
- `server/services/valuationJob.ts` → emits `ValuationUpdated` (active, non-mutating)

**Bootstrap:** `registerAllHandlers()` called in `server/index.ts` before routes are registered.

**Design:** No external deps, synchronous fan-out, fire-and-forget via `emitBackground()`, all direct calls preserved.

### Phase 6 — Simulation Isolation (Complete 2026-03-09)
Isolated all simulation/sandbox code from the core into `server/simulation/`.

**Files created:**
- `server/simulation/players/name-generator.ts` — summoner name generation + vault migration
- `server/simulation/players/dummy-player-generator.ts` — 1000 synthetic player generator
- `server/simulation/bots/bot-trader.ts` — 100-bot simulation (7 strategies)
- `server/simulation/services/simulation-market-service.ts` — operational façade
- `server/simulation/index.ts` — public API

**Originals converted to re-export shims:** `server/name-generator.ts`, `server/services/botTrader.ts`

**Callers updated:** `server/routes.ts`, `server/index.ts`, `server/domains/admin/routes.ts`, `server/domains/trading/routes.ts` (inline `generateDummyPlayers()` removed — now imports from simulation)

**Boundary:** Core (`services/`, `domains/`, `market-core/`) never imports from `simulation/`. Simulation may import from core services (trade executor) — direction is simulation → core only.

### Phase 5C — Job Service Layer (Complete 2026-03-09)
Introduced a formal job service layer in `server/integrations/jobs/`. Admin handlers no longer import from `riot-sync.ts` or `riot-perf.ts` directly.

**Services created:**
- `performance-sync-service.ts` — `syncChallengerRoster()`, `getStatus()` (wraps `syncChallengerNA1`, `getMatchCacheCount`, `getPerfJobStatus`)
- `performance-batch-service.ts` — `runBatch()` (wraps `runPerfPricingJob`)

**Admin endpoints migrated:**
- `POST /api/admin/riot/sync/challenger-na1` → `performanceSyncService.syncChallengerRoster()`
- `GET /api/admin/riot/status` → `performanceSyncService.getStatus()`
- `POST /api/admin/riot/perf/run` → `performanceBatchService.runBatch()`

**Boundary established:** Provider = read/data access. Job Service = operational orchestration. Core modules (`riot-sync.ts`, `riot-perf.ts`) untouched.

### Phase 5B — PerformanceProvider Expansion (Complete 2026-03-09)
Expanded provider usage to all remaining read endpoints. Added `getLeaderboard()` + `LeaderboardEntry` type to interface.

**Migrated endpoints:**
- `GET /api/riot/leaderboard` → `provider.getLeaderboard(300)`
- `GET /api/player/fundamentals/:puuid` → `provider.getPlayerFundamentals(puuid)`
- `GET /api/performance/asset/:assetId/latest` → `provider.getLatestPerformanceScore(puuid)`

**Kept as direct DB reads (intentionally):** admin performance baselines/history/match-detail — engine-internal state that should not cross the provider boundary.

### Phase 5A — PerformanceProvider Abstraction (Complete 2026-03-09)
Introduced a `PerformanceProvider` interface to decouple the core from Riot API direct calls.

**Files created:**
- `server/integrations/interfaces/performance-provider.ts` — interface + types (PlayerRecord, PlayerFundamentals, PerformanceScore, MatchSummary)
- `server/integrations/riot/performance-provider.ts` — adapter delegating to `riot-sync.ts` + `riot-perf.ts`
- `server/integrations/synthetic/performance-provider.ts` — adapter backed by sandbox `vaults` table
- `server/integrations/performance-provider-factory.ts` — resolves provider from `PERFORMANCE_PROVIDER` env var or market mode

**Integration point:** `server/domains/player/routes.ts` → `GET /api/riot/players` now routes through the factory.

**Preserved untouched:** `riot-sync.ts`, `riot-perf.ts`, `performanceEngine.ts`, all market/trade flows.

### Phase 4 — Schema Modularization (Complete 2026-03-09)
`shared/schema.ts` (973 lines) broken into 11 domain files + 1 index under `shared/schema/`:

| File | Tables |
|---|---|
| `auth.ts` | users, sessions, accessRequests, passwordResetTokens, waitlist |
| `player.ts` | riotPlayers, riotAssets, riotMatchCache, riotPlayerState, markets, assets, vaults, vaultSnapshots |
| `performance.ts` | roleBaselines, roleMetricWeights, playerMatchMetrics, performanceScores |
| `valuation.ts` | assetValuationState |
| `market.ts` | appConfig, assetMarkets, assetMarketState, assetPriceSnapshots, idempotencyKeys, marketSyncRuns, marketSyncStatus, triggerOrders, triggerOrderEvents, newsEvents, assetNewsPulses |
| `portfolio.ts` | portfolios, positions, trades, riotPositions, riotTrades, ledgerEntries |
| `discovery.ts` | watchlist, assetWatchlist |
| `arena.ts` | arenaProfiles, arenaUserStats, arenaEvents, achievementsCatalog, userAchievements, arenaSeasons, arenaUserSeasonStats, arenaSeasonLeaderboardSnapshot, arenaBadges, userBadges, seasonRewards, seasonRewardDistributions, arenaChallenges, arenaTraderFollows, arenaDuels + draft re-exports |
| `simulation.ts` | botProfiles |
| `treasury.ts` | feeLedger, playerFeeBalance |
| `admin.ts` | (empty — no admin-only tables) |

`shared/schema.ts` converted to a 6-line compatibility shim (`export * from "./schema/index"`). All existing imports unchanged. Zero breaking changes.

### Phase 3D — Complete (2026-03-09)
Final 20 routes migrated — `server/routes.ts` is now a pure aggregator (184 lines):

- **Market** (13 routes) → `server/domains/market/routes.ts` (620 lines): recent trades, market stats, riot asset detail, riot recent trades, riot asset trades, terminal market, market heatmap, market index, canonical assets list/detail/snapshots, AMM quote, SSE terminal stream
- **Trading** (3 routes + seed) → `server/domains/trading/routes.ts` (434 lines): sandbox seed, sandbox trade execution, riot trade execution. `generateDummyPlayers()` moved here from routes.ts.
- **Orders** (4 routes) → `server/domains/orders/routes.ts` (156 lines): POST /api/orders, GET /api/orders/me, GET /api/orders/:id, POST /api/orders/:id/cancel

routes.ts: 1,356 → 184 lines (−1,172 lines). **Cumulative Phase 3A+B+C+D: 143 routes migrated, routes.ts reduced 96.9% from original 5,947 lines.**

`server/routes.ts` now contains only: imports, session middleware declaration, `adminAuth` middleware, `ensureAdminUser()`, and `registerRoutes()` with init + domain wiring.

## External Dependencies

-   **PostgreSQL**: Primary relational database.
-   **Drizzle ORM**: Used for database schema definition and interaction.
-   **Replit OIDC**: Provides OpenID Connect for user authentication.
-   **connect-pg-simple**: Manages PostgreSQL-backed session storage.
-   **TanStack Query v5**: For client-side data fetching and caching.
-   **Recharts**: Utilized for rendering charts and data visualizations.
-   **Framer Motion**: For declarative animations in the UI.
-   **shadcn/ui + Radix UI**: Provides accessible and customizable UI components.
-   **Tailwind CSS**: For utility-first styling.
-   **wouter**: A lightweight client-side router.
-   **Zod**: For schema validation across the stack.
-   **React Hook Form**: Manages form state and validation.
-   **Google Fonts**: For custom typography.
## Sprint 3.5 — Admin Predict Console + Media System

### Etapa 3 — Media System (2026-03-15)

Full media upload/library system for the Admin Predict Console.

**New tables:**
- `media_assets` — stores uploaded image metadata (storage_key, public_url, mime_type, file_name, file_size, asset_type, created_by, is_active)
- `prediction_event_media` — join table linking prediction events to media assets (usage_type: card/hero/thumbnail/banner, sort_order)

**New backend domain (`server/domains/media/`):**
- `repository.ts` — DB queries for asset CRUD + event-media links
- `service.ts` — file validation (mime, size), disk write to `server/uploads/media/`, DB record creation
- `routes.ts` — REST handlers; multer memory-storage for uploads

**New API endpoints (mounted at `/api/admin/media`):**
- `POST /api/admin/media/upload` — multipart file upload (field name: `file`)
- `GET  /api/admin/media` — paginated asset library (limit/offset)
- `GET  /api/admin/media/:id` — single asset
- `GET  /api/admin/media/events/:eventId` — media attached to a prediction event
- `POST /api/admin/media/events/:eventId` — attach asset to event (body: mediaAssetId, usageType, sortOrder)

**Static file serving:** uploaded files stored in `server/uploads/media/`, served at `/uploads/media/<storage_key>` via `express.static`.

**Updated frontend pages:**
- `client/src/pages/admin/media.tsx` — full rewrite: drag-and-drop upload zone, confirm/cancel flow, grid/list view toggle, copy-URL on hover
- `client/src/pages/admin/event-detail.tsx` — Media section replaced: shows attached assets grid + attach-from-library form (asset picker + usage type dropdown)

**External dependency added:** `multer` + `@types/multer`

### Home Page Redesign (2026-03-16 — Complete)
**Spec:** Hero + Upcoming side-by-side at top; Featured row below; Trade Markets rail from real player data.

**Layout:**
- `MarketPulseTicker` — top ticker (unchanged)
- Top row: `HomeHeroSection` (editorial hero event, flex-1) + `HomeUpcomingPanel` (300-320px, upcoming events list) — side-by-side on desktop, stacked on mobile
- `HomeFeaturedRow` — horizontal scroll of featured event cards (only renders if `featuredEvents.length > 0`)
- `HomeTradeMarketsRail` — horizontal scroll of player cards from real `/api/market/assets` data (no mock)

**New/updated files:**
- `client/src/features/home/types/home.ts` — Added `FeaturedEventVM`, `TradeMarketAssetVM`; updated `HomeViewModel` (removed `heroMarket`, `liveMarkets`, `upcomingSpotlight`, `hotPlayers`; added `heroEvent`, `upcomingEvents[]`, `featuredEvents[]`)
- `client/src/features/home/mappers/mapHomeResponseToVM.ts` — Removed `MOCK_HOT_PLAYERS`; mapper now produces editorial-driven `heroEvent`, `upcomingEvents`, `featuredEvents`
- `client/src/features/home/hooks/useTradeMarkets.ts` — New hook; fetches `/api/market/assets?limit=10&sort=volume24h`; computes `change24hPct` from `lastTradePrice`/`price24hAgo`
- `client/src/features/home/components/HomeHeroSection.tsx` — New; editorial hero event card with image/gradient background, teams, timer, CTA
- `client/src/features/home/components/HomeUpcomingPanel.tsx` — New; vertical list of upcoming events from queue "upcoming"
- `client/src/features/home/components/HomeFeaturedRow.tsx` — New; horizontal scroll of featured event cards from queue "featured"
- `client/src/features/home/components/HomeTradeMarketsRail.tsx` — New; Trade Markets rail using real asset data; shows skeleton while loading
- `client/src/features/home/components/HomeSkeleton.tsx` — Updated to match new three-section layout
- `client/src/features/home/pages/HomePage.tsx` — Full redesign; removes sidebar, uses new layout

**Data sources:**
- Hero/Upcoming/Featured: `GET /api/predictions/home` → `publicSurfaces.hero`, `.upcomingEventsEditorial`, `.featuredEvents`
- Trade Markets: `GET /api/market/assets` (real `assets` table data — same source as Terminal)

**TS baseline:** 89 errors maintained (no new errors introduced)

### Fase 1 — Multigame Architecture Foundation (2026-03-17 — Complete)
**Goal:** Add canonical identity layer (`connectedAccounts`, `playerProfiles`) and multigame columns to `assets` to support expanding beyond LoL.

**New tables (PostgreSQL):**
- `connected_accounts` — links a GamerStock user to their external provider accounts (Riot, Steam, etc.). Columns: `userId→users`, `providerGroup`, `game`, `providerAccountId`, `providerAccountName`, `providerProfileUrl`, `verificationStatus` (PENDING/VERIFIED/REJECTED), `isPrimary`, `linkedAt`, `lastVerifiedAt`, `createdAt`, `updatedAt`. Unique constraint on `(userId, providerGroup, game, providerAccountId)`.
- `player_profiles` — canonical esports identity in GamerStock, one per (game, player). Columns: `game`, `canonicalName`, `primaryConnectedAccountId→connectedAccounts`, `status` (DRAFT/ACTIVE/INACTIVE/BLOCKED), `createdAt`, `updatedAt`.

**Modified table:**
- `assets` — added `playerProfileId` (FK→`player_profiles`, nullable, SET NULL on delete), `tradingStatus` (VARCHAR 32, default ACTIVE), `listingStatus` (VARCHAR 32, default LISTED). All 300 existing LoL assets retain `playerProfileId=null` (migration in Fase 2).

**New schema file:** `shared/schema/multigame.ts` — enums (`GAMES`, `PROVIDER_GROUPS`, `VERIFICATION_STATUS_VALUES`, `PLAYER_PROFILE_STATUS_VALUES`), table definitions, insert schemas, and inferred types.

**New domain:** `server/domains/multigame/`
- `repository.ts` — CRUD for ConnectedAccounts, PlayerProfiles; `listTerminalAssets()` + `findTerminalAssetById()` queries with `markets` JOIN for game/provider context.
- `routes.ts` — All endpoints registered via `registerMultigameRoutes(app)`.

**API endpoints:**
- `GET /api/me/connected-accounts` — authenticated user's linked accounts
- `POST /api/me/connected-accounts` — link a new provider account
- `PATCH /api/me/connected-accounts/:id` — update account details
- `DELETE /api/me/connected-accounts/:id` — unlink account
- `GET /api/me/player-profiles` — authenticated user's player profiles
- `POST /api/me/player-profiles` — create player profile (with optional connectedAccount link + game validation)
- `GET /api/terminal/assets` — **public** paginated asset catalog (filters: game, tradingStatus, listingStatus, limit, offset)
- `GET /api/terminal/assets/:id` — **public** single asset by id

**Auth guard:** `/api/terminal/assets` added as public exception in `adminAuth` middleware (same pattern as `/api/market/` and `/api/performance/`).

**TS baseline:** unchanged (all new code compiles clean; `as any` casts only on Drizzle insert calls for Zod `.$type<>()` schema compatibility)

### Fase 2 — Dota2 Onboarding Foundation (2026-03-17 — Complete)
**Goal:** Implement operational foundation for Dota2 onboarding: Steam ConnectedAccount → PlayerProfile → Asset stub → EligibilitySnapshot, without activating trading/listing or implementing analytics.

**New table (PostgreSQL):**
- `player_eligibility_snapshots` — immutable point-in-time snapshots of a player's eligibility state. Columns: `playerProfileId→player_profiles`, `game`, `isEligible`, `reasonCode` (PENDING_DATA_COLLECTION/INSUFFICIENT_SAMPLE/etc.), `sampleSize`, `dataCompleteness` (0.0000–1.0000), `roleDetectability` (0.0000–1.0000), `rankSignal`, `snapshotJson`, `createdAt`. ON DELETE CASCADE so removing the profile removes all its snapshots.

**New DB constraints:**
- Partial unique index on `player_profiles(primary_connected_account_id) WHERE NOT NULL` — prevents one ConnectedAccount from owning more than one PlayerProfile
- Global unique index on `connected_accounts(provider_group, game, provider_account_id)` — prevents the same external identity (e.g. a Steam ID) from being claimed by two different GS users

**New schema exports** (`shared/schema/multigame.ts`):
- `ELIGIBILITY_REASON_CODES` enum + `EligibilityReasonCode` type
- `playerEligibilitySnapshots` table + insert schema + types

**New service** (`server/domains/multigame/dota2OnboardingService.ts`):
- `connectDota2Account(userId, input)` — atomic 6-step orchestration:
  1. Global dedup check (STEAM_ID_ALREADY_CLAIMED → 409 if claimed by another user; idempotent if same user)
  2. Create `connected_account` (steam, dota2, verificationStatus=PENDING)
  3. Create/recover `player_profile` (dota2, status=DRAFT)
  4. Upsert `steam/dota2/global/default` market (one shared market for all Dota2 players)
  5. Create `asset` stub (tradingStatus=DRAFT, listingStatus=UNDER_REVIEW) — NOT listed/visible
  6. Create initial `player_eligibility_snapshot` (isEligible=false, PENDING_DATA_COLLECTION)
- `getDota2Status(userId)` — read-only: returns current bootstrap state

**Updated repository** (`server/domains/multigame/repository.ts`):
- `findConnectedAccountByIdForUser()` — ownership-safe lookup
- `findConnectedAccountByProviderIdentity()` — global dedup check
- `findPlayerProfileByConnectedAccountId()` — one-to-one link lookup
- `findOrCreateMarket()` — upsert market by provider+game+region+scope
- `findAssetByUid()`, `findAssetByPlayerProfileId()` — asset dedup checks
- `createAssetStub()` — creates a DRAFT/UNDER_REVIEW asset
- `createEligibilitySnapshot()`, `findLatestEligibilitySnapshot()`, `findAllEligibilitySnapshots()`
- `updatePlayerProfileStatus()` — for Fase 3 promotion (DRAFT → ACTIVE)
- Fixed `inArray` nullable column type issue in `findPlayerProfilesByUser()`

**New API endpoints** (`POST/GET /api/me/dota2/*`):
- `POST /api/me/dota2/connect` — atomic onboarding (201=new, 200=idempotent reconnect, 409=duplicate Steam ID)
- `GET /api/me/dota2/status` — current bootstrap state inspection
- `GET /api/me/dota2/eligibility` — latest + full history of eligibility snapshots

**Dota2 asset lifecycle:**
```
connect → Asset(tradingStatus=DRAFT, listingStatus=UNDER_REVIEW)
                    ↓ Fase 3: match ingestion
         EligibilitySnapshot refreshed (reasonCode → DATA_READY or ELIGIBLE)
                    ↓ Admin review
         Asset(tradingStatus=ACTIVE, listingStatus=LISTED) — visible in terminal
```

**LoL preserved:** zero changes to LoL flow, assets, markets, or profiles.

**TS baseline:** 89 errors maintained (no new errors introduced)

**Ready for Fase 3:** `player_eligibility_snapshots` ready for analytical refresh after match ingestion. `updatePlayerProfileStatus()` available to promote DRAFT→ACTIVE. Dota2 market (steam/dota2/global/default) auto-seeded on first connect and reused for all subsequent Dota2 players.

### Fase 3 — Dota2 Match Ingestion Foundation (2026-03-17 — Complete)
**Goal:** Implement real match ingestion pipeline: fetch from OpenDota API → persist raw data → dedup/idempotency → update eligibility with real facts.

**Architecture layers:**
- `server/domains/multigame/providers/openDotaClient.ts` — OpenDota API wrapper (no key required). `steamId64ToAccountId32()`, `fetchPlayerMatches()`, `fetchMatchDetail()`, `fetchPlayerInfo()`, `lobbyTypeToQueueLabel()`, `rankTierToBucket()`.
- `server/domains/multigame/dota2MatchSyncService.ts` — sync orchestration. `syncDota2Matches()` (8-step pipeline) + `getDota2MatchList()` (inspection).
- Repository additions: `upsertMatchSourceData()`, `bulkUpsertMatchSourceData()`, `listMatchSourceDataByProfile()`, `countMatchSourceDataByProfile()`, `countRankedMatchesByProfile()`, `findMatchByProviderIdentity()`, `findExistingProviderMatchIds()`, `findDota2ConnectedAccount()`.

**New table:** `player_match_source_data` — 22 columns, 8 indexes (1 PK + 1 unique on `(player_profile_id, provider_group, provider_match_id)` + 6 lookup indexes).

**New schema exports** (`shared/schema/multigame.ts`):
- `MATCH_SOURCE_STATUS_VALUES` enum: `RAW_FETCHED | DETAIL_FETCHED | PROCESSING_PENDING | PROCESSED | FAILED | SKIPPED`
- New reason codes: `INSUFFICIENT_MATCH_HISTORY | INCOMPLETE_SOURCE_DATA | READY_FOR_ANALYTICS | PROVIDER_SYNC_FAILED`
- `PlayerMatchSourceDatum` type + `insertPlayerMatchSourceDataSchema`

**Sync flow (8 steps):**
1. Locate user's steam+dota2 ConnectedAccount + dota2 PlayerProfile
2. Fetch current rank from OpenDota (best-effort, non-blocking)
3. Fetch match summaries (default 50, up to 500)
4. Dedup: find existing providerMatchIds in DB
5. Build upsert payloads (isRanked = lobby_type===7, queueType = lobby label, rankBucket = current rank)
6. Bulk upsert (ON CONFLICT DO UPDATE on unique key)
7. Count totalMatches + rankedMatches from DB
8. Create new EligibilitySnapshot with real facts (sampleSize, dataCompleteness, reasonCode)

**Eligibility thresholds:**
- 0 matches → `PENDING_DATA_COLLECTION`
- <10 ranked → `INSUFFICIENT_MATCH_HISTORY`
- ≥10 ranked, completeness <50% → `INCOMPLETE_SOURCE_DATA`
- ≥10 ranked, completeness ≥50% → `READY_FOR_ANALYTICS` (Fase 4 promotes to ELIGIBLE)
- provider failure → `PROVIDER_SYNC_FAILED`

**New endpoints (Fase 3):**
- `POST /api/me/dota2/sync-matches` — trigger match sync (body: `{limit?: number}`)
- `GET /api/me/dota2/matches` — inspect persisted matches (query: `?limit=20&offset=0`)

**TS baseline:** 89 errors maintained.

**Ready for Fase 4:** `playerMatchSourceData` rows with `matchStatus=RAW_FETCHED` are ready for role detection + performance scoring. `READY_FOR_ANALYTICS` reason code signals sufficient data. `countRankedMatchesByProfile()` provides direct eligibility fact. `bulkUpsertMatchSourceData()` can promote status to `PROCESSING_PENDING` for async Fase 4 workers.

### Fase 4 — Dota2 Match Enrichment + Analytics (Complete)

- **`dota2MatchEnrichmentService.ts`** — 7-step pipeline: raw→detail fetch, role detection (P1-P5 via lane/farm/support heuristics), eligibility, metrics extraction, analytics upsert, status promotion.
- **3 new tables (DDL applied):** `player_match_analytics` (main enrichment store), `performance_baselines`, `performance_metric_weights`.
- **New endpoints:** `POST /api/me/dota2/process-matches`, `GET /api/me/dota2/match-analytics`.

### Fase 5 — Dota2 Baseline Builder + RoleRelativeScore (Complete)

- **`dota2MetricConfig.ts`** — canonical P1-P5 metric weight tables for 9 composite metrics.
- **`dota2MetricDeriver.ts`** — derives 9 composite metrics from raw analytics.
- **`dota2BaselineBuilder.ts`** — builds median/MAD cohort baselines at 3 specificity levels (A: hero+role+rank+patch+duration, B: no hero, C: role+rank only).
- **`dota2ScoreCalculator.ts`** — robust z-score + weight redistribution for missing metrics.
- **`dota2BaselineService.ts`** — orchestrator: rebuild-baselines + score-matches + getDota2ScoreComponents.
- **New table (DDL applied):** `performance_score_components`.
- **New endpoints:** `POST /api/admin/dota2/rebuild-baselines`, `POST /api/me/dota2/score-matches`, `GET /api/me/dota2/score-components`.

### Fase 6 — Dota2 PerformanceScore Aggregation (Complete)

Aggregates RoleRelativeScore (Fase 5) + SelfTrendScore + ContextScore into a single `PerformanceScore [0-100]`.

**Formula:**
- `effective_self_trend_weight = 0.25 × trend_confidence`
- `effective_context_weight = 0.15` (fixed)
- `effective_role_weight = 1 − effective_self_trend_weight − 0.15`
- `PerformanceScore = role_w × RRS + trend_w × SelfTrend + ctx_w × ContextScore`

**New files:**
- `dota2SelfTrendCalculator.ts` — self-vs-own-history z-score; TREND_WINDOW=20; confidence tiers ≥15/8/3 → 1.00/0.70/0.40/0.00.
- `dota2ContextCalculator.ts` — 5 sub-scores: MatchDifficulty 35%, MatchLengthFit 20%, ObjectiveLeverage 20%, WinLossContext 15%, RoleExpectationFit 10%.
- `dota2PerformanceService.ts` — Fase 6 orchestrator: loads score components + history → calls both calculators → aggregates → upserts.

**New table (DDL applied):** `dota2_performance_scores` (unique on `player_match_analytics_id`; note: `performance_scores` is pre-existing LoL table — must NOT be modified).

**New repository functions:** `findAnalyticsByIds`, `upsertDota2PerformanceScore`, `listDota2PerformanceScores`, `countDota2PerformanceScores`, `avgDota2PerformanceScoreByProfile`.

**New endpoints:**
- `POST /api/me/dota2/compute-performance` — compute and persist PerformanceScore for all eligible matches (body: `{scoreLimit?: number}`).
- `GET /api/me/dota2/performance-scores` — read persisted PerformanceScores with full audit breakdown (query: `?limit=20&offset=0&role=P1`).

**TS baseline:** 89 errors maintained throughout all Fases 1-6.

### Fase 7 — Dota2 Valuation Pipeline (Complete)

Implements the full ConfidenceScore → InitialValue → RawValue → PlayerValue pipeline.

**Key principle:** Value ≠ Price. Price comes from the market (AMM). Value is a fundamental estimate. These must never be mixed.

**New files:**
- `dota2ConfidenceCalculator.ts` — ConfidenceScore (0..1) with 4 components:
  - SampleConfidence = clamp(sample_size / 30, 0, 1)
  - RoleConfidence = avg(role_confidence) from recent analytics; fallback to role_detectability
  - DataCompleteness = data_completeness from eligibility snapshot (0..1)
  - RankStability = rank_signal bucket proxy (immortal=1.0 … herald=0.35)
  - Also exports `estimateMmrFromRankSignal` for InitialValue MMR proxy
- `dota2ValuationService.ts` — orchestrates bootstrap + update + read:
  - `bootstrapDota2Valuation`: InitialValue = clamp(8+10×mmrNorm+3×wrNorm+2×gamesFactor, 6, 25); logs BOOTSTRAP history
  - `updateDota2Valuation`: RawValue EMA update (α=0.08, β=0.10); logs MATCH_UPDATE per score
  - `getDota2Valuation` / `getDota2ValueHistory`: read-only access

**New tables (DDL applied):** `dota2_valuation_state` (current state, unique on asset_id), `dota2_value_history` (append-only audit trail).
Note: `asset_valuation_state` is pre-existing LoL table — must NOT be modified.

**New repository functions:** `upsertDota2ValuationState`, `getDota2ValuationState`, `insertDota2ValueHistory`, `listDota2ValueHistory`, `countDota2ValueHistory`.

**New endpoints:**
- `POST /api/me/dota2/bootstrap-valuation` — compute ConfidenceScore + InitialValue; idempotent
- `POST /api/me/dota2/update-valuation` — apply performance scores to update RawValue/PlayerValue
- `GET /api/me/dota2/valuation` — read current valuation state
- `GET /api/me/dota2/valuation-history` — audit trail (query: `?limit=20&offset=0&eventType=BOOTSTRAP|MATCH_UPDATE|RECALC|MANUAL_ADJUSTMENT`)

**TS baseline:** 89 errors maintained throughout all Fases 1-7.

### Fase 8 — Valuation Safety + Idempotency + Terminal Fundamentals (Complete)

Adds idempotency guard to the update pipeline, ensures each performance score is applied at most once, and exposes a terminal-facing fundamentals read model.

**Idempotency columns added to `dota2_performance_scores`:**
- `applied_to_valuation BOOLEAN NOT NULL DEFAULT FALSE` — pending (false) vs applied (true)
- `applied_to_valuation_at TIMESTAMP` — when it was applied
- `valuation_history_id INTEGER` — FK into `dota2_value_history` for full audit link
- Index `ps_applied_idx` on `applied_to_valuation` for efficient filtering

**Service refactor (`dota2ValuationService.ts` — `updateDota2Valuation`):**
- Only loads scores with `applied_to_valuation = false` (chronological ASC order)
- Early return with zero DB writes when no pending scores exist
- After each `insertDota2ValueHistory`, calls `markDota2PerformanceScoreApplied(scoreId, histId)` atomically
- Re-running update-valuation is fully safe — already-applied scores are never double-counted

**New repository functions:**
- `markDota2PerformanceScoreApplied(scoreId, historyId)` — idempotency fence writer
- `findDota2AssetFundamentals(assetId)` — joins assets + markets + dota2_valuation_state; returns `pendingScoreCount`
- `listDota2PerformanceScores` now accepts `applied?: boolean` and `orderAsc?: boolean`

**New endpoint:**
- `GET /api/terminal/assets/:id/fundamentals` — public read model; returns asset metadata + Dota2 valuation state + `pendingScoreCount`

**Updated endpoints:**
- `GET /api/me/dota2/performance-scores` now accepts `?applied=true|false` to filter by idempotency status

**TS baseline:** 89 errors maintained throughout all Fases 1-8.

### Fase 9 — Terminal Listing Workflow + Asset Promotion Rules (Complete)

Implements the full governance workflow for promoting a Dota2 player asset from stub to live terminal listing. Listing is a deliberate admin decision, never automatic.

**State machine:**
```
ONBOARDING → tradingStatus=DRAFT,   listingStatus=UNDER_REVIEW  (onboarding creates stub)
ADMIN APPROVE → tradingStatus=ACTIVE,  listingStatus=LISTED      (asset goes live in terminal)
ADMIN REJECT  → tradingStatus=DRAFT,   listingStatus=REJECTED    (back to draft, reason recorded)
```

**New table (DDL applied): `asset_listing_reviews`**
- `id, asset_id, game, decision (APPROVED|REJECTED), reason_code, snapshot_json, reviewed_by (nullable), created_at, updated_at`
- Append-only: one immutable row per admin decision
- `snapshotJson` captures the readiness state at decision time for full audit reconstruction

**New service: `dota2ListingEligibilityService.ts`**
- `evaluateDota2ListingReadiness(userId)` — read-only evaluation; returns structured `ListingReadinessSnapshot`
- 10 named checks: `hasConnectedSteamAccount`, `hasPlayerProfile`, `hasAsset`, `hasEligibilitySnapshot`, `rankedMatchesMet (≥10)`, `eligibleAnalyticsMet (≥10)`, `performanceScoresMet (≥10)`, `hasValuationState`, `confidenceScoreMet (≥0.55)`, `hasPlayerValue (>0)`
- Exports `LISTING_THRESHOLDS` — all thresholds are named constants for tuning

**New repository functions:**
- `updateAssetStatus(assetId, { tradingStatus, listingStatus })` — admin-only status transition
- `insertAssetListingReview(data)` → `AssetListingReview` — immutable audit insert
- `findLatestAssetListingReview(assetId)` → latest review or null
- `listDota2AssetsUnderReview()` → queue of UNDER_REVIEW dota2 assets + their latest review

**New endpoints:**
- `GET /api/me/dota2/listing-readiness` — read-only; returns all 10 check results + `isReady` + `failingChecks`
- `GET /api/admin/dota2/assets-under-review` — admin queue
- `POST /api/admin/dota2/assets/:id/approve-listing` — ACTIVE + LISTED + audit record
- `POST /api/admin/dota2/assets/:id/reject-listing` — DRAFT + REJECTED + audit record

**Updated endpoint:**
- `GET /api/terminal/assets/:id/fundamentals` — now includes `isTradable` flag (`tradingStatus=ACTIVE && listingStatus=LISTED`)

**Key invariants enforced:**
- Listing is never automatic (neither on connect nor on valuation ready)
- Every approve/reject is immutably recorded with a snapshot
- Listing ≠ claim; no claim flow or Steam verification implemented in this fase

**TS baseline:** 89 errors maintained throughout all Fases 1-9.

### Fase 10 — Steam OpenID Verification + Listing Submissions (Complete)

Implements the real Steam account verification foundation (OpenID 2.0) and a user-driven submit-for-review flow with immutable frozen snapshots. No extra npm packages required — uses native `fetch` (Node.js 18+).

**Steam OpenID 2.0 flow (no passport, no extra packages):**
- `buildSteamLoginUrl(returnTo, realm)` — builds the `https://steamcommunity.com/openid/login?...` redirect URL
- `verifySteamCallback(query)` — verifies the Steam signature by POSTing `check_authentication` to Steam; extracts SteamID64 from `openid.claimed_id`
- Session stores `steamReturnUrl` across the redirect/callback round-trip
- If SteamID64 mismatches the one set at onboarding, verification is FAILED + audited
- On success: `connectedAccounts.verificationStatus` → VERIFIED

**New table (DDL applied): `account_verification_events`**
- `id, connected_account_id, provider_group, game, method (STEAM_OPENID|MANUAL_OVERRIDE), status (INITIATED|VERIFIED|FAILED|REVOKED), payload_json, created_at`
- Append-only immutable audit log — one row per attempt; enables forensic reconstruction

**New table (DDL applied): `asset_listing_submissions`**
- `id, asset_id, player_profile_id, submitted_by_user_id, game, submission_status (PENDING|UNDER_REVIEW|APPROVED|REJECTED|WITHDRAWN), readiness_snapshot_json, created_at, updated_at`
- `readiness_snapshot_json` is frozen at submission time from `evaluateDota2ListingReadiness`
- Distinct from `asset_listing_reviews` (admin decisions) — this is the user-initiated request

**New service: `steamVerificationService.ts`**
- Pure HTTP — no session or DB writes; caller handles both
- `buildSteamLoginUrl(returnTo, realm): string`
- `verifySteamCallback(query): Promise<SteamVerificationResult>` → `{ valid, steamId64, claimedId, error? }`

**New repository functions (7 new):**
- `insertAccountVerificationEvent(data)` — immutable event insert
- `listAccountVerificationEvents(connectedAccountId)` — audit log by account
- `insertAssetListingSubmission(data)` — create submission with frozen snapshot
- `findLatestAssetListingSubmission(assetId)` — most recent submission per asset
- `listAssetListingSubmissionsByUser(userId)` — all submissions by a user
- `updateAssetListingSubmissionStatus(submissionId, status)` — status transition
- `updateConnectedAccountVerificationStatus(connectedAccountId, status, name?)` — PENDING→VERIFIED

**Enhanced admin queue:**
- `listDota2AssetsUnderReview()` now also returns `latestSubmission` per asset
- Admin sees: `latestReview`, `latestSubmission` (with frozen readiness snapshot, all 10 checks, confidence score, player value, who submitted)

**New endpoints (4 added):**
- `GET  /api/auth/steam/start?returnUrl=...` — requires auth; logs INITIATED event; redirects to Steam
- `GET  /api/auth/steam/callback` — verifies Steam signature; VERIFIED or FAILED; redirects with `?steam_verified=1` or `?steam_error=...`
- `POST /api/me/dota2/submit-for-review` — evaluates readiness; freezes snapshot; creates submission; transitions asset → UNDER_REVIEW
- `GET  /api/me/dota2/submissions` — list user's submissions with parsed readiness snapshot

**Session extension:**
- `steamReturnUrl?: string` added to `express-session.SessionData` interface

**Key design invariants maintained:**
- Verification ≠ claim — no dispute flow implemented
- Listing is still a separate admin governance decision
- LoL untouched
- No price logic introduced

**TS baseline:** 89 errors maintained throughout all Fases 1-10.

### Fase 11 — Claim Flow + Submission Lifecycle Completion (Complete)

Implements the full ownership claim flow for Dota2 player assets, auditable ownership links, submission withdrawal/re-submit lifecycle, and admin claim review with ownership link creation.

**Core invariants enforced:**
- Verification ≠ Claim ≠ Listing (three separate, non-conflated flows)
- Claim requires Steam VERIFIED (`connectedAccount.verificationStatus === "VERIFIED"`)
- Every claim decision is immutably audited
- Ownership links are append-only (REVOKED, never deleted)
- LoL untouched; no price automation

**New table (DDL applied): `dota2_asset_claim_requests`** (prefixed per CRITICAL naming rule)
- `id, asset_id, player_profile_id, connected_account_id, requested_by_user_id, game, claim_status (PENDING|UNDER_REVIEW|APPROVED|REJECTED|CANCELLED), reason_code, evidence_json, review_notes, reviewed_by, reviewed_at, created_at, updated_at`
- Duplicate open claim prevention: at most one PENDING/UNDER_REVIEW per asset+user
- Separate from LoL's `player_claims` table

**New table (DDL applied): `asset_ownership_links`** (generic cross-game)
- `id, asset_id, player_profile_id, user_id, ownership_type (CLAIMED_OWNER|SUBMITTED_BY), status (ACTIVE|REVOKED), source_type ("CLAIM_APPROVAL"), source_id (claim request id), created_at, updated_at`
- On new claim approval: existing ACTIVE link is REVOKED before new ACTIVE link is created
- Full audit trail — no rows ever deleted

**New repository functions (9 added):**
- `insertDota2ClaimRequest(data)` — create claim with status=PENDING
- `findOpenDota2ClaimsByAssetAndUser(assetId, userId)` — duplicate guard filter
- `findDota2ClaimRequest(id)` — get by id
- `listDota2ClaimRequestsByUser(userId)` — user's claims
- `listDota2ClaimRequestsAdmin(claimStatus?)` — admin queue, optional status filter
- `updateDota2ClaimRequest(id, update)` — status + review fields
- `insertAssetOwnershipLink(data)` — create ACTIVE link on approval
- `findActiveAssetOwnershipLink(assetId)` — current owner (at most one ACTIVE)
- `listAssetOwnershipLinksByUser(userId)` — audit trail for a user
- `revokeAssetOwnershipLink(linkId)` — REVOKED on re-claim

**Submission lifecycle completion:**
- `POST /api/me/dota2/submissions/:id/withdraw` — sets submission WITHDRAWN; reverts asset → DRAFT
- Submit-for-review now guards against duplicate open submissions (PENDING or UNDER_REVIEW)
- Re-submit is allowed after REJECTED or WITHDRAWN state

**New endpoints (6 added):**
- `POST /api/me/dota2/claim-asset` — requires VERIFIED Steam; prevents duplicate open claims
- `GET  /api/me/dota2/claims` — list user's claim requests
- `POST /api/me/dota2/submissions/:id/withdraw` — withdraw open submission
- `GET  /api/admin/dota2/claim-requests?status=...` — admin queue with ownership enrichment
- `POST /api/admin/dota2/claim-requests/:id/approve` — revokes old link, creates new ACTIVE link, marks APPROVED
- `POST /api/admin/dota2/claim-requests/:id/reject` — marks REJECTED with optional reviewNotes

**TS baseline:** 89 errors maintained throughout all Fases 1-11.

### Fase 12A — Claim Safety Core (Complete)

Hardened the claim/ownership flow with DB-level guarantees and transactional consistency. No new tables, no UI, no new endpoints — pure integrity upgrade.

**Regra conceitual reforçada:**
- Duplicate prevention é por asset_id + requested_by_user_id (NUNCA por Steam account global)
- Um mesmo usuário pode claimar múltiplos assets diferentes com a mesma Steam account verificada
- Uma única ACTIVE ownership link por asset (unicidade por asset_id, não por user/provider)

**A. Partial unique index — open claim guard (DB-level)**
- Table: `dota2_asset_claim_requests`
- Index name: `dacr_open_claim_unique`
- DDL: `CREATE UNIQUE INDEX dacr_open_claim_unique ON dota2_asset_claim_requests (asset_id, requested_by_user_id) WHERE claim_status IN ('PENDING', 'UNDER_REVIEW')`
- Garante: at most 1 open claim per asset+user no banco — applicationの guard de Fase 11 mantido como camada extra

**B. Partial unique index — single ACTIVE owner guarantee (DB-level)**
- Table: `asset_ownership_links`
- Index name: `aol_active_owner_unique`
- DDL: `CREATE UNIQUE INDEX aol_active_owner_unique ON asset_ownership_links (asset_id) WHERE status = 'ACTIVE'`
- Garante: race condition de aprovação simultânea resulta em unique violation + rollback, não em dois owners ativos

**C. Transactional approve — `approveDota2ClaimTx()` (new repo function)**
- Localização: `server/domains/multigame/repository.ts`
- Assinatura: `approveDota2ClaimTx(claimId, reviewedBy, reviewNotes?) → { claim, ownershipLink }`
- Passos dentro de `db.transaction()`:
  1. Load + validate claim (PENDING or UNDER_REVIEW; lança CLAIM_NOT_FOUND / CLAIM_NOT_APPROVABLE)
  2. Revoke existing ACTIVE link via `UPDATE asset_ownership_links SET status='REVOKED'`
  3. Insert new ACTIVE ownership link (índice B triggera unique violation se concurrent race)
  4. Update claim → APPROVED com reviewedBy + reviewedAt
- Rota `POST /api/admin/dota2/claim-requests/:id/approve` refatorada para chamar a função; mapeia erros semânticos (NOT_FOUND → 404, NOT_APPROVABLE → 409)

**TS baseline:** 89 errors maintained throughout all Fases 1-12A.

### Fase 13 — Admin Claim Policy & Operations Surface (Complete)

Construiu a superfície operacional admin para claims, ownership links, listing submissions e painel de contexto consolidado por asset.  Introduz os campos do modelo híbrido de claim (claimOrigin, approvalType, matchConfidence) e o computed policyDecision.

**Schema changes:**
- 3 novos campos em `dota2_asset_claim_requests` (DDL aplicado):
  - `claim_origin VARCHAR(32)` — `MANUAL | ASSISTED | AUTO`
  - `approval_type VARCHAR(32)` — `MANUAL_ADMIN | AUTO_POLICY | REQUIRES_REVIEW`
  - `match_confidence VARCHAR(32)` — `HIGH | MEDIUM | LOW`
- 4 novos enums TypeScript: `ClaimOrigin`, `ApprovalType`, `MatchConfidence`, `PolicyDecision`
- `policyDecision` computado em tempo de leitura (não armazenado)

**Novos endpoints admin:**
- `GET /api/admin/dota2/claims` — lista enriched com filtros: status, approvalType, matchConfidence (DB), verificationStatus, hasActiveOwner (post-fetch)
- `GET /api/admin/dota2/claims/:id` — detalhe de claim com connected account + ownership link
- `GET /api/admin/dota2/assets/:id/admin-context` — 6-section read model consolidado (asset, ownership, verification, valuation, listingReadiness, claimPolicy + policyDecision computado)
- `GET /api/admin/dota2/assets-under-review` — enriquecido com confidenceScore, playerValue, matchesCount, isTradable, ownershipStatus, ownerUserId, verificationStatus + filtros: hasOwner, hasValuation, verificationStatus

**Novos repo functions (3):**
- `findLatestDota2ClaimByAsset(assetId)` — último claim do asset
- `listDota2ClaimsByAsset(assetId)` — histórico de claims do asset
- `listDota2ClaimRequestsAdminFiltered(opts)` — lista com filtros DB-level

**policyDecision logic (computed):**
- `AUTO_APPROVABLE` — VERIFIED + matchConfidence=HIGH + nenhum owner ativo + approvalType != REQUIRES_REVIEW
- `BLOCKED` — verificationStatus != VERIFIED
- `REQUIRES_REVIEW` — todos os demais casos

**Frontend: Multigame Admin area (2 novas páginas + 1 layout):**
- `client/src/pages/admin/multigame-layout.tsx` — layout com sidebar (Claims, Assets Under Review)
- `client/src/pages/admin/multigame-claims.tsx` — tabela de claims com 5 filtros, Sheet de detalhe + approve/reject inline e em sheet, link para Asset Context
- `client/src/pages/admin/multigame-assets-review.tsx` — tabela de assets under review com 3 filtros, Sheet de detalhe + approve/reject listing inline e em sheet
- Asset Context Panel — Sheet lateral reusável que carrega `/api/admin/dota2/assets/:id/admin-context`, mostra as 6 seções; acessível de ambas as páginas

**Rotas registradas:**
- `/admin/multigame/claims` → AdminMultigameClaimsPage
- `/admin/multigame/assets-under-review` → AdminMultigameAssetsReviewPage

**TS baseline:** 89 errors maintained throughout all Fases 1-13.

### Fase 14 — My Assets / Claimable Assets Tab + Assisted Claim Flow (Complete)

Abre a superfície do usuário final para assets, claims e submissions. Introduz candidate discovery automático, assisted claim com auto-approval por policy, cancel flow e read model consolidado.

**Novos endpoints:**
- `GET /api/me/assets/claimable` — candidate discovery: VERIFIED steam+dota2 account → playerProfile → asset; retorna matchConfidence, policyDecision, canClaim, alreadyOwned, hasActiveOwner
- `GET /api/me/assets/summary` — read model consolidado: connectedAccounts + ownedAssets (ACTIVE ownership links + fundamentals enrichment) + claims (+ asset info) + submissions (+ asset info)
- `POST /api/me/dota2/claims/:id/cancel` — cancel PENDING ou UNDER_REVIEW; owner-only; lança FORBIDDEN / NOT_CANCELLABLE:STATUS; auditoria preservada

**Enhance `POST /api/me/dota2/claim-asset`:**
- Adicionados campos do modelo híbrido: `claimOrigin="ASSISTED"`, `matchConfidence="HIGH"|"MEDIUM"` (HIGH quando playerProfile.primaryConnectedAccountId === steamAccount.id), `approvalType="AUTO_POLICY"|"REQUIRES_REVIEW"`
- Auto-approval executado inline se: VERIFIED + matchConfidence=HIGH + sem owner ativo → chama `approveDota2ClaimTx(claimId, "system:auto-policy")` atomicamente → retorna claimStatus=APPROVED + autoApproved=true
- Se auto-approve falhar por qualquer razão: fall-through para PENDING normal (silently logged; não surfaceia erro ao user)

**Novo repo function:**
- `cancelDota2ClaimRequest(claimId, userId)` — validação de ownership + status cancellable; atualiza para CANCELLED

**Frontend — `/settings/my-assets`:**
- Nova página com 5 seções em cards verticais:
  1. **Connected Accounts** — provider, game, verificationStatus badge, accountName
  2. **Claimable Assets** — candidates com matchConfidence badge, policyDecision badge, hasActiveOwner flag, Claim Asset button (auto-approval inline) ou Claim Submitted badge; canClaim check
  3. **My Owned Assets** — ACTIVE ownership links com playerValue, confidenceScore, isTradable, listingStatus
  4. **My Claims** — histórico de claims com ClaimStatus badge, matchConfidence badge, approvalType label, reviewNotes, Cancel button (PENDING/UNDER_REVIEW)
  5. **My Submissions** — submissions com SubmissionStatus badge, listingStatus, Submit for Review CTA quando asset owned + não em review
- SettingsNav atualizado em ambas as páginas (Security / Player Identity / My Assets)
- Rota `/settings/my-assets` registrada em App.tsx

**policyDecision no claimable endpoint:**
- `AUTO_APPROVABLE` — VERIFIED + HIGH + sem owner ativo + sem open claim
- `REQUIRES_REVIEW` — qualquer outro caso autenticado
- `BLOCKED` — verificationStatus != VERIFIED

**Cancel flow — decisão de allowlist:**
- PENDING: permitido (estado antes do admin ver)
- UNDER_REVIEW: também permitido — admin deve checar status antes de agir (policy existente: admin não processa CANCELLED)
- APPROVED/REJECTED/CANCELLED: NOT_CANCELLABLE — imutáveis após decisão

### Fase 15 — Claim Policy Layer + Multi-Game Discovery Foundation (Complete)

Formaliza a camada de policy de claim e extrai toda a lógica inline do Fase 14 para serviços independentes e extensíveis. Prepara a arquitetura para multi-game/multi-provider sem quebrar o fluxo Dota2 existente.

**Novos arquivos:**

`server/domains/multigame/claimPolicyConfig.ts`
- Config versionada em código (sem tabela DB nesta fase)
- `GameClaimPolicy` — interface com: game, providerGroup, verificationMethod, requiredVerificationStatus, autoApproval criteria
- `GAME_CLAIM_POLICIES` — registry com 4 games: dota2 (✓ ativo), cs2 (stub), lol (stub), valorant (stub)
- Provider mapping: dota2+cs2 → steam/STEAM_OPENID; lol+valorant → riot/RIOT_OAUTH
- Funções helpers: `getGamePolicy(game)`, `getGamesForProvider(providerGroup)`

`server/domains/multigame/claimPolicyEvaluator.ts`
- Função pura: `evaluateClaimPolicy(input)` → `EvaluateClaimPolicyResult`
- Sem I/O, sem DB — determinístico e unit-testável
- Input: `{ game, verificationStatus, providerGroup, matchConfidence, hasActiveOwner, hasOpenClaim }`
- Output: `{ policyDecision, reasons[], approvalType, canAutoApprove, canClaim }`
- Decision tree: NO_POLICY_FOR_GAME → BLOCKED; not verified → BLOCKED; provider mismatch → BLOCKED; all auto-criteria met → AUTO_APPROVABLE; else → REQUIRES_REVIEW
- reasons[] específicos por critério: VERIFICATION_REQUIRED, WRONG_PROVIDER, CONFIDENCE_INSUFFICIENT, HAS_ACTIVE_OWNER, HAS_OPEN_CLAIM

`server/domains/multigame/claimDiscovery.ts`
- `ClaimCandidate` interface completa (18 campos incl. providerGroup, verificationMethod, policyReasons, canAutoApprove)
- `discoverDota2ClaimCandidates(userId)` — adapter ativo com lógica extraída do claimable endpoint
- `discoverCs2ClaimCandidates(userId)` — stub vazio (retorna [])
- `discoverLolClaimCandidates(userId)` — stub vazio (retorna [])
- `discoverValorantClaimCandidates(userId)` — stub vazio (retorna [])
- `getClaimableAssets(userId)` — agregador: Promise.all sobre todos os adapters, retorna flat list

**Arquivos alterados:**

`server/domains/multigame/routes.ts`
- Importa `getClaimableAssets` (claimDiscovery) e `evaluateClaimPolicy` (claimPolicyEvaluator)
- `GET /api/me/assets/claimable` — substituído: de ~80 linhas de lógica inline para 3 linhas (`const candidates = await getClaimableAssets(userId)`)
- `POST /api/me/dota2/claim-asset` — substituído: inline policy (hardcoded booleans) → `evaluateClaimPolicy({...})` centralizado; `autoApprovable` e `approvalType` derivados do resultado

**TS baseline:** 89 errors maintained throughout all Fases 1-15.

### Fase 16 — Verification Adapter Framework (Complete)

Formaliza a verificação de identidade por provider como framework/adapters reutilizáveis. Mantém o fluxo Steam exato do Fase 10 sem regressão; adiciona stubs extensíveis para Riot/Epic.

**Novos arquivos:**

`server/domains/multigame/verificationAdapter.ts`
- Contrato/interface central do framework
- `VerificationAdapter` interface: `providerGroup`, `method`, `startVerification()`, `handleCallback()`, `normalizeIdentity()`
- `VerificationStartParams` / `VerificationStartResult` — redirect URL + INITIATED event payload
- `VerificationCallbackParams` / `VerificationCallbackResult` — success/failure + event payload + normalizedIdentity
- `NormalizedProviderIdentity` — forma canônica: `providerAccountId`, `displayName`, `profileUrl`, `rawData`
- Usa `InsertAccountVerificationEvent` do schema compartilhado (trilha auditável preservada)

`server/domains/multigame/steamVerificationAdapter.ts`
- Implementação concreta do `VerificationAdapter` para Steam OpenID 2.0
- Wraps `buildSteamLoginUrl()` e `verifySteamCallback()` do `steamVerificationService.ts` (não alterado)
- `startVerification()` — sync; retorna redirectUrl + INITIATED event payload
- `handleCallback()` — async; 3 casos: sig inválida → FAILED, SteamID64 mismatch → FAILED, válido → VERIFIED + NormalizedProviderIdentity
- `normalizeIdentity()` — SteamID64 como providerAccountId, claimedId como profileUrl, displayName=null (Steam OpenID não retorna display name no callback)

`server/domains/multigame/riotVerificationAdapter.ts`
- Stub para Riot OAuth 2.0 (guia de implementação nos comentários: PKCE, RSO /userinfo, PUUID)
- Todos os métodos lançam `RIOT_OAUTH_NOT_IMPLEMENTED` com mensagem descritiva

`server/domains/multigame/epicVerificationAdapter.ts`
- Stub para Epic Games OAuth 2.0 (guia de implementação nos comentários: EAS, accountId endpoint)
- Todos os métodos lançam `EPIC_OAUTH_NOT_IMPLEMENTED` com mensagem descritiva

`server/domains/multigame/verificationRegistry.ts`
- Registry/factory: `Map<string, VerificationAdapter>` com 3 entradas (steam ativo, riot/epic stubs)
- `getVerificationAdapter(providerGroup)` — retorna adapter ou lança `NO_VERIFICATION_ADAPTER:${group}`
- `registerVerificationAdapter(adapter)` — extensão dinâmica (testes / plugins)
- `listRegisteredProviders()` — lista todos os grupos registrados
- `isProviderActive(providerGroup)` — retorna true apenas para "steam" por enquanto

**Arquivos alterados:**

`server/domains/multigame/routes.ts`
- Removido import `* as steamVerification from "./steamVerificationService"` (agora órfão)
- Adicionado import `{ getVerificationAdapter } from "./verificationRegistry"`
- `GET /api/auth/steam/start` — refatorado: lógica inline substituída por `adapter.startVerification({...})` + `repo.insertAccountVerificationEvent(startResult.verificationEventPayload)`
- `GET /api/auth/steam/callback` — refatorado: lógica inline substituída por `adapter.handleCallback({...})` + persistência do evento retornado; updateConnectedAccountVerificationStatus separado e explícito
- Comportamento externo idêntico ao Fase 10 — sem regressão

`steamVerificationService.ts` — NÃO alterado (continua como camada HTTP pura)

**TS baseline:** 89 errors maintained throughout all Fases 1-16.

### Fase 17 — CS2 Multi-Game Integration (Complete)

Expande a arquitetura Steam para suportar CS2 como segundo jogo além do Dota2. Mesmo provider Steam (mesmo SteamID64), contas e assets separados por jogo. Verificação herdada: se o usuário já verificou o Steam para Dota2, a conta CS2 herda `VERIFIED` automaticamente.

**Novos arquivos:**

`server/domains/multigame/cs2OnboardingService.ts`
- Orquestra o fluxo CS2: `ConnectedAccount(steam+cs2)` → `PlayerProfile(cs2)` → `Asset stub (steam:cs2:player:{steamId64})` → `EligibilitySnapshot(PENDING_DATA_COLLECTION)`
- `connectCs2Account(userId, input)` — idempotente; sem pipeline de analytics ainda
- `getCs2Status(userId)` — inspeção read-only
- Herança de verificação: se Steam ID já verificado (dota2), cs2 account criada como VERIFIED
- Export `Cs2BootstrapResult.inheritedVerification` sinaliza ao caller quando verificação foi herdada

**Arquivos alterados:**

`shared/schema/multigame.ts`
- `GAMES = ["lol", "dota2", "cs2"]` — cs2 adicionado; type `Game` atualizado

`server/domains/multigame/repository.ts`
- Adicionado `updateAllSteamConnectedAccountsVerificationStatus(userId, steamId64, status, name?)` — update em batch de todos os ConnectedAccounts steam do usuário com o mesmo SteamID64; chamado no Steam callback para multi-game

`server/domains/multigame/claimDiscovery.ts`
- Extraído `discoverSteamGameClaimCandidates(userId, game)` — helper genérico para dota2 e cs2 (mesma estratégia STEAM_PROFILE_LINK, apenas game code diferente)
- `discoverDota2ClaimCandidates` refatorado para delegar ao helper genérico
- `discoverCs2ClaimCandidates` — implementação ativa (antes era stub retornando [])
- Agregador `getClaimableAssets` — cs2 ativado em paralelo com dota2

`server/domains/multigame/routes.ts`
- `POST /api/me/cs2/connect` — onboarding CS2 (mirrors dota2/connect)
- `GET /api/me/cs2/status` — inspeção read-only do estado CS2
- `POST /api/me/cs2/claim-asset` — claim CS2 (reusa `dota2_asset_claim_requests` com `game:"cs2"`; auto-approve via policy)
- Steam callback atualizado: `updateAllSteamConnectedAccountsVerificationStatus()` substitui single-account update; um SteamID64 verificado uma vez aplica a todos os games conectados

`client/src/pages/settings/my-assets.tsx`
- `claimMutation.mutationFn` parametrizado por game: `(game: string) => apiRequest("POST", "/api/me/${game}/claim-asset")`
- `onClaim` handler passa `c.game` para a mutation — suporta dota2 e cs2 automaticamente

**TS baseline:** 89 errors maintained (Fases 1-17).

### Fase 18 — Admin Ops & Observability (Complete)

Adiciona camada de observabilidade multi-game no painel admin: métricas agregadas, tabelas de breakdown e alertas de troubleshooting para todos os jogos (Dota2, CS2, LoL, Valorant).

**Novos arquivos:**

`client/src/pages/admin/multigame-ops.tsx`
- Dashboard "Ops Summary": 6 metric cards (accounts, verified, claims, auto-approved, owned assets, under review)
- 6 breakdown tables: accounts by game, verification status, claims by game+status, assets by game+listing, active ownership, verification events
- Troubleshooting section: 4 alert rows + detail cards para ownership conflicts, verification failures e assets under review
- Auto-refresh a cada 60s

**Arquivos alterados:**

`server/domains/multigame/repository.ts`
- `listMultigameClaimsAdmin({game?, claimStatus?, approvalType?, matchConfidence?, limit, offset})` — lista unificada de claims multi-game com filtros
- `getMultigameOpsSummary()` — agrega: connectedAccounts (total, byProviderGame, byVerificationStatus), claims (total, byGameAndStatus, auto/manual/rejected counts), assets (total, byGameAndListing, underReview/listed), ownedAssets (active, byGame), verificationEvents (total, byStatus, failed/verified)
- `getMultigameTroubleshootingData()` — detecta: verification failures recentes (10 últimas), ownership conflicts (claim aberto em asset com owner ativo), oldest pending claims (5), assets with open submission
- Fix: `autoApprovedCount` filter corrigido de `"AUTO"` → `"AUTO_POLICY"` (eliminou 1 TS error extra)

`server/domains/multigame/routes.ts`
- `GET /api/admin/multigame/ops-summary` — retorna `getMultigameOpsSummary()`
- `GET /api/admin/multigame/troubleshooting` — retorna `getMultigameTroubleshootingData()`
- `GET /api/admin/multigame/claims` — lista paginada multi-game com enrichment de ownership link; aceita query params: game, claimStatus, approvalType, matchConfidence, limit, offset

`client/src/pages/admin/multigame-layout.tsx`
- Adicionado item "Ops Summary" (`/admin/multigame/ops`) como primeiro item do nav

`client/src/pages/admin/multigame-claims.tsx`
- Migrado de `/api/admin/dota2/claims` → `/api/admin/multigame/claims`
- Adicionado filtro "Game" (dota2 / cs2 / lol) na barra de filtros
- Query param renomeado: `status` → `claimStatus` para alinhar com novo endpoint

`client/src/App.tsx`
- Rota `/admin/multigame/ops` registrada → `AdminMultigameOpsPage` (com AdminRoute guard)

**TS baseline:** 89 errors maintained (Fases 1-18).

### Fase 19 — Dota2 → Canonical Market Bridge (Complete)

Implementa a projeção canônica final: o pipeline Dota2 agora alimenta a camada de mercado canônica (`assets`, `asset_price_snapshots`, `asset_markets`, `asset_market_state`). O Terminal deixa de ser hardcoded em Riot/LoL e passa a exibir todos os assets canônicos.

**Novo arquivo:**

`server/domains/multigame/dota2CanonicalProjection.ts`
- Único ponto de travessia do domínio Dota2 para a camada canônica de mercado
- `projectDota2ValuationToCanonical(assetId, playerValue)`:
  - **Primeira projeção**: escreve `assets.fundamentalPrice`, `assets.lastTradePrice`, `assets.price24hAgo` = playerValue; insere 1 snapshot em `asset_price_snapshots`
  - **Projeções subsequentes**: atualiza apenas `assets.fundamentalPrice` — lastTradePrice é mantido pela atividade de mercado
  - Idempotente: guard via `fundamentalPrice IS NULL` para detectar primeira projeção

**Arquivos alterados:**

`server/domains/multigame/dota2ValuationService.ts`
- `bootstrapDota2Valuation()`: chama `projectDota2ValuationToCanonical()` após `upsertDota2ValuationState()` (com `.catch` não-fatal)
- `updateDota2Valuation()`: idem — atualiza `fundamentalPrice` em cada run de valuation

`server/domains/multigame/routes.ts`
- `POST /api/admin/dota2/assets/:id/approve-listing`: após ACTIVE+LISTED, executa seed de AMM:
  - `asset_markets`: `floorPrice=5`, `paramA=5`, `paramB=100` (`DEFAULT_AMM_PARAMS`), `isEnabled=true`; com `onConflictDoNothing`
  - `asset_market_state`: `supply = supplyForPrice(lastTradePrice, DEFAULT_AMM_PARAMS)`, `lastPrice = lastTradePrice`; com `onConflictDoNothing`
  - Seed não-fatal (falha não bloqueia o approve; admin pode re-seed via `/api/admin/amm/seed`)
- Novos imports: `assetMarkets`, `assetMarketState`, `assets` do schema; `db`, `eq` do drizzle; `supplyForPrice`, `DEFAULT_AMM_PARAMS` do ammPricing

`client/src/pages/terminal.tsx`
- `MARKET_PARAMS`: removidos `provider`, `game`, `region`, `scope` — mantido apenas `limit: "50"`
- Count-check query (linha 3299): removido filtro `riot/lol/NA1/RANKED_SOLO_5x5` — passa apenas `limit: "1"`
- Terminal agora exibe todos os assets canônicos (Dota2, LoL, CS2, Valorant)

**TS baseline:** 89 errors maintained (Fases 1-19).

**Limitações restantes antes da próxima fase:**
- Trade path (`POST /api/riot/trade`, `GET /api/riot/quote`) ainda Riot-locked via puuid — não generalizado nesta fase
- `GET /api/market/heatmap` e `GET /api/market/index` ainda leem de `riotAssets` apenas
- Posições no Terminal filtradas por `source === "RIOT_NA1"` — Dota2 positions não exibidas (trade path não unificado ainda)
- `extractPuuid()` no terminal ainda nomeada como "puuid" mas funciona para qualquer provider (read-only)

### Fase 24 — Dota2 Market Bootstrap via OpenDota proPlayers (2026-03-18 — Complete)

**Goal:** Seed the canonical market layer with ~500 professional Dota2 player assets sourced from OpenDota's `/api/proPlayers` endpoint (no Steam OAuth required). Assets become immediately tradeable via AMM.

**Bootstrap results (production DB):**
- **500 pro players seeded** in ~9s; all LISTED + ACTIVE + AMM seeded
- Asset UID format: `dota2:dota2:player:{accountId32}` (compatible with `isDota2` check + `getAssetGame()` helper)
- Market: ID=3, provider=steam, game=dota2, region=global, scope=default
- Initial price: $15.00 per asset; AMM supply=638.9, bid=14.91, ask=15.09, spread=1.2%

**New files:**
- `server/domains/multigame/dota2MarketBootstrapService.ts` — bootstrap orchestrator: fetches OpenDota proPlayers, deduplicates by accountId32, inserts assets + asset_markets + asset_market_state + initial price snapshots atomically; `getBootstrapStatus()` query

**New admin endpoints (in `server/domains/multigame/routes.ts`):**
- `GET /api/admin/dota2/bootstrap-status` → `{ totalDota2Assets, listed, active, withFundamentalPrice, withLastTradePrice, withAmmSeeded }`
- `POST /api/admin/dota2/bootstrap-market` → `{ limit?, activeOnly?, basePrice?, force? }` → `{ created, skipped, errors[], durationMs }`
  - `skipIfExistingAbove=10` safety guard (bypassed with `force:true`)
  - Idempotent: skips already-existing assets by assetUid conflict

**Auth fix:** multigame admin routes use `req.session?.isAdmin` (not `req.user?.isAdmin`)

**Removed:** temporary `GET /api/admin/dota2/session-debug` endpoint (debugging artifact)

**TS baseline:** 89 errors maintained.

### Fase 24A — Multigame Game Filter (2026-03-18 — Complete)

**Goal:** Add per-game filtering to the Terminal UI (tabs: All Games | LoL | Dota 2) and wire all market queries to respect the active filter.

**Changes:**
- `client/src/state/terminalStore.ts` — added `GameFilter` type, `gameFilter` state field, `SET_GAME_FILTER` action (clears `selectedAsset` on switch)
- `client/src/pages/terminal.tsx` — header tabs dispatch `SET_GAME_FILTER`; `MarketScanner` and `PlayerMarketGrid` pass `game=` param; queryKeys include `gameFilter`

### Fase 24B — Corrective Fixes: Featured Filter + Dota2 Individual Valuations (2026-03-18 — Complete)

**Goal (1): DiscoveryHeroSection game filter**
- Root cause: `DiscoveryHeroSection.tsx` hardcoded `provider:"riot", game:"lol", region:"NA1"` — always fetched LoL assets
- Fix: Removed hardcoded params; reads `state.gameFilter`, passes `game=gf` when gf ≠ "all"; queryKey includes `gameFilter`

**Goal (2): Dota2 differentiated valuations**
- Root cause: bootstrap set `fundamentalPrice="15.00"` flat for all 500 assets; no valuation state existed
- Fix: `enrichDota2Valuations()` in `dota2MarketBootstrapService.ts`:
  - Fetches per-player MMR from OpenDota `/api/players/{accountId}` (batches of 5, 800ms delay)
  - Falls back to MMR=7000 for private profiles; formula: `initialValue=clamp(8+10×(mmr/12000)+2, 6, 25)`, `playerValue=initialValue×0.80`
  - Updates `assets.fundamentalPrice`, `assets.lastTradePrice` (if volume=0), `assetMarketState`, upserts `dota2_valuation_state` (playerProfileId=0 sentinel)
- New endpoint: `POST /api/admin/dota2/enrich-valuations` with `{limit, offset, dryRun}`

**Enrichment results:** 500/500 processed; 19 distinct prices ($10.07–$15.00, avg $13.19); 499/499 no-trade assets have `fund==last`; 416 `dota2_valuation_state` rows created

**TS baseline:** 89 errors maintained.

### Fase 25 — Bootstrap Quality Gate: Real-Data Pipeline for Dota2 (2026-03-18 — Complete)

**Goal:** Replace neutral-assumption enrichment with a full real-data pipeline. Only players with real, accessible match data are listed. Ineligible players are auto-removed and replaced with eligible ones from the wider proPlayers pool.

**Root cause (Fase 24B limitations):**
- `wrNorm=0` (50% WR assumed for all) — no real win rate used
- `gamesFactor=1` (max assumed for all) — no real game count used
- `momentum="0.0000"` for all 500 assets — no real recent-form data

**New enrichment pipeline (`enrichDota2WithRealData`):**
Three API calls per player:
1. `GET /api/players/{id}/wl` → wins, losses (eligibility gate + real WR + total games)
2. `GET /api/players/{id}` → MMR/rank (real `mmrNorm`)
3. `GET /api/players/{id}/recentMatches` → last 20 matches (real momentum)

**Eligibility criteria:** WL endpoint accessible AND wins+losses ≥ 20
- Ineligible → `tradingStatus="PAUSED"`, `listingStatus="UNDER_REVIEW"` (no artificial data generated)

**Formula (all 3 components now real — no neutral assumptions):**
- `mmrNorm = clamp(mmr/12000, 0, 1)` ← real MMR
- `wrNorm = clamp((winRate-0.5)/0.2, -1, 1)` ← real win rate
- `gamesFactor = clamp(log10(totalGames+1)/3, 0, 1)` ← real game count
- Confidence: 0.65–0.80 (was flat 0.50) based on actual sample quality

**Momentum (real):**
- `recentWR = wins in last 20 / 20`
- `momentum = clamp((recentWR - overallWR) × 10, -2, 2)` ← non-neutral, per-player

**Refill pipeline (`refillDota2Market`):**
- Fetches proPlayers, filters out those already in DB
- Checks WL eligibility per candidate before seeding
- Adds eligible players until target ACTIVE count is reached
- `fetchProPlayers()` now has 60-min in-memory cache + 3-retry on 429

**Results (production DB — after full pipeline):**

| Metric | Before (Fase 24B) | After (Fase 25) |
|--------|------------------|-----------------|
| ACTIVE+LISTED assets | 500 (all flat) | **405** (real data only) |
| PAUSED/ineligible | 0 | 312 |
| Distinct prices | 19 | **298** (15× more diverse) |
| Price range | $10.07–$15.00 | **$6.05–$19.12** |
| Non-zero momentum | 0 | **390** |
| Positive momentum | 0 | 159 (improving form) |
| Negative momentum | 0 | 231 (declining form) |

**Sample top assets (real prices + real momentum):**
- [Tundra Esports] Pure: $18.99, momentum=+1.29
- [Aurora] Abed: $18.33, momentum=-2.00
- [Team Spirit] Collapse: $18.38, momentum=+0.68
- [Aurora] Ws`: $19.12, momentum=-0.80

**New admin endpoints:**
- `POST /api/admin/dota2/enrich-real` — `{limit, offset, dryRun, minGames}` — full real-data enrichment with eligibility filter
- `POST /api/admin/dota2/refill-market` — `{target, minGames, limit, dryRun}` — replace ineligible assets with eligible replacements

**Files changed:**
- `server/domains/multigame/dota2MarketBootstrapService.ts` — new `enrichDota2WithRealData()`, `refillDota2Market()`, `seedPlayerWithValuation()`, `fetchPlayerWL()`, `fetchRecentMatches()`, `computeFullRealValuation()`, `computeRealMomentum()`, proPlayers cache+retry; legacy `enrichDota2Valuations()` preserved
- `server/domains/multigame/routes.ts` — new `POST /api/admin/dota2/enrich-real` + `POST /api/admin/dota2/refill-market` endpoints

**TS baseline:** 89 errors maintained.

## Creator Economy — Card Image Upload (Fase 26)

**Goal**: Allow player operators (creators) to upload a custom portrait image for their market card via a simplified UI in Creator Hub.

### Backend Changes
- `POST /api/player-operator/:assetId/card-image` — new multer endpoint (authenticated + operator-access gated); accepts `file` field, saves via `mediaService.saveUploadedFile`, updates `player_card_visuals.mediaAssetId`, returns `{ imageUrl, cardVisual }`
- `serializeCardVisual(row, imageUrl?)` — updated to accept optional `imageUrl` parameter (previously always returned `null`)
- `playerOperatorRepository.findLatestCardVisualWithImageUrl(assetId)` — new method that fetches card visual then resolves `publicUrl` from `media_assets` via `mediaAssetId`
- `playerOperatorRepository.setCardVisualMediaAsset(assetId, mediaAssetId, userId)` — new method that upserts card visual with a given `mediaAssetId`
- `getCardVisual`, `getOverview`, `updateCardVisual` in service — updated to pass `imageUrl` through serializer
- `uploadCardImage` — new service method coordinating file save + card visual upsert
- `/api/market/featured` — now fetches `playerCardVisuals` joined with `mediaAssets` for operator assets and includes `cardImageUrl` in each `EnrichedRow`

### Frontend Changes
- `useUploadCardImage(assetId)` — new mutation hook that POSTs multipart form to `/api/player-operator/:assetId/card-image`
- `CardImageManager.tsx` — completely rewritten with simplified UX: portrait preview (3:4 ratio), hover-overlay change button, upload button, "Publish Card" CTA, hint text (1200×1600px, max 10 MB)
- `DiscoveryHeroSection.tsx` — `FeaturedAssetRow` and `FeaturedCard` now include `cardImageUrl`; `DiscoveryCard` uses `card.cardImageUrl ?? PORTRAITS[cardIndex % 4]` so operator custom images appear on featured market cards

## Terminal Eligibility Policy (Quality Gate)

**Goal**: Show only players with real game data in the player market terminal. No bootstrapped/orphan assets without ongoing observability.

### Eligibility Criteria (4 rules, always-on)
An asset appears in the terminal (`/api/assets` and `/api/terminal/assets`) only if ALL four conditions are met:
1. `listing_status = 'LISTED'` — officially published
2. `trading_status = 'ACTIVE'` — trading open
3. `player_profile_id IS NOT NULL` — linked to a real registered player who connected their account
4. `fundamental_price IS NOT NULL` — valuation has been calculated from real API data (OpenDota/Steam)

### Game-specific interpretation
- **Dota2**: player_profile + enough OpenDota matches → fundamental_price set by valuation service
- **CS2**: player_profile + Steam stats fetched and non-empty → fundamental_price set by valuation service
- **Orphan/bootstrap assets**: excluded regardless of price (no player_profile_id)

### Impact
- **Before**: 1,507 assets visible (1,505 orphan bulk-imports with no player linkage)
- **After**: 1 asset eligible (cs2/Skid_Row at $6.60 — has player_profile + fundamental_price from CS2 bootstrap)
- **Filtered**: 1,817 orphan assets (no player_profile_id), 2 assets with profile but no valuation, 313 with bad status
- **Data preserved**: No assets deleted from DB. Orphan assets remain in database, just excluded from terminal query.

### Files changed
- `server/domains/discovery/routes.ts` — `/api/assets` now applies 4 baseline eligibility conditions; added `isNotNull` to drizzle imports
- `server/domains/multigame/repository.ts` — `listTerminalAssets()` applies same policy; defaults to LISTED/ACTIVE + player_profile_id + fundamental_price

### Future TODOs
- When a player connects their account and sync succeeds (fundamental_price gets set), they automatically become eligible — no manual intervention needed
- Add more player accounts with real Dota2/CS2 data to populate the terminal
- Consider a `terminal_eligibility_override` flag for admin-approved special cases

## Terminal Market Architecture — Invariant-Gated Entry (2026-04-05)

**Goal**: No asset can enter or remain ACTIVE/LISTED without completing the full market pipeline. Every architectural surface that can produce an active asset now enforces the same invariant set.

### Market Invariants (Single Source of Truth)

Defined in `server/domains/terminal/invariants.ts`:

| ID | Rule | Gate level |
|----|------|-----------|
| INV_1 | `dota2_valuation_state` row exists | Hard gate — blocks entry |
| INV_2 | `assets.fundamental_price` NOT NULL | Hard gate — blocks entry |
| INV_3 | `assets.last_trade_price` NOT NULL | Hard gate — blocks entry |
| INV_4 | ≥1 row in `dota2_value_history` | Hard gate — blocks entry |
| INV_5 | `player_value ≠ $15 baseline` OR verified via RECALC/MATCH_UPDATE | Soft gate — monitored by reconciler |

- **`checkTerminalEligibility(assetId)`** — read-only audit (used by reconciler)
- **`gateTerminalPromotion(assetId)`** — returns `{ approved, suggestedListingStatus, suggestedTradingStatus, reason }`. Only INV_1–INV_4 are hard gates. A new asset must pass all four before being promoted to LISTED/ACTIVE. INV_5 is monitored post-entry.

### Atomic Terminal Entry (`addToTerminal`)

`server/domains/player-hub/service.ts` — `addToTerminal`:

Before (fire-and-forget):
```
Create stub → ACTIVE/LISTED → bootstrap() in void
```

After (atomic):
```
Create stub → UNDER_REVIEW/PAUSED
  → bootstrapValuation() synchronously (30s timeout)
  → gateTerminalPromotion()
  → If approved: update to LISTED/ACTIVE
  → If rejected: stays UNDER_REVIEW/PAUSED (reconciler picks up)
```

Key rules:
- Virtual candidates (new stubs) always start in `UNDER_REVIEW/PAUSED`
- Pre-existing LISTED/ACTIVE assets (platform-seeded) are not re-gated on user claim
- Any bootstrap failure → stays in `UNDER_REVIEW/PAUSED` (no "fake-ready" asset)
- Provider timeout → graceful failure, reconciler will revisit next cycle

### Reconciler as Integrity Guardian

`server/domains/terminal/reconciler.ts` — runs every 30 min:

| Invariant violated | Asset class | Action |
|-------------------|-------------|--------|
| INV_1 (no valuation_state) | Any | QUARANTINE |
| INV_2 (no fundamental_price) | Any | QUARANTINE |
| INV_3 (no last_trade_price) | Any | QUARANTINE |
| INV_4 (no history) | Any | AUTO-REPAIR (write synthetic BOOTSTRAP event) |
| INV_5 (stuck at $15 baseline) | Bulk (player_profile_id = 0) | FLAG only — requires admin migration |
| INV_5 (stuck at $15 baseline) | User-linked (player_profile_id ≠ 0) | QUARANTINE — dynamic loop not updating |

The reconciler now triggers when `stuckAtBaseline > 0` (not just when missing state/history), ensuring all five invariants are actively policed.

### Multigame Contract

`server/domains/terminal/marketContract.ts` — formal TypeScript interface every game must implement:

```typescript
interface MultigameContract {
  readonly game: RegisteredGame;
  isEligibleForTerminal(externalId: string): Promise<GameEligibilityResult>;
  fetchInitialData(externalId: string): Promise<RawProviderData | null>;
  calculateInitialValuation(data: RawProviderData): Promise<InitialValuation>;
  projectValuationToCanonicalPrice(assetId: number, valuation: InitialValuation): Promise<void>;
  calculateDynamicPerformance(assetId: number, userId: string): Promise<DynamicPerformanceResult>;
}
```

Registered games: `cs2`, `dota2`. A new game cannot enter the platform without implementing all five methods. The contract also documents `BootstrapFailureReason` codes for structured error handling.

### Dynamic Loop Coverage

- **Bulk assets** (`player_profile_id = 0`): Intentionally excluded from the 10-min valuation loop. Eligible with BOOTSTRAP history. Corrected via admin migrations (e.g. `runBulkCs2PriceProjectionV2`).
- **User-linked assets** (`player_profile_id ≠ 0`): Processed every 10 min by `multigameValuationScheduler.ts`. If stuck at baseline after enrichment cycles → reconciler quarantines.

### Files Changed
- `server/domains/terminal/marketContract.ts` (NEW) — formal multigame interface + `BootstrapFailureReason` codes
- `server/domains/terminal/invariants.ts` — added `gateTerminalPromotion()` with INV_1–INV_4 hard gate logic
- `server/domains/player-hub/service.ts` — `addToTerminal` is now atomic (stub → bootstrap → gate → promote/hold)
- `server/domains/terminal/reconciler.ts` — INV_5 now quarantines user-linked assets; bulk assets flagged only; cycle triggers on `stuckAtBaseline > 0`

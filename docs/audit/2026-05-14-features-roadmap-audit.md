# Auditoria 2.10 — Features e Roadmap

**Data**: 2026-05-14
**Tipo**: Estratégica (consolidação cross-relatório das 9 auditorias técnicas anteriores)
**Escopo**: quantificar features, decidir as 9 P-x, propor 3 cenários de roadmap, priorização final das Fases A-H
**Método**: re-leitura de exploration + 2.1-2.9, queries DB diretas para row counts, LOC counts por feature, mapping de dependências

---

## 1. Resumo executivo

Após 9 auditorias técnicas, GamerStock tem perfil claro: **MVP funcional ambicioso (~109k LOC, 28 domínios, 102 tabelas) com fundação criptográfica boa, mas postura operacional inexistente e ~30% do código em features que nunca foram exercitadas em dados reais**. Score médio das 8 auditorias técnicas: **5.1/10** — bom em estrutura (arquitetura 7+, AMM math 8+), fraco em segurança operacional (logs/headers ausentes, 1 leak crítico em forgot-password), crítico em produção (deploy 2.0, testes 1.5).

**Quantificação das decisões**:
- **P-1 Predictions** confirma remoção: **~11 086 LOC** + 9 tabelas (1 com 1 row de teste) + 5 schedulers/services + zero deps exclusivas + zero usuários reais
- **P-5 Arena** análoga: ~6 350 LOC + 15 tabelas (18 rows totais — apenas catálogo de badges seeded) + 4 services
- **P-6 Draft** zumbi puro: ~3 707 LOC, 5 tabelas todas com 0 rows, nunca foi acessível na UI
- **P-7/P-8** pequenos: ~800 LOC totais
- **P-4 Multigame** confirma keep: **15 368 LOC backend** + 800 assets de produção (Dota2 + CS2 bootstrap)

**Recomendação consolidada**: executar **Cenário B (Moderado, ~150-180h, 8-10 semanas)**. Combinação de Fase 0 emergência (~60min) + Fase A P1 (~22-26h) + Fase H production-readiness (~10-15h) + remoção decisiva de P-1/P-3/P-5/P-6/P-8 (~12-16h) + Fase B P2 (~26-32h) + setup testing MVP (~10-15h). Output: **~50-60k LOC removidos**, ~30 tabelas dropadas, sistema deployável, observability mínima, 30% coverage financeiro.

**Severidade estratégica**: o produto **não está em risco de perda** se P-1 ou P-5 forem removidos — não tem usuários reais nessas features. **Está em risco real** se subir para produção sem Fase 0 + Fase H + sem CI rodando testes. **Maior alavanca é decisional, não técnica**: você sabe o que cortar — agora corte.

---

## 2. Fichas P-x (decisão final)

### 2.1 P-1 — Predictions (REMOVER ✅)

| Campo | Valor |
|---|---|
| ID | P-1 |
| Decisão atual | ✅ Confirmado remover |
| Feature | Prediction markets (eventos esportivos com binary outcomes, orders, settlements) |
| **LOC backend** | **8 312** (server/domains/prediction/*) |
| LOC frontend (pages user) | 788 (predictions.tsx + predictions-market.tsx) |
| LOC frontend (admin) | 883 (admin/predict-dashboard.tsx + admin/predict-layout.tsx) |
| LOC schema | 587 (prediction.ts 387 + ingestion.ts 200) |
| LOC ingestion + scheduler | 516 |
| **LOC TOTAL** | **~11 086** |
| Tabelas DB | 9 (predictionEvents, predictionMarkets, predictionOutcomes, predictionPositions, predictionOrders, predictionSettlements, predictionPriceSnapshots, predictionMarketStats, predictionMarketEvents) + 3 ingestion (predictionEventCandidates, predictionEventPublications, predictionDisplayQueue) |
| Rows reais | predictionEvents=1, predictionMarkets=1, predictionOutcomes=2, predictionMarketStats=1. **Resto: 0 rows**. Test data only |
| Schedulers | 2 (`startPredictionAutoLockScheduler`, `startIngestionScheduler` + `startProviderResolutionScheduler`) |
| Services exclusivos | 0 (compartilha wallet, fee-engine) |
| Endpoints | 1316 LOC em prediction/routes.ts + 411 LOC em adminHistoryRoutes |
| Frontend routes | 2 (`/predictions`, `/predictions/markets/:idOrSlug`) + admin: `/admin/predict-dashboard`, `/admin/history`, `/admin/events`, `/admin/display-queue`, `/admin/ingestion` |
| Deps exclusivas | **Zero** (confirmado em 2.7) |
| Observação exploration | flag PREDICT_ENABLED já desativada por default no .env.local original — feature já era cosmeticamente off |
| Custo operacional | 2 schedulers cron + 200 LOC ingestion (PandaScore-dependent — B2.7-3 fix paralelo) |
| Risco se mantida | 9 tabelas adicionais a manter, refactors em prediction/service.ts (2958 LOC god file — S-1) |
| Risco se removida | Mínimo: dados de teste apenas; rotas órfãs precisam ser removidas do App.tsx |
| **Recomendação final** | **REMOVE imediato**. Maior simplificação possível: -11k LOC, -12 tabelas, -3 schedulers, -1 dep externa (PandaScore opcional). Decisão já tomada. Effort ~6-8h |

### 2.2 P-2 — `/admin/market` (DECIDIR → KEEP COM AUDIT)

| Campo | Valor |
|---|---|
| ID | P-2 |
| Decisão atual | 🤔 A decidir |
| Feature | Painel admin de mercado: gerenciar Riot API key, modo de mercado (REAL_RIOT_NA1/SANDBOX), trigger sync, ver bot traders |
| LOC backend | Spread por admin/routes.ts:567-617 (Riot key mgmt) + market-maker.ts (12784 LOC top-level legacy) |
| LOC frontend | admin/market.tsx (~700 LOC inferred) |
| Tabelas DB | `app_config` (key-value, 0 rows), `market_sync_runs` (24 rows), `market_sync_status` (1 row), `riot_assets` (0 rows) |
| Rows reais | apenas market_sync_runs/status têm dados — health do sync system |
| Schedulers | `startMarketSyncScheduler` |
| Services | `getRiotApiKey`, `setRiotApiKey`, `getMarketMode`, `setMarketMode` (app-config.ts) |
| Endpoints | `/api/admin/riot/key/*`, `/api/admin/simulator/*`, `/api/admin/bots/*` |
| Frontend routes | `/admin/market` |
| Deps exclusivas | nenhuma |
| Observação exploration | "Market Mode = REAL_RIOT_NA1" visível; Riot API key field visible; bot status mostra "Running" mas Bot Count=0 (B-3) |
| Custo operacional | baixo — só 1 scheduler |
| Risco se mantida | nenhum significativo |
| Risco se removida | perderia capacidade de admin de gerenciar Riot key UI; teria que usar diretamente DB (`app_config`) |
| **Recomendação final** | **KEEP com auditoria**. Remoção de bot section (atrelada a P-1 indiretamente — bots fazem trade que vai pra wallet). Riot key mgmt útil. Bot traders: decisão depende se quer manter simulação (provável NÃO em prod) |

### 2.3 P-3 — `/admin/predict` e `/admin/history` (REMOVER ✅ — subset P-1)

| Campo | Valor |
|---|---|
| ID | P-3 |
| Decisão atual | ✅ Confirmado (subset de P-1) |
| Feature | Admin tooling de predictions |
| LOC frontend | Incluído em P-1 (883 LOC em admin pages) |
| Tabelas | Mesmas de P-1 |
| **Recomendação final** | **REMOVE** junto com P-1. Não merece análise separada |

### 2.4 P-4 — Multigame (KEEP ✅ — audit lixo interno)

| Campo | Valor |
|---|---|
| ID | P-4 |
| Decisão atual | ✅ Manter |
| Feature | Integração Steam/Dota2/CS2 — match ingestion, player profiles, eligibility, valuation, ownership, claims |
| **LOC backend** | **15 368** (server/domains/multigame/*) — domínio mais denso do projeto |
| LOC frontend | Difuso — feature está no terminal (3537 LOC) + portfolio (45KB) + assets (72KB) + player pages |
| LOC schema | 1069 (multigame.ts — 18 tabelas) |
| Tabelas DB | 18 (connectedAccounts, playerProfiles, playerEligibilitySnapshots, playerMatchSourceData, playerMatchAnalytics, performanceBaselines, performanceMetricWeights, performanceScoreComponents, dota2PerformanceScores, dota2ValuationState, dota2ValueHistory, assetListingReviews, accountVerificationEvents, assetListingSubmissions, dota2AssetClaimRequests, assetOwnershipLinks, cs2StatsSnapshot, cs2SyntheticMatch) |
| Rows reais | `dota2_valuation_state=781`, `dota2_value_history=869`, `role_baselines=25`, `role_metric_weights=25`, `assets=800` (mostly CS2 bulk). **Tabelas user-flow (connectedAccounts, playerProfiles, claims) = 0 rows**: ninguém fez onboarding Steam ainda |
| Schedulers | `startMultigameValuationLoop`, parte do `startBaselineUpdateScheduler` |
| Services exclusivos | 28 arquivos em multigame/ + steamCs2StatsClient + dota2MarketBootstrapService + cs2MarketBootstrapService |
| Endpoints | 2563 LOC em multigame/routes.ts (god file — S-1, 17 blocos lógicos extraíveis em 8 sub-routers) |
| Frontend routes | Difuso (terminal + assets + portfolio + player + admin/multigame-*) |
| Deps exclusivas | Steam OpenID flow (provider hardcoded URL), PandaScore (P-1 atacaria), OpenDota (public API) |
| Observação exploration | 800 assets visíveis no terminal, mas 0 assets em /assets (B-2, default game=dota2 hardcoded). Mismatch operacional |
| Custo operacional | alto — 2 schedulers + 18 tabelas + 5 endpoints com N+1 (B2.2-6) |
| Risco se mantido | god files exigem refactor médio prazo (S-1), 5 endpoints com N+1 a corrigir |
| Risco se removido | catastrófico — é o produto |
| **Recomendação final** | **KEEP**. Audit interno via P-4: (a) modularização do god file routes (8-10 sub-routers), (b) fix dos N+1 admin endpoints, (c) decidir CS2 bulk vs Dota2 onboarding como prioridade. Effort de cleanup: ~15-20h |

### 2.5 P-5 — Arena (REMOVE ✅)

| Campo | Valor |
|---|---|
| ID | P-5 |
| Decisão atual | 🟡 Provável remover → **CONFIRMAR REMOVE** |
| Feature | Gamificação social: profiles, leaderboards, achievements, seasons, badges, duels, follows |
| LOC backend (routes) | 822 (server/domains/arena/routes.ts) |
| LOC backend (top-level legacy) | 207 (server/arena.ts — legacy) |
| LOC backend services | seasonsService 372 + achievementsService 365 + duelService 254 + followService 110 = **1101** |
| LOC services bootstrap | arenaBootstrap.ts 466 |
| **LOC TOTAL backend** | **~2 596** |
| LOC frontend | 4 720 (arena.tsx 34328 + arena-achievements 10530 + arena-draft 39906 + arena-leaderboards 31551 + arena-seasons 24083 + arena-trader-profile 18334 + admin/arena.tsx ~5000) → tudo somado em chars/LOC ≈ 4 720 LOC |
| LOC schema | 267 (arena.ts — 15 tabelas) |
| **LOC TOTAL** | **~7 583** |
| Tabelas DB | 15 (arena_profiles, arena_user_stats, arena_events, achievements_catalog, user_achievements, arena_seasons, arena_user_season_stats, arena_season_leaderboard_snapshot, arena_badges, user_badges, season_rewards, season_reward_distributions, arena_challenges, arena_trader_follows, arena_duels) |
| Rows reais | **`arena_badges=18`, `achievements_catalog=10`** (catalog seeds only). 13 outras tabelas vazias. **Zero users na arena**. |
| Schedulers | parte de `scheduleDuelResolver` (15min) + `backfillAchievementBadges` (one-shot) |
| Services exclusivos | 4 (achievementsService, duelService, followService, seasonsService) |
| Endpoints | 822 LOC em routes |
| Frontend routes | 6 (`/arena/profile`, `/arena/leaderboards`, `/arena/achievements`, `/arena/seasons`, `/arena/draft`, `/arena/trader/:username`) + `/admin/arena` |
| Deps exclusivas | nenhuma (framer-motion, recharts já usados em outros lugares) |
| Observação exploration | B-7: `/admin/arena` crasha em `data?.seasons.find()`. Bug em pasta dormente — sinal forte de zero uso real |
| Custo operacional | médio — 4 services + 15 tabelas + crash bug |
| Risco se mantido | god file admin/arena (B-7), 4 services dormentes que viram dívida |
| Risco se removido | mínimo: zero users ativos. `arena_badges` seed catalog precisa ser preservado ou migrado se reuso futuro |
| **Recomendação final** | **REMOVE**. ~7,6k LOC + 15 tabelas + 4 services. Cleanup ~6-10h. Mantém apenas o "social/competitive" se algum dia voltar a fazer sentido — re-add é mais barato que manter dormente |

### 2.6 P-6 — Draft (REMOVE ✅ — feature zumbi)

| Campo | Valor |
|---|---|
| ID | P-6 |
| Decisão atual | 🤔 A decidir → **CONFIRMAR REMOVE** |
| Feature | Weekly Performance Draft — sistema de "fantasy draft" semanal de jogadores. Atrelado a Arena? |
| LOC backend | 2 659 (server/modules/draft/* — único módulo na pasta `modules/`, estrutura especulativa) |
| LOC frontend | 1 048 (arena-draft.tsx) + admin/draft.tsx |
| Tabelas DB | 5 (draft_entries, draft_entry_picks, draft_player_week_metrics, draft_user_season_stats, draft_weeks) |
| Rows reais | **0 em TODAS as 5 tabelas** |
| Schedulers | nenhum dedicado |
| Endpoints | em `server/modules/draft/draft.routes.ts` |
| Frontend routes | `/arena/draft`, `/admin/draft` |
| Deps exclusivas | nenhuma |
| Observação exploration | Página visível mas nunca exercitada. Feature mais zumbi do projeto |
| Custo operacional | nenhum hoje (não tem dados, schedulers, etc.) |
| Risco se mantido | mais 4k LOC dormente + 5 tabelas a confundir auditorias futuras |
| Risco se removido | zero |
| **Recomendação final** | **REMOVE**. Feature speculativa nunca exercitada. ~4k LOC + 5 tabelas. Cleanup ~2-3h |

### 2.7 P-7 — AMM standalone (`/admin/amm`) (KEEP COMO DEBUG VIEW)

| Campo | Valor |
|---|---|
| ID | P-7 |
| Decisão atual | 🤔 A decidir → **KEEP** |
| Feature | Painel admin do AMM: visualizar curvas, calcular preços hipotéticos, ver supply de cada asset |
| LOC frontend | 281 (admin/amm.tsx) |
| LOC backend | reusa `server/services/ammPricing.ts` (58 LOC — funções puras, ÚTIL no resto do produto) |
| Tabelas DB | `asset_markets` (800 rows), `asset_market_state` (800 rows) — produção ativa |
| Rows reais | 800 em ambas — DATA QUENTE |
| Schedulers | nenhum direto |
| Deps exclusivas | nenhuma |
| Observação exploration | Painel debug útil para investigar pricing |
| Custo operacional | desprezível (281 LOC frontend) |
| Risco se mantido | nenhum |
| Risco se removido | perde ferramenta de debug; teria que consultar DB diretamente |
| **Recomendação final** | **KEEP**. É 281 LOC de tela de debug em cima de math que é central para o produto. Custo de manter ≈ zero |

### 2.8 P-8 — Leaderboard standalone (`/leaderboard`) (REMOVE ✅)

| Campo | Valor |
|---|---|
| ID | P-8 |
| Decisão atual | 🟡 Provável remover → **CONFIRMAR REMOVE** |
| Feature | Página `/leaderboard` standalone mostrando "NA1 Challenger Leaderboard" — copy LoL-only |
| LOC frontend | 278 (leaderboard.tsx) + 171 (riot-leaderboard.tsx) = **449** |
| Tabelas DB | reusa `riot_assets` (0 rows!) — sem dado real |
| Endpoints | `/api/players/leaderboard` ou similar |
| Frontend routes | `/leaderboard` |
| Deps exclusivas | nenhuma |
| Observação exploration | P-9 detalhou copy LoL ("Search summoner name…", "NA1 Challenger Leaderboard", "League Points"). Mostra `riot_assets` (0 rows). **Página vazia hoje** |
| Custo operacional | desprezível |
| Risco se mantido | reforça inconsistência multigame (P-4 keep + page só-LoL) |
| Risco se removido | zero |
| **Recomendação final** | **REMOVE**. Página é vestígio do antigo "produto LoL". Substituto se quiser leaderboard multigame = view no terminal. ~1h cleanup |

### 2.9 P-9 — Copy LoL hardcoded (FIX SISTEMÁTICO)

| Campo | Valor |
|---|---|
| ID | P-9 |
| Decisão atual | 🤔 A decidir → **FIX SISTEMÁTICO** |
| Feature | 14+ strings LoL hardcoded em 10+ arquivos (login, landing, watchlist, leaderboard, player, terminal) — detalhado em B2.3-5 |
| Trabalho | substituir copy fixa por dinâmica/i18n-ready ou copy genérica multigame |
| Effort | 2-3h (já estimado em B2.3-5) |
| Dependência | parte do trabalho some com P-5 (arena) e P-8 (leaderboard) — remove os arquivos primeiro, depois resta menos copy a substituir |
| Observação exploration | B-9 watchlist `<span>Challenger</span>` hardcoded para CADA asset — sintoma estrutural |
| **Recomendação final** | **FIX após remoções P-5/P-8**. Ordem importa: deletar arquivos primeiro reduz escopo; depois sweep copy. Effort líquido ~1-2h |

---

## 3. P-10+ Features descobertas durante 2.10

### P-10 — News service (KEEP COM AUDIT)

| Campo | Valor |
|---|---|
| Feature | RSS news aggregation com sentiment, entity tagging, asset impact |
| LOC backend | `server/services/newsService.ts` 23 375 chars ≈ **~600 LOC** |
| Tabelas | `news_events` (0 rows), `asset_news_pulses` (0 rows) |
| Scheduler | inline `scheduleNews` (10min interval, 30s warmup) |
| Deps exclusivas | `rss-parser@3.13.0` |
| Recomendação | **KEEP** se mantém parsing de feeds. **REMOVE scheduler** se feature não está atrelada a algo visível. **DEFER decisão** — 10min para ver se algum frontend consome `/api/news/*` |

### P-11 — Bot trader system (REMOVE PROVÁVEL)

| Campo | Valor |
|---|---|
| Feature | Simulação de bots fazendo trades para liquidez/atividade |
| LOC backend | `server/simulation/bots/bot-trader.ts` + `server/services/botTrader.ts` (deprecated shim) |
| Tabelas | `bot_profiles` (0 rows) |
| Scheduler | `startBotSimulator` (gated por NODE_ENV=production + ENABLE_BOTS=true) |
| Observação | B-3 ("Running" with Bot Count=0) é sintoma de feature mal-acoplada |
| Recomendação | **REMOVE** se aceita que produto vai depender só de usuários reais. **DEFER** se quiser manter como "filler" para terminal vazio |

### P-12 — Web3 / Player Tokens (REMOVE)

| Campo | Valor |
|---|---|
| Feature | "On-chain trading markets" promised on README — pasta `server/web3/` |
| LOC | esqueleto, observation-mode bridge declarado em boot |
| Schedulers | zero |
| Tabelas | zero |
| Observação | S-7: "observation mode, no adapters active" no log do boot. Esqueleto sem implementação |
| Recomendação | **REMOVE** ou **DEFER**. Se for parte do roadmap futuro real, deixar gated. Se for vestígio aspiracional → remover ~2-3h |

### P-13 — Player operator / Player claims (DEFER / KEEP)

| Campo | Valor |
|---|---|
| Feature | Sistema de "creator mode" onde jogador real pode reivindicar sua "ação" e gerenciar (missions, moments, transactions) |
| LOC backend | `server/domains/player-operator/` 387 LOC routes + service + 4 hooks + 8 tabelas |
| LOC frontend | `client/src/features/player-operator/*` + admin/multigame-claims |
| Tabelas | 8 (playerOperatorAccess, playerOperatorSnapshots, playerMissions, playerRecommendedActions, playerActivityEvents, playerCardVisuals, playerMoments, playerMomentTransactions) + claims |
| Rows reais | **TODAS 0** — feature dormente |
| Observação | Sistema ambicioso mas sem usuários |
| Recomendação | **DEFER**. É feature core da visão "esports player trading" mas hoje sem uso. Manter como "pronta para quando primeiro jogador reivindicar" OU mover para feature flag |

### P-14 — Media library (KEEP — feature ativa simples)

| Campo | Valor |
|---|---|
| Feature | Upload de imagens admin via multer + servir por storage key |
| LOC | 135 LOC routes + 105 LOC service |
| Tabelas | `media_assets` (0 rows), `prediction_event_media` (0 rows) |
| Recomendação | **KEEP** (necessário para hero images de markets). Aplicar fix B2.6-4 (SVG sanitization) |

---

## 4. Schedulers — tabela completa com decisão

| # | Scheduler | Periodicidade | Atrelado a | Decisão |
|---|---|---|---|---|
| 1 | `startMarketSimulator` | 15s tick | AMM core (P-4) | **KEEP** |
| 2 | `startRiotSyncScheduler` | 24h | Legacy Riot (sem dados) | **REMOVE** (junto P-8) ou **DEFER** se decidir manter LoL via Riot |
| 3 | `startPerfPricingScheduler` | 10min | Legacy Riot PVI | **REMOVE** (mesma razão de #2) |
| 4 | `startMarketSyncScheduler` | (interno) | Canonical markets (P-4) | **KEEP** |
| 5 | `startPredictionAutoLockScheduler` | 60s default | P-1 | **REMOVE** (com P-1) |
| 6 | `startIngestionScheduler` | 15min após 60s warmup | P-1 + PandaScore | **REMOVE** (com P-1) |
| 7 | `startProviderResolutionScheduler` | configurável | P-1 (resolução de prediction events) | **REMOVE** (com P-1) |
| 8 | `ensureSystemWalletsExist` | one-shot | Economy (KEEP) | **KEEP** |
| 9 | `startTriggerEngine` | 3s loop | Orders (P-4) | **KEEP** |
| 10 | `startBaselineUpdateScheduler` | daily | Performance baselines (P-4) | **KEEP** |
| 11 | `startMultigameValuationLoop` | (interno) | Dota2/CS2 valuation (P-4) | **KEEP** |
| 12 | `runBulkCs2PriceProjectionV2` | one-shot idempotente | P-4 (data migration) | **KEEP** mas planejar fade-out quando PandaScore voltar |
| 13 | `startTerminalReconciler` | (interno) | P-4 invariantes | **KEEP** |
| 14 | `startBotSimulator` | gated env | P-11 bots | **REMOVE** (com P-11) |
| 15 | `runStartupSeed` | one-shot c/ guards | Initial market seed | **KEEP** |
| 16 | `backfillAchievementBadges` | one-shot idempotente | P-5 Arena | **REMOVE** (com P-5) |
| 17 | `seedInitialValuations` | one-shot c/ guards | P-4 valuation seed | **KEEP** |
| 18 | Valuation batch loop | 10min | P-4 valuation | **KEEP** |
| 19 | `scheduleDuelResolver` | 15min | P-5 Arena duels | **REMOVE** (com P-5) |
| 20 | `scheduleNews` | 10min, 30s delay | P-10 News | **DEFER** decisão até confirmar se news é exibida |

**Após decisões finais**: KEEP=12, REMOVE=8, DEFER=1. Redução de ~40% dos schedulers em background.

---

## 5. Tabelas DROP candidates (~30)

Empty tables organizadas por categoria:

### Categoria A: REMOVE com P-1 (Predictions)
1. `prediction_event_candidates` (0 rows)
2. `prediction_event_publications` (0 rows)
3. `prediction_event_media` (0 rows)
4. `prediction_display_queue` (0 rows)
5. `prediction_orders` (0 rows)
6. `prediction_positions` (0 rows)
7. `prediction_price_snapshots` (0 rows)
8. `prediction_settlements` (0 rows)
9. `prediction_market_events` (0 rows)
10. (manter `prediction_outcomes`, `prediction_events`, `prediction_markets`, `prediction_market_stats` brevemente até confirmar drop)

### Categoria B: REMOVE com P-5 (Arena)
11. `arena_profiles` (0 rows)
12. `arena_user_stats` (0 rows)
13. `arena_events` (0 rows)
14. `arena_seasons` (0 rows)
15. `arena_user_season_stats` (0 rows)
16. `arena_season_leaderboard_snapshot` (0 rows)
17. `arena_trader_follows` (0 rows)
18. `arena_duels` (0 rows)
19. `arena_challenges` (0 rows)
20. `user_achievements` (0 rows)
21. `user_badges` (0 rows)
22. `season_rewards` (0 rows)
23. `season_reward_distributions` (0 rows)
24. **Preservar (catalog)**: `arena_badges` (18 rows), `achievements_catalog` (10 rows) — mover para seed externo

### Categoria C: REMOVE com P-6 (Draft)
25. `draft_entries` (0 rows)
26. `draft_entry_picks` (0 rows)
27. `draft_player_week_metrics` (0 rows)
28. `draft_user_season_stats` (0 rows)
29. `draft_weeks` (0 rows)

### Categoria D: REMOVE com P-8 (Legacy LoL)
30. `riot_assets` (0 rows)
31. `riot_match_cache` (0 rows)
32. `riot_player_state` (0 rows)
33. `riot_players` (0 rows)
34. `riot_positions` (0 rows)
35. `riot_trades` (0 rows)

### Categoria E: REMOVE com trilho legacy (S-2 / B2.4-8)
36. `vaults` (0 rows)
37. `vault_snapshots` (0 rows)
38. `positions` (0 rows — old portfolio path)
39. `trades` (0 rows — old portfolio path)

### Categoria F: Mantidas (bootstrap-empty, esperam dados)
- `connected_accounts`, `playerProfiles`, etc. — vão receber dados quando Steam OAuth for usado pela primeira vez
- `wallet_ledger_entries`, `fee_ledger`, `system_wallet_ledger` — recebem dados na primeira trade
- `media_assets`, `asset_listing_submissions` — workflow legítimo, vazio porque novo

**Total DROP recomendado**: **~38 tabelas** (de 111 atuais → ~73 tabelas finais).

**Cuidado**: preservar `achievements_catalog` + `arena_badges` (seed) em export caso decida reintroduzir gamification.

---

## 6. Três cenários de roadmap

### Cenário A: Conservador (~80-100h, 4-6 semanas full-time solo)

**Escopo**:
- ✅ Fase 0 EMERGÊNCIA (~60min): B2.5-1, B2.6-1, B2.6-2, B2.6-3
- ✅ Fase A P1 completa (~22-26h): backend fixes + frontend B-x bugs + drizzle-orm bump + SIGTERM
- ✅ Fase H Production Readiness (~10-15h): Docker + pool + health + logger + backup + CI
- ✅ P-1, P-3, P-8 (confirmados) — remoções (~7-10h)
- ⏸️ P-5, P-6, P-7, P-9 deferidos
- ⏸️ P2 (rate limit, helmet, session.regenerate) deferidos
- ⏸️ Testes: apenas destravar trade-settlement (B2.8-1, 5min)
- ⏸️ Cobertura coverage tool

**Output**: sistema deployável, sem leaks críticos, mas com débito P2 inteiro acumulado. Multigame intacto. ~12k LOC removidos (P-1 + P-8).

**Risco residual**: alto em segurança operacional (sem rate limit, sem helmet, sem session.regenerate, sem CI rodando testes).

**Effort total**: ~50-60h (conservador chama Cenário A porque escolhe **completude crítica** ao invés de cobertura ampla).

### Cenário B: Moderado (~150-180h, 8-10 semanas) ⭐ RECOMENDADO

**Escopo**: Cenário A +
- ✅ Fase B P2 completa (~26-32h): rate limit, helmet, session.regenerate, CSP, code splitting, multigame UI/copy refactor (B2.3-4/5), precisão decimal, trilho strangler começa
- ✅ Decidir e executar P-5, P-6 — remoções (~8-13h)
- ✅ P-9 sweep após P-5/P-8 (~1-2h)
- ✅ Setup testing MVP + 5-7 testes priorizados (~10-15h): destravar trade-settlement, AMM unit tests, wallet integration, fee-engine idempotência regression
- ✅ Modularização do multigame/routes.ts (8 sub-routers) (~4h)

**Output**: produto enxuto e operável. ~50-60k LOC removidos (P-1 + P-5 + P-6 + P-8 + trilho legacy + cleanup). ~30 tabelas dropadas. Sistema deployável com observability mínima + segurança operacional minimamente OK. 30% coverage financeiro.

**Risco residual**: médio. P3 acumulados (~25-30 issues), god files restantes (terminal.tsx 3537), 140 `any`, falta 2FA/email verification, react 18 → 19 deferido.

**Effort total**: ~110-130h.

### Cenário C: Agressivo (~250-300h, 14-18 semanas)

**Escopo**: Cenário B +
- ✅ Fase E todos os Smells: S-2 (vault→asset migration completa), S-3 (top-level legacy → domains), S-4 (ESLint/Prettier/Husky), S-8 (reconciliação cross-ledger), S-11..S-16 (security gaps: lockout, email verification, 2FA, audit log, session-invalidation-on-pwd-change, custom cookie name), S-7 (web3 decisão final)
- ✅ Fase F testes amplos (~30-40h): UI testing infra + 30% coverage financeiro + smoke MVP + 15+ tests
- ✅ Refactor god files (S-1): terminal.tsx (3537) split em 8-10 sub-componentes; multigame/repository.ts modularização opcional
- ✅ React 19 migration + recharts 3 migration
- ✅ P-x todos decididos (P-7 keep, P-10..P-14 todos avaliados e decididos)
- ✅ Documentação completa: DEPLOY.md, RUNBOOK.md, CONTRIBUTING.md, architecture-target documentation
- ✅ Sentry + Prometheus + Grafana setup

**Output**: codebase production-grade. ~100-120k LOC alcançável após reduções. Tooling completo. Test coverage substancial. Onboarding novo dev = 1 dia.

**Risco residual**: baixo. Stack atualizada. Tooling completo. Mas ~14-18 semanas de single-dev work é prazo longo.

**Effort total**: ~200-260h.

---

## 7. Priorização final consolidada — sequência operacional

### Sprint 1 (1 dia) — EMERGÊNCIA + destravar testes
- B2.5-1 (5min): remover `_devResetLink` de forgot-password
- B2.6-2 (10min): error middleware com NODE_ENV gate
- B2.6-3 (15min): projection em GET /api/admin/users
- B2.6-1 (30min): redaction no logger middleware
- B2.8-1 (5min): setupFiles dotenv em vitest.config.ts
- B2.4-1 / B-8 (5min): admin/metrics lê canonical
- B2.3-2 / B-7 (5min): null-safe .find() em admin/arena
- B2.3-3 / B-2 (15min): default /assets ?game=all
- B2.9-6 (15min): pool config com timeouts
- Verificar e rodar `npm audit fix` (5min)

**Total Sprint 1: ~2h**. Fecha 10 quick wins críticos. Status: emergências OFF.

### Sprint 2-3 (1-2 semanas) — Fase A P1 financeiro + auth
- B2.2-1 (1h): UNIQUE em fee_ledger
- B2.2-2 (3-4h): wallet settlement dentro da tx
- B2.5-6 (1-2h): admin reset-password timing-safe + min 12 chars
- B2.3-1 / B-1 (30min): unificar Buying Power source
- B2.7-1 (1-2h): bump drizzle-orm major
- B2.7-4 + B2.7-6 + B2.7-8 (1h): remover deps zero-use + Replit plugins + Tailwind v4 dangling
- B2.7-5 (30-60min): deletar 15 templates shadcn órfãos + 6 packages
- B2.4-3 (TBD): plano para bulkCs2PriceProjection.ts (não fix imediato)

**Total Sprint 2-3: ~10-13h**.

### Sprint 4-5 (1-2 semanas) — Fase H Production Readiness
- B2.9-1 (1-2h): SIGTERM handlers
- B2.9-2 (30min): health check deep
- B2.9-3 (3-4h): Dockerfile + .dockerignore + scripts + README deploy section
- B2.9-5 + B2.6-1 (2-3h): pino com redact paths
- B2.9-7 (30min): Sentry SDK
- B2.8-6/B2.9-4 (1h): GitHub Actions com `npm test` + `npm run check`
- Backup pg_dump cron (1h)
- Env validation centralizada via zod (30min)
- B2.9-9 (15min): limpar build.ts allowlist

**Total Sprint 4-5: ~10-15h**.

### Sprint 6-8 (Cenário B continuação)
- Remoção P-1 (Predictions completo) — ~6-8h
- Remoção P-3 — incluído em P-1
- Remoção P-8 (Leaderboard) — ~1h
- Remoção P-5 (Arena) — ~6-10h
- Remoção P-6 (Draft) — ~2-3h
- P-9 sweep após remoções — ~1-2h
- Fase B P2: rate limit, helmet, session.regenerate, CSP — ~10-15h

**Total Sprint 6-8: ~26-39h**.

### Sprint 9-10 — Fase F testing MVP
- AMM unit tests (2-3h)
- pviEngine unit tests (1h)
- wallet integration tests (3-4h)
- fee-engine regression (B2.2-1) (2h)
- valuationJob regression (B2.2-8) (1h)
- forgot-password regression (B2.5-1) (1h)
- admin endpoints regression (B2.6-3, B-7, B-8) (2-3h)

**Total Sprint 9-10: ~12-15h**.

### Sprint 11+ — P3 + Smells residuais (Cenário C only)
Tudo o que sobrou da Fase E.

---

## 8. Estimativa de impacto LOC final

| Métrica | Antes | Após Cenário A | Após Cenário B | Após Cenário C |
|---|---:|---:|---:|---:|
| LOC backend | ~70 000 | ~62 000 | **~50 000** | ~45 000 |
| LOC frontend | ~39 000 | ~36 000 | **~30 000** | ~28 000 |
| Tabelas DB | 111 | ~95 | **~73** | ~70 |
| Schedulers ativos | 20 | 17 | **12** | 12 |
| Packages diretos (deps) | ~99 | ~95 | **~85** | ~85 |
| `node_modules` total | 382 MB | ~360 MB | **~310 MB** | ~310 MB |
| god files >1500 LOC | 6 | 5 | 4 | **1** (apenas terminal.tsx) |
| Test coverage financeiro | 0% | <5% | **30%** | 50%+ |
| CI rodando testes | ❌ | ✅ básico | ✅ básico | ✅ completo |
| Production readiness | 2.0/10 | 5.5/10 | **6.5/10** | 8.0/10 |

---

## 9. Riscos residuais por cenário

### Cenário A (Conservador)
- **Alto**: zero rate limit (B2.5-2), zero helmet (B2.6-5), zero session.regenerate (B2.5-3) — segurança operacional ainda fraca
- **Alto**: god files intactos (S-1)
- **Médio**: tests só destravados mas sem expansão
- **Médio**: 140 `any` continuam
- **Médio**: Arena/Draft/Web3 dormentes

### Cenário B (Moderado, recomendado)
- **Médio**: P3 acumulados (~25-30 issues) — gaps de defense-in-depth
- **Médio**: terminal.tsx 3537 LOC sem split (god file)
- **Baixo**: trilho legacy parcialmente limpo
- **Baixo**: React 18 vs 19 (sem CVE, atrasado)

### Cenário C (Agressivo)
- **Baixo**: stack atualizada, tooling completo
- **Baixo**: cobertura substancial
- **Cuidado operacional**: 14-18 semanas single-dev é prazo longo — risco de "perder momentum"

---

## 10. Métricas de sucesso (alvo após Cenário B)

| Métrica | Estado atual | Meta Cenário B |
|---|---:|---:|
| Score médio auditorias técnicas | **5.1/10** | **6.5/10** |
| P1 fechados | 0 | **100%** (21/21) |
| P2 fechados | 0 | **60%+** (~18 de 30) |
| Quick wins fechados | 0 | **100%** (17/17) |
| Production readiness score | **2.0** | **6.5** |
| Backup automatizado | ❌ | ✅ |
| CI/CD funcionando | ❌ | ✅ básico |
| Test coverage financeiro | **0%** | **30%** |
| god files >1500 LOC | **6** | **4** |
| LOC backend | ~70k | ~50k |
| Tabelas DB | 111 | ~73 |
| Schedulers ativos | 20 | 12 |
| `_devResetLink` no JSON | ✅ vaza | ❌ ausente |
| `passwordHash` em `/api/admin/users` | ✅ vaza | ❌ ausente |
| Headers de segurança HTTP | 1/12 | 7/12 |

---

## 11. Quantitativos finais (consolidação 9 auditorias)

| Item | Valor |
|---|---:|
| Achados técnicos totais (B2.x-y) | **88** |
| — Achados P1 | 21 (4 EMERGÊNCIAS) |
| — Achados P2 | 30 |
| — Achados P3 | 30 |
| — Won't fix | 2 |
| — Merged | 2 |
| Smells arquiteturais (S-x) | 17 |
| Decisões de produto (P-x) consolidadas | 14 (9 originais + 5 descobertas) |
| — REMOVE confirmados | 6 (P-1, P-3, P-5, P-6, P-8, P-11) |
| — KEEP confirmados | 4 (P-2, P-4, P-7, P-14) |
| — DEFER / contextual | 4 (P-9 vira fix sistemático, P-10/P-12/P-13) |
| Effort range por cenário | A: 50-60h · B: 110-130h · C: 200-260h |
| Quick wins acumulados (<30min) | **17** |
| Fases de remediação propostas | 8 (Fase 0, A, B, C, D, E, F, G, H) |
| LOC removíveis (Cenário B) | **~28-30k** (de 109k) |
| Tabelas removíveis | ~38 (de 111) |
| Schedulers removíveis | 8 (de 20) |
| Score médio auditorias técnicas | **5.1/10** |
| Recomendação consolidada | **Cenário B Moderado** (~110-130h, 8-10 semanas) |

---

## 12. Notas finais

### Próxima auditoria estrutural
**Após Sprint 5 (~Fase 0 + A + H concluídas, ~22-30h de trabalho)**. Auditar:
- Re-medir scores de segurança e production-readiness
- Validar que B2.5-1, B2.6-1/2/3 estão fechados (smoke test contra prod-like env)
- Confirmar CI rodando + testes destravados
- Decisão final P-5, P-6 com data de execução

**Após Cenário B completo (~3 meses)**:
- Auditoria de "produto na rua" — primeiro user real
- Validar custo operacional real (logs volume, DB queries/min, etc.)
- Decisão sobre 2FA/email verification baseado em audience real

### Perguntas estratégicas pendentes
(Você não precisa responder no doc — listei pra reflexão):

1. **Audiência-alvo**: open beta com gamers brasileiros? Beta restrita por convite? White-label para esports orgs?
2. **Pré ou pós-revenue?** Sem revenue ainda → P-2/P-7 (admin tooling) mais críticos. Pós-revenue → segurança operacional vira blocker absoluto
3. **Time = 1 dev (você) ou expansão?** Onboarding 2º dev requer DEPLOY.md + RUNBOOK.md + CONTRIBUTING.md (~6h doc).
4. **Open-source vs fechado?** Open-source → repo público requer scrubbing total + LICENSE. Fechado → menos pressão de doc external.
5. **Real-money path?** Hoje GS é virtual. Se planejar fiat/crypto, regulatory (KYC, AML, tax reporting) vira P0 absoluto — escopo separado.

### Pontos fortes confirmados após 9 auditorias
- **AMM math sólida** (2.2): zero divisão por zero, edge cases guardados
- **bcrypt 12 rounds** consistente
- **256-bit reset tokens + SHA-256 hash + TTL + single-use**
- **Drizzle bem usado** — zero SQL injection real
- **Schema bem modelado** (2.4) — 0 tabela sem PK
- **102 tabelas modeladas** para visão multigame de produto
- **TanStack Query + Context** state pattern moderno (2.3)
- **Zero `localStorage`, zero `dangerouslySetInnerHTML` real, zero `@ts-ignore`** (2.6)
- **1 teste de trade-settlement bem escrito** existe (precisa só de 1 linha pra rodar)

### Mensagem final
GamerStock é **um produto bem ambicioso construído rápido em plataforma errada (Replit autoscale), migrou para Windows local sem ferramentas operacionais, mas tem fundação técnica sólida**. As 88 issues mapeadas não são "código ruim" — são "código sem rede de segurança". A decisão estratégica não é "como consertar tudo" — é "**o que cortar agora** para o que sobrar caber no que você consegue fazer sozinho".

**Cenário B é o equilíbrio honesto**. ~110-130h ao longo de 8-10 semanas, executado em paralelo com qualquer iteração de produto que você queira. Resultado: produto enxuto, deployável, com observability mínima, testes de regressão nas regiões críticas, e sem os 3 leaks P1.

A maior alavanca **continua sendo decisional** — não técnica. Os números deste audit dão coragem para cortar.

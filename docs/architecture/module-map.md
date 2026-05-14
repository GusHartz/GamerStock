# GamerStock — Module Map

> **Versão:** Fase 1 (2026-04-06)
> **Status:** Mapeamento — sem mover arquivos.
> **Propósito:** Classificar código existente para guiar refactors futuros.

Labels: **OFFICIAL** | **LEGACY_FROZEN** | **EXPERIMENTAL** | **OPS_ONLY**

---

## server/ (raiz)

| Arquivo | Label | Motivo |
|---|---|---|
| `server/index.ts` | OFFICIAL | Boot point central — mas precisa de extração de `startSchedulers()` |
| `server/routes.ts` | LEGACY_FROZEN | Monólito de rotas — migrar progressivamente para routers de domínio |
| `server/storage.ts` | LEGACY_FROZEN | Repositório monolítico — substituir por repos de domínio |
| `server/db.ts` | OFFICIAL | Conexão Drizzle — simples e correto |
| `server/app-config.ts` | OFFICIAL | Key-value runtime config |
| `server/market-maker.ts` | OFFICIAL | PAE + momentum + AMM sync — core de preço |
| `server/market-quotes.ts` | OFFICIAL | Utilitário de quotes AMM |
| `server/riot-sync.ts` | LEGACY_FROZEN | Sync Riot acoplado — migrar para PerformanceProvider interface |
| `server/riot-perf.ts` | LEGACY_FROZEN | Idem — processamento de match Riot |
| `server/arena.ts` | OFFICIAL | Core de Arena — mas acoplado diretamente (extrair para domínio) |
| `server/name-generator.ts` | EXPERIMENTAL | Gera nomes fictícios — pertence a simulation |
| `server/static.ts` | OFFICIAL | Serve estáticos em PROD |
| `server/vite.ts` | OFFICIAL | Setup Vite em DEV |
| `server/events/` | OFFICIAL | Event bus interno |
| `server/sse/` | OFFICIAL | Server-Sent Events |

---

## server/domains/

### admin/
| Arquivo | Label | Motivo |
|---|---|---|
| `routes.ts` | OPS_ONLY | Painel admin — não afeta regras de mercado |

### arena/
| Arquivo | Label | Motivo |
|---|---|---|
| `*` | OFFICIAL | Temporadas, badges, rankings, duelos |

### discovery/
| Arquivo | Label | Motivo |
|---|---|---|
| `*` | OFFICIAL | Busca de assets e candidatos |

### fee-engine/
| Arquivo | Label | Motivo |
|---|---|---|
| `*` | OFFICIAL | Cálculo e coleta de taxas |

### identity/
| Arquivo | Label | Motivo |
|---|---|---|
| `*` | OFFICIAL | Autenticação e acesso |

### ingestion/
| Arquivo | Label | Motivo |
|---|---|---|
| `routes/` | OFFICIAL | API de revisão e publicação de candidatos |
| `services/` | OFFICIAL | Fila de ingestion e elegibilidade |
| `repository/` | OFFICIAL | Acesso a dados de candidatos |

### market/
| Arquivo | Label | Motivo |
|---|---|---|
| `routes.ts` | OFFICIAL | Endpoints de mercado |

### media/
| Arquivo | Label | Motivo |
|---|---|---|
| `routes.ts` | OFFICIAL | Upload e gestão de mídia |

### multigame/
| Arquivo | Label | Motivo |
|---|---|---|
| `multigameValuationScheduler.ts` | OFFICIAL | Loop central de valuation Dota2/CS2 |
| `dota2ValuationService.ts` | OFFICIAL | Engine de valuation Dota2 |
| `cs2ValuationService.ts` | OFFICIAL | Engine de valuation CS2 |
| `dota2MatchSyncService.ts` | OFFICIAL | Sync de matches Dota2 via OpenDota |
| `cs2MatchSyncService.ts` | OFFICIAL | Sync de stats CS2 via Steam |
| `dota2BaselineService.ts` | OFFICIAL | Baseline de performance Dota2 |
| `dota2CanonicalProjection.ts` | OFFICIAL | Projeta player_value → fundamental_price |
| `cs2SyntheticMatchService.ts` | EXPERIMENTAL | Síntese de matches CS2 para pricing |
| `cs2DeltaEngine.ts` | EXPERIMENTAL | Delta engine CS2 |
| `epicVerificationAdapter.ts` | EXPERIMENTAL | Epic Games verification |
| `verificationRegistry.ts` | OFFICIAL | Registro de adapters de verificação |
| `providers/` | OFFICIAL | Adapters de provider (OpenDota, Steam) |
| `repository.ts` | OFFICIAL | Acesso a dados de valuation |
| `routes.ts` | OFFICIAL | Endpoints multigame |

### news/
| Arquivo | Label | Motivo |
|---|---|---|
| `*` | OFFICIAL | Feed de notícias |

### orders/
| Arquivo | Label | Motivo |
|---|---|---|
| `*` | OFFICIAL | Gerenciamento de ordens |

### performance/
| Arquivo | Label | Motivo |
|---|---|---|
| `*` | OFFICIAL | Scores de performance por jogador |

### player-claims/
| Arquivo | Label | Motivo |
|---|---|---|
| `*` | OFFICIAL | Processo de reivindicação de asset por jogador |

### player-earnings/
| Arquivo | Label | Motivo |
|---|---|---|
| `*` | OFFICIAL | Ganhos dos jogadores como creators |

### player-hub/
| Arquivo | Label | Motivo |
|---|---|---|
| `*` | OFFICIAL | Hub de perfil público do jogador |

### player-operator/
| Arquivo | Label | Motivo |
|---|---|---|
| `*` | OFFICIAL | Operações de jogador como operador de asset |

### player-public/
| Arquivo | Label | Motivo |
|---|---|---|
| `*` | OFFICIAL | Dados públicos de player |

### portfolio/
| Arquivo | Label | Motivo |
|---|---|---|
| `*` | OFFICIAL | Portfólio e posições do usuário |

### prediction/
| Arquivo | Label | Motivo |
|---|---|---|
| `*` | OFFICIAL | Mercado de predições — auto-lock, settlement, posições |

### synthetic/
| Arquivo | Label | Motivo |
|---|---|---|
| `*` | EXPERIMENTAL | Mercado sintético CS2 |

### system/
| Arquivo | Label | Motivo |
|---|---|---|
| `*` | OPS_ONLY | Utilidades de sistema |

### terminal/
| Arquivo | Label | Motivo |
|---|---|---|
| `reconciler.ts` | OPS_ONLY | Reconciler de invariants |
| `invariants.ts` | OPS_ONLY | Definições de invariants de mercado |
| `marketContract.ts` | OFFICIAL | Contrato de mercado para Terminal |
| `routes.ts` | OFFICIAL | Endpoints do Terminal |

### trade-settlement/
| Arquivo | Label | Motivo |
|---|---|---|
| `*` | OFFICIAL | Liquidação de trades |

### trading/
| Arquivo | Label | Motivo |
|---|---|---|
| `*` | OFFICIAL | Execução de trades |

### valuation/
| Arquivo | Label | Motivo |
|---|---|---|
| `*` | OFFICIAL | Valuation state e histórico |

### wallet/
| Arquivo | Label | Motivo |
|---|---|---|
| `*` | OFFICIAL | Saldos e ledger do usuário |

---

## server/services/

| Arquivo | Label | Motivo |
|---|---|---|
| `ammPricing.ts` | OFFICIAL | AMM core — cálculo de preços |
| `triggerEngine.ts` | OFFICIAL | Engine de trigger orders |
| `tradeExecutor.ts` | OFFICIAL | Execução de trades (wrapper) |
| `assetTradeExecutor.ts` | OFFICIAL | Idem — versão para assets |
| `valuationJob.ts` | LEGACY_FROZEN | Valuation LoL/Riot — substituir pelo multigame loop |
| `pviEngine.ts` | LEGACY_FROZEN | PVI para LoL — engine legado |
| `performanceEngine.ts` | LEGACY_FROZEN | Performance engine Riot legado |
| `baselineUpdateJob.ts` | OFFICIAL | Atualização de baselines |
| `seasonsService.ts` | OFFICIAL | Serviço de temporadas |
| `duelService.ts` | OFFICIAL | Resolução de duelos |
| `achievementsService.ts` | OFFICIAL | Achievements e badges |
| `newsService.ts` | OFFICIAL | Feed de notícias |
| `marketSignals.ts` | OFFICIAL | Sinais de mercado |
| `followService.ts` | OFFICIAL | Sistema de follow |
| `arenaBootstrap.ts` | OPS_ONLY | Bootstrap de arena |
| `botTrader.ts` | EXPERIMENTAL | Bot trader (legado — ver simulation/) |

---

## server/scheduler/

| Arquivo | Label | Motivo |
|---|---|---|
| `market-sync-scheduler.ts` | OFFICIAL | Sync de mercado |
| `prediction-auto-lock.ts` | OFFICIAL | Auto-lock de predições |
| `ingestion-scheduler.ts` | OFFICIAL | Scheduler de ingestion |
| `provider-resolution-scheduler.ts` | OFFICIAL | Resolução de providers |

---

## server/market-core/

| Arquivo | Label | Motivo |
|---|---|---|
| `asset-registry.ts` | OFFICIAL | Registro canônico multi-provider |
| `sync.ts` | OFFICIAL | Sync canônico |
| `startup-seed.ts` | OPS_ONLY | Seed inicial — separar prod de dev |
| `backfill-trading-assets.ts` | OPS_ONLY | Script de migração única — mover para scripts/ |

---

## server/migrations/

| Arquivo | Label | Motivo |
|---|---|---|
| `bulkCs2PriceProjection.ts` | OPS_ONLY | Migration de projeção CS2 — roda no boot com idempotência |

---

## server/simulation/

| Arquivo | Label | Motivo |
|---|---|---|
| `bots/` | EXPERIMENTAL | Bot trader |
| `synthetic-market/` | EXPERIMENTAL | Mercado sintético |
| `players/` | EXPERIMENTAL | Players simulados |
| `services/` | EXPERIMENTAL | Serviços de simulação |

---

## server/modules/

| Arquivo | Label | Motivo |
|---|---|---|
| `draft/` | EXPERIMENTAL | Sistema de draft esportivo — em desenvolvimento |

---

## server/integrations/

| Arquivo | Label | Motivo |
|---|---|---|
| `jobs/` | OFFICIAL | Jobs de sync de performance (riot, steam) |
| `riot/` | OFFICIAL | Integration Riot |
| `synthetic/` | EXPERIMENTAL | Integration sintética |
| `interfaces/` | OFFICIAL | Interfaces de provider |
| `performance-provider-factory.ts` | OFFICIAL | Factory de providers |

---

## server/web3/

| Arquivo | Label | Motivo |
|---|---|---|
| `*` | EXPERIMENTAL | Bridge Web3 — não ativo em PROD |

---

## server/ws/

| Arquivo | Label | Motivo |
|---|---|---|
| `market-ws.ts` | OFFICIAL | WebSocket de mercado |
| `market-hub.ts` | OFFICIAL | Hub de broadcast |

---

## shared/schema/

| Arquivo | Label | Motivo |
|---|---|---|
| `player.ts` | OFFICIAL | assets, markets, trades — core |
| `multigame.ts` | OFFICIAL | Valuation state, history, profiles |
| `auth.ts` | OFFICIAL | users, sessions |
| `wallet.ts` | OFFICIAL | wallets, ledger |
| `prediction.ts` | OFFICIAL | Prediction market |
| `arena.ts` | OFFICIAL | Arena, seasons, badges |
| `portfolio.ts` | LEGACY_FROZEN | portfolios.balance legado — NÃO usar para saldo |
| `valuation.ts` | LEGACY_FROZEN | Valuation Riot legado |
| `performance.ts` | LEGACY_FROZEN | Performance Riot legado |
| `simulation.ts` | EXPERIMENTAL | Schema de simulação |
| `treasury.ts` | EXPERIMENTAL | Treasury futuro |
| `hub.ts` | OFFICIAL | Player hub |
| `ingestion.ts` | OFFICIAL | Fila de ingestion |
| `claims.ts` | OFFICIAL | Claims de assets |
| `media.ts` | OFFICIAL | Mídia |
| `discovery.ts` | OFFICIAL | Discovery |
| `market.ts` | OFFICIAL | Ordens, triggers, market state |

---

## client/src/pages/

| Arquivo | Label | Motivo |
|---|---|---|
| `terminal.tsx` | OFFICIAL | Terminal de trading principal |
| `assets.tsx` | OFFICIAL | Listagem de assets |
| `asset-detail.tsx` | OFFICIAL | Detalhe de asset |
| `portfolio.tsx` | OFFICIAL | Portfolio do usuário |
| `predictions*.tsx` | OFFICIAL | Mercado de predições |
| `arena*.tsx` | OFFICIAL | Arena e gamification |
| `player*.tsx` | OFFICIAL | Perfil público de player |
| `admin/` | OPS_ONLY | Painel admin |
| `landing.tsx` | OFFICIAL | Landing page |
| `login.tsx` | OFFICIAL | Autenticação |
| `player-operator.tsx` | OFFICIAL | Operador de asset |

---

## Resumo por Label

| Label | Count (estimado) | Ação |
|---|---|---|
| OFFICIAL | ~70% | Manter, investir, refinar |
| LEGACY_FROZEN | ~15% | Não quebrar, não investir, planejar substituição |
| EXPERIMENTAL | ~10% | Avaliar antes de cada feature, pode ser removido |
| OPS_ONLY | ~5% | Ferramentas admin — separar claramente de regras de mercado |

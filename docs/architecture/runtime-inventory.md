# GamerStock — Runtime Inventory

> **Versão:** Fase 1 (2026-04-06)
> **Status:** Auditoria de jobs e side effects — sem modificações no código.
> **Propósito:** Mapear todos os processos auto-iniciados no boot para operação segura.

---

## Boot Sequence (server/index.ts)

Os items abaixo são iniciados sequencialmente após `httpServer.listen()` retornar.

---

## 1. Schedulers Contínuos

### 1.1 Market Simulator (PAE + Momentum + AMM Sync)

| Campo | Valor |
|---|---|
| **Nome** | Market Simulator |
| **Função de start** | `startMarketSimulator()` |
| **Arquivo** | `server/market-maker.ts` |
| **Intervalo** | 15 segundos (tick geral) / PAE a cada 4 ticks (60s) |
| **Finalidade** | Anima preços via AMM, aplica decaimento de momentum, ancora `last_trade_price` em `fundamental_price` via PAE, emite SSE para clientes |
| **Obrigatório em PROD** | Sim — sem ele, preços ficam estáticos |
| **Deve rodar em DEV** | Sim |
| **Risco operacional** | Alto — é o loop central de preço. Parar sem motivo congela o mercado |
| **Classificação** | OFFICIAL |

---

### 1.2 Riot Sync Scheduler

| Campo | Valor |
|---|---|
| **Nome** | Riot Sync Scheduler |
| **Função de start** | `startRiotSyncScheduler()` |
| **Arquivo** | `server/riot-sync.ts` |
| **Intervalo** | 24 horas |
| **Finalidade** | Sincroniza challengers LoL NA1 via Riot API — busca novos players e assets |
| **Obrigatório em PROD** | Sim (para manter atualização de players LoL) |
| **Deve rodar em DEV** | Opcional — caro em API calls, pode ser desativado localmente |
| **Risco operacional** | Baixo — falha não quebra o sistema, apenas atrasa sync |
| **Classificação** | OFFICIAL |

---

### 1.3 Performance Pricing Scheduler (Riot Perf)

| Campo | Valor |
|---|---|
| **Nome** | Perf Pricing Scheduler |
| **Função de start** | `startPerfPricingScheduler()` |
| **Arquivo** | `server/riot-perf.ts` |
| **Intervalo** | 10 minutos |
| **Finalidade** | Busca matches recentes e recalcula preços de assets Riot/LoL via PVI |
| **Obrigatório em PROD** | Sim (para assets LoL) |
| **Deve rodar em DEV** | Opcional |
| **Risco operacional** | Baixo — falha isola só assets LoL |
| **Classificação** | LEGACY_FROZEN (será substituído pelo Multigame Valuation Loop) |

---

### 1.4 Market Sync Scheduler

| Campo | Valor |
|---|---|
| **Nome** | Market Sync Scheduler |
| **Função de start** | `startMarketSyncScheduler()` |
| **Arquivo** | `server/scheduler/market-sync-scheduler.ts` |
| **Intervalo** | Configurável via `MARKET_SYNC_INTERVAL_MS` (default: não explícito no boot log) |
| **Finalidade** | Sincroniza estado de mercado canônico — preços e volumes |
| **Obrigatório em PROD** | Sim |
| **Deve rodar em DEV** | Sim |
| **Risco operacional** | Médio |
| **Classificação** | OFFICIAL |

---

### 1.5 Prediction Auto-Lock Scheduler

| Campo | Valor |
|---|---|
| **Nome** | Prediction Auto-Lock |
| **Função de start** | `startPredictionAutoLockScheduler()` |
| **Arquivo** | `server/scheduler/prediction-auto-lock.ts` |
| **Intervalo** | 60 segundos (configurável via `PREDICTION_AUTOLOCK_INTERVAL_MS`) |
| **Finalidade** | Bloqueia automaticamente predições que passaram do deadline |
| **Obrigatório em PROD** | Sim — sem ele, predições ficam abertas indefinidamente |
| **Deve rodar em DEV** | Sim (mas pode ter intervalo maior) |
| **Risco operacional** | Alto — falha pode deixar predições em estado inconsistente |
| **Classificação** | OFFICIAL |

---

### 1.6 Ingestion Scheduler

| Campo | Valor |
|---|---|
| **Nome** | Ingestion Scheduler |
| **Função de start** | `startIngestionScheduler()` |
| **Arquivo** | `server/scheduler/ingestion-scheduler.ts` |
| **Intervalo** | 15 minutos (configurável via `INGESTION_SCHEDULER_INTERVAL_MS`) |
| **Finalidade** | Processa candidatos de players na fila de ingestion — avalia elegibilidade e publica |
| **Obrigatório em PROD** | Sim |
| **Deve rodar em DEV** | Opcional |
| **Risco operacional** | Baixo — falha apenas atrasa publicação de novos players |
| **Classificação** | OFFICIAL |

---

### 1.7 Provider Resolution Scheduler

| Campo | Valor |
|---|---|
| **Nome** | Provider Resolution Scheduler |
| **Função de start** | `startProviderResolutionScheduler()` |
| **Arquivo** | `server/scheduler/provider-resolution-scheduler.ts` |
| **Intervalo** | 5 minutos (configurável via `PROVIDER_RESOLUTION_SCHEDULER_INTERVAL_MS`) |
| **Finalidade** | Resolve identidades de provider para novos assets (mapeia externalId → playerProfileId) |
| **Obrigatório em PROD** | Sim |
| **Deve rodar em DEV** | Opcional |
| **Risco operacional** | Baixo |
| **Classificação** | OFFICIAL |

---

### 1.8 Trigger Engine

| Campo | Valor |
|---|---|
| **Nome** | Trigger Engine |
| **Função de start** | `startTriggerEngine()` |
| **Arquivo** | `server/services/triggerEngine.ts` |
| **Intervalo** | 3 segundos (loop contínuo) |
| **Finalidade** | Executa trigger orders (ordens condicionais de compra/venda) quando preço cruza threshold |
| **Obrigatório em PROD** | Sim — sem ele, trigger orders nunca disparam |
| **Deve rodar em DEV** | Sim |
| **Risco operacional** | Alto — falha impede execução de ordens automáticas |
| **Classificação** | OFFICIAL |

---

### 1.9 Baseline Update Scheduler

| Campo | Valor |
|---|---|
| **Nome** | Baseline Update Scheduler |
| **Função de start** | `startBaselineUpdateScheduler()` |
| **Arquivo** | `server/services/baselineUpdateJob.ts` |
| **Intervalo** | 24 horas |
| **Finalidade** | Atualiza baselines de performance por role/game — usados como referência para cálculo de score |
| **Obrigatório em PROD** | Sim |
| **Deve rodar em DEV** | Opcional |
| **Risco operacional** | Baixo — falha não afeta preços imediatamente |
| **Classificação** | OFFICIAL |

---

### 1.10 Multigame Valuation Loop (Fase 2)

| Campo | Valor |
|---|---|
| **Nome** | Multigame Valuation Loop |
| **Função de start** | `startMultigameValuationLoop()` |
| **Arquivo** | `server/domains/multigame/multigameValuationScheduler.ts` |
| **Intervalo** | 10 minutos (warmup: 5 min após boot) |
| **Finalidade** | Atualiza `player_value` em `dota2_valuation_state` para TODOS os assets ACTIVE/LISTED Dota2 e CS2 — user-linked via OpenDota/Steam, bulk via API provider |
| **Obrigatório em PROD** | Sim — motor central de valuation para Dota2/CS2 |
| **Deve rodar em DEV** | Sim (pode ter intervalo maior) |
| **Risco operacional** | Alto — se parar, valuations ficam stale e o reconciler pode quarentenar assets |
| **Classificação** | OFFICIAL |
| **Observabilidade** | `export let lastLoopRun`, `export let lastCycleSummary` — consultáveis via `GET /api/admin/system-health` |

---

### 1.11 Terminal Reconciler

| Campo | Valor |
|---|---|
| **Nome** | Terminal Reconciler |
| **Função de start** | `startTerminalReconciler()` |
| **Arquivo** | `server/domains/terminal/reconciler.ts` |
| **Intervalo** | 5 minutos |
| **Finalidade** | Verifica invariants de integridade de mercado (INV_5: preço baseline, INV_6: freshness) e quarentena ou reprocessa assets violadores |
| **Obrigatório em PROD** | Sim — garante integridade dos assets no Terminal |
| **Deve rodar em DEV** | Sim (pode ter intervalo maior) |
| **Risco operacional** | Médio — pode quarentenar assets se valuation loop estiver offline |
| **Classificação** | OPS_ONLY |

---

### 1.12 Valuation Batch (LoL/Riot — Legado)

| Campo | Valor |
|---|---|
| **Nome** | Valuation Batch |
| **Função de start** | Inline em `server/index.ts` via `scheduleValuation()` |
| **Arquivo** | `server/services/valuationJob.ts` |
| **Intervalo** | 10 minutos |
| **Finalidade** | Recalcula PVI/preços para assets Riot LoL |
| **Obrigatório em PROD** | Sim (para LoL) |
| **Deve rodar em DEV** | Opcional |
| **Risco operacional** | Baixo — falha isola só LoL |
| **Classificação** | LEGACY_FROZEN |

---

### 1.13 Duel Resolver

| Campo | Valor |
|---|---|
| **Nome** | Duel Resolver |
| **Função de start** | Inline em `server/index.ts` via `scheduleDuelResolver()` |
| **Arquivo** | `server/services/duelService.ts` |
| **Intervalo** | 15 minutos |
| **Finalidade** | Resolve duelos vencidos pelo tempo — distribui prêmios |
| **Obrigatório em PROD** | Sim |
| **Deve rodar em DEV** | Opcional |
| **Risco operacional** | Baixo |
| **Classificação** | OFFICIAL |

---

### 1.14 News Refresh Scheduler

| Campo | Valor |
|---|---|
| **Nome** | News Refresh |
| **Função de start** | Inline em `server/index.ts` via `scheduleNews()` |
| **Arquivo** | `server/services/newsService.ts` |
| **Intervalo** | 10 minutos (warm-up: 30s após boot) |
| **Finalidade** | Atualiza feed de notícias de esports |
| **Obrigatório em PROD** | Não crítico — UI funciona sem ele |
| **Deve rodar em DEV** | Não recomendado |
| **Risco operacional** | Mínimo |
| **Classificação** | OFFICIAL |

---

### 1.15 Bot Simulator

| Campo | Valor |
|---|---|
| **Nome** | Bot Trader Simulator |
| **Função de start** | `startBotSimulator()` |
| **Arquivo** | `server/simulation/bots/bot-trader.ts` |
| **Intervalo** | Contínuo (baseado em configuração interna) |
| **Finalidade** | Simula atividade de trading com bots para animar o mercado |
| **Obrigatório em PROD** | Não — mas melhora UX com volume sintético |
| **Deve rodar em DEV** | Sim (para simular mercado ativo) |
| **Risco operacional** | Médio — bots que operam agressivamente podem distorcer preços |
| **Classificação** | EXPERIMENTAL |

---

## 2. One-Time Boot Jobs (não loops)

### 2.1 CS2 Price Projection Migration V2

| Campo | Valor |
|---|---|
| **Nome** | Bulk CS2 Price Projection V2 |
| **Arquivo** | `server/migrations/bulkCs2PriceProjection.ts` |
| **Trigger** | Uma única vez no boot (com guard de idempotência) |
| **Finalidade** | Projeta `player_value` → `fundamental_price` para assets CS2 bulk com 800 preços pré-capturados |
| **Obrigatório em PROD** | Sim (idempotente — skip se já aplicado) |
| **Risco operacional** | Baixo — não altera preços negociados, só `fundamental_price` |
| **Classificação** | OPS_ONLY |

---

### 2.2 System Wallet Init

| Campo | Valor |
|---|---|
| **Nome** | System Wallet Init |
| **Arquivo** | `server/domains/fee-engine/index.ts` |
| **Trigger** | Uma vez no boot (idempotente) |
| **Finalidade** | Garante existência das carteiras de sistema para fee collection |
| **Obrigatório em PROD** | Sim |
| **Risco operacional** | Baixo |
| **Classificação** | OPS_ONLY |

---

### 2.3 Startup Seed

| Campo | Valor |
|---|---|
| **Nome** | Startup Seed |
| **Arquivo** | `server/market-core/startup-seed.ts` |
| **Trigger** | Boot, non-blocking (background) |
| **Finalidade** | Seed inicial de assets canônicos — executa apenas se necessário |
| **Obrigatório em PROD** | Depende — pode conflitar com dados reais |
| **Risco operacional** | Médio — seed em PROD pode duplicar assets se guard falhar |
| **Classificação** | OPS_ONLY |
| **Atenção** | Deve ter guard robusto para não rodar em PROD se dados já existem |

---

### 2.4 Achievement Badge Backfill

| Campo | Valor |
|---|---|
| **Nome** | Achievement Badge Backfill |
| **Arquivo** | `server/services/achievementsService.ts` |
| **Trigger** | Boot, background, non-fatal |
| **Finalidade** | Atribui badges a usuários que já tinham achievements antes do sistema de badges existir |
| **Obrigatório em PROD** | Apenas uma vez — idempotente |
| **Risco operacional** | Mínimo |
| **Classificação** | OPS_ONLY |

---

### 2.5 Initial Valuation Seed (LoL)

| Campo | Valor |
|---|---|
| **Nome** | Initial Valuation Seed |
| **Arquivo** | `server/services/valuationJob.ts` (`seedInitialValuations`) |
| **Trigger** | Boot, background, non-fatal |
| **Finalidade** | Seed de PVI inicial para assets Riot que ainda não têm valuation |
| **Obrigatório em PROD** | Apenas uma vez — idempotente |
| **Risco operacional** | Baixo |
| **Classificação** | LEGACY_FROZEN |

---

## 3. Outros Processos de Infraestrutura

| Nome | Arquivo | Finalidade |
|---|---|---|
| Market WebSocket | `server/ws/market-ws.ts` + `market-hub.ts` | SSE/WS broadcast de preços em tempo real |
| Event Handlers | `server/events/index.ts` | Bus de eventos internos |
| Web3 Bridge | `server/web3/index.ts` | Bridge para futuro — não ativo em prod |
| DB Connection Check | `server/db.ts` | Verifica conectividade no boot (non-fatal) |

---

## 4. Riscos Identificados

| Risco | Descrição | Severidade | Status (Fase 4) |
|---|---|---|---|
| Startup Seed em PROD | `runStartupSeed()` pode duplicar assets se guard falhar | Alta | ✅ Mitigado — guards de count + logs WARN em PROD |
| Bot Simulator sem env guard | Roda em PROD sem configuração explícita | Média | ✅ Mitigado — bloqueado em PROD sem `ENABLE_BOTS=true` |
| `server/index.ts` monolítico | Todos os schedulers inline dificultam testes e feature flags | Média | ✅ Resolvido — extraído para `server/scheduler/index.ts` |
| CS2 PandaScore 401 | Bulk CS2 fica sem sync de performance — apenas `updatedAt` é tocado | Média | ⚠️ Pendente (fora do escopo da Fase 4) |
| Backfill + Seed bloqueiam startup se DB lento | Jobs non-fatal mas podem consumir conexões | Baixa | ⚠️ Pendente (fora do escopo da Fase 4) |

---

## 5. Perfil Operacional de Ambiente (Fase 4)

> Adicionado em 2026-04-06 como parte da Fase 4 — Runtime & Environment Parity.
> Ponto de verdade para decisões de deployment e CI/CD.

### 5.1 O que deve rodar em DEV

Todos os schedulers rodam por padrão em DEV.
O bot simulator inicia por padrão (a menos que `DISABLE_BOTS=true`).
O startup seed verifica counts e só roda pipelines pesados se o DB estiver vazio.

| Scheduler | Roda em DEV | Observação |
|---|---|---|
| Market Simulator (AMM/PAE) | ✅ Sempre | Loop central de preço |
| Riot Sync | ✅ Sempre | Caro em API calls — pode usar `DISABLE_RIOT_SYNC` futuramente |
| Perf Pricing (PVI) | ✅ Sempre | LoL only, LEGACY_FROZEN |
| Market Sync | ✅ Sempre | |
| Prediction Auto-lock | ✅ Sempre | |
| Ingestion | ✅ Sempre | |
| Provider Resolution | ✅ Sempre | |
| Trigger Engine | ✅ Sempre | |
| Baseline Update | ✅ Sempre | |
| Multigame Valuation Loop | ✅ Sempre | |
| Terminal Reconciler | ✅ Sempre | |
| Valuation Batch (10m) | ✅ Sempre | |
| Duel Resolver (15m) | ✅ Sempre | |
| News Refresh (10m) | ✅ Sempre | |
| **Bot Simulator** | ✅ Por padrão | Skip com `DISABLE_BOTS=true` |
| Startup Seed | ✅ Por padrão | Guarded — só roda pipelines pesados se DB vazio |

### 5.2 O que deve rodar em PROD

Em PROD, o comportamento difere apenas no bot simulator.

| Scheduler | Roda em PROD | Como ativar/desativar |
|---|---|---|
| Market Simulator (AMM/PAE) | ✅ Obrigatório | — |
| Riot Sync | ✅ Obrigatório | — |
| Perf Pricing (PVI) | ✅ Obrigatório | — |
| Market Sync | ✅ Obrigatório | — |
| Prediction Auto-lock | ✅ Obrigatório | — |
| Ingestion | ✅ Obrigatório | — |
| Provider Resolution | ✅ Obrigatório | — |
| Trigger Engine | ✅ Obrigatório | — |
| Baseline Update | ✅ Obrigatório | — |
| Multigame Valuation Loop | ✅ Obrigatório | — |
| Terminal Reconciler | ✅ Obrigatório | — |
| Valuation Batch (10m) | ✅ Obrigatório | — |
| Duel Resolver (15m) | ✅ Obrigatório | — |
| News Refresh (10m) | ✅ Obrigatório | — |
| **Bot Simulator** | ❌ OFF por padrão | Ativar com `ENABLE_BOTS=true` |
| Startup Seed | ✅ Automático | Guarded — skip se dados já existem; WARN se cs2/dota2=0 |

### 5.3 Variáveis de Ambiente Operacionais

| Variável | Tipo | Propósito | Valor default |
|---|---|---|---|
| `NODE_ENV` | `string` | Controla guards de ambiente | `development` |
| `ENABLE_BOTS` | `"true"` / unset | Ativa bot simulator em PROD | unset (= off em PROD) |
| `DISABLE_BOTS` | `"true"` / unset | Desativa bot simulator em qualquer ambiente | unset (= on em DEV) |
| `PORT` | `number` | Porta HTTP do servidor | `5000` |
| `BUILD_ID` | `string` | Identificador do build (logging) | `"dev"` |

### 5.4 Comportamento do Bot Simulator

O bot simulator (`server/simulation/bots/bot-trader.ts`) executa 100 bots virtuais
com diferentes estratégias (TREND_FOLLOWER, VALUE_TRADER, PROFIT_TAKER, etc.)
que geram trades reais em `assets` e afetam `asset_market_state.supply` e `last_price`.

**Em DEV**: inicia por padrão. Útil para popular o order book e testar a UI.
**Em PROD**: bloqueado por padrão. Requer `ENABLE_BOTS=true` (decisão operacional explícita).
**Em CI/test**: bloquear com `DISABLE_BOTS=true`.

Log quando bloqueado:
```
[Schedulers] ✗ Bot simulator — SKIPPED (NODE_ENV=production without ENABLE_BOTS=true)
```

Log quando ativo:
```
[Schedulers] ✓ Bot simulator — started (NODE_ENV=development (default))
```

### 5.5 Comportamento do Startup Seed

O startup seed (`server/market-core/startup-seed.ts`) roda no boot e verifica:

1. **Mercado canônico Riot** — skip se marketCount > 0 e assetCount > 0
2. **Mercados estruturais** (sandbox, Dota2 global, CS2 global) — sempre, mas idempotente
3. **CS2 bootstrap** — skip se cs2AssetCount > 0
4. **Dota2 bootstrap** — skip se assetCount > 0
5. **Dota2 enrichment** — skip se dota2_valuation_state tem rows

Em PROD com dados ausentes (primeiro deploy), emite `console.warn` antes de executar.
Em PROD com dados presentes (deploys normais), todos os passos são skipped e logados como tal.

Log típico em PROD com dados (operação normal):
```
[Seed] ── Startup Seed BEGIN (env=production) ──
[Seed] markets=2 assets=1439 — skip sync (already seeded)
[Seed] Steam/Dota2 market ensured.
[Seed] Steam/CS2 market ensured.
[Seed] CS2 assets already exist (720) — skip CS2 bootstrap.
[Seed] dota2_valuation_state has 719 rows — skip enrichment.
[Seed] ── Startup Seed COMPLETE (env=production) ──
```

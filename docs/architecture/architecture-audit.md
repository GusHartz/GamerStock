# GamerStock — Architecture Audit

> **Status:** Read-only analysis. No files were moved or modified.  
> **Date:** March 2026  
> **Scope:** Full codebase — server/, client/, shared/, seed.ts, integrations, market, arena, simulation

---

## A. Resumo Executivo

### Visão Geral da Arquitetura Atual

GamerStock é uma aplicação Node.js/React full-stack estruturada como monólito servido: o Express serve tanto a API quanto o frontend via Vite middleware. O servidor inicializa schedulers, WebSocket, SSE e a engine de mercado no mesmo processo.

A base de código passou por pelo menos três camadas de evolução:

1. **Fase 1 (Sandbox/Fantasy):** Players sintéticos (`vaults`), trades simulados (`trades`/`positions`), sem dados reais.
2. **Fase 2 (Real Market — Riot):** Novo conjunto de tabelas (`riotAssets`, `riotTrades`, `riotPositions`), engine de performance com dados da API Riot, PVI engine, AMM engine.
3. **Fase 3 (Plataforma — Arena/Social):** Arena, achievements, seasons, duels, follows, draft, market signals, news service.

Esse crescimento incremental deixou cicatrizes arquiteturais importantes, documentadas abaixo.

### Principais Pontos Fortes

- **Performance Engine (PVI/Valuation):** Código limpo, bem documentado, com configurações centralizadas. Base sólida para o Performance Layer.
- **AMM Engine:** Implementação matemática correta de bonding curve logarítmica com parâmetros configuráveis.
- **Trade Executor:** Transação atômica, com idempotency, fee ledger, e hooks de arena. Relativamente coeso.
- **Draft Module (`server/modules/draft/`):** Único módulo com estrutura de pasta por domínio. Serve de template.
- **Market Core (`server/market-core/`):** Asset Registry, Provider Adapter, sync canônico — abstração multi-provider iniciada.
- **Provider Adapter Pattern (`server/providers/types.ts`):** Intenção correta de abstrair a fonte de dados externa.
- **Ledger Entries + Fee Ledger:** Base contábil imutável — certa para um sistema financeiro web3-ready.

### Principais Riscos de Arquitetura

1. **routes.ts tem 5.873 linhas** — maior risco de regressão e o principal bloqueador para escalar o time.
2. **Dois modelos de dados paralelos sem unificação clara** — `vaults/trades/positions` (sandbox) e `riotAssets/riotTrades/riotPositions` (real) coexistem. O `storage.ts` serve apenas o modelo legado.
3. **Sintéticos misturados ao core** — bots vivem na tabela `users` com `isBot=true`. Seed de players fictícios em `seed.ts` usa as mesmas tabelas que players reais.
4. **Riot acoplado diretamente ao core de mercado** — `market-maker.ts`, `tradeExecutor.ts` e `routes.ts` importam diretamente de `riot-sync`, `riot-perf` e `riotAssets`.
5. **shared/schema.ts com 973 linhas** — todos os domínios em um único arquivo.
6. **shared/routes.ts desatualizado** — cobre apenas o modelo legado de vaults, divergindo das rotas reais da API.
7. **Arena acoplada ao Trade Executor** — `updateArenaOnTrade()` é chamada diretamente de dentro do `executeRiotTrade()`.
8. **Market-maker.ts mistura responsabilidades** — PAE (Performance Anchor), momentum decay, broadcasts SSE, e AMM sync no mesmo módulo.
9. **Nenhuma interface de PerformanceProvider** — `riot-sync.ts` e `riot-perf.ts` são chamados diretamente, impossibilitando mock ou substituição por outro provider.

---

## B. Classificação KEEP / REFACTOR / DEPRECATE / REBUILD LATER

### `server/`

| Arquivo / Pasta | Categoria | Justificativa |
|---|---|---|
| `server/index.ts` | **REFACTOR** | Boot limpo, mas inicializa muitos schedulers inline. Extrair startup orchestrator. |
| `server/routes.ts` | **REFACTOR** | 5.873 linhas — maior problema. Deve ser dividido em routers por domínio. |
| `server/storage.ts` | **DEPRECATE** | Serve apenas o modelo legado (`vaults`). Será absorvido pelos repos de domínio. |
| `server/db.ts` | **KEEP** | Conexão simples e correta com Drizzle. |
| `server/app-config.ts` | **KEEP** | Key-value store para configuração de runtime. Pequeno e funcional. |
| `server/arena.ts` | **REFACTOR** | Lógica de arena válida, mas acoplada via chamada direta do tradeExecutor. Deve expor evento/hook. |
| `server/market-maker.ts` | **REFACTOR** | PAE, momentum decay, AMM sync e broadcast SSE — responsabilidades demais. Separar em PAE Service e MarketTick Scheduler. |
| `server/market-quotes.ts` | **KEEP** | Utilitário pequeno de quotes. |
| `server/name-generator.ts` | **DEPRECATE** | Gerador de nomes sintéticos. Pertence ao domínio de simulação/sandbox, não ao core. |
| `server/riot-sync.ts` | **REFACTOR** | Lógica de integração Riot válida, mas deve ficar atrás de uma interface `PerformanceProvider`. |
| `server/riot-perf.ts` | **REFACTOR** | Idem — processamento de match data deve ser chamado via interface, não importado diretamente. |
| `server/static.ts` | **KEEP** | Serve estáticos em produção. Simples. |
| `server/vite.ts` | **KEEP** | Setup de dev com Vite middleware. Funcional. |
| `server/market-core/asset-registry.ts` | **KEEP** | Abstração de registro canônico de ativos. Base do modelo multi-provider. |
| `server/market-core/sync.ts` | **KEEP** | Sync canônico multi-provider. Mantenível. |
| `server/market-core/startup-seed.ts` | **REFACTOR** | Lógica válida, mas não deve rodar seed de sandbox durante boot de produção. |
| `server/market-core/backfill-trading-assets.ts` | **DEPRECATE** | Script de migração única. Deve sair do boot e virar script avulso. |
| `server/providers/riot.ts` | **KEEP** | Provider adapter correto. Serve de base para o pattern. |
| `server/providers/types.ts` | **KEEP** | Interface ProviderAdapter bem definida. Expandir. |
| `server/services/ammPricing.ts` | **KEEP** | Matemática do AMM encapsulada, bem isolada. |
| `server/services/performanceEngine.ts` | **KEEP** | Core da engine de performance. Bem documentado e configurável. |
| `server/services/pviEngine.ts` | **KEEP** | PVI + Fair Value. Código limpo com config centralizada. |
| `server/services/valuationJob.ts` | **KEEP** | Job de valuation bem estruturado. |
| `server/services/tradeExecutor.ts` | **REFACTOR** | Lógica correta, mas chama arena e broadcast diretamente — acoplamento indevido. |
| `server/services/marketSignals.ts` | **KEEP** | Signals de mercado para o terminal. Modular. |
| `server/services/newsService.ts` | **KEEP** | RSS + sentiment. Independente. |
| `server/services/botTrader.ts` | **REFACTOR** | Simulação válida, mas bots vivem na tabela `users` — deve ser isolado no domínio de simulação. |
| `server/services/arenaBootstrap.ts` | **REFACTOR** | Bootstrap e diagnóstico em um arquivo. Separar. |
| `server/services/achievementsService.ts` | **KEEP** | Catálogo e progresso de achievements. Coeso. |
| `server/services/seasonsService.ts` | **KEEP** | Seasons + challenges + rewards. Bem estruturado. |
| `server/services/duelService.ts` | **KEEP** | Social — duels. Independente. |
| `server/services/followService.ts` | **KEEP** | Social — follows. Independente. |
| `server/services/triggerEngine.ts` | **REFACTOR** | Trigger orders funcionam, mas usam `assetId: text` (inconsistente com o FK integer do schema). |
| `server/services/baselineUpdateJob.ts` | **KEEP** | Job de atualização de baselines de role. Isolado. |
| `server/scheduler/market-sync-scheduler.ts` | **REFACTOR** | Bom padrão, mas deve centralizar todos os schedulers em um único lugar. |
| `server/sse/terminalBroadcaster.ts` | **KEEP** | SSE bem encapsulado. |
| `server/ws/market-hub.ts` | **KEEP** | Hub de WebSocket clean com pub/sub. |
| `server/ws/market-ws.ts` | **KEEP** | Attachment do WS ao HTTP server. |
| `server/modules/draft/` | **KEEP** | Módulo mais bem estruturado da base. Template para os outros. |
| `server/replit_integrations/auth/` | **KEEP** | Auth via Replit OIDC + local auth. Funciona corretamente. |
| `server/scripts/resetUserPassword.ts` | **KEEP** | Script operacional. |

### `shared/`

| Arquivo / Pasta | Categoria | Justificativa |
|---|---|---|
| `shared/schema.ts` | **REFACTOR** | 973 linhas com todos os domínios misturados. Dividir em `shared/schema/*.ts` por domínio. |
| `shared/models/auth.ts` | **KEEP** | Já separado corretamente. |
| `shared/routes.ts` | **REFACTOR** | Cobre apenas o modelo legado de vaults. Desatualizado em relação à API real. |
| `shared/arena-config.ts` | **KEEP** | Configuração compartilhada de arena. |
| `shared/market-quotes.ts` | **KEEP** | Cálculo de quotes compartilhado. |

### `client/`

| Arquivo / Pasta | Categoria | Justificativa |
|---|---|---|
| `client/src/App.tsx` | **REFACTOR** | Rotas organizadas, mas algumas condições de auth inline. |
| `client/src/pages/terminal.tsx` | **KEEP** | Terminal é core do produto. |
| `client/src/pages/asset-detail.tsx` | **KEEP** | Detail view de ativo real. |
| `client/src/pages/assets.tsx` | **KEEP** | Explorador de ativos. |
| `client/src/pages/vault-detail.tsx` | **DEPRECATE** | Vault = modelo sintético legado. |
| `client/src/pages/player.tsx` | **REFACTOR** | Ambiguidade player real vs sintético. |
| `client/src/pages/arena*.tsx` | **KEEP** | Suite de arena completa. |
| `client/src/pages/admin/market-lab.tsx` | **KEEP** | Ferramenta de simulação admin valiosa. |
| `client/src/pages/leaderboard.tsx` | **REFACTOR** | Duplicação com arena-leaderboards. Verificar. |
| `client/src/components/ui/` | **KEEP** | shadcn/ui — não tocar. |
| `client/src/hooks/use-auth.ts` | **KEEP** | Hook de auth limpo. |
| `client/src/lib/queryClient.ts` | **KEEP** | Config de TanStack Query. |
| `client/src/state/terminalStore.ts` | **KEEP** | State do terminal. |

### Raiz do projeto

| Arquivo | Categoria | Justificativa |
|---|---|---|
| `seed.ts` | **DEPRECATE** | Seeder de players sintéticos. Deve ir para `server/simulation/seed.ts` ou virar script avulso de dev. |
| `drizzle.config.ts` | **KEEP** | Config do ORM. |
| `vite.config.ts` | **KEEP** | Config do bundler. |
| `script/build.ts` | **KEEP** | Build script funcional. |

---

## C. Principais Problemas Encontrados

### 1. Monólito em `routes.ts` (5.873 linhas)
Um único arquivo registra todas as rotas: vaults, portfolio, trades, admin, arena, leaderboard, riot sync, market lab, AMM, triggers, news, performance scores, bot control, valuation, duels, follows, access requests, reset de senha, broadcast SSE — tudo inline. Qualquer mudança neste arquivo é um risco de regressão. Impossível para múltiplos desenvolvedores trabalharem em paralelo.

### 2. Schema monolítico (`shared/schema.ts`)
Todos os domínios — Auth, Market, Arena, AMM, Performance, Valuation, Simulation, Treasury — num único arquivo de 973 linhas. Cada domínio que for extraído para pasta própria precisará de um arquivo de schema correspondente.

### 3. Dois modelos de dados paralelos, não unificados
- **Modelo legado:** `vaults` + `trades` + `positions` + `watchlist` — players sintéticos, storage.ts
- **Modelo real:** `assets` + `riotAssets` + `riotTrades` + `riotPositions` + `assetWatchlist` — players reais, tradeExecutor.ts

Ambos referenciam `portfolios` do usuário, mas via sistemas diferentes. O storage.ts ainda serve as páginas de frontend que referenciam `vaultId`. A unificação via canonical market (`markets`/`assets`) existe no banco mas não está completa no código de produto.

### 4. Simulação misturada ao core
- Bots vivem na tabela `users` com `isBot=true` — mesma tabela de usuários reais.
- `seed.ts` na raiz cria players fictícios usando as mesmas tabelas que players reais.
- `name-generator.ts` fica em `server/` ao lado de código de produção.
- `generateDummyPlayers()` está inline dentro de `routes.ts`.

### 5. Riot acoplado diretamente ao core
`market-maker.ts`, `tradeExecutor.ts` e `routes.ts` importam `riotAssets` diretamente — o que significa que trocar o provider de dados de performance (ex: outro jogo, outra API) exige mudança no core de mercado. O padrão de provider adapter foi iniciado (`server/providers/`) mas não foi adotado pelo market-maker.

### 6. Arena acoplada via chamada direta
`updateArenaOnTrade()` é chamada dentro de `executeRiotTrade()`. Isso significa que um erro de arena pode afetar a execução de trade, e as responsabilidades de mercado + gamificação estão acopladas. Deveria ser desacoplado via evento ou callback assíncrono.

### 7. `shared/routes.ts` divergiu da API real
O arquivo de rotas tipadas (`shared/routes.ts`) cobre apenas vaults, portfolio, trade e watchlist legados — nenhuma das rotas reais de assets, leaderboard, arena, draft etc. está tipada ali. Isso elimina o benefício de type-safety end-to-end.

### 8. Trigger Orders com tipo de dado inconsistente
`triggerOrders.assetId` é declarado como `text` no schema, enquanto em toda a base o padrão de `assetId` é `integer` referenciando `assets.id`. Ambiguidade / revisar depois.

### 9. `market-maker.ts` acumula responsabilidades demais
Performance Anchor Engine (PAE), momentum decay, AMM supply sync, broadcast SSE e controle de pausa — num único módulo de scheduler. Cada uma dessas responsabilidades pertence a um serviço separado.

### 10. Sem separação entre dev/prod para seed de sandbox
`runStartupSeed()` é chamada em todo startup de produção e inclui criação do mercado sandbox e linkagem de vaults sintéticos. Seed de sandbox não deveria ser executado em ambiente de produção com dados reais.

---

## D. Proposta de Arquitetura-Alvo

```
server/
  domains/
    identity/           ← auth, sessions, access-requests, password-reset
      routes.ts
      service.ts
      storage.ts
    player/             ← registry de players reais (riotPlayers, riotAssets)
      routes.ts
      service.ts
      storage.ts
    performance/        ← performance engine, match metrics, baselines
      routes.ts
      engine.ts         ← performanceEngine.ts atual
      pvi.ts            ← pviEngine.ts atual
      valuation.ts      ← valuationJob.ts atual
      baseline-job.ts
    market/             ← AMM, trade execution, market state, quotes, triggers
      routes.ts
      trade-executor.ts
      amm-pricing.ts
      market-maker.ts   ← apenas tick scheduler
      pae.ts            ← Performance Anchor Engine extraído
      trigger-engine.ts
      market-signals.ts
    portfolio/          ← portfolios, positions, ledger
      routes.ts
      service.ts
      storage.ts
    discovery/          ← assets explorer, watchlist, leaderboard público
      routes.ts
      service.ts
    arena/              ← gamification: XP, ranks, achievements, seasons, duels, follows, draft
      routes.ts
      arena-core.ts     ← arena.ts atual
      achievements.ts
      seasons.ts
      duels.ts
      follows.ts
      draft/            ← modules/draft atual → move aqui
    treasury/           ← fee ledger, player fee balance, revenue
      service.ts
      storage.ts
    news/               ← newsService.ts atual
      routes.ts
      service.ts
    admin/              ← todas as rotas /api/admin/*
      routes.ts
      bootstrap.ts
      market-lab.ts

  integrations/
    riot/               ← riot-sync.ts, riot-perf.ts, providers/riot.ts
      sync.ts
      perf.ts
      provider.ts
    interfaces/
      performance-provider.ts   ← interface ProviderAdapter expandida

  simulation/           ← bots, seed de sandbox, name-generator
    bot-trader.ts
    name-generator.ts
    sandbox-seed.ts     ← seed.ts movido aqui

  market-core/          ← asset-registry, sync canônico (já organizado — manter)
    asset-registry.ts
    sync.ts
    startup-seed.ts     ← apenas dados de produção

  realtime/             ← SSE + WebSocket
    sse/
      terminal-broadcaster.ts
    ws/
      market-hub.ts
      market-ws.ts

  scheduler/            ← todos os schedulers centralizados
    index.ts            ← orquestra todos
    market-sync.ts
    valuation.ts
    news.ts
    duel-resolver.ts

  db.ts
  app-config.ts
  index.ts              ← apenas boot + scheduler init

shared/
  schema/
    auth.ts             ← já existe em models/auth.ts
    market.ts           ← vaults, assets, markets, amm, triggers
    performance.ts      ← riotAssets, matchMetrics, scores, baselines
    portfolio.ts        ← portfolios, positions, trades, ledger
    arena.ts            ← arena, achievements, seasons, duels, follows
    simulation.ts       ← botProfiles
    draft.ts            ← já existe em modules/draft/draft.schema.ts
  routes/
    market.ts
    arena.ts
    ...
  arena-config.ts
  market-quotes.ts

web3-adapters/          ← futuro, não entra agora
  wallet/
  treasury/
  on-chain/
```

---

## E. Plano de Execução em Fases

### Fase 1 — Classificar e Preparar (agora)
- [x] Auditoria arquitetural completa (este documento)
- [ ] Criar inventário de módulos (`module-inventory.md`)
- [ ] Criar mapa de domínios (`target-domain-map.md`)
- [ ] Identificar dependências circulares entre serviços

### Fase 2 — Modularizar Rotas e Schema
- Dividir `shared/schema.ts` em arquivos por domínio (sem breaking change — re-exportar tudo de `schema/index.ts`)
- Dividir `server/routes.ts` em routers por domínio, montados no `registerRoutes()`
- Criar pasta `server/domains/` com estrutura alvo
- Cada domínio começa com seu próprio `routes.ts` extraído do monólito
- **Zero breaking changes** — apenas reorganização de imports

### Fase 3 — Abstrair PerformanceProvider
- Definir interface `PerformanceProvider` em `server/integrations/interfaces/`
- Wrapper Riot implementa essa interface
- `market-maker.ts` e `tradeExecutor.ts` passam a usar a interface, não o módulo Riot diretamente
- Isso desbloqueia suporte a múltiplos jogos (Valorant, etc.)

### Fase 4 — Separar Simulation do Core
- Criar pasta `server/simulation/`
- Mover `botTrader.ts`, `name-generator.ts`, `seed.ts` para lá
- Criar tabela separada `simulation_users` ou prefixo isolado para bots
- Garantir que bots não coexistem com usuários reais nas mesmas queries de produto
- Remover `generateDummyPlayers()` de `routes.ts`

### Fase 5 — Preparar Interfaces Web3-Ready
- Criar `server/web3-adapters/` como pasta vazia com INTERFACES apenas (sem implementação)
- Definir eventos de domínio (ex: `TradeExecuted`, `FeeCaptured`) que web3 adapters poderiam consumir
- Garantir que `ledgerEntries` e `feeLedger` são a fonte de verdade (já estão)
- Criar interface `TreasuryAdapter` para futura integração on-chain
- Documentar pontos de extensão sem implementar nada

---

*Este documento é de auditoria — nenhum arquivo foi modificado.*

# GamerStock — Arquitetura Alvo

> **Versão:** Fase 1 (2026-04-06)
> **Status:** Documento oficial de arquitetura — sem modificações no código.
> **Propósito:** Estabelecer clareza arquitetural, nomear fontes de verdade e formalizar as três timelines do produto.

---

## 1. Visão Geral

A GamerStock é uma plataforma híbrida de **mercado de predição esportiva** e **creator economy** para esports.

A premissa central do sistema é:

> **performance gera valor · mercado gera preço**

Isso não é só uma afirmação filosófica — é a regra que determina a separação arquitetural entre os módulos de Valuation e Market. Nenhum módulo deve cruzar essa fronteira sem justificativa explícita.

---

## 2. Módulos Principais

| Módulo | Status | Responsabilidade Central |
|---|---|---|
| Identity & Access | OFFICIAL | Autenticação, sessões, papéis, controle de acesso |
| Asset Registry | OFFICIAL | Registro canônico multi-provider (Riot, Steam, Dota2) de assets do mercado |
| Performance Ingestion | OFFICIAL | Coleta de dados esportivos dos providers (Riot API, OpenDota, Steam/PandaScore) |
| Performance History | OFFICIAL (formalizar) | Série temporal de performance esportiva por jogador/asset |
| Valuation Engine | OFFICIAL | Algoritmo que interpreta performance → valor (EMA, PVI, confiança) |
| Market Engine | OFFICIAL | AMM, PAE, momentum, bid/ask, market-maker tick |
| Trading & Settlement | OFFICIAL | Execução de ordens, liquidação de trades, histórico de transações |
| Wallet & Ledger | OFFICIAL | Saldos, locks, crédito/débito, fee ledger |
| Market Integrity & Operations | OPS_ONLY | Reconciler, invariants, admin panel, system-health |
| Platform Runtime | OPS_ONLY | Boot, schedulers, seed, migrations, simulador |
| Arena & Gamification | OFFICIAL | Temporadas, badges, rankings, duelos, leaderboards |
| Discovery & Feed | OFFICIAL | Busca de assets, trending, candidatos, news feed |
| Prediction Market | OFFICIAL | Mercado de predições, posições, auto-lock, settlement |
| Simulation Layer | EXPERIMENTAL | Bot trader, market sintético, sintetic match (CS2) |
| Web3 Adapter | EXPERIMENTAL | Bridge para futuro — não ativo em produção |
| Draft Module | EXPERIMENTAL | Funcionalidade de draft esportivo — em desenvolvimento |

---

## 3. Fontes de Verdade

### Asset Truth

> Qual é o identificador canônico de um asset?

- **Tabela:** `assets` (campo `asset_uid`)
- **Arquivo:** `shared/schema/player.ts`
- **Formato:** `{game}:{game}:player:{externalId}` (ex: `dota2:dota2:player:126842529`)
- **Registro:** `server/market-core/asset-registry.ts`

### Performance Truth

> Qual é a performance mais recente de um jogador?

- **Tabelas:**
  - `player_match_source_data` — dados brutos de matches
  - `player_match_analytics` — métricas derivadas por match
  - `dota2_performance_scores` — score final de performance por match
  - `cs2_stats_snapshot` — snapshot de estatísticas de carreira CS2
- **Schema:** `shared/schema/multigame.ts`
- **Providers:** OpenDota (Dota2), Steam Web API (CS2), Riot API (LoL)

### Value Truth

> Qual é o valor calculado de um asset?

- **Tabela principal:** `dota2_valuation_state` (usada para Dota2 e CS2)
  - Campo `player_value` — valor atual calculado pelo algoritmo
  - Campo `confidence_score` — confiança na estimativa
- **Tabela de histórico:** `dota2_value_history` — append-only, audit trail de cada mudança de valor
- **Schema:** `shared/schema/multigame.ts`
- **Engine:** `server/domains/multigame/dota2ValuationService.ts`, `cs2ValuationService.ts`

### Market Truth

> Qual é o preço de mercado de um asset?

- **Tabela principal:** `assets`
  - Campo `last_trade_price` — último preço negociado (truth de preço)
  - Campo `fundamental_price` — âncora fundamental derivada do value (updated pelo PAE)
  - Campo `price_24h_ago`, `volume_24h`, `momentum`
- **Market maker:** `server/market-maker.ts` — PAE tick a cada 60s
- **AMM:** `server/services/ammPricing.ts`

### Financial Truth

> Qual é o saldo real de um usuário?

- **Tabela:** `wallets` (campos `available_balance`, `locked_balance`)
- **Ledger:** `fee_ledger`, `player_fee_balance`
- **Schema:** `shared/schema/wallet.ts`
- **Endpoint correto:** `GET /api/wallets/me`
- **Atenção:** `portfolios.balance` é legado — NÃO usar como fonte de saldo.

### Provider Truth

> Qual é a configuração e disponibilidade dos providers externos?

- **Tabela:** `market_sync_status` — last sync, erro, status por provider
- **Config:** `server/app-config.ts` — runtime key-value
- **Secrets:** `RIOT_API_KEY`, `STEAM_WEB_API_KEY`, `PANDASCORE_API_KEY`

---

## 4. As Três Timelines do Produto

A GamerStock possui **três séries temporais distintas** que devem ser tratadas como módulos independentes:

```
Performance History  →  Value History  →  Price History
     (esportiva)          (algorítmica)      (mercado)
```

### 4.1 Performance History

- **O que é:** A série temporal de performance esportiva de um jogador
- **Fontes:** matches OpenDota, snapshots Steam, partidas Riot
- **Tabelas:** `player_match_source_data`, `dota2_performance_scores`, `cs2_stats_snapshot`
- **Status atual:** Existente, mas não exposta como módulo público canônico
- **Requisito arquitetural:** Deve evoluir para endpoint público de leitura por asset (`GET /api/assets/:id/performance-history`)

### 4.2 Value History

- **O que é:** Como o algoritmo interpretou a performance ao longo do tempo
- **Fontes:** Cada evento de re-valuation produz uma linha em `dota2_value_history`
- **Tabelas:** `dota2_value_history` (append-only, audit trail)
- **Event types:** `BOOTSTRAP`, `MATCH_UPDATE`, `RECALC`, `SYNTHETIC_MATCH`, `MANUAL_ADJUSTMENT`
- **Status atual:** Persistido, exposto parcialmente no admin

### 4.3 Price History

- **O que é:** Como o mercado respondeu ao longo do tempo
- **Fontes:** Trades, PAE ticks, AMM moves
- **Tabelas:** `trades`, `asset_market_state` (snapshots de 24h), `asset_valuation_state`
- **Status atual:** Exposto via `GET /api/market/assets` e gráficos de preço na UI

### Implicação Arquitetural

> A UI pública deve evoluir para suportar as três leituras de forma separada.
> Um usuário deve conseguir ver: "o jogador melhorou tecnicamente (performance) → o valor calculado subiu (value) → mas o mercado ainda não precificou (price)".
> Hoje apenas a price history está totalmente visível. As duas anteriores devem ser formalizadas.

---

## 5. Classificação dos Módulos

| Label | Significado |
|---|---|
| `OFFICIAL` | Módulo ativo em produção, com regras de mercado críticas. Mudanças requerem revisão. |
| `LEGACY_FROZEN` | Funciona, não quebrar, mas não investir. Candidato a substituição futura. |
| `EXPERIMENTAL` | Em desenvolvimento ou não confiável para prod. Pode ser removido. |
| `OPS_ONLY` | Ferramentas administrativas e operacionais. Não afeta regras de mercado. |

### Módulos por Classificação

**OFFICIAL:**
- `server/domains/identity/` — autenticação e acesso
- `server/domains/multigame/` — valuation engine Dota2/CS2
- `server/domains/market/` — engine de mercado
- `server/domains/trading/` — execução de trades
- `server/domains/trade-settlement/` — liquidação
- `server/domains/wallet/` — saldos e ledger
- `server/domains/prediction/` — mercado de predições
- `server/domains/arena/` — gamification e temporadas
- `server/market-maker.ts` — PAE e market simulator
- `server/services/ammPricing.ts` — AMM
- `server/market-core/` — asset registry canônico

**LEGACY_FROZEN:**
- `server/storage.ts` — repositório monolítico legado (substituir por repos de domínio)
- `server/routes.ts` — router monolítico (migrar para routers por domínio)
- `server/riot-sync.ts` — sync Riot acoplado diretamente (migrar para interface PerformanceProvider)
- `server/riot-perf.ts` — idem
- `shared/schema/valuation.ts` — schema de valuation Riot legado
- `server/services/valuationJob.ts` — valuation Riot legado (PVI para LoL — não afeta Dota2/CS2)

**EXPERIMENTAL:**
- `server/simulation/` — bot trader, synthetic market
- `server/web3/` — bridge Web3 (não ativo em prod)
- `server/modules/draft/` — sistema de draft esportivo
- `server/domains/synthetic/` — mercado sintético CS2

**OPS_ONLY:**
- `server/domains/admin/` — painel administrativo
- `server/domains/terminal/reconciler.ts` — reconciler de invariants
- `server/migrations/` — scripts de migração pontuais
- `server/scripts/` — scripts avulsos operacionais

---

## 6. Fluxos Críticos

### Fluxo de Valuation (Dota2/CS2 — Fase 2)

```
Provider API (OpenDota / Steam)
  ↓
syncDota2Matches / syncCs2Stats
  ↓
player_match_source_data / cs2_stats_snapshot
  ↓
updateDota2Valuation / updateBulkDota2ValuationFromProvider
  ↓
dota2_valuation_state.player_value   (Value Truth)
dota2_value_history                  (Value Audit Trail)
  ↓
assets.fundamental_price             (PAE update)
  ↓
PAE tick (market-maker.ts)
  ↓
assets.last_trade_price              (Market Truth)
```

### Fluxo de Trade

```
Usuário faz ordem
  ↓
server/domains/orders/ — validação e criação
  ↓
server/domains/trading/ — execução AMM
  ↓
trades insert
  ↓
wallets.available_balance update
  ↓
fee_ledger entry
  ↓
SSE broadcast (market-hub.ts)
```

### Fluxo de Reconciliação

```
startTerminalReconciler (a cada 5 min)
  ↓
invariants.ts — INV_5 (baseline price), INV_6 (freshness)
  ↓
Se violação detectada: quarantine / reprocess
  ↓
LOG estruturado
```

---

## 7. Dependências Externas

| Provider | API | Disponibilidade | Impacto de Falha |
|---|---|---|---|
| Riot API | `/lol/league/v4/` | Requer RIOT_API_KEY | LoL assets sem sync de performance |
| OpenDota | `/api/players/{id}/wl` | Pública (rate limited) | Dota2 bulk valuation degradada |
| Steam Web API | `/ISteamUserStats/` | Requer STEAM_WEB_API_KEY | CS2 user-linked sem sync |
| PandaScore | `/csgo/players/` | Requer PANDASCORE_API_KEY (401 atual) | CS2 bulk: PROVIDER_UNAVAILABLE |

---

## 8. Decisões Arquiteturais Registradas

| ADR | Decisão | Motivo |
|---|---|---|
| ADR-001 | `dota2_valuation_state` serve Dota2 e CS2 | Evitar refactor prematuro de schema |
| ADR-002 | `last_trade_price` nunca é setado diretamente pelo scheduler | PAE é o único responsável pelo preço de mercado |
| ADR-003 | `wallets.available_balance` é a fonte de saldo | `portfolios.balance` é legado e não deve ser usado |
| ADR-004 | Scheduler tem warmup de 5 min | Não competir com startup seed |
| ADR-005 | CS2 bulk usa PROVIDER_UNAVAILABLE quando PandaScore retorna 401 | Fallback explícito, nunca silencioso |

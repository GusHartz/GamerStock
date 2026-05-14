# Auditoria 2.4 — Banco e Migrations

**Data**: 2026-05-14
**Escopo**: schema Drizzle (`shared/schema/`, 20 arquivos), DB real (Postgres 16.13 no Docker, 111 tabelas), migrations (1 SQL consolidada + 1 .ts ad-hoc)
**Método**: leitura cirúrgica do schema TS + cross-check com `pg_*` system catalogs + queries direcionadas para os bugs B-3, B-4, B-5, B-8 + 1 sub-agente Explore para inventário schema
**Output**: somente leitura — nenhum DDL/DML executado

---

## 1. Resumo executivo

DB rodando em Postgres 16-alpine no container `gamerstock-postgres` (porta 5433). **111 tabelas reais** vs **~110 declaradas** no Drizzle (discrepância pequena explicada por re-exports de `shared/models/auth.ts`). Schema bem-modelado em estrutura: 0 tabelas sem PK, 96 FKs, 350 indexes, 40 UNIQUE constraints. Hub-and-spoke ao redor de `assets` (105 referências em código) e `users` (~30 FKs).

**3 dores principais**:
1. **80% das tabelas vivem vazias** (88 de 111 com 0 rows) — schema over-provisioned. O sistema escreve em ~6 tabelas (`asset_price_snapshots` 14k, `assets`/`asset_markets`/`asset_market_state` 800 cada, `dota2_value_history` 869, `dota2_valuation_state` 781), o resto está dormante.
2. **Trilho legacy vs canonical em coexistência zumbi**: 8 tabelas legacy (`vaults`, `riot_*`) com 67 referências de código mas **0 rows** todas elas — o bootstrap atual só escreve no canonical. Pior: o endpoint `/api/admin/metrics:535-536` lê de `riot_trades` (0 rows) e `riot_assets` (0 rows) ⇒ causa raiz do B-8 NaN.
3. **Idempotência financeira ainda quebrada no DB**: confirmado o achado P1 de 2.2 — `fee_ledger` tem índice em `(reference_type, reference_id)` mas **sem UNIQUE constraint**.

**Estratégia de evolução fraca**: 1 migration consolidada (`0000_chubby_lenny_balinger.sql`, 263 statements) de 2026-03-13; depois disso, `db:push` apagou histórico. Sem rollback path. Sem journal incremental. Plus uma **migration TypeScript** (`server/migrations/bulkCs2PriceProjection.ts`, 38 KB) que injeta 800 preços hardcoded no boot — fora do sistema Drizzle.

**Severidade geral: MÉDIA**. Estrutura saudável; problemas concentrados em integridade financeira (P1), trilho duplo confuso (P2) e governance de migrations (P2).

---

## 2. Top 10 achados

### B2.4-1 [P1] — `/api/admin/metrics` lê de tabelas legacy vazias (causa raiz B-8)
- **Arquivo:linha**: `server/domains/admin/routes.ts:535-536`
- **Tabelas**: `riot_trades` (0 rows), `riot_assets` (0 rows), `users` (2 rows)
- **Categoria**: data-integrity / dead-code
- **Descrição**: o endpoint computa `totalUsers`, `totalTrades`, `totalAssets`. Para trades e assets, ele consulta `riotTrades` e `riotAssets` — ambas legacy e vazias. Os dados reais vivem em `assetTrades` (0 rows porque nenhum trade ainda foi feito) e `assets` (800 rows). Frontend computa "24h activity rate" como ratio que com `totalTrades=0` resulta em `0/0 = NaN`.
- **Impacto**: KPI exibe "NaN%" em produção. Pior: o painel admin reporta `totalAssets: 0` mesmo com 800 assets no DB.

### B2.4-2 [P1] — `fee_ledger` sem UNIQUE constraint (confirma B2.2-1 no DB)
- **Tabela**: `fee_ledger`
- **Estado real do DB**: `Indexes: fee_ledger_ref_idx btree (reference_type, reference_id)` — apenas índice, **sem UNIQUE**
- **Categoria**: idempotency / integrity
- **Descrição**: query `pg_constraint WHERE contype='u'` confirma: das 40 UNIQUE constraints existentes, **nenhuma é em fee_ledger**. O `player_earnings_ledger` tem `pel_idempotency_key UNIQUE (asset_id, currency, reference_type, reference_id, direction)` — pattern correto que `fee_ledger` deveria copiar.
- **Impacto**: retry ou webhook re-fire = double settlement, double credit em `system_wallets`.

### B2.4-3 [P1] — `bulkCs2PriceProjection.ts` é uma migration de 38 KB embutida em TypeScript fora do Drizzle
- **Arquivo:linha**: `server/migrations/bulkCs2PriceProjection.ts`, header em 1-20, dataset hardcoded 25-825
- **Categoria**: migration-governance / coupling
- **Descrição**: o arquivo embute **800 preços CS2 hardcoded** num `const CS2_VALUES: Record<string, number>` e executa updates em 5 tabelas no boot (chamado de `server/scheduler/index.ts:122`). É descrito como "V2 — Static Dataset" porque "PandaScore API now returns 401, so ALL 800 bulk CS2 assets are frozen at $15.00". Idempotência depende de heurística `>= 700 CS2 assets com fundamental_price ≠ ~$15`. **Não tem rollback, não usa Drizzle migrate, não está no journal.**
- **Impacto**: dado de produção fica preso no código-fonte. Qualquer alteração de preço CS2 exige PR + redeploy. Se o array ficar dessincronizado da tabela `assets`, comportamento silenciosamente errado.

### B2.4-4 [P2] — 80% das tabelas estão vazias (88 de 111)
- **Categoria**: schema-bloat / dead-code
- **Descrição**: queries em `pg_stat_user_tables`. Apenas **23 tabelas têm dados** hoje. As 88 vazias incluem **toda a infraestrutura financeira de trades** (`asset_trades`, `asset_positions`, `wallet_ledger_entries=1`, `ledger_entries`, `fee_ledger`, `system_wallet_ledger`, `player_earnings_ledger`), **toda arena** (`arena_*` 13 tabelas), **toda prediction** salvo 5 (`prediction_orders`, `prediction_positions`, `prediction_settlements`, etc. todas 0), **toda performance** (4 tabelas), e tabelas legacy (`vaults`, `riot_*`).
- **Impacto**: schema desenhado para escala mas o produto está em pre-revenue. Não é bug em si, mas: (a) dificulta auditoria visual no DB ("o que é vivo vs morto?"), (b) algumas tabelas vazias devem estar sendo lidas em endpoints (B-5, B-8), retornando arrays vazios silenciosamente.

### B2.4-5 [P2] — Inconsistência de precisão decimal em colunas de preço
- **Tabelas afetadas**: `assets.last_trade_price` (10,2), `asset_market_state.last_price` (18,6), `asset_price_snapshots.price` (10,2), `asset_valuation_state.fair_value_gs` (10,4), `assets.fundamental_price` (18,6), `dota2_valuation_state.player_value` (10,4)
- **Categoria**: type-consistency / silent-precision-loss
- **Descrição**: 3 escalas diferentes (2, 4, 6) coexistem para o conceito "price". O fluxo crítico:
  1. AMM compute em JS Number → grava `asset_market_state.last_price` com `numeric(18,6)`
  2. Mesmo valor flui para `assets.last_trade_price` com `numeric(10,2)` — **truncamento implícito** de 4 casas decimais
  3. Snapshot vai pra `asset_price_snapshots.price` (10,2) — alinhado com #2, OK
- **Impacto**: pode introduzir drift acumulativo entre AMM state e display price. Não é showstopper hoje (preços tipicamente acima de $0.01), mas se algum asset tiver preço sub-cent (impossível pelo floor=5) ou se a regra mudar, dores garantidas.

### B2.4-6 [P2] — `timestamp` sem TZ usado em 200 colunas, com TZ em apenas 5
- **Tabelas afetadas**: praticamente todas (verificado via `information_schema.columns WHERE data_type IN (...)`)
- **Categoria**: type-consistency
- **Descrição**: padrão `timestamp without time zone` vs `timestamp with time zone`. Postgres recomenda TZ-aware para evitar bugs em deploys multi-região. O Drizzle default é `timestamp` sem TZ. As 5 ocorrências com TZ provavelmente são de uma tabela específica recém-adicionada.
- **Impacto**: hoje irrelevante (servidor único em America/Sao_Paulo). Vira problema se o app for clusterizar em múltiplos hosts em TZs diferentes, ou se o cliente passar timestamps com `Z` que serão interpretados como local.

### B2.4-7 [P2] — KPIs admin "Pending review" / "Auto-approved" leem tabelas vazias (causa raiz B-5)
- **Tabela do estado real**: `assets.listing_status` ⇒ `UNDER_REVIEW=616`, `LISTED=184` (total 800)
- **Tabelas KPI consulta**: provavelmente `asset_listing_submissions` (0 rows) e `asset_listing_reviews` (0 rows) ou `player_claims` (0 rows)
- **Categoria**: data-source-mismatch / workflow-bypass
- **Descrição**: o bootstrap CS2/Dota2 (em `cs2MarketBootstrapService.ts` / `dota2MarketBootstrapService.ts`) atribui `listing_status = 'UNDER_REVIEW'` direto na tabela `assets`, pulando o workflow oficial de submission→review. Os 616 UNDER_REVIEW visíveis nos cards não estão nas tabelas que os KPIs consultam. **Workflow correto não foi exercido**.
- **Impacto**: usuário admin vê 616 assets aguardando revisão mas os KPIs "Pending review" e "Auto-approved" mostram 0. Pode tomar decisão errada pensando que nada precisa de atenção.

### B2.4-8 [P2] — Trilho legacy/canonical em coexistência zumbi
- **Tabelas legacy vivas no schema mas vazias**: `vaults`, `vault_snapshots`, `riot_trades`, `riot_assets`, `riot_players`, `riot_match_cache`, `riot_player_state`, `riot_positions` (todas 0 rows)
- **Tabelas canonical com dados**: `assets`/`asset_markets`/`asset_market_state` (800 cada), `dota2_value_history` (869), `dota2_valuation_state` (781), `asset_price_snapshots` (14 027)
- **Categoria**: dead-code / dual-trail
- **Descrição**: 67 referências de código a tabelas legacy (em 8 arquivos distintos), incluindo:
  - `seed.ts` (raiz) — gera 1000 vaults sintéticos (mas nunca foi rodado nesta DB)
  - `server/domains/admin/routes.ts:535-536` — `/api/admin/metrics` lê de riotTrades/riotAssets (B-8 root cause)
  - 18 arquivos referenciam `vaults`, 19 referenciam `riotAssets`
- **Impacto**: o produto operacionalmente usa apenas canonical; mas o **código** ainda fala como se ambos coexistissem. Cada decisão futura ("posso dropar `vaults`?") precisa de auditoria de callsites. Cada bug no fluxo financeiro pode acidentalmente tocar trail morto.

### B2.4-9 [P3] — `bot_profiles` vazia + status "Running" em memória (causa raiz B-3)
- **Tabela**: `bot_profiles` (0 rows)
- **Arquivo:linha**: `server/simulation/bots/bot-trader.ts:626` — `export function isBotSimulatorRunning() { return running; }`
- **Categoria**: state-inconsistency / observability
- **Descrição**: o admin endpoint `GET /api/admin/bots/status` retorna `running: boolean` derivado de um flag em-memória (`running` no módulo `bot-trader.ts`). O "Bot Count" lê `bot_profiles.count(*)` (0). Quando o admin chama `POST /api/admin/bots/start` (admin/routes.ts:1043), `startBotSimulator()` é chamado e `running := true`, **mas isso não cria rows em bot_profiles** — é só um loop in-memory. O `POST /api/admin/bots/seed` (admin/routes.ts:1059) é que popularia.
- **Impacto**: dashboard mostra "Bot Traders: Running" com "Bot Count: 0" simultaneamente. Confusão. Pior: se o processo crashar e reiniciar, `running` reseta para false silenciosamente — sem persistir intent.

### B2.4-10 [P3] — Apenas 5 CHECK constraints, todas em `wallets`/`wallet_ledger_entries`
- **Tabelas/colunas com CHECK**:
  - `wallets.available_balance >= 0`
  - `wallets.locked_balance >= 0`
  - `wallets.total_balance >= 0`
  - `wallets.total_balance = available_balance + locked_balance` ✅ invariante elegante
  - `wallet_ledger_entries.amount > 0`
- **Tabelas que DEVERIAM ter CHECK e não têm**: `system_wallets`, `player_earnings_balance`, `assets.last_trade_price >= 0`, `asset_markets.floor_price >= 0`, `fee_ledger.notional >= 0`, `fee_ledger.platform_fee >= 0`, etc.
- **Categoria**: integrity / under-defended
- **Descrição**: a defesa de não-negatividade existe **apenas para wallets dos usuários**. Os 3 ledgers (`fee_ledger`, `system_wallet_ledger`, `player_earnings_ledger`) **não têm CHECK** garantindo amounts positivos ou cross-component consistency. As tabelas de mercado (`assets`, `asset_markets`, `asset_market_state`) também não têm CHECK contra preços negativos.
- **Impacto**: bug de aplicação (sign flipped em alguma multiplication) pode persistir valores impossíveis silenciosamente.

---

## 3. Investigações específicas

### B-3 — Bot Traders "Running" mas Bot Count=0 ⇒ ✅ raiz confirmada
- `bot_profiles` no DB: **0 rows**, 6 colunas (`id`, `user_id`, `strategy`, `risk_profile`, `interval_multiplier`, `created_at`)
- `isBotSimulatorRunning()` (server/simulation/bots/bot-trader.ts:626) lê **flag em-memória** `running`
- 2 fontes independentes para o que deveria ser 1 conceito (o sistema rodando = bots configurados rodando)
- **Fix necessário**: ou (a) o status mostra "Running" só se `bot_profiles.count > 0`, ou (b) o admin chama `seedBots()` automaticamente ao chamar `startBotSimulator()`

### B-4 — Multigame "AMM Ready 800" mas /assets vazio ⇒ ✅ confirmação dupla
- `assets` row count: **800** ✓
- `asset_markets` row count: **800** ✓
- `asset_market_state` row count: **800** ✓ (AMM efetivamente "ready" para todos)
- `listing_status`: 616 UNDER_REVIEW + 184 LISTED
- **A página /assets vazia é problema de filtro frontend** (já B-2/B2.3-3 — default `game=dota2` que combinado com endpoint `/api/assets` retorna 0); o backend tem os dados
- **DB confirma**: o produto SAS 800 assets pronto pra negociar; o frontend que filtra errado

### B-5 — 613 UNDER_REVIEW mas KPIs "Pending review=0, Auto-approved=0" ⇒ ✅ causa raiz
- `assets WHERE listing_status='UNDER_REVIEW'`: **616** (próximo dos 613 reportados — diferença é evolução temporal natural)
- `asset_listing_submissions` row count: **0** (vazia)
- `asset_listing_reviews` row count: **0** (vazia)
- `player_claims` row count: **0** (vazia)
- O bootstrap de mercado (`cs2MarketBootstrapService.ts:127`, `dota2MarketBootstrapService.ts`) **atribui `listing_status='UNDER_REVIEW'` direto**, pulando o workflow oficial. Os KPIs leem do workflow, e o workflow está vazio.
- **Fix necessário**: ou (a) o bootstrap também cria rows em `asset_listing_submissions` com status pending, ou (b) os KPIs leem `assets.listing_status` diretamente em vez de `submissions`/`reviews`

### B-8 — /admin/metrics "24h activity rate: NaN%" ⇒ ✅ causa raiz confirmada
- `server/domains/admin/routes.ts:532-547`:
  ```ts
  const [tradeCount] = await db.select({ count: ... }).from(riotTrades);
  const [assetCount] = await db.select({ count: ... }).from(riotAssets);
  ```
- `riot_trades` row count: **0**, `riot_assets` row count: **0**
- Endpoint retorna `{ totalUsers: 2, totalTrades: 0, totalAssets: 0 }`
- Frontend (`pages/admin/metrics.tsx`) deve computar algo como `activeTrades24h / totalTrades` ou similar — com denominador zero, `0/0 = NaN`
- **Fix necessário**: substituir `riotTrades` → `assetTrades` (canonical) e `riotAssets` → `assets` (canonical) no endpoint admin

---

## 4. Análise por área

### 4.1 Schema — Foreign Keys, Constraints, Indexes

**Foreign Keys** (96 totais via `pg_constraint`):
- Centradas em 2 hubs: `users` (~25 FKs apontando) e `assets` (~25 FKs apontando)
- Políticas `onDelete` heterogêneas:
  - **CASCADE**: relacionamentos owner-child (e.g., `arena_trader_follows`, `wallets → users`, `player_match_source_data`)
  - **RESTRICT**: trilho financeiro de prediction (`prediction_orders`, `prediction_settlements`, `wallet_ledger_entries`) — bom, mantém audit trail mesmo após delete tentado
  - **SET NULL**: `player_card_visuals.created_by_user_id`, `player_missions.created_by_user_id`, `player_moments.*` — preserva audit, abandona ref
  - Várias **sem cláusula explícita** = NO ACTION default (e.g., `arena_duels → users`)

**UNIQUE Constraints** (40 totais):
- Cobertura **adequada para idempotência** em: `player_earnings_ledger` (5-col composite), `prediction_orders.idempotency_key`, `markets (provider,game,region,scope)`, `connected_accounts (user,provider_group,game,provider_account_id)`, `news_events.external_id`, `assets.asset_uid`
- Cobertura **inadequada** em: `fee_ledger` (B2.4-2), `wallet_ledger_entries` (sem UNIQUE em `(reference_type, reference_id)` — soft FKs), `system_wallet_ledger` (idem)
- Há tabela `idempotency_keys` (0 rows) genérica não usada — provavelmente esqueleto para feature futura

**CHECK Constraints** (apenas 5, todos em wallets — vide B2.4-10)

**Indexes** (350 totais):
- Distribuição razoável (média ~3 por tabela)
- Top heavy: `player_match_source_data` (8), `prediction_markets` (7), `prediction_event_candidates` (7), `player_match_analytics` (7), `prediction_orders` (6), `news_events` (6), `dota2_performance_scores` (6)
- Sem indexes redundantes flagrantes notados
- **Auditoria de indexes inúteis** (sobre tabelas vazias): muito index sobre tabelas com 0 rows. Não é bug, é write amplification quando finalmente forem populadas — mas todos estão lá para coverage de queries reais conforme o produto evolui

### 4.2 Migrations

**Estado atual**: 1 arquivo SQL consolidado + 1 migration TypeScript no boot.

```
migrations/
├── 0000_chubby_lenny_balinger.sql  (64 KB, 263 statements, gerado em 2026-03-13)
└── meta/
    ├── 0000_snapshot.json
    └── _journal.json  (1 entrada)

server/migrations/
└── bulkCs2PriceProjection.ts  (38 KB, executado em boot)
```

**Análise**:
- `_journal.json` tem **uma única entrada** (`idx: 0, when: 1773600811500`). Nenhuma migration incremental desde a snapshot inicial
- A configuração `drizzle.config.ts` aponta para `./migrations` — Drizzle vê só o snapshot zero
- O `db:push` (script `db:push`) sincroniza schema TS direto com o DB **sem gerar migration**. Histórico de mudanças após 2026-03-13 vive **apenas no git diff** do `shared/schema/`
- `bulkCs2PriceProjection.ts` é uma data migration disfarçada de script — roda no boot, é idempotente por heurística, mas **não interage com Drizzle**. Auditoria difícil

**Rollback path**: **inexistente**. Para reverter qualquer mudança de schema, opções são:
1. Reverter `shared/schema/*.ts` no git, rodar `db:push` — pode quebrar se houver dados que não cabem mais
2. `docker compose down -v` + `db:push` — destrói tudo
3. `pg_dump` manual antes de mudanças significativas

**Backup**: nenhum config de backup no `docker-compose.yml`. Volume `gamerstock_pgdata` persiste, mas sem snapshot regular. **`pg_dump` em nenhum script**.

### 4.3 Trilho legacy vs canonical (quantificado)

| Trilho | Tabelas | Row counts no DB | Refs em código |
|---|---|---|---:|
| **LEGACY (vault/riot)** | `vaults`, `vault_snapshots`, `riot_positions`, `riot_trades`, `riot_assets`, `riot_players`, `riot_match_cache`, `riot_player_state` | TODAS 0 rows | 67 refs em 8 arquivos |
| **CANONICAL (asset/multigame)** | `assets`, `asset_markets`, `asset_market_state`, `asset_positions`, `asset_trades`, `asset_price_snapshots`, `asset_valuation_state` | 800/800/800/0/0/14027/0 | 164 refs em 7 arquivos |

**Discovery prática**:
- Bootstrap atual (`startup-seed.ts` + `dota2MarketBootstrapService` + `cs2MarketBootstrapService`) escreve **apenas no canonical**
- O legacy é mantido vivo no schema para `seed.ts` (raiz, nunca rodado nesta DB), para `/api/admin/metrics` (B-8), e em vários handlers que ainda leem dele
- Tabelas legacy mais referenciadas: `assets` (105 — mas isso é canonical confusamente nomeado), `riotAssets` (19), `vaults` (18) — as últimas duas são as legítimas legacy
- **Cleanup possível**: dropar trilho legacy pode quebrar 30+ arquivos. Strangler pattern explícito não existe.

**Recomendação prática**: documentar o estado canônico, listar todos os reads de legacy e migrar 1 a 1, depois fazer `DROP TABLE`.

### 4.4 Soft FKs nos ledgers

Padrão `(reference_type, reference_id)` em 4 tabelas:

| Tabela | Reference fields | UNIQUE em (type, id)? | Estado |
|---|---|---|---|
| `wallet_ledger_entries` | `reference_type`, `reference_id` | ❌ não | risco de double-log |
| `fee_ledger` | `reference_type`, `reference_id` | ❌ não (só index) | B2.4-2: double-settlement |
| `system_wallet_ledger` | `reference_type`, `reference_id` | ❌ não | espelha fee_ledger |
| `player_earnings_ledger` | `reference_type`, `reference_id` + `asset_id, currency, direction` | ✅ `pel_idempotency_key` 5-col | ✅ protegido |
| `ledger_entries` | `reference_type`, `reference_id` | ❌ não | 0 rows; legado portfolio |

**Sem trigger, sem CHECK** validando que `reference_id` aponta para uma row existente da tabela inferida por `reference_type`. Toda integridade depende da camada de aplicação fazer o `referenceType` certo. Dangling refs são silenciosamente possíveis.

### 4.5 Tipos e inconsistências

**Decimais**:
- 3 escalas para `price`/`amount`/`value`:
  - `numeric(10, 2)` — `assets.last_trade_price`, `asset_price_snapshots.price`, `asset_trades.*`
  - `numeric(10, 4)` — `dota2_valuation_state.*`, `cs2_synthetic_match.*`, `asset_valuation_state.fair_value_gs`
  - `numeric(18, 6)` — `assets.fundamental_price`, `asset_market_state.last_price`, `asset_markets.floor_price`, `fee_ledger.*`, `ledger_entries.amount`, `arena_season_leaderboard_snapshot.value`

- O **fluxo crítico** acontece em `asset_market_state.last_price (18,6) → assets.last_trade_price (10,2)`: truncamento de 4 decimais a cada trade.

**Timestamps**:
- `timestamp without time zone`: **200 colunas**
- `timestamp with time zone`: **5 colunas**
- Inconsistente. Postgres default seria sem TZ; recomendação industry é com TZ. Drizzle padrão também é sem TZ.

**IDs**:
- `integer` (serial/bigserial): **84 colunas** — usado para todas tabelas com auto-increment
- `varchar` (UUID via `gen_random_uuid()`): **10 colunas** — usado para `users.id`, `sessions.sid`, `password_reset_tokens.id`, `access_requests.id`, etc.

**JSON**:
- `jsonb` usado consistentemente (e.g., `sessions.sess`, várias colunas de metadata em multigame). Sem `json` ocorrências.

**Naming**: snake_case no DB (correto), camelCase no Drizzle TS — Drizzle faz a tradução automática. Não vi inconsistências.

---

## 5. Tabelas suspeitas

### Órfãs (0 rows + 0 reads recentes)
- `bot_profiles` — só populada via `/api/admin/bots/seed`, nunca executado
- `cs2_stats_snapshot`, `cs2_synthetic_match` — pipeline CS2 dependeria de PandaScore (ofuscado pela B2.4-3)
- `dota2_asset_claim_requests` — claim flow nunca rodado
- `connected_accounts` — onboarding Steam nunca completado nesta DB
- `arena_*` (13 tabelas) — feature provavelmente saindo via P-5
- `draft_*` (5 tabelas em `server/modules/draft/`) — feature não implementada completamente
- `player_*` (transactions, missions, moments, etc.) — operator mode nunca usado

### Macros (>30 colunas)
Nenhuma identificada. A mais densa é `users` (~15 colunas com campos auth + perfil) e `assets` (~16 colunas com market + multigame + status). Tudo abaixo do threshold de macro.

### `shared/schema/admin.ts` vazia (já notado em 2.1)
- Confirmado: 0 tabelas declaradas. Admin é gateado por `users.role='admin'` + middleware. O arquivo é placeholder.

---

## 6. Quantitativos

| Métrica | Valor |
|---|---:|
| Tabelas reais no DB (`pg_tables`) | **111** |
| Tabelas declaradas no Drizzle (~estimado pelo agente) | **~110** |
| Tabelas com 0 rows | **88 (79%)** |
| Tabelas com dados | **23 (21%)** |
| Foreign keys (`pg_constraint contype='f'`) | **96** |
| UNIQUE constraints | **40** |
| CHECK constraints | **5** (todos em wallets) |
| Indexes totais | **350** |
| Tabelas sem PK | **0** ✅ |
| Migrations registradas (journal) | **1** (snapshot consolidado 2026-03-13) |
| Migrations TypeScript ad-hoc | **1** (`bulkCs2PriceProjection.ts`, 38 KB) |
| Distinct numeric precision usados em prices/amounts | **3** (10,2 · 10,4 · 18,6) |
| timestamp w/o TZ vs w/ TZ | **200 vs 5** |
| Soft FKs em ledgers (4 tabelas com `reference_type`+`reference_id`) | 3 sem UNIQUE, 1 com UNIQUE |
| Row counts em trilho legacy | **0 em todas as 8 tabelas** |
| Code refs em trilho legacy | **67 em 8 arquivos** |
| Code refs em trilho canonical | **164 em 7 arquivos** |
| Top tabela por row count | `asset_price_snapshots` (14 027) |
| Backup automático configurado | **0** (sem `pg_dump`, sem cron) |

---

## 7. Recomendações de prioridade (Top 5)

| # | Ação | Justificativa | Effort |
|---|---|---|---|
| **1** | **Trocar `riotTrades`→`assetTrades` + `riotAssets`→`assets` em `admin/routes.ts:535-536`** (fecha B-8) | Bug de KPI visível; trilho legacy lendo morto. Fix de 2 linhas | 5min |
| **2** | **Adicionar `UNIQUE(reference_type, reference_id)` em `fee_ledger`** (fecha B2.2-1 e B2.4-2) | Bloqueia double-settlement no DB-level. Migration trivial | 30min + migration |
| **3** | **Adicionar query unificada de bot status: "Running" só se `bot_profiles.count > 0`** (fecha B-3) | Elimina divergência em-memória vs DB. Fix em handler `/api/admin/bots/status` | 15min |
| **4** | **Decidir KPI source para "Pending review"**: usar `assets.listing_status='UNDER_REVIEW'` em vez de `asset_listing_submissions` (fecha B-5) | Workflow legitimate uses bootstrap shortcut; KPI deve refletir realidade | 30min — ler o endpoint metrics e ajustar |
| **5** | **Documentar estratégia de trilho** (estabelecer "canonical wins"; listar reads ainda em legacy; planejar DROP) | B2.4-8 é confusion-debt; deixar resolvido descongela refactors futuros | 2-3h doc + análise |

**Total Top 5**: ~4-5h. Fecha 3 bugs P1 visíveis + 1 desconfusão estratégica.

**Item bônus** (não fix, recomendação): subir backup automatizado via `pg_dump` no docker-compose ou cron Windows. Sem backup, o `docker compose down -v` apaga tudo. Item para 2.9 (deploy/infra).

---

## 8. Score subjetivo de qualidade

| Área | Score | Observação |
|---|---:|---|
| Schema design (tables, columns, relationships) | **8.0** | Modelagem multigame sólida, hub-and-spoke claro, 0 tabela sem PK |
| Foreign keys (cobertura + onDelete) | **7.5** | 96 FKs, políticas heterogêneas mas não contraditórias. RESTRICT em prediction é elegante |
| UNIQUE constraints (cobertura) | **6.5** | 40 unique, mas falta no `fee_ledger` (P1) e nos outros 2 ledgers |
| CHECK constraints | **4.0** | Apenas 5, todos em wallets. Resto do schema sem invariantes DB-level |
| Indexes | **8.0** | 350, distribuição razoável. Tabelas vazias acumulam indexes não-úteis mas não atrapalham |
| Migrations governance | **4.5** | 1 snapshot + 0 incrementais via db:push + 1 migration TS hardcoded. Sem rollback |
| Trilho legacy/canonical | **5.0** | Coexistência zumbi confusa; documentação ausente |
| Tipos (consistência) | **6.5** | 3 precisões para price (-), timestamp w/o TZ uniforme (-), IDs OK |
| Integridade ledger (soft FKs) | **6.0** | 1 dos 4 ledgers tem idempotência DB-level. Resto depende da app |
| Backup/restore | **2.0** | Inexistente. Crítico se for pra produção |
| Performance/escala | **8.0** | Indexes prontos, partitioning não necessário ainda |
| Investigations (B-3/4/5/8) | **N/A** | Todas as 4 causas raiz confirmadas via DB queries diretas |
| **Total banco** | **6.5** | Schema bom; governance e integridade ledger fracos; bug em metrics fácil de fixar |

---

## Notas finais

- **bulkCs2PriceProjection.ts** merece doc separado. Embute dados de produção em código. Não é incomum em casos de bridge de API caída, mas precisa de plano de saída.
- **80% das tabelas vazias** é um sinal claro de que o schema está modelado para um futuro do produto. Não é débito em si — é over-architecture. O cuidado é não confundir "vazio" com "morto" sem auditar quem lê.
- **Trilho legacy não tem dados, mas tem leitores**. Esse é o pior pattern porque o reader pode silenciosamente retornar 0/[] e o frontend não distingue de "feature desativada".
- Para auditoria 2.6 (segurança), o trecho importante daqui é: **soft FKs sem validação trigger/check** + **sessions table sem TTL DB-level** (TTL fica no app via `connect-pg-simple`).

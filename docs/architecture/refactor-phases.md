# GamerStock — Backlog de Refactors por Fase

> **Versão:** Fase 1 (2026-04-06)
> **Status:** Planejamento arquitetural — sem mudanças no código.
> **Propósito:** Sequenciar mudanças futuras sem perder contexto entre sessões.

Cada fase é independente e tem critérios de aceite explícitos.
A ordem reflete dependências: uma fase posterior pode assumir que as anteriores foram concluídas.

---

## Fase 2 — Market Integrity ✅ CONCLUÍDA (2026-04-06)

**Objetivo:** Garantir que o sistema nunca deixe preços em estado inválido sem diagnóstico explícito.

### Conceito central: 3 níveis de elegibilidade

A Fase 2 formalizou a distinção entre 3 estados distintos que antes eram confundidos:

#### A. Elegibilidade de Ingestão (`ingestionEligibility`)
O player tem dados suficientes para existir no pipeline?
- asset/perfil existe com identity válida
- game e provider definidos
- externalId não-zero
- `dota2_valuation_state` existe com `player_value` acima do baseline de $15

Se falhar aqui → `REQUIRES_PROVIDER_DATA` ou `REQUIRES_INITIAL_VALUATION`

#### B. Elegibilidade de Listagem no Terminal (`listingEligibility`)
O asset tem todos os campos que o Terminal precisa para operar sem nulls críticos?
- `dota2_valuation_state.player_value` existe e não está no baseline
- `fundamental_price` existe e é > 0
- `last_trade_price` existe
- Pelo menos 1 evento em `dota2_value_history` (BOOTSTRAP ou equivalente)
- `listing_status` é LISTED ou ACTIVE

Se falhar aqui → `REQUIRES_BOOTSTRAP` ou `REQUIRES_INITIAL_VALUATION`

#### C. Integridade Mínima Pós-Listagem (Reconciler, INV_1–INV_6)
O asset já listado continua operável?
- INV_1–INV_4: campos críticos ainda presentes (quarantine se não)
- INV_5: não está preso no baseline de $15 (quarantine)
- INV_6: valuation_state.updated_at foi tocado nas últimas 2h (reprocess ou quarantine)

Este nível é contínuo e leve — não um sistema sofisticado de monitoramento.

### Nota sobre naming multigame
`dota2_valuation_state` e `dota2_value_history` são usadas para Dota2 e CS2.
Isso é um naming herdado, NÃO uma limitação conceitual. Renomear → Fase 7.

**Mudanças implementadas:**
- `server/domains/terminal/listingEligibilityService.ts` — serviço `evaluateTerminalEligibility(assetId)`
- `server/domains/terminal/reconcilerLog.ts` — buffer em memória (últimas 200 ações)
- `server/domains/terminal/reconciler.ts` — log estruturado JSON em quarantine/repair/reprocess/warn
- `server/domains/admin/routes.ts` — `system-health` expandido + 2 novos endpoints
- `GET /api/admin/assets/:id/invariant-status` — diagnóstico completo por asset
- `GET /api/admin/reconciler/log` — últimas N ações do reconciler (query param: ?limit=N)

**O que NÃO foi feito:**
- Nenhuma migration criada
- Nenhum cálculo de preço ou valuation alterado
- Nenhuma tabela renomeada
- Nenhuma lógica central recriada
- Nenhum sistema de agentes ou automação pesada

**Critérios de aceite:**
- ✅ `system-health` retorna top-10 para: no_valuation, no_history, no_fundamental_price, no_last_trade_price, eligibility_failing
- ✅ Reconciler emite `{"type":"reconciler_action","assetId":...,"game":...,"invariant":...,"action":...,"timestamp":...,"details":{...}}`
- ✅ `GET /api/admin/assets/:id/invariant-status` retorna diagnóstico em 3 seções: ingestion, listing, recommended action
- ✅ Zero mudança no comportamento de preço

---

## Fase 3 — Performance History ✅ CONCLUÍDA (2026-04-06)

**Objetivo:** Tornar as timelines de Performance e Value públicas e canônicas via API, com visualização na asset-detail.

### As 3 Timelines (formalizadas)

| Timeline | Endpoint | Fonte de dados | O que representa |
|---|---|---|---|
| **Performance** | `GET /api/assets/:uid/performance-history` | `dota2_value_history` (RECALC events com performance_score) | Performance esportiva do jogador |
| **Value** | `GET /api/assets/:uid/value-history` | `dota2_value_history` (todos os eventos) | Estimativa algorítmica de valor fundamental |
| **Price** | `GET /api/assets/:uid/snapshots` | `asset_price_snapshots` | Resposta do mercado ao valor |

Estas 3 timelines são **independentes** e **não devem ser confundidas**:
- Performance ≠ price momentum
- Performance ≠ market movement
- Value = modelo algorítmico baseado em performance
- Price = AMM + trades (mercado)

### Nota: fonte de performance history

`dota2_performance_scores` é a fonte canônica futura, mas tem **0 rows** em PROD
(match ingestion pipeline ainda não ativo). Até lá, `performance-history` usa
`dota2_value_history.performance_score` (RECALC events) como proxy.

**Mudanças implementadas:**
- `server/domains/discovery/routes.ts`:
  - `GET /api/assets/:assetUid/performance-history` — score 0–100 por dia, agrega RECALC events
  - `GET /api/assets/:assetUid/value-history` — últimos N dias de player_value (default 90)
- `client/src/pages/asset-detail.tsx`:
  - Seção "Performance Score History" com AreaChart (cor índigo) — Timeline 1
  - Seção "Algorithmic Value History" com AreaChart (cor verde) — Timeline 2
  - Tooltips explicativos diferenciando cada timeline
  - Empty state quando não há dados

**O que NÃO foi feito:**
- Nenhuma migration
- Nenhum cálculo de score alterado
- Nenhuma lógica de EMA alterada
- Nenhum pipeline de ingestion modificado

### Shape exato dos endpoints

```
GET /api/assets/:assetUid/performance-history?days=90
→ [{date:"2026-04-02", score:66.44, matchesCount:1, sourceType:"VALUE_HISTORY_PROXY"}]

GET /api/assets/:assetUid/value-history?days=90
→ [{date:"2026-04-02T13:49:38.675Z", playerValueAfter:13.417, eventType:"RECALC"}]
```

**Critérios de aceite:**
- ✅ `performance-history` retorna `{date, score, matchesCount, sourceType}` ordenado por data
- ✅ `value-history` retorna `{date, playerValueAfter, eventType}` dos últimos 90 dias
- ✅ Asset-detail mostra "Performance Score History" e "Algorithmic Value History" distintos do price chart
- ✅ Nenhuma mudança no valuation engine, scoring, ou pricing

---

## Fase 4 — Runtime & Environment Parity ✅ CONCLUÍDA (2026-04-06)

**Objetivo:** Garantir que os schedulers não rodem de forma destrutiva em DEV e que PROD seja previsível.

### O que foi implementado

#### 1. Extração da orquestração de schedulers
`server/index.ts` foi reduzido a configuração HTTP + delegação.
Toda lógica de scheduler foi movida para `server/scheduler/index.ts`:
- Função única `startSchedulers()` — chamada por `server/index.ts` após o bind de porta
- Cada scheduler é iniciado com log `✓ Nome — descrição`
- Schedulers pulados são logados com `✗ Nome — SKIPPED (motivo)`

#### 2. Guard do bot simulator

Regra implementada em `server/scheduler/index.ts` → função `botGuard()`:

| Condição | Resultado |
|---|---|
| `DISABLE_BOTS=true` | Nunca inicia (qualquer ambiente) |
| `NODE_ENV=production` sem `ENABLE_BOTS=true` | Nunca inicia (safe default) |
| `NODE_ENV=production` com `ENABLE_BOTS=true` | Inicia (opt-in explícito) |
| Qualquer outro ambiente (dev/test) | Inicia por padrão |

#### 3. Guards do startup seed

`server/market-core/startup-seed.ts` detecta `NODE_ENV` e emite `console.warn` em PROD para:
- CS2 bootstrap (cs2AssetCount=0 em PROD)
- Dota2 bootstrap (assetCount=0 em PROD)
- Dota2 enrichment (dota2_valuation_state vazio em PROD)

Os guards de dados já existentes (checks de count) continuam sendo a proteção principal.
O log PROD diferencia entre "safe on first deploy" e "verify this is expected".

#### 4. Logs de boot

Boot agora imprime:
```
[Schedulers] ════════════════════════════════════════
[Schedulers] Environment : development
[Schedulers] ENABLE_BOTS : (unset)
[Schedulers] DISABLE_BOTS: (unset)
[Schedulers] ────────────────────────────────────────
[Schedulers] ✓ Market simulator    — AMM + PAE + momentum (15s tick)
[Schedulers] ✓ Riot sync           — LoL challengers sync (24h interval)
...
[Schedulers] ✗ Bot simulator       — SKIPPED (NODE_ENV=production without ENABLE_BOTS=true)
[Seed] ── Startup Seed BEGIN (env=production) ──
[Seed] ── Startup Seed COMPLETE (env=production) ──
```

#### 5. Variáveis de ambiente introduzidas

| Variável | Propósito | Default |
|---|---|---|
| `ENABLE_BOTS` | Ativa bots em PROD quando `=true` | (unset = off em PROD) |
| `DISABLE_BOTS` | Desativa bots em qualquer ambiente quando `=true` | (unset = on em DEV) |

**Arquivos criados/alterados:**
- `server/scheduler/index.ts` — CRIADO: orquestração central de schedulers
- `server/index.ts` — ALTERADO: reduzido a HTTP + delegação a `startSchedulers()`
- `server/market-core/startup-seed.ts` — ALTERADO: guards PROD + logs de ambiente

**Critérios de aceite (todos satisfeitos):**
- ✅ Bot simulator não inicia se `NODE_ENV=production` sem `ENABLE_BOTS=true`
- ✅ `startSchedulers()` isolado em `server/scheduler/index.ts`
- ✅ Documentação operacional atualizada

**O que NÃO foi feito (em conformidade com o escopo):**
- Nenhuma regra de preço alterada
- Nenhum cálculo de valuation alterado
- Nenhuma migration criada
- Nenhuma lógica central recriada
- Intervalos dos schedulers inalterados

---

## Fase 5 — Modular Refactor

**Objetivo:** Eliminar `server/routes.ts` monolítico e `server/storage.ts` legado.

**Mudanças esperadas:**
- Migrar rotas de `server/routes.ts` para `registerRoutes()` em cada domínio (já parcialmente feito)
- Eliminar `server/storage.ts` — substituir todos os callers por repositórios de domínio
- Mover `server/riot-sync.ts` e `server/riot-perf.ts` para `server/integrations/riot/`
- Encapsular acesso direto ao Riot API atrás de interface `PerformanceProvider`
- Mover `server/arena.ts` para `server/domains/arena/arena-core.ts`

**O que NÃO fazer ainda:**
- Não renomear tabelas nesta fase
- Não fazer big-bang — migrar rota por rota
- Não alterar `shared/schema/` nesta fase

**Critérios de aceite:**
- `server/storage.ts` tem zero callers
- `server/routes.ts` tem menos de 200 linhas (apenas `registerRoutes` orchestration)
- Todos os testes existentes passam após cada migration de rota

---

## Fase 6 — Observability

**Objetivo:** O sistema deve ser auto-explicativo sobre seu estado.

**Mudanças esperadas:**
- Expandir `GET /api/admin/system-health` com:
  - `schedulers` — status de cada scheduler (last run, next run, errors)
  - `providers` — status de cada provider externo (last success, last error, rate limit)
  - `queues` — tamanho da fila de ingestion
- Padronizar todos os logs estruturados com `{type, module, timestamp, data}`
- Criar dashboard de operações no painel admin consumindo esses dados
- Adicionar alertas básicos (Slack/email) para `status=CRITICAL`

**O que NÃO fazer ainda:**
- Não integrar APM externo (Datadog, Sentry) ainda
- Não criar sistema de tracing distribuído
- Não alterar log format de módulos LEGACY_FROZEN (pode quebrar monitoring existente)

**Critérios de aceite:**
- `system-health` retorna estado de todos os schedulers
- Cada scheduler exporta `lastRun`, `errors`, `nextRunEstimate`
- Dashboard admin mostra semáforo verde/amarelo/vermelho por módulo

---

## Fase 7 — Multi-game Consolidation

**Objetivo:** Unificar a nomenclatura de schema e código para múltiplos jogos sem quebrar dados existentes.

**Mudanças esperadas:**
- Renomear `dota2_valuation_state` → `asset_valuation_state` (com migration safe)
- Renomear `dota2_value_history` → `asset_value_history` (com migration safe)
- Renomear `dota2_performance_scores` → `asset_performance_scores` (com migration safe)
- Consolidar `dota2ValuationService.ts` e `cs2ValuationService.ts` em `valuationService.ts` com adapter por jogo
- Eliminar prefixo `dota2` de arquivos que já servem Dota2 e CS2

**O que NÃO fazer ainda:**
- Não fazer todas as renomeações em um commit — uma tabela por vez
- Não alterar a lógica de valuation durante a renomeação
- Não mudar tipos de coluna ou PKs

**Critérios de aceite:**
- Zero referência a `dota2_valuation_state` no código após a migration
- `system-health` ainda funciona com os novos nomes
- Performance de queries mantida (indexes recriados nos novos nomes)

---

## Notas Transversais

- **Nunca quebrar `GET /api/admin/system-health`** — é o canário do sistema
- **Nunca alterar `last_trade_price` diretamente** — apenas o PAE em market-maker.ts
- **Nunca usar `portfolios.balance`** — sempre `wallets.available_balance`
- **Cada fase deve ter PR separado** — nunca misturar observability com refactoring de schema

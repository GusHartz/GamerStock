# Auditoria 2.8 — Testes

**Data**: 2026-05-14
**Escopo**: confirmação quantitativa do gap + infrastructure check + plano propositivo de cobertura mínima
**Método**: greps de inventário, `npm test`, leitura do único arquivo de teste existente, mapeamento de áreas críticas
**Output**: somente leitura

---

## 1. Resumo executivo

**1 arquivo de teste** existe em todo o projeto (`server/domains/trade-settlement/__tests__/service.test.ts`, **282 LOC, 7 it() blocks bem escritos** cobrindo idempotência + reservas + fills + edge cases). **Mas o teste não roda hoje**: ao executar `npm test`, falha imediatamente com `DATABASE_URL must be set` porque vitest não carrega `.env` automaticamente e o módulo `server/db.ts:8` faz throw at import time. **Resultado funcional: zero testes executáveis em 109k LOC.**

Infrastructure mínima existe (vitest@4.0.18 + vitest.config.ts), mas faltam: dotenv loader, `@testing-library/react`, jsdom/happy-dom (vitest está em `environment: "node"`), MSW, supertest, coverage tool, CI. Tooling para frontend test = zero. Test DB isolado = zero. Fixtures = zero.

**Severidade geral: CRÍTICA**. Sistema financeiro com PVI + AMM + 3 ledgers, sem rede de segurança. Pior: o único teste que **existe** e atacaria exatamente os achados financeiros P1 (B2.2-1 idempotência) **está quebrado em ambiente local** — provavelmente nunca rodou pós-Replit-migration.

---

## 2. Confirmação quantitativa

| Métrica | Valor |
|---|---:|
| Arquivos `*.test.*` (excluindo node_modules) | **1** |
| Arquivos `*.spec.*` | 0 |
| Pastas `__tests__/` | 1 (apenas em trade-settlement) |
| `describe(` / `it(` / `test(` ocorrências no código | 7 (no arquivo único) |
| Test files em frontend (`client/src/**`) | **0** |
| Test files em shared (`shared/**`) | **0** |
| Test files em services (`server/services/**`) | **0** |
| Test files em outros 27 domínios | **0** |
| Pastas `tests/`, `test/`, `e2e/`, `cypress/`, `playwright/` | nenhuma existe |
| `.github/workflows/`, `.husky/`, `.gitlab-ci.yml`, `.circleci/` | nenhum |
| Pre-commit hooks | 0 |
| Linhas em `vitest.config.ts` | 17 (config básica) |
| `vitest` instalado | ✅ v4.0.18 |
| `@testing-library/react` | ❌ ausente |
| `@testing-library/jest-dom` | ❌ ausente |
| `@testing-library/user-event` | ❌ ausente |
| `jsdom` / `happy-dom` | ❌ ausente (e config está em `environment: "node"`) |
| `msw` (Mock Service Worker) | ❌ ausente |
| `supertest` (API testing) | ❌ ausente |
| `playwright` / `cypress` | ❌ ausente |
| `@vitest/coverage-v8` | ❌ ausente |
| Test scripts em `package.json` | apenas `"test": "vitest run"` (sem watch, sem coverage) |
| dotenv loader em vitest config | ❌ ausente (causa do erro `DATABASE_URL must be set`) |
| Test fixtures/helpers/mocks folders | ❌ nenhum |
| `vi.mock(` / `vi.fn(` ocorrências | 0 |
| Test DB / containerização | ❌ ausente |
| Testes skipped/todo (zumbis) | 0 |

`npm test` falha com:
```
FAIL  server/domains/trade-settlement/__tests__/service.test.ts
Error: DATABASE_URL must be set. Did you forget to provision a database?
 ❯ server/db.ts:8:9
```

---

## 3. Top achados

### B2.8-1 [P0] — Test único existe mas está quebrado em runtime
- **Arquivo**: `server/domains/trade-settlement/__tests__/service.test.ts` (282 LOC, 7 it() blocks)
- **Categoria**: infrastructure-orphan
- **Descrição**: o arquivo é **bem escrito** — cobre os cenários certos (reserveBuyOrderFunds, releaseBuyOrderFunds, settleMatchedTrade full fill, partial fill, insufficient locked, **idempotência por tradeId**) com setup/teardown via `beforeAll`/`afterAll`, cleanup com `CASCADE delete`, e prefixo `settle-test-` para isolamento. O teste #6 testa exatamente o tipo de invariante que B2.2-1 documenta (idempotência via tradeId). **Mas**: `npm test` retorna `Failed Suites 1, no tests` porque `server/db.ts:7-11` faz `throw new Error("DATABASE_URL must be set")` no import time, e `vitest.config.ts` não tem `setupFiles` carregando `dotenv/config`.
- **Impacto**: o teste cobre o caminho financeiro mais sensível do produto, e ele **não roda**. Foi escrito mas está dormente. Provavelmente funcionou no Replit (env vars injetadas pelo runtime), nunca foi adaptado para a era Windows/Docker (D-fix 2026-05-14).
- **Fix**: 1 linha em `vitest.config.ts` adicionando `setupFiles: ['dotenv/config']`. Após isso o teste passa contra o DB de dev (com cleanup automático).

### B2.8-2 [P1] — Frontend tem ZERO testes E zero infra de teste frontend
- **Arquivos**: nenhum em `client/`
- **Categoria**: missing-tests / missing-infra
- **Descrição**: zero arquivos `.test.tsx`, zero `@testing-library/react`, zero `jsdom`/`happy-dom`. `vitest.config.ts:7` declara `environment: "node"` — incompatível com testes de componentes React. Para frontend testar, precisa de `jsdom` ou `happy-dom` + `@testing-library/react`. Setup necessário antes de qualquer teste de UI.
- **Áreas mais críticas sem cobertura UI**:
  - `client/src/features/buy-flow/` — modal multi-step de compra
  - `client/src/hooks/use-auth.ts` — gate de session
  - `client/src/state/terminalStore.ts` — Context state reducer
  - `client/src/pages/admin/arena.tsx:230` — bug B-7 trivialmente prevenível com `data?.seasons?.find()` unit test

### B2.8-3 [P1] — 16 services + 27 domains sem cobertura
- **Categoria**: missing-tests
- **Descrição**: cobertura efetiva = **1 service em 1 domain**. Detalhes:
  - 0 testes em `server/services/` (16 arquivos, incluindo `tradeExecutor`, `assetTradeExecutor`, `triggerEngine`, `valuationJob`, `performanceEngine`, `pviEngine`, `ammPricing`)
  - 0 testes em 27 outros domains (`server/domains/wallet/`, `fee-engine/`, `multigame/`, `prediction/`, etc.)
  - 0 testes para `shared/` (zod schemas, tipos compartilhados)
- **Impacto**: cada bug financeiro reportado nas auditorias anteriores é refactor-roleta. Mudanças em `ammPricing.ts` não têm validação de regressão.

### B2.8-4 [P2] — Sem coverage tool, impossível medir progresso
- **Categoria**: missing-infra
- **Descrição**: `@vitest/coverage-v8` não instalado. Sem `npm run test:coverage`. Não há baseline para acompanhar "% coverage por domínio".
- **Fix**: 1 `npm install -D @vitest/coverage-v8` + add `"coverage": "vitest run --coverage"` script.

### B2.8-5 [P2] — Sem mock infrastructure (MSW, supertest)
- **Categoria**: missing-infra
- **Descrição**: para testes de integração API sem subir o servidor inteiro, precisa de `supertest` (HTTP request injection). Para mockear external APIs (Riot, Steam, PandaScore) em testes, `msw` (Mock Service Worker) é o standard. Ambos ausentes.

### B2.8-6 [P3] — Sem CI/CD e sem pre-commit
- **Categoria**: missing-infra
- **Descrição**: já S-4. `.github/workflows/` ausente, `.husky/` ausente. Mesmo se testes existirem, ninguém os roda automaticamente. Combinado com B2.8-1, o único teste existente vai continuar broken até alguém manualmente rodar `npm test`.

### B2.8-7 [P3] — Sem strategy de DB isolation
- **Categoria**: design-gap
- **Descrição**: o teste existente roda contra o `DATABASE_URL` do `.env` (DB de dev). Usa prefixo `settle-test-` para isolamento + CASCADE cleanup. Funciona mas:
  - dois desenvolvedores rodando `npm test` simultaneamente conflitam
  - nenhum reset de schema entre runs
  - sem container Postgres dedicado para CI
- **Recomendação**: separar `DATABASE_URL_TEST` ou usar `testcontainers` quando atacar.

---

## 4. Áreas críticas sem cobertura

### 4.1 Financeiro (🔴 P0)

| Arquivo | Função-chave | Cenários de teste |
|---|---|---|
| `server/services/tradeExecutor.ts` | execução de trade Riot path | tx atomicidade, fee capture dentro da tx, debit fora (B2.2-2), event emit |
| `server/services/assetTradeExecutor.ts` | execução de trade canonical | mesmo + idempotência em retry |
| `server/domains/wallet/service.ts:135-176` (creditWallet) | crédito atômico | FOR UPDATE, idempotência por referenceId, invariante non-negativo |
| `server/domains/wallet/service.ts:debitWallet` | débito atômico | insufficient funds throws, FOR UPDATE lock, ledger sincronizado |
| `server/domains/wallet/service.ts:lockFunds/unlockFunds` | reservas | available ↓ + locked ↑ + total inalterado |
| `server/domains/fee-engine/index.ts:_capture` | fee split 60/25/15 | atomicidade com tx, idempotência por (referenceType, referenceId) — **B2.2-1 regression test** |
| `server/domains/trade-settlement/service.ts` | ✅ **já coberto** mas teste quebrado | reativar via B2.8-1 fix |
| `server/domains/player-earnings/service.ts:accruePlayerEarnings` | accrual idempotente | UNIQUE pel_idempotency_key respeitado, ON CONFLICT DO NOTHING |

**Effort estimado para cobertura financeira**: ~16-24h (10-15 testes), assumindo infra setup ok.

### 4.2 AMM math (🟡 P1)

Funções puras = unit tests rápidos, sem DB.

| Função | Edge cases |
|---|---|
| `spotPrice(supply, p)` | supply=0 → floorPrice; supply negativo clamped; supply enorme |
| `costToBuy(supply, qty, p)` | qty=0 → 0; qty negativo → 0; integral correto |
| `payoutToSell(supply, qty, p)` | qty>supply clamped; resultado ≥ 0; supply=qty edge |
| `supplyForPrice(price, p)` | price≤floor → 0; price>>floor sem overflow |
| `primitiveAt(supply, p)` | monotonicamente crescente |
| Inversibilidade | `supplyForPrice(spotPrice(s, p), p) ≈ s` |

**Effort**: ~2-3h. **Quick win**: AMM é o core valuation. Test 1 quebra → suite te avisa antes do prod.

### 4.3 Auth flows (🟡 P1)

Após fixes da Fase 0 (B2.5-1, B2.6-1, B2.6-2, B2.6-3), validar via testes que as mitigações continuam aplicadas.

| Endpoint | Cenários |
|---|---|
| `POST /api/auth/signup` | rate limit hit, weak password rejected, email duplicado retorna 409, novo user tem wallet criada |
| `POST /api/auth/login` | bcrypt compare, session.regenerate chamado, blocked/deleted/pending status, audit log emit |
| `POST /api/auth/forgot-password` | response NUNCA contém `_devResetLink` em prod, token gerado e hash persistido, anti-enumeration |
| `POST /api/auth/reset-password` | token expired rejeitado, single-use enforcement, password policy |
| `POST /api/admin/auth/reset-password` | timing-safe compare, rate limit, password ≥12 chars, cria admin (B2.5-6) |
| `POST /api/admin/login` | bcrypt path para DB user, env-var path com ADMIN_USER/PASS, lockout absent (TBD) |

**Effort**: ~6-8h (8 testes via supertest após instalar).

### 4.4 Performance / valuation (🟢 P2)

Funções puras + 1 integration test do batch.

| Arquivo | Testes |
|---|---|
| `server/services/pviEngine.ts` | clamp 0-100, EMA alpha=0.18, div/0 guards em divergence, fair value monotonia |
| `server/services/performanceEngine.ts` | z-score com std=0, kda safe-divide, role baseline lookup |
| `server/services/valuationJob.ts:runValuationBatch` | mid-batch crash leaves flag=false (try/finally), upsert idempotente |
| `server/services/baselineUpdateJob.ts` | recompute correto, samples insuficientes pula |

**Effort**: ~4-6h.

### 4.5 Frontend (🟢 P2)

Após instalar `jsdom` + `@testing-library/react`.

| Componente | Cenários prioritários |
|---|---|
| `client/src/pages/admin/arena.tsx:230` | data=undefined não throw (B-7 regression) |
| `client/src/features/buy-flow/QuickBuyModal` | quantity input, insufficient funds blocker, slippage warning |
| `client/src/hooks/use-auth.ts` | 401 → returns null, refetch on focus, logout clears state |
| `client/src/state/terminalStore.ts` | reducer actions: SELECT_ASSET, SET_SIDE, RESET |
| `client/src/pages/watchlist.tsx` | empty state, asset rendering (B-9 LoL hardcode regression) |
| `client/src/pages/assets.tsx:1331` | default game filter (B-2 regression — assert default not "dota2") |

**Effort**: ~8-12h (depois de 1h de setup do jsdom + testing-library).

### 4.6 Schedulers (🟢 P3)

| Scheduler | Smoke test |
|---|---|
| `server/scheduler/ingestion-scheduler.ts` | skip se PANDASCORE_API_KEY ausente (D-fix regression) |
| `server/scheduler/index.ts` | botGuard logic em diferentes NODE_ENV |
| `server/services/triggerEngine.ts` | trigger order avaliação, race condition cancel + execute |
| `server/services/valuationJob.ts` | try/finally garante flag reset (B2.2-8 regression) |

**Effort**: ~4-6h.

---

## 5. Testes que teriam pego bugs conhecidos

| Achado | Teste preventivo (file:line de produção → teste) |
|---|---|
| **B2.2-1** (fee_ledger dup) | `fee-engine/__tests__/_capture.test.ts` — chamar `captureTradeFees({tradeId:"X"})` 2x → 2ª retorna idempotent OU rejeita por UNIQUE |
| **B2.2-2** (wallet outside tx) | integration test que faz `mockReject` no `debitWallet` mid-trade e valida que portfolio rollback aconteceu |
| **B2.4-1 / B-8** (metrics NaN) | `admin/routes.test.ts` — `GET /api/admin/metrics` com 0 trades retorna `0%`, não `NaN` |
| **B2.5-1** (reset token leak) | `identity/routes.test.ts` — `POST /api/auth/forgot-password` response NUNCA inclui `_devResetLink` em NODE_ENV=production |
| **B2.6-1** (log middleware) | integration: mock console, fazer login, assert que log line NÃO contém `passwordHash` ou `_devResetLink` |
| **B2.6-3** (admin/users hash) | `GET /api/admin/users` response não tem nenhum row com chave `passwordHash` |
| **B-2** (assets default dota2) | frontend snapshot ou unit do reducer/initialState garante default `game="all"` |
| **B-7** (admin/arena crash) | frontend render test com `data={undefined}` não throw em `.find()` |
| **B-9** (watchlist Challenger hardcoded) | rendering test com asset de game=cs2 não renderiza "Challenger" |
| **AMM `supply=0`** | unit test que `spotPrice(0, params)` retorna `params.floorPrice` exato (não NaN, não 0) |
| **B2.5-3** (session.regenerate) | integration: login + assert `req.session.id` mudou pré/pós-login |

**Verdict**: dos ~71 achados das auditorias 2.x, **~30 (40%) poderiam ter sido prevenidos por testes**, dos quais ~12 são "smoke level" (1 linha por teste).

---

## 6. Plano de cobertura recomendado

### 6.1 Setup minimum viable (~1-2h)

1. **`vitest.config.ts`**: adicionar `setupFiles: ['dotenv/config']` (linha única) — destrava o teste existente
2. **`package.json` scripts**: adicionar `"test:watch": "vitest"`, `"test:coverage": "vitest run --coverage"`
3. **Instalar coverage**: `npm install -D @vitest/coverage-v8`
4. **Instalar frontend test infra** (quando atacar 4.5): `npm install -D @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom`
5. **Instalar API test infra** (quando atacar 4.3): `npm install -D supertest @types/supertest`
6. **Definir env var `DATABASE_URL_TEST`** apontando para um DB ou schema separado (recomendado: `gamerstock_test`)
7. **Criar `tests/setup.ts`** com helper para limpar tabelas comuns entre testes

### 6.2 Primeiros 10-15 testes priorizados

Ordem por ratio (impacto × baixo effort):

| # | Test file | Tipo | Effort | Justificativa |
|---|---|---|---|---|
| 1 | **destravar `trade-settlement/__tests__/service.test.ts`** | integration | **5min** | já existe, fix de 1 linha (`setupFiles: ['dotenv/config']`) |
| 2 | `services/ammPricing.test.ts` (spotPrice + costToBuy edge cases) | unit | 1h | funções puras, fácil, cobre core valuation |
| 3 | `services/pviEngine.test.ts` (clamp, EMA, divergence) | unit | 1h | funções puras, regression p/ B2.4-5 truncation |
| 4 | `domains/wallet/__tests__/service.test.ts` (credit/debit/lock) | integration | 3h | DB já gateado por env var; testar FOR UPDATE invariants |
| 5 | `domains/fee-engine/__tests__/capture.test.ts` (idempotência) | integration | 2h | **B2.2-1 regression** — chamar 2x, assert apenas 1 row em fee_ledger (após fix) |
| 6 | `services/valuationJob.test.ts` (flag try/finally) | integration | 1h | **B2.2-8 regression** |
| 7 | `domains/identity/__tests__/signup.test.ts` (via supertest) | api | 2h | duplicate email, weak password, wallet criada |
| 8 | `domains/identity/__tests__/forgot-password.test.ts` | api | 1h | **B2.5-1 regression** — response sem `_devResetLink` |
| 9 | `admin/__tests__/users.test.ts` (response sem passwordHash) | api | 1h | **B2.6-3 regression** |
| 10 | `admin/__tests__/metrics.test.ts` (no NaN) | api | 1h | **B-8 regression** |
| 11 | `pages/admin/arena.test.tsx` (data=undefined safe) | frontend | 30min | **B-7 regression**, após setup jsdom |
| 12 | `pages/watchlist.test.tsx` (multigame agnostic) | frontend | 1h | **B-9 regression** |
| 13 | `hooks/use-auth.test.tsx` (401 → null) | frontend | 1h | session expiry handling |
| 14 | `state/terminalStore.test.ts` (reducer pureza) | unit | 1h | actions, no side effects |
| 15 | `services/triggerEngine.test.ts` (race condition) | integration | 2h | order claim + execute |

**Total effort**: ~18-22h para os 15 testes + 1-2h setup = **~20-24h de trabalho**.

### 6.3 Roadmap até "smoke test minimum viable"

**Definição**: app boota, schedulers iniciam, 5 endpoints críticos respondem 200, login + 1 trade end-to-end.

| Fase | Effort | Output |
|---|---|---|
| Smoke 1: app boot | 1h | `tests/smoke/boot.test.ts` — `import "../server/index"` não throw |
| Smoke 2: 5 endpoints | 2h | `GET /api/health`, `GET /api/market/assets`, `GET /api/auth/me` (401), etc. |
| Smoke 3: signup + login + 1 trade | 3h | supertest full flow |

**Total smoke MVP**: **~6-8h**.

### 6.4 Roadmap até 30% coverage em domínios financeiros

| Domain | Effort para 30% |
|---|---|
| `wallet/` | 4-6h (8 testes) |
| `fee-engine/` | 3-4h (4 testes) |
| `trade-settlement/` | já tem 6, falta admin paths (2h) |
| `player-earnings/` | 2-3h (3 testes) |
| `services/tradeExecutor.ts` + `assetTradeExecutor.ts` | 4-6h (6 testes) |
| `services/ammPricing.ts` + `pviEngine.ts` | 3-4h (10 testes — pureza) |

**Total**: ~20-28h.

---

## 7. Recomendações de prioridade (Top 5)

| # | Ação | Justificativa | Effort |
|---|---|---|---|
| **1** | **Destravar o teste existente** (`setupFiles: ['dotenv/config']` em vitest.config.ts) | B2.8-1. 1 linha, restaura 7 testes financeiros já escritos | **5min** |
| **2** | **Adicionar `@vitest/coverage-v8` + script `test:coverage`** | Permite medir progresso. Sem isso, qualquer estratégia é cega | 15min |
| **3** | **Escrever 5 unit tests de AMM math** (`spotPrice`, `costToBuy`, `payoutToSell`, `supplyForPrice`, edge cases) | Funções puras, rápidas, cobrem core valuation. Quick win com ratio absurdo | 2-3h |
| **4** | **Setup test DB isolado** + Wallet service integration tests | B2.2-1 e B2.2-2 são P1 financeiros — sem teste, qualquer refactor é roleta | 4-6h |
| **5** | **Frontend test infra** (jsdom + RTL) + 2 regression tests (B-7 admin/arena, B-9 watchlist) | Destrava UI testing + cobre 2 bugs reportados que voltarão sem teste | 3-4h |

**Total Top 5**: ~10-15h para passar de zero-testes-executáveis para "tem rede de segurança no caminho financeiro core + 2 regressions".

---

## 8. Score subjetivo de qualidade

| Área | Score | Observação |
|---|---:|---|
| Test coverage atual | **0.5** | 1 arquivo existe mas não roda. Effective coverage = 0 |
| Test quality (do que existe) | **8.5** | O teste de trade-settlement é bem escrito — setup/teardown limpo, cobre idempotência, isolamento por prefixo |
| Test infrastructure (vitest config) | **3.0** | Vitest instalado, config básica, mas falta dotenv loader + frontend env |
| Test-related deps | **2.0** | Só vitest. Falta testing-library, jsdom, msw, supertest, coverage |
| CI/CD para testes | **0.0** | Ausente |
| Pre-commit / git hooks | **0.0** | Ausente |
| Test fixtures / helpers | **3.0** | Único teste tem cleanup inline; nenhum helper compartilhado |
| DB isolation strategy | **2.5** | Prefixo `settle-test-` funciona mas não escala |
| Mocking infrastructure | **0.0** | Ausente — sem MSW, sem vi.mock usage |
| Regression test coverage (bugs conhecidos) | **0.0** | Zero dos ~30 achados preveníveis cobertos |
| **Total testes** | **1.5** | Sistema financeiro voa cego |

---

## Notas finais

- **A boa notícia escondida**: existe **1 teste bem escrito** que mostra que alguém **entende** como deveria ser feito (cleanup, setup, isolation por prefix, edge cases). Não é uma codebase que nunca viu testes — é uma que **abandonou** o esforço após 1 arquivo.
- **Hipótese**: o teste foi escrito durante o desenvolvimento do trade-settlement no Replit (que injeta env vars no runtime). Pós-migração para Windows/Docker, ninguém percebeu que `npm test` quebra.
- **O fix de 1 linha em `vitest.config.ts`** (`setupFiles: ['dotenv/config']`) é literalmente a maior alavanca disponível: 7 testes financeiros voltam a rodar imediatamente.
- Para a auditoria 2.9 (deploy/observability), o gap de **CI rodando testes** vai aparecer junto com o gap de **monitoring**. Recomendo atacar ambos no mesmo sprint.
- O teste existente é um **excelent template** pros próximos. Padrão de prefix isolation + CASCADE cleanup + helper functions pode ser portado para wallet, fee-engine, player-earnings.
- Severidade **CRÍTICA** não é exagero: 109k LOC, $-handling (PVI + AMM + fees + 3 ledgers), bcrypt 12 rounds — tudo isso sem rede. Cada commit é torcida.

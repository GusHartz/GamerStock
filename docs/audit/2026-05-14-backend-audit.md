# Auditoria 2.2 — Backend Profundo

**Data**: 2026-05-14
**Escopo**: implementação de domínios críticos (Economy, Markets, Identity+Multigame) + transversais
**Método**: leitura cirúrgica + 3 sub-agentes Explore + greps quantitativos
**Output**: somente leitura — nenhum código foi modificado

---

## 1. Resumo executivo

GamerStock entrega um backend funcionalmente ambicioso (102 tabelas, 277 endpoints, 28 domínios) em 27 dias com qualidade arquitetural **acima da média** para esse ritmo. A camada AMM/PVI é matematicamente sólida, transações DB são usadas onde mais importam (wallet, fee-engine, trade-settlement), `bcrypt` está com 12 rounds, e tokens de reset usam SHA-256 com TTL 1h e single-use.

**Fraquezas concentradas em 3 áreas**: (i) **idempotência do fee_ledger** — sem UNIQUE constraint, double-settlement é possível em retry; (ii) **settlement de wallet fora da transação do trade** — gap de ~2ms onde divergência ledger↔balance pode ocorrer; (iii) **higiene de auth** — ausência de rate limiting, falta de `session.regenerate()` no login, e padrão de admin-check inconsistente (4 endpoints `/api/admin/*` usam check inline em vez do `isAdminOnly` middleware).

**Severidade geral: MÉDIA**. Nenhum bug crítico exploitável remotamente sem credenciais, nenhum SQL injection (Drizzle bem usado), nenhum auth-bypass total. Mas 2 achados P1 financeiros + 4 P2 de auth justificam ação antes de qualquer exposição além de localhost.

---

## 2. Top 10 achados críticos

### B2.2-1 [P1] — feeLedger sem UNIQUE constraint permite double-settlement
- **Arquivo:linha**: `shared/schema/treasury.ts:26-41`
- **Categoria**: idempotency / integrity
- **Descrição**: `fee_ledger` tem índices em `(referenceType, referenceId)` mas **nenhuma UNIQUE constraint**. Duas chamadas a `captureTradeFees()` com o mesmo `tradeId` inserem duas linhas em `fee_ledger`, creditam `system_wallets` em dobro, e disparam `accruePlayerEarnings()` duas vezes (apenas o `player_earnings_ledger` está protegido por UNIQUE em `(assetId, currency, referenceType, referenceId, direction)`).
- **Impacto**: retry de admin, webhook re-fire, ou bug de cliente que reposte o mesmo trade ⇒ platform_revenue overstated, system wallets em dessincronia com a verdade, reconciliação falha sem ferramenta para detectar.

### B2.2-2 [P1] — Settlement de wallet acontece FORA da transação do trade
- **Arquivo:linha**: `server/services/assetTradeExecutor.ts:211-233` e `server/services/tradeExecutor.ts:228-249`
- **Categoria**: race-condition / integrity
- **Descrição**: A `db.transaction()` que persiste `assetTrades`, atualiza `assetMarketState.supply`, debita `portfolio.balance` e captura fees commita primeiro (linha 209). **Só depois** chama-se `debitWallet()` numa segunda transação independente. Se o `debitWallet()` falhar (DB indisponível por 200ms, deadlock, validação de invariante), o trade está registrado e o portfolio rebalanceado, mas o `wallet_ledger_entries` não recebeu a baixa correspondente.
- **Impacto**: divergência permanente entre `wallets.balance` e o ledger; o usuário "ficou com o ativo sem pagar". Detectável só por reconciliação periódica — e atualmente **não existe job de reconciliação cross-ledger**.

### B2.2-3 [P2] — Zero rate limiting em endpoints de auth
- **Arquivo:linha**: `server/domains/identity/routes.ts:23-68` (signup), `:70-156` (login), `:264-307` (forgot-password)
- **Categoria**: security / abuse
- **Descrição**: greps `rateLimit|rateLimiter|throttle|express-rate-limit` retornam **zero matches** em todo o servidor. Signup retorna 409 quando email existe (enumeração trivial). Login aceita email ou displayName, sem throttle em falhas. Forgot-password retorna sempre 200 (anti-enum bom), mas permite spam de tokens.
- **Impacto**: enumeração de contas, brute-force de senha (12 rounds bcrypt ≈ 160ms cada — viável em horas para senhas fracas via paralelismo), DoS por flood de tokens de reset, abuso do endpoint público `POST /api/admin/auth/reset-password` (gateado por bootstrap secret, mas mesmo assim brute-forceável sem rate limit).

### B2.2-4 [P2] — `session.regenerate()` não é chamado no login bem-sucedido
- **Arquivo:linha**: `server/domains/identity/routes.ts:129-140`
- **Categoria**: security / session fixation
- **Descrição**: após `bcrypt.compare()` retornar true, o handler popula `req.session.userId`, `userRole`, etc. diretamente sem regenerar o session ID. Padrão clássico vulnerável a session fixation: atacante força a vítima a usar um session ID conhecido (via XSS, link malicioso, cookie injection), vítima loga, atacante reusa o session ID.
- **Impacto**: hijack de sessão se o atacante consegue plantar o session cookie antes do login. Em produção com HTTPS + `httpOnly` + `sameSite=lax` o risco cai bastante, mas o fix é trivial (1 chamada) e padrão da indústria.

### B2.2-5 [P2] — 7 endpoints `/api/admin/*` usam check inline em vez de `isAdminOnly` middleware
- **Arquivo:linha**:
  - `server/domains/admin/routes.ts:1036, 1044, 1052` (bots/status, bots/start, bots/stop) — usa `if (req.user?.role !== "admin" && req.session?.userRole !== "admin" && !req.session?.isAdmin)`
  - `server/domains/performance/routes.ts:103, 128, 158` (admin/performance/baselines, /player/:assetId, /match/:matchId) — **omite** `!req.session?.isAdmin` no OR, dependendo só de `userRole`
  - `server/domains/admin/routes.ts:365` (`/api/admin/me`) — sem check (intencional? retorna `{isAdmin:false}` se não for admin)
- **Categoria**: authorization / consistency
- **Descrição**: o gate global `adminAuth` em `server/routes.ts:100-103` deixa passar **qualquer usuário autenticado** para `/api/*` (não só admin). A discriminação admin acontece no middleware `isAdminOnly` por endpoint — 22 arquivos usam o middleware (~277 endpoints). Mas 7 endpoints `/api/admin/*` usam variações de check inline. Hoje os checks inline funcionam, mas: (a) o pattern inconsistente é landmine pra refactor; (b) os 3 endpoints de `performance/routes.ts` falham para sessões admin que tenham só `isAdmin=true` sem `userRole=admin` (situação possível se o flow de login mudar).
- **Impacto**: nenhum bypass atual confirmado, mas a fragilidade do padrão deixa o auth implícito em vez de explícito — qualquer dev que adicionar rota `/api/admin/*` esquecendo o middleware vai expor ao usuário comum.

### B2.2-6 [P2] — N+1 queries em endpoints admin de listagem (multigame)
- **Arquivo:linha**: `server/domains/multigame/routes.ts:1030-1059` (assets-under-review) + 4 endpoints análogos em `:1908-1912`, `:1932-1959`, `:2010-2012`, `:2142-2146`
- **Categoria**: performance
- **Descrição**: o handler de `/api/admin/dota2/assets-under-review` faz `Promise.all(baseQueue.map(async item => { ... 4 lookups por asset ... }))`. Para 50 assets na fila ⇒ ~400 queries sequenciais. Pattern repetido em 4 outros endpoints admin de listagem.
- **Impacto**: latência alta (segundos em fila de 50), pressão desnecessária no Postgres, gargalo escalonando. Não derruba o servidor, mas degrada UX admin e queima CPU/IO.

### B2.2-7 [P3] — settleMatchedTrade lê wallets antes de adquirir locks
- **Arquivo:linha**: `server/domains/trade-settlement/service.ts:236-260`
- **Categoria**: race-condition
- **Descrição**: linhas 238-239 fazem `SELECT` de buyer + seller wallets **sem** `FOR UPDATE`. Depois nas linhas 245-250 adquire locks por ID ascendente (deadlock prevention). A leitura inicial é stale — se outra thread modificar a wallet entre o SELECT e o lock, a validação de invariante em :255-260 usa um snapshot velho.
- **Impacto**: probabilidade baixa em produção single-instance, mas possível: settlement rejeita um caso válido, ou aceita um inválido (e.g., `lockedBalance` mudou entre SELECT e lock).

### B2.2-8 [P3] — valuationJob usa flag em memória sem try/finally garantido
- **Arquivo:linha**: `server/services/valuationJob.ts:292-327`
- **Categoria**: concurrency / availability
- **Descrição**: a guarda contra batches simultâneos é `valuationBatchRunning = true` no início e `= false` no fim. **Não está num try/finally garantido**. Se o processo crashar mid-batch (ou se `cluster mode` rodar 2 workers), a flag fica `true` e nenhum batch novo começa até reset manual.
- **Impacto**: parar valuation por horas/dias sem detectar (só logs). Sem corrupção de dados (upsert é idempotente), mas market fica com fair value stale.

### B2.2-9 [P3] — Steam OpenID realm derivado de Host header spoofável
- **Arquivo:linha**: `server/domains/multigame/routes.ts:1289-1303`
- **Categoria**: security / open redirect
- **Descrição**: o `realm` enviado para Steam OpenID é `host` derivado de `req.get("host")` (após cadeia de fallbacks Replit). Sem trusted proxy validation, header `X-Forwarded-Host` pode ser spoofado. Steam pode então construir um login URL que retorna para domínio do atacante.
- **Impacto**: phishing potencial via fluxo de Steam Connect. Mitigação parcial pelo gate `isAuthenticated` antes do start, mas o callback é público.

### B2.2-10 [P3] — Deduplicação de candidatos é analysis-only, não persistida
- **Arquivo:linha**: `server/domains/ingestion/services/candidateDeduplicationService.ts:1-62`
- **Categoria**: data-integrity / design-gap
- **Descrição**: o schema `prediction_event_candidates` não tem `canonicalCandidateId`/`duplicateOfCandidateId`/`dedupeStatus`. A função retorna `schemaSupportsPersistedDedupe: false`. Cada ciclo re-analisa os mesmos candidatos.
- **Impacto**: depende de salvaguarda downstream (UNIQUE em `assetMarkets(assetId, game)`?). Sem confirmar isso, o mesmo evento real pode entrar como 2 markets distintos.

---

## 3. Análise por cluster

### 3.1 Economy — Pontos por subdomínio

**`server/domains/wallet/`** (✅ sólido em isolamento)
- `repository.ts:37-48` faz `SELECT … FOR UPDATE` corretamente em todas as mutações
- `service.ts:135-314` usa `db.transaction()` em todas as ops (`credit`, `debit`, `lock`, `unlock`, `consumeLocked`)
- Validação de invariante de não-negatividade dentro da tx (`service.ts:176`), com CHECK constraint no schema (`shared/schema/wallet.ts:56`)
- Reconciliação existe (`reconciliation.ts`) — soma ledger vs balance. **Mas não há job periódico chamando.**

**`server/domains/fee-engine/`** (⚠️ duas dívidas de integridade)
- `_capture()` em `index.ts:62-141` faz tudo numa transação se o caller passar `tx` (linha 159-162) — ✅
- **Mas o `feeLedger` insert não tem UNIQUE constraint** (achado B2.2-1)
- `system_wallets` não têm idempotência protetiva — dois fee captures = double credit

**`server/domains/trade-settlement/`** (✅ majoritariamente sólido)
- `service.ts:236-260` é o único ponto frágil (achado B2.2-7)
- Settle usa lock-then-validate, exceto a leitura inicial fora de lock

**`server/domains/player-earnings/`** (✅ sólido)
- `service.ts:99` tem `ON CONFLICT DO NOTHING` no `playerEarningsLedger` — idempotência forte
- UNIQUE `(assetId, currency, referenceType, referenceId, direction)` no schema

**`server/services/tradeExecutor.ts` + `assetTradeExecutor.ts`** (⚠️ achado B2.2-2)
- Transação cobre persistência do trade + asset state + fee capture + portfolio update — ✅
- Mas settlement de wallet é commit-then-debit em transação separada — ❌
- Eventos disparados via `eventBus.emitBackground()` fora da tx (`assetTradeExecutor.ts:239, 241`) — aceitável (fire-and-forget intencional)

**Reconciliação cross-ledger**: **inexistente**. Os 3 ledgers (`wallet_ledger_entries`, `fee_ledger`, `player_earnings_ledger`) vivem em silos. Não há job/endpoint que asserta `sum(fee_ledger) == system_wallets.totals`. Achado B2.2-1 + B2.2-2 ficam invisíveis até alguém perguntar.

### 3.2 Markets — Pontos por subdomínio

**`server/services/ammPricing.ts`** (✅ excelente)
Auditei as 4 funções principais:
- `spotPrice(supply, p)`: clamps `supply < 0 → 0` antes do log; argument do `log` é sempre ≥ 1; resultado ≥ floorPrice ✅
- `costToBuy(supply, qty, p)`: clamps `qty ≤ 0`; usa primitiva da integral — matematicamente sound ✅
- `payoutToSell(supply, qty, p)`: clamp `qty > supply → qty = supply` evita supply negativo ✅
- `supplyForPrice(price, p)`: guard `price ≤ floor → 0`; exp() sempre positiva ✅
- Sem divisão por zero em qualquer função. Overflow improvável em range realista (supply ~10³).

**`server/services/pviEngine.ts` + `performanceEngine.ts`** (✅ bem feito)
- EMA com `alpha=0.18` (smoothing 82:18) — convergente, sem oscilação
- `clamp()` aplicado em PVI (0-100), fair value (MIN-MAX), z-score (-5, +5)
- `computeZScore()` em `performanceEngine.ts:229` guarda `std ≤ 0 → 0`
- `computeDivergence()` em `pviEngine.ts:304` guarda `fairValue ≤ 0 → 0`

**`server/services/triggerEngine.ts`** (⚠️ N+1 + race window)
- Loop a cada 3s. Achado N+1: itera 50 ordens pegando preço por asset numa query individual (`:139-153`). Otimizável com `inArray`.
- Race window: ordem reads → status update — janela de ~1-2ms onde cancel concorrente quebra. Tratado por `WHERE status="OPEN"` na UPDATE (idempotente), mas se trade executar **antes** do status flipa, fundos podem ser duplo-liberados.
- Sem retry/circuit breaker — se wallet trava 5s, loop trava 5s.

**`server/services/valuationJob.ts`** (⚠️ achado B2.2-8 + ✅ resto)
- Flag em memória sem try/finally
- `onConflictDoUpdate()` ⇒ idempotente em re-run
- try-catch por puuid (falha de um não quebra batch)
- Fair-value tem cap de ±1.5 por ciclo (smoothing intencional documentado — não é bug)

**`server/domains/market/`, `trading/`, `orders/`, `valuation/`**
- Rotas têm try/catch em todos os handlers
- `trading/routes.ts` é único arquivo que faz `db.transaction()` direto (`:1`) — corretamente
- `orders/routes.ts` (6 try/catch) registra trigger orders com validação Zod (5 schemas)
- `valuation/` é só read-model — sem mutações críticas

### 3.3 Identity & Multigame — Pontos por subdomínio

**`server/domains/identity/`** (⚠️ 2 P2 + ✅ resto)
- bcrypt 12 rounds ✅
- Token reset = `crypto.randomBytes(32).toString("hex")` (256 bits) com hash SHA-256 persistido ✅
- TTL 1h, single-use enforcement no flow ✅
- 2 dívidas: rate limit (B2.2-3) + session fixation (B2.2-4)
- Account enumeration via 409 vs 400 no signup (`:23-68`)

**`server/domains/multigame/`** (⚠️ N+1 + ⚠️ Steam realm + ✅ Zod-heavy)
- 79 schemas Zod (mais que qualquer outro domínio)
- 5 endpoints com N+1 (B2.2-6)
- Steam OpenID flow (B2.2-9)
- Padrão admin guard inconsistente entre `isAdminUser(req)` helper (recomendado) e `if (!req.session?.isAdmin)` raw (`routes.ts:2425, 2466, 2504, 2539`)

**`server/domains/performance/`** + **`server/domains/ingestion/`**
- Performance: 3 admin endpoints com check inline (B2.2-5)
- Ingestion: 25 try/catch, 53 Zod schemas. Dedup analysis-only (B2.2-10). Sem fallback PandaScore → OpenDota — falha de provider para um jogo, pulamos o ciclo daquele jogo.

### 3.4 Marginais (parágrafo cada)

**`prediction/`** (saindo via P-1, análise leve)
2 958 LOC em `service.ts`, 1 569 em `repository.ts`. Encontrei 3 `.catch(() => {})` silenciosos em `service.ts:1161, 2635, 2859` — todos no caminho "update order status to failed", intencionalmente best-effort para não cascade. Defensável. Domínio inteiro fica isolado do resto (zero FK para users/assets); financeiro mora em `wallet.ledgerEntries`. Saída via P-1 (remoção do produto) parece factível sem desentanglement profundo.

**`arena/`** (provável saída via P-5, mas limpo)
822 LOC de routes, 21 try/catch, 23 isAdminOnly usages. `arenaBootstrap.ts` usa `sql.raw()` 6 vezes — analisei: TODAS com strings de `REQUIRED_TABLES`/`CRITICAL_COLUMNS` (constantes hardcoded), não user-controlled. **Não é SQL injection**, é só código não-idiomático para o resto da codebase. Cosmético.

**`discovery/`** (10 handlers, 16 try/catch, 4 Zod, 666 LOC)
Watchlist + signals. Spot-check: handlers consistentes, validation leve mas adequada para read-only endpoints.

**`news/` (35 LOC), `system/` (19 LOC), `media/` (135 LOC), `synthetic/` (48 LOC), `player-public/` (69 LOC), `player-hub/` (161 LOC)**
Todos minúsculos. Nada gritante. `system/` só tem health/version. `news/` delega tudo para `newsService.ts`. `media/` usa multer com `memoryStorage()` (sem disk paths — OK em Windows). `player-public/` é read-only com 2 endpoints.

**`player-operator/`** (387 LOC, 16 try/catch)
Confirmei: 15 handlers reais (`app.get/post/patch`). O `requireOperatorAccess` middleware (`routes.ts:38+`) gating é razoável — verifica claim aprovado ou operator_access entry. Admin bypass intencional (debugging). Upload via multer `memoryStorage` com `fileSize: 10MB`.

---

## 4. Achados transversais

### Error handling
- **24 `db.transaction()` em 15 arquivos** — concentrado em wallet, fee-engine, trade-settlement, trading, multigame, modules/draft, services. Coverage adequado para os caminhos críticos, ausente onde devia (settlement de wallet pós-trade — B2.2-2).
- **50 `.catch()` handlers**: a maioria captura e propaga ou loga. Apenas 3 swallowers reais (`prediction/service.ts:1161, 2635, 2859`), todos intencionais best-effort no caminho "marcar ordem como failed quando algo deu errado". Aceitável.
- **Padrão de error inconsistente** — alguns retornam `{message}`, outros `{error}`, outros `{success: false, detail}`. Sem norma unificada.

### Validação de input — Zod por domínio
Distribuição assimétrica (contagem de `z.object/z.string/z.number/z.array/safeParse/.parse`):

| Domínio | Hits Zod | Avaliação |
|---|---:|---|
| multigame | 79 | ✅ excelente |
| prediction | 59 | ✅ excelente |
| ingestion | 53 | ✅ excelente |
| wallet | 6 | ⚠️ baixo para financeiro |
| trading | 5 | ⚠️ baixo para financeiro |
| orders | 5 | ⚠️ baixo para financeiro |
| arena | 5 | OK |
| media, discovery | 4 cada | OK |
| valuation, trade-settlement, terminal, system, synthetic | **0** | ⚠️ sem validação Zod |

**Domínios financeiros (wallet, trading, orders) têm validação subótima.** Os endpoints recebem `req.body` e fazem checks ad-hoc (`if (!amount || amount <= 0)`). Não é falha de segurança em si (Drizzle ainda blinda SQL), mas é fonte de bugs de borda (NaN, strings vs numbers, decimal precision).

### Autorização
- 4 endpoints `/api/admin/*` com check inline em vez de `isAdminOnly` middleware (B2.2-5)
- Padrão `isAdminUser(req)` helper vs `req.session?.isAdmin` raw — coexistem dentro do `multigame/routes.ts`
- Nenhum endpoint que pareça público mas devesse ser autenticado (publicPaths whitelist parece intencional)

### Transações DB
- Gap identificado em B2.2-2 (settlement de wallet)
- Demais usos parecem corretos
- **Zero `db.transaction()` em `prediction/`** — embora o serviço tenha 2 958 LOC. Provavelmente faz updates atômicos via SQL único? Ou tem holes? **Não auditei profundamente** — domínio sai via P-1.

### Concorrência
- `FOR UPDATE` aplicado em wallets (✅)
- N+1 em triggerEngine assetId loop (P3)
- valuationBatch flag in-memory sem try/finally (P3)
- Settlement read-then-lock window (P3)
- Sem locks distribuídos — assume processo único (CHECK isso antes de cluster mode)

### SQL injection
- **114 usages de `sql\`...\``** (template literal) — Drizzle parametriza ⇒ seguro
- **6 usages de `sql.raw()`** em `server/services/arenaBootstrap.ts` (linhas 37, 44, 51, 106, 339, 343) — TODAS com strings hardcoded de `REQUIRED_TABLES`/`CRITICAL_COLUMNS`/seed Statements. **Não exploitable**, apenas inconsistente com o resto.
- Veredito: **zero SQL injection** real no codebase.

### Fire-and-forget
- 2 em `assetTradeExecutor.ts:239, 241` (events, arena update) — intencional
- Vários `.catch(() => null)` em endpoints admin (`admin/routes.ts:784-785`, `identity/routes.ts:199`, etc.) — fallback para dados opcionais, OK
- Schedulers todos `.catch(...)` no nível mais externo — não derrubam o boot

---

## 5. Os 2 god files críticos

### `server/domains/multigame/routes.ts` — 2 563 LOC

**17 blocos lógicos identificados** (cabeçalhos `// ───`):

| Linhas | Bloco | Modularizável? |
|---|---|---|
| 1-100 | Header + auth middleware + Zod schemas | sim → `validation.ts` |
| 156-221 | ConnectedAccounts CRUD | sim → sub-router |
| 223-268 | PlayerProfiles CRUD | sim → sub-router |
| 270-435 | Dota2 + CS2 onboarding | sim → sub-router |
| 474-787 | Dota2 pipeline (sync, score, perf, valuation) — **313 LOC, maior bloco** | sim → 2-3 sub-routers |
| 816-865 | Public terminal assets | sim → sub-router público |
| 880-916 | Listing readiness | sim |
| 935-1019 | CS2 valuation pipeline | sim |
| 1023-1073 | Admin: assets-under-review (com N+1) | sim → admin sub-router |
| 1079-1260 | Admin: listing approval/rejection | sim |
| 1260-1470 | Steam OpenID verification | sim → `steam-verification.ts` |
| 1470-1824 | Dota2 submissions + claims | sim → sub-router |
| 1875-2001 | Asset discovery | sim |
| 2001-2270 | Admin views (claims, ops, troubleshooting) | sim |
| 2402-2563 | Admin bootstrap + enrichment | sim |

**Potencial de modularização: ALTO**. Sem dependências circulares aparentes. Estimativa: 2-4h para 8-10 sub-routers, mantendo `registerMultigameRoutes(app)` como facade.

**Responsabilidades misturadas**: legítimas — domínio multigame integra 3 jogos (Dota2, CS2, ligação Steam) + admin tooling + público + onboarding + claims. É grande porque o produto é grande, não porque está mal escrito.

### `server/domains/multigame/repository.ts` — 2 183 LOC

**11 blocos lógicos** organizados por entidade (mais limpo que o routes):

| Linhas | Bloco | Notas |
|---|---|---|
| 65-93 | ConnectedAccounts | simples |
| 95-200 | PlayerProfiles + EligibilitySnapshots | |
| 300-600 | PlayerMatchSourceData (bulk upsert + lookups) | |
| 600-800 | PlayerMatchAnalytics | |
| 800-1000 | Performance baselines + weights + scores | extrair? |
| 1000-1200 | Dota2 valuation state + history | extrair? |
| 1200-1400 | Asset ownership + listing reviews | extrair? |
| 1400-1600 | Terminal assets + markets read model | |
| 1600-1800 | Dota2 claim requests | |
| 1800-2000 | Verification events + account state | |
| 2000-2183 | Listing submissions + helpers (catch-all) | |

**Potencial de modularização: MÉDIO**. Já está bem organizado internamente por seção. Splitting cria 11 arquivos de ~200 LOC. Trade-off: mais arquivos vs cognitive load atual. Alternativa preferível: manter monolítico, **adicionar barrel** que re-exporta funções de sub-módulos internos.

**Sem antipatterns no repository em si** — as queries são todas Drizzle-style, parametrizadas, com `onConflictDoUpdate` correto. O N+1 do achado B2.2-6 **vive na camada de routes** chamando o repository em loop, não no repository.

---

## 6. Quantitativos

| Métrica | Valor |
|---|---:|
| Total LOC backend (server/) | ~80k (estimativa de 109k total - frontend ~25k - shared ~4k) |
| `db.transaction(` total | **24** |
| Arquivos com `db.transaction(` | **15** |
| try/catch blocks (todos os domínios) | 392 |
| `.catch()` handlers | 50 |
| Silent `.catch()` (engole intencionalmente) | **3** (prediction/service.ts) |
| Endpoints HTTP totais | ~277 |
| Endpoints `/api/admin/*` com `isAdminOnly` middleware | ~70 |
| Endpoints `/api/admin/*` com check inline | **7** (3 perf + 3 bots + admin/me) |
| Endpoints com auth bypass real | **0** |
| Zod schemas total | ~270 (multigame 79 + prediction 59 + ingestion 53 + outros ~80) |
| Domínios financeiros com Zod < 10 | **3** (wallet, trading, orders) |
| `sql\`...\`` template literals (Drizzle, parametrizadas) | 114 |
| `sql.raw()` calls | **6** (todos com strings hardcoded em `arenaBootstrap.ts`) |
| Raw SQL injection real | **0** |
| N+1 patterns identificados | **6** (5 multigame admin endpoints + 1 triggerEngine) |
| Race conditions identificadas | **3** (wallet settlement gap, settle read-before-lock, trigger order claim window) |
| Idempotency holes | **2** (fee_ledger sem UNIQUE, assetTrades sem UNIQUE) |
| Rate limit configurado | **0** |
| `req.session.regenerate()` calls | **0** |

---

## 7. Recomendações de prioridade (Top 5)

| # | Ação | Justificativa | Effort estimado |
|---|---|---|---|
| **1** | Adicionar UNIQUE `(referenceType, referenceId)` em `fee_ledger` + idempotência em `assetTrades` | B2.2-1. Bloqueia double-settlement em qualquer cenário de retry. Migration + 0 código novo | 1h |
| **2** | Mover `debitWallet` / `creditWallet` para **dentro** da transação de trade em `assetTradeExecutor.ts` e `tradeExecutor.ts` | B2.2-2. Elimina a janela de divergência ledger↔balance. Requer refator do `walletService.debitWallet` para aceitar `tx` opcional | 3-4h |
| **3** | `express-rate-limit` em `/api/auth/{signup,login,forgot-password,reset-password}` + `/api/admin/login` + `/api/admin/auth/reset-password` | B2.2-3. Bloqueia enumeração e brute force. ~5 linhas + middleware | 30min |
| **4** | `req.session.regenerate()` no flow de login (identity, admin, signup) | B2.2-4. Session fixation. Padrão industry-standard | 30min |
| **5** | Padronizar TODOS os endpoints `/api/admin/*` em `isAdminOnly` middleware (deletar checks inline em performance/, bots/, admin/me) | B2.2-5. Auth se torna explícito; reduz risco de regressão em PRs futuros | 1h |

**Total estimado para fechar Top 5**: ~6-7h de trabalho.

---

## 8. Score subjetivo de qualidade

Escala 0-10. Critério: correção + segurança + manutenibilidade + idiomaticidade.

| Cluster | Score | Observação |
|---|---:|---|
| Economy (wallet + fee-engine + settlement + player-earnings) | **7.0** | Transações onde precisam, FOR UPDATE em wallets. Mas 2 P1 (B2.2-1, B2.2-2) e zero reconciliação cross-ledger. |
| Markets (AMM + PVI + valuation + triggerEngine) | **8.0** | Math sólida, sem div/0, idempotência em batches. Operacional não-crítico (N+1, lock in-memory). |
| Identity | **6.5** | bcrypt + token design corretos. Mas sem rate limit, sem session.regenerate, account enumeration via 409. |
| Multigame | **6.5** | Zod-heavy, repository bem organizado. Mas god file routes (precisa modularização), 5 endpoints com N+1, auth pattern inconsistente, Steam realm spoofável. |
| Ingestion | **7.0** | Já corrigimos eager init. Dedup é analysis-only (gap), sem fallback de provider. |
| Performance + Valuation (read-side) | **8.0** | Funções puras corretas. 3 admin endpoints com check inline. |
| Marginais (arena, discovery, news, system, media, synthetic, player-*) | **7.5** | Pequenos, limpos. Único smell: `sql.raw` em arenaBootstrap (cosmético). |
| **Total backend** | **7.1** | Acima da média para MVP de 27 dias. Dívidas concentradas em 5-7 lugares conhecidos, todas fixáveis sem rewrite. |

---

## Notas finais

- Esta auditoria foi feita por leitura e não por execução de testes. Cenários como "duas requests concorrentes no mesmo wallet em produção" foram avaliados pela leitura do código + schema, não por load test.
- Domínios marginais foram apenas spot-checked. Se algum deles vier a escalar (e.g., `arena` em P-5), merece nova passada.
- `prediction/` (2 958 LOC) só foi tocado superficialmente — fora de escopo conforme briefing (saída via P-1).
- Para uma auditoria de **segurança** dedicada (XSS, CSRF, headers, CORS, helmet), recomendo execução separada (será Task #7, escopo 2.6).

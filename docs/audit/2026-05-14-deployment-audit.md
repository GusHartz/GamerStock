# Auditoria 2.9 — Deploy e Observabilidade

**Data**: 2026-05-14
**Escopo**: infra de deploy, health checks, backup, CI/CD, logs, error tracking, secret mgmt em runtime, graceful shutdown, migrations, connection pool, env vars, monitoring, multi-env, docs, disaster recovery
**Método**: greps de inventário + leitura cirúrgica de `server/index.ts`, `db.ts`, `script/build.ts`, `docker-compose.yml`, `package.json` scripts, `README.md`
**Output**: somente leitura

---

## 1. Resumo executivo

GamerStock **não tem postura de produção em nenhum eixo operacional**. Zero Dockerfile, zero CI/CD, zero workflow `.github/`, zero pre-commit hooks, zero pino/winston/sentry/datadog. Zero signal handlers (SIGTERM/SIGINT/uncaughtException/unhandledRejection). Zero compression middleware. Zero env validation centralizada (cada módulo throw ad-hoc). Zero backup automatizado (já S-9). Health check é único linha que retorna `{ok, env, time}` sem checar DB nem nada externo.

O que **existe** é mínimo viável de **dev local Windows pós-migração**: `docker-compose.yml` para Postgres, script `build.ts` esbuild+Vite que gera `dist/index.cjs` (nunca executado nesta máquina — `dist/` não existe), `package.json` com 6 scripts cruzados (`dev`, `build`, `start`, `check`, `db:push`, `test`). `README.md` é marketing copy de 56 linhas sem instruções de setup, deploy ou env vars.

**Inferência crítica**: o sistema foi desenhado para **Replit autoscale** (`.replit:24 deploymentTarget = "autoscale"`), que gerencia process supervision, env injection, restart, e logs via plataforma. Removido isso, **não há substituto**. Quem for tentar rodar isso em qualquer host genérico (Docker, VPS, Render, Railway) precisa **construir tudo do zero**: image, healthchecks, secret injection, log shipper, monitoring.

**Severidade geral: CRÍTICA para qualquer plano de produção**. Não é "ruim" — é "ausente". Para uso local atual (single-user, Windows, Docker Postgres), tolerável; para qualquer exposição além disso, blocking.

---

## 2. Top 10 achados

### B2.9-1 [P0] — Sem signal handlers: SIGTERM mata processo mid-request
- **Arquivo:linha**: `server/index.ts:73-132` — boot loop completo, **zero `process.on('SIGTERM'|'SIGINT'|'uncaughtException'|'unhandledRejection')`**
- **Categoria**: deployment-blocker / data-loss-risk
- **Descrição**: greppei `process.on(` em todo `server/` → **zero matches**. Em container/Docker/Kubernetes, deploy = `kill -15 <pid>`. Sem SIGTERM handler, o processo morre imediato. **Riscos concretos**:
  - request em progress no meio de `db.transaction()` → rollback automático do Postgres, OK
  - request HTTP no meio de `res.write()` → cliente recebe response cortada
  - SSE/WS connections → connection drop sem `wss.close()` → clients ficam pendurados até timeout
  - scheduler em meio de `runValuationBatch()` → flag em memória `valuationBatchRunning = true` fica para sempre (já em B2.2-8) — próximo container restart **não consegue rodar batch nenhum**
  - pool Postgres não-drainado → conexões zombie no DB lado até timeout
- **Impacto**: cada deploy ou restart é uma roleta. Em produção com 2+ instâncias rolling, sempre tem cliente em request quando o sinal chega.

### B2.9-2 [P1] — Health check é cosmético (não verifica DB nem dependencies)
- **Arquivo:linha**: `server/index.ts:42-45`
  ```ts
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, env: process.env.NODE_ENV || "unknown", time: ... });
  });
  ```
- **Categoria**: operational-blindness
- **Descrição**: retorna 200 mesmo se:
  - Postgres está offline (`testDbConnection()` é só logado, não bloqueia boot)
  - Scheduler crashou em loop
  - Pool exhausted
  - PandaScore/Riot APIs down
- **Impacto**: load balancer ou Kubernetes probe vê health verde mesmo com sistema disfuncional. **Falsa segurança operacional**.

### B2.9-3 [P1] — Sem Dockerfile, sem `.dockerignore` (artefato de deploy não-existe)
- **Categoria**: deployment-blocker
- **Descrição**: greppei root → **zero arquivos `Dockerfile*`, zero `.dockerignore`**. `docker-compose.yml` atual roda apenas o Postgres (D-fix). Para deploy real em qualquer host de container, precisa:
  - Dockerfile multi-stage (build → runtime)
  - `.dockerignore` excluindo `node_modules`, `dist`, `.env`, `attached_assets/` (24 MB), `.local/`
  - Healthcheck no Dockerfile
  - `USER node` (não root)
  - Cache mount para `npm ci`
- O `script/build.ts` produz `dist/index.cjs` + `dist/public/` — pode ser embedded em image. Mas a image em si **não existe**.

### B2.9-4 [P1] — Zero CI/CD, zero pre-commit hooks
- **Categoria**: process-blocker
- **Descrição**: confirmado via `ls`:
  - `.github/workflows/` — ❌ ausente
  - `.gitlab-ci.yml`, `.circleci/`, `azure-pipelines.yml`, `Jenkinsfile`, `bitbucket-pipelines.yml` — ❌ todos ausentes
  - `.husky/`, `.pre-commit-config.yaml`, `lint-staged` em package.json — ❌
  - ESLint, Prettier — ❌ (S-4)
- **Impacto**: Nenhuma proteção entre commit e deploy. Combinado com B2.8 (zero testes executando), cada PR é torcida.

### B2.9-5 [P1] — 771 `console.log/error/warn` em 92 arquivos, sem logger estruturado
- **Categoria**: observability / log-quality
- **Descrição**: confirmado via grep:
  - 92 arquivos contém `console.*` calls
  - 771 chamadas totais
  - Zero `pino`, `winston`, `bunyan`, `logtape` nas deps
  - Format: human-readable strings (`[BOOT] ...`, `[AUTH/Login] ...`)
  - Sem level por env, sem correlation ID, sem request ID, sem JSON
- **Impacto**:
  - Em prod stdout vai pra Docker logs → log aggregator (se houver) precisa parsear texto livre
  - Sem level dinâmico — `console.error` continua mesmo em prod
  - Sem correlação entre logs de uma request única (não dá pra rastrear bug específico)
- Combinado com **B2.6-1** (logger middleware faz `JSON.stringify` de toda response em `/api/*`), o volume de log é alto AND não-estruturado.

### B2.9-6 [P1] — Connection pool sem limites (B2.9-fix essencial)
- **Arquivo:linha**: `server/db.ts:13`
  ```ts
  export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  ```
- **Categoria**: scalability-blocker
- **Descrição**: usa **defaults de pg-pool**:
  - `max: 10` (10 connections concorrentes)
  - `idleTimeoutMillis: 10000` (idle 10s)
  - `connectionTimeoutMillis: 0` (espera indefinida para nova connection)
  - **`statement_timeout: undefined`** — nenhum statement tem timeout
  - **`query_timeout: undefined`** — query individual sem timeout
- **Impacto**:
  - **10 connections** é trivial saturar (1 admin lista grande + 20 schedulers + algumas request = pool exhausted)
  - **Sem statement_timeout** = query lenta segura connection indefinidamente. Combina com B2.7-3 (path-to-regexp DoS) — atacante pode segurar todas as 10 connections
- Recomendação: `max: 20-30`, `idleTimeoutMillis: 30000`, `statement_timeout: 30000` (30s).

### B2.9-7 [P2] — Sem error tracking (Sentry/Datadog/etc.)
- **Categoria**: observability
- **Descrição**: greppei `@sentry|datadog|newrelic|opentelemetry|bugsnag|rollbar|prom-client` → **zero**. Erros 500 em prod só aparecem em stdout. Combinado com B2.9-5 (logs não-estruturados) e B2.9-8 (sem alertas), **errors em produção são invisíveis** até alguém grep manualmente os logs.
- **Impacto**: tempo de detecção de incident = tempo até user reclamar.

### B2.9-8 [P2] — Sem monitoring/alerting de qualquer tipo
- **Categoria**: observability
- **Descrição**:
  - Zero métricas de aplicação (sem `prom-client`, sem custom counters)
  - Zero latência tracking
  - Zero DB query metrics
  - Zero custom business metrics (trades/min, MRR, etc.)
  - Zero alert routing (Slack/email/PagerDuty)
  - Zero dashboards (Grafana, etc.)
- **Impacto**: sem visibilidade contínua. Em audit anterior identificamos coisas como "logger captura toda response" — em prod isso só é detectável manualmente.

### B2.9-9 [P2] — Build allowlist em `script/build.ts:8-34` lista 11 packages que não existem
- **Arquivo:linha**: `script/build.ts:8-34`
- **Categoria**: dead-config / code-debt
- **Descrição**: o array `allowlist` controla quais packages são **bundled** (vs externalized) no `dist/index.cjs`. Lista 26 packages incluindo:
  - `cors` ❌ não em package.json
  - `express-rate-limit` ❌
  - `nodemailer` ❌
  - `stripe` ❌
  - `@google/generative-ai` ❌
  - `openai` ❌
  - `jsonwebtoken` ❌
  - `uuid` ❌
  - `nanoid` ❌
  - `xlsx` ❌
  - `axios` ❌
- **Impacto**: não-funcional (filter ignora entries que não existem), mas é **smell de copy-paste template**. Indica que o build script veio de outro projeto. Pode esconder bugs reais (ex: pacote que deveria ser bundled mas não está na lista).

### B2.9-10 [P3] — `README.md` é marketing copy (56 linhas), zero docs operacionais
- **Categoria**: documentation
- **Descrição**: README.md atual:
  - "Performance creates value. The market creates price."
  - Lista 4 engines + 6 tech stack items + future vision (web3 etc.)
  - **Zero**: como subir local, como fazer deploy, como rodar testes, env vars necessárias, troubleshooting
- **`replit.md`** (100KB / 1310 linhas) tem boa parte do conhecimento operacional, mas é **log de agente AI**, não runbook estruturado
- Novo dev levaria 1-2 dias para descobrir o que `docs/audit/` já mapeia.
- **Impacto**: bus-factor 1 (só você sabe rodar).

---

## 3. Análise por área

### 3.1 Deployment infrastructure

| Item | Estado |
|---|---|
| Dockerfile | ❌ ausente |
| Multi-stage build | ❌ |
| `.dockerignore` | ❌ |
| `docker-compose.yml` | ✅ existe (só Postgres) |
| `docker-compose.prod.yml` | ❌ |
| Build process | `script/build.ts` esbuild+vite → `dist/index.cjs` + `dist/public/` |
| Build size | desconhecido (`dist/` não existe na máquina; bundle estimado ~5-10 MB para CJS) |
| Process manager | ❌ Não usa PM2, systemd, nem similar. `npm start` direto via `node dist/index.cjs` |
| Port binding | `0.0.0.0:5000` (já fixado em D-7, sem `reusePort`) |
| Network exposure | depende de host — sem reverse proxy declarado |
| `script/build.ts:8-34` allowlist | 11 packages não-existentes (B2.9-9) |

### 3.2 Health checks

`server/index.ts:42-45`:

```ts
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, env: process.env.NODE_ENV || "unknown", time: new Date().toISOString() });
});
```

**Limitações**:
- ❌ Não verifica `pool.query("SELECT 1")` antes de retornar
- ❌ Não distingue **liveness** (processo vivo) de **readiness** (pode receber tráfego)
- ❌ Não checa schedulers (poderiam estar todos crashados)
- ❌ Não checa external dependencies (Riot, PandaScore, Steam)
- Registrado SYNCHRONOUSLY antes de `await registerRoutes()` (linha 43) — então responde mesmo durante boot, **antes do DB conectar**

**`/api/version`** existe via `system/routes.ts:9-13` — retorna `{buildId, buildTime, environment}` — info-disclosure menor (B2.6 já flagged).

### 3.3 Backup automatizado

❌ **Inexistente** (S-9, B2.4-backup-zero confirmados em 2.4).

- Sem `pg_dump` em algum cron
- Sem snapshot da volume Docker (`gamerstock_pgdata`)
- Sem script `backup.sh` no repo
- Sem documentação de recovery
- `docker compose down -v` apaga TODO o estado em 1 comando

**Recovery atual**: rodar `db:push` + `prod-bootstrap.ts` + esperar que dados sejam recreados a partir das fontes externas (Riot/PandaScore). Para wallets, ledgers, trades = **perda total e irreversível**.

### 3.4 CI/CD

❌ **Totalmente ausente** (confirmado em B2.9-4):
- `.github/`, `.gitlab/`, `.circleci/`, `azure-pipelines.yml`, `Jenkinsfile`, `bitbucket-pipelines.yml`
- `.husky/`, `lint-staged`, `pre-commit`
- ESLint, Prettier, EditorConfig

**Deploy manual presumido**: `git push` → SSH ao host → `git pull` → `npm install` → `npm run build` → `npm start` (ou equivalente Replit autoscale antigo).

Não há nenhum trigger que rode testes, lint, type-check (`npm run check` = `tsc` existe mas nunca é forçado) antes de deploy.

### 3.5 Logs estruturados

❌ **Inexistente**:
- **771 chamadas `console.*`** em **92 arquivos** (grep direto)
- Zero libs estruturadas (`pino`, `winston`, etc.)
- Format: human-readable strings com prefix `[Subsystem]`
- Sem level dinâmico (`console.error` sai sempre)
- Sem correlation ID, sem request ID, sem trace context
- Logger middleware (B2.6-1) faz `JSON.stringify(responseBody)` para cada `/api/*` — então **alguns** logs são JSON-shaped, mas o resto não

**Sample de log line atual**:
```
1:15:42 PM [express] POST /api/auth/login 200 in 250ms :: {"success":true,"user":{"id":"...","email":"..."}}
[BOOT] HTTP server listening on port 5000
[AUTH/Login] FAIL — wrong password for userId=... email="..."
```

Não há parseabilidade automática. Tail manual ou grep é a única ferramenta.

### 3.6 Error tracking / APM

❌ **Zero** — confirmado em B2.9-7.

- Sem Sentry, Datadog APM, New Relic, Bugsnag, Rollbar
- Sem OpenTelemetry tracer
- Sem prom-client metrics
- Sem `process.on('uncaughtException')` — uncaught throw mata o processo silently (modulo Node logging que é mínimo)
- Sem `process.on('unhandledRejection')` — promise rejeitada não-catchada vira só `(node) UnhandledPromiseRejectionWarning` em stderr

### 3.7 Secret management em produção

**Como `.env` chega ao deploy?** Não documentado. Assumindo:
- Replit (legado): `[userenv.shared]` em `.replit` + Replit Secrets injetava env vars
- Hoje: **desconhecido**. Você mantém `.env` manualmente no host? Cria via SSH/SCP?

**Validação de presença** — fragmentada:
- `server/db.ts:7`: throw se `DATABASE_URL` ausente
- `server/auth/session.ts:12`: throw se `SESSION_SECRET` ausente
- `server/domains/admin/routes.ts:130-136`: throw se `ADMIN_USER`/`ADMIN_PASS` ausentes (D-9)
- `server/routes.ts:117`: throw se `ADMIN_BOOTSTRAP_EMAIL` ausente (D-9.6)
- Resto: usa `|| default` ou `?? null` → app sobe mesmo sem env vital

**Não há validação centralizada** (e.g., zod schema validando `process.env` no boot).

**Secret rotation**: nenhum mecanismo. Rotation manual via edit `.env` + restart.

**Secret manager** (Vault, AWS SM, GCP Secret Manager, etc.): **zero**.

### 3.8 Graceful shutdown

❌ **Inexistente** — B2.9-1.

- Zero `process.on('SIGTERM')`, `process.on('SIGINT')`, `process.on('uncaughtException')`, `process.on('unhandledRejection')`
- **1 cleanup encontrado**: `server/simulation/bots/bot-trader.ts:620` faz `clearTimeout(workerTimer)` — mas isso é para reset interno do scheduler de bot, não shutdown handler
- 20 schedulers (do 2.1) — nenhum exposta uma função `stop()` que seja chamada em sinal
- Postgres pool não é `await pool.end()` em shutdown
- WebSocket server não fecha gracefully

### 3.9 Database deploy / migrations

**Migrations strategy** (confirmado em 2.4):
- 1 SQL consolidada `migrations/0000_chubby_lenny_balinger.sql` (263 statements, 64 KB)
- 1 migration TypeScript ad-hoc `server/migrations/bulkCs2PriceProjection.ts` (38 KB, embute 800 preços)
- **`drizzle-kit push`** (não `migrate`) usado em prod via `server/scripts/prod-bootstrap.ts:48`:
  ```ts
  execSync("npm run db:push", { stdio: "inherit", timeout: 90_000 });
  ```

**Risco**: `db:push` sincroniza schema sem gerar migration. **Drift entre schema TS e DB** acumula sem histórico. Rollback impossível sem `pg_dump` prévio (não-existente).

**`server/scripts/prod-bootstrap.ts`**:
- Não está em `package.json` scripts (precisa rodar manualmente: `npx tsx server/scripts/prod-bootstrap.ts`)
- Executa: schema push → markets canonicais → dota2 assets (~800 via OpenDota) → prediction markets → display queue → state report
- Idempotente (skip if data exists)
- Falha em qualquer etapa **não derruba o boot** porque é executado **uma vez fora** do boot

### 3.10 Connection pooling

`server/db.ts:13`: `new Pool({ connectionString: process.env.DATABASE_URL })` — **defaults pg-pool**:
- max: 10
- idleTimeoutMillis: 10000
- connectionTimeoutMillis: 0 (espera indefinida)
- **statement_timeout: undefined** ← CRÍTICO
- **query_timeout: undefined** ← CRÍTICO

10 connections concorrentes é apertado para:
- 20 schedulers que rodam queries
- Logger middleware (cada request faz queries diversas)
- Trade execution (transações)
- Health probes (se forem instaladas no futuro)

Sem `statement_timeout`, uma query travada (e.g., lock waiting) segura connection indefinidamente.

### 3.11 Environment variables

**Total**: 36 vars únicas consumidas (do 2.1/2.5).

**Validação no boot** (estado fragmentado):
- `DATABASE_URL` → throws (db.ts:7-11)
- `SESSION_SECRET` → throws (auth/session.ts:12-16)
- `ADMIN_USER`, `ADMIN_PASS` → throws (admin/routes.ts:130-136, D-9)
- `ADMIN_BOOTSTRAP_EMAIL` → throws (routes.ts:117, D-9.6)
- `REPL_ID` → opcional (gating)
- `RIOT_API_KEY`, `PANDASCORE_API_KEY`, `STEAM_WEB_API_KEY` → opcional (features degradam)
- Resto: defaults

**`.env.example` existe** ✅ (D-4) — documenta 18+ variáveis com exemplos.

**Validação centralizada** (envalid, zod, joi): ❌ ausente.

### 3.12 Monitoring / métricas

❌ **Zero**.

- Sem `prom-client` ou métrica custom alguma
- Sem latency tracking interno
- Sem DB query metrics
- Sem business metrics (trades/min, MRR, active users)
- Sem alert routing
- Sem dashboards (Grafana, etc.)
- A única "observabilidade" disponível é grepping logs.

### 3.13 Multi-environment

- Variável `NODE_ENV` usada em ~20 lugares (`server/index.ts:43, 74, 108`, etc.)
- Lógica condicional em vários pontos:
  - `cookie.secure: process.env.NODE_ENV === "production"` (auth/session.ts:43)
  - `if (process.env.NODE_ENV === "production") serveStatic(app); else setupVite(...)` (index.ts:107-113)
  - `riot-perf.ts:428`: `INITIAL_DELAY_MS = ... === "production" ? 30_000 : 2 * 60 * 1000`
  - Schedulers gate por env (`bot guard`, etc.)
- **`dev` / `staging` / `production`**: só 2 desses são checados explicitamente. `staging` não é conceito presente. Sem `.env.staging` ou `.env.production`. Todos os secrets vivem em **1 só `.env`**.

### 3.14 Documentation

| Doc | Estado |
|---|---|
| `README.md` | 56 linhas, marketing copy. **Zero setup, zero deploy, zero env vars.** |
| `replit.md` | 100KB / 1310 linhas — log do agente Replit. Tem conhecimento operacional mas é "stream of consciousness", não runbook |
| `docs/architecture/` | **35 markdowns** de qualidade variável (B2.4 viu como log de evolução, não doc canônica) |
| `docs/economy/` | 2 markdowns explicando wallet/ledger e trade settlement |
| `docs/product/` | 2 markdowns sobre player-claim system |
| `docs/audit/` | 9 (com este) — alta qualidade, propositivos |
| `CONTRIBUTING.md` | ❌ ausente |
| `DEPLOY.md` | ❌ ausente |
| `RUNBOOK.md` | ❌ ausente |
| Architecture diagrams | ❌ ausentes (textual em md) |
| Onboarding clarity (novo dev) | ⚠️ baixo — vai precisar do `.env.example` + dos docs audit + ler `replit.md` por horas |

### 3.15 Disaster recovery

❌ **Não-existente como processo formal**.

| Item | Estado |
|---|---|
| RTO (recovery time objective) | indefinido |
| RPO (recovery point objective) | indefinido |
| DR plan documentado | ❌ |
| Backup procedure | ❌ |
| Restore procedure | ❌ |
| Tabletop drill | ❌ |

**Cenários de DR**:
- **DB volume corromper**: perda total. `docker compose down -v && docker compose up -d && npm run db:push && npx tsx server/scripts/prod-bootstrap.ts` recria schema vazio + dados externos. Wallets/ledgers/trades = perda permanente.
- **Servidor host morrer**: re-clone repo + setup do zero (D-fix steps inteiros). Recovery time = horas, com perda de uptime.
- **Deploy ruim**: sem rollback automático. Manual: `git revert` + redeploy.

---

## 4. Quantitativos

| Métrica | Valor |
|---|---:|
| Dockerfile presence | **0** |
| `.dockerignore` | **0** |
| `docker-compose.yml` | **1** (só Postgres) |
| Workflow files (`.github/workflows`, etc.) | **0** |
| Pre-commit hooks | **0** |
| ESLint/Prettier configs | **0** |
| `process.on()` handlers | **0** (zero SIGTERM/SIGINT/uncaughtException/unhandledRejection) |
| Total `console.*` calls em server | **771** |
| Arquivos com `console.*` em server | **92** |
| Logger libs estruturadas | **0** |
| Error tracking libs (Sentry/Datadog/etc.) | **0** |
| APM/OpenTelemetry | **0** |
| Metric collectors (prom-client) | **0** |
| Compression middleware (gzip/brotli) | **0** |
| Health check endpoints | **1** (`/api/health`, cosmético) |
| Health checks com validação real (DB, etc.) | **0** |
| Cache-Control headers em static | **2** (api no-store + uploads immutable) |
| `process.env.*` unique vars | **36** |
| Env vars com validação throw centralizada | **0** (fragmentada em 4 arquivos) |
| Connection pool max | **10** (default) |
| Connection pool statement_timeout | **undefined** (sem limite) |
| Migration history entries (drizzle journal) | **1** (snapshot consolidado) |
| Migrations TS ad-hoc fora do Drizzle | **1** (`bulkCs2PriceProjection.ts`) |
| `package.json` scripts | **6** (`dev`, `build`, `start`, `check`, `db:push`, `test`) |
| Build allowlist mismatched entries | **11** packages não-existentes |
| Scheduler cleanup handlers | **1** (apenas bot-trader local timer) |
| `.env` em multi-env strategy | **1** arquivo único |
| Backup automatizado | **0** |
| Documentos operacionais (RUNBOOK/DEPLOY/CONTRIBUTING) | **0** |
| README.md instructional content | minimal (56 linhas, marketing) |
| Process manager | **0** (PM2/systemd absent) |

---

## 5. Recomendações de prioridade (Top 5)

| # | Ação | Justificativa | Effort |
|---|---|---|---|
| **1** | **Adicionar SIGTERM/SIGINT handlers + `unhandledRejection`** em `server/index.ts` que: (a) parem `httpServer.listen`, (b) chamem `pool.end()`, (c) fechem WebSocket server, (d) tenham timeout de 30s pra forçar exit | B2.9-1. Sem isso qualquer deploy/restart pode corromper estado. Padrão industry de 10 linhas | 1-2h + smoke test |
| **2** | **Configurar pool com `max: 20, statement_timeout: 30000, idleTimeoutMillis: 30000`** em `server/db.ts:13` | B2.9-6. 10 connections + sem timeout = single slow query derruba app. 3 keys no Pool config | 15min |
| **3** | **Health check deep**: `GET /api/health` faz `pool.query("SELECT 1")` antes de 200; mantém `/api/health/live` cosmético | B2.9-2. LB/k8s probe precisa diferenciar liveness vs readiness | 30min |
| **4** | **Adicionar `pino` como logger estruturado** com `redact: ['*.passwordHash', '*.token', '*._devResetLink']` + level por env | B2.9-5 + B2.6-1 + B2.5-9. Resolve 3 achados em 1 install. JSON logs habilitam log aggregation (Loki/CloudWatch/etc.) | 2-3h refactor |
| **5** | **Escrever Dockerfile + .dockerignore + scripts deploy básicos** + atualizar README com seção "Deploy" | B2.9-3 + B2.9-10. Sem isso, deploy a qualquer host é projeto separado. Multi-stage Dockerfile + `EXPOSE 5000` + `HEALTHCHECK` | 3-4h |

**Bonus operacionais** (após Top 5):
- Validação centralizada de env via zod (`envSchema.parse(process.env)` no boot) — 30min
- Backup via `pg_dump` em cron + retenção 7 dias — 1h
- Sentry SDK install + `init({ dsn })` (free tier) — 30min
- GitHub Actions workflow rodando `npm test` + `npm run check` em PR — 1h
- ESLint + Prettier setup mínimo — 1-2h

---

## 6. Score subjetivo de qualidade

| Área | Score | Observação |
|---|---:|---|
| Deployment infrastructure (Dockerfile, compose) | **2.0** | Apenas docker-compose pra Postgres. Zero artefato de app deploy |
| Health checks | **2.5** | Endpoint existe mas é cosmético |
| Backup automatizado | **0.0** | Inexistente |
| CI/CD | **0.0** | Inexistente |
| Logs estruturados | **2.0** | console.log com prefixes; suficiente para dev, fraco para prod |
| Error tracking / APM | **0.0** | Inexistente |
| Secret management em prod | **3.5** | `.env.example` existe; validação fragmentada; rotation manual |
| Graceful shutdown | **0.0** | Zero handlers |
| Database deploy / migrations | **4.0** | `db:push` funciona mas é "schema-as-truth" sem rollback |
| Connection pooling | **3.0** | Defaults aceitos, sem timeout — single point of contention |
| Environment variables | **5.5** | 36 vars, doc via `.env.example` (D-fix), validação fragmentada |
| Monitoring / métricas | **0.0** | Inexistente |
| Multi-environment | **3.5** | NODE_ENV usado mas só dev/prod, sem staging |
| Documentation | **3.0** | README marketing; replit.md é log; audits/ alta qualidade mas não-operacional |
| Disaster recovery | **0.5** | Nenhum plano. Cenário concreto leva a perda total |
| Production readiness composite | **2.0** | Sistema funciona em dev local; não está pronto para hosting de produção em nenhum eixo |
| **Total deploy + observabilidade** | **2.0** | Sistema é "Replit-shaped" e migração para qualquer plataforma genérica exige construir tudo do zero |

---

## Notas finais

- A frase mais importante deste audit: **GamerStock foi modelado para Replit autoscale, removeu a plataforma, mas não construiu substitutos**. Cada item desta lista (process supervision, env injection, logs aggregation, deploy automation, healthchecks reais) era **provido implicitamente pelo Replit**. Agora não há.
- **Severidade CRÍTICA é específica para "ir pra prod"**. Para uso **local atual** (1 dev, Windows, Docker Postgres), os achados são teóricos — `npm run dev` funciona. Mas **qualquer exposição além de localhost** vai dolorosamente revelar essas ausências.
- O **caminho mais econômico** para ter "production-shaped MVP":
  1. **5min**: pool config + statement timeout
  2. **1-2h**: SIGTERM handler + health check deep
  3. **2-3h**: `pino` + redact paths
  4. **3-4h**: Dockerfile + scripts deploy + README com seção deploy
  5. **1h**: backup cron via `pg_dump`
  6. **1-2h**: GitHub Actions workflow rodando testes + type-check em PR
  - **Total ~10-15h** para ter um sistema deployável em Render/Railway/Fly.io com observability mínima.
- O **score 2.0** é honesto — não é projeto ruim, é projeto **dev-only** sem investimento em operação. Compensação: 7 auditorias técnicas (2.1-2.8) score médio 5.5/10. Operacional é claramente o eixo mais atrasado.
- Para a auditoria 2.10 (features e roadmap), as decisões P-x (remover Predictions, Arena, etc.) **devem considerar custo operacional**. Cada feature mantida é mais 5-15 schedulers, mais logs, mais surfaces para monitoring, mais carga DB.

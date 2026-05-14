# GamerStock — Tracker de Remediação

**Status**: provisional — vai crescendo conforme auditorias terminam
**Última atualização**: 2026-05-14 (após exploration + 2.1 + 2.2 + 2.3 + 2.4 + 2.5 + 2.6 + 2.7 + 2.8 + 2.9; 2.10 pendente)

---

🚨 ATENÇÃO IMEDIATA — Triplo Leak de Dados

A combinação de 3 achados forma um vetor amplificado:
- B2.5-1: forgot-password retorna reset token no JSON
- B2.6-1: logger middleware faz JSON.stringify de toda response /api/*
- B2.6-3: GET /api/admin/users retorna passwordHash no select *

Resultado: tokens vivos por 1h + hashes bcrypt vão pra stdout em toda chamada admin. Combinado com B2.6-2 (error middleware vaza err.message sem gate NODE_ENV), 4 fixes totalizam ~60 minutos. Atacar AGORA, antes de qualquer outra ação.

**Nota narrativa da 2.9**: GamerStock foi modelado para Replit autoscale (process supervision, env injection, logs aggregation, healthchecks providos pela plataforma) e perdeu essa fundação ao migrar. **Para uso local atual, tolerável; para qualquer deploy real, blocker total.** Os achados B2.9-x não são "ruins" — são "ausentes". Caminho econômico para production-shaped MVP: ~10-15h.

---

## Status das auditorias

| Etapa | Status | Documento |
|-------|--------|-----------|
| Exploração visual ponta-a-ponta | ✅ Concluído | `2026-05-14-exploration-report.md` |
| **D** Plano de remediação Windows | ✅ Concluído | (commits) |
| **2.1** Arquitetura geral | ✅ Concluído | `2026-05-14-architecture-audit.md` |
| **2.2** Backend profundo | ✅ Concluído | `2026-05-14-backend-audit.md` |
| **2.3** Frontend profundo | ✅ Concluído | `2026-05-14-frontend-audit.md` |
| **2.4** Banco e migrations | ✅ Concluído | `2026-05-14-database-audit.md` |
| **2.5** Auth e sessão | ✅ Concluído | `2026-05-14-auth-audit.md` |
| **2.6** Segurança | ✅ Concluído | `2026-05-14-security-audit.md` |
| **2.7** Dependências | ✅ Concluído | `2026-05-14-dependencies-audit.md` |
| **2.8** Testes | ✅ Concluído | `2026-05-14-testing-audit.md` |
| **2.9** Deploy e observabilidade | ✅ Concluído | `2026-05-14-deployment-audit.md` |
| **2.10** Features e roadmap | ⏳ Pendente (parcial via exploration) | — |

---

## Achados técnicos consolidados

Convenções:
- **Prioridade**: P1 (urgente, antes de exposição), P2 (alta, antes de prod), P3 (média), P4 (baixa)
- **Status**: open / in-progress / done / deferred / wontfix / merged
- **Origem**: exp = exploration, 2.1, 2.2, 2.3, 2.4, 2.5, etc.

### P1 — Urgente (antes de qualquer exposição além de localhost)

| ID | Origem | Categoria | Descrição | Effort | Status |
|----|--------|-----------|-----------|--------|--------|
| 🔴 **B2.5-1** | 2.5 | account-takeover | `forgot-password` retorna `_devResetLink` (token bruto) no JSON. Account takeover em 2 requests sem acessar email | **5min** | **EMERGÊNCIA** |
| B2.2-1 / B2.4-2 | 2.2 / 2.4 | integrity | `fee_ledger` sem UNIQUE em `(referenceType, referenceId)` → double-settlement em retry | 1h | open |
| B2.2-2 | 2.2 | race / integrity | Wallet settlement (debitWallet/creditWallet) roda FORA da tx do trade. Janela de divergência ledger↔balance | 3-4h | open |
| B2.3-1 / B-1 | 2.3 / exp | data-consistency | Buying Power lê de 2 fontes: `useGsWallet()` (header) vs `usePortfolio()` (modal). Mostra $1k vs $10k | 30min | open |
| B2.3-2 / B-7 | 2.3 / exp | bug | `/admin/arena` crash: `.find()` em `undefined` em `admin/arena.tsx:230`. Fix de 1 caractere | 5min | open |
| B2.3-3 / B-2 | 2.3 / exp | bug | `/assets` default `game="dota2"` hardcoded em `assets.tsx:1331`. Mostra vazio mesmo com 800 players | 15min | open |
| B2.4-1 / B-8 | 2.4 / exp | data-integrity | `/api/admin/metrics:535` lê `riotTrades`/`riotAssets` (0 rows) em vez de canonical → "24h activity rate: NaN%" | 5min | open |
| B2.4-3 | 2.4 | migration-governance | `bulkCs2PriceProjection.ts` 38KB com 800 preços hardcoded em TS, fora do Drizzle. Bridge para PandaScore caído | TBD (planejamento) | open |
| B2.5-6 / sec-reset-pass | 2.5 / exp | privilege-escalation | `/api/admin/auth/reset-password` faz UPSERT — cria admins arbitrários com qualquer email. `===` não-timing-safe, sem rate limit, min 8 chars | 1-2h | open |
| 🔴 B2.6-1 | 2.6 | log-leak | Logger middleware (server/index.ts:47-71) faz JSON.stringify(responseBody) de toda response /api/* — captura tokens, hashes, PII em stdout | 30min-1h | **EMERGÊNCIA** |
| 🔴 B2.6-2 | 2.6 | information-disclosure | Error middleware (server/index.ts:92-103) vaza err.message sem gate NODE_ENV. SQL fragments, internal paths em response | 10min | **EMERGÊNCIA** |
| 🔴 B2.6-3 | 2.6 | sensitive-data | GET /api/admin/users retorna passwordHash (select * em 10 callsites). Combinado com B2.6-1, hashes em log | 15min | **EMERGÊNCIA** |
| B2.7-1 | 2.7 | sql-injection | `drizzle-orm@0.39.3` CVE SQL injection via identifiers (CVSS 7.5). Risco baixo no código atual (não usa `sql.identifier`), mas bump major obrigatório → 0.45.2 | 1-2h | open |
| ⚡ B2.8-1 | 2.8 | infrastructure-orphan | 1 arquivo de teste existe (`trade-settlement/__tests__/service.test.ts`, 282 LOC, 7 testes bem escritos cobrindo idempotência B2.2-1) mas QUEBRADO em runtime: `vitest.config.ts` sem `setupFiles: ['dotenv/config']`. Fix de 1 linha. **Maior alavanca/custo do projeto** | **5min** | open |
| B2.8-2 | 2.8 | missing-tests | Frontend tem ZERO testes E zero infra. Sem `@testing-library/react`, sem `jsdom`. Setup necessário antes de qualquer UI test | 1h setup + 8-12h testes | open |
| B2.8-3 | 2.8 | missing-tests | 16 services + 27 domains sem cobertura. Cada bug financeiro = refactor-roleta | 20-28h para 30% coverage financeiro | open |
| 🔴 B2.9-1 | 2.9 | deployment-blocker | Zero signal handlers (SIGTERM/SIGINT/uncaughtException/unhandledRejection) em server/index.ts. Cada deploy/restart é roleta — combina com B2.2-8 (flag valuationBatchRunning nunca reseta) | 1-2h | open |
| B2.9-2 | 2.9 | operational-blindness | Health check (`/api/health`) cosmético — retorna `{ok:true}` sem validar DB. LB/k8s probe vê verde mesmo com sistema disfuncional | 30min | open |
| B2.9-3 | 2.9 | deployment-blocker | Zero Dockerfile, zero .dockerignore. Artefato de deploy não existe. Para deploy em qualquer host de container precisa multi-stage + healthcheck + USER node | 3-4h | open |
| B2.9-5 | 2.9 | observability | 771 `console.*` em 92 arquivos, zero pino/winston. Sem level por env, sem correlation ID, sem JSON. Fix combinado com B2.6-1 via pino + redact paths | 2-3h | open |
| B2.9-6 | 2.9 | scalability-blocker | Connection pool defaults (max=10, sem statement_timeout, sem query_timeout). Single slow query trava todas conexões — amplifica B2.7-3 (DoS path-to-regexp) | 15min | open |

### P2 — Alta (antes de produção real)

| ID | Origem | Categoria | Descrição | Effort | Status |
|----|--------|-----------|-----------|--------|--------|
| B2.5-2 / B2.2-3 | 2.5 / 2.2 | brute-force | Zero rate limiting em 8 endpoints de auth (signup, login, forgot, reset, change-pwd, force-change, admin-login, admin-reset) | 1h | open |
| B2.5-3 / B2.2-4 | 2.5 / 2.2 | session-fixation | Zero `req.session.regenerate()` em 5 callsites onde sessão é estabelecida | 30min | open |
| B2.5-4 | 2.5 | session-lifecycle | Logout não chama `clearCookie("connect.sid")` — sessão fica órfã no browser por 7 dias | 10min | open |
| B2.5-5 | 2.5 | bug/config | TTL do session DB passado em ms onde `connect-pg-simple` espera segundos = 19 anos. Tabela `sessions` cresce indefinidamente | 5min + smoke | open |
| B2.5-7 / B2.2-5 | 2.5 / 2.2 | authorization-consistency | 7 endpoints `/api/admin/*` usam check inline em vez de `isAdminOnly` (3 perf + 4 bots) | 30min | open |
| B2.5-9 | 2.5 | pii-leak / log-injection | Auth logs vazam emails (PII/LGPD) e **token de reset completo** (linha 300 de identity/routes.ts) | 1-2h | open |
| B2.2-6 | 2.2 | performance | N+1 queries em 5 endpoints admin de multigame (~400 queries/listagem de 50) | 2-3h | open |
| B2.3-4 / B-9 | 2.3 / exp | architecture | Watchlist LoL-shaped: tipo sem `game`, "Challenger" hardcoded literal para todo asset, copy "across the rift" | 2-3h | open |
| B2.3-5 / P-9 | 2.3 / exp | architecture | Copy LoL hardcoded em 14+ pontos (login, landing, leaderboard, player, terminal, etc.). ~25-30 strings estimadas | 2-3h | open |
| B2.3-6 | 2.3 | performance | Zero `React.lazy`. 50+ rotas em bundle único. Admin (21 pages) carrega para todo usuário | 2h | open |
| B2.3-7 | 2.3 | performance | Zero virtualization em listas potencialmente grandes (terminal scanner, leaderboards, admin/users) | 1-2h | open |
| B2.4-5 | 2.4 | type-consistency | 3 escalas decimais para "price" (10,2/10,4/18,6) — truncamento implícito a cada trade | 2-4h | open |
| B2.4-6 | 2.4 | type-consistency | 200 cols timestamp sem TZ vs 5 com TZ. Cluster multi-região = problemas | preventivo | deferred |
| B2.4-7 / B-5 | 2.4 / exp | data-source-mismatch | KPIs admin lêem `asset_listing_submissions` (0 rows) — bootstrap escreve direto em `assets.listing_status` (616 UNDER_REVIEW) | 30min | open |
| B2.4-8 | 2.4 | architecture | Trilho legacy/canonical zumbi: 8 tabelas legacy 0 rows + 67 refs em código. Cleanup precisa strangler explícito | 2-3h doc + análise | open |
| backup-zero | 2.4 | ops | Sem `pg_dump`, sem cron, sem snapshot regular. `docker compose down -v` apaga tudo | TBD em 2.9 | open |
| admin-pass-weak | exp | security | `ADMIN_PASS=GamerStock-01` é fraca e foi exposta em screenshots — rotacionar antes de prod | 5min | open |
| helmet-missing / B2.6-5 | 2.5+2.6+2.7 | security-headers | Zero headers (helmet, CSP, HSTS, X-Frame-Options). `helmet` + `express-rate-limit` ausentes no package.json — adicionar ambos em mesmo install | 30-45min | open |
| B2.6-4 | 2.6 | xss / upload | SVG aceito em ALLOWED_MIME_TYPES sem sanitization. Mimetype-only validation, sem magic bytes | 5min ou 1h | open |
| B2.6-6 | 2.6 | csp-absent | index.html sem CSP. 28 Google Fonts via link, Vite gera inline scripts | 30min | open |
| B2.7-2 | 2.7 | information-disclosure | `vite@7.3.0` arbitrary file read via dev WebSocket. Dev-only — risco se 5000 exposto em rede | 5min (`npm audit fix`) | open |
| B2.7-3 | 2.7 | dos | `path-to-regexp` DoS via Express 5 router. Combinado com B2.5-2 (zero rate limit), 1 request stalla worker | 5min (`npm audit fix`) | open |
| B2.7-4 | 2.7 | unused-dep | 2 packages diretos zero-use: `next-themes@0.4.6`, `tw-animate-css@1.2.5` | 5min | open |
| B2.7-5 | 2.7 | dead-code / supply-chain | 15 templates shadcn UI órfãos + 6 packages dedicados (`cmdk`, `vaul`, `input-otp`, `react-day-picker`, `embla-carousel-react`, `react-resizable-panels`) | 30-60min | open |
| B2.7-6 | 2.7 | replit-cleanup | 3 packages `@replit/vite-plugin-*` ainda no tree (gateados por REPL_ID, nunca carregam no Windows) | 10min | open |
| B2.8-4 | 2.8 | missing-infra | `@vitest/coverage-v8` não instalado. Sem `npm run test:coverage`. Impossível medir progresso | 15min | open |
| B2.8-5 | 2.8 | missing-infra | Sem MSW (mock external APIs), sem supertest (HTTP test). Necessário para integration tests | 30min install | open |
| B2.9-7 | 2.9 | observability | Sem error tracking (Sentry/Datadog/Bugsnag/Rollbar/OTel). Erros 500 em prod só em stdout. Tempo de detecção = user reclama | 30min install + integração | open |
| B2.9-8 | 2.9 | observability | Sem monitoring: zero prom-client, zero latency tracking, zero DB query metrics, zero business metrics, zero alert routing, zero dashboards | sprint dedicado | open |

### P3 — Média (melhoria contínua)

| ID | Origem | Categoria | Descrição | Effort | Status |
|----|--------|-----------|-----------|--------|--------|
| B2.5-8 / B2.6-8 / B2.2-9 | 2.5+2.6+2.2 | open-redirect | Steam callback: 6 res.redirect com returnUrl sem validação (multigame/routes.ts:1366, 1403, 1421, 1426, 1451, 1454). Phishing user-facing | 30min | open |
| B2.5-10 | 2.5 | data-integrity | Signup case-sensitive vs login case-insensitive → duplicate accounts possíveis | 30min | open |
| B2.2-7 | 2.2 | race | `settleMatchedTrade` lê wallets antes de adquirir locks (read-before-lock) | 1h | open |
| B2.2-8 | 2.2 | concurrency | `valuationJob` usa flag em memória sem try/finally garantido | 30min | open |
| B2.2-10 | 2.2 | data-integrity | Deduplicação de candidatos é analysis-only, não persistida | 2-3h | open |
| B2.3-8 | 2.3 | type-safety | 140 ocorrências de `: any` / `as any`. 47 só nos 3 piores arquivos | 4-6h (incremental) | open |
| B2.3-9 | 2.3 | accessibility | Botões icon-only sem `aria-label` (WCAG 2.1 AA gap) | 1-2h | open |
| B2.3-10 | 2.3 | performance | Inline object/array em props recriados a cada render. Zero `useCallback` em terminal.tsx | 2-3h | open |
| B2.4-9 / B-3 | 2.4 / exp | state-inconsistency | `bot_profiles` 0 rows + flag em memória `running` independente da tabela | 15min | open |
| B2.4-10 | 2.4 | integrity | Apenas 5 CHECK constraints (todos em wallets). Resto do schema sem invariantes DB-level | 2-3h incremental | open |
| B2.4-4 | 2.4 | observation | 80% tabelas vazias (88 de 111). Não bug — schema over-provisioned | — | won't fix |
| B-4 | exp | data-consistency | (merged com B2.3-3, validado em DB em 2.4) | — | merged |
| B-6 | exp | data-anomaly | Usuário `admin@gamerstock.ai` aparece sem origem clara (provável seed) | 30min | open |
| B2.6-7 | 2.6 | observation | dangerouslySetInnerHTML em components/ui/chart.tsx:81 (shadcn) — falso positivo, conteúdo interno hardcoded | — | won't fix |
| B2.6-9 | 2.6 | ssrf | PANDASCORE_BASE_URL env-overridable habilita SSRF se admin malicioso ou .env vazar. Outras 6 integrações têm URLs hardcoded | 30min | open |
| B2.6-10 | 2.6 | access-control | /uploads/media/:storageKey é endpoint público sem auth (fora do gate /api/*). Storage keys vazam via logger (B2.6-1) | 30min | open |
| B2.7-7 | 2.7 | cutting-edge | Express 5.0.1 (out/2024) + Multer 2.1.1 (mar/2025) — major versions recém-lançadas. Estáveis mas ecosystem ainda imaturo | monitoramento | open |
| B2.7-8 | 2.7 | inconsistency | `tailwindcss@3.4.17` + `@tailwindcss/vite@4.1.18` coexistem. Plugin v4 não está sendo usado | 5min | open |
| B2.7-9 | 2.7 | obsolescence | 6 packages com major version atrasada: React 19, Recharts 3, react-day-picker 10, react-resizable-panels 4, framer-motion 12, date-fns 4, @hookform/resolvers 5 | sprint dedicado | deferred |
| B2.7-10 | 2.7 | supply-chain | `node_modules` 382 MB, 709 packages. ~3x typical. Cleanup proposto em B2.7-4/5/6 reduz ~30-40 packages | parcial via outros | open |
| B2.8-6 / B2.9-4 | 2.8+2.9 | missing-infra | Zero CI/CD: sem `.github/workflows/`, sem husky, sem lint-staged, sem ESLint/Prettier. Mesmo se testes existirem, ninguém roda automaticamente. Combinado com S-4 | 2-4h setup CI | open |
| B2.8-7 | 2.8 | design-gap | Sem strategy de DB isolation para testes. Único teste usa prefixo `settle-test-` + CASCADE — funciona mas não escala (CI paralelo) | 2-3h | open |
| B2.9-9 | 2.9 | code-debt | `script/build.ts:8-34` allowlist lista 11 packages que não existem (cors, express-rate-limit, nodemailer, stripe, @google/generative-ai, openai, jsonwebtoken, uuid, nanoid, xlsx, axios). Copy-paste de template | 15min | open |
| B2.9-10 | 2.9 | documentation | README.md 56 linhas marketing copy. Zero setup, zero deploy, zero env vars. Bus-factor 1 — só você sabe rodar. Precisa DEPLOY.md + RUNBOOK.md + CONTRIBUTING.md | 3-4h | open |

---

## Smells arquiteturais (S-x)

| ID | Origem | Categoria | Descrição | Status |
|----|--------|-----------|-----------|--------|
| S-1 | 2.1 | god-files | terminal.tsx (3537), prediction/service.ts (2958), multigame/routes.ts (2563). 9% do código em 3 arquivos | open (P-1 resolve 1/3) |
| S-2 | 2.1 | architecture | Migração `vault → asset` inacabada. Validado quantitativamente em B2.4-8 | open |
| S-3 | 2.1 | organization | 7 top-level legacy files em `server/` que deveriam estar em `domains/` | open |
| S-4 / B2.9-4 | 2.1+2.9 | tooling | Sem ESLint, Prettier, EditorConfig, CI, pre-commit hooks. Detalhado em B2.8-6/B2.9-4 | open |
| S-5 | 2.1 | integrity | 3 ledgers com soft FKs (referenceType/referenceId) | parcial (B2.2-1 ataca um) |
| S-6 | 2.1+2.8 | testing | 1 arquivo de teste em 109k LOC, e ele está quebrado. Coverage efetiva = 0%. Detalhado em B2.8-1 a B2.8-7 | open |
| S-7 | 2.1 | dead-code | `server/web3/` esquelético, "observation mode, no adapters active" | open (decisão P-x?) |
| S-8 | 2.2-cmt | observability | Não existe job de reconciliação cross-ledger | open |
| S-9 | 2.4 | ops | Backup automatizado inexistente | open |
| S-10 | 2.4 | architecture | 80% tabelas vazias (over-provisioned) | open |
| S-11 | 2.5 | security | Sem account lockout — combinado com B2.5-2 = brute force ilimitado | open |
| S-12 | 2.5 | security | Sem email verification real (só flag boolean, sem token de verificação) | open |
| S-13 | 2.5 | security | Sem 2FA/MFA em qualquer fluxo | open |
| S-14 | 2.5 | observability | Sem audit log table para mudanças críticas (role admin, password reset, etc.) | open |
| S-15 | 2.5 | security | Mudança de senha não invalida outras sessões ativas do mesmo user | open |
| S-16 | 2.5 | naming | Cookie `connect.sid` default — disclose framework (helmet também ajuda) | open |
| S-17 | 2.9 | platform-shape | Sistema "Replit-shaped" — fundação operacional (process supervision, env injection, logs aggregation, healthchecks) era provida pela plataforma e foi embora junto na migração. Detalhado em B2.9-x | open |

---

## Decisões de produto (P-x)

| ID | Decisão | Status | Notas |
|----|---------|--------|-------|
| **P-1** | Remover Predictions inteiro | ✅ Confirmado | ~5,843 LOC backend + 9 tabelas + 2 schedulers + 2 frontend pages |
| **P-2** | Revisar `/admin/market` (Riot API key mgmt, bot traders, market mode toggle) | 🤔 A decidir | Médio escopo |
| **P-3** | Remover `/admin/predict`, `/admin/history` admin | ✅ Confirmado (subset de P-1) | — |
| **P-4** | **Multigame: MANTER** mas auditar "lixo" | ✅ Decidido | Limpar inconsistências internas, manter sistema |
| **P-5** | Revisar Arena (admin bugada B2.3-2 + user-side) | 🟡 Provável remover | 822 LOC routes + 15 tabelas + 7KB legacy `arena.ts` + 6 frontend pages |
| **P-6** | Revisar Draft (Weekly Performance Draft, vazio) | 🤔 A decidir | Atrelado a Arena provavelmente |
| **P-7** | Revisar AMM standalone (`/admin/amm`) legacy | 🤔 A decidir | Investigar relação com AMM multigame antes |
| **P-8** | Remover Leaderboard standalone (legacy LoL Challenger) | 🟡 Provável remover | Pequeno |
| **P-9** | Auditar copy/UI hardcoded LoL (`league of legends`, `rift`, `Region`, `Rank Tier`) | 🤔 A decidir | = B2.3-5, escopo agora quantificado |

---

## Manutenção e operações

| Item | Ação | Deadline | Status |
|------|------|----------|--------|
| Repo `GamerStock-legacy` no GitHub | Deletar | 07/06/2026 | open |
| `ADMIN_PASS=GamerStock-01` | Rotacionar para 16+ chars random | Antes de prod | open |
| Email Git `24bit.oficial@gmail.com` | Considerar usar noreply do GitHub | Antes de tornar repo público | deferred |
| `D:\gamer-stock-backup-pre-nuke` | Backup ainda no disco | Deletar quando confiar na nova baseline | deferred |
| `server/replit_integrations/auth/` (4 arquivos) | Remover quando confirmado sem rollback | Médio prazo | deferred |
| `replit.md` (100KB) | Documentação histórica, manter como referência | — | keep |
| 13 vulnerabilidades npm (1 low, 5 moderate, 7 high) | Detalhadas em B2.7-1 a B2.7-3. `npm audit fix` resolve 6 das 7 high (5min) | (consolidado em B2.7-x) | superseded |
| `script/build.ts` allowlist | Remover 11 entries não-existentes (B2.9-9) | Quick win | open |
| Documentação operacional | Criar DEPLOY.md + RUNBOOK.md + CONTRIBUTING.md; expandir README com seção Setup/Deploy | Antes de onboarding 2º dev | open |
| Validação env centralizada | Substituir 4 throws ad-hoc por `envSchema.parse(process.env)` (zod) no boot | 30min | open |

---

## Fases de remediação propostas

### Fase 0 — EMERGÊNCIA (atacar AGORA — 4 fixes, ~60min total)
- B2.6-2 (10min): error middleware gate por NODE_ENV
- B2.6-3 (15min): projection em GET /api/admin/users (excluir passwordHash)
- B2.5-1 (5min): remover _devResetLink da response
- B2.6-1 (30min): redaction no logger middleware

Esses 4 combinados eliminam o triplo leak + DB error disclosure. Não esperar fim das auditorias.

### Fase A — Stop the Bleeding (P1)
~11-13h. Conserta as 9 P1 com maior risco financeiro/segurança/takeover. **5 dessas são quick wins (<30min cada)**: B2.5-1 (5min), B2.4-1 (5min), B2.3-2 (5min), B2.3-3 (15min), B2.4-2/B2.2-1 (30min).

### Fase B — Higiene de Produção (P2)
~18-25h. **Primeiro item**: `npm audit fix` (5min) — resolve 6 das 7 high vulnerabilidades transitivas, incluindo o DoS do Express 5. Depois: rate limiting, session.regenerate, helmet, multigame UI/copy refactor, code splitting, precisão decimal de preços, backup automatizado, trilho strangler, TTL bug.

### Fase C — Decomissões confirmadas
P-1 (Predictions), P-3 (admin predict/history). Pode ir em paralelo com B. Reduz ~5,843 LOC backend + 9 tabelas.

### Fase D — Decisões pendentes
Revisar P-2, P-5, P-6, P-7, P-8, P-9. Decidir antes de mexer.

### Fase E — Limpeza técnica (S-x)
S-2 (vault→asset migration), S-3 (top-level legacy), S-4 (toolchain), S-8 (reconciliação cross-ledger), S-9 (backup), S-11..S-16 (security gaps).

### Fase H — Production Readiness (~10-15h, pacote coeso)

Blocker para qualquer deploy real, opcional para uso local. Faz sentido executar como sprint dedicado.

1. **B2.9-6 (15min)**: pool config `max: 20`, `statement_timeout: 30000`, `idleTimeoutMillis: 30000`
2. **B2.9-1 (1-2h)**: SIGTERM/SIGINT handlers com cleanup ordenado (HTTP server stop → pool.end → wss.close → 30s force-exit timeout)
3. **B2.9-2 (30min)**: health check deep com `SELECT 1` antes de 200; criar `/api/health/live` cosmético separado
4. **B2.9-5 + B2.6-1 (2-3h)**: instalar pino com redact `['*.passwordHash', '*.token', '*._devResetLink']` + level por env. Resolve 2 achados juntos
5. **B2.9-3 (3-4h)**: Dockerfile multi-stage + .dockerignore + scripts deploy + atualizar README com seção Deploy
6. **Backup (1h)**: pg_dump em cron + retenção 7 dias (S-9, B2.4-backup-zero)
7. **B2.9-7 (30min)**: Sentry SDK install + `init({ dsn })` (free tier)
8. **B2.8-6/B2.9-4 (1h)**: GitHub Actions workflow rodando `npm test` + `npm run check` em PR
9. **Env validation centralizada (30min)**: zod schema no boot
10. **B2.9-9 (15min)**: limpar build.ts allowlist

**Total ~10-15h** para sistema deployável em Render/Railway/Fly.io com observability mínima.

### Fase F — Testes (B2.8-1 a B2.8-7, S-6)

**F.0 Quick win imperdível (~5min)**
- B2.8-1: `setupFiles: ['dotenv/config']` em vitest.config.ts → 7 testes financeiros existentes voltam a rodar

**F.1 Setup MVP (~1-2h)**
- Coverage tool (B2.8-4)
- Scripts test:watch, test:coverage
- Test DB isolado ou DATABASE_URL_TEST (B2.8-7)
- tests/setup.ts com helpers

**F.2 Primeiros 15 testes priorizados (~18-22h)**
1. Destravar trade-settlement (5min)
2. ammPricing unit tests (1h)
3. pviEngine unit tests (1h)
4. wallet/service integration (3h)
5. fee-engine capture idempotência — B2.2-1 regression (2h)
6. valuationJob try/finally — B2.2-8 regression (1h)
7. identity/signup api test (2h)
8. forgot-password — B2.5-1 regression (1h)
9. admin/users — B2.6-3 regression (1h)
10. admin/metrics — B-8 regression (1h)
11. admin/arena render — B-7 regression (30min)
12. watchlist — B-9 regression (1h)
13. use-auth hook (1h)
14. terminalStore reducer (1h)
15. triggerEngine race (2h)

**F.3 Smoke MVP (~6-8h)**
- App boot
- 5 endpoints críticos respondem 200
- signup→login→trade end-to-end via supertest

**F.4 30% coverage em domínios financeiros (~20-28h)**
- wallet/, fee-engine/, trade-settlement/, player-earnings/, tradeExecutor + assetTradeExecutor, ammPricing + pviEngine

**Total Fase F**: ~50-60h. Top 5 quick wins (~10-15h) cobrem ~80% do valor.

### Fase G — P3
Tudo o que sobrou.

---

## Métricas globais

| Métrica | Valor |
|---------|------:|
| Achados técnicos totais | 88 |
| — P1 | 21 (4 EMERGÊNCIAS) |
| — P2 | 30 |
| — P3 | 30 |
| — won't fix | 2 |
| — merged | 2 |
| Smells arquiteturais | 17 |
| Decisões de produto pendentes | 9 (3 confirmadas, 4 a decidir, 2 prováveis remover) |
| Effort estimado para fechar P1 | ~22-26h |
| Effort estimado para fechar P1+P2 | ~48-60h |
| Quick wins (<30min cada) | 17 |
| **Score acumulado das auditorias** | 2.1 N/A · 2.2 7.1 · 2.3 7.0 · 2.4 6.5 · **2.5 5.5** · 2.6 5.8 · 2.7 6.0 · 2.8 1.5 · 2.9 2.0 |
| Score médio das 8 auditorias técnicas | **~5.1/10** |

---

**Próxima atualização**: após 2.10 (features/roadmap), a auditoria final. Espera-se cobrir: revisão das 9 decisões P-1..P-9 (status), análise de features em produção vs lixo, proposta de roadmap pós-remediação, decisão sobre custo operacional de cada feature mantida (especialmente impacto em B2.9-8 monitoring scope), priorização final de fases A-H.

# Auditoria 2.6 — Segurança

**Data**: 2026-05-14
**Escopo**: segurança fora de auth/sessão (já em 2.5) — headers HTTP, CORS, CSP, XSS, upload, SSRF, path traversal, command injection, secret management, information disclosure, open redirects, criptografia, logging
**Método**: greps de inventário + leitura cirúrgica de `server/index.ts`, `client/index.html`, multer configs, error middleware, todos os `res.redirect()`, all `db.select().from(users)`
**Output**: somente leitura

---

## 1. Resumo executivo

Postura de segurança operacional **fraca**, com fundação criptográfica boa herdada de 2.5 (bcrypt 12, randomBytes 256-bit, SHA-256 hashing). Defesas perimetrais quase totalmente ausentes: **zero headers de segurança** (sem helmet, sem CSP, sem HSTS), `X-Powered-By: Express` exposto, error middleware vaza `err.message` em qualquer ambiente, logging middleware **JSON.stringify de toda response body** para stdout em `/api/*` (incluindo `_devResetLink` tokens da B2.5-1 e password hashes do listing de admin), upload de SVG permitido sem sanitização. Risco real de SSRF baixo (URLs externas hardcoded), command injection inexistente. Open redirects via Steam callback `returnUrl` (já em B2.5-8) e CORS na sua "ausência protetiva" (default Express bloqueia cross-origin com credentials, OK para single-origin).

**Severidade geral: ALTA**. 3 achados P1 — todos relacionados a **vazamento de dados em logs**: o logger captura toda response, sem redaction. Combinado com B2.5-1 (forgot-password retorna token), o token vaza em 2 lugares: response (cliente) e log (operadores). Adicionalmente, listing de admin users com `select *` inclui `passwordHash`, que também flui pro log.

---

## 2. Top 10 achados

### B2.6-1 [P1] — Logging middleware faz `JSON.stringify(responseBody)` de toda resposta `/api/*`
- **Arquivo:linha**: `server/index.ts:47-71` (logger middleware monkey-patcha `res.json`)
- **Categoria**: information-disclosure / log-leak
- **Descrição**: o middleware intercepta `res.json()` e captura `capturedJsonResponse`. No `res.on("finish")`, loga `${req.method} ${path} ${res.statusCode} in ${duration}ms :: ${JSON.stringify(capturedJsonResponse)}` para **toda request com path `/api`**. Não há truncation, nem filtro por endpoint, nem redaction.
- **Impacto** (vazamento em stdout / log aggregator):
  - `POST /api/auth/forgot-password` → loga `_devResetLink` (token de reset) — combinado com B2.5-1 = token em 2 lugares
  - `GET /api/admin/users` → loga **toda a lista de usuários com `passwordHash`** (B2.6-3)
  - `POST /api/auth/login` → loga user info no body de sucesso
  - `GET /api/wallets/me` → loga balance, lockedBalance, ledger entries
  - `GET /api/auth/me` → loga email, role, capabilities, mustChangePassword
  - **Cada call de admin retorna response gigante** → logs gigantes
- **CVSS**: ~7.0 (alto se logs forem acessíveis a operadores/staff ou se forem persistidos em sistema externo)

### B2.6-2 [P1] — Error middleware vaza `err.message` sem gate `NODE_ENV`
- **Arquivo:linha**: `server/index.ts:92-103`
- **Categoria**: information-disclosure
- **Descrição**:
  ```ts
  app.use((err: any, _req, res, next) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    console.error("Internal Server Error:", err);
    if (res.headersSent) return next(err);
    return res.status(status).json({ message });
  });
  ```
  Em qualquer ambiente, retorna `{message: err.message}` que pode conter:
  - SQL fragmentos (`duplicate key value violates unique constraint "users_email_idx"`)
  - Internal paths (`ECONNREFUSED 127.0.0.1:5433`)
  - Drizzle errors verbosas
  - Stack-trace-like strings em catches mal feitos
  - `console.error("Internal Server Error:", err)` loga **err inteiro com stack** para stdout — combina com B2.6-1
- **Impacto**: enumeração de schema, descoberta de versão de DB, descoberta de paths internos. Sem NODE_ENV check para sanitizar em prod.

### B2.6-3 [P1] — `GET /api/admin/users` retorna `passwordHash` no JSON
- **Arquivo:linha**: `server/domains/admin/routes.ts:374-381`
- **Categoria**: sensitive-data-exposure
- **Descrição**: `const allUsers = await db.select().from(users).orderBy(desc(users.createdAt)); res.json(allUsers);` — **select sem projection**, retorna todas as 20 colunas de `users` incluindo `passwordHash`. Mesmo padrão em `GET /api/admin/users/:userId` (linha 387). Apenas admins podem chamar (gated por `isAdminOnly`), MAS:
  - Combinado com B2.6-1, os hashes ficam em **stdout/log files**
  - Cross-admin exposure: admin A vê hashes do admin B
  - Hash exposto = brute-force offline possível (bcrypt 12 é lento, mas viável para senhas fracas)
- **Endpoints similares afetados** (todos com `select().from(users)` sem projection):
  - `server/domains/admin/routes.ts:151, 256, 303, 376, 387` (5 callsites)
  - `server/domains/identity/repositories/user-repository.ts:23, 29, 37` (3 callsites)
  - `server/domains/identity/routes.ts:271, 374` (2 callsites)
- **Impacto**: vazamento direto via API admin + amplificação via log.

### B2.6-4 [P2] — Upload aceita SVG sem sanitização (XSS surface)
- **Arquivo:linha**: `server/domains/media/service.ts:7`
- **Categoria**: xss / upload-validation
- **Descrição**: `const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/svg+xml", "image/gif"];` — `image/svg+xml` é permitido. SVG pode conter `<script>` tags executáveis quando renderizado como `<object>`, `<iframe>` ou inline. Mais: **validação é por `mimeType` da request** (spoofável), sem **magic bytes check**, sem **content sanitization** (e.g., DOMPurify ou svgo).
- **Mitigação parcial**: se o frontend renderiza só como `<img src=...>`, browsers não executam scripts SVG. Mas qualquer surface que renderize SVG inline (e.g., para tema custom, banner background, ou via fetch+innerHTML) abre XSS.
- **Path do arquivo armazenado**: DB (`storageProvider: "database"`), servido em `/uploads/media/:storageKey` — não está gateado pelo `adminAuth` (que cobre só `/api/*`). **Qualquer um com o storage key pode baixar**.
- **Impacto**: dependente do uso no frontend. Mas o upload + serving está aberto a SVG malicioso.

### B2.6-5 [P2] — Zero headers HTTP de segurança
- **Arquivo:linha**: `server/index.ts:21-30` (apenas json + urlencoded body parsers — nenhum middleware de header)
- **Categoria**: defense-in-depth absent
- **Descrição**: confirmado via grep `helmet|X-Frame-Options|Content-Security-Policy|Strict-Transport-Security` → **zero matches** em `server/`. Resultado: nenhuma das seguintes defesas existe:
  - `X-Frame-Options: DENY` → clickjacking possível
  - `Strict-Transport-Security` → MITM downgrade possível em prod HTTPS
  - `X-Content-Type-Options: nosniff` → MIME confusion ataques possíveis
  - `Content-Security-Policy` → XSS é livre para usar inline scripts/eval
  - `Referrer-Policy` → URLs com query strings (`?token=...`) vazam pro Referer
  - `X-Powered-By: Express` (default Express) → version disclosure
- **Impacto**: cada header é defesa-em-profundidade. Sozinhos cada um é menor; ausentes em conjunto = postura fraca.

### B2.6-6 [P2] — `index.html` sem CSP, com fontes externas (Google Fonts)
- **Arquivo:linha**: `client/index.html` (15 linhas) — nenhum `<meta http-equiv="Content-Security-Policy">`
- **Categoria**: csp-absent
- **Descrição**: o HTML root carrega 28 famílias de Google Fonts via `<link href="https://fonts.googleapis.com/...">` mais `https://fonts.gstatic.com`. Sem CSP, browsers aceitam:
  - Inline scripts (Vite injeta dev script in module)
  - Inline styles (shadcn injeta CSS via JS, ver B2.6-7)
  - Fetch para qualquer origem (vide `_devResetLink` poderia ser exfiltrated por XSS)
- **Impacto**: amplifica qualquer XSS futuro. Não é vulnerabilidade isolada.

### B2.6-7 [P3] — `dangerouslySetInnerHTML` em `components/ui/chart.tsx` (shadcn, conteúdo interno)
- **Arquivo:linha**: `client/src/components/ui/chart.tsx:81`
- **Categoria**: xss / false-positive
- **Descrição**: única ocorrência no projeto inteiro. Conteúdo:
  ```tsx
  dangerouslySetInnerHTML={{ __html: Object.entries(THEMES)...
  ```
  Injeção de CSS theme variables. `THEMES` é constante interna do shadcn, não user-input. **Não é vulnerabilidade**, mas combinada com falta de CSP (B2.6-6), se o atacante conseguir mutate `THEMES` via algum vetor desconhecido, fica game-over.

### B2.6-8 [P2] — Steam callback open-redirect (já em B2.5-8, recapitulação completa)
- **Arquivos:linhas** (lista exaustiva dos `res.redirect()` que usam `returnUrl` da sessão):
  - `server/domains/multigame/routes.ts:1366` — `${returnUrl}?steam_error=SESSION_EXPIRED`
  - `server/domains/multigame/routes.ts:1403` — `${returnUrl}?steam_error=${cbResult.errorCode}`
  - `server/domains/multigame/routes.ts:1421` — `${returnUrl}?steam_error=AUTO_CREATE_FAILED`
  - `server/domains/multigame/routes.ts:1426` — `${returnUrl}?steam_error=NO_STEAM_ACCOUNT`
  - `server/domains/multigame/routes.ts:1451` — `${returnUrl}?steam_verified=1`
  - `server/domains/multigame/routes.ts:1454` — `${returnUrl}?steam_error=SERVER_ERROR`
- **Categoria**: open-redirect
- **Descrição**: `returnUrl` vem de `req.session?.steamReturnUrl` (set em `/api/auth/steam/start` a partir de `req.query.returnUrl`). Sem validação de prefixo `/` ou allowlist de domínio. Atacante força query `?returnUrl=https://evil.com` → completa o fluxo Steam → redireciona para `https://evil.com?steam_verified=1`. Verificação Steam genuína (assinatura OK), mas vítima pousa em página atacante.
- **Mitigação atual**: nenhuma. `/start` gateado por `isAuthenticated` mitiga só se atacante não está logado.

### B2.6-9 [P3] — `PANDASCORE_BASE_URL` env-overridable habilita SSRF se admin malicioso
- **Arquivo:linha**: `server/domains/ingestion/providers/pandascore/pandascoreClient.ts:91`
- **Categoria**: ssrf / configuration
- **Descrição**: `this.baseUrl = process.env.PANDASCORE_BASE_URL ?? "https://api.pandascore.co"` — o admin pode setar `PANDASCORE_BASE_URL=https://internal-service.local:8080/admin` no `.env`, e o `pandascoreClient.request()` fará fetch para esse URL. SSRF clássico via env var, mas com pré-requisito (acesso ao `.env`).
- **Impacto**: improvável em fase atual (1 admin). Mas se o produto crescer e .env vier de um secret manager com vazamento, ou se o env vier de UI admin (B-3 do contexto sugere admin pode setar Riot key via UI), o vetor amplifica. **Defense-in-depth**: validar domínio antes do fetch.
- **Outras 6 integrações externas**: URLs **hardcoded** (não env-overridable):
  - Riot: `https://na1.api.riotgames.com` (server/riot-sync.ts:6), `https://americas.api.riotgames.com` (linha 7) — ✅ hardcoded
  - OpenDota: hardcoded em `dota2MarketBootstrapService.ts`
  - Steam Web API: hardcoded em `steamCs2StatsClient.ts`
  - Steam OpenID: `https://steamcommunity.com/openid/login` (steamVerificationService.ts) — hardcoded
  - News RSS: feeds hardcoded em `newsService.ts`
  - Replit OIDC: `https://replit.com/oidc` ou env override via `ISSUER_URL` — gated atrás de `REPL_ID`

### B2.6-10 [P3] — `/uploads/media/:storageKey` é endpoint público sem auth
- **Arquivo:linha**: `server/routes.ts:231` (handler `app.get("/uploads/media/:storageKey", ...)`)
- **Categoria**: access-control
- **Descrição**: o handler serve qualquer media asset por `storageKey`. **Não está em `/api/*`** ⇒ o gate global `adminAuth` (em `server/routes.ts:100-103` que cobre `/api/`) **não aplica**. Storage key é `crypto.randomBytes(8).toString("hex") + ext` = ~64 bits de entropia — não-brute-forçável, mas:
  - storage keys aparecem em response de `GET /api/admin/media` (sem auth listing).
  - Logging middleware loga essa response (B2.6-1) → keys em log.
  - Cache headers default (browsers + CDN cache 31536000s ≅ 1 year, ver linha 239 `Cache-Control: public, max-age=31536000, immutable`) — uma vez vazada, key fica acessível para sempre.
- **Impacto**: se um media asset contém info sensível (e.g., screenshot de admin panel uploaded como banner), URL é shareable indefinidamente.

---

## 3. Análise por área

### 3.1 Headers HTTP de segurança

| Header | Status | Risco |
|---|---|---|
| `X-Powered-By` | **enviado** (`Express`, default) | version disclosure menor |
| `X-Frame-Options` | **ausente** | clickjacking possível |
| `Strict-Transport-Security` | **ausente** | HTTPS downgrade em prod |
| `X-Content-Type-Options` | **ausente** | MIME sniffing |
| `Content-Security-Policy` | **ausente** | XSS amplification |
| `Referrer-Policy` | **ausente** | URLs leakam em referer |
| `Permissions-Policy` | **ausente** | features browser não-restritas |
| `Cache-Control: no-store` para `/api/*` | ✅ **presente** (`server/routes.ts:170-173`) | OK |

**Verdict**: cobertura **8% (1 de 12 esperados)**. `helmet` instalaria 7 desses por default em 1 linha.

### 3.2 CORS

- `cors` package **NÃO instalado** (grep zero).
- **Default Express behavior**: sem `Access-Control-Allow-Origin`, browsers bloqueiam cross-origin fetches com `credentials: "include"`. Same-origin only.
- **Frontend** está embedded no mesmo origin (Vite dev em :5000 same-origin, prod build estático servido pelo Express same-origin).
- **Verdict**: para a arquitetura atual (single-origin SPA + API), ausência de CORS é defesa default. Se um dia separar frontend/backend em domains diferentes, precisará configurar explicitamente.

### 3.3 CSP

- **Ausente** (B2.6-6).
- `index.html` carrega 28 fontes do Google Fonts (preconnect + stylesheet).
- Vite gera inline module scripts em dev e em prod build.
- Sem nonce, sem hash, sem CSP.
- **Verdict**: defesa-em-profundidade ausente. Recomendação: meta CSP com `default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'`.

### 3.4 XSS surface

**Frontend**:
- `dangerouslySetInnerHTML` count: **1** (B2.6-7, falso positivo em shadcn)
- React JSX por default escapa string → user content via `{user.bio}` é seguro
- Não vi `document.write`, `eval`, `Function()` ou `innerHTML` direto em arquivos do projeto (componentes ui/ não auditados)
- URL params (e.g., `:assetId`) passados via `encodeURIComponent` em fetches — OK

**Backend**:
- Nenhum template HTML gerado server-side (`res.sendFile(index.html)` apenas em SPA fallback)
- `console.log` é o único output de string para stdout — não atinge clientes diretamente

**Upload XSS** (B2.6-4): SVG aceito sem sanitização — surface real.

### 3.5 Upload validation

**2 instâncias multer**:

| Local | Config | Risco |
|---|---|---|
| `server/domains/media/routes.ts:22-25` | `memoryStorage` + `fileSize: 10 MB`, **sem `fileFilter`** | aceita qualquer mime; validação no service |
| `server/domains/player-operator/routes.ts:26` | `memoryStorage` + `fileSize: 10 MB`, **sem `fileFilter`** | aceita qualquer mime |

**Validação no service `media/service.ts:7-15`**:
- `ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/svg+xml", "image/gif"]`
- Validação por `mimeType` do request (spoofável)
- **Sem magic bytes check** (ex: usar `file-type` package para inferir do buffer)
- **Sem sanitização de SVG** (B2.6-4)
- 10 MB max — razoável

**Storage**:
- DB-based (`storageProvider: "database"`), arquivos persistidos em `media_assets.file_data` bytea
- Sem cleanup automático (delete endpoint existe — `DELETE /api/admin/media/:id`)
- Não vi quota total

**Falta**:
- Magic bytes verification (mimetype spoofable)
- SVG sanitization
- Image validation (verificar que é imagem válida, não malformed/zip-bomb)

### 3.6 SSRF (7 integrações externas)

| # | Provider | URL source | Allowlist | Timeout | Risco |
|---|---|---|---|---|---|
| 1 | Riot NA1 | `https://na1.api.riotgames.com` hardcoded | N/A | ❌ sem timeout no fetch | baixo |
| 2 | Riot Americas | `https://americas.api.riotgames.com` hardcoded | N/A | ❌ sem timeout | baixo |
| 3 | OpenDota | hardcoded em service | N/A | ❌ | baixo |
| 4 | Steam Web API | hardcoded | N/A | ❌ | baixo |
| 5 | Steam OpenID | `https://steamcommunity.com/openid` hardcoded | N/A | callback hardcoded | baixo |
| 6 | **PandaScore** | `process.env.PANDASCORE_BASE_URL ?? default` | **NÃO** | ❌ | **B2.6-9** |
| 7 | News RSS | hardcoded URLs em `newsService.ts` | N/A | ❌ | baixo |

**Bonus 8º**: Replit OIDC `process.env.ISSUER_URL ?? "https://replit.com/oidc"` — env-overridable mas gated por `REPL_ID` (não roda no Windows).

**Verdict**: SSRF surface concentrado em PandaScore env override. Defesa-em-profundidade: add `URL.parse` validation antes de fetch.

### 3.7 Path traversal

**File system reads**:
- `server/static.ts:22`: `res.sendFile(path.resolve(distPath, "index.html"))` — hardcoded, sem input ⇒ ✅ safe
- `server/vite.ts:40`: `fs.promises.readFile(clientTemplate, "utf-8")` — clientTemplate hardcoded ⇒ ✅ safe
- `server/routes.ts:231-244`: `/uploads/media/:storageKey` — chama `serveFile(req.params.storageKey)`. storageKey passa pra DB query, não vai pra filesystem. ✅ safe

**Static file serving**:
- Dev: Vite middleware (controlado)
- Prod: `serveStatic(app)` em `server/static.ts` — `express.static(distPath)` com SPA fallback. **`distPath = path.resolve(__dirname, "public")`**. Sem input do usuário.

**Verdict**: zero path traversal surface real. Files all stored in DB or in hardcoded paths.

### 3.8 Command injection

**`exec/execSync/spawn` calls** (totais: 3):
- `server/scripts/prod-bootstrap.ts:21,48`: `import { execSync } from "child_process"; execSync("npm run db:push", ...)` — **string hardcoded**, sem user input. ✅ safe.
- `server/domains/multigame/steamVerificationService.ts:109`: `STEAM_ID_REGEX.exec(claimed)` — **falso positivo** (regex.exec, não child_process). ✅.

**Verdict**: zero command injection. Surface não existe.

### 3.9 Secret management

**Greps de hardcoded secrets**:
- `RGAPI-`: apenas em placeholder UI / regex validation (já em 2.4) — ✅ falso positivo
- `Bearer `: usado como prefixo em headers de fetch — ✅ não é secret, é format
- `api_key=`, `secret =`, `password =`: nenhum hardcoded encontrado no código (em `replit.md` doc-only, e em `.env` que é gitignored)
- JWT prefix `eyJ`: zero matches
- Stripe `sk_`/`pk_`: zero

**`.env` no `.gitignore`**: ✅ (D-fix)
**`.env.example`** commitado com placeholders: ✅
**Secrets em logs**: 🔴 confirmado:
- B2.5-9 já documentou que `[ForgotPassword] Reset link for ${email}: ${resetLink}` loga token (identity/routes.ts:300)
- B2.6-1 amplifica: `_devResetLink` na response é capturado pelo logger middleware

### 3.10 Information disclosure

| Vetor | Status |
|---|---|
| Stack traces em response | 🔴 **sim** (B2.6-2, error middleware vaza `err.message`) |
| `X-Powered-By: Express` | 🟡 enviado (default não-disabled) |
| `package.json` em response | ✅ não exposto |
| Debug endpoints | 🟡 `/api/health` retorna `{ok, env: process.env.NODE_ENV, time}` — `env` revela environment (minor) |
| Source maps em prod | depends on `vite.config.ts build` — não tem `build.sourcemap: true` ⇒ Vite default = false em prod ✅ |
| `.git` exposto via static | ✅ não — `serveStatic(distPath)` aponta para `dist/public`, não inclui `.git` |
| `node_modules` exposto | ✅ não |
| **Response body logado em stdout** | 🔴 **sim** — B2.6-1, **maior leak surface** |

### 3.11 Open redirects

**`res.redirect()` lista exaustiva** (11 ocorrências):

| # | Arquivo:linha | URL source | Validação | Risco |
|---|---|---|---|---|
| 1 | `multigame/routes.ts:1262` | hardcoded `/api/auth/steam/start...` (alias) | N/A | ✅ safe |
| 2 | `multigame/routes.ts:1327` | `startResult.redirectUrl` (from Steam adapter — Steam OpenID URL) | ✅ Steam-controlled | safe |
| 3 | `multigame/routes.ts:1338` | mesmo | ✅ | safe |
| 4 | `multigame/routes.ts:1366` | `${returnUrl}?steam_error=SESSION_EXPIRED` | ❌ no validation | B2.6-8 / B2.5-8 |
| 5 | `multigame/routes.ts:1403` | `${returnUrl}?steam_error=...` | ❌ | B2.6-8 |
| 6 | `multigame/routes.ts:1421` | `${returnUrl}?steam_error=AUTO_CREATE_FAILED` | ❌ | B2.6-8 |
| 7 | `multigame/routes.ts:1426` | `${returnUrl}?steam_error=NO_STEAM_ACCOUNT` | ❌ | B2.6-8 |
| 8 | `multigame/routes.ts:1451` | `${returnUrl}?steam_verified=1` | ❌ | B2.6-8 |
| 9 | `multigame/routes.ts:1454` | `${returnUrl}?steam_error=SERVER_ERROR` | ❌ | B2.6-8 |
| 10 | `replit_integrations/auth/replitAuth.ts:100` | `client.buildEndSessionUrl(...)` (OIDC logout) | ✅ OIDC-built | safe; gated por REPL_ID |
| 11 | (nenhum outro `res.redirect` no codebase) | | | |

**Verdict**: 6 redirects sem validação, todos no Steam callback flow. Resto é safe.

### 3.12 Sensitive data em API responses

**Endpoints auditados**:

| Endpoint | Campos retornados | Vazamento? |
|---|---|---|
| `GET /api/auth/me` | id, displayName, email, role, mustChangePassword, status, capabilities | ✅ projection manual, sem hash |
| `POST /api/auth/login` | id, displayName, email, mustChangePassword | ✅ |
| `POST /api/auth/signup` | id, displayName, email | ✅ |
| **`GET /api/admin/users`** | **all 20 columns** (`select * from users`) including `passwordHash` | 🔴 **B2.6-3** |
| `GET /api/admin/users/:userId` | mesma situação (linha 387) | 🔴 B2.6-3 |
| `GET /api/portfolio` | not audited deep — likely safe |
| `GET /api/wallets/me` | not audited deep — likely OK |

**Repository helpers** em `identity/repositories/user-repository.ts:23, 29, 37`: também usam `select().from(users)` sem projection. Used por `storage.getUser()` chamado em `/api/auth/me` (linha 180 of identity/routes.ts) — but the response handler picks fields manually (linhas 201-211), so hash não vaza no /me. 

### 3.13 Criptografia (não-auth)

- `crypto.randomBytes(32)` para reset tokens — 256 bits ✅
- `crypto.createHash("sha256")` para token hash ✅
- `crypto.randomBytes(8).toString("hex")` para storage key (16 hex chars = 64 bits) — moderado para storage keys públicos
- Bcrypt 12 rounds (em 10 callsites) ✅ — já em 2.5
- **JWT**: não usado (Passport + session-based)
- **Outros hashes**: `idempotencyKeys` table existe mas vazia

**Verdict**: criptografia em si está bem. Tokens com 256 bits, hashing SHA-256 + bcrypt.

### 3.14 Logging em produção

- **Logger**: `console.log` puro, sem lib estruturada (sem pino, winston, bunyan)
- **Sem level by env**: dev e prod logam o mesmo
- **Sem redaction**: B2.6-1, B2.5-9 — PII e tokens em log
- **Sem audit log table** para admin actions (role change, user deletion, market control)
- **Logs em stdout**: depende de onde o processo roda. Em Docker, captura padrão. Em prod, dependerá da configuração

**Verdict**: logging operacional **inadequado para prod**. Estruturar com pino + redact recomendado.

---

## 4. Quantitativos

| Métrica | Valor |
|---|---:|
| `helmet` instalado | **NÃO** |
| `cors` instalado | **NÃO** (defesa default Express OK para single-origin) |
| `X-Powered-By` disabled | **NÃO** (default exposed) |
| `dangerouslySetInnerHTML` count | **1** (shadcn falso positivo) |
| `multer` instances | **2** (media, player-operator) |
| Multer `fileFilter` setado | **0** (validação só no service para media) |
| `res.redirect()` total | **11** (9 no Steam flow, 1 alias safe, 1 Replit OIDC safe) |
| Open redirects sem validação | **6** (Steam callback) |
| `child_process`/`exec` calls reais | **1** (hardcoded `npm run db:push`) ✅ |
| `fs.readFile`/`sendFile` com user input | **0** ✅ |
| `select().from(users)` sem projection | **10 callsites** (5 admin + 5 outros) — 2 retornam ao cliente direto (admin/users) |
| Endpoints com `Cache-Control: no-store` | **TODOS `/api/*`** (global middleware) ✅ |
| Headers de segurança configurados | **0 de 12** esperados (apenas no-store cache) |
| Logger estruturado | **NÃO** (console.log puro) |
| Audit log table | **NÃO** |
| Response body logado em stdout | **SIM** (todos `/api/*`) — B2.6-1 |
| Stack trace em error response | **SIM** via `err.message` — B2.6-2 |
| Source maps em prod build | **NÃO** (Vite default) ✅ |
| Hardcoded secrets em código | **0** ✅ (placeholders são string literals validation-only) |
| SSRF: external URLs hardcoded vs env | **6 hardcoded + 1 env-overridable** (PandaScore) |
| SVG upload permitido | **SIM** sem sanitização |
| Magic bytes check em uploads | **NÃO** (só mimetype) |
| `/uploads/media/:key` autenticado | **NÃO** (público) |

---

## 5. Recomendações de prioridade (Top 5)

| # | Ação | Justificativa | Effort |
|---|---|---|---|
| **1** 🔴 | **Redaction no logging middleware**: gate por endpoint (não logar body para `/api/auth/*`, `/api/admin/users*`, `/api/wallets*`); OU truncar body para 100 chars; OU usar pino com redact paths | B2.6-1. Fix imediato pra parar leak de tokens + hashes em log. Sem fix isso amplifica B2.5-1 | 30min-1h |
| **2** 🔴 | **Projection explícita em `GET /api/admin/users`** (excluir `passwordHash`, `gamesSelected` opcionalmente). Pattern: `db.select({ id, email, ...}).from(users)` | B2.6-3. Pára hash leak via API direta e via log | 15min |
| **3** 🔴 | **Error middleware gate por NODE_ENV**: em prod, retornar `{message: "Internal Server Error"}` genérico; só vazar `err.message` se `NODE_ENV !== "production"` | B2.6-2. Pára DB error leak | 10min |
| **4** | **Instalar `helmet`** com defaults razoáveis (HSTS off em dev, frameguard, contentTypeOptions, noSniff). Adicionar meta CSP no `index.html` em paralelo | B2.6-5 + B2.6-6. Defesa-em-profundidade. 1 linha de middleware | 30min |
| **5** | **Remover SVG do `ALLOWED_MIME_TYPES`** (`media/service.ts:7`) OU adicionar SVG sanitization via `dompurify` antes de salvar OU servir SVGs como `Content-Type: text/plain` | B2.6-4. Fecha XSS surface | 5min (remover) ou 1h (sanitizer) |

**Bonus**:
- Adicionar `app.disable("x-powered-by")` em `server/index.ts:12` — 1 linha
- Validar `returnUrl` no Steam start endpoint (B2.6-8): permitir só paths começando com `/` — 5min
- Adicionar timeout em fetches externos (10s) — 30min para todos os 7 providers
- Validar magic bytes em uploads via `file-type` package — 1h

**Total Top 5**: ~2-3h para mitigar 5 P1/P2.

---

## 6. Score subjetivo de qualidade

| Área | Score | Observação |
|---|---:|---|
| Headers HTTP de segurança | **1.5** | Apenas `Cache-Control: no-store`. Resto ausente |
| CORS | **7.0** | Não configurado, mas default Express é seguro pra single-origin |
| CSP | **0.0** | Ausente |
| XSS surface (frontend) | **8.5** | React escapa por default, `dangerouslySetInnerHTML` só em shadcn interno |
| XSS surface (backend) | **9.0** | Zero templates, zero echo user content |
| Upload validation | **4.5** | mimetype-based, sem magic bytes, SVG permitido |
| SSRF | **7.5** | 6 hardcoded; 1 env-overridable; sem timeout em fetches |
| Path traversal | **9.5** | Zero surface real |
| Command injection | **9.5** | Zero surface (apenas 1 execSync com string hardcoded) |
| Secret management | **8.5** | `.env` gitignored, sem secrets hardcoded; mas logs vazam tokens |
| Information disclosure | **3.0** | Error message + body logging vazam |
| Open redirects | **5.0** | 6 instâncias sem validação no Steam |
| Sensitive data em responses | **4.0** | `/api/admin/users` retorna hashes |
| Criptografia (não-auth) | **9.0** | randomBytes 32, SHA-256, bcrypt 12 — sólido |
| Logging em produção | **2.5** | console.log puro, sem level, sem redaction, captura body de toda response |
| **Total segurança** | **5.8** | Fundamentos criptográficos sólidos, defesas perimetrais ausentes |

---

## Notas finais

- A **postura defense-in-depth é quase inexistente**: zero helmet, zero CSP, zero rate limit (B2.5-2), error middleware verboso. Esse não é um problema "no início" — é fácil de adicionar 1 sprint inteiro de hardening. Mas hoje o servidor está pelado.
- O **logger middleware é o leak amplifier**: combinado com B2.5-1 (forgot-password retorna token), B2.6-3 (admin lista hashes), B2.5-9 (auth logs com email), TODOS esses dados acabam em stdout. Quem tiver acesso a logs tem o reino.
- Steam open redirect (B2.6-8) é o maior risco user-facing — usuário autenticado pode ser phisheado.
- Para uma auditoria de **dependências** (2.7), os pontos relevantes daqui:
  - `multer` 2.x — verificar CVEs recentes (10MB limit pode ser DOS via slow upload)
  - `express` 5.0.x — first major bump, validar CVEs
  - `bcryptjs` 3.0 — OK
  - 13 vulnerabilidades flagged por `npm audit` (do install em D-3) — provavelmente em transitive deps de Vite/Tailwind/etc., mas validar runtime
- A boa notícia: criptografia + lógica de auth + DB queries (sem SQL injection) estão **bem feitas**. O que falta é "infraestrutura de segurança operacional" — middleware bem comum que pode ser bolted on sem refactor.

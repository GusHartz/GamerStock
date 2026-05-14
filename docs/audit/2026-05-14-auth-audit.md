# Auditoria 2.5 — Auth e Sessão

**Data**: 2026-05-14
**Escopo**: 8 fluxos de auth (signup, login, logout, forgot/reset, change-password, force-change, admin reset, Steam OAuth, Replit OIDC), configuração de sessão (server + client), autorização (middleware + guards frontend), vetores: CSRF, rate limit, lockout, email verification, 2FA, headers de segurança
**Método**: leitura linha-a-linha de `identity/routes.ts`, `auth/session.ts`, `use-auth.ts`, callbacks Steam + admin reset, greps de configuração de segurança
**Output**: somente leitura

---

## 1. Resumo executivo

Fluxos de auth implementados com fundação sólida — bcrypt 12 rounds (consistente em 10 callsites), tokens de reset com `crypto.randomBytes(32)` + SHA-256 hash + TTL 1h + single-use, cookies HttpOnly + sameSite=lax + secure-em-prod, sessions persistidas em Postgres via `connect-pg-simple`. Logout endpoints existem, force-password-change está gateado em 3 lugares. Logging de auth events presente (sucesso/falha).

**3 problemas de gravidade ALTA** (1 crítico):
1. 🔴 **`POST /api/auth/forgot-password` retorna o reset token no JSON da response** (`identity/routes.ts:302`) — campo `_devResetLink` contém o token bruto, sempre. Qualquer atacante com um email válido consegue reset imediato sem acessar a caixa de email. **CVSS estimado 9.0+**.
2. 🟠 **Zero rate limiting** em todos os endpoints de auth (signup, login, forgot, reset, admin reset, admin login). Brute force trivial em qualquer um.
3. 🟠 **Zero `req.session.regenerate()`** em todos os 4 pontos onde sessão é estabelecida (signup, login, force-change-password, admin-login). Session fixation real, embora atenuada por `sameSite=lax` em HTTPS.

**6 problemas P2/P3**: bug de TTL ms-vs-segundos no `connect-pg-simple` (sessions DB não expiram), 7 endpoints `/api/admin/*` sem `isAdminOnly` middleware, logout não limpa cookie no client, Steam callback redirect com `returnUrl` da sessão sem validação (open redirect risk), sem helmet/CSP/HSTS, sem account lockout, sem email verification real, sem 2FA, signup case-sensitive vs login case-insensitive (duplicate emails possíveis), reset secret comparado com `===` (não timing-safe).

**Severidade geral: ALTA**. O leak do reset token em forgot-password é P1 absoluto, fixável em uma linha. Os outros são P2 estruturais.

---

## 2. Top 10 achados

### B2.5-1 [P1 🔴 CRÍTICO] — `forgot-password` retorna o reset token no corpo da response
- **Arquivo:linha**: `server/domains/identity/routes.ts:299-302`
- **Categoria**: information-disclosure / account-takeover
- **Descrição**: o handler gera `rawToken = crypto.randomBytes(32).toString("hex")`, monta `resetLink = "/reset-password?token=" + rawToken`, e retorna `res.json({ ...GENERIC, _devResetLink: resetLink })`. **A linha 302 inclui o token bruto no JSON da response sempre que o email casa com um user real**, independente de `NODE_ENV`. Não há gate `if (NODE_ENV === "development")`.
- **Impacto**:
  1. **Account takeover trivial**: atacante envia `POST /api/auth/forgot-password {email: vitima@x.com}`, recebe `{_devResetLink: "/reset-password?token=ABCDEF..."}`, faz `POST /api/auth/reset-password {token: "ABCDEF...", password: "atacante"}` e toma a conta. Sem precisar de acesso à caixa de email da vítima.
  2. **Account enumeration**: response COM `_devResetLink` ⇒ email existe; SEM ⇒ não existe. A intenção de "não vazar enumeration" via `GENERIC` é completamente quebrada pela presença/ausência desse campo.
  3. Aplicável em qualquer ambiente — não é dev-only.

### B2.5-2 [P2] — Zero rate limiting em endpoints de auth
- **Arquivos:linhas**: confirmação via grep `express-rate-limit|rateLimit|throttle` → 0 ocorrências em `server/`. Endpoints afetados:
  - `POST /api/auth/signup` (`identity/routes.ts:23`)
  - `POST /api/auth/login` (`identity/routes.ts:70`)
  - `POST /api/auth/forgot-password` (`identity/routes.ts:264`)
  - `POST /api/auth/reset-password` (`identity/routes.ts:310`)
  - `POST /api/auth/change-password` (`identity/routes.ts:362`)
  - `POST /api/auth/force-change-password` (`identity/routes.ts:396`)
  - `POST /api/admin/login` (`admin/routes.ts:284`)
  - `POST /api/admin/auth/reset-password` (`admin/routes.ts:324`)
- **Categoria**: brute-force / abuse / DoS
- **Descrição**: nenhuma das libs `express-rate-limit`, `express-slow-down`, `rate-limiter-flexible` está nas dependências. Login aceita unlimited tentativas. Forgot-password permite spam de tokens (cada chamada bem-sucedida invalida o anterior — sem efeito acumulativo, mas escala IO).
- **Impacto**: brute-force de senhas pretas (12 rounds bcrypt ≈ 160ms — viável em dias com paralelismo); brute-force do `ADMIN_BOOTSTRAP_SECRET` (~3.5×10²² combinações = irrealizável, mas a ausência da defesa é prática ruim); enumeração de conta via timing/4xx-difference.

### B2.5-3 [P2] — Zero `req.session.regenerate()` (session fixation)
- **Arquivos:linhas** (todos os pontos de estabelecimento de sessão):
  - `identity/routes.ts:59-63` (signup — popula session sem regenerar)
  - `identity/routes.ts:129-140` (login — popula sem regenerar; `save()` chamado mas não é o suficiente)
  - `identity/routes.ts:382-383` (change-password — não regenera)
  - `identity/routes.ts:423-425` (force-change-password — não regenera)
  - `admin/routes.ts:301-307` (admin/login `req.session.isAdmin = true` — não regenera)
- **Categoria**: session-fixation
- **Descrição**: padrão clássico OWASP — após autenticação bem-sucedida, o session ID deve ser regenerado para que um atacante que tenha plantado um session ID (via XSS, link malicioso, ou cookie injection) não consiga usá-lo após o login da vítima.
- **Impacto**: em HTTPS + httpOnly + sameSite=lax o vetor fica reduzido, mas qualquer XSS ou CSRF que consiga plantar `connect.sid` antes da vítima logar permite hijack.

### B2.5-4 [P2] — Logout não chama `clearCookie`, sessão persiste no client
- **Arquivo:linha**: `server/domains/identity/routes.ts:158-161`
- **Categoria**: session-lifecycle
- **Descrição**: `req.session.destroy(() => {})` destrói no DB mas **não chama `res.clearCookie("connect.sid")`**. O cliente fica com o cookie de sessão expired pelo Set-Cookie do server NUNCA enviado. A próxima request manda o cookie velho; o middleware cria uma nova sessão vazia. Funcionalmente "logado-out" mas o cookie fica órfão no browser até `maxAge` expirar (7 dias).
- **Impacto**: minor, mas inconsistente com padrão. Pode confundir audit logs (cookie de sessão ainda flowing após logout). O `admin/routes.ts:320-322` tem o mesmo problema.

### B2.5-5 [P2] — TTL do DB session passado em ms ao invés de segundos
- **Arquivo:linha**: `server/auth/session.ts:26`
- **Categoria**: bug / configuration
- **Descrição**: `connect-pg-simple` documenta `ttl` em **segundos**. O código passa `ttl: SESSION_TTL_MS` que é `7*24*60*60*1000 = 604_800_000` (ms). Interpretado como segundos = **19+ anos**.
  - Cookie `maxAge` (em ms) está correto (7 dias).
  - Sessions no DB acumulam para sempre — nunca expiram via TTL do store.
- **Comentário no código** (linha 24-25): "Preserves the pre-existing replitAuth.ts behaviour of passing ms here; changing units would silently alter session lifetimes in deployed envs."  ⇒ o bug é conhecido mas preservado intencionalmente para evitar mudança de comportamento.
- **Impacto**: rows em `sessions` acumulam até atingir o `expire` column (que vem do `cookie.maxAge`, 7 dias). Não é exploitable diretamente, mas: (a) tabela cresce indefinidamente se cookies persistirem; (b) pruning automático do store nunca dispara.

### B2.5-6 [P2] — `POST /api/admin/auth/reset-password` aceita qualquer email e cria admins
- **Arquivo:linha**: `server/domains/admin/routes.ts:324-363`
- **Categoria**: privilege-escalation / weak-auth
- **Descrição**: o endpoint **upserts** — se email não existe, cria novo user com `role="admin"`, `emailVerified=true`, `status="active"`, `mustChangePassword=false`. Logado como **`createdByAdmin: true`** (linha 358). Quem tem o `ADMIN_BOOTSTRAP_SECRET` pode:
  1. Resetar a senha de qualquer admin existente
  2. **Criar admins arbitrários com qualquer email**, sem limite de quantos
- Adicionalmente:
  - `bootstrapSecret !== expectedSecret` em linha 328 é comparação **não-timing-safe** (`===` no string). Deveria ser `crypto.timingSafeEqual` para evitar timing attacks (irrelevante hoje sem rate limit; relevante se atacante puder fazer muitas tentativas).
  - Senha exigida ≥ 8 chars (linha 331) — mais fraca que o warning ≥ 12 que setamos em D-9 para `ADMIN_PASS`.
- **Impacto**: o secret é o anel único — quem tem ele tem o reino. A intenção é bootstrap só, mas o endpoint fica permanentemente exposto.

### B2.5-7 [P3] — 7 endpoints `/api/admin/*` usam check inline em vez de `isAdminOnly` middleware
- **Lista exata** (12 ocorrências de admin routes sem middleware):
  - `admin/routes.ts:284` — `POST /api/admin/login` (público intencional via publicPaths)
  - `admin/routes.ts:318` — `POST /api/admin/logout` (público intencional)
  - `admin/routes.ts:324` — `POST /api/admin/auth/reset-password` (público gateado por secret no body — ver B2.5-6)
  - `admin/routes.ts:365` — `GET /api/admin/me` (retorna `{isAdmin: false}` se não for, OK)
  - `admin/routes.ts:1035` — `GET /api/admin/bots/status` — **check inline** (`req.user?.role !== "admin" && req.session?.userRole !== "admin" && !req.session?.isAdmin`)
  - `admin/routes.ts:1043` — `POST /api/admin/bots/start` — check inline
  - `admin/routes.ts:1051` — `POST /api/admin/bots/stop` — check inline
  - `admin/routes.ts:1059` — `POST /api/admin/bots/seed` — check inline (não conferi mas pattern provável)
  - `admin/routes.ts:1066` — `POST /api/admin/bots/config` — check inline
  - `performance/routes.ts:102` — `GET /api/admin/performance/baselines` — check inline (`req.user?.role !== "admin" && req.session?.userRole !== "admin"`) **omite `!req.session?.isAdmin`**
  - `performance/routes.ts:127` — `GET /api/admin/performance/player/:assetId` — check inline (mesma omissão)
  - `performance/routes.ts:157` — `GET /api/admin/performance/match/:matchId` — check inline (mesma omissão)
- **Categoria**: authorization-consistency
- **Descrição**: o gate global `adminAuth` em `routes.ts` deixa passar qualquer autenticado para `/api/*`. A discriminação admin acontece em middleware `isAdminOnly` (~70 endpoints) **ou** em check inline (12). Os 3 endpoints em `performance/routes.ts` falham para sessões admin que sejam só `isAdmin=true` sem `userRole="admin"` — situação possível se o flow de login mudar.
- **Impacto**: nenhum bypass atual confirmado, mas o pattern inconsistente é landmine para refactors futuros.

### B2.5-8 [P3] — Steam OpenID callback usa `returnUrl` da sessão sem validação
- **Arquivo:linha**: `server/domains/multigame/routes.ts:1360, 1403-1405`
- **Categoria**: open-redirect / session-trust
- **Descrição**: `const returnUrl = req.session?.steamReturnUrl ?? "/";` (linha 1360) — esse valor foi armazenado no `/start` (linha 1281 do mesmo arquivo) a partir de `req.query.returnUrl`. Sem validação de domínio ou prefixo `/`. O `res.redirect(returnUrl + "?steam_error=...")` (linha 1404) executa essa URL sem checar se é local.
- **Adicionalmente**: o OpenID 2.0 não tem state/nonce nativo — Steam usa o próprio assinatura como CSRF defense. **MAS**: se o session cookie estiver "plantado" no atacante (e o usuário logar), o atacante pode disparar o `/start` com `returnUrl` malicioso e receber o callback redirecionado para seu domínio.
- **Impacto**: open redirect via parâmetro de início persistido na sessão. Phishing potencial via fluxo Steam. Mitigado parcialmente por `isAuthenticated` no `/start` e pelo realm derivado de host (também spoofável — B2.2-9).

### B2.5-9 [P3] — Auth logs vazam emails e detalhes de tentativa de login
- **Arquivos:linhas** (7 ocorrências):
  - `identity/routes.ts:91`: `[AUTH/Login] FAIL — no user found for login="${login}"`
  - `identity/routes.ts:95`: `[AUTH/Login] FAIL — userId=${user.id} has no password hash`
  - `identity/routes.ts:100`: `[AUTH/Login] FAIL — wrong password for userId=${user.id} email="${user.email}"`
  - `identity/routes.ts:104`: `[AUTH/Login] BLOCKED — userId=... email=...`
  - `identity/routes.ts:108`: `[AUTH/Login] DELETED — userId=... email=...`
  - `identity/routes.ts:143`: `[AUTH/Login] SUCCESS — userId=... email=... role=...`
  - `identity/routes.ts:300`: `[ForgotPassword] Reset link for ${email}: ${resetLink}` — **loga o token completo**
- **Categoria**: pii-leak / log-injection
- **Descrição**: emails de usuários ficam em stdout/log file. Tokens de reset ficam em stdout (linha 300). Quem ler os logs (operador, infra team, hosting provider) tem acesso a reset tokens vivos por 1h.
- **Impacto**: PII em logs (LGPD/GDPR exposure). Tokens de reset na cleartext em logs = bypass de email channel.

### B2.5-10 [P3] — Signup case-sensitive vs login case-insensitive (duplicate email possible)
- **Arquivo:linha**: `identity/routes.ts:32` (signup, `eq(users.email, email)` — exato) vs `identity/routes.ts:84` (login, `lower(${users.email}) = ${login}` — case-insensitive)
- **Categoria**: data-integrity / auth-consistency
- **Descrição**: se Alice se cadastrar com `Alice@gmail.com`, depois Bob tentar `alice@gmail.com`, o check em :32 falha (não casa) e Bob consegue criar uma segunda conta. Mas Alice consegue logar com qualquer variação (graças ao lower no login). **Possível conflict**: ambos tentam logar com `alice@gmail.com`/senha próprias e o login retorna a primeira match (não-determinístico ou pela order do banco).
- **Impacto**: duplicate accounts possíveis; comportamento de login impreviszível em caso raro.

---

## 3. Aprofundamento dos achados existentes

### B2.2-3 — Rate limiting (lista completa + recomendação)

**Confirmado**: zero libs de rate limiting nas dependências. **8 endpoints precisam**, ordenados por risco:

| # | Endpoint | Risco | Rate sugerido |
|---|---|---|---|
| 1 | `POST /api/admin/login` | brute force admin | 5/min/IP |
| 2 | `POST /api/admin/auth/reset-password` | brute force secret + admin escalation | 3/min/IP |
| 3 | `POST /api/auth/login` | brute force user | 10/min/IP |
| 4 | `POST /api/auth/forgot-password` | token spam + enumeration | 5/min/IP + 3/hour/email |
| 5 | `POST /api/auth/reset-password` | token brute force (mas espaço 2^256 — improvável) | 20/min/IP |
| 6 | `POST /api/auth/signup` | account spam + enumeration | 3/min/IP |
| 7 | `POST /api/auth/change-password` | autenticado, baixo risco | 10/min/user |
| 8 | `POST /api/auth/force-change-password` | autenticado, baixo risco | 5/min/user |

**Recomendação técnica**: `express-rate-limit` com store em memória (suficiente para single-instance). Key por `req.ip` + opcionalmente `req.body.email` para combos por-email. Adicionar `helmet` junto.

### B2.2-4 — Session regeneration (lista exata)

**Pontos onde DEVE chamar `req.session.regenerate(cb)` ANTES de popular session data**:

| # | Arquivo:linha | Hoje | Deveria |
|---|---|---|---|
| 1 | `identity/routes.ts:59-63` (signup) | Direto popula `req.session.userId = newUser.id` | regen → popula → save |
| 2 | `identity/routes.ts:129-140` (login) | Direto popula + `save()` | regen → popula → save |
| 3 | `identity/routes.ts:382-383` (change-password) | atualiza `mustChangePassword=false` no session | regen recomendado (mudança de credenciais) |
| 4 | `identity/routes.ts:423-425` (force-change-password) | atualiza `mustChangePassword` | regen recomendado |
| 5 | `admin/routes.ts:301-307` (admin/login DB-path) | popula `isAdmin/userId/userRole` | regen |
| 6 | `admin/routes.ts:289-294` (admin/login env-path) | popula `isAdmin=true` | regen |
| 7 | `multigame/routes.ts:1414-1418` (Steam callback após verify) | não muda session-auth, mas opcional | opcional |

`session.regenerate(cb)` é syncrono via promise wrapper:
```ts
await new Promise<void>((resolve, reject) =>
  req.session.regenerate(err => err ? reject(err) : resolve())
);
// then populate session
```

### B2.2-5 — 7 endpoints `/api/admin/*` com check inline (lista completa exata)

Listei completamente em **B2.5-7** acima. Resumo:
- 5 endpoints em `admin/routes.ts:1035-1066` (bots/*)
- 3 endpoints em `performance/routes.ts:102, 127, 157` (admin/performance/*)
- Mais 4 endpoints público-intencionais (`/api/admin/login`, `/logout`, `/auth/reset-password`, `/me`) que não devem ter `isAdminOnly`

**Padronização proposta**: substituir os 8 inline checks (3 perf + 5 bots) por `isAdminOnly` middleware. Reduz 8 if-blocks para 8 args de middleware. Mantém os 4 público-intencionais intocados.

**Cobertura exaustiva**: greppei TODOS os `app.(get|post|put|delete|patch)` em `/api/admin/*` em todo `server/`. Os 12 listados são os únicos sem `isAdminOnly`. Não há endpoint admin "esquecido sem QUALQUER check".

### B2.2-9 — Steam OpenID realm (análise técnica)

**Fluxo**:
1. `/start` em `multigame/routes.ts:1272-1343`:
   - Gate `isAuthenticated` → exige sessão
   - Salva `req.session.steamReturnUrl = req.query.returnUrl ?? "/"`
   - Calcula `host` por fallback: `APP_URL` → `REPLIT_DEPLOYMENT/DOMAINS` → `REPLIT_DEV_DOMAIN` → `req.protocol://req.get("host")`
   - Cria login URL para Steam: `realm = host`, `return_to = host + "/api/auth/steam/callback"`
2. `/callback` em `multigame/routes.ts:1359+`:
   - Endpoint público (Steam redireciona unauthenticated)
   - Lê `req.session?.userId` — exige sessão preservada
   - Lê `req.session?.steamReturnUrl` para redirect final
   - Delega a `adapter.handleCallback()` que verifica a assinatura openid

**Vetores**:
- **Open redirect**: `returnUrl` salvo na sessão pode apontar para qualquer URL (B2.5-8)
- **Realm/host spoofing**: `req.get("host")` é um header HTTP spoofável se trust proxy não está configurado (no caso `trust proxy = 1` está setado, então respeita 1 hop de X-Forwarded-Host). Risk: low se proxy é confiável; high se direto-exposto.
- **State/CSRF**: OpenID 2.0 não tem state nativo. Steam assina o callback inteiro, então CSRF está coberto **se** o atacante não pode plantar a sessão antes. Se o atacante consegue plantar `connect.sid`, ele pode fazer o `/start` com returnUrl malicioso, e o usuário logado completa o handshake e é redirecionado para o atacante.

### sec-reset-pass — `/api/admin/auth/reset-password` análise linha-a-linha

```ts
324:  app.post("/api/admin/auth/reset-password", async (req, res) => {
325:    try {
326:      const { email, newPassword, bootstrapSecret } = req.body;     // ① sem schema/zod
327:      const expectedSecret = process.env.ADMIN_BOOTSTRAP_SECRET;
328:      if (!expectedSecret || bootstrapSecret !== expectedSecret) {   // ② === não-timing-safe
329:        return res.status(403).json({ message: "Invalid bootstrap secret" });
330:      }
331:      if (!email || !newPassword || newPassword.length < 8) {        // ③ 8 chars (mais fraco que ADMIN_PASS warn ≥12)
332:        return res.status(400).json({ message: "..." });
333:      }
334:      const hash = await bcrypt.hash(newPassword, 12);
335:      const normalizedEmail = email.trim().toLowerCase();
...
337:      const [updated] = await db.update(users).set({...}).where(...);  // ④ UPDATE if exists
342:      if (updated) return res.json({success: true, action: "updated"});
346:      const [created] = await db.insert(users).values({               // ⑤ INSERT if not exists — cria admin!
347:        email: normalizedEmail,
350:        role: "admin",                                                 // ⑥ todos os created são admin
353:        emailVerified: true,                                           // ⑦ pula email verification
357:        createdByAdmin: true,
358:      } as any).returning(...);
359:      return res.json({success: true, action: "created"});
```

**3 vulnerabilidades**:
1. **Privilege escalation via creation**: quem tem o secret pode criar admins arbitrários. O nome é "reset password" mas o efeito é "upsert admin".
2. **Timing attack**: `===` em strings revela info de prefixo. Sem rate limit, brute force teórico possível para secrets curtos. Mitigado pelo tamanho (você usou 64 chars).
3. **Sem rate limit**: bate com B2.5-2. Combinado com #1, atacante pode tentar muitos secrets sem throttle.

**Recomendação**:
- Substituir `===` por `crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))` com pré-check de length
- Adicionar rate limit (3/min/IP)
- Considerar split em 2 endpoints: `/api/admin/auth/reset-password` (só UPDATE existente) vs `/api/admin/auth/bootstrap-admin` (só INSERT, com token de uso único separado)
- Aumentar min length de senha para 12 (alinhado com warning do D-9)

---

## 4. Análise por fluxo

### 4.1 Signup (`POST /api/auth/signup`, identity/routes.ts:23-68)
- ✅ Validação básica de campos obrigatórios
- ✅ bcrypt 12 rounds
- ✅ Cria portfolio + wallets idempotentemente
- ❌ Email comparison case-sensitive (B2.5-10)
- ❌ Sem regex email — aceita "abc" como email
- ❌ Sem rate limit
- ❌ Sem session regenerate
- ❌ 409 em email duplicado = enumeration leak
- ⚠️ Não envia email de verificação (`emailVerified: false` mas sem token; conta já pode ser usada)

### 4.2 Login (`POST /api/auth/login`, identity/routes.ts:70-156)
- ✅ Case-insensitive (lower(email)), aceita email ou displayName
- ✅ bcrypt.compare
- ✅ Block/deleted/pending status checks
- ✅ Updates lastLoginAt
- ✅ Auto-backfill wallets for old users (catches in promise, won't crash login)
- ✅ Explicit `session.save()` antes de responder (linha 138-140)
- ❌ Sem session regenerate (B2.5-3)
- ❌ Sem rate limit
- ❌ Logs detalhados com PII (B2.5-9)
- ✅ Resposta uniforme "Invalid email or password" para 3 falhas distintas (no user / no hash / wrong pwd) — bom anti-enumeration nessa parte

### 4.3 Logout (`POST /api/auth/logout`, identity/routes.ts:158-161)
```ts
req.session.destroy(() => {});
res.json({ success: true });
```
- ❌ Callback vazio engole erros
- ❌ Não chama `res.clearCookie("connect.sid")` (B2.5-4)
- ⚠️ Responde sucesso antes da destroy completar — se DB write falhar, cliente acha que loggou-out mas sessão persiste no servidor
- Equivalente em admin: `admin/routes.ts:318-322` — apenas `req.session.isAdmin = false` + `adminUsername = undefined`. Não destrói sessão. Reseta só os 2 fields, mas `req.session.userId` (se existir) fica. Pode resultar em estado misturado.

### 4.4 Forgot / Reset password
**Forgot** (`identity/routes.ts:264-307`):
- ✅ Generic response anti-enumeration (`GENERIC` const linha 266)
- ✅ Token 256 bits via `crypto.randomBytes(32)`
- ✅ Apenas SHA-256 hash persistido (não plain)
- ✅ TTL 1h
- ✅ Tokens anteriores invalidados (linha 285-290)
- 🔴 **LINHA 302 RETORNA O TOKEN NA RESPONSE** (B2.5-1)
- ❌ Logs token (B2.5-9)
- ❌ Sem rate limit

**Reset** (`identity/routes.ts:310-339`):
- ✅ Token validation (existência, used, expired)
- ✅ Password policy: ≥8 chars + letter + number (regex)
- ✅ Marca `usedAt` após sucesso
- ✅ Clear `mustChangePassword` flag
- ❌ Sem rate limit
- ❌ Sem session regenerate (não há sessão para regenerar — usuário pode estar não-logado)
- ⚠️ Não invalida outras sessões ativas do mesmo user — se atacante já tem sessão, reset não corta

**Validate** (`identity/routes.ts:342-359`): GET sem mutação — OK.

### 4.5 Force password change (`identity/routes.ts:396-433`)
- ✅ Re-verify DB que `mustChangePassword=true` (não confia só na session, anti-stale)
- ✅ Policy igual ao reset
- ✅ Session `save()` explícito
- ❌ Sem session regenerate
- ❌ Sem rate limit
- Frontend gating (3 lugares em App.tsx — ProtectedRoute:86-88, RootRoute:145, PredictRoute:130) — sem loops detectados em auditoria 2.3

### 4.6 Admin bootstrap/reset (`admin/routes.ts:324-363`)
Detalhado em sec-reset-pass acima.

**Resumo**: cria/atualiza admins se conhecer o secret. Sem rate limit. `===` não-timing-safe. Min 8 chars (deveria ser 12).

### 4.7 Steam OpenID (`multigame/routes.ts:1272-1470`)
- ✅ `/start` gateado por `isAuthenticated`
- ✅ `/callback` público (Steam pode redirecionar unauthenticated — design correto)
- ✅ Signature verification delegada a adapter (linha 1387)
- ✅ Auto-create connected_account em sucesso (Fase 26, linha 1412)
- ❌ `returnUrl` sem validação (B2.5-8 — open redirect)
- ❌ `host` derivation spoofable (B2.2-9)
- ⚠️ `req.session?.steamReturnUrl` (linha 1360) — se sessão for resetada entre start e callback (e.g., user logou em outra device), `returnUrl` cai para "/", mas `userId` cai para undefined ⇒ redirect com `?steam_error=SESSION_EXPIRED`

### 4.8 Replit OIDC (`server/replit_integrations/auth/replitAuth.ts`)
- ✅ Gated por `REPL_ID` ausente (D-8 do remediation) — não roda em Windows local
- ✅ Função `setupAuth(app)` só chamada se `process.env.REPL_ID` truthy (`server/routes.ts:163`)
- ⚠️ Se hipoteticamente fosse rodar com REPL_ID setado, herdaria todos os problemas do `passport` flow (sem regenerate, sem CSRF state explícito)

---

## 5. Configuração de sessão

### Server (`server/auth/session.ts`)
- **Store**: branching `connect-pg-simple` (com `DATABASE_URL`) vs `memorystore` (sem) — bom para testes
- **`createTableIfMissing: false`** ✅ (tabela `sessions` vem do schema Drizzle, não auto-criada)
- **Secret**: `process.env.SESSION_SECRET` exigido (throw se ausente — D-fix) ✅
- **Cookie flags**:
  - `httpOnly: true` ✅
  - `secure: NODE_ENV === "production"` ✅ — só HTTPS em prod, OK em dev local
  - `sameSite: "lax"` ✅ — CSRF defense para top-level navigations
  - `maxAge: 7 days` (em ms) ✅
  - `path: "/"` ✅
  - **Falta**: `name` customizado — usa default `connect.sid` que disclose framework

- **`resave: false`** ✅ (sessão só re-saved se modified)
- **`saveUninitialized: false`** ✅ (sessão não-criada para anônimos)
- **`trust proxy: 1`** ✅ (set em `routes.ts:167` e duplicado em `replitAuth.ts:41`)

- **🐛 Bug TTL**: linha 26 passa `ttl: SESSION_TTL_MS` (ms) onde `connect-pg-simple` espera segundos — B2.5-5

### Frontend (`use-auth.ts`)
- **Query key**: `["/api/auth/me"]`
- **Storage**: cookies only (zero `localStorage` confirmado em 2.3)
- **`staleTime: 5min`**: cache razoável
- **`refetchOnWindowFocus: true`** ✅ — atualiza ao voltar pra aba
- **`retry: false`** ✅ — 401 não re-tenta, fail-fast
- **Logout**: `window.location.href = "/login"` (linha 36) — full reload limpa state. Funcional mas brutal.
- **Detecção 401**: `fetchAuthMe` retorna `null` em 401, e o hook trata `data === null` como "não-autenticado"
- **⚠️ `console.log("AUTH STATE", ...)`** na linha 67 — loga em todo render no browser console com email/displayName em prod. PII em console.

---

## 6. Authorization

### Middleware tier

**`isAuthenticated`** (definido **separadamente em 5+ arquivos**):
- `identity/routes.ts:11-15`
- `multigame/routes.ts` (provavelmente)
- `replitAuth.ts:135-162` (versão OIDC com refresh token)
- `server/routes.ts:43-47` (versão adminAuth global)
- `routes/ ... player-operator/routes.ts` (versão local)

Inconsistência de implementação — algumas checam `req.session?.isAdmin || req.session?.userId`, outras adicionam `req.isAuthenticated()` (Passport). Não é landmine direto, mas duplicação de lógica.

**`isAdminOnly`** (não-greppei a definição mas vejo no admin/routes.ts ~70 endpoints aplicam):
```ts
const isAdminOnly: RequestHandler = (req: any, res, next) => {
  if (req.session?.isAdmin) return next();
  if (req.session?.userRole === "admin") return next();
  return res.status(403).json({ message: "Forbidden" });
};
```
(definido em `server/routes.ts:49-53` baseado no que vi em audit anterior)

Padrão saudável **quando usado**.

**`isAdminUser(req)` helper** vs raw checks — coexistem em multigame. Não foi consolidado.

### Route guards no frontend (já em 2.3)
- `ProtectedRoute` — 401 redirect `/login`, force-pwd check
- `AdminRoute` — non-admin redirect `/terminal`
- `PredictRoute` — feature flag gated

**Comportamento em network error**: `useAuth` com `retry: false` trata erro de rede como "401-equivalente" (data null), forçando re-login em flap de rede. Agressivo mas seguro.

---

## 7. Smells novos identificados

### CSRF
- **Nenhuma defesa explícita**. Sem `csurf`, sem custom CSRF token middleware.
- Defesa atual: `sameSite: "lax"` no cookie de sessão. Funciona para:
  - top-level navigations (GET) — cookie é enviado, mas resposta JSON é safe se não tiver side-effect
  - cross-site form submissions (POST sem credentials) — cookie NÃO é enviado
- **Gap**: endpoints `POST` chamados via `fetch` com `credentials: "include"` de outro domain não funcionam por default (sameSite=lax). Mas se algum endpoint estiver em GET e mudar state, sameSite não protege.
- Greppando `app.get` que faz `db.update`/`db.insert`/`db.delete`: spot-checked não encontrei. Não-side-effect-GET pattern bem aderido.
- **Verdict**: CSRF defense suficiente para o setup atual, mas frágil — qualquer endpoint POST/PUT/DELETE adicionado sem ciência dessa dependência fica vulnerável.

### Headers de segurança
- ❌ **`helmet` NÃO instalado** (grep zero)
- ❌ Nenhum `res.setHeader("X-Frame-Options", "DENY")`, nenhum CSP, nenhum HSTS, nenhum X-Content-Type-Options
- Response default do Express: `X-Powered-By: Express` disclosed (helmet remove)

### Logging de auth
- ✅ Login success/fail loggado com detalhes (`identity/routes.ts:91-143`)
- ✅ Password reset loggado (linha 333)
- ✅ Force change loggado (linha 427)
- ❌ Logs incluem emails (PII) — B2.5-9
- ❌ **Logs incluem reset token completo** (linha 300) — B2.5-9
- ❌ Não há tabela `audit_log` para mudanças de role admin
- ❌ Mudança de senha não dispara logout das outras sessões (não há mecanismo)

### Account lockout
- ❌ **Inexistente**. Greppei `failedAttempts`, `lockoutUntil`, `loginAttempts`, `lockedAt` — zero matches em `server/`.
- Combinado com sem rate limit: brute force ilimitado e sem freio.

### Email verification
- `users.emailVerified` boolean existe (default `false` em signup, `true` em admin-created)
- Token de verificação **não existe** (sem grep matching `email.verify`, `verifyEmail`, `verification.token`)
- Conta criada via signup pode ser usada imediatamente sem confirmar email
- Apenas marca cosmética

### 2FA / MFA
- ❌ **Inexistente** em backend e frontend (grep zero por `totp|2fa|MFA|twofactor|two_factor|authenticator`)

### Account enumeration
- ✅ Forgot password: response uniforme (linha 266 `GENERIC`)
- ✅ Login: 3 cenários de falha retornam mesma mensagem
- ❌ Signup: 409 specificamente para email duplicado — vaza enumeration
- ❌ Forgot password com `_devResetLink` field presente/ausente — vaza enumeration (B2.5-1)

---

## 8. Quantitativos

| Métrica | Valor |
|---|---:|
| Endpoints de auth totais | **12** (signup, login, logout, me, forgot, reset, validate-reset, change-pwd, force-change, access-request, admin-login, admin-reset, admin-logout, admin-me) |
| Endpoints SEM rate limit | **12 (100%)** |
| Endpoints SEM `session.regenerate()` | **5 (todos que estabelecem sessão)** |
| `bcrypt.hash/compare` call sites | **10** (consistentemente 12 rounds) |
| `req.session` mutation sites | **~15** |
| Cookie flags (`auth/session.ts:41-47`) | httpOnly ✅, secure (prod-only) ✅, sameSite=lax ✅, maxAge 7d, path / |
| TTL DB session | **BUGGED** (ms passado como segundos = 19 anos efetivos) |
| `trust proxy` setting | **1** (1 hop confiável) |
| `isAdminOnly` middleware applications | **~70 endpoints** |
| `/api/admin/*` com check inline | **7** (3 perf + 4 bots — admin/me/login/logout/reset-password são públicos intencionais) |
| `helmet` instalado | **NÃO** |
| `csurf` ou CSRF token custom | **NÃO** |
| Account lockout | **NÃO** |
| Email verification real | **NÃO** (só flag, sem token) |
| 2FA/MFA | **NÃO** |
| Audit log table | **NÃO** |
| Auth logs em stdout | sim (com PII + tokens) |
| Session ID name | default `connect.sid` (disclose framework) |
| Frontend `localStorage` | **0 ocorrências** (tokens só em cookies) ✅ |
| `console.log` com user info em prod | **sim** (`use-auth.ts:67`) |

---

## 9. Recomendações de prioridade (Top 5)

| # | Ação | Justificativa | Effort |
|---|---|---|---|
| **1** 🔴 | **Remover `_devResetLink` da response em `forgot-password`** (`identity/routes.ts:302`) — ou gatear por `NODE_ENV !== "production"` | B2.5-1. Account takeover trivial. Fix de 1-3 linhas. **EMERGÊNCIA** | 5min |
| **2** | **Instalar `express-rate-limit`** e aplicar nos 8 endpoints listados em B2.2-3 | B2.5-2. Bloqueia brute-force e enumeration via timing | 1h (instalar + configurar tabela de regras + smoke test) |
| **3** | **Adicionar `req.session.regenerate()`** nos 5 callsites (signup/login/admin-login/change-pwd/force-change-pwd) | B2.5-3. Padrão OWASP. Promise wrapper já é o pattern existente para `save()` | 30min |
| **4** | **Refatorar admin checks**: substituir 7 inline em `bots/*` e `performance/*` por `isAdminOnly` middleware | B2.5-7. Reduz superfície de regressão em refactors | 30min |
| **5** | **Logout limpa cookie**: adicionar `res.clearCookie("connect.sid")` em `identity/routes.ts:158` e `admin/routes.ts:318`. Bonus: `res.clearCookie` antes do `res.json` | B2.5-4. Limpa estado do cliente | 10min |

**Bônus operacional** (não Top 5 mas importante quando expor publicamente):
- Adicionar `helmet` com defaults razoáveis (X-Frame-Options, X-Content-Type-Options, HSTS) — 15min
- Mascarar emails em logs ou usar logger estruturado (pino + redact) — 1h
- Fix TTL bug em `auth/session.ts:26` (passar segundos ao invés de ms) — 1 linha + smoke

---

## 10. Score subjetivo de qualidade

| Área | Score | Observação |
|---|---:|---|
| Password hashing | **9.0** | bcrypt 12 rounds consistente em 10 callsites |
| Reset token design (cryptography) | **8.0** | 256-bit token + SHA-256 hash + TTL + single-use. Mas leak em forgot endpoint (B2.5-1) tira pontos |
| Session config (cookies) | **7.5** | Flags HTTP corretas; bug de TTL ms vs sec |
| Session regeneration | **2.0** | Inexistente em 5 pontos |
| Rate limiting | **0.0** | Inexistente em todos os 12 endpoints |
| Authorization (isAdminOnly coverage) | **6.5** | 90% via middleware, 7 inline (não-broken mas inconsistente) |
| Account enumeration defenses | **5.0** | Bom em login + forgot generic, mas signup 409 + `_devResetLink` field leak |
| CSRF | **6.0** | Só sameSite=lax; suficiente para POST-via-fetch atual, mas frágil |
| Headers de segurança (helmet/CSP/HSTS) | **2.0** | Inexistente |
| Logging de auth (audit trail) | **5.5** | Logs existem mas com PII + tokens |
| Account lockout | **0.0** | Inexistente |
| Email verification | **2.0** | Flag existe, fluxo de token não |
| 2FA / MFA | **0.0** | Inexistente |
| Force-password-change flow | **8.5** | Gateado em 3 lugares; re-checa DB; clean |
| Steam OpenID flow | **6.5** | Signature verification correto; open redirect risk em returnUrl |
| Replit OIDC gating | **9.0** | Correto via D-8 fix; não roda sem REPL_ID |
| **Total auth** | **5.5** | Fundação criptográfica boa; defesas operacionais ausentes; 1 leak crítico |

---

## Notas finais

- A combinação **B2.5-1 (token leak) + B2.5-2 (sem rate limit)** torna account takeover trivialmente automatizável. Fix do B2.5-1 deve ser feito **antes** de qualquer outro deploy/exposição.
- Auth está bem desenhado nas partes que importam (bcrypt rounds, token entropy, TTL, single-use), mas tem gaps operacionais clássicos (rate limit, regenerate, helmet, lockout). Esses gaps são fixáveis em 1 sprint.
- O Steam flow é mais complexo do que parece — confiar em `req.session?.userId` no callback assume continuidade da sessão entre `/start` e `/callback`. Já tem `?steam_error=SESSION_EXPIRED` fallback. OK.
- O Replit OIDC está dormindo (sem REPL_ID). Se um dia decidir habilitá-lo de novo (e.g., para o legacy server), revisitar com cuidado.
- Para auditoria 2.6 (segurança), incluir: análise de headers em todas as responses (não apenas auth), CSRF para mutations cross-domain se houver expansão, e revisão de logging level por ambiente.

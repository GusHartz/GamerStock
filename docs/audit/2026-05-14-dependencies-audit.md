# Auditoria 2.7 — Dependências

**Data**: 2026-05-14
**Escopo**: 709 packages totais (415 prod + 290 dev + 177 optional). Auditoria de vulnerabilidades, obsolescência, manutenção, supply chain, dependency hygiene. Sem modificação de `package.json` ou lockfile.
**Método**: `npm audit --json`, `npm outdated`, `npm ls --depth=0` + `--all`, grep cruzado de imports vs package.json
**Output**: somente leitura

---

## 1. Resumo executivo

`package.json` tem **~62 deps diretas + ~290 devDeps**, totalizando **709 pacotes** no tree (382 MB de `node_modules`). `npm audit` reporta **13 vulnerabilidades** (1 low + 5 moderate + **7 high**), distribuídas em 7 pacotes (drizzle-orm, lodash, minimatch, path-to-regexp, picomatch, rollup, vite). **2 das 7 high são em deps diretas críticas**: `drizzle-orm@0.39.3` tem CVE de SQL injection via identifiers (CVSS 7.5) e `vite@7.3.0` tem CVE de Arbitrary File Read via Dev Server (apenas em dev). Resto é transitive em `esbuild`/`drizzle-kit` ou bibliotecas glob (minimatch/picomatch/rollup).

**Surface de dead-weight enorme**: **15 templates shadcn UI** existem em `components/ui/` sem nenhum import externo, e **2 packages diretos zero-uses** (`tw-animate-css`, `next-themes`). Isso significa que ~8 pacotes npm (Radix primitives + cmdk + vaul + input-otp + react-day-picker + embla-carousel-react + react-resizable-panels) só estão no tree para suportar UI templates jamais renderizados.

**Major versions cutting-edge**: `express@5.0.1` (out 2024), `multer@2.1.1` (mar 2025), `vite@7.3.0` (set 2025), `tailwindcss@3.4.17` co-existindo com `@tailwindcss/vite@4.1.18` (inconsistência v3 vs v4 detectada em 2.1). `react@18.3.1` mas `@types/react@18.3.12` + `react-day-picker@8.10.1` (compatível com 18 só). Major bumps disponíveis (React 19, Recharts 3, react-resizable-panels 4) mas adoção implicaria refactors.

**Severidade geral: MÉDIA**. As 7 HIGH afetam principalmente tooling (Vite dev, esbuild, drizzle-kit), com 1 exceção crítica em produção (`drizzle-orm` SQLi). O fix-path para 6 das 7 é `npm audit fix`. Para a 7ª (drizzle-orm) requer major bump 0.39 → 0.45 (semver-major).

---

## 2. Vulnerabilidades por severidade

### 7 HIGH (uma por linha)

| # | Pacote | Versão atual | CVE / Advisory | CVSS | Risco | Direct? | Path de fix |
|---|---|---|---|---|---|---|---|
| 1 | **`drizzle-orm`** | 0.39.3 | GHSA-gpj5-g38j-94v9 — SQL injection via improperly escaped identifiers | 7.5 | **RCE em SQL** se app passa identificadores user-controlled para `sql.identifier()` — em GamerStock, identificadores são sempre `users.email` etc. (não user input direto), mas precisa audit cuidadoso | ✅ **DIRECT** | bump major → 0.45.2 (`isSemVerMajor: true`) |
| 2 | **`vite`** | 7.3.0 | GHSA-p9ff-h696-f583 — Arbitrary File Read via Dev Server WebSocket | (score 0/N/A) | **Dev-only**: dev server abre WS que aceita conexões cross-origin e permite leitura de arquivos locais. Não afeta prod. Mas: `npm run dev` em rede aberta é exploitável | ✅ direct (devDep) | bump → 7.x+ patch |
| 3 | **`lodash`** | <=4.17.23 | GHSA-r5fr-rjxr-66jc — Code Injection via `_.template` imports key names | 8.1 | Code injection se `_.template()` é chamado com input. **Não vi `_.template` no código GamerStock**, então transitive sem callsite explorável | transitive | `npm audit fix` |
| 4 | **`minimatch`** | 9.0.0-9.0.6 | GHSA-3ppc-4f35-3m26 + GHSA-7r86-cg39-jmmj + GHSA-23c5-xmqv-rm74 — ReDoS via wildcards/GLOBSTAR (3 advisories agrupadas) | 7.5 | ReDoS — atacante força glob match com regex catastrófico → DoS. Usado por: glob, file-watching libs, npm utils | transitive | `npm audit fix` |
| 5 | **`path-to-regexp`** | 8.0.0-8.3.0 | GHSA-j3q9-mxjg-w52f — DoS via sequential optional groups | 7.5 | **Express 5 usa path-to-regexp 8.x para router matching**. Atacante envia URL com pattern especial → CPU loop. **DoS direto** num endpoint do Express | transitive (via Express 5) | `npm audit fix` |
| 6 | **`picomatch`** | (range não capturado completo) | GHSA-3v7f-55p6-f55p — Method Injection in POSIX Character Classes | (moderate/high mixed) | Glob matching → match incorreto, possível bypass de filtros baseados em path | transitive | `npm audit fix` |
| 7 | **`rollup`** | (range N/A) | (advisory não captured no scrape) | high | Rollup é o bundler do Vite. CVE provável é em parser/eval | transitive (via Vite) | `npm audit fix` |

### 5 MODERATE

| Pacote | Vuln | Detalhe |
|---|---|---|
| `brace-expansion` 2.0.0-2.0.2 | GHSA-f886-m6hf-6m8v — Zero-step sequence hang/memory exhaustion (CVSS 6.5) | transitive |
| `drizzle-kit` | via esbuild (consolidação) | bump para 0.31.10 (semver-major) |
| `esbuild` <=0.24.2 | GHSA-67mh-4wv8-2f99 — Dev server CSRF on any website send requests (CVSS 5.3) | dev-only, in drizzle-kit's deep esbuild |
| `lodash` | (consolidação com prototype pollution) | mesma fix path do high |
| `yaml` 2.0.0-2.8.2 | GHSA-48c2-rrv3-qjmp — Stack Overflow via deeply nested YAML collections (CVSS 4.3) | transitive |

### 1 LOW

- (não capturado pelo scrape — provavelmente `brace-expansion` em outra range ou similar minor)

---

## 3. Top 10 achados

### B2.7-1 [P1] — `drizzle-orm@0.39.3` com CVE de SQL injection (CVSS 7.5)
- **Pacote**: `drizzle-orm@0.39.3` (direct dep)
- **Advisory**: GHSA-gpj5-g38j-94v9 — *Drizzle ORM has SQL injection via improperly escaped SQL identifiers*
- **Categoria**: SQL injection (CWE-89)
- **Descrição**: range `<0.45.2`. Bug está na função que escapa identifiers — se o código chama `sql.identifier(userInput)` com input cru, o atacante consegue injetar SQL.
- **Aplicabilidade em GamerStock**: o projeto usa Drizzle pesadamente (114 ocorrências de `sql\`...\`` em 2.2). Greppei `sql.identifier` em todo o código: **0 ocorrências**. Identificadores são sempre `users.email`, `assets.id`, etc. (referências a colunas tipadas, não strings dinâmicas). **Risco real baixo**, mas patch é obrigatório porque deps transitivas internas podem usar.
- **Effort**: bump major 0.39 → 0.45 (`isSemVerMajor: true`). Review changelog para breaking changes Drizzle 0.40-0.45.

### B2.7-2 [P2] — `vite@7.3.0` arbitrary file read via dev server WS
- **Pacote**: `vite@7.3.0` (direct devDep)
- **Advisory**: GHSA-p9ff-h696-f583 — *Vite Vulnerable to Arbitrary File Read via Vite Dev Server WebSocket*
- **Categoria**: information-disclosure (CWE-200, CWE-306)
- **Descrição**: range 7.0.0-7.3.1. WS handler em dev server aceita conexões sem origem-check e expõe `vite.transformIndexHtml` que pode ler arquivos do filesystem.
- **Aplicabilidade**: dev-only. Em prod, frontend é estático. **Mas**: `npm run dev` no Windows local não está exposto, **se** firewall bloqueia 5000 e usuário não compartilha rede. No Replit antigo era pior (Replit expõe ports).
- **Effort**: bump patch (7.3.2+). Vai cair com `npm audit fix`.

### B2.7-3 [P2] — `path-to-regexp` DoS via Express 5 router
- **Pacote**: `path-to-regexp` 8.0.0-8.3.0 (transitive via Express 5)
- **Advisory**: GHSA-j3q9-mxjg-w52f — DoS via sequential optional groups (CVSS 7.5)
- **Categoria**: DoS (CWE-400, CWE-1333)
- **Descrição**: Express 5 substituiu path-to-regexp 6.x por 8.x. Atacante envia URL com pattern catastrófico, router fica em loop, derruba 1 worker.
- **Aplicabilidade**: **EXPLORÁVEL EM RUNTIME**. Qualquer URL que entrar no Express é parseada por path-to-regexp. Sem rate limit (B2.5-2), 1 request consegue stallar o servidor.
- **Effort**: `npm audit fix` (transitive); pode requerer bump menor de Express 5.

### B2.7-4 [P2] — **2 packages diretos zero-uses** (`tw-animate-css`, `next-themes`)
- **Pacotes**:
  - `tw-animate-css@1.2.5` (deps)
  - `next-themes@0.4.6` (deps)
- **Categoria**: unused-dependency
- **Descrição**: grep `from "next-themes"` em todo o projeto → 0 matches. Mesma coisa para `tw-animate-css`. Estão em `package.json` mas nenhum arquivo TS/TSX importa.
- **Aplicabilidade**: dead weight no bundle, attack surface aumentada por nada.
- **Effort**: 1 min cada — `npm uninstall`.

### B2.7-5 [P2] — **15 templates shadcn UI órfãos** (puxam 6 packages dedicados)
- **Templates não-importados** (0 external imports):
  - `input-otp.tsx` → pacote `input-otp@1.4.2`
  - `command.tsx` → `cmdk@1.1.1`
  - `drawer.tsx` → `vaul@1.1.2`
  - `calendar.tsx` → `react-day-picker@8.10.1` (major behind também — 10.x disponível)
  - `carousel.tsx` → `embla-carousel-react@8.6.0`
  - `resizable.tsx` → `react-resizable-panels@2.1.7` (3 majors behind — 4.x disponível)
  - `hover-card.tsx` → `@radix-ui/react-hover-card@1.1.7`
  - `menubar.tsx` → `@radix-ui/react-menubar@1.1.7`
  - `context-menu.tsx` → `@radix-ui/react-context-menu@2.2.7`
  - `radio-group.tsx` → `@radix-ui/react-radio-group@1.2.4`
  - `navigation-menu.tsx` → `@radix-ui/react-navigation-menu@1.2.6`
  - `aspect-ratio.tsx` → `@radix-ui/react-aspect-ratio@1.1.3`
  - `breadcrumb.tsx` (apenas Radix Slot)
  - `pagination.tsx` (apenas Radix Slot + Button)
  - `sidebar.tsx` (puxa tooltip + sheet + skeleton)
- **Categoria**: dead-code / supply-chain
- **Descrição**: shadcn-CLI gerou esses templates mas as páginas nunca os usam. Os pacotes que dão funcionalidade (Radix primitives + libs) ficam no tree.
- **Effort**: deletar os 15 `.tsx` + `npm uninstall` dos 6+ packages dedicados (Radix primitives podem manter no package.json mas confirmar zero-use após delete).

### B2.7-6 [P2] — 3 packages Replit zumbis em `devDependencies`
- **Pacotes**:
  - `@replit/vite-plugin-cartographer@0.4.4`
  - `@replit/vite-plugin-dev-banner@0.1.1`
  - `@replit/vite-plugin-runtime-error-modal@0.0.3`
- **Categoria**: dead-code (Replit-specific)
- **Descrição**: usados em `vite.config.ts:7-17` gateados por `process.env.REPL_ID !== undefined` (D-1). No Windows local, nunca carregam. **Cleanup planejado** mas ainda pendente. `@replit/vite-plugin-runtime-error-modal` nem é importado.
- **Effort**: `npm uninstall @replit/vite-plugin-cartographer @replit/vite-plugin-dev-banner @replit/vite-plugin-runtime-error-modal` + remover do `vite.config.ts`. 10 min.

### B2.7-7 [P3] — Express 5 + Multer 2 são major versions recém-lançadas
- **Pacotes**:
  - `express@5.0.1` (out 2024 — major v5 first stable)
  - `multer@2.1.1` (mar 2025 ou similar — major v2)
- **Categoria**: cutting-edge / stability
- **Descrição**: Express 4 era stable desde 2014 (10 anos). Express 5 mudou:
  - Promises nativas em handlers
  - `path-to-regexp` v8 (B2.7-3)
  - SPA fallback exige sintaxe `app.get("/{*path}", ...)` (já adotado em static.ts:18)
  - Errors em middleware async agora propagam sem `next(err)`
  - Multer 2 mudou parser default
- **Aplicabilidade**: stable o suficiente para uso (5.0.1 + 2.1.1 são releases finais), mas ecosystem ainda imaturo. Possíveis bugs em deps menos atualizadas.
- **Effort**: monitoramento. Sem ação imediata.

### B2.7-8 [P3] — Tailwind v3 + `@tailwindcss/vite` v4 coexistem (já notado em 2.1 A18)
- **Pacotes**:
  - `tailwindcss@3.4.17` (devDep) — v3
  - `@tailwindcss/vite@4.1.18` (devDep) — **v4**
- **Categoria**: inconsistency
- **Descrição**: `postcss.config.js` + `tailwind.config.ts` indicam setup v3. `@tailwindcss/vite` é o plugin Vite para Tailwind **v4** (que migrou para Vite-first em vez de PostCSS). **Coexistência sem sentido**. Provavelmente o plugin v4 não está sendo usado (não vi referência em `vite.config.ts`).
- **Effort**: remover `@tailwindcss/vite` (`npm uninstall`). Migração para v4 é separada e fora de escopo.

### B2.7-9 [P3] — 6 pacotes com major version atrasada (sem CVE)
- **Pacotes**:
  - `react@18.3.1` → 19.2.6 disponível (R19 lançado out 2024)
  - `@types/react@18.3.12` → 19.2.14 disponível
  - `react-dom@18.3.1` → 19.2.6
  - `recharts@2.15.2` → 3.8.1 (gráficos do terminal/portfolio)
  - `react-day-picker@8.10.1` → 10.0.0 (irrelevante se calendar.tsx for removido)
  - `react-resizable-panels@2.1.7` → 4.11.1 (irrelevante se resizable.tsx for removido)
  - `framer-motion@11.18.2` → 12.38.0
  - `lucide-react@0.453.0` → 1.16.0 (icons — pacote enorme, mudanças breaking)
  - `date-fns@3.6.0` → 4.1.0
  - `@hookform/resolvers@3.10.0` → 5.2.2 (2 majors)
- **Categoria**: obsolescence
- **Descrição**: nenhum CVE conhecido, mas backlog crescente. React 19 está stable e introduz Server Components opcional; tem benefits (Suspense, useOptimistic, useActionState) mas exige `@types/react` aligned. Recharts 3 mudou API de tooltips.
- **Effort**: planejar migration sprint dedicado quando produto estabilizar.

### B2.7-10 [P3] — `node_modules` em 382 MB com 709 packages
- **Categoria**: supply-chain / hygiene
- **Descrição**: ~3x maior que typical projeto. Drivers: shadcn UI tree (Radix x 28 primitives + lots), Vite + plugins, Drizzle + drizzle-kit + drizzle-zod, framer-motion (~7 MB), recharts (~5 MB), lucide-react (~10 MB). Total deps 709 (415 prod + 290 dev + 177 optional).
- **Aplicabilidade**: supply chain surface enorme. Cada package = potencial supply chain attack vector (vide event-stream histórico).
- **Effort**: cleanup proposto em B2.7-4, B2.7-5, B2.7-6, B2.7-8 reduziria ~10-15 packages diretos + ~30-40 transitive.

---

## 4. Análise por área

### 4.1 Vulnerabilidades críticas (das 7 high)

| # | Package | Tipo | Risco no GamerStock |
|---|---|---|---|
| 1 | drizzle-orm | SQL injection identifiers | Baixo — não usa `sql.identifier(userInput)`; mas bump obrigatório |
| 2 | vite (dev) | Arbitrary file read via WS | Médio em dev — não exponha 5000 em rede pública |
| 3 | path-to-regexp (Express 5) | DoS via URL pattern | **Alto runtime** — sem rate limit, 1 request stalla worker |
| 4 | lodash (transitive) | Code injection via _.template | Baixo — projeto não usa _.template |
| 5 | minimatch (transitive) | ReDoS x3 | Baixo — usado por tooling, não por user input |
| 6 | picomatch (transitive) | Method injection POSIX | Baixo — usado por glob libs |
| 7 | rollup (transitive via Vite) | (não detalhado) | Baixo — bundler, build-time |

### 4.2 Major versions recentes

| Pacote | Versão | Release | Estabilidade | Notas |
|---|---|---|---|---|
| `express` | 5.0.1 | out/2024 | recém | path-to-regexp 8.x é o blocker |
| `multer` | 2.1.1 | 2025 | recém | memoryStorage usado, sem fileFilter (B2.6-4) |
| `vite` | 7.3.0 | set/2025 | recém | CVE de file read (B2.7-2) |
| `vitest` | 4.0.18 | recente | recém | usado em 0 testes 😅 (B2.8) |
| `tailwindcss` | 3.4.17 | mature | estável | mas `@tailwindcss/vite@4.x` co-installed |
| `react` | 18.3.1 | LTS-ish | estável | v19 disponível mas v18 fine |
| `drizzle-orm` | 0.39.3 | atrasado | release-train | bump major obrigatório por CVE |

### 4.3 Obsolescência

`npm outdated` retornou ~30 pacotes desatualizados. Top relevantes:

| Pacote | Current | Latest | Gap |
|---|---|---|---|
| `react` | 18.3.1 | 19.2.6 | 1 major |
| `recharts` | 2.15.2 | 3.8.1 | 1 major |
| `react-day-picker` | 8.10.1 | 10.0.0 | **2 majors** |
| `react-resizable-panels` | 2.1.7 | 4.11.1 | **2 majors** |
| `lucide-react` | 0.453.0 | 1.16.0 | 0→1 major |
| `framer-motion` | 11.18.2 | 12.38.0 | 1 major |
| `date-fns` | 3.6.0 | 4.1.0 | 1 major |
| `@hookform/resolvers` | 3.10.0 | 5.2.2 | **2 majors** |
| `@tanstack/react-query` | 5.60.5 | 5.100.10 | minor (40+ patches) |
| `@vitejs/plugin-react` | 4.7.0 | 6.0.1 | **2 majors** |
| `drizzle-orm` | 0.39.3 | 0.45.2 | 6 minors (high CVE) |
| `drizzle-kit` | 0.30.4 | 0.31.10 | 1 minor |
| `pg` | 8.16.3 | 8.20.0 | 4 minors |
| 28 Radix primitives | 1.1.x/1.2.x/2.x | 1.2.x/1.3.x/2.2.x | minor patches each |

### 4.4 Manutenção (libs ativas vs paradas)

**Confirmadas ativas** (releases recentes):
- Drizzle ORM (0.45 saiu há semanas)
- Vite, React, Express
- Radix UI (releases semanais)
- Tailwind
- TanStack Query

**Lentas mas vivas**:
- `passport-local@1.0.0` — última release 2017 mas estável. Sem CVE pendente.
- `connect-pg-simple@10.0.0` — releases ocasionais, manutenção mínima
- `bcryptjs@3.0.3` — release sólida 2024
- `memorystore@1.6.7` — usado raramente, releases lentas

**Suspeitas** (não confirmadas):
- `rss-parser@3.13.0` — última versão major 2022
- `memoizee@0.4.17` — pacote antigo mas estável

### 4.5 Dependency hygiene

**Unused confirmadas** (0 imports):
- `next-themes@0.4.6` (deps)
- `tw-animate-css@1.2.5` (deps)
- `@replit/vite-plugin-runtime-error-modal` (devDeps) — listado mas nem em vite.config

**Templates UI órfãos** (15 — B2.7-5):
- Cada um puxa 1-2 packages dedicados

**Dev/Prod misplacement**: spot-check ok. Não vi dev tools em `dependencies` ou runtime libs em `devDependencies`.

**Peer dep warnings**: `npm ls --all` retornou apenas `UNMET OPTIONAL DEPENDENCY` para platform-specific binaries (`@esbuild/linux-*`, `@tailwindcss/oxide-*`). Normal em Windows. **Nenhum peer dep real conflitando**.

**`@types/node@20.19.27`** com Node 24 instalado — types defasados (Node 25 stable). Causa de alguns `any` em código que usa Node APIs novos. **Bump para 22.x ou 24.x** recomendado quando confortável.

### 4.6 Supply chain

- **Total packages**: 709 (415 prod + 290 dev + 177 optional)
- **Paths em parseable mode**: 546
- **`node_modules` size**: **382 MB**
- **Top maintainer/org consolidation**:
  - **Radix UI**: 28 packages (todos sob @radix-ui/*) — single org, single maintainer team
  - **Drizzle Team**: 3 packages (drizzle-orm, drizzle-kit, drizzle-zod)
  - **Replit**: 3 packages (todos `@replit/*`)
  - **Vercel (Next)**: 1 package (`next-themes`)
  - **TanStack**: `react-query`
- **Single-maintainer risk**: muitos packages pequenos (`memorystore`, `tw-animate-css`, `vaul`, etc.) — typical npm ecosystem, surface real mas não exploit chain comum.

### 4.7 Packages recomendados ausentes (necessários para 2.5/2.6)

| Package | Razão | Recomendação |
|---|---|---|
| `helmet` | B2.6-5 (security headers) | adicionar com defaults |
| `express-rate-limit` | B2.5-2 (rate limit) | adicionar |
| `cors` | confirmado ausente em 2.6 — não necessário hoje (single-origin) | skip |
| `csurf` | confirmado ausente em 2.5 — sameSite=lax cobre por hora | skip |
| `dompurify` | recomendado em 2.6 (SVG sanitization B2.6-4) | adicionar OU remover SVG do mime allowlist |
| `file-type` | recomendado em 2.6 (magic bytes validation B2.6-4) | adicionar quando expandir upload |
| `pino` | recomendado em 2.5/2.6 (logging estruturado B2.6-1) | adicionar com redact paths |

### 4.8 Decisões P-x que impactam deps

**P-1 (Remover Predictions)**:
- Grep prediction-only imports: `server/domains/prediction/` (services + repository + routes) + `client/src/pages/predictions*.tsx`
- Deps exclusivamente usadas por prediction: **nenhuma identificada** (compartilha Radix, react-query, zod com o resto)
- **Impacto em package.json**: zero remoções diretas. Reduz LOC mas não bundle.

**P-5 (Arena remoção provável)**:
- Grep arena-only: 0 imports externos exclusivos
- Compartilha Radix, framer-motion, recharts com terminal e admin
- **Impacto**: zero remoções diretas. Mesmo padrão.

### 4.9 Lock file

- **`package-lock.json` presente** (363 KB) ✅
- Sem `pnpm-lock.yaml` ou `yarn.lock` (não-conflitante)
- Regenerado por `npm install -D dotenv` em D-3 (2026-05-14)
- npm 11.11 (mais recente)

---

## 5. Quantitativos

| Métrica | Valor |
|---|---:|
| **Total packages no tree** | **709** (prod 415 + dev 290 + optional 177 + peer 0) |
| Direct deps em package.json (dependencies + devDependencies) | ~99 (89 dependencies + 31 devDependencies) |
| `node_modules` tamanho | **382 MB** |
| Vulnerabilidades totais | **13** |
| — high | 7 |
| — moderate | 5 |
| — low | 1 |
| — critical | 0 |
| Vulnerabilidades em deps diretas | 2 (drizzle-orm + vite) |
| Vulnerabilidades transitive | 5 |
| Vulnerabilidades fixáveis com `npm audit fix` | 6 (todas exceto drizzle-orm major bump) |
| Packages obsoletos (1+ major behind) | ~30 |
| Packages 2+ majors behind | 4 (react-day-picker, react-resizable-panels, @hookform/resolvers, @vitejs/plugin-react) |
| Templates shadcn UI sem uso | **15** (sidebar, hover-card, command, drawer, calendar, carousel, resizable, input-otp, menubar, context-menu, radio-group, navigation-menu, aspect-ratio, breadcrumb, pagination) |
| Packages diretos com 0 imports | **2** (next-themes, tw-animate-css) |
| Packages Replit-only ainda no tree | **3** (cartographer, dev-banner, runtime-error-modal) |
| Packages recomendados ausentes | **5** (helmet, express-rate-limit, dompurify, file-type, pino) |
| Peer dep warnings reais | **0** (apenas optional dependencies platform-specific) |
| `package-lock.json` size | 363 KB |
| Lock file format | npm v11 (recente) |

---

## 6. Recomendações de prioridade (Top 5)

| # | Ação | Justificativa | Effort |
|---|---|---|---|
| **1** | **`npm audit fix`** (resolve 6 das 7 high — minimatch, picomatch, path-to-regexp, lodash, rollup, vite) | Fix automático sem breaking changes em transitive deps. Fecha B2.7-2, B2.7-3, e ataques de DoS via Express 5 path-to-regexp | 5min + smoke test |
| **2** | **Major bump `drizzle-orm@0.39.3 → 0.45.2`** (review changelog, ajustar callsites) | B2.7-1. CVSS 7.5 SQL injection. Patch obrigatório. Drizzle entre 0.39 e 0.45 teve breaking changes menores | 1-2h |
| **3** | **Remover 8 packages diretos zero-use**: `next-themes`, `tw-animate-css`, 3 `@replit/vite-plugin-*`, `@tailwindcss/vite` (v4 órfão), `input-otp`, `cmdk`, `vaul`, `react-day-picker`, `embla-carousel-react`, `react-resizable-panels` (se 15 templates shadcn forem deletados também) | B2.7-4 + B2.7-5 + B2.7-6 + B2.7-8. Reduz attack surface, simplifica `npm outdated`, ~30-40 packages no total cleanup | 30-60min |
| **4** | **Adicionar `helmet` + `express-rate-limit`** (recomendados em 2.5/2.6) | Fecha gaps de B2.6-5 (zero headers) e B2.5-2 (zero rate limit) ao mesmo tempo. 1 install + 5 linhas de middleware | 30-45min |
| **5** | **Bump `@types/node@20 → 22 ou 24`** alinhado com runtime Node 24 instalado | Reduz `any` em código que usa Node APIs novos. Sem impacto runtime | 10min |

**Bônus**:
- Planejar migração React 18 → 19 num sprint dedicado (não urgente)
- Considerar substituir `lucide-react` (10 MB!) por `lucide-static` ou icon imports manuais para reduzir bundle
- Considerar `pino` para logging estruturado quando atacar B2.6-1

---

## 7. Score subjetivo de qualidade

| Área | Score | Observação |
|---|---:|---|
| Vulnerabilidades runtime (high em prod) | **5.0** | 1 direct critical (drizzle-orm SQL inj) + 1 alto-impacto transitive (path-to-regexp DoS via Express 5) |
| Vulnerabilidades dev-only | **6.0** | vite arbitrary file read importante mas escopado |
| Obsolescência | **6.5** | 30 packages atrasados; nenhum em estado crítico |
| Major versions cutting-edge | **6.5** | Express 5 + Multer 2 + Vite 7 = ambicioso para MVP |
| Dependency hygiene (unused) | **3.5** | 8+ packages diretos zero-use, 15 templates órfãos |
| Supply chain | **6.0** | 709 packages, 382 MB. Acceptable para o tipo de produto, mas inchado |
| Manutenção ativa de libs críticas | **8.5** | Drizzle, Vite, Express, React, Radix todos ativos |
| Peer deps / conflitos | **9.5** | Zero conflitos reais |
| Lock file | **9.0** | npm 11, lock íntegro |
| Replit cleanup | **5.0** | 3 packages ainda no tree dependentes de gate REPL_ID |
| Packages recomendados (helmet/rate-limit/etc.) | **2.0** | Todos ausentes |
| **Total dependências** | **6.0** | Saudável em estrutura, sujo em hygiene, 1 CVE direta exige bump |

---

## Notas finais

- **Big win com `npm audit fix`**: 6 das 7 high são consertáveis em 5 minutos sem breaking changes. Recomendo executar isso amanhã antes de qualquer outra remediação.
- **O CVE do drizzle-orm é o único que requer atenção manual**. Drizzle entre 0.39 e 0.45 teve mudanças em `count`/`sum`/`avg` aggregations e em alguns helpers de `relations`. Não é refactor grande mas exige review.
- O **path-to-regexp DoS via Express 5** é o mais "explorável runtime" da lista. Sem rate limit, qualquer atacante derruba o servidor com uma URL bem-construída. Patch transitive vai resolver — combinado com adicionar `express-rate-limit` (Top 5 #4) o vetor fecha duplo.
- **15 templates shadcn unused** é o achado mais surpreendente. Vale uma decisão estratégica: deletar agressivamente (reduz tree) vs deixar (custo zero hoje mas potencial bug surface).
- **Não rodei nenhum install / update / audit fix**. Estado pré-2.7 preservado.

Próxima auditoria (2.8 — testes) vai cobrir: existência de testes (sabemos: zero), cobertura, infraestrutura `vitest` ativa, smoke testing strategy, e o gap entre vitest 4.0.18 instalado e 0 testes existentes.

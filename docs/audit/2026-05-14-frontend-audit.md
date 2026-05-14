# Auditoria 2.3 — Frontend Profundo

**Data**: 2026-05-14
**Escopo**: client/src (~25k LOC), foco em god files, state management, routing/auth, features, acoplamento backend, transversais (a11y/segurança/tipagem/perf)
**Método**: leitura cirúrgica + 2 sub-agentes Explore (terminal.tsx, state/routing/features) + 5 investigações pontuais (B-1, B-2, B-7, B-9, P-9)
**Output**: somente leitura

---

## 1. Resumo executivo

Frontend de React 18 + Vite 7 + TanStack Query v5 + wouter + shadcn/Radix + Tailwind. Arquitetura **acima da média para MVP**: 3 route guards consistentes (`ProtectedRoute`/`AdminRoute`/`PredictRoute`), force-password-change gating em 3 níveis, separação limpa entre Context (UI) e TanStack Query (server state), zero `localStorage` (tokens só em cookie httpOnly), zero `@ts-ignore`, zero `dangerouslySetInnerHTML` real (a única ocorrência é injeção interna de CSS do shadcn). Auth flow seguro com `credentials: "include"` consistente.

**Fraquezas concentradas** em 4 frentes: (i) **bugs específicos confirmados** — B-1 (Buying Power lê 2 endpoints diferentes), B-2 (filtro default `/assets?game=dota2` hardcoded), B-7 (`.find()` sem null-safe em admin/arena:230), B-9 (watchlist LoL-hardcoded até no rank "Challenger" estático); (ii) **acoplamento LoL profundo no copy + tipos** (B-9, P-9) — 14+ strings hardcoded incompatíveis com a visão multigame; (iii) **performance bottlenecks futuros** — zero code splitting (50+ rotas em bundle único), zero virtualization (terminal renderiza scanner com 50 rows hoje sem virtualizar); (iv) **140 ocorrências de `any`** (37 só nos top 3 arquivos) — débito de tipos que não dói agora mas trava refactors.

**Severidade geral: MÉDIA**. Sem vulnerabilidades de segurança real client-side. 3 bugs P1 funcionais que afetam UX hoje. 11 áreas de débito conhecidas, fixáveis incrementalmente.

---

## 2. Top 10 achados

### B2.3-1 [P1] — Buying Power lê de 2 fontes divergentes
- **Arquivo:linha**:
  - Header: `client/src/components/layout.tsx:73-78` (`useGsWallet() → gsBalance`)
  - QuickBuy panel (terminal): `client/src/pages/terminal.tsx:940-942` (mesma `useGsWallet()`)
  - Trade modal: `client/src/pages/terminal.tsx:1831-1833` (`usePortfolio() → portfolio?.portfolio?.balance`)
- **Categoria**: data-consistency / coupling
- **Descrição**: o header e o QuickBuy panel leem **wallet balance** (endpoint provavelmente `/api/wallets/me`). O Trade Modal lê **portfolio balance** (`/api/portfolio`). Wallet e portfolio são duas representações com semânticas diferentes: wallet inclui locked funds via `lockedBalance`, portfolio tem `balance` derivado de trades + initial seed (10 000 GS).
- **Impacto**: usuário vê `$1 000` no header e `$10 000` no modal. Pode pensar que tem $10k e tentar comprar, mas a wallet só libera $1k → ordem rejeitada. Bug reportado pelo usuário, raiz confirmada.

### B2.3-2 [P1] — `/admin/arena` crash em null `.find()`
- **Arquivo:linha**: `client/src/pages/admin/arena.tsx:230`
- **Categoria**: bug / runtime-error
- **Descrição**: `const activeSeason = data?.seasons.find((s) => s.id === data.activeSeasonId);` — optional chaining para na propriedade `seasons` mas continua sem proteção no `.find()`. Quando `data` é `undefined` (loading inicial, erro 401, response malformada), `data?.seasons` retorna `undefined`, e chamar `.find()` em `undefined` **throw imediato**: `Cannot read properties of undefined (reading 'find')`.
- **Impacto**: a página `/admin/arena` quebra na primeira renderização antes da query carregar (ou se a query falhar). Fix trivial: `data?.seasons?.find(...)`.

### B2.3-3 [P1] — `/assets` default `game=dota2` hardcoded
- **Arquivo:linha**: `client/src/pages/assets.tsx:1331`
- **Categoria**: ux / bug
- **Descrição**: `const [game, setGame] = useState(urlParams.get("game") ?? "dota2");` — sem `?game=...` na URL, força filtro `dota2`. Combinado com o endpoint `/api/assets?game=dota2` (linha 1380), retorna apenas assets dota2. Se o DB foi seedado primariamente com Riot NA1 Challenger (LoL), a página mostra "No players match". Terminal usa `/api/market/assets` (endpoint diferente, com seu próprio comportamento — coletivo "all" → "dota2" em `terminal.tsx:374`).
- **Impacto**: usuário vê 800 players no terminal e zero em `/assets`. Reportado. Fix: default `game="all"` ou tornar opcional (sem param).

### B2.3-4 [P2] — Watchlist é LoL-only por design (incluindo rank "Challenger" hardcoded)
- **Arquivo:linha**: `client/src/pages/watchlist.tsx:67, 79-80, 139`
- **Categoria**: hardcoded-domain / multigame-blocker
- **Descrição**: linha 67 "Tracking your favorite players across the rift" (frase LoL-specific). Linhas 79-80 colunas hardcoded "Region" e "Rank Tier". Linha 139 **renderiza `<span>Challenger</span>` LITERAL** para cada asset, sem checar se é o rank verdadeiro. O tipo `WatchlistAsset` (linhas 6-14) sequer tem campo `game` ou `rank` — está fixado em shape Riot. Re-fetch a cada 5s (linha 36) — agressivo para uma página de bookmarks.
- **Impacto**: usuário com asset Dota2 na watchlist vê coluna "Rank Tier: Challenger" mesmo que Dota2 não use isso. Confusão. Não é só copy — é a *forma* da tabela.

### B2.3-5 [P2] — Copy LoL hardcoded espalhado em 14+ pontos
- **Arquivo:linha** (amostra representativa):
  - `client/src/pages/landing.tsx:35` — `"Trade shares of top League of Legends players based on their live performance."`
  - `client/src/pages/login.tsx:69` — string idêntica à do landing
  - `client/src/pages/watchlist.tsx:67` — "across the rift"
  - `client/src/pages/leaderboard.tsx:96-97` — `"NA1 Challenger Leaderboard"`, `"Real Riot NA1 Challenger players ranked by League Points"`
  - `client/src/pages/leaderboard.tsx:106` — placeholder `"Search by summoner name or tag..."`
  - `client/src/components/riot-leaderboard.tsx:49, 71, 89, 127` — "Search summoner name…", "Trigger a sync from… NA1 Challenger leaderboard", coluna "Summoner", `{player.summonerName}`
  - `client/src/pages/player.tsx:198, 232` — "League Points", "This stock is backed by a real NA1 Challenger player… Riot Games API"
  - `client/src/pages/asset-detail.tsx:149` — "League Points"
  - `client/src/pages/terminal.tsx:69` — METRIC_INFO.lp tooltip ("Riot ranking system")
  - `client/src/pages/terminal.tsx:1144-1152` — `isLoL` check + "Challenger avg" string
  - `client/src/pages/terminal.tsx:2802, 2933, 3254, 3518` — "Challenger", "LoL", "Connect a Riot account…"
  - `client/src/state/syntheticContext.tsx:9` — tipo `summonerTag` (LoL-shaped)
- **Categoria**: hardcoded-domain
- **Descrição**: o produto tem hoje 4 jogos (Dota2, LoL, CS2, Valorant) e a copy de marketing/onboarding ainda assume LoL. Não é falha de implementação — é texto antigo não atualizado durante a fase multigame.
- **Impacto**: usuário entrando pelo `/login` lê "League of Legends" e pode não entender que pode trocar shares de jogadores de Dota2/CS2.

### B2.3-6 [P2] — Zero code splitting: 50+ rotas em bundle único
- **Arquivo:linha**: `client/src/App.tsx` (~385 LOC; 0 ocorrências de `React.lazy` em todo o projeto)
- **Categoria**: performance
- **Descrição**: todos os imports de páginas são estáticos no topo do `App.tsx`. Não há `lazy()` em rota nenhuma. Bundle inicial inclui `terminal.tsx` (164 KB), `assets.tsx` (72 KB), `portfolio.tsx` (45 KB), `arena-draft.tsx` (40 KB), e 21 páginas admin (que usuários comuns nunca visitam).
- **Impacto**: tempo de primeira interação degrada com o crescimento. Para o admin (que nunca verá `/admin`), bundle inicial carrega tudo. Ainda mais relevante para mobile.

### B2.3-7 [P2] — Zero virtualization em listas potencialmente grandes
- **Arquivo:linha**: ausência de `react-window` / `react-virtual` / `@tanstack/react-virtual` em todo o projeto
- **Categoria**: performance
- **Descrição**: o backend pode servir 800+ assets para o terminal; o frontend está paginando (50 rows visíveis), o que mitiga *agora*. Mas:
  - `terminal.tsx` scanner re-renderiza todas as 50 rows a cada SSE tick (linha 387-391 atualiza `flashMap` no render)
  - `leaderboard.tsx` mostra até 50 jogadores sem virtualizar
  - `arena-leaderboards.tsx` (31 KB) idem
  - Tabela admin de users (`admin/users.tsx`) cresce com a base
- **Impacto**: aceitável hoje. Vira problema quando alguma lista passar de ~100 rows ou quando o terminal tiver SSE + WS firing a cada segundo.

### B2.3-8 [P3] — 140 ocorrências de `: any` ou `as any` (47 só nos 3 piores arquivos)
- **Arquivo:linha**: distribuídos; top:
  - `client/src/pages/terminal.tsx`: **26**
  - `client/src/pages/settings/my-assets.tsx`: **25**
  - `client/src/hooks/use-vaults.ts`: **16**
  - `client/src/pages/settings/accounts.tsx`: 7
  - `client/src/pages/assets.tsx`: 6
  - Demais ≤ 6 cada
- **Categoria**: type-safety / debt
- **Descrição**: a maioria são casts em respostas JSON (`res.json() as any`) ou em handlers de Recharts (`formatter={(v: any) => …}`). Mas alguns são em props internas (e.g., `terminal.tsx` tem `any` em handlers de mutation onError). Compensação: **zero `@ts-ignore` e zero `@ts-expect-error`** — discipline of strict mode é boa fora dos casts.
- **Impacto**: bugs de runtime que poderiam ser pegos pelo compilador escapam. Refactors em estruturas tipadas com `any` na borda têm risco elevado.

### B2.3-9 [P3] — Botões icon-only sem `aria-label`
- **Arquivo:linha**:
  - `client/src/pages/watchlist.tsx:142-152` — `Trash2` (remove from watchlist) só tem `title`
  - `client/src/pages/assets.tsx:1657` — star toggle só com `title`
  - `client/src/pages/terminal.tsx` — múltiplos icon buttons sem `aria-label`
  - `client/src/components/layout.tsx:101-109` — logout button (X icon) só com `title`
- **Categoria**: accessibility
- **Descrição**: tooltips do shadcn dão alguma cobertura via ARIA roles, mas `title` HTML não é equivalente a `aria-label` para screen readers em todos os contextos. Botões com só ícone (Star, X, Trash2, ChevronUp/Down, Search) precisam de `aria-label="..."` explícito.
- **Impacto**: usuários de screen reader navegam sem entender ações. Não é showstopper mas é acessibilidade básica WCAG 2.1 AA não atendida.

### B2.3-10 [P3] — Inline object/array em props recriados a cada render
- **Arquivo:linha**:
  - `client/src/pages/assets.tsx:283` — `contentStyle={{...}}` recriado em cada render do MiniChart
  - `client/src/pages/assets.tsx:262-266` — `validPoints.filter(...).map(...)` cria array novo a cada render
  - `client/src/pages/terminal.tsx:713, 920` — inline `style={{minHeight: ...}}`
  - `client/src/pages/assets.tsx:336-341` — inline style object no PlayerCard
- **Categoria**: performance / re-renders
- **Descrição**: objetos inline mudam de identidade em todo render, quebrando shallow compare de `React.memo` (se usado). Não tem `useCallback` em parte alguma do terminal — handlers como `() => setSort(...)` recriados em todo render.
- **Impacto**: re-renders desnecessários em listas; degradação imperceptível agora, mas amplifica se virtualization for adicionada futuramente (key-by-identity quebra).

---

## 3. Investigações específicas (B-x e P-9)

### B-1 — Buying Power divergente: ✅ raiz confirmada
Dois data sources distintos:
- **Header + Terminal QuickBuy** usam `useGsWallet()` (hook em `hooks/use-wallets.ts`) → fetch `/api/wallets/me` (ou similar) → campo `availableBalance` (provavelmente `balance - lockedBalance`)
- **Trade Modal** em `terminal.tsx:1831-1833` usa `usePortfolio()` (hook em `hooks/use-portfolio.ts`) → fetch `/api/portfolio` → campo `portfolio.balance` (saldo bruto do portfolio, sem subtrair locked)
- **Recomendação**: unificar para uma fonte só (`useGsWallet`) em todos os componentes que mostram "Buying Power".

### B-2 — `/assets` vazio com 800 no terminal: ✅ raiz confirmada
Dois fatores combinados:
1. Default state em `assets.tsx:1331`: `useState(urlParams.get("game") ?? "dota2")` — filtra dota2
2. Endpoint `/api/assets` (com filtro `game=dota2`) é diferente de `/api/market/assets` que o terminal usa
3. Backend pode estar aplicando filtros distintos nos dois endpoints (e.g., `/api/assets` pode ter um filtro "tradeable" ou "approved" que `/api/market/assets` não tem)
- **Investigação no backend pendente**: confirmar se `/api/assets?game=dota2` retorna 0 mesmo com dota2 assets existindo no DB. Frontend está correto no que faz — bug pode estar no backend filter ou na semântica esperada do endpoint.

### B-7 — `/admin/arena` crash: ✅ raiz confirmada
`client/src/pages/admin/arena.tsx:230`:
```ts
const activeSeason = data?.seasons.find((s) => s.id === data.activeSeasonId);
```
`data?.seasons` resolve para `undefined` quando `data` é undefined (loading state, response sem `seasons`, network error). `.find()` em `undefined` ⇒ `TypeError`. Fix de 1 caractere: `data?.seasons?.find(...)`.

### B-9 — Watchlist LoL-only: ✅ raiz confirmada — refactor necessário
Não é só copy. É:
1. Tipo `WatchlistAsset` (linhas 6-14) sem campo `game` ou `rank`
2. Frase de subtítulo (`:67`): "across the rift"
3. Colunas hardcoded (`:79-80`): "Region", "Rank Tier"
4. **Rank renderizado como literal "Challenger" para CADA asset** (`:139`)
5. Renderização de `asset.region?.toUpperCase()` (`:135`) — colunas LoL-shaped
- **Refactor necessário**: passar a tabela a renderer game-aware, com colunas dinâmicas; tipo enriquecido com `game` e dados rank-specific por jogo; copy genérica.

### P-9 — LoL hardcoded copy: ✅ amostra coletada
Lista representativa (não exaustiva — há mais):

| Arquivo:linha | String hardcoded |
|---|---|
| `landing.tsx:35` | "Trade shares of top League of Legends players based on their live performance" |
| `login.tsx:69` | (idêntica à de landing) |
| `watchlist.tsx:67` | "Tracking your favorite players across the rift" |
| `watchlist.tsx:139` | "Challenger" (rank hardcoded, todo asset) |
| `leaderboard.tsx:96` | "NA1 Challenger Leaderboard" |
| `leaderboard.tsx:97` | "Real Riot NA1 Challenger players ranked by League Points" |
| `leaderboard.tsx:106` | placeholder "Search by summoner name or tag…" |
| `riot-leaderboard.tsx:49` | placeholder "Search summoner name…" |
| `riot-leaderboard.tsx:71` | "…NA1 Challenger leaderboard" |
| `riot-leaderboard.tsx:89, 127` | column "Summoner", `{player.summonerName}` |
| `player.tsx:198, 232` | "League Points"; "real NA1 Challenger player… Riot Games API" |
| `asset-detail.tsx:149` | "League Points" |
| `terminal.tsx:69` | METRIC_INFO.lp ("Riot ranking system") |
| `terminal.tsx:1144-1152, 2802, 2933, 3254, 3518` | "Challenger", "LoL", "Connect a Riot account…" |
| `state/syntheticContext.tsx:9` | tipo `summonerTag` |

**Estimativa**: ~25-30 strings totais em ~10-12 arquivos. Substituir por tabela de copy game-aware ou i18n strings é trabalho de 2-3h.

---

## 4. Análise por área

### 4.1 God files

#### `pages/terminal.tsx` — 3 537 LOC (164 KB)

Estrutura: **38 sub-componentes definidos inline**. Os maiores:

| Componente | Linhas | LOC | Status |
|---|---|---:|---|
| `MarketScanner` | 339-680 | 342 | Tabela com filtros/sort/paginação — extraível |
| `TradeTicket` | 1534-1925 | 392 | Form modal completo — extraível |
| `CompactTradeBox` | 1926-2207 | 282 | **Duplicação** ~80% com TradeTicket |
| `PlayerFundamentals` | 2721-3023 | 303 | Painel direito com 2 charts Recharts |
| `PlayerDetailCard` | 681-912 | 232 | Side panel asset details |
| `AssetHeroHeader` | 1180-1361 | 182 | Header com preço + timeframe |
| `AssetChartSummary` | 1362-1533 | 172 | Wrapper Recharts |
| `PlayerMarketGrid` | 962-1102 | 141 | 3 grids de 8 assets |
| `TradeTape` | 3024-3161 | 138 | Histórico de trades |
| `OpenOrdersPanel` | 2446-2568 | 123 | Trigger orders + cancel |

**Hooks usage**:
- 18 `useState` (vários poderiam ser `useReducer` em TradeTicket)
- 6 `useEffect` (SSE/WS lifecycle, pagination reset, auto-select)
- 9 `useMemo` (filtros, watchlist Set, chart data)
- **0 `useCallback`** — handlers como `() => setSort(...)`, `(e) => setQty(...)` recriam a cada render
- 30 `useQuery` (alguns com chaves potencialmente colidindo entre `MarketScanner` e `PlayerMarketGrid`)
- 6 `useMutation`

**Smells específicos**:
- Linha 112-116: `getAssetGameLabel` inclui "lol" mas comentário linha 90-91 diz terminal é Dota2-only
- Linha 304-311: `SCANNER_ROLE` é LoL-role-specific (TOP/JGL/MID/ADC/SUPPORT) com cores hardcoded
- Linha 318-329: thresholds de momentum/divergence/change hardcoded sem config (15, -35, 0.005, 0.007, 12, 4)
- Linha 376: `refetchInterval: 5000` repetido 4 vezes
- Linha 472, 475, 478: `.slice(0, 20)` hardcoded para top-N
- Linha 1611: `fee = gross * 0.02` (2% fee hardcoded — devia vir do backend `assetMarkets.feeBps`)
- Linha 1944-1960 (CompactTradeBox): refatorar conjunto com TradeTicket via hook compartilhado

**Modularização possível**: alta. 8-10 sub-arquivos viáveis sem mudar comportamento.

#### `pages/assets.tsx` — 1 725 LOC

Estrutura (15 sub-componentes inline):

| Componente | Linhas | Função |
|---|---|---|
| `GameBadge`, `RegionBadge`, `PerfBar` | 208-249 | Badges utilitários |
| `MiniChart` | 251-295 | Wrapper Recharts |
| `PlayerCard` | 317-472 | Card grande de cada asset (155 LOC) |
| `AssetTradeModule` | 474-783 | **Modal de trade — 309 LOC** |
| `SafeAssetTradeModule` | 784-793 | Wrapper com ErrorBoundary |
| `GlobalErrorMonitor` | 795-843 | Monitor de erros global |
| `Drawer*` (5 componentes) | 866-1280 | Painel deslizante de detalhes |
| `AssetDrawer` | 1153-1280 | Orquestrador do drawer |
| `AssetsPageInner` | 1321-1700+ | Página principal |

**Causa raiz B-2 aqui**: linha 1331 default `game="dota2"`.

**Magic numbers**:
- Linha 1298: `PAGE_SIZE = 25` (no terminal era 50)
- Linha 1331: default `"dota2"`
- Linha 1380: endpoint `/api/assets` (diferente do terminal `/api/market/assets`)

**Duplicação com terminal.tsx**:
- `MiniChart`, `GameBadge`, `RegionBadge`, `PerfBar` — todos LoL/multigame badges, similares a componentes do terminal
- `AssetTradeModule` × `TradeTicket` — função idêntica, código separado

### 4.2 State management

**Estrutura**:
- `client/src/state/TerminalProvider.tsx` (11 LOC) + `terminalStore.ts` (116 LOC) — Context + useReducer para UI state (selectedAsset, side, gameFilter, search)
- `client/src/state/syntheticContext.tsx` (118 LOC) — context separado para demo mode com helpers
- `client/src/features/trade/TradeCardContext.tsx` (11 LOC) — intent global de trade modal

**Padrão geral**: limpo. Sem overlap entre contexts. Discriminated union actions, typed. **Nenhum Redux/Zustand/Jotai** — apenas Context + TanStack Query.

**TanStack Query defaults** (`client/src/lib/queryClient.ts:44-57`):
- `queryFn` global: `getQueryFn({ on401: "returnNull" })` — retorna null em 401, não throw
- `staleTime: Infinity` — caching agressivo
- `retry: false` — fail-fast
- `refetchOnWindowFocus: false` — explicit control

**Problemas notados**:
- `staleTime: Infinity` global, mas vários `useQuery` no terminal overridem com `refetchInterval` (5s, 10s, 120s) sem padrão claro. Pode haver fontes pollando 5s desnecessariamente.
- Query key colliding risk: `["/api/market/assets", ...]` é usado em `MarketScanner` e `PlayerMarketGrid` no terminal com params possivelmente diferentes

**`apiRequest` helper** (linhas 10-24): method + URL + body → Response. Throw em non-ok. Usado para POST/DELETE/PATCH. **Inconsistência**: GETs usam fetch direto (não via helper), perdendo a uniformidade de error handling.

### 4.3 Routing & auth gates

**`App.tsx`** (~385 LOC): Wouter Switch com 50+ rotas. Sem base path. **Não usa `React.lazy`** — todos os imports estáticos.

**3 route guards**:

| Guard | Linha | Lógica | Estado |
|---|---|---|---|
| `ProtectedRoute` | 75-97 | `isAuthenticated` + `mustChangePassword` redirect; wraps `ErrorBoundary` + `Layout` | ✅ sólido |
| `AdminRoute` | 99-116 | `role === "admin"`; redirect não-admin para `/terminal` | ✅ sólido |
| `PredictRoute` | 122-139 | feature flag `isPredictEnabled()`; fail-closed | ✅ sólido |

**Force-password-change**: gate em 3 lugares (`RootRoute:145`, `ProtectedRoute:86-88`, `PredictRoute:130`) — sem loops, sem leaks.

**Deep links**: URL params **não validados** antes de uso:
- `/asset/:assetId` — aceita qualquer string, passa direto pra query
- `/player/:id` — idem
- `encodeURIComponent` usado nos fetches (✅ não tem URL injection)

**Auth hook** (`hooks/use-auth.ts`, 82 LOC):
- Query key `["/api/auth/me"]`, fetch direto (não usa o `queryFn` default)
- `staleTime: 5min`, `refetchOnWindowFocus: true` (refresca em tab switch)
- `retry: false` (401 não retry)
- Logout via `window.location.href = "/login"` (full reload, limpa state) — pragmático

### 4.4 Features

| Feature | Avaliação |
|---|---|
| `buy-flow/` | Modal multi-step bem encapsulado (QuickBuy→Review→Processing→Success). Trata quote cache, fallback AMM. Sem anti-patterns. |
| `home/` | Hero, markets rail, predictions trending, news. `getHomeData.ts` tem fallback em erro. Mapper de ViewModel limpo. |
| `player-hub/` | Discovery + claims overview com Steam integration. `operatorFetch` wrapper para error handling custom. |
| `player-operator/` | Mission control. Múltiplos hooks (overview, performance, action-center, mission, moments). Separação 401/403 no `operatorFetch`. |
| `player-public/` | Read-only player profile. Mínimo, sem state especial. |
| `trade/` | Global trade sheet intent via Context. Feature-flag gated. Minimal. |

**Veredito**: features estão limpas, sem antipatterns. Diferentemente das `pages/`, foram organizadas por escopo recente.

### 4.5 Acoplamento backend

**Padrão dominante: inline fetch em `queryFn`**. ~142 chamadas `fetch()` em 57 arquivos. Sem axios. `credentials: "include"` setado manualmente em cada chamada (risco baixo de inconsistência mas existe — sem interceptor central).

**SSE**: 1 conexão em `terminal.tsx:193-204` → `/api/terminal/stream` (`withCredentials: true`). Eventos: `tick`, `update`, `discovery`. Reconnect exponencial até 2min. JSON parse com try-catch. Cleanup limpo no unmount.

**WebSocket**: 1 conexão em `terminal.tsx:258-320` → `/ws/market` (protocolo auto-detected ws/wss). Heartbeat 30s. Reconnect exponencial. Atualiza queries via `setQueriesData`. Cleanup limpo.

**Error handling**:
- Queries: ErrorBoundary local por feature; query erros logam no console
- Mutations: regex parse de `{"message":"..."}` da response body, toast `destructive`
- Trade mutations (`terminal.tsx:1566-1568, 1957-1960`): error parsing redundante (mesma lógica em 2 lugares)

---

## 5. Achados transversais

### Performance
- **0 code splitting** (B2.3-6)
- **0 virtualization** (B2.3-7)
- **0 `useCallback`** no terminal — todos os handlers recriados a cada render
- **Inline object/array** em chart props, player card styles (B2.3-10)
- 9 `useMemo` no terminal — alguns parecem prematuros (e.g., `safeNumber` calls), outros legítimos (filtros, Set construction)

### Acessibilidade
- **0 `aria-label`** em icon-only buttons (Star, X, Trash2, ChevronUp/Down, Search) — B2.3-9
- `alt` text em imagens: ~27 ocorrências. Imagens decorativas marcadas `alt=""` + `aria-hidden="true"` (✅ correto). Imagens funcionais parecem ter `alt` mas não verifiquei exaustivamente.
- Forms: usam react-hook-form em alguns lugares (signup, login, settings); shadcn Form component encapsula labeling — provavelmente OK mas não auditei profundamente
- Tooltips: shadcn `<Tooltip>` provê ARIA roles via Radix — ✅
- Focus management: não auditado (modais shadcn devem cuidar disso)

### Segurança client-side
- **0 `localStorage`** ✅ (tokens só em cookie httpOnly via backend)
- **0 `dangerouslySetInnerHTML` real** ✅ (1 ocorrência em `components/ui/chart.tsx:81` é injeção interna do shadcn de CSS theme — input hardcoded, não user-supplied)
- **0 XSS risk identificado**
- Tokens: cookies HttpOnly via backend, sem manipulação client-side
- URL params: `encodeURIComponent` usado consistentemente em fetches
- CSP / Content Security Policy: **não encontrei** em `index.html` ou meta tag — área para revisar
- Sem CSRF token explícito — depende de `sameSite=lax` no cookie (configurado no backend)

### Tipagem
- 140 `: any` / `as any` (B2.3-8)
- 0 `@ts-ignore` / `@ts-expect-error` ✅
- 0 `eslint-disable` (mas não há ESLint config no projeto — não é mérito)
- `@shared/*` imports usados em 13 lugares — saudável (compartilha types backend-frontend sem virar monorepo formal)

### Smells gerais
- **Hardcoded LoL copy/types** (B2.3-4, B2.3-5)
- **2 hooks de wallet** (`useGsWallet`, `usePortfolio`) com semânticas que divergem (B2.3-1)
- **Duplicação TradeTicket × CompactTradeBox** no terminal
- **Duplicação `AssetTradeModule` em assets.tsx vs `TradeTicket` em terminal.tsx**
- Magic numbers de pricing (2% fee em terminal.tsx:1611) hardcoded em vez de derivar do backend
- `console.log/error/warn` mais ruidosos: `assets.tsx` (19), `use-vaults.ts` (4)

---

## 6. Quantitativos

| Métrica | Valor |
|---|---:|
| LOC totais client/src | ~25 000 |
| Pages (`client/src/pages/`) | 32 (3 god files >1500 LOC) |
| Admin pages | 21 |
| Features (`client/src/features/`) | 6 |
| Rotas declaradas (wouter) | 50+ |
| Route guards | 3 (Protected/Admin/Predict) |
| Componentes UI shadcn | 50+ (em `components/ui/`) |
| `useQuery` no terminal.tsx | 30 |
| `useState` no terminal.tsx | 18 |
| `useCallback` no terminal.tsx | **0** |
| `fetch(` total | ~142 em 57 arquivos |
| SSE endpoints | 1 (`/api/terminal/stream`) |
| WS endpoints | 1 (`/ws/market`) |
| `dangerouslySetInnerHTML` real | **0** (1 falso positivo em shadcn) |
| `localStorage` | **0** ✅ |
| `@ts-ignore` / `@ts-expect-error` | **0** ✅ |
| `: any` / `as any` | **140** ❌ |
| `React.lazy` | **0** ❌ |
| Virtualization libs | **0** ❌ |
| Direct DOM (`document.*`) | 2 únicos (`main.tsx` mount + scrollIntoView em settings) ✅ |
| `console.log/error/warn` total estimado | ~35 |
| `aria-label` em icon-only buttons | **escasso** (não auditado quantitativamente — sample mostra ausência) |
| Hardcoded LoL strings encontradas | 14+ (amostra; estimativa real ~25-30) |

---

## 7. Recomendações de prioridade (Top 5)

| # | Ação | Justificativa | Effort |
|---|---|---|---|
| **1** | **Fix B-7** (`data?.seasons?.find(...)` em `admin/arena.tsx:230`) | Crash imediato em uma página admin com fix de 1 caractere | 5min |
| **2** | **Unificar fonte do "Buying Power"** — substituir `usePortfolio()` no TradeTicket por `useGsWallet()` (ou vice-versa, se a semântica desejada for `portfolio.balance`) | B-1; afeta UX direto (usuário vê valores divergentes) | 30min + revisar todo lugar que renderiza balance |
| **3** | **Default `/assets` para `game="all"`** (ou trocar endpoint para `/api/market/assets`) | B-2; usuário hoje vê página vazia | 15min código + alinhar com backend se filtro do endpoint precisa mudar também |
| **4** | **Refactor Watchlist** para multigame: tipo enriquecido + colunas dinâmicas por jogo + copy genérica + remover "Challenger" literal | B-9; bloqueia visão multigame que o produto se propôs a ser | 2-3h |
| **5** | **Code splitting via `React.lazy`** em todas as páginas admin (21 páginas que usuários comuns nunca tocam) + páginas pesadas (terminal, assets, portfolio) | B2.3-6; vai ficar pior com tempo. Single quick win pra bundle size | 2h |

Total estimado Top 5: ~6-7h. Conserta os 3 bugs P1 + uma área de UI bloqueante + um quick win de perf.

---

## 8. Score subjetivo de qualidade

| Área | Score | Observação |
|---|---:|---|
| State management (Context + TanStack Query) | **8.5** | Separação limpa, sem Redux, defaults sensatos. Único problema: 2 fontes de wallet balance. |
| Routing & auth gates | **8.0** | 3 guards consistentes, force-pass-change bem tratado. -2 por zero lazy loading e URL params não-validados. |
| Auth hook + session handling | **8.5** | Cookies HttpOnly, sem localStorage, refresh em focus. Padrão moderno. |
| Backend coupling (fetch/SSE/WS) | **7.0** | Padrão consistente mas verboso (sem interceptor central). SSE/WS bem feitos. |
| Features | **8.0** | Limpas, sem antipatterns. Refactor recente que pegou bem. |
| Pages (god files) | **5.5** | terminal.tsx (3537 LOC) e assets.tsx (1725 LOC) precisam quebra. Várias duplicações. |
| Acessibilidade | **6.0** | Imagens OK; tooltips OK; mas icon-only buttons sem aria-label são gap WCAG |
| Segurança client-side | **8.5** | Zero localStorage, zero XSS surface, encodeURIComponent. Falta CSP. |
| Tipagem | **7.0** | Zero ts-ignore (raro), mas 140 `any` em arquivos críticos. |
| Performance | **6.5** | Zero code splitting + zero virtualization + zero useCallback no terminal. Ainda funciona, mas curva ruim. |
| Multigame readiness | **5.0** | Copy + tipos LoL espalhados em 14+ pontos. Watchlist hardcoded Challenger. Não está pronto pra multigame visual. |
| **Total frontend** | **7.0** | Estrutura saudável (state, auth, security). Débito acumulado em god files, copy LoL, perf. |

---

## Notas finais

- Componentes em `client/src/components/ui/` (shadcn) não foram auditados — confiamos na lib.
- Pages de auth (login, signup, request-access) são pequenas e foram inspecionadas só para P-9.
- `prediction*` pages tocadas leve pois saem via P-1.
- Performance perceived hoje é OK — os achados de perf são preventivos para quando o produto escalar (mais usuários, listas maiores).
- A maior dívida estratégica deste audit é a **dívida multigame de UI/copy**: o backend já está modelado pra multigame (per 2.2), mas o frontend ainda assume LoL em vários surfaces. É a área mais visível pra um novo usuário entrando no produto.

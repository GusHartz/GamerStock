# GamerStock — Module Inventory

> **Status:** Auditoria — sem modificações nos arquivos.  
> Categorias: **KEEP** · **REFACTOR** · **DEPRECATE** · **REBUILD LATER**

---

## server/

| Path | Domínio Atual | Categoria | Motivo | Ação Recomendada | Prioridade |
|---|---|---|---|---|---|
| `server/index.ts` | Boot | REFACTOR | Inicializa schedulers inline, mistura responsabilidades de startup | Extrair `startSchedulers()` para `server/scheduler/index.ts` | Média |
| `server/routes.ts` | ALL (monólito) | REFACTOR | 5.873 linhas com todas as rotas da aplicação misturadas | Dividir em routers por domínio: `identity`, `market`, `arena`, `admin`, etc. | Alta |
| `server/storage.ts` | Portfolio / Market (legado) | DEPRECATE | Serve apenas o modelo legado de vaults — será absorvido por repos de domínio | Substituir por repositories em `server/domains/portfolio/` e `server/domains/market/` | Alta |
| `server/db.ts` | Infra | KEEP | Conexão Drizzle simples e correta | Nenhuma | — |
| `server/app-config.ts` | Infra / Config | KEEP | Key-value de configuração de runtime. Pequeno e funcional | Nenhuma | — |
| `server/arena.ts` | Arena | REFACTOR | Lógica correta mas chamada diretamente do tradeExecutor — acoplamento de domínios | Expor via evento/hook; mover para `server/domains/arena/arena-core.ts` | Alta |
| `server/market-maker.ts` | Market / Simulation | REFACTOR | PAE, momentum decay, AMM sync, SSE broadcast — 4 responsabilidades num módulo | Separar PAE Service, extrair tick scheduler, isolar broadcast | Alta |
| `server/market-quotes.ts` | Market | KEEP | Utilitário de quotes. Pequeno e isolado | Mover para `server/domains/market/` | Baixa |
| `server/name-generator.ts` | Simulation | DEPRECATE | Gera nomes sintéticos para players fictícios — não pertence ao core | Mover para `server/simulation/` | Média |
| `server/riot-sync.ts` | Integrations / Player | REFACTOR | Lógica válida mas acoplada diretamente — sem interface | Encapsular atrás de `PerformanceProvider` em `server/integrations/riot/` | Alta |
| `server/riot-perf.ts` | Integrations / Performance | REFACTOR | Idem — processamento de match deve usar interface, não importação direta | Mover para `server/integrations/riot/perf.ts` | Alta |
| `server/static.ts` | Infra | KEEP | Serve estáticos em produção | Nenhuma | — |
| `server/vite.ts` | Infra | KEEP | Setup Vite middleware em dev | Nenhuma | — |

### server/market-core/

| Path | Domínio Atual | Categoria | Motivo | Ação Recomendada | Prioridade |
|---|---|---|---|---|---|
| `server/market-core/asset-registry.ts` | Market / Player | KEEP | Registro canônico multi-provider correto | Manter; expandir para suportar novos providers | Baixa |
| `server/market-core/sync.ts` | Market | KEEP | Sync canônico bem estruturado | Nenhuma | — |
| `server/market-core/startup-seed.ts` | Market / Simulation | REFACTOR | Mistura seed de produção com seed de sandbox | Separar: seed canônico real ≠ seed sandbox de dev | Média |
| `server/market-core/backfill-trading-assets.ts` | Market (migração) | DEPRECATE | Script de migração única, não deve rodar no boot | Mover para `server/scripts/` como script avulso | Alta |

### server/providers/

| Path | Domínio Atual | Categoria | Motivo | Ação Recomendada | Prioridade |
|---|---|---|---|---|---|
| `server/providers/types.ts` | Integrations | KEEP | Interface ProviderAdapter bem definida | Expandir para incluir PerformanceProvider | Média |
| `server/providers/riot.ts` | Integrations | KEEP | Provider adapter correto; serve de template | Mover para `server/integrations/riot/provider.ts` | Baixa |

### server/services/

| Path | Domínio Atual | Categoria | Motivo | Ação Recomendada | Prioridade |
|---|---|---|---|---|---|
| `server/services/ammPricing.ts` | Market | KEEP | AMM matemático puro, bem isolado | Mover para `server/domains/market/amm-pricing.ts` | Baixa |
| `server/services/performanceEngine.ts` | Performance | KEEP | Core da engine de performance — código limpo, bem documentado | Mover para `server/domains/performance/engine.ts` | Baixa |
| `server/services/pviEngine.ts` | Valuation / Performance | KEEP | PVI + Fair Value com config centralizada | Mover para `server/domains/performance/pvi.ts` | Baixa |
| `server/services/valuationJob.ts` | Valuation | KEEP | Job de valuation bem estruturado | Mover para `server/domains/performance/valuation.ts` | Baixa |
| `server/services/tradeExecutor.ts` | Market | REFACTOR | Correto, mas chama arena e broadcast diretamente — acoplamento indevido | Desacoplar arena via evento; mover para `server/domains/market/trade-executor.ts` | Alta |
| `server/services/marketSignals.ts` | Market / Discovery | KEEP | Signals de mercado para terminal. Modular | Mover para `server/domains/market/signals.ts` | Baixa |
| `server/services/newsService.ts` | News | KEEP | RSS + sentiment independente | Mover para `server/domains/news/` | Baixa |
| `server/services/botTrader.ts` | Simulation | REFACTOR | Lógica de simulação válida, mas bots vivem em `users` — mistura com prod | Mover para `server/simulation/bot-trader.ts`; isolar usuários bot | Alta |
| `server/services/arenaBootstrap.ts` | Arena / Admin | REFACTOR | Bootstrap + diagnóstico em um arquivo; admin específico | Separar em `server/domains/arena/bootstrap.ts` e `server/domains/admin/diagnostics.ts` | Média |
| `server/services/achievementsService.ts` | Arena | KEEP | Achievements coeso e isolado | Mover para `server/domains/arena/achievements.ts` | Baixa |
| `server/services/seasonsService.ts` | Arena | KEEP | Seasons + challenges + rewards bem estruturado | Mover para `server/domains/arena/seasons.ts` | Baixa |
| `server/services/duelService.ts` | Arena / Social | KEEP | Duels independente | Mover para `server/domains/arena/duels.ts` | Baixa |
| `server/services/followService.ts` | Arena / Social | KEEP | Follows independente | Mover para `server/domains/arena/follows.ts` | Baixa |
| `server/services/triggerEngine.ts` | Market | REFACTOR | Funcional, mas `assetId` é `text` — inconsistência com FK integer do schema | Corrigir tipo; mover para `server/domains/market/trigger-engine.ts` | Média |
| `server/services/baselineUpdateJob.ts` | Performance | KEEP | Job de baselines isolado | Mover para `server/domains/performance/baseline-job.ts` | Baixa |

### server/scheduler/

| Path | Domínio Atual | Categoria | Motivo | Ação Recomendada | Prioridade |
|---|---|---|---|---|---|
| `server/scheduler/market-sync-scheduler.ts` | Market | REFACTOR | Boa estrutura, mas schedulers estão espalhados por `index.ts`, `market-maker.ts`, etc. | Centralizar todos schedulers aqui: `server/scheduler/index.ts` orquestra tudo | Média |

### server/sse/ e server/ws/

| Path | Domínio Atual | Categoria | Motivo | Ação Recomendada | Prioridade |
|---|---|---|---|---|---|
| `server/sse/terminalBroadcaster.ts` | Realtime | KEEP | SSE bem encapsulado | Mover para `server/realtime/sse/` | Baixa |
| `server/ws/market-hub.ts` | Realtime | KEEP | Hub WebSocket com pub/sub correto | Mover para `server/realtime/ws/` | Baixa |
| `server/ws/market-ws.ts` | Realtime | KEEP | Attachment WS → HTTP server | Mover para `server/realtime/ws/` | Baixa |

### server/modules/

| Path | Domínio Atual | Categoria | Motivo | Ação Recomendada | Prioridade |
|---|---|---|---|---|---|
| `server/modules/draft/` | Arena | KEEP | Módulo mais bem estruturado — controller/routes/service/schema/types separados | Mover para `server/domains/arena/draft/`; servir de template | Baixa |

### server/replit_integrations/

| Path | Domínio Atual | Categoria | Motivo | Ação Recomendada | Prioridade |
|---|---|---|---|---|---|
| `server/replit_integrations/auth/` | Identity | KEEP | Auth OIDC + local. Funciona | Renomear pasta para `server/domains/identity/`; manter lógica | Baixa |

### server/scripts/

| Path | Domínio Atual | Categoria | Motivo | Ação Recomendada | Prioridade |
|---|---|---|---|---|---|
| `server/scripts/resetUserPassword.ts` | Identity / Ops | KEEP | Script operacional legítimo | Manter em `server/scripts/` | — |

---

## shared/

| Path | Domínio Atual | Categoria | Motivo | Ação Recomendada | Prioridade |
|---|---|---|---|---|---|
| `shared/schema.ts` | ALL (monólito) | REFACTOR | 973 linhas — todos os domínios num único arquivo | Dividir em `shared/schema/*.ts` por domínio; `shared/schema/index.ts` re-exporta tudo | Alta |
| `shared/models/auth.ts` | Identity | KEEP | Já separado corretamente — template para os outros | Nenhuma | — |
| `shared/routes.ts` | Market (legado) | REFACTOR | Cobre apenas vaults/portfolio/trade legados; divergiu da API real | Expandir com rotas de assets, arena, draft; ou migrar para tRPC/OpenAPI no futuro | Alta |
| `shared/arena-config.ts` | Arena | KEEP | Configuração compartilhada. Pequena e focada | Nenhuma | — |
| `shared/market-quotes.ts` | Market | KEEP | Cálculo de quotes compartilhado corretamente | Nenhuma | — |

---

## client/

| Path | Domínio Atual | Categoria | Motivo | Ação Recomendada | Prioridade |
|---|---|---|---|---|---|
| `client/src/App.tsx` | Routing | REFACTOR | Rotas organizadas, mas condições de auth inline | Extrair AuthGuard component | Baixa |
| `client/src/pages/terminal.tsx` | Market | KEEP | Core do produto — terminal de trading | Nenhuma | — |
| `client/src/pages/assets.tsx` | Discovery | KEEP | Explorador de ativos real | Nenhuma | — |
| `client/src/pages/asset-detail.tsx` | Discovery / Market | KEEP | Detail de ativo real | Nenhuma | — |
| `client/src/pages/vault-detail.tsx` | Market (legado) | DEPRECATE | Vault = modelo sintético legado; duplica asset-detail para sandbox | Avaliar remoção quando sandbox for isolado | Alta |
| `client/src/pages/player.tsx` | Player | REFACTOR | Ambiguidade entre player real vs sintético | Clarificar — deve apontar para player real | Média |
| `client/src/pages/portfolio.tsx` | Portfolio | KEEP | Portfolio do usuário | Nenhuma | — |
| `client/src/pages/watchlist.tsx` | Discovery | REFACTOR | Ambiguidade — existe `watchlist` (vault) e `assetWatchlist` (asset real) | Unificar em watchlist de assets reais | Média |
| `client/src/pages/leaderboard.tsx` | Arena | REFACTOR | Duplicação possível com `arena-leaderboards.tsx` — verificar | Consolidar ou diferenciar claramente | Média |
| `client/src/pages/arena.tsx` | Arena | KEEP | Página principal de arena | Nenhuma | — |
| `client/src/pages/arena-achievements.tsx` | Arena | KEEP | Achievements funcionais | Nenhuma | — |
| `client/src/pages/arena-leaderboards.tsx` | Arena | KEEP | Leaderboard de arena | Nenhuma | — |
| `client/src/pages/arena-seasons.tsx` | Arena | KEEP | Seasons | Nenhuma | — |
| `client/src/pages/arena-draft.tsx` | Arena | KEEP | Draft semanal | Nenhuma | — |
| `client/src/pages/arena-trader-profile.tsx` | Arena | KEEP | Perfil de trader | Nenhuma | — |
| `client/src/pages/admin/market-lab.tsx` | Admin / Simulation | KEEP | Ferramenta de simulação admin com grande valor | Nenhuma | — |
| `client/src/pages/admin/market.tsx` | Admin | KEEP | Controle de mercado | Nenhuma | — |
| `client/src/pages/admin/amm.tsx` | Admin | KEEP | Configuração AMM | Nenhuma | — |
| `client/src/pages/admin/arena.tsx` | Admin / Arena | KEEP | Gestão de arena admin | Nenhuma | — |
| `client/src/pages/admin/draft.tsx` | Admin / Arena | KEEP | Gestão de draft | Nenhuma | — |
| `client/src/pages/admin/users.tsx` | Admin / Identity | KEEP | Gerenciamento de usuários | Nenhuma | — |
| `client/src/pages/admin/user-detail.tsx` | Admin / Identity | KEEP | Detalhe de usuário | Nenhuma | — |
| `client/src/pages/admin/access-requests.tsx` | Admin / Identity | KEEP | Solicitações de acesso | Nenhuma | — |
| `client/src/pages/admin/metrics.tsx` | Admin | KEEP | Métricas gerais | Nenhuma | — |
| `client/src/pages/login.tsx` | Identity | KEEP | Login funcional | Nenhuma | — |
| `client/src/pages/signup.tsx` | Identity | KEEP | Signup | Nenhuma | — |
| `client/src/pages/landing.tsx` | Identity | KEEP | Landing pública | Nenhuma | — |
| `client/src/pages/forgot-password.tsx` | Identity | KEEP | Reset de senha | Nenhuma | — |
| `client/src/pages/reset-password.tsx` | Identity | KEEP | Reset de senha | Nenhuma | — |
| `client/src/pages/force-password-change.tsx` | Identity | KEEP | Obriga troca de senha | Nenhuma | — |
| `client/src/pages/request-access.tsx` | Identity | KEEP | Formulário de acesso | Nenhuma | — |
| `client/src/pages/settings/security.tsx` | Identity | KEEP | Configurações de segurança | Nenhuma | — |
| `client/src/hooks/use-auth.ts` | Identity | KEEP | Hook de auth limpo | Nenhuma | — |
| `client/src/hooks/use-portfolio.ts` | Portfolio | KEEP | Hook de portfolio | Nenhuma | — |
| `client/src/hooks/use-trade.ts` | Market | KEEP | Hook de trade | Nenhuma | — |
| `client/src/hooks/use-vaults.ts` | Market (legado) | DEPRECATE | Hook de vaults sintéticos | Deprecar quando vault-detail sair | Alta |
| `client/src/lib/queryClient.ts` | Infra | KEEP | TanStack Query config | Nenhuma | — |
| `client/src/lib/format.ts` | Infra | KEEP | Formatadores | Nenhuma | — |
| `client/src/lib/auth-utils.ts` | Identity | KEEP | Utilitários de auth | Nenhuma | — |
| `client/src/state/terminalStore.ts` | Market | KEEP | Estado do terminal | Nenhuma | — |
| `client/src/components/ui/` | UI | KEEP | shadcn/ui — não modificar | Nenhuma | — |
| `client/src/components/layout.tsx` | Infra | KEEP | Layout principal | Nenhuma | — |
| `client/src/components/news-ticker.tsx` | News | KEEP | News ticker | Nenhuma | — |
| `client/src/components/riot-leaderboard.tsx` | Discovery | KEEP | Leaderboard Riot | Nenhuma | — |
| `client/src/components/error-boundary.tsx` | Infra | KEEP | Error boundary | Nenhuma | — |

---

## Raiz do projeto

| Path | Domínio Atual | Categoria | Motivo | Ação Recomendada | Prioridade |
|---|---|---|---|---|---|
| `seed.ts` | Simulation | DEPRECATE | Seed de players sintéticos na raiz; mistura com dados de prod | Mover para `server/simulation/sandbox-seed.ts`; remover da raiz | Alta |
| `drizzle.config.ts` | Infra | KEEP | Config ORM | Nenhuma | — |
| `vite.config.ts` | Infra | KEEP | Bundler config | Nenhuma | — |
| `script/build.ts` | Infra | KEEP | Build script | Nenhuma | — |
| `tailwind.config.ts` | UI | KEEP | Tailwind config | Nenhuma | — |
| `postcss.config.js` | UI | KEEP | PostCSS config | Nenhuma | — |
| `tsconfig.json` | Infra | KEEP | TypeScript config | Nenhuma | — |
| `package.json` | Infra | KEEP | Dependências | Nenhuma | — |

---

## Resumo de Contagem por Categoria

| Categoria | Qtd arquivos / módulos |
|---|---|
| KEEP | ~75 |
| REFACTOR | ~18 |
| DEPRECATE | ~8 |
| REBUILD LATER | 0 (nenhum descarte total — web3 entra por camada nova) |

> **REBUILD LATER** não se aplica a arquivos existentes — todos têm aproveitamento.  
> O conceito se aplica a domínios novos a criar: `treasury`, `web3-adapters`, `player-economy`.

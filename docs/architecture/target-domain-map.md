# GamerStock — Target Domain Map

> **Status:** Proposta arquitetural — sem modificações nos arquivos.  
> Este documento define os domínios lógicos da GamerStock v2 e o que pertence a cada um.

---

## Mapa de Domínios

```
┌─────────────────────────────────────────────────────────────────────┐
│                        GamerStock Platform                          │
├──────────────┬──────────────┬──────────────┬───────────────────────┤
│  Identity    │   Player     │ Performance  │     Valuation         │
│  & Access    │  Registry    │   Engine     │     Engine            │
├──────────────┼──────────────┼──────────────┼───────────────────────┤
│    Market    │  Portfolio   │  Discovery   │       Arena           │
│    Engine    │  / Ledger    │   Engine     │   / Gamification      │
├──────────────┼──────────────┼──────────────┼───────────────────────┤
│   Treasury   │ Integrations │   Realtime   │      Admin            │
│  (futuro)    │   (Riot)     │  (SSE / WS)  │      Panel            │
├──────────────┴──────────────┴──────────────┴───────────────────────┤
│               Simulation Layer  (isolada do core)                  │
├────────────────────────────────────────────────────────────────────┤
│          Web3 Adapter Layer  (futuro — não entra agora)            │
└────────────────────────────────────────────────────────────────────┘
```

---

## 1. Identity & Access

**Responsabilidade:** Gerenciar quem pode entrar na plataforma e com que identidade.

**O que entra:**
- Registro e login de usuários (email/senha + Replit OIDC)
- Sessões autenticadas
- Solicitações de acesso (`accessRequests`)
- Reset de senha e tokens (`passwordResetTokens`)
- Bloqueio, deleção e papéis de usuário (admin/user)
- Campos de perfil básico (`users` table)
- Configuração de segurança do usuário

**O que NÃO entra:**
- Perfil de trader gamificado (→ Arena)
- Portfolio e saldo financeiro (→ Portfolio/Ledger)
- Bots e usuários sintéticos (→ Simulation)

**Módulos atuais que pertencem aqui:**
- `server/replit_integrations/auth/` (index, replitAuth, routes, storage)
- `shared/models/auth.ts` (users, sessions, accessRequests, passwordResetTokens)
- `client/src/pages/login.tsx`, `signup.tsx`, `landing.tsx`
- `client/src/pages/forgot-password.tsx`, `reset-password.tsx`, `force-password-change.tsx`
- `client/src/pages/request-access.tsx`, `settings/security.tsx`
- `client/src/hooks/use-auth.ts`, `client/src/lib/auth-utils.ts`

---

## 2. Player Registry

**Responsabilidade:** Manter o registro canônico de players que existem na plataforma — tanto reais (Riot) quanto sintéticos (Sandbox).

**O que entra:**
- Players reais: `riotPlayers`, `riotAssets` como registros de identidade
- Assets canônicos: `markets`, `assets` (modelo unificado multi-provider)
- Sincronização de dados externos de players (summonerName, LP, winrate)
- Asset Registry (`market-core/asset-registry.ts`, `market-core/sync.ts`)
- Provider Adapter interface

**O que NÃO entra:**
- Preços de mercado e trades (→ Market Engine)
- Scores de performance de match (→ Performance Engine)
- Players sintéticos de bot (→ Simulation)
- Cálculo de fair value (→ Valuation Engine)

**Módulos atuais que pertencem aqui:**
- `server/riot-sync.ts` (sincronização de dados de player)
- `server/market-core/asset-registry.ts`, `market-core/sync.ts`
- `server/providers/riot.ts`, `server/providers/types.ts`
- Tabelas: `riotPlayers`, `riotAssets`, `markets`, `assets`

---

## 3. Performance Engine

**Responsabilidade:** Calcular e armazenar o desempenho de jogadores em partidas — o coração do "Performance Market".

**O que entra:**
- Processamento de match data da Riot API
- Role-Based Performance Engine (MatchScore composto)
- Baselines de role por tier (Challenger)
- Métricas por partida (`playerMatchMetrics`, `performanceScores`)
- EMA de performance, trend score, context score
- `riotMatchCache` — cache de partidas processadas
- `riotPlayerState` — estado EMA por player
- Job de atualização de baselines (`baselineUpdateJob`)
- Role Metric Weights

**O que NÃO entra:**
- Fair Value e preço fundamental (→ Valuation Engine)
- Sincronização de dados de player (→ Player Registry / Integrations)
- Impacto no preço de mercado (→ Market Engine)

**Módulos atuais que pertencem aqui:**
- `server/services/performanceEngine.ts`
- `server/services/baselineUpdateJob.ts`
- `server/riot-perf.ts` (processamento de matches)
- Tabelas: `roleBaselines`, `roleMetricWeights`, `playerMatchMetrics`, `performanceScores`, `riotMatchCache`, `riotPlayerState`

---

## 4. Valuation Engine

**Responsabilidade:** Calcular o valor justo (Fair Value) de cada asset com base nos dados de performance — a "âncora fundamental" do mercado.

**O que entra:**
- PVI (Player Value Index) — fórmula multi-componente (0-100)
- Componentes do PVI: recentPerformance, consistencyScore, historicalSkill, activityScore
- Fair Value em GS$ derivado do PVI
- Divergência entre preço de mercado e fair value
- Confidence score
- `assetValuationState` — estado de valuation por asset
- Valuation job e seed de valuations iniciais
- Inactivity decay

**O que NÃO entra:**
- Aplicação da âncora ao preço (→ Market Engine — PAE)
- Dados brutos de match (→ Performance Engine)
- Preços de mercado (→ Market Engine)

**Módulos atuais que pertencem aqui:**
- `server/services/pviEngine.ts`
- `server/services/valuationJob.ts`
- Tabelas: `assetValuationState`

---

## 5. Market Engine

**Responsabilidade:** Executar trades, manter estado de mercado, aplicar dinâmicas de preço (AMM, PAE, momentum), processar ordens trigger.

**O que entra:**
- Execução de trades: `tradeExecutor.ts`
- AMM (Automated Market Maker) bonding curve: `ammPricing.ts`
- Market state por asset: `assetMarkets`, `assetMarketState`
- Performance Anchor Engine (PAE) — aplica pressão do fair value ao preço
- Momentum decay
- Market ticker / scheduler de tick
- Trigger Orders (limit/stop-loss/take-profit): `triggerEngine.ts`, `triggerOrders`, `triggerOrderEvents`
- Market Signals para o terminal: `marketSignals.ts`
- Idempotency keys de trades
- Price snapshots: `assetPriceSnapshots`
- Fee capture: `feeLedger` (registro de taxas por trade)
- Market sync scheduler

**O que NÃO entra:**
- Fair value computation (→ Valuation Engine)
- Gamificação ao executar trade (→ Arena — deve ser desacoplada via evento)
- Dados de performance de match (→ Performance Engine)
- Bots sintéticos (→ Simulation)

**Módulos atuais que pertencem aqui:**
- `server/services/tradeExecutor.ts`
- `server/services/ammPricing.ts`
- `server/services/marketSignals.ts`
- `server/market-maker.ts` (scheduler + PAE + momentum decay)
- `server/services/triggerEngine.ts`
- `server/scheduler/market-sync-scheduler.ts`
- `shared/market-quotes.ts`
- Tabelas: `assetMarkets`, `assetMarketState`, `triggerOrders`, `triggerOrderEvents`, `assetPriceSnapshots`, `feeLedger`, `idempotencyKeys`

---

## 6. Portfolio / Ledger

**Responsabilidade:** Manter o estado financeiro do usuário — saldo, posições, histórico de trades, ledger imutável.

**O que entra:**
- Portfolios de usuários (`portfolios`)
- Posições abertas (`positions`, `riotPositions`)
- Histórico de trades (`trades`, `riotTrades`)
- Ledger imutável de entradas financeiras (`ledgerEntries`)
- Cálculo de P&L, unrealized/realized
- Saldo de play-USDC

**O que NÃO entra:**
- Execução de trades (→ Market Engine)
- Gamificação de performance de trading (→ Arena)
- Distribuição de fees para players (→ Treasury)

**Módulos atuais que pertencem aqui:**
- `server/storage.ts` (parcialmente — getPortfolio, getPositions, getTrades)
- Tabelas: `portfolios`, `positions`, `trades`, `riotPositions`, `riotTrades`, `ledgerEntries`
- `client/src/pages/portfolio.tsx`
- `client/src/hooks/use-portfolio.ts`

---

## 7. Discovery Engine

**Responsabilidade:** Ajudar o usuário a encontrar assets, explorar o mercado, gerenciar watchlist.

**O que entra:**
- Explorer de assets com filtros, busca e rankings
- Watchlist de assets (`assetWatchlist`)
- Leaderboard público de assets por preço/volume/performance
- Quotes e visualizações de market overview
- Page de asset-detail: dados consolidados de market + performance + valuation

**O que NÃO entra:**
- Execução de trade (→ Market Engine)
- Dados brutos de performance (→ Performance Engine)
- Leaderboard de traders (→ Arena)

**Módulos atuais que pertencem aqui:**
- `client/src/pages/assets.tsx`
- `client/src/pages/asset-detail.tsx`
- `client/src/pages/watchlist.tsx`
- `client/src/components/riot-leaderboard.tsx`
- Tabelas: `assetWatchlist`

---

## 8. Arena / Gamification

**Responsabilidade:** Engajar o usuário como trader através de progressão, conquistas, competição social e desafios sazonais.

**O que entra:**
- Perfil de trader: avatar, bio, estilo (`arenaProfiles`)
- XP, rank tier, estatísticas de trading (`arenaUserStats`)
- Eventos de arena (log de XP) (`arenaEvents`)
- Achievements e catálogo (`achievementsCatalog`, `userAchievements`)
- Seasons, leaderboards de temporada (`arenaSeasons`, `arenaUserSeasonStats`, `arenaSeasonLeaderboardSnapshot`)
- Badges e distribuição de recompensas (`arenaBadges`, `userBadges`, `seasonRewards`, `seasonRewardDistributions`)
- Challenges semanais (`arenaChallenges`)
- Social: follows e duels (`arenaTraderFollows`, `arenaDuels`)
- Draft semanal de players (`modules/draft/`)
- Hooks de trade → XP (deve ser desacoplado via evento, não importação direta)

**O que NÃO entra:**
- Execução de trade (→ Market Engine)
- Dados de mercado e performance de player (→ Performance / Market)
- Autenticação (→ Identity)

**Módulos atuais que pertencem aqui:**
- `server/arena.ts`
- `server/services/achievementsService.ts`
- `server/services/seasonsService.ts`
- `server/services/duelService.ts`
- `server/services/followService.ts`
- `server/services/arenaBootstrap.ts`
- `server/modules/draft/`
- `client/src/pages/arena*.tsx`
- Tabelas: `arenaProfiles`, `arenaUserStats`, `arenaEvents`, `achievementsCatalog`, `userAchievements`, `arenaSeasons`, `arenaUserSeasonStats`, `arenaSeasonLeaderboardSnapshot`, `arenaBadges`, `userBadges`, `seasonRewards`, `seasonRewardDistributions`, `arenaChallenges`, `arenaTraderFollows`, `arenaDuels`

---

## 9. Treasury / Revenue Share *(futuro — REBUILD LATER)*

**Responsabilidade:** Capturar, contabilizar e distribuir receita de fees entre plataforma e players.

**O que entra:**
- Saldo de fees por player/asset (`playerFeeBalance`)
- Fee ledger (`feeLedger`)
- Regras de split plataforma/player
- Distribuição periódica de revenue share
- Futuramente: integração com treasury on-chain

**O que NÃO entra:**
- Execução do trade em si (→ Market Engine)
- Web3/wallet (→ Web3 Adapter Layer)

**Módulos atuais parcialmente aqui:**
- Tabelas: `feeLedger`, `playerFeeBalance`
- Lógica de fee split em `tradeExecutor.ts` (deve ser extraída)

> **Nota:** As estruturas de dados já existem. O domínio precisa de um serviço próprio de distribuição e uma interface para futura integração on-chain.

---

## 10. Integrations

**Responsabilidade:** Adaptar fontes externas de dados (APIs de jogos, provedores de dados) para o formato interno da plataforma — sem vazar detalhes externos para o core.

**O que entra:**
- Interface `PerformanceProvider` (abstrata)
- Implementação Riot LoL: sync de challengers, fetch de matches, processamento de perf
- Configuração de API keys e rate limiting
- Retry logic e circuit breaker para APIs externas
- Futuramente: Valorant, CSGO, outros jogos

**O que NÃO entra:**
- Lógica de negócio de mercado (→ Market Engine)
- Persistência de assets canônicos (→ Player Registry)
- Cálculo de performance (→ Performance Engine) — apenas coleta e entrega os dados brutos

**Módulos atuais que pertencem aqui:**
- `server/riot-sync.ts`
- `server/riot-perf.ts`
- `server/providers/riot.ts`
- `server/providers/types.ts`

---

## 11. Realtime

**Responsabilidade:** Entregar dados em tempo real para o frontend via SSE e WebSocket.

**O que entra:**
- Terminal broadcaster via SSE (`terminalBroadcaster.ts`)
- Market hub WebSocket com pub/sub por canal (`market-hub.ts`)
- Attachment do WS ao HTTP server (`market-ws.ts`)
- Protocolos de mensagem (subscribe/unsubscribe/publish)

**O que NÃO entra:**
- Lógica de negócio de mercado (apenas recebe eventos para broadcast)
- Persistência de dados

**Módulos atuais que pertencem aqui:**
- `server/sse/terminalBroadcaster.ts`
- `server/ws/market-hub.ts`
- `server/ws/market-ws.ts`

---

## 12. Admin Panel

**Responsabilidade:** Interface de controle operacional e diagnóstico da plataforma para administradores.

**O que entra:**
- Gestão de usuários (block, delete, reset senha, roles)
- Controle de mercado (pause/resume simulador, market mode)
- Market Lab (simulação e validação de algoritmos)
- Controle de AMM por asset
- Gestão de Arena (bootstrap, seasons, challenges)
- Gestão de Draft (semanas, métricas, scoring)
- Solicitações de acesso
- Métricas operacionais

**O que NÃO entra:**
- Lógica de negócio core (apenas chama os serviços dos outros domínios)

**Módulos atuais que pertencem aqui:**
- Rotas `/api/admin/*` (dispersas em `routes.ts`)
- `client/src/pages/admin/`

---

## 13. Simulation Layer *(isolada do core)*

**Responsabilidade:** Simular atividade de mercado com bots e dados sintéticos — NUNCA exposta como dados reais para usuários.

**O que entra:**
- Bot trader com estratégias diversas (`botTrader.ts`)
- Perfis de bot (`botProfiles`)
- Gerador de nomes sintéticos (`name-generator.ts`)
- Seed de players fictícios para ambiente Sandbox (`seed.ts`)
- Market Lab simulation backend (parte da simulação)

**O que NÃO entra:**
- Usuários reais (bots NÃO devem estar na tabela `users`)
- Players reais de Riot (Sandbox é isolado)

**Regra crítica:** Bots atualmente vivem na tabela `users` com `isBot=true` — isso precisa ser isolado. Queries de produto (leaderboard, explorador de assets) devem excluir bots sistematicamente.

**Módulos atuais que pertencem aqui:**
- `server/services/botTrader.ts`
- `server/name-generator.ts`
- `seed.ts` (raiz)
- `botProfiles` table

---

## 14. Web3 Adapter Layer *(futuro — não entra agora)*

**Responsabilidade:** Conectar o core operacional Web2 a infraestrutura on-chain sem poluir o core.

**O que entra (quando chegar a hora):**
- Wallet linking (conectar endereço blockchain ao userId)
- Mirror de trades no ledger on-chain
- Treasury on-chain (revenue share via smart contract)
- Token representation de assets (NFTs ou fungíveis)
- Event hooks: `TradeExecuted → on-chain event`

**O que NÃO entra agora:**
- Qualquer código de blockchain no core
- Dependências Web3 em `server/domains/*`

**Pontos de extensão já existentes no core (sem modificação necessária):**
- `ledgerEntries` — fonte de verdade imutável → pode ser espelhada on-chain
- `feeLedger` + `playerFeeBalance` → base do treasury on-chain
- `TradeExecuted` event → hook natural para broadcast on-chain
- `userId` como chave primária → pode receber `walletAddress` como campo adicional

---

## Regras Transversais dos Domínios

| Regra | Descrição |
|---|---|
| **Ledger é a verdade** | `ledgerEntries` e `feeLedger` são imutáveis e são a fonte de verdade do sistema financeiro |
| **Core não depende de Riot** | O Market Engine não pode importar `riot-sync` ou `riotAssets` diretamente — usa `PerformanceProvider` |
| **Simulação isolada** | Bots e players sintéticos nunca se misturam com dados de produto para usuários reais |
| **Arena é desacoplada** | Gamificação recebe eventos de trade — não é chamada diretamente do executor |
| **Web3 entra por adapters** | Nenhum código de blockchain entra nos domínios core |
| **Multi-provider by design** | Player Registry e Performance Engine suportam múltiplos jogos via interface |

---

*Este documento é de auditoria — nenhum arquivo foi modificado.*

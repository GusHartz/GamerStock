# GamerStock — Relatório Consolidado da Exploração

**Data:** 14 de maio de 2026
**Sessão:** Auditoria visual ponta-a-ponta pós-migração Replit → Windows
**Cobertura:** ~30 páginas exploradas com screenshots

---

## 1. Resumo Executivo

Após migração bem-sucedida do Replit, hardening de segurança (4 vulnerabilidades corrigidas) e nuke do histórico Git, a plataforma **sobe limpa no Windows** e está **100% funcional no modo de desenvolvimento**. O produto tem uma UI muito bem polida — em vários pontos surpreendentemente acima do que se esperaria de um projeto solo. Mas carrega **arqueologia significativa** de pivots anteriores: features sobrepostas, sistemas paralelos para o mesmo problema, e copy/schema legados de quando o escopo era só LoL Challenger.

A exploração revelou um produto com 4 eixos vivos (Trading via AMM, Revenue Intelligence, Multigame Claims, Performance Algorithm), 4 eixos em estado morto/legado (Predictions, Arena, Draft, Leaderboard standalone) e 9 bugs/inconsistências documentadas.

---

## 2. Estado Técnico

| Item | Status |
|------|--------|
| Boot Windows local | ✅ Funcional (porta 5000, Postgres Docker porta 5433) |
| Schema do banco | ✅ 111 tabelas via Drizzle |
| Seed Dota2 (OpenDota Bootstrap) | ✅ 800 assets, 187 listados, 800 AMM-ready |
| Login admin (`guhartz@gmail.com`) | ✅ Ativado via `/api/admin/auth/reset-password` |
| Vulnerabilidades de segurança críticas (D-9 a D-10) | ✅ Corrigidas |
| Git history limpo (1 commit, novo repo) | ✅ `github.com/GusHartz/GamerStock` |
| Schedulers (Performance, Predict, Markets, Trading) | ⚠️ Rodando, mas com erros não-fatais |
| Riot API Key | ❌ Não configurada (esperado em dev) |

### Pendências técnicas conhecidas

- 103 erros TypeScript pré-existentes em arquivos não tocados
- Schema drift em `bulkCs2PriceProjection.ts` (non-fatal, ad-hoc migration)
- Bot simulator FK constraint no boot (catch silencia)
- 13 vulnerabilidades npm (1 low, 5 moderate, 7 high) — `npm audit fix` não executado
- ADMIN_PASS `GamerStock-01` exposta em screenshots — rotacionar antes de prod

---

## 3. Mapa do Produto

### 3.1 Páginas User-Facing

| URL | Status | Descrição |
|-----|--------|-----------|
| `/` (logado) | ✅ | Auto-redirect para `/terminal` |
| `/` (anônimo) | ✅ | Auto-redirect para `/login` |
| `/login` | ✅ | UI bonita, mas copy ainda hardcoded "League of Legends" |
| `/signup` | ✅ | Cadastro público, copy já genérico "esports" |
| `/request-access` | ✅ | "Join Beta" — formulário público de solicitação |
| `/terminal` | ✅ | **Carro-chefe**. 800 players Dota2, AMM ativo, ticker, AI cards |
| `/portfolio` | ✅ | KPIs completos (Buying Power, GS Locked, PNL realizado/não-realizado), tabs Open/History/Settlements |
| `/players/:id` | ✅ | Detalhe completo: market chart, performance score, supporters, missions, moments |
| `/predictions` | ⚠️ | 1 mercado seed dev (`FURIA vs NAVI`). **Sai na P-1** |
| `/assets` | 🐛 | Vazio mesmo com 800 players carregados no `/terminal` (**B-2**) |
| `/watchlist` | ⚠️ | Empty, com schema LoL-only (Region, Rank Tier) — **B-9** |
| `/player-hub` (= "Creator" no menu) | ✅ | Connect Steam, Operator Mode, Pending Claims/Requests |
| `/leaderboard` | ⚠️ | NA1 Challenger Leaderboard (legacy LoL) — **P-8** |
| `/settings/security` | ✅ | Apenas Change Password (sem MFA, sem sessions) |

### 3.2 Páginas Admin

| URL | Status | Descrição |
|-----|--------|-----------|
| `/admin/users` | ✅ | Gestão completa (View/Block/Make Admin/Remove Admin/Reset Password/Delete soft) |
| `/admin/revenue` | ✅ | **Diamante do projeto**. Revenue Intelligence CFO-grade. Sub-tabs Overview/Market Health/Revenue Analytics/Valuation |
| `/admin/player-earnings` | ✅ | Pool de distribuição, payout threshold 10 GS |
| `/admin/market` | ⚠️ | Market Mode toggle (REAL_RIOT_NA1 vs SANDBOX), bot simulator, Riot API mgmt — **P-2** |
| `/admin/market-lab` | ✅ | Algorithm Validation Suite. Sliders, simulações, engine options |
| `/admin/predict` | ⚠️ | Pipeline de ingestion → events → display queue → media library — **P-3** |
| `/admin/history` | ⚠️ | Histórico de prediction events — **P-3** |
| `/admin/multigame-ops` | ✅ | Ops summary, pipeline Dota2 Bootstrap, 613 assets UNDER_REVIEW |
| `/admin/metrics` | 🐛 | KPIs platform-wide. **B-8: 24h activity rate = NaN%** |
| `/admin/access-requests` | ✅ | Aprovação/rejeição de Join Beta |
| `/admin/arena` | ❌ | **CRASHA** — `Cannot read properties of undefined (reading 'find')` — **B-7** |
| `/admin/draft` | ⚠️ | Weekly Performance Draft, vazio — **P-6** |
| `/admin/amm` | ⚠️ | AMM Engine standalone com bonding curve `F + A × ln(1 + s/B)`. **0 markets** (legacy) — **P-7** |

### 3.3 Features descobertas

- **AMM (Automated Market Maker)** — sistema de pricing por bonding curve logarítmica, fee 2% split 50/50 platform/player
- **Missions** — sistema de desafios/objetivos por player (não explorado em detalhe)
- **Moments** — possível sistema de highlights/colecionáveis estilo NBA Top Shot
- **Supporters** — feature social de "seguir" um player (separado de holding)
- **Operator Mode / Player Claims** — jogador real prova identidade via Steam OAuth e ganha earnings
- **Performance Algorithm** — EMA smoothing, role-weighted PP scores 0-100, circuit breaker ±20% diário
- **Bot Traders** — 100 synthetic traders (trend, value, profit, random, whale) — atualmente 0 ativos

---

## 4. Tracker de Decisões de Produto

| ID | Decisão | Status | Escopo estimado |
|----|---------|--------|-----------------|
| **P-1** | Remover Predictions inteiro | ✅ Confirmado | Grande: 11 tabelas DB, 12+ arquivos backend, ~6 telas frontend, 2 schedulers, schema 21KB, env vars |
| **P-2** | Revisar `/admin/market` | 🤔 A decidir | Médio: Riot API key mgmt, bot traders, market mode toggle, P1 dynamic pricing |
| **P-3** | Remover `/admin/predict`, `/admin/history` | ✅ Confirmado (com P-1) | Pequeno: subpages que saem junto com P-1 |
| **P-4** | **Multigame: MANTER mas auditar** | ✅ Manter | Pequeno-Médio: limpar "lixo" identificado (claims sem fluxo, assets em review sem critério, etc.) |
| **P-5** | Arena (admin bugada + user-side) | 🟡 Provável remover | Médio: `arena_*` tables (XP, leaderboards, follows, draft picks, achievements, seasons) |
| **P-6** | Draft (Weekly Performance) | 🤔 A decidir | Médio: feature isolada, vazia, atrelada a Arena |
| **P-7** | AMM standalone (legacy) | 🤔 A decidir | Pequeno: investigar relação com AMM multigame antes de mexer |
| **P-8** | Leaderboard standalone | 🟡 Provável remover | Pequeno: legacy LoL Challenger pré-pivot |
| **P-9** | Auditar copy/UI hardcoded LoL | 🤔 A decidir | Pequeno-Médio: `/login`, `/watchlist`, terminologia "rift", "Region", "Rank Tier" |

---

## 5. Tracker de Bugs e Inconsistências

| ID | Severidade | Descrição |
|----|-----------|-----------|
| **B-1** | Média | Buying Power diverge: header mostra `$1,000.00`, modal de trade mostra `$10,000.00` |
| **B-2** | Alta | `/assets` retorna "No players match" mesmo com filtro Dota 2 e 800 players carregados no `/terminal` |
| **B-3** | Baixa | `/admin/market` Bot Traders status "Running" mas Bot Count=0, Trades/hr=0 |
| **B-4** | Média | `/admin/multigame-ops` mostra "AMM Ready 800" mas `/assets` vazio (relacionado a B-2) |
| **B-5** | Baixa | KPIs do multigame-ops não batem: 613 assets UNDER_REVIEW mas Pending review=0 |
| **B-6** | Baixa | Usuário `admin@gamerstock.ai` aparece sem origem clara (provavelmente seed de bootstrap) |
| **B-7** | **Alta** | `/admin/arena` crasha em runtime: `Cannot read properties of undefined (reading 'find')` |
| **B-8** | Baixa | `/admin/metrics` exibe `24h activity rate: NaN%` (divisão por zero) |
| **B-9** | Baixa | `/watchlist` tem schema LoL-only (Region, Rank Tier) que não acompanha pivot multi-game |

### Descoberta adicional de segurança (para auditoria 2.6 futura)

Endpoint `POST /api/admin/auth/reset-password`:
- Quem tiver `ADMIN_BOOTSTRAP_SECRET` pode CRIAR novos admins com qualquer email (não só resetar admin canônico)
- Sem rate-limit
- Comparação de secret não usa `timingSafeEqual` (susceptível a timing attacks)

---

## 6. Recomendação de Ordem de Ataque

### Fase A — Decomissão (1-2 sessões)

Ordem sugerida das remoções, da mais simples para a mais complexa:

1. **P-8: Leaderboard standalone** — feature isolada, baixo acoplamento. Quick win.
2. **P-3 + P-1: Predictions + Predict admin + History** — operação grande mas coesa. Atacar tudo de uma vez. Inclui:
   - Frontend: `predictions.tsx`, `predictions-market.tsx`, `predict-dashboard`, `predict-layout`, ticker
   - Backend: `server/domains/prediction/` inteiro
   - Schema: `shared/schema/prediction.ts` + 11 tabelas `prediction_*`
   - Schedulers: `prediction-auto-lock`, `provider-resolution`
   - Env vars: `PREDICT_ENABLED`, `VITE_PREDICT_ENABLED`
   - Seed dev: 4 mercados FURIA/NAVI
3. **P-5: Arena** — se confirmado remover, atacar junto com a próxima onda
4. **P-6: Draft** — provavelmente atrelado a Arena, sai junto
5. **P-7: AMM standalone** — investigar primeiro se o AMM ativo (multigame) é fork desse ou independente

### Fase B — Limpeza Multigame (1 sessão)

P-4 mantém o sistema, mas precisa de auditoria interna:
- Mapear o que é "lixo" exatamente
- Validar fluxo de claims end-to-end (Steam OAuth → claim → review → approval)
- Decidir destino dos 613 assets em UNDER_REVIEW
- Auditar `/admin/multigame-assets-review` e `/admin/multigame-claims` (não vistas em detalhe)

### Fase C — Correções e Coerência (1 sessão)

- **B-7**: corrigir crash do Arena admin (se mantiver) ou remover (se sair via P-5)
- **B-1**: alinhar fontes de Buying Power
- **B-2/B-4**: investigar pipeline /assets vs /terminal
- **B-8**: tratar divisão por zero em `/admin/metrics`
- **P-9**: limpar copy hardcoded LoL nas páginas multi-game
- **B-9**: ajustar schema de Watchlist para suportar Dota2/CS2

### Fase D — Auditoria estrutural (4-6 sessões — plano original 2.1 a 2.10)

Apenas depois da limpeza acima, atacar as auditorias profundas:
- 2.1 Arquitetura geral
- 2.2 Backend (domínios, schedulers, services)
- 2.3 Frontend (components, state, routing)
- 2.4 Banco e migrations
- 2.5 Auth e session
- **2.6 Segurança** (incluindo endpoint `reset-password` vulnerável)
- 2.7 Dependências (incluindo 13 vulnerabilidades npm)
- 2.8 Testes (ausentes/insuficientes)
- 2.9 Deploy/observabilidade
- 2.10 Features (consolidação e roadmap)

---

## 7. Pendências de manutenção

| Item | Ação |
|------|------|
| Repo `GamerStock-legacy` no GitHub | Deletar após 30 dias (07/06/2026) |
| `ADMIN_PASS=GamerStock-01` | Rotacionar antes de prod, 16+ chars random |
| Email Git `24bit.oficial@gmail.com` | Considerar usar noreply do GitHub antes de tornar repo público |
| `D:\gamer-stock-backup-pre-nuke` | Backup ainda no disco — manter por enquanto, deletar quando confiar na nova baseline |
| `server/replit_integrations/auth/` (4 arquivos) | Manter gated por `REPL_ID`, remover quando confirmado que nunca mais haverá rollback |
| `replit.md` (100KB) | Documentação histórica, manter como referência |

---

**Fim da exploração.** O próximo passo natural é começar a Fase A (decomissão). Recomendo atacar P-1 (Predictions) primeiro porque é o maior, e qualquer mudança subsequente vai depender de saber se o terreno está limpo dele.

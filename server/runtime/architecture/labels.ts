// ── Module Architecture Labels ────────────────────────────────────────────────
//
// Artefato de suporte para classificação arquitetural de módulos.
// Fase 1 — GamerStock Reorganization (2026-04-06)
//
// NÃO integrar no runtime ainda.
// Use esses labels para documentar a intenção de cada módulo durante code review
// e para preparar as fases de refactoring futuras.
//
// Referência: docs/architecture/gamerstock-target-architecture.md
// ─────────────────────────────────────────────────────────────────────────────

/** Status arquitetural de um módulo ou arquivo. */
export type ModuleLabel =
  | "OFFICIAL"       // Módulo ativo em produção com regras de mercado críticas
  | "LEGACY_FROZEN"  // Funciona, não quebrar, não investir — candidato a substituição
  | "EXPERIMENTAL"   // Em desenvolvimento ou não confiável para PROD — pode ser removido
  | "OPS_ONLY";      // Ferramentas administrativas — não afeta regras de mercado

/** Metadados de classificação de um módulo. */
export interface ModuleDescriptor {
  /** Caminho relativo ao projeto (ex: "server/market-maker.ts") */
  path: string;
  /** Classificação arquitetural */
  label: ModuleLabel;
  /** Domínio de negócio ao qual o módulo pertence */
  domain: string;
  /** Nota explicativa sobre o status */
  note?: string;
}

/**
 * Mapa de classificação dos módulos centrais do sistema.
 * Atualizar conforme as fases de refactoring avançam.
 *
 * Fonte de verdade completa: docs/architecture/module-map.md
 */
export const MODULE_MAP: ModuleDescriptor[] = [
  // ── Core de Mercado ───────────────────────────────────────────────────────
  {
    path:   "server/market-maker.ts",
    label:  "OFFICIAL",
    domain: "Market Engine",
    note:   "PAE + momentum + AMM sync — loop central de preço",
  },
  {
    path:   "server/services/ammPricing.ts",
    label:  "OFFICIAL",
    domain: "Market Engine",
  },
  {
    path:   "server/domains/multigame/multigameValuationScheduler.ts",
    label:  "OFFICIAL",
    domain: "Valuation Engine",
    note:   "Loop de valuation Dota2/CS2 — cobre todos os assets ACTIVE/LISTED",
  },
  {
    path:   "server/domains/multigame/dota2ValuationService.ts",
    label:  "OFFICIAL",
    domain: "Valuation Engine",
  },
  {
    path:   "server/domains/multigame/cs2ValuationService.ts",
    label:  "OFFICIAL",
    domain: "Valuation Engine",
  },
  {
    path:   "server/domains/terminal/reconciler.ts",
    label:  "OPS_ONLY",
    domain: "Market Integrity",
    note:   "Reconciler de invariants — INV_5 baseline, INV_6 freshness",
  },

  // ── Legado Congelado ──────────────────────────────────────────────────────
  {
    path:   "server/storage.ts",
    label:  "LEGACY_FROZEN",
    domain: "Infrastructure",
    note:   "Repositório monolítico — substituir por repos de domínio (Fase 5)",
  },
  {
    path:   "server/routes.ts",
    label:  "LEGACY_FROZEN",
    domain: "Infrastructure",
    note:   "Router monolítico — migrar para routers de domínio (Fase 5)",
  },
  {
    path:   "server/riot-sync.ts",
    label:  "LEGACY_FROZEN",
    domain: "Performance Ingestion",
    note:   "Acoplado diretamente — migrar para PerformanceProvider interface (Fase 5)",
  },
  {
    path:   "server/riot-perf.ts",
    label:  "LEGACY_FROZEN",
    domain: "Performance Ingestion",
    note:   "Idem — mover para server/integrations/riot/ (Fase 5)",
  },
  {
    path:   "server/services/valuationJob.ts",
    label:  "LEGACY_FROZEN",
    domain: "Valuation Engine",
    note:   "Valuation LoL/Riot legado — será substituído pelo multigame loop",
  },
  {
    path:   "server/services/pviEngine.ts",
    label:  "LEGACY_FROZEN",
    domain: "Valuation Engine",
    note:   "PVI engine para LoL — legado, não estender",
  },
  {
    path:   "shared/schema/portfolio.ts",
    label:  "LEGACY_FROZEN",
    domain: "Wallet & Ledger",
    note:   "portfolios.balance é legado — usar wallets.available_balance",
  },

  // ── Experimental ──────────────────────────────────────────────────────────
  {
    path:   "server/simulation/",
    label:  "EXPERIMENTAL",
    domain: "Simulation Layer",
    note:   "Bot trader e mercado sintético — não ativo por padrão em PROD",
  },
  {
    path:   "server/web3/",
    label:  "EXPERIMENTAL",
    domain: "Web3 Adapter",
    note:   "Bridge Web3 — não ativo em PROD",
  },
  {
    path:   "server/modules/draft/",
    label:  "EXPERIMENTAL",
    domain: "Draft Module",
    note:   "Sistema de draft — em desenvolvimento",
  },
  {
    path:   "server/domains/synthetic/",
    label:  "EXPERIMENTAL",
    domain: "Simulation Layer",
    note:   "Mercado sintético CS2",
  },

  // ── Operacional ───────────────────────────────────────────────────────────
  {
    path:   "server/domains/admin/",
    label:  "OPS_ONLY",
    domain: "Platform Operations",
    note:   "Painel administrativo — não afeta regras de mercado",
  },
  {
    path:   "server/migrations/",
    label:  "OPS_ONLY",
    domain: "Platform Operations",
    note:   "Scripts de migração pontuais com idempotência",
  },
  {
    path:   "server/market-core/startup-seed.ts",
    label:  "OPS_ONLY",
    domain: "Platform Runtime",
    note:   "Seed inicial — separar comportamento PROD vs DEV (Fase 4)",
  },
];

/**
 * Retorna a classificação de um módulo pelo seu caminho.
 * Útil para tooling e validações em code review.
 */
export function getLabelFor(path: string): ModuleLabel | null {
  const match = MODULE_MAP.find(m => path.startsWith(m.path));
  return match?.label ?? null;
}

/**
 * Filtra módulos por label.
 */
export function getModulesByLabel(label: ModuleLabel): ModuleDescriptor[] {
  return MODULE_MAP.filter(m => m.label === label);
}

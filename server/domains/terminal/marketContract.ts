// ─── Multigame Market Contract ────────────────────────────────────────────────
//
// FORMAL CONTRACT: every game joining the Terminal must implement this interface.
//
// Invariants enforced for any asset to enter/remain ACTIVE/LISTED:
//
//   INV_1  valuation_state exists         → dota2_valuation_state row present
//   INV_2  fundamental_price set          → assets.fundamental_price NOT NULL
//   INV_3  last_trade_price set           → assets.last_trade_price NOT NULL
//   INV_4  bootstrap history exists       → ≥1 row in dota2_value_history
//   INV_5  non-baseline value             → player_value ≠ $15 OR verified via RECALC/MATCH_UPDATE
//   INV_6  dynamic loop coverage          → bulk: has BOOTSTRAP; user-linked: actively processed
//   INV_7  provider/data status valid     → no PROVIDER_FAILED state without retry path
//
// Gate rule at entry:
//   INV_1–INV_4 are HARD gates (must pass before LISTED/ACTIVE).
//   INV_5–INV_7 are monitored by the reconciler and trigger quarantine when unresolvable.
//
// Adding a new game:
//   1. Implement MultigameContract interface
//   2. Register in REGISTERED_GAMES
//   3. Pass all INV_1–INV_4 before promoting to LISTED/ACTIVE
//   4. Ensure your dynamic loop registers processed asset IDs so INV_6 can be checked
//
// ─────────────────────────────────────────────────────────────────────────────

// ── Registered games ──────────────────────────────────────────────────────────

export const REGISTERED_GAMES = ["cs2", "dota2"] as const;
export type RegisteredGame = typeof REGISTERED_GAMES[number];

// ── Data shapes ───────────────────────────────────────────────────────────────

/** Raw data returned by a provider for a single player. */
export interface RawProviderData {
  externalId: string;
  displayName: string;
  providerSource: string;
  [key: string]: unknown;
}

/** Initial valuation computed from provider data at bootstrap time. */
export interface InitialValuation {
  /** Raw performance estimate before confidence weighting (GS units). */
  rawValue: number;
  /** Confidence-weighted player value that flows into assets.fundamental_price. */
  playerValue: number;
  /** 0–1 confidence score — drives uncertainty discount. */
  confidenceScore: number;
}

/** Result of a dynamic performance update tick. */
export interface DynamicPerformanceResult {
  /** True if a new price signal was applied. */
  updated: boolean;
  newPlayerValue?: number;
  newConfidenceScore?: number;
  /** History event type written (e.g. MATCH_UPDATE, RECALC). */
  eventType?: string;
  /** Human-readable reason when updated=false. */
  skipReason?: string;
}

/** Result of a terminal eligibility check. */
export interface GameEligibilityResult {
  eligible: boolean;
  /** Machine-readable reason code when not eligible. */
  reason?: string;
  /** Human-readable message for admin logs. */
  message?: string;
}

// ── Contract interface ────────────────────────────────────────────────────────

/**
 * MultigameContract — the interface every game integration must satisfy.
 *
 * Bootstrap flow (called once when an asset enters the terminal):
 *   1. isEligibleForTerminal()          → guard
 *   2. fetchInitialData()               → raw provider data
 *   3. calculateInitialValuation()      → raw → player_value
 *   4. projectValuationToCanonicalPrice() → write to assets table
 *   → then gateTerminalPromotion() in invariants.ts promotes to LISTED/ACTIVE
 *
 * Dynamic loop (runs every N minutes for user-linked assets):
 *   calculateDynamicPerformance()       → update valuation_state + write history event
 *   → PAE (Performance Anchor Engine) pulls market price toward fundamental_price
 */
export interface MultigameContract {
  /** Game identifier — must match REGISTERED_GAMES. */
  readonly game: RegisteredGame;

  /**
   * Check whether this external account is eligible to enter the terminal.
   * Called BEFORE any data fetch to avoid wasting provider quota on ineligible assets.
   */
  isEligibleForTerminal(externalId: string): Promise<GameEligibilityResult>;

  /**
   * Fetch raw data from the game's provider (Steam, OpenDota, PandaScore, Riot, etc).
   * Returns null when the provider has no data for this player (not a fatal error).
   */
  fetchInitialData(externalId: string): Promise<RawProviderData | null>;

  /**
   * Compute the initial valuation from raw provider data.
   * Must always return a deterministic result — never throw on missing fields.
   * Falls back to baseline (15.00 GS, confidence 0.30) when data is incomplete.
   */
  calculateInitialValuation(data: RawProviderData): Promise<InitialValuation>;

  /**
   * Write the initial valuation into the canonical assets table.
   * Specifically: sets fundamental_price, last_trade_price, and seeds the AMM.
   * Called after calculateInitialValuation — the last step before gate check.
   */
  projectValuationToCanonicalPrice(assetId: number, valuation: InitialValuation): Promise<void>;

  /**
   * Run a single dynamic performance update for a user-linked asset.
   * Called by the multigame valuation scheduler every 10 minutes.
   * Must write a history event on success (MATCH_UPDATE, RECALC, etc).
   */
  calculateDynamicPerformance(
    assetId: number,
    userId: string,
  ): Promise<DynamicPerformanceResult>;
}

// ── Provider failure states ───────────────────────────────────────────────────

/**
 * Intermediate asset statuses used when the full bootstrap pipeline cannot
 * complete. The asset must NOT be set to LISTED/ACTIVE in any of these states.
 *
 * UNDER_REVIEW  — provider data missing; pending manual review or retry
 * PAUSED        — invariant violation detected; trading suspended
 * ELIGIBLE      — data collected; awaiting admin approval to list
 */
export type IntermediateAssetStatus = "UNDER_REVIEW" | "PAUSED" | "ELIGIBLE";

/**
 * Reason codes for bootstrap failures.
 * Stored in asset metadata or logs to enable targeted reconciliation.
 */
export type BootstrapFailureReason =
  | "PROVIDER_UNAVAILABLE"    // External API down or quota exceeded
  | "PROVIDER_NO_DATA"        // Provider returned 200 but no data for this player
  | "VALUATION_COMPUTE_FAILED" // calculateInitialValuation threw
  | "PROJECTION_FAILED"       // projectValuationToCanonicalPrice threw
  | "INVARIANT_GATE_FAILED"   // gateTerminalPromotion() rejected (INV_1–INV_4)
  | "ALREADY_CLAIMED";        // Another user already owns this asset

/**
 * Verification Registry — GamerStock Multigame
 *
 * Factory / registry for provider verification adapters.
 * Maps providerGroup identifiers to their VerificationAdapter implementations.
 *
 * Usage:
 *   const adapter = getVerificationAdapter("steam");
 *   const { redirectUrl, verificationEventPayload } = adapter.startVerification(params);
 *
 * Adding a new provider:
 *   1. Implement the VerificationAdapter interface (see verificationAdapter.ts).
 *   2. Import the adapter and add it to the REGISTRY map below.
 *   3. The routes, claim discovery, and policy evaluator will automatically support it
 *      once the corresponding GameClaimPolicy is declared in claimPolicyConfig.ts.
 *
 * Registry state:
 *   steam  → steamVerificationAdapter   (active — Fase 10/16)
 *   riot   → riotVerificationAdapter    (stub — Fase 16; throws on call)
 *   epic   → epicVerificationAdapter    (stub — Fase 16; throws on call)
 */

import type { VerificationAdapter } from "./verificationAdapter";
import { steamVerificationAdapter } from "./steamVerificationAdapter";
import { riotVerificationAdapter }  from "./riotVerificationAdapter";
import { epicVerificationAdapter }  from "./epicVerificationAdapter";

// ── Registry ──────────────────────────────────────────────────────────────────

const REGISTRY: Map<string, VerificationAdapter> = new Map([
  ["steam", steamVerificationAdapter],
  ["riot",  riotVerificationAdapter],
  ["epic",  epicVerificationAdapter],
]);

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Retrieve the adapter for a given providerGroup.
 *
 * @throws Error(`NO_VERIFICATION_ADAPTER:${providerGroup}`) if no adapter is registered.
 *
 * Note: Stub adapters (riot, epic) ARE registered and will be returned by this function.
 * They throw descriptive errors if their methods are called — this is intentional.
 * It allows the registry to always return an adapter (useful for capability checks)
 * while making unimplemented calls fail fast with clear messages.
 */
export function getVerificationAdapter(providerGroup: string): VerificationAdapter {
  const adapter = REGISTRY.get(providerGroup);
  if (!adapter) {
    throw new Error(`NO_VERIFICATION_ADAPTER:${providerGroup}`);
  }
  return adapter;
}

/**
 * Register (or replace) an adapter for a providerGroup.
 *
 * Useful for testing and for plugins registering adapters at startup.
 * In production, all adapters are registered statically above.
 */
export function registerVerificationAdapter(adapter: VerificationAdapter): void {
  REGISTRY.set(adapter.providerGroup, adapter);
}

/**
 * Return the list of all registered provider groups.
 * Includes both active adapters and stubs.
 */
export function listRegisteredProviders(): string[] {
  return Array.from(REGISTRY.keys());
}

/**
 * Check if a provider group has an active (non-stub) adapter registered.
 *
 * Currently, "active" means the adapter method is not a NOT_IMPLEMENTED stub.
 * This is determined by whether startVerification() throws on a dry-run check.
 *
 * Use this for capability checks (e.g. to decide whether to show a "Connect" button).
 * Returns false for riot/epic until their adapters are implemented.
 */
export function isProviderActive(providerGroup: string): boolean {
  return REGISTRY.has(providerGroup) && providerGroup === "steam";
}

/**
 * Server-side feature flags.
 * Each flag is read from environment variables at call time.
 * Absent or empty value = feature enabled (opt-in to disable).
 */

/**
 * Returns true when the Prediction Markets feature is enabled.
 * Set PREDICT_ENABLED=false in the server environment to disable.
 *
 * The client-side equivalent is VITE_PREDICT_ENABLED (featureFlags.ts).
 * Both flags can be set independently; the server flag is the authoritative
 * gate for all API operations.
 */
export function isPredictEnabledServer(): boolean {
  const val = process.env.PREDICT_ENABLED;
  if (!val || val.trim() === "") return true;
  return val.trim().toLowerCase() !== "false";
}

/**
 * Feature flags — read from Vite env vars at runtime.
 * Default to enabled (true) if the var is absent or anything other than "false".
 */

export const isPredictEnabled = (): boolean =>
  import.meta.env.VITE_PREDICT_ENABLED !== "false";

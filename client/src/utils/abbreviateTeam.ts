/**
 * Abbreviate a team or side label to at most 3 uppercase characters.
 * Used in Trade Card CTAs and side buttons to prevent layout overflow.
 *
 * Rules:
 *  - empty / whitespace  → ""
 *  - 3 chars or fewer    → uppercase as-is
 *  - multi-word          → first 3 chars of the first word
 *  - single long word    → first 3 chars
 *
 * Examples:
 *  "Spirit Academy" → "SPI"
 *  "Zero Tenacity"  → "ZER"
 *  "FURIA"          → "FUR"
 *  "YES"            → "YES"
 *  "NO"             → "NO"
 */
export function abbreviateTeam(name: string): string {
  const cleaned = (name ?? "").trim();
  if (!cleaned) return "";
  if (cleaned.length <= 3) return cleaned.toUpperCase();
  const parts = cleaned.split(/\s+/);
  return parts[0].slice(0, 3).toUpperCase();
}

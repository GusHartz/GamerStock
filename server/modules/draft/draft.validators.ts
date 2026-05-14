export const VALID_SLOT_TYPES = [
  "top",
  "jungle",
  "mid",
  "adc",
  "support",
  "breakout_player",
  "rising_star",
  "hidden_gem",
] as const;

export type ValidSlotType = (typeof VALID_SLOT_TYPES)[number];

export const ROLE_SLOTS: readonly string[] = ["top", "jungle", "mid", "adc", "support"];
export const PERFORMANCE_SLOTS: readonly string[] = ["breakout_player", "rising_star", "hidden_gem"];
export const REQUIRED_SLOTS: readonly string[] = [...ROLE_SLOTS, ...PERFORMANCE_SLOTS];

export class DraftValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DraftValidationError";
  }
}

export function isValidSlotType(slot: unknown): slot is ValidSlotType {
  return typeof slot === "string" && (VALID_SLOT_TYPES as readonly string[]).includes(slot);
}

export function validatePicksPayload(picks: unknown): Array<{ slotType: ValidSlotType; playerId: string }> {
  if (!Array.isArray(picks)) {
    throw new DraftValidationError("INVALID_PAYLOAD", "picks must be an array");
  }
  if (picks.length === 0) {
    throw new DraftValidationError("EMPTY_PICKS", "picks array must not be empty");
  }
  if (picks.length > 8) {
    throw new DraftValidationError("TOO_MANY_PICKS", "Maximum 8 picks allowed per entry");
  }

  const seenSlots = new Set<string>();

  return picks.map((item: unknown, idx: number) => {
    if (!item || typeof item !== "object") {
      throw new DraftValidationError("INVALID_PAYLOAD", `Pick at index ${idx} must be an object`);
    }
    const p = item as Record<string, unknown>;

    if (!isValidSlotType(p.slotType)) {
      throw new DraftValidationError(
        "INVALID_SLOT_TYPE",
        `Invalid slotType "${p.slotType}" at index ${idx}. Must be one of: ${VALID_SLOT_TYPES.join(", ")}`,
      );
    }
    if (seenSlots.has(p.slotType as string)) {
      throw new DraftValidationError("DUPLICATE_SLOT", `Duplicate slotType "${p.slotType}" in request`);
    }
    seenSlots.add(p.slotType as string);

    if (!p.playerId || typeof p.playerId !== "string" || p.playerId.trim() === "") {
      throw new DraftValidationError("INVALID_PLAYER", `playerId is required at index ${idx}`);
    }

    return { slotType: p.slotType as ValidSlotType, playerId: p.playerId as string };
  });
}

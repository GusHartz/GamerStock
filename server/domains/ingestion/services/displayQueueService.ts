// ─── Display Queue Service ─────────────────────────────────────────────────────
// Responsibility: operate the prediction_display_queue table.
//
// Schema facts that drive every design decision here:
//   - entity_type   varchar(50)   — what type of entity occupies the slot
//   - entity_id     integer       — FK-free ref to the entity
//   - surface       varchar(100)  — named display surface (home, hero, predictions…)
//   - position      integer       — ordering within a surface
//   - UNIQUE (surface, position)  — no two active slots share the same position
//   - is_active     boolean       — soft-deactivation flag
//   - starts_at / ends_at        — optional visibility window
//   - curation_label             — optional display annotation
//   - created_by / updated_by    — soft audit refs (no FK)
//
// Supported operations:
//   listDisplayQueue           — paginated, filterable list
//   getDisplayQueueItem        — single item by PK
//   addEventToDisplayQueue     — insert a prediction_event slot
//   reorderDisplayQueueItem    — swap positions within a surface (transactional)
//   updateDisplayQueueItem     — patch editorial fields (label, isActive, startsAt, endsAt)
//   deactivateDisplayQueueItem — soft deactivate (is_active = false)
//   removeDisplayQueueItem     — hard delete (no FK references this table)
//
// Limitations of the current schema:
//   - No unique constraint on (entity_type, entity_id, surface), so the same
//     event can appear multiple times on the same surface. addEventToDisplayQueue
//     enforces this guard in the service layer instead.
//   - position gaps are not auto-compacted; reorder only swaps one pair.
// ─────────────────────────────────────────────────────────────────────────────

import { eq, and, desc, max, sql, inArray } from "drizzle-orm";
import { db } from "../../../db";
import {
  predictionDisplayQueue,
  type PredictionDisplayQueueItem,
} from "../../../../shared/schema/ingestion";
import { predictionEvents } from "../../../../shared/schema/prediction";
import { evictCached } from "../../prediction/cache";

const HOME_CACHE_KEY = "prediction:home";

// ── Canonical surface values ────────────────────────────────────────────────
// Derived from ingestion.types.ts DisplayQueueSurface.

export const VALID_SURFACES = [
  "hero",
  "predictions",
  "featured",
  "upcoming",
] as const;

export type DisplayQueueSurface = (typeof VALID_SURFACES)[number];

// ── Input/filter types ────────────────────────────────────────────────────────

export interface ListDisplayQueueFilters {
  surface?:    string;
  isActive?:   boolean;
  entityType?: string;
  entityId?:   number;
  limit?:      number;
  offset?:     number;
}

export interface AddToDisplayQueueInput {
  /** ID of an existing prediction_event */
  entityId:        number;
  surface:         string;
  /** Explicit position. If omitted, item is appended (max + 1). */
  position?:       number;
  startsAt?:       Date | null;
  endsAt?:         Date | null;
  curationLabel?:  string | null;
  createdBy?:      string | null;
}

export interface ReorderDisplayQueueInput {
  position:   number;
  updatedBy?: string | null;
}

// ── Errors ────────────────────────────────────────────────────────────────────

export class DisplayQueueItemNotFoundError extends Error {
  readonly statusCode = 404;
  constructor(id: number) {
    super(`Display queue item #${id} not found`);
    this.name = "DisplayQueueItemNotFoundError";
  }
}

export class DisplayQueueConflictError extends Error {
  readonly statusCode = 409;
  constructor(message: string) {
    super(message);
    this.name = "DisplayQueueConflictError";
  }
}

export class DisplayQueueValidationError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = "DisplayQueueValidationError";
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

export class DisplayQueueService {

  // ── Read ──────────────────────────────────────────────────────────────────

  async listDisplayQueue(
    filters: ListDisplayQueueFilters = {}
  ): Promise<{ rows: PredictionDisplayQueueItem[]; total: number }> {
    const limit  = Math.min(filters.limit  ?? 50, 200);
    const offset = filters.offset ?? 0;

    const conditions = [];
    // Always exclude legacy items with deprecated surfaces (e.g. "home").
    conditions.push(inArray(predictionDisplayQueue.surface, [...VALID_SURFACES]));
    if (filters.surface    !== undefined) conditions.push(eq(predictionDisplayQueue.surface,    filters.surface));
    if (filters.entityType !== undefined) conditions.push(eq(predictionDisplayQueue.entityType, filters.entityType));
    if (filters.isActive   !== undefined) conditions.push(eq(predictionDisplayQueue.isActive,   filters.isActive));
    if (filters.entityId   !== undefined) conditions.push(eq(predictionDisplayQueue.entityId,   filters.entityId));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, countResult] = await Promise.all([
      db.select()
        .from(predictionDisplayQueue)
        .where(where)
        .orderBy(
          sql`surface ASC, position ASC`
        )
        .limit(limit)
        .offset(offset),

      db.select({ total: sql<number>`count(*)::int` })
        .from(predictionDisplayQueue)
        .where(where),
    ]);

    return { rows, total: countResult[0]?.total ?? 0 };
  }

  async getDisplayQueueItem(id: number): Promise<PredictionDisplayQueueItem> {
    const [row] = await db
      .select()
      .from(predictionDisplayQueue)
      .where(eq(predictionDisplayQueue.id, id))
      .limit(1);

    if (!row) throw new DisplayQueueItemNotFoundError(id);
    return row;
  }

  // ── Write — add ───────────────────────────────────────────────────────────

  async addEventToDisplayQueue(
    input: AddToDisplayQueueInput
  ): Promise<PredictionDisplayQueueItem> {
    // Validate surface value
    if (!VALID_SURFACES.includes(input.surface as DisplayQueueSurface)) {
      throw new DisplayQueueValidationError(
        `Invalid surface "${input.surface}". Valid values: ${VALID_SURFACES.join(", ")}`
      );
    }

    // Validate the prediction_event exists
    const [event] = await db
      .select({ id: predictionEvents.id })
      .from(predictionEvents)
      .where(eq(predictionEvents.id, input.entityId))
      .limit(1);

    if (!event) {
      throw new DisplayQueueValidationError(
        `prediction_event #${input.entityId} does not exist`
      );
    }

    // Guard against duplicate (same event already active on this surface)
    const [duplicate] = await db
      .select({ id: predictionDisplayQueue.id })
      .from(predictionDisplayQueue)
      .where(
        and(
          eq(predictionDisplayQueue.entityType, "event"),
          eq(predictionDisplayQueue.entityId,   input.entityId),
          eq(predictionDisplayQueue.surface,    input.surface),
          eq(predictionDisplayQueue.isActive,   true),
        )
      )
      .limit(1);

    if (duplicate) {
      throw new DisplayQueueConflictError(
        `prediction_event #${input.entityId} is already active on surface "${input.surface}" (queue item #${duplicate.id})`
      );
    }

    // Determine position (explicit or append)
    let position = input.position;

    if (position === undefined) {
      // Append: use max position on this surface + 1 (or 1 if empty)
      const [maxRow] = await db
        .select({ maxPos: max(predictionDisplayQueue.position) })
        .from(predictionDisplayQueue)
        .where(eq(predictionDisplayQueue.surface, input.surface));

      position = (maxRow?.maxPos ?? 0) + 1;
    }

    // Check the explicit position is not already taken on this surface
    if (input.position !== undefined) {
      const [taken] = await db
        .select({ id: predictionDisplayQueue.id })
        .from(predictionDisplayQueue)
        .where(
          and(
            eq(predictionDisplayQueue.surface,  input.surface),
            eq(predictionDisplayQueue.position, input.position),
          )
        )
        .limit(1);

      if (taken) {
        throw new DisplayQueueConflictError(
          `Position ${input.position} on surface "${input.surface}" is already occupied (queue item #${taken.id}). ` +
          `Use /reorder to swap, or omit position to auto-append.`
        );
      }
    }

    const [row] = await db
      .insert(predictionDisplayQueue)
      .values({
        entityType:    "event",
        entityId:      input.entityId,
        surface:       input.surface,
        position,
        startsAt:      input.startsAt  ?? null,
        endsAt:        input.endsAt    ?? null,
        isActive:      true,
        curationLabel: input.curationLabel ?? null,
        createdBy:     input.createdBy     ?? null,
        updatedBy:     input.createdBy     ?? null,
      })
      .returning();

    evictCached(HOME_CACHE_KEY);
    return row;
  }

  // ── Write — reorder ───────────────────────────────────────────────────────

  /**
   * Moves item `id` to `targetPosition` within its surface.
   * If another item currently occupies `targetPosition`, they swap.
   * Uses a temporary position to avoid the unique constraint during the swap.
   */
  async reorderDisplayQueueItem(
    id:    number,
    input: ReorderDisplayQueueInput
  ): Promise<{ item: PredictionDisplayQueueItem; swappedWith: PredictionDisplayQueueItem | null }> {
    const item = await this.getDisplayQueueItem(id);

    if (item.position === input.position) {
      // No-op — already at target position
      return { item, swappedWith: null };
    }

    // Find any item currently at the target position on the same surface
    const [occupant] = await db
      .select()
      .from(predictionDisplayQueue)
      .where(
        and(
          eq(predictionDisplayQueue.surface,  item.surface),
          eq(predictionDisplayQueue.position, input.position),
        )
      )
      .limit(1);

    const updatedAt = new Date();
    let finalItem!: PredictionDisplayQueueItem;
    let swappedWith: PredictionDisplayQueueItem | null = null;

    await db.transaction(async (tx) => {
      if (occupant) {
        // Swap: move `item` to a temp position to free the unique slot
        const tempPosition = -item.id; // guaranteed unique per item

        // 1. item → temp (avoid unique conflict)
        await tx
          .update(predictionDisplayQueue)
          .set({ position: tempPosition, updatedBy: input.updatedBy ?? null, updatedAt })
          .where(eq(predictionDisplayQueue.id, id));

        // 2. occupant → item's old position
        const [swapped] = await tx
          .update(predictionDisplayQueue)
          .set({ position: item.position, updatedBy: input.updatedBy ?? null, updatedAt })
          .where(eq(predictionDisplayQueue.id, occupant.id))
          .returning();
        swappedWith = swapped;

        // 3. item → target position
        const [moved] = await tx
          .update(predictionDisplayQueue)
          .set({ position: input.position, updatedBy: input.updatedBy ?? null, updatedAt })
          .where(eq(predictionDisplayQueue.id, id))
          .returning();
        finalItem = moved;
      } else {
        // Direct move — target position is free
        const [moved] = await tx
          .update(predictionDisplayQueue)
          .set({ position: input.position, updatedBy: input.updatedBy ?? null, updatedAt })
          .where(eq(predictionDisplayQueue.id, id))
          .returning();
        finalItem = moved;
      }
    });

    evictCached(HOME_CACHE_KEY);
    return { item: finalItem, swappedWith };
  }

  // ── Write — editorial update ─────────────────────────────────────────────

  async updateDisplayQueueItem(
    id:        number,
    input: {
      curationLabel?: string | null;
      isActive?:      boolean;
      startsAt?:      Date | null;
      endsAt?:        Date | null;
      updatedBy?:     string | null;
    }
  ): Promise<PredictionDisplayQueueItem> {
    await this.getDisplayQueueItem(id);

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.updatedBy     !== undefined) patch.updatedBy     = input.updatedBy;
    if (input.curationLabel !== undefined) patch.curationLabel = input.curationLabel;
    if (input.isActive      !== undefined) patch.isActive      = input.isActive;
    if (input.startsAt      !== undefined) patch.startsAt      = input.startsAt;
    if (input.endsAt        !== undefined) patch.endsAt        = input.endsAt;

    const [row] = await db
      .update(predictionDisplayQueue)
      .set(patch as any)
      .where(eq(predictionDisplayQueue.id, id))
      .returning();

    evictCached(HOME_CACHE_KEY);
    return row;
  }

  // ── Write — deactivate / delete ───────────────────────────────────────────

  async deactivateDisplayQueueItem(
    id:         number,
    updatedBy?: string | null
  ): Promise<PredictionDisplayQueueItem> {
    // Verify existence first for a clean 404
    await this.getDisplayQueueItem(id);

    const [row] = await db
      .update(predictionDisplayQueue)
      .set({
        isActive:  false,
        updatedBy: updatedBy ?? null,
        updatedAt: new Date(),
      })
      .where(eq(predictionDisplayQueue.id, id))
      .returning();

    evictCached(HOME_CACHE_KEY);
    return row;
  }

  async removeDisplayQueueItem(id: number): Promise<void> {
    // Verify existence first for a clean 404
    await this.getDisplayQueueItem(id);

    await db
      .delete(predictionDisplayQueue)
      .where(eq(predictionDisplayQueue.id, id));

    evictCached(HOME_CACHE_KEY);
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────
export const displayQueueService = new DisplayQueueService();

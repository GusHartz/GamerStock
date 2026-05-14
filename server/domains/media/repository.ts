// ─── Media Repository ─────────────────────────────────────────────────────────
import { db } from "../../db";
import { mediaAssets, predictionEventMedia } from "@shared/schema";
import {
  type InsertMediaAsset,
  type MediaAsset,
  type InsertPredictionEventMedia,
  type PredictionEventMedia,
} from "@shared/schema";
import { eq, desc, sql } from "drizzle-orm";

// Columns returned for listing/single-asset endpoints (excludes fileData — too large).
const metaCols = {
  id:              mediaAssets.id,
  storageProvider: mediaAssets.storageProvider,
  storageKey:      mediaAssets.storageKey,
  publicUrl:       mediaAssets.publicUrl,
  mimeType:        mediaAssets.mimeType,
  fileName:        mediaAssets.fileName,
  fileSize:        mediaAssets.fileSize,
  width:           mediaAssets.width,
  height:          mediaAssets.height,
  assetType:       mediaAssets.assetType,
  createdBy:       mediaAssets.createdBy,
  isActive:        mediaAssets.isActive,
  createdAt:       mediaAssets.createdAt,
  updatedAt:       mediaAssets.updatedAt,
};

// ── Assets ────────────────────────────────────────────────────────────────────

export async function createAsset(
  input:    InsertMediaAsset,
  fileData: Buffer,
): Promise<MediaAsset> {
  const [row] = await db
    .insert(mediaAssets)
    .values({ ...input, fileData } as any)
    .returning(metaCols as any);
  return row as MediaAsset;
}

export async function listAssets(
  limit  = 100,
  offset = 0,
): Promise<{ rows: MediaAsset[]; total: number }> {
  const [rows, totals] = await Promise.all([
    db.select(metaCols as any).from(mediaAssets)
      .where(eq(mediaAssets.isActive, true))
      .orderBy(desc(mediaAssets.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)::int` })
      .from(mediaAssets)
      .where(eq(mediaAssets.isActive, true)),
  ]);
  return { rows: rows as MediaAsset[], total: totals[0]?.count ?? 0 };
}

export async function findAssetById(id: number): Promise<MediaAsset | null> {
  const [row] = await db
    .select(metaCols as any)
    .from(mediaAssets)
    .where(eq(mediaAssets.id, id));
  return (row as MediaAsset) ?? null;
}

/** Used by the media-serve endpoint — fetches ONLY fileData + mimeType. */
export async function findAssetFileByStorageKey(
  storageKey: string,
): Promise<{ fileData: Buffer; mimeType: string } | null> {
  const [row] = await db
    .select({ fileData: mediaAssets.fileData, mimeType: mediaAssets.mimeType })
    .from(mediaAssets)
    .where(eq(mediaAssets.storageKey, storageKey));
  if (!row || !row.fileData) return null;
  return { fileData: row.fileData as Buffer, mimeType: row.mimeType };
}

// ── Asset deletion ────────────────────────────────────────────────────────────

export async function deleteEventMediaByAssetId(assetId: number): Promise<number> {
  const deleted = await db
    .delete(predictionEventMedia)
    .where(eq(predictionEventMedia.mediaAssetId, assetId))
    .returning();
  return deleted.length;
}

export async function deleteAssetById(id: number): Promise<boolean> {
  const deleted = await db
    .delete(mediaAssets)
    .where(eq(mediaAssets.id, id))
    .returning();
  return deleted.length > 0;
}

// ── Event-media links ──────────────────────────────────────────────────────────

export async function attachAssetToEvent(
  input: InsertPredictionEventMedia,
): Promise<PredictionEventMedia> {
  const [row] = await db.insert(predictionEventMedia).values(input).returning();
  return row;
}

export async function listEventMedia(
  eventId: number,
): Promise<(PredictionEventMedia & { asset: MediaAsset | null })[]> {
  const links = await db
    .select()
    .from(predictionEventMedia)
    .where(eq(predictionEventMedia.predictionEventId, eventId))
    .orderBy(predictionEventMedia.sortOrder, predictionEventMedia.createdAt);

  if (links.length === 0) return [];

  const allAssets = await db.select(metaCols as any).from(mediaAssets);
  const assetsMap = Object.fromEntries(
    (allAssets as MediaAsset[]).map((a) => [a.id, a]),
  );

  return links.map((l) => ({ ...l, asset: assetsMap[l.mediaAssetId] ?? null }));
}

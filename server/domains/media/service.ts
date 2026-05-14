// ─── Media Service ────────────────────────────────────────────────────────────
import path from "path";
import crypto from "crypto";
import * as mediaRepository from "./repository";
import type { MediaAsset, PredictionEventMedia } from "@shared/schema";

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/svg+xml", "image/gif"];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export function validateMime(mimeType: string): boolean {
  return ALLOWED_MIME_TYPES.includes(mimeType);
}

export function validateSize(size: number): boolean {
  return size <= MAX_FILE_SIZE;
}

export function generateStorageKey(originalName: string): string {
  const ext  = path.extname(originalName).toLowerCase();
  const hash = crypto.randomBytes(8).toString("hex");
  return `${Date.now()}_${hash}${ext}`;
}

export function publicUrlFromKey(storageKey: string): string {
  return `/uploads/media/${storageKey}`;
}

export async function saveUploadedFile(opts: {
  buffer:       Buffer;
  originalName: string;
  mimeType:     string;
  fileSize:     number;
  createdBy?:   string;
}): Promise<MediaAsset> {
  const { buffer, originalName, mimeType, fileSize, createdBy } = opts;

  if (!validateMime(mimeType)) {
    throw new Error(`Unsupported file type: ${mimeType}. Allowed: jpeg, png, webp, svg, gif`);
  }
  if (!validateSize(fileSize)) {
    throw new Error(`File too large: ${(fileSize / 1024 / 1024).toFixed(1)} MB (max 10 MB)`);
  }

  const storageKey = generateStorageKey(originalName);

  return mediaRepository.createAsset(
    {
      storageProvider: "database",
      storageKey,
      publicUrl:   publicUrlFromKey(storageKey),
      mimeType,
      fileName:    originalName,
      fileSize,
      assetType:   "image",
      createdBy:   createdBy ?? null,
      isActive:    true,
    },
    buffer,
  );
}

export async function serveFile(
  storageKey: string,
): Promise<{ fileData: Buffer; mimeType: string } | null> {
  return mediaRepository.findAssetFileByStorageKey(storageKey);
}

export async function listAssets(limit = 100, offset = 0) {
  return mediaRepository.listAssets(limit, offset);
}

export async function getAsset(id: number): Promise<MediaAsset | null> {
  return mediaRepository.findAssetById(id);
}

export async function attachToEvent(opts: {
  predictionEventId: number;
  mediaAssetId:      number;
  usageType:         string;
  sortOrder?:        number;
}) {
  const asset = await mediaRepository.findAssetById(opts.mediaAssetId);
  if (!asset) throw new Error(`Media asset #${opts.mediaAssetId} not found`);

  return mediaRepository.attachAssetToEvent({
    predictionEventId: opts.predictionEventId,
    mediaAssetId:      opts.mediaAssetId,
    usageType:         opts.usageType,
    sortOrder:         opts.sortOrder ?? 0,
  });
}

export async function listEventMedia(eventId: number) {
  return mediaRepository.listEventMedia(eventId);
}

export async function deleteMediaAsset(id: number): Promise<{ deletedLinks: number }> {
  const asset = await mediaRepository.findAssetById(id);
  if (!asset) throw new Error(`Asset #${id} not found`);

  const deletedLinks = await mediaRepository.deleteEventMediaByAssetId(id);
  await mediaRepository.deleteAssetById(id);

  return { deletedLinks };
}

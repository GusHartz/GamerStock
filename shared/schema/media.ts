// ─── Media Domain — Drizzle Schema ───────────────────────────────────────────
// Sprint 3.5 · Etapa 3: media assets + event-media join table.
//
// Design:
//   - serial IDs (matches existing domain convention)
//   - No pg enums — varchar string literals
//   - storageProvider "database" — file bytes stored in file_data (bytea)
//   - predictionEventId stored without FK constraint (cross-domain boundary)
// ─────────────────────────────────────────────────────────────────────────────

import {
  pgTable,
  serial,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  index,
  customType,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ─── Custom bytea type ────────────────────────────────────────────────────────

const bytea = customType<{ data: Buffer | null; notNull: false; default: false }>({
  dataType() {
    return "bytea";
  },
  toDriver(value: Buffer | null) {
    return value;
  },
  fromDriver(value: unknown): Buffer | null {
    if (value === null || value === undefined) return null;
    if (Buffer.isBuffer(value)) return value;
    if (typeof value === "string") {
      // pg text protocol returns bytea as \x<hex>
      if (value.startsWith("\\x")) return Buffer.from(value.slice(2), "hex");
      return Buffer.from(value, "hex");
    }
    return Buffer.from(value as any);
  },
});

// ─── media_assets ─────────────────────────────────────────────────────────────

export const mediaAssets = pgTable("media_assets", {
  id:               serial("id").primaryKey(),
  storageProvider:  varchar("storage_provider", { length: 32 }).notNull().default("database"),
  storageKey:       varchar("storage_key",       { length: 512 }).notNull(),
  publicUrl:        varchar("public_url",         { length: 1024 }).notNull(),
  mimeType:         varchar("mime_type",          { length: 64 }).notNull(),
  fileName:         varchar("file_name",          { length: 255 }).notNull(),
  fileSize:         integer("file_size").notNull(),
  width:            integer("width"),
  height:           integer("height"),
  assetType:        varchar("asset_type",         { length: 64 }).notNull().default("image"),
  createdBy:        varchar("created_by",         { length: 64 }),
  isActive:         boolean("is_active").notNull().default(true),
  fileData:         bytea("file_data"),
  createdAt:        timestamp("created_at").notNull().defaultNow(),
  updatedAt:        timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("media_assets_storage_key_idx").on(t.storageKey),
  index("media_assets_created_at_idx").on(t.createdAt),
]);

export const insertMediaAssetSchema = createInsertSchema(mediaAssets).omit({
  id:        true,
  fileData:  true,
  createdAt: true,
  updatedAt: true,
});

export type InsertMediaAsset = z.infer<typeof insertMediaAssetSchema>;
export type MediaAsset = Omit<typeof mediaAssets.$inferSelect, "fileData">;

// ─── prediction_event_media ────────────────────────────────────────────────────

export const predictionEventMedia = pgTable("prediction_event_media", {
  id:                serial("id").primaryKey(),
  predictionEventId: integer("prediction_event_id").notNull(),
  mediaAssetId:      integer("media_asset_id").notNull(),
  usageType:         varchar("usage_type", { length: 64 }).notNull().default("card"),
  sortOrder:         integer("sort_order").notNull().default(0),
  createdAt:         timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("pem_event_idx").on(t.predictionEventId),
  index("pem_asset_idx").on(t.mediaAssetId),
]);

export const insertPredictionEventMediaSchema = createInsertSchema(predictionEventMedia).omit({
  id: true,
  createdAt: true,
});

export type InsertPredictionEventMedia = z.infer<typeof insertPredictionEventMediaSchema>;
export type PredictionEventMedia = typeof predictionEventMedia.$inferSelect;

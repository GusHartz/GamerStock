// ─── Compatibility shim ───────────────────────────────────────────────────────
// This file is kept as the public entry point for all schema imports.
// The actual table definitions now live in shared/schema/ (domain files).
// Importing from `@shared/schema` or `shared/schema.ts` continues to work
// without any changes to existing consumers.
// ─────────────────────────────────────────────────────────────────────────────
export * from "./schema/index";

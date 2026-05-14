# Contributing to GamerStock

## TypeScript entry-points convention

> **Rule**: every TypeScript entry-point in this project MUST have `import "dotenv/config";` as the first line (before any other import).

### Why

| Runtime | Loads `.env` automatically? |
|---|---|
| Vite dev server | ✅ Yes (via its own `loadEnv`) |
| `tsx <file>` | ❌ No |
| `node <file>` | ❌ No |
| `vitest` | ❌ No (must be added via `setupFiles`) |

Most modules in `server/` read `process.env.X` at **import-time** (e.g., `server/db.ts:7-11` throws `"DATABASE_URL must be set"`). If `.env` is not loaded before those imports resolve, the entry-point dies before any of its logic runs.

In the original Replit deployment, env vars were injected by the platform runtime and this was never a problem. Post-migration to local Windows / Docker, every TS entry-point that does not run through Vite must load `.env` explicitly.

### Affected callsites

| File | Loader |
|---|---|
| `server/index.ts` | `import "dotenv/config";` (line 1) |
| `server/scripts/prod-bootstrap.ts` | `import "dotenv/config";` (line 1) |
| `seed.ts` | `import "dotenv/config";` (line 1) |
| `vitest.config.ts` | `setupFiles: ["dotenv/config"]` in `test` config |
| `script/build.ts` | ❌ not needed — only uses `process.env` inside esbuild `define` (bundle-time replacement) |

### Adding a new entry-point

Any new file in `server/scripts/`, any new test config, or any standalone script that is invoked via `npx tsx <file>` or `node <file>`:

```typescript
import "dotenv/config";   // ← MUST be the first line
// ... your other imports
```

### Why this exists (S-18 architectural smell)

See `docs/audit/REMEDIATION-PLAN.md` — smell S-18 ("Replit-shaped platform debt — TS entry-points lack explicit dotenv load post-migration").

The historical leak: scripts that worked on Replit silently broke after migration with a misleading throw from `server/db.ts`. Tracking the smell as S-18 keeps it visible so we don't have to rediscover the rule each time someone adds a new entry-point.

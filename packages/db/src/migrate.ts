/**
 * Migration-runner wrapper. The committed migrations live in
 * `packages/db/drizzle/`; they are resolved relative to this module via
 * `import.meta.url` so the same logic works from `src/` (Vitest) and from
 * the compiled `dist/` output inside a packaged app — never from `cwd`.
 */
import { fileURLToPath } from 'node:url';

import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

/** Absolute path of the committed `drizzle/` migrations folder. */
export function resolveMigrationsFolder(): string {
  // `src/migrate.ts` and `dist/migrate.js` are both exactly one level below
  // the package root, so `../drizzle` resolves identically from either.
  return fileURLToPath(new URL('../drizzle', import.meta.url));
}

/**
 * Apply all pending migrations (idempotent — Drizzle's own
 * `__drizzle_migrations` bookkeeping table stands in for DD-003's
 * `schema_migrations`; a second run applies zero migrations).
 */
export function runMigrations(db: BetterSQLite3Database): void {
  migrate(db, { migrationsFolder: resolveMigrationsFolder() });
}

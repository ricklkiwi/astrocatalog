import { defineConfig } from 'vitest/config';

/**
 * Intentionally-empty local config. Without it, this package's
 * `vitest run --dir src` (the `pnpm -r test` path) walks up to the root
 * `vitest.config.ts` and loads its `test.projects`, whose per-project
 * `include` globs don't resolve under `--dir src` — zero tests found.
 * A local config stops the upward lookup; Vitest defaults + `--dir src`
 * then match this package's tests exactly as before the #45 migration.
 */
export default defineConfig({});

import { defineConfig } from 'vitest/config';

import { testModulePathPlugin } from './vitest-worker-module-path-plugin.js';

/**
 * Local config. Without it, this package's `vitest run --dir src` (the
 * `pnpm -r test` path) walks up to the root `vitest.config.ts` and loads its
 * `test.projects`, whose per-project `include` globs don't resolve under
 * `--dir src` — zero tests found. A local config stops the upward lookup;
 * Vitest defaults + `--dir src` then match this package's tests exactly as
 * before the #45 migration.
 *
 * `testModulePathPlugin` is required so `pool.ts`'s `./worker-entry
 * ?modulePath` import (electron-vite's real, `apply: 'build'`-only
 * mechanism — plan Default 7) resolves under plain `vitest` too, letting
 * `pool.test.ts` spin up a genuine `worker_threads` instance running the
 * real `worker-entry.ts`.
 */
export default defineConfig({
  plugins: [testModulePathPlugin()],
});

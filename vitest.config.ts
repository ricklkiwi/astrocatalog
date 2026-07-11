import { defineConfig } from 'vitest/config';

import { testModulePathPlugin } from './packages/desktop/vitest-worker-module-path-plugin.js';

/**
 * Root Vitest config (replaces the deprecated `vitest.workspace.ts`, #45) so a
 * root-level `vitest run` executes each package's tests consistently under
 * `test.projects`. `pnpm -r test` still runs each package's own
 * `vitest run --dir src` in dependency order.
 *
 * Note: `desktop` scopes to its own `src/` so it never picks up the nested
 * `renderer` workspace member's tests.
 *
 * `desktop`'s `plugins` mirrors `packages/desktop/vitest.config.ts` (P0-05):
 * this project entry is an inline object, not a file-path reference, so it
 * does NOT automatically pick up that package-local config — the
 * `?modulePath` stand-in plugin (see that file's header) must be listed here
 * too, or `pool.ts`'s static `./worker-entry?modulePath` import fails to
 * resolve under the root-level `vitest run` (`pnpm test`, CI's `Test` step).
 */
export default defineConfig({
  test: {
    projects: [
      { test: { name: 'core', root: './packages/core', include: ['src/**/*.test.ts'] } },
      { test: { name: 'db', root: './packages/db', include: ['src/**/*.test.ts'] } },
      {
        plugins: [testModulePathPlugin()],
        test: { name: 'desktop', root: './packages/desktop', include: ['src/**/*.test.ts'] },
      },
      './packages/desktop/renderer/vitest.config.ts',
      { test: { name: 'fixtures', root: './fixtures', include: ['src/**/*.test.ts'] } },
    ],
  },
});

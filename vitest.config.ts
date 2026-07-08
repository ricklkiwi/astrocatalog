import { defineConfig } from 'vitest/config';

/**
 * Root Vitest config (replaces the deprecated `vitest.workspace.ts`, #45) so a
 * root-level `vitest run` executes each package's tests consistently under
 * `test.projects`. `pnpm -r test` still runs each package's own
 * `vitest run --dir src` in dependency order.
 *
 * Note: `desktop` scopes to its own `src/` so it never picks up the nested
 * `renderer` workspace member's tests.
 */
export default defineConfig({
  test: {
    projects: [
      { test: { name: 'core', root: './packages/core', include: ['src/**/*.test.ts'] } },
      { test: { name: 'db', root: './packages/db', include: ['src/**/*.test.ts'] } },
      { test: { name: 'desktop', root: './packages/desktop', include: ['src/**/*.test.ts'] } },
      './packages/desktop/renderer/vitest.config.ts',
      { test: { name: 'fixtures', root: './fixtures', include: ['src/**/*.test.ts'] } },
    ],
  },
});

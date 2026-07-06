import { defineWorkspace } from 'vitest/config';

/**
 * Root Vitest workspace so a root-level `vitest` invocation resolves each
 * package's tests consistently. `pnpm -r test` still runs each package's own
 * `vitest run --dir src` in dependency order.
 *
 * Note: `desktop` scopes to its own `src/` so it never picks up the nested
 * `renderer` workspace member's tests.
 */
export default defineWorkspace([
  { test: { name: 'core', root: './packages/core', include: ['src/**/*.test.ts'] } },
  { test: { name: 'db', root: './packages/db', include: ['src/**/*.test.ts'] } },
  { test: { name: 'desktop', root: './packages/desktop', include: ['src/**/*.test.ts'] } },
  { test: { name: 'renderer', root: './packages/desktop/renderer', include: ['src/**/*.test.ts'] } },
]);

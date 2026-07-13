import { defineConfig } from 'vitest/config';

/**
 * Local config stops the upward project-config lookup (same reason as
 * `packages/db/vitest.config.ts`, #45): without it, `vitest run --dir src`
 * (the `pnpm -r test` path) walks up to the root `vitest.config.ts` and
 * loads its `test.projects`, whose per-project `include` globs don't resolve
 * under `--dir src`.
 *
 * `test.benchmark.include` scopes `vitest bench` (invoked by `src/run.ts`,
 * the `pnpm bench` entry point) to this package's `*.bench.ts` files.
 */
export default defineConfig({
  test: {
    // Step 2 lands this package before any *.test.ts file exists (Step 3
    // adds the first one); without this, `vitest run --dir src` exits
    // non-zero on "no test files found" and breaks `pnpm -r test` at every
    // intermediate step.
    passWithNoTests: true,
    benchmark: {
      include: ['src/**/*.bench.ts'],
    },
  },
});

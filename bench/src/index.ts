/**
 * `@astrotracker/bench` (P0-07) — dev-tooling workspace member, not an app
 * package. There is no runtime consumer of this module (`bench/tsconfig.json`
 * sets `noEmit: true`); it exists so the package has a real TypeScript
 * source file immediately after workspace wiring (Step 2 of
 * docs/plans/p0-07-benchmark-harness.md), before the seed builder and
 * `*.bench.ts` files land in later steps. See `bench/README.md` for what
 * this package measures and how `pnpm bench` works.
 */
export const benchPackageName = '@astrotracker/bench';

/**
 * Public entry point of `@astrotracker/fixtures` (P0-07 Step 1).
 *
 * Re-exports the pure, deterministic, already-seeded in-memory generator
 * (`generateFrames`) so workspace packages other than the CLI (namely
 * `bench/`) can call it directly instead of shelling out to
 * `src/generate.ts`'s CLI or duplicating generator logic.
 *
 * This is additive only: `src/generate.ts`'s CLI entry (`main()`/`run()`) is
 * unchanged, and nothing here re-exports fs/CLI-only surface (`run`,
 * `assertUsableOutDir`, `parseArgs`) — those stay CLI-internal.
 */
export {
  generateFrames,
  type GenerateOptions,
  type GeneratedFrame,
  type WeightedEntry,
  type ProfileName,
} from './generate.js';
export { BLOCK_BYTES, CARD_BYTES } from './lib/fits.js';

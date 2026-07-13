/**
 * Bulk DB insert-rate benchmark (P0-07 Step 4). Times `@astrotracker/db`
 * write throughput for a 100k-frame synthetic dataset that is generated
 * once, in memory, at module load — before any `bench()` timing begins —
 * via `generateBenchFrames()`, so `generateFrames()`'s own synthesis cost
 * never enters a timed sample. The timed function itself calls only
 * `insertGeneratedFrames()`, which does exactly what a future DD-004
 * scanning-pipeline caller would: `repos.files.insert()`/
 * `repos.frames.insert()` inside `db.transaction()`, chunked per Step 3 — no
 * new repository method is added anywhere in this file.
 *
 * Repeated-call note: tinybench calls a benchmark's function once per
 * "cycle" (warmup, then run) as an unrecorded sync/async detection probe,
 * in addition to the recorded `iterations` samples — so this function is
 * invoked more times than `iterations` against the same `SeedContext`.
 * `insertGeneratedFrames()`'s `relativePathPrefix` parameter keeps every
 * call's rows distinct so none collide with
 * `files_watch_folder_relative_path_uq`; later samples measure insert
 * throughput as the table grows, which is at least as representative of a
 * real, growing catalog as always inserting into an empty one.
 */
import { bench, describe } from 'vitest';

import { BENCH_FRAME_COUNT, BENCH_SEED } from './benchmarks.js';
import {
  cleanupSeed,
  createSeedContext,
  generateBenchFrames,
  insertGeneratedFrames,
  type SeedContext,
} from './lib/seed-db.js';

// Pure, in-memory, generated exactly once — excluded from every timed sample.
const frames = generateBenchFrames({ count: BENCH_FRAME_COUNT, seed: BENCH_SEED });

describe('db-insert', () => {
  let ctx: SeedContext | undefined;
  let callIndex = 0;

  bench(
    'db-insert-100k-files-frames-rows-per-sec',
    () => {
      if (!ctx) throw new Error('db-insert bench: setup() did not run before the timed fn');
      callIndex += 1;
      insertGeneratedFrames(ctx, frames, `call${callIndex}-`);
    },
    {
      // Heavy, IO-bound macro-benchmark: a 100k-frame (200k-row) insert
      // takes far longer than tinybench's default 500ms time budget, so a
      // small explicit `iterations` count (not the default 10) bounds total
      // CI wall-clock cost while still giving 3 samples to reduce variance
      // (plan Edge Case: CI runner noise near the 20% regression boundary).
      iterations: 3,
      warmupIterations: 0,
      warmupTime: 0,
      // Bench-level hooks (tinybench "Options.setup/teardown"): called once
      // per cycle (before/after warmup, and again before/after run), never
      // per sample — this is what keeps DB-context creation/teardown out of
      // every individual timed insert sample.
      setup: () => {
        ctx = createSeedContext();
      },
      teardown: () => {
        if (ctx) {
          cleanupSeed(ctx);
          ctx = undefined;
        }
      },
    },
  );
});

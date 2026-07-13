/**
 * Small-N smoke test for the seed builder (P0-07 Step 3) — not a benchmark.
 * Asserts row counts, FK integrity, and `frameTypeSource`, plus a passing
 * UUIDv7-monotonicity assertion across this test's insert burst (plan Edge
 * Case: the highest-volume exercise of P0-04's UUIDv7 generator to date;
 * informational, not expected to fail, but asserted rather than hoped for).
 */
import { isUuid } from '@astrotracker/core';
import { afterEach, describe, expect, it } from 'vitest';

import {
  BENCH_FILTERS,
  BENCH_TARGETS,
  cleanupSeed,
  seedDatabase,
  type SeedResult,
} from './seed-db.js';

const SMOKE_N = 500;

let result: SeedResult | undefined;

afterEach(() => {
  if (result) {
    cleanupSeed(result);
    result = undefined;
  }
});

describe('seedDatabase', () => {
  it('inserts exactly N files/frames rows and seeds the full lookup pool', () => {
    result = seedDatabase({ count: SMOKE_N, seed: 42 });
    const { db } = result;

    expect(result.frames).toHaveLength(SMOKE_N);
    expect(db.repos.files.list()).toHaveLength(SMOKE_N);
    expect(db.repos.frames.list()).toHaveLength(SMOKE_N);
    expect(db.repos.targets.list()).toHaveLength(BENCH_TARGETS.length);
    expect(db.repos.filters.list()).toHaveLength(BENCH_FILTERS.length);
    expect(db.repos.watchFolders.list()).toHaveLength(1);
  });

  it('never leaves an orphan targetId/filterId foreign key', () => {
    result = seedDatabase({ count: SMOKE_N, seed: 7 });
    const { db } = result;
    const targetIds = new Set(db.repos.targets.list().map((t) => t.id));
    const filterIds = new Set(db.repos.filters.list().map((f) => f.id));

    for (const frame of db.repos.frames.list()) {
      if (frame.targetId !== null) expect(targetIds.has(frame.targetId)).toBe(true);
      if (frame.filterId !== null) expect(filterIds.has(frame.filterId)).toBe(true);
    }
  });

  it('stamps frameTypeSource as "header" on every inserted frame row', () => {
    result = seedDatabase({ count: SMOKE_N, seed: 3 });
    const frames = result.db.repos.frames.list();
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) {
      expect(frame.frameTypeSource).toBe('header');
    }
  });

  it('produces valid, strictly increasing UUIDv7 ids across the insert burst', () => {
    result = seedDatabase({ count: SMOKE_N, seed: 99 });
    const files = result.db.repos.files.list();
    // better-sqlite3 `list()` has no ORDER BY guarantee beyond rowid
    // insertion order here, which matches insert order for this table.
    const ids = files.map((f) => f.id);
    for (const id of ids) expect(isUuid(id)).toBe(true);
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i]! > ids[i - 1]!).toBe(true);
    }
  });
});

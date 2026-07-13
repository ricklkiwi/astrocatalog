/**
 * Deterministic synthetic-dataset DB seed builder shared by the insert-rate
 * and aggregate-query benchmarks (P0-07 Step 3).
 *
 * Opens a temp-file `AstroDatabase` (never inside the repo — cleaned up via
 * `cleanupSeed`), seeds `watch_folders` + a bench-specific `targets`/
 * `filters` lookup-table pool (dozens of weighted entries, not
 * `generate.ts`'s 3-object CLI default, so the aggregate-query benchmark
 * exercises realistic index cardinality), then inserts one `files` + one
 * `frames` row per synthetic frame from `@astrotracker/fixtures`'s
 * `generateFrames()`.
 *
 * `createSeedContext()`/`insertGeneratedFrames()` are split apart so
 * `db-insert.bench.ts` (Step 4) can time only the insert loop, with
 * `generateFrames()`'s synthesis cost and the lookup-table setup excluded
 * from the timed region. `seedDatabase()` is the convenience wrapper used by
 * callers (the aggregate-query benchmark, the smoke test below) that want a
 * fully-seeded DB in one call and don't care about isolating insert timing.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openDatabase, type AstroDatabase, type Frame } from '@astrotracker/db';
import { generateFrames, type GeneratedFrame, type WeightedEntry } from '@astrotracker/fixtures';

/**
 * Rows are inserted in fixed-size sub-transactions — a documented
 * throughput/memory tradeoff (plan Edge Cases): one 200k-statement
 * transaction risks WAL growth/memory pressure and produces a single
 * unrepresentative number; one transaction per row defeats the point of
 * "bulk" (autocommit overhead dominates).
 */
export const INSERT_CHUNK_SIZE = 1000;

/** SQLite filename inside each seed's temp directory (see `SeedContext.filePath`). */
export const SEED_DB_FILENAME = 'bench.sqlite';

/**
 * Bench-specific target-name pool: dozens of real object designations (not
 * `generate.ts`'s 3-object CLI default) with a rough power-law weighting so
 * the `frames(target_id, filter_id, frame_type)` index sees realistic
 * selectivity rather than a degenerate 3-bucket case.
 */
export const BENCH_TARGETS: readonly WeightedEntry[] = [
  'M 31',
  'M 42',
  'M 51',
  'M 81',
  'M 101',
  'M 106',
  'M 33',
  'M 45',
  'M 27',
  'M 57',
  'M 1',
  'M 63',
  'M 64',
  'M 65',
  'M 66',
  'M 82',
  'M 97',
  'M 104',
  'NGC 7000',
  'NGC 6992',
  'NGC 891',
  'NGC 2237',
  'NGC 281',
  'NGC 6946',
  'NGC 2244',
  'NGC 6960',
  'NGC 6888',
  'NGC 7635',
  'NGC 1499',
  'NGC 3372',
  'NGC 5139',
  'NGC 4565',
  'IC 1396',
  'IC 5070',
  'IC 434',
  'Sh2-101',
  'Sh2-132',
  'LDN 1235',
  'vdB 152',
  'Abell 21',
].map((name, index) => ({ name, weight: 1 / (index + 1) }));

/** Bench-specific filter pool — a handful of realistic broadband + narrowband names. */
export const BENCH_FILTERS: readonly WeightedEntry[] = [
  { name: 'L', weight: 5 },
  { name: 'R', weight: 2 },
  { name: 'G', weight: 2 },
  { name: 'B', weight: 2 },
  { name: 'Ha', weight: 4 },
  { name: 'OIII', weight: 3 },
  { name: 'SII', weight: 3 },
  { name: 'none', weight: 1 },
];

const BENCH_EXPTIMES = [30, 60, 120, 180, 300, 600];
const BENCH_IMAGETYPES: readonly WeightedEntry[] = [
  { name: 'LIGHT', weight: 0.8 },
  { name: 'DARK', weight: 0.08 },
  { name: 'FLAT', weight: 0.08 },
  { name: 'BIAS', weight: 0.04 },
];

/** DD-004 classification order's header half: IMAGETYP -> DD-003 frame_type. */
const FRAME_TYPE_BY_IMAGETYP: Record<string, Frame['frameType']> = {
  LIGHT: 'light',
  DARK: 'dark',
  FLAT: 'flat',
  BIAS: 'bias',
  DARKFLAT: 'darkflat',
};

export interface SeedContext {
  db: AstroDatabase;
  /** Temp directory holding the SQLite file (never inside the repo). */
  dir: string;
  /** Full path to the SQLite file — `join(dir, SEED_DB_FILENAME)`. */
  filePath: string;
  watchFolderId: string;
  targetIdByName: ReadonlyMap<string, string>;
  filterIdByName: ReadonlyMap<string, string>;
}

/**
 * Opens a fresh temp-file `AstroDatabase` and seeds `watch_folders` plus the
 * bench target/filter lookup tables (untimed setup — callers that need to
 * time only the frame insert loop call this before starting their timer).
 */
export function createSeedContext(): SeedContext {
  const dir = mkdtempSync(join(tmpdir(), 'astrotracker-bench-'));
  const filePath = join(dir, SEED_DB_FILENAME);
  const db = openDatabase({ filePath });

  const watchFolder = db.repos.watchFolders.insert({
    path: dir,
    driveLabel: 'bench-synthetic',
    isActive: true,
  });

  const targetIdByName = new Map<string, string>();
  for (const entry of BENCH_TARGETS) {
    const row = db.repos.targets.insert({
      canonicalName: entry.name,
      status: 'capturing',
    });
    targetIdByName.set(entry.name, row.id);
  }

  const filterIdByName = new Map<string, string>();
  for (const entry of BENCH_FILTERS) {
    const row = db.repos.filters.insert({
      rawName: entry.name,
      canonicalName: entry.name,
    });
    filterIdByName.set(entry.name, row.id);
  }

  return { db, dir, filePath, watchFolderId: watchFolder.id, targetIdByName, filterIdByName };
}

/**
 * Inserts one `files` + one `frames` row per `frames` entry into `ctx`, in
 * `INSERT_CHUNK_SIZE`-row sub-transactions via `db.transaction()` +
 * `repos.files.insert()`/`repos.frames.insert()` — the exact public surface
 * a future scanning-pipeline (DD-004) caller would use; no new repository
 * method is added. Returns the number of rows inserted (files + frames
 * combined) for rows/sec reporting.
 *
 * `relativePathPrefix` disambiguates repeated calls against the same `ctx`
 * (`files_watch_folder_relative_path_uq` is a unique index on
 * `(watch_folder_id, relative_path)`) — `db-insert.bench.ts` calls this once
 * per tinybench invocation of its benchmark function, including an
 * unrecorded probe call tinybench issues before the first timed sample, so a
 * fixed `frame.fileName` would collide on the second call.
 */
export function insertGeneratedFrames(
  ctx: SeedContext,
  frames: readonly GeneratedFrame[],
  relativePathPrefix = '',
): number {
  let rowsInserted = 0;
  for (let start = 0; start < frames.length; start += INSERT_CHUNK_SIZE) {
    const chunk = frames.slice(start, start + INSERT_CHUNK_SIZE);
    ctx.db.transaction((repos) => {
      for (const frame of chunk) {
        const dateObsUtc = new Date(`${frame.dateObs}Z`);
        const fileRow = repos.files.insert({
          watchFolderId: ctx.watchFolderId,
          relativePath: `${relativePathPrefix}${frame.fileName}`,
          filename: frame.fileName,
          extension: '.fits',
          sizeBytes: frame.bytes.length,
          fileMtime: dateObsUtc,
          firstSeenAt: dateObsUtc,
          lastSeenAt: dateObsUtc,
          status: 'present',
        });
        repos.frames.insert({
          fileId: fileRow.id,
          frameType: FRAME_TYPE_BY_IMAGETYP[frame.imagetype] ?? 'unknown',
          frameTypeSource: 'header',
          objectRaw: frame.object,
          targetId: ctx.targetIdByName.get(frame.object) ?? null,
          filterRaw: frame.filter,
          filterId: ctx.filterIdByName.get(frame.filter) ?? null,
          exposureSeconds: frame.exptime,
          dateObsUtc,
          // Stand-in for a real parsed header (no parsing occurs here — see
          // bench/src/header-scan.bench.ts for the boundary-detection
          // benchmark). Opaque JSON storage as far as the DB layer is
          // concerned (DD-003 `headers_json`).
          headersJson: JSON.stringify({
            IMAGETYP: frame.imagetype,
            OBJECT: frame.object,
            FILTER: frame.filter,
            EXPTIME: frame.exptime,
            'DATE-OBS': frame.dateObs,
          }),
        });
        rowsInserted += 2;
      }
    });
  }
  return rowsInserted;
}

export interface SeedOptions {
  count: number;
  seed?: number;
}

export interface SeedResult {
  db: AstroDatabase;
  dir: string;
  filePath: string;
  frames: GeneratedFrame[];
}

/**
 * Calls `generateFrames()` with the bench-specific target/filter/exptime/
 * imagetype pools — the pure, in-memory synthesis step shared by
 * `seedDatabase()` and by `db-insert.bench.ts`/`aggregate-query.bench.ts`,
 * which call this directly so their own "already generated in memory before
 * timing starts" dataset is built with the exact same distribution
 * `seedDatabase()` uses.
 */
export function generateBenchFrames(opts: SeedOptions): GeneratedFrame[] {
  const { frames } = generateFrames({
    count: opts.count,
    // Unused by generateFrames (pure, in-memory) — only `run()`'s CLI writer
    // touches `out`. Never written to.
    out: 'unused-generateFrames-is-pure-in-memory',
    seed: opts.seed ?? 1,
    profile: 'nina',
    objects: [...BENCH_TARGETS],
    filters: [...BENCH_FILTERS],
    exptimes: BENCH_EXPTIMES,
    imagetypes: [...BENCH_IMAGETYPES],
    dateStart: '2026-01-01',
    nights: Math.max(1, Math.ceil(opts.count / 200)),
  });
  return frames;
}

/** Full build: fresh context + `generateBenchFrames()` + chunked insert, in one call. */
export function seedDatabase(opts: SeedOptions): SeedResult {
  const ctx = createSeedContext();
  const frames = generateBenchFrames(opts);
  insertGeneratedFrames(ctx, frames);
  return { db: ctx.db, dir: ctx.dir, filePath: ctx.filePath, frames };
}

/** Closes the DB connection and removes its temp directory. */
export function cleanupSeed(result: { db: AstroDatabase; dir: string }): void {
  result.db.close();
  rmSync(result.dir, { recursive: true, force: true });
}

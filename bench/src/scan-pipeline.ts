/**
 * DD-004 "10k-file stages 1-3" scan benchmark (P1-07 acceptance criterion 3).
 *
 * Drives the REAL scanning pipeline end-to-end over a synthetic library:
 *   - Stage 1 (discovery walk) + Stages 2-3 (header parse + classify) are the
 *     actual production worker function `runScanJob` from `@astrotracker/desktop`.
 *   - Persistence is the real `@astrotracker/db` repositories
 *     (`files.upsertDiscovered` / `files.recordParseError` /
 *     `frames.upsertByFileId`) against a real temp-file SQLite database.
 *
 * Why `runScanJob` is imported by relative source path rather than from the
 * `@astrotracker/desktop` package entry: the desktop package only exports its
 * electron-vite main bundle (`out/main/index.js`), which pulls in Electron and
 * isn't importable as plain Node modules. `scan-job.ts` itself, however, is
 * pure — it imports only `node:fs` and `@astrotracker/core` (no Electron, no
 * `worker_threads`, no `pool.ts`/`worker-entry?modulePath`), so importing it
 * directly runs the genuine Stage-1-3 code under plain `tsx`/`tsc`. Reusing
 * `createJobQueueOrchestrator` instead would drag in `pool.ts`'s
 * electron-vite-only `./worker-entry?modulePath` import, which bench's
 * toolchain can't resolve; so the ~30-line batch-persist glue that normally
 * lives in the orchestrator's `processDiscoveredBatch` is replicated at this
 * call site below (see `persistBatch`/`toFrameRow`), which is the only part of
 * the pipeline that isn't shared production code.
 *
 * Records wall-clock elapsed time as a `files/sec` `BenchMetric`. The absolute
 * time budget is enforced by `run.ts` (an absolute floor, not just the
 * baseline-relative gate) — see `scanPipelineBudgetMs`.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import type { ParsedFrame } from '@astrotracker/core';
import { openDatabase, type NewFrame, type Repositories } from '@astrotracker/db';
import { corruptFitsBytes, selectCorruptIndices } from '@astrotracker/fixtures';

import type { BenchMetric } from './benchmarks.js';
import { generateBenchFrames } from './lib/seed-db.js';
// Pure production Stage-1-3 worker function + its message types. Imported by
// relative source path — see the module header for why this can't come from
// the `@astrotracker/desktop` package entry.
import type { JobContext } from '../../packages/desktop/src/main/jobs/job-context.js';
import type { DiscoveredFile } from '../../packages/desktop/src/main/jobs/protocol.js';
import { runScanJob } from '../../packages/desktop/src/main/jobs/scan-job.js';

export const SCAN_PIPELINE_METRIC_NAME = 'scan-pipeline-stages-1-3-files-per-sec';

/** DD-004 / PRD §8.4 synthetic library size. */
export const SCAN_BENCH_FILE_COUNT = 10_000;
/** ~1% malformed, exercising acceptance criterion 2 (logged + skipped) at scale. */
export const SCAN_BENCH_CORRUPT_COUNT = 100;
export const SCAN_BENCH_SEED = 1;

/** PRD §8.4 reference-hardware target: 10k files scanned (stages 1-3) in < 5 min. */
export const SCAN_PIPELINE_BASE_BUDGET_MS = 300_000;
/**
 * CI budget multiplier. GitHub Actions `ubuntu-latest` runners are shared,
 * slower, and far more variable than a "reference hardware" dev machine
 * (see bench/README.md's note on CI hardware variance), and this run is
 * fs-write- and SQLite-heavy rather than CPU-bound, so a single slow runner
 * can easily be 2x a warm local run. 3x buys generous headroom above that so
 * the gate only trips on a genuine multi-minute regression, not runner noise,
 * while still holding the wall-clock to a hard ceiling (15 min) that fails the
 * build (DD-004 "regression fails the build").
 */
export const SCAN_PIPELINE_CI_BUDGET_MULTIPLIER = 3;

/** Absolute wall-clock budget in ms, widened on CI. */
export function scanPipelineBudgetMs(env: NodeJS.ProcessEnv = process.env): number {
  return env['CI'] !== undefined
    ? SCAN_PIPELINE_BASE_BUDGET_MS * SCAN_PIPELINE_CI_BUDGET_MULTIPLIER
    : SCAN_PIPELINE_BASE_BUDGET_MS;
}

/** The budget expressed as a minimum acceptable files/sec throughput floor. */
export function scanPipelineMinFilesPerSec(
  fileCount = SCAN_BENCH_FILE_COUNT,
  env: NodeJS.ProcessEnv = process.env,
): number {
  return fileCount / (scanPipelineBudgetMs(env) / 1000);
}

export interface ScanPipelineResult {
  metric: BenchMetric;
  elapsedMs: number;
  filesCount: number;
  framesCount: number;
  erroredCount: number;
}

export interface ScanPipelineOptions {
  fileCount?: number;
  corruptCount?: number;
  seed?: number;
}

/**
 * Parse a `FrameMetadata.dateObs` string to a UTC `Date`, or `null`.
 * Replicated from the orchestrator's `parseDateObs` (see module header).
 */
function parseDateObs(dateObs: string | null): Date | null {
  if (dateObs === null) {
    return null;
  }
  const ms = Date.parse(dateObs);
  return Number.isNaN(ms) ? null : new Date(ms);
}

/**
 * Map a worker-parsed {@link ParsedFrame} onto a `frames` insert row.
 * Replicated verbatim from `orchestrator.ts`'s `toFrameRow` (see module
 * header) — the only orchestrator logic this benchmark reimplements.
 */
function toFrameRow(fileId: string, parsed: ParsedFrame): NewFrame {
  const m = parsed.metadata;
  return {
    fileId,
    frameType: parsed.frameType,
    frameTypeSource: parsed.frameTypeSource,
    objectRaw: m.object,
    filterRaw: m.filter,
    exposureSeconds: m.exposureSeconds,
    dateObsUtc: parseDateObs(m.dateObs),
    telescopeRaw: m.telescope,
    cameraRaw: m.instrument,
    ccdTemp: m.ccdTempCelsius,
    setTemp: m.setTempCelsius,
    gain: m.gain,
    offset: m.offset,
    binningX: m.binningX,
    binningY: m.binningY,
    widthPx: m.widthPixels,
    heightPx: m.heightPixels,
    raDeg: m.raDegrees,
    decDeg: m.decDegrees,
    focalLength: m.focalLengthMm,
    aperture: m.apertureDiameterMm,
    pierSide: m.pierSide,
    airmass: m.airmass,
    observer: m.observer,
    siteName: m.siteName,
    bayerPattern: m.bayerPattern,
    headersJson: JSON.stringify(m.headers),
  };
}

/**
 * Persist one discovered-file batch (DD-004 Stages 1-3). Replicates
 * `orchestrator.ts`'s `processDiscoveredBatch` for the benchmark call site:
 * upsert the `files` row, then write the `frames` row (parse ok) or record the
 * `parse_error` (parse failed) — a bad file never aborts the batch. Runs in one
 * transaction, mirroring production's single-writer batching.
 */
function persistBatch(
  repos: Repositories,
  watchFolderId: string,
  seenAt: Date,
  discovered: DiscoveredFile[],
): void {
  for (const file of discovered) {
    const upsert = repos.files.upsertDiscovered(
      {
        watchFolderId,
        relativePath: file.relativePath,
        filename: file.filename,
        extension: file.extension,
        sizeBytes: file.sizeBytes,
        fileMtime: file.fileMtimeMs === null ? null : new Date(file.fileMtimeMs),
      },
      seenAt,
    );
    const fileId = upsert.file.id;
    if (file.parseError !== undefined) {
      repos.files.recordParseError(fileId, file.parseError);
    } else if (file.parsed !== undefined) {
      repos.frames.upsertByFileId(toFrameRow(fileId, file.parsed));
      repos.files.recordParseError(fileId, null);
    }
  }
}

/**
 * Generate an `fileCount`-file synthetic FITS library (with `corruptCount`
 * malformed files interleaved) in a scratch temp directory, then drive the
 * real Stage-1-3 pipeline over it against a real temp-file SQLite DB, timing
 * only the scan (fixture generation is untimed setup). Verifies the
 * scan-summary row counts as a correctness sanity check, and returns the
 * throughput metric plus counts. The scratch directory (files + DB) is always
 * removed afterward — nothing is written into the repo.
 */
export async function runScanPipelineBenchmark(
  options: ScanPipelineOptions = {},
): Promise<ScanPipelineResult> {
  const fileCount = options.fileCount ?? SCAN_BENCH_FILE_COUNT;
  const corruptCount = options.corruptCount ?? SCAN_BENCH_CORRUPT_COUNT;
  const seed = options.seed ?? SCAN_BENCH_SEED;

  const dir = mkdtempSync(join(tmpdir(), 'astrotracker-scan-bench-'));
  try {
    // --- Untimed fixture setup: write N well-formed FITS files, corrupt a subset. ---
    const frames = generateBenchFrames({ count: fileCount, seed });
    const corruptIndices = new Set(selectCorruptIndices(frames.length, corruptCount));
    for (let i = 0; i < frames.length; i += 1) {
      const frame = frames[i]!;
      const bytes = corruptIndices.has(i) ? corruptFitsBytes(frame.bytes) : frame.bytes;
      writeFileSync(join(dir, frame.fileName), bytes);
    }
    const expectedErrored = corruptIndices.size;

    const db = openDatabase({ filePath: join(dir, 'scan-bench.sqlite') });
    try {
      const watchFolderId = db.repos.watchFolders.insert({
        path: dir,
        driveLabel: 'scan-bench',
        isActive: true,
      }).id;

      // One cutoff for the whole run, mirroring the orchestrator's job.startedAt.
      const seenAt = new Date();
      const ctx: JobContext = {
        reportProgress: () => undefined,
        // Persist each batch as it arrives (streaming, bounded memory) — exactly
        // how the production orchestrator consumes onDiscovered. Batch writes go
        // through one transaction, matching processDiscoveredBatch.
        reportDiscovered: (batch: DiscoveredFile[]) => {
          db.transaction((repos) => {
            persistBatch(repos, watchFolderId, seenAt, batch);
          });
        },
        isCancelled: () => false,
      };

      const start = performance.now();
      await runScanJob({ watchFolderId, rootPath: dir, extensions: ['fits'] }, ctx);
      const elapsedMs = performance.now() - start;

      // Correctness sanity check alongside timing (no second rescan; small-scale
      // idempotency is proven in parse-pipeline.test.ts): every file row exists,
      // every well-formed file produced a frame, and every corrupted file is
      // surfaced as a parse error in the scan summary.
      const allFiles = db.repos.files.list();
      const filesCount = allFiles.length;
      const erroredCount = allFiles.filter((f) => f.parseError !== null).length;
      const framesCount = db.repos.frames.list().length;

      assertCount('files indexed', filesCount, fileCount);
      assertCount('parse errors surfaced', erroredCount, expectedErrored);
      assertCount('frames written', framesCount, fileCount - expectedErrored);

      const value = fileCount / (elapsedMs / 1000);
      const metric: BenchMetric = {
        name: SCAN_PIPELINE_METRIC_NAME,
        unit: 'files/sec',
        value,
        higherIsBetter: true,
        samples: [value],
      };
      return { metric, elapsedMs, filesCount, framesCount, erroredCount };
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function assertCount(what: string, actual: number, expected: number): void {
  if (actual !== expected) {
    throw new Error(
      `scan-pipeline benchmark correctness check failed: ${what} = ${actual}, expected ${expected}`,
    );
  }
}

/**
 * A benchmark whose result is gated against an absolute wall-clock budget
 * (not just the baseline-relative regression gate). `floor` is the minimum
 * acceptable value of `metric` — `run.ts` fails the build when
 * `metric.value < floor`.
 */
export interface AbsoluteBudgetResult {
  metric: BenchMetric;
  floor: number;
  budgetMs: number;
  elapsedMs: number;
  label: string;
}

/** Run the 10k-file scan benchmark and attach its absolute time budget. */
export async function runScanPipelineBudget(): Promise<AbsoluteBudgetResult> {
  const result = await runScanPipelineBenchmark();
  return {
    metric: result.metric,
    floor: scanPipelineMinFilesPerSec(),
    budgetMs: scanPipelineBudgetMs(),
    elapsedMs: result.elapsedMs,
    label: `${SCAN_BENCH_FILE_COUNT}-file scan (stages 1-3), ${result.erroredCount} malformed`,
  };
}

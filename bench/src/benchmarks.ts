import { performance } from 'node:perf_hooks';

import Database from 'better-sqlite3';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { BLOCK_BYTES, CARD_BYTES, type GeneratedFrame } from '@astrotracker/fixtures';

import {
  cleanupSeed,
  createSeedContext,
  generateBenchFrames,
  insertGeneratedFrames,
  seedDatabase,
} from './lib/seed-db.js';

export interface BenchMetric {
  name: string;
  unit: 'rows/sec' | 'queries/sec' | 'headers/sec';
  value: number;
  higherIsBetter: true;
  samples: number[];
}

export const BENCH_FRAME_COUNT = 100_000;
export const BENCH_SEED = 1;
export const BENCH_INSERT_SAMPLES = 1;
export const BENCH_QUERY_SAMPLES = 3;
export const BENCH_HEADER_SAMPLES = 3;
export const BENCH_AGGREGATE_QUERY_REPEATS = 50;
export const BENCH_HEADER_SCAN_REPEATS = 1_000;
export const BENCH_HEADER_SCAN_FRAME_COUNT = 500;

function measureRate(unitCount: number, fn: () => void): number {
  const start = performance.now();
  fn();
  const elapsedSeconds = (performance.now() - start) / 1000;
  return unitCount / elapsedSeconds;
}

function mean(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function makeMetric(
  name: BenchMetric['name'],
  unit: BenchMetric['unit'],
  samples: number[],
): BenchMetric {
  return {
    name,
    unit,
    value: mean(samples),
    higherIsBetter: true,
    samples,
  };
}

export function runDbInsertBenchmark(): BenchMetric {
  const frames = generateBenchFrames({ count: BENCH_FRAME_COUNT, seed: BENCH_SEED });
  const samples: number[] = [];

  for (let sample = 0; sample < BENCH_INSERT_SAMPLES; sample += 1) {
    const ctx = createSeedContext();
    try {
      const rate = measureRate(BENCH_FRAME_COUNT * 2, () => {
        insertGeneratedFrames(ctx, frames, `sample${sample}-`);
      });
      samples.push(rate);
    } finally {
      cleanupSeed(ctx);
    }
  }

  return makeMetric('db-insert-100k-files-frames-rows-per-sec', 'rows/sec', samples);
}

function measureStatementRate(execute: () => void): number[] {
  const samples: number[] = [];
  for (let sample = 0; sample < BENCH_QUERY_SAMPLES; sample += 1) {
    samples.push(
      measureRate(BENCH_AGGREGATE_QUERY_REPEATS, () => {
        for (let i = 0; i < BENCH_AGGREGATE_QUERY_REPEATS; i += 1) {
          execute();
        }
      }),
    );
  }
  return samples;
}

export interface AggregateQueryWorkload {
  executeGlobalRollup(): void;
  executeTargetDrilldown(): void;
  cleanup(): void;
}

/** Untimed setup shared by both aggregate query shapes. */
export function createAggregateQueryWorkload(): AggregateQueryWorkload {
  const seed = seedDatabase({ count: BENCH_FRAME_COUNT, seed: BENCH_SEED });
  const connection = new Database(seed.filePath, { readonly: true, fileMustExist: true });
  const queryDb = drizzle(connection);

  try {
    const globalRollup = sql`
      SELECT target_id, filter_id, frame_type, SUM(exposure_seconds) AS exposure_seconds, COUNT(*) AS frame_count
      FROM frames
      WHERE frame_type = 'light'
      GROUP BY target_id, filter_id, frame_type
      ORDER BY exposure_seconds DESC
    `;

    const target = queryDb.get<{ targetId: string }>(sql`
      SELECT target_id AS targetId
      FROM frames
      WHERE frame_type = 'light' AND target_id IS NOT NULL
      GROUP BY target_id
      ORDER BY COUNT(*) DESC
      LIMIT 1
    `);

    if (!target) throw new Error('No target_id found in seeded benchmark frames');

    const drilldown = sql`
      SELECT filter_id, SUM(exposure_seconds) AS exposure_seconds, COUNT(*) AS frame_count
      FROM frames
      WHERE target_id = ${target.targetId} AND frame_type = 'light'
      GROUP BY filter_id
      ORDER BY exposure_seconds DESC
    `;

    const workload: AggregateQueryWorkload = {
      executeGlobalRollup: () => {
        queryDb.all(globalRollup);
      },
      executeTargetDrilldown: () => {
        queryDb.all(drilldown);
      },
      cleanup: () => {
        connection.close();
        cleanupSeed(seed);
      },
    };

    // Warm both statements once before any timed sample.
    workload.executeGlobalRollup();
    workload.executeTargetDrilldown();
    return workload;
  } catch (error) {
    connection.close();
    cleanupSeed(seed);
    throw error;
  }
}

export function measureAggregateQueryWorkload(workload: AggregateQueryWorkload): BenchMetric[] {
  return [
    makeMetric(
      'aggregate-target-filter-type-rollup-queries-per-sec',
      'queries/sec',
      measureStatementRate(workload.executeGlobalRollup),
    ),
    makeMetric(
      'aggregate-single-target-filter-rollup-queries-per-sec',
      'queries/sec',
      measureStatementRate(workload.executeTargetDrilldown),
    ),
  ];
}

export function runAggregateQueryBenchmarks(): BenchMetric[] {
  const workload = createAggregateQueryWorkload();
  try {
    return measureAggregateQueryWorkload(workload);
  } finally {
    workload.cleanup();
  }
}

export function findFitsHeaderEndBlock(buffer: Uint8Array, maxBytes = 512 * 1024): number {
  const limit = Math.min(buffer.length, maxBytes);
  for (let offset = 0; offset + CARD_BYTES <= limit; offset += CARD_BYTES) {
    if (
      Buffer.from(buffer.subarray(offset, offset + 8))
        .toString('ascii')
        .trimEnd() === 'END'
    ) {
      return Math.ceil((offset + CARD_BYTES) / BLOCK_BYTES) * BLOCK_BYTES;
    }
  }
  throw new Error(`FITS END card not found in first ${limit} bytes`);
}

export interface HeaderScanWorkload {
  frames: readonly GeneratedFrame[];
}

/** Pure in-memory setup, intentionally outside every measured scan sample. */
export function createHeaderScanWorkload(): HeaderScanWorkload {
  return {
    frames: generateBenchFrames({ count: BENCH_HEADER_SCAN_FRAME_COUNT, seed: BENCH_SEED }),
  };
}

export function executeHeaderScanWorkload(workload: HeaderScanWorkload): void {
  for (let i = 0; i < BENCH_HEADER_SCAN_REPEATS; i += 1) {
    for (const frame of workload.frames) {
      const endOffset = findFitsHeaderEndBlock(frame.bytes);
      if (endOffset <= 0 || endOffset % BLOCK_BYTES !== 0) {
        throw new Error(`Unexpected FITS header end offset: ${endOffset}`);
      }
    }
  }
}

export function measureHeaderScanWorkload(workload: HeaderScanWorkload): BenchMetric {
  const samples: number[] = [];

  for (let sample = 0; sample < BENCH_HEADER_SAMPLES; sample += 1) {
    samples.push(
      measureRate(BENCH_HEADER_SCAN_REPEATS * workload.frames.length, () =>
        executeHeaderScanWorkload(workload),
      ),
    );
  }

  return makeMetric('fits-header-end-block-scan-headers-per-sec', 'headers/sec', samples);
}

export function runHeaderScanBenchmark(): BenchMetric {
  return measureHeaderScanWorkload(createHeaderScanWorkload());
}

export function runAllBenchmarks(): BenchMetric[] {
  return [runDbInsertBenchmark(), ...runAggregateQueryBenchmarks(), runHeaderScanBenchmark()];
}

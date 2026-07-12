import { performance } from 'node:perf_hooks';

import Database from 'better-sqlite3';

import { BLOCK_BYTES, CARD_BYTES } from '@astrotracker/fixtures';

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

const FRAME_COUNT = 100_000;
const BENCH_SEED = 1;
const INSERT_SAMPLES = 1;
const QUERY_SAMPLES = 3;
const HEADER_SAMPLES = 3;
const AGGREGATE_QUERY_REPEATS = 50;
const HEADER_SCAN_REPEATS = 1_000;
const HEADER_SCAN_FRAME_COUNT = 500;

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
  const frames = generateBenchFrames({ count: FRAME_COUNT, seed: BENCH_SEED });
  const samples: number[] = [];

  for (let sample = 0; sample < INSERT_SAMPLES; sample += 1) {
    const ctx = createSeedContext();
    try {
      const rate = measureRate(FRAME_COUNT * 2, () => {
        insertGeneratedFrames(ctx, frames, `sample${sample}-`);
      });
      samples.push(rate);
    } finally {
      cleanupSeed(ctx);
    }
  }

  return makeMetric('db-insert-100k-files-frames-rows-per-sec', 'rows/sec', samples);
}

function measureStatementRate(
  statement: Database.Statement,
  args: readonly unknown[] = [],
): number[] {
  const samples: number[] = [];
  for (let sample = 0; sample < QUERY_SAMPLES; sample += 1) {
    samples.push(
      measureRate(AGGREGATE_QUERY_REPEATS, () => {
        for (let i = 0; i < AGGREGATE_QUERY_REPEATS; i += 1) {
          statement.all(...args);
        }
      }),
    );
  }
  return samples;
}

export function runAggregateQueryBenchmarks(): BenchMetric[] {
  const seed = seedDatabase({ count: FRAME_COUNT, seed: BENCH_SEED });
  const connection = new Database(seed.filePath, { readonly: true, fileMustExist: true });

  try {
    const globalRollup = connection.prepare(`
      SELECT target_id, filter_id, frame_type, SUM(exposure_seconds) AS exposure_seconds, COUNT(*) AS frame_count
      FROM frames
      WHERE frame_type = 'light'
      GROUP BY target_id, filter_id, frame_type
      ORDER BY exposure_seconds DESC
    `);
    globalRollup.all();

    const target = connection
      .prepare(
        `
          SELECT target_id AS targetId
          FROM frames
          WHERE frame_type = 'light' AND target_id IS NOT NULL
          GROUP BY target_id
          ORDER BY COUNT(*) DESC
          LIMIT 1
        `,
      )
      .get() as { targetId: string } | undefined;

    if (!target) throw new Error('No target_id found in seeded benchmark frames');

    const drilldown = connection.prepare(`
      SELECT filter_id, SUM(exposure_seconds) AS exposure_seconds, COUNT(*) AS frame_count
      FROM frames
      WHERE target_id = ? AND frame_type = 'light'
      GROUP BY filter_id
      ORDER BY exposure_seconds DESC
    `);
    drilldown.all(target.targetId);

    return [
      makeMetric(
        'aggregate-target-filter-type-rollup-queries-per-sec',
        'queries/sec',
        measureStatementRate(globalRollup),
      ),
      makeMetric(
        'aggregate-single-target-filter-rollup-queries-per-sec',
        'queries/sec',
        measureStatementRate(drilldown, [target.targetId]),
      ),
    ];
  } finally {
    connection.close();
    cleanupSeed(seed);
  }
}

export function runAggregateQueryBenchmark(): BenchMetric {
  return runAggregateQueryBenchmarks()[0]!;
}

export function runAggregateTargetDrilldownBenchmark(): BenchMetric {
  return runAggregateQueryBenchmarks()[1]!;
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

export function runHeaderScanBenchmark(): BenchMetric {
  const frames = generateBenchFrames({ count: HEADER_SCAN_FRAME_COUNT, seed: BENCH_SEED });
  const samples: number[] = [];

  for (let sample = 0; sample < HEADER_SAMPLES; sample += 1) {
    samples.push(
      measureRate(HEADER_SCAN_REPEATS * frames.length, () => {
        for (let i = 0; i < HEADER_SCAN_REPEATS; i += 1) {
          for (const frame of frames) {
            const endOffset = findFitsHeaderEndBlock(frame.bytes);
            if (endOffset <= 0 || endOffset % BLOCK_BYTES !== 0) {
              throw new Error(`Unexpected FITS header end offset: ${endOffset}`);
            }
          }
        }
      }),
    );
  }

  return makeMetric('fits-header-end-block-scan-headers-per-sec', 'headers/sec', samples);
}

export function runAllBenchmarks(): BenchMetric[] {
  return [runDbInsertBenchmark(), ...runAggregateQueryBenchmarks(), runHeaderScanBenchmark()];
}

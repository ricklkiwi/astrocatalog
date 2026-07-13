import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runAllBenchmarks } from './benchmarks.js';
import {
  compareResults,
  formatComparisonTable,
  hasRegression,
  parseBaseline,
  REGRESSION_THRESHOLD,
  type BenchBaseline,
} from './compare.js';

const BASELINE_PATH = fileURLToPath(new URL('../baselines/results.json', import.meta.url));

function readBaseline(): BenchBaseline {
  try {
    return parseBaseline(JSON.parse(readFileSync(BASELINE_PATH, 'utf8')));
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Invalid benchmark baseline at ${BASELINE_PATH}: ${detail}`, { cause });
  }
}

function writeBaseline(baseline: BenchBaseline): void {
  mkdirSync(dirname(BASELINE_PATH), { recursive: true });
  writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
}

function main(): void {
  const updateBaseline = process.argv.includes('--update-baseline');

  if (updateBaseline) {
    const results = runAllBenchmarks();
    const baseline = parseBaseline({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      results,
    });
    writeBaseline(baseline);
    console.log(`Updated ${BASELINE_PATH}`);
    return;
  }

  const baseline = readBaseline();
  const results = runAllBenchmarks();
  const comparisons = compareResults(results, baseline);
  console.log(formatComparisonTable(comparisons));

  if (hasRegression(comparisons)) {
    console.error(
      `Benchmark regression exceeds ${(REGRESSION_THRESHOLD * 100).toFixed(0)}% threshold.`,
    );
    process.exitCode = 1;
  }
}

try {
  main();
} catch (cause) {
  const detail = cause instanceof Error ? cause.message : String(cause);
  console.error(`Benchmark harness failed: ${detail}`);
  process.exitCode = 1;
}

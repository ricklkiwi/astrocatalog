import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runAllBenchmarks } from './benchmarks.js';
import {
  compareResults,
  formatComparisonTable,
  hasRegression,
  type BenchBaseline,
} from './compare.js';

const BASELINE_PATH = fileURLToPath(new URL('../baselines/results.json', import.meta.url));

function readBaseline(): BenchBaseline {
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as BenchBaseline;
}

function writeBaseline(baseline: BenchBaseline): void {
  mkdirSync(dirname(BASELINE_PATH), { recursive: true });
  writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
}

function main(): void {
  const updateBaseline = process.argv.includes('--update-baseline');
  const results = runAllBenchmarks();

  if (updateBaseline) {
    writeBaseline({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      results,
    });
    console.log(`Updated ${BASELINE_PATH}`);
    return;
  }

  const comparisons = compareResults(results, readBaseline());
  console.log(formatComparisonTable(comparisons));

  if (hasRegression(comparisons)) {
    console.error(`Benchmark regression exceeds ${(0.2 * 100).toFixed(0)}% threshold.`);
    process.exitCode = 1;
  }
}

main();

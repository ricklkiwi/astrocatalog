import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { runAllBenchmarks, type BenchMetric } from './benchmarks.js';
import {
  compareResults,
  formatComparisonTable,
  hasRegression,
  parseBaseline,
  REGRESSION_THRESHOLD,
  type BenchBaseline,
} from './compare.js';

const BASELINE_PATH = fileURLToPath(new URL('../baselines/results.json', import.meta.url));

export interface RunOptions {
  updateBaseline: boolean;
  outputCurrentPath?: string;
}

export interface RunCliDeps {
  argv?: readonly string[];
  baselinePath?: string;
  runBenchmarks?: () => BenchMetric[];
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
}

export function parseRunOptions(argv: readonly string[]): RunOptions {
  const options: RunOptions = { updateBaseline: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      continue;
    }
    if (arg === '--update-baseline') {
      options.updateBaseline = true;
      continue;
    }
    if (arg === '--output-current') {
      const outputPath = argv[index + 1];
      if (!outputPath || outputPath.startsWith('--')) {
        throw new Error('--output-current requires a file path');
      }
      options.outputCurrentPath = outputPath;
      index += 1;
      continue;
    }
    throw new Error(`Unknown benchmark option: ${arg}`);
  }

  if (options.updateBaseline && options.outputCurrentPath) {
    throw new Error('--output-current is only valid for normal benchmark gate runs');
  }

  return options;
}

export function createBenchBaseline(results: readonly BenchMetric[]): BenchBaseline {
  return parseBaseline({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    results,
  });
}

function readBaseline(path = BASELINE_PATH): BenchBaseline {
  try {
    return parseBaseline(JSON.parse(readFileSync(path, 'utf8')));
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Invalid benchmark baseline at ${path}: ${detail}`, { cause });
  }
}

function writeBaseline(path: string, baseline: BenchBaseline): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(baseline, null, 2)}\n`);
}

export function runCli({
  argv = process.argv.slice(2),
  baselinePath = BASELINE_PATH,
  runBenchmarks = runAllBenchmarks,
  stdout = console.log,
  stderr = console.error,
}: RunCliDeps = {}): number {
  const options = parseRunOptions(argv);

  if (options.updateBaseline) {
    const results = runBenchmarks();
    const baseline = createBenchBaseline(results);
    writeBaseline(baselinePath, baseline);
    stdout(`Updated ${baselinePath}`);
    return 0;
  }

  const baseline = readBaseline(baselinePath);
  const results = runBenchmarks();
  const currentBaseline = createBenchBaseline(results);

  if (options.outputCurrentPath) {
    writeBaseline(options.outputCurrentPath, currentBaseline);
    stdout(`Wrote current benchmark results to ${options.outputCurrentPath}`);
  }

  const comparisons = compareResults(results, baseline);
  stdout(formatComparisonTable(comparisons));

  if (hasRegression(comparisons)) {
    stderr(`Benchmark regression exceeds ${(REGRESSION_THRESHOLD * 100).toFixed(0)}% threshold.`);
    return 1;
  }

  return 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    process.exitCode = runCli();
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    console.error(`Benchmark harness failed: ${detail}`);
    process.exitCode = 1;
  }
}

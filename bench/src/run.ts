import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
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
import { runScanPipelineBudget, type AbsoluteBudgetResult } from './scan-pipeline.js';

const BASELINE_PATH = fileURLToPath(new URL('../baselines/results.json', import.meta.url));

export interface RunOptions {
  updateBaseline: boolean;
  outputCurrentPath?: string;
}

export interface RunCliDeps {
  argv?: readonly string[];
  baselinePath?: string;
  /**
   * The committed-baseline benchmark set (the fast, deterministic P0-07
   * metrics). Compared against `baselines/results.json` and written by
   * `--update-baseline`.
   */
  runBenchmarks?: () => BenchMetric[];
  /**
   * Benchmarks gated against an absolute wall-clock budget rather than the
   * baseline-relative regression threshold (DD-004's 10k-file scan budget).
   * Their metrics are reported and included in `--output-current`, but are NOT
   * written into the committed baseline (the absolute floor is the gate, and a
   * single committed number can't express the env-dependent CI budget). Async
   * because the scan pipeline is fs/DB-bound.
   */
  runBudgetBenchmarks?: () => Promise<AbsoluteBudgetResult[]>;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
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

function resolveCurrentOutputPath(outputPath: string, baselinePath: string): string {
  const resolvedOutputPath = resolve(outputPath);
  const resolvedBaselineDir = dirname(resolve(baselinePath));
  const relativeToBaselineDir = relative(resolvedBaselineDir, resolvedOutputPath);

  if (
    relativeToBaselineDir === '' ||
    (!relativeToBaselineDir.startsWith('..') && !isAbsolute(relativeToBaselineDir))
  ) {
    throw new Error(
      `--output-current must not write inside the benchmark baseline directory: ${resolvedBaselineDir}`,
    );
  }

  return resolvedOutputPath;
}

export async function runCli({
  argv = process.argv.slice(2),
  baselinePath = BASELINE_PATH,
  runBenchmarks = runAllBenchmarks,
  runBudgetBenchmarks = async () => [await runScanPipelineBudget()],
  stdout = console.log,
  stderr = console.error,
}: RunCliDeps = {}): Promise<number> {
  const options = parseRunOptions(argv);
  const currentOutputPath = options.outputCurrentPath
    ? resolveCurrentOutputPath(options.outputCurrentPath, baselinePath)
    : undefined;

  if (options.updateBaseline) {
    // Only the committed-baseline set is written; the absolute-budget
    // benchmarks are deliberately excluded (see RunCliDeps.runBudgetBenchmarks).
    const results = runBenchmarks();
    const baseline = createBenchBaseline(results);
    writeBaseline(baselinePath, baseline);
    stdout(`Updated ${baselinePath}`);
    return 0;
  }

  const baseline = readBaseline(baselinePath);
  const results = runBenchmarks();
  const budgetResults = await runBudgetBenchmarks();
  const allResults = [...results, ...budgetResults.map((budget) => budget.metric)];
  const currentBaseline = createBenchBaseline(allResults);

  if (currentOutputPath) {
    writeBaseline(currentOutputPath, currentBaseline);
    stdout(`Wrote current benchmark results to ${currentOutputPath}`);
  }

  // Budget metrics have no committed baseline entry, so they surface as NEW in
  // the comparison table; the absolute floor below is their real gate.
  const comparisons = compareResults(allResults, baseline);
  stdout(formatComparisonTable(comparisons));

  let failed = false;

  if (hasRegression(comparisons)) {
    stderr(`Benchmark regression exceeds ${(REGRESSION_THRESHOLD * 100).toFixed(0)}% threshold.`);
    failed = true;
  }

  for (const budget of budgetResults) {
    const withinBudget = budget.metric.value >= budget.floor;
    const detail =
      `${budget.label}: ${formatSeconds(budget.elapsedMs)} elapsed ` +
      `(budget ${formatSeconds(budget.budgetMs)}, ` +
      `${budget.metric.value.toFixed(1)} files/sec vs floor ${budget.floor.toFixed(1)})`;
    if (withinBudget) {
      stdout(`Absolute budget OK — ${detail}`);
    } else {
      stderr(`Absolute budget EXCEEDED — ${detail}`);
      failed = true;
    }
  }

  return failed ? 1 : 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  runCli()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((cause: unknown) => {
      const detail = cause instanceof Error ? cause.message : String(cause);
      console.error(`Benchmark harness failed: ${detail}`);
      process.exitCode = 1;
    });
}

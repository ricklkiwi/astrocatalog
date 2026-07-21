import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { BenchMetric } from './benchmarks.js';
import { parseBaseline, type BenchBaseline } from './compare.js';
import { parseRunOptions, runCli } from './run.js';
import type { AbsoluteBudgetResult } from './scan-pipeline.js';

function metric(name: string, value: number): BenchMetric {
  return {
    name,
    unit: 'rows/sec',
    value,
    higherIsBetter: true,
    samples: [value],
  };
}

function baseline(results: BenchMetric[]): BenchBaseline {
  return {
    schemaVersion: 1,
    generatedAt: '2026-01-01T00:00:00.000Z',
    results,
  };
}

let tempDir: string | undefined;

function makeTempDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), 'astrotracker-bench-run-test-'));
  return tempDir;
}

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe('parseRunOptions', () => {
  it('parses a normal current-output path', () => {
    expect(parseRunOptions(['--', '--output-current', 'bench-current/results.json'])).toEqual({
      updateBaseline: false,
      outputCurrentPath: 'bench-current/results.json',
    });
  });

  it('requires an explicit path and keeps current output separate from baseline updates', () => {
    expect(() => parseRunOptions(['--output-current'])).toThrow(/requires a file path/);
    expect(() =>
      parseRunOptions(['--update-baseline', '--output-current', 'current.json']),
    ).toThrow(/only valid for normal benchmark gate runs/);
  });
});

describe('runCli evidence output', () => {
  it('writes exact current BenchBaseline JSON while preserving the failing gate result', async () => {
    const dir = makeTempDir();
    const baselineDir = join(dir, 'baselines');
    const baselinePath = join(baselineDir, 'results.json');
    const currentPath = join(dir, 'current', 'results.json');
    const current = metric('stable', 70);
    const stdout: string[] = [];
    const stderr: string[] = [];

    mkdirSync(baselineDir, { recursive: true });
    writeFileSync(baselinePath, `${JSON.stringify(baseline([metric('stable', 100)]), null, 2)}\n`);

    const exitCode = await runCli({
      argv: ['--output-current', currentPath],
      baselinePath,
      runBenchmarks: () => [current],
      // Skip the real 10k-file scan pipeline — this test only exercises the
      // baseline-relative gate and evidence output.
      runBudgetBenchmarks: () => Promise.resolve([]),
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(1);
    expect(stdout.join('\n')).toContain('Wrote current benchmark results');
    expect(stdout.join('\n')).toContain('REGRESSED');
    expect(stderr.join('\n')).toContain('20% threshold');

    const written = parseBaseline(JSON.parse(readFileSync(currentPath, 'utf8')));
    expect(written.results).toEqual([current]);
    expect(new Date(written.generatedAt).toISOString()).toBe(written.generatedAt);
  });

  it('rejects output-current inside the resolved baseline directory without changing content', async () => {
    const dir = makeTempDir();
    const baselineDir = join(dir, 'baselines');
    const baselinePath = join(baselineDir, 'results.json');
    const sameResolvedPath = join(baselineDir, '..', 'baselines', 'results.json');
    const originalContent = `${JSON.stringify(baseline([metric('stable', 100)]), null, 2)}\n`;
    let didRunBenchmarks = false;

    mkdirSync(baselineDir, { recursive: true });
    writeFileSync(baselinePath, originalContent);

    await expect(
      runCli({
        argv: ['--output-current', sameResolvedPath],
        baselinePath,
        runBenchmarks: () => {
          didRunBenchmarks = true;
          return [metric('stable', 70)];
        },
        runBudgetBenchmarks: () => Promise.resolve([]),
      }),
    ).rejects.toThrow(/must not write inside the benchmark baseline directory/);

    expect(didRunBenchmarks).toBe(false);
    expect(readFileSync(baselinePath, 'utf8')).toBe(originalContent);
  });
});

describe('runCli absolute budget gate', () => {
  function stableBaseline(dir: string): string {
    const baselineDir = join(dir, 'baselines');
    const baselinePath = join(baselineDir, 'results.json');
    mkdirSync(baselineDir, { recursive: true });
    writeFileSync(baselinePath, `${JSON.stringify(baseline([metric('stable', 100)]), null, 2)}\n`);
    return baselinePath;
  }

  function budget(value: number, elapsedMs: number): AbsoluteBudgetResult {
    return {
      metric: {
        name: 'scan-pipeline-stages-1-3-files-per-sec',
        unit: 'files/sec',
        value,
        higherIsBetter: true,
        samples: [value],
      },
      floor: 33.3,
      budgetMs: 300_000,
      elapsedMs,
      label: '10k-file scan (stages 1-3)',
    };
  }

  it('fails the build when a budget benchmark is below its absolute floor', async () => {
    const baselinePath = stableBaseline(makeTempDir());
    const stderr: string[] = [];

    const exitCode = await runCli({
      baselinePath,
      runBenchmarks: () => [metric('stable', 100)],
      runBudgetBenchmarks: () => Promise.resolve([budget(20, 500_000)]),
      stdout: () => undefined,
      stderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(1);
    expect(stderr.join('\n')).toContain('Absolute budget EXCEEDED');
  });

  it('passes when a budget benchmark meets its floor', async () => {
    const baselinePath = stableBaseline(makeTempDir());
    const stdout: string[] = [];

    const exitCode = await runCli({
      baselinePath,
      runBenchmarks: () => [metric('stable', 100)],
      runBudgetBenchmarks: () => Promise.resolve([budget(200, 50_000)]),
      stdout: (message) => stdout.push(message),
      stderr: () => undefined,
    });

    expect(exitCode).toBe(0);
    expect(stdout.join('\n')).toContain('Absolute budget OK');
  });
});

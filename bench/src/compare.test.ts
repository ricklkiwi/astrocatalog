import { describe, expect, it } from 'vitest';

import type { BenchMetric } from './benchmarks.js';
import {
  compareResults,
  formatComparisonTable,
  hasRegression,
  type BenchBaseline,
} from './compare.js';

function metric(name: string, value: number): BenchMetric {
  return {
    name,
    unit: 'rows/sec',
    value,
    higherIsBetter: true,
    samples: [value],
  };
}

const baseline: BenchBaseline = {
  schemaVersion: 1,
  generatedAt: '2026-01-01T00:00:00.000Z',
  results: [metric('stable', 100), metric('slow', 100)],
};

describe('compareResults', () => {
  it('passes metrics within the 20% regression threshold', () => {
    const comparisons = compareResults([metric('stable', 81)], baseline);
    expect(comparisons[0]?.status).toBe('OK');
    expect(hasRegression(comparisons)).toBe(false);
  });

  it('fails metrics below the 20% regression threshold', () => {
    const comparisons = compareResults([metric('slow', 79)], baseline);
    expect(comparisons[0]?.status).toBe('REGRESSED');
    expect(hasRegression(comparisons)).toBe(true);
  });

  it('passes metrics at exactly the 20% regression boundary', () => {
    const comparisons = compareResults([metric('stable', 80)], baseline);
    expect(comparisons[0]?.status).toBe('OK');
  });

  it('passes metrics that improve over baseline', () => {
    const comparisons = compareResults([metric('stable', 120)], baseline);
    expect(comparisons[0]?.status).toBe('OK');
  });

  it('marks metrics absent from the baseline as new', () => {
    const comparisons = compareResults([metric('new-bench', 50)], baseline);
    expect(comparisons[0]?.baseline).toBeNull();
    expect(comparisons[0]?.status).toBe('NEW');
  });

  it('marks baseline metrics absent from the current run as missing', () => {
    const comparisons = compareResults([metric('stable', 100)], baseline);
    expect(comparisons.find((comparison) => comparison.name === 'slow')?.status).toBe('MISSING');
    expect(hasRegression(comparisons)).toBe(false);
  });
});

describe('formatComparisonTable', () => {
  it('prints the benchmark, baseline, current, delta, and status columns', () => {
    const table = formatComparisonTable(compareResults([metric('stable', 110)], baseline));
    expect(table).toContain('Benchmark');
    expect(table).toContain('Baseline');
    expect(table).toContain('Current');
    expect(table).toContain('+10.0%');
    expect(table).toContain('OK');
  });
});

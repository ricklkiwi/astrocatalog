import { describe, expect, it } from 'vitest';

import type { BenchMetric } from './benchmarks.js';
import {
  compareResults,
  formatComparisonTable,
  hasRegression,
  REGRESSION_THRESHOLD,
  type BenchBaseline,
} from './compare.js';

function metric(name: string, value: number, overrides: Partial<BenchMetric> = {}): BenchMetric {
  return {
    name,
    unit: 'rows/sec',
    value,
    higherIsBetter: true,
    samples: [value],
    ...overrides,
  };
}

function makeBaseline(results: BenchMetric[] = [metric('stable', 100)]): BenchBaseline {
  return {
    schemaVersion: 1,
    generatedAt: '2026-01-01T00:00:00.000Z',
    results,
  };
}

describe('compareResults', () => {
  it.each([
    { label: 'small regression', current: 81, expectedDelta: -0.19 },
    { label: 'exact boundary', current: 80, expectedDelta: -REGRESSION_THRESHOLD },
    { label: 'improvement', current: 120, expectedDelta: 0.2 },
  ])('keeps an unregressed higher-is-better metric OK: $label', ({ current, expectedDelta }) => {
    const comparisons = compareResults([metric('stable', current)], makeBaseline());

    expect(comparisons[0]).toMatchObject({
      status: 'OK',
      deltaPercent: expectedDelta,
    });
    expect(hasRegression(comparisons)).toBe(false);
  });

  it('uses (current - baseline) / baseline and regresses only beyond 20%', () => {
    const comparisons = compareResults([metric('stable', 79)], makeBaseline());

    expect(comparisons[0]).toMatchObject({ status: 'REGRESSED', deltaPercent: -0.21 });
    expect(hasRegression(comparisons)).toBe(true);
  });

  it('matches by benchmark name rather than array position', () => {
    const baseline = makeBaseline([metric('first', 100), metric('second', 200)]);
    const comparisons = compareResults([metric('second', 200), metric('first', 100)], baseline);

    expect(comparisons.map(({ name, status }) => ({ name, status }))).toEqual([
      { name: 'second', status: 'OK' },
      { name: 'first', status: 'OK' },
    ]);
  });

  it('reports NEW and MISSING metrics without failing the gate', () => {
    const comparisons = compareResults(
      [metric('stable', 100), metric('new-bench', 50)],
      makeBaseline([metric('stable', 100), metric('removed-bench', 70)]),
    );

    expect(comparisons.find(({ name }) => name === 'new-bench')).toMatchObject({
      baseline: null,
      status: 'NEW',
    });
    expect(comparisons.find(({ name }) => name === 'removed-bench')).toMatchObject({
      current: null,
      status: 'MISSING',
    });
    expect(hasRegression(comparisons)).toBe(false);
  });

  it('reports every simultaneous regression through one gate result', () => {
    const comparisons = compareResults(
      [metric('first', 70), metric('second', 60)],
      makeBaseline([metric('first', 100), metric('second', 100)]),
    );

    expect(
      comparisons.filter(({ status }) => status === 'REGRESSED').map(({ name }) => name),
    ).toEqual(['first', 'second']);
    expect(hasRegression(comparisons)).toBe(true);
  });
});

describe('strict metric schema validation', () => {
  const validCurrent = metric('stable', 100);
  const validBaseline = makeBaseline();

  it.each([
    [
      'missing required field',
      { unit: 'rows/sec', value: 100, higherIsBetter: true, samples: [100] },
    ],
    ['unknown field', { ...validCurrent, extra: 'unexpected' }],
    ['unknown unit', { ...validCurrent, unit: 'milliseconds' }],
    ['wrong direction', { ...validCurrent, higherIsBetter: false }],
    ['non-finite value', { ...validCurrent, value: Number.NaN }],
    ['non-finite sample', { ...validCurrent, samples: [Number.POSITIVE_INFINITY] }],
    ['empty samples', { ...validCurrent, samples: [] }],
  ])('rejects malformed current metrics: %s', (_label, invalidMetric) => {
    expect(() => compareResults([invalidMetric], validBaseline)).toThrow(/Invalid current metric/);
  });

  it.each([
    [
      'missing required field',
      { name: 'stable', unit: 'rows/sec', higherIsBetter: true, samples: [100] },
    ],
    ['unknown field', { ...validCurrent, extra: 'unexpected' }],
    ['unknown unit', { ...validCurrent, unit: 'milliseconds' }],
    ['wrong direction', { ...validCurrent, higherIsBetter: false }],
    ['non-finite value', { ...validCurrent, value: Number.NEGATIVE_INFINITY }],
    ['non-finite sample', { ...validCurrent, samples: [Number.NaN] }],
  ])('rejects malformed baseline metrics: %s', (_label, invalidMetric) => {
    expect(() =>
      compareResults([validCurrent], { ...validBaseline, results: [invalidMetric] }),
    ).toThrow(/Invalid baseline metric/);
  });

  it.each([
    [
      'missing schemaVersion',
      { generatedAt: validBaseline.generatedAt, results: validBaseline.results },
    ],
    ['unknown root field', { ...validBaseline, extra: true }],
    ['wrong schemaVersion', { ...validBaseline, schemaVersion: 2 }],
    ['invalid generatedAt', { ...validBaseline, generatedAt: 'today' }],
  ])('rejects malformed baseline documents: %s', (_label, invalidBaseline) => {
    expect(() => compareResults([validCurrent], invalidBaseline)).toThrow(/Invalid baseline/);
  });

  it('rejects duplicate names on either side', () => {
    expect(() => compareResults([validCurrent, validCurrent], validBaseline)).toThrow(
      /duplicate benchmark name/,
    );
    expect(() =>
      compareResults([validCurrent], makeBaseline([validCurrent, validCurrent])),
    ).toThrow(/duplicate benchmark name/);
  });

  it('rejects matched metrics with mismatched unit metadata', () => {
    const current = metric('stable', 100, { unit: 'queries/sec' });
    expect(() => compareResults([current], validBaseline)).toThrow(/metadata mismatch/);
  });
});

describe('formatComparisonTable', () => {
  it('prints all required columns and renders absent values as dashes', () => {
    const comparisons = compareResults(
      [metric('stable', 110), metric('new-bench', 50)],
      makeBaseline([metric('stable', 100), metric('missing-bench', 50)]),
    );
    const table = formatComparisonTable(comparisons);

    expect(table).toContain('Benchmark');
    expect(table).toContain('Baseline');
    expect(table).toContain('Current');
    expect(table).toContain('Delta');
    expect(table).toContain('Status');
    expect(table).toContain('+10.0%');
    expect(table).toContain('NEW');
    expect(table).toContain('MISSING');
    expect(table).not.toContain('missing-bench  50.00 rows/sec  0.00 rows/sec');
  });
});

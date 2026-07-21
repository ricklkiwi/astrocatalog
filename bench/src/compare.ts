import type { BenchMetric } from './benchmarks.js';

export interface BenchBaseline {
  schemaVersion: 1;
  generatedAt: string;
  results: BenchMetric[];
}

export type BenchStatus = 'pass' | 'fail' | 'new';
export type BenchDisplayStatus = 'OK' | 'REGRESSED' | 'NEW' | 'MISSING';

export interface BenchComparison {
  name: string;
  unit: BenchMetric['unit'];
  baseline: number | null;
  current: number | null;
  deltaPercent: number | null;
  status: BenchDisplayStatus;
}

export const REGRESSION_THRESHOLD = 0.2;

const METRIC_KEYS = ['name', 'unit', 'value', 'higherIsBetter', 'samples'] as const;
const BASELINE_KEYS = ['schemaVersion', 'generatedAt', 'results'] as const;
const RATE_UNITS = new Set<BenchMetric['unit']>([
  'rows/sec',
  'queries/sec',
  'headers/sec',
  'files/sec',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
  label: string,
): void {
  const expected = new Set(expectedKeys);
  const missing = expectedKeys.filter((key) => !(key in value));
  const unknown = Object.keys(value).filter((key) => !expected.has(key));
  if (missing.length > 0 || unknown.length > 0) {
    const details = [
      missing.length > 0 ? `missing fields: ${missing.join(', ')}` : '',
      unknown.length > 0 ? `unknown fields: ${unknown.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('; ');
    throw new Error(`${label}: ${details}`);
  }
}

function parseMetric(value: unknown, label: string): BenchMetric {
  if (!isRecord(value)) throw new Error(`${label}: expected an object`);
  assertExactKeys(value, METRIC_KEYS, label);

  if (typeof value.name !== 'string' || value.name.length === 0) {
    throw new Error(`${label}: name must be a non-empty string`);
  }
  if (typeof value.unit !== 'string' || !RATE_UNITS.has(value.unit as BenchMetric['unit'])) {
    throw new Error(`${label}: unit must be rows/sec, queries/sec, headers/sec, or files/sec`);
  }
  if (value.higherIsBetter !== true) {
    throw new Error(`${label}: higherIsBetter must be true for rate metrics`);
  }
  if (typeof value.value !== 'number' || !Number.isFinite(value.value) || value.value <= 0) {
    throw new Error(`${label}: value must be a positive finite number`);
  }
  if (!Array.isArray(value.samples) || value.samples.length === 0) {
    throw new Error(`${label}: samples must be a non-empty array`);
  }
  if (
    !value.samples.every(
      (sample) => typeof sample === 'number' && Number.isFinite(sample) && sample > 0,
    )
  ) {
    throw new Error(`${label}: every sample must be a positive finite number`);
  }

  return {
    name: value.name,
    unit: value.unit as BenchMetric['unit'],
    value: value.value,
    higherIsBetter: true,
    samples: [...value.samples] as number[],
  };
}

function parseMetrics(value: unknown, label: 'current' | 'baseline'): BenchMetric[] {
  if (!Array.isArray(value)) throw new Error(`Invalid ${label} results: expected an array`);
  const metrics = value.map((metric, index) =>
    parseMetric(metric, `Invalid ${label} metric at index ${index}`),
  );
  const names = new Set<string>();
  for (const metric of metrics) {
    if (names.has(metric.name)) {
      throw new Error(`Invalid ${label} results: duplicate benchmark name "${metric.name}"`);
    }
    names.add(metric.name);
  }
  return metrics;
}

export function parseBaseline(value: unknown): BenchBaseline {
  if (!isRecord(value)) throw new Error('Invalid baseline: expected an object');
  assertExactKeys(value, BASELINE_KEYS, 'Invalid baseline');
  if (value.schemaVersion !== 1) {
    throw new Error('Invalid baseline: schemaVersion must be 1');
  }
  if (
    typeof value.generatedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.generatedAt)) ||
    new Date(value.generatedAt).toISOString() !== value.generatedAt
  ) {
    throw new Error('Invalid baseline: generatedAt must be an ISO 8601 UTC timestamp');
  }
  return {
    schemaVersion: 1,
    generatedAt: value.generatedAt,
    results: parseMetrics(value.results, 'baseline'),
  };
}

function compareMetric(current: BenchMetric, baseline?: BenchMetric): BenchComparison {
  if (!baseline) {
    return {
      name: current.name,
      unit: current.unit,
      baseline: null,
      current: current.value,
      deltaPercent: null,
      status: 'NEW',
    };
  }

  const deltaPercent = (current.value - baseline.value) / baseline.value;
  return {
    name: current.name,
    unit: current.unit,
    baseline: baseline.value,
    current: current.value,
    deltaPercent,
    status: deltaPercent < -REGRESSION_THRESHOLD ? 'REGRESSED' : 'OK',
  };
}

export function compareResults(currentInput: unknown, baselineInput: unknown): BenchComparison[] {
  const current = parseMetrics(currentInput, 'current');
  const baseline = parseBaseline(baselineInput);
  const baselineByName = new Map(baseline.results.map((metric) => [metric.name, metric]));
  const currentNames = new Set(current.map((metric) => metric.name));
  const comparisons = current.map((metric) => {
    const baselineMetric = baselineByName.get(metric.name);
    if (baselineMetric && baselineMetric.unit !== metric.unit) {
      throw new Error(
        `Benchmark metadata mismatch for "${metric.name}": current unit ${metric.unit}, baseline unit ${baselineMetric.unit}`,
      );
    }
    return compareMetric(metric, baselineMetric);
  });

  for (const baselineMetric of baseline.results) {
    if (!currentNames.has(baselineMetric.name)) {
      comparisons.push({
        name: baselineMetric.name,
        unit: baselineMetric.unit,
        baseline: baselineMetric.value,
        current: null,
        deltaPercent: null,
        status: 'MISSING',
      });
    }
  }

  return comparisons;
}

function formatNumber(value: number | null): string {
  if (value === null) return '-';
  if (value >= 1000) return Math.round(value).toLocaleString('en-US');
  return value.toFixed(2);
}

function formatDelta(value: number | null): string {
  if (value === null) return '-';
  const sign = value > 0 ? '+' : '';
  return `${sign}${(value * 100).toFixed(1)}%`;
}

export function formatComparisonTable(comparisons: readonly BenchComparison[]): string {
  const rows = [
    ['Benchmark', 'Baseline', 'Current', 'Delta', 'Status'],
    ...comparisons.map((comparison) => [
      comparison.name,
      `${formatNumber(comparison.baseline)} ${comparison.unit}`,
      `${formatNumber(comparison.current)} ${comparison.unit}`,
      formatDelta(comparison.deltaPercent),
      comparison.status,
    ]),
  ];

  const widths = rows[0]!.map((_, column) => Math.max(...rows.map((row) => row[column]!.length)));

  return rows
    .map((row) =>
      row
        .map((cell, column) => cell.padEnd(widths[column]!))
        .join('  ')
        .trimEnd(),
    )
    .join('\n');
}

export function hasRegression(comparisons: readonly BenchComparison[]): boolean {
  return comparisons.some((comparison) => comparison.status === 'REGRESSED');
}

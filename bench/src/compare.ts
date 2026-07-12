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
  current: number;
  deltaPercent: number | null;
  status: BenchDisplayStatus;
}

export const REGRESSION_THRESHOLD = 0.2;

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

export function compareResults(
  current: readonly BenchMetric[],
  baseline: BenchBaseline,
): BenchComparison[] {
  const baselineByName = new Map(baseline.results.map((metric) => [metric.name, metric]));
  const currentNames = new Set(current.map((metric) => metric.name));
  const comparisons = current.map((metric) =>
    compareMetric(metric, baselineByName.get(metric.name)),
  );

  for (const baselineMetric of baseline.results) {
    if (!currentNames.has(baselineMetric.name)) {
      comparisons.push({
        name: baselineMetric.name,
        unit: baselineMetric.unit,
        baseline: baselineMetric.value,
        current: 0,
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

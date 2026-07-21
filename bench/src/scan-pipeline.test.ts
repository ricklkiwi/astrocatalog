/**
 * Small-scale correctness test for the 10k-file scan benchmark's driver
 * (`runScanPipelineBenchmark`). Runs the real Stage-1-3 pipeline over a tiny
 * synthetic corpus so `pnpm --filter bench test` stays fast, while proving the
 * driver wires the production worker + real DB repos correctly and that
 * malformed files are surfaced as parse errors (not dropped, not aborting the
 * run). The full 10k-file timing run lives in the `pnpm bench` gate.
 */
import { describe, expect, it } from 'vitest';

import {
  runScanPipelineBenchmark,
  scanPipelineMinFilesPerSec,
  SCAN_PIPELINE_METRIC_NAME,
} from './scan-pipeline.js';

describe('runScanPipelineBenchmark', () => {
  it('drives the real pipeline and surfaces malformed files as parse errors', async () => {
    const result = await runScanPipelineBenchmark({ fileCount: 60, corruptCount: 4, seed: 3 });

    expect(result.filesCount).toBe(60);
    expect(result.erroredCount).toBe(4);
    expect(result.framesCount).toBe(56);

    expect(result.metric.name).toBe(SCAN_PIPELINE_METRIC_NAME);
    expect(result.metric.unit).toBe('files/sec');
    expect(result.metric.value).toBeGreaterThan(0);
    expect(result.elapsedMs).toBeGreaterThan(0);
  }, 30000);

  it('exposes an env-dependent throughput floor derived from the wall-clock budget', () => {
    const local = scanPipelineMinFilesPerSec(10_000, {});
    const ci = scanPipelineMinFilesPerSec(10_000, { CI: 'true' });
    // 10k files / 300s local vs 10k / 900s on CI (3x budget) → CI floor is lower.
    expect(local).toBeCloseTo(10_000 / 300, 5);
    expect(ci).toBeCloseTo(10_000 / 900, 5);
    expect(ci).toBeLessThan(local);
  });
});

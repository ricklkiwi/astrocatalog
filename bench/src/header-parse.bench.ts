/**
 * Full FITS header parse throughput (P1-01): the real `@astrotracker/core`
 * parser — 80-char card decoding, value typing, CONTINUE handling, keyword
 * map construction — over the deterministic generated corpus. Complements
 * the END-scan benchmark, which measures only block-boundary detection.
 */
import { beforeAll, bench, describe } from 'vitest';

import {
  createHeaderScanWorkload,
  executeHeaderParseWorkload,
  type HeaderScanWorkload,
} from './benchmarks.js';

describe('header-parse', () => {
  let workload: HeaderScanWorkload;

  beforeAll(() => {
    workload = createHeaderScanWorkload();
  });

  bench(
    'fits-header-parse-headers-per-sec',
    () => {
      executeHeaderParseWorkload(workload);
    },
    { iterations: 1, warmupIterations: 0, warmupTime: 0 },
  );
});

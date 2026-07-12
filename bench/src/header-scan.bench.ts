/**
 * FITS header-region throughput benchmark (P0-07 Step 6). This intentionally
 * measures bounded-read END-card block-boundary detection only: no 80-char
 * keyword/value decoding, CONTINUE handling, or `headers_json` construction
 * happens here. Revisit this benchmark after P1-01 lands the real FITS parser.
 */
import { bench, describe } from 'vitest';

import { runHeaderScanBenchmark } from './benchmarks.js';

describe('header-scan', () => {
  bench(
    'fits-header-end-block-scan-headers-per-sec',
    () => {
      runHeaderScanBenchmark();
    },
    { iterations: 1, warmupIterations: 0, warmupTime: 0 },
  );
});

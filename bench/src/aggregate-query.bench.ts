/**
 * Aggregate-query latency benchmark (P0-07 Step 5). The CLI runner in
 * `src/run.ts` is the gate CI uses; this Vitest bench wrapper keeps the
 * benchmark discoverable for humans using `vitest bench`.
 *
 * The measured SQL shapes stand in for PRD 8.4's target-dashboard budget:
 * global integration rollups by target/filter/type, plus a single-target
 * drill-down grouped by filter. This measures backing query latency only,
 * not future React render time.
 */
import { bench, describe } from 'vitest';

import { runAggregateQueryBenchmark, runAggregateTargetDrilldownBenchmark } from './benchmarks.js';

describe('aggregate-query', () => {
  bench(
    'aggregate-target-filter-type-rollup-queries-per-sec',
    () => {
      runAggregateQueryBenchmark();
    },
    { iterations: 1, warmupIterations: 0, warmupTime: 0 },
  );

  bench(
    'aggregate-single-target-filter-rollup-queries-per-sec',
    () => {
      runAggregateTargetDrilldownBenchmark();
    },
    { iterations: 1, warmupIterations: 0, warmupTime: 0 },
  );
});

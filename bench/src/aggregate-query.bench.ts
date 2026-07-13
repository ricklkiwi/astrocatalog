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
import { afterAll, beforeAll, bench, describe } from 'vitest';

import { createAggregateQueryWorkload, type AggregateQueryWorkload } from './benchmarks.js';

describe('aggregate-query', () => {
  let workload: AggregateQueryWorkload;

  beforeAll(() => {
    workload = createAggregateQueryWorkload();
  });

  afterAll(() => {
    workload.cleanup();
  });

  bench(
    'aggregate-target-filter-type-rollup-queries-per-sec',
    () => {
      workload.executeGlobalRollup();
    },
    { iterations: 1, warmupIterations: 0, warmupTime: 0 },
  );

  bench(
    'aggregate-single-target-filter-rollup-queries-per-sec',
    () => {
      workload.executeTargetDrilldown();
    },
    { iterations: 1, warmupIterations: 0, warmupTime: 0 },
  );
});

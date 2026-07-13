# bench/ - AstroTracker benchmark harness (P0-07)

Root-level dev-tooling workspace member (`@astrotracker/bench`), peer to `fixtures/` per
DD-002's module layout — not an app package under `packages/`.

## Benchmarks

`pnpm bench` runs the benchmark suite and compares the results against
`bench/baselines/results.json`. Regression math is `(current - baseline) / baseline`; a metric
fails when its current value is more than 20% below the committed baseline.

| Benchmark                                               | What it measures                                                                |
| ------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `db-insert-100k-files-frames-rows-per-sec`              | `files` + `frames` repository inserts for a deterministic 100k-frame dataset    |
| `aggregate-target-filter-type-rollup-queries-per-sec`   | DD-003 integration rollup query grouped by target, filter, and frame type       |
| `aggregate-single-target-filter-rollup-queries-per-sec` | Single-target filter rollup backing PRD 8.4's target dashboard budget           |
| `fits-header-end-block-scan-headers-per-sec`            | Bounded FITS header `END` card scan and 2880-byte block-boundary detection only |

The header benchmark is intentionally not a full FITS parser. It measures only the in-memory,
I/O-bound bounded-read boundary scan that locates the literal `END` card and rounds its position
to a 2880-byte FITS block. It does not decode 80-character keyword/value cards, handle the
`CONTINUE` convention, or construct `headers_json`. Revisit it when P1-01 lands the real FITS
header parser.

The DB insert and aggregate-query benchmarks currently use the same deterministic, seeded
100k-frame synthetic workload. They do not implement or claim DD-004's full 10k-file stages 1-3
scan budget; that end-to-end discovery, parse, and resolve benchmark remains follow-up work after
the missing pipeline stages land.

## Commands

```sh
pnpm bench
pnpm bench -- --output-current bench-current/results.json
pnpm bench:update-baseline
```

`--output-current <path>` is an evidence-only option for normal gated runs. It writes the fresh
current results in the same `BenchBaseline` JSON shape as `bench/baselines/results.json`, then
still prints the comparison table and still exits nonzero if the 20% gate fails. It never updates
the committed baseline. CI uses this option and uploads the file as the `benchmark-current-results`
artifact with `if: always()`, so exact `ubuntu-latest` samples are available even when the
benchmark job fails.

Use `pnpm bench:update-baseline` only when an intentional implementation change moves the
performance envelope:

1. Run `pnpm bench:update-baseline` to regenerate `bench/baselines/results.json`.
2. Inspect every changed metric with `git diff -- bench/baselines/results.json`.
3. Commit the baseline in the same PR as the performance-affecting implementation.
4. Explain why it changed and include the benchmark table as evidence in the PR description,
   following `CLAUDE.md`'s benchmark-output evidence rule.

The committed baseline is calibrated from `ubuntu-latest` GitHub Actions hardware. Local failures
can be hardware variance: rerun once, check the delta magnitude, and compare against CI. Do not
raise the threshold in response to one noisy local run. CI runs `pnpm bench` on `ubuntu-latest`
only and folds that result into the aggregate `ci-ok` required check.

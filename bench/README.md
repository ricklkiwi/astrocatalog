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

The header benchmark is intentionally not a full FITS parser. It measures the bounded-read
header-region scan needed before P1-01 lands richer card parsing.

## Commands

```sh
pnpm bench
pnpm bench:update-baseline
```

Use `pnpm bench:update-baseline` only when an intentional implementation change moves the
performance envelope. Commit the updated `bench/baselines/results.json` in the same PR and note
the reason in the PR description.

The committed baseline is calibrated from `ubuntu-latest` GitHub Actions hardware. Local failures
can be hardware variance: rerun once, check the delta magnitude, and compare against CI before
raising the threshold. CI runs `pnpm bench` on `ubuntu-latest` only and folds that result into
the aggregate `ci-ok` required check.

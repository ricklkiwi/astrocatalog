# bench/ - AstroTracker benchmark harness (P0-07)

Root-level dev-tooling workspace member (`@astrotracker/bench`), peer to `fixtures/` per
DD-002's module layout — not an app package under `packages/`.

## Benchmarks

`pnpm bench` runs the benchmark suite and compares the results against
`bench/baselines/results.json`. Regression math is `(current - baseline) / baseline`; a metric
fails when its current value is more than 20% below the committed baseline.

| Benchmark                                               | What it measures                                                                                                                         |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `db-insert-100k-files-frames-rows-per-sec`              | `files` + `frames` repository inserts for a deterministic 100k-frame dataset                                                             |
| `aggregate-target-filter-type-rollup-queries-per-sec`   | DD-003 integration rollup query grouped by target, filter, and frame type                                                                |
| `aggregate-single-target-filter-rollup-queries-per-sec` | Single-target filter rollup backing PRD 8.4's target dashboard budget                                                                    |
| `fits-header-end-block-scan-headers-per-sec`            | Bounded FITS header `END` card scan and 2880-byte block-boundary detection only                                                          |
| `fits-header-parse-headers-per-sec`                     | Full P1-01 FITS header parse (cards, values, CONTINUE, keyword map)                                                                      |
| `scan-pipeline-stages-1-3-files-per-sec`                | DD-004 stages 1-3 (discover → parse → classify → `frames` row) over a 10k-file synthetic library, gated by an absolute wall-clock budget |

The END-scan benchmark is intentionally not a full FITS parser: it measures only the in-memory
bounded-read boundary scan that locates the literal `END` card and rounds its position to a
2880-byte FITS block. The parse benchmark runs the real `@astrotracker/core` P1-01 parser over
the same generated corpus — 80-character card decoding, value typing, the `CONTINUE`
convention, and keyword-map construction. Its committed baseline is deliberately set to
6,250 headers/sec (not a measured CI sample) so the 20% regression gate trips exactly at
P1-01's 5,000 headers/sec acceptance floor; recalibrate it from a CI run the same way as the
other metrics once one is recorded.

The DB insert and aggregate-query benchmarks use the same deterministic, seeded 100k-frame
synthetic workload.

## DD-004 10k-file scan budget (`scan-pipeline-stages-1-3-files-per-sec`)

`bench/src/scan-pipeline.ts` implements DD-004's "synthetic 10k-header fixture set must scan
(stages 1-3) under a CI-adjusted time budget; regression fails the build". It generates a 10,000-
file synthetic FITS library (with ~1% malformed files interleaved via `@astrotracker/fixtures`'s
`corruptFitsBytes`) in a scratch temp directory, then drives the **real** Stage-1-3 pipeline over
it: the production `runScanJob` worker function (imported by relative source path from
`packages/desktop` — it is Electron-free and `worker_threads`-free, unlike the orchestrator's
`pool.ts`, so it runs directly under `tsx`/`tsc`) feeding real `@astrotracker/db` repositories
(`files.upsertDiscovered` / `files.recordParseError` / `frames.upsertByFileId`) against a real
temp-file SQLite database. Only the ~30-line batch-persist glue from `orchestrator.ts`'s
`processDiscoveredBatch`/`toFrameRow` is replicated at the bench call site; everything else is
shared production code. Fixture generation is untimed; only the scan + persistence is measured.

Alongside the timing metric it asserts the scan-summary row counts as a correctness sanity check
(files indexed = 10,000, parse errors surfaced = corrupted count, frames written = well-formed
count) — demonstrating at scale that malformed files are logged and skipped without aborting the
batch. Small-scale idempotency and per-format parsing correctness are proven separately in
`packages/desktop/.../parse-pipeline.test.ts` and `packages/core/.../parse-file.test.ts`, so this
benchmark does not repeat them.

Unlike the other metrics, this one is gated by an **absolute wall-clock budget**, not just the
baseline-relative regression threshold — PRD §8.4 is a hard external requirement, not a
"don't get slower than last time" gate. The reference-hardware target is **5 min (300s)** for
10k files; on CI (`process.env.CI` set) the budget is widened **3x → 15 min** to absorb the slower,
more variable, fs/SQLite-heavy behavior of shared `ubuntu-latest` runners (`SCAN_PIPELINE_*`
constants in `scan-pipeline.ts`). `run.ts` fails the `bench` job (nonzero exit) when the measured
throughput falls below the budget-derived floor. This benchmark is **not** written into
`baselines/results.json` (a single committed number can't express the env-dependent budget, and
the absolute floor is the real gate), so it always shows as `NEW` in the comparison table; its
pass/fail is reported separately as an `Absolute budget OK`/`EXCEEDED` line.

## Commands

```sh
pnpm bench
pnpm bench -- --output-current ../bench-current/results.json
pnpm bench:update-baseline
```

`--output-current <path>` is an evidence-only option for normal gated runs. It writes the fresh
current results in the same `BenchBaseline` JSON shape as `bench/baselines/results.json`, then
still prints the comparison table and still exits nonzero if the 20% gate fails. It never updates
the committed baseline. CI uses this option and uploads the file as the `benchmark-current-results`
artifact with `if: always()`, so exact `ubuntu-latest` samples are available even when the
benchmark job fails. The path is resolved from the `@astrotracker/bench` package's working
directory; `../bench-current/results.json` writes the artifact file at the repo root as
`bench-current/results.json`.

Use `pnpm bench:update-baseline` only when an intentional implementation change moves the
performance envelope:

1. Run `pnpm bench:update-baseline` to regenerate `bench/baselines/results.json`.
2. Inspect every changed metric with `git diff -- bench/baselines/results.json`.
3. Commit the baseline in the same PR as the performance-affecting implementation.
4. Explain why it changed and include the benchmark table as evidence in the PR description,
   following `CLAUDE.md`'s benchmark-output evidence rule.

The committed baseline is calibrated from `ubuntu-latest` GitHub Actions hardware; the current
baseline came from PR #61's GitHub Actions run `29219448456`. Local failures can be hardware
variance: rerun once, check the delta magnitude, and compare against CI. Do not raise the
threshold in response to one noisy local run. CI runs `pnpm bench` on `ubuntu-latest` only and
folds that result into the aggregate `ci-ok` required check.

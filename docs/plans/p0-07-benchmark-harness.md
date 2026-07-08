# Plan: [P0-07] Benchmark harness with CI regression gates

**Slug:** p0-07-benchmark-harness **Issue:** #7 **Date:** 2026-07-08
**Governing DDs:** DD-004 (scanning pipeline — header-only reads, "Benchmarks in CI" rule), DD-001 (tech stack — Vitest, better-sqlite3/Drizzle, GitHub Actions CI), DD-003 (schema — aggregation indexes the query benchmark exercises); PRD §8.4 (performance targets)
**Status:** READY_FOR_SPEC

## Summary

This issue adds a new root-level dev-tooling workspace member, `bench/` (peer to `fixtures/`,
per DD-002's module layout — neither is an app package under `packages/`), that measures three
things against a deterministic, seeded 100k-frame synthetic dataset: bulk `@astrotracker/db`
insert throughput, DD-003 aggregate-query latency (the integration-time rollup pattern the
schema's indexes exist for), and FITS header-region I/O throughput. Results are produced by
Vitest's built-in `bench()` (tinybench-backed, confirmed to support `outputJson`/`compare` in
the installed Vitest 3.2 line), fed through a small custom comparator that prints a results
table and exits non-zero if any benchmark regresses more than 20% against a committed baseline
JSON file — satisfying the issue's "Vitest bench or custom" latitude by using Vitest for
execution/timing and custom code only for the gate itself, which needs precise, testable
control over the 20% threshold and exit behavior that Vitest's own `--compare` output does not
document as CI-gate-ready. `pnpm bench` (already named in `CLAUDE.md`'s command table) runs the
full suite, prints the table, and gates; a new `bench` CI job (ubuntu-latest only — see Open
Questions/rationale) runs the same command and is folded into the existing `ci-ok` aggregate
required check.

**Scope note surfaced up front (see Open Questions):** no FITS header *parser* exists in the
repo yet — `packages/core` only exports a UUIDv7 generator (P1-01, the real FITS parser, has
not landed). The issue's "header parse throughput" criterion is therefore met with a narrower,
honestly-scoped benchmark: bounded-read + END-card block-boundary detection (the I/O-bound half
of DD-004's Stage 2 "header-only reads... seek + bounded read") over synthetic FITS bytes — not
the full 80-char card/keyword/value decode, CONTINUE-convention handling, etc., which is P1-01's
domain logic and does not exist to benchmark. This plan does not invent that parser inside
`bench/`; it flags the gap and recommends revisiting this one benchmark file once P1-01 merges.

## Affected Files

- `fixtures/package.json` — modified; add `main`/`types`/`exports` (a real library entry
  point) so `bench/` can `import { generateFrames } from '@astrotracker/fixtures'` instead of
  shelling out to the CLI or duplicating generator logic; enable `declaration`/`declarationMap`
  in its build (currently `noEmit: true`, dev-CLI-only)
- `fixtures/src/index.ts` — new; barrel re-exporting `generateFrames`, `GenerateOptions`,
  `GeneratedFrame`, `WeightedEntry`, `ProfileName` for external (workspace) consumption
- `fixtures/tsconfig.json` — modified; drop `noEmit: true` / re-enable declaration emit to
  match the `core`/`db` package build shape now that fixtures has real consumers
- `pnpm-workspace.yaml` — modified; add `bench` as a workspace member
- `bench/package.json` — new; private `@astrotracker/bench`, deps on `@astrotracker/core`,
  `@astrotracker/db`, `@astrotracker/fixtures` (all `workspace:*`), devDep `tinybench`-adjacent
  none needed (Vitest ships its own); scripts `build` (typecheck, `noEmit`), `lint`, `test`,
  `bench`, `bench:update-baseline`
- `bench/tsconfig.json` — new; same shape as `fixtures/tsconfig.json` pre-change (dev-only,
  `noEmit: true` — bench has no consumers of its own)
- `bench/vitest.config.ts` — new; local config (same "stop the upward project-config lookup"
  reason as `packages/db/vitest.config.ts`) plus a `test.benchmark.include` glob for
  `src/**/*.bench.ts`
- `bench/src/lib/seed-db.ts` — new; deterministic 100k-frame `AstroDatabase` builder shared by
  the insert and query benchmarks
- `bench/src/db-insert.bench.ts` — new; bulk insert-rate benchmark
- `bench/src/aggregate-query.bench.ts` — new; DD-003 rollup-query latency benchmarks
- `bench/src/header-scan.bench.ts` — new; header-region boundary-detection throughput
  benchmark (scoped-down per Open Questions)
- `bench/src/compare.ts` — new; loads a fresh `outputJson` result + the committed baseline,
  computes per-benchmark % delta, prints the results table, exits non-zero on >20% regression
- `bench/src/compare.test.ts` — new; unit tests for the regression math against fixed fake
  result JSON (no real benchmark run needed)
- `bench/src/run.ts` — new; the `pnpm bench` entry point — invokes `vitest bench --outputJson`
  against a temp file, then calls `compare.ts`; a `--update-baseline` mode instead overwrites
  `bench/baselines/results.json` and skips gating
- `bench/baselines/results.json` — new; committed baseline (ubuntu-latest GitHub Actions
  runner numbers), generated by Step 9 and re-generated deliberately via
  `bench:update-baseline`
- `bench/README.md` — new; what's benchmarked, how the gate works, how/when to update
  baselines, the header-scan benchmark's scoped-down nature and its P1-01 follow-up
- `vitest.config.ts` (root) — modified; add a `bench` project (`root: './bench'`,
  `include: ['src/**/*.test.ts']`) so `compare.ts`'s unit tests run under `pnpm test`/CI's
  `test` job, matching the existing `core`/`db`/`desktop`/`renderer`/`fixtures` project list;
  this does **not** pick up `*.bench.ts` files (different glob), so `pnpm test` stays fast
- `package.json` (root) — modified; add `bench` and `bench:update-baseline` scripts
  (`CLAUDE.md` already documents `pnpm bench` as a command, this issue implements it)
- `.github/workflows/ci.yml` — modified; new `bench` job (ubuntu-latest only), `ci-ok`'s
  `needs` extended to `[test, bench]` with the same `if: always()` / explicit-result-check
  pattern
- `CONTRIBUTING.md` — modified; local gate section notes `pnpm bench` and how to read a local
  regression (hardware variance vs. a real regression)
- `README.md` — modified; Commands section gains `pnpm bench`

Not touched (verified, reasons noted):

- `packages/db/src/repositories/*` — no new repository methods (bulk-insert convenience API,
  aggregation query helpers). Benchmarks exercise the existing public `CrudRepository`/
  `db.transaction()` surface exactly as P0-04 shipped it; adding a formal bulk-insert or
  aggregation API is a product decision for a later Phase 1 issue, informed by these numbers,
  not this one.
- `packages/core/src/*` — no header parser added. See Open Questions.
- `.github/workflows/package.yml` — unrelated packaging stub, no changes.

## Implementation Steps

### Step 1 — `@astrotracker/fixtures` gets a real library entry point

**Outcome:** `@astrotracker/fixtures` is importable from another workspace package the same
way `@astrotracker/core`/`@astrotracker/db` already are (`main`/`types`/`exports` +
declaration emit), without changing any existing fixture-authoring behavior. A new
`fixtures/src/index.ts` barrel exports `generateFrames`, `GenerateOptions`, `GeneratedFrame`,
`WeightedEntry`, `ProfileName` — the pure, already-deterministic, already-seeded in-memory
generator function `bench/` needs. `fixtures/src/generate.ts`'s CLI (`main()`/`run()`) is
unchanged; only its exports become reachable from outside the package. This is a small,
additive extension to an already-merged P0-06 package, not a behavior change — flagged
explicitly for the Reviewer.
**Files:** `fixtures/package.json`, `fixtures/src/index.ts`, `fixtures/tsconfig.json`.
**Depends on:** none

### Step 2 — `bench/` workspace package skeleton

**Outcome:** `pnpm install` recognizes `bench` as a workspace member; `pnpm -r build`,
`pnpm -r lint`, `pnpm -r test` all succeed against an empty-but-wired package (mirrors how
`fixtures/` was bootstrapped in P0-06 Step 1). Root `package.json` gains `bench` and
`bench:update-baseline` scripts that currently no-op or point at not-yet-created files (filled
in by later steps) — kept green at every step per repo convention of never landing a broken
intermediate state on `main`.
**Files:** `pnpm-workspace.yaml`, `bench/package.json`, `bench/tsconfig.json`,
`bench/vitest.config.ts`, root `package.json`.
**Depends on:** Step 1

### Step 3 — Deterministic 100k-frame DB seed builder

**Outcome:** `bench/src/lib/seed-db.ts` exports a function that, given a count and seed, opens
a temp-file `AstroDatabase` (`node:os.tmpdir()` + `mkdtempSync` — never inside the repo, so no
`.gitignore` change is needed and cleanup is trivial), inserts one `watch_folders` row, and
inserts N `targets`/`filters` rows keyed by name (drawn from a bench-specific weighted-name
list richer than `generate.ts`'s 3-object CLI default — dozens of synthetic target names and a
handful of filters, passed directly as a typed `GenerateOptions` object, no CLI parsing
involved — so the aggregate-query benchmark exercises realistic index cardinality instead of a
degenerate 3-bucket case). It then calls `generateFrames()` for N synthetic frames and, for
each, inserts a `files` row (unique `relativePath`) and a `frames` row with `frameType` mapped
from the synthetic `IMAGETYP` value, `frameTypeSource: 'header'`, `targetId`/`filterId`
resolved from the pre-created lookup tables, and `headersJson` set to a JSON dump of the
synthetic keyword set (a stand-in for a real parsed header — no parsing occurs; this column is
opaque storage as far as the DB layer is concerned). Returns both the open `AstroDatabase`
handle and the raw `GeneratedFrame[]` (with FITS bytes) for benchmarks that need the bytes
too. Row-insertion here is chunked into fixed-size sub-transactions (not one 200k-statement
transaction and not one transaction per row) — a documented, reviewable throughput/memory
tradeoff, not left implicit.
**Files:** `bench/src/lib/seed-db.ts`, `bench/src/lib/seed-db.test.ts` (a small-N smoke test —
row counts, FK integrity, index population — not a benchmark).
**Depends on:** Step 2

### Step 4 — Bulk DB insert-rate benchmark

**Outcome:** `bench/src/db-insert.bench.ts` times *only* the insert loop (files + frames rows,
chunked-transaction strategy from Step 3) for a 100k-frame synthetic dataset that has already
been generated in memory before timing starts — so the benchmark measures
`@astrotracker/db` write throughput, not `generateFrames()`'s synthesis cost. Reports rows/sec
(files+frames combined) via the `bench()` name so the results table is self-explanatory. No
new repository methods; the benchmark calls `repos.files.insert()`/`repos.frames.insert()`
inside `db.transaction()` exactly as any future scanning-pipeline caller would (DD-004 Stage 2
target).
**Files:** `bench/src/db-insert.bench.ts`.
**Depends on:** Step 3

### Step 5 — Aggregate query-latency benchmark

**Outcome:** `bench/src/aggregate-query.bench.ts` seeds one 100k-frame DB once (untimed
`beforeAll`-equivalent setup), then times two DD-003-documented query shapes, each a raw
Drizzle `sql`/query-builder statement (no new repository method — this is read-only
measurement, not a new domain API): (a) the global integration-time rollup
`SUM(exposure_seconds) GROUP BY target_id, filter_id` restricted to `frame_type = 'light'`,
which is DD-003's own worked example and exercises `frames_target_filter_type_idx` directly;
(b) a single-target "dashboard" drill-down (`WHERE target_id = :id AND frame_type = 'light'
GROUP BY filter_id`), mapping directly to PRD §8.4's "target dashboard with full statistics
renders in under 1 second" budget. Both benchmarks reuse the one seeded DB (setup cost isn't
part of either bench's timed region).
**Files:** `bench/src/aggregate-query.bench.ts`.
**Depends on:** Step 3

### Step 6 — Header-region boundary-detection throughput benchmark (scoped down)

**Outcome:** `bench/src/header-scan.bench.ts` times, over the in-memory FITS byte buffers
`generateFrames()` already produced (no disk I/O — `GeneratedFrame.bytes`), a bounded scan that
walks 2880-byte blocks (reusing `BLOCK_BYTES`/`CARD_BYTES` constants re-exported from
`@astrotracker/fixtures`'s FITS builder lib) looking for the literal `END` card, returning the
header's total byte length / block count. This is explicitly *not* full card/keyword/value
decoding (no quoting, no CONTINUE convention, no `headers_json` construction) — a header
comment block and `bench/README.md` both say so plainly, and both note this file should be
revisited once P1-01's real parser exists (either replaced by calling into it directly, or its
boundary-detection logic absorbed by it). See Open Questions for why this scoping was chosen
over inventing a full parser.
**Files:** `bench/src/header-scan.bench.ts`.
**Depends on:** Step 1 (needs the `bytes`/constants export surface)

### Step 7 — Baseline storage + comparator/gate (`pnpm bench`)

**Outcome:** `bench/src/run.ts` (the `bench` script's entry point) runs the three-ish
`*.bench.ts` files via Vitest's `bench` mode with `outputJson` pointed at a temp file, then
hands that JSON plus the committed `bench/baselines/results.json` to `bench/src/compare.ts`,
which: matches benchmarks by name, computes `(current - baseline) / baseline` on the
lower-is-better timing metric, prints a console table (name | baseline | current | delta % |
status: OK/REGRESSED/NEW/MISSING), and sets a non-zero process exit code if any matched
benchmark regressed more than 20%. Benchmarks present only in one side (a brand-new bench, or
one removed) are reported informationally and never fail the gate. `--update-baseline` (wired
to `bench:update-baseline`) runs the same benchmarks and writes straight to
`bench/baselines/results.json` instead of comparing — an explicit, reviewed act, never done
automatically by CI (the workflow's `permissions: contents: read` already forecloses that).
`compare.ts`'s pure comparison logic is unit-tested (Step 3 of this section) against fixed fake
JSON, independent of actually running benchmarks.
**Files:** `bench/src/run.ts`, `bench/src/compare.ts`, `bench/src/compare.test.ts`,
`bench/package.json` (script wiring).
**Depends on:** Steps 4–6

### Step 8 — CI wiring

**Outcome:** `.github/workflows/ci.yml` gains a `bench` job, `runs-on: ubuntu-latest` only
(not the 3-OS matrix — see Open Questions/rationale), following the exact
checkout/`pnpm/action-setup`/`actions/setup-node`(`cache: pnpm`)/`pnpm install
--frozen-lockfile`/`pnpm -r build` sequence the `test` job already uses (bench imports built
`dist/` output from `core`/`db`/`fixtures`, same as any workspace-linked test), then runs
`pnpm bench`. The `ci-ok` aggregate job's `needs` becomes `[test, bench]` and its shell check
fails unless **both** results are `success`, preserving the single stable required-check name
`CONTRIBUTING.md` documents (no branch-protection reconfiguration needed — `ci-ok` already is
the one required check).
**Files:** `.github/workflows/ci.yml`.
**Depends on:** Step 7

### Step 9 — Docs + initial committed baseline

**Outcome:** `bench/README.md` documents: what each of the (up to five) named benchmarks
measures and why; the 20% regression threshold and how it's computed; that the committed
baseline reflects ubuntu-latest GitHub Actions runner hardware, so a local `pnpm bench` failure
on a dev machine may reflect hardware variance rather than a real regression (and how to tell
the difference — rerun, check the delta magnitude); the exact `bench:update-baseline` workflow
for intentionally updating baselines (regenerate, inspect the diff, commit it in the same PR as
the performance-affecting change, explain why in the PR description per `CLAUDE.md`'s
"evidence: benchmark output" requirement); and the header-scan benchmark's scoped-down nature
plus its P1-01 follow-up note. `CONTRIBUTING.md`'s local-gate section and root `README.md`'s
Commands section each get a one-line pointer. The initial `bench/baselines/results.json` is
generated (via `bench:update-baseline`, run against this issue's own PR's CI or a representative
local ubuntu run) and committed so the very first CI run of the `bench` job on `main` has
something to compare against — not a zero-baseline that trivially "passes" forever.
**Files:** `bench/README.md`, `CONTRIBUTING.md`, `README.md` (root), `bench/baselines/results.json`.
**Depends on:** Step 8

## Edge Cases

- **Chunked vs. monolithic bulk-insert transaction:** one 200k-statement transaction risks WAL
  growth / memory pressure and produces a single unrepresentative number; one transaction per
  row defeats the point of "bulk" (autocommit overhead dominates). Step 3's seed builder uses
  fixed-size sub-transactions — a documented tradeoff, not an implicit default the Reviewer has
  to reverse-engineer.
- **UUIDv7 monotonicity under the largest insert burst the codebase has produced:** P0-04's
  generator already handles same-millisecond bursts (counter bits) and clock rollback, but this
  benchmark is by far the highest-volume exercise of it to date — informational, not expected
  to fail, but worth a passing assertion in Step 3's smoke test.
- **CI runner variance (shared vCPU, noisy neighbor) near the 20% boundary:** a single noisy
  run can false-positive. Not fully solvable in code; mitigated by choosing adequate Vitest
  `bench()` `time`/`iterations` per benchmark (enough samples to reduce variance) and documented
  in `bench/README.md` as a known operational risk with "rerun the job" as the first response,
  not "raise the threshold" (the threshold is the issue's own acceptance criterion).
- **`--frozen-lockfile` after adding the `bench` workspace member and its new dependency
  edges:** the lockfile must be regenerated and committed in this PR (same class of edge case
  P0-02's plan already documented for other packages) or CI's `pnpm install --frozen-lockfile`
  fails immediately on the new job.
- **Baseline drift after legitimate performance work elsewhere** (e.g., a future DD-003 index
  change, or a `better-sqlite3`/Drizzle version bump): must go through the explicit
  `bench:update-baseline` step and land as a reviewed diff in the same PR as the change that
  caused it — CI never writes to the baseline file itself (`permissions: contents: read`).
- **Synthetic target/filter cardinality:** `generate.ts`'s CLI defaults (3 objects, 3 filters)
  would make the aggregate-query benchmark measure a near-degenerate 3×3 bucket space at 100k
  rows — not representative of a real catalog. Step 3 explicitly passes a richer bench-specific
  `GenerateOptions.objects`/`.filters` list (not the CLI defaults) so the query benchmark
  exercises realistic index selectivity.
- **`fixtures/` gaining declaration emit for the first time:** flipping `noEmit: true` off
  could surface latent TypeScript errors in fixture-authoring code that were previously
  invisible (no prior consumer forced strict declaration-compatible types) — Step 1 must run
  `pnpm --filter @astrotracker/fixtures build` and fix any newly-surfaced errors, not just add
  the config.
- **Vitest `bench()` files must not be picked up by `pnpm test`:** the root `vitest.config.ts`
  `bench` project's `include: ['src/**/*.test.ts']` naturally excludes `*.bench.ts` (different
  glob) — verified against the existing `fixtures`/`db` project entries' pattern, not a new
  mechanism.

## Invariant Checklist

- [x] Non-destructive: benchmarks write only to `os.tmpdir()`-scoped temp SQLite files (never
      inside the repo, cleaned up after each run) and to the repo-tracked
      `bench/baselines/results.json` (only via the explicit, human-invoked
      `bench:update-baseline`, never automatically) — no code path touches user image files
- [x] Layering: `bench/` is a root-level dev-tooling workspace member (DD-002's own layout
      diagram places `fixtures/` there; `bench/` is the same kind of thing) with no Electron
      dependency; it depends on `core`/`db`/`fixtures` but adds no code inside `packages/`
- [x] DB: no schema/migration changes — benchmarks exercise the existing DD-003 schema and
      existing repository/index surface as-is
- [x] Timestamps stored UTC: synthetic `date_obs_utc` values come from
      `@astrotracker/fixtures`'s already-UTC-only `generateFrames()`
- [x] Long-running work goes through the worker job queue: N/A — dev/CI tooling, not
      in-app runtime code
- [x] Performance budgets (PRD §8.4): this issue **is** the enforcement mechanism; flag for
      the Reviewer that the header-scan benchmark (Step 6) is a deliberately narrower stand-in
      for "header parse throughput" pending P1-01 — see Open Questions

## Out of Scope

- The actual FITS/XISF/RAW header parser (P1-01/P1-02/P1-03) — Step 6's benchmark measures
  I/O-bound boundary detection only, not card/keyword/value decoding; no parser lands in
  `packages/core` from this issue
- DD-004's full "synthetic 10k-header fixture set must scan (stages 1-3) under a CI-adjusted
  time budget" — that requires PARSE (P1-01) and RESOLVE (P1-04+, target/filter resolution)
  to exist first; this issue benchmarks the three narrower categories the issue text actually
  lists (header-region throughput, bulk DB insert rate, aggregate query latency), not a
  full-pipeline scan benchmark. A follow-up issue should add the full DD-004 scan benchmark
  once those stages exist.
- New `packages/db` repository methods (a formal bulk-insert API, an aggregation query
  method) — benchmarks call the existing public surface; a later Phase 1 issue may formalize
  these APIs using this issue's numbers as justification
- Non-ubuntu CI benchmark gating (windows/macos legs) — `test` still runs on all 3 OSes;
  `bench` is ubuntu-only for cost/noise reasons (see Open Questions)
- Thumbnail-generation throughput ("50 FITS files/sec", PRD §8.4) — no thumbnail pipeline
  exists yet (later phase)
- UI/renderer render-latency benchmarks ("dashboard renders in under 1 second" as perceived in
  the app) — only the backing SQL query latency is measured; no React UI exists yet to render
- Any `packages/desktop` or IPC changes

## Open Questions

1. **"Header parse throughput" scoping — flagged as a real, if narrow, blocker.** No FITS
   header parser exists in the repo (P1-01 hasn't landed; `packages/core` only has the UUIDv7
   generator). This plan's **recommended default** (Step 6) is to benchmark bounded-read +
   END-card block-boundary detection — a genuine, narrow I/O primitive that DD-004 Stage 2
   explicitly calls out ("seek + bounded read") and that will very likely be reused unchanged
   once P1-01 lands — rather than the full card/keyword/value decode, which is P1-01's domain
   logic and would mean writing (and later discarding or reconciling) a second FITS parser
   outside `packages/core`. The alternative, **not** chosen by default, is to drop "header
   parse throughput" from this issue's deliverables entirely (ship only bulk-insert +
   aggregate-query benchmarks now, both fully real) and open a fast-follow issue for the
   header-parse benchmark once P1-01 merges — a cleaner acceptance-criteria story but a
   partial delivery against the issue text as written. Please confirm the recommended default
   (scoped-down proxy benchmark, Step 6 as planned) or direct a switch to the fast-follow
   option before Step 6 starts; Steps 1–5 and 7–9 are unaffected either way.
2. **`bench` CI job scoped to ubuntu-latest only, and folded into the required `ci-ok` gate**
   (defaults chosen, flagged for review, not blocking): cross-OS benchmark comparison would
   need three separate baselines and triples CI cost/noise for numbers that are about relative
   regression, not absolute cross-platform performance; `CLAUDE.md` ("treat regressions as
   build breaks") implies the gate should block merges the same way `test` does, hence folding
   into `ci-ok` rather than making it an advisory-only check.

Plan written: docs/plans/p0-07-benchmark-harness.md — 9 steps

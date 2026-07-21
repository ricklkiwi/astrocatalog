# Spec: [P0-07] Benchmark harness with CI regression gates

**Slug:** p0-07-benchmark-harness **Issue:** #7 **Plan:** docs/archive/tasks/p0-07-benchmark-harness/plan.md **Date:** 2026-07-08

Criteria are tagged `[local]` (Reviewer verifies directly in this worktree/PR diff) or
`[github]` (only observable after push, on the GitHub-hosted Actions run — orchestrator
verifies these on the PR, not the Reviewer locally).

**Orchestrator-decided scope baked into this spec (not open questions — already resolved):**

1. "Header parse throughput" (issue text) is satisfied by Step 6's narrower, honestly-scoped
   benchmark: bounded-read + END-card block-boundary detection (the I/O-bound half of DD-004
   Stage 2's "seek + bounded read"), **not** full 80-char card/keyword/value decoding — no FITS
   parser exists yet (P1-01 hasn't landed). This scope reduction must be stated in the
   benchmark's own output/docs (the `.bench.ts` file itself and `bench/README.md`), not only in
   the PR description — see FR-9/FR-10 below.
2. The `bench` CI job runs `ubuntu-latest` only (not the 3-OS matrix) and is folded into the
   existing required `ci-ok` aggregate check rather than being a separate/advisory check.

## Definition of Done

### Functional Requirements

**Issue-level acceptance criteria (from #7), refined:**

- [ ] `[local]` Given the repo root after this issue lands, when `pnpm bench` is run against an
      unregressed local run, then it exits 0 and prints a console results table to stdout with
      one row per defined benchmark and columns for name, baseline value, current value, delta
      %, and status (`OK`/`REGRESSED`/`NEW`/`MISSING`).
- [ ] `[local]` Given `bench/baselines/results.json`, when the repo is inspected, then the file
      exists, is tracked by git (not gitignored), and contains one result entry per benchmark
      defined in `bench/src/*.bench.ts`, each with `name`, `unit`, `higherIsBetter: true`,
      non-zero finite `value`, and a finite `samples[]` array (an all-zero, placeholder, `NaN`,
      or `Infinity` baseline does not satisfy "baselines stored in repo").
- [ ] `[local]` Given `bench/src/compare.ts`, when a benchmark's current-run value regresses
      more than 20% versus its baseline entry (matched by benchmark name on a higher-is-better
      rate metric), then the process exits non-zero and that row prints `REGRESSED` in the table;
      exactly `-20.0%` remains `OK`.
- [ ] `[local]` Given a benchmark name present in the current run but absent from the baseline
      (or vice versa — present in baseline, absent from current), then that row prints
      `NEW`/`MISSING` respectively and does **not** affect the process exit code.
- [ ] `[local]` Given `bench/src/compare.ts`, when a current-run or baseline metric is malformed
      (missing required fields), declares an unexpected unit or `higherIsBetter` flag, or carries
      a non-finite numeric value, then `pnpm bench` fails fast with an explicit error instead of
      silently computing a misleading delta or passing the gate.
- [ ] `[github]` Given `.github/workflows/ci.yml`, when a PR triggers CI, then a `bench` job runs
      on `ubuntu-latest` only, executes `pnpm bench`, and the `ci-ok` aggregate job's result
      depends on both `test` and `bench` succeeding.
- [ ] `[local]` Given `.github/workflows/ci.yml`, when read, then the existing `test` job remains
      a three-OS matrix over `ubuntu-latest`, `windows-latest`, and `macos-latest`; the new
      `bench` job is additive and ubuntu-only, not a replacement for cross-OS CI coverage.
- [ ] `[local]` Given `.github/workflows/ci.yml`, when read, then the `bench` job follows the
      same checkout → `pnpm/action-setup` (no `version:` key) → `actions/setup-node`
      (`node-version: 26`, `cache: pnpm`) → `pnpm install --frozen-lockfile` → `pnpm -r build`
      sequence as the existing `test` job, then runs `pnpm bench`.
- [ ] `[local]` Given `.github/workflows/ci.yml`'s `ci-ok` job, when read, then its `needs` array
      is exactly `[test, bench]`, it retains `if: always()`, and its shell check fails non-zero
      unless **both** `needs.test.result == 'success'` and `needs.bench.result == 'success'`
      (a bare `needs: [test, bench]` with no explicit per-result check does not satisfy this —
      same pattern as the existing `test`-only check).
- [ ] `[local]` Given `bench/README.md`, when read, then it documents: what each named benchmark
      measures, the 20% regression threshold and how it is computed, that the committed baseline
      reflects `ubuntu-latest` GitHub Actions hardware (so local failures may be hardware
      variance, not a real regression), and the exact `bench:update-baseline` workflow for
      intentionally updating baselines (regenerate, inspect the diff, commit in the same PR,
      explain why per `CLAUDE.md`'s "evidence: benchmark output" rule).
- [ ] `[local]` Given `bench/README.md`, when read, then it makes the current suite's scope
      explicit: DB insert and aggregate-query benchmarks operate on a deterministic 100k-frame
      synthetic dataset today, while DD-004's full 10k-file stages-1-3 scan budget remains a
      follow-up and is not claimed as implemented by this issue.

**Header-scan scope-reduction disclosure (orchestrator decision item 1):**

- [ ] `[local]` Given `bench/src/header-scan.bench.ts`, when read, then it contains an explicit
      comment (not just a code identifier) stating this benchmark measures bounded-read +
      END-card block-boundary detection only — not full 80-char card/keyword/value decoding,
      CONTINUE-convention handling, or `headers_json` construction — and that it should be
      revisited once P1-01's real FITS header parser lands.
- [ ] `[local]` Given `bench/README.md`'s section describing the header-scan benchmark, when
      read, then it states the same scope-reduction fact (not full header decode; I/O-bound
      boundary detection only) and names the P1-01 follow-up — this is the "own output/docs, not
      just the PR description" requirement from the orchestrator's scoping decision; a PR
      description alone stating this does not satisfy the criterion.
- [ ] `[local]` Given the console results table `pnpm bench` prints, when the header-scan
      benchmark's row is inspected, then its printed name is unambiguous about scope (e.g.
      `header-scan-boundary-detection` or similar — not a bare `header-parse`/`fits-parse` name
      that would misleadingly imply full decode throughput).

**Package/workspace wiring (Steps 1–2, prerequisite for the above):**

- [ ] `[local]` Given `pnpm-workspace.yaml`, when read, then `bench` is listed as a workspace
      member; `pnpm -r list --depth -1` includes `@astrotracker/bench`.
- [ ] `[local]` Given `bench/package.json`, when read, then it is private, named
      `@astrotracker/bench`, depends on `@astrotracker/core`, `@astrotracker/db`, and
      `@astrotracker/fixtures` as `workspace:*`, and defines `build`, `lint`, `test`, `bench`,
      and `bench:update-baseline` scripts.
- [ ] `[local]` Given root `package.json`, when read, then it defines `bench` (runs
      `bench/src/run.ts` producing the table + gate) and `bench:update-baseline` (runs the same
      benchmarks and overwrites `bench/baselines/results.json` without gating) scripts —
      matching the commands `CLAUDE.md` already documents.
- [ ] `[local]` Given `fixtures/package.json`, when read, then it declares `main`/`types`/an
      `exports` map (not just `scripts`), and `fixtures/tsconfig.json` no longer sets
      `noEmit: true` (declaration emit enabled), matching the shape `core`/`db` already use.
- [ ] `[local]` Given `fixtures/src/index.ts`, when read, then it re-exports `generateFrames`,
      `GenerateOptions`, `GeneratedFrame`, `WeightedEntry`, and `ProfileName` from
      `fixtures/src/generate.ts`, and after `pnpm --filter @astrotracker/fixtures build`,
      `import { generateFrames } from '@astrotracker/fixtures'` resolves from another workspace
      package (i.e. `bench/`) without shelling out to the CLI.
- [ ] `[local]` Given `fixtures/src/generate.ts`'s existing CLI entry (`main()`/`run()`), when
      diffed against pre-issue behavior, then it is functionally unchanged — this issue only
      exposes new exports, per the plan's Step 1 note that this is additive, not a behavior
      change.
- [ ] `[local]` Given `pnpm --filter @astrotracker/fixtures build` after `noEmit: true` is
      removed, then it exits 0 with no newly-surfaced TypeScript errors (the plan's Edge Case:
      flipping declaration emit on for the first time could surface latent type errors that a
      prior CLI-only consumer never forced).

**Seed builder, benchmarks, and comparator (Steps 3–7):**

- [ ] `[local]` Given `bench/src/lib/seed-db.ts`, when invoked with a count and seed, then it
      builds a temp-file `AstroDatabase` under `node:os.tmpdir()` (via `mkdtempSync`, never
      inside the repo), seeds `watch_folders`/`targets`/`filters` rows, calls `generateFrames()`
      for N synthetic frames, and inserts corresponding `files`/`frames` rows with
      `frameTypeSource: 'header'` and `targetId`/`filterId` resolved from the pre-created lookup
      tables — returning both the open `AstroDatabase` handle and the raw `GeneratedFrame[]`.
- [ ] `[local]` Given `bench/src/benchmarks.ts`, when read, then the suite's dataset-shaping
      inputs are fixed named constants — including the 100k-frame corpus size, deterministic seed,
      and fixed header-scan subset/repeat counts — so every gated run measures the same synthetic
      workload shape rather than an ad hoc or time-varying one.
- [ ] `[local]` Given `bench/src/lib/seed-db.ts`'s row-insertion strategy, when read, then rows
      are inserted via fixed-size sub-transactions (neither one 200k-statement transaction nor
      one transaction per row) — a chunk size is a named constant, not a magic inline number.
- [ ] `[local]` Given `bench/src/lib/seed-db.ts`'s target/filter name pool, when read, then it is
      a bench-specific `GenerateOptions.objects`/`.filters` list with dozens of weighted entries
      (not `generate.ts`'s 3-object/3-filter CLI default), so the aggregate-query benchmark
      exercises realistic index cardinality rather than a degenerate 3×3 bucket space.
- [ ] `[local]` Given `bench/src/db-insert.bench.ts`, when read, then its timed region covers
      only the `repos.files.insert()`/`repos.frames.insert()` calls inside `db.transaction()`
      for a dataset already generated in memory before timing starts — `generateFrames()`'s own
      cost is excluded from the timed region — and it reports a rows/sec (files+frames combined)
      metric via the `bench()` name.
- [ ] `[local]` Given `bench/src/db-insert.bench.ts`, when read, then it calls the existing
      public `CrudRepository`/`db.transaction()` surface from `packages/db` exactly as shipped by
      P0-04 — no new repository method is added anywhere in this diff.
- [ ] `[local]` Given `bench/src/aggregate-query.bench.ts`, when read, then it seeds one 100k-frame
      DB once (setup outside any timed benchmark region) and times two query shapes: (a) the
      global `SUM(exposure_seconds) GROUP BY target_id, filter_id` rollup restricted to
      `frame_type = 'light'` (DD-003's own worked example, exercising the
      `frames(target_id, filter_id, frame_type)` index), and (b) a single-target drill-down
      (`WHERE target_id = :id AND frame_type = 'light' GROUP BY filter_id`) mapping to PRD
      §8.4's "target dashboard... under 1 second" budget.
- [ ] `[local]` Given `bench/src/aggregate-query.bench.ts`, when read, then both query shapes are
      raw Drizzle `sql`/query-builder statements (no new repository/aggregation method added).
- [ ] `[local]` Given `bench/src/header-scan.bench.ts`, when read, then it operates only on
      in-memory `GeneratedFrame.bytes` (no disk I/O), walks 2880-byte blocks using
      `BLOCK_BYTES`/`CARD_BYTES` constants imported from `@astrotracker/fixtures`'s FITS builder
      lib (not re-declared locally), and returns header byte-length/block-count by locating the
      literal `END` card.
- [ ] `[local]` Given `bench/src/run.ts`, when read, then it calls `runAllBenchmarks()` directly
      (not Vitest JSON output) to obtain the fresh metrics, prints the comparator table against
      `bench/baselines/results.json`, and on `--update-baseline` writes `schemaVersion`,
      `generatedAt`, and the fresh metric records (`name`, `unit`, `higherIsBetter`, `value`,
      `samples`) straight to `bench/baselines/results.json` before exiting 0 without gating.
- [ ] `[local]` Given `bench/src/compare.ts`, when read, then its regression math is
      `(current - baseline) / baseline` on higher-is-better rate metrics, matched by benchmark
      name (string equality, not positional/index matching), and a row is `REGRESSED` only when
      `deltaPercent < -0.20` (not when it is exactly `-0.20`).
- [ ] `[local]` Given the root `vitest.config.ts`, when read, then it gains a `bench` project
      (`root: './bench'`, `include: ['src/**/*.test.ts']`) matching the existing
      `core`/`db`/`desktop`/`fixtures` project shape, and this glob does **not** match
      `*.bench.ts` files — `pnpm test` (root `vitest run`) must not execute any actual benchmark.

**Docs (Step 9):**

- [ ] `[local]` Given `CONTRIBUTING.md`, when read, then its local-gate section now mentions
      `pnpm bench` and how to distinguish hardware variance from a real local regression (rerun,
      check delta magnitude — per the plan's stated first response, not "raise the threshold").
- [ ] `[local]` Given root `README.md`, when read, then its Commands section lists both
      `pnpm bench` and `pnpm bench:update-baseline`.
- [ ] `[local]` Given `pnpm-lock.yaml`, when inspected after adding the `bench` workspace member
      and its dependency edges, then it is regenerated/committed in this PR —
      `pnpm install --frozen-lockfile` (as CI's `bench`/`test` jobs run it) succeeds against the
      committed lockfile without modification.

### Data Integrity

- [ ] N/A — no database schema, table, or migration is introduced or touched by this issue.
      Benchmarks exercise the existing DD-003 schema and existing repository/index surface as-is
      (Reviewer confirms no file under `packages/db/src/schema/**` or `packages/db/drizzle/**`
      changes in the diff).

### Core Invariants

- [ ] No code path in the diff writes, moves, renames, or deletes files outside the app-data
      directory: adapted — benchmarks write only to `os.tmpdir()`-scoped temp SQLite files
      (created via `mkdtempSync`, never inside the repo, cleaned up after each run/suite) and to
      the repo-tracked `bench/baselines/results.json`, and the latter is written **only** by the
      explicit, human-invoked `bench:update-baseline` path — never by the default `pnpm bench`
      gate path and never automatically by CI (the workflow's `permissions: contents: read`
      already forecloses a CI write). Reviewer greps `bench/src/**` for
      `fs.write*`/`fs.rename*`/`mkdtempSync`/`fs.unlink*`/`fs.rm*` calls and verifies every
      non-tmpdir target is `bench/baselines/results.json`, reached only from the
      `--update-baseline` code path.
- [ ] New domain logic is in packages/core with no Electron/fs imports: N/A/adapted — this issue
      adds no `packages/core` code. Reviewer instead verifies `bench/` has no `electron` import
      anywhere and no dependency on `packages/desktop` (bench is dev-tooling, per DD-002's module
      layout placing it alongside `fixtures/` outside `packages/`).
- [ ] All persisted timestamps are UTC: applies — the only "persisted" timestamps in this issue's
      code path are synthetic `date_obs_utc` values passed through from
      `@astrotracker/fixtures`'s already-UTC-only `generateFrames()`; `bench/src/lib/seed-db.ts`
      introduces no new timestamp construction/formatting logic of its own.
- [ ] Manual user overrides (target/filter/type/session assignments) survive a rescan: N/A — this
      issue has no scanning, assignment, or session logic; it seeds synthetic data directly via
      repository calls, not through a scan pipeline.
- [ ] Long-running work goes through the worker job queue: N/A — this is dev/CI tooling
      (benchmarks and their comparator), not in-app runtime code; nothing here runs inside the
      Electron app or a worker thread.

### Performance

- [ ] This issue **is** the performance-enforcement mechanism (PRD §8.4) rather than a consumer
      of an existing budget — its own "performance requirement" is that `pnpm bench` completes in
      a CI-practical wall-clock time (the plan does not fix an exact ceiling; Reviewer flags only
      a run so slow it would make the `bench` CI job an obvious contributor to CI flakiness/cost,
      not a specific numeric SLA).
- [ ] `[local]` Given the aggregate-query benchmark's single-target drill-down shape, when its
      benchmark name/comment is read, then it explicitly cites PRD §8.4's "target dashboard...
      under 1 second" as the budget it stands in for — this benchmark measures only the backing
      SQL query latency, not full UI render time (no React UI exists yet); this distinction must
      be stated in-repo (bench file comment or `bench/README.md`), not left implicit.
- [ ] `[local]` Given `bench/src/compare.ts`, when read, then the 20% regression threshold is a
      single named constant (not duplicated/hardcoded in multiple places), and its value is
      documented in `bench/README.md` alongside the computation formula.
- [ ] No hard-coded _absolute_-time pass/fail assertion is required anywhere in `bench/` beyond
      the relative regression gate — the plan deliberately scopes this issue to relative
      regression detection against a committed baseline, not absolute-budget enforcement inside
      the benchmark files themselves; the Reviewer must not require one.

### Tests

- [ ] Table-driven unit tests in `bench/src/compare.test.ts` cover, against fixed fake result/baseline
      JSON (no real benchmark execution): an unregressed run (small negative or positive delta
      under threshold) prints `OK` and exits 0; a >20% regression prints `REGRESSED` and exits
      non-zero; a benchmark improving (positive delta, current higher than baseline) prints `OK`
      (never flagged as a problem); a benchmark name present only in the current run prints `NEW`
      and does not affect exit code; a benchmark name present only in the baseline prints
      `MISSING` and does not affect exit code; multiple simultaneous regressions across different
      benchmarks are all reported and the process still exits non-zero exactly once (not once per
      regression).
- [ ] `bench/src/compare.test.ts` explicitly asserts the comparator's behavior at exactly a 20.0%
      regression: the row remains `OK`, `hasRegression(...)` stays false, and the test locks in
      the exact plan-mandated `deltaPercent < -0.20` semantics instead of leaving `>` vs `>=`
      ambiguous.
- [ ] `bench/src/compare.test.ts` includes malformed-metric cases covering: a non-finite
      `value`/sample, a missing required field, and unexpected unit or `higherIsBetter` metadata;
      each case fails deterministically with an explicit error instead of yielding `OK`/`NEW`/
      `MISSING` output from partially-invalid input.
- [ ] `bench/src/lib/seed-db.test.ts` is a small-N (not 100k) smoke test asserting: row counts in
      `files`/`frames`/`targets`/`filters` match the requested count/lookup-table size, every
      `frames.targetId`/`frames.filterId` foreign key resolves to a row that exists (no orphan
      references), and `frameTypeSource` is `'header'` on every inserted frame row.
- [ ] `bench/src/lib/seed-db.test.ts` includes a passing assertion on UUIDv7 monotonicity/validity
      across the largest insert burst this smoke test produces (per the plan's Edge Case — this
      is the highest-volume exercise of P0-04's UUIDv7 generator to date; informational, not
      expected to fail, but asserted rather than merely hoped for).
- [ ] All existing tests still pass: `pnpm -r test` and root `pnpm test` (which now includes the
      `bench` project's `compare.test.ts`/`seed-db.test.ts`, but not any `*.bench.ts` file) both
      exit 0.
- [ ] E2E: N/A — this issue has no UI or Electron surface; no Playwright scenario applies.

## Out of Scope

Copied from the plan and expanded — the Reviewer must not flag any of the following as missing:

- The actual FITS/XISF/RAW header parser (P1-01/P1-02/P1-03) — Step 6's benchmark measures
  I/O-bound boundary detection only, not card/keyword/value decoding; no parser lands in
  `packages/core` from this issue.
- DD-004's full "synthetic 10k-header fixture set must scan (stages 1-3) under a CI-adjusted
  time budget" — that requires PARSE (P1-01) and RESOLVE (P1-04+) to exist first; this issue
  benchmarks only the three narrower categories the issue text lists (header-region throughput,
  bulk DB insert rate, aggregate query latency), not a full-pipeline scan benchmark. A follow-up
  issue should add the full DD-004 scan benchmark once those stages exist.
- New `packages/db` repository methods (a formal bulk-insert API, an aggregation query method) —
  benchmarks call the existing public `CrudRepository`/`db.transaction()` surface as-is; a later
  Phase 1 issue may formalize these APIs using this issue's numbers as justification.
- Non-ubuntu CI benchmark gating (windows/macos legs) — `test` still runs on all 3 OSes; `bench`
  is ubuntu-only per the orchestrator's scoping decision.
- Thumbnail-generation throughput ("50 FITS files/sec", PRD §8.4) — no thumbnail pipeline exists
  yet (later phase).
- UI/renderer render-latency benchmarks ("dashboard renders in under 1 second" as perceived in
  the app) — only the backing SQL query latency is measured; no React UI exists yet to render.
- Any `packages/desktop` or IPC changes.
- Exact numeric baseline values committed in `bench/baselines/results.json` — these are
  hardware-dependent (ubuntu-latest GitHub Actions runner) and not independently verifiable by
  the Reviewer from a local machine; Reviewer checks the file's _shape_ (one entry per benchmark,
  non-zero/non-placeholder values) and that it was generated via `bench:update-baseline`, not its
  exact numbers.
- Exact Vitest `bench()` `time`/`iterations` tuning values — the plan requires "adequate samples
  to reduce variance," not a specific number; Reviewer does not require a particular config value.
- Exact prose/wording of `bench/README.md`/`CONTRIBUTING.md`/`README.md` beyond the required
  content items listed above — Reviewer checks content presence, not phrasing.
- Actually triggering/observing a real CI regression end-to-end — that is a `[github]` criterion
  verified by the orchestrator post-push (see Test Hints), not something the Reviewer can
  establish by reading the diff alone.

## Test Hints

- **bench-workspace-member**: `pnpm -r list --depth -1` includes `@astrotracker/bench`.
- **fixtures-barrel-export**: after `pnpm --filter @astrotracker/fixtures build`, write a scratch
  script importing `{ generateFrames } from '@astrotracker/fixtures'` from outside the package;
  assert it resolves and runs without shelling out to the CLI.
- **results-table-shape**: run `pnpm bench` locally; assert stdout contains a table with
  name/baseline/current/delta/status columns and one row per `*.bench.ts` benchmark defined.
- **compare-ok**: feed `compare.ts` a fake current-run JSON with a benchmark 5% slower than its
  baseline entry; assert exit 0, row status `OK`.
- **compare-regressed**: feed `compare.ts` a fake current-run JSON with a benchmark 25% slower
  than its baseline entry; assert non-zero exit, row status `REGRESSED`.
- **compare-boundary**: feed `compare.ts` a fake current-run JSON with a benchmark exactly 20.0%
  slower; assert the row remains `OK`, `hasRegression(...)` is false, and this exact
  `deltaPercent === -0.20` case is covered by a `compare.test.ts` assertion.
- **compare-new-missing**: feed `compare.ts` fake JSON with one benchmark name absent from the
  baseline and one baseline benchmark name absent from the current run; assert exit 0 (neither
  affects gating) and rows print `NEW`/`MISSING` respectively.
- **compare-improvement**: feed `compare.ts` a fake current-run JSON with a benchmark 15% faster
  than baseline; assert exit 0, row status `OK` (never flagged).
- **compare-invalid-metric**: feed `compare.ts` fake JSON containing `NaN`, `Infinity`, a missing
  `value`, or mismatched `unit`/`higherIsBetter`; assert it throws or exits non-zero with an
  explicit invalid-metric error rather than producing a comparison row.
- **update-baseline-writes-unconditionally**: run `pnpm bench:update-baseline` against a scratch
  copy of the repo where the in-memory run would have "regressed" versus the existing baseline;
  assert `bench/baselines/results.json` is overwritten with the new numbers and the process still
  exits 0 (no gating on this path).
- **seed-db-smoke**: run `seed-db.ts`'s builder with a small N (e.g. 500); assert `files`/`frames`
  row counts equal N, every `frames.targetId`/`filterId` resolves to an existing row, and
  `frameTypeSource === 'header'` on every row.
- **header-scan-no-disk-io**: run the header-scan benchmark's core function directly against a
  `GeneratedFrame.bytes` buffer (not through Vitest's `bench()` timer); assert it never touches
  `fs` and correctly reports the header's block count against a fixture with a known END-card
  position (reuse the P0-06 fixtures' 36-card vs 37-card block-boundary edge cases if convenient).
- **ci-workflow-bench-job** `[local]`: read `.github/workflows/ci.yml`; assert a `bench` job
  exists with `runs-on: ubuntu-latest` (no matrix), the same setup-step sequence as `test`, a
  `pnpm bench` step, and `ci-ok`'s `needs` is `[test, bench]` with an explicit check that both
  results are `success`.
- **ci-workflow-cross-os-matrix** `[local]`: read `.github/workflows/ci.yml`; assert the `test`
  job still declares the `ubuntu-latest` / `windows-latest` / `macos-latest` matrix after the
  `bench` job is added.
- **readme-scope-disclosure** `[local]`: `grep -n "P1-01"` `bench/README.md` and
  `bench/src/header-scan.bench.ts`; assert both mention the scope reduction (boundary-detection
  only, not full card decode) and the P1-01 follow-up.
- **readme-10k-vs-100k-scope** `[local]`: read `bench/README.md`; assert it states that today's
  DB/query benchmarks use a deterministic 100k-frame synthetic dataset and that the full DD-004
  10k-file stages-1-3 scan benchmark remains future work, not current scope.
- **lockfile-frozen-install** `[local]`: from a clean checkout, run
  `pnpm install --frozen-lockfile`; assert it succeeds without modifying `pnpm-lock.yaml`.
- **github-bench-ci-green** `[github]`: on this issue's own PR, fetch check-run statuses for
  `bench (ubuntu-latest)` (or equivalently named job) and `ci-ok`; assert both `success`.
- **github-regression-gate-fires** `[github]`: orchestrator, on a scratch branch/PR off this
  change, deliberately lowers a baseline value in `bench/baselines/results.json` (simulating a
  regression without needing a real perf change) and pushes; assert the `bench` job's `pnpm
bench` step fails and `ci-ok` goes red — the actual end-to-end firing of the regression gate
  on GitHub Actions, which cannot be established by reading the diff alone.

Spec written: docs/archive/tasks/p0-07-benchmark-harness/spec.md — 53 criteria

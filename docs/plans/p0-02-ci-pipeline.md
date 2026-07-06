# Plan: [P0-02] GitHub Actions CI pipeline

**Slug:** p0-02-ci-pipeline   **Issue:** #2   **Date:** 2026-07-06
**Governing DDs:** DD-001 (tech stack — "CI: GitHub Actions: lint, typecheck, unit tests, package on Win+mac")
**Status:** READY_FOR_SPEC

Also folds in two open backlog issues that are natural parts of this work:

- **#45** — migrate the deprecated `vitest.workspace.ts` (`defineWorkspace`, deprecated since
  Vitest 3.2) to a root `vitest.config.ts` using `test.projects`, so CI is not built on a
  deprecated entry point.
- **#46** — add root-level lint/format coverage for root config files (`eslint.config.mjs`,
  the new `vitest.config.ts`, root `package.json`, docs), which today are covered by no
  package's `lint` script — CI would otherwise never check the very files that define CI.

## Summary

This issue gives every subsequent PR an automated quality gate: a GitHub Actions workflow
triggered on pushes to `main` and on all pull requests that runs install → typecheck/build →
lint → unit tests across an `ubuntu-latest` / `windows-latest` / `macos-latest` matrix, with
the pnpm store cached per-OS. A second, separate workflow is a manual-dispatch packaging stub
that P0-03 will later fill with electron-builder steps. Because the matrix includes Windows,
the plan also normalizes line endings via `.gitattributes` (Prettier enforces LF; a CRLF
checkout on the Windows runner would fail `prettier --check` spuriously). Branch protection
itself is a repo-settings action a human performs once; this issue delivers the documentation
for it in a new `CONTRIBUTING.md`, plus a single aggregate `ci-ok` job so the required status
check has one stable name that survives matrix changes.

## Affected Files

- `vitest.config.ts` (root) — new; replaces `vitest.workspace.ts` with `defineConfig` +
  `test.projects` carrying over the same four named projects (`core`, `db`, `desktop`,
  `renderer`) with the same `root`/`include` scoping (#45)
- `vitest.workspace.ts` — deleted (#45)
- `package.json` (root) — modified; root `test` script switches from `pnpm -r test` to
  `vitest run` (single-process run of all projects — what CI invokes); new `lint:root` script
  covering root config files; root `lint` becomes `pnpm run lint:root && pnpm -r lint`;
  new `typecheck` convenience alias (#46 + CI wiring)
- `.gitattributes` — new; force LF for text files so Windows runners check out what Prettier
  and `.editorconfig` expect
- `.github/workflows/ci.yml` — new; the push/PR CI workflow with the 3-OS matrix, pnpm
  caching, and the `ci-ok` aggregate job
- `.github/workflows/package.yml` — new; manual-dispatch (`workflow_dispatch`) packaging stub
  for P0-03 to extend
- `CONTRIBUTING.md` — new; contributor workflow (from CLAUDE.md's working agreements) plus
  the branch-protection setup documentation the acceptance criteria require
- `README.md` — modified; Commands section gains the root `pnpm test` / `pnpm lint` /
  `pnpm typecheck` forms and a one-line pointer to CI + CONTRIBUTING.md
- Various `*.md` / `*.json` root files — reformatted once by `pnpm format` so the new
  root-level `prettier --check .` passes from day one (#46)

Not touched (verified, reasons noted):

- Per-package `package.json` `lint`/`test` scripts — still valid for scoped local runs;
  `pnpm -r lint` remains part of the root `lint` gate. Only the root `test` alias changes.
- `eslint.config.mjs` — no rule changes needed; flat config already resolves for root-level
  `.mjs`/`.ts` files, and its `ignores` (dist/node_modules/coverage) don't exclude them.
  Root files are linted without type-aware rules, which `tseslint.configs.recommended`
  supports (no `parserOptions.project` required).
- `tsconfig.base.json`, per-package `tsconfig.json` — the CI typecheck reuses the existing
  `tsc -p` builds; no compiler changes.

## Implementation Steps

### Step 1 — Migrate `vitest.workspace.ts` → root `vitest.config.ts` with `test.projects` (#45)

- **Outcome:** A root `vitest run` executes all four projects (`core`, `db`, `desktop`,
  `renderer`) exactly as the workspace file did — same project names, same per-project
  `root` and `include: ['src/**/*.test.ts']` scoping (so `desktop` still never picks up the
  nested `renderer` member's tests) — with no deprecation warning. `vitest.workspace.ts` is
  gone. The root `package.json` `test` script becomes `vitest run`, giving CI a single
  command and single reporter output; `pnpm -r test` still works per package.
- **Files:** `vitest.config.ts` (new), `vitest.workspace.ts` (deleted), root `package.json`
- **Depends on:** none

### Step 2 — Root-level lint/format coverage (#46)

- **Outcome:** `pnpm lint` at the root now fails if `eslint.config.mjs`, `vitest.config.ts`,
  or any root-level markdown/JSON/config file violates lint or Prettier formatting — today
  these files are checked by nothing (each package lints only its own `src/`). Concretely:
  a new root script `lint:root` runs ESLint over the root config files
  (`eslint eslint.config.mjs vitest.config.ts`) and `prettier --check .` over the whole repo
  (`.prettierignore` already excludes `pnpm-lock.yaml`, `dist/`, `node_modules/`,
  `coverage/`); the root `lint` script becomes `pnpm run lint:root && pnpm -r lint`.
  A one-time `pnpm format` run normalizes any currently-unformatted root files (e.g.
  `README.md`, `issues-phase-0-1.json`, `docs/plans/*.md`) so the new check starts green.
  Per-package Prettier checks overlap with the root sweep; that duplication is harmless and
  keeps `pnpm lint` inside a single package meaningful.
- **Files:** root `package.json`; any root/docs files `pnpm format` rewrites
- **Depends on:** Step 1 (so `vitest.config.ts` exists to be added to the ESLint file list,
  and the deleted workspace file isn't referenced)

### Step 3 — Line-ending normalization for the Windows runner

- **Outcome:** A fresh clone on any OS — including `windows-latest` with git's default
  `core.autocrlf=true` — checks out LF text files, so `prettier --check` (LF is Prettier 3's
  default `endOfLine`) and `.editorconfig` agree with what's on disk. Achieved with a root
  `.gitattributes` declaring `* text=auto eol=lf` (with binary exceptions as fixtures arrive
  later; none exist yet). The repo's existing files are re-normalized
  (`git add --renormalize .`) in the same change so the attributes file isn't a lie.
- **Files:** `.gitattributes` (new)
- **Depends on:** none (but must land with/before Step 4, or Windows CI fails on formatting)

### Step 4 — CI workflow (`.github/workflows/ci.yml`)

- **Outcome:** Every push to `main` and every pull request runs a `test` job across a
  `fail-fast: false` matrix of `ubuntu-latest`, `windows-latest`, `macos-latest` that:
  checks out (`actions/checkout`), installs pnpm via `pnpm/action-setup` **with no `version`
  input** (it reads the pinned `pnpm@10.34.4` from the root `packageManager` field — one
  source of truth, no drift), installs Node 24 via `actions/setup-node` with `node-version: 24`
  and `cache: pnpm` (caches the pnpm store keyed per-OS + lockfile hash), then runs
  `pnpm install --frozen-lockfile`, `pnpm -r build` (the typecheck step — `tsc -p` per
  package in dependency order, which also produces the `dist/` output the workspace-linked
  imports and tests resolve against), `pnpm lint` (root sweep + per-package, from Step 2),
  and `pnpm test` (root Vitest projects run, from Step 1). A final `ci-ok` job with
  `needs: [test]` and `if: always()` fails unless every matrix leg succeeded — giving branch
  protection a single stable check name that won't break when the matrix changes. The
  workflow sets `permissions: contents: read`, restricts the `push` trigger to `main`
  (PR branches are covered by the `pull_request` trigger — no double runs), and uses a
  `concurrency` group keyed on workflow+ref with `cancel-in-progress: true` so superseded
  PR pushes don't queue.
- **Files:** `.github/workflows/ci.yml`
- **Depends on:** Steps 1–3

### Step 5 — Packaging workflow stub (`.github/workflows/package.yml`)

- **Outcome:** A separate workflow, trigger `workflow_dispatch` only, exists as the future
  home of electron-builder packaging (P0-03 adds the real steps; DD-001 scopes packaging to
  Windows + macOS, so its matrix is `windows-latest` + `macos-latest`). When dispatched
  manually today it must succeed: it performs the same checkout/pnpm/node/install setup as
  CI, then a clearly-labeled no-op step stating that packaging lands in P0-03 and exits 0.
  Keeping the setup steps real (not just an echo) means the stub already validates that
  install works on both packaging OSes and that P0-03 only has to append builder steps.
- **Files:** `.github/workflows/package.yml`
- **Depends on:** Step 4 (reuses its setup step sequence; conceptual dependency only)

### Step 6 — `CONTRIBUTING.md` with branch-protection documentation

- **Outcome:** A contributor (or the repo admin) can read `CONTRIBUTING.md` and (a) follow
  the PR workflow — branch naming `<issue-id>-short-slug`, conventional commits, squash
  merge, one issue per PR, acceptance-criteria checklist in the PR description (all lifted
  from CLAUDE.md so the two documents agree), local gate commands
  (`pnpm install && pnpm -r build && pnpm lint && pnpm test`); and (b) configure branch
  protection for `main` step by step: Settings → Branches → Add branch protection rule →
  pattern `main` → "Require a pull request before merging" → "Require status checks to pass
  before merging" with **`ci-ok`** as the required check → "Require branches to be up to
  date before merging". The doc states explicitly that `ci-ok` (not the individual matrix
  legs) is the required check and why (matrix renames would silently orphan per-leg required
  checks). README gains a short "Contributing / CI" pointer and the updated root commands.
- **Files:** `CONTRIBUTING.md` (new), `README.md`
- **Depends on:** Step 4 (check name must match the workflow)

### Step 7 — Verification: green matrix on all three OSes

- **Outcome:** The full local gate passes from a clean checkout
  (`pnpm install && pnpm -r build && pnpm lint && pnpm test`); the PR for this issue shows
  the CI workflow green on ubuntu, windows, and macos plus a green `ci-ok`; after merge, the
  push-to-`main` run is green (first acceptance criterion); a manual dispatch of the
  packaging stub succeeds on both of its OSes. Evidence (run links / check names) goes in
  the PR description per CLAUDE.md.
- **Files:** none (verification only)
- **Depends on:** Steps 1–6

## Edge Cases

- **Windows CRLF checkout vs. Prettier LF:** without Step 3's `.gitattributes`,
  `windows-latest` checks out CRLF (runner git defaults to `autocrlf=true`) and
  `prettier --check` fails on every file while ubuntu/macos pass — an OS-dependent red that
  looks like a formatting regression. `.gitattributes` + renormalize is the fix; do not
  paper over it with a `git config` step in the workflow (local Windows contributors would
  still hit it).
- **`pnpm install --frozen-lockfile` after a `package.json` edit without a lockfile
  regeneration:** CI must fail (that's the point of the flag) — the plan intentionally does
  not use plain `pnpm install`, which would silently rewrite the lockfile on the runner.
- **`pnpm/action-setup` with both a `version` input and `packageManager` present:** the two
  can disagree and the action errors (or worse, wins silently in older versions). Omit
  `version` everywhere; `packageManager: pnpm@10.34.4` is the single pin. Same rule for the
  packaging stub.
- **Renaming/adding matrix legs after branch protection is configured:** per-leg required
  checks (e.g. `test (ubuntu-latest)`) become permanently-pending orphans and block all
  merges. The aggregate `ci-ok` job exists precisely for this; CONTRIBUTING.md documents
  requiring only `ci-ok`.
- **`ci-ok` with `needs` + default behavior on skipped/failed legs:** a plain
  `needs: [test]` job is *skipped* (not failed) if a leg fails, and GitHub treats a skipped
  required check as… still pending/neutral depending on context. The job must use
  `if: always()` and explicitly fail when `needs.test.result != 'success'`.
- **Root `vitest run` finding zero tests in a project:** if a project's `include` pattern or
  `root` is wrong after the #45 migration, Vitest can pass while silently running fewer test
  files than before. Verification for Step 1 must compare the reported project names and
  test-file counts against the pre-migration `vitest.workspace.ts` run (currently 4 projects,
  one placeholder test file each).
- **`desktop` project globbing into `renderer`:** the workspace file scoped `desktop` to its
  own `src/` specifically to avoid picking up the nested member's tests — the migrated
  `test.projects` entries must preserve per-project `root` + `include` exactly, not switch
  to a `packages/*` glob (which would also miss the nested `packages/desktop/renderer`).
- **Tests import workspace packages via `dist/`:** `@astrotracker/db` and
  `@astrotracker/desktop` import siblings through `exports` → `./dist/index.js`, so `pnpm test`
  on a clean runner fails with module-not-found unless `pnpm -r build` runs first. CI step
  order (build before test) is load-bearing; CONTRIBUTING.md's local gate lists the same
  order.
- **Double CI runs on PRs:** `on: push` without a branch filter runs every branch push *and*
  the PR event — two runs per push, slower feedback, wasted minutes. Restrict `push` to
  `main`.
- **First run on each OS has a cold pnpm cache:** expected; `setup-node`'s cache key
  includes the OS, so the three legs never share (or poison) each other's store. No action
  needed beyond knowing the first run is slower.
- **`macos-latest` is arm64:** irrelevant today (no native modules), but the packaging stub
  is where better-sqlite3/sharp rebuilds will surface in P0-03 — the stub's OS matrix
  (windows + macos) is chosen so that work lands in the right place. Flagged, not solved,
  here.
- **Prettier sweep now covers historical docs:** `prettier --check .` will flag
  `docs/plans/*.md` and `issues-phase-0-1.json` if they were never formatted. Step 2 runs
  `pnpm format` once; the Coder should verify the diff is formatting-only (no content
  changes to plans/DDs).

## Invariant Checklist

- [x] Non-destructive: no code path writes/moves/renames/deletes user image files — N/A;
      this issue adds CI config and docs only, no runtime code
- [x] Layering: new domain logic lives in packages/core, pure — N/A; no domain logic added.
      CI *enforces* the existing layering lint rule on every PR from now on
- [x] DB: new tables/columns use UUIDv7 PKs + updated_at via Drizzle migration — N/A; no
      schema work (starts P0-04)
- [x] Timestamps stored UTC — N/A; no timestamp-bearing data
- [x] Long-running work goes through the worker job queue — N/A; no runtime work exists
- [x] Performance budgets (PRD §8.4) — N/A for app code; CI benchmark jobs are P0-07's
      scope (DD-004 "Benchmarks in CI"), not this issue's

## Out of Scope

- Actual packaging: electron-builder config, native-module rebuilds, signing — P0-03 fills
  the stub created here
- Benchmark jobs / performance-budget enforcement in CI (P0-07, per DD-004)
- Playwright E2E on the packaged app in CI (P0-08)
- Actually clicking the branch-protection settings (or automating them via API/terraform) —
  the acceptance criterion is *documentation* in CONTRIBUTING.md; a repo admin applies it
- Release/tag workflows, artifact publishing, CI deploys (Phase 2, DD-007)
- Coverage reporting/thresholds — no DD requires them yet; adding them now would slow the
  matrix for placeholder tests
- Renaming Vitest project display names to scoped forms (declared cosmetic/out-of-scope by
  the #44 plan; the migration keeps the existing `core`/`db`/`desktop`/`renderer` names)
- Any change to per-package build/lint/test script contents

## Open Questions

None — the following defaults were chosen and should be called out in the PR:

1. **Typecheck = `pnpm -r build`** (per-package `tsc -p` with declaration emit, dependency
   order) rather than a separate `tsc --noEmit` pass — the build is required before tests
   anyway (dist-resolved workspace imports), so a separate no-emit pass would only duplicate
   work. A root `typecheck` alias points at it for discoverability.
2. **Root `test` script becomes `vitest run`** (the #45 projects runner); `pnpm -r test`
   remains available per package. CI uses the root form for single-reporter output.
3. **Node version in CI: major pin `24`** matching `engines.node: ^24`; no Node version
   matrix (single runtime target per DD-001/Electron).
4. **`ci-ok` aggregate job** is the sole documented required status check, rather than the
   three matrix legs individually.
5. **pnpm version comes only from `packageManager`** — `pnpm/action-setup` (current major
   v6) reads it when its `version` input is omitted; corepack is not separately enabled in CI.
6. **`prettier --check .` scope at root includes docs/JSON**, requiring a one-time
   `pnpm format` normalization commit — accepted as the intent of #46 ("root-level
   lint/format coverage").

Plan written: docs/plans/p0-02-ci-pipeline.md — 7 steps

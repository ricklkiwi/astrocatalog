# Spec: [P0-02] GitHub Actions CI pipeline

**Slug:** p0-02-ci-pipeline **Issue:** #2 **Plan:** docs/plans/p0-02-ci-pipeline.md **Date:** 2026-07-06

Also specs backlog **#45** (vitest.workspace.ts → root vitest.config.ts migration) and **#46**
(root-level lint/format coverage), which the plan folds into this issue.

Criteria are tagged `[local]` (Reviewer verifies directly in this worktree/PR diff) or
`[github]` (only observable after push, on the GitHub-hosted Actions run or repo settings —
orchestrator verifies these on the PR, not the Reviewer locally).

## Definition of Done

### Functional Requirements

**#45 — vitest.workspace.ts → vitest.config.ts migration**

- [ ] `[local]` Given the repo root, when listing files, then `vitest.workspace.ts` no longer exists and `vitest.config.ts` exists.
- [ ] `[local]` Given `vitest.config.ts`, when read, then it calls `defineConfig` (not `defineWorkspace`) from `vitest/config` and sets `test.projects` to an array of exactly four project configs.
- [ ] `[local]` Given `vitest.config.ts`'s four project entries, when compared to the deleted `vitest.workspace.ts`, then each preserves the same `name` (`core`, `db`, `desktop`, `renderer`), the same `root` path, and the same `include: ['src/**/*.test.ts']` — no project switched to a `packages/*` glob.
- [ ] `[local]` Given the `desktop` project's `root`/`include`, when evaluated against the repo tree, then it resolves only `packages/desktop/src/**/*.test.ts` and does not also match `packages/desktop/renderer/src/**/*.test.ts`.
- [ ] `[local]` Given root `package.json`, when inspected, then its `test` script is exactly `vitest run` (not `pnpm -r test`).
- [ ] `[local]` Given the installed workspace, when `pnpm test` is run at the root, then Vitest reports exactly 4 projects (`core`, `db`, `desktop`, `renderer`) and exactly 4 passing test files total (one placeholder each), zero skipped/failed, and no `defineWorkspace`/`vitest.workspace.ts` deprecation warning in the output.
- [ ] `[local]` Given the installed workspace, when `pnpm -r test` is run (per-package path), then it still passes — this script is untouched by the migration.

**#46 — root-level lint/format coverage**

- [ ] `[local]` Given root `package.json`, when inspected, then a `lint:root` script exists running ESLint over exactly the root config files (`eslint.config.mjs` and `vitest.config.ts`) plus `prettier --check .` over the whole repo.
- [ ] `[local]` Given root `package.json`, when inspected, then the `lint` script is exactly `pnpm run lint:root && pnpm -r lint` (root sweep runs before/in addition to the existing per-package sweep, not instead of it).
- [ ] `[local]` Given root `package.json`, when inspected, then a `typecheck` script/alias exists pointing at the same build-based typecheck CI uses (per the plan's Open Question 1, this may be an alias for `pnpm -r build` rather than a separate `tsc --noEmit` pass — either is acceptable as long as it exits non-zero on a type error).
- [ ] `[local]` Given the repo tree, when `prettier --check .` is run at the root, then it exits 0 — i.e., the one-time `pnpm format` normalization (README.md, issues-phase-0-1.json, docs/plans/*.md, etc.) has already been applied and committed.
- [ ] `[local]` Given the one-time formatting pass, when diffed against the pre-#46 tree, then the changes are whitespace/formatting only — no content/wording changes to plan or DD files (spot-checked by the Reviewer on `docs/plans/*.md`).
- [ ] `[local]` Given `pnpm lint` at the root, when a deliberately-malformed `vitest.config.ts` (e.g. bad indentation or an ESLint violation) is introduced on a scratch copy, then `pnpm run lint:root` fails non-zero; revert the scratch change afterward.
- [ ] `[local]` Given `eslint.config.mjs`, when inspected, then no change was needed/made to its `ignores` or rules to support root-file linting (per the plan's "Not touched" note) — Reviewer must not require a rule addition here.

**CI workflow (`.github/workflows/ci.yml`)**

- [ ] `[local]` Given `.github/workflows/ci.yml`, when read, then it triggers on `pull_request` (all branches) and on `push` scoped to `main` only (not an unscoped `push:` trigger).
- [ ] `[local]` Given the workflow's `test` job, when read, then its `strategy.matrix.os` is exactly `[ubuntu-latest, windows-latest, macos-latest]` with `fail-fast: false`.
- [ ] `[local]` Given the workflow's setup steps, when read, then they run in order: `actions/checkout`, `pnpm/action-setup` with no `version` input, `actions/setup-node` with `node-version: 24` and `cache: pnpm`, `pnpm install --frozen-lockfile`, `pnpm -r build`, `pnpm lint`, `pnpm test`.
- [ ] `[local]` Given `pnpm/action-setup`'s invocation, when read, then it has no `version:` key (so it derives the pnpm version solely from root `package.json`'s `packageManager` field) — this rule applies identically in `package.yml`.
- [ ] `[local]` Given the workflow, when read, then it declares `permissions: contents: read` at the workflow or job level.
- [ ] `[local]` Given the workflow, when read, then it declares a `concurrency` group keyed on workflow name + `github.ref` with `cancel-in-progress: true`.
- [ ] `[local]` Given the workflow, when read, then a `ci-ok` job exists with `needs: [test]`, `if: always()`, and a step that explicitly fails (non-zero exit) when `needs.test.result != 'success'` — a bare `needs: [test]` with no `if: always()`/explicit-failure logic does not satisfy this criterion (per Edge Cases: a skipped job must not read as passing).
- [ ] `[github]` Given a push to `main` (post-merge) and given every pull request opened against this repo, when the Actions tab is inspected, then the `test` matrix job runs all three OS legs and the `ci-ok` job runs and reports a result once `test` completes — this is the first issue acceptance criterion ("CI green on all three OSes for main branch") and is only observable after push.
- [ ] `[github]` Given this issue's own PR, when its checks are inspected, then `test (ubuntu-latest)`, `test (windows-latest)`, `test (macos-latest)`, and `ci-ok` are all green.

**Packaging workflow stub (`.github/workflows/package.yml`)**

- [ ] `[local]` Given `.github/workflows/package.yml`, when read, then its only trigger is `workflow_dispatch` (no `push`/`pull_request` trigger).
- [ ] `[local]` Given the packaging workflow's matrix, when read, then `os` is exactly `[windows-latest, macos-latest]` (no `ubuntu-latest`, per DD-001 packaging scope).
- [ ] `[local]` Given the packaging workflow, when read, then it performs the same checkout/pnpm-setup/node-setup/install sequence as `ci.yml` (no `version` input on `pnpm/action-setup` here either), followed by one step whose output/name clearly states packaging is added in P0-03, and that step exits 0.
- [ ] `[github]` Given a manual `workflow_dispatch` of `package.yml` on this branch/PR, when run, then both the `windows-latest` and `macos-latest` legs complete successfully (install succeeds; the no-op step exits 0).

**Line-ending normalization**

- [ ] `[local]` Given root `.gitattributes`, when read, then it declares `* text=auto eol=lf` (or an equivalent rule forcing LF for text files repo-wide).
- [ ] `[local]` Given the working tree, when `git add --renormalize .` was run as part of this change, then `git status`/`git diff` shows no residual CRLF-vs-LF-only diff outstanding (i.e., renormalization was already applied and committed, not left as a follow-up).
- [ ] `[local]` Given a fresh checkout simulated by `git show HEAD:<file>` for a sample of tracked text files (e.g. `README.md`, `package.json`), when byte-inspected, then no `\r\n` sequences are present.

**`CONTRIBUTING.md` and branch protection documentation**

- [ ] `[local]` Given `CONTRIBUTING.md`, when read, then it exists at the repo root and documents: branch naming `<issue-id>-short-slug`, conventional commits, squash merge, one issue per PR, an acceptance-criteria checklist requirement in the PR description — consistent with (not contradicting) `CLAUDE.md`'s Workflow section.
- [ ] `[local]` Given `CONTRIBUTING.md`, when read, then it documents the local gate command chain `pnpm install && pnpm -r build && pnpm lint && pnpm test` (root forms, matching the build-before-test ordering `packages/db`/`packages/desktop` require for `dist`-resolved workspace imports).
- [ ] `[local]` Given `CONTRIBUTING.md`, when read, then it documents the branch-protection setup steps for `main`: Settings → Branches → Add branch protection rule → pattern `main` → "Require a pull request before merging" → "Require status checks to pass before merging" with **`ci-ok`** named as the required check → "Require branches to be up to date before merging".
- [ ] `[local]` Given `CONTRIBUTING.md`, when read, then it states explicitly that `ci-ok` (the aggregate job), not the individual per-OS matrix legs, is the required status check, and gives the reason (matrix renames orphan per-leg required checks).
- [ ] `[local]` Given root `README.md`, when read, then it contains a short "Contributing / CI" pointer to `CONTRIBUTING.md` and the CI workflow, plus updated root command forms (`pnpm test` → `vitest run` semantics, `pnpm lint` → root+per-package sweep, `pnpm typecheck`).
- [ ] `[github]` Given the repository's Settings → Branches configuration, when inspected by a repo admin, then a protection rule on `main` requires the `ci-ok` status check before merge — this is the second issue acceptance criterion ("PRs blocked on CI via branch protection") and the plan scopes this issue to _documenting_ the steps, not to the orchestrator/Coder clicking them; the Reviewer verifies the documentation exists and is accurate, not that the setting is live.

### Data Integrity

- [ ] N/A — no database schema, table, or migration is introduced or touched by this issue.

### Core Invariants

- [ ] No code path in the diff writes, moves, renames, or deletes files outside the app-data directory — N/A; this issue adds CI/lint config and docs only, no runtime file-system code.
- [ ] New domain logic is in packages/core with no Electron/fs imports — N/A; no domain logic added. `pnpm -r lint`, run as part of both `ci.yml` and `CONTRIBUTING.md`'s local gate, continues to enforce the existing `packages/core` `no-restricted-imports` rule on every PR from now on — CI's introduction _is_ the mechanism, not a change to it.
- [ ] All persisted timestamps are UTC — N/A; no timestamp-bearing data in this issue.
- [ ] Manual user overrides (target/filter/type/session assignments) survive a rescan — N/A; no assignment or scanning logic exists yet.

### Performance

- [ ] N/A — this issue touches no scanning, query, thumbnail, or UI-list code path. No benchmark job is added (P0-07 scope, per DD-004); the plan's Out of Scope explicitly excludes benchmark/perf-budget enforcement here.

### Tests

- [ ] `[local]` `pnpm test` (root `vitest run`, #45) reports exactly 4 passing project test files, 0 failed/skipped — same count as the pre-migration `vitest.workspace.ts` run, per the plan's Edge Case on silent test-count regressions.
- [ ] `[local]` `pnpm -r test` (per-package path) still passes unmodified.
- [ ] `[local]` `pnpm lint` (root, #46 + existing) exits 0 from a clean, already-formatted tree.
- [ ] `[local]` `pnpm -r build` exits 0 (typecheck-via-build for all four packages, dependency order, producing `dist/` that `db`/`desktop` tests resolve against).
- [ ] `[local]` The full local gate `pnpm install && pnpm -r build && pnpm lint && pnpm test`, run from a clean checkout (no stale `node_modules`/`dist`), exits 0 end-to-end.
- [ ] E2E: N/A — no UI surface exists yet (Playwright harness is P0-08, per the plan's Out of Scope).

## Out of Scope

Copied and expanded from the plan — the Reviewer must not flag any of the following as missing:

- Actual packaging: electron-builder config, code signing, native-module (better-sqlite3/sharp) rebuild steps — P0-03 fills in the stub `package.yml` created here.
- Benchmark jobs or performance-budget enforcement in CI — P0-07, per DD-004.
- Playwright E2E on the packaged app in CI — P0-08.
- Actually clicking the GitHub branch-protection settings, or automating them via API/Terraform — the acceptance criterion is documentation in `CONTRIBUTING.md`; a repo admin applies the setting by hand. The `[github]` criterion above verifies the setting only if/when the orchestrator checks it post-PR; the Reviewer's scope stops at the documentation being present and accurate.
- Release/tag workflows, artifact publishing, CI-driven deploys — Phase 2, DD-007.
- Coverage reporting or coverage thresholds — no DD requires them yet; would slow the matrix for placeholder tests.
- Renaming the Vitest project display names (`core`/`db`/`desktop`/`renderer`) to scoped forms — declared cosmetic/out of scope by the #44 plan; the #45 migration must keep these exact names, not introduce new ones.
- Any change to per-package `build`/`lint`/`test` script contents — only the root scripts change (`test`, `lint`, new `lint:root`/`typecheck`).
- Any change to `tsconfig.base.json` or per-package `tsconfig.json` — CI reuses the existing `tsc -p` builds unmodified.
- A Node version matrix — single Node 24 target per DD-001/Electron; no matrix dimension on Node version.
- Wording/prose-style nitpicks on `CONTRIBUTING.md` or the `README.md` pointer beyond the specific content items enumerated above.

## Test Hints

- **vitest-project-count**: run `pnpm test` (root), assert output reports 4 projects (`core`, `db`, `desktop`, `renderer`) and 4 test files, 0 failed/skipped, no `defineWorkspace` deprecation warning.
- **desktop-scope-static**: `grep -n "root:" vitest.config.ts` and compare each project's `root`/`include` pair against the deleted `vitest.workspace.ts` (`git show HEAD~N:vitest.workspace.ts` if still in history) — assert `desktop`'s `root` is `./packages/desktop` (not a glob covering `renderer`).
- **root-scripts**: read root `package.json`, assert `scripts.test === "vitest run"`, `scripts.lint === "pnpm run lint:root && pnpm -r lint"`, `scripts["lint:root"]` references both `eslint.config.mjs` and `vitest.config.ts` plus `prettier --check .`, and a `typecheck` script exists.
- **format-clean**: run `prettier --check .` at root on the committed tree, assert exit 0 (proves the one-time `pnpm format` pass landed).
- **ci-workflow-shape**: read `.github/workflows/ci.yml`, assert (a) `on.push.branches == ['main']`, (b) `on.pull_request` present with no branch restriction, (c) `strategy.matrix.os` is the 3-OS list with `fail-fast: false`, (d) step order checkout → pnpm/action-setup (no `version:` key) → setup-node (`node-version: 24`, `cache: pnpm`) → `pnpm install --frozen-lockfile` → `pnpm -r build` → `pnpm lint` → `pnpm test`, (e) a `ci-ok` job with `needs: [test]`, `if: always()`, and a step failing on `needs.test.result != 'success'`.
- **package-stub-shape**: read `.github/workflows/package.yml`, assert `on` is only `workflow_dispatch`, matrix os is `[windows-latest, macos-latest]`, no `pnpm/action-setup` `version:` key, and a final no-op step referencing P0-03 that exits 0.
- **gitattributes-lf**: read `.gitattributes`, assert a rule forcing `eol=lf` for text files; spot-check `README.md`/`package.json` bytes for absence of `\r\n`.
- **contributing-doc**: read `CONTRIBUTING.md`, assert presence of: branch-naming convention, conventional-commit/squash-merge mention, the local gate command chain (build-before-test order), and the branch-protection walkthrough naming `ci-ok` as the required check with the orphaned-per-leg-checks rationale.
- **readme-pointer**: read `README.md`, assert a CI/Contributing section/pointer exists and command examples reflect the new root scripts (`vitest run` semantics for `pnpm test`, combined root+per-package `pnpm lint`, `pnpm typecheck`).
- **full-gate**: from a clean checkout (`node_modules`/`dist` removed), run `pnpm install && pnpm -r build && pnpm lint && pnpm test` as one chained command, assert exit code 0.
- **github-ci-green** `[github]`: on the PR for this branch, fetch check-run statuses for `test (ubuntu-latest)`, `test (windows-latest)`, `test (macos-latest)`, `ci-ok` — assert all `success`.
- **github-package-dispatch** `[github]`: trigger `workflow_dispatch` on `package.yml` for this branch, assert both `windows-latest` and `macos-latest` runs complete with `conclusion: success`.
- **github-branch-protection** `[github]`: query the repo's branch protection rule for `main` (once configured by an admin), assert `required_status_checks.contexts` includes `ci-ok`.

Spec written: docs/specs/p0-02-ci-pipeline.md — 48 criteria

# Contributing to AstroTracker

This document covers the pull-request workflow and the one-time branch-protection setup for
`main`. It restates the working agreements from [`CLAUDE.md`](CLAUDE.md) and
[`planning/development-plan.md`](planning/development-plan.md) — if the documents ever
disagree, treat that as a bug and fix it.

## Pull-request workflow

- **One issue per PR.** Pick an issue whose `Depends on:` entries are all merged.
- **Branch naming:** `<issue-id>-short-slug`, e.g. `p1-01-fits-parser`.
- **Conventional commits**, scoped to the task ID where applicable, e.g.
  `feat(p1-01): parse FITS 80-char cards`.
- **Squash merge** — one PR becomes one commit on `main`.
- **Acceptance criteria in the PR description:** complete the issue's acceptance-criteria
  checklist with evidence (test names, benchmark output, CI run links).
- CI must be green (see below) before merge.

## Local gate

Run the full gate before opening or updating a PR — it is exactly what CI runs:

```
pnpm install && pnpm -r build && pnpm lint && pnpm test
```

The order matters: `pnpm -r build` is the typecheck (per-package `tsc -p` in dependency
order) **and** it produces the `dist/` output that `packages/db` and `packages/desktop`
tests resolve their workspace imports against — `pnpm test` on a clean tree fails with
module-not-found if the build hasn't run first.

Root script reference:

| Command          | What it runs                                                                     |
| ---------------- | -------------------------------------------------------------------------------- |
| `pnpm typecheck` | Alias for `pnpm -r build` (the build is the typecheck)                           |
| `pnpm lint`      | `lint:root` (ESLint on root configs + `prettier --check .`) then `pnpm -r lint`  |
| `pnpm test`      | Root `vitest run` across all four projects (`core`, `db`, `desktop`, `renderer`) |
| `pnpm format`    | `prettier --write .` — fix formatting failures from `pnpm lint`                  |
| `pnpm bench`     | P0-07 benchmark regression gate against `bench/baselines/results.json`           |

Run `pnpm bench` before PRs that touch DB inserts, aggregate queries, fixture generation, or
header scanning. Use `pnpm bench:update-baseline` only for intentional performance changes and
commit the refreshed baseline with the implementation.

## CI

`.github/workflows/ci.yml` runs on every pull request and on pushes to `main`: install →
build/typecheck → lint → test across an `ubuntu-latest` / `windows-latest` / `macos-latest`
matrix, runs the benchmark regression gate on `ubuntu-latest`, plus a final aggregate job named
**`ci-ok`** that fails unless every matrix leg and the benchmark job succeeded.

`.github/workflows/package.yml` is a manual-dispatch (`workflow_dispatch`) packaging stub
on Windows + macOS; P0-03 fills in the electron-builder steps.

## Branch protection for `main` (one-time repo-admin setup)

1. Go to **Settings → Branches**.
2. Click **Add branch protection rule**.
3. Branch name pattern: `main`.
4. Enable **Require a pull request before merging**.
5. Enable **Require status checks to pass before merging**, and add **`ci-ok`** as the
   required status check.
6. Enable **Require branches to be up to date before merging**.

**Require only `ci-ok` — not the individual matrix legs** (`test (ubuntu-latest)`,
`test (windows-latest)`, `test (macos-latest)`). Required checks are matched by name; if
the matrix is ever renamed or re-shaped, per-leg required checks become permanently-pending
orphans that block every merge until an admin edits the rule. `ci-ok` exists precisely so
the required-check name stays stable while the matrix behind it can change freely.

# Plan: [P0-01] Initialize monorepo with TypeScript, lint, and package structure

**Slug:** p0-01-monorepo-init   **Issue:** #1   **Date:** 2026-07-05
**Governing DDs:** DD-001 (tech stack), DD-002 (application architecture / module layout)
**Status:** READY_FOR_SPEC

## Summary

This issue lays the foundation every later Phase 0/1 issue builds on: a pnpm workspace with
four TypeScript packages (`core`, `db`, `desktop`, `desktop/renderer`) plus a `fixtures/`
directory, wired together with a shared strict `tsconfig`, a shared ESLint + Prettier
configuration, and root scripts so `pnpm install && pnpm -r build && pnpm -r lint && pnpm -r test`
succeed end to end. No product logic is written here — every package ships only a minimal
placeholder (an exported constant/function and one test) whose sole job is to prove the
toolchain and the DD-002 layering rule work. The structure and boundaries this issue creates
are what let `core`, `db`, and `desktop` work proceed in parallel afterwards (P0-02…P0-08 and
all of Phase 1 depend on this landing first).

## Affected Files

- `pnpm-workspace.yaml` — new; declares workspace package globs, including the nested
  `packages/desktop/renderer` member
- `package.json` (root) — new; `private: true`, `packageManager` pin, shared devDependencies
  (typescript, eslint + plugins, prettier, vitest), root convenience scripts
- `tsconfig.base.json` (root) — new; shared strict compiler options every package extends
- `eslint.config.mjs` (root, flat config) — new; shared lint rules, plus a `packages/core`
  override that forbids importing `electron` / `fs` / `node:fs*`
- `.prettierrc.json`, `.prettierignore` (root) — new
- `.editorconfig` (root) — new
- `.gitignore` — modified; add `*.tsbuildinfo`, `coverage/`, package-level `dist/` already covered
- `packages/core/package.json`, `tsconfig.json`, `src/index.ts`, `src/index.test.ts` — new
- `packages/db/package.json`, `tsconfig.json`, `src/index.ts`, `src/index.test.ts` — new
  (workspace dependency on `core`)
- `packages/desktop/package.json`, `tsconfig.json`, `src/index.ts`, `src/index.test.ts` — new
  (workspace dependency on `core` and `db`)
- `packages/desktop/renderer/package.json`, `tsconfig.json`, `src/index.ts`,
  `src/index.test.ts` — new (separate workspace member, own dependency set)
- `fixtures/README.md` — new; explains purpose and points to P0-06, no fixture data yet
- `README.md` (root) — modified; add "Package layout & layering rules" section per DD-002
- `vitest.workspace.ts` (root) — new; lets `pnpm -r test` and a future root `pnpm test` resolve
  per-package Vitest configs consistently

## Implementation Steps

### Step 1 — Workspace and shared tooling skeleton
**Outcome:** `pnpm install` succeeds at the repo root; a single source of truth exists for
TypeScript strictness, lint rules, formatting, and the Node/pnpm version every package and CI
job (P0-02) will use.
**Files:** `pnpm-workspace.yaml`, root `package.json` (with `packageManager` field pinning an
exact pnpm version and an `engines.node` range), `tsconfig.base.json`, `eslint.config.mjs`,
`.prettierrc.json`, `.prettierignore`, `.editorconfig`, `.gitignore` update.
**Depends on:** none

### Step 2 — `packages/core` scaffold (pure domain package)
**Outcome:** A buildable, lintable, testable TypeScript package with zero runtime dependencies
and no dependency on `electron` or Node's `fs`; this is the package DD-002 rule 1 governs, so
its scaffold is the one that proves the "purity" constraint is mechanically enforced, not just
documented.
**Files:** `packages/core/package.json` (empty `dependencies`, only shared dev tooling via
workspace root), `packages/core/tsconfig.json` (extends base), `packages/core/src/index.ts`
(placeholder export, e.g. a `coreVersion` constant), `packages/core/src/index.test.ts`
(placeholder Vitest test).
**Depends on:** Step 1

### Step 3 — `packages/db` scaffold
**Outcome:** A buildable, lintable, testable package that depends on `core` via the pnpm
`workspace:*` protocol, establishing the intended dependency direction (`db` → `core`, never
the reverse) ahead of the real Drizzle schema work in P0-04.
**Files:** `packages/db/package.json` (workspace dependency on `core`), `packages/db/tsconfig.json`,
`packages/db/src/index.ts`, `packages/db/src/index.test.ts`.
**Depends on:** Step 2

### Step 4 — `packages/desktop` scaffold (main process shell)
**Outcome:** A buildable, lintable, testable package representing the future Electron main
process, depending on `core` and `db` via `workspace:*`. No Electron dependency is added yet
(that begins in P0-03) — this step only proves the package exists at the right place in the
graph with the right build/lint/test wiring.
**Files:** `packages/desktop/package.json`, `packages/desktop/tsconfig.json`,
`packages/desktop/src/index.ts`, `packages/desktop/src/index.test.ts`.
**Depends on:** Step 3

### Step 5 — `packages/desktop/renderer` scaffold (nested workspace member)
**Outcome:** A separate pnpm workspace package nested under `desktop/`, so renderer-only
tooling (React/Vite, added in P0-03) never bleeds into the main-process package's dependency
tree and vice versa. Builds, lints, and tests independently of its parent `desktop` package.
**Files:** `packages/desktop/renderer/package.json`, `packages/desktop/renderer/tsconfig.json`,
`packages/desktop/renderer/src/index.ts`, `packages/desktop/renderer/src/index.test.ts`.
**Depends on:** Step 1 (does not depend on `core`/`db`/`desktop` — the renderer only ever talks
to main via IPC, added in P0-03, so no workspace dependency edge is created here)

### Step 6 — `fixtures/` placeholder directory
**Outcome:** The directory DD-002 and P0-06 expect exists in the repo with a short README
describing its future contents (real-world FITS/XISF/RAW header samples + manifest JSON), so
P0-06 has a home to populate without also needing to create the directory.
**Files:** `fixtures/README.md`.
**Depends on:** none

### Step 7 — Root scripts and cross-package verification
**Outcome:** `pnpm install && pnpm -r build && pnpm -r lint && pnpm -r test` all succeed from a
clean checkout, run in dependency order, and the root `README.md` documents the package
boundaries and layering rules from DD-002 (which package may depend on which, and why
`core` must stay pure).
**Files:** root `README.md` (new section), `vitest.workspace.ts`, minor root `package.json`
convenience scripts (`"build": "pnpm -r build"`, `"lint": "pnpm -r lint"`, `"test": "pnpm -r test"`).
**Depends on:** Steps 1–6

## Edge Cases

- A future contributor adds `import fs from 'node:fs'` (or `electron`) inside
  `packages/core/src/**` — the ESLint override from Step 1 must fail lint, not just fail at
  runtime/build, so `pnpm -r lint` is the enforcement point, not a manual code-review rule.
- `packages/desktop/renderer` accidentally adds a `workspace:*` dependency on `desktop` (or
  vice versa) — this would let renderer code import main-process modules directly, violating
  DD-002's "renderer never touches fs/db directly" rule before IPC even exists. The scaffold
  should not wire this dependency edge, and the README's layering section should call out that
  renderer→desktop is not a permitted direct import path once IPC lands in P0-03.
- Running `pnpm -r build` before `pnpm install` (no `node_modules`, no lockfile) — first-run
  clean-checkout case; must be the actual command exercised when verifying this issue's
  acceptance criteria, not `pnpm build` from inside a package.
- Node/pnpm version mismatch between a contributor's machine and the pinned
  `packageManager`/`engines` fields — pnpm should refuse or warn rather than silently using a
  different version, so version drift is caught locally instead of surfacing later in CI (P0-02).
- Two packages both declaring a placeholder `src/index.test.ts` with the same test name — not a
  real collision (Vitest scopes by file), but the plan calls it out so the Coder doesn't
  copy-paste identical test descriptions that make CI output ambiguous when triaging failures.
- `tsconfig.base.json` strict mode surfaces implicit-`any` in the placeholder files themselves —
  the scaffold code must be trivial enough (a typed constant/function, not `any`) to pass strict
  mode cleanly, since this is the first thing every later PR's `tsc` run will inherit.

## Invariant Checklist

- [x] Non-destructive: no code path writes/moves/renames/deletes user image files — N/A, no
      file-system logic is introduced in this issue
- [x] Layering: new domain logic lives in packages/core, pure (no Electron, no fs side effects) —
      enforced by empty `dependencies` in `packages/core/package.json` plus the ESLint
      no-restricted-imports rule from Step 1
- [x] DB: new tables/columns use UUIDv7 PKs + updated_at, added via a Drizzle migration — N/A,
      no schema work in this issue (starts at P0-04)
- [x] Timestamps stored UTC — N/A, no timestamp-bearing data in this issue
- [x] Long-running work goes through the worker job queue, never blocks main/renderer — N/A, no
      runtime work exists yet
- [x] Performance budgets respected (PRD §8.4) — N/A, no benchmarked code path exists yet
      (benchmark harness itself is P0-07)

## Out of Scope

- GitHub Actions CI workflow / branch protection (P0-02)
- Any Electron runtime code, preload, typed IPC contract, Vite dev server wiring for the
  renderer (P0-03)
- Drizzle schema, migrations, UUIDv7 generator, repository layer (P0-04)
- Worker pool / job queue (P0-05)
- Populating `fixtures/` with real or synthetic header samples (P0-06)
- Benchmark harness (P0-07)
- Playwright E2E harness (P0-08)
- Any actual FITS/XISF/RAW parsing, catalog, or IPC logic
- `packages/cloud` (Phase 2+, not part of DD-002's Phase 0/1 layout)

## Open Questions

- Exact Node.js and pnpm versions to pin in `engines`/`packageManager`. No DD specifies this;
  DD-001 only says "Electron (latest LTS)", which constrains the Electron version, not the
  Node/pnpm version used for the monorepo tooling itself. Recommend Node 20 (Active LTS) and
  the latest pnpm 9.x at implementation time, but this should be confirmed since it affects the
  CI matrix P0-02 builds next.
- Whether `packages/desktop/renderer` should be its own pnpm workspace member (this plan's
  choice, for dependency isolation between main-process and React/Vite tooling) versus a plain
  subdirectory of `packages/desktop` with a single shared `package.json`. DD-002's diagram shows
  `renderer/` nested under `desktop/` but doesn't state whether it is a separate package
  manifest. This plan assumes "separate workspace member" as the cleaner default for P0-03 to
  build on — flag for confirmation before P0-03 is planned, since reversing it later means
  moving dependencies between two `package.json` files.

Plan written: docs/plans/p0-01-monorepo-init.md — 7 steps

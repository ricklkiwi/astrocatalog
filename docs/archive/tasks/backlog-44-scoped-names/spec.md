# Spec: [Backlog] Scope package names to @astrotracker/* before real deps land

**Slug:** backlog-44-scoped-names **Issue:** #44 **Plan:** docs/archive/tasks/backlog-44-scoped-names/plan.md **Date:** 2026-07-05

## Definition of Done

### Functional Requirements

- [ ] Given `packages/core/package.json`, when read, then `name` is exactly `"@astrotracker/core"`.
- [ ] Given `packages/db/package.json`, when read, then `name` is exactly `"@astrotracker/db"` and its `dependencies` object has key `"@astrotracker/core"` (no `core` key) with value unchanged as `"workspace:*"`.
- [ ] Given `packages/desktop/package.json`, when read, then `name` is exactly `"@astrotracker/desktop"` and its `dependencies` object has keys `"@astrotracker/core"` and `"@astrotracker/db"` (no bare `core`/`db` keys), each with value unchanged as `"workspace:*"`.
- [ ] Given `packages/desktop/renderer/package.json`, when read, then `name` is exactly `"@astrotracker/renderer"` and `dependencies` remains `{}`.
- [ ] Given `packages/db/src/index.ts`, when read, then the import is `import { coreVersion } from '@astrotracker/core';` (no remaining bare `'core'` specifier).
- [ ] Given `packages/desktop/src/index.ts`, when read, then the imports are `from '@astrotracker/core'` and `from '@astrotracker/db'` (no remaining bare `'core'`/`'db'` specifiers).
- [ ] Given the repo root, when `pnpm install` is run, then it completes without `--no-frozen-lockfile` and `pnpm-lock.yaml` shows no uncommitted diff afterward (i.e., the checked-in lockfile is already the regenerated, correct one).
- [ ] Given `pnpm-lock.yaml`, when inspected, then the four workspace importers' dependency keys/specifiers reference `@astrotracker/core`, `@astrotracker/db`, `@astrotracker/desktop`, `@astrotracker/renderer` and no bare `core`/`db`/`desktop`/`renderer` package entries remain anywhere in the lockfile.
- [ ] Given `README.md`'s package-layout table (the "May depend on" column for the `packages/db` and `packages/desktop` rows), when read, then the cells read `` `@astrotracker/core` `` and `` `@astrotracker/core`, `@astrotracker/db` `` respectively, replacing the old bare-name cells.
- [ ] Given the full gate command `pnpm install && pnpm -r build && pnpm -r lint && pnpm -r test`, when run from a clean checkout of the branch, then it exits 0.

### Data Integrity

- [ ] N/A — no database schema, table, or migration exists or is touched by this issue.

### Core Invariants

- [ ] No code path in the diff writes, moves, renames, or deletes files outside the app-data directory — N/A; this diff touches only package manifests, two import lines, the lockfile, and README prose.
- [ ] New domain logic is in packages/core with no Electron/fs imports — N/A, no domain logic added; `packages/core/package.json`'s empty `dependencies` field and the existing `no-restricted-imports` ESLint rule (path-scoped, untouched by this rename) must still pass `pnpm -r lint`.
- [ ] All persisted timestamps are UTC — N/A, no persisted data involved.
- [ ] Manual user overrides survive a rescan — N/A, no assignment or scanning logic exists.

### Performance

- [ ] N/A — no scanning, query, thumbnail, or UI-list code path is touched.

### Tests

- [ ] All four existing placeholder Vitest tests (`core`, `db`, `desktop`, `desktop/renderer`) still pass unmodified by `pnpm -r test`; no new tests are required since no behavior changes.
- [ ] `describeDb()` output is unchanged in content (`db@0.1.0 (core@0.1.0)`) — only the module specifier it's built from changed, not the runtime string, per the existing `packages/db/src/index.test.ts` assertion.
- [ ] `describeDesktop()` output is unchanged in content (`desktop@0.1.0 (core@0.1.0, db@0.1.0)`) for the same reason.
- [ ] E2E: N/A — no UI surface exists yet (Playwright harness is P0-08).

## Out of Scope

- Renaming Vitest project names in `vitest.workspace.ts` (`'core'`, `'db'`, `'desktop'`, `'renderer'`) — these key off `root` paths, not `package.json#name`; Reviewer must not flag them as missed.
- Any change to `eslint.config.mjs` — its `no-restricted-imports` rule scopes via the file glob `packages/core/src/**/*.ts`, a path, not a package name.
- Any change to `tsconfig.base.json` or per-package `tsconfig.json` — none reference package names.
- Editing `docs/archive/tasks/p0-01-monorepo-init/plan.md` or `docs/archive/tasks/p0-01-monorepo-init/spec.md` — historical records of an already-merged issue; left describing the old bare names.
- Any prose in `README.md` outside the package-layout table's "May depend on" cells (e.g., the "Allowed dependency direction: `core` ← `db` ← `desktop`" sentence, the `core` purity paragraph) — the plan scopes the README edit to the table cells only; Reviewer must not require the rest of the prose to be rewritten.
- Directory moves — `packages/core`, `packages/db`, `packages/desktop`, `packages/desktop/renderer` paths are unchanged; only `package.json#name` and dependency keys change.
- Changing `version`, `description`, or any `package.json` field other than `name` and the dependency keys being renamed.
- Adding any real third-party runtime dependency to any package, or any `packages/cloud` scaffolding — unrelated to this issue.

## Test Hints

- **names-scoped**: read all four `package.json` files, assert `name` equals `@astrotracker/core`, `@astrotracker/db`, `@astrotracker/desktop`, `@astrotracker/renderer` respectively, and no bare-name value remains.
- **dep-keys-rekeyed**: read `packages/db/package.json` and `packages/desktop/package.json`, assert `dependencies` object keys are the scoped names with value `workspace:*`, and assert no key literally equals `core`, `db`, or `desktop`.
- **imports-updated**: `grep -rn "from 'core'\|from 'db'\|from \"core\"\|from \"db\"" packages/` returns no matches; `grep -rn "from '@astrotracker/core'" packages/db/src/index.ts packages/desktop/src/index.ts` and `grep -n "from '@astrotracker/db'" packages/desktop/src/index.ts` each return a match.
- **lockfile-clean**: run `pnpm install`, then `git diff --exit-code pnpm-lock.yaml` — expect no diff (lockfile was already regenerated and committed correctly); separately `grep -n "^\s*core:\|^\s*db:\|^\s*desktop:\|^\s*renderer:" pnpm-lock.yaml` under the importers' `dependencies`/`devDependencies` blocks returns no bare-name matches.
- **readme-table**: read `README.md` lines ~29-31, assert the `packages/db` row's "May depend on" cell contains `@astrotracker/core` and the `packages/desktop` row's cell contains both `@astrotracker/core` and `@astrotracker/db`.
- **gate-green**: from a clean checkout, run `pnpm install && pnpm -r build && pnpm -r lint && pnpm -r test` as one chained command; assert exit code 0.
- **placeholder-output-unchanged**: run `pnpm --filter @astrotracker/db test` and `pnpm --filter @astrotracker/desktop test`, assert the existing assertions on `describeDb()`/`describeDesktop()` string output still pass without modification to the test files.

Spec written: docs/archive/tasks/backlog-44-scoped-names/spec.md — 22 criteria

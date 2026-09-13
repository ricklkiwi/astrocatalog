# Spec: [P0-01] Initialize monorepo with TypeScript, lint, and package structure

**Slug:** p0-01-monorepo-init **Issue:** #1 **Plan:** docs/archive/tasks/p0-01-monorepo-init/plan.md **Date:** 2026-07-19

## Definition of Done

### Functional Requirements

- [ ] Given a clean checkout with no `node_modules` anywhere and no prior install, when `pnpm install` is run at the repo root, then it exits 0 using the exact pinned `packageManager` value from root `package.json`.
- [ ] Given root `package.json`, when inspected, then it has `"private": true`, an exact `packageManager` pin, an `engines.node` range, shared devDependencies for TypeScript, ESLint, Prettier, and Vitest, and root scripts for `build`, `lint`, and `test`.
- [ ] Given `pnpm-workspace.yaml`, when inspected, then it includes the P0-01 workspace members `packages/core`, `packages/db`, `packages/desktop`, and `packages/desktop/renderer`.
- [ ] Given `pnpm-workspace.yaml`, when `pnpm -r list --depth -1 --json` is run after install, then `packages/desktop/renderer` resolves as its own workspace package rather than only as a subdirectory of `packages/desktop`.
- [ ] Given the installed workspace, when `pnpm -r build` is run, then every workspace package builds successfully and the P0-01 packages compile under `tsconfig.base.json` strict mode.
- [ ] Given `tsconfig.base.json`, when inspected, then it enables `strict` TypeScript options and every P0-01 package-local `tsconfig.json` extends it.
- [ ] Given the installed workspace, when `pnpm -r lint` is run, then ESLint flat config and Prettier checks exit 0 across every workspace package.
- [ ] Given root `eslint.config.mjs`, when inspected, then it is a flat config that includes TypeScript linting, Prettier compatibility, and a scoped `packages/core/src/**` rule that forbids Electron and Node `fs` imports.
- [ ] Given `.prettierrc.json`, `.prettierignore`, and `.editorconfig`, when inspected, then they exist at the repository root and provide shared formatting/editor rules for the workspace.
- [ ] Given the installed workspace, when `pnpm -r test` is run, then every workspace package test script exits 0 and the P0-01 scaffold packages each contribute at least one passing Vitest test.
- [ ] Given root `vitest.config.ts`, when inspected, then it uses Vitest's current `test.projects` API to include the P0-01 packages.
- [ ] Given each P0-01 package, when inspected, then it has a package-local `vitest.config.ts` so `pnpm -r test` runs that package's own tests without inheriting the root multi-project config by accident.
- [ ] Given `pnpm-lock.yaml`, when inspected, then it is committed and contains importers for the P0-01 workspace packages after their manifests and workspace dependency edges are final.
- [ ] Given `packages/core/package.json`, when inspected for P0-01, then it has no runtime dependencies and no dependency or devDependency on `electron`.
- [ ] Given every file under `packages/core/src/**`, when scanned for import statements, then none import `electron`, `fs`, `node:fs`, `fs/promises`, or `node:fs/promises`.
- [ ] Given a scratch copy, when a file under `packages/core/src/**` adds `import fs from 'node:fs'` or an `electron` import and `pnpm -r lint` is run, then lint fails on that file via the scoped restricted-import rule.
- [ ] Given `packages/db/package.json`, when inspected, then it declares a `workspace:*` dependency on `@astrotracker/core` and no dependency on `@astrotracker/desktop` or `@astrotracker/renderer`.
- [ ] Given `packages/desktop/package.json`, when inspected for the P0-01 scaffold, then it declares workspace access to `@astrotracker/core` and `@astrotracker/db` without requiring any Electron runtime code from P0-01.
- [ ] Given `packages/desktop/renderer/package.json`, when inspected for P0-01, then it is an independent workspace package and does not require runtime/value imports from `@astrotracker/core`, `@astrotracker/db`, or `@astrotracker/desktop`.
- [ ] Given the renderer after P0-03 has added the typed IPC contract, when inspected, then a type-only `@astrotracker/desktop` devDependency for erased IPC contract imports is allowed and does not count as a P0-01 layering violation.
- [ ] Given root `README.md`, when read, then it documents the DD-002 package boundaries and allowed dependency direction: `core` is pure domain logic, `db` depends on `core`, `desktop` may depend on `core` and `db`, and renderer runtime access to main-process behavior goes only through typed IPC.
- [ ] Given root `README.md`, when read, then it states that `packages/core` forbids Electron and Node `fs` coupling rather than permanently forbidding all future pure runtime libraries.
- [ ] Given `fixtures/README.md`, when read for P0-01, then it exists and identifies `fixtures/` as the future home for FITS/XISF/RAW sample data populated by P0-06.
- [ ] Given `.gitignore`, when inspected, then it ignores `node_modules/`, package build output, coverage output, `*.tsbuildinfo`, and OS/editor noise without ignoring committed source, config, docs, or `pnpm-lock.yaml`.

### Data Integrity

- [ ] N/A — P0-01 introduces no database schema, table, migration, repository, fixture manifest, or persisted domain data.

### Core Invariants

- [ ] No code path in the P0-01 diff writes, moves, renames, or deletes user image files outside the app-data directory — N/A, P0-01 introduces only repository scaffold and tooling files.
- [ ] New domain logic is in `packages/core` with no Electron or Node `fs` imports — applies to the scaffold placeholder and is enforced by the static import scan plus the scoped ESLint rule.
- [ ] All persisted timestamps are UTC — N/A, P0-01 persists no timestamp-bearing application data.
- [ ] Manual user overrides survive a rescan — N/A, P0-01 introduces no scanning, assignment, or rescan behavior.

### Performance

- [ ] N/A — P0-01 touches no scanning, query, thumbnail, benchmark, or UI-list code path.

### Tests

- [ ] The clean-checkout command sequence `pnpm install && pnpm -r build && pnpm -r lint && pnpm -r test` exits 0 from the repository root.
- [ ] The P0-01 package placeholder tests exercise exported package surfaces rather than testing only Vitest itself.
- [ ] The four P0-01 placeholder test descriptions are not all identical, so package failures can be identified from test output.
- [ ] The root test configuration and package-local Vitest configurations are both covered by running `pnpm test` and `pnpm -r test` successfully.
- [ ] E2E: N/A — P0-01 has no UI surface, no Electron runtime, and no packaged app behavior.

## Out of Scope

- GitHub Actions CI workflow and branch protection documentation (P0-02).
- Electron main process runtime, preload, typed IPC implementation, Vite React renderer wiring, hot reload, native module rebuilds, and packaged artifacts (P0-03).
- Drizzle schema, migrations, UUIDv7 generator, repository layer, app-data DB bootstrap, WAL mode, and `busy_timeout` (P0-04).
- Worker pool, persistent job queue, progress events, cancellation, and resume-on-restart behavior (P0-05).
- Real FITS/XISF/RAW fixtures, manifest schema, fixture authoring tools, and synthetic generator behavior (P0-06).
- Benchmark harness, benchmark baselines, and CI regression gates (P0-07).
- Playwright E2E harness, packaged-app smoke tests, and temp app-data/library helpers (P0-08).
- Actual FITS, XISF, RAW, catalog, database, worker, thumbnail, UI, or IPC product logic.
- `packages/cloud` or any Phase 2 service package.
- Requiring exact Node.js or pnpm version numbers beyond an explicit root `packageManager` pin and `engines.node` range, because DD-001 does not specify those numbers.
- Requiring `packages/core` to stay forever dependency-free; P0-01 starts with no runtime dependencies, but later pure runtime libraries are allowed when they do not introduce Electron or Node `fs` coupling.

## Test Hints

- **clean-install-chain**: remove all `node_modules` directories in a scratch checkout, run `pnpm install && pnpm -r build && pnpm -r lint && pnpm -r test`, and assert exit code 0 for the whole root-level chain.
- **workspace-members**: run `pnpm -r list --depth -1 --json` and assert the returned package paths include `packages/core`, `packages/db`, `packages/desktop`, and `packages/desktop/renderer`; allow later P0 workspace packages such as `fixtures` or `bench`.
- **strict-tsconfig-inheritance**: read `tsconfig.base.json` and the four P0-01 package `tsconfig.json` files, assert strict mode is enabled in the base config and each package extends the base.
- **vitest-projects-and-local-configs**: read root `vitest.config.ts`, assert it uses `test.projects` for the P0-01 packages, then run both `pnpm test` and `pnpm -r test` to prove aggregate and package-local discovery work.
- **lockfile-importers**: read `pnpm-lock.yaml`, assert importers exist for `.`, `packages/core`, `packages/db`, `packages/desktop`, and `packages/desktop/renderer`.
- **core-purity-static**: search `packages/core/src/**` for imports from `electron`, `fs`, `node:fs`, `fs/promises`, and `node:fs/promises`, and assert there are no matches.
- **core-purity-lint-enforced**: on a scratch copy, add `import fs from 'node:fs';` to a `packages/core/src/**` file, run `pnpm -r lint`, assert non-zero exit referencing the restricted-import rule, and discard the scratch edit.
- **dependency-graph**: read `packages/core/package.json`, `packages/db/package.json`, `packages/desktop/package.json`, and `packages/desktop/renderer/package.json`; assert the P0-01 dependency direction is `core` <- `db` <- `desktop`, with renderer runtime/value imports kept out of the graph.
- **renderer-type-only-exception**: after P0-03, assert any renderer dependency on `@astrotracker/desktop` is a devDependency used only for erased `import type` IPC contract imports, and assert the ESLint renderer rule rejects value imports from `@astrotracker/desktop`.
- **readme-layering-section**: read root `README.md`, assert it documents DD-002 package boundaries, renderer IPC-only runtime access, and core purity as no Electron or Node `fs` coupling.
- **fixtures-placeholder**: read `fixtures/README.md`, assert it identifies P0-06 as the issue that populates real fixture data.

Spec written: docs/archive/tasks/p0-01-monorepo-init/spec.md — 39 criteria

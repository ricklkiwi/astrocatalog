# Spec: [P0-01] Initialize monorepo with TypeScript, lint, and package structure

**Slug:** p0-01-monorepo-init **Issue:** #1 **Plan:** docs/archive/tasks/p0-01-monorepo-init/plan.md **Date:** 2026-07-05

## Definition of Done

### Functional Requirements

- [ ] Given a clean checkout with no `node_modules` anywhere and no prior install, when `pnpm install` is run at the repo root, then it exits 0 and resolves exactly four workspace packages: `packages/core`, `packages/db`, `packages/desktop`, `packages/desktop/renderer`.
- [ ] Given the installed workspace, when `pnpm -r build` is run, then all four packages compile via `tsc` under `tsconfig.base.json` strict mode with zero type errors.
- [ ] Given the installed workspace, when `pnpm -r lint` is run, then ESLint (flat config) and Prettier checks exit 0 with zero errors across all four packages.
- [ ] Given the installed workspace, when `pnpm -r test` is run, then Vitest reports exactly one passing placeholder test per package (four total: `core`, `db`, `desktop`, `desktop/renderer`), zero skipped/failed.
- [ ] Given root `package.json`, when inspected, then `packageManager` is exactly `"pnpm@10.34.4"` and `engines.node` specifies a Node 26 LTS range.
- [ ] Given `pnpm-workspace.yaml`, when inspected, then its `packages` globs make `packages/desktop/renderer` resolve as its own independent workspace member (a distinct entry in `pnpm -r list --depth -1`), not merely a subdirectory of `packages/desktop`.
- [ ] Given `packages/core/package.json`, when inspected, then its `dependencies` field is empty — no runtime dependency on `electron` or any Node `fs`-providing package.
- [ ] Given every file under `packages/core/src/**`, when scanned for import statements, then none import `electron`, `fs`, `node:fs`, or `node:fs/promises`.
- [ ] Given the root ESLint config, when a file under `packages/core/src/**` adds `import fs from 'node:fs'` (or `import ... from 'electron'`), then `pnpm -r lint` fails on that file via a `no-restricted-imports`-style rule scoped to `packages/core`.
- [ ] Given `packages/db/package.json`, when inspected, then it declares a `workspace:*` dependency on `core` and no dependency on `desktop` or `desktop/renderer`.
- [ ] Given `packages/desktop/package.json`, when inspected, then it declares `workspace:*` dependencies on both `core` and `db`.
- [ ] Given `packages/desktop/renderer/package.json` and `packages/desktop/package.json`, when both are inspected, then neither declares a `workspace:*` dependency on the other (renderer has no edge to `core`, `db`, or `desktop`; desktop has no edge to `renderer`).
- [ ] Given root `README.md`, when read, then it contains a section documenting package boundaries and the DD-002 layering rules: the allowed dependency direction (`core` ← `db` ← `desktop`, `renderer` independent, all reached only via IPC from P0-03 onward) and that `core` must stay pure.
- [ ] Given `fixtures/README.md`, when read, then it exists, states no fixture data is present yet, and points to P0-06 as the issue that populates it.

### Data Integrity

- [ ] N/A — no database schema, table, or migration is introduced by this issue (schema work starts at P0-04).

### Core Invariants

- [ ] No code path in the diff writes, moves, renames, or deletes files outside the app-data directory — N/A, this issue introduces no file-system logic beyond the scaffold/tooling files themselves.
- [ ] New domain logic is in packages/core with no Electron/fs imports — applies: verified by the empty `dependencies` field, the import scan, and the ESLint `no-restricted-imports` rule above.
- [ ] All persisted timestamps are UTC — N/A, no persisted data exists in this issue.
- [ ] Manual user overrides survive a rescan — N/A, no assignment or scanning logic exists in this issue.

### Performance

- [ ] N/A — this issue touches no scanning, query, thumbnail, or UI-list code path; no benchmark harness exists yet (P0-07).

### Tests

- [ ] Each package (`core`, `db`, `desktop`, `desktop/renderer`) ships exactly one `src/index.test.ts` with one passing Vitest test exercising its placeholder export; test names must not be copy-pasted identically across packages (Edge Case: ambiguous CI triage).
- [ ] `pnpm -r test` passes with these four placeholder tests as the only tests in the repo (no pre-existing tests to regress).
- [ ] E2E: N/A — no UI surface exists in this issue (Playwright harness is P0-08).

## Out of Scope

- GitHub Actions CI workflow / branch protection (P0-02) — the Reviewer must not require a CI config file to exist yet, only that the commands it will invoke succeed locally.
- Any Electron runtime code, preload script, typed IPC contract, or Vite dev server wiring for the renderer (P0-03) — `packages/desktop` and `packages/desktop/renderer` need only placeholder exports, not a real Electron entry point or React app.
- Drizzle schema, migrations, UUIDv7 generator, repository layer (P0-04) — `packages/db`'s placeholder must not include real schema code.
- Worker pool / job queue (P0-05).
- Populating `fixtures/` with real or synthetic header samples (P0-06) — only the placeholder README is required.
- Benchmark harness (P0-07) and Playwright E2E harness (P0-08).
- Any actual FITS/XISF/RAW parsing, catalog, or IPC logic anywhere in this diff.
- `packages/cloud` — not part of DD-002's Phase 0/1 layout, must not be created by this issue.
- Exact wording/formatting of the README layering section beyond covering the dependency direction and core purity — the Reviewer should not nitpick prose style.

## Test Hints

- **clean-install**: from a checkout with `node_modules` removed at every workspace level, run `pnpm install && pnpm -r build && pnpm -r lint && pnpm -r test` as one chained command (not per-package `pnpm build`/`pnpm lint`/`pnpm test` run manually inside a package dir); assert exit code 0 for the whole chain.
- **workspace-member-count**: run `pnpm -r list --depth -1 --json`, assert the result contains exactly four entries with names/paths matching `packages/core`, `packages/db`, `packages/desktop`, `packages/desktop/renderer`.
- **core-purity-static**: `grep -rn "from 'electron'\|from 'fs'\|from 'node:fs" packages/core/src` returns no matches; and `packages/core/package.json`'s `dependencies` key is `{}` or absent.
- **core-purity-lint-enforced**: on a scratch copy, add `import fs from 'node:fs';` to `packages/core/src/index.ts`, run `pnpm --filter core lint` (or `pnpm -r lint`), assert non-zero exit referencing the restricted-import rule; then revert the change (do not leave it in the tree).
- **dependency-graph**: read `packages/db/package.json`, `packages/desktop/package.json`, `packages/desktop/renderer/package.json`; assert `db.dependencies` includes `core` via `workspace:*`, `desktop.dependencies` includes both `core` and `db` via `workspace:*`, and `renderer.dependencies` contains none of `core`/`db`/`desktop`.
- **packageManager-pin**: read root `package.json`, assert `packageManager === "pnpm@10.34.4"` exactly (not a range) and `engines.node` matches a Node 26 range.
- **placeholder-tests-distinct**: read the four `src/index.test.ts` files, assert their top-level `test`/`it` description strings are not all identical.
- **readme-layering-section**: read root `README.md`, assert it contains a heading/section referencing package boundaries and DD-002, and mentions that `core` has no Electron/fs dependency.
- **fixtures-readme**: read `fixtures/README.md`, assert it exists and references P0-06.

Spec written: docs/archive/tasks/p0-01-monorepo-init/spec.md — 24 criteria

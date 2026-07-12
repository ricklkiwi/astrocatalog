# Spec: [P0-08] Playwright E2E harness on packaged app

**Slug:** p0-08-playwright-e2e **Issue:** #8 **Plan:** docs/plans/p0-08-playwright-e2e.md **Date:** 2026-07-11

Verification-mode legend used on every criterion below:

- **[local]** — mechanically checkable in this worktree on this macOS machine: reading
  source/config files, `pnpm -r lint` / `pnpm -r build` / `pnpm -r test`, running
  `pnpm --filter @astrotracker/desktop pree2e` to produce the `--dir` unpacked mac build, then
  `pnpm e2e` (or `pnpm --filter @astrotracker/desktop e2e`) against it.
- **[github]** — the `windows-latest` leg of `.github/workflows/e2e.yml`; not producible on this
  mac (no Windows runner locally). The orchestrator/Reviewer verifies this post-push via the PR's
  CI run status, not by local execution. The `macos-latest` leg of the same workflow is `[local]`-
  equivalent (same commands this spec already requires locally) and is not called out separately.

This harness is foundational: every later Phase 1 UI-touching issue is required to add its own
spec using the pattern this issue ships. Criteria below therefore verify the _pattern_ is
mechanically enforced and genuinely reusable (Steps 4/5), not only that the one shipped smoke
spec passes.

## Definition of Done

### Functional Requirements

**AC1 — Playwright toolchain wired into `packages/desktop` (Step 1)**

- [ ] **[local]** Given `packages/desktop/package.json`, when read, then `@playwright/test`
      appears under `devDependencies` and no other Playwright-family package (`playwright`,
      `playwright-core`, `electron-playwright-helpers`) is added anywhere in the repo.
- [ ] **[local]** Given `packages/desktop/playwright.config.ts`, when read, then `testDir` is
      `'./e2e'`, `reporter` branches on `process.env.CI` (`'github'` in CI, `'list'` otherwise),
      `use.trace` is `'retain-on-failure'`, `use.screenshot` is `'only-on-failure'`, and
      `workers`/`fullyParallel` are set so the suite runs single-worker/non-parallel.
- [ ] **[local]** Given `packages/desktop/package.json`, when read, then a `pree2e` script builds
      the `electron-builder --dir` unpacked artifact and an `e2e` script runs
      `playwright test` (or equivalent `electron-vite build && electron-rebuild ... &&
electron-builder --dir` / `playwright test` split across `pree2e`/`e2e`), and the root
      `package.json` gains an `e2e` script equal to `pnpm --filter @astrotracker/desktop e2e`.
- [ ] **[local]** Given `packages/desktop/tsconfig.json`, when read, then `include` contains
      `"e2e"` in addition to the existing `"src"` / `"electron.vite.config.ts"` entries, and
      `pnpm -r build` (which runs `tsc --noEmit -p tsconfig.json` for this package) exits 0 with
      the `e2e/` directory populated (post Steps 2–5).
- [ ] **[local]** Given `packages/desktop/package.json`'s `lint` script, when read, then its
      `eslint`/`prettier --check` file arguments include `e2e` alongside the existing `src`
      argument, and `pnpm -r lint` exits 0.
- [ ] **[local]** Given an empty `e2e/` directory (state after Step 1 alone, before Steps 2–5
      land), when `pnpm --filter @astrotracker/desktop exec playwright test` is run, then it
      exits 0 reporting zero tests found — proves config wiring independent of any spec content.

**AC2 — `resolve-build.ts` locates the packaged app payload per OS (Step 2)**

- [ ] **[local]** Given a single matching build under `packages/desktop/release/mac*/*.app` on
      `darwin`, when `resolveBuild()` is called, then it returns that `.app`'s packaged
      `Contents/Resources/app.asar` path without hardcoding `mac`, `mac-arm64`, or
      `mac-universal` in the glob.
- [ ] **[local]** Given `packages/desktop/release/win-unpacked/resources/app.asar` on `win32`,
      when `resolveBuild()` is called, then it returns that path directly (deterministic, no
      glob, since `electron-builder.yml` pins Windows to a single nsis/x64 target).
- [ ] **[local]** Given zero matching build directories under `packages/desktop/release/` for the
      current OS, when `resolveBuild()` is called, then it throws an error whose message names
      the `pree2e` command to run.
- [ ] **[local]** Given two matching `.app` directories under `packages/desktop/release/mac*/`
      simultaneously (e.g. a stale Intel build plus a fresh arm64 build), when `resolveBuild()`
      is called, then it throws an error naming every candidate path found, and does not silently
      pick one.

**AC3 — Temp app-data + temp library-folder helper (Step 3) — the issue's named acceptance criterion**

- [ ] **[local]** Given `createTempAppDataDir()` is called, when it resolves, then it returns
      `{ path, cleanup }` where `path` is a freshly `fs.mkdtemp`-created directory under the OS
      temp root, distinct from the real OS user-data location.
- [ ] **[local]** Given `createTempAppDataDir()` is called twice in the same process, when the two
      returned `path` values are compared, then they are different directories (no collision
      across concurrent/sequential test runs).
- [ ] **[local]** Given `createTempLibraryDir()` is called with no arguments, when it resolves,
      then it returns `{ path, cleanup }` where `path` exists and is empty.
- [ ] **[local]** Given `createTempLibraryDir(seedFiles)` is called with a list of filenames that
      exist under `fixtures/`, when it resolves, then every named file has been copied into the
      returned `path` (byte-identical to its `fixtures/` source), and no other file is present.
- [ ] **[local]** Given `createTempLibraryDir(seedFiles)` is called with a filename that does not
      exist under `fixtures/`, when it resolves or rejects, then it does not silently produce a
      directory missing that file without surfacing an error (Reviewer reads the implementation
      to confirm a missing seed file is not swallowed).
- [ ] **[local]** Given either helper's `cleanup()` is called, when it resolves, then the temp
      directory no longer exists on disk.
- [ ] **[local]** Given `temp-dirs.ts`'s `cleanup()` implementation, when read, then it retries
      `fs.rm(..., { recursive: true })` a bounded number of times on `EBUSY`/`EPERM` before
      throwing, rather than either retrying unboundedly or failing on the first transient error.
      (The retry firing under real Windows file-lock contention is `[github]`-only signal — it
      cannot be reproduced on macOS — but the bounded-retry _code path existing_ is `[local]`.)
- [ ] **[local]** Given neither helper is passed a real/ambient OS user-data path, when
      `packages/desktop/e2e/support/temp-dirs.ts` is grepped for hardcoded paths outside the OS
      temp directory, then none are found (Core Invariants: non-destructive guarantee).

**AC4 — Shared fixture is the sole, mechanically-enforced entry point (Step 4) — reusability**

- [ ] **[local]** Given `packages/desktop/e2e/fixtures.ts`, when read, then it exports an
      extended Playwright `test` (and re-exports `expect`) with one fixture, `electronApp`, that
      composes `resolveBuild()` + both `temp-dirs.ts` helpers and launches via
      `_electron.launch({ args: [appAsar, '--user-data-dir=' + appDataDir] })`, yielding
      `{ app, appDataDir, libraryDir }` to the test.
- [ ] **[local]** Given a spec using the `electronApp` fixture that is made to fail deliberately
      (Reviewer adds a throwing assertion to a scratch copy of the smoke spec), when
      `pnpm e2e` is run, then the fixture's teardown still runs — the Electron app process exits
      and both temp directories are removed — verified by checking the temp paths no longer exist
      after the run (proves teardown runs on failure, not just success); the scratch copy is
      reverted afterward.
- [ ] **[local]** Given the top of `packages/desktop/e2e/fixtures.ts`, when read, then it contains
      a comment documenting how to add a new E2E spec (`import { test, expect } from
'../fixtures'`, destructure `electronApp`, call `electronApp.app.firstWindow()`), matching
      the plan's Defaults #4 rationale for why specs must not call `_electron.launch()` directly.
- [ ] **[local]** Given the root `eslint.config.mjs`, when read, then it contains a rule scoped to
      `packages/desktop/e2e/**/*.spec.ts` that forbids importing `_electron` from
      `@playwright/test` directly, and the rule's scope does **not** match `fixtures.ts` itself
      (which is the one file permitted to import it).
- [ ] **[local]** Given a scratch spec file under `packages/desktop/e2e/` that adds
      `import { _electron } from '@playwright/test';` directly (bypassing `fixtures.ts`), when
      `pnpm -r lint` is run, then it exits non-zero citing the scoped rule; reverted afterward,
      `pnpm -r lint` exits 0.
- [ ] **[local] Reusability proof — second, throwaway spec.** Given a second scratch spec file
      (e.g. `packages/desktop/e2e/_reusability-check.spec.ts`, deleted before this criterion is
      marked done) that imports `test`/`expect` from `../fixtures`, uses `electronApp`, calls
      `createTempLibraryDir` indirectly via the fixture's `libraryDir`, and asserts something
      independent of the shipped smoke spec (e.g. `electronApp.appDataDir !== <the first spec's
appDataDir>` captured via a shared temp marker, or simply that `libraryDir` exists and is
      writable), when `pnpm e2e` is run with both specs present, then both pass independently, in
      the same `workers: 1` run, without one spec's temp dirs colliding with or being visible to
      the other — proving the fixture pattern generalizes beyond the one shipped spec, not just
      that a single hand-tuned spec happens to pass.

**AC5 — The required smoke spec (Step 5)**

- [ ] **[local]** Given `packages/desktop/e2e/app-launch.spec.ts`, when `pnpm e2e` runs it against
      the `--dir` unpacked mac build, then `electronApp.app.windows()` has length exactly 1.
- [ ] **[local]** Given the same run, when the first window's `page.title()` is read, then it is
      exactly `"AstroTracker"` (matches `packages/desktop/renderer/index.html`'s `<title>`).
- [ ] **[local]** Given the same run, when `window.astrotracker.invoke('app.version')` is
      evaluated inside the renderer page context, then the result has non-empty string values for
      `appVersion`, `electronVersion`, `chromeVersion`, `nodeVersion`, `platform`.
- [ ] **[local]** Given the same IPC result, then `sqliteVersion` and `sharpVersion` are present,
      non-empty, and **not** the literal string `'unknown'` — the packaged-asar proof that
      `better-sqlite3`/`sharp` were rebuilt against the correct Electron ABI (the class of bug
      P0-03 Step 6's unit-level native smoke could not catch on its own).
- [ ] **[local]** Given `app-launch.spec.ts`, when read, then it imports `test`/`expect` only
      from `../fixtures` (never `@playwright/test` directly), consistent with AC4's enforced
      pattern.

**AC6 — CI: `.github/workflows/e2e.yml` on Windows + macOS (Step 6)**

- [ ] **[local]** Given `.github/workflows/e2e.yml`, when read, then its `on:` triggers match
      `ci.yml`'s (`push` to `main`, `pull_request`), its matrix is exactly
      `[windows-latest, macos-latest]` (no `ubuntu-latest` leg), and its steps are, in order:
      checkout, `pnpm/action-setup@v4`, `actions/setup-node@v4` (node 24, pnpm cache),
      `pnpm install --frozen-lockfile`, `pnpm -r build`, `pnpm e2e`.
- [ ] **[local]** Given the same file, when read, then it sets `timeout-minutes: 20` on the job
      and uploads `packages/desktop/playwright-report/` via `actions/upload-artifact@v4` gated on
      `if: failure()`.
- [ ] **[local]** Given the same file, when read, then it is **not** referenced by `ci.yml`'s
      `ci-ok` aggregate job (`needs:` list in `ci.yml` unchanged) — this workflow stays a
      separate, not-yet-required check per the plan's Out of Scope.
- [ ] **[github]** Given a pushed commit/PR on this branch, when the `e2e.yml` `windows-latest`
      matrix leg runs, then it completes with `pnpm e2e` exiting 0 (Windows-side proof that
      `resolve-build.ts`'s `win32` branch, native-module `npmRebuild` on Windows, and
      `temp-dirs.ts`'s Windows cleanup retry all work end-to-end — none of this is reproducible on
      the local mac).
- [ ] **[local]** Given a clean workspace on this mac, when `pnpm --filter @astrotracker/desktop
pree2e` then `pnpm e2e` are run at repo root, then both exit 0 (the `macos-latest` leg's
      command sequence, run locally).

**AC7 — Docs (Step 7)**

- [ ] **[local]** Given `README.md`'s commands table, when read, then it gains a `pnpm e2e` row
      describing "playwright on packaged app (P0-08)" (or equivalent), matching the existing
      table's style (see `pnpm dev`/`pnpm package` rows).
- [ ] **[local]** Given `README.md`, when read, then it contains a short "Adding an E2E spec"
      note naming `packages/desktop/e2e/fixtures.ts` as the required entry point and referencing
      why (`_electron.launch()` must not be called directly from a spec).
- [ ] **[local]** Given `CONTRIBUTING.md`'s CI section, when read, then it gains a line describing
      `.github/workflows/e2e.yml` (Windows + macOS matrix, `pnpm e2e`) alongside the existing
      `ci.yml`/`package.yml` descriptions, and states it is not yet part of the `ci-ok` required
      check.

**AC8 — `.gitignore`**

- [ ] **[local]** Given `.gitignore`, when read, then it adds
      `packages/desktop/playwright-report/` and `packages/desktop/test-results/` (Playwright's
      default output directories are not already covered by the existing `packages/desktop/out/`
      / `packages/desktop/release/` entries).

### Data Integrity

- [ ] N/A — no table, column, or migration is introduced by this issue; no `packages/db` changes.

### Core Invariants

- [ ] **[local]** No code path in the diff writes, moves, renames, or deletes files outside a
      freshly created OS-temp directory or the gitignored `packages/desktop/release/` build
      output — Reviewer greps `packages/desktop/e2e/**` for `fs.write*`/`fs.rename*`/
      `fs.unlink*`/`fs.rm*`/`fs.cp*` calls and verifies every target path derives from
      `os.tmpdir()`/`fs.mkdtemp` (via `temp-dirs.ts`) or from a value returned by those helpers,
      never a hardcoded real user-data or library path.
- [ ] **[local]** New domain logic is in `packages/core` with no Electron/fs imports — N/A/
      adapted: this issue makes no `packages/core` changes; verified via `git diff --name-only`
      showing no `packages/core/**` paths touched.
- [ ] N/A — all persisted timestamps are UTC: nothing is persisted by this issue (E2E harness
      only; no DB writes).
- [ ] N/A — manual user overrides surviving a rescan: no assignment or scanning logic exists in
      this issue.
- [ ] **[local]** The Step 4 ESLint rule (AC4) is itself the mechanical enforcement of the
      non-destructive guarantee for this issue specifically: a spec bypassing `fixtures.ts` could
      call `_electron.launch()` with no `--user-data-dir` override and touch a developer's real
      Electron profile — the lint rule makes that a build failure, not a code-review convention.

### Performance

- [ ] N/A — no scanning, query, thumbnail, or UI-list code path is touched; no `pnpm bench`
      interaction. CI wall-clock time (native rebuild + `--dir` packaging + Electron boot per OS)
      is a CI-cost note covered by AC6's `timeout-minutes: 20`, not a PRD §8.4 regression.

### Tests

- [ ] **[local]** `pnpm e2e` passes locally against the `--dir` unpacked mac build (AC5, AC6's
      last bullet) — this **is** the issue's test suite; `resolve-build.ts` and `temp-dirs.ts`
      have no separate Vitest unit-test file, and none is required: `e2e/**` is deliberately
      excluded from both `vitest.config.ts` `test.projects` entries and the `desktop` package's
      own `vitest run --dir src` (plan Edge Cases: "Two test runners, two conventions"), so
      Reviewer must not ask for a parallel Vitest suite covering these files — `pnpm e2e` running
      green is their only and sufficient test coverage.
- [ ] **[local]** `pnpm -r test` passes unmodified — no existing `core`/`db`/`desktop`/`renderer`
      test regresses from this issue's changes.
- [ ] **[local]** `pnpm -r lint` and `pnpm -r build` both exit 0 with `e2e/**` included (AC1).
- [ ] **[local]** E2E: `app-launch.spec.ts` (AC5) is the one required scenario; AC4's throwaway
      reusability-proof spec is a Reviewer-only verification step, not a shipped test (deleted
      before the diff is considered complete — see Out of Scope).
- [ ] **[github]** `pnpm e2e` passes on the `windows-latest` CI matrix leg (AC6) — the other half
      of the issue's named acceptance criterion ("passes locally and in CI on both OSes"); the
      `macos-latest` CI leg is equivalent to the `[local]` run above and is not separately gating.

## Out of Scope

- Any UI beyond the single existing version screen — this issue tests what P0-03 shipped; no new
  pages, navigation, or fixtures for unbuilt Phase 1 features (library-folder configuration,
  scanning, target resolution).
- `createTempLibraryDir` being consumed by any spec other than the smoke spec and this spec's
  own throwaway reusability-proof spec — it is deliberately unused by `app-launch.spec.ts` itself
  and exists as scaffolding for later scanning/cataloging E2E specs.
- Wiring `packages/db`'s `openDatabase` into `packages/desktop/src/main/index.ts` — the app does
  not yet persist anything under the app-data directory; `createTempAppDataDir` is ready for
  whenever that lands, but this issue does not make the main process read/write it.
- Folding `.github/workflows/e2e.yml` into `ci.yml`'s `ci-ok` aggregate required check —
  deliberately left as a separate, not-yet-required workflow (AC6); Reviewer must not require
  `ci-ok`'s `needs:` list to include the new job.
- Fixing `.github/workflows/package.yml`'s stale placeholder body — pre-existing, unrelated debt;
  not touched here.
- Code signing / notarization / Gatekeeper handling for the packaged artifact under test — builds
  stay unsigned exactly like `pnpm package`'s existing artifacts (P1-33 territory).
- Cross-platform artifact caching/reuse between CI jobs, or trimming `pree2e`'s rebuild cost —
  a performance follow-up once the suite exists and its CI time is measured.
- Linux/`ubuntu-latest` E2E coverage — out of the issue's acceptance criteria (Win + mac only) and
  out of scope for `electron-builder.yml`, which defines no Linux target.
- A parallel Vitest unit-test suite for `resolve-build.ts`/`temp-dirs.ts` — see Tests section
  above; `pnpm e2e` itself is the test coverage for these support files by design.
- Multi-window or off-origin-navigation E2E scenarios — `main/index.ts`'s `setWindowOpenHandler`/
  `will-navigate` lockdown denies these by design (DD-002); a spec attempting either should fail,
  and that failure is not a harness bug to fix here.

## Test Hints

- **toolchain-wired-no-specs**: with `e2e/` empty (Step 1 alone), run
  `pnpm --filter @astrotracker/desktop exec playwright test`, assert exit 0 and "no tests found".
- **resolve-build-single-mac-candidate**: with exactly one `release/mac*/*.app` present, call
  `resolveBuild()`, assert the returned `appPath` points to `Contents/Resources/app.asar` inside
  that `.app`.
- **resolve-build-zero-candidates-throws**: with `release/` absent or empty, call
  `resolveBuild()`, assert it throws mentioning `pree2e`.
- **resolve-build-multiple-candidates-throws-naming-both**: create two sibling
  `release/mac*/*.app` directories (e.g. copy one), call `resolveBuild()`, assert the thrown
  error message names both paths; delete the extra copy afterward.
- **temp-app-data-dir-unique-per-call**: call `createTempAppDataDir()` twice, assert the two
  `path` values differ and both exist on disk until `cleanup()`.
- **temp-library-dir-seed-files-copied**: call `createTempLibraryDir(['some-fixture.fits'])`,
  assert the file exists at `path/some-fixture.fits` with identical bytes to the `fixtures/`
  source.
- **temp-library-dir-empty-when-no-seed**: call `createTempLibraryDir()`, assert `path` exists
  and `fs.readdir(path)` is `[]`.
- **cleanup-removes-directory**: call either helper, then `cleanup()`, assert `fs.stat(path)`
  rejects with `ENOENT`.
- **fixtures-teardown-runs-on-failure**: temporarily add a throwing assertion to a copy of
  `app-launch.spec.ts`, run `pnpm e2e`, assert the Electron process is gone and both temp dirs
  are removed despite the test failing; revert.
- **fixtures-top-comment-documents-pattern**: read the first block comment in `fixtures.ts`,
  assert it names the import path and the `electronApp` fixture explicitly.
- **eslint-blocks-direct-electron-import**: add `import { _electron } from '@playwright/test';`
  to a scratch file under `e2e/*.spec.ts`, run `pnpm -r lint`, assert non-zero exit citing the
  scoped rule; assert the same import inside `fixtures.ts` itself does _not_ trigger the rule;
  revert the scratch file.
- **reusability-second-spec**: add a temporary second `.spec.ts` using `electronApp` from
  `fixtures.ts` with an assertion independent of `app-launch.spec.ts`, run `pnpm e2e` with both
  present, assert both pass in the same single-worker run with no shared/colliding temp dirs;
  delete the temporary spec afterward.
- **smoke-window-count-and-title**: run `app-launch.spec.ts` via `pnpm e2e`, assert
  `electronApp.app.windows().length === 1` and `page.title() === 'AstroTracker'`.
- **smoke-ipc-native-versions**: within the same spec, assert
  `sqliteVersion`/`sharpVersion` are non-empty and not `'unknown'`.
- **ci-workflow-shape**: read `.github/workflows/e2e.yml`, assert matrix is
  `[windows-latest, macos-latest]`, `timeout-minutes: 20`, `pnpm e2e` is the final step, and
  `actions/upload-artifact@v4` is gated `if: failure()` on `packages/desktop/playwright-report/`.
- **ci-not-required-yet**: read `.github/workflows/ci.yml`'s `ci-ok` job `needs:` list, assert it
  is unchanged (still `[test]`), confirming `e2e.yml` was not folded into the required gate.
- **docs-present**: grep `README.md` for `pnpm e2e` and `fixtures.ts`; grep `CONTRIBUTING.md` for
  `e2e.yml`.

Spec written: docs/specs/p0-08-playwright-e2e.md — 50 criteria

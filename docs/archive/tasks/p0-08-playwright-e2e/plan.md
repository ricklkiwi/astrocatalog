# Plan: [P0-08] Playwright E2E harness on packaged app

**Slug:** p0-08-playwright-e2e **Issue:** #8 **Date:** 2026-07-08
**Governing DDs:** DD-001 (tech stack: "Playwright (E2E on packaged app)"), DD-002 (application
architecture / layering — E2E must exercise the real renderer↔preload↔main↔IPC boundary, not
bypass it)
**Status:** READY_FOR_SPEC

## Summary

This issue gives AstroTracker its first end-to-end test: Playwright's `_electron` API launches
the actual `electron-builder`-packaged desktop app (not a dev-mode `electron .` process) and
proves the whole stack boots — a window opens, its title is "AstroTracker", and a renderer→
preload→main IPC round trip (`app.version`, which itself proves the native `better-sqlite3`/
`sharp` rebuild works per P0-03 Step 6) returns real data. Equally important as the one smoke
test is the _harness_ it establishes: every later Phase 1 issue that touches the UI is required
(per the working agreement that motivated this issue) to add its own Playwright spec before its
PR opens, so this issue's job is to make that cheap and consistent — a documented pattern for
adding a new spec (`packages/desktop/e2e/fixtures.ts`), and a reusable helper for seeding an
isolated temp app-data directory and a temp "library folder" that future scanning/cataloging
specs will point the app at. CI runs the suite on `windows-latest` and `macos-latest` (DD-001
scopes packaging, and by extension this E2E suite, to Windows + macOS; no Linux Electron GUI
job is added).

## Defaults chosen (no DD dictates these — recorded here so deviations are visible)

1. **Launch the `electron-builder --dir` unpacked build, not a full installer/DMG and not a raw
   `pnpm -r build` + `electron .` dev build.** Three options were considered:
   - _Full installer (NSIS/DMG)_: closest to what a user runs, but requires silently installing
     an app or mounting a DMG in CI — slow and platform-fragile — and the installer wrapper adds
     no test signal beyond what the unpacked bundle inside it already has.
   - _Dev build (`electron .` against `pnpm -r build` output)_: fast, but skips `asar` packing,
     `asarUnpack`, and `npmRebuild` entirely — exactly the machinery P0-03 Step 6 flagged as the
     fragile part (native-module ABI mismatches, `.node` binaries unloadable from inside an
     asar). A dev-mode E2E run could pass while the artifact real users install is broken, which
     defeats the point of "Playwright on packaged app" in DD-001.
   - **`electron-builder --dir`** ("Build unpacked dir. Useful to test." — electron-builder CLI)
     runs the identical `asar: true` / `asarUnpack` / `npmRebuild: true` pipeline configured in
     `electron-builder.yml` and used for the real release artifacts, but stops short of wrapping
     the result in an NSIS installer or DMG. It produces `release/mac*/AstroTracker.app` (macOS)
     or `release/win-unpacked/AstroTracker.exe` (Windows) — realistic packaging, no
     install/mount step, fast enough to run per-CI-job. This is the standard approach used by
     the Electron testing ecosystem (e.g. `electron-playwright-helpers`' `findLatestBuild`
     assumes exactly this kind of unpacked output). Chosen.
2. **New dependency: `@playwright/test` only** (added to `packages/desktop/package.json`
   devDependencies). Its `_electron` export is the full Electron automation API — no separate
   `playwright` or `playwright-core` package, and no third-party helper library
   (`electron-playwright-helpers`) is added: that package's `findLatestBuild()` assumes a
   different output-directory convention (`out/<app>-<platform>-<arch>`) than this repo's
   `electron-builder.yml` (`directories.output: release`), and P0-03 already set the precedent
   of hand-rolling a small amount of glue code over pulling in a dependency of uncertain
   maintenance status when the alternative is ~30 lines (see Step 2).
3. **E2E code lives at `packages/desktop/e2e/`**, a sibling of `src/` and `renderer/`, not a new
   top-level `packages/e2e`. DD-002's module layout has no E2E package, and this suite tests
   exactly one package's packaged output — nesting it under `desktop` keeps the dependency
   (`@playwright/test`) and the thing it tests co-located, and keeps `packages/desktop/release/`
   (already gitignored) as the natural build target both `pnpm package` and `pnpm e2e` share.
4. **Temp app-data isolation via the `--user-data-dir` Electron/Chromium launch switch**, not an
   app-code change. Electron honors `--user-data-dir=<path>` out of the box (it is a Chromium
   switch Electron passes through), redirecting everything `app.getPath('userData')` returns —
   so E2E can isolate every run into a fresh temp directory with zero changes to
   `packages/desktop/src/main/index.ts`. This also means the harness does not block on P0-04's
   database wiring landing in `main/index.ts` (it hasn't yet — `runNativeSmoke` is still
   in-memory only); the seeding helper is ready for whenever a later issue makes the main
   process actually read/write files under `userData`.

## Affected Files

- `packages/desktop/package.json` — new devDependency `@playwright/test`; new scripts
  `pree2e` (build the `--dir` unpacked artifact) and `e2e` (run the Playwright suite); `lint`
  script's file list gains `e2e`
- `packages/desktop/tsconfig.json` — `include` gains `e2e`, so `pnpm -r build`'s
  `tsc --noEmit` typechecks the E2E suite too
- `packages/desktop/playwright.config.ts` — new; `testDir: './e2e'`, CI-friendly reporter,
  trace/screenshot-on-failure, single worker (see Edge Cases)
- `packages/desktop/e2e/support/resolve-build.ts` — new; locates the `electron-builder --dir`
  output's packaged `app.asar` payload per OS
- `packages/desktop/e2e/support/temp-dirs.ts` — new; `createTempAppDataDir()` and
  `createTempLibraryDir()` helpers, `fs.mkdtemp`-based, with Windows-tolerant cleanup
- `packages/desktop/e2e/temp-dirs.spec.ts` — new; focused harness tests proving app-data
  uniqueness, library seeding, rejected unsafe/missing seeds, and cleanup without launching
  Electron (the shared `electronApp` fixture remains lazy when a test does not request it)
- `packages/desktop/e2e/fixtures.ts` — new; the extended Playwright `test`/`expect` every spec
  imports — wires `resolve-build.ts` + `temp-dirs.ts` into a single `electronApp` fixture with
  automatic launch/cleanup, and is the file this plan's "documented pattern for adding a new
  spec" points to
- `packages/desktop/e2e/app-launch.spec.ts` — new; the one required smoke spec (window opens,
  title, `app.version` IPC round trip)
- `eslint.config.mjs` (root) — new scoped rule: `packages/desktop/e2e/**/*.spec.ts` may not
  import `_electron` from `@playwright/test` directly (must go through `fixtures.ts`), so every
  spec is mechanically forced through the temp-dir isolation instead of relying on convention
- `package.json` (root) — new `e2e` script: `pnpm --filter @astrotracker/desktop e2e`
- `.github/workflows/e2e.yml` — new; `windows-latest` / `macos-latest` matrix running
  `pnpm install`, `pnpm -r build`, `pnpm e2e`, with the Playwright HTML report uploaded as an
  artifact on failure
- `.gitignore` — add `packages/desktop/playwright-report/` and
  `packages/desktop/test-results/` (Playwright's default output dirs)
- `README.md` — commands table gains `pnpm e2e`; new short "Adding an E2E spec" note pointing
  at `packages/desktop/e2e/fixtures.ts`
- `CONTRIBUTING.md` — CI section gains a line describing `.github/workflows/e2e.yml`

## Implementation Steps

### Step 1 — Playwright toolchain wired into `packages/desktop`

**Outcome:** `@astrotracker/desktop` has `@playwright/test` as a devDependency and a
`playwright.config.ts` pointing at a (still-empty) `e2e/` directory. Running
`pnpm --filter @astrotracker/desktop exec playwright test` succeeds trivially (no specs found)
— proves the toolchain and config are wired before any app-launch logic is written.
Config defaults, each chosen deliberately: `reporter: process.env.CI ? 'github' : 'list'` (the
`github` reporter annotates PR checks natively); `use: { trace: 'retain-on-failure',
screenshot: 'only-on-failure' }` (this is the project's first E2E harness — prioritize
debuggability of the inevitable first flaky CI failure over trace-file size); `workers: 1` /
`fullyParallel: false` (launching a full packaged Electron app is comparatively heavy and this
issue ships one packaged-app smoke scenario plus small non-launching helper checks; revisit
parallelism once enough app-driving specs exist for it to matter — noted so a later issue
doesn't need an "Open Question," just flip the config).
**Files:** `packages/desktop/package.json`, `packages/desktop/playwright.config.ts`,
`packages/desktop/tsconfig.json`, root `package.json`, `.gitignore`
**Depends on:** none

### Step 2 — Locate the packaged build (`resolve-build.ts`)

**Outcome:** A function that returns the absolute path to the `electron-builder --dir` output's
packaged `app.asar` payload for the current OS: on `darwin`, it globs
`packages/desktop/release/mac*/*.app` (there is deliberately no hardcoded `mac` vs `mac-arm64`
vs `mac-universal` — electron-builder's default arch for an unqualified `--dir` build is not
pinned by this repo's config, so the resolver discovers whichever directory exists rather than
guessing), then returns that bundle's `Contents/Resources/app.asar`; on `win32`, it resolves
`packages/desktop/release/win-unpacked/resources/app.asar` directly (this repo's
`electron-builder.yml` pins Windows to a single `nsis`/x64 target, so the output directory name
is deterministic). If zero or more than one candidate is found, it throws an error naming every
candidate and instructing the developer to run `pnpm --filter @astrotracker/desktop pree2e`,
while listing stale candidates for manual inspection. The resolver itself never removes or
rewrites `release/`; artifact cleanup is not a test-launch side effect. Playwright's
`_electron.launch()` still uses the repo's Electron test runner so it can inject its
loader/debug hooks; the app argument is the packaged `app.asar`, which keeps the
asar/asarUnpack/native payload signal without launching the raw source directory.
**Files:** `packages/desktop/e2e/support/resolve-build.ts`
**Depends on:** Step 1

### Step 3 — Temp app-data + temp library-folder helpers (`temp-dirs.ts`)

**Outcome:** Two small async helpers, each returning `{ path, cleanup }`:
`createTempAppDataDir()` creates a fresh `fs.mkdtemp` directory intended for the
`--user-data-dir` Electron launch switch (Defaults #4) — isolating every test run's Electron
profile/singleton-lock/preferences from both the real OS user-data location and from other
parallel CI jobs; `createTempLibraryDir(seedFiles?: readonly string[])` creates a second temp
directory representing the folder a user will eventually point AstroTracker's (future,
Phase 1) library-folder setting at, optionally pre-populating it by copying named files from
`fixtures/` — unused by this issue's own smoke spec, but this is the explicit hook a later
scanning/cataloging E2E spec seeds with real FITS/XISF/RAW fixture files. Seed paths are
fixture-root-relative only: absolute paths and traversal outside `fixtures/` are rejected, and
duplicate destination basenames fail rather than silently overwriting one seed with another.
Both `cleanup()` functions recursively remove their directory and tolerate `EBUSY`/`EPERM`
(Windows can hold a brief file lock after Electron's process exits — see Edge Cases) with a
short bounded retry before giving up loudly. A small Playwright support spec imports the shared
`test`/`expect` entry point but does not request `electronApp` (so the lazy fixture does not
launch Electron); it proves app-data paths are unique, empty-library creation, byte-identical
fixture seeding, unsafe/missing-seed rejection, and cleanup. This keeps the named helper under
committed automated coverage instead of relying on a later Phase 1 spec for its first exercise.
**Files:** `packages/desktop/e2e/support/temp-dirs.ts`, `packages/desktop/e2e/temp-dirs.spec.ts`
**Depends on:** Step 1

### Step 4 — The shared fixture and spec-authoring pattern (`fixtures.ts`)

**Outcome:** An extended Playwright `test` (re-exporting `expect`) with one fixture,
`electronApp`, that composes Steps 2 and 3: resolves the packaged `app.asar`, creates both temp
dirs, launches via `_electron.launch({ args: [appAsar, '--user-data-dir=' + appDataDir] })`,
yields `{ app, appDataDir, libraryDir }` to the test, and in teardown always closes the Electron
app and cleans up both temp dirs — even on test failure, because Playwright fixture teardown
runs regardless of test outcome. Resource acquisition and teardown also cover failures outside
the test body: if creating the library directory or launching Electron fails after app-data
creation, every resource already acquired is released; if app close or either directory cleanup
fails, teardown still attempts the remaining cleanup operations and then surfaces the
failure(s). This file's top-of-file comment is the "how to add a new E2E
spec" documentation the issue asks for: `import { test, expect } from '../fixtures'` (or
relative path), destructure `electronApp` from the test args, call
`electronApp.app.firstWindow()` to get the renderer `Page`. The companion ESLint rule (Affected
Files) makes `fixtures.ts` the only file in `e2e/` allowed to import `_electron` directly, so
every spec is mechanically routed through temp-dir isolation — a spec author cannot accidentally
launch against a real user-data directory.
**Files:** `packages/desktop/e2e/fixtures.ts`, `eslint.config.mjs`
**Depends on:** Steps 2, 3

### Step 5 — The required smoke spec

**Outcome:** `app-launch.spec.ts` uses the Step 4 fixture to assert the three acceptance-level
behaviors: exactly one window opens (`electronApp.app.windows()` has length 1); the window's
title is exactly `"AstroTracker"` (matches `renderer/index.html`'s `<title>`); and the demo IPC
round trip works end-to-end by evaluating
`window.astrotracker.invoke('app.version')` inside the renderer page context and asserting the
result shape — `appVersion`, `electronVersion`, `chromeVersion`, `nodeVersion`, `platform` are
non-empty strings, and critically `sqliteVersion`/`sharpVersion` are present and not the
`'unknown'` fallback, which is the same signal P0-03 Step 6's native smoke was built to
surface, now proven through the _packaged_ asar-unpacked binary rather than only in unit tests.
The test uses `firstWindow()` plus Playwright web-first assertions (for example
`expect(page).toHaveTitle('AstroTracker')` and a visible loaded version-screen assertion) before
the IPC evaluation, with the configured bounded Playwright timeout and no fixed sleeps. This
waits through the packaged app's `ready-to-show`/renderer hydration path and makes a slow CI cold
start a retryable condition rather than a one-shot title read.
**Files:** `packages/desktop/e2e/app-launch.spec.ts`
**Depends on:** Step 4

### Step 6 — CI: `.github/workflows/e2e.yml` on Windows + macOS

**Outcome:** A new workflow, triggered the same way as `ci.yml` (`push` to `main`,
`pull_request`), with a `windows-latest` / `macos-latest` matrix (no `ubuntu-latest` leg — DD-001
scopes Playwright to the packaged app, and packaging itself is Win/mac only per
`electron-builder.yml`; adding a Linux GUI leg would need `xvfb` for no packaging target this
repo produces). Steps mirror `ci.yml`'s setup (checkout, `pnpm/action-setup`, `setup-node@v4`
node 26 + pnpm cache, `pnpm install --frozen-lockfile`), then `pnpm -r build` (workspace
`@astrotracker/core`/`@astrotracker/db` must have `dist/` built before electron-vite can bundle
them — the same ordering `CONTRIBUTING.md`'s local gate already documents), then `pnpm e2e`.
`packages/desktop/playwright-report/` is uploaded via `actions/upload-artifact@v4` with
`if: failure()` so a red CI run leaves a downloadable trace/report instead of only console
output. A generous `timeout-minutes: 20` per matrix leg (native module rebuild +
`electron-builder --dir` packaging + Electron cold boot is slower than the unit-test matrix).
This workflow is intentionally separate from `ci-ok`'s aggregate gate for now (see Out of
Scope) so a flaky/slow E2E leg cannot block every PR merge on day one; folding it into
`ci-ok`'s required check is a one-line follow-up once the suite has proven stable.
**Files:** `.github/workflows/e2e.yml`
**Depends on:** Step 5

### Step 7 — Docs

**Outcome:** `README.md`'s command table gains `pnpm e2e`, and a short "Adding an E2E spec"
paragraph names `packages/desktop/e2e/fixtures.ts` as the required entry point (linking back to
this plan's Defaults #4 for _why_ specs must not call `_electron.launch()` directly).
`CONTRIBUTING.md`'s CI section gains one line describing `.github/workflows/e2e.yml` alongside
the existing `ci.yml`/`package.yml` description, including the note that it is not yet part of
the `ci-ok` required check (Step 6).
**Files:** `README.md`, `CONTRIBUTING.md`
**Depends on:** Step 6

## Edge Cases

- **macOS output directory name is not fixed by this repo's config** (`mac`, `mac-arm64`, or
  `mac-universal` depending on electron-builder's arch defaults on a given runner/host) —
  `resolve-build.ts` globs rather than hardcodes (Step 2); if a developer's local `release/`
  directory somehow contains more than one matching `.app` (e.g. built once on Intel, once via
  a stale Rosetta run), the resolver must fail loudly naming both rather than silently picking
  one.
- **Stale artifacts from a previous `pnpm package` run** (a `.dmg`/`.exe` installer plus its
  staging directory) coexisting in `packages/desktop/release/` alongside the new `--dir` output
  — the resolver only globs for the unpacked `.app`/`win-unpacked` shapes, not installer files,
  so this should be harmless, but it is called out because both `pnpm package` and `pnpm e2e`
  now write into the same gitignored `release/` directory.
- **Windows temp-dir cleanup racing a held file handle**: Electron/Chromium can keep a
  `SingletonLock` or similar file briefly open for a few hundred ms after the process the
  Playwright `close()` call terminates returns. `temp-dirs.ts`'s `cleanup()` retries
  `fs.rm(..., { recursive: true })` a bounded number of times on `EBUSY`/`EPERM` before
  surfacing the error, rather than letting one flaky teardown fail the whole spec.
- **Setup or teardown fails halfway through**: a library-directory creation or Electron launch
  failure must not leak the app-data directory, and an `app.close()`/first-cleanup failure must
  not prevent the other temp directory from being removed. Fixture teardown attempts all
  applicable releases and reports the original/aggregate failure only after cleanup attempts.
- **Unsafe or colliding library seeds**: a seed such as `../outside.fit`, an absolute path, or
  two fixture-relative paths with the same basename must fail before copying outside the
  fixture contract or silently replacing a previously seeded file. All writes remain confined
  to the fresh library temp directory.
- **`--user-data-dir` isolates Electron's profile but not `packages/desktop/release/`
  itself** — the packaged binary is shared read-only across all specs/workers in a run; only
  per-run _state_ (temp app-data, temp library dir) is isolated. This is intentional (rebuilding
  the app per spec would be far too slow) and is why `workers: 1` (Step 1) is the safer starting
  default until it's confirmed multiple Electron instances launched from the same binary don't
  interfere with each other.
- **Native ABI mismatch surfacing only at packaged-app launch, not in unit tests**: if
  `better-sqlite3`/`sharp` were rebuilt against the wrong Electron ABI, `app.version`'s IPC call
  throws inside the real packaged process — the smoke spec's assertion on `sqliteVersion`/
  `sharpVersion` (Step 5) is the first automated check that would catch this class of bug in the
  actual shipped artifact, not just in `native-smoke.test.ts`'s plain-Node unit test.
- **Two test runners, two conventions, same repo**: Vitest's root config
  (`vitest.config.ts`) scopes the `desktop` project to `include: ['src/**/*.test.ts']`, and the
  package's own `test` script is `vitest run --dir src` — `e2e/**/*.spec.ts` is excluded from
  both by directory (not under `src/`) and by naming convention (`.spec.ts`, never `.test.ts`),
  so there is no risk of Vitest attempting to collect a Playwright spec (which would fail — a
  Playwright `test()` fixture is not a Vitest test function) or vice versa.
- **CI matrix legs don't share a `release/` build** — Windows and macOS each run `pree2e`
  independently on their own runner; there is no cross-OS artifact reuse in this plan (packaging
  is fast enough per-OS that reuse isn't worth the added workflow complexity of an
  upload/download artifact step between jobs).
- **A future spec needs a second window or a real navigation** — the app's
  `setWindowOpenHandler` denies every new-window request and `will-navigate` is locked to the
  packaged `file://` origin (`main/index.ts`), by design (DD-002's "renderer is a pure UI
  client" / P0-03's security posture). Any later E2E spec attempting to open a second window or
  navigate off-origin will correctly fail — that is the app's hardening working as intended, not
  a harness bug, and should not be "fixed" by loosening `main/index.ts`'s navigation lockdown.
- **Packaged renderer startup is slower on a cold CI host** — assertions use Playwright's
  bounded auto-retry behavior after `firstWindow()`; no `waitForTimeout` or arbitrary sleep is
  used to guess when the title, React tree, or preload bridge is ready.

## Invariant Checklist

- [x] Non-destructive: no code path writes/moves/renames/deletes user image files — the E2E
      harness never touches real user files; `--user-data-dir` and the temp library dir are both
      freshly created under the OS temp directory per run and removed in fixture teardown. The
      Step 4 ESLint rule makes bypassing the temp-dir isolation (calling `_electron.launch()`
      directly from a spec, which could fall back to a developer's real Electron `userData`
      directory) a lint failure, not just a code-review convention. Fixture seeding rejects
      paths outside the repository fixture root, and build resolution only reads generated
      package output; neither helper automatically deletes package artifacts or ambient paths.
- [x] Layering: no `packages/core` or `packages/db` changes; E2E lives entirely inside
      `packages/desktop` and drives the app only through its real IPC surface
      (`window.astrotracker.invoke`) exactly as a user's renderer would — never reaches into
      main-process internals directly.
- [x] DB: no schema/table changes; no migration.
- [x] Timestamps stored UTC: N/A, nothing persisted by this issue.
- [x] Long-running work goes through the worker job queue: N/A, no runtime app logic added —
      this issue is test infrastructure only.
- [x] Performance budgets (PRD §8.4): N/A, no runtime code path affected. CI _wall-clock_ time
      grows (native rebuild + packaging + Electron boot per OS, Step 6's `timeout-minutes: 20`),
      which is a CI-cost note, not a PRD §8.4 application-performance regression.

## Out of Scope

- Any UI beyond the single existing version screen — this issue tests what P0-03 shipped; it
  does not add pages, navigation, or fixtures for Phase 1 features that don't exist yet
  (library-folder configuration, scanning, target resolution). `createTempLibraryDir` is
  deliberately unused by the packaged-app smoke spec; its focused harness spec proves the
  helper itself, while actual scanning use remains scaffolding for later issues.
- Wiring `packages/db`'s `openDatabase` into `packages/desktop/src/main/index.ts` — the app does
  not yet persist anything under the app-data directory (P0-04 built the package; nothing in
  `main/index.ts` calls it yet). `createTempAppDataDir` is ready for whenever that lands.
- Folding the new `e2e.yml` workflow into `ci.yml`'s `ci-ok` aggregate required-status-check —
  left as a deliberately separate, not-yet-required workflow (Step 6) until the suite has run
  enough times to trust it; making it required on day one risks blocking every PR on a new
  and unproven CI leg per the same reasoning `ci-ok`'s own design (documented in
  `CONTRIBUTING.md`) already applies to flaky/renamed legs.
- Fixing `.github/workflows/package.yml`'s stale placeholder body (it still echoes "packaging
  lands in P0-03" even though P0-03 merged; P0-03's plan explicitly chose not to touch
  `.github/workflows/*` to avoid a merge conflict with the then-in-flight P0-02, and that gap was
  never closed) — pre-existing documentation/workflow debt unrelated to this issue's acceptance
  criteria; not touched here to keep this PR scoped to E2E.
- Code signing / notarization / Gatekeeper handling for the packaged artifact under test — this
  issue's builds are unsigned exactly like `pnpm package`'s (P1-33 territory); since CI builds
  and runs the app on the same machine (no download/quarantine step), Gatekeeper's
  quarantine-attribute behavior that affects a _distributed_ unsigned DMG does not apply to a
  freshly-built local unpacked binary.
- Cross-platform artifact caching/reuse between CI jobs, or trimming `pree2e`'s rebuild cost
  (e.g. caching `electron-rebuild` output) — a performance follow-up once the suite exists and
  its CI time is measured, not a prerequisite for landing it.
- Linux/`ubuntu-latest` E2E coverage — explicitly out of the issue's acceptance criteria
  (Win + mac only) and out of scope for `electron-builder.yml`, which defines no Linux target.

## Open Questions

None. The one real design decision this issue required — packaged artifact vs. dev-mode launch
— is resolved above (Defaults #1: `electron-builder --dir`) with reasoning recorded so a
reviewer can challenge the call directly instead of it being left pending.

Plan written: docs/archive/tasks/p0-08-playwright-e2e/plan.md — 7 steps

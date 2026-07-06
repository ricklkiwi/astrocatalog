# Spec: [P0-03] Electron shell with typed IPC and packaged builds

**Slug:** p0-03-electron-shell   **Issue:** #3   **Plan:** docs/plans/p0-03-electron-shell.md   **Date:** 2026-07-06

Verification-mode legend used on every criterion below (Reviewer runs on macOS only):
- **[macOS-local]** — mechanically checkable on this machine right now: unit/vitest tests, `pnpm -r lint`/`pnpm -r build`, reading config/source files, running `pnpm package` for the mac target.
- **[manual-launch]** — requires actually running `pnpm dev` or the packaged mac app and observing behavior; no mocked test substitutes for it.
- **[CI-deferred]** — cannot be produced or verified on this macOS machine at all (Windows NSIS artifact); Reviewer checks only that the *contract* to produce it exists (config, docs), not that the artifact exists.

## Definition of Done

### Functional Requirements

**AC1 — `pnpm dev` launches app with hot reload; renderer calls `app.version` over typed IPC**
- [ ] **[macOS-local]** Given `packages/desktop/src/main/index.ts`, when read, then it branches on the electron-vite-provided dev-server env var to load the Vite dev URL, and on the packaged-file env branch resolves `index.html` relative to the app bundle path (not `process.cwd()`).
- [ ] **[manual-launch]** Given `pnpm dev` run at repo root, when the process starts, then one Electron window opens showing the version screen (no manual extra steps).
- [ ] **[manual-launch]** Given `pnpm dev` running, when a file under `renderer/src/**` is edited and saved, then the change appears in the running window via HMR without a full window reload.
- [ ] **[manual-launch]** Given `pnpm dev` running, when `src/main/index.ts` is edited and saved, then Electron restarts automatically (new process, same command still running).
- [ ] **[manual-launch]** Given `pnpm dev` running, when `src/preload/index.ts` is edited and saved, then the page reloads and the bridge still functions.
- [ ] **[manual-launch]** Given the real (non-mocked) `pnpm dev` window, when the renderer calls `app.version`, then the rendered text includes app version, Electron version, Chrome version, Node version, platform, SQLite version, and sharp version — proving the full renderer → preload → main → renderer round trip over the actual `contextBridge`, not the Vitest-mocked `window.astrotracker` (Edge Cases: a broken/mis-emitted preload would still pass the mocked renderer test, so this manual check is the only thing that catches it).
- [ ] **[macOS-local]** Given `packages/desktop/src/ipc/contract.test.ts`, when run, then it asserts every channel declared in `contract.ts` is bound exactly once in `register.ts` (no channel unregistered, no channel double-registered).
- [ ] **[macOS-local]** Given `contract.test.ts`, when run, then it asserts the `app.version` handler's return value satisfies the contract's output type at the runtime-shape level (all required keys present, correct primitive types).
- [ ] **[macOS-local]** Given `renderer/src/App.test.tsx`, when run against a mocked `window.astrotracker`, then it asserts the rendered output contains the mocked version text.

**AC2 — `pnpm package` produces installable artifacts on Win and mac (verified in CI packaging workflow)**
- [ ] **[macOS-local]** Given a clean workspace on this mac, when `pnpm package` is run at repo root, then it exits 0 and `packages/desktop/release/` contains an unsigned `.dmg` for the host architecture.
- [ ] **[macOS-local]** Given `packages/desktop/electron-builder.yml`, when read, then it sets `mac.target: dmg`, `mac.identity: null`, `win.target` to NSIS x64 only, `asar: true`, `asarUnpack` covering `better-sqlite3` and `sharp` native binaries, and `npmRebuild: true`.
- [ ] **[manual-launch]** Given the built `.dmg` from this mac, when installed (bypassing Gatekeeper quarantine per README instructions) and launched, then the app window shows the version screen including a valid-looking SQLite version string and sharp version info — end-to-end proof the native-module rebuild pipeline works in a packaged mac build.
- [ ] **[CI-deferred]** Given the CI packaging workflow (owned by P0-02, not part of this diff) invoking `pnpm package` on `windows-latest`, an NSIS x64 `.exe` is produced and uploaded as an artifact — not verifiable on this machine; Reviewer checks only that `electron-builder.yml`'s `win` block and the documented command contract in README are correct, and does not require a Windows artifact to exist in this PR.
- [ ] **[macOS-local]** Given the repo diff for this issue, when `git diff --name-only <base>...HEAD` is inspected, then it contains no path under `.github/workflows/` (that tree belongs to P0-02, in flight in parallel; touching it here is out of scope and would be a merge-conflict risk).
- [ ] **[macOS-local]** Given `README.md`, when read, then it states the exact CI packaging integration contract: run `pnpm install` then `pnpm package` on `windows-latest` and `macos-latest`, and upload `packages/desktop/release/*.exe` and `*.dmg`.
- [ ] **[macOS-local]** Given `README.md`, when read, then it documents the unsigned-DMG Gatekeeper workaround (right-click → Open, or `xattr -dr com.apple.quarantine`) so testers don't misread quarantine blocking as a broken build.

**AC3 — Renderer has no nodeIntegration; preload exposes only the typed API**
- [ ] **[macOS-local]** Given `packages/desktop/src/main/index.ts`, when the `BrowserWindow` constructor call is read, then `webPreferences` sets `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, and `webSecurity` is not disabled.
- [ ] **[macOS-local]** Given `packages/desktop/src/main/index.ts`, when read, then it registers a navigation guard (`will-navigate` handler and/or `setWindowOpenHandler`) that denies navigation/new-window requests to any origin other than the app's own dev-server URL or packaged file origin.
- [ ] **[macOS-local]** Given `packages/desktop/src/preload/index.ts`, when read, then it calls `contextBridge.exposeInMainWorld` exactly once, exposing exactly one global (`window.astrotracker`), and the exposed `invoke` is gated by a whitelist derived from `contract.ts` channel names — no other Node/Electron API is exposed.
- [ ] **[macOS-local]** Given the preload whitelist logic (extracted as a plain function/module where feasible), when invoked with a channel name absent from the contract, then it throws before calling `ipcRenderer.invoke`, verified by a unit test.
- [ ] **[macOS-local]** Given `packages/desktop/src/preload/index.ts`'s build output, when inspected, then it is emitted as CJS (`.cjs` or CJS format), not ESM — required because `sandbox: true` preloads cannot use the ESM loader even though the rest of the desktop package is `"type": "module"`.
- [ ] **[macOS-local]** Given the root `eslint.config.mjs`, when a scratch file under `packages/desktop/renderer/src/**` adds a *value* import from `@astrotracker/desktop` (not `import type`), then `pnpm -r lint` fails on that file via the scoped rule; reverted afterward, `pnpm -r lint` passes.
- [ ] **[macOS-local]** Given `packages/desktop/renderer/package.json`, when read, then `@astrotracker/desktop: workspace:*` appears under `devDependencies`, never under `dependencies`.
- [ ] **[macOS-local]** Given every file under `packages/desktop/renderer/src/**`, when scanned for imports of `@astrotracker/desktop`, then all such imports use `import type` only (no runtime value crosses the renderer/desktop boundary).

### Data Integrity
- [ ] N/A — no table, column, or migration is introduced by this issue. The Step 6 native-module smoke opens an **in-memory** SQLite database (`:memory:`) purely to read `sqlite_version()`; it defines no schema and persists nothing. Schema/migrations start at P0-04.

### Core Invariants
- [ ] **[macOS-local]** No code path in the diff writes, moves, renames, or deletes files outside the app-data directory — applies vacuously: Reviewer greps `packages/desktop/src/**` for `fs.write|fs.rename|fs.unlink|writeFile|renameSync|unlinkSync` and expects zero matches outside test fixtures; the native-module smoke targets `:memory:` only, never a file path.
- [ ] **[macOS-local]** New domain logic is in packages/core with no Electron/fs imports — N/A, this issue makes no changes under `packages/core`; verified via `git diff --name-only` showing no `packages/core/**` paths touched.
- [ ] N/A — All persisted timestamps are UTC: nothing is persisted by this issue.
- [ ] N/A — Manual user overrides survive a rescan: no assignment or scanning logic exists in this issue.

### Performance
- [ ] N/A — this issue introduces no scanning, query, thumbnail, or UI-list code path; no benchmark harness exists yet (P0-07). The single IPC round trip (`app.version`) has no stated budget and is not benchmark surface.

### Tests
- [ ] **[macOS-local]** `packages/desktop/src/ipc/contract.test.ts` covers: (a) every contract channel registered exactly once, (b) `app.version` handler output matches contract output shape at runtime.
- [ ] **[macOS-local]** A unit test for the native-module smoke (run under Vitest/Node, not Electron) asserts `sqlite_version()` returns a semver-like string (e.g. matches `/^\d+\.\d+\.\d+$/`) and that `sharp`'s versions object contains a `sharp` key.
- [ ] **[macOS-local]** `packages/desktop/renderer/src/App.test.tsx` renders the app against a mocked `window.astrotracker` and asserts the version text is present (replaces the P0-01 renderer placeholder test).
- [ ] **[macOS-local]** `pnpm -r test` passes: `core` and `db` placeholder tests untouched/passing; `desktop` and `desktop/renderer` P0-01 placeholder tests (`src/index.test.ts`) are removed, not left stale alongside the new tests.
- [ ] **[macOS-local]** `pnpm -r lint` and `pnpm -r build` (`tsc --noEmit` across `src/main`, `src/preload`, `src/ipc`, and renderer `tsconfig.json`) both exit 0.
- [ ] N/A / deferred — E2E: Playwright on the packaged app is P0-08's job, explicitly out of scope here. Its manual-launch substitute in this issue is the AC1 "real `pnpm dev` window" and AC2 "installed DMG launch" checks above, which exist specifically because a mocked-bridge test cannot catch a broken preload (Edge Cases).

## Out of Scope
- Any `.github/workflows/*` file — CI and the packaging-workflow stub belong to P0-02 (parallel, in flight); this issue only documents the command contract (`pnpm package`) it should call. Reviewer must not require a workflow file to exist.
- Drizzle schema, migrations, real DB bootstrap, repositories (P0-04) — `better-sqlite3` usage here is an inert rebuild-proof only; no schema, no on-disk file, no repository layer.
- Worker pool, job queue, IPC progress events (P0-05).
- Playwright E2E on the packaged app (P0-08) — this issue's automated tests are unit-level only; manual-launch checks above are the stand-in, not a replacement requirement to add Playwright now.
- Code signing, notarization, auto-update (P1-33); mac DMG and Windows NSIS installer stay **unsigned** — Gatekeeper "damaged"/"unidentified developer" warnings on first launch are expected, not a bug, and are documented in README rather than fixed.
- Real UI: pages, navigation, shadcn/ui, Tailwind, Zustand stores (Phase 1 UI issues) — the renderer is a single version screen only; Reviewer must not ask for more UI.
- Any FITS/XISF/RAW parsing or `packages/core` changes.
- **Windows-local packaging verification** — impossible on this macOS machine; this is the one item of AC2 fully deferred to CI. Reviewer verifies only that `electron-builder.yml`'s Windows target block and README's documented CI contract are correct, not that a `.exe` was produced.
- Universal-binary or cross-arch mac builds; ia32/arm64 Windows targets — host-arch-only mac DMG, NSIS x64-only, both by design (plan default #6).
- Root `.npmrc` `node-linker=hoisted` fallback — only required if the default pnpm symlink layout breaks electron-builder's dependency collection on either OS; if `pnpm package` succeeds without it on this mac, its absence is not a defect. If added, it must be repo-wide (root `.npmrc`, not scoped).

## Test Hints
- **contract-registration-completeness**: import `contract.ts`'s channel list and `register.ts`'s bound-handlers list in the test; assert set equality (no channel missing, no extra channel bound).
- **app-version-shape**: invoke the `app.version` handler directly in a unit test (not through IPC), assert the returned object has `appVersion`, `electronVersion`, `chromeVersion`, `nodeVersion`, `platform`, `sqliteVersion`, `sharpVersion` all as non-empty strings.
- **preload-whitelist-rejects-unknown-channel**: call the preload's invoke-gating logic with `'fs.read'` (a channel that does not exist in the contract), assert it throws synchronously without touching `ipcRenderer`.
- **renderer-mocked-bridge**: render `<App />` with `window.astrotracker = { invoke: vi.fn().mockResolvedValue({ appVersion: '0.1.0', ... }) }`, assert the version text renders via TanStack Query.
- **native-smoke-under-node**: in a Vitest test (plain Node, no Electron), `new Database(':memory:')`, run `SELECT sqlite_version()`, assert semver-shaped string; `require('sharp').versions`, assert a `sharp` key exists.
- **eslint-type-only-boundary**: on a scratch copy, add `import { something } from '@astrotracker/desktop';` (value import, not `import type`) to a renderer source file, run `pnpm -r lint`, assert non-zero exit citing the scoped rule; revert before finishing.
- **window-preferences-hardening**: read the `BrowserWindow` constructor call in `src/main/index.ts`; assert `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true` are literal values, not variables that could resolve falsy/truthy unexpectedly.
- **dev-vs-packaged-branch**: read `src/main/index.ts`'s window-load logic; assert the dev branch loads a URL (`loadURL`) and the packaged branch loads a file path resolved via `app.getAppPath()`/`__dirname`-equivalent (never `process.cwd()`).
- **package-script-wiring**: read root `package.json`; assert `scripts.dev === "pnpm --filter @astrotracker/desktop dev"` and `scripts.package === "pnpm --filter @astrotracker/desktop package"`.
- **electron-builder-config**: read `packages/desktop/electron-builder.yml`; assert `mac.identity: null`, `win.target` includes `nsis` with `x64` only, `asarUnpack` lists patterns matching `better-sqlite3` and `sharp`, `npmRebuild: true`.
- **manual-dev-launch** (not automatable): run `pnpm dev`, confirm one window opens with the version screen populated (all seven fields), edit a renderer file and observe HMR, edit `src/main/index.ts` and observe Electron restart, edit `src/preload/index.ts` and observe reload.
- **manual-packaged-launch** (not automatable): run `pnpm package`, mount/install the resulting `.dmg` after clearing quarantine, launch the app, confirm the version screen matches the dev-mode output including SQLite/sharp versions.

Spec written: docs/specs/p0-03-electron-shell.md — 35 criteria

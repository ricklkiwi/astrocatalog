# Plan: [P0-03] Electron shell with typed IPC and packaged builds

**Slug:** p0-03-electron-shell   **Issue:** #3   **Date:** 2026-07-05
**Governing DDs:** DD-001 (tech stack), DD-002 (application architecture / layering rules)
**Status:** READY_FOR_SPEC

## Summary

This issue turns the placeholder `@astrotracker/desktop` and `@astrotracker/renderer` packages
into a real Electron application: an ESM main process, a sandboxed preload that exposes exactly
one narrow typed API over `contextBridge`, a React 18 renderer served by Vite with HMR, and a
hand-rolled typed IPC contract (DD-001 explicitly permits "electron-trpc **or hand-rolled typed
IPC**"; hand-rolled is chosen — the upstream `electron-trpc` package has lagged tRPC v11 and
survives via community forks, and a single-file typed contract carries zero runtime dependency
risk while giving the same end-to-end inference). One demo procedure, `app.version`, proves the
full path renderer → preload → main and back, and its response embeds the SQLite version obtained
through `better-sqlite3` so that a packaged build mechanically proves the native-module rebuild
pipeline works. `electron-builder` produces an unsigned Windows NSIS installer and an unsigned
macOS DMG via a root `pnpm package` script; the CI packaging workflow (owned by P0-02, in flight
in parallel) only needs to run that one script per OS and upload artifacts — that command is the
whole integration contract.

## Defaults chosen (no DD dictates these — recorded here so deviations are visible)

1. **Hand-rolled typed IPC**, not `electron-trpc` (rationale above; DD-001 sanctions either).
2. **Build tool: `electron-vite`** (the electron-vite.org package) in `packages/desktop`,
   configured so the renderer root points at `packages/desktop/renderer/`. It gives Vite HMR for
   the renderer, hot restart for main, and hot reload for preload out of one `dev` command,
   matching DD-001's "Vite + electron-builder" row.
3. **Contract types shared via a type-only edge**: the contract lives in
   `packages/desktop/src/ipc/contract.ts`; the renderer declares `@astrotracker/desktop` as a
   **devDependency** and may import from it **only** with `import type` (enforced by an ESLint
   rule scoped to `packages/desktop/renderer/src/**`). No runtime code crosses the boundary, so
   DD-002 rule 2 ("renderer communicates only through the typed IPC contract") and the README's
   "no direct renderer→desktop import path" rule are preserved — types are erased at build time.
4. **`sandbox: true` + CommonJS preload.** Electron sandboxed preloads cannot use the ESM
   loader, so the preload is emitted as `.cjs`/CJS by electron-vite while main stays ESM. Keeping
   the sandbox on is the stronger security posture and costs nothing at this stage.
5. **`better-sqlite3` and `sharp` are added as `@astrotracker/desktop` dependencies now**, even
   though DB work is P0-04 and thumbnails are Phase 1. The issue text requires the packaging
   config to include their native rebuild; a rebuild path that is never exercised is untested,
   so both modules ship with a startup smoke usage (see Step 6). P0-04's real DB code later
   moves `better-sqlite3` usage behind `packages/db`.
6. **Mac builds current-architecture only** (arm64 on Apple Silicon runners/machines, x64 on
   Intel); no universal binary in Phase 0. Windows target: NSIS x64 only (no ia32/arm64).

## Affected Files

- `packages/desktop/package.json` — modified; adds `electron`, `electron-vite`,
  `electron-builder`, `better-sqlite3`, `sharp` (+ types); `main` repointed at the electron-vite
  output (`out/main/index.js`); new `dev`, `typecheck`, `package` scripts; `build` becomes
  `electron-vite build` (with `tsc --noEmit` kept as the typecheck)
- `packages/desktop/electron.vite.config.ts` — new; main/preload/renderer sections; renderer
  root = `renderer/`; workspace deps (`@astrotracker/*`) bundled, native modules
  (`better-sqlite3`, `sharp`) externalized
- `packages/desktop/electron-builder.yml` — new; appId/productName, `directories.output`,
  `files` (electron-vite `out/` only), `asar: true`, `asarUnpack` for `better-sqlite3`/`sharp`,
  `npmRebuild: true`, `win.target: nsis (x64)`, `mac.target: dmg`, `mac.identity: null`
  (unsigned), artifact naming including version + arch
- `packages/desktop/src/main/index.ts` — new; app lifecycle, `BrowserWindow` with
  `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, dev-URL vs packaged-file
  loading, navigation/window-open lockdown
- `packages/desktop/src/main/ipc/register.ts` — new; binds every contract procedure to
  `ipcMain.handle` from one source of truth
- `packages/desktop/src/ipc/contract.ts` — new; the typed IPC contract (channel names, input
  and output types, `app.version` procedure); the single file both sides derive types from
- `packages/desktop/src/ipc/contract.test.ts` — new; unit tests for the contract/registration
  invariants
- `packages/desktop/src/preload/index.ts` — new; `contextBridge.exposeInMainWorld` of the typed
  invoke surface only, with a hard whitelist of contract channel names
- `packages/desktop/src/index.ts`, `src/index.test.ts` — removed/replaced by the real entries
  above (placeholder from P0-01 retires)
- `packages/desktop/tsconfig.json` — modified; covers `src/main`, `src/preload`, `src/ipc`
- `packages/desktop/renderer/package.json` — modified; adds `react`, `react-dom`,
  `@tanstack/react-query`, `@vitejs/plugin-react` (+ types), and a type-only devDependency
  `@astrotracker/desktop: workspace:*`
- `packages/desktop/renderer/index.html` — new; Vite entry
- `packages/desktop/renderer/src/main.tsx`, `src/App.tsx` — new; React root + a component that
  calls `app.version` through TanStack Query (per DD-002's "TanStack Query against typed IPC")
- `packages/desktop/renderer/src/ipc.ts` — new; thin typed client wrapping `window.astrotracker`
- `packages/desktop/renderer/src/window.d.ts` — new; ambient declaration of the preload-exposed
  API using `import type` from the contract
- `packages/desktop/renderer/src/App.test.tsx` (replacing placeholder `index.test.ts`) — new;
  renders the version view against a mocked `window.astrotracker`
- `packages/desktop/renderer/tsconfig.json` — modified; DOM lib, JSX, bundler module resolution
- `eslint.config.mjs` (root) — modified; new scoped rule: renderer sources may reference
  `@astrotracker/desktop` only via type-only imports; React hooks plugin for renderer files
- `package.json` (root) — modified; `dev` → `pnpm --filter @astrotracker/desktop dev`,
  `package` → `pnpm --filter @astrotracker/desktop package`
- `.npmrc` (root) — new, only if needed (see Edge Cases): `node-linker=hoisted` fallback for
  electron-builder + pnpm symlink issues
- `README.md` — modified; commands section gains `pnpm dev` / `pnpm package`; layering section
  gains the "type-only contract import" clarification; a short "CI packaging integration
  (P0-02)" note stating the workflow contract: run `pnpm package` on `windows-latest` and
  `macos-latest`, collect `packages/desktop/release/*.exe|*.dmg`

## Implementation Steps

### Step 1 — Electron main process boots a secure window
**Outcome:** `packages/desktop` owns an Electron dependency and a main-process entry that opens
a `BrowserWindow` hardened per Electron security guidance: `contextIsolation: true`,
`sandbox: true`, `nodeIntegration: false`, webSecurity on, all `window.open`/navigation denied
except the app's own origin/dev-server URL. In dev it loads the Vite dev-server URL (from the
env electron-vite provides); packaged, it loads the built renderer `index.html` from the app
bundle. App quits on all-windows-closed (except macOS convention).
**Files:** `packages/desktop/package.json`, `packages/desktop/src/main/index.ts`,
`packages/desktop/tsconfig.json`
**Depends on:** none

### Step 2 — Typed IPC contract with `app.version`
**Outcome:** A single contract module defines the IPC surface as data + types: channel name
`app.version`, input `void`, output an object carrying app version, Electron/Chrome/Node
versions, platform, and (after Step 6) the loaded SQLite version. Main-process registration is
derived from the contract (`register.ts` maps every procedure to `ipcMain.handle`), so a
procedure cannot exist without appearing in the shared type, and renderer/preload cannot name a
channel the contract doesn't declare. Unit tests pin the invariants: every contract channel gets
registered exactly once; the `app.version` handler's return value satisfies the contract output
type at runtime shape level.
**Files:** `packages/desktop/src/ipc/contract.ts`, `packages/desktop/src/main/ipc/register.ts`,
`packages/desktop/src/ipc/contract.test.ts`
**Depends on:** Step 1

### Step 3 — Preload bridge exposing only the typed API
**Outcome:** A sandboxed CJS preload exposes exactly one global (`window.astrotracker`) via
`contextBridge.exposeInMainWorld`. The exposed object offers a typed `invoke` keyed to contract
channel names, backed by a hard whitelist — invoking any channel outside the contract throws in
the preload, before reaching `ipcRenderer`. Nothing else from Node/Electron is reachable from
the page. This is the acceptance criterion "preload exposes only the typed API" made mechanical.
**Files:** `packages/desktop/src/preload/index.ts`
**Depends on:** Step 2

### Step 4 — React renderer calls `app.version` over the bridge
**Outcome:** The renderer package becomes a real React 18 + Vite app. An ambient `window.d.ts`
types `window.astrotracker` using `import type` from the desktop contract (types only — erased
at compile time; ESLint forbids value imports across this boundary). A thin `ipc.ts` client
wraps the global; `App.tsx` fetches `app.version` through TanStack Query and renders the
result, which is the visible proof of the typed round-trip. A Vitest test renders the app
against a mocked `window.astrotracker` and asserts the version text appears, so the renderer
has coverage without Electron (real-process E2E is P0-08's job).
**Files:** `packages/desktop/renderer/package.json`, `index.html`, `src/main.tsx`,
`src/App.tsx`, `src/ipc.ts`, `src/window.d.ts`, `src/App.test.tsx`, `tsconfig.json`; root
`eslint.config.mjs` (type-only-import rule)
**Depends on:** Step 3

### Step 5 — `pnpm dev` with hot reload, wired through electron-vite
**Outcome:** `pnpm dev` at the repo root starts one command that builds main + preload, boots
the Vite dev server for `renderer/`, and launches Electron against it. Editing renderer code
hot-replaces modules without app restart; editing main restarts Electron; editing preload
reloads the page. `electron.vite.config.ts` bundles `@astrotracker/*` workspace sources into
the main output (so packaged apps don't depend on workspace symlinks) and externalizes only
native modules. First acceptance criterion is demonstrable after this step.
**Files:** `packages/desktop/electron.vite.config.ts`, `packages/desktop/package.json`
(scripts), root `package.json` (`dev` script), removal of P0-01 placeholder
`packages/desktop/src/index.ts`/`index.test.ts`
**Depends on:** Step 4

### Step 6 — Native modules present and provably rebuilt
**Outcome:** `better-sqlite3` and `sharp` are dependencies of `@astrotracker/desktop`,
externalized from the bundle. At startup the main process opens an in-memory SQLite database and
reads `sqlite_version()`, and reads `sharp`'s versions object; both land in the `app.version`
response the renderer displays. Consequence: if either module was compiled against the wrong ABI
(Node instead of Electron, or wrong arch), the packaged app visibly fails this call — the
rebuild pipeline cannot silently rot. No user files, no on-disk DB, no image processing — the
usage is deliberately inert (DB work proper is P0-04).
**Files:** `packages/desktop/package.json` (deps), `packages/desktop/src/main/index.ts` or a
small `src/main/native-smoke.ts`, `packages/desktop/src/ipc/contract.ts` (output type gains the
two version fields), renderer `App.tsx`/test updated for the richer payload
**Depends on:** Steps 2, 5

### Step 7 — electron-builder packaging: Win NSIS + mac DMG, unsigned
**Outcome:** `pnpm package` at the repo root runs the production electron-vite build then
electron-builder for the host OS: on Windows an NSIS x64 installer, on macOS a DMG for the host
arch, both unsigned (`mac.identity: null`; no Windows cert configured). `npmRebuild: true`
ensures better-sqlite3/sharp are rebuilt against the Electron headers during packaging;
`asarUnpack` keeps their `.node` binaries loadable outside the asar archive. Output lands in
`packages/desktop/release/` (gitignored). Installing the artifact on this mac and launching it
shows the version screen including the SQLite version — end-to-end proof for the second and
third acceptance criteria on macOS; Windows proof comes from the CI packaging workflow (below).
**Files:** `packages/desktop/electron-builder.yml`, `packages/desktop/package.json` (`package`
script), root `package.json` (`package` script), `.gitignore` (add `packages/desktop/release/`,
`packages/desktop/out/`), possibly root `.npmrc` (see Edge Cases)
**Depends on:** Steps 5, 6

### Step 8 — CI packaging integration point + docs
**Outcome:** The repository documents the exact contract the P0-02 packaging workflow stub needs
— run `pnpm install`, `pnpm package` on `windows-latest` and `macos-latest`, upload
`packages/desktop/release/*.exe` and `*.dmg` — without this issue creating or editing any
`.github/workflows/` file (P0-02 owns that tree and is in flight in parallel; touching it here
would guarantee a merge conflict). README command table updated (`pnpm dev`, `pnpm package`),
layering section updated to describe the type-only contract import rule and why it does not
violate the "no renderer→desktop import" rule.
**Files:** `README.md`
**Depends on:** Step 7

## Edge Cases

- **pnpm symlinked `node_modules` vs electron-builder dependency collection**: electron-builder
  walking `node_modules` to collect/rebuild production deps has a history of missing packages
  under pnpm's symlink layout. If `pnpm package` fails to include or rebuild
  better-sqlite3/sharp, the sanctioned fallback is a root `.npmrc` with `node-linker=hoisted`
  (repo-wide, affects all packages — must be committed, not local). The plan treats this as
  conditional: only add it if the default layout fails on either OS.
- **Sandboxed preload cannot be ESM**: the desktop package is `"type": "module"`, but a
  `sandbox: true` preload runs without the ESM loader. The preload must be emitted as CJS
  (`.cjs` extension or CJS format from electron-vite); silently shipping `.mjs` produces
  "Unable to load preload script" only at runtime, with the renderer then having no bridge —
  the renderer test's mocked global would still pass, so a manual dev-run check of the real
  bridge is part of this issue's verification.
- **Packaged app accidentally depending on the dev-server URL**: main must branch on the
  electron-vite-provided dev env var, and the packaged branch must resolve `index.html` relative
  to the app bundle (not `process.cwd()`), or the installed app shows a blank window while
  `pnpm dev` looks perfectly healthy.
- **Compromised/buggy renderer invoking a non-contract channel**: preload whitelist rejects
  channel names not in the contract, so `window.astrotracker.invoke('fs.read', …)` (or any
  future typo) fails closed in the preload rather than reaching `ipcMain`.
- **ABI mismatch in native modules** (rebuilt for system Node, not Electron; or x64 binary in an
  arm64 app): app launches but `better-sqlite3` throws `NODE_MODULE_VERSION` mismatch on
  require. The Step 6 startup smoke turns this into a visible failure in the packaged artifact
  instead of a latent P0-04 landmine.
- **Unsigned mac DMG and Gatekeeper**: on first open macOS quarantines the app
  ("damaged"/"unidentified developer"). Expected until P1-33 (signing/notarization); README
  packaging note documents right-click-Open / `xattr -dr com.apple.quarantine` for testers so
  it isn't misread as a broken build.
- **Renderer devDependency edge misused at runtime**: someone writes
  `import { something } from '@astrotracker/desktop'` (value import) in renderer code — must
  fail `pnpm -r lint` via the scoped ESLint rule, not merely fail at bundle time, because Vite
  could happily bundle main-process code into the renderer otherwise.
- **Two Vite instances/versions** (renderer package's own tooling vs electron-vite's bundled
  Vite): version skew can produce confusing plugin errors. The renderer's Vite-related deps must
  satisfy the peer range of the chosen electron-vite version; pin them together.
- **macOS lifecycle conventions**: window-all-closed on mac should not quit (activate re-creates
  the window); on Windows it quits. Trivial but always forgotten, and P0-08's smoke test will
  run on both OSes.

## Invariant Checklist

- [x] Non-destructive: no code path writes/moves/renames/deletes user image files — the app
      touches no user files at all; SQLite smoke is in-memory only
- [x] Layering: no new domain logic; `packages/core` untouched. Renderer↔main separation
      enforced by contextIsolation + sandbox + whitelisted preload + type-only-import lint rule
      (DD-002 rules 1–2)
- [x] DB: no tables/columns created — the in-memory smoke DB persists nothing and defines no
      schema (schema/migrations are P0-04); no migration needed, so no migration Step 1
- [x] Timestamps stored UTC — N/A, nothing persisted
- [x] Long-running work goes through the worker job queue — N/A, no long-running work; the only
      IPC handler returns in microseconds (queue itself is P0-05)
- [x] Performance budgets (PRD §8.4) — no scan/parse/query paths introduced; no benchmark
      surface affected

## Out of Scope

- Any `.github/workflows/*` file — CI and the packaging-workflow stub belong to P0-02 (parallel,
  in flight); this issue only documents the command contract (`pnpm package`) it should call
- Drizzle schema, migrations, real DB bootstrap, repositories (P0-04) — better-sqlite3 here is
  an inert rebuild-proof only
- Worker pool, job queue, IPC progress events (P0-05)
- Playwright E2E on the packaged app (P0-08) — this issue's tests are unit-level only
- Code signing, notarization, auto-update (P1-33); mac DMG and Win NSIS stay unsigned
- Real UI: pages, navigation, shadcn/ui, Tailwind, Zustand stores (DD-008 / Phase 1 UI issues) —
  the renderer is a single version screen
- Any FITS/XISF/RAW parsing or `packages/core` changes
- Windows-local packaging verification — impossible on this macOS machine; covered by the CI
  packaging workflow once P0-02's stub invokes `pnpm package`
- Universal-binary or cross-arch mac builds; ia32/arm64 Windows targets

## Open Questions

None — the six defaults at the top of this plan (hand-rolled IPC, electron-vite, type-only
contract sharing, sandboxed CJS preload, native deps added now with a startup smoke,
host-arch-only artifacts) are judgment calls no DD constrains, chosen to be cheap to reverse;
each is flagged there for reviewer attention rather than blocking work.

Plan written: docs/plans/p0-03-electron-shell.md — 8 steps

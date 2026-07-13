# AstroTracker

Desktop-first astrophotography data catalog: file/session management with FITS/XISF metadata auto-extraction, integration-time tracking per target across years of sessions, calibration frame matching, and (later phases) intelligent target recommendations.

## Status

Pre-development. Architecture and full task plan are complete; implementation issues are tracked in [Issues](../../issues).

## Documents

| Location                                                             | Contents                                                                  |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [`planning/PRD-AstroTracker-v1.md`](planning/PRD-AstroTracker-v1.md) | Product requirements                                                      |
| [`planning/development-plan.md`](planning/development-plan.md)       | Phases, milestones, working agreements, testing strategy                  |
| [`planning/task-breakdown.md`](planning/task-breakdown.md)           | All 79 tasks (source of the GitHub issues)                                |
| [`design/`](design/)                                                 | Design decisions DD-001…DD-008 — **authoritative** for all implementation |
| [`CLAUDE.md`](CLAUDE.md)                                             | Instructions for coding agents                                            |

## Stack (DD-001)

Electron + React + TypeScript, SQLite (better-sqlite3 + Drizzle), pnpm monorepo. Windows primary, macOS secondary.

## Package layout & layering rules (DD-002)

pnpm workspace with four packages plus a `fixtures/` directory:

| Package                     | Role                                                                                                      | May depend on                            |
| --------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `packages/core`             | Pure domain logic — parsers, target resolution, session detection, calibration matching, integration math | nothing (zero runtime dependencies)      |
| `packages/db`               | Drizzle schema, migrations, repositories (from P0-04)                                                     | `@astrotracker/core`                     |
| `packages/desktop`          | Electron main process, preload, workers (from P0-03)                                                      | `@astrotracker/core`, `@astrotracker/db` |
| `packages/desktop/renderer` | React UI — its own workspace member                                                                       | nothing (IPC only)                       |
| `fixtures/`                 | Real-world FITS/XISF/RAW header samples + manifests (populated in P0-06)                                  | —                                        |

Allowed dependency direction: `core` ← `db` ← `desktop`. The renderer is deliberately
independent — it declares no _value_-level dependency on `core`, `db`, or `desktop`, and
`desktop` declares none on `renderer`. The renderer reaches main-process functionality **only**
over the typed IPC contract (`packages/desktop/src/ipc/contract.ts`); a direct `renderer` →
`desktop` (or reverse) _runtime_ import is never a permitted path.

**Type-only exception (P0-03):** `packages/desktop/renderer/package.json` lists
`@astrotracker/desktop: workspace:*` as a **devDependency** so the renderer can `import type`
the IPC contract (channel names, input/output types) and get full end-to-end type inference on
`window.astrotracker.invoke(...)` calls. This does not violate the "no renderer→desktop import"
rule: TypeScript erases `import type` at compile time, so zero runtime code crosses the
boundary — only types, which never ship in the bundle. A root ESLint rule scoped to
`packages/desktop/renderer/src/**` enforces this mechanically: any _value_ import from
`@astrotracker/desktop` fails `pnpm -r lint`, even though a type-only import of the same
specifier passes.

**`core` must stay pure:** no Electron dependency and no `fs` imports — parsers accept
Buffers/streams. This is enforced mechanically, not by convention: `packages/core/package.json`
has an empty `dependencies` field, and the root ESLint config applies a `no-restricted-imports`
rule to `packages/core/src/**` that fails `pnpm -r lint` on any `electron`, `fs`, `node:fs`, or
`node:fs/promises` import.

### Commands

```
pnpm install        # bootstrap the workspace
pnpm -r build       # tsc build, dependency order
pnpm typecheck      # alias for pnpm -r build (the build is the typecheck)
pnpm lint           # root sweep (eslint on root configs + prettier --check .) then pnpm -r lint
pnpm test           # root vitest run across all four projects (core, db, desktop, renderer)
pnpm -r test        # same tests, run per package instead
pnpm dev            # launch the Electron app with hot reload (P0-03)
pnpm package        # build an installable artifact for this OS (P0-03)
pnpm e2e            # playwright on the packaged app (P0-08)
pnpm bench          # run P0-07 benchmark regression gate against committed baselines
pnpm bench:update-baseline # intentionally refresh bench/baselines/results.json
```

## Contributing / CI

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the PR workflow, the local gate
(`pnpm install && pnpm -r build && pnpm lint && pnpm test`), the benchmark gate
(`pnpm bench`), and the branch-protection setup. CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml))
runs build/lint/test on ubuntu/windows/macos and runs benchmarks on ubuntu only; the aggregate
`ci-ok` job is the required status check.

## Electron shell (P0-03)

`packages/desktop` is a real Electron app: an ESM main process, a sandboxed CJS preload that
exposes exactly one global (`window.astrotracker`) gated by a whitelist derived from the typed
IPC contract, and a React 18 + Vite renderer built by `electron-vite`. The one procedure,
`app.version`, returns app/Electron/Chrome/Node/platform info plus the SQLite and sharp versions
read by an in-memory-only native-module smoke test — proof the native rebuild pipeline (see
below) actually works, not just that the modules are listed as dependencies.

`pnpm dev` runs `electron-vite dev --watch` for `@astrotracker/desktop`: editing
`renderer/src/**` hot-replaces modules without a window reload, editing `src/main/**` restarts
Electron, editing `src/preload/**` reloads the page (bridge still functions after reload).

### Native modules and Electron's ABI

`better-sqlite3` links against Node's native addon ABI, which differs between plain Node.js and
Electron's embedded Node — a module built for one throws `NODE_MODULE_VERSION` mismatch under
the other. (`sharp` uses N-API, which is ABI-stable, so it needs no special handling.) The
desktop package's scripts flip `better-sqlite3` to the ABI each command needs:

- `predev` runs `electron-rebuild -f -w better-sqlite3` before `pnpm dev` — the workspace
  `node_modules` copy becomes Electron-ABI.
- `pretest` runs `pnpm rebuild better-sqlite3` before `vitest` — reverts to the ambient
  (plain-Node) ABI, since Vitest itself runs under plain Node.
- `pnpm package` runs the same `electron-rebuild` step explicitly before invoking
  `electron-builder`, in addition to `electron-builder.yml`'s own `npmRebuild: true` — belt and
  suspenders, because `electron-builder`'s internal rebuild reported success without changing
  the shipped binary in one sandboxed environment during development of this issue.

Because these scripts mutate a shared `node_modules`, running `pnpm dev` and then `pnpm -r test`
back to back triggers a native rebuild each time (a few seconds) — expected, not a bug.

### Packaging (`pnpm package`)

`packages/desktop/electron-builder.yml` configures `electron-builder`: `mac.target: dmg` /
`mac.identity: null` (unsigned — see below), `win.target: nsis` restricted to `x64`, `asar: true`
with `asarUnpack` covering `better-sqlite3`/`sharp`'s native binaries (asar archives can't
`dlopen` into themselves), and `npmRebuild: true`. Output lands in `packages/desktop/release/`
(gitignored), host-architecture only — no universal mac binary, no ia32/arm64 Windows targets.

**Unsigned artifacts and Gatekeeper:** the mac DMG and Windows NSIS installer are unsigned
(code signing and notarization land in P1-33). On first launch, macOS Gatekeeper reports the app
as "damaged" or from an "unidentified developer" — this is expected, not a broken build. Testers
should either right-click the app → **Open** (bypasses the warning after one confirmation), or
run:

```
xattr -dr com.apple.quarantine /Applications/AstroTracker.app
```

### E2E on the packaged app (P0-08)

`pnpm e2e` builds the `electron-builder --dir` unpacked artifact (same asar/asarUnpack/npmRebuild
pipeline as the release builds) and runs the Playwright suite in `packages/desktop/e2e/` against
it.

**Adding an E2E spec:** every spec imports `test`/`expect` from
[`packages/desktop/e2e/fixtures.ts`](packages/desktop/e2e/fixtures.ts) and uses its `electronApp`
fixture — never `_electron.launch()` directly. Launched bare, Electron falls back to your REAL
user-data directory, which the non-destructive guarantee forbids a test from touching; the
fixture isolates every run in fresh temp `--user-data-dir` and library-folder directories and
removes them in teardown. A scoped ESLint rule fails `pnpm -r lint` on any `*.spec.ts` importing
`_electron`, so this is mechanically enforced, not a convention. See `fixtures.ts`'s top comment
for the full pattern.

### CI packaging integration contract (P0-02)

`.github/workflows/package.yml` (added by P0-02) is a manual-dispatch stub with a placeholder
step — it does not yet build or upload anything. Wiring it up is a small follow-up: run
`pnpm install && pnpm package` on both `windows-latest` and `macos-latest`, then upload
`packages/desktop/release/*.exe` (from Windows) and `packages/desktop/release/*.dmg` (from macOS)
as build artifacts.

## Development order

Phase 0 issues (P0-01 … P0-08) bootstrap the monorepo, CI, DB layer, and test harnesses and must land first — start with P0-01. Phase 1 (P1-01 … P1-34) delivers MVP v1.0. Dependencies are stated in each issue body.

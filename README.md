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
independent — it declares **no** workspace dependency on `core`, `db`, or `desktop`, and
`desktop` declares none on `renderer`. Once the typed IPC contract lands (P0-03), the renderer
reaches main-process functionality **only** over IPC; a direct `renderer` → `desktop` (or
reverse) import is never a permitted path.

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
```

## Contributing / CI

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the PR workflow, the local gate
(`pnpm install && pnpm -r build && pnpm lint && pnpm test`), and the branch-protection
setup. CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs the same gate on
ubuntu/windows/macos for every PR and push to `main`; the aggregate `ci-ok` job is the
required status check.

## Development order

Phase 0 issues (P0-01 … P0-08) bootstrap the monorepo, CI, DB layer, and test harnesses and must land first — start with P0-01. Phase 1 (P1-01 … P1-34) delivers MVP v1.0. Dependencies are stated in each issue body.

# AstroTracker

Desktop-first astrophotography data catalog: file/session management with FITS/XISF metadata auto-extraction, integration-time tracking per target across years of sessions, calibration frame matching, and (later phases) intelligent target recommendations.

## Status

Pre-development. Architecture and full task plan are complete; implementation issues are tracked in [Issues](../../issues).

## Documents

| Location | Contents |
|---|---|
| [`planning/PRD-AstroTracker-v1.md`](planning/PRD-AstroTracker-v1.md) | Product requirements |
| [`planning/development-plan.md`](planning/development-plan.md) | Phases, milestones, working agreements, testing strategy |
| [`planning/task-breakdown.md`](planning/task-breakdown.md) | All 79 tasks (source of the GitHub issues) |
| [`design/`](design/) | Design decisions DD-001…DD-008 — **authoritative** for all implementation |
| [`CLAUDE.md`](CLAUDE.md) | Instructions for coding agents |

## Stack (DD-001)

Electron + React + TypeScript, SQLite (better-sqlite3 + Drizzle), pnpm monorepo. Windows primary, macOS secondary.

## Development order

Phase 0 issues (P0-01 … P0-08) bootstrap the monorepo, CI, DB layer, and test harnesses and must land first — start with P0-01. Phase 1 (P1-01 … P1-34) delivers MVP v1.0. Dependencies are stated in each issue body.

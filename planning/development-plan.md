# AstroTracker — Development Plan

**Repo:** https://github.com/ricklkiwi/astrocatalog
**PRD:** `../requirements/PRD-AstroTracker-v1.md`
**Design decisions:** `../design/` (DD-001 … DD-008) — authoritative for all tasks
**Task breakdown:** `task-breakdown.md` (issue-ready, agent-readable)
**Date:** 2026-07-05

## 1. Summary

AstroTracker is a cross-platform (Windows primary, macOS secondary) Electron + React + TypeScript desktop app with a SQLite metadata catalog, later extended with a Node/PostgreSQL cloud service for sync and target recommendations. Development is organized into six phases mapping to PRD versions: Phase 0 (foundations) and Phase 1 (MVP v1.0) deliver the offline desktop core; Phases 2–5 deliver v2.0–v5.0 of the roadmap.

Each task in `task-breakdown.md` is scoped to be a single GitHub issue completable by a coding agent: it names the package(s) touched, references the governing DDs, and states acceptance criteria including tests. Dependencies between tasks are explicit (`Depends on:`), so issues can be picked up in parallel wherever no dependency exists.

## 2. Phase overview

| Phase | Deliverable                 | Theme                                                                          | Task IDs      | Est. issues |
| ----- | --------------------------- | ------------------------------------------------------------------------------ | ------------- | ----------- |
| 0     | Repo & platform foundations | Monorepo, CI, Electron shell, DB layer, fixtures                               | P0-01 … P0-08 | 8           |
| 1     | MVP v1.0                    | Scanning, targets, sessions, calibration, projects, stats, packaging           | P1-01 … P1-34 | 34          |
| 2     | v2.0                        | Cloud service, auth, metadata sync, Tonight's Sky, recommendations, weather    | P2-01 … P2-14 | 14          |
| 3     | v3.0                        | Community benchmarks, shared lists, club projects, AstroBin, public stats      | P3-01 … P3-08 | 8           |
| 4     | v4.0                        | Capture-software hooks, auto-import, quality scoring, mosaics, maintenance log | P4-01 … P4-09 | 9           |
| 5     | v5.0                        | ML suggestions, predictive completion, planning calendar, quality trends       | P5-01 … P5-06 | 6           |

Total: **79 issues**. Phase 1 is the critical path to beta; a closed beta (PRD §9: 50 users) should start after milestone M4 below.

## 3. Phase 1 milestones (MVP)

| Milestone                 | Definition of done                                                                  | Gated by tasks                |
| ------------------------- | ----------------------------------------------------------------------------------- | ----------------------------- |
| M1 Walking skeleton       | Packaged app opens, empty dashboard, DB migrates, CI green on Win+mac               | P0-01…P0-08                   |
| M2 Indexing core          | Watch folder scan populates catalog; FITS/XISF/RAW parsed; incremental rescan works | P1-01…P1-09                   |
| M3 Target library         | Targets auto-grouped, integration times correct, review queue functional            | P1-10…P1-16                   |
| M4 Sessions & calibration | Sessions auto-detected; calibration matching + gap report                           | P1-17…P1-23 → **closed beta** |
| M5 Full MVP               | Projects, statistics/export, thumbnails, settings, onboarding, free-tier limit      | P1-24…P1-31                   |
| M6 Release 1.0            | Performance targets verified, installers signed, auto-update, docs                  | P1-32…P1-34                   |

## 4. Working agreements (binding for all issues)

1. **DDs are law.** If an implementation needs to deviate from a DD, the issue outcome is a proposed DD revision, not a silent divergence.
2. **Core logic is pure.** Parsers, resolvers, session detection, calibration matching live in `packages/core` with no I/O; unit tests are table-driven against `fixtures/`.
3. **Tests are part of done.** Every issue's acceptance criteria include tests; CI (lint, typecheck, unit) must pass. UI issues include at least a smoke-level Playwright test once the E2E harness (P0-08) exists.
4. **Non-destructive guarantee** (PRD §5.2): no code path may modify, move, rename, or delete user image files. Reviewers reject any PR that writes outside app-data except explicit exports.
5. **Performance budgets** (PRD §8.4) are enforced by benchmark tests (P0-07, P1-32): 10k headers scanned < 5 min, 100k-file library loads < 3 s, target dashboard < 1 s.
6. **Conventional commits**, PR per issue, squash merge. Issue labels: `phase:N`, `pkg:core|db|desktop|cloud`, `type:feat|infra|test|docs`.

## 5. Dependency shape

```
P0 (foundations) ──► P1 scanning (P1-01..09) ──► targets (P1-10..16)
                                    │                    │
                                    ├──► sessions (P1-17..19)
                                    │            └──► calibration (P1-20..23)
                                    └──► thumbnails (P1-26..27)
targets+sessions ──► projects (P1-24..25) ──► stats/export (P1-28..29)
all M2-M5 ──► perf/packaging/release (P1-32..34)
P1 complete ──► P2 cloud (P2-01..) ──► P3 community ──► P5 intelligence
P1 complete ──► P4 automation (mostly independent of P2/P3)
```

Phases 2 and 4 can run concurrently after Phase 1 if capacity allows; Phase 3 depends on Phase 2's auth/sync; Phase 5 depends on data accumulated by 2–4.

## 6. Testing strategy

- **Unit (Vitest):** all `packages/core` logic; fixtures library of real headers from N.I.N.A., SGPro, APT, SharpCap, ASIStudio, Voyager, plus malformed/edge cases (P0-06). Target ≥ 90% coverage in `core`.
- **Integration:** DB repositories + pipeline stages against temp SQLite; migration round-trips.
- **E2E (Playwright):** onboarding, scan, target browse, calibration report on a packaged build with a synthetic library.
- **Benchmarks:** synthetic 10k/100k-file libraries in CI with regression thresholds.
- **Manual beta:** M4 closed beta with real multi-TB libraries — the fixture set cannot anticipate every capture-software quirk; beta feedback feeds the software-profile table (DD-004).

## 7. Risks tracked during development

| Risk (from PRD §10)                                 | Engineering response                                                                     |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| FITS header inconsistency                           | Data-driven software profiles + fixtures grown from beta telemetry (opt-in header dumps) |
| Large-library performance                           | Benchmarks in CI from Phase 0; virtualized UI; staged pipeline                           |
| Native module packaging pain (sharp/better-sqlite3) | P0-03 proves packaged builds on both OSes before feature work                            |
| Scope creep in MVP                                  | Phases 2+ items must not enter Phase 1 PRs; review queue is the only "AI-ish" v1 feature |

## 8. Release & distribution

- electron-builder: NSIS installer (Win), notarized DMG (mac), both x64 + arm64.
- Auto-update via electron-updater against GitHub Releases.
- Versioning: semver; v0.x during Phase 1, v1.0.0 at M6.
- Free-tier 10k-file limit shipped in v1 but license enforcement/payments deferred to Phase 2 (P2-13) — beta builds are unrestricted.

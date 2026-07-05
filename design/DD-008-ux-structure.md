# DD-008: UX Structure & UI Conventions

**Status:** Accepted
**Date:** 2026-07-05

## Navigation (left sidebar)

1. **Dashboard** — library totals, integration this month, recent sessions, targets by status, calibration health warnings.
2. **Targets** — card grid + table toggle; search/filter bar (name, filter, equipment, date, status, integration range). Target detail: hero image, per-filter integration bars, session timeline, equipment list, calibration status, linked projects, notes.
3. **Sessions** — calendar heat-map + chronological list. Session detail: frames by target/filter, equipment, conditions, quality stats, notes.
4. **Calibration** — master library grouped by camera/type; gap report ("lights lacking matching darks"); provenance view.
5. **Projects** — processing projects kanban by status; project detail links inputs → outputs with version history.
6. **Equipment** — auto-detected profiles, usage hours, user confirmation/merge.
7. **Review queue** — unresolved targets, unknown frame types, unknown filters, duplicates. Badge count in sidebar.
8. **Settings** — watch folders, matching tolerances, session gap, theme, (Phase 2: account/sync/location).

Phase 2 adds **Tonight** (recommendations + altitude charts) between Dashboard and Targets.

## Conventions

- **Dark theme default** (astronomers) with optional **red night-vision mode**; light theme available. All colors via CSS custom properties.
- Integration time always displayed `HHh MMm`; per-filter bars use consistent filter colors (L=white, R/G/B, Ha=deep red, OIII=teal, SII=orange-red).
- Long operations (scans) surface as a global progress indicator with per-stage counts; UI never blocks.
- Virtualized lists everywhere file counts are unbounded (100k-file target).
- Every destructive or file-touching action requires explicit confirmation (non-destructive principle); "remove from catalog" never deletes from disk and says so.
- Empty states teach: each page's empty state explains what will appear and how to get it (Beginner Ben).
- Keyboard: `/` focuses search; arrows navigate grids; `Cmd/Ctrl+K` command palette (v1.x).

## Onboarding flow (first run)

Welcome → pick watch folder(s) → initial scan with live progress and discovered-targets preview → land on Dashboard with review-queue prompt if unresolved items exist.

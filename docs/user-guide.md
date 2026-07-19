# AstroTracker User Guide

This is a living document with two parts: **what you can actually do today** (pre-development —
only Phase 0 infrastructure is built), and **the target v1 experience** described in
[`planning/PRD-AstroTracker-v1.md`](../planning/PRD-AstroTracker-v1.md) and
[`design/DD-008-ux-structure.md`](../design/DD-008-ux-structure.md).

As Phase 1 (`P1-*`) issues land, move the feature they implement from "Target v1 Experience" up
into "What Works Today," with the actual steps rather than the design intent. Don't let this file
silently drift into describing features that don't exist yet as if they do.

---

## What Works Today

AstroTracker is pre-development: the monorepo, CI, database schema/repositories, and the Electron
shell exist, but none of the cataloging features below are implemented yet. Running the app today
shows a single diagnostic screen, not a real catalog.

### Running it

```
pnpm install        # first time only
pnpm dev             # launches the Electron app with hot reload
```

### What you'll see

A single window with two things on it:

1. **Version info** — a table of the app, Electron, Chrome, Node, platform, SQLite, and `sharp`
   versions, fetched from the Electron main process over the typed IPC bridge. This exists as
   proof the renderer ↔ preload ↔ main process round trip and the native-module rebuild pipeline
   both actually work — not a real feature.
2. **Worker demo** — a "Start demo job" button that enqueues a fake background job on the worker
   pool and shows a live progress bar (via `jobs.progress` IPC events) until it finishes, plus a
   "Cancel" button to cancel it mid-run. This proves the background job/worker-pool
   infrastructure that real scanning and thumbnailing will later run on — it doesn't scan or
   process any real files.

There is currently no way to point AstroTracker at a folder of FITS/XISF/RAW files, no target or
session catalog, and no calibration matching — that's all Phase 1 work tracked in
[`planning/task-breakdown.md`](../planning/task-breakdown.md) and the repo's
[Issues](../../../issues).

### Packaged builds

`pnpm package` produces an unsigned installer (`.dmg` on macOS, `.nsis` on Windows) in
`packages/desktop/release/`. Unsigned means Gatekeeper will call it "damaged" or from an
"unidentified developer" on first launch — right-click → Open, or run
`xattr -dr com.apple.quarantine /Applications/AstroTracker.app`. Code signing lands in P1-35. A
packaged build shows the same version/worker-demo screen as `pnpm dev` — packaging status, not
feature status.

---

## Target v1 Experience

This section describes the intended v1 product per the PRD and DD-008. None of it exists yet —
treat it as what you're building toward, not a manual for something installed on your machine.

### First run

Welcome screen → pick one or more watch folders (including external drives) → initial scan runs
with a live progress indicator and a preview of targets discovered as it goes → you land on the
Dashboard, with a prompt to visit the Review Queue if anything couldn't be resolved automatically.

### Navigation (left sidebar)

**Dashboard** — library totals, integration time captured this month, recent sessions, targets by
status (planning / capturing / ready to process / processed / complete), and calibration health
warnings (e.g. lights missing a matching dark).

**Targets** — every target you've imaged, as a card grid or table (toggle), searchable/filterable
by name, filter, equipment, date, integration range, or status. Fuzzy name matching means "M31",
"M 31", and "Andromeda Galaxy" all resolve to the same target automatically. Opening a target
shows a hero image, integration time per filter (`HHh MMm`, with consistent filter colors —
L=white, R/G/B, Ha=deep red, OIII=teal, SII=orange-red), a timeline of every session that
contributed to it, the equipment used, calibration status, linked final images, and notes.

**Sessions** — a calendar heat-map plus a chronological list of every imaging night. A session is
detected automatically as files captured within one dusk-to-dawn window (the window is
configurable in Settings). Opening a session shows every frame captured, grouped by target and
filter, the equipment configuration, environmental conditions if the FITS headers recorded them,
quality stats (FWHM/star count where available), and a place to add free-text notes.

**Calibration** — candidate master darks/flats/bias/dark-flats, grouped by camera and type. V1
shows ranked matching suggestions and gap reports using visible criteria such as camera, exposure,
filter, binning, temperature when present, and recency. Full provenance editing, superseded-master
management, exposure-scaled darks, and advanced camera-type rules are v1.x.

**Review Queue** — anything the automatic resolution could not confidently place: unresolved
targets, unrecognized frame types, and unknown filters. Duplicate review appears after background
hashing has run. The sidebar shows a badge count so nothing sits here unnoticed.

**Settings** — watch folders, timezone/site, calibration-matching tolerances, the session gap
window, and theme (dark by default, with a red night-vision mode and a light theme available).

### Non-negotiable behaviors (not optional polish)

- **Nothing on disk is ever touched without you asking.** "Remove from catalog" only removes the
  catalog entry — it never deletes, moves, or renames the original file, and says so wherever it
  appears. Any action that does touch a file requires an explicit confirmation.
- Scans and other long operations run in the background with a global progress indicator; the UI
  never freezes waiting on them.
- Every list is built to stay responsive at 100,000+ files.
- Empty states explain what will show up on that page and what to do to make that happen, so a new
  user is never looking at a blank screen with no idea what it's for.

### What v1 deliberately leaves out

Processing (stacking, calibrating, stretching) stays in PixInsight/Siril/etc. — AstroTracker v1
helps you find and hand off the exact source files you need. Full processing-project tracking is v1.x;
it does not replace your processing software. Target recommendations, tonight's-sky planning, weather integration, and cloud sync are
Phase 2+ (see the PRD's roadmap) — v1 is about getting your existing archive into a truthful,
searchable state, not suggesting what to shoot next.

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

AstroTracker is early Phase 1: the monorepo, CI, database schema/repositories, and the Electron
shell exist, and the file-discovery/parsing/hashing pipeline (P1-01–P1-08) now runs end-to-end —
but there is still no catalog UI (no Dashboard/Targets/Sessions/Review Queue) to browse what it
found. Running the app today lets you scan a real library and watch it get indexed, but you can't
yet look at the results without opening the SQLite database directly (see below).

### Running it

```
pnpm install        # first time only
pnpm dev             # launches the Electron app with hot reload
```

### What you'll see

A single window with three things on it:

1. **Version info** — a table of the app, Electron, Chrome, Node, platform, SQLite, and `sharp`
   versions, fetched from the Electron main process over the typed IPC bridge. This exists as
   proof the renderer ↔ preload ↔ main process round trip and the native-module rebuild pipeline
   both actually work — not a real feature.
2. **Worker demo** — a "Start demo job" button that enqueues a fake background job on the worker
   pool and shows a live progress bar (via `jobs.progress` IPC events) until it finishes, plus a
   "Cancel" button to cancel it mid-run. Proves the background job/worker-pool infrastructure
   real scanning runs on; doesn't touch any real files itself.
3. **Watch folders** — add a folder by absolute path and scan it. This is real: it walks your
   actual files, parses their headers, and hashes them. See "Running it over your own library"
   below.

### Running it over your own library

1. Launch the app (`pnpm dev`, or a packaged build — see below).
2. Under **Watch folders**, type the absolute path to a folder of captures (e.g.
   `/Users/you/Astrophotography/Lights`) into **Folder path** and click **Add folder**.
3. Click **Scan now** next to the folder you just added. A live label next to it tracks progress
   (`running: NN%` while the file count is known, `running: working` while still walking).
4. What happens, automatically, in order:
   - **Discovery (Stage 1):** recursively walks the folder, skipping hidden/dot-prefixed entries
     and `node_modules`, matching by extension — `fits`/`fit`/`fts`, `xisf`, `cr2`/`cr3`/`nef`/
     `arw`/`dng`. Every match becomes a `files` row (path, size, modified time).
   - **Parse + classify (Stages 2–3):** each new or changed file gets a header-only read (FITS
     2880-byte blocks / XISF XML header / RAW EXIF — never the pixel data) and is classified as
     light/dark/flat/bias/darkflat/unknown, inline with the same scan.
   - **Background hashing + duplicates (Stage 5a):** once the scan settles, a low-priority
     background pass SHA-256-hashes files (yielding to any new scan you start), and marks exact
     content duplicates — the earliest-discovered copy is kept as canonical, later copies are
     flagged `duplicate` and linked to it.
   - **Rescans are incremental and safe:** unchanged files (same size + mtime) aren't re-parsed.
     If a drive is disconnected, its files are marked `missing`, never deleted; reconnecting and
     rescanning restores them. A file moved to a new path is detected by content hash and
     re-linked in place (its history isn't lost).
   - Nothing is ever written to, moved, or deleted on your original files — everything above is a
     read-only pass into the app's own SQLite catalog.
5. **There is no results UI yet.** To see what got cataloged, open the app's SQLite database
   directly with any SQLite browser/CLI:
   - macOS: `~/Library/Application Support/AstroTracker/astrotracker.db`
   - Windows: `%APPDATA%/AstroTracker/astrotracker.db`

   Relevant tables: `watch_folders`, `files` (`status`: `present`/`missing`/`duplicate`;
   `sha256`/`duplicate_of_id` once hashed), `frames` (parsed metadata, one row per image file),
   `scan_jobs` (progress/counters for each scan or hash pass).

There is still no target or session catalog and no calibration matching in the UI — that's
ongoing Phase 1 work tracked in [`planning/task-breakdown.md`](../planning/task-breakdown.md) and
the repo's [Issues](../../../issues).

### Packaged builds

`pnpm package` produces an unsigned installer (`.dmg` on macOS, `.nsis` on Windows) in
`packages/desktop/release/`. Unsigned means Gatekeeper will call it "damaged" or from an
"unidentified developer" on first launch — right-click → Open, or run
`xattr -dr com.apple.quarantine /Applications/AstroTracker.app`. Code signing lands in P1-35. A
packaged build shows the same screen described above (version info, worker demo, watch folders) as
`pnpm dev` — packaging status, not feature status.

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

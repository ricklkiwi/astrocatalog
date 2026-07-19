# AstroTracker — Phased Task Breakdown (GitHub-issue-ready)

**Repo:** https://github.com/ricklkiwi/astrocatalog
Each task below becomes one GitHub issue. Issue title = `[ID] Title`. Body = Context + Requirements + Acceptance criteria. Labels and dependencies are listed per task. Design decisions (DD-001…DD-008 in `../design/`) are authoritative; read the referenced DDs before starting a task.

Format key — **Labels:** `phase:*`, `pkg:*`, `type:*` · **Depends on:** tasks that must be merged first (no entry = ready when its phase starts).

---

## Phase 0 — Foundations

### P0-01: Initialize monorepo with TypeScript, lint, and package structure

**Labels:** phase:0, pkg:core, type:infra
**Refs:** DD-001, DD-002
Create pnpm-workspace monorepo with packages `core`, `db`, `desktop` (with `renderer`), plus `fixtures/` dir. TypeScript strict mode, shared tsconfig base, ESLint + Prettier, `.editorconfig`, root README describing layout per DD-002.
**Acceptance criteria:**

- `pnpm install && pnpm -r build && pnpm -r lint && pnpm -r test` all succeed (placeholder test per package)
- `packages/core` has zero runtime dependencies on Electron or Node fs
- README documents package boundaries and layering rules from DD-002

### P0-02: GitHub Actions CI pipeline

**Labels:** phase:0, type:infra
**Refs:** DD-001
**Depends on:** P0-01
Workflow running on push/PR: install, typecheck, lint, unit tests on ubuntu + windows + macos matrix. Cache pnpm. Separate packaging workflow stub (manual dispatch) for later.
**Acceptance criteria:**

- CI green on all three OSes for main branch
- PRs blocked on CI via branch protection documentation in CONTRIBUTING.md

### P0-03: Electron shell with typed IPC and packaged builds

**Labels:** phase:0, pkg:desktop, type:infra
**Refs:** DD-001, DD-002
**Depends on:** P0-01
Electron app: main process, preload with contextIsolation, React renderer via Vite, typed IPC layer (electron-trpc or equivalent hand-rolled typed contract) with one demo procedure (`app.version`). electron-builder config producing Win NSIS + mac DMG (unsigned for now), including native-module rebuild for better-sqlite3/sharp.
**Acceptance criteria:**

- `pnpm dev` launches app with hot reload; renderer calls `app.version` over typed IPC
- `pnpm package` produces a local installable artifact on the current OS and verifies native modules load in the packaged app
- Renderer has no nodeIntegration; preload exposes only the typed API

### P0-04: Database layer — Drizzle schema v1 and migration runner

**Labels:** phase:0, pkg:db, type:infra
**Refs:** DD-003
**Depends on:** P0-01
Implement the foundation schema from DD-003 (`watch_folders`, `files`, `frames`, `scan_jobs`, `settings`, `schema_migrations`), Drizzle migration setup, DB bootstrap (app-data path, WAL mode, busy_timeout), and repository layer skeleton with typed query helpers. Feature-owned tables are added by the vertical slice that first uses them.
**Acceptance criteria:**

- Migration from empty DB creates the foundation schema; round-trip test (create → insert file/frame fixtures → query) passes
- UUIDv7 generator utility with test
- Foundation indexes are created and verified by query-plan or repository tests; FTS5 is added with target/notes search slices
- Repositories expose no raw connection to callers

### P0-05: Worker pool and persistent job queue

**Labels:** phase:0, pkg:desktop, type:infra
**Refs:** DD-002, DD-004
**Depends on:** P0-03, P0-04
Worker-thread pool with a job queue persisted in `scan_jobs`-style tables: enqueue, claim, progress reporting to renderer via IPC events, resume-on-restart, cancellation.
**Acceptance criteria:**

- Demo job (sleep + progress) runs in worker, streams progress to renderer, survives app restart mid-job and resumes
- Unit tests for queue claim/resume/cancel semantics

### P0-06: Fixtures library of real-world file headers

**Labels:** phase:0, type:test
**Refs:** DD-004, DD-005
**Depends on:** P0-01
Assemble `fixtures/`: real FITS headers (as standalone header-only .fits files) from N.I.N.A., SGPro, APT, SharpCap, ASIStudio, Voyager; XISF samples; CR2/CR3/NEF/ARW EXIF samples; malformed cases (truncated header, missing END, non-standard keywords, CONTINUE cards). Include a generator script that synthesizes valid FITS headers for bulk benchmarks and a manifest JSON describing expected parse output for each fixture.
**Acceptance criteria:**

- ≥ 25 real-world fixtures across ≥ 5 capture programs, each with expected-output manifest entry
- Generator produces N synthetic header-only FITS files with controllable OBJECT/FILTER/EXPTIME/DATE-OBS distributions
- All fixtures license-clean (self-captured or CC0) with provenance noted

### P0-07: Benchmark harness with CI regression gates

**Labels:** phase:0, type:test
**Refs:** DD-001, DD-004; PRD §8.4
**Depends on:** P0-04, P0-06
Benchmark runner (Vitest bench or custom) measuring: header parse throughput, bulk DB insert rate, aggregate query latency on a synthetic 100k-frame DB, plus hooks for realistic I/O benchmark packs. CI job fails on >20% regression against stored baselines.
**Acceptance criteria:**

- `pnpm bench` outputs results table with p50/p95 metrics; baselines stored in repo
- CI job compares and fails on regression; docs explain updating baselines
- Realistic I/O benchmark pack format documented: cold/warm cache runs, HDD/external-drive assumptions, network/slow-drive notes, and degraded-mode expectations

### P0-08: Playwright E2E harness on packaged app

**Labels:** phase:0, pkg:desktop, type:test
**Depends on:** P0-03
Playwright launching the built Electron app, one smoke test (app opens, window title, demo IPC round-trip). Runs in CI on Win + mac.
**Acceptance criteria:**

- `pnpm e2e` passes locally and in CI on both OSes
- Test helper for seeding a temp app-data dir + temp library folder

---

## Phase 1 — MVP v1.0

### Indexing core (M2)

### P1-01: FITS header parser

**Labels:** phase:1, pkg:core, type:feat
**Refs:** DD-004; PRD §8.2
**Depends on:** P0-06
Header-only FITS parser in `packages/core/fits`: accepts a read callback/stream, reads 2880-byte blocks to END card, parses 80-char cards (strings, numbers, booleans, comments, CONTINUE convention), returns typed keyword map + raw card list. Extract all PRD §8.2 critical + important keywords into a normalized `FrameMetadata` type; unknown keywords preserved.
**Acceptance criteria:**

- All FITS fixtures parse to their manifest expectations
- Malformed fixtures produce structured errors, never throws/hangs
- Never reads beyond header region (verified by mock reader byte-count test)
- Parses ≥ 5,000 fixture headers/second in benchmark

### P1-02: XISF header parser

**Labels:** phase:1, pkg:core, type:feat
**Refs:** DD-004; PRD §8.1
**Depends on:** P0-06
XISF monolithic-file header parser: validate signature, read XML header block, extract FITSKeyword and XISF Property elements into the same `FrameMetadata` type as P1-01.
**Acceptance criteria:**

- XISF fixtures parse to manifest expectations; PixInsight-written and N.I.N.A.-written variants covered
- Malformed XML → structured error

### P1-03: RAW EXIF metadata adapter

**Labels:** phase:1, pkg:core, type:feat
**Refs:** DD-004; PRD §8.1
**Depends on:** P0-06
Adapter using `exifr` for CR2/CR3/NEF/ARW (+ TIFF): map EXIF (exposure, ISO→gain field, capture time, camera model) into `FrameMetadata`. OBJECT/FILTER unavailable in EXIF → left null for path heuristics.
**Acceptance criteria:**

- RAW fixtures parse; capture time correctly normalized to UTC using EXIF offset when present
- Unknown/corrupt RAW → structured error

### P1-04: Frame classification (type detection)

**Labels:** phase:1, pkg:core, type:feat
**Refs:** DD-004
**Depends on:** P1-01
Pure function classifying frames as light/dark/flat/bias/darkflat/unknown: IMAGETYP mapping table (incl. capture-software variants like 'Light Frame', 'LIGHT', 'masterDark'), then path-segment heuristics, recording `frame_type_source`.
**Acceptance criteria:**

- Table-driven tests: ≥ 40 IMAGETYP variants and ≥ 20 path patterns
- Ambiguous cases → `unknown`, never guessed silently

### P1-05: Capture-software profile table

**Labels:** phase:1, pkg:core, type:feat
**Refs:** DD-004
**Depends on:** P1-01
Data-driven profile registry detecting originating software (SWCREATE/CREATOR/PROGRAM headers or keyword fingerprints) and applying per-software keyword mappings/quirk fixes (e.g., APT temperature keyword, SharpCap gain conventions).
**Acceptance criteria:**

- Each fixture's software correctly detected; quirk mappings tested per software
- Adding a profile requires only a data entry + fixture, no code changes

### P1-06: Watch folders — settings and discovery scan (Stage 1)

**Labels:** phase:1, pkg:desktop, pkg:db, type:feat
**Refs:** DD-004; PRD §6.1
**Depends on:** P0-05
Watch-folder CRUD (settings UI + repository), recursive directory walk in worker honoring supported extensions, upserting `files` rows (path/size/mtime), marking absent files `missing` (never deleting), drive-label capture for external drives. Skip patterns (node_modules-style ignore list, hidden dirs) configurable.
**Acceptance criteria:**

- Adding a folder enqueues a scan; progress visible via IPC events
- Rescan of unchanged tree performs zero frame re-parses (incremental check test)
- Disconnecting a drive marks files missing; reconnecting restores them
- E2E: add temp folder with synthetic files → files rows appear

### P1-07: Parse + resolve pipeline stages (Stages 2–3)

**Labels:** phase:1, pkg:desktop, pkg:core, type:feat
**Refs:** DD-004
**Depends on:** P1-01, P1-02, P1-03, P1-04, P1-05, P1-06
Wire parsers into the worker pipeline: for each new/changed file, header-only parse → classification → `frames` row with `headers_json`. Batch inserts (transaction per N files). Parse errors recorded on file row; batch never aborts.
**Acceptance criteria:**

- Synthetic 10k-file library completes stages 1–3 within CI benchmark budget (target: <5 min on reference hardware per PRD §8.4)
- Malformed files logged and skipped; error count surfaced in scan summary
- Re-running scan is idempotent (row counts stable)

### P1-08: Background SHA-256 hashing and duplicate detection (Stage 5a)

**Labels:** phase:1, pkg:desktop, type:feat
**Refs:** DD-003, DD-004; PRD §6.1
**Depends on:** P1-06
Lowest-priority background jobs streaming SHA-256 per file; on hash collision mark `duplicate` with `duplicate_of_id` (oldest first-seen wins as canonical). Move detection: new path + matching (size, sha256) of a missing file re-paths the existing row preserving all links.
**Acceptance criteria:**

- Duplicates across two watch folders detected; canonical selection deterministic
- Moved file retains frame/session/project links (integration test)
- Hashing throttles under active scanning (priority test)

### P1-09: Live watch mode (chokidar)

**Labels:** phase:1, pkg:desktop, type:feat
**Refs:** DD-004
**Depends on:** P1-07
File-system watching on active folders with 30 s debounce feeding the pipeline; toggle per folder; graceful handling of watcher limits on large trees (fall back to periodic rescan with user notice).
**Acceptance criteria:**

- Dropping files into a watched folder auto-catalogs them without manual rescan (E2E)
- Debounce verified: burst of writes → single pipeline batch

### Target library (M3)

### P1-10: Bundled object catalog build script

**Labels:** phase:1, pkg:core, type:feat
**Refs:** DD-005
Introduce the target catalog storage/asset schema needed by DD-005, then build-time script compiling OpenNGC (+ Messier common names, popular Sharpless/Barnard/vdB) into a bundled lookup asset (JSON or SQLite): designations, cross-references, common names, RA/DEC, type, constellation. CC-BY-SA attribution included in app about screen data.
**Acceptance criteria:**

- Asset contains ≥ 13,000 objects; M31 ↔ NGC 224 ↔ 'Andromeda Galaxy' cross-referenced
- Script re-runnable and documented; asset size < 10 MB
- Lookup API: by normalized designation, by common name, by cone search (ra/dec/radius)

### P1-11: Target name resolver

**Labels:** phase:1, pkg:core, type:feat
**Refs:** DD-005
**Depends on:** P1-10
Add `targets` and `target_aliases` migrations if not already present, then implement DD-005 resolution: normalization, alias lookup, catalog lookup, coordinate-fallback suggestions, mosaic panel extraction. Pure functions + a resolver service that persists user aliases.
**Acceptance criteria:**

- Table-driven tests: ≥ 60 name variants incl. 'M 31'/'M31'/'m-31'/'NGC224'/'Andromeda Galaxy'/'Sh2-101'/'M 31 Panel 2'
- Unresolvable names yield 'needs review' with ranked fuzzy suggestions (suggest-only, never auto-merge)
- User alias assignment persists and wins on rescan

### P1-12: Filter normalization

**Labels:** phase:1, pkg:core, type:feat
**Refs:** DD-005
**Depends on:** P0-04
Add `filters` and filter-mapping persistence, then implement data-driven raw→canonical filter mapping per DD-005 table, unknown filters become their own visible canonical entries, user merge with remembered mappings.
**Acceptance criteria:**

- Table-driven tests ≥ 30 raw variants incl. dualband filters
- Merge operation reassigns frames and persists mapping (integration test)

### P1-13: Integration-time aggregation queries

**Labels:** phase:1, pkg:db, type:feat
**Refs:** DD-003; PRD §6.2
**Depends on:** P0-04
Repository queries: per-target totals, per-target-per-filter, per-session, per-equipment, per-month; formatted `HHh MMm`; only `light` frames counted; missing-file frames included (data still exists) with an excludable flag.
**Acceptance criteria:**

- Correctness tests against hand-computed fixture sums, incl. mixed filters and missing files
- 100k-frame synthetic DB: per-target rollup query < 100 ms (benchmark)

### P1-14: Targets page — grid, table, search & filters

**Labels:** phase:1, pkg:desktop, type:feat
**Refs:** DD-008; PRD §6.2
**Depends on:** P1-11, P1-12, P1-13
Targets page per DD-008: card grid + table toggle, virtualized; search (FTS) and filters (filter band, equipment, date range, integration range, status); status badges; sort by name/integration/last-imaged.
**Acceptance criteria:**

- E2E: seeded library → search 'andromeda' finds M 31; filters combine correctly
- Renders 1,000 targets without jank (virtualization test)

### P1-15: Target detail dashboard

**Labels:** phase:1, pkg:desktop, type:feat
**Refs:** DD-008; PRD §6.2
**Depends on:** P1-14
Per-target view: per-filter integration bars (DD-008 colors), session timeline, equipment used, date range, frame counts by type, status control (planning/capturing/ready/processed/complete), notes editor, linked final images placeholder.
**Acceptance criteria:**

- All PRD §6.2 dashboard elements present; renders < 1 s on a 200-session target (benchmark seed)
- Status and notes persist; FTS finds note text

### P1-16: Review queue — unresolved targets, types, filters

**Labels:** phase:1, pkg:desktop, type:feat
**Refs:** DD-005, DD-008
**Depends on:** P1-11, P1-12, P1-04
Review page listing unresolved OBJECT names (with fuzzy + coordinate suggestions), unknown frame types, and unknown filters; bulk assignment actions; sidebar badge count.
**Acceptance criteria:**

- Assigning an unresolved name creates alias; all matching frames re-resolve immediately and on future scans
- Bulk actions (select all by raw name) work; E2E covers assign-and-verify flow

### Sessions & calibration (M4)

### P1-17: Session detection algorithm

**Labels:** phase:1, pkg:core, type:feat
**Refs:** DD-006; PRD §6.3
**Depends on:** P1-07
Add `sessions` persistence and assignment-lock storage, then implement pure `detectSessions()` per DD-006: astronomical-day windowing, 4 h gap splitting, equipment-profile splitting, calibration-only sessions, idempotent re-runs, manual-assignment locks respected.
**Acceptance criteria:**

- Table-driven tests: midnight-spanning night, two-run night, multi-rig night, DSLR without CCD-TEMP, calibration-only night, timezone edge (site vs system tz)
- Re-run after new files preserves manual merges/splits

### P1-18: Equipment profile auto-detection

**Labels:** phase:1, pkg:core, pkg:db, type:feat
**Refs:** DD-003, DD-006; PRD §6.3
**Depends on:** P1-07
Add `equipment_profiles` persistence, then detect distinct TELESCOP+INSTRUME(+FOCALLEN) combos into `equipment_profiles`; fuzzy-consolidate near-identical strings as suggestions; user confirm/rename/merge UI on Equipment page with usage hours per profile.
**Acceptance criteria:**

- Same rig with minor header string drift ('EdgeHD 8' vs 'EdgeHD8') suggested as one profile, merged only on user confirm
- Usage hours = sum of light exposure per profile (test)

### P1-19: Sessions page and session detail

**Labels:** phase:1, pkg:desktop, type:feat
**Refs:** DD-008; PRD §6.3
**Depends on:** P1-17, P1-18
Calendar heat-map + list; detail view: targets, filter/exposure breakdown, equipment, conditions from headers (temp/humidity when present), quality stats (FWHM/HFR/star count when present), notes editor, manual merge/split controls.
**Acceptance criteria:**

- E2E: seeded multi-night library shows correct session grouping; merge/split persists across rescan
- All PRD §6.3 detail elements render; absent header data degrades gracefully

### P1-20: Calibration gap detection and ranked suggestions

**Labels:** phase:1, pkg:core, type:feat
**Refs:** DD-006; PRD §6.4
**Depends on:** P1-17
Implement v1 `matchCalibration()` per DD-006: conservative hard filters by master type, simple ranked suggestions, gap flags, flat staleness warnings, and per-target/session status (complete/partial/stale/missing). Defer provenance editing, superseded-master lifecycle, exposure-scaled darks, and advanced camera-type-specific needed-set rules to v1.x.
**Acceptance criteria:**

- Table-driven tests per DD-006 matrix: mono+FW, OSC+dualband, tolerance boundaries (±2 °C edges), stale flats, missing masters
- Deterministic ranking with visible reason fields; manual suggestion override respected on re-match

### P1-21: Master frame candidate library

**Labels:** phase:1, pkg:desktop, pkg:db, type:feat
**Refs:** DD-003; PRD §6.4
**Depends on:** P1-20
Add a minimal `master_frames` migration, then detect master-frame candidates (IMAGETYP master variants or user designation). Calibration page groups masters by camera/type and shows the properties used by matching. Do not include raw-sub provenance editing or superseded-master lifecycle in v1.0.
**Acceptance criteria:**

- Masters auto-detected from fixture headers; manual designation flow works
- Master detail shows matching-relevant properties and which suggestions use it
- No action deletes, modifies, or marks source image files as superseded

### P1-22: Calibration gap report and status indicators

**Labels:** phase:1, pkg:desktop, type:feat
**Refs:** DD-006, DD-008; PRD §6.4
**Depends on:** P1-20, P1-21
Gap report ("these lights lack matching darks/flats"), status chips on sessions and targets, tolerance settings UI (temp tolerance, staleness window, gap hours).
**Acceptance criteria:**

- E2E: library with missing flats shows correct gaps; tightening temp tolerance updates statuses live
- Status chips consistent between Sessions, Targets, and Calibration pages (shared selector test)

### P1-23: Session notes and annotations

**Labels:** phase:1, pkg:desktop, type:feat
**Refs:** PRD §6.3
**Depends on:** P1-19
Rich-text-lite (markdown) notes on sessions with weather/equipment-issue quick tags; searchable via FTS.
**Acceptance criteria:**

- Notes persist, render markdown, searchable from global search
- Quick tags filterable on Sessions page

### Retrieval, stats, polish (M5)

### P1-24: Lightweight final image linking

**Labels:** phase:1, pkg:desktop, type:feat
**Refs:** PRD §6.5
**Depends on:** P1-15
Add a minimal `processed_images` or target-linked final-image table, then attach a final TIFF/PNG/JPG path directly to a target as an optional reference image; mark one linked image as the target hero. This is deliberately not a processing-project tracker.
**Acceptance criteria:**

- Hero image shows on target card/detail when present
- Linked final images are excluded from light-frame statistics
- Removing the link never deletes or modifies the image file

### P1-25: File collection and processing handoff

**Labels:** phase:1, pkg:desktop, type:feat
**Refs:** PRD §6.5
**Depends on:** P1-14, P1-19
Selection flows for collecting source files by target, session, filter, frame type, equipment, and date range; copy absolute paths for PixInsight/Siril handoff and reveal selected files in Finder/Explorer.
**Acceptance criteria:**

- E2E: select M31 Ha light frames across sessions and copy newline-separated absolute paths
- Reveal-in-Finder/Explorer works for selected files without modifying them
- Missing files are clearly marked and omitted from copied path lists unless explicitly included

### P1-26: FITS/XISF thumbnail generation (Stage 5b)

**Labels:** phase:1, pkg:desktop, pkg:core, type:feat
**Refs:** DD-004; PRD §6.7
**Depends on:** P1-07
Worker-based thumbnail pipeline: read pixel data, debayer OSC when BAYERPAT present, midtones-transfer autostretch, downscale via sharp, cache as WebP keyed by frame id; LRU disk cache with size cap; lowest job priority.
**Acceptance criteria:**

- Correct-looking thumbnails for mono, OSC, and 32-bit float fixtures (golden-image tests with tolerance)
- ≥ 50 thumbnails/sec on reference hardware for 16-bit 6200x4x binned data per PRD §8.4 (benchmark; document hardware assumptions)
- Cache eviction respects cap; regeneration transparent

### P1-27: File browser page

**Labels:** phase:1, pkg:desktop, type:feat
**Refs:** DD-008; PRD §6.7
**Depends on:** P1-26
Browse library by target / date / equipment / physical folder with virtualized thumbnail grid; frame inspector (all parsed headers + raw `headers_json`); reveal-in-Explorer/Finder; copy-paths-to-clipboard for processing handoff.
**Acceptance criteria:**

- 100k-file library browses smoothly (virtualization benchmark)
- 'Copy file list' produces newline-separated absolute paths usable in PixInsight/Siril (E2E clipboard test)

### P1-28: Statistics dashboard

**Labels:** phase:1, pkg:desktop, type:feat
**Refs:** DD-008; PRD §6.6
**Depends on:** P1-13, P1-17
Dashboard page: totals (targets, integration, files, library size), integration per month chart, sessions per month, most-imaged targets, per-filter distribution, equipment usage hours, calibration health summary.
**Acceptance criteria:**

- All widgets correct against seeded fixture library (numeric assertions)
- Dashboard renders < 1 s on 100k-frame DB (benchmark)

### P1-29: CSV/JSON export

**Labels:** phase:1, pkg:desktop, type:feat
**Refs:** PRD §6.6
**Depends on:** P1-28
Export targets, sessions, frames, and statistics rollups as CSV and JSON to user-chosen location; column documentation in user docs.
**Acceptance criteria:**

- Exports re-import cleanly into a spreadsheet (schema test: headers, escaping, UTF-8 BOM for Excel)
- JSON validates against a published schema file in repo

### P1-30: Duplicate review workflow

**Labels:** phase:1, pkg:desktop, type:feat
**Refs:** DD-004, DD-008; PRD §6.1
**Depends on:** P1-08
Review queue section for duplicate files after background hashing has identified them: canonical file display, duplicate groups, missing/moved-file context, and safe catalog-only resolution actions.
**Acceptance criteria:**

- Duplicate groups show deterministic canonical selection and all duplicate paths
- User can mark a duplicate as ignored/accepted without deleting or modifying source files
- E2E: seeded duplicate files appear in duplicate review only after hashing completes

### P1-31: Onboarding flow and empty states

**Labels:** phase:1, pkg:desktop, type:feat
**Refs:** DD-008
**Depends on:** P1-06, P1-14
First-run wizard per DD-008 (welcome → watch folder → live scan preview → dashboard); instructive empty states on every page; sample-library mode for trying the app without data.
**Acceptance criteria:**

- E2E: fresh app-data → wizard → scan → dashboard populated
- Every nav page has a designed empty state (visual snapshot tests)

### P1-32: Settings, theming, and free-tier limit

**Labels:** phase:1, pkg:desktop, type:feat
**Refs:** DD-008; PRD §11
**Depends on:** P1-22
Settings page consolidating: watch folders, tolerances, session gap, timezone/site, theme (dark default / light / red night-vision), language of file-count limit. Implement 10,000-file free-tier soft limit (counting indexed image files) with clear upgrade messaging — enforcement flag off in beta builds.
**Acceptance criteria:**

- All three themes applied app-wide via CSS custom properties (snapshot tests)
- Limit triggers at threshold, blocks new indexing only (never hides existing data), flag-controllable

### Release (M6)

### P1-33: Performance validation and optimization pass

**Labels:** phase:1, type:test
**Refs:** PRD §8.4
**Depends on:** P1-27, P1-28
Run full benchmark suite against PRD targets on reference Win + mac hardware, including the realistic I/O benchmark pack; profile and fix the top bottlenecks; document results and degraded-mode behavior.
**Acceptance criteria:**

- 10k-file scan < 5 min; 100k library load < 3 s; target dashboard < 1 s; thumbnails ≥ 50/s — all evidenced in a committed benchmark report with p50/p95, cold/warm cache runs, and storage assumptions
- CI baselines updated
- Slow external drive/network share behavior documented, including watcher fallback, throttling, and user-facing degraded-mode messaging

### P1-34: CI package artifact workflow

**Labels:** phase:1, pkg:desktop, type:infra
**Depends on:** P0-03
Wire the manual packaging workflow to build the packaged app on `windows-latest` and `macos-latest`, then upload the produced `.exe` and `.dmg` artifacts. This is separate from P0-03, which proves local packaging and native-module loading only.
**Acceptance criteria:**

- Manual-dispatch workflow runs `pnpm install && pnpm package` on Windows and macOS
- Workflow uploads Windows `.exe` and macOS `.dmg` artifacts from `packages/desktop/release/`
- Packaging workflow failures are visible but do not block ordinary feature PR CI unless explicitly enabled

### P1-35: Code signing, notarization, auto-update

**Labels:** phase:1, pkg:desktop, type:infra
**Depends on:** P1-34
Windows code signing, macOS notarization, electron-updater against GitHub Releases with staged rollout channel (beta/stable).
**Acceptance criteria:**

- Signed installers install without OS warnings on both platforms
- Beta-channel build auto-updates to a newer beta release (verified manually, process documented)

### P1-36: v1.0 release — docs, website copy, beta feedback triage

**Labels:** phase:1, type:docs
**Depends on:** P1-31, P1-32, P1-33, P1-35
User documentation (getting started, folder scanning, file retrieval/handoff, calibration matching concepts, FAQ), in-app help links, release notes, README polish, triage of closed-beta feedback into labeled backlog issues.
**Acceptance criteria:**

- Docs published (repo /docs or site); every MVP feature covered
- v1.0.0 tagged; release checklist committed for repeatability

---

## Phase 1.x — Processing Workflow Tracking

These tasks are deliberately outside v1.0. They build on the useful archive/retrieval product after scanning, organization, calibration gaps, and processing handoff are working well on real libraries.

### P1x-01: Processing projects

**Labels:** phase:1.x, pkg:desktop, pkg:db, type:feat
**Refs:** DD-003, DD-008; PRD §6.5
**Depends on:** P1-24, P1-25, P1-21
Add `processing_projects`, `project_frame_inputs`, and `project_master_frame_inputs` migrations. Create project for a target; select input lights and calibration masters; status kanban (in-progress/complete/abandoned); processing notes (software, steps, parameters); version labels ("M31 v2 - added Ha").
**Acceptance criteria:**

- E2E: create project from target detail, select inputs, move through statuses
- Version history listed on target detail; inputs remain linked if files move (via P1-08 move detection)

### P1x-02: Processing trace-back view

**Labels:** phase:1.x, pkg:desktop, type:feat
**Refs:** PRD §6.5
**Depends on:** P1x-01
Extend linked final images so each can attach to a processing project and navigate final image -> project -> sessions -> frames -> calibration masters.
**Acceptance criteria:**

- Trace-back view navigates the full chain from a final image to source data
- Existing v1 target-level final-image links migrate cleanly into project-linked images when assigned

### P1x-03: Advanced calibration management

**Labels:** phase:1.x, pkg:core, pkg:desktop, pkg:db, type:feat
**Refs:** DD-003, DD-006, DD-008; PRD §6.4
**Depends on:** P1-20, P1-21, P1-22
Add the calibration-management behavior intentionally deferred from v1.0: raw-sub provenance editing (`master_frame_subs`), superseded-master lifecycle, exposure-scaled dark suggestions, and advanced camera-type-specific needed-set rules.
**Acceptance criteria:**

- Provenance view lists and edits the raw calibration subs used to build each master
- Superseded masters are excluded from default suggestions but remain visible and reversible
- Exposure-scaled darks are clearly labeled as scaled and ranked below exact matches
- Camera-type rules are data-driven, user-overridable, and covered for DSLR, OSC, mono+filterwheel, and set-point cooled cameras

---

## Phase 2 — v2.0: Online Integration & Recommendations

### P2-01: Cloud service scaffold (Fastify + PostgreSQL)

**Labels:** phase:2, pkg:cloud, type:infra
**Refs:** DD-007
`packages/cloud`: Fastify app, PostgreSQL via Drizzle, OpenAPI generation, health checks, staging deploy (Fly.io/Render), CI deploy workflow, structured logging.
**Acceptance criteria:**

- `/v1/health` live on staging; OpenAPI doc served; CI deploys on tag
- Local dev via docker-compose (postgres) documented

### P2-02: Authentication and account management

**Labels:** phase:2, pkg:cloud, type:feat
**Refs:** DD-007
**Depends on:** P2-01
Email magic-link + Google OAuth; JWT access/refresh; device tokens for desktop; account deletion (GDPR-style full purge); rate limiting.
**Acceptance criteria:**

- Auth flows integration-tested; refresh rotation works; deletion purges all user rows
- Desktop can hold a device token through restart (secure storage via OS keychain)

### P2-03: Desktop sign-in and account UI

**Labels:** phase:2, pkg:desktop, type:feat
**Refs:** DD-007, DD-008
**Depends on:** P2-02
Settings → Account: sign in (browser handoff), status, sign out; offline behavior clearly indicated; no core feature gated on auth.
**Acceptance criteria:**

- E2E against staging: sign in, restart, still authenticated, sign out
- Airplane-mode app remains fully functional (regression suite)

### P2-04: Metadata sync engine

**Labels:** phase:2, pkg:cloud, pkg:desktop, type:feat
**Refs:** DD-007, DD-003
**Depends on:** P2-03
Sync targets/frames-metadata/sessions/stats per DD-007: UUID-keyed upserts, per-field LWW with conflict prompts on user-edited fields, incremental push/pull with cursor, backoff/retry, sync status UI.
**Acceptance criteria:**

- Two desktops on one account converge (integration test harness with two app instances)
- Conflict on notes prompts rather than overwrites; image files never uploaded (network assertion test)
- 100k-frame initial sync completes and resumes after interruption

### P2-05: Ephemeris and visibility engine

**Labels:** phase:2, pkg:core, type:feat
**Refs:** DD-007
Astronomy calculations in `packages/core/sky` (astronomy-engine): object altitude/azimuth curves for a night, transit time, astronomical darkness window, moon phase/position/separation, per-site (lat/lon/elevation).
**Acceptance criteria:**

- Validated against known ephemerides (±0.2° altitude, ±2 min transit for test cases)
- Pure functions usable both desktop-offline and server-side

### P2-06: Site/location settings with Bortle class

**Labels:** phase:2, pkg:desktop, type:feat
**Refs:** DD-007; PRD §7 Phase 2
**Depends on:** P2-05
Site management: named sites with lat/lon (map picker or manual), timezone, Bortle class (manual entry with light-pollution-map link); default site; per-session site attribution when SITENAME headers exist.
**Acceptance criteria:**

- Multiple sites supported; coordinates validated; Bortle stored
- Sessions with SITENAME map to sites via user-confirmable suggestions

### P2-07: Tonight's Sky panel

**Labels:** phase:2, pkg:desktop, type:feat
**Refs:** DD-007, DD-008; PRD §7 Phase 2
**Depends on:** P2-05, P2-06
'Tonight' page: darkness window, moon phase/rise/set, altitude charts for user's active targets + suggested catalog objects, transit times, filterable by min altitude and moon separation.
**Acceptance criteria:**

- Works fully offline (local ephemeris); charts render for 50 targets < 1 s
- E2E: changing site updates all charts

### P2-08: Weather integration

**Labels:** phase:2, pkg:cloud, pkg:desktop, type:feat
**Refs:** DD-007; PRD §7 Phase 2
**Depends on:** P2-06
Server-side weather proxy (Open-Meteo primary; Astrospheric if API access granted) with caching; desktop shows cloud cover/seeing/transparency forecast on Tonight panel; graceful offline degradation.
**Acceptance criteria:**

- Forecast cached server-side (≤ 1 req/site/hour upstream); desktop caches last forecast for offline
- API keys never shipped in desktop binary

### P2-09: Recommendation engine v1

**Labels:** phase:2, pkg:cloud, pkg:core, type:feat
**Refs:** DD-007; PRD §7 Phase 2
**Depends on:** P2-04, P2-05, P2-08
Transparent weighted scoring per DD-007 combining: visibility tonight, moon interference, existing integration + filter balance, target status, season window remaining, weather. Output ranked list with human-readable reason strings.
**Acceptance criteria:**

- Golden-case tests: 'needs more OIII' case, 'new target at peak' case, 'already competitive' case from PRD examples
- Scoring weights configurable server-side; every recommendation carries its reasons
- Degraded offline mode on desktop uses cached data with banner

### P2-10: Recommendations UI

**Labels:** phase:2, pkg:desktop, type:feat
**Refs:** DD-008
**Depends on:** P2-07, P2-09
Recommendation cards on Tonight page: reason strings, altitude sparkline, filter-balance visual, actions (snooze target, dismiss, mark planned tonight).
**Acceptance criteria:**

- E2E against staging with seeded account; snooze/dismiss persist and affect future rankings
- Empty/no-account state gracefully advertises the feature without nagging

### P2-11: Filter balance and exposure goal tracking

**Labels:** phase:2, pkg:desktop, pkg:core, type:feat
**Refs:** PRD §7 Phase 2
**Depends on:** P1-15
Per-target exposure goals (per filter, hours) with progress bars; goal templates (e.g., SHO balanced, LRGB 2:1:1:1); feeds recommendation scoring.
**Acceptance criteria:**

- Goals editable on target detail; progress accurate; 'remaining hours' correct
- Goal completion flips target status suggestion to 'ready'

### P2-12: Bortle-aware exposure guidance

**Labels:** phase:2, pkg:core, type:feat
**Refs:** PRD §7 Phase 2
**Depends on:** P2-06, P2-11
Heuristic guidance table: suggested total integration per target type per Bortle class (community-sourced defaults, editable), surfaced on target detail and in goal templates.
**Acceptance criteria:**

- Guidance data-driven with documented sources; unit tests on lookup logic
- Clearly labeled as guidance, user-overridable

### P2-13: Licensing, entitlements, and payments

**Labels:** phase:2, pkg:cloud, pkg:desktop, type:feat
**Refs:** DD-007; PRD §11
**Depends on:** P2-02
Stripe subscriptions (Pro $59/yr, $7/mo; Team $149/yr per PRD), entitlement API, desktop entitlement cache with 14-day offline grace, free-tier limit enforcement wiring (P1-32 flag), upgrade flows.
**Acceptance criteria:**

- Stripe test-mode E2E: subscribe → entitlement active on desktop; cancel → downgrade after period
- Offline grace verified; free tier never loses access to already-indexed data

### P2-14: v2.0 release hardening

**Labels:** phase:2, type:test
**Depends on:** P2-04, P2-10, P2-13
Load test sync + recommendations endpoints; security review pass (authz on every endpoint, IDOR checks); privacy review of synced fields; v2.0 docs and release.
**Acceptance criteria:**

- Load: 1,000 concurrent syncing users on staging within latency SLOs (documented)
- Security checklist committed; pen-test-style authz tests in CI; v2.0.0 tagged

---

## Phase 3 — v3.0: Community & Collaboration

### P3-01: Anonymized statistics opt-in pipeline

**Labels:** phase:3, pkg:cloud, pkg:desktop, type:feat
**Refs:** DD-007; PRD §7 Phase 3
Opt-in flow with explicit field list; server aggregates per-target integration distributions; coordinates rounded 0.1°; opt-out purges contributions.
**Acceptance criteria:**

- No PII in aggregate tables (schema review test); opt-out purge verified
- Aggregates require ≥ 10 contributors per target before exposure (k-anonymity test)

### P3-02: Community benchmarks on target detail

**Labels:** phase:3, pkg:desktop, type:feat
**Depends on:** P3-01
'Community: median 22 h on M31 (n=340)' style benchmark on target detail and in recommendations ('your 6 h vs typical 20 h+').
**Acceptance criteria:**

- Benchmarks display with sample size; hidden below k-anonymity threshold; offline-cached

### P3-03: Curated shared target lists

**Labels:** phase:3, pkg:cloud, pkg:desktop, type:feat
**Refs:** PRD §7 Phase 3
Server-hosted curated lists (seasonal, beginner, narrowband showcases) with recommended exposure plans; browse/subscribe in desktop; subscribing creates targets with goals.
**Acceptance criteria:**

- Admin tooling for list curation; subscribed list syncs updates; unsubscribe keeps captured data

### P3-04: Team/club shared projects — data model and API

**Labels:** phase:3, pkg:cloud, type:feat
**Refs:** DD-007; PRD §7 Phase 3
**Depends on:** P2-13
Team entities: org, members, roles (admin/member), shared projects targeting a common object; per-member contribution attribution; Team-tier entitlement gate.
**Acceptance criteria:**

- Multi-member integration test: two accounts contribute sessions to one shared project; totals attribute correctly
- Authz matrix tested (non-members see nothing)

### P3-05: Club projects desktop UI

**Labels:** phase:3, pkg:desktop, type:feat
**Depends on:** P3-04
Projects page gains 'Team' scope: shared target progress (combined per-filter integration across members), member contribution breakdown, join-by-invite flow.
**Acceptance criteria:**

- E2E with two staged accounts; Club Carlos flow: invite → member syncs sessions → combined dashboard updates

### P3-06: AstroBin integration

**Labels:** phase:3, pkg:desktop, type:feat
**Refs:** PRD §7 Phase 3
**Depends on:** P1x-02
Link processed images to AstroBin entries (OAuth or API key per AstroBin API): push acquisition details (integration per filter, equipment, dates) to pre-fill AstroBin technical card; store backlink.
**Acceptance criteria:**

- Technical card data matches catalog statistics exactly (unit test on payload builder)
- Graceful handling when AstroBin API unavailable; feature flagged

### P3-07: Public profile / share pages

**Labels:** phase:3, pkg:cloud, type:feat
**Refs:** PRD §7 Phase 3
**Depends on:** P3-01
Opt-in public page per user: showcase targets, total integration, gallery of linked finals (thumbnails user explicitly chose to share).
**Acceptance criteria:**

- Private by default; share toggle per target; revocation immediate; no EXIF/location leakage (test)

### P3-08: v3.0 release hardening

**Labels:** phase:3, type:test
**Depends on:** P3-02, P3-05, P3-06
Privacy audit of all sharing surfaces, team authz fuzzing, docs, v3.0.0 release.
**Acceptance criteria:**

- Privacy checklist signed off; authz property tests in CI; v3.0.0 tagged

---

## Phase 4 — v4.0: Advanced Automation

### P4-01: N.I.N.A. integration

**Labels:** phase:4, pkg:desktop, type:feat
**Refs:** PRD §7 Phase 4
Ingest N.I.N.A. session metadata (Advanced Sequencer JSON logs / image-saved webhooks via N.I.N.A. plugins) for real-time session logging; document companion-plugin approach if needed.
**Acceptance criteria:**

- Live session appears in AstroTracker during capture (tested against N.I.N.A. simulator)
- Frames arriving via watch mode auto-associate to the live session

### P4-02: SGPro and Voyager ingestion adapters

**Labels:** phase:4, pkg:desktop, type:feat
**Refs:** PRD §7 Phase 4
**Depends on:** P4-01
Adapter framework generalized from P4-01; SGPro sequence logs and Voyager RoboTarget DB/log ingestion mapping to sessions/targets.
**Acceptance criteria:**

- Fixture logs from both tools ingest correctly; adapter interface documented for community adapters

### P4-03: Remote observatory auto-import pipelines

**Labels:** phase:4, pkg:desktop, type:feat
**Refs:** PRD §7 Phase 4
**Depends on:** P1-09
Pipeline profiles for remote-download folders: post-download trigger, optional checksum manifest verification, optional organize-by-template **copy** (never move originals without explicit opt-in), auto-catalog, nightly summary notification.
**Acceptance criteria:**

- Remote Rita flow: dropping a night's download auto-catalogs and produces a session summary (E2E)
- Any file-organizing action is opt-in, logged, and reversible (dry-run mode)

### P4-04: Sub-frame quality scoring engine

**Labels:** phase:4, pkg:core, type:feat
**Refs:** PRD §7 Phase 4
Pixel-level analysis in workers: star detection, FWHM, eccentricity, background level/gradient, SNR estimate per sub; persisted per frame; batch scoring jobs.
**Acceptance criteria:**

- Metrics within tolerance of PixInsight SubframeSelector on a validation set (documented comparison)
- 6200-class 16-bit frame scores in < 2 s per frame on reference hardware; cancellable batches

### P4-05: Quality-based accept/reject recommendations

**Labels:** phase:4, pkg:desktop, type:feat
**Depends on:** P4-04
Per-target quality distribution views; threshold-based reject suggestions (never deletes); export accepted-list for stacking tools; quality badge on frames.
**Acceptance criteria:**

- Suggested rejects match configured sigma thresholds (unit tests); export consumable by PixInsight (path list)
- Rejected frames remain cataloged and reversible

### P4-06: Mosaic project support

**Labels:** phase:4, pkg:desktop, pkg:core, type:feat
**Refs:** PRD §7 Phase 4
**Depends on:** P1-11
Mosaic projects: define panel grid for a target (RA/DEC per panel), auto-assign frames via panel attribute (DD-005) or coordinate matching, per-panel integration progress, completion heat-map.
**Acceptance criteria:**

- Panels auto-populate from 'Panel N' OBJECT conventions and RA/DEC proximity; per-panel per-filter progress correct
- Recommendation engine (if Phase 2 active) treats incomplete panels as suggestions

### P4-07: Plate-solving integration for coordinate verification

**Labels:** phase:4, pkg:desktop, type:feat
**Depends on:** P4-06
Optional local plate solve (ASTAP CLI integration, user-installed) to verify/populate RA/DEC for frames missing coordinates; improves target coordinate-fallback and mosaic assignment.
**Acceptance criteria:**

- ASTAP detected when installed; solves populate frame RA/DEC with 'solved' provenance; absence degrades gracefully

### P4-08: Equipment maintenance logging

**Labels:** phase:4, pkg:desktop, type:feat
**Refs:** PRD §7 Phase 4
**Depends on:** P1-18
Maintenance log per equipment profile: collimation, sensor cleaning, PE correction, firmware; reminders by elapsed time/usage hours; maintenance events annotated on session timeline.
**Acceptance criteria:**

- CRUD + reminders fire correctly on usage-hour thresholds; events visible on relevant session views

### P4-09: v4.0 release hardening

**Labels:** phase:4, type:test
**Depends on:** P4-03, P4-05, P4-06
Long-run soak test (simulated month of nightly auto-imports), quality-engine performance regression suite, docs, v4.0.0 release.
**Acceptance criteria:**

- Soak: no leaks/db bloat over simulated 30 nights × 500 frames; v4.0.0 tagged

---

## Phase 5 — v5.0: Intelligence & Analytics

### P5-01: Imaging-pattern feature store

**Labels:** phase:5, pkg:cloud, type:feat
**Refs:** PRD §7 Phase 5
Per-user (consented) feature aggregation: clear-night frequency by month, typical session length, filter usage patterns, target-type preferences — foundation for ML features; all local-first with opt-in cloud training.
**Acceptance criteria:**

- Features computed locally and inspectable by user; cloud upload strictly opt-in; documented schema

### P5-02: Predictive completion estimates

**Labels:** phase:5, pkg:core, type:feat
**Refs:** PRD §7 Phase 5
**Depends on:** P5-01
'At your pace (2.1 h/clear night, ~6 clear nights/month), M33 completes in ~6 sessions / by late October' — statistical model from user history + goals + seasonal visibility window.
**Acceptance criteria:**

- Backtest against held-out user history within stated confidence interval; displayed with uncertainty range, never as certainty

### P5-03: Seasonal planning calendar

**Labels:** phase:5, pkg:desktop, type:feat
**Refs:** PRD §7 Phase 5
**Depends on:** P5-02, P2-09
Year-view calendar: optimal months per target (visibility windows), planned targets with projected completion, moon-phase overlay, goal deadlines; drag targets between months.
**Acceptance criteria:**

- Calendar consistent with ephemeris engine; plan persists and syncs; printable/exportable (PDF/ICS)

### P5-04: ML-ranked recommendations

**Labels:** phase:5, pkg:cloud, type:feat
**Refs:** PRD §7 Phase 5
**Depends on:** P5-01, P2-09
Learning-to-rank layer over the v2 scoring engine using accepted/dismissed/snoozed feedback; offline evaluation harness; transparent 'why' preserved (model contributes rank, reasons stay rule-derived).
**Acceptance criteria:**

- Offline eval shows ranking lift vs v2 baseline on held-out feedback; kill-switch reverts to v2 scoring; model card documented

### P5-05: Data quality trends analytics

**Labels:** phase:5, pkg:desktop, type:feat
**Refs:** PRD §7 Phase 5
**Depends on:** P4-04
Trend dashboards: FWHM/eccentricity/background over time, segmented by equipment/site/season; annotate with maintenance events (P4-08) to show cause/effect.
**Acceptance criteria:**

- Trends correct on fixture history; maintenance annotations align on time axis; export as CSV/PNG

### P5-06: v5.0 release hardening

**Labels:** phase:5, type:test
**Depends on:** P5-03, P5-04, P5-05
Model governance review, prediction accuracy monitoring dashboards, docs, v5.0.0 release.
**Acceptance criteria:**

- Live accuracy monitoring in place with alerting; v5.0.0 tagged

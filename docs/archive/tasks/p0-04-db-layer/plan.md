# Plan: [P0-04] Database layer — Drizzle schema v1 and migration runner

**Slug:** p0-04-db-layer **Issue:** #4 **Date:** 2026-07-05
**Governing DDs:** DD-003 (database schema — primary), DD-001 (better-sqlite3 + Drizzle), DD-002 (layering: db owns SQLite; core stays pure)
**Status:** READY_FOR_SPEC

## Summary

This issue turns the `@astrotracker/db` placeholder package into the real persistence layer:
the complete DD-003 v1 schema defined in Drizzle (every table with a UUIDv7 string PK and an
`updated_at` column), committed SQL migrations (an initial schema migration plus a custom
migration adding the FTS5 search table and its sync triggers), a database bootstrap that opens
a SQLite file with WAL mode / `busy_timeout` / `foreign_keys` and runs pending migrations, and
a repository-layer skeleton whose factory is the only thing callers ever see — the raw
better-sqlite3 connection never escapes the package. A small, dependency-free UUIDv7 generator
(RFC 9562) lands in `@astrotracker/core` (it is pure domain logic reused later by cloud sync)
with its own unit test. Everything is verified by Vitest tests against throwaway temp-file
databases: migration-from-empty, insert-fixture-rows-and-query round-trip, FTS5 search through
the triggers, and an encapsulation test asserting no raw connection is exposed.

Key defaults chosen where DD-003 is silent (all flagged in steps below): timestamps stored as
INTEGER Unix epoch milliseconds (UTC by definition) via Drizzle's `timestamp_ms` mode, except
`sessions.session_date` which stays a `YYYY-MM-DD` TEXT local astronomical date per DD-002
rule 4 / DD-006; `updated_at` is maintained by repository write-helpers (single writer per
DD-003), not by SQL triggers; Drizzle's own `__drizzle_migrations` table serves as DD-003's
`schema_migrations`; the hand-rolled UUIDv7 generator avoids a new runtime dependency; a
single FTS5 table (`search_fts`) indexes target names/aliases, session notes, and project
notes rather than one FTS table per entity.

## Affected Files

- `packages/core/src/ids/uuidv7.ts` — new; pure RFC 9562 UUIDv7 generator (monotonic within
  the same millisecond), zero dependencies, uses `node:crypto` `getRandomValues` (allowed in
  core; only fs/electron are restricted)
- `packages/core/src/ids/uuidv7.test.ts` — new; format/version/variant/monotonicity tests
- `packages/core/src/index.ts` — modified; re-export `uuidv7()` (and a `isUuid()` validator)
- `packages/db/package.json` — modified; add `drizzle-orm`, `better-sqlite3` (runtime) and
  `drizzle-kit`, `@types/better-sqlite3` (dev); add `db:generate` script
- `packages/db/drizzle.config.ts` — new; dialect `sqlite`, schema path, out dir `./drizzle`
- `packages/db/src/schema/` — new; Drizzle table definitions split by domain
  (`files.ts`, `frames.ts`, `targets.ts`, `sessions.ts`, `equipment.ts`, `calibration.ts`,
  `projects.ts`, `infra.ts`) plus `columns.ts` (shared `id`/`createdAt`/`updatedAt` helpers)
  and `index.ts` barrel
- `packages/db/drizzle/0000_<name>.sql` + `drizzle/meta/*` — new; generated initial migration
  creating all tables and indexes
- `packages/db/drizzle/0001_fts5_search.sql` — new; custom migration (`drizzle-kit generate
--custom`): `CREATE VIRTUAL TABLE search_fts USING fts5(...)` + sync triggers
- `packages/db/src/bootstrap.ts` — new; `openDatabase(options)` — PRAGMAs, migration run,
  returns the closed-over handle
- `packages/db/src/migrate.ts` — new; migration-runner wrapper resolving the `drizzle/`
  folder relative to the package (works from `dist/` via `import.meta.url`)
- `packages/db/src/repositories/` — new; `index.ts` factory + one file per repository
  (`watch-folders.ts`, `files.ts`, `frames.ts`, `targets.ts`, `filters.ts`, `sessions.ts`,
  `equipment-profiles.ts`, `master-frames.ts`, `projects.ts`, `scan-jobs.ts`, `settings.ts`,
  `search.ts`) and `shared.ts` (typed insert/update helpers that stamp `id`/`updated_at`)
- `packages/db/src/index.ts` — modified; replace placeholder with public API: `openDatabase`,
  `AstroDatabase` type, repository types, schema types (`Frame`, `NewFrame`, …). The
  placeholder `describeDb`/`dbVersion` export and its test are removed
- `packages/db/src/index.test.ts` — replaced; public-API surface + encapsulation test
- `packages/db/src/bootstrap.test.ts` — new; PRAGMA/WAL/busy_timeout/foreign-keys checks
- `packages/db/src/migrations.test.ts` — new; empty-DB migration + full round-trip test
- `packages/db/src/fts.test.ts` — new; trigger-driven FTS5 population + search test

## Schema (what "full v1 schema" means concretely)

Every table gets `id TEXT PRIMARY KEY` (UUIDv7, app-generated), `created_at` and `updated_at`
INTEGER epoch-ms NOT NULL — including junction/infra tables (`master_frame_subs`,
`project_inputs`, `thumbnails` get a surrogate UUIDv7 `id` plus a UNIQUE constraint on their
natural key). Two deliberate deviations, both noted for the Reviewer:

- `settings` keeps DD-003's natural `key TEXT PRIMARY KEY` (a UUIDv7 surrogate adds nothing to
  a key-value table that never syncs by row identity) but still gets `updated_at`.
- `schema_migrations` is realized as Drizzle's own `__drizzle_migrations` bookkeeping table
  rather than a hand-rolled twin; it is driver-managed and exempt from the UUIDv7/updated_at
  rule.

Tables (per DD-003, with FK arrows): `watch_folders`, `files` (self-FK `duplicate_of_id`,
`status` CHECK `present|missing|duplicate`), `frames` (UNIQUE `file_id`, `frame_type` CHECK,
`frame_type_source` CHECK, `headers_json` NOT NULL, all quality columns nullable),
`targets`, `target_aliases`, `filters`, `sessions`, `equipment_profiles`, `master_frames`
(`master_type` CHECK), `master_frame_subs`, `processing_projects`, `project_inputs`
(polymorphic: `input_type` CHECK `frame|master_frame`, nullable `frame_id`/`master_frame_id`,
CHECK exactly one set), `processed_images`, `scan_jobs`, `thumbnails`, `settings`.

Indexes per DD-003: `frames(target_id, filter_id, frame_type)`, `frames(session_id)`,
`frames(date_obs_utc)`, `files(sha256)`, `target_aliases(alias_normalized)`; plus uniqueness
the DD implies: `watch_folders(path)`, `files(watch_folder_id, relative_path)`,
`frames(file_id)`, `target_aliases(target_id, alias_normalized)`,
`master_frame_subs(master_frame_id, frame_id)`, `thumbnails(frame_id)`.

FTS5: one `search_fts` virtual table `fts5(entity_type UNINDEXED, entity_id UNINDEXED, title,
body)` (regular/intrinsic content, not contentless, so `DELETE … WHERE entity_id=…` works
plainly), kept in sync by AFTER INSERT/UPDATE/DELETE triggers on `targets`
(canonical_name + display_name + notes), `target_aliases` (alias), `sessions` (notes +
weather_notes), `processing_projects` (name + notes).

## Implementation Steps

### Step 1 — Schema v1 + initial migration (with Drizzle tooling)

**Outcome:** `packages/db` has real dependencies (`drizzle-orm`, `better-sqlite3`,
`@types/better-sqlite3`, `drizzle-kit`) and a complete typed schema module for every DD-003
table as specified in the Schema section above, with shared column helpers guaranteeing the
UUIDv7-PK + `created_at`/`updated_at` shape on each table. `pnpm --filter @astrotracker/db
db:generate` produces the committed migration `drizzle/0000_*.sql` that creates all tables
and all indexes from an empty database. Inferred row types (`Frame`/`NewFrame`, etc.) are
exported.
**Files:** `packages/db/package.json`, `packages/db/drizzle.config.ts`,
`packages/db/src/schema/*`, `packages/db/drizzle/0000_*.sql`, `packages/db/drizzle/meta/*`.
**Depends on:** none

### Step 2 — FTS5 migration (virtual table + sync triggers)

**Outcome:** A committed custom migration `drizzle/0001_fts5_search.sql` (created via
`drizzle-kit generate --custom`) adds the `search_fts` FTS5 table and the twelve sync
triggers (insert/update/delete × targets/target_aliases/sessions/processing_projects).
Update triggers delete-then-insert the entity's rows; NULL notes index as empty strings.
After this migration, any write to the four source tables is reflected in `search_fts`
without application code. Drizzle never tries to manage the virtual table (it lives only in
raw SQL, not in the Drizzle schema, so `generate` diffs ignore it).
**Files:** `packages/db/drizzle/0001_fts5_search.sql`, `packages/db/drizzle/meta/*` update.
**Depends on:** Step 1

### Step 3 — UUIDv7 generator in `@astrotracker/core`

**Outcome:** `uuidv7()` returns RFC 9562 version-7 UUID strings: 48-bit Unix-ms timestamp,
version/variant bits correct, random tail, and monotonicity within the same millisecond
(counter-increment strategy) so bulk inserts in one scan batch sort in creation order. A
small clock-regression guard reuses the last timestamp rather than emitting time-travelling
IDs. `isUuid()` validates the shape. Unit tests cover: regex shape, version nibble `7`,
variant bits `10xx`, timestamp-prefix round-trip against a mocked clock, strictly increasing
sort order for 10k IDs generated in a tight loop, and clock-rollback behavior. Zero new
dependencies; core stays pure (`node:crypto` randomness only — no fs, no Electron).
**Files:** `packages/core/src/ids/uuidv7.ts`, `packages/core/src/ids/uuidv7.test.ts`,
`packages/core/src/index.ts`.
**Depends on:** none (parallel with Steps 1–2)

### Step 4 — Bootstrap and migration runner

**Outcome:** `openDatabase({ filePath })` opens (creating parent directories for the DB file
if absent), applies connection PRAGMAs in order — `journal_mode=WAL`,
`busy_timeout=<default 5000ms>`, `foreign_keys=ON`, `synchronous=NORMAL` — verifies the
SQLite build has FTS5 compiled in (fail fast with a clear error otherwise), runs pending
migrations via `drizzle-orm/better-sqlite3/migrator`'s `migrate()` with the migrations folder
resolved relative to the installed package (`new URL('../drizzle', import.meta.url)` so it
works from `dist/` and inside a packaged app), and returns an `AstroDatabase` handle. The
caller supplies the file path — the db package never asks Electron for the app-data dir
(desktop passes `app.getPath('userData')`-derived paths in P0-05+; DD-003's
`%APPDATA%/AstroTracker` / `~/Library/Application Support/AstroTracker` location is the
desktop package's responsibility). A `filePath: ':memory:'` escape hatch exists for fast
unit tests, but WAL-dependent tests use temp files (in-memory DBs report
`journal_mode=memory`). Bootstrap tests assert each PRAGMA took effect and that opening the
same file twice is safe (migrations idempotent, busy_timeout honored).
**Files:** `packages/db/src/bootstrap.ts`, `packages/db/src/migrate.ts`,
`packages/db/src/bootstrap.test.ts`.
**Depends on:** Steps 1–2

### Step 5 — Repository skeleton with typed helpers (no raw connection escape)

**Outcome:** `openDatabase()` returns `AstroDatabase = { repos, transaction, close }` where
the better-sqlite3 `Database` and the Drizzle instance are captured in a closure and appear
nowhere on the public type. `repos` exposes one repository per aggregate (watchFolders,
files, frames, targets, filters, sessions, equipmentProfiles, masterFrames, projects,
scanJobs, settings, search). Skeleton scope: each repo gets typed `insert` (stamps UUIDv7
`id` via `@astrotracker/core`, `created_at`/`updated_at` now-UTC), `getById`, `list`, and
`update` (re-stamps `updated_at`) built on shared generic helpers in
`repositories/shared.ts`; `search.query(text)` runs an FTS5 `MATCH` returning
`{ entityType, entityId, title, snippet }`; `settings` gets `get`/`set` keyed helpers;
`transaction(fn)` wraps better-sqlite3's synchronous transaction and hands `fn` the same
repos object. Richer domain queries (aggregations, session grouping, calibration matching)
are deliberately NOT built here — later issues add methods to this skeleton. A test asserts
the public surface leaks no connection: no property of `AstroDatabase` or any repo is a
better-sqlite3 `Database`/`Statement`, and the package's public exports include no re-export
of `better-sqlite3` types.
**Files:** `packages/db/src/repositories/*`, `packages/db/src/index.ts`,
`packages/db/src/index.test.ts`.
**Depends on:** Steps 3–4

### Step 6 — Acceptance tests: migration round-trip and FTS5 search

**Outcome:** Two integration test suites against a temp-directory DB file (created/removed
per test):
(a) _Round-trip:_ `openDatabase()` on an empty path creates the full schema (assert every
DD-003 table exists via `sqlite_master`, spot-check the five DD-003 indexes); then insert a
coherent fixture graph through the repositories — watch_folder → file → frame →
target/filter/session/equipment_profile, a master_frame + master_frame_subs link, a
processing_project + project_inputs (one frame input, one master input) — and read it back:
`getById` on each, a `frames.list` filtered by target, and FK integrity (inserting a frame
with a bogus `file_id` throws thanks to `foreign_keys=ON`).
(b) _FTS search:_ inserting a target named "M 31"/"Andromeda Galaxy" with alias "NGC 224",
a session with notes, and a project with notes makes all four findable via
`repos.search.query(...)` (including prefix queries like `androm*`); updating the target's
display_name changes results; deleting the alias removes its hit. This proves the triggers,
not application code, maintain the index.
Fixture rows live in the test files (fixtures/ FITS samples are P0-06 and not needed here —
"fixtures" in this issue's acceptance criteria means representative rows).
**Files:** `packages/db/src/migrations.test.ts`, `packages/db/src/fts.test.ts`.
**Depends on:** Step 5

## Edge Cases

- Two `openDatabase()` calls on the same file (e.g. app restarted while a stale process holds
  the lock): `busy_timeout` must be set _before_ the migration runs, and `migrate()` must be
  idempotent — second open applies zero migrations, changes nothing.
- In-memory DB (`:memory:`) silently ignores WAL (`journal_mode` stays `memory`): bootstrap
  must not treat this as an error, but WAL assertions in tests must use a real temp file.
- FTS5 missing from the linked SQLite (a rebuilt/system better-sqlite3 without FTS5):
  bootstrap fails fast with an actionable message instead of dying later inside migration
  0001 with an opaque "no such module: fts5".
- `targets.notes` (or session/project notes) transitioning NULL → text → NULL: update
  triggers must not insert literal "null" into `search_fts` and must still refresh the
  title-only row (use `coalesce(…, '')`).
- Two rows inserted in the same millisecond (bulk insert): UUIDv7 generator must still emit
  strictly increasing IDs (counter bits), and a wall-clock rollback (NTP correction) must not
  produce IDs that sort before already-issued ones.
- `files.duplicate_of_id` self-reference: a file marked duplicate-of a row that is deleted —
  FK action must be `SET NULL` (never cascade-delete a file row; DD-003: rows removed only by
  explicit user action).
- `project_inputs` with both `frame_id` and `master_frame_id` set (or neither): rejected by
  CHECK constraint, not left to application discipline.
- Migration folder resolution when the package runs from `dist/` (compiled) vs `src/`
  (Vitest): the `import.meta.url`-relative path must resolve `packages/db/drizzle/` in both;
  a test exercises the resolved path rather than hardcoding cwd.
- Inserting a frame whose `file_id` already has a frame (rescan double-fire): UNIQUE(file_id)
  violation must surface as a typed constraint error, not silently overwrite.
- `search_fts` DELETE triggers on `targets` must also remove that target's _alias_ rows'
  FTS entries? No — alias rows are deleted by the `target_aliases` FK cascade/explicit
  delete, and each alias's own delete trigger cleans its FTS row; the plan wires
  `target_aliases.target_id` with `ON DELETE CASCADE` so orphaned alias FTS rows are
  impossible. (Deviation-check for Reviewer: cascade here deletes catalog metadata rows only,
  never `files` rows, so DD-003's "rows removed only by explicit user action" for files is
  untouched.)

## Invariant Checklist

- [x] Non-destructive: no code path writes/moves/renames/deletes user image files — the db
      package touches only the SQLite file at the caller-supplied app-data path
- [x] Layering: new domain logic in packages/core stays pure — the UUIDv7 generator uses
      only `node:crypto` randomness; all sqlite/fs code lives in packages/db; core gains no
      dependency on db
- [x] DB: every new table uses UUIDv7 TEXT PKs + `updated_at`, created via committed Drizzle
      migrations (two noted, justified exceptions: `settings` natural key; Drizzle's own
      migrations bookkeeping table)
- [x] Timestamps stored UTC — INTEGER epoch-ms columns everywhere;
      `sessions.session_date` is a local astronomical _date label_ per DD-002 rule 4/DD-006,
      not a timestamp
- [x] Long-running work goes through the worker job queue — N/A here (no scanning/hashing in
      this issue); the synchronous better-sqlite3 API is exactly what DD-001 prescribes for
      the future worker-side single writer
- [x] Performance budgets respected (PRD §8.4) — schema carries the DD-003 aggregation
      indexes; bulk-insert benchmarks themselves are P0-07 (flag: P0-07 should benchmark
      insert-with-triggers, since the FTS triggers add per-write cost on the four
      note-bearing tables — frames, the hot bulk path, has no FTS triggers)

## Out of Scope

- Worker pool / persistent job-queue semantics on `scan_jobs` (P0-05) — the table exists,
  its claim/resume logic does not
- Scanning, hashing, header parsing, thumbnail generation (P0-05, P1-01+); no code reads
  image files here
- fixtures/ FITS/XISF/RAW sample library (P0-06) — this issue's tests use inline row fixtures
- Benchmarks and CI regression gates (P0-07)
- Electron integration: resolving the real app-data directory, native-module rebuild wiring
  for better-sqlite3 under Electron ABI (P0-03/P0-05/packaging)
- IPC exposure of repositories to the renderer (P0-03+)
- Domain query methods beyond the CRUD/search skeleton (integration rollups, session
  detection, calibration matching — Phase 1 issues extend the repos)
- Free-tier 10,000-file limit enforcement (application layer, per DD-003)
- Cloud sync fields/logic (Phase 2; UUIDv7 PKs are the only sync-enabling artifact here)

## Open Questions

None — defaults chosen and flagged for review: (1) epoch-ms INTEGER timestamps (except
`session_date` TEXT date label); (2) `updated_at` stamped by repository helpers, not SQL
triggers; (3) hand-rolled zero-dependency UUIDv7 in `@astrotracker/core` instead of the
`uuidv7` npm package; (4) single `search_fts` table with entity_type/entity_id columns;
(5) `settings` keeps its natural TEXT key; (6) Drizzle's `__drizzle_migrations` stands in
for DD-003's `schema_migrations`; (7) surrogate UUIDv7 PKs + natural-key UNIQUE on junction
tables; (8) default `busy_timeout` 5000 ms.

Plan written: docs/archive/tasks/p0-04-db-layer/plan.md — 6 steps

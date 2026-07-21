# Spec: [P0-04] Database layer — Drizzle schema v1 and migration runner

**Slug:** p0-04-db-layer **Issue:** #4 **Plan:** docs/archive/tasks/p0-04-db-layer/plan.md **Date:** 2026-07-06

## Definition of Done

### Functional Requirements

- [ ] Given an empty (nonexistent) SQLite file path, when `openDatabase({ filePath })` is called, then it creates any missing parent directories, opens the file, and returns without throwing.
- [ ] Given a freshly opened database, when its `sqlite_master` table is queried, then every DD-003 v1 table exists: `watch_folders`, `files`, `frames`, `targets`, `target_aliases`, `filters`, `sessions`, `equipment_profiles`, `master_frames`, `master_frame_subs`, `processing_projects`, `project_inputs`, `processed_images`, `scan_jobs`, `thumbnails`, `settings`.
- [ ] Given a freshly opened database, when `sqlite_master` is queried for indexes, then at minimum these DD-003 indexes exist: `frames(target_id, filter_id, frame_type)`, `frames(session_id)`, `frames(date_obs_utc)`, `files(sha256)`, `target_aliases(alias_normalized)`.
- [ ] Given a database file already migrated once, when `openDatabase()` is called again on the same file, then zero additional migrations apply and no schema/data changes occur (idempotent re-open).
- [ ] Given a coherent fixture row graph (watch_folder → file → frame → target/filter/session/equipment_profile, a master_frame + master_frame_subs link, a processing_project + project_inputs with one frame input and one master input), when each row is inserted through the repository layer and then re-read via `getById`, then every read returns the values written, including foreign keys.
- [ ] Given frames inserted for multiple targets, when `repos.frames.list({ targetId })` (or equivalent filter) is called, then only frames for that target are returned.
- [ ] Given `foreign_keys=ON`, when a frame is inserted with a `file_id` that does not exist in `files`, then the insert throws a foreign-key-constraint error.
- [ ] Given a target named "M 31" with `display_name` "Andromeda Galaxy" and alias "NGC 224", a session with notes, and a project with notes, when `repos.search.query('androm*')` (or equivalent prefix query) is run, then all four rows are findable via FTS5, each returning `{ entityType, entityId, title, snippet }`.
- [ ] Given an indexed target's `display_name` is updated, when `repos.search.query(...)` is re-run, then results reflect the new value without any application-level FTS write call.
- [ ] Given an indexed alias row is deleted, when `repos.search.query(...)` is re-run for that alias text, then the alias's hit no longer appears.
- [ ] Given `uuidv7()` from `@astrotracker/core`, when called, then it returns a 36-character canonical UUID string matching `/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i` (version nibble `7`, variant bits `10xx`).
- [ ] Given `uuidv7()` called 10,000 times in a tight loop (including calls that land in the same millisecond), when the outputs are sorted lexically, then that order equals emission order (strictly increasing, no duplicates).
- [ ] Given a mocked clock that moves backward between two `uuidv7()` calls (simulated NTP correction), when the second call is made, then its ID still sorts after the first (monotonic guard reuses/advances the last timestamp rather than emitting a smaller one).
- [ ] Given `isUuid()` from `@astrotracker/core`, when passed a valid UUIDv7 string and a clearly invalid string (wrong length, wrong version nibble), then it returns `true` and `false` respectively.
- [ ] Given `openDatabase()` on a real temp-file path, when the connection's PRAGMAs are inspected, then `journal_mode=wal`, `foreign_keys=ON` (`1`), and `synchronous=NORMAL` are all in effect, and `busy_timeout` reflects the configured value (default 5000 ms).
- [ ] Given `filePath: ':memory:'`, when `openDatabase()` is called, then it succeeds without error even though `journal_mode` reports `memory` (not `wal`).
- [ ] Given a better-sqlite3 build without FTS5 compiled in (simulated/mocked), when `openDatabase()` runs, then it fails fast during bootstrap with an actionable error message, not with an opaque `no such module: fts5` failure surfaced later from migration 0001.
- [ ] Given `project_inputs` insert attempts with both `frame_id` and `master_frame_id` set, and separately with neither set, when each is executed, then both are rejected by the CHECK constraint (not left to application-level validation).
- [ ] Given a `files` row marked `duplicate_of_id` pointing at another `files` row, when the referenced row is deleted, then the FK action is `SET NULL` on `duplicate_of_id` (the dependent file row itself is never cascade-deleted).
- [ ] Given a frame already inserted for a given `file_id`, when a second frame insert is attempted for the same `file_id`, then it fails with a typed UNIQUE-constraint violation rather than silently overwriting the existing row.
- [ ] Given `targets.notes` (or session/project notes) transitioning NULL → text → NULL, when `search_fts` is inspected after each transition, then no literal `"null"` string appears in the indexed row and the title-only content still indexes correctly (`coalesce(…, '')` behavior).
- [ ] Given the package built to `dist/` versus run from `src/` under Vitest, when the migration folder is resolved via `import.meta.url`, then both resolve to the same `packages/db/drizzle/` directory and migrations apply successfully in both contexts.

### Data Integrity

- [ ] Every DD-003 table (per the list above) has `id TEXT PRIMARY KEY` populated by `uuidv7()`, `created_at INTEGER NOT NULL` and `updated_at INTEGER NOT NULL` (epoch-ms UTC); created by the initial migration `packages/db/drizzle/0000_*.sql`, except the two explicitly documented deviations below.
- [ ] **DD-003 hard rule — UUIDv7 PKs:** every table's `id` column is a UUIDv7 string generated by `@astrotracker/core`'s `uuidv7()` at insert time, with the two documented exceptions (`settings.key`, Drizzle's own `__drizzle_migrations`) — Reviewer checks each `schema/*.ts` table definition's PK column and the corresponding `repositories/shared.ts` insert helper.
- [ ] **DD-003 hard rule — `updated_at` on every table:** every table definition includes a non-null `updated_at` column, and every repository `insert`/`update` helper stamps it — Reviewer checks `repositories/shared.ts` and each repository file for the stamp call, and confirms `update()` re-stamps `updated_at` on every write.
- [ ] **DD-002 rule 4 — UTC timestamps:** `created_at`/`updated_at`/`date_obs_utc`/`started_at_utc`/`ended_at_utc`/etc. are stored as INTEGER epoch-ms (UTC by construction); `sessions.session_date` is the one documented exception, stored as a `YYYY-MM-DD` TEXT local-astronomical-date label (not a timestamp, no UTC claim applies) — Reviewer checks `schema/sessions.ts` and confirms no other table uses a TEXT date/time column.
- [ ] Migration round-trips: `openDatabase()` on an empty path applies migrations 0000 and 0001 without error; re-running on the same now-migrated path applies zero further migrations without error (see Functional Requirements above for the fixture round-trip itself).
- [ ] `frame_type` is validated by a CHECK constraint to one of `light|dark|flat|bias|darkflat|unknown`; `frame_type_source` to `header|path_heuristic|manual`; `files.status` to `present|missing|duplicate`; `master_frames.master_type` to `dark|flat|bias|darkflat`; `project_inputs.input_type` to `frame|master_frame`.
- [ ] Uniqueness constraints exist and are enforced: `watch_folders(path)`, `files(watch_folder_id, relative_path)`, `frames(file_id)`, `target_aliases(target_id, alias_normalized)`, `master_frame_subs(master_frame_id, frame_id)`, `thumbnails(frame_id)`.

### Documented Deviations (review callouts — confirm justified, not silent drift)

These are the plan's 8 flagged defaults chosen where DD-003 is silent. Reviewer must confirm each is (a) actually implemented as described and (b) called out in the PR description, not left implicit:

- [ ] **(1) Timestamp representation:** all timestamps are INTEGER Unix epoch-ms via Drizzle's `timestamp_ms` mode, except `sessions.session_date` (TEXT local date label per DD-002 rule 4 / DD-006).
- [ ] **(2) `updated_at` maintenance:** stamped by repository write-helpers (`repositories/shared.ts`), not by SQL triggers — confirm no `updated_at`-maintaining trigger exists in either migration file.
- [ ] **(3) UUIDv7 generator:** hand-rolled zero-dependency implementation in `@astrotracker/core`, not the `uuidv7` npm package — confirm `packages/core/package.json` gains no new runtime dependency.
- [ ] **(4) FTS5 shape:** a single `search_fts` table with `entity_type`/`entity_id` columns indexing targets, target_aliases, sessions, and processing_projects, rather than one FTS table per entity.
- [ ] **(5) `settings` PK:** keeps its natural `key TEXT PRIMARY KEY` (no UUIDv7 surrogate) but still carries `updated_at` — confirm this is the only non-`__drizzle_migrations` table without a UUIDv7 `id`.
- [ ] **(6) `schema_migrations`:** realized as Drizzle's own `__drizzle_migrations` bookkeeping table, exempt from the UUIDv7/`updated_at` rule — confirm no hand-rolled `schema_migrations` table is also created (would be redundant/conflicting).
- [ ] **(7) Junction/infra surrogate PKs:** `master_frame_subs`, `project_inputs`, `thumbnails` each get a surrogate UUIDv7 `id` plus a UNIQUE constraint on their natural key, rather than a natural composite PK.
- [ ] **(8) `busy_timeout` default:** 5000 ms, configurable via `openDatabase(options)` — confirm the value is a named option with 5000 as literal default, not hardcoded with no override path.

### Core Invariants

- [ ] No code path in the diff writes, moves, renames, or deletes files outside the app-data directory — applies narrowly: the only fs writes are (a) creating parent directories for the caller-supplied SQLite file path and (b) SQLite's own WAL/journal files alongside it; Reviewer greps the diff for `fs.` / `unlink` / `rename` calls and confirms none touch image files or paths outside the caller-supplied DB path.
- [ ] New domain logic is in packages/core with no Electron/fs imports — the UUIDv7 generator (`packages/core/src/ids/uuidv7.ts`) imports only `node:crypto`; Reviewer greps it and `packages/core/src/index.ts` for `electron`/`fs`/`node:fs` imports and confirms none exist.
- [ ] All persisted timestamps are UTC — see Data Integrity's DD-002 rule 4 check above; N/A carve-out is `sessions.session_date` only, and that carve-out is explicit in the schema and this spec, not silent.
- [ ] Manual user overrides (target/filter/type/session assignments) survive a rescan — N/A, this issue adds no scanning or rescan logic (P0-05+); repository `update()` semantics (re-stamp `updated_at`, leave other columns as given by the caller) must not themselves clobber a value the caller didn't pass, but there is no rescan code path to test yet.
- [ ] Repositories expose no raw connection to callers (issue #4 acceptance criterion): no property of `AstroDatabase` or of any object under `repos` is a better-sqlite3 `Database` or `Statement` instance; `packages/db/src/index.ts`'s public exports include no re-export of any `better-sqlite3` type — Reviewer checks the test in `index.test.ts` asserts this and inspects the type signature of `AstroDatabase`.

### Performance

- [ ] N/A for this issue — no benchmark harness exists yet (P0-07); schema does carry the DD-003 aggregation indexes (`frames(target_id, filter_id, frame_type)`, `frames(session_id)`, `frames(date_obs_utc)`, `files(sha256)`, `target_aliases(alias_normalized)`) so P0-07 has something to benchmark against — Reviewer confirms indexes exist (see Data Integrity) but must not require `pnpm bench` output for this PR.
- [ ] Flag carried into P0-07 (from the plan's invariant checklist, not a gate here): FTS5 sync triggers add per-write cost to `targets`, `target_aliases`, `sessions`, `processing_projects`; `frames` (the hot bulk-insert path) has no FTS triggers and is unaffected — Reviewer confirms this asymmetry by checking which tables migration 0001 attaches triggers to.

### Tests

- [ ] `packages/core/src/ids/uuidv7.test.ts` covers: regex/shape, version nibble `7`, variant bits `10xx`, timestamp-prefix round-trip against a mocked clock, strictly increasing sort order for 10k IDs generated in a tight loop, and clock-rollback (NTP correction) behavior.
- [ ] `packages/db/src/bootstrap.test.ts` covers: each PRAGMA (`journal_mode`, `busy_timeout`, `foreign_keys`, `synchronous`) took effect on a real temp-file DB; opening the same file twice is safe/idempotent; `:memory:` open succeeds despite reporting `journal_mode=memory`; missing-FTS5 fails fast with an actionable message.
- [ ] `packages/db/src/migrations.test.ts` covers: empty-DB migration creates every DD-003 table and the five named indexes (via `sqlite_master`); full fixture round-trip (watch_folder → file → frame → target/filter/session/equipment_profile, master_frame + master_frame_subs, processing_project + project_inputs with one frame input and one master input) insert-then-read through repositories; `frames.list` filtered by target; FK violation on bogus `file_id` throws; UNIQUE(file_id) double-insert throws typed error; `project_inputs` CHECK rejects both-set and neither-set; `duplicate_of_id` SET NULL on referenced-row delete; migration-folder resolution works from both `dist/` and `src/`.
- [ ] `packages/db/src/fts.test.ts` covers: inserting target "M 31"/"Andromeda Galaxy" + alias "NGC 224" + session notes + project notes makes all four findable via `repos.search.query`, including a prefix query (e.g. `androm*`); updating `display_name` changes results without app-level FTS calls; deleting the alias removes its hit; NULL → text → NULL notes transition never indexes literal `"null"` and still refreshes the title-only row.
- [ ] `packages/db/src/index.test.ts` covers: public-API surface (`openDatabase`, `AstroDatabase` type, repository types, schema row types) and the encapsulation test (no raw connection/statement reachable from any public value or type).
- [ ] All existing tests still pass (`pnpm -r test`), including the placeholder tests in `packages/desktop` and `packages/desktop/renderer` untouched by this issue.

## Out of Scope

Copied and expanded from the plan — Reviewer must not flag any of the following as missing from this PR:

- Worker pool / persistent job-queue semantics on `scan_jobs` (P0-05) — the table and its columns exist; claim/resume/retry logic does not.
- Scanning, hashing, header parsing, thumbnail generation (P0-05, P1-01+) — no code in this diff reads an actual image file; all test fixtures are inline rows, not files.
- `fixtures/` FITS/XISF/RAW sample library (P0-06) — "fixtures" in issue #4's acceptance criteria means representative inline test rows, not the shared fixture library.
- Benchmarks and CI regression gates (P0-07) — see Performance section above; no `pnpm bench` requirement here.
- Electron integration: resolving the real app-data directory (`app.getPath('userData')`), native-module rebuild wiring for better-sqlite3 under Electron ABI (P0-03/P0-05/packaging) — `openDatabase` only accepts a caller-supplied `filePath`.
- IPC exposure of repositories to the renderer (P0-03+).
- Domain query methods beyond the CRUD/search skeleton — aggregations, session-date grouping, calibration matching are later Phase 1 issues; the skeleton's `insert`/`getById`/`list`/`update`/`search.query`/`settings.get`/`settings.set` is the full surface expected here.
- Free-tier 10,000-file limit enforcement (application layer, per DD-003) — not schema, not this issue.
- Cloud sync fields/logic (Phase 2) — UUIDv7 PKs are the only sync-enabling artifact expected here; no sync columns, no conflict resolution.
- Exact SQL formatting/naming of generated migration files beyond matching the schema module (Reviewer should diff behavior, not bikeshed Drizzle's auto-generated column ordering or migration file naming).

## Test Hints

- **empty-db-schema**: `openDatabase({ filePath: tmpFile })` on a nonexistent path; query `sqlite_master` for `type='table'`; assert the full DD-003 table-name set is present and assert the five named indexes exist via `sqlite_master` `type='index'`.
- **idempotent-reopen**: open a temp-file DB, close it, reopen the same path; assert the migrations-applied count (or `__drizzle_migrations` row count) is unchanged between the two opens.
- **fixture-round-trip**: seed watch_folder → file → frame → target/filter/session/equipment_profile, a master_frame + master_frame_subs row, and a processing_project + two project_inputs (one `frame_id`-set, one `master_frame_id`-set) through the repos; `getById` each; assert every field matches what was inserted, including FK ids.
- **frames-list-by-target**: insert frames for two different `target_id`s; `repos.frames.list({ targetId: A })`; assert only target-A frames returned.
- **fk-violation**: insert a frame with `file_id: 'nonexistent-uuid'`; assert it throws (SQLite foreign-key constraint error, `foreign_keys=ON`).
- **unique-file-id-violation**: insert two frames for the same `file_id`; assert the second throws a typed unique-constraint error, not a silent overwrite.
- **project-inputs-check**: insert `project_inputs` rows with (a) both `frame_id` and `master_frame_id` set, (b) neither set; assert both throw a CHECK-constraint error.
- **duplicate-of-set-null**: insert file A, file B with `duplicate_of_id: A.id`; delete A; assert B's `duplicate_of_id` is now NULL (not cascade-deleted).
- **fts-search-basics**: insert target "M 31"/"Andromeda Galaxy" with alias "NGC 224", a session with notes text, a project with notes text; `repos.search.query('androm*')` and other exact/prefix queries; assert all four appear with correct `entityType`/`entityId`.
- **fts-update-trigger**: update the target's `display_name`; re-run the search; assert results reflect new text and not stale text.
- **fts-delete-trigger**: delete the alias row; re-run search for the alias text; assert no hit remains.
- **fts-null-notes**: set a target's `notes` to NULL, then text, then NULL again; inspect `search_fts` row content at each step; assert no literal `"null"` substring and title-only content is present when notes is NULL.
- **uuidv7-shape**: generate one ID; assert regex match, version nibble `7`, variant bits `10xx`.
- **uuidv7-monotonic-10k**: generate 10,000 IDs in a loop (including same-millisecond bursts); assert sorted-lexical order equals emission order with no duplicates.
- **uuidv7-clock-rollback**: mock `Date.now()` to return a later then earlier value across two calls; assert the second ID still sorts after the first.
- **encapsulation**: iterate all enumerable properties/types of `AstroDatabase` and each `repos.*` object; assert none is `instanceof` better-sqlite3's `Database`/`Statement`; grep the package's exported `.d.ts`/type surface for `better-sqlite3` re-exports and assert none exist.
- **dist-vs-src-migration-path**: run the migration-resolution logic once under Vitest (`src/`) and once against a built `dist/` output; assert both resolve to `packages/db/drizzle/` and both apply migrations successfully.
- **fts5-missing-fast-fail**: mock/stub the FTS5-availability check to report unavailable; call `openDatabase()`; assert it throws before attempting migration 0001, with a message naming FTS5 (not the raw SQLite "no such module" text).

Spec written: docs/archive/tasks/p0-04-db-layer/spec.md — 50 criteria

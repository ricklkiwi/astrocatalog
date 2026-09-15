# DD-003: Database Schema (SQLite)

**Status:** Accepted
**Date:** 2026-07-05

## Decision

Metadata-only SQLite catalog. Files are referenced by path; image data never enters the DB. Drizzle ORM manages schema + versioned migrations from day one.

## Schema rollout

**Intent:** P0 creates only the foundation catalog spine: watch folders, physical files, parsed frames, scan jobs, settings, schema migrations, and the indexes needed for those repositories. Feature-owned tables are added by the first vertical slice that uses them, with a Drizzle migration and round-trip migration test in that same issue.

This keeps early schema work tied to proven behavior instead of front-loading the entire v1 domain model before parsers, target resolution, session detection, and calibration matching have been validated.

**What actually happened (amended 2026-09-07, see ADR-004):** P0-04 created the entire v1 domain model in migration `0000` — all sixteen tables — rather than the spine alone. The deviation was not noticed at review time and no DD revision was proposed, contrary to the "DDs are law" working agreement.

The remaining feature tables are **kept**. They are now load-bearing for slices already in flight, they carry no user data problem (columns are nullable and unused until their slice lands), and unwinding them would churn migrations for no behavioral gain. Feature slices that were told to "add the X migration" therefore **alter** the existing table where their acceptance criteria need columns it lacks, and add only indexes and constraints.

The one exception was the processing-project group (`processing_projects`, `project_inputs`, `processed_images`), dropped in migration `0006`. Unlike the rest, its feature moved out of v1.0 entirely (to P1x-01), and the shape that shipped contradicted the "separate join tables" design point below — so there was nothing to preserve and a wrong precedent to remove.

## Planned tables by feature area

```sql
-- Physical storage roots the user watches
watch_folders(id, path, drive_label, timezone, is_active, last_scan_at, created_at, updated_at)

-- One row per physical file discovered
files(
  id, watch_folder_id → watch_folders,
  relative_path, filename, extension, size_bytes,
  sha256,                    -- nullable until hashed (lazy)
  file_mtime, first_seen_at, last_seen_at,
  status,                    -- 'present' | 'missing' | 'duplicate'
  duplicate_of_id → files,   -- canonical file if duplicate
  created_at, updated_at
)

-- Parsed metadata, one row per image file
frames(
  id, file_id → files (unique),
  frame_type,                -- 'light'|'dark'|'flat'|'bias'|'darkflat'|'unknown'
  frame_type_source,         -- 'header'|'path_heuristic'|'manual'
  object_raw,                -- OBJECT header verbatim
  target_id → targets,       -- resolved (nullable)
  filter_raw, filter_id → filters,
  exposure_seconds, date_obs_utc,
  telescope_raw, camera_raw, equipment_profile_id → equipment_profiles,
  ccd_temp, set_temp, gain, offset, binning_x, binning_y,
  width_px, height_px, ra_deg, dec_deg,
  focal_length, aperture, pier_side, airmass, observer, site_name,
  bayer_pattern, fwhm, hfr, star_count,   -- quality (nullable)
  session_id → sessions,
  session_assignment_locked, -- user merge/split lock, default false (P1-17)
  headers_json,              -- full raw header dump for forward-compat
  created_at, updated_at
)

-- Canonical astronomical targets
targets(
  id, canonical_name,        -- e.g. 'M 31'
  display_name,              -- user-editable, e.g. 'Andromeda Galaxy'
  catalog_ids_json,          -- ['M 31','NGC 224']
  ra_deg, dec_deg, object_type, constellation,
  status,                    -- 'planning'|'capturing'|'ready'|'processed'|'complete'
  notes, thumbnail_frame_id, created_at, updated_at
)

target_aliases(id, target_id → targets, alias_normalized, source, created_at, updated_at) -- 'builtin'|'user'

-- Normalized filters with canonical grouping
filters(id, raw_name, canonical_name, band_type, created_at, updated_at) -- 'L','R','G','B','Ha','OIII','SII','UVIR','none'…

-- Detected imaging nights
sessions(
  id, session_date,          -- local astronomical date (noon-to-noon)
  started_at_utc, ended_at_utc,
  timezone, timezone_source, -- timezone_source: 'watch_folder'|'system_fallback' (P1-17)
  equipment_profile_id, notes, weather_notes,
  created_at, updated_at
)

-- Distinct telescope+camera(+rotator/reducer) combos, auto-detected
equipment_profiles(id, name, telescope, camera, focal_length, aperture, pixel_size, is_user_confirmed, created_at, updated_at)

-- Calibration masters; raw-sub provenance arrives with advanced calibration management
master_frames(
  id, file_id → files, master_type,   -- 'dark'|'flat'|'bias'|'darkflat'
  camera_raw, equipment_profile_id, filter_id,
  exposure_seconds, ccd_temp, gain, offset, binning_x, binning_y,
  created_date, sub_count, notes, created_at, updated_at
)
master_frame_subs(master_frame_id, frame_id)   -- v1.x: which raw subs built the master

-- Processing workflow
processing_projects(id, target_id, name, version_label, status, software, notes, created_at, updated_at)
project_frame_inputs(project_id, frame_id, role, created_at)
project_master_frame_inputs(project_id, master_frame_id, role, created_at)
processed_images(id, project_id, file_id, format, is_final, published_url, created_at, updated_at)

-- Infrastructure
scan_jobs(id, watch_folder_id, status, files_seen, files_added, files_updated, started_at, finished_at, error, created_at, updated_at)
thumbnails(frame_id, cache_path, generated_at, updated_at)
settings(key, value_json, created_at, updated_at)
schema_migrations(version, applied_at)
```

## Key design points

- **`headers_json` on every frame:** raw header dump preserved so future features (new keywords) never require rescanning disks.
- **Aggregation performance:** integration-time rollups are `SUM(exposure_seconds) GROUP BY target_id, filter_id` over indexed columns. Indexes: `frames(target_id, filter_id, frame_type)`, `frames(session_id)`, `frames(date_obs_utc)`, `files(sha256)`, `target_aliases(alias_normalized)`.
- **FTS5** is added incrementally with the target/notes features that need it; P0 does not create search tables before searchable entities exist.
- **Missing vs deleted:** files on disconnected drives are marked `missing`, never auto-deleted — statistics remain stable when external drives are offline. Rows are removed only by explicit user action.
- **Lazy hashing:** SHA-256 computed in background after metadata scan (hashing is I/O-heavy); duplicate detection is therefore eventually-consistent.
- **Sync-ready timestamps:** all logical entities that may sync in Phase 2 carry `created_at` and `updated_at` from v1. User-visible deletes are explicit tombstones in a later sync migration; v1 does not hard-delete catalog rows except through explicit local cleanup actions.
- **Project inputs:** frame inputs and master-frame inputs use separate join tables (`project_frame_inputs`, `project_master_frame_inputs`) instead of a polymorphic foreign key, preserving referential integrity and simple query plans. Migration `0000` violated this with a single polymorphic `project_inputs` table discriminated by a CHECK; its UNIQUE natural key was inert, because SQLite treats NULLs as distinct. Dropped in `0006`; P1x-01 creates the intended pair.
- **Timezone source:** `watch_folders.timezone` stores an IANA timezone (user-confirmable) for astronomical-day grouping. `sessions.timezone` captures the timezone used at detection time so historical grouping remains stable if settings change.
- **DB location:** app data dir (`%APPDATA%/AstroTracker` / `~/Library/Application Support/AstroTracker`), WAL mode, single writer (worker), `PRAGMA busy_timeout`.
- **Free-tier limit (10,000 files)** enforced in application layer, not schema.

## Consequences

- Schema evolution goes through Drizzle migrations; every feature-owned table is introduced in the feature slice that first uses it, and every migration gets a round-trip test against a fixture DB.
- Cloud sync (Phase 2) syncs logical entities (targets, frames-metadata, sessions), keyed by stable UUIDs — all PKs are UUIDv7 strings, not autoincrement ints, to make sync/merge feasible.

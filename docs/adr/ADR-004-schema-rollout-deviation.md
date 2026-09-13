# ADR-004: Keep the Front-Loaded v1 Schema, Drop the Processing-Project Tables

**Status:** Accepted
**Date:** 2026-09-07

## Context

`DD-003` has an explicit "Schema rollout" section: P0 creates only the foundation catalog spine
(watch folders, files, frames, scan jobs, settings, schema migrations), and every feature-owned
table arrives with the vertical slice that first uses it. The stated reason is that this "keeps
early schema work tied to proven behavior instead of front-loading the entire v1 domain model
before parsers, target resolution, session detection, and calibration matching have been
validated."

P0-04 did not do that. Migration `0000_numerous_dreadnoughts.sql` creates all sixteen v1 tables at
once, including `targets`, `sessions`, `equipment_profiles`, `filters`, `master_frames`, and the
processing-project group. The deviation shipped without review comment and without the DD revision
that `planning/development-plan.md` working agreement 1 ("DDs are law") requires.

The drift then propagated into the task breakdown, which still instructs later slices to "add the
`targets` and `target_aliases` migrations if not already present" and similar — guidance that
describes a world that no longer exists, and that a coding agent would either follow into a
duplicate migration or silently ignore.

A second, independent violation rode along in the same migration. `DD-003` says frame inputs and
master-frame inputs "use separate join tables instead of a polymorphic foreign key, preserving
referential integrity and simple query plans." What shipped is a single polymorphic
`project_inputs` table discriminated by a CHECK constraint. Its `UNIQUE(project_id, frame_id,
master_frame_id)` natural key is also inert: SQLite treats NULLs as distinct, so
`(project, frame, NULL)` can be inserted without limit. That was filed as a backlog issue rather
than recognized as a design-decision violation.

## Decision

**Keep the front-loaded tables, except the processing-project group.**

1. The already-created feature tables (`targets`, `target_aliases`, `filters`, `sessions`,
   `equipment_profiles`, `master_frames`, `master_frame_subs`, `thumbnails`) stay. Their columns
   are nullable and unused until their slice lands, so they cause no data problem, and unwinding
   them would churn migrations for no behavioral gain. Feature slices now **alter** these tables
   where they need columns, indexes, or constraints the table lacks.

2. `processing_projects`, `project_inputs`, and `processed_images` are **dropped** in migration
   `0006`. Unlike the rest, the feature they serve left v1.0 entirely for Phase 1.x (P1x-01), so
   there is no slice coming to grow into them during v1; and the shape that shipped is the one
   `DD-003` explicitly rejected, so keeping it would preserve a wrong precedent for whoever
   implements P1x-01. P1x-01 creates `project_frame_inputs` and `project_master_frame_inputs` as
   `DD-003` intends.

3. `DD-003`'s rollout section is amended to record what happened and which rule now applies, rather
   than left describing an intent the codebase contradicts.

## Consequences

- The DD and the schema agree again, so an agent reading `DD-003` gets accurate guidance.
- Backlog issue #51 ("ineffective UNIQUE on `project_inputs`") is obsolete rather than fixed. The
  correct resolution of a constraint bug on a table that should not exist is to remove the table.
- The FTS5 triggers on `processing_projects` are dropped with it, and the `search_fts` rows they
  wrote are deleted explicitly. `DROP TABLE` removes a table's triggers but does not fire
  `AFTER DELETE`, so without that step the search index would keep `entity_type = 'project'` hits
  pointing at a table that no longer exists.
- `SearchHit['entityType']` loses `'project'`. It returns in Phase 1.x with P1x-01.
- The general lesson is process, not schema: the violation was invisible because nothing compared
  the DDs against the code. The narrower analogue for the issue tracker is now automated
  (`pnpm issues:verify`); DD conformance remains a review responsibility.

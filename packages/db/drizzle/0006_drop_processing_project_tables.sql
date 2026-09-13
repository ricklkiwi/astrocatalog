-- Drop the processing-project tables (DD-003 revision, ADR-004).
--
-- These shipped in 0000 despite DD-003's own "Schema rollout" rule that P0
-- creates only the foundation spine and feature tables arrive with the slice
-- that first uses them. The feature they serve has since moved out of v1.0 to
-- Phase 1.x (P1x-01), and the shape that shipped contradicts DD-003's stated
-- design point: it used one polymorphic `project_inputs` table with a CHECK
-- rather than separate frame/master-frame join tables. Its UNIQUE natural key
-- was also inert, because SQLite treats NULLs as distinct, so
-- (project, frame, NULL) could be inserted repeatedly.
--
-- No user data exists yet. P1x-01 recreates these in DD-003's intended shape.

-- The FTS triggers must go first, and the rows they wrote must be deleted by
-- hand: SQLite drops a table's triggers with the table, but DROP TABLE does
-- not fire AFTER DELETE, so any indexed project rows would otherwise be
-- orphaned in `search_fts` forever with no table left to clean them up.
DROP TRIGGER IF EXISTS `processing_projects_fts_after_insert`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `processing_projects_fts_after_update`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `processing_projects_fts_after_delete`;--> statement-breakpoint
DELETE FROM `search_fts` WHERE `entity_type` = 'project';--> statement-breakpoint

-- Children before parent: both reference `processing_projects`, and bootstrap
-- runs with `PRAGMA foreign_keys = ON`.
DROP TABLE `processed_images`;--> statement-breakpoint
DROP TABLE `project_inputs`;--> statement-breakpoint
DROP TABLE `processing_projects`;

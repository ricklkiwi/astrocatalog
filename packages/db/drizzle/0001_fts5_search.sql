-- Custom migration (DD-003: FTS5 virtual table over target names/aliases,
-- session notes, project notes). One search_fts table with entity_type /
-- entity_id discriminator columns (plan deviation 4). Regular (intrinsic
-- content) FTS5 table so plain `DELETE ... WHERE entity_id = ...` works.
-- Kept in sync purely by the triggers below — no application-level FTS
-- writes exist. NULL notes index as '' via coalesce (never literal 'null').
-- This table lives only in raw SQL, never in the Drizzle schema, so
-- `drizzle-kit generate` diffs ignore it.
CREATE VIRTUAL TABLE `search_fts` USING fts5(
	`entity_type` UNINDEXED,
	`entity_id` UNINDEXED,
	`title`,
	`body`
);--> statement-breakpoint

-- targets: title = canonical_name + display_name, body = notes
CREATE TRIGGER `targets_fts_after_insert` AFTER INSERT ON `targets` BEGIN
	INSERT INTO `search_fts` (`entity_type`, `entity_id`, `title`, `body`)
	VALUES ('target', new.`id`, trim(new.`canonical_name` || ' ' || coalesce(new.`display_name`, '')), coalesce(new.`notes`, ''));
END;--> statement-breakpoint
CREATE TRIGGER `targets_fts_after_update` AFTER UPDATE ON `targets` BEGIN
	DELETE FROM `search_fts` WHERE `entity_type` = 'target' AND `entity_id` = old.`id`;
	INSERT INTO `search_fts` (`entity_type`, `entity_id`, `title`, `body`)
	VALUES ('target', new.`id`, trim(new.`canonical_name` || ' ' || coalesce(new.`display_name`, '')), coalesce(new.`notes`, ''));
END;--> statement-breakpoint
CREATE TRIGGER `targets_fts_after_delete` AFTER DELETE ON `targets` BEGIN
	DELETE FROM `search_fts` WHERE `entity_type` = 'target' AND `entity_id` = old.`id`;
END;--> statement-breakpoint

-- target_aliases: title = alias_normalized, no body. Alias FTS rows are
-- cleaned by this delete trigger; target_aliases.target_id is ON DELETE
-- CASCADE and SQLite fires delete triggers for cascaded deletes (with
-- foreign_keys=ON and recursive_triggers default), so orphaned alias FTS
-- rows are impossible.
CREATE TRIGGER `target_aliases_fts_after_insert` AFTER INSERT ON `target_aliases` BEGIN
	INSERT INTO `search_fts` (`entity_type`, `entity_id`, `title`, `body`)
	VALUES ('target_alias', new.`id`, new.`alias_normalized`, '');
END;--> statement-breakpoint
CREATE TRIGGER `target_aliases_fts_after_update` AFTER UPDATE ON `target_aliases` BEGIN
	DELETE FROM `search_fts` WHERE `entity_type` = 'target_alias' AND `entity_id` = old.`id`;
	INSERT INTO `search_fts` (`entity_type`, `entity_id`, `title`, `body`)
	VALUES ('target_alias', new.`id`, new.`alias_normalized`, '');
END;--> statement-breakpoint
CREATE TRIGGER `target_aliases_fts_after_delete` AFTER DELETE ON `target_aliases` BEGIN
	DELETE FROM `search_fts` WHERE `entity_type` = 'target_alias' AND `entity_id` = old.`id`;
END;--> statement-breakpoint

-- sessions: title = session_date label, body = notes + weather_notes
CREATE TRIGGER `sessions_fts_after_insert` AFTER INSERT ON `sessions` BEGIN
	INSERT INTO `search_fts` (`entity_type`, `entity_id`, `title`, `body`)
	VALUES ('session', new.`id`, new.`session_date`, trim(coalesce(new.`notes`, '') || ' ' || coalesce(new.`weather_notes`, '')));
END;--> statement-breakpoint
CREATE TRIGGER `sessions_fts_after_update` AFTER UPDATE ON `sessions` BEGIN
	DELETE FROM `search_fts` WHERE `entity_type` = 'session' AND `entity_id` = old.`id`;
	INSERT INTO `search_fts` (`entity_type`, `entity_id`, `title`, `body`)
	VALUES ('session', new.`id`, new.`session_date`, trim(coalesce(new.`notes`, '') || ' ' || coalesce(new.`weather_notes`, '')));
END;--> statement-breakpoint
CREATE TRIGGER `sessions_fts_after_delete` AFTER DELETE ON `sessions` BEGIN
	DELETE FROM `search_fts` WHERE `entity_type` = 'session' AND `entity_id` = old.`id`;
END;--> statement-breakpoint

-- processing_projects: title = name, body = notes
CREATE TRIGGER `processing_projects_fts_after_insert` AFTER INSERT ON `processing_projects` BEGIN
	INSERT INTO `search_fts` (`entity_type`, `entity_id`, `title`, `body`)
	VALUES ('project', new.`id`, new.`name`, coalesce(new.`notes`, ''));
END;--> statement-breakpoint
CREATE TRIGGER `processing_projects_fts_after_update` AFTER UPDATE ON `processing_projects` BEGIN
	DELETE FROM `search_fts` WHERE `entity_type` = 'project' AND `entity_id` = old.`id`;
	INSERT INTO `search_fts` (`entity_type`, `entity_id`, `title`, `body`)
	VALUES ('project', new.`id`, new.`name`, coalesce(new.`notes`, ''));
END;--> statement-breakpoint
CREATE TRIGGER `processing_projects_fts_after_delete` AFTER DELETE ON `processing_projects` BEGIN
	DELETE FROM `search_fts` WHERE `entity_type` = 'project' AND `entity_id` = old.`id`;
END;

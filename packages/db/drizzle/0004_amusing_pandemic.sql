ALTER TABLE `files` ADD `parse_error` text;--> statement-breakpoint
ALTER TABLE `scan_jobs` ADD `files_errored` integer DEFAULT 0 NOT NULL;
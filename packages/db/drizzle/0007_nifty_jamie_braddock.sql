ALTER TABLE `frames` ADD `session_assignment_locked` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `timezone` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `timezone_source` text;--> statement-breakpoint
ALTER TABLE `watch_folders` ADD `timezone` text;
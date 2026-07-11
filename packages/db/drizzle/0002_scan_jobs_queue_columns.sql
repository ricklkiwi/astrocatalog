PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_scan_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`watch_folder_id` text,
	`job_type` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`files_seen` integer DEFAULT 0 NOT NULL,
	`files_added` integer DEFAULT 0 NOT NULL,
	`files_updated` integer DEFAULT 0 NOT NULL,
	`payload_json` text,
	`progress_current` integer DEFAULT 0 NOT NULL,
	`progress_total` integer,
	`progress_message` text,
	`priority` integer DEFAULT 0 NOT NULL,
	`worker_id` text,
	`claimed_at` integer,
	`cancel_requested` integer DEFAULT false NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`error` text,
	FOREIGN KEY (`watch_folder_id`) REFERENCES `watch_folders`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "scan_jobs_status_check" CHECK("__new_scan_jobs"."status" IN ('queued', 'running', 'completed', 'failed', 'cancelled'))
);
--> statement-breakpoint
INSERT INTO `__new_scan_jobs`("id", "created_at", "updated_at", "watch_folder_id", "job_type", "status", "files_seen", "files_added", "files_updated", "payload_json", "progress_current", "progress_total", "progress_message", "priority", "worker_id", "claimed_at", "cancel_requested", "started_at", "finished_at", "error") SELECT "id", "created_at", "updated_at", "watch_folder_id", 'scan', "status", "files_seen", "files_added", "files_updated", NULL, 0, NULL, NULL, 0, NULL, NULL, 0, "started_at", "finished_at", "error" FROM `scan_jobs`;--> statement-breakpoint
DROP TABLE `scan_jobs`;--> statement-breakpoint
ALTER TABLE `__new_scan_jobs` RENAME TO `scan_jobs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `scan_jobs_status_priority_created_at_idx` ON `scan_jobs` (`status`,`priority`,`created_at`);
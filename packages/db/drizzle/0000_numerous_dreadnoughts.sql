CREATE TABLE `equipment_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`name` text NOT NULL,
	`telescope` text,
	`camera` text,
	`focal_length` real,
	`aperture` real,
	`pixel_size` real,
	`is_user_confirmed` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`watch_folder_id` text NOT NULL,
	`relative_path` text NOT NULL,
	`filename` text NOT NULL,
	`extension` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`sha256` text,
	`file_mtime` integer,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`status` text NOT NULL,
	`duplicate_of_id` text,
	FOREIGN KEY (`watch_folder_id`) REFERENCES `watch_folders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`duplicate_of_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "files_status_check" CHECK("files"."status" IN ('present', 'missing', 'duplicate'))
);
--> statement-breakpoint
CREATE INDEX `files_sha256_idx` ON `files` (`sha256`);--> statement-breakpoint
CREATE UNIQUE INDEX `files_watch_folder_relative_path_uq` ON `files` (`watch_folder_id`,`relative_path`);--> statement-breakpoint
CREATE TABLE `filters` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`raw_name` text NOT NULL,
	`canonical_name` text,
	`band_type` text
);
--> statement-breakpoint
CREATE TABLE `frames` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`file_id` text NOT NULL,
	`frame_type` text NOT NULL,
	`frame_type_source` text NOT NULL,
	`object_raw` text,
	`target_id` text,
	`filter_raw` text,
	`filter_id` text,
	`exposure_seconds` real,
	`date_obs_utc` integer,
	`telescope_raw` text,
	`camera_raw` text,
	`equipment_profile_id` text,
	`ccd_temp` real,
	`set_temp` real,
	`gain` real,
	`offset` real,
	`binning_x` integer,
	`binning_y` integer,
	`width_px` integer,
	`height_px` integer,
	`ra_deg` real,
	`dec_deg` real,
	`focal_length` real,
	`aperture` real,
	`pier_side` text,
	`airmass` real,
	`observer` text,
	`site_name` text,
	`bayer_pattern` text,
	`fwhm` real,
	`hfr` real,
	`star_count` integer,
	`session_id` text,
	`headers_json` text NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_id`) REFERENCES `targets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`filter_id`) REFERENCES `filters`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`equipment_profile_id`) REFERENCES `equipment_profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "frames_frame_type_check" CHECK("frames"."frame_type" IN ('light', 'dark', 'flat', 'bias', 'darkflat', 'unknown')),
	CONSTRAINT "frames_frame_type_source_check" CHECK("frames"."frame_type_source" IN ('header', 'path_heuristic', 'manual'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `frames_file_id_uq` ON `frames` (`file_id`);--> statement-breakpoint
CREATE INDEX `frames_target_filter_type_idx` ON `frames` (`target_id`,`filter_id`,`frame_type`);--> statement-breakpoint
CREATE INDEX `frames_session_id_idx` ON `frames` (`session_id`);--> statement-breakpoint
CREATE INDEX `frames_date_obs_utc_idx` ON `frames` (`date_obs_utc`);--> statement-breakpoint
CREATE TABLE `master_frame_subs` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`master_frame_id` text NOT NULL,
	`frame_id` text NOT NULL,
	FOREIGN KEY (`master_frame_id`) REFERENCES `master_frames`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`frame_id`) REFERENCES `frames`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `master_frame_subs_master_frame_uq` ON `master_frame_subs` (`master_frame_id`,`frame_id`);--> statement-breakpoint
CREATE TABLE `master_frames` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`file_id` text NOT NULL,
	`master_type` text NOT NULL,
	`camera_raw` text,
	`equipment_profile_id` text,
	`filter_id` text,
	`exposure_seconds` real,
	`ccd_temp` real,
	`gain` real,
	`offset` real,
	`binning_x` integer,
	`binning_y` integer,
	`created_date` integer,
	`sub_count` integer,
	`notes` text,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`equipment_profile_id`) REFERENCES `equipment_profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`filter_id`) REFERENCES `filters`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "master_frames_master_type_check" CHECK("master_frames"."master_type" IN ('dark', 'flat', 'bias', 'darkflat'))
);
--> statement-breakpoint
CREATE TABLE `processed_images` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`project_id` text NOT NULL,
	`file_id` text,
	`format` text,
	`is_final` integer DEFAULT false NOT NULL,
	`published_url` text,
	FOREIGN KEY (`project_id`) REFERENCES `processing_projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `processing_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`target_id` text,
	`name` text NOT NULL,
	`version_label` text,
	`status` text,
	`software` text,
	`notes` text,
	FOREIGN KEY (`target_id`) REFERENCES `targets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `project_inputs` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`project_id` text NOT NULL,
	`input_type` text NOT NULL,
	`frame_id` text,
	`master_frame_id` text,
	FOREIGN KEY (`project_id`) REFERENCES `processing_projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`frame_id`) REFERENCES `frames`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`master_frame_id`) REFERENCES `master_frames`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "project_inputs_exactly_one_check" CHECK(("project_inputs"."input_type" = 'frame' AND "project_inputs"."frame_id" IS NOT NULL AND "project_inputs"."master_frame_id" IS NULL) OR ("project_inputs"."input_type" = 'master_frame' AND "project_inputs"."master_frame_id" IS NOT NULL AND "project_inputs"."frame_id" IS NULL)),
	CONSTRAINT "project_inputs_input_type_check" CHECK("project_inputs"."input_type" IN ('frame', 'master_frame'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_inputs_natural_uq` ON `project_inputs` (`project_id`,`frame_id`,`master_frame_id`);--> statement-breakpoint
CREATE TABLE `scan_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`watch_folder_id` text NOT NULL,
	`status` text NOT NULL,
	`files_seen` integer DEFAULT 0 NOT NULL,
	`files_added` integer DEFAULT 0 NOT NULL,
	`files_updated` integer DEFAULT 0 NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`error` text,
	FOREIGN KEY (`watch_folder_id`) REFERENCES `watch_folders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`session_date` text NOT NULL,
	`started_at_utc` integer,
	`ended_at_utc` integer,
	`equipment_profile_id` text,
	`notes` text,
	`weather_notes` text,
	FOREIGN KEY (`equipment_profile_id`) REFERENCES `equipment_profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `target_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`target_id` text NOT NULL,
	`alias_normalized` text NOT NULL,
	`source` text NOT NULL,
	FOREIGN KEY (`target_id`) REFERENCES `targets`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "target_aliases_source_check" CHECK("target_aliases"."source" IN ('builtin', 'user'))
);
--> statement-breakpoint
CREATE INDEX `target_aliases_alias_normalized_idx` ON `target_aliases` (`alias_normalized`);--> statement-breakpoint
CREATE UNIQUE INDEX `target_aliases_target_alias_uq` ON `target_aliases` (`target_id`,`alias_normalized`);--> statement-breakpoint
CREATE TABLE `targets` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`canonical_name` text NOT NULL,
	`display_name` text,
	`catalog_ids_json` text,
	`ra_deg` real,
	`dec_deg` real,
	`object_type` text,
	`constellation` text,
	`status` text,
	`notes` text,
	`thumbnail_frame_id` text,
	FOREIGN KEY (`thumbnail_frame_id`) REFERENCES `frames`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "targets_status_check" CHECK("targets"."status" IN ('planning', 'capturing', 'ready', 'processed', 'complete'))
);
--> statement-breakpoint
CREATE TABLE `thumbnails` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`frame_id` text NOT NULL,
	`cache_path` text NOT NULL,
	`generated_at` integer NOT NULL,
	FOREIGN KEY (`frame_id`) REFERENCES `frames`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `thumbnails_frame_id_uq` ON `thumbnails` (`frame_id`);--> statement-breakpoint
CREATE TABLE `watch_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`path` text NOT NULL,
	`drive_label` text,
	`is_active` integer DEFAULT true NOT NULL,
	`last_scan_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `watch_folders_path_uq` ON `watch_folders` (`path`);
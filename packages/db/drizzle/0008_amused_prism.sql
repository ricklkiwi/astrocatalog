ALTER TABLE `equipment_profiles` ADD `match_key` text;--> statement-breakpoint
ALTER TABLE `equipment_profiles` ADD `merged_into_id` text REFERENCES equipment_profiles(id);--> statement-breakpoint
CREATE UNIQUE INDEX `equipment_profiles_match_key_uq` ON `equipment_profiles` (`match_key`) WHERE "equipment_profiles"."match_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `frames_equipment_profile_id_idx` ON `frames` (`equipment_profile_id`);
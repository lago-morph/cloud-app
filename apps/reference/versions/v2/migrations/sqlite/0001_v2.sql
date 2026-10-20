ALTER TABLE `children` ADD `rank` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE INDEX `children_parent_id_rank_idx` ON `children` (`parent_id`,`rank`);
--> statement-breakpoint
ALTER TABLE `parents` DROP COLUMN `note`;

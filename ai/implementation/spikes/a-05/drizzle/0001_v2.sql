CREATE TABLE `tag` (
	`id` integer PRIMARY KEY NOT NULL,
	`parent_id` integer,
	`label` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `parent`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `parent` ADD `nickname` text;--> statement-breakpoint
ALTER TABLE `parent` ADD `score` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `parent_name_uq` ON `parent` (`name`);--> statement-breakpoint
CREATE INDEX `child_parent_idx` ON `child` (`parent_id`);--> statement-breakpoint
ALTER TABLE `child` DROP COLUMN `legacy`;
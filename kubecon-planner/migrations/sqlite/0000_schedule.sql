CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`sessionize_id` text NOT NULL,
	`source` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`day` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`room` text NOT NULL,
	`track` text NOT NULL,
	`format` text,
	`events` text NOT NULL,
	`speakers` text NOT NULL,
	`speaker_text` text NOT NULL,
	`fingerprint` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_sessionize_id_unique` ON `sessions` (`sessionize_id`);
--> statement-breakpoint
CREATE INDEX `sessions_day_starts_at_idx` ON `sessions` (`day`,`starts_at`);
--> statement-breakpoint
CREATE TABLE `selections` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`sessionize_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `selections_owner_id_sessionize_id_unique` ON `selections` (`owner_id`,`sessionize_id`);

CREATE TABLE `child` (
	`id` integer PRIMARY KEY NOT NULL,
	`parent_id` integer NOT NULL,
	`legacy` text,
	FOREIGN KEY (`parent_id`) REFERENCES `parent`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `parent` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);

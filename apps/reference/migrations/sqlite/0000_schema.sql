CREATE TABLE `authors` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `authors_name_unique` ON `authors` (`name`);
--> statement-breakpoint
CREATE TABLE `posts` (
	`id` text PRIMARY KEY NOT NULL,
	`author_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`votes` integer DEFAULT 0 NOT NULL,
	`score` real DEFAULT 0 NOT NULL,
	`done` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`rating` integer,
	`weight` real,
	`flag` integer,
	`seen_at` integer,
	FOREIGN KEY (`author_id`) REFERENCES `authors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `posts_author_id_created_at_idx` ON `posts` (`author_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text NOT NULL,
	`label` text NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `tags_label_idx` ON `tags` (`label`);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_post_id_label_unique` ON `tags` (`post_id`,`label`);
--> statement-breakpoint
CREATE TABLE `blobs` (
	`id` text PRIMARY KEY NOT NULL,
	`body` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `parents` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `children` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text NOT NULL,
	`label` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `parents`(`id`) ON UPDATE no action ON DELETE no action
);

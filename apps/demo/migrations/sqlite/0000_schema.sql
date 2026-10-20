CREATE TABLE `posts` (
	`id` text PRIMARY KEY NOT NULL,
	`author_id` text NOT NULL,
	`author_name` text,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `posts_status_created_at_idx` ON `posts` (`status`,`created_at`);
--> statement-breakpoint
CREATE INDEX `posts_author_id_created_at_idx` ON `posts` (`author_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `photos` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text NOT NULL,
	`size` real NOT NULL,
	`content_type` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `photos_post_id_created_at_idx` ON `photos` (`post_id`,`created_at`);

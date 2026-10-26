CREATE TABLE `__framework_test_mail` (
	`id` text PRIMARY KEY NOT NULL,
	`recipient` text NOT NULL,
	`sender` text NOT NULL,
	`subject` text NOT NULL,
	`text_body` text NOT NULL,
	`html_body` text NOT NULL,
	`sent_at` text NOT NULL
);

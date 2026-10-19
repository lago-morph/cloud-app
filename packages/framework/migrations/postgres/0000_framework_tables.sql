CREATE TABLE "__framework_kv" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "__framework_migrations" (
	"id" text PRIMARY KEY NOT NULL,
	"dialect" text NOT NULL,
	"checksum" text NOT NULL,
	"applied_at" bigint NOT NULL
);

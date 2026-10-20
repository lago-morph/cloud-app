CREATE TABLE "posts" (
	"id" text PRIMARY KEY NOT NULL,
	"author_id" text NOT NULL,
	"author_name" text,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"status" text NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "photos" (
	"id" text PRIMARY KEY NOT NULL,
	"post_id" text NOT NULL,
	"name" text NOT NULL,
	"size" double precision NOT NULL,
	"content_type" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "posts_status_created_at_idx" ON "posts" USING btree ("status","created_at");
--> statement-breakpoint
CREATE INDEX "posts_author_id_created_at_idx" ON "posts" USING btree ("author_id","created_at");
--> statement-breakpoint
CREATE INDEX "photos_post_id_created_at_idx" ON "photos" USING btree ("post_id","created_at");

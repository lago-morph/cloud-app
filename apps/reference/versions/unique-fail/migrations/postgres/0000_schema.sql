CREATE TABLE "authors" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "authors_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" text PRIMARY KEY NOT NULL,
	"author_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"votes" integer DEFAULT 0 NOT NULL,
	"score" double precision DEFAULT 0 NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"created_at" bigint NOT NULL,
	"rating" integer,
	"weight" double precision,
	"flag" boolean,
	"seen_at" bigint
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" text PRIMARY KEY NOT NULL,
	"post_id" text NOT NULL,
	"label" text NOT NULL,
	CONSTRAINT "tags_post_id_label_unique" UNIQUE("post_id","label")
);
--> statement-breakpoint
CREATE TABLE "blobs" (
	"id" text PRIMARY KEY NOT NULL,
	"body" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parents" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"note" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "children" (
	"id" text PRIMARY KEY NOT NULL,
	"parent_id" text NOT NULL,
	"label" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_author_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."authors"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "children" ADD CONSTRAINT "children_parent_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."parents"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "posts_author_id_created_at_idx" ON "posts" USING btree ("author_id","created_at");
--> statement-breakpoint
CREATE INDEX "tags_label_idx" ON "tags" USING btree ("label");

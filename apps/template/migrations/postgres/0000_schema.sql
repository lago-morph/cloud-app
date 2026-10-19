CREATE TABLE "notes" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"text" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "notes_owner_id_created_at_idx" ON "notes" USING btree ("owner_id","created_at");

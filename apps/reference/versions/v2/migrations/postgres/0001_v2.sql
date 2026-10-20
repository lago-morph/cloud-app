ALTER TABLE "children" ADD COLUMN "rank" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE INDEX "children_parent_id_rank_idx" ON "children" USING btree ("parent_id","rank");
--> statement-breakpoint
ALTER TABLE "parents" DROP COLUMN "note";

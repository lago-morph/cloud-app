// Same logical table for both dialects (SQL §2.1 shape: text id, text, integer, nullable).
import { sqliteTable, text as sText, integer as sInt } from "drizzle-orm/sqlite-core";
import { pgTable, text as pText, integer as pInt } from "drizzle-orm/pg-core";

export const notesSqlite = sqliteTable("notes", {
  id: sText("id").primaryKey(),
  title: sText("title").notNull(),
  rank: sInt("rank").notNull(),
  body: sText("body"),
});

export const notesPg = pgTable("notes", {
  id: pText("id").primaryKey(),
  title: pText("title").notNull(),
  rank: pInt("rank").notNull(),
  body: pText("body"),
});

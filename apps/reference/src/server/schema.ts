import { boolean, defineTable, id, integer, number, ref, text, timestamp } from "@lago-morph/prototype-framework";

/** Case tables (C-T2's shared SQL case sets): every column type, nullable and defaulted columns, references, uniques. */
export const authors = defineTable("authors", {
  id: id(),
  name: text().unique(),
});

export const posts = defineTable(
  "posts",
  {
    id: id(),
    authorId: ref(() => authors.id),
    title: text(),
    body: text().nullable(),
    votes: integer().default(0),
    score: number().default(0),
    done: boolean().default(false),
    createdAt: timestamp(),
    rating: integer().nullable(),
    weight: number().nullable(),
    flag: boolean().nullable(),
    seenAt: timestamp().nullable(),
  },
  { indexes: [["authorId", "createdAt"]] },
);

export const tags = defineTable(
  "tags",
  {
    id: id(),
    postId: ref(() => posts.id),
    label: text(),
  },
  { uniques: [["postId", "label"]], indexes: [["label"]] },
);

/** One oversized row at a time, for the `SQL.RESULT_TOO_LARGE` error route. */
export const blobs = defineTable("blobs", {
  id: id(),
  body: text(),
});

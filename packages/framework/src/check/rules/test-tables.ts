/** A schema module shared by the rule unit tests' temp apps (`src/server/tables.ts`). */
export const TABLES = `import { boolean, defineTable, id, integer, number, ref, text, timestamp } from "@lago-morph/prototype-framework";

export const authors = defineTable("authors", { id: id(), name: text().unique() });
export const posts = defineTable("posts", {
  id: id(),
  authorId: ref(() => authors.id),
  title: text(),
  body: text().nullable(),
  votes: integer().default(0),
  score: number().default(0),
  done: boolean().default(false),
  createdAt: timestamp(),
});
`;

/** The header most query fixtures start with. */
export const QUERY_HEADER = `import type { PortableDb } from "@lago-morph/prototype-framework";\nimport { authors, posts } from "./tables";\n`;

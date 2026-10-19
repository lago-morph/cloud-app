/**
 * Tables used by the SQL query, value, atomic and failure suites (B-T2).
 *
 * The framework module is passed in rather than imported, so the same definitions are
 * used by the in-process test (framework sources, dialect selected per process) and by the
 * scratch app whose `src/app.ts` the CLI loads to generate the migrations that
 * `createTestApp` applies (framework package). The only import here is type-only.
 */
import type * as Fw from "../../../../src/index.js";

export type SchemaApi = Pick<typeof Fw, "defineTable" | "id" | "text" | "integer" | "number" | "timestamp" | "boolean" | "ref">;

export function defineSuiteSchema(fw: SchemaApi) {
  const authors = fw.defineTable("authors", {
    id: fw.id(),
    name: fw.text().unique(),
    country: fw.text().nullable(),
  });
  const posts = fw.defineTable(
    "posts",
    {
      id: fw.id(),
      authorId: fw.ref(() => authors.id),
      title: fw.text(),
      body: fw.text().nullable(),
      score: fw.integer().nullable(),
      rating: fw.number().nullable(),
      publishedAt: fw.timestamp().nullable(),
      draft: fw.boolean(),
      views: fw.integer().default(0),
    },
    { indexes: [["authorId", "publishedAt"]] },
  );
  /** Join table: `id()` plus a `uniques` entry over its two reference columns (sql.md §2.3). */
  const favourites = fw.defineTable(
    "favourites",
    { id: fw.id(), authorId: fw.ref(() => authors.id), postId: fw.ref(() => posts.id) },
    { uniques: [["authorId", "postId"]] },
  );
  /** One nullable column per portable type, for boundary values (SQL-AC-004). */
  const samples = fw.defineTable("samples", {
    id: fw.id(),
    label: fw.text().unique(),
    intValue: fw.integer().nullable(),
    numValue: fw.number().nullable(),
    tsValue: fw.timestamp().nullable(),
    boolValue: fw.boolean().nullable(),
    textValue: fw.text().nullable(),
    authorId: fw.ref(() => authors.id).nullable(),
    required: fw.integer().default(1),
  });
  /** Text payloads for the result-size limit (SQL-AC-006). */
  const blobs = fw.defineTable("blobs", { id: fw.id(), body: fw.text() });
  return { authors, posts, favourites, samples, blobs };
}

export type SuiteSchema = ReturnType<typeof defineSuiteSchema>;

export const SUITE_APP_NAME = "sqlsuite";

/** `src/app.ts` of the scratch app (loaded by the CLI); `./schema.ts` is a copy of this file. */
export const SCRATCH_APP_SOURCE = `import * as fw from "@lago-morph/prototype-framework";
import { defineSuiteSchema } from "./schema.ts";

export const app = fw.defineApp({
  name: "${SUITE_APP_NAME}",
  config: {},
  secrets: [],
  tables: defineSuiteSchema(fw),
  routes: () => {},
});
export default app;
`;

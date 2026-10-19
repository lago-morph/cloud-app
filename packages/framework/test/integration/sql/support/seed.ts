/**
 * Seed data for the SQL suites. Imports the framework (via suite-app), suites only.
 *
 * Text values cover upper/lower case, accented letters, `%`, `_`, `\` and NULL; numbers
 * cover negatives, ties and NULL, so orderings and filters have one right answer that
 * differs from UTF-16, locale or LIKE semantics.
 */
import type { TestApp } from "../../../../src/testing/index.js";
import { run } from "./probe.js";
import { tables, uuid } from "./suite-app.js";

export const A1 = uuid(1); // Ada, UK
export const A2 = uuid(2); // Émile, no country
export const A3 = uuid(3); // bob, US
export const A4 = uuid(4); // Zoë, FR, no posts
export const P1 = uuid(11);
export const P2 = uuid(12);
export const P3 = uuid(13);
export const P4 = uuid(14);
export const P5 = uuid(15);

export const AUTHORS = [
  { id: A1, name: "Ada", country: "UK" },
  { id: A2, name: "Émile", country: null },
  { id: A3, name: "bob", country: "US" },
  { id: A4, name: "Zoë", country: "FR" },
] as const;

export const POSTS = [
  { id: P1, authorId: A1, title: "Alpha", body: "Hello World", score: 10, rating: 1.5, publishedAt: 1000, draft: false },
  { id: P2, authorId: A1, title: "beta", body: null, score: null, rating: null, publishedAt: null, draft: true },
  { id: P3, authorId: A2, title: "Émile's note", body: "100% sure_thing", score: -5, rating: 2.25, publishedAt: 3000, draft: false },
  { id: P4, authorId: A3, title: "Zed", body: "back\\slash", score: 7, rating: null, publishedAt: 2000, draft: false },
  { id: P5, authorId: A3, title: "apple", body: "ÀPPLE and apple", score: 10, rating: 0.25, publishedAt: 500, draft: true },
] as const;

export async function seed(app: TestApp): Promise<void> {
  await run(app, async ({ sql }) => {
    await sql.insert(tables.authors).values(AUTHORS.map((a) => ({ ...a })));
    await sql.insert(tables.posts).values(POSTS.map((p) => ({ ...p })));
  });
}

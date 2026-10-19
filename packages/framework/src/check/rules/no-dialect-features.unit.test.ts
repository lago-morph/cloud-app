import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCheckApp, forFile, rulesFor, type CheckApp } from "../harness.js";
import type { CheckDiagnostic } from "../engine.js";
import { QUERY_HEADER, TABLES } from "./test-tables.js";

const FW = "@lago-morph/prototype-framework";
const q = (body: string, imports = ""): string => `${imports}${QUERY_HEADER}export const query = (db: PortableDb) => ${body};\n`;

const FILES: Record<string, string> = {
  "src/server/tables.ts": TABLES,
  "src/server/like.ts": q(`db.select().from(posts).where(like(posts.title, "%a%"))`, `import { like } from "drizzle-orm";\n`),
  "src/server/not-like.ts": q(`db.select().from(posts).where(notLike(posts.title, "%a%"))`, `import { notLike } from "drizzle-orm";\n`),
  "src/server/ilike-alias.ts": q(`db.select().from(posts).where(fuzzy(posts.title, "%a%"))`, `import { ilike as fuzzy } from "drizzle-orm";\n`),
  "src/server/like-namespace.ts": q(`db.select().from(posts).where(d.like(posts.title, "%a%"))`, `import * as d from "drizzle-orm";\n`),
  "src/server/like-reexport.ts": `export { like as matches } from "drizzle-orm";\n`,
  "src/server/like-reexport-user.ts": q(`db.select().from(posts).where(matches(posts.title, "%a%"))`, `import { matches } from "./like-reexport";\n`),
  "src/server/exists.ts": q(`db.select().from(authors).where(exists(db.select().from(posts).where(eq(posts.authorId, authors.id))))`, `import { exists } from "drizzle-orm";\nimport { eq } from "${FW}";\n`),
  "src/server/drizzle-sum.ts": q(`db.select({ s: sum(posts.votes) }).from(posts)`, `import { sum } from "drizzle-orm";\n`),
  "src/server/right-join.ts": q(`db.select().from(posts).rightJoin(authors, eq(posts.authorId, authors.id))`, `import { eq } from "${FW}";\n`),
  "src/server/full-join.ts": q(`db.select().from(posts).fullJoin(authors, eq(posts.authorId, authors.id))`, `import { eq } from "${FW}";\n`),
  "src/server/subquery-right-join.ts": q(`db.select().from(db.select({ id: posts.id }).from(posts).rightJoin(authors, eq(posts.authorId, authors.id)).as("sq"))`, `import { eq } from "${FW}";\n`),
  "src/server/union.ts": q(`db.select({ id: posts.id }).from(posts).union(db.select({ id: authors.id }).from(authors))`),
  "src/server/for-update.ts": q(`db.select().from(posts).for("update")`),
  "src/server/max-boolean.ts": q(`db.select({ m: max(posts.done) }).from(posts)`, `import { max } from "${FW}";\n`),
  "src/server/min-boolean.ts": q(`db.select({ m: min(posts.done) }).from(posts)`, `import { min } from "${FW}";\n`),
  "src/server/sum-text.ts": q(`db.select({ s: sum(posts.title) }).from(posts)`, `import { sum } from "${FW}";\n`),
  "src/server/avg-text.ts": q(`db.select({ a: avg(posts.title) }).from(posts)`, `import { avg } from "${FW}";\n`),
  "src/server/sum-timestamp.ts": q(`db.select({ s: sum(posts.createdAt) }).from(posts)`, `import { sum } from "${FW}";\n`),
  "src/server/avg-id.ts": q(`db.select({ a: avg(posts.id) }).from(posts)`, `import { avg } from "${FW}";\n`),
  "src/server/cte-max-boolean.ts": `import { max, type PortableDb } from "${FW}";\nimport { posts } from "./tables";\nexport const query = (db: PortableDb) => {\n  const flags = db.$with("flags").as(db.select({ m: max(posts.done) }).from(posts));\n  return db.with(flags).select().from(flags);\n};\n`,
  "src/server/data-modifying-cte.ts": `import { newId, now, type PortableDb } from "${FW}";\nimport { posts } from "./tables";\nexport const query = (db: PortableDb, authorId: string) => {\n  const inserted = db.$with("inserted").as(db.insert(posts).values({ id: newId(), authorId, title: "t", createdAt: now() }).returning({ id: posts.id }));\n  return db.with(inserted).select().from(inserted);\n};\n`,
  "src/server/ok.ts": `import { and, asc, avg, between, containsText, count, countDistinct, eq, gt, inArray, isNull, max, min, not, or, sum, type PortableDb } from "${FW}";\nimport { authors, posts } from "./tables";\nexport async function ok(db: PortableDb) {\n  const recent = db.$with("recent").as(db.select({ id: posts.id }).from(posts).where(gt(posts.createdAt, 0)));\n  const sub = db.select({ id: posts.id }).from(posts).as("sub");\n  return [\n    await db.select({ t: max(posts.title), v: min(posts.votes), c: max(posts.createdAt), s: sum(posts.votes), a: avg(posts.score), n: count(), d: countDistinct(posts.done) }).from(posts),\n    await db.select().from(posts).innerJoin(authors, eq(posts.authorId, authors.id)).leftJoin(sub, eq(sub.id, posts.id)).where(and(or(isNull(posts.body), not(eq(posts.votes, 1))), inArray(posts.id, ["a"]), between(posts.votes, 1, 2), containsText(posts.title, "x"))).orderBy(asc(posts.id)),\n    await db.with(recent).select().from(recent),\n    await db.select({ a: posts.authorId, n: count() }).from(posts).groupBy(posts.authorId).orderBy(asc(posts.authorId)),\n  ];\n}\n`,
};

describe("[CHECK-AC-001][SQL-AC-002] no-dialect-features", () => {
  let app: CheckApp;
  let diagnostics: CheckDiagnostic[];

  beforeAll(async () => {
    app = await createCheckApp(FILES);
    diagnostics = await app.lint();
  }, 120_000);

  afterAll(async () => {
    await app.dispose();
  });

  const rejects: [string, RegExp][] = [
    ["src/server/like.ts", /\blike\b/],
    ["src/server/not-like.ts", /notLike/],
    ["src/server/ilike-alias.ts", /fuzzy.*ilike/],
    ["src/server/like-namespace.ts", /\blike\b/],
    ["src/server/like-reexport.ts", /\blike\b/],
    ["src/server/like-reexport-user.ts", /matches/],
    ["src/server/exists.ts", /exists/],
    ["src/server/drizzle-sum.ts", /\bsum\b/],
    ["src/server/right-join.ts", /rightJoin/],
    ["src/server/full-join.ts", /fullJoin/],
    ["src/server/subquery-right-join.ts", /rightJoin/],
    ["src/server/union.ts", /union/],
    ["src/server/for-update.ts", /\bfor\b/],
    ["src/server/max-boolean.ts", /\bmax\b.*boolean/],
    ["src/server/min-boolean.ts", /\bmin\b.*boolean/],
    ["src/server/sum-text.ts", /\bsum\b.*text/],
    ["src/server/avg-text.ts", /\bavg\b.*text/],
    ["src/server/sum-timestamp.ts", /\bsum\b.*timestamp/],
    ["src/server/avg-id.ts", /\bavg\b.*\bid\b/],
    ["src/server/cte-max-boolean.ts", /\bmax\b/],
    ["src/server/data-modifying-cte.ts", /\$with.*insert|insert.*\$with/],
  ];

  for (const [file, construct] of rejects) {
    it(`rejects ${file}`, () => {
      const found = forFile(diagnostics, file).filter((d) => d.rule === "prototype-framework/no-dialect-features");
      expect(found.length, JSON.stringify(forFile(diagnostics, file))).toBeGreaterThan(0);
      expect(found.some((d) => construct.test(d.message)), JSON.stringify(found)).toBe(true);
    });
  }

  it("accepts every supported feature, incl. aggregates on their allowed column types", () => {
    expect(forFile(diagnostics, "src/server/ok.ts")).toEqual([]);
    expect(rulesFor(diagnostics, "src/server/tables.ts")).toEqual([]);
  });
});

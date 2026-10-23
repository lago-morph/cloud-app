import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCheckApp, forFile, type CheckApp } from "../harness.js";
import type { CheckDiagnostic } from "../engine.js";
import { QUERY_HEADER, TABLES } from "./test-tables.js";

const FW = "@lago-morph/prototype-framework";

const FILES: Record<string, string> = {
  "src/server/tables.ts": TABLES,
  "src/server/transaction.ts": `import { newId } from "${FW}";\n${QUERY_HEADER}export const f = (db: PortableDb) => db.transaction(async (tx) => { await tx.insert(authors).values({ id: newId(), name: "a" }); });\n`,
  "src/server/batch.ts": `import { newId } from "${FW}";\n${QUERY_HEADER}export const f = (db: PortableDb) => db.batch([db.insert(authors).values({ id: newId(), name: "a" })]);\n`,
  "src/server/destructured.ts": `${QUERY_HEADER}export const f = (db: PortableDb) => { const { transaction } = db; return transaction; };\n`,
  "src/server/param-destructured.ts": `${QUERY_HEADER}export const f = ({ batch }: PortableDb) => batch;\n`,
  "src/server/computed.ts": `${QUERY_HEADER}export const f = (db: PortableDb) => db["transaction"];\n`,
  "src/server/write-db.ts": `import { atomic } from "${FW}";\n${QUERY_HEADER}export const f = (db: PortableDb) => atomic(db, [(w) => { void w.transaction; return w.delete(posts); }]);\n`,
  "src/server/query.ts": `${QUERY_HEADER}export const f = (db: PortableDb) => db.query.posts.findMany();\n`,
  "src/server/query-alias.ts": `${QUERY_HEADER}export const f = (db: PortableDb) => { const relational = db.query; return relational.posts.findFirst(); };\n`,
  "src/server/relations.ts": `import { relations } from "drizzle-orm";\nimport { authors, posts } from "./tables";\nexport const r = relations(posts, ({ one }) => ({ author: one(authors) }));\n`,
  "src/server/not-a-db.ts": `const queue = { batch: (n: number): number => n, transaction: 1, query: "q" };\nexport const f = (): number => queue.batch(queue.transaction) + queue.query.length;\n`,
  "src/server/atomic-ok.ts": `import { atomic, newId, eq } from "${FW}";\n${QUERY_HEADER}export const f = (db: PortableDb) => atomic(db, [(w) => w.insert(authors).values({ id: newId(), name: "a" }), (w) => w.delete(posts).where(eq(posts.id, "x"))]);\n`,
};

describe("database handle rules", () => {
  let app: CheckApp;
  let diagnostics: CheckDiagnostic[];

  beforeAll(async () => {
    app = await createCheckApp(FILES);
    diagnostics = await app.lint();
  }, 120_000);

  afterAll(async () => {
    await app.dispose();
  });

  const cases: [string, string, RegExp][] = [
    ["no-transactions", "src/server/transaction.ts", /transaction/],
    ["no-transactions", "src/server/batch.ts", /batch/],
    ["no-transactions", "src/server/destructured.ts", /transaction/],
    ["no-transactions", "src/server/param-destructured.ts", /batch/],
    ["no-transactions", "src/server/computed.ts", /transaction/],
    ["no-transactions", "src/server/write-db.ts", /transaction/],
    ["no-relational-queries", "src/server/query.ts", /query/],
    ["no-relational-queries", "src/server/query-alias.ts", /query/],
    ["no-relational-queries", "src/server/relations.ts", /relations/],
  ];

  for (const [rule, file, construct] of cases) {
    it(`[CHECK-AC-001][SQL-AC-002] ${rule} rejects ${file}`, () => {
      const found = forFile(diagnostics, file).filter((d) => d.rule === `prototype-framework/${rule}`);
      expect(found.length, JSON.stringify(forFile(diagnostics, file))).toBeGreaterThan(0);
      expect(found.some((d) => construct.test(d.message)), JSON.stringify(found)).toBe(true);
    });
  }

  it("[CHECK-AC-001] members of the same names on other objects, and atomic, pass", () => {
    expect(forFile(diagnostics, "src/server/not-a-db.ts")).toEqual([]);
    expect(forFile(diagnostics, "src/server/atomic-ok.ts")).toEqual([]);
  });
});

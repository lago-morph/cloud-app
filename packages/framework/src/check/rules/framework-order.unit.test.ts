import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCheckApp, forFile, rulesFor, type CheckApp } from "../harness.js";
import type { CheckDiagnostic } from "../engine.js";
import { QUERY_HEADER, TABLES } from "./test-tables.js";

const FW = "@lago-morph/prototype-framework";

const FILES: Record<string, string> = {
  "src/server/tables.ts": TABLES,
  "src/server/drizzle-asc.ts": `import { asc } from "drizzle-orm";\n${QUERY_HEADER}export const q = (db: PortableDb) => db.select().from(posts).orderBy(asc(posts.title));\n`,
  "src/server/drizzle-desc-alias.ts": `import { desc as newest } from "drizzle-orm";\n${QUERY_HEADER}export const q = (db: PortableDb) => db.select().from(posts).orderBy(newest(posts.createdAt));\n`,
  "src/server/plain-column.ts": `${QUERY_HEADER}export const q = (db: PortableDb) => db.select().from(posts).orderBy(posts.title);\n`,
  "src/server/callback.ts": `${QUERY_HEADER}export const q = (db: PortableDb) => db.selectDistinct().from(posts).orderBy(posts.title, posts.id);\n`,
  "src/server/reexport.ts": `export { asc as ascending } from "drizzle-orm";\n`,
  "src/server/reexport-user.ts": `import { ascending } from "./reexport";\n${QUERY_HEADER}export const q = (db: PortableDb) => db.select().from(posts).orderBy(ascending(posts.title));\n`,
  "src/server/order.ts": `export { asc as oldestFirst, desc as newestFirst } from "${FW}";\n`,
  "src/server/ok.ts": `import { asc, desc } from "${FW}";\nimport { oldestFirst, newestFirst } from "./order";\n${QUERY_HEADER}export const q = (db: PortableDb) => db.select().from(posts).orderBy(desc(posts.createdAt), asc(posts.id));\nexport const r = (db: PortableDb) => db.select().from(posts).orderBy(newestFirst(posts.createdAt), oldestFirst(posts.id));\n`,
};

describe("[CHECK-AC-001][SQL-AC-002] framework-order", () => {
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
    ["src/server/drizzle-asc.ts", /\basc\b/],
    ["src/server/drizzle-desc-alias.ts", /newest.*\bdesc\b/],
    ["src/server/plain-column.ts", /orderBy.*title|title.*orderBy/],
    ["src/server/callback.ts", /orderBy/],
    ["src/server/reexport.ts", /\basc\b/],
    ["src/server/reexport-user.ts", /ascending/],
  ];

  for (const [file, construct] of rejects) {
    it(`rejects ${file}`, () => {
      const found = forFile(diagnostics, file).filter((d) => d.rule === "prototype-framework/framework-order");
      expect(found.length, JSON.stringify(forFile(diagnostics, file))).toBeGreaterThan(0);
      expect(found.some((d) => construct.test(d.message)), JSON.stringify(found)).toBe(true);
    });
  }

  it("reports a Drizzle asc call once, not again as an orderBy argument", () => {
    expect(forFile(diagnostics, "src/server/drizzle-asc.ts")).toHaveLength(1);
  });

  it("accepts the framework's asc/desc, also re-exported under other names", () => {
    expect(rulesFor(diagnostics, "src/server/ok.ts")).toEqual([]);
    expect(rulesFor(diagnostics, "src/server/order.ts")).toEqual([]);
  });
});

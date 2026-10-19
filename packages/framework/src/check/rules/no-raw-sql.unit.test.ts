import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCheckApp, forFile, rulesFor, type CheckApp } from "../harness.js";
import type { CheckDiagnostic } from "../engine.js";
import { QUERY_HEADER, TABLES } from "./test-tables.js";

const FILES: Record<string, string> = {
  "src/server/tables.ts": TABLES,
  "src/server/template.ts": `import { sql } from "drizzle-orm";\n${QUERY_HEADER}export const q = (db: PortableDb) => db.select({ one: sql<number>\`1\` }).from(posts);\n`,
  "src/server/raw.ts": `import { sql } from "drizzle-orm";\n${QUERY_HEADER}export const q = (db: PortableDb) => db.select().from(posts).where(sql.raw("1 = 1"));\n`,
  "src/server/alias.ts": `import { sql as q } from "drizzle-orm";\n${QUERY_HEADER}export const f = (db: PortableDb) => db.select().from(posts).where(q\`\${posts.votes} > 3\`);\n`,
  "src/server/namespace.ts": `import * as d from "drizzle-orm";\n${QUERY_HEADER}export const f = (db: PortableDb) => db.select().from(posts).where(d.sql\`1 = 1\`);\n`,
  "src/server/reexport.ts": `export { sql as fragment } from "drizzle-orm";\n`,
  "src/server/reexport-user.ts": `import { fragment } from "./reexport";\n${QUERY_HEADER}export const f = (db: PortableDb) => db.select().from(posts).where(fragment\`lower(\${posts.title}) = 'x'\`);\n`,
  "src/server/const-alias.ts": `import { sql } from "drizzle-orm";\nconst raw = sql;\nexport const f = () => raw\`1\`;\n`,
  "src/server/execute.ts": `${QUERY_HEADER}export const f = (db: PortableDb) => db.execute("select 1");\n`,
  "src/server/ok.ts": `import { eq, asc } from "@lago-morph/prototype-framework";\n${QUERY_HEADER}export const f = (db: PortableDb, id: string) => db.select().from(posts).where(eq(posts.id, id)).orderBy(asc(posts.id));\n`,
};

describe("[CHECK-AC-001][SQL-AC-002] no-raw-sql", () => {
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
    ["src/server/template.ts", /\bsql\b/],
    ["src/server/raw.ts", /\bsql\b/],
    ["src/server/alias.ts", /\bq\b.*\bsql\b|\bsql\b/],
    ["src/server/namespace.ts", /\bsql\b/],
    ["src/server/reexport.ts", /\bsql\b/],
    ["src/server/reexport-user.ts", /fragment/],
    ["src/server/const-alias.ts", /\bsql\b/],
    ["src/server/execute.ts", /execute/],
  ];

  for (const [file, construct] of rejects) {
    it(`rejects ${file}`, () => {
      const found = forFile(diagnostics, file).filter((d) => d.rule === "prototype-framework/no-raw-sql");
      expect(found.length, JSON.stringify(forFile(diagnostics, file))).toBeGreaterThan(0);
      expect(found.some((d) => construct.test(d.message)), JSON.stringify(found)).toBe(true);
    });
  }

  it("accepts framework expressions and the schema module", () => {
    expect(rulesFor(diagnostics, "src/server/ok.ts")).toEqual([]);
    expect(rulesFor(diagnostics, "src/server/tables.ts")).toEqual([]);
  });

  it("the diagnostic points to the SQL reference", () => {
    const found = forFile(diagnostics, "src/server/raw.ts");
    expect(found[0]?.reference).toBe("skill/reference/sql-and-migrations.md");
  });
});

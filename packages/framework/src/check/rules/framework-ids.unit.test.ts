import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCheckApp, forFile, type CheckApp } from "../harness.js";
import type { CheckDiagnostic } from "../engine.js";
import { TABLES } from "./test-tables.js";

const FW = "@lago-morph/prototype-framework";
const HEAD = `import { eq, newId, type PortableDb } from "${FW}";\nimport { authors, posts } from "./tables";\n`;

const FILES: Record<string, string> = {
  "src/server/tables.ts": TABLES,
  "src/server/literal.ts": `${HEAD}export const f = (db: PortableDb) => db.insert(authors).values({ id: "fixed-note-id", name: "Ann" });\n`,
  "src/server/random-uuid.ts": `${HEAD}export const f = (db: PortableDb, name: string) => db.insert(authors).values({ id: crypto.randomUUID(), name });\n`,
  "src/server/helper.ts": `${HEAD}const makeId = (): string => \`author-\${Date.now()}\`;\nexport const f = (db: PortableDb, name: string) => db.insert(authors).values({ id: makeId(), name });\n`,
  "src/server/const-literal.ts": `${HEAD}const fixed = "abc";\nexport const f = (db: PortableDb) => db.insert(authors).values([{ id: newId(), name: "a" }, { id: fixed, name: "b" }]);\n`,
  "src/server/update-id.ts": `${HEAD}export const f = (db: PortableDb, id: string) => db.update(authors).set({ id: newId() }).where(eq(authors.id, id));\n`,
  "src/server/upsert-id.ts": `${HEAD}export const f = (db: PortableDb) => db.insert(authors).values({ id: newId(), name: "a" }).onConflictDoUpdate({ target: authors.name, set: { id: newId() } });\n`,
  "src/server/ok.ts": `import { newId as freshId, now, eq, type PortableDb } from "${FW}";\nimport { authors, posts } from "./tables";\nexport async function ok(db: PortableDb, authorId: string, existing: string) {\n  const id = freshId();\n  const other = id;\n  await db.insert(authors).values({ id, name: "a" });\n  await db.insert(authors).values({ id: other, name: "b" });\n  await db.insert(posts).values({ id: freshId(), authorId, title: "t", createdAt: now() });\n  await db.insert(posts).values({ id: existing, authorId: "literal-ref-is-fine", title: "t", createdAt: now() });\n  await db.update(posts).set({ authorId, title: "u" }).where(eq(posts.id, id));\n}\n`,
};

describe("[CHECK-AC-001] framework-ids", () => {
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
    ["src/server/literal.ts", /fixed-note-id.*newId|newId.*fixed-note-id/],
    ["src/server/random-uuid.ts", /randomUUID/],
    ["src/server/helper.ts", /makeId/],
    ["src/server/const-literal.ts", /fixed/],
    ["src/server/update-id.ts", /\bid\b/],
    ["src/server/upsert-id.ts", /\bid\b/],
  ];

  for (const [file, construct] of rejects) {
    it(`rejects ${file}`, () => {
      const found = forFile(diagnostics, file).filter((d) => d.rule === "prototype-framework/framework-ids");
      expect(found.length, JSON.stringify(forFile(diagnostics, file))).toBeGreaterThan(0);
      expect(found.some((d) => construct.test(d.message)), JSON.stringify(found)).toBe(true);
    });
  }

  it("accepts newId() values (directly, aliased, through consts), parameters, and ref values", () => {
    expect(forFile(diagnostics, "src/server/ok.ts")).toEqual([]);
  });
});

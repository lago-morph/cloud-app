/**
 * Applying migrations in place on the real local databases (migrations.md §2 "Local"):
 * local D1 through Wrangler's getPlatformProxy (DEC-0105) and the PGlite harness.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { tag } from "../../../../tests/support/tags.js";
import { id, integer, ref, text } from "../sql/columns.js";
import { openPostgres } from "../sql/drivers.js";
import { defineTable } from "../sql/table.js";
import type { AnyTable } from "../sql/types.js";
import { applyMigrations, d1MigrationDatabase, migrateLocal, MigrationFailedError, pgliteMigrationDatabase, type D1Like, type MigrationDatabase } from "./apply.js";
import { FRAMEWORK_MIGRATIONS_DIR } from "./framework.js";
import { appSchema, generateMigrations } from "./generate.js";
import { readHistory } from "./history.js";

interface Harness {
  db: MigrationDatabase;
  rows(sql: string): Promise<Record<string, unknown>[]>;
  run(sql: string): Promise<void>;
  close(): Promise<void>;
}

async function openD1(): Promise<Harness> {
  const proxy = await getPlatformProxy<{ DB: D1Like }>({ configPath: new URL("./fixtures/wrangler.jsonc", import.meta.url).pathname, persist: false });
  const b = proxy.env.DB;
  return {
    db: d1MigrationDatabase(b),
    rows: async (sql) => (await b.prepare(sql).all<Record<string, unknown>>()).results,
    run: async (sql) => void (await b.prepare(sql).run()),
    close: () => proxy.dispose(),
  };
}

async function openPg(): Promise<Harness> {
  const pg = await openPostgres();
  return {
    db: pgliteMigrationDatabase(pg),
    rows: async (sql) => (await pg.query<Record<string, unknown>>(sql)).rows,
    run: async (sql) => void (await pg.exec(sql)),
    close: () => pg.close(),
  };
}

const parents = defineTable("parents", { id: id(), name: text(), code: text().nullable() });
const children = defineTable("children", { id: id(), parentId: ref(() => parents.id), label: text() });

// Version 2 variants: supported changes only (drop a column of a referenced table, add a
// defaulted column, add a table) and a unique constraint over existing duplicates.
const parentsUnique = defineTable("parents", { id: id(), name: text(), code: text().nullable().unique() });
const parentsNoCode = defineTable("parents", { id: id(), name: text() });
const childrenRank = defineTable("children", { id: id(), parentId: ref(() => parents.id), label: text(), rank: integer().default(0) });
const tags = defineTable("tags", { id: id(), name: text().unique() });

const P1 = "00000000-0000-4000-8000-000000000001";
const P2 = "00000000-0000-4000-8000-000000000002";
const C1 = "00000000-0000-4000-8000-00000000000a";
const C2 = "00000000-0000-4000-8000-00000000000b";
const C3 = "00000000-0000-4000-8000-00000000000c";
const C4 = "00000000-0000-4000-8000-00000000000d";

const dirs: string[] = [];
async function appHistory(...versions: Record<string, AnyTable>[]): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "mig-apply-"));
  dirs.push(root);
  for (const tables of versions) await generateMigrations({ root, schema: appSchema(tables) });
  return root;
}
afterAll(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe.each([
  ["sqlite", openD1],
  ["postgres", openPg],
] as const)("%s", (dialect, open) => {
  let h: Harness;
  beforeEach(async () => {
    h = await open();
  }, 60_000);
  afterEach(async () => {
    await h?.close();
  });

  const histories = (root: string) => ({
    framework: readHistory(FRAMEWORK_MIGRATIONS_DIR, dialect, "framework"),
    app: readHistory(root, dialect, "app"),
  });
  const record = () => h.rows(`SELECT * FROM "__framework_migrations" ORDER BY applied_at, id`);

  it(tag("MIG-AC-002", "a fresh database gets the framework migrations, then the app's, each recorded once in order with its dialect and checksum"), async () => {
    const root = await appHistory({ parents, children });
    const { framework, app } = histories(root);
    const result = await applyMigrations(h.db, histories(root));
    const ids = [...framework, ...app].map((m) => m.id);
    expect(result.applied).toEqual(ids);
    const rows = await record();
    expect(rows.map((r) => r["id"])).toEqual(ids);
    expect(rows.map((r) => r["checksum"])).toEqual([...framework, ...app].map((m) => m.checksum));
    expect(rows.every((r) => r["dialect"] === dialect && Number(r["applied_at"]) > 0)).toBe(true);
    expect(await h.rows(`SELECT * FROM "children"`)).toEqual([]);
    expect(await h.rows(`SELECT * FROM "__framework_kv"`)).toEqual([]);
  });

  it(tag("MIG-AC-002", "a second run with nothing pending applies nothing and changes no data or record"), async () => {
    const root = await appHistory({ parents, children });
    await applyMigrations(h.db, histories(root));
    await h.run(`INSERT INTO "parents" ("id", "name") VALUES ('${P1}', 'one')`);
    const before = { record: await record(), parents: await h.rows(`SELECT * FROM "parents"`) };
    let clockCalls = 0;
    const result = await applyMigrations(h.db, histories(root), () => {
      clockCalls += 1;
      return 1;
    });
    expect(result.applied).toEqual([]);
    expect(clockCalls).toBe(0);
    expect(await record()).toEqual(before.record);
    expect(await h.rows(`SELECT * FROM "parents"`)).toEqual(before.parents);
  });

  it(tag("MIG-AC-003", "local: a data-dependent failing migration (unique over duplicates) fails, leaves the database unchanged, and a re-run after correcting the data succeeds"), async () => {
    const root = await appHistory({ parents, children }, { parents: parentsUnique, children: childrenRank, tags });
    const v1 = { framework: histories(root).framework, app: histories(root).app.slice(0, 1) };
    await applyMigrations(h.db, v1);
    await seed();
    const snapshot = async () => ({
      record: await record(),
      parents: await h.rows(`SELECT * FROM "parents" ORDER BY id`),
      children: await h.rows(`SELECT * FROM "children" ORDER BY id`),
      tables: await tableNames(),
    });
    const before = await snapshot();

    const failing = histories(root);
    const err = await applyMigrations(h.db, failing).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MigrationFailedError);
    expect(err).toMatchObject({ migration: failing.app[1]?.id, applied: [] });
    expect(await snapshot()).toEqual(before);

    await h.run(`UPDATE "parents" SET "code" = 'unique-2' WHERE "id" = '${P2}'`);
    const result = await applyMigrations(h.db, failing);
    expect(result.applied).toEqual([failing.app[1]?.id]);
    expect((await record()).map((r) => r["id"])).toEqual([...failing.framework, ...failing.app].map((m) => m.id));
    expect(await tableNames()).toEqual(expect.arrayContaining(["tags"]));
    expect(await h.rows(`SELECT "id", "rank" FROM "children" ORDER BY id`)).toEqual([
      { id: C1, rank: 0 },
      { id: C2, rank: 0 },
      { id: C3, rank: 0 },
    ]);
  });

  it(tag("MIG-AC-003", "local: supported changes, including a column drop on a table with child rows, preserve every row and reference not dropped"), async () => {
    const root = await appHistory({ parents, children }, { parents: parentsNoCode, children: childrenRank, tags });
    const all = histories(root);
    await applyMigrations(h.db, { framework: all.framework, app: all.app.slice(0, 1) });
    await seed();
    expect((await applyMigrations(h.db, all)).applied).toEqual([all.app[1]?.id]);
    expect(await h.rows(`SELECT * FROM "parents" ORDER BY id`)).toEqual([
      { id: P1, name: "one" },
      { id: P2, name: "two" },
    ]);
    expect(await h.rows(`SELECT "id", "parent_id", "label", "rank" FROM "children" ORDER BY id`)).toEqual([
      { id: C1, parent_id: P1, label: "a", rank: 0 },
      { id: C2, parent_id: P1, label: "b", rank: 0 },
      { id: C3, parent_id: P2, label: "c", rank: 0 },
    ]);
    // References still enforced: a child of a missing parent is refused.
    await expect(h.run(`INSERT INTO "children" ("id", "parent_id", "label") VALUES ('${C4}', '00000000-0000-4000-8000-0000000000ff', 'x')`)).rejects.toThrow();
  });

  it(tag("MIG-AC-002", "migrateLocal reads the package's framework history and the app's migrations directory, framework first"), async () => {
    const root = await appHistory({ parents, children });
    const result = await migrateLocal(h.db, root);
    expect(result.applied).toEqual([...histories(root).framework, ...histories(root).app].map((m) => m.id));
    expect((await migrateLocal(h.db, root)).applied).toEqual([]);
  });

  it("migrateLocal with no app migrations directory applies only the framework history", async () => {
    const result = await migrateLocal(h.db, join(tmpdir(), "mig-apply-does-not-exist"));
    expect(result.applied).toEqual(readHistory(FRAMEWORK_MIGRATIONS_DIR, dialect, "framework").map((m) => m.id));
  });

  async function seed(): Promise<void> {
    await h.run(`INSERT INTO "parents" ("id", "name", "code") VALUES ('${P1}', 'one', 'dup'), ('${P2}', 'two', 'dup')`);
    await h.run(`INSERT INTO "children" ("id", "parent_id", "label") VALUES ('${C1}', '${P1}', 'a'), ('${C2}', '${P1}', 'b'), ('${C3}', '${P2}', 'c')`);
  }

  async function tableNames(): Promise<string[]> {
    const rows = dialect === "sqlite"
      ? await h.rows(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name`)
      : await h.rows(`SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`);
    return rows.map((r) => String(r["name"]));
  }
});

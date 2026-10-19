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
import { id, ref, text } from "../sql/columns.js";
import { openPostgres } from "../sql/drivers.js";
import { defineTable } from "../sql/table.js";
import type { AnyTable } from "../sql/types.js";
import { applyMigrations, d1MigrationDatabase, pgliteMigrationDatabase, type D1Like, type MigrationDatabase } from "./apply.js";
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
});

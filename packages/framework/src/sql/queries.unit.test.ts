/**
 * Queries on the real local databases (B-06): ordering, `containsText`, aggregates, writes,
 * result size, failure mapping and `atomic`, on local D1 (getPlatformProxy, DEC-0105) and the
 * PGlite harness. Each dialect runs the same cases (unit-layer evidence only, DEC-PENDING-B-05-5).
 */
import { generateDrizzleJson, generateMigration, generateSQLiteDrizzleJson, generateSQLiteMigration } from "drizzle-kit/api";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { tag } from "../../../../tests/support/tags.js";
import { boolean, id, integer, number, ref, text } from "./columns.js";
import type { Dialect } from "./dialect.js";
import { openPostgres, postgresDb, sqliteDb } from "./drivers.js";
import { asc, avg, containsText, count, countDistinct, desc, eq, max, min, sum } from "./public.js";
import { defineTable, tableFor } from "./table.js";
import type { AnyTable, PortableDb } from "./types.js";

const parents = defineTable("parents", { id: id(), name: text().unique() });
const things = defineTable("things", {
  id: id(),
  parentId: ref(() => parents.id).nullable(),
  name: text(),
  note: text().nullable(),
  score: integer().nullable(),
  ratio: number().nullable(),
  flag: boolean().default(false),
});
const schema = { parents, things };

/** Fixed, valid UUID v4 IDs so orderings ending in `id` are known. */
const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const [T1, T2, T3, T4] = [uuid(1), uuid(2), uuid(3), uuid(4)];
const [R1, R2] = [uuid(101), uuid(102)];

interface Harness {
  db: PortableDb;
  run(sql: string): Promise<void>;
  close(): Promise<void>;
}

async function ddl(dialect: Dialect): Promise<string[]> {
  const imports = Object.fromEntries(Object.entries(schema).map(([k, t]) => [k, tableFor(t, dialect)]));
  if (dialect === "sqlite") {
    return generateSQLiteMigration(await generateSQLiteDrizzleJson({}), await generateSQLiteDrizzleJson(imports));
  }
  return generateMigration(generateDrizzleJson({}), generateDrizzleJson(imports));
}

type D1Binding = Parameters<typeof sqliteDb>[0] & { prepare(q: string): { run(): Promise<unknown> } };

async function openD1(): Promise<Harness> {
  const proxy = await getPlatformProxy<{ DB: D1Binding }>({
    configPath: new URL("./fixtures/wrangler.jsonc", import.meta.url).pathname,
    persist: false,
  });
  const binding = proxy.env.DB;
  return {
    db: sqliteDb(binding),
    run: async (sql) => void (await binding.prepare(sql).run()),
    close: () => proxy.dispose(),
  };
}

async function openPg(): Promise<Harness> {
  const pg = await openPostgres();
  return {
    db: postgresDb(pg),
    run: async (sql) => void (await pg.exec(sql)),
    close: () => pg.close(),
  };
}

describe.each([
  ["sqlite", openD1],
  ["postgres", openPg],
] as const)("%s", (dialect, open) => {
  let h: Harness;
  const T = <X extends AnyTable>(t: X): X => tableFor(t, dialect) as unknown as X;

  beforeAll(async () => {
    h = await open();
    for (const statement of await ddl(dialect)) await h.run(statement);
  }, 60_000);
  afterAll(async () => {
    await h?.close();
  });

  beforeEach(async () => {
    await h.run("delete from things");
    await h.run("delete from parents");
    await h.db.insert(T(parents)).values([
      { id: R1, name: "first" },
      { id: R2, name: "second" },
    ]);
    await h.db.insert(T(things)).values([
      { id: T1, parentId: R1, name: "Alpha", note: "Hello World", score: 10, ratio: 1.5 },
      { id: T2, parentId: R1, name: "beta", note: null, score: null, ratio: null, flag: true },
      { id: T3, parentId: R2, name: "Émile", note: "100% sure_thing", score: -5, ratio: 2.5 },
      { id: T4, parentId: null, name: "Zed", note: "back\\slash ÀPPLE", score: 7, ratio: null },
    ]);
  });

  describe("ordering", () => {
    it(tag("SQL-AC-003", "asc sorts NULLs first, desc sorts NULLs last"), async () => {
      const t = T(things);
      const up = await h.db.select({ id: t.id }).from(t).orderBy(asc(t.score), asc(t.id));
      expect(up.map((r) => r.id)).toEqual([T2, T3, T4, T1]);
      const down = await h.db.select({ id: t.id }).from(t).orderBy(desc(t.ratio), asc(t.id));
      expect(down.map((r) => r.id)).toEqual([T3, T1, T2, T4]);
    });

    it(tag("SQL-AC-003", "text orders by code point"), async () => {
      const t = T(things);
      const up = await h.db.select({ name: t.name }).from(t).orderBy(asc(t.name));
      expect(up.map((r) => r.name)).toEqual(["Alpha", "Zed", "beta", "Émile"]);
      const down = await h.db.select({ name: t.name }).from(t).orderBy(desc(t.name));
      expect(down.map((r) => r.name)).toEqual(["Émile", "beta", "Zed", "Alpha"]);
    });
  });

  describe("containsText", () => {
    const ids = async (needle: string, column: "note" | "name" = "note"): Promise<string[]> => {
      const t = T(things);
      const rows = await h.db.select({ id: t.id }).from(t).where(containsText(t[column], needle)).orderBy(asc(t.id));
      return rows.map((r) => r.id);
    };

    it(tag("SQL-AC-003", "empty needle matches every non-NULL value; NULL never matches"), async () => {
      expect(await ids("")).toEqual([T1, T3, T4]);
    });

    it(tag("SQL-AC-003", "`%`, `_` and `\\` are literal"), async () => {
      expect(await ids("%")).toEqual([T3]);
      expect(await ids("_")).toEqual([T3]);
      expect(await ids("\\")).toEqual([T4]);
      expect(await ids("0% s")).toEqual([T3]);
      expect(await ids("e_t")).toEqual([T3]);
      expect(await ids("o_")).toEqual([]);
      expect(await ids("%o")).toEqual([]);
    });

    it(tag("SQL-AC-003", "folds case for ASCII A–Z only"), async () => {
      expect(await ids("hello WORLD")).toEqual([T1]);
      expect(await ids("ALPHA", "name")).toEqual([T1]);
      expect(await ids("àpple")).toEqual([]);
      expect(await ids("Àpple")).toEqual([T4]);
      expect(await ids("ÉMILE", "name")).toEqual([T3]);
      expect(await ids("émile", "name")).toEqual([]);
    });
  });

  describe("aggregates", () => {
    it(tag("SQL-AC-003", "count, sum and avg are JS numbers; min/max keep the column type"), async () => {
      const t = T(things);
      const [r] = await h.db
        .select({
          n: count(), scored: count(t.score), distinct: countDistinct(t.parentId),
          sumScore: sum(t.score), avgScore: avg(t.score), sumRatio: sum(t.ratio), avgRatio: avg(t.ratio),
          minScore: min(t.score), maxName: max(t.name),
        })
        .from(t);
      expect(r).toEqual({ n: 4, scored: 3, distinct: 2, sumScore: 12, avgScore: 4, sumRatio: 4, avgRatio: 2, minScore: -5, maxName: "Émile" });
    });

    it(tag("SQL-AC-003", "on empty input count is 0 and every other aggregate is null"), async () => {
      const t = T(things);
      const [r] = await h.db
        .select({ n: count(t.score), s: sum(t.score), a: avg(t.ratio), lo: min(t.score), hi: max(t.name) })
        .from(t)
        .where(eq(t.name, "missing"));
      expect(r).toEqual({ n: 0, s: null, a: null, lo: null, hi: null });
    });
  });

  it("the handle exposes only the PortableDb members (no raw SQL, transactions, batch or relational queries)", () => {
    expect(Object.keys(h.db).sort()).toEqual(["$with", "delete", "insert", "select", "selectDistinct", "update", "with"]);
    for (const member of ["run", "all", "execute", "batch", "transaction", "query", "$client", "values", "get"]) {
      expect((h.db as unknown as Record<string, unknown>)[member], member).toBeUndefined();
    }
  });

  describe("writes", () => {
    it(tag("SQL-AC-003", "insert, update and delete without returning resolve to undefined"), async () => {
      const t = T(things);
      expect(await h.db.insert(t).values({ id: uuid(9), name: "new" })).toBeUndefined();
      expect(await h.db.update(t).set({ score: 1 }).where(eq(t.id, uuid(9)))).toBeUndefined();
      expect(await h.db.delete(t).where(eq(t.id, uuid(9)))).toBeUndefined();
      // The same through execute() and promise chaining.
      expect(await h.db.update(t).set({ score: 2 }).where(eq(t.id, T1)).execute()).toBeUndefined();
      expect(await h.db.delete(t).where(eq(t.id, uuid(9))).then((v) => v)).toBeUndefined();
    });

    it(tag("SQL-AC-003", ".returning({ id }) lists exactly the affected rows"), async () => {
      const t = T(things);
      const updated = await h.db.update(t).set({ score: 0 }).where(eq(t.parentId, R1)).returning({ id: t.id });
      expect(updated.map((r) => r.id).sort()).toEqual([T1, T2]);
      expect(await h.db.delete(t).where(eq(t.name, "missing")).returning({ id: t.id })).toEqual([]);
    });
  });
});

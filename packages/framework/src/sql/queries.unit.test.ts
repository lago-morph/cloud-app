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
import { openPostgres, postgresDb, sqliteDb, type SqlAdapterOptions } from "./drivers.js";
import { asc, atomic, avg, containsText, count, countDistinct, desc, eq, inArray, isNotNull, max, min, sum } from "./public.js";
import { defineTable, tableFor } from "./table.js";
import type { AnyTable, PortableDb, WriteDb } from "./types.js";

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
  /** Another handle over the same database, with adapter options. */
  handle(options: SqlAdapterOptions): PortableDb;
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
    handle: (options) => sqliteDb(binding, options),
    run: async (sql) => void (await binding.prepare(sql).run()),
    close: () => proxy.dispose(),
  };
}

async function openPg(): Promise<Harness> {
  const pg = await openPostgres();
  return {
    db: postgresDb(pg),
    handle: (options) => postgresDb(pg, options),
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

  it(tag("SQL-AC-006", "a result larger than PAR-215 is SQL.RESULT_TOO_LARGE; exactly PAR-215 bytes succeeds"), async () => {
    await h.run("delete from things");
    await h.run("delete from parents");
    const p = T(parents);
    // 63 names of 4096 ASCII bytes and one of 2048 × "é" (4096 UTF-8 bytes): 262144 bytes.
    const names = [...Array.from({ length: 63 }, (_, i) => `${i}`.padEnd(4096, "x")), "é".repeat(2048)];
    for (let i = 0; i < names.length; i += 16) {
      await h.db.insert(p).values(names.slice(i, i + 16).map((name, j) => ({ id: uuid(1000 + i + j), name })));
    }
    expect(await h.db.select({ name: p.name }).from(p)).toHaveLength(64);
    await h.db.insert(p).values({ id: uuid(2000), name: "x" });
    await expect(h.db.select({ name: p.name }).from(p)).rejects.toMatchObject({ name: "FrameworkError", code: "SQL.RESULT_TOO_LARGE" });
    // Non-text values count 8 bytes each: 65 ids are well below the limit.
    expect(await h.db.select({ id: p.id }).from(p)).toHaveLength(65);
  });

  it(tag("SQL-AC-006", "uniqueness and reference violations are SQL.CONFLICT"), async () => {
    const p = T(parents);
    const t = T(things);
    const conflict = { name: "FrameworkError", code: "SQL.CONFLICT" };
    await expect(h.db.insert(p).values({ id: uuid(50), name: "first" })).rejects.toMatchObject(conflict);
    await expect(h.db.insert(p).values({ id: R1, name: "other" })).rejects.toMatchObject(conflict);
    await expect(h.db.update(p).set({ name: "second" }).where(eq(p.id, R1))).rejects.toMatchObject(conflict);
    await expect(h.db.insert(t).values({ id: uuid(51), parentId: uuid(999), name: "orphan" })).rejects.toMatchObject(conflict);
    await expect(h.db.delete(p).where(eq(p.id, R1))).rejects.toMatchObject(conflict);
  });

  it("a database that cannot be reached is SQL.UNAVAILABLE; a forced outage too", async () => {
    const other = await open();
    await other.close();
    const t = T(things);
    const unavailable = { name: "FrameworkError", code: "SQL.UNAVAILABLE" };
    await expect(other.db.select({ id: t.id }).from(t)).rejects.toMatchObject(unavailable);
    const forced = h.handle({ unavailable: true });
    await expect(forced.select({ id: t.id }).from(t)).rejects.toMatchObject(unavailable);
  });

  describe("select forms through the handle", () => {
    it(tag("SQL-AC-003", "subqueries, select-only CTEs, joins and selectDistinct"), async () => {
      const p = T(parents);
      const t = T(things);
      const names = await h.db
        .select({ name: p.name })
        .from(p)
        .where(inArray(p.id, h.db.select({ id: t.parentId }).from(t).where(eq(t.flag, true))))
        .orderBy(asc(p.name));
      expect(names).toEqual([{ name: "first" }]);
      const sq = h.db.select({ id: t.id }).from(t).where(eq(t.flag, false)).as("unflagged");
      expect(await h.db.select({ n: count() }).from(sq)).toEqual([{ n: 3 }]);
      const scored = h.db.$with("scored").as(h.db.select({ id: t.id }).from(t).where(isNotNull(t.score)));
      expect(await h.db.with(scored).select({ n: count() }).from(scored)).toEqual([{ n: 3 }]);
      const joined = await h.db
        .select({ thing: t.name, parent: p.name })
        .from(t)
        .leftJoin(p, eq(t.parentId, p.id))
        .orderBy(asc(t.id));
      expect(joined.map((r) => r.parent)).toEqual(["first", "first", "second", null]);
      const inner = await h.db.select({ id: t.id }).from(t).innerJoin(p, eq(t.parentId, p.id)).where(eq(p.name, "second"));
      expect(inner).toEqual([{ id: T3 }]);
      expect(await h.db.selectDistinct({ parentId: t.parentId }).from(t).orderBy(asc(t.parentId))).toEqual([{ parentId: null }, { parentId: R1 }, { parentId: R2 }]);
    });

    it(tag("SQL-AC-003", "upsert against a declared unique constraint, with returning"), async () => {
      const p = T(parents);
      const updated = await h.db.insert(p).values({ id: uuid(80), name: "first" })
        .onConflictDoUpdate({ target: p.name, set: { name: "first!" } }).returning({ id: p.id });
      expect(updated).toEqual([{ id: R1 }]);
      const skipped = await h.db.insert(p).values({ id: uuid(81), name: "second" }).onConflictDoNothing({ target: p.name }).returning({ id: p.id });
      expect(skipped).toEqual([]);
    });
  });

  describe("atomic", () => {
    const snapshot = async () => {
      const p = T(parents);
      const t = T(things);
      return {
        parents: await h.db.select().from(p).orderBy(asc(p.id)),
        things: await h.db.select().from(t).orderBy(asc(t.id)),
      };
    };

    it(tag("SQL-AC-005", "applies every step and resolves per step to undefined or its RETURNING rows; empty input is a no-op"), async () => {
      const p = T(parents);
      const t = T(things);
      const results = await atomic(h.db, [
        (w) => w.insert(p).values({ id: uuid(60), name: "third" }),
        (w) => w.insert(t).values({ id: uuid(61), parentId: uuid(60), name: "child" }).returning({ id: t.id }),
        (w) => w.update(t).set({ score: 3 }).where(eq(t.parentId, uuid(60))).returning({ id: t.id, score: t.score }),
        (w) => w.delete(t).where(eq(t.id, T4)),
      ] as const);
      expect(results).toEqual([undefined, [{ id: uuid(61) }], [{ id: uuid(61), score: 3 }], undefined]);
      expect((await snapshot()).things.map((r) => r.id)).toEqual([T1, T2, T3, uuid(61)]);
      expect(await atomic(h.db, [] as const)).toEqual([]);
    });

    it(tag("SQL-AC-005", "a last step that violates a constraint leaves no rows from earlier steps"), async () => {
      const p = T(parents);
      const t = T(things);
      const before = await snapshot();
      await expect(
        atomic(h.db, [
          (w) => w.insert(p).values({ id: uuid(62), name: "fourth" }),
          (w) => w.update(t).set({ score: 99 }).where(eq(t.id, T1)),
          (w) => w.insert(p).values({ id: uuid(63), name: "first" }),
        ] as const),
      ).rejects.toMatchObject({ name: "FrameworkError", code: "SQL.CONFLICT" });
      await expect(
        atomic(h.db, [
          (w) => w.insert(p).values({ id: uuid(64), name: "fifth" }),
          (w) => w.update(t).set({ score: 2147483648 }).where(eq(t.id, T1)),
        ] as const),
      ).rejects.toMatchObject({ name: "FrameworkError", code: "SQL.INVALID_VALUE" });
      expect(await snapshot()).toEqual(before);
    });

    it(tag("SQL-AC-005", "a step whose write was built on the outer handle is rejected with CORE.INTERNAL before any step executes"), async () => {
      const p = T(parents);
      const t = T(things);
      const before = await snapshot();
      const internal = { name: "FrameworkError", code: "CORE.INTERNAL" };
      await expect(
        atomic(h.db, [(w) => w.insert(p).values({ id: uuid(65), name: "a" }), () => h.db.insert(p).values({ id: uuid(66), name: "b" })]),
      ).rejects.toMatchObject(internal);
      await expect(
        atomic(h.db, [() => h.db.update(t).set({ score: 1 }).where(eq(t.id, T1)), (w) => w.insert(p).values({ id: uuid(67), name: "c" })]),
      ).rejects.toMatchObject(internal);
      const outer = h.db.delete(t).where(eq(t.id, T1));
      await expect(atomic(h.db, [(w) => w.insert(p).values({ id: uuid(68), name: "d" }), () => outer])).rejects.toMatchObject(internal);
      // A step that is not synchronous, or returns something that is not a write.
      await expect(atomic(h.db, [(async (w: WriteDb) => w.delete(t)) as never])).rejects.toMatchObject(internal);
      expect(await snapshot()).toEqual(before);
    });

    it("fails with SQL.UNAVAILABLE on a forced outage, and with CORE.INTERNAL for a handle the framework did not make", async () => {
      const p = T(parents);
      await expect(atomic(h.handle({ unavailable: true }), [(w) => w.insert(p).values({ id: uuid(69), name: "e" })])).rejects.toMatchObject({ code: "SQL.UNAVAILABLE" });
      await expect(atomic({} as PortableDb, [(w) => w.insert(p).values({ id: uuid(70), name: "f" })])).rejects.toMatchObject({ code: "CORE.INTERNAL" });
    });
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

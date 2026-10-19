/**
 * Column rules and schemas against the real local databases: local D1 (Wrangler's
 * getPlatformProxy, DEC-0105) and the PGlite harness. Each dialect runs the same cases.
 */
import { generateDrizzleJson, generateMigration, generateSQLiteDrizzleJson, generateSQLiteMigration } from "drizzle-kit/api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { tag } from "../../../../tests/support/tags.js";
import { boolean, id, integer, number, ref, text, timestamp } from "./columns.js";
import type { Dialect } from "./dialect.js";
import { openPostgres, postgresDb, sqliteDb } from "./drivers.js";
import { defineTable, tableFor } from "./table.js";
import type { AnyTable, PortableDb } from "./types.js";
import { newId } from "./values.js";

const owners = defineTable("owners", { id: id(), name: text().unique() });
const items = defineTable(
  "items",
  {
    id: id(),
    ownerId: ref(() => owners.id),
    title: text(),
    note: text().nullable(),
    count: integer().default(0),
    ratio: number().nullable(),
    createdAt: timestamp(),
    isDone: boolean().default(false),
  },
  { indexes: [["ownerId", "createdAt"]], uniques: [["ownerId", "title"]] },
);
const schema = { owners, items };

interface Harness {
  db: PortableDb;
  /** Runs one SQL statement directly (test setup and inspection only). */
  run(sql: string): Promise<void>;
  /** Rows of a raw query (inspection only). */
  rows(sql: string): Promise<Record<string, unknown>[]>;
  close(): Promise<void>;
}

async function ddl(dialect: Dialect): Promise<string[]> {
  const imports = Object.fromEntries(Object.entries(schema).map(([k, t]) => [k, tableFor(t, dialect)]));
  if (dialect === "sqlite") {
    return generateSQLiteMigration(await generateSQLiteDrizzleJson({}), await generateSQLiteDrizzleJson(imports));
  }
  return generateMigration(generateDrizzleJson({}), generateDrizzleJson(imports));
}

async function openD1(): Promise<Harness> {
  const proxy = await getPlatformProxy<{ DB: Parameters<typeof sqliteDb>[0] & { prepare(q: string): { run(): Promise<unknown>; all(): Promise<{ results: Record<string, unknown>[] }> } } }>({
    configPath: new URL("./fixtures/wrangler.jsonc", import.meta.url).pathname,
    persist: false,
  });
  const binding = proxy.env.DB;
  return {
    db: sqliteDb(binding),
    run: async (sql) => void (await binding.prepare(sql).run()),
    rows: async (sql) => (await binding.prepare(sql).all()).results,
    close: () => proxy.dispose(),
  };
}

async function openPg(): Promise<Harness> {
  const pg = await openPostgres();
  return {
    db: postgresDb(pg),
    run: async (sql) => void (await pg.exec(sql)),
    rows: async (sql) => (await pg.query<Record<string, unknown>>(sql)).rows,
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

  it(tag("SQL-AC-004", "every column type round-trips in its documented JS type"), async () => {
    const ownerId = newId();
    const itemId = newId();
    await h.db.insert(T(owners)).values({ id: ownerId, name: `o-${ownerId}` });
    await h.db.insert(T(items)).values({
      id: itemId,
      ownerId,
      title: "Ünïcödé 😀",
      note: null,
      ratio: 0.5,
      createdAt: Number.MAX_SAFE_INTEGER,
      isDone: true,
    });
    const rows = await h.db.select().from(T(items)).where(eqId(T(items), itemId));
    expect(rows).toEqual([
      { id: itemId, ownerId, title: "Ünïcödé 😀", note: null, count: 0, ratio: 0.5, createdAt: Number.MAX_SAFE_INTEGER, isDone: true },
    ]);
  });

  describe("boundary values: accepted ones round-trip, rejected ones fail with SQL.INVALID_VALUE before the database", () => {
    let ownerId: string;
    beforeAll(async () => {
      ownerId = newId();
      await h.db.insert(T(owners)).values({ id: ownerId, name: `b-${ownerId}` });
    });
    const base = () => ({ id: newId(), ownerId, title: `t-${newId()}`, createdAt: 0 });

    it.each(acceptedCases)(tag("SQL-AC-004", "accepts %s"), async (_what, patch, expected) => {
      const row = { ...base(), ...patch };
      await h.db.insert(T(items)).values(row as never);
      const [read] = await h.db.select().from(T(items)).where(eqId(T(items), row.id));
      expect(read).toMatchObject(expected ?? patch);
    });

    it.each(rejectedCases)(tag("SQL-AC-004", "rejects %s"), async (_what, patch) => {
      const row = { ...base(), ...patch };
      const before = await countItems();
      let err: unknown;
      try {
        await h.db.insert(T(items)).values(row as never); // as app code does: `await` the builder
      } catch (e) {
        err = e;
      }
      expect(err).toMatchObject({ name: "FrameworkError", code: "SQL.INVALID_VALUE" });
      expect(await countItems()).toBe(before);
    });
  });

  describe("updates and upserts follow the same rules", () => {
    let ownerId: string;
    let itemId: string;
    beforeAll(async () => {
      ownerId = newId();
      itemId = newId();
      await h.db.insert(T(owners)).values({ id: ownerId, name: `u-${ownerId}` });
      await h.db.insert(T(items)).values({ id: itemId, ownerId, title: "keep", createdAt: 5 });
    });

    async function rejected(write: () => PromiseLike<unknown>): Promise<void> {
      let err: unknown;
      try {
        await write();
      } catch (e) {
        err = e;
      }
      expect(err).toMatchObject({ name: "FrameworkError", code: "SQL.INVALID_VALUE" });
      const [row] = await h.db.select().from(T(items)).where(eqId(T(items), itemId));
      expect(row).toMatchObject({ id: itemId, title: "keep", count: 0, createdAt: 5 });
    }

    it(tag("SQL-AC-004", "update rejects a value that breaks the column rule"), async () => {
      await rejected(() => h.db.update(T(items)).set({ count: 2147483648 } as never).where(eqId(T(items), itemId)));
    });
    it(tag("SQL-AC-004", "update rejects null in a NOT NULL column"), async () => {
      await rejected(() => h.db.update(T(items)).set({ title: null } as never).where(eqId(T(items), itemId)));
    });
    it("update rejects a change of the id() column (immutable)", async () => {
      await rejected(() => h.db.update(T(items)).set({ id: newId() } as never).where(eqId(T(items), itemId)));
    });
    it(tag("SQL-AC-004", "an upsert's set is checked like an update"), async () => {
      await rejected(() =>
        h.db
          .insert(T(items))
          .values({ id: itemId, ownerId, title: "keep", createdAt: 5 } as never)
          .onConflictDoUpdate({ target: (T(items) as unknown as { id: never }).id, set: { title: null } as never }),
      );
    });
    it("valid updates and upserts still apply", async () => {
      await h.db.update(T(items)).set({ count: 3 } as never).where(eqId(T(items), itemId));
      await h.db
        .insert(T(items))
        .values({ id: itemId, ownerId, title: "keep", createdAt: 5 } as never)
        .onConflictDoUpdate({ target: (T(items) as unknown as { id: never }).id, set: { note: "upserted" } as never });
      const [row] = await h.db.select().from(T(items)).where(eqId(T(items), itemId));
      expect(row).toMatchObject({ count: 3, note: "upserted" });
      await h.db.update(T(items)).set({ count: 0, note: null } as never).where(eqId(T(items), itemId));
    });
  });

  async function countItems(): Promise<number> {
    const [r] = await h.rows("select count(*) as n from items");
    return Number(r?.["n"]);
  }
});

type Patch = Record<string, unknown>;
const acceptedCases: [string, Patch, Patch?][] = [
  ["integer 2147483647", { count: 2147483647 }],
  ["integer -2147483648", { count: -2147483648 }],
  ["integer -0 (stored as 0)", { count: -0 }, { count: 0 }],
  ["empty text", { title: "" }],
  ["astral-plane text", { title: "\u{1F600}\u{10FFFF}" }],
  ["number 1.7976931348623157e308", { ratio: Number.MAX_VALUE }],
  ["number -0 (stored as 0)", { ratio: -0 }, { ratio: 0 }],
  ["number 2^53 + 2", { ratio: 2 ** 53 + 2 }],
  ["timestamp 0", { createdAt: 0 }],
  ["timestamp Number.MAX_SAFE_INTEGER", { createdAt: Number.MAX_SAFE_INTEGER }],
  ["boolean false", { isDone: false }],
  ["boolean true", { isDone: true }],
  ["null in a nullable column", { note: null, ratio: null }],
];
const rejectedCases: [string, Patch][] = [
  ["integer 2147483648", { count: 2147483648 }],
  ["integer -2147483649", { count: -2147483649 }],
  ["integer 1.5", { count: 1.5 }],
  ["text with an unpaired high surrogate", { title: "a\uD800" }],
  ["text with an unpaired low surrogate", { title: "\uDC00a" }],
  ["text with NUL", { title: "a\u0000b" }],
  ["number NaN", { ratio: Number.NaN }],
  ["number Infinity", { ratio: Infinity }],
  ["timestamp -1", { createdAt: -1 }],
  ["timestamp Number.MAX_SAFE_INTEGER + 1", { createdAt: Number.MAX_SAFE_INTEGER + 1 }],
  ["timestamp 1.5", { createdAt: 1.5 }],
  ["boolean 1", { isDone: 1 }],
  ["id that is not a UUID v4", { id: "not-a-uuid" }],
  ["ref that is not a UUID v4", { ownerId: "not-a-uuid" }],
  ["null in a NOT NULL column", { title: null }],
  ["a NOT NULL column without default left out", { createdAt: undefined }],
  ["a string in an integer column", { count: "1" }],
];

import { eq } from "drizzle-orm";
function eqId(t: AnyTable, value: string) {
  return eq((t as unknown as { id: Parameters<typeof eq>[0] }).id, value);
}

/**
 * The lossless backup reader (DEC-0557) against real SQLite (node:sqlite), behind a minimal
 * `D1Client`: keyset paging over keys holding a NUL, which `quote()` would truncate.
 */
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { D1Client, D1Row } from "./client.js";
import { readLossyTables } from "./lossless.js";

function sqliteClient(db: DatabaseSync): D1Client & { readonly sql: string[] } {
  const sql: string[] = [];
  const unsupported = async (): Promise<never> => {
    throw new Error("not used here");
  };
  return {
    sql,
    create: unsupported,
    list: unsupported,
    delete: unsupported,
    dumpAction: unsupported,
    batch: async (_uuid, statements) =>
      statements.map((s) => {
        sql.push(s.sql);
        return db.prepare(s.sql).all(...((s.params ?? []) as never[])) as D1Row[];
      }),
  };
}

describe("lossless reader on real SQLite (node:sqlite)", () => {
  it("a WITHOUT ROWID table whose text and blob keys hold NULs is paged to the end, every row once, by hex key literals", async () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE "kv" ("ns" text NOT NULL, "b" blob NOT NULL, "v" integer, PRIMARY KEY ("ns", "b")) WITHOUT ROWID`);
    const insert = db.prepare(`INSERT INTO "kv" VALUES (?, ?, ?)`);
    for (const [ns, b] of [["a\u0000x", [1, 0, 2]], ["a\u0000x", [1, 0, 3]], ["a\u0000y", [0]], ["a", [0, 0]], ["b\u0000", [9]]] as const) insert.run(ns, new Uint8Array(b), 1);
    insert.run("z", new Uint8Array([5]), 9007199254740993n);
    const client = sqliteClient(db);
    const lossy = await readLossyTables(client, "db", 2);
    const rows = lossy?.tables[0]?.rows ?? [];
    expect(lossy?.tables.map((t) => t.name)).toEqual(["kv"]);
    expect(rows.map((r) => r[0]?.raw)).toEqual(["61", "610078", "610078", "610079", "6200", "7A"]);
    expect(client.sql.some((s) => s.includes(`> (CAST(X'610078' AS TEXT), X'010002')`))).toBe(true);
  });

  it("a page whose last key does not move forward fails loudly instead of reading forever", async () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE "t" ("k" text PRIMARY KEY, "v" integer) WITHOUT ROWID`);
    db.prepare(`INSERT INTO "t" VALUES (?, ?)`).run("a", 9007199254740993n);
    db.prepare(`INSERT INTO "t" VALUES (?, ?)`).run("b", 1);
    const real = sqliteClient(db);
    // A transport that ignores the keyset condition: every page is the first one.
    const stuck: D1Client = { ...real, batch: (uuid, statements) => real.batch(uuid, statements.map((s) => ({ ...s, sql: s.sql.replace(/ WHERE \(.*?\) > \(.*?\) ORDER BY/, " ORDER BY") }))) };
    await expect(readLossyTables(stuck, "db", 1)).rejects.toThrow(/did not move forward/);
  });
});

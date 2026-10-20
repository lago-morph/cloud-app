import { beforeAll, describe, expect, it } from "vitest";
import { frameworkTables } from "../mig/framework.js";
import { openPostgres, postgresDb } from "./postgres.js";

describe("PGlite harness (PAR-107, DEC-0106)", () => {
  // The first openPostgres() in a process also makes the C/C template (~3 s, more under
  // load); pay it here so each test measures only its own behaviour
  // (ai/implementation/root-causes/2026-10-19-B-05-pglite-harness-test-timeout.md).
  beforeAll(async () => {
    await (await openPostgres()).close();
  }, 60_000);

  it("opens a fresh database created with LC_COLLATE 'C' and LC_CTYPE 'C'", async () => {
    const pg = await openPostgres();
    try {
      const { rows } = await pg.query<{ collate: string; ctype: string; folded: string }>(
        "select datcollate as collate, datctype as ctype, lower('ÀB') as folded from pg_database where datname = current_database()",
      );
      expect(rows).toEqual([{ collate: "C", ctype: "C", folded: "Àb" }]);
    } finally {
      await pg.close();
    }
  });

  // The PGlite loads in the next two tests are the behaviour under test; over 5 s on a loaded machine
  // (ai/implementation/root-causes/2026-10-20-D-04-verify-unrelated-failures.md, Review (a)).
  const PGLITE_LOAD_TIMEOUT_MS = 30_000;

  it("gives every call its own empty database", async () => {
    const a = await openPostgres();
    const b = await openPostgres();
    try {
      await a.exec("create table only_in_a (x integer)");
      const { rows } = await b.query<{ n: number }>("select count(*)::int as n from pg_tables where tablename = 'only_in_a'");
      expect(rows).toEqual([{ n: 0 }]);
    } finally {
      await a.close();
      await b.close();
    }
  }, PGLITE_LOAD_TIMEOUT_MS);

  it("a query on a closed harness database is SQL.UNAVAILABLE (SQL-REQ-006)", async () => {
    const pg = await openPostgres();
    const db = postgresDb(pg) as unknown as { select(): { from(t: unknown): Promise<unknown> } };
    await pg.close();
    await expect(db.select().from(frameworkTables("postgres").kv)).rejects.toMatchObject({ name: "FrameworkError", code: "SQL.UNAVAILABLE" });
  }, PGLITE_LOAD_TIMEOUT_MS);
});

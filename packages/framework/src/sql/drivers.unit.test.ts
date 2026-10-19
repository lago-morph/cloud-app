import { beforeAll, describe, expect, it } from "vitest";
import { openPostgres } from "./drivers.js";

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
  });
});

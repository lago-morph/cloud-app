import { describe, it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePg } from "drizzle-orm/pglite";
import { drizzle as drizzleD1 } from "drizzle-orm/d1";
import { asc, sql } from "drizzle-orm";
import { Miniflare } from "miniflare";
import { getPlatformProxy } from "wrangler";
import { z } from "zod";
import { notesPg, notesSqlite } from "../src/schema";

const rows = [
  { id: "1", title: "b", rank: 1, body: null },
  { id: "2", title: "B", rank: 2, body: "x" },
  { id: "3", title: "a", rank: 3, body: null },
  { id: "4", title: "é", rank: 4, body: null },
];
const codePointOrder = ["B", "a", "b", "é"];

describe("PGlite 0.5.8 + drizzle-orm 0.45.4", () => {
  it("runs a query and orders text by code point (C collation)", async () => {
    const pg = await PGlite.create();
    const ver = await pg.query<{ v: string }>("select version() as v");
    console.log("PG:", ver.rows[0]?.v);
    const coll = await pg.query("select datname, datcollate, datctype, datlocprovider from pg_database where datname = current_database()");
    console.log("DB collation:", JSON.stringify(coll.rows));
    const cAvail = await pg.query("select collname from pg_collation where collname in ('C','POSIX','ucs_basic')");
    console.log("collations:", JSON.stringify(cAvail.rows));
    const db = drizzlePg(pg);
    await db.execute(sql`create table notes (id text primary key, title text not null, rank integer not null, body text)`);
    await db.insert(notesPg).values(rows);
    const out = await db.select().from(notesPg).orderBy(asc(notesPg.title));
    expect(out.map((r) => r.title)).toEqual(codePointOrder);
    const lower = await pg.query<{ l: string }>("select lower('ÀB') as l");
    console.log("lower('ÀB') =", lower.rows[0]?.l);
    await pg.close();
  });

  it("can create a database with C collation from template0 (MIG §2)", async () => {
    const pg = await PGlite.create();
    const r = await pg.query("CREATE DATABASE spikec TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'").then(
      () => "ok",
      (e: unknown) => "error: " + String(e),
    );
    console.log("CREATE DATABASE ... C:", r);
    await pg.close();
  });
});

describe("wrangler getPlatformProxy (D1 + R2) + drizzle d1 driver", () => {
  it("D1 orders text by code point and R2 round-trips", async () => {
    const proxy = await getPlatformProxy<{ DB: unknown; FILES: { put(k: string, v: string): Promise<unknown>; get(k: string): Promise<{ text(): Promise<string> } | null> } }>({
      configPath: "wrangler.jsonc",
      persist: false,
    });
    try {
      const d1 = proxy.env.DB as { prepare(q: string): { run(): Promise<unknown> } };
      await d1.prepare("create table notes (id text primary key not null, title text not null, rank integer not null, body text)").run();
      const db = drizzleD1(proxy.env.DB as never);
      await db.insert(notesSqlite).values(rows);
      const out = await db.select().from(notesSqlite).orderBy(asc(notesSqlite.title));
      expect(out.map((r) => r.title)).toEqual(codePointOrder);
      await proxy.env.FILES.put("k", "v");
      expect(await (await proxy.env.FILES.get("k"))?.text()).toBe("v");
    } finally {
      await proxy.dispose();
    }
  });
});

describe("Miniflare 5 (alpha) direct API", () => {
  it("starts a worker with D1 + R2 via workers[].config.env", async () => {
    const mf = new Miniflare({
      workers: [
        {
          config: {
            name: "w",
            compatibilityDate: "2026-10-01",
            manifest: {
              mainModule: "index.js",
              modules: { "index.js": { type: "esm", contents: "export default { fetch() { return new Response('ok'); } }" } },
            },
            env: { DB: { type: "d1" }, FILES: { type: "r2" } },
          },
        },
      ],
    } as never);
    try {
      expect(await (await mf.dispatchFetch("http://x/")).text()).toBe("ok");
      const d1 = await mf.getD1Database("DB");
      const r = await d1.prepare("select 1 as one").first<{ one: number }>();
      expect(r?.one).toBe(1);
      const r2 = await mf.getR2Bucket("FILES");
      await r2.put("k", "v");
      expect(await (await r2.get("k"))?.text()).toBe("v");
    } finally {
      await mf.dispose();
    }
  });
});

describe("runner features", () => {
  it("fake timers govern Date.now", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    expect(new Date().toISOString()).toBe("2030-01-01T00:00:00.000Z");
    vi.advanceTimersByTime(60_000);
    expect(Date.now()).toBe(Date.parse("2030-01-01T00:01:00Z"));
    vi.useRealTimers();
  });
  it("zod 4 parses", () => {
    expect(z.object({ a: z.number() }).safeParse({ a: "x" }).success).toBe(false);
  });
});

/**
 * KV on `__framework_kv` through the SQL adapters (kv.md §2), on the real local databases:
 * local D1 through Wrangler's getPlatformProxy (DEC-0105) and the PGlite harness, each with the
 * framework migrations applied. Unit evidence only; the integration suite is the criterion's evidence.
 */
import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { tag } from "../../../../tests/support/tags.js";
import { FrameworkError } from "../core/errors.js";
import { d1MigrationDatabase, migrateLocal, pgliteMigrationDatabase, type D1Like } from "../mig/apply.js";
import { sqliteDb, type SqlAdapterOptions } from "../sql/d1.js";
import { openPostgres, postgresDb } from "../sql/postgres.js";
import type { PortableDb } from "../sql/types.js";
import type { KvService } from "./public.js";
import { asKvFailure, createKv } from "./service.js";

const NO_APP_MIGRATIONS = "/nonexistent-kv-unit-test-migrations";

/** 50–61 sequential puts, each a workerd/PGlite round trip; over 5 s on a loaded machine, by design
 * (ai/implementation/root-causes/2026-10-20-D-04-verify-unrelated-failures.md, Review (a)). */
const MANY_PUTS_TIMEOUT_MS = 30_000;

interface Harness {
  /** A SQL handle over the database (options as an adapter would pass them). */
  handle(options?: SqlAdapterOptions): PortableDb;
  /** Rows of `__framework_kv`, by key. */
  rows(): Promise<{ key: string; value: string }[]>;
  close(): Promise<void>;
}

async function openD1(): Promise<Harness> {
  const proxy = await getPlatformProxy<{ DB: D1Like }>({ configPath: new URL("./fixtures/wrangler.jsonc", import.meta.url).pathname, persist: false });
  const binding = proxy.env.DB;
  let closed = false;
  await migrateLocal(d1MigrationDatabase(binding), NO_APP_MIGRATIONS);
  return {
    handle: (options) => sqliteDb(binding as never, options),
    rows: async () => (await binding.prepare(`select key, value from __framework_kv order by key`).all<{ key: string; value: string }>()).results,
    close: async () => {
      if (!closed) await proxy.dispose();
      closed = true;
    },
  };
}

async function openPg(): Promise<Harness> {
  const pg: PGlite = await openPostgres();
  await migrateLocal(pgliteMigrationDatabase(pg), NO_APP_MIGRATIONS);
  return {
    handle: (options) => postgresDb(pg, options),
    rows: async () => (await pg.query<{ key: string; value: string }>(`select key, value from __framework_kv order by key`)).rows,
    close: async () => {
      if (!pg.closed) await pg.close();
    },
  };
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error instanceof FrameworkError ? error.code : `not a FrameworkError: ${String(error)}`;
  }
}

describe.each([
  ["sqlite", openD1],
  ["postgres", openPg],
] as const)("KV on %s", (_dialect, open) => {
  let h: Harness;
  let kv: KvService;

  beforeEach(async () => {
    h = await open();
    kv = createKv(h.handle());
  }, 60_000);
  afterEach(async () => {
    await h?.close();
  });

  it(tag(["KV-AC-001", "KV-AC-004"], "get of an absent key is null; put creates and replaces; put resolves undefined"), async () => {
    expect(await kv.get("greeting")).toBeNull();
    expect(await kv.put("greeting", "hello")).toBeUndefined();
    expect(await kv.get("greeting")).toBe("hello");
    await kv.put("greeting", "bonjour");
    expect(await kv.get("greeting")).toBe("bonjour");
    expect(await kv.get("Greeting")).toBeNull();
    expect(await h.rows()).toEqual([{ key: "greeting", value: "bonjour" }]);
  });

  it(tag(["KV-AC-001", "KV-AC-004"], "delete removes the key; deleting an absent key succeeds"), async () => {
    await kv.put("a", "1");
    await kv.put("b", "2");
    expect(await kv.delete("a")).toBeUndefined();
    expect(await kv.get("a")).toBeNull();
    expect(await kv.delete("a")).toBeUndefined();
    expect(await kv.delete("never-existed")).toBeUndefined();
    expect(await h.rows()).toEqual([{ key: "b", value: "2" }]);
  });

  it(tag(["KV-AC-002", "KV-AC-004"], "invalid keys and values are rejected before the database; an empty value is stored"), async () => {
    await kv.put("kept", "original");
    expect(await codeOf(kv.put("", "v"))).toBe("KV.INVALID_KEY");
    expect(await codeOf(kv.get("\uD800"))).toBe("KV.INVALID_KEY");
    expect(await codeOf(kv.delete("k".repeat(1025)))).toBe("KV.INVALID_KEY");
    expect(await codeOf(kv.put("kept", "v".repeat(4097)))).toBe("KV.VALUE_TOO_LARGE");
    expect(await codeOf(kv.put("kept", "x\uDC00"))).toBe("KV.INVALID_KEY");
    expect(await kv.get("kept")).toBe("original");
    await kv.put("empty", "");
    expect(await kv.get("empty")).toBe("");
    await kv.put("😀".repeat(256), "é".repeat(2048));
    expect(await kv.get("😀".repeat(256))).toBe("é".repeat(2048));
  });

  it(tag(["KV-AC-001", "KV-AC-004"], "list matches the prefix literally and case-sensitively, in code point order"), async () => {
    for (const k of ["a%b", "axb", "a_b", "aXb", "AXb", "ab", "a", "b%", "a%c", "k:😀", "k:\uFFFD", "k:é", "q", "q\u{10FFFF}x", "r", "s\u{10FFFF}", "s\u{10FFFF}a", "t"]) await kv.put(k, `v:${k}`);
    const keys = async (prefix: string) => (await kv.list(prefix)).items.map((i) => i.key);
    expect(await kv.list("a%")).toEqual({ items: [{ key: "a%b", value: "v:a%b" }, { key: "a%c", value: "v:a%c" }], nextCursor: null });
    expect(await keys("a_")).toEqual(["a_b"]);
    expect(await keys("%")).toEqual([]);
    expect(await keys("A")).toEqual(["AXb"]);
    expect(await keys("a")).toEqual(["a", "a%b", "a%c", "aXb", "a_b", "ab", "axb"]);
    expect(await keys("k:")).toEqual(["k:é", "k:\uFFFD", "k:😀"]);
    expect(await keys("q")).toEqual(["q", "q\u{10FFFF}x"]);
    expect(await keys("s\u{10FFFF}")).toEqual(["s\u{10FFFF}", "s\u{10FFFF}a"]);
    expect(await keys("zz")).toEqual([]);
    expect(await codeOf(kv.list("\uD800"))).toBe("KV.INVALID_KEY");
  });

  it(tag(["KV-AC-003", "KV-AC-004"], "listing 2.5 pages returns each key once, PAR-221 per page by default; a full last page has a null cursor"), async () => {
    const keys = Array.from({ length: 50 }, (_, i) => `page/${String(i).padStart(2, "0")}`);
    for (const k of [...keys].reverse()) await kv.put(k, k);
    await kv.put("pagf", "noise");
    const seen: string[] = [];
    const sizes: number[] = [];
    let cursor: string | undefined;
    do {
      const page = await kv.list("page/", cursor === undefined ? {} : { cursor });
      sizes.push(page.items.length);
      seen.push(...page.items.map((i) => i.key));
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
    expect(sizes).toEqual([20, 20, 10]);
    expect(seen).toEqual(keys);
    const exact = await kv.list("page/", { limit: 50 });
    expect(exact.items).toHaveLength(50);
    expect(exact.nextCursor).toBeNull();
  }, MANY_PUTS_TIMEOUT_MS);

  it(tag(["KV-AC-003", "KV-AC-004"], "a cursor is valid only for its prefix"), async () => {
    for (let i = 0; i < 3; i++) await kv.put(`one/${i}`, "x");
    const first = await kv.list("one/", { limit: 1 });
    const cursor = first.nextCursor ?? "";
    expect(await codeOf(kv.list("one", { cursor }))).toBe("KV.INVALID_CURSOR");
    expect(await codeOf(kv.list("one/", { cursor: `${cursor}x` }))).toBe("KV.INVALID_CURSOR");
    expect((await kv.list("one/", { cursor })).items.map((i) => i.key)).toEqual(["one/1", "one/2"]);
  });

  it("limit above PAR-222 is clamped to PAR-222, below 1 to 1; a non-finite limit means the default", async () => {
    for (let i = 0; i < 60; i++) await kv.put(`n/${String(i).padStart(2, "0")}`, "x");
    expect((await kv.list("n/", { limit: 1000 })).items).toHaveLength(50);
    expect((await kv.list("n/", { limit: 0 })).items).toHaveLength(1);
    expect((await kv.list("n/", { limit: 2.7 })).items).toHaveLength(2);
    expect((await kv.list("n/", { limit: Number.NaN })).items).toHaveLength(20);
  }, MANY_PUTS_TIMEOUT_MS);

  it(tag(["KV-AC-005", "KV-AC-004"], "a maximum page of maximum-size entries lists successfully"), async () => {
    const keys = Array.from({ length: 50 }, (_, i) => `max/${String(i).padStart(2, "0")}/`.padEnd(1024, "k"));
    for (const k of keys) await kv.put(k, "v".repeat(4096));
    await kv.put(`max/99/`.padEnd(1024, "k"), "v".repeat(4096)); // the row after the page is fetched too
    const page = await kv.list("max/", { limit: 50 });
    expect(page.items.map((i) => i.key)).toEqual(keys);
    expect(page.nextCursor).not.toBeNull();
  }, MANY_PUTS_TIMEOUT_MS);

  describe("storage that cannot be used", () => {
    const ops: Array<[string, (s: KvService) => Promise<unknown>]> = [
      ["get", (s) => s.get("k")],
      ["put", (s) => s.put("k", "v")],
      ["delete", (s) => s.delete("k")],
      ["list", (s) => s.list("k", { limit: 1 })],
    ];

    it(tag(["KV-AC-005", "KV-AC-004"], "with the SQL handle forced unavailable, every operation fails with KV.UNAVAILABLE, logged once under KV"), async () => {
      const entries: { component: string; severity: string; message: string }[] = [];
      const log = { write: (component: string, severity: string, message: string) => void entries.push({ component, severity, message }) };
      const down = createKv(h.handle({ unavailable: true }), { log: log as never });
      for (const [name, op] of ops) {
        entries.length = 0;
        const thrown = await op(down).then(() => undefined, (e: unknown) => e);
        expect(thrown, name).toBeInstanceOf(FrameworkError);
        expect((thrown as FrameworkError).code, name).toBe("KV.UNAVAILABLE");
        expect(entries.map((e) => [e.component, e.severity]), name).toEqual([["KV", "error"]]);
        expect(entries[0]?.message, name).toContain("KV.UNAVAILABLE");
      }
    });

    it(tag(["KV-AC-005", "KV-AC-004"], "a closed database fails with KV.UNAVAILABLE, not SQL.UNAVAILABLE"), async () => {
      const store = createKv(h.handle());
      await h.close();
      for (const [name, op] of ops) expect(await codeOf(op(store)), name).toBe("KV.UNAVAILABLE");
    });
  });
});

describe("asKvFailure", () => {
  it("maps other SQL codes to CORE.INTERNAL (never surfaced under SQL's codes), unlogged; leaves other errors alone", () => {
    const entries: string[] = [];
    const log = { write: (component: string) => void entries.push(component) };
    for (const code of ["SQL.RESULT_TOO_LARGE", "SQL.CONFLICT", "SQL.INVALID_VALUE"] as const) {
      const mapped = asKvFailure(new FrameworkError(code, "x"), log as never);
      expect(mapped).toBeInstanceOf(FrameworkError);
      expect((mapped as FrameworkError).code).toBe("CORE.INTERNAL");
    }
    expect(entries).toEqual([]);
    const internal = new FrameworkError("CORE.INTERNAL", "y");
    expect(asKvFailure(internal, log as never)).toBe(internal);
    const invalid = new FrameworkError("KV.INVALID_KEY", "z");
    expect(asKvFailure(invalid, log as never)).toBe(invalid);
  });
});

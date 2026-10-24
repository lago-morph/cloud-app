/**
 * KV integration suite (B-T2): KV-AC-001…KV-AC-005, local parts, on local D1 and PGlite.
 *
 * KV is used exactly as app code uses it: `c.var.kv` inside a request of an in-process
 * test app (testing.d.ts, kv.d.ts). Expectations are literals from kv.md (literal,
 * case-sensitive prefixes; code point order; PAR-220…PAR-223 limits), and the suite runs
 * once per dialect process, so passing on both is the local part of KV-AC-004.
 * Imports the framework: load only after the dialect is selected.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { tag } from "../../../../../tests/support/tags.js";
import { defineApp, type KvListPage, type KvService } from "../../../src/index.js";
import { createTestApp, type TestApp } from "../../../src/testing/index.js";
import { DIALECT_LABEL, type Dialect } from "../sql/support/dialect.js";
import { expectCode } from "../sql/support/errors.js";
import { probe, probeRoutes, run } from "../sql/support/probe.js";

const PAR_220 = 1024; // maximum key length, UTF-8 bytes
const PAR_221 = 20; // default page size
const PAR_222 = 50; // maximum page size
const PAR_223 = 4096; // maximum value size, UTF-8 bytes

const kvApp = defineApp({ name: "kvsuite", config: {}, secrets: [], tables: {}, routes: (api) => probeRoutes(api) });

const utf8 = (s: string): number => new TextEncoder().encode(s).length;
const HOOK = 120_000;

export function defineKvSuite(dialect: Dialect): void {
  const on = `(${DIALECT_LABEL[dialect]})`;
  const t = (id: string, title: string): string => tag([id, "KV-AC-004"], `${title} ${on}`);

  describe(`KV ${on}`, () => {
    let app: TestApp;

    beforeEach(async () => {
      app = await createTestApp(kvApp);
    }, HOOK);
    afterEach(async () => {
      await app?.dispose();
    }, HOOK);

    const kv = <T>(fn: (kv: KvService) => Promise<T>) => run(app, async (v) => fn(v.kv));
    const kvOutcome = <T>(fn: (kv: KvService) => Promise<T>) => probe(app, async (v) => fn(v.kv));

    /** Every item under `prefix`, page by page, with the page sizes seen. */
    async function listAll(prefix: string, limit?: number): Promise<{ keys: string[]; values: string[]; sizes: number[] }> {
      const keys: string[] = [];
      const values: string[] = [];
      const sizes: number[] = [];
      let cursor: string | undefined;
      for (let i = 0; i < 1000; i++) {
        const options = { ...(limit === undefined ? {} : { limit }), ...(cursor === undefined ? {} : { cursor }) };
        const page: KvListPage = await kv((s) => s.list(prefix, options));
        sizes.push(page.items.length);
        for (const item of page.items) {
          keys.push(item.key);
          values.push(item.value);
        }
        if (page.nextCursor === null) return { keys, values, sizes };
        cursor = page.nextCursor;
      }
      throw new Error("list never ended");
    }

    // ---- KV-AC-001 -------------------------------------------------------------------

    it(t("KV-AC-001", "put, overwrite, get, missing-key get, delete and repeated delete behave as specified"), async () => {
      expect(await kv((s) => s.get("greeting"))).toBeNull();
      const put = await kvOutcome((s) => s.put("greeting", "hello"));
      expect(put).toEqual({ ok: true, value: undefined });
      expect(await kv((s) => s.get("greeting"))).toBe("hello");
      await kv((s) => s.put("greeting", "bonjour"));
      expect(await kv((s) => s.get("greeting"))).toBe("bonjour");
      expect(await kv((s) => s.get("Greeting"))).toBeNull();
      const del = await kvOutcome((s) => s.delete("greeting"));
      expect(del).toEqual({ ok: true, value: undefined });
      expect(await kv((s) => s.get("greeting"))).toBeNull();
      const again = await kvOutcome((s) => s.delete("greeting"));
      expect(again).toEqual({ ok: true, value: undefined });
      const never = await kvOutcome((s) => s.delete("never-existed"));
      expect(never).toEqual({ ok: true, value: undefined });
      expect(await kv((s) => s.list("greeting"))).toEqual({ items: [], nextCursor: null });
    });

    it(t("KV-AC-001", "list returns exactly the keys that literally match the prefix, including %, _ and mixed case"), async () => {
      const keys = ["a%b", "axb", "a_b", "aXb", "AXb", "ab", "a", "b%", "a%c"];
      for (const k of keys) await kv((s) => s.put(k, `v:${k}`));
      const list = async (prefix: string) => (await listAll(prefix)).keys;
      expect(await list("a%")).toEqual(["a%b", "a%c"]);
      expect(await list("a_")).toEqual(["a_b"]);
      expect(await list("aX")).toEqual(["aXb"]);
      expect(await list("ax")).toEqual(["axb"]);
      expect(await list("A")).toEqual(["AXb"]);
      expect(await list("b%")).toEqual(["b%"]);
      expect(await list("%")).toEqual([]);
      expect(await list("_")).toEqual([]);
      expect(await list("a")).toEqual(["a", "a%b", "a%c", "aXb", "a_b", "ab", "axb"]);
      expect(await list("zz")).toEqual([]);
      const page = await kv((s) => s.list("a%"));
      expect(page).toEqual({ items: [{ key: "a%b", value: "v:a%b" }, { key: "a%c", value: "v:a%c" }], nextCursor: null });
    });

    it(t("KV-AC-001", "list orders keys by code point (not UTF-16), and the prefix's key range is exact"), async () => {
      const keys = ["k:😀", "k:b", "k:\uFFFD", "k:B", "k:é", "k:a"];
      for (const k of keys) await kv((s) => s.put(k, k));
      expect((await listAll("k:")).keys).toEqual(["k:B", "k:a", "k:b", "k:é", "k:\uFFFD", "k:😀"]);
      for (const k of ["q", "q~", "q\u{10FFFF}x", "r", "p\u{10FFFF}"]) await kv((s) => s.put(k, k));
      expect((await listAll("q")).keys).toEqual(["q", "q~", "q\u{10FFFF}x"]);
      for (const k of ["s\u{10FFFF}", "s\u{10FFFF}a", "t", "s"]) await kv((s) => s.put(k, k));
      expect((await listAll("s\u{10FFFF}")).keys).toEqual(["s\u{10FFFF}", "s\u{10FFFF}a"]);
    });

    // ---- KV-AC-002 -------------------------------------------------------------------

    it(t("KV-AC-002", "empty, oversized and malformed keys are rejected with KV.INVALID_KEY; keys of exactly PAR-220 bytes are accepted"), async () => {
      const exact = ["k".repeat(PAR_220), "é".repeat(PAR_220 / 2), "😀".repeat(PAR_220 / 4)];
      for (const key of exact) {
        expect(utf8(key)).toBe(PAR_220);
        await kv((s) => s.put(key, "ok"));
        expect(await kv((s) => s.get(key))).toBe("ok");
        await kv((s) => s.delete(key));
        expect(await kv((s) => s.get(key))).toBeNull();
      }
      const bad = ["", "k".repeat(PAR_220 + 1), `${"é".repeat(PAR_220 / 2)}k`, `${"😀".repeat(PAR_220 / 4)}k`, "\uD800", "a\uDC00", "\uDE00\uD83D"];
      for (const key of bad) {
        expectCode(await kvOutcome((s) => s.put(key, "v")), "KV.INVALID_KEY");
        expectCode(await kvOutcome((s) => s.get(key)), "KV.INVALID_KEY");
        expectCode(await kvOutcome((s) => s.delete(key)), "KV.INVALID_KEY");
      }
      expectCode(await kvOutcome((s) => s.list("\uD800")), "KV.INVALID_KEY");
      expectCode(await kvOutcome((s) => s.list("k".repeat(PAR_220 + 1))), "KV.INVALID_KEY");
      expect(await listAll("k")).toEqual({ keys: [], values: [], sizes: [0] });
    });

    it(t("KV-AC-002", "oversized values are rejected with KV.VALUE_TOO_LARGE, malformed values with KV.INVALID_KEY; values of exactly PAR-223 bytes are accepted"), async () => {
      const exact = ["v".repeat(PAR_223), "é".repeat(PAR_223 / 2), "😀".repeat(PAR_223 / 4)];
      for (const value of exact) {
        expect(utf8(value)).toBe(PAR_223);
        await kv((s) => s.put("exact", value));
        expect(await kv((s) => s.get("exact"))).toBe(value);
      }
      await kv((s) => s.put("kept", "original"));
      for (const value of ["v".repeat(PAR_223 + 1), `${"é".repeat(PAR_223 / 2)}v`, `${"😀".repeat(PAR_223 / 4)}v`]) {
        expectCode(await kvOutcome((s) => s.put("kept", value)), "KV.VALUE_TOO_LARGE");
      }
      for (const value of ["\uD800", "x\uDC00", "\uDE00\uD83D"]) {
        expectCode(await kvOutcome((s) => s.put("kept", value)), "KV.INVALID_KEY");
      }
      expect(await kv((s) => s.get("kept"))).toBe("original");
      // An empty value is well-formed text within the limit (KV-REQ-002), so it is stored, not absent.
      await kv((s) => s.put("empty", ""));
      expect(await kv((s) => s.get("empty"))).toBe("");
    });

    // ---- KV-AC-003 -------------------------------------------------------------------

    it(t("KV-AC-003", "listing 2.5 pages of keys returns each key once, in order, PAR-221 per page by default"), async () => {
      const keys = Array.from({ length: Math.round(PAR_221 * 2.5) }, (_, i) => `page/${String(i).padStart(2, "0")}`);
      for (const k of [...keys].reverse()) await kv((s) => s.put(k, `value ${k}`));
      for (const noise of ["page", "pagd/0", "pagf/0", "Page/0"]) await kv((s) => s.put(noise, "noise"));
      const all = await listAll("page/");
      expect(all.sizes).toEqual([PAR_221, PAR_221, PAR_221 / 2]);
      expect(all.keys).toEqual(keys);
      expect(new Set(all.keys).size).toBe(keys.length);
      expect(all.values).toEqual(keys.map((k) => `value ${k}`));
      const small = await listAll("page/", 7);
      expect(small.keys).toEqual(keys);
      expect(small.sizes.slice(0, -1).every((n) => n === 7)).toBe(true);
    });

    it(t("KV-AC-003", "a cursor used with a different prefix, or a malformed cursor, is rejected with KV.INVALID_CURSOR"), async () => {
      for (let i = 0; i < 5; i++) {
        await kv((s) => s.put(`one/${i}`, "x"));
        await kv((s) => s.put(`two/${i}`, "x"));
      }
      const first = await kv((s) => s.list("one/", { limit: 2 }));
      expect(first.items.map((i) => i.key)).toEqual(["one/0", "one/1"]);
      expect(first.nextCursor).not.toBeNull();
      const cursor = first.nextCursor ?? "";
      expectCode(await kvOutcome((s) => s.list("two/", { cursor })), "KV.INVALID_CURSOR");
      expectCode(await kvOutcome((s) => s.list("one", { cursor })), "KV.INVALID_CURSOR");
      expectCode(await kvOutcome((s) => s.list("one/0", { cursor })), "KV.INVALID_CURSOR");
      expectCode(await kvOutcome((s) => s.list("one/", { cursor: "not-a-cursor" })), "KV.INVALID_CURSOR");
      expectCode(await kvOutcome((s) => s.list("one/", { cursor: `${cursor}x` })), "KV.INVALID_CURSOR");
      // The cursor still works for its own prefix.
      const second = await kv((s) => s.list("one/", { limit: 2, cursor }));
      expect(second.items.map((i) => i.key)).toEqual(["one/2", "one/3"]);
    });

    // ---- KV-AC-005 (every-target part) -----------------------------------------------

    it(t("KV-AC-005", "a maximum page (PAR-222 entries) of maximum-size keys and values lists successfully"), async () => {
      const keys = Array.from({ length: PAR_222 }, (_, i) => {
        const head = `max/${String(i).padStart(2, "0")}/`;
        return head + "k".repeat(PAR_220 - utf8(head));
      });
      const valueOf = (i: number): string => `${String(i).padStart(2, "0")}`.padEnd(PAR_223, "v");
      for (const [i, k] of keys.entries()) {
        expect(utf8(k)).toBe(PAR_220);
        await kv((s) => s.put(k, valueOf(i)));
      }
      const page = await kv((s) => s.list("max/", { limit: PAR_222 }));
      expect(page.items).toHaveLength(PAR_222);
      expect(page.items.map((i) => i.key)).toEqual(keys);
      expect(page.items.map((i) => i.value)).toEqual(keys.map((_, i) => valueOf(i)));
      expect(page.items.every((i) => utf8(i.value) === PAR_223)).toBe(true);
      expect(page.nextCursor).toBeNull();
    });
  });

  describe(`KV with the database unreachable ${on}`, () => {
    let app: TestApp;

    beforeAll(async () => {
      app = await createTestApp(kvApp, { unavailable: ["sql"] });
    }, HOOK);
    afterAll(async () => {
      await app?.dispose();
    }, HOOK);

    it(tag("KV-AC-005", `locally, with the database unreachable, every KV operation fails with KV.UNAVAILABLE ${on}`), async () => {
      const ops: Array<(kv: KvService) => Promise<unknown>> = [
        (s) => s.get("k"),
        (s) => s.put("k", "v"),
        (s) => s.delete("k"),
        (s) => s.list("k"),
        (s) => s.list("k", { limit: 1 }),
      ];
      for (const op of ops) {
        const outcome = await probe(app, async (v) => op(v.kv));
        expectCode(outcome, "KV.UNAVAILABLE");
      }
    });
  });
}

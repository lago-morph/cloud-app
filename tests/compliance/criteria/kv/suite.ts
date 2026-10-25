/**
 * KV-AC-001…-005: one shared suite, the reference app's `kv` case set
 * (`apps/reference/src/server/cases/kv.ts`), with literal expectations from kv.md, kv.d.ts and
 * PAR-220…PAR-223. The same expectations run in-process on local D1 and PGlite and through
 * the reference app on every target, so passing on each is KV-AC-004 ("identical results"):
 * every test here is also tagged KV-AC-004.
 *
 * Keys live under a random namespace and every case deletes what it wrote. Rows per suite run:
 * basics 1, prefixes 14, limits 2, empty value 1, pages 10, max page 50 (PAR-222: the criterion's own size),
 * each written once and deleted once.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tag } from "../../harness/index.js";
import { newNamespace, valueOf, type CaseRunner, type Place } from "../sql/support/runner.js";

const PAR_220 = 1024; // maximum key length, UTF-8 bytes
const PAR_222 = 50; // maximum page size
const PAR_223 = 4096; // maximum value size, UTF-8 bytes

const HOOK_MS = 180_000;
const TEST_MS = 120_000;

export function defineKvSuite(place: Place, makeRunner: () => Promise<CaseRunner>): void {
  const t = (id: string, title: string): string => tag([id, "KV-AC-004"], `${title} (${place})`);

  describe(`KV shared case set (${place})`, () => {
    let runner: CaseRunner;
    const ns = newNamespace();
    const run = (name: string, input: unknown = { ns }) => runner.run("kv", name, input);

    beforeAll(async () => {
      runner = await makeRunner();
    }, HOOK_MS);
    afterAll(async () => {
      await runner?.dispose();
    }, HOOK_MS);

    // ---- KV-AC-001 ------------------------------------------------------------------------

    it(t("KV-AC-001", "put, overwrite, get, missing-key get, delete and repeated delete behave as specified"), async () => {
      expect(valueOf(await run("basics"))).toEqual({
        missing: { ok: null },
        put: { undefined: true },
        afterPut: { ok: "hello" },
        overwrite: { undefined: true },
        afterOverwrite: { ok: "bonjour" },
        otherCase: { ok: null },
        delete: { undefined: true },
        afterDelete: { ok: null },
        deleteAgain: { undefined: true },
        deleteNeverExisted: { undefined: true },
      });
    }, TEST_MS);

    it(t("KV-AC-001", "list returns exactly the keys that literally start with the prefix (%, _, mixed case), in code point order"), async () => {
      const page = (keys: string[]) => ({ keys, valuesMatch: true, nextCursor: null });
      expect(valueOf(await run("prefixes"))).toEqual({
        percent: page(["/p/a%", "/p/a%b", "/p/a%bc"]),
        underscore: page(["/p/a_b"]),
        lowerA: page(["/p/a", "/p/a%", "/p/a%b", "/p/a%bc", "/p/aXb", "/p/a_b", "/p/ab"]),
        upperA: page(["/p/A%b"]),
        percentB: page(["/p/a%b", "/p/a%bc"]),
        all: page(["/p/A%b", "/p/a", "/p/a%", "/p/a%b", "/p/a%bc", "/p/aXb", "/p/a_b", "/p/ab"]),
        // Code point order: U+FFFD before U+1F600 (UTF-16 order would put the astral key first).
        unicode: page(["/u/z", "/u/é", "/u/�", "/u/😀"]),
        noMatch: page([]),
      });
    }, TEST_MS);

    // ---- KV-AC-002 ------------------------------------------------------------------------

    it(t("KV-AC-002", "empty keys, oversized keys and values, and malformed keys and values are rejected with the specified codes; a key of exactly PAR-220 bytes and a value of exactly PAR-223 bytes are accepted"), async () => {
      const invalidKey = "KV.INVALID_KEY";
      expect(valueOf(await run("limits", { ns, keyBytes: PAR_220, valueBytes: PAR_223 }))).toEqual({
        sizes: { exactKey: PAR_220, overKey: PAR_220 + 1, astralOverKey: PAR_220 + 1, astralOverKeyUtf16: PAR_220 - 1, exactValue: PAR_223, overValue: PAR_223 + 1 },
        emptyKey: { put: invalidKey, get: invalidKey, delete: invalidKey },
        overKey: { put: invalidKey, get: invalidKey, delete: invalidKey },
        // Over the limit in UTF-8 bytes although under it in UTF-16 code units.
        astralOverKey: { put: invalidKey },
        malformedKey: { put: invalidKey, get: invalidKey, delete: invalidKey },
        malformedPrefix: invalidKey,
        exactKey: { put: "ok", get: { ok: "at the key limit" }, listed: true },
        exactValue: { put: "ok", roundTrips: true },
        overValue: "KV.VALUE_TOO_LARGE",
        // KV-REQ-002: a malformed value string is rejected with KV.INVALID_KEY.
        malformedValue: invalidKey,
        valueAfterRejections: true,
      });
    }, TEST_MS);

    it(t("KV-AC-002", "an empty value is accepted and read back as \"\""), async () => {
      expect(valueOf(await run("emptyValue"))).toEqual({ put: "ok", get: { ok: "" } });
    }, TEST_MS);

    // ---- KV-AC-003 ------------------------------------------------------------------------

    it(t("KV-AC-003", "listing 2.5 pages of keys returns each key once; a cursor used with a different prefix is rejected"), async () => {
      expect(valueOf(await run("pages", { ns, limit: 4 }))).toEqual({
        sizes: [4, 4, 2],
        seen: ["00=00", "01=01", "02=02", "03=03", "04=04", "05=05", "06=06", "07=07", "08=08", "09=09"],
        otherPrefix: "KV.INVALID_CURSOR",
        narrowerPrefix: "KV.INVALID_CURSOR",
        widerPrefix: "KV.INVALID_CURSOR",
        garbage: "KV.INVALID_CURSOR",
        samePrefixAgain: "ok",
        defaultPage: 10,
      });
    }, TEST_MS);

    // ---- KV-AC-005 ------------------------------------------------------------------------

    it(t("KV-AC-005", "a maximum page (PAR-222) of maximum-size entries (PAR-220-byte keys, PAR-223-byte values) lists successfully"), async () => {
      expect(valueOf(await run("maxPage", { ns, entries: PAR_222, keyBytes: PAR_220, valueBytes: PAR_223 }))).toEqual({
        list: "ok",
        items: PAR_222,
        exact: true,
        keyBytes: PAR_220,
        valueBytes: PAR_223,
        nextCursor: null,
      });
    }, TEST_MS);
  });
}

/** KV-AC-005, local clause: with the database unreachable every KV operation fails with KV.UNAVAILABLE. */
export function defineKvUnavailableSuite(place: Place, makeRunner: (unavailable: readonly ("sql" | "kv")[]) => Promise<CaseRunner>): void {
  describe(`KV with the database unreachable (${place})`, () => {
    for (const unavailable of [["sql"], ["kv"]] as const) {
      it(tag("KV-AC-005", `locally, with the database unreachable (createTestApp unavailable: ${unavailable.join(",")}), put, get, list and delete fail with KV.UNAVAILABLE (${place})`), async () => {
        const runner = await makeRunner(unavailable);
        try {
          const unavailableCode = "KV.UNAVAILABLE";
          expect(valueOf(await runner.run("kv", "operations", { ns: newNamespace() }))).toEqual({ put: unavailableCode, get: unavailableCode, list: unavailableCode, delete: unavailableCode });
        } finally {
          await runner.dispose();
        }
      }, TEST_MS);
    }
  });
}

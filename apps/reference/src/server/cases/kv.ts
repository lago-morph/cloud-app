import { z } from "@lago-morph/prototype-framework";
import type { CaseServices, CaseSet } from "../case-types";
import { codeOf, namespace, outcome, padToBytes, utf8Length } from "./support";

/**
 * KV case set (C-T2): KV-AC-001…-005 as cases that run unchanged in-process (local D1,
 * PGlite) and through `POST /api/cases/run` on every target; KV-AC-004 is the same
 * expectations passing on each of them. Every key lives under `<ns>/`; every case deletes the
 * keys it wrote.
 */

/** KV-AC-001: put, overwrite, get, missing-key get, delete, repeated delete. */
const basics = async ({ kv }: CaseServices, input: unknown): Promise<unknown> => {
  const ns = namespace(input);
  const key = `${ns}/greeting`;
  try {
    return {
      missing: await outcome(() => kv.get(key)),
      put: await outcome(() => kv.put(key, "hello")),
      afterPut: await outcome(() => kv.get(key)),
      overwrite: await outcome(() => kv.put(key, "bonjour")),
      afterOverwrite: await outcome(() => kv.get(key)),
      otherCase: await outcome(() => kv.get(`${ns}/Greeting`)),
      delete: await outcome(() => kv.delete(key)),
      afterDelete: await outcome(() => kv.get(key)),
      deleteAgain: await outcome(() => kv.delete(key)),
      deleteNeverExisted: await outcome(() => kv.delete(`${ns}/never-existed`)),
    };
  } finally {
    await kv.delete(key);
  }
};

/** Key suffixes under `<ns>/p/`: `%`, `_` and mixed case, which a LIKE-based prefix would get wrong. */
const PREFIX_KEYS = ["a%b", "a%bc", "a_b", "aXb", "A%b", "ab", "a%", "a"] as const;
/** Key suffixes under `<ns>/u/`: code point order differs from UTF-16 order for the astral one. */
const UNICODE_KEYS = ["z", "é", "�", "😀"] as const;

/** KV-AC-001: list returns exactly the keys that literally start with the prefix, in code point order. */
const prefixes = async ({ kv }: CaseServices, input: unknown): Promise<unknown> => {
  const ns = namespace(input);
  const written = [...PREFIX_KEYS.map((k) => `${ns}/p/${k}`), ...UNICODE_KEYS.map((k) => `${ns}/u/${k}`), `${ns}/q/a%b`, `${ns}/pa%b`];
  try {
    for (const key of written) await kv.put(key, `v:${key.slice(ns.length)}`);
    const list = async (suffix: string) => {
      const page = await kv.list(`${ns}${suffix}`);
      return {
        keys: page.items.map((i) => i.key.slice(ns.length)),
        valuesMatch: page.items.every((i) => i.value === `v:${i.key.slice(ns.length)}`),
        nextCursor: page.nextCursor,
      };
    };
    return {
      percent: await list("/p/a%"),
      underscore: await list("/p/a_"),
      lowerA: await list("/p/a"),
      upperA: await list("/p/A"),
      percentB: await list("/p/a%b"),
      all: await list("/p/"),
      unicode: await list("/u/"),
      noMatch: await list("/p/b"),
    };
  } finally {
    for (const key of written) await kv.delete(key);
  }
};

/** KV-AC-002: empty, oversized and malformed keys and values; keys and values of exactly the limit. */
const limitsInput = z.object({ ns: z.string().min(8).max(64), keyBytes: z.number().int().min(64).max(4096), valueBytes: z.number().int().min(64).max(16384) });

const limits = async ({ kv }: CaseServices, input: unknown): Promise<unknown> => {
  const { ns, keyBytes, valueBytes } = limitsInput.parse(input);
  const exactKey = padToBytes(`${ns}/k/`, keyBytes, "é");
  const overKey = padToBytes(`${ns}/k/`, keyBytes + 1, "é");
  const astralOverKey = `${padToBytes(`${ns}/k/`, keyBytes - 3)}😀`;
  const malformedKey = `${ns}/k/\uD800`;
  const valueKey = `${ns}/k/value`;
  const exactValue = padToBytes("", valueBytes, "€");
  const overValue = padToBytes("", valueBytes + 1, "€");
  try {
    const exactKeyPut = await codeOf(() => kv.put(exactKey, "at the key limit"));
    const exactKeyGet = await outcome(() => kv.get(exactKey));
    const exactKeyListed = (await kv.list(`${ns}/k/`)).items.some((i) => i.key === exactKey);
    const exactValuePut = await codeOf(() => kv.put(valueKey, exactValue));
    const exactValueRead = await kv.get(valueKey);
    const result = {
      sizes: { exactKey: utf8Length(exactKey), overKey: utf8Length(overKey), astralOverKey: utf8Length(astralOverKey), astralOverKeyUtf16: astralOverKey.length, exactValue: utf8Length(exactValue), overValue: utf8Length(overValue) },
      emptyKey: { put: await codeOf(() => kv.put("", "v")), get: await codeOf(() => kv.get("")), delete: await codeOf(() => kv.delete("")) },
      overKey: { put: await codeOf(() => kv.put(overKey, "v")), get: await codeOf(() => kv.get(overKey)), delete: await codeOf(() => kv.delete(overKey)) },
      astralOverKey: { put: await codeOf(() => kv.put(astralOverKey, "v")) },
      malformedKey: { put: await codeOf(() => kv.put(malformedKey, "v")), get: await codeOf(() => kv.get(malformedKey)), delete: await codeOf(() => kv.delete(malformedKey)) },
      malformedPrefix: await codeOf(() => kv.list(`${ns}/k/\uDC00`)),
      exactKey: { put: exactKeyPut, get: exactKeyGet, listed: exactKeyListed },
      exactValue: { put: exactValuePut, roundTrips: exactValueRead === exactValue },
      overValue: await codeOf(() => kv.put(valueKey, overValue)),
      malformedValue: await codeOf(() => kv.put(valueKey, "a\uD800")),
      valueAfterRejections: (await kv.get(valueKey)) === exactValue,
    };
    return result;
  } finally {
    await kv.delete(exactKey);
    await kv.delete(valueKey);
  }
};

/** KV-AC-002's empty-value clause read with KV-REQ-002 (DEC-0146): the empty value is stored and read back. */
const emptyValue = async ({ kv }: CaseServices, input: unknown): Promise<unknown> => {
  const key = `${namespace(input)}/empty`;
  try {
    return { put: await codeOf(() => kv.put(key, "")), get: await outcome(() => kv.get(key)) };
  } finally {
    await kv.delete(key);
  }
};

/** Ten key suffixes for KV-AC-003: 2.5 pages of four. */
const PAGE_KEYS = ["00", "01", "02", "03", "04", "05", "06", "07", "08", "09"] as const;
const pagesInput = z.object({ ns: z.string().min(8).max(64), limit: z.number().int().min(1).max(10) });

/** KV-AC-003: listing 2.5 pages returns each key once; a cursor used with another prefix is rejected. */
const pages = async ({ kv }: CaseServices, input: unknown): Promise<unknown> => {
  const { ns, limit } = pagesInput.parse(input);
  const prefix = `${ns}/g/`;
  const keys = PAGE_KEYS.map((k) => `${prefix}${k}`);
  try {
    for (const key of keys) await kv.put(key, `value ${key.slice(prefix.length)}`);
    const sizes: number[] = [];
    const seen: string[] = [];
    let cursor: string | undefined;
    let firstCursor: string | null = null;
    // Bounded: 10 keys in pages of `limit` need at most 10 pages.
    for (let page = 0; page < 11; page++) {
      const result = await kv.list(prefix, cursor === undefined ? { limit } : { limit, cursor });
      sizes.push(result.items.length);
      for (const item of result.items) seen.push(`${item.key.slice(prefix.length)}=${item.value.slice("value ".length)}`);
      if (page === 0) firstCursor = result.nextCursor;
      if (result.nextCursor === null) break;
      cursor = result.nextCursor;
    }
    const issued = firstCursor ?? "";
    return {
      sizes,
      seen,
      otherPrefix: await codeOf(() => kv.list(`${ns}/h/`, { limit, cursor: issued })),
      narrowerPrefix: await codeOf(() => kv.list(`${prefix}0`, { limit, cursor: issued })),
      widerPrefix: await codeOf(() => kv.list(`${ns}/`, { limit, cursor: issued })),
      garbage: await codeOf(() => kv.list(prefix, { cursor: "not-a-cursor" })),
      samePrefixAgain: await codeOf(() => kv.list(prefix, { limit, cursor: issued })),
      defaultPage: (await kv.list(prefix)).items.length,
    };
  } finally {
    for (const key of keys) await kv.delete(key);
  }
};

const maxPageInput = z.object({
  ns: z.string().min(8).max(64),
  entries: z.number().int().min(1).max(50),
  keyBytes: z.number().int().min(64).max(1024),
  valueBytes: z.number().int().min(64).max(4096),
});

/**
 * KV-AC-005: a maximum page (PAR-222 entries) of maximum-size keys (PAR-220 bytes) and values
 * (PAR-223 bytes) lists successfully. The test passes the sizes; the entries are the smallest
 * set that shows the criterion (plan §1 limits).
 */
const maxPage = async ({ kv }: CaseServices, input: unknown): Promise<unknown> => {
  const { ns, entries, keyBytes, valueBytes } = maxPageInput.parse(input);
  const prefix = `${ns}/m/`;
  const written: { key: string; value: string }[] = [];
  for (let i = 0; i < entries; i++) {
    const n = String(i).padStart(2, "0");
    written.push({ key: padToBytes(`${prefix}${n}/`, keyBytes, "k"), value: padToBytes(`${n}:`, valueBytes, "€") });
  }
  try {
    for (const e of written) await kv.put(e.key, e.value);
    const page = await outcome(() => kv.list(prefix, { limit: entries }));
    if (!("ok" in page)) return { list: "code" in page ? page.code : "undefined" };
    const items = page.ok.items;
    return {
      list: "ok",
      items: items.length,
      exact: items.length === written.length && items.every((item, i) => item.key === written[i]?.key && item.value === written[i]?.value),
      keyBytes: Math.max(...items.map((i) => utf8Length(i.key))),
      valueBytes: Math.max(...items.map((i) => utf8Length(i.value))),
      nextCursor: page.ok.nextCursor,
    };
  } finally {
    for (const e of written) await kv.delete(e.key);
  }
};

/** KV-AC-005 (local, database unreachable): every operation's outcome code. */
const operations = async ({ kv }: CaseServices, input: unknown): Promise<unknown> => {
  const ns = namespace(input);
  const key = `${ns}/ops`;
  return {
    put: await codeOf(() => kv.put(key, "v")),
    get: await codeOf(() => kv.get(key)),
    list: await codeOf(() => kv.list(`${ns}/`)),
    delete: await codeOf(() => kv.delete(key)),
  };
};

export const kvCases: CaseSet = { basics, prefixes, limits, emptyValue, pages, maxPage, operations };

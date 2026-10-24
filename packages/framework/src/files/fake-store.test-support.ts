/**
 * In-memory stand-in for the R2 binding subset FILES uses (`FilesStore`), for unit tests only.
 * Can return short truncated pages (as R2 may when metadata is included) so paging is exercised.
 *
 * Order (`order` option):
 * - `"codepoint"` (default): code point order, as local R2 (Miniflare, SQLite BINARY) lists.
 * - `"r2"`: the order real R2 lists in, through the binding and the S3 API alike, as measured by
 *   the live probe of 2026-10-24 (`ai/implementation/root-causes/2026-10-24-pass1c-FILES-AC-001-r2-list-order.md`,
 *   "Live probe"): UTF-8 byte order, except that the end of a key ranks like one more byte between
 *   0x31 and 0x61 (0x31 here). `startAfter` does not follow that order: R2 returns every key other
 *   than `startAfter` whose ranked form is greater than the plain `startAfter` bytes. Keys longer
 *   than 1,024 bytes are refused, as R2 refuses them (`InvalidObjectName`, 10020).
 */
import type { FilesStore, StoredObject, StoredObjectBody } from "./service.js";

function compareCodePoints(a: string, b: string): number {
  const x = Array.from(a, (c) => c.codePointAt(0) ?? 0);
  const y = Array.from(b, (c) => c.codePointAt(0) ?? 0);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return x.length - y.length;
}

const utf8 = new TextEncoder();
/** The rank R2 gives the end of a key (any value in 0x31–0x61 fits the probe). */
const R2_END_RANK = 0x31;
const R2_MAX_KEY_BYTES = 1024;

function compareBytes(x: Uint8Array, y: Uint8Array): number {
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return x.length - y.length;
}

/** The key's bytes followed by R2's end-of-key rank. */
function ranked(key: string): Uint8Array {
  const bytes = utf8.encode(key);
  const out = new Uint8Array(bytes.length + 1);
  out.set(bytes);
  out[bytes.length] = R2_END_RANK;
  return out;
}

function compareR2(a: string, b: string): number {
  return compareBytes(ranked(a), ranked(b)) || compareBytes(utf8.encode(a), utf8.encode(b));
}

/** R2's `startAfter` (probe L3/L4): every key but `after` whose ranked form is above `after`'s plain bytes. */
function afterR2(key: string, after: string): boolean {
  return key !== after && compareBytes(ranked(key), utf8.encode(after)) > 0;
}

export interface FakeStoreOptions {
  readonly order?: "codepoint" | "r2";
}

export interface FakeStore extends FilesStore {
  readonly objects: Map<string, { bytes: Uint8Array; contentType: string | undefined }>;
  /** When set, every list call returns at most this many objects (still reporting truncation). */
  shortPages: number | undefined;
  listCalls: number;
}

export function fakeStore(fakeOptions: FakeStoreOptions = {}): FakeStore {
  const r2 = fakeOptions.order === "r2";
  const checkKey = (key: string): void => {
    if (r2 && utf8.encode(key).byteLength > R2_MAX_KEY_BYTES) throw new Error("The specified object name is not valid. (10020)");
  };
  const objects = new Map<string, { bytes: Uint8Array; contentType: string | undefined }>();
  const info = (key: string): StoredObject | null => {
    const o = objects.get(key);
    if (o === undefined) return null;
    return o.contentType === undefined ? { key, size: o.bytes.byteLength, httpMetadata: {} } : { key, size: o.bytes.byteLength, httpMetadata: { contentType: o.contentType } };
  };
  const store: FakeStore = {
    objects,
    shortPages: undefined,
    listCalls: 0,
    async put(key, value, options) {
      checkKey(key);
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(await new Response(value).arrayBuffer());
      objects.set(key, { bytes: bytes.slice(), contentType: options?.httpMetadata?.contentType });
      return null;
    },
    async get(key) {
      checkKey(key);
      const meta = info(key);
      if (meta === null) return null;
      const bytes = objects.get(key)?.bytes ?? new Uint8Array();
      const body = new Response(bytes.slice()).body as ReadableStream<Uint8Array>;
      return { ...meta, body } satisfies StoredObjectBody;
    },
    async head(key) {
      checkKey(key);
      return info(key);
    },
    async delete(key) {
      checkKey(key);
      objects.delete(key);
    },
    async list(options) {
      store.listCalls++;
      const prefix = options.prefix ?? "";
      const after = options.startAfter;
      const isAfter = (k: string): boolean => after === undefined || (r2 ? afterR2(k, after) : compareCodePoints(k, after) > 0);
      const keys = [...objects.keys()].filter((k) => k.startsWith(prefix) && isAfter(k)).sort(r2 ? compareR2 : compareCodePoints);
      const max = Math.min(options.limit ?? 1000, store.shortPages ?? Infinity);
      const page = keys.slice(0, max);
      return { objects: page.map((k) => info(k) as StoredObject), truncated: keys.length > page.length };
    },
  };
  return store;
}

/** A store whose every operation fails the way an unreachable binding does. */
export function unreachableStore(): FilesStore {
  const fail = async (): Promise<never> => {
    throw new Error("connect ECONNREFUSED 127.0.0.1:8787");
  };
  return { put: fail, get: fail, head: fail, delete: fail, list: fail };
}

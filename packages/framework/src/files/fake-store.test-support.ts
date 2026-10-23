/**
 * In-memory stand-in for the R2 binding subset FILES uses (`FilesStore`), for unit tests only.
 * Lists in code point order like R2, and can return short truncated pages (as R2 may when
 * metadata is included) so paging is exercised.
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

export interface FakeStore extends FilesStore {
  readonly objects: Map<string, { bytes: Uint8Array; contentType: string | undefined }>;
  /** When set, every list call returns at most this many objects (still reporting truncation). */
  shortPages: number | undefined;
  listCalls: number;
}

export function fakeStore(): FakeStore {
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
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(await new Response(value).arrayBuffer());
      objects.set(key, { bytes: bytes.slice(), contentType: options?.httpMetadata?.contentType });
      return null;
    },
    async get(key) {
      const meta = info(key);
      if (meta === null) return null;
      const bytes = objects.get(key)?.bytes ?? new Uint8Array();
      const body = new Response(bytes.slice()).body as ReadableStream<Uint8Array>;
      return { ...meta, body } satisfies StoredObjectBody;
    },
    async head(key) {
      return info(key);
    },
    async delete(key) {
      objects.delete(key);
    },
    async list(options) {
      store.listCalls++;
      const prefix = options.prefix ?? "";
      const keys = [...objects.keys()]
        .filter((k) => k.startsWith(prefix) && (options.startAfter === undefined || compareCodePoints(k, options.startAfter) > 0))
        .sort(compareCodePoints);
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

/**
 * Cloudflare R2 keys for FILES names (DEC-PENDING-fix-r2order-1, amends DEC-0162 "Order").
 *
 * R2 lists in UTF-8 byte order except where one key is a proper prefix of another: the end of a
 * key then ranks like a byte between 0x31 and 0x61, and `startAfter` does not follow the listing
 * order (live probe, `ai/implementation/root-causes/2026-10-24-pass1c-FILES-AC-001-r2-list-order.md`).
 * So each name is stored as `name + U+0001`. FILES-REQ-002 forbids U+0001 in names, and it sorts
 * below every byte a name can hold, so no stored key is a proper prefix of another and R2's order
 * of stored keys is byte order of the names, which is code point order (FILES-REQ-001).
 *
 * R2's key limit is 1,024 bytes, the same as PAR-230, so a name of exactly PAR-230 bytes is stored
 * unterminated. It can be a proper prefix of no valid name, so the order still holds, and decoding
 * stays unambiguous (a key ends in U+0001 exactly when it was terminated).
 *
 * Only the Cloudflare target wraps its store; the shared service, the local target and the S3
 * stores keep plain keys. Workers-compatible.
 */
import { MAX_NAME_BYTES } from "../names.js";
import type { FilesStore, StoredObject } from "../service.js";

/** The terminator every stored key under PAR-230 bytes ends with. */
export const KEY_TERMINATOR = "\u0001";

const utf8 = new TextEncoder();

/** The R2 key that holds the file `name` (or a list position after it). */
export function storedKey(name: string): string {
  return utf8.encode(name).byteLength < MAX_NAME_BYTES ? name + KEY_TERMINATOR : name;
}

/** The file name a stored key holds. */
export function nameOfKey(key: string): string {
  return key.endsWith(KEY_TERMINATOR) ? key.slice(0, -KEY_TERMINATOR.length) : key;
}

/** The fields FILES reads, copied explicitly: an R2 binding object may expose them as prototype getters, which a spread would drop. */
function named(object: StoredObject): StoredObject {
  return { key: nameOfKey(object.key), size: object.size, httpMetadata: object.httpMetadata };
}

/**
 * The Cloudflare `FilesStore`: the R2 binding addressed by `storedKey`, reporting names. The
 * service's `startAfter` is a name, so it becomes that name's stored key, and paging stays in
 * the listing's order. `prefix` is passed unchanged: every stored key of a name that starts with
 * it also starts with it.
 */
export function cloudflareFilesStore(store: FilesStore): FilesStore {
  return {
    put: (name, value, options) => store.put(storedKey(name), value, options),
    get: async (name) => {
      const object = await store.get(storedKey(name));
      return object === null ? null : { ...named(object), body: object.body };
    },
    head: async (name) => {
      const object = await store.head(storedKey(name));
      return object === null ? null : named(object);
    },
    delete: (name) => store.delete(storedKey(name)),
    list: async (options) => {
      const { startAfter, ...rest } = options;
      const page = await store.list(startAfter === undefined ? rest : { ...rest, startAfter: storedKey(startAfter) });
      return { objects: page.objects.map(named), truncated: page.truncated };
    },
  };
}

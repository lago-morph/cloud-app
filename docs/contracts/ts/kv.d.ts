/** Key-value storage (KV). Behavior: docs/components/kv.md. */

export interface KvListOptions {
  /** Page size; default and maximum in the parameters register (PAR-221, PAR-222). */
  readonly limit?: number;
  /** Cursor from a previous page of the same prefix. */
  readonly cursor?: string;
}

export interface KvListPage {
  readonly items: readonly { readonly key: string; readonly value: string }[];
  /** Null when there are no more items. */
  readonly nextCursor: string | null;
}

export interface KvService {
  /** The stored value, or null if the key is absent. */
  get(key: string): Promise<string | null>;
  /** Creates or replaces the value. */
  put(key: string, value: string): Promise<void>;
  /** Removes the key. Deleting an absent key succeeds. */
  delete(key: string): Promise<void>;
  /** Keys starting with `prefix` (literal, case-sensitive), in code point order. */
  list(prefix: string, options?: KvListOptions): Promise<KvListPage>;
}

/**
 * KV on the framework table `__framework_kv(key, value)` in the app's SQL database (kv.md §2,
 * DEC-0010), through a SQL adapter's handle (`sqliteDb`/`postgresDb`), so it needs no
 * target-specific code.
 */
import { and, eq, gt, gte, lt, type SQL } from "drizzle-orm";
import { FrameworkError } from "../core/errors.js";
import { frameworkTables } from "../mig/framework.js";
import { asc } from "../sql/expressions.js";
import { adapterOf } from "../sql/handle.js";
import type { PortableDb } from "../sql/types.js";
import type { KvListOptions, KvListPage, KvService } from "./public.js";
import { decodeCursor, encodeCursor } from "./cursor.js";
import { prefixEnd } from "./range.js";
import { checkKey, checkPrefix, checkValue } from "./rules.js";

/** PAR-221: default list page size. */
export const DEFAULT_PAGE_SIZE = 20;
/** PAR-222: maximum list page size. */
export const MAX_PAGE_SIZE = 50;

type KvTable = ReturnType<typeof frameworkTables>["kv"];

/** KV over `db`, a handle made by `sqliteDb`/`postgresDb`. */
export function createKv(db: PortableDb): KvService {
  const adapter = adapterOf(db);
  if (adapter === undefined) throw new FrameworkError("CORE.MISCONFIGURED", "KV needs a SQL handle made by the framework's SQL adapter");
  const table = frameworkTables(adapter.dialect).kv;
  // The handle's builders are typed for the pg-core contract; the KV table is a plain Drizzle table.
  const sql = db as unknown as {
    select(fields: object): {
      from(t: KvTable): {
        where(c: unknown): {
          limit(n: number): Promise<{ value: string }[]>;
          orderBy(o: unknown): { limit(n: number): Promise<{ key: string; value: string }[]> };
        };
      };
    };
    insert(t: KvTable): { values(row: object): { onConflictDoUpdate(c: object): Promise<void> } };
    delete(t: KvTable): { where(c: unknown): Promise<void> };
  };

  return {
    async get(key) {
      checkKey(key);
      const rows = await sql.select({ value: table.value }).from(table).where(eq(table.key, key)).limit(1);
      return rows[0]?.value ?? null;
    },
    async put(key, value) {
      checkKey(key);
      checkValue(value);
      await sql.insert(table).values({ key, value }).onConflictDoUpdate({ target: table.key, set: { value } });
    },
    async delete(key) {
      checkKey(key);
      await sql.delete(table).where(eq(table.key, key));
    },
    async list(prefix: string, options: KvListOptions = {}): Promise<KvListPage> {
      checkPrefix(prefix);
      const limit = pageSize(options.limit);
      const after = options.cursor === undefined ? undefined : decodeCursor(options.cursor, prefix);
      const end = prefixEnd(prefix);
      const conditions: SQL[] = [after === undefined ? gte(table.key, prefix) : gt(table.key, after)];
      if (end !== null) conditions.push(lt(table.key, end));
      // One row more than the page tells whether another page follows (nextCursor null otherwise).
      // A maximum page plus one row (51 × (PAR-220 + PAR-223) = 261,120 bytes) is within PAR-215.
      const rows = await sql
        .select({ key: table.key, value: table.value })
        .from(table)
        .where(and(...conditions))
        .orderBy(asc(table.key as never))
        .limit(limit + 1);
      const items = rows.slice(0, limit).map((r) => ({ key: r.key, value: r.value }));
      const last = items[items.length - 1];
      return { items, nextCursor: rows.length > limit && last !== undefined ? encodeCursor(prefix, last.key) : null };
    },
  };
}

/** The page size for `limit`: PAR-221 when absent; clamped to 1…PAR-222 (DEC-PENDING-B-08-3). */
function pageSize(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(limit)));
}

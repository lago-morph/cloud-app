/**
 * MIG step-4 check facts read from a D1 database through the HTTP API (mig/cloud/check.ts).
 * Column rules come from the declared SQLite type, the only type a D1 database holds: an
 * INTEGER column holds integers, REAL reals, TEXT text without NUL (SQL §2.1); a NOT NULL
 * column holds no NULL. Requests: two for the tables, one each for references, added-column
 * rules and the record's two reads.
 */
import type { CheckReader, ColumnShape, TableShape } from "../../../mig/cloud/check.js";
import type { D1Client } from "./client.js";
import { d1HttpMigrationDatabase } from "./migration-database.js";

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;
const NOT_INTERNAL = `"name" NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND "name" NOT LIKE '\\_cf\\_%' ESCAPE '\\'`;

/** SQL that is true when `c`'s value keeps its column's rule. */
function ruleHolds(c: ColumnShape): string {
  const col = q(c.name);
  const type = c.type.toLowerCase();
  const typed = type.includes("int")
    ? `typeof(${col}) = 'integer'`
    : /real|floa|doub/.test(type)
      ? `typeof(${col}) = 'real'`
      : /char|clob|text/.test(type)
        ? `(typeof(${col}) = 'text' AND instr(CAST(${col} AS BLOB), x'00') = 0)`
        : `typeof(${col}) <> 'null'`;
  return c.notNull ? typed : `(${col} IS NULL OR ${typed})`;
}

export function d1CheckReader(client: D1Client, uuid: string): CheckReader {
  return {
    async tables() {
      const [master = []] = await client.batch(uuid, [{ sql: `SELECT "name" FROM sqlite_master WHERE "type" = 'table' AND ${NOT_INTERNAL} ORDER BY "name"` }]);
      const names = master.map((m) => String(m["name"]));
      if (names.length === 0) return [];
      const facts = await client.batch(
        uuid,
        names.flatMap((t) => [{ sql: `PRAGMA table_info(${q(t)})` }, { sql: `SELECT count(*) AS "n" FROM ${q(t)}` }]),
      );
      return names.map(
        (name, i): TableShape => ({
          name,
          columns: (facts[2 * i] ?? []).map((c) => ({ name: String(c["name"]), type: String(c["type"]).toLowerCase(), notNull: Number(c["notnull"]) === 1 })),
          rows: Number(facts[2 * i + 1]?.[0]?.["n"] ?? 0),
        }),
      );
    },
    async referenceViolations() {
      const [rows = []] = await client.batch(uuid, [{ sql: "PRAGMA foreign_key_check" }]);
      const counts = new Map<string, number>();
      for (const r of rows) counts.set(String(r["table"]), (counts.get(String(r["table"])) ?? 0) + 1);
      return [...counts].map(([table, n]) => ({ table, rows: n }));
    },
    async columnRuleViolations(table, columns) {
      const results = await client.batch(
        uuid,
        columns.map((c) => ({ sql: `SELECT count(*) AS "n" FROM ${q(table)} WHERE NOT ${ruleHolds(c)}` })),
      );
      return columns.map((_, i) => Number(results[i]?.[0]?.["n"] ?? 0));
    },
    recordedIds: () => d1HttpMigrationDatabase(client, uuid).recordedIds(),
  };
}

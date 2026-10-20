/**
 * The MIG step-4 check (migrations.md §2 "Schema-changing cloud deploy" step 4), target-neutral:
 * row counts of every table not explicitly dropped, intact references, column rules on added
 * columns, and a complete record. Readers are plain stubs here; the D1 reader is tested in
 * provision/cloudflare/d1.
 */
import { describe, expect, it } from "vitest";
import { tag } from "../../../../../tests/support/tags.js";
import type { Migration } from "../history.js";
import { checkMigrated, type CheckReader, type TableShape } from "./check.js";

const migration = (id: string, text: string): Migration => ({ id, name: id.split("/")[1] ?? id, file: `${id}.sql`, text, checksum: "c", statements: [text] });
const m0 = migration("framework/0000_framework_tables", "CREATE TABLE `__framework_kv` (`key` text);");
const m1 = migration("app/0001_schema", "CREATE TABLE `notes` (`id` text);");
const m2 = migration("app/0002_schema", "DROP TABLE `old`;--> statement-breakpoint\nALTER TABLE `notes` ADD `rank` integer DEFAULT 0 NOT NULL;");
const histories = { framework: [m0], app: [m1, m2] };

const col = (name: string, type = "text", notNull = false) => ({ name, type, notNull });

function reader(tables: TableShape[], extra: Partial<CheckReader> = {}): CheckReader & { asked: unknown[] } {
  const asked: unknown[] = [];
  return {
    asked,
    tables: async () => tables,
    referenceViolations: async () => [],
    columnRuleViolations: async (table, columns) => {
      asked.push([table, columns.map((c) => c.name)]);
      return columns.map(() => 0);
    },
    recordedIds: async () => new Set([m0.id, m1.id, m2.id]),
    ...extra,
  };
}

const before = (): TableShape[] => [
  { name: "__framework_kv", columns: [col("key")], rows: 2 },
  { name: "notes", columns: [col("id")], rows: 3 },
  { name: "__framework_migrations", columns: [col("id")], rows: 2 },
  { name: "old", columns: [col("id")], rows: 5 },
];
const after = (): TableShape[] => [
  { name: "__framework_kv", columns: [col("key")], rows: 2 },
  { name: "notes", columns: [col("id"), col("rank", "integer", true)], rows: 3 },
  { name: "__framework_migrations", columns: [col("id")], rows: 3 },
];

describe("MIG step-4 check", () => {
  it(tag("MIG-AC-003", "passes when every kept table has its rows, references hold, added columns keep their rule and the record is complete"), async () => {
    const next = reader(after());
    expect(await checkMigrated({ previous: reader(before()), next, applied: [m2.id], migrations: histories })).toEqual([]);
    expect(next.asked).toEqual([["notes", ["rank"]]]);
  });

  it("a table that is missing without a migration dropping it, or has other row counts, fails", async () => {
    const next = reader([
      { name: "notes", columns: [col("id"), col("rank", "integer", true)], rows: 2 },
      { name: "__framework_migrations", columns: [col("id")], rows: 3 },
    ]);
    const problems = await checkMigrated({ previous: reader(before()), next, applied: [m2.id], migrations: histories });
    expect(problems).toEqual(["table __framework_kv is missing from the new database, and no applied migration drops it", "table notes has 2 rows in the new database, 3 expected"]);
  });

  it("broken references, broken column rules on added columns and an incomplete record fail", async () => {
    const next = reader(after(), {
      referenceViolations: async () => [{ table: "notes", rows: 4 }],
      columnRuleViolations: async (_t, columns) => columns.map(() => 1),
      recordedIds: async () => new Set([m0.id, m1.id]),
    });
    const problems = await checkMigrated({ previous: reader(before()), next, applied: [m2.id], migrations: histories });
    expect(problems).toEqual([
      "4 rows of table notes reference rows that do not exist",
      "added column notes.rank: 1 rows break its rule (integer, not null)",
      "the migration record lacks app/0002_schema",
    ]);
  });
});

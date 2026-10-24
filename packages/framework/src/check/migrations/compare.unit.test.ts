/**
 * Logical-schema comparison (CHECK-REQ-004 first bullet: both dialect histories yield the same
 * logical schema) and the supported-change whitelist (second bullet, migrations.md §2).
 */
import { describe, expect, it } from "vitest";
import { compareDialects, dataStatements, unsupportedChanges } from "./compare.js";
import type { ColumnSchema, DatabaseSchema, TableSchema } from "./databases.js";

const col = (type: string, more: Partial<ColumnSchema> = {}): ColumnSchema => ({ type, notNull: true, default: null, primaryKey: false, ...more });
const table = (columns: Record<string, ColumnSchema>, more: Partial<TableSchema> = {}): TableSchema => ({ columns, indexes: [], uniques: [], foreignKeys: [], ...more });

const sqlite: DatabaseSchema = {
  records: table(
    { id: col("text", { primaryKey: true }), amount: col("integer", { default: "0" }), at: col("integer"), ok: col("integer", { default: "true" }), n: col("real", { notNull: false }) },
    { indexes: ["amount"], uniques: ["at"], foreignKeys: [] },
  ),
};
const postgres: DatabaseSchema = {
  records: table(
    { id: col("text", { primaryKey: true }), amount: col("integer", { default: "0" }), at: col("bigint"), ok: col("boolean", { default: "true" }), n: col("double precision", { notNull: false }) },
    { indexes: ["amount"], uniques: ["at"], foreignKeys: [] },
  ),
};

describe("[CHECK-AC-004] both dialects yield the same logical schema", () => {
  it("the framework's type pairs (text, integer/bigint/boolean, real/double precision) are the same logical schema", () => {
    expect(compareDialects(sqlite, postgres)).toEqual([]);
  });

  it("a column in one dialect only is a difference naming the table and column", () => {
    const records = postgres["records"];
    if (records === undefined) throw new Error("fixture");
    const pg = { records: { ...records, columns: { ...records.columns, extra: col("text", { notNull: false }) } } };
    expect(compareDialects(sqlite, pg)).toEqual(["column records.extra exists in postgres but not in sqlite"]);
  });

  it("tables, types, nullability, defaults, primary keys, indexes, uniques and references are compared", () => {
    const pg: DatabaseSchema = {
      records: table(
        { id: col("text"), amount: col("text", { default: "1" }), at: col("bigint", { notNull: false }), ok: col("boolean", { default: "true" }), n: col("double precision", { notNull: false }) },
        { indexes: [], uniques: ["at", "n"], foreignKeys: ["n -> other(id) on update no action on delete no action"] },
      ),
      other: table({ id: col("text", { primaryKey: true }) }),
    };
    expect(compareDialects(sqlite, pg)).toEqual([
      "table other exists in postgres but not in sqlite",
      "column records.id: primary key in sqlite, not in postgres",
      "column records.amount: type integer in sqlite but text in postgres",
      "column records.amount: default 0 in sqlite but 1 in postgres",
      "column records.at: NOT NULL in sqlite, nullable in postgres",
      "table records: index (amount) exists in sqlite but not in postgres",
      "table records: unique (n) exists in postgres but not in sqlite",
      "table records: reference n -> other(id) on update no action on delete no action exists in postgres but not in sqlite",
    ]);
  });
});

describe("[CHECK-AC-004] supported changes only (migrations.md §2), judged by the schema each migration leaves", () => {
  const ADD_COPY_DROP = /add-copy-drop pattern/;
  const base: DatabaseSchema = {
    parents: table({ id: col("text", { primaryKey: true }), name: col("text") }),
    records: table(
      { id: col("text", { primaryKey: true }), label: col("text"), amount: col("integer", { default: "0" }), pid: col("text", { notNull: false }) },
      { indexes: ["label"], foreignKeys: ["pid -> parents(id) on update no action on delete no action"] },
    ),
  };
  const records = base["records"] ?? table({});
  const withRecords = (r: Partial<TableSchema>): DatabaseSchema => ({ ...base, records: { ...records, ...r } });
  const cols = (c: Record<string, ColumnSchema | undefined>) => Object.fromEntries(Object.entries({ ...records.columns, ...c }).filter((e): e is [string, ColumnSchema] => e[1] !== undefined));

  it("each supported change passes: add or drop a table, add a nullable or defaulted column, drop a column (with its reference), add or drop an index or unique", () => {
    const supported: DatabaseSchema[] = [
      { ...base, tags: table({ id: col("text", { primaryKey: true }) }) },
      { records },
      withRecords({ columns: cols({ note: col("text", { notNull: false }) }) }),
      withRecords({ columns: cols({ active: col("integer", { default: "true" }) }) }),
      withRecords({ columns: cols({ pid: undefined }), foreignKeys: [] }),
      withRecords({ indexes: [] }),
      withRecords({ indexes: ["amount", "label"], uniques: ["label"] }),
      withRecords({ columns: cols({ kid: col("text", { notNull: false }) }), foreignKeys: [...records.foreignKeys, "kid -> parents(id) on update no action on delete no action"] }),
    ];
    for (const after of supported) expect(unsupportedChanges(base, after)).toEqual([]);
    expect(unsupportedChanges(withRecords({ uniques: ["label"] }), base)).toEqual([]);
  });

  it("a NOT NULL column without a static default added to an existing table fails, naming the add-copy-drop pattern", () => {
    const found = unsupportedChanges(base, withRecords({ columns: cols({ score: col("integer") }) }));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/records\.score/);
    expect(found[0]).toMatch(ADD_COPY_DROP);
  });

  it("a NOT NULL column without a default in a new table is fine", () => {
    expect(unsupportedChanges(base, { ...base, tags: table({ id: col("text", { primaryKey: true }), name: col("text") }) })).toEqual([]);
  });

  it("changing an existing column's type, nullability, default or primary key fails, naming the add-copy-drop pattern", () => {
    for (const change of [{ type: "real" }, { notNull: true }, { default: "'x'" }, { primaryKey: true }]) {
      const pid = records.columns["pid"] ?? col("text");
      const found = unsupportedChanges(base, withRecords({ columns: cols({ pid: { ...pid, ...change } }) }));
      expect(found, JSON.stringify(change)).toHaveLength(1);
      expect(found[0]).toMatch(/records\.pid/);
      expect(found[0]).toMatch(ADD_COPY_DROP);
    }
  });

  it("a column rename (a column removed and one added in the same table in one migration) fails, naming the add-copy-drop pattern", () => {
    const label = records.columns["label"] ?? col("text");
    const found = unsupportedChanges(base, withRecords({ columns: cols({ label: undefined, title: { ...label, notNull: false } }) }));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/rename/);
    expect(found[0]).toMatch(/label/);
    expect(found[0]).toMatch(/title/);
    expect(found[0]).toMatch(ADD_COPY_DROP);
  });

  it("a table rename (a table removed and one added in one migration) fails, naming the add-copy-drop pattern", () => {
    const found = unsupportedChanges(base, { parents: base["parents"] ?? table({}), entries: records });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/records/);
    expect(found[0]).toMatch(/entries/);
    expect(found[0]).toMatch(ADD_COPY_DROP);
  });

  it("statements that change data fail (a migration changes the schema only); drizzle-kit's SQLite rebuild copy is allowed", () => {
    expect(dataStatements(["CREATE TABLE `__new_records` (`id` text)", 'INSERT INTO `__new_records`("id") SELECT "id" FROM `records`', "DROP TABLE `records`"])).toEqual([]);
    const found = dataStatements(["UPDATE `records` SET `label` = 'x'", "delete from records", "INSERT INTO `records` VALUES ('a')", 'TRUNCATE "records"']);
    expect(found).toHaveLength(4);
    expect(found[0]).toMatch(/UPDATE/);
  });

  it("adding or removing a reference on an existing column fails", () => {
    expect(unsupportedChanges(base, withRecords({ foreignKeys: [] }))).toHaveLength(1);
    expect(unsupportedChanges(withRecords({ foreignKeys: [] }), base)).toHaveLength(1);
  });
});

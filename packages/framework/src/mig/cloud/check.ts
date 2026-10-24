/**
 * The MIG step-4 check of a schema-changing cloud deploy (migrations.md §2 "Schema-changing
 * cloud deploy" step 4), target-neutral. A target supplies a `CheckReader` per database (D1 on
 * Cloudflare; a Postgres reader would serve AWS) and the check compares the copy-and-migrated
 * database with the previous one:
 *
 * - every table of the previous database that no applied migration drops is present with the
 *   same row count (supported changes never delete rows); the record table has one more row
 *   per applied migration;
 * - no row references a missing row;
 * - every column added by this deploy satisfies its column rule on every row (the reader
 *   decides what the rule is from the database's declared type and NOT NULL, the only facts a
 *   database holds; the generator already checked each static default against its SQL rule);
 * - the migration record lists every migration of both histories.
 *
 * Returns the problems found, empty when the check passes.
 */
import type { Histories } from "../apply.js";
import { MIGRATIONS_TABLE } from "../framework.js";

export interface ColumnShape {
  readonly name: string;
  /** Declared type, lower case (`text`, `integer`, `real`, …). */
  readonly type: string;
  readonly notNull: boolean;
}

export interface TableShape {
  readonly name: string;
  readonly columns: readonly ColumnShape[];
  readonly rows: number;
}

export interface CheckReader {
  /** The database's app and framework tables (no internal tables), with columns and row counts. */
  tables(): Promise<readonly TableShape[]>;
  /** Tables with rows whose references point at no row, and how many such rows. */
  referenceViolations(): Promise<readonly { readonly table: string; readonly rows: number }[]>;
  /** For each given column of `table`, the number of rows whose value breaks the column's rule. */
  columnRuleViolations(table: string, columns: readonly ColumnShape[]): Promise<readonly number[]>;
  recordedIds(): Promise<ReadonlySet<string>>;
}

export interface CheckInput {
  readonly previous: CheckReader;
  readonly next: CheckReader;
  /** IDs applied to `next` by this deploy. */
  readonly applied: readonly string[];
  readonly migrations: Histories;
}

const DROP_TABLE = /\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?[`"[]?([^`"\]\s;]+)[`"\]]?/gi;

/** Tables the given migrations drop explicitly. */
export function droppedTables(texts: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const text of texts) for (const m of text.matchAll(DROP_TABLE)) if (m[1]) out.add(m[1]);
  return out;
}

export async function checkMigrated(input: CheckInput): Promise<string[]> {
  const all = [...input.migrations.framework, ...input.migrations.app];
  const appliedTexts = all.filter((m) => input.applied.includes(m.id)).map((m) => m.text);
  const dropped = droppedTables(appliedTexts);
  const [before, after, references, recorded] = await Promise.all([input.previous.tables(), input.next.tables(), input.next.referenceViolations(), input.next.recordedIds()]);
  const problems: string[] = [];

  const afterByName = new Map(after.map((t) => [t.name, t]));
  for (const t of before) {
    const now = afterByName.get(t.name);
    if (!now) {
      if (!dropped.has(t.name)) problems.push(`table ${t.name} is missing from the new database, and no applied migration drops it`);
    } else {
      // the record gains one row per applied migration
      const expected = t.name === MIGRATIONS_TABLE ? t.rows + input.applied.length : t.rows;
      if (now.rows !== expected) problems.push(`table ${t.name} has ${now.rows} rows in the new database, ${expected} expected`);
    }
  }
  for (const v of references) problems.push(`${v.rows} rows of table ${v.table} reference rows that do not exist`);

  const beforeByName = new Map(before.map((t) => [t.name, t]));
  for (const t of after) {
    const old = beforeByName.get(t.name);
    const added = old ? t.columns.filter((c) => !old.columns.some((o) => o.name === c.name)) : [];
    if (added.length === 0) continue;
    const counts = await input.next.columnRuleViolations(t.name, added);
    added.forEach((c, i) => {
      const n = counts[i] ?? 0;
      if (n > 0) problems.push(`added column ${t.name}.${c.name}: ${n} rows break its rule (${c.type}${c.notNull ? ", not null" : ", nullable"})`);
    });
  }

  for (const m of all) if (!recorded.has(m.id)) problems.push(`the migration record lacks ${m.id}`);
  return problems;
}

/**
 * SQL-AC-001 (rejection part) and SQL-AC-004 (`.default()` part), per dialect process:
 * schemas with each unsupported feature or invalid name, and tables with no or two `id()`
 * columns, are rejected; `.default()` values are checked against the column rule
 * (sql.md §2.1). "Rejected" is taken as: `defineTable` or `defineApp` throws, so no
 * database is ever created from such a schema (DEC-PENDING-B-T2-4).
 *
 * Features the contract cannot even express (composite primary keys, reference actions,
 * collations, SQL defaults) are also asserted at the type level with `@ts-expect-error`,
 * which `npm run typecheck` enforces; at run time each is forced through with a cast, as
 * untyped code could, and must still be rejected.
 */
import { describe, expect, it } from "vitest";
import { sql as drizzleSql } from "drizzle-orm";
import { serial, varchar } from "drizzle-orm/pg-core";
import { tag } from "../../../../../tests/support/tags.js";
import {
  boolean, defineApp, defineTable, id, integer, number, ref, text, timestamp, type AnyTable,
} from "../../../src/index.js";
import { DIALECT_LABEL, type Dialect } from "./support/dialect.js";

/** `build` (one table, or `{ tables }` for several) must throw, or `defineApp` with its result must. */
function expectSchemaRejected(what: string, build: () => AnyTable | { readonly tables: Record<string, AnyTable> }): void {
  let threw = false;
  try {
    const built = build();
    const tables = "tables" in built && !("id" in built) ? (built as { tables: Record<string, AnyTable> }).tables : { t: built as AnyTable };
    defineApp({ name: "rejects", config: {}, secrets: [], tables, routes: () => {} });
  } catch {
    threw = true;
  }
  expect(threw, `${what} must be rejected`).toBe(true);
}

function expectSchemaAccepted(what: string, build: () => AnyTable): void {
  expect(() => {
    const t = build();
    defineApp({ name: "accepts", config: {}, secrets: [], tables: { t }, routes: () => {} });
  }, what).not.toThrow();
}

const never = <T>(v: unknown): T => v as T;

export function defineSchemaRuleSuite(dialect: Dialect): void {
  const on = `(${DIALECT_LABEL[dialect]})`;

  describe(`SQL schema rules ${on}`, () => {
    it(tag("SQL-AC-001", `a table using every column type and option is accepted ${on}`), () => {
      expectSchemaAccepted("every type and option", () => {
        const parent = defineTable("parent_rows", { id: id() });
        return defineTable(
          "every_type",
          {
            id: id(),
            plainText: text(),
            optionalText: text().nullable(),
            uniqueText: text().unique(),
            defaultText: text().default("x"),
            count: integer().default(0),
            ratio: number().nullable(),
            seenAt: timestamp(),
            enabled: boolean().default(true),
            parentId: ref(() => parent.id),
            optionalParentId: ref(() => parent.id).nullable(),
          },
          { indexes: [["seenAt"], ["plainText", "count"]], uniques: [["plainText", "seenAt"]] },
        );
      });
    });

    it(tag("SQL-AC-001", `invalid table names are rejected ${on}`), () => {
      for (const name of ["Notes", "notesList", "notes-list", "notes list", "1notes", "café", "__framework_notes", "", "n".repeat(64)]) {
        expectSchemaRejected(`table name ${JSON.stringify(name)}`, () => defineTable(name, { id: id(), title: text() }));
      }
      expectSchemaAccepted("snake_case table name", () => defineTable("note_items2", { id: id() }));
    });

    it(tag("SQL-AC-001", `column keys that are not lowerCamelCase, or map to invalid SQL names, are rejected ${on}`), () => {
      for (const key of ["Title", "created_at", "title-text", "title text", "ünicode", "__frameworkX", "a".repeat(64)]) {
        expectSchemaRejected(`column key ${JSON.stringify(key)}`, () => defineTable("notes", { id: id(), [key]: text() }));
      }
      expectSchemaAccepted("lowerCamelCase keys", () => defineTable("notes", { id: id(), createdAt: timestamp(), bodyText2: text() }));
    });

    it(tag("SQL-AC-001", `tables with no id() column or with two id() columns are rejected ${on}`), () => {
      expectSchemaRejected("no id()", () => defineTable("notes", { title: text() }));
      expectSchemaRejected("no id() (text key named id)", () => defineTable("notes", { id: text() }));
      expectSchemaRejected("two id()", () => defineTable("notes", { id: id(), otherId: id() }));
    });

    it(tag("SQL-AC-001", `unsupported features are rejected: SQL defaults, auto-increment, generated columns, composite keys, reference actions, non-portable column types ${on}`), () => {
      expectSchemaRejected("SQL-expression default", () =>
        // @ts-expect-error — `.default()` takes a static value of the column type, not SQL.
        defineTable("notes", { id: id(), n: integer().default(drizzleSql`1 + 1`) }));
      expectSchemaRejected("SQL-expression default (timestamp now)", () =>
        defineTable("notes", { id: id(), at: timestamp().default(never<number>(drizzleSql`CURRENT_TIMESTAMP`)) }));
      expectSchemaRejected("auto-increment column", () =>
        defineTable("notes", { id: id(), seq: never<ReturnType<typeof integer>>(serial()) }));
      expectSchemaRejected("generated column", () =>
        defineTable("notes", { id: id(), g: never<ReturnType<typeof text>>(varchar("g").generatedAlwaysAs(drizzleSql`'x'`)) }));
      expectSchemaRejected("non-portable column type (varchar)", () =>
        defineTable("notes", { id: id(), v: never<ReturnType<typeof text>>(varchar("v", { length: 10 })) }));
      expectSchemaRejected("composite primary key option", () =>
        // @ts-expect-error — TableOptions has no primary-key option.
        defineTable("notes", { id: id(), a: text(), b: text() }, { primaryKey: [["a", "b"]] }));
      expectSchemaRejected("reference action other than fail-while-referenced", () => {
        const parent = defineTable("parents", { id: id() });
        // @ts-expect-error — `ref` takes only its target; delete actions are not supported.
        return { tables: { parent, child: defineTable("children", { id: id(), parentId: ref(() => parent.id, { onDelete: "cascade" }) }) } };
      });
      expectSchemaRejected("index over an unknown column key", () =>
        // @ts-expect-error — index entries list the table's own column keys.
        defineTable("notes", { id: id(), a: text() }, { indexes: [["missing"]] }));
    });

    it(tag("SQL-AC-004", `.default() values are checked against the column rule ${on}`), () => {
      expectSchemaAccepted("integer default 2147483647", () => defineTable("d1", { id: id(), n: integer().default(2147483647) }));
      expectSchemaRejected("integer default 2147483648", () => defineTable("d2", { id: id(), n: integer().default(2147483648) }));
      expectSchemaRejected("integer default 1.5", () => defineTable("d3", { id: id(), n: integer().default(1.5) }));
      expectSchemaRejected("number default Infinity", () => defineTable("d4", { id: id(), x: number().default(Number.POSITIVE_INFINITY) }));
      expectSchemaRejected("timestamp default -1", () => defineTable("d5", { id: id(), at: timestamp().default(-1) }));
      expectSchemaRejected("text default with unpaired surrogate", () => defineTable("d6", { id: id(), s: text().default("\uD800") }));
      expectSchemaRejected("text default with NUL", () => defineTable("d7", { id: id(), s: text().default("a\u0000") }));
      expectSchemaRejected("boolean default 1", () => defineTable("d8", { id: id(), b: boolean().default(never<boolean>(1)) }));
    });
  });
}

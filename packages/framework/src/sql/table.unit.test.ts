import { describe, expect, it } from "vitest";
import { tag } from "../../../../tests/support/tags.js";
import { FrameworkError } from "../core/errors.js";
import { boolean, id, integer, ref, text } from "./columns.js";
import { defineTable } from "./table.js";
import type { ColumnBuilders, TableOptions } from "./types.js";

function failure(fn: () => unknown): FrameworkError {
  try {
    fn();
  } catch (err) {
    if (err instanceof FrameworkError) return err;
    throw err;
  }
  throw new Error("expected a FrameworkError");
}

function rejected(name: string, cols: ColumnBuilders, options?: TableOptions, fragment?: string): void {
  const err = failure(() => defineTable(name, cols, options as never));
  expect(err.code).toBe("CORE.MISCONFIGURED");
  expect(err.message).toContain(JSON.stringify(name));
  if (fragment !== undefined) expect(err.message).toContain(fragment);
}

describe("defineTable: rejected schemas (SQL-REQ-001)", () => {
  it(tag("SQL-AC-001", "rejects an invalid table name"), () => {
    rejected("Notes", { id: id() }, undefined, "snake_case");
  });

  it(tag("SQL-AC-001", "rejects the reserved __framework_ prefix"), () => {
    rejected("__framework_notes", { id: id() }, undefined, "__framework_");
  });

  it(tag("SQL-AC-001", "rejects an invalid column key"), () => {
    rejected("notes", { id: id(), created_at: integer() }, undefined, '"created_at"');
  });

  it(tag("SQL-AC-001", "rejects a table with no id() column"), () => {
    rejected("notes", { title: text() }, undefined, "exactly one id()");
  });

  it(tag("SQL-AC-001", "rejects a table with two id() columns (no composite primary keys)"), () => {
    rejected("notes", { id: id(), otherId: id() }, undefined, "exactly one id()");
  });

  it.each([
    ["an onDelete action", { onDelete: "cascade" }],
    ["onDelete and onUpdate actions", { onDelete: "set null", onUpdate: "cascade" }],
    ["a bare action string", "cascade"],
    ["an explicit undefined", undefined],
  ] as const)(tag("SQL-AC-001", "rejects ref() given %s: only fail-while-referenced is supported"), (_label, action) => {
    const parents = defineTable("parents", { id: id() });
    const child = (ref as (...args: unknown[]) => ReturnType<typeof ref>)(() => parents.id, action);
    rejected("children", { id: id(), parentId: child }, undefined, '"parentId"');
    rejected("children", { id: id(), parentId: child.nullable() }, undefined, "reference actions");
  });

  it(tag("SQL-AC-001", "rejects a column that is not a framework column helper (e.g. a raw Drizzle column)"), () => {
    rejected("notes", { id: id(), raw: { notNull: () => undefined } as never }, undefined, '"raw"');
  });

  it(tag("SQL-AC-001", "rejects table options other than indexes and uniques (e.g. checks, primaryKey)"), () => {
    rejected("notes", { id: id() }, { checks: [] } as never, '"checks"');
    rejected("notes", { id: id() }, { primaryKey: ["id"] } as never, '"primaryKey"');
  });

  it(tag("SQL-AC-001", "rejects an index or unique entry naming an unknown column key"), () => {
    rejected("notes", { id: id(), n: integer() }, { indexes: [["nope"]] } as never, '"nope"');
    rejected("notes", { id: id(), n: integer() }, { uniques: [["n", "nope"]] } as never, '"nope"');
  });

  it(tag("SQL-AC-001", "rejects an empty index entry and a key repeated within one entry"), () => {
    rejected("notes", { id: id(), n: integer() }, { indexes: [[]] });
    rejected("notes", { id: id(), n: integer() }, { uniques: [["n", "n"]] }, '"n"');
  });

  it(tag("SQL-AC-001", "rejects the same unique column set declared twice"), () => {
    rejected("notes", { id: id(), n: integer().unique() }, { uniques: [["n"]] }, "twice");
    rejected("notes", { id: id(), a: integer(), b: integer() }, { uniques: [["a", "b"], ["b", "a"]] }, "twice");
  });

  it(tag("SQL-AC-001", "rejects an index whose generated name would exceed 63 characters"), () => {
    const longKey = "a" + "b".repeat(30);
    rejected("t".repeat(30), { id: id(), [longKey]: integer() }, { indexes: [[longKey]] }, "63");
  });

  it("accepts a table with every column type and option", () => {
    expect(() =>
      defineTable(
        "every",
        { id: id(), title: text().unique(), n: integer().default(0), flag: boolean().nullable() },
        { indexes: [["n", "flag"]], uniques: [["title", "n"]] },
      ),
    ).not.toThrow();
  });
});

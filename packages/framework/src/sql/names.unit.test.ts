import { describe, expect, it } from "vitest";
import { tag } from "../../../../tests/support/tags.js";
import { FrameworkError } from "../core/errors.js";
import { checkColumnKey, checkTableName, snakeCase } from "./names.js";

function failure(fn: () => unknown): FrameworkError {
  try {
    fn();
  } catch (err) {
    if (err instanceof FrameworkError) return err;
    throw err;
  }
  throw new Error("expected a FrameworkError");
}

describe("snakeCase: lowerCamelCase column keys to SQL names (SQL-REQ-001)", () => {
  it.each([
    ["title", "title"],
    ["createdAt", "created_at"],
    ["notebookId", "notebook_id"],
    ["aB1", "a_b1"],
    ["a1B", "a1_b"],
    ["pointX", "point_x"],
  ])(tag("SQL-AC-001", "maps %s to %s"), (key, sqlName) => {
    expect(snakeCase(key)).toBe(sqlName);
  });
});

describe("checkTableName (SQL-REQ-001)", () => {
  it.each(["notes", "note_tags", "t1", "a_1", "a".repeat(63)])("accepts %s", (name) => {
    expect(() => checkTableName(name)).not.toThrow();
  });

  it.each([
    ["", "empty"],
    ["Notes", "uppercase"],
    ["noteTags", "camelCase"],
    ["note-tags", "hyphen"],
    ["1notes", "leading digit"],
    ["_notes", "leading underscore"],
    ["notes_", "trailing underscore"],
    ["note__tags", "double underscore"],
    ["notés", "non-ASCII"],
    ["a".repeat(64), "longer than 63 bytes"],
    ["sqlite_stats", "SQLite-reserved prefix"],
  ])(tag("SQL-AC-001", "rejects %j (%s) with CORE.MISCONFIGURED naming the rule"), (name) => {
    const err = failure(() => checkTableName(name));
    expect(err.code).toBe("CORE.MISCONFIGURED");
    expect(err.message).toContain(JSON.stringify(name));
    expect(err.message).toContain("snake_case");
  });

  it(tag("SQL-AC-001", "rejects the reserved __framework_ prefix with a message naming it"), () => {
    const err = failure(() => checkTableName("__framework_kv"));
    expect(err.code).toBe("CORE.MISCONFIGURED");
    expect(err.message).toContain("__framework_");
  });

  it("accepts the reserved prefix for framework tables", () => {
    expect(() => checkTableName("__framework_kv", { framework: true })).not.toThrow();
  });
});

describe("checkColumnKey (SQL-REQ-001)", () => {
  it.each(["id", "title", "createdAt", "a1", "aBC"])("accepts %s", (key) => {
    expect(() => checkColumnKey("notes", key)).not.toThrow();
  });

  it.each([
    ["", "empty"],
    ["CreatedAt", "UpperCamelCase"],
    ["created_at", "snake_case"],
    ["created-at", "hyphen"],
    ["1st", "leading digit"],
    ["héllo", "non-ASCII"],
    ["a" + "B".repeat(32), "SQL name longer than 63 bytes"],
  ])(tag("SQL-AC-001", "rejects column key %j (%s)"), (key) => {
    const err = failure(() => checkColumnKey("notes", key));
    expect(err.code).toBe("CORE.MISCONFIGURED");
    expect(err.message).toContain(JSON.stringify(key));
    expect(err.message).toContain('"notes"');
  });
});

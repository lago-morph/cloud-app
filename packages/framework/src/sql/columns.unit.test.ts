import { describe, expect, it } from "vitest";
import { tag } from "../../../../tests/support/tags.js";
import { FrameworkError } from "../core/errors.js";
import { boolean, columnSpec, id, integer, number, ref, text, timestamp } from "./columns.js";

function failure(fn: () => unknown): FrameworkError {
  try {
    fn();
  } catch (err) {
    if (err instanceof FrameworkError) return err;
    throw err;
  }
  throw new Error("expected a FrameworkError");
}

describe("column helpers (sql.md §2.1)", () => {
  it.each([
    ["id", id()],
    ["text", text()],
    ["integer", integer()],
    ["number", number()],
    ["timestamp", timestamp()],
    ["boolean", boolean()],
  ] as const)("%s() is NOT NULL, not unique, without default", (kind, builder) => {
    expect(columnSpec(builder)).toEqual({ kind, nullable: false, unique: false, hasDefault: false });
  });

  it("ref() records its target lazily and is NOT NULL", () => {
    const target = () => {
      throw new Error("not called at definition");
    };
    const spec = columnSpec(ref(target));
    expect(spec).toMatchObject({ kind: "ref", nullable: false, unique: false, hasDefault: false });
    expect(spec?.target).toBe(target);
  });

  it("options return new builders and leave the original unchanged", () => {
    const base = text();
    const changed = base.nullable().unique().default("x");
    expect(columnSpec(base)).toEqual({ kind: "text", nullable: false, unique: false, hasDefault: false });
    expect(columnSpec(changed)).toEqual({ kind: "text", nullable: true, unique: true, hasDefault: true, defaultValue: "x" });
  });

  it("default() stores the checked value (negative zero as zero)", () => {
    expect(Object.is(columnSpec(number().default(-0))?.defaultValue, 0)).toBe(true);
  });

  it.each([
    ["integer", () => integer().default(2147483648)],
    ["text", () => text().default("a\uD800")],
    ["number", () => number().default(Number.NaN)],
    ["timestamp", () => timestamp().default(-1)],
    ["boolean", () => boolean().default(0 as unknown as boolean)],
    ["text (null)", () => text().nullable().default(null as unknown as string)],
  ])(tag("SQL-AC-001", "a %s default that breaks the column rule is rejected with SQL.INVALID_VALUE"), (_kind, make) => {
    expect(failure(make).code).toBe("SQL.INVALID_VALUE");
  });

  it.each([
    ["nullable", () => id().nullable()],
    ["unique", () => id().unique()],
    ["default", () => id().default("0f8fad5b-d9cb-469f-a165-70867728950e")],
  ])(tag("SQL-AC-001", "id() rejects %s: it is the primary key"), (_opt, make) => {
    const err = failure(make);
    expect(err.code).toBe("CORE.MISCONFIGURED");
    expect(err.message).toContain("id()");
  });

  it("values that are not framework builders have no spec", () => {
    expect(columnSpec({})).toBeUndefined();
    expect(columnSpec(null)).toBeUndefined();
  });
});

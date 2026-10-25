import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { tag } from "../../../../tests/support/tags.js";
import { FrameworkError } from "../core/errors.js";
import { parseStageConfig } from "./schema.js";

const FILE = "config/cloudflare/prod.json";

function rejection(text: string): FrameworkError {
  try {
    parseStageConfig(text, FILE);
  } catch (err) {
    if (err instanceof FrameworkError) return err;
    throw err;
  }
  throw new Error("expected the values file to be rejected");
}

const json = (value: unknown) => JSON.stringify(value);

describe("stage values file schema (stage-config.schema.json)", () => {
  it("accepts a minimal file; admins default to an empty list and users stay absent", () => {
    const file = parseStageConfig(json({ values: {}, framework: {} }), FILE);
    expect(file).toEqual({ values: {}, framework: { admins: [] } });
    expect("users" in file.framework).toBe(false);
  });

  it("accepts every value type and every framework field", () => {
    const text = json({
      values: { title: "Notes", limit: 3, open: true, tags: ["a", "b"] },
      framework: { admins: ["password:1"], users: ["password:2"], email: { senderName: "Notes Demo" } },
    });
    expect(parseStageConfig(text, FILE)).toEqual({
      values: { title: "Notes", limit: 3, open: true, tags: ["a", "b"] },
      framework: { admins: ["password:1"], users: ["password:2"], email: { senderName: "Notes Demo" } },
    });
  });

  it("framework.email may be empty; senderName is optional (MAIL-REQ-003)", () => {
    expect(parseStageConfig(json({ values: {}, framework: { email: {} } }), FILE).framework.email).toEqual({});
  });

  it("an empty users list is a users list (present, admitting nobody but admins)", () => {
    expect(parseStageConfig(json({ values: {}, framework: { users: [] } }), FILE).framework.users).toEqual([]);
  });

  it.each([
    ["at the top level", { values: {}, framework: {}, secrets: { apiKey: "x" } }, "secrets"],
    ["in framework", { values: {}, framework: { testStage: true } }, "framework.testStage"],
    ["in framework.email", { values: {}, framework: { email: { senderName: "Notes", from: "x" } } }, "framework.email.from"],
    ["framework.google (retired, DEC-0513)", { values: {}, framework: { google: { clientId: "id" } } }, "framework.google"],
  ])(tag("CFG-AC-006", "a values file with an unknown field %s is rejected, naming the field"), (_where, value, field) => {
    const err = rejection(json(value));
    expect(err.code).toBe("CORE.MISCONFIGURED");
    expect(err.message).toContain(FILE);
    expect(err.message).toContain(`unknown field "${field}"`);
  });

  it.each([
    ["values missing", { framework: {} }, '"values"'],
    ["framework missing", { values: {} }, '"framework"'],
    ["not an object", ["values"], "must be a JSON object"],
    ["a value of an unsupported type", { values: { limit: 1.5 }, framework: {} }, '"values.limit"'],
    ["a list value with a non-string item", { values: { tags: ["a", 1] }, framework: {} }, '"values.tags'],
    ["a nested object value", { values: { opts: { a: 1 } }, framework: {} }, '"values.opts"'],
    ["an empty admin ID", { values: {}, framework: { admins: [""] } }, '"framework.admins.0"'],
    ["a repeated admin ID", { values: {}, framework: { admins: ["u1", "u1"] } }, '"framework.admins"'],
    ["a repeated users ID", { values: {}, framework: { users: ["u1", "u1"] } }, '"framework.users"'],
    ["an empty senderName", { values: {}, framework: { email: { senderName: "" } } }, '"framework.email.senderName"'],
    ["a senderName over 64 characters", { values: {}, framework: { email: { senderName: "n".repeat(65) } } }, '"framework.email.senderName"'],
    ["a senderName holding an address", { values: {}, framework: { email: { senderName: "Me <me@example.test>" } } }, '"framework.email.senderName"'],
    ["a senderName with a line break", { values: {}, framework: { email: { senderName: "a\nb" } } }, '"framework.email.senderName"'],
    ["a senderName that is not a string", { values: {}, framework: { email: { senderName: 3 } } }, '"framework.email.senderName"'],
  ])("rejects a file with %s, naming where", (_label, value, where) => {
    const err = rejection(json(value));
    expect(err.code).toBe("CORE.MISCONFIGURED");
    expect(err.message).toContain(FILE);
    expect(err.message).toContain(where);
  });

  it("rejects text that is not JSON, naming the file", () => {
    const err = rejection("{ values: ");
    expect(err.message).toContain(FILE);
    expect(err.message).toContain("not valid JSON");
  });
});

describe("the Zod mirror matches the contract schema's fields", () => {
  const contract = JSON.parse(
    readFileSync(new URL("../../../../docs/contracts/schemas/stage-config.schema.json", import.meta.url), "utf8"),
  ) as {
    required: string[];
    properties: { framework: { properties: Record<string, { required?: string[]; properties?: object }> } };
  };

  it("required top-level fields and framework fields are the ones validated here", () => {
    expect(contract.required.sort()).toEqual(["framework", "values"]);
    expect(Object.keys(contract.properties).sort()).toEqual(["framework", "values"]);
    // DEC-0513/DEC-0514: no `google`; `email` holds only `senderName`.
    expect(Object.keys(contract.properties.framework.properties).sort()).toEqual(["admins", "email", "users"]);
    expect(contract.properties.framework.properties["email"]?.required).toBeUndefined();
    expect(Object.keys(contract.properties.framework.properties["email"]?.properties ?? {})).toEqual(["senderName"]);
  });

  it("senderName's bounds and pattern are the contract's", () => {
    const senderName = (contract.properties.framework.properties["email"]?.properties as Record<string, { minLength: number; maxLength: number; pattern: string }>)["senderName"];
    expect([senderName?.minLength, senderName?.maxLength]).toEqual([1, 64]);
    const pattern = new RegExp(senderName?.pattern ?? "");
    for (const name of ["Notes", "Notes Demo", "Ünïcode team", "x".repeat(64), "Me <a>", "a@b", 'say "hi"', "back\\slash", "a\rb", "x".repeat(65)]) {
      const accepted = (() => {
        try {
          parseStageConfig(json({ values: {}, framework: { email: { senderName: name } } }), FILE);
          return true;
        } catch {
          return false;
        }
      })();
      expect(accepted, name).toBe(pattern.test(name) && name.length >= 1 && name.length <= 64);
    }
  });
});

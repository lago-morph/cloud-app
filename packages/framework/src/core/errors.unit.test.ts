import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { tag } from "../../../../tests/support/tags.js";
import { ERROR_CATALOGUE, FrameworkError } from "./errors.js";

const SRC = fileURLToPath(new URL("..", import.meta.url));
const CONTRACT = fileURLToPath(new URL("../../../../docs/contracts/ts/errors.d.ts", import.meta.url));

/** Quoted literals shaped like a catalogue code (`"PREFIX.NAME"`), whatever the prefix. */
const CODE_LITERAL = /["'`]([A-Z]{2,8}\.[A-Z][A-Z_]*)["'`]/g;

function codeLiterals(source: string): string[] {
  return Array.from(source.matchAll(CODE_LITERAL), (m) => m[1] ?? "");
}

function frameworkSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith(".ts") && !e.name.endsWith(".unit.test.ts"))
    .map((e) => join(e.parentPath, e.name));
}

describe("error catalogue", () => {
  it("transcribes errors.d.ts exactly (codes, statuses, retryable, meanings, order)", () => {
    const contract = readFileSync(CONTRACT, "utf8");
    const entry = /readonly "([A-Z]+\.[A-Z_]+)":\s*\{ status: (\d+|null); retryable: (true|false);\s*meaning: "([^"]*)" \};/g;
    const expected = Array.from(contract.matchAll(entry), (m) => [
      m[1],
      { status: m[2] === "null" ? null : Number(m[2]), retryable: m[3] === "true", meaning: m[4] },
    ]);
    expect(expected.length).toBeGreaterThan(20);
    expect(Object.entries(ERROR_CATALOGUE)).toEqual(expected);
  });

  it("the code scanner finds code literals and ignores unquoted mentions", () => {
    const sample = `new FrameworkError("KV.NOPE", "x"); const c = 'SQL.CONFLICT'; // FILES.TICKET_EXPIRED retired`;
    expect(codeLiterals(sample)).toEqual(["KV.NOPE", "SQL.CONFLICT"]);
  });

  it(tag("CORE-AC-004", "every code literal in framework source appears in the catalogue"), () => {
    const files = frameworkSources(SRC);
    expect(files.length).toBeGreaterThan(10);
    const unknown: string[] = [];
    for (const file of files) {
      for (const code of codeLiterals(readFileSync(file, "utf8"))) {
        if (!(code in ERROR_CATALOGUE)) unknown.push(`${relative(SRC, file)}: ${code}`);
      }
    }
    expect(unknown).toEqual([]);
  });

  it("FrameworkError carries its code and is an Error", () => {
    const err = new FrameworkError("HTTP.CONFLICT", "limit reached");
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("HTTP.CONFLICT");
    expect(err.message).toBe("limit reached");
    expect(err.name).toBe("FrameworkError");
  });
});

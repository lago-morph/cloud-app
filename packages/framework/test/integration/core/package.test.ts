/**
 * CORE package-level criteria: the exports map (CORE-AC-005, exports-map part; the `verify`
 * part is B-T4's) and the catalogue completeness of framework source (CORE-AC-004, scan part).
 * Criteria: docs/components/core.md §4.
 */
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { tag } from "../../../../../tests/support/tags.js";
import { ERROR_CATALOGUE } from "../../../src/index.js";
import { FRAMEWORK_DIR, listFiles } from "./harness/harness.js";

/**
 * CORE-REQ-005's subpath table, without `./targets/aws`: this phase supports the local and
 * Cloudflare targets only ("one subpath per supported target"; DEC-PENDING-B-01-1, plan §11 Q3).
 */
const SUBPATHS = [".", "./client", "./testing", "./targets/local", "./targets/cloudflare", "./provision", "./check"];

/** Owning-component prefixes of the catalogue (errors.d.ts). */
const PREFIXES = [...new Set(Object.keys(ERROR_CATALOGUE).map((c) => c.split(".")[0]))];

describe("CORE package", () => {
  it(tag("CORE-AC-005", "exports-map part: the package's exports map equals the CORE-REQ-005 subpath table"), async () => {
    const pkg = JSON.parse(await readFile(join(FRAMEWORK_DIR, "package.json"), "utf8")) as {
      name: string;
      exports: Record<string, unknown>;
    };
    expect(pkg.name).toBe("@lago-morph/prototype-framework");
    expect(Object.keys(pkg.exports).sort()).toEqual([...SUBPATHS].sort());
    // No wildcard or extra subpath can expose internals.
    for (const key of Object.keys(pkg.exports)) expect(key).not.toContain("*");
  });

  it(tag("CORE-AC-004", "scan part: every error code in framework source appears in the catalogue"), async () => {
    const codePattern = new RegExp(String.raw`["'\`]((?:${PREFIXES.join("|")})\.[A-Z][A-Z0-9_]*)["'\`]`, "g");
    const constructed = /new\s+FrameworkError\s*\(\s*["'`]([^"'`]+)["'`]/g;
    const sources = (await listFiles(join(FRAMEWORK_DIR, "src"))).filter(
      (f) => /\.(?:ts|js|mjs)$/.test(f) && !/\.unit\.test\.ts$/.test(f),
    );
    expect(sources.length).toBeGreaterThan(0);
    const unknown: string[] = [];
    let found = 0;
    for (const file of sources) {
      const text = await readFile(file, "utf8");
      for (const m of text.matchAll(codePattern)) {
        found++;
        if (!(m[1]! in ERROR_CATALOGUE)) unknown.push(`${relative(FRAMEWORK_DIR, file)}: ${m[1]}`);
      }
      for (const m of text.matchAll(constructed)) {
        if (!(m[1]! in ERROR_CATALOGUE)) unknown.push(`${relative(FRAMEWORK_DIR, file)}: new FrameworkError(${m[1]})`);
      }
    }
    // The catalogue itself lives in framework source, so the scan always finds codes.
    expect(found).toBeGreaterThanOrEqual(Object.keys(ERROR_CATALOGUE).length);
    expect(unknown).toEqual([]);
  });
});

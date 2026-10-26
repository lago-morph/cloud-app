/**
 * CORE-REQ-005's subpath table against the package's exports map (CORE-AC-005, exports-map part,
 * unit level). The integration suite checks the same map; this test also checks that each
 * subpath's compiled files come from a framework source module (DEC-0111), so a subpath such as
 * a subpath cannot be listed without code behind it. Release 1 has no `./targets/aws` (DEC-0508).
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { tag } from "../../../../tests/support/tags.js";

const FRAMEWORK_DIR = fileURLToPath(new URL("../..", import.meta.url));

/** CORE-REQ-005: exactly these subpaths, one per supported target (local, cloudflare). */
const SUBPATHS = [".", "./client", "./testing", "./targets/local", "./targets/cloudflare", "./provision", "./check"];

const pkg = JSON.parse(readFileSync(`${FRAMEWORK_DIR}package.json`, "utf8")) as { exports: Record<string, { types?: unknown; default?: unknown }> };

describe("CORE package exports map (CORE-REQ-005)", () => {
  it(tag("CORE-AC-005", "exports-map part, unit level: the exports map equals the subpath table (release 1: no ./targets/aws)"), () => {
    expect(Object.keys(pkg.exports).sort()).toEqual([...SUBPATHS].sort());
  });

  it.each(SUBPATHS)("subpath %s points at compiled dist files built from an existing source module", (subpath) => {
    const entry = pkg.exports[subpath];
    expect(typeof entry?.types).toBe("string");
    expect(typeof entry?.default).toBe("string");
    const js = String(entry?.default);
    expect(js).toMatch(/^\.\/dist\/.+\.js$/);
    expect(entry?.types).toBe(js.replace(/\.js$/, ".d.ts"));
    expect(existsSync(`${FRAMEWORK_DIR}${js.replace(/^\.\/dist\//, "src/").replace(/\.js$/, ".ts")}`), js).toBe(true);
  });
});

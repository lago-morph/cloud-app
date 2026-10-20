import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { scanSourceTags } from "../tools/traceability.js";
import { readCatalogue } from "./catalogue.js";
import { UNIT_LEVEL } from "./expected.js";
import { runnerSelection, scopeTests, uncovered } from "./selection.js";

const repo = new URL("../../../", import.meta.url).pathname;

// Root cause 2026-10-20-E2E-004-coverage-and-not-run, causes A and B.
describe("[E2E-004] coverage is computed from the runners' listing with the driver's selection", () => {
  it("a source scan cannot see the KV/SQL tags built at run time; the runners' titles can", () => {
    // What E2E-004 scanned before the fix: the test file and the helper that defines its tests.
    const scanned = ["tests/compliance/criteria/kv/kv.pglite.test.ts", "tests/compliance/criteria/kv/suite.ts", "tests/compliance/criteria/sql/sql.pglite.test.ts", "tests/compliance/criteria/sql/suite.ts"].flatMap((f) => scanSourceTags(readFileSync(`${repo}${f}`, "utf8")));
    expect(scanned).not.toContain("KV-AC-001");
    expect(scanned).not.toContain("SQL-AC-003");
    // The same tests as Vitest names them in the run (raw/vitest.json of record xc3s44jl2dbmqpv).
    const listed = scopeTests(runnerSelection({ target: "local" })[0]!, [
      { title: "KV shared case set (in-process PGlite) > [KV-AC-001][KV-AC-004] put, overwrite, get", file: "tests/compliance/criteria/kv/kv.pglite.test.ts" },
      { title: "SQL shared case set (in-process PGlite) > [SQL-AC-003] typed insert and select", file: "tests/compliance/criteria/sql/sql.pglite.test.ts" },
    ]);
    expect(uncovered(["KV-AC-001", "KV-AC-004", "SQL-AC-003", "KV-AC-002"], listed)).toEqual(["KV-AC-002"]);
  });

  it("local selection is the driver's: integration config, unit config for unit-level IDs only, the two Playwright projects", () => {
    const local = runnerSelection({ target: "local" });
    expect(local.map((s) => [s.runner, s.label, s.args.join(" ")])).toEqual([
      ["vitest", "vitest", "vitest run --config vitest.integration.config.ts"],
      ["vitest", "vitest-unit", "vitest run --config vitest.unit.config.ts"],
      ["playwright", "playwright", "playwright test --project integration --project e2e"],
    ]);
    expect(local[1]?.onlyIds).toEqual(UNIT_LEVEL);
    expect(local[0]?.onlyIds).toBeUndefined();
    const cloud = runnerSelection({ target: "cloudflare" });
    expect(cloud.map((s) => s.args.join(" "))).toEqual(["vitest run --config vitest.integration.config.ts tests/compliance/criteria", "playwright test --project integration --project e2e tests/compliance/"]);
    expect(runnerSelection({ target: "local", selfTest: true }).map((s) => s.args.join(" "))).toEqual(["vitest run --config tests/compliance/harness/self-test/vitest.config.ts"]);
  });

  it("a unit-layer test covers only unit-level IDs: the fixture literal [KV-AC-001] in tags.unit.test.ts covers nothing", () => {
    const unit = runnerSelection({ target: "local" })[1]!;
    const listed = scopeTests(unit, [
      { title: "test tags > rejects the malformed ID \"[KV-AC-001]\"", file: "tests/support/tags.unit.test.ts" },
      { title: "[COMPL-AC-007][KV-AC-002] deploy database discovery", file: "packages/framework/src/provision/core/databases.unit.test.ts" },
    ]);
    expect(listed).toEqual([{ title: "[COMPL-AC-007][KV-AC-002] deploy database discovery", file: "packages/framework/src/provision/core/databases.unit.test.ts", ids: ["COMPL-AC-007"] }]);
    expect(uncovered(["KV-AC-001", "KV-AC-002", "COMPL-AC-007"], listed)).toEqual(["KV-AC-001", "KV-AC-002"]);
  });

  it("every unit-level ID is a Local criterion of the catalogue", () => {
    const catalogue = new Map(readCatalogue(`${repo}docs`).map((e) => [e.id, e]));
    for (const id of UNIT_LEVEL) expect(catalogue.get(id)?.applies.local?.automated, id).toBe(true);
  });
});

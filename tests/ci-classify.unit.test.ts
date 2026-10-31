// CI change classification (plan-v0.2.0 §7a.2.4): scripts/ci/classify.mjs against the committed
// scripts/ci/path-map.json. Each case is a PR's changed files and the layers it must select.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { classify, globToRegExp, loadMap, matches } from "../scripts/ci/classify.mjs";

interface Result {
  docs: string[];
  testInputs: string[];
  unit: { all: boolean; files: string[] };
  linters: string[];
  build: boolean;
  integration: Record<string, string[]>;
  e2e: { all: boolean; specs: string[] };
  chromium: boolean;
}
const REPO = join(import.meta.dirname, "..");
const map = loadMap(REPO) as { components: Record<string, { dependsOn: string[]; integration: string[] }>; testInputs: { unit?: string[] }[]; e2e: { ui: string[]; specs: string[] } };
const run = (...files: string[]): Result => classify(files, map) as Result;
const components = (r: Result): string[] => Object.keys(r.integration).sort();

describe("glob matching", () => {
  it("anchors at the repository root; ** spans directories, * one segment, {a,b} alternatives", () => {
    expect(globToRegExp("docs/**").test("docs/a/b.md")).toBe(true);
    expect(globToRegExp("docs/**").test("x/docs/a.md")).toBe(false);
    expect(globToRegExp("**/*.md").test("README.md")).toBe(true);
    expect(globToRegExp("**/*.md").test("a/b/c.md")).toBe(true);
    expect(globToRegExp("docs/*.md").test("docs/a/b.md")).toBe(false);
    expect(globToRegExp("tsconfig*.json").test("tsconfig.app.json")).toBe(true);
    expect(globToRegExp("p/{src,bin}/**/*.{ts,js}").test("p/bin/x/y.js")).toBe(true);
    expect(globToRegExp("p/{src,bin}/**/*.{ts,js}").test("p/test/y.js")).toBe(false);
    expect(globToRegExp("a.b").test("aXb")).toBe(false);
  });

  it("a leading ! excludes what earlier globs matched", () => {
    expect(matches("src/auth/password/x.ts", ["src/auth/**", "!src/auth/password/**"])).toBe(false);
    expect(matches("src/auth/x.ts", ["src/auth/**", "!src/auth/password/**"])).toBe(true);
  });
});

describe("classification", () => {
  it("docs, specs and plans that no test reads run no test and no build", () => {
    const r = run("docs/CONVENTIONS.md", "docs/README.md", "ai/implementation/plan.md", "retrospective/x.md", "README.md");
    expect(r.docs).toHaveLength(5);
    expect(r).toMatchObject({ build: false, unit: { all: false, files: [] }, e2e: { all: false, specs: [] }, chromium: false, linters: [] });
    expect(components(r)).toEqual([]);
  });

  it("a doc that tests read selects exactly the listed tests, never e2e and never dependents", () => {
    const r = run("docs/acceptance/e2e-scenarios.md");
    expect(r.testInputs).toEqual(["docs/acceptance/e2e-scenarios.md"]);
    expect(r.unit.all).toBe(false);
    expect(r.unit.files).toContain("tests/compliance/harness/catalogue.unit.test.ts");
    expect(components(r)).toEqual(["COMPL"]);
    expect(r.e2e).toEqual({ all: false, specs: [] });
    expect(run("docs/contracts/ts/errors.d.ts").linters).toEqual(["typecheck"]);
  });

  it("framework source: the unit layer, its component and direct dependents, the local e2e projects, eslint", () => {
    const r = run("packages/framework/src/kv/store.ts");
    expect(r.unit.all).toBe(true);
    expect(components(r)).toEqual(["CF", "COMPL", "KV", "LOCAL"]);
    expect(r.integration["LOCAL"]).toEqual(["depends on KV"]);
    expect(r.e2e.all).toBe(true);
    expect(r.chromium).toBe(true);
    expect(r.linters).toEqual(expect.arrayContaining(["eslint", "typecheck", "pack"]));
  });

  it("a unit test change runs the unit layer only", () => {
    const r = run("packages/framework/src/kv/store.unit.test.ts");
    expect(r.unit.all).toBe(true);
    expect(components(r)).toEqual([]);
    expect(r.e2e.all).toBe(false);
  });

  it("an integration test change runs its component's integration tests (no dependents) and never e2e", () => {
    const r = run("packages/framework/test/integration/kv/kv.sqlite.test.ts", "tests/compliance/criteria/sql/suite.ts");
    expect(components(r)).toEqual(["KV", "SQL"]);
    expect(r.e2e.all).toBe(false);
    expect(r.chromium).toBe(false);
  });

  it("a change only to e2e specs runs only those specs, with Chromium only for a browser spec", () => {
    const api = run("tests/compliance/e2e/E2E-002.spec.ts");
    expect(api).toMatchObject({ unit: { all: false }, e2e: { all: false, specs: ["tests/compliance/e2e/E2E-002.spec.ts"] }, chromium: false });
    expect(components(api)).toEqual([]);
    expect(run("tests/compliance/e2e/E2E-005.spec.ts").chromium).toBe(true);
  });

  it("shared inputs (lockfile, root configs, core, config, testing, build, harness) run every component", () => {
    for (const f of ["package-lock.json", "vitest.integration.config.ts", "packages/framework/src/core/errors.ts", "packages/framework/src/testing/x.ts", "tests/compliance/harness/driver.ts"]) {
      expect(components(run(f)), f).toEqual(Object.keys(map.components).sort());
    }
    expect(run("tests/compliance/harness/driver.ts").e2e.all).toBe(false);
  });

  it("a workflow change runs everything", () => {
    const r = run(".github/workflows/ci.yml");
    expect(r).toMatchObject({ unit: { all: true }, e2e: { all: true }, chromium: true, build: true });
    expect(components(r)).toEqual(Object.keys(map.components).sort());
  });

  it("planned v0.2.0 paths are pre-declared", () => {
    expect(components(run("packages/framework/src/auth-app/worker.ts"))).toContain("AUTH");
    expect(components(run("packages/framework/src/admin-app/pages.ts"))).toContain("SETUP");
    expect(components(run("tests/support/mock-oauth2/server.ts"))).toContain("AUTH");
  });
});

describe("the path map", () => {
  it("names only existing test files and components", () => {
    const codes = Object.keys(map.components);
    for (const [code, c] of Object.entries(map.components)) {
      for (const dep of c.dependsOn) expect(codes, `${code} depends on ${dep}`).toContain(dep);
      for (const dir of c.integration) expect(existsSync(join(REPO, dir)), dir).toBe(true);
    }
    for (const f of [...map.testInputs.flatMap((t) => t.unit ?? []), ...map.e2e.ui]) expect(existsSync(join(REPO, f)), f).toBe(true);
    for (const f of map.e2e.ui) expect(matches(f, map.e2e.specs), f).toBe(true);
  });

  it("dependsOn mirrors docs/architecture/component-map.md §3", () => {
    const text = readFileSync(join(REPO, "docs/architecture/component-map.md"), "utf8");
    const table = (heading: string): string[] => ((text.split(`### ${heading}`)[1] ?? "").split(/\n##/)[0] ?? "").split("\n").filter((l) => /^\| \[`/.test(l)).map((l) => /`([A-Z]+)`/.exec(l)?.[1] ?? "");
    const capabilities = table("Capabilities").filter((c) => c !== "GOOGLE");
    const targets = table("Targets").filter((c) => c !== "AWS");
    const rows = (text.split("## 3. Dependencies")[1] ?? "").split("\n").filter((l) => /^\| [A-Z]/.test(l) && !l.startsWith("| Component"));
    for (const row of rows) {
      const [names = "", deps = ""] = row.split("|").slice(1, 3).map((s) => s.trim());
      const wanted = deps.startsWith("All capability and target") ? [...capabilities, ...targets] : deps.startsWith("All capability") ? capabilities : deps.split(",").map((s) => s.trim()).filter((s) => /^[A-Z]+$/.test(s) && s !== "AWS");
      for (const name of names.split(",").map((s) => s.trim()).filter((s) => s !== "AWS")) {
        expect(map.components[name]?.dependsOn.slice().sort(), name).toEqual([...new Set(wanted)].sort());
      }
    }
  });
});

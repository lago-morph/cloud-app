// CI change classification (plan-v0.2.0 §7a.2.4): scripts/ci/classify.mjs against the committed
// scripts/ci/path-map.json. Each case is a PR's changed files and the layers it must select.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ciPlan, classify, githubOutput, globToRegExp, loadMap, matches, UNTAGGED } from "../scripts/ci/classify.mjs";

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

  it("the skill, the template and the reference app select SKILL, whose tests compare the examples with them", () => {
    for (const f of ["skill/reference/kv.md", "skill/examples/notes.md", "apps/template/src/server/app.ts", "apps/reference/src/server/app.ts", "QUICKSTART.md", "packages/framework/README.md"]) {
      expect(components(run(f)), f).toContain("SKILL");
    }
    expect(run("packages/framework/README.md").linters).toContain("pack");
  });

  it("shared test support also runs the e2e projects (every spec imports it)", () => {
    expect(run("tests/support/tags.ts").e2e.all).toBe(true);
  });

  it("planned v0.2.0 paths are pre-declared", () => {
    expect(components(run("packages/framework/src/auth-app/worker.ts"))).toContain("AUTH");
    expect(components(run("packages/framework/src/admin-app/pages.ts"))).toContain("SETUP");
    expect(components(run("tests/support/mock-oauth2/server.ts"))).toContain("AUTH");
  });
});

describe("the CI plan (what the staged ci.yml runs)", () => {
  interface Plan { unit: string; unitFiles: string[]; ids: string[]; direct: string[]; alsoE2e: string[]; chromium: boolean }
  const plan = (...files: string[]): Plan => ciPlan(run(...files), map, REPO) as Plan;

  it("a criteria doc runs COMPL's tagged criteria through the harness and the catalogue unit tests; no e2e ID", () => {
    const p = plan("docs/acceptance/e2e-scenarios.md");
    expect(p.unit).toBe("files");
    expect(p.unitFiles).toContain("tests/compliance/harness/catalogue.unit.test.ts");
    expect(p.ids).toContain("COMPL-AC-001");
    expect(p.ids.filter((id) => id.startsWith("E2E-"))).toEqual([]);
    expect(p.direct).toEqual([]);
  });

  it("framework source: criteria IDs of the component and its dependents, e2e IDs of every spec, untagged framework suites run directly", () => {
    const p = plan("packages/framework/src/kv/store.ts");
    expect(p.unit).toBe("all");
    expect(p.ids).toEqual(expect.arrayContaining(["KV-AC-001", "E2E-001", "E2E-016", "DEMO-AC-001"]));
    expect(p.direct).toEqual(["packages/framework/test/integration/kv", "packages/framework/test/integration/local"]);
    expect(p.chromium).toBe(true);
  });

  it("an e2e spec change runs only that spec's IDs", () => {
    const p = plan("tests/compliance/e2e/E2E-002.spec.ts");
    expect(p).toMatchObject({ unit: "none", ids: ["DEMO-AC-010", "E2E-002"], direct: [], alsoE2e: [], chromium: false });
  });

  it("an integration ID also tagged in an e2e spec names that spec, which the harness runs too", () => {
    const p = plan("packages/framework/test/integration/cli/verify.test.ts");
    expect(p.ids).toContain("CHECK-AC-005");
    expect(p.alsoE2e).toEqual(["tests/compliance/e2e/demo-local.spec.ts"]);
    expect(p.chromium).toBe(true);
  });

  it("docs off the test-input list: nothing to run", () => {
    expect(githubOutput(plan("docs/README.md"), run("docs/README.md"))).toBe(["build=false", "linters=", "unit=none", "unit_files=", "ids=", "direct=", "chromium=false"].join("\n") + "\n");
  });
});

describe("the staged ci.yml (scripts/ci/workflows/ci.yml, DEC-0637)", () => {
  const yml = readFileSync(join(REPO, "scripts/ci/workflows/ci.yml"), "utf8");

  it("runs on pull requests only and prints the classification first", () => {
    expect(yml).toMatch(/\non:\n {2}pull_request:\n\n/);
    expect(yml).not.toMatch(/\n {2}push:/);
    expect(yml).toContain('node scripts/ci/classify.mjs --base "$PR_BASE" --github-output "$GITHUB_OUTPUT"');
  });

  it("reads every classify output it uses, and selects criteria only through the harness", () => {
    const keys = githubOutput({ unit: "none", unitFiles: [], ids: [], direct: [], alsoE2e: [], chromium: false }, run()).split("\n").filter(Boolean).map((l: string) => l.split("=")[0]);
    for (const k of keys) expect(yml, k).toContain(`${k}: \${{ steps.classify.outputs.${k} }}`);
    expect(yml).toContain('npm run compliance -- --target local --only "$IDS"');
    expect(yml).toContain(`-t '${UNTAGGED as string}'`);
    expect(yml).not.toMatch(/test:integration|test:e2e/);
  });

  it("sets the reference app's local test secret before the harness runs, from a fresh random value", () => {
    const secret = yml.indexOf("npm run secrets -- set apiKey --target local --stage local");
    expect(secret).toBeGreaterThan(0);
    expect(secret).toBeLessThan(yml.indexOf("npm run compliance -- --target local --only"));
    expect(yml).toContain("randomBytes(24)");
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

  it("e2e.ui (the Playwright e2e-ui project) is exactly the specs that drive a browser", () => {
    // A browser fixture in a test's arguments, a Chromium launch, a new page, or the template-pages
    // driver (which E2E-001 runs as a child process with Chromium).
    const BROWSER = /\(\{[^})]*\b(?:page|browser|context)\b[^})]*\}\)|\bchromium\b|\.newPage\(|template-pages/;
    const dir = join(REPO, "tests/compliance/e2e");
    const specs = readdirSync(dir).filter((f) => f.endsWith(".spec.ts")).map((f) => `tests/compliance/e2e/${f}`);
    const browser = specs.filter((f) => BROWSER.test(readFileSync(join(REPO, f), "utf8")));
    expect(browser.length).toBeGreaterThan(0);
    expect(map.e2e.ui.slice().sort()).toEqual(browser.sort());
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

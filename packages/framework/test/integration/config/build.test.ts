/**
 * CFG build-time criteria through the package binary's `build` command (CLI-REQ-001) on an
 * on-disk fixture app: values-file validation and per-stage file selection (CFG-AC-002), the
 * resolved configuration's secret locations (CFG-AC-004), and schema rejection of unknown
 * fields (CFG-AC-006). Criteria: docs/components/config.md §4.
 */
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { tag } from "../../../../../tests/support/tags.js";
import { devFixtureFiles, listFiles, makeTempApp, runCli, stageConfig, type TempApp } from "../core/harness/harness.js";

let app: TempApp | undefined;
afterEach(async () => {
  await app?.remove();
  app = undefined;
});

const LOCAL = ["build", "--target", "local", "--stage", "local"];
const cloudflare = (stage: string) => ["build", "--target", "cloudflare", "--stage", stage];

async function fixture(overrides: Record<string, string | null> = {}): Promise<TempApp> {
  const files: Record<string, string> = devFixtureFiles({ name: "bt1cfgapp" });
  for (const [path, content] of Object.entries(overrides)) {
    if (content === null) delete files[path];
    else files[path] = content;
  }
  return makeTempApp(files);
}

describe("CFG-AC-002 values files", () => {
  it("control for CFG-AC-002: complete values files build for local and a test stage", async () => {
    app = await fixture();
    const local = await runCli(LOCAL, { cwd: app.dir });
    expect(local.status, local.output).toBe(0);
    const test = await runCli(cloudflare("test-bt1cfg"), { cwd: app.dir });
    expect(test.status, test.output).toBe(0);
  });

  it(tag("CFG-AC-002", "a build fails naming the key when a value is missing"), async () => {
    app = await fixture({ "config/local.json": stageConfig({ limit: 3 }) });
    const res = await runCli(LOCAL, { cwd: app.dir });
    expect(res.status).not.toBe(0);
    expect(res.status).not.toBeNull();
    expect(res.output).toContain("greeting");
  });

  it(tag("CFG-AC-002", "a build fails naming the key when a value has the wrong type"), async () => {
    for (const bad of [{ greeting: "x", limit: "five" }, { greeting: "x", limit: 2.5 }, { greeting: 7 }]) {
      app = await fixture({ "config/local.json": stageConfig(bad) });
      const res = await runCli(LOCAL, { cwd: app.dir });
      expect(res.status, JSON.stringify(bad)).not.toBe(0);
      expect(res.status).not.toBeNull();
      expect(res.output, JSON.stringify(bad)).toContain(typeof bad.greeting === "number" ? "greeting" : "limit");
      await app.remove();
      app = undefined;
    }
  });

  it(tag("CFG-AC-002", "a build fails naming the key when the values file names an undeclared key"), async () => {
    app = await fixture({ "config/local.json": stageConfig({ greeting: "x", bt1UndeclaredKey: "y" }) });
    const res = await runCli(LOCAL, { cwd: app.dir });
    expect(res.status).not.toBe(0);
    expect(res.status).not.toBeNull();
    expect(res.output).toContain("bt1UndeclaredKey");
  });

  it(tag("CFG-AC-002", "a build for a stage named test-<id> uses config/<target>/test.json"), async () => {
    // A valid test.json and no file of the stage's own: the build succeeds…
    app = await fixture({ "config/cloudflare/test.json": stageConfig({ greeting: "from test.json" }) });
    const ok = await runCli(cloudflare("test-bt1abc"), { cwd: app.dir });
    expect(ok.status, ok.output).toBe(0);
    await app.remove();
    // …and an invalid value in test.json makes it fail naming the key, so test.json is what it read.
    app = await fixture({ "config/cloudflare/test.json": stageConfig({ greeting: "x", limit: "wrong" }) });
    const bad = await runCli(cloudflare("test-bt1abc"), { cwd: app.dir });
    expect(bad.status).not.toBe(0);
    expect(bad.status).not.toBeNull();
    expect(bad.output).toContain("limit");
  });

  it(tag("CFG-AC-002", "a build for a non-test stage without its own values file fails naming the missing file, even when test.json exists"), async () => {
    app = await fixture();
    const res = await runCli(cloudflare("bt1prod"), { cwd: app.dir });
    expect(res.status).not.toBe(0);
    expect(res.status).not.toBeNull();
    expect(res.output).toContain("config/cloudflare/bt1prod.json");
  });

  it(tag("CFG-AC-002", "a non-test stage reads only its own file and never test.json"), async () => {
    // Own file valid, test.json invalid: the production-stage build must not read test.json.
    app = await fixture({
      "config/cloudflare/bt1prod.json": stageConfig({ greeting: "from prod" }),
      "config/cloudflare/test.json": stageConfig({ greeting: "x", limit: "wrong" }),
    });
    const res = await runCli(cloudflare("bt1prod"), { cwd: app.dir });
    expect(res.status, res.output).toBe(0);
  });
});

describe("CFG-AC-004 secret locations", () => {
  /** SEC-REQ-003: local and Cloudflare locations are `SECRET_<NAME>`. */
  const SECRETS: [string, string][] = [
    ["apiKey", "SECRET_API_KEY"],
    ["unsetSecret", "SECRET_UNSET_SECRET"],
  ];

  for (const [label, args] of [
    ["local", LOCAL],
    ["cloudflare test stage", cloudflare("test-bt1loc")],
  ] as const) {
    it(tag("CFG-AC-004", `the resolved configuration of a ${label} build lists every declared secret with its target location`), async () => {
      app = await fixture();
      const res = await runCli(args, { cwd: app.dir });
      expect(res.status, res.output).toBe(0);
      const generated = await listFiles(join(app.dir, ".framework"));
      expect(generated.length, "build wrote nothing under .framework/").toBeGreaterThan(0);
      for (const [name, location] of SECRETS) {
        const holders: string[] = [];
        for (const f of generated) {
          const text = await readFile(f, "utf8");
          if (text.includes(name) && text.includes(location)) holders.push(relative(app.dir, f));
        }
        expect(holders, `${name} → ${location}`).not.toEqual([]);
      }
    });
  }
});

describe("CFG-AC-006 unknown fields", () => {
  const cases: [string, string, string][] = [
    ["top-level field", JSON.stringify({ values: { greeting: "x" }, framework: {}, bt1Password: "hunter2" }), "bt1Password"],
    ["framework field", JSON.stringify({ values: { greeting: "x" }, framework: { bt1ClientSecret: "s" } }), "bt1ClientSecret"],
    ["google field", JSON.stringify({ values: { greeting: "x" }, framework: { google: { clientId: "bt1-fake-client-id", bt1Secret: "s" } } }), "bt1Secret"],
  ];
  for (const [label, file, field] of cases) {
    it(tag("CFG-AC-006", `a values file containing an unknown ${label} is rejected by schema validation`), async () => {
      app = await fixture({ "config/local.json": file });
      const res = await runCli(LOCAL, { cwd: app.dir });
      expect(res.status).not.toBe(0);
      expect(res.status).not.toBeNull();
      expect(res.output).toContain(field);
    });
  }
});

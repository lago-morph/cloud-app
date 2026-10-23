/**
 * CFG build-time criteria through the package binary's `build` command (CLI-REQ-001) on an
 * on-disk fixture app: values-file validation and per-stage file selection (CFG-AC-002), the
 * resolved configuration's secret locations (CFG-AC-004), and schema rejection of unknown
 * fields (CFG-AC-006). Criteria: docs/components/config.md §4.
 */
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
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

  /**
   * config.md §2 Delivery (DEC-0063): the resolved configuration is embedded as a generated
   * JavaScript module with no imports whose default export is the resolved configuration as
   * JSON data; `ResolvedConfig` holds the deployment and each declared secret as
   * `{ name, location }`. Finds every such module the build wrote, by importing each candidate
   * module (no imports, a default export) and keeping those whose default export has the
   * ResolvedConfig shape.
   */
  async function resolvedConfigs(dir: string): Promise<{ file: string; config: Record<string, unknown> }[]> {
    const out: { file: string; config: Record<string, unknown> }[] = [];
    for (const f of await listFiles(join(dir, ".framework"))) {
      if (!/\.(m?js)$/.test(f)) continue;
      const text = await readFile(f, "utf8");
      if (!/\bexport\s+default\b/.test(text)) continue;
      if (/^\s*import\b|\bimport\s*\(|\brequire\s*\(|^\s*export\s+[^;]*\bfrom\b/m.test(text)) continue;
      let mod: unknown;
      try {
        mod = await import(`${pathToFileURL(f).href}?t=${String(Date.now())}`);
      } catch {
        continue; // not a plain data module (e.g. a Worker bundle needing its runtime)
      }
      const value: unknown = mod !== null && typeof mod === "object" ? Reflect.get(mod, "default") : undefined;
      if (value === null || typeof value !== "object") continue;
      if (!("secrets" in value) || !("deployment" in value) || !("values" in value)) continue;
      out.push({ file: relative(dir, f), config: value as Record<string, unknown> });
    }
    return out;
  }

  for (const [label, args, target, stage] of [
    ["local", LOCAL, "local", "local"],
    ["cloudflare test stage", cloudflare("test-bt1loc"), "cloudflare", "test-bt1loc"],
  ] as const) {
    it(tag("CFG-AC-004", `the resolved configuration of a ${label} build lists every declared secret with its target location`), async () => {
      app = await fixture();
      const res = await runCli(args, { cwd: app.dir });
      expect(res.status, res.output).toBe(0);
      const found = (await resolvedConfigs(app.dir)).filter(({ config }) => {
        const d = config["deployment"];
        return d !== null && typeof d === "object" && Reflect.get(d, "stage") === stage && Reflect.get(d, "target") === target;
      });
      expect(
        found.map((f) => f.file),
        `exactly one resolved-configuration module for ${target}/${stage} under .framework/`,
      ).toHaveLength(1);
      const secrets = found[0]?.config["secrets"];
      expect(Array.isArray(secrets), `secrets in ${String(found[0]?.file)}: ${JSON.stringify(secrets)}`).toBe(true);
      // Every declared secret, each exactly once, with its logical name and this target's location.
      const entries = (secrets as unknown[]).map((e) => ({
        name: e !== null && typeof e === "object" ? Reflect.get(e, "name") : undefined,
        location: e !== null && typeof e === "object" ? Reflect.get(e, "location") : undefined,
      }));
      const byName = (a: { name: unknown }, b: { name: unknown }): number => String(a.name).localeCompare(String(b.name));
      expect(entries.sort(byName)).toStrictEqual(SECRETS.map(([name, location]) => ({ name, location })).sort(byName));
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

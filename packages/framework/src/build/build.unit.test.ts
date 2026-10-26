/**
 * The build pipeline (cli.md §2 "`build` generates the target entry points under `.framework/`";
 * core.md §2 "Deployment identity"; config.md §2 "Delivery"; CORE-REQ-006, CF-REQ-003,
 * PROV-REQ-005). Fixture apps import the framework's sources by absolute path (the package's
 * `dist/` is not built in the unit layer); the generated entry imports the target runtime from
 * the sources too (`runtimeImport`), so the bundle holds one copy of the framework.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { unstable_startWorker } from "wrangler";
import { tag } from "../../../../tests/support/tags.js";
import { FrameworkError } from "../core/errors.js";
import { buildApp, loadApp, type BuildOptions } from "./public.js";
import { readDeployedOrigin, recordDeployOutput } from "../cli/commands/smoke.js";

const SRC = dirname(dirname(fileURLToPath(import.meta.url)));
const runtimeImport = (target: string) => join(SRC, "targets", target, "public.ts");

const APP_SOURCE = (name: string, extra = "") => `
import { configString, defineApp, defineTable, id, text } from ${JSON.stringify(join(SRC, "index.ts"))};
import { greet } from "./server/greet";
const notes = defineTable("notes", { id: id(), title: text() });
export const app = defineApp({
  name: ${JSON.stringify(name)},
  config: { greeting: configString() },
  secrets: ["apiKey"],
  tables: { notes },
  routes: (api) => {
    api.get("/hello", (c) => c.json({ greeting: greet(c.var.config.get("greeting")) }));
  },
});
${extra}
`;

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fixture(files: Record<string, string>, name = "buildunit"): string {
  const dir = mkdtempSync(join(tmpdir(), "b16-build-"));
  dirs.push(dir);
  const all: Record<string, string> = {
    "src/app.ts": APP_SOURCE(name, "export default app;"),
    "src/server/greet.ts": "export function greet(g: string): string { return `${g}!`; }\n",
    "config/local.json": JSON.stringify({ values: { greeting: "marker-local-json" }, framework: {} }),
    "config/cloudflare/test.json": JSON.stringify({ values: { greeting: "marker-cf-test-json" }, framework: {} }),
    "config/cloudflare/prod.json": JSON.stringify({ values: { greeting: "marker-cf-prod-json" }, framework: {} }),
    ...files,
  };
  for (const [path, content] of Object.entries(all)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

function options(appDir: string, target: "local" | "cloudflare", stage: string): BuildOptions {
  return { appDir, target, stage, runtimeImport: runtimeImport(target) };
}

describe("loadApp", () => {
  it("loads the defineApp result exported by src/app.ts (default or named app)", async () => {
    const dir = fixture({});
    expect((await loadApp(dir)).definition.name).toBe("buildunit");
    const named = fixture({ "src/app.ts": APP_SOURCE("namedonly") });
    expect((await loadApp(named)).definition.name).toBe("namedonly");
    expect(existsSync(join(dir, ".framework", ".load"))).toBe(false);
  });

  it("fails with CORE.MISCONFIGURED when src/app.ts is missing or exports no app", async () => {
    const empty = mkdtempSync(join(tmpdir(), "b16-build-empty-"));
    dirs.push(empty);
    await expect(loadApp(empty)).rejects.toThrow(/src\/app\.ts/);
    const none = fixture({ "src/app.ts": "export const nothing = 1;\n" });
    await expect(loadApp(none)).rejects.toThrow(FrameworkError);
  });
});

describe("buildApp --target cloudflare", () => {
  // cli.md §2: `deploy` records each stage's origin in `.framework/<target>/stages/<stage>.json` for
  // `smoke` and `check-login`. A later build of the app (another stage's deploy) must keep them:
  // the compliance driver deploys the run stage, then prodcheck, then runs the tests (which deploy
  // further stages from the same app directory), then check-login on prodcheck.
  it("a build keeps the recorded deploy outputs of every stage under .framework/<target>/stages/", async () => {
    const dir = fixture({ "config/cloudflare/prodcheck.json": JSON.stringify({ values: { greeting: "p" }, framework: {} }) });
    await buildApp(options(dir, "cloudflare", "test-run1"));
    recordDeployOutput(dir, "cloudflare", "test-run1", "https://reference-test-run1.sub.workers.dev");
    await buildApp(options(dir, "cloudflare", "prodcheck"));
    recordDeployOutput(dir, "cloudflare", "prodcheck", "https://reference-prodcheck.sub.workers.dev");
    await buildApp(options(dir, "cloudflare", "test-other"));
    expect(readDeployedOrigin(dir, "cloudflare", "test-run1")).toBe("https://reference-test-run1.sub.workers.dev");
    expect(readDeployedOrigin(dir, "cloudflare", "prodcheck")).toBe("https://reference-prodcheck.sub.workers.dev");
  });

  it(tag("PROV-AC-005", "build part: a test-<id> stage reads config/cloudflare/test.json and includes the mock"), async () => {
    const dir = fixture({});
    const result = await buildApp(options(dir, "cloudflare", "test-b16"));
    expect(result.deployment).toMatchObject({ stage: "test-b16", target: "cloudflare", isTestStage: true });
    const bundle = readFileSync(result.bundle, "utf8");
    expect(result.bundle.startsWith(join(dir, ".framework"))).toBe(true);
    expect(bundle).toContain("__framework/health");
    expect(bundle).toContain("marker-cf-test-json");
    expect(bundle).not.toContain("marker-cf-prod-json");
    expect(bundle).toContain("mock-login");
  });

  it(tag("PROV-AC-005", "build part: a production stage reads its own file and has no mock or mock-login route"), async () => {
    const dir = fixture({});
    const result = await buildApp(options(dir, "cloudflare", "prod"));
    const bundle = readFileSync(result.bundle, "utf8");
    expect(bundle).toContain("marker-cf-prod-json");
    expect(bundle).not.toContain("marker-cf-test-json");
    expect(bundle).not.toContain("mock-login");
    expect(result.modules.some((m) => m.endsWith("auth/mock.ts"))).toBe(false);
  });

  // MAIL §2: the test stages' mail capture and its route are imported only by test-stage entries.
  const TEST_MAIL_ROUTE = /__framework\/test-mail/;
  const CAPTURE_MODULE = /mail\/test-stage\.ts$/;

  for (const stage of ["prod", "prodcheck", "mytest-1"]) {
    it(`a production stage (${stage}) bundles no test-mail capture or route, but the Email Service sender`, async () => {
      const dir = fixture({ [`config/cloudflare/${stage}.json`]: JSON.stringify({ values: { greeting: `marker-${stage}` }, framework: {} }) });
      const result = await buildApp(options(dir, "cloudflare", stage));
      const bundle = readFileSync(result.bundle, "utf8");
      expect(bundle).not.toMatch(TEST_MAIL_ROUTE);
      expect(result.modules.some((m) => CAPTURE_MODULE.test(m))).toBe(false);
      expect(result.modules.some((m) => /mail\/cloudflare\.ts$/.test(m))).toBe(true);
      expect(bundle).toContain("FRAMEWORK_MAIL_FROM");
    });
  }

  it("a test-<id> stage bundles the test-mail capture and its route", async () => {
    const dir = fixture({});
    const result = await buildApp(options(dir, "cloudflare", "test-b16"));
    expect(readFileSync(result.bundle, "utf8")).toMatch(TEST_MAIL_ROUTE);
    expect(result.modules.some((m) => CAPTURE_MODULE.test(m))).toBe(true);
  });

  it(tag("CFG-AC-002", "build part: a production stage without its own values file fails naming the file, even with test.json present"), async () => {
    const dir = fixture({});
    await expect(buildApp(options(dir, "cloudflare", "prodcheck"))).rejects.toThrow(/config\/cloudflare\/prodcheck\.json/);
  });

  it(tag("CFG-AC-002", "build part: a wrong value type fails naming the key"), async () => {
    const dir = fixture({ "config/cloudflare/test.json": JSON.stringify({ values: { greeting: 3 }, framework: {} }) });
    await expect(buildApp(options(dir, "cloudflare", "test-b16"))).rejects.toThrow(/greeting/);
  });

  it(tag("CORE-AC-007", "build part: an app name with a hyphen fails naming the app-name rule"), async () => {
    const dir = fixture({ "src/app.ts": APP_SOURCE("bad-name", "export default app;") });
    await expect(buildApp(options(dir, "cloudflare", "test-b16"))).rejects.toThrow(/app-name rule/);
  });

  it("fails when the app declares a reserved secret name", async () => {
    const dir = fixture({ "src/app.ts": APP_SOURCE("buildunit", "export default app;").replace('["apiKey"]', '["frameworkThing"]') });
    await expect(buildApp(options(dir, "cloudflare", "test-b16"))).rejects.toThrow(/reserved/);
  });

  for (const stage of ["test-b16", "prod"]) {
    it(tag("CORE-AC-006", `build part, stage ${stage}: the Cloudflare bundle bundles no Postgres harness, stub provider, local transfer route, test helpers, provisioning or tooling module`), async () => {
      const dir = fixture({});
      const result = await buildApp(options(dir, "cloudflare", stage));
      const excluded = [/@electric-sql\/pglite/, /drizzle-orm\/pglite/, /auth\/stub-provider/, /files\/local\//, /\/testing\//, /\/provision\//, /\/(wrangler|drizzle-kit|esbuild|vite|vitest|typescript|eslint|miniflare)\//];
      for (const module of result.modules) for (const pattern of excluded) expect(module).not.toMatch(pattern);
      const bundle = readFileSync(result.bundle, "utf8");
      expect(bundle).not.toMatch(/__framework\/files/);
      expect(bundle).not.toMatch(/stubLoginProvider|loginWithStub|stubFailure/);
    });
  }

  it(tag("CF-AC-003", "build part: the Worker bundle imports no Node.js module (no filesystem access)"), async () => {
    const dir = fixture({});
    const result = await buildApp(options(dir, "cloudflare", "prod"));
    const bundle = readFileSync(result.bundle, "utf8");
    expect(bundle).not.toMatch(/(?:from\s*|import\(\s*|require\(\s*)["'](?:node:)?(?:fs|fs\/promises|child_process|worker_threads|url|path|os)["']/);
  });

  it(tag("CF-AC-003", "build part: node:crypto and node:async_hooks stay external; any other Node.js module fails the build naming it"), async () => {
    const allowed = fixture({
      "src/server/greet.ts":
        'import { createHash } from "node:crypto";\nimport { AsyncLocalStorage } from "node:async_hooks";\nconst als = new AsyncLocalStorage();\nexport function greet(g: string): string { return als.run(1, () => `${g}!${createHash("sha256").update(g).digest("hex").length}`); }\n',
    });
    const result = await buildApp(options(allowed, "cloudflare", "prod"));
    const bundle = readFileSync(result.bundle, "utf8");
    expect(bundle).toMatch(/from\s*"node:crypto"/);
    expect(bundle).toMatch(/from\s*"node:async_hooks"/);

    const disallowed = fixture({ "src/server/greet.ts": 'import { sep } from "node:path";\nexport function greet(g: string): string { return g + sep; }\n' });
    await expect(buildApp(options(disallowed, "cloudflare", "prod"))).rejects.toThrow(/node:path/);
  });

  it(tag("CFG-AC-004", "build part: the embedded resolved configuration lists each declared secret with its location"), async () => {
    const dir = fixture({});
    const result = await buildApp(options(dir, "cloudflare", "test-b16"));
    const config = readFileSync(result.configModule, "utf8");
    expect(config).toContain('"apiKey"');
    expect(config).toContain('"SECRET_API_KEY"');
  });
});

describe("buildApp --target local", () => {
  it("writes the local Worker bundle and a wrangler.jsonc with the local D1 and R2 bindings", async () => {
    const dir = fixture({});
    const result = await buildApp(options(dir, "local", "local"));
    expect(result.wranglerConfig).toBeDefined();
    const config = JSON.parse(readFileSync(result.wranglerConfig ?? "", "utf8")) as { main: string; d1_databases: { binding: string }[]; r2_buckets: { binding: string }[] };
    expect(config.main).toBe("worker.js");
    expect(config.d1_databases[0]?.binding).toBe("DB");
    expect(config.r2_buckets[0]?.binding).toBe("FILES");
    expect((config as unknown as { compatibility_flags: string[] }).compatibility_flags).toEqual(["nodejs_compat"]);
    expect(config).not.toHaveProperty("send_email");
    const bundle = readFileSync(result.bundle, "utf8");
    expect(bundle).toContain("marker-local-json");
    expect(bundle).toContain("__framework/files");
  });

  it("the local bundle runs in workerd and answers app routes and JSON 404s", async () => {
    const dir = fixture({});
    const result = await buildApp(options(dir, "local", "local"));
    const worker = await unstable_startWorker({ config: result.wranglerConfig ?? "", dev: { server: { port: 0 }, inspector: false, persist: false } as never });
    try {
      const hello = await worker.fetch("http://localhost/api/hello");
      expect(await hello.json()).toEqual({ greeting: "marker-local-json!" });
      const missing = await worker.fetch("http://localhost/api/nope");
      expect(missing.status).toBe(404);
      expect(((await missing.json()) as { error: { code: string } }).error.code).toBe("HTTP.NOT_FOUND");
    } finally {
      await worker.dispose();
    }
  }, 120_000);
});

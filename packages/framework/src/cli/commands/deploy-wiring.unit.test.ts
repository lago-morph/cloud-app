/**
 * The real bindings of the cloud commands (D-05): what `deploy` builds and reads before the PROV
 * core runs, the client's static assets, and the Cloudflare operations built from the process
 * environment. No Cloudflare call is made: the API is reached only through a stubbed `fetch`.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COMPATIBILITY_DATE } from "../../build/build.js";
import { createDeployment } from "../../core/identity.js";
import type { WorkerCode } from "../../provision/cloudflare/sst.js";
import { BINDINGS } from "../../targets/cloudflare/bindings.js";
import { buildClientAssets, cloudflareOperations, prepareDeploy, targetOperations, type PrepareDeps } from "./deploy.js";

function appDir(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "d05-deploy-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

function prepareDeps(overrides: Partial<PrepareDeps> = {}): PrepareDeps & { built: string[] } {
  const built: string[] = [];
  return {
    built,
    build: async (o) => {
      built.push(`${o.target} ${o.stage}`);
      return {
        deployment: createDeployment({ app: "notes", stage: o.stage, target: o.target }),
        resolved: { deployment: createDeployment({ app: "notes", stage: o.stage, target: o.target }), values: {}, secrets: [{ name: "apiKey", location: "SECRET_API_KEY" }], email: { senderName: "Notes" } },
        outDir: join(o.appDir, ".framework", o.target),
        bundle: join(o.appDir, ".framework", o.target, "worker.js"),
      };
    },
    buildClient: async (dir, out) => (built.push(`client ${out.slice(dir.length)}`), out),
    frameworkMigrationsDir: appDir({ "sqlite/0000_framework_tables.sql": "CREATE TABLE a (x text);" }),
    accountId: "acc123",
    ...overrides,
  };
}

describe("deploy: preparing a Cloudflare deployment", () => {
  it("builds the stage, then its client into .framework/cloudflare/client, and hands the built Worker to the target", async () => {
    const dir = appDir({ "migrations/sqlite/0000_init.sql": "CREATE TABLE notes (id text);" });
    const deps = prepareDeps();
    const prepared = await prepareDeploy(deps)(dir, "cloudflare", "test-abc");
    expect(deps.built).toEqual(["cloudflare test-abc", "client /.framework/cloudflare/client"]);
    expect(prepared.app).toBe("notes");
    expect(prepared.requiredSecrets).toEqual(["apiKey"]);
    expect("googleClientId" in prepared).toBe(false);
    expect(prepared.migrations.framework.map((m) => m.id)).toEqual(["framework/0000_framework_tables"]);
    expect(prepared.migrations.app.map((m) => m.id)).toEqual(["app/0000_init"]);
    const code = prepared.code as WorkerCode;
    expect(code).toEqual({
      bundle: join(dir, ".framework", "cloudflare", "worker.js"),
      assetsDirectory: join(dir, ".framework", "cloudflare", "client"),
      compatibilityDate: COMPATIBILITY_DATE,
      variables: { [BINDINGS.r2AccountId]: "acc123", [BINDINGS.filesBucket]: "notes-test-abc-files" },
      logBucketBinding: BINDINGS.logs,
    });
  });

  it("an app without a client (no index.html) deploys without static assets", async () => {
    const prepared = await prepareDeploy(prepareDeps({ buildClient: async () => undefined }))(appDir(), "cloudflare", "test-abc");
    expect((prepared.code as WorkerCode).assetsDirectory).toBeUndefined();
  });

  it("without CLOUDFLARE_ACCOUNT_ID the ticket variables are left out (the preflight names the missing credential)", async () => {
    const prepared = await prepareDeploy(prepareDeps({ accountId: undefined }))(appDir(), "cloudflare", "test-abc");
    expect((prepared.code as WorkerCode).variables).toEqual({ [BINDINGS.filesBucket]: "notes-test-abc-files" });
  });
});

describe("deploy: the client's static assets", { timeout: 60_000 }, () => {
  it("builds index.html and its scripts with Vite into the output directory (no app Vite configuration)", async () => {
    const dir = appDir({
      "index.html": '<!doctype html><html><body><script type="module" src="/src/client/main.ts"></script></body></html>',
      "src/client/main.ts": 'document.title = "built";\n',
      "vite.config.ts": "throw new Error('the app Vite configuration must not be read');\n",
    });
    const out = join(dir, ".framework", "cloudflare", "client");
    expect(await buildClientAssets(dir, out)).toBe(out);
    const html = readFileSync(join(out, "index.html"), "utf8");
    expect(html).toMatch(/<script type="module" crossorigin src="\/assets\/[^"]+\.js">/);
  });

  it("returns undefined, building nothing, when the app has no index.html", async () => {
    const dir = appDir();
    expect(await buildClientAssets(dir, join(dir, "out"))).toBeUndefined();
    expect(existsSync(join(dir, "out"))).toBe(false);
  });
});

describe("cloud commands: the Cloudflare operations from the process environment", () => {
  it("sends the API token from CLOUDFLARE_API_TOKEN to the account's paths (here a stubbed fetch)", async () => {
    const requests: { url: string; auth: string | null }[] = [];
    const stub: typeof fetch = async (input, init) => {
      requests.push({ url: String(input), auth: new Headers(init?.headers).get("authorization") });
      // The signing credential's record (DEC-0550) is an object: absent here.
      if (String(input).includes("/objects/")) return new Response(JSON.stringify({ success: false, errors: [{ code: 10007, message: "The specified key does not exist." }] }), { status: 404 });
      return new Response(JSON.stringify({ success: true, result: { subdomain: "sub" } }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const ops = cloudflareOperations({ env: { CLOUDFLARE_API_TOKEN: "placeholder", CLOUDFLARE_ACCOUNT_ID: "acc123" }, fetch: stub, requireCredentials: true })({ appDir: appDir(), target: "cloudflare" });
    expect(ops.target).toBe("cloudflare");
    await ops.inspectAccount();
    expect(requests.length).toBeGreaterThan(0);
    for (const r of requests) {
      expect(r.url.startsWith("https://api.cloudflare.com/client/v4/accounts/acc123/")).toBe(true);
      expect(r.auth).toBe("Bearer placeholder");
    }
  });

  it("with requireCredentials, a missing credential variable is named before any request", () => {
    let requested = false;
    const stub: typeof fetch = async () => ((requested = true), new Response("{}"));
    const make = cloudflareOperations({ env: { CLOUDFLARE_API_TOKEN: "placeholder" }, fetch: stub, requireCredentials: true });
    expect(() => make({ appDir: appDir(), target: "cloudflare" })).toThrow(/CLOUDFLARE_ACCOUNT_ID/);
    expect(requested).toBe(false);
  });

  it("for deploy (no requireCredentials) the target is built, so its preflight names every missing credential", async () => {
    const ops = cloudflareOperations({ env: {}, fetch: async () => new Response("{}"), requireCredentials: false })({ appDir: appDir(), target: "cloudflare" });
    expect(await ops.preflight({ app: "notes", stage: "test-abc" })).toEqual(["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]);
  });
});

describe("deploy: the per-target operations factory (release 1: local and Cloudflare, DEC-0508)", () => {
  it("a target with no provisioning is refused before anything is built", async () => {
    const deps = prepareDeps();
    await expect(prepareDeploy(deps)(appDir(), "local", "local")).rejects.toThrow(/no provisioning for target local/);
    expect(deps.built).toEqual([]);
  });

  it("deploy's binding takes the Cloudflare operations from the per-target factory; local and unknown targets have none", () => {
    const make = targetOperations({ env: { CLOUDFLARE_API_TOKEN: "placeholder", CLOUDFLARE_ACCOUNT_ID: "acc123" }, requireCredentials: false });
    expect(make({ appDir: appDir(), target: "cloudflare" }).target).toBe("cloudflare");
    expect(() => make({ appDir: appDir(), target: "local" })).toThrow(/no provisioning operations for target local/);
    expect(() => make({ appDir: appDir(), target: "aws" as never })).toThrow(/no provisioning operations for target aws/);
  });
});

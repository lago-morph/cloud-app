import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ACCOUNT, FakeCloud } from "../../../packages/framework/src/provision/cloudflare/fake-cloud.test-support.js";
import { stageLeftovers } from "./leftovers.js";
import { cloudflareOperations } from "../../../packages/framework/src/cli/commands/deploy.js";
import { FakeTarget } from "../../../packages/framework/src/provision/core/fake-target.js";
import { installAwsNetworkGuard } from "../../../packages/framework/src/provision/aws/aws-network-guard.test-support.js";
import type { TargetOperations } from "../../../packages/framework/src/provision/core/operations.js";
import { AWS_CALLS_REPORT_PREFIX } from "./aws-usage.js";
import { cliStageOps, deployOrigin, devOrigin, generateTestSecret, pendingStageStore, readVersions, runProcess, secretsNotSet, stageResourceOperations, type OperationsFactory } from "./node-deps.js";

const repo = new URL("../../../", import.meta.url).pathname;
let dir: string | undefined;
afterEach(() => {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("driver process helpers", () => {
  it("finds the origin `dev` prints", () => {
    expect(devOrigin("dev: built reference\n\n  reference is running at http://localhost:5179/  (client and /api; Ctrl-C stops)\n")).toBe("http://localhost:5179");
    expect(devOrigin("dev: built reference\n")).toBeUndefined();
  });

  it("finds the stage's workers.dev origin in deploy output", () => {
    expect(deployOrigin("deploy: done\nPublic origin: https://reference-test-abc.sub.workers.dev\n")).toBe("https://reference-test-abc.sub.workers.dev");
    expect(deployOrigin("deploy: done\n")).toBeUndefined();
  });

  it("finds the stage's CloudFront origin in AWS deploy output, never the Function URL", () => {
    const out = "deploy: done\nFunction https://abc123.lambda-url.eu-west-1.on.aws/\nPublic origin: https://d1a2b3c4d5e6f7.cloudfront.net\n";
    expect(deployOrigin(out, "aws")).toBe("https://d1a2b3c4d5e6f7.cloudfront.net");
    expect(deployOrigin("Public origin: https://reference-test-abc.sub.workers.dev\n", "aws")).toBeUndefined();
    expect(deployOrigin("Function https://abc123.lambda-url.eu-west-1.on.aws/\n", "aws")).toBeUndefined();
  });

  it("keeps pending test stages in a file, per target", () => {
    dir = mkdtempSync(join(tmpdir(), "pending-"));
    const store = pendingStageStore(join(dir, "sub", "pending-stages.json"));
    expect(store.list("cloudflare")).toEqual([]);
    store.add("cloudflare", "test-a");
    store.add("cloudflare", "test-b");
    store.add("cloudflare", "test-a");
    store.remove("cloudflare", "test-b");
    expect(pendingStageStore(join(dir, "sub", "pending-stages.json")).list("cloudflare")).toEqual(["test-a"]);
    expect(store.list("aws")).toEqual([]);
  });

  it("reads exact framework and dependency versions from the installed packages", () => {
    const versions = readVersions(repo);
    expect(versions["@lago-morph/prototype-framework"]).toBe("0.1.0");
    expect(versions.node).toBe(process.version);
    expect(versions.vitest).toMatch(/^\d+\.\d+\.\d+/);
    expect(versions["@playwright/test"]).toMatch(/^\d+\.\d+\.\d+/);
    expect(versions.wrangler).toMatch(/^\d+\.\d+\.\d+/);
  });
});

/** A `fetch` that answers the Cloudflare API from D-03's in-memory account, plus a D1 database list. */
function cloudFetch(cloud: FakeCloud, databases: readonly { uuid: string; name: string }[], seen: string[]): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    seen.push(url.pathname);
    if (url.pathname.endsWith("/d1/database")) {
      const result = url.searchParams.get("page") === "1" ? databases : [];
      return Response.json({ success: true, errors: [], messages: [], result, result_info: { page: 1, total_pages: 1, count: result.length } });
    }
    const path = `${url.pathname.replace(/^\/client\/v4/, "")}${url.search}`;
    const reply = await cloud.api((init?.method ?? "GET") as Parameters<FakeCloud["api"]>[0], path, init?.body === undefined || init.body === null ? undefined : JSON.parse(String(init.body)));
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

describe("the driver's Cloudflare leftover check (D-06-2; COMPL-REQ-004, PROV §2)", () => {
  const ENV = { CLOUDFLARE_API_TOKEN: "placeholder", CLOUDFLARE_ACCOUNT_ID: ACCOUNT };
  const stage = { app: "reference", stage: "test-abc" };
  const worker = () => ({ secrets: new Map<string, string>(), enabled: true, previews: false, bindings: [] });

  it("reads every resource of the removal list through the framework's listStageResources, by exact name", async () => {
    const cloud = FakeCloud.withSharedResources();
    cloud.workers.set("reference-test-abc", worker());
    cloud.workers.set("reference-test-abcd", worker());
    cloud.buckets.set("reference-test-abc-files", new Set());
    cloud.tokens.set("tok9", { name: "reference-test-abc-files-signing", resources: {} });
    cloud.buckets.get("sst-state")!.add("app/reference/test-abc").add("app/reference/test-abcd");
    const dbs = [
      { uuid: "u1", name: "reference-test-abc-db-1" },
      { uuid: "u2", name: "reference-test-abcd-db-1" },
    ];
    const seen: string[] = [];
    const ops = await stageResourceOperations(repo, "cloudflare", { env: ENV, fetch: cloudFetch(cloud, dbs, seen) });
    expect(await stageLeftovers(ops, stage)).toEqual([
      "database reference-test-abc-db-1",
      "Worker reference-test-abc",
      "R2 bucket reference-test-abc-files",
      "R2 API token tok9",
      "SST state object app/reference/test-abc",
    ]);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((p) => p.startsWith(`/client/v4/accounts/${ACCOUNT}/`))).toBe(true);
  });

  it("an emptied stage has no leftovers", async () => {
    const ops = await stageResourceOperations(repo, "cloudflare", { env: ENV, fetch: cloudFetch(FakeCloud.withSharedResources(), [], []) });
    expect(await stageLeftovers(ops, stage)).toEqual([]);
  });

  it("refuses, before any request, when credentials are missing, fetch would bypass the proxy, or the target has no operations", async () => {
    const seen: string[] = [];
    const fetch = cloudFetch(FakeCloud.withSharedResources(), [], seen);
    await expect(stageResourceOperations(repo, "cloudflare", { env: {}, fetch })).rejects.toThrow(/CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID/);
    await expect(stageResourceOperations(repo, "cloudflare", { env: { ...ENV, HTTPS_PROXY: "http://proxy:1" }, fetch })).rejects.toThrow(/NODE_USE_ENV_PROXY=1/);
    // AWS goes through the framework's per-target factory (G-11): without AWS credentials it refuses before any
    // request, which the driver records as a failed leftover check, never as none.
    await expect(stageResourceOperations(repo, "aws", { env: ENV, fetch })).rejects.toThrow(/missing AWS credentials: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY/);
    expect(seen).toEqual([]);
    const proxied = await stageResourceOperations(repo, "cloudflare", { env: { ...ENV, HTTPS_PROXY: "http://proxy:1", NODE_USE_ENV_PROXY: "1" }, fetch });
    expect(await stageLeftovers(proxied, stage)).toEqual([]);
  });

  it("with AWS credentials the default factory gives the AWS operations (G-10), built without any request", async () => {
    const guard = installAwsNetworkGuard();
    try {
      const ops = await stageResourceOperations(repo, "aws", { env: { AWS_ACCESS_KEY_ID: "AKIDPLACEHOLDER", AWS_SECRET_ACCESS_KEY: "placeholder" } });
      expect((ops as TargetOperations).target).toBe("aws");
      expect(typeof ops.listStageResources).toBe("function");
      expect(guard.attempts).toEqual([]);
    } finally {
      guard.uninstall();
    }
  });
});

describe("the run stage's test secret (D-07; DEC-0277)", () => {
  const ENV = { CLOUDFLARE_API_TOKEN: "placeholder", CLOUDFLARE_ACCOUNT_ID: ACCOUNT };

  it("generates a long random value of letters and digits, different each time", () => {
    const a = generateTestSecret();
    const b = generateTestSecret();
    expect(a).toMatch(/^[A-Za-z0-9]{32}$/);
    expect(b).toMatch(/^[A-Za-z0-9]{32}$/);
    expect(a).not.toBe(b);
  });

  it("recognises a deploy that stopped only because secrets are unset (first deploy after step 5, or the preflight)", () => {
    expect(secretsNotSet("deploy failed at step code: required secrets are not set: apiKey\nnext: set them with secrets set")).toBe(true);
    expect(secretsNotSet("missing prerequisites:\n  - secret apiKey is not set (set it with secrets set)")).toBe(true);
    expect(secretsNotSet("deploy failed at step infrastructure: SST failed")).toBe(false);
  });

  it("passes standard input to the process and hides the given values in its live echo, line by line", async () => {
    const echoed: string[] = [];
    const value = "Zq8hidden0value0K3";
    const result = await runProcess(
      { command: process.execPath, args: ["-e", "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{process.stdout.write('got '+s.length+'\\n'+s.slice(0,4));process.stdout.write(s.slice(4)+' end\\n')})"], cwd: repo, env: { PATH: process.env.PATH ?? "" }, input: value, redact: [value] },
      (text) => echoed.push(text),
    );
    expect(result.status).toBe(0);
    expect(result.output).toBe(`got ${String(value.length)}\n${value} end\n`);
    expect(echoed.join("")).toBe(`got ${String(value.length)}\n<test-secret> end\n`);
    expect(echoed.join("")).not.toContain(value.slice(0, 8));
  });

  it("setting the value through the framework's Cloudflare operations is one API request", async () => {
    const cloud = FakeCloud.withSharedResources();
    cloud.workers.set("reference-test-abc", { secrets: new Map<string, string>(), enabled: true, previews: false, bindings: [] });
    const seen: string[] = [];
    const make = cloudflareOperations({ env: ENV, requireCredentials: true, fetch: cloudFetch(cloud, [], seen) });
    const ops = make({ appDir: join(repo, "apps", "reference"), target: "cloudflare" });
    await ops.setSecret({ app: "reference", stage: "test-abc" }, "apiKey", "Zq8hidden0value0K3");
    expect(seen).toEqual([`/client/v4/accounts/${ACCOUNT}/workers/scripts/reference-test-abc/secrets`]);
    expect(cloud.workers.get("reference-test-abc")?.secrets.get("SECRET_API_KEY")).toBe("Zq8hidden0value0K3");
  });
});

// plan-aws.md G-T4: the AWS leftover check goes through the AWS `listStageResources` (PROV §2), here a fake
// target behind the operations interface (the real factory is the CLI's `targetOperations`, G-11). No AWS request is made.
describe("[COMPL-AC-004] AWS leftovers through listStageResources (fake target)", () => {
  const STAGE = "test-awsleft0000001";
  /** The leftover check runs in the driver process: with no proxy variable it needs no NODE_USE_ENV_PROXY. */
  const AWS_ENV = { AWS_REGION: "eu-west-1" };

  function fakeAws(): { fake: FakeTarget; factory: OperationsFactory; seen: { target: string; requireCredentials: boolean; appDir: string }[] } {
    const fake = new FakeTarget({ dialect: "postgres", databases: [{ name: `reference-${STAGE}-db-2` }, { name: `reference-${STAGE}x-db-1` }, { name: "reference-prodcheck-db-1" }] });
    fake.stageState({ app: "reference", stage: STAGE }).resources.push({ kind: "Lambda function", id: `reference-${STAGE}-http` }, { kind: "SSM parameter", id: `/reference/${STAGE}/secrets/apiKey` });
    const seen: { target: string; requireCredentials: boolean; appDir: string }[] = [];
    const factory: OperationsFactory = (options) => (input) => {
      seen.push({ target: input.target, requireCredentials: options.requireCredentials, appDir: input.appDir });
      return fake;
    };
    return { fake, factory, seen };
  }

  it("lists the stage's databases by the exact pattern and its resources by exact identifier, wired as remove wires them", async () => {
    const { fake, factory, seen } = fakeAws();
    const ops = cliStageOps(repo, "aws", { operations: factory, env: AWS_ENV });
    expect(await ops.listStageResources(STAGE)).toEqual([`database reference-${STAGE}-db-2`, `Lambda function reference-${STAGE}-http`, `SSM parameter /reference/${STAGE}/secrets/apiKey`]);
    expect(seen).toEqual([{ target: "aws", requireCredentials: true, appDir: join(repo, "apps", "reference") }]);
    expect(fake.calls).toEqual([`listStageResources reference/${STAGE}`]);
  });

  it("a removed stage has no leftovers; a failing listing rejects (the driver records it as a failed check)", async () => {
    const { fake, factory } = fakeAws();
    fake.stages.clear();
    fake.databases.delete(`reference-${STAGE}-db-2`);
    expect(await cliStageOps(repo, "aws", { operations: factory, env: AWS_ENV }).listStageResources(STAGE)).toEqual([]);
    fake.fail("listStageResources", new Error("AccessDenied"));
    await expect(cliStageOps(repo, "aws", { operations: factory, env: AWS_ENV }).listStageResources(STAGE)).rejects.toThrow("AccessDenied");
  });

  it("refuses non-test stages", async () => {
    const { factory } = fakeAws();
    await expect(cliStageOps(repo, "aws", { operations: factory, env: AWS_ENV }).listStageResources("prodcheck")).rejects.toThrow(/test stages only/);
  });

  it("deploys through the CLI with --target aws and takes the CloudFront origin; Cloudflare operations count no clusters", async () => {
    const calls: string[][] = [];
    const run = (call: { args: readonly string[] }): Promise<{ status: number; output: string }> => {
      calls.push([...call.args]);
      return Promise.resolve({ status: 0, output: `deploy: done\nPublic origin: https://d111111abcdef8.cloudfront.net\n${AWS_CALLS_REPORT_PREFIX}0\n` });
    };
    const ops = cliStageOps(repo, "aws", { run });
    expect((await ops.deploy(STAGE)).baseUrl).toBe("https://d111111abcdef8.cloudfront.net");
    expect(calls).toEqual([["prototype-framework", "deploy", "--target", "aws", "--stage", STAGE]]);
    expect(typeof ops.testStageClusters).toBe("function");
    expect(typeof ops.lambdaFunctions).toBe("function");
    expect(ops.apiCalls?.()).toBe(0);
    expect(cliStageOps(repo, "cloudflare").testStageClusters).toBeUndefined();
    expect(cliStageOps(repo, "cloudflare").lambdaFunctions).toBeUndefined();
  });

  // G-EV F4: the account's region, read as the framework reads it (the log bucket's location); G-EV F3: fakes mark the record.
  it("reads the account's region through the given account reader, on AWS only", async () => {
    const seen: (string | undefined)[] = [];
    const ops = cliStageOps(repo, "aws", { env: { AWS_REGION: "us-west-1", HTTPS_PROXY: "http://proxy:3128" }, accountRegion: (env) => (seen.push(env.https_proxy), Promise.resolve("eu-north-1")) });
    expect(await ops.region?.()).toBe("eu-north-1");
    // The reader gets the CLI's AWS child environment (proxy variables paired), as deploy and smoke build it.
    expect(seen).toEqual(["http://proxy:3128"]);
    expect(cliStageOps(repo, "cloudflare").region).toBeUndefined();
  });

  it("says it is a dry run when the CLI runner or the operations factory is a fake, and not otherwise", () => {
    const { factory } = fakeAws();
    const run = (): Promise<{ status: number; output: string }> => Promise.resolve({ status: 0, output: "" });
    expect(cliStageOps(repo, "aws", { operations: factory }).dryRun).toBe("fake stage operations (OperationsFactory)");
    expect(cliStageOps(repo, "aws", { run, operations: factory }).dryRun).toBe("fake framework CLI runner; fake stage operations (OperationsFactory)");
    expect(cliStageOps(repo, "cloudflare", { run }).dryRun).toBe("fake framework CLI runner");
    expect(cliStageOps(repo, "aws").dryRun).toBeUndefined();
    expect(cliStageOps(repo, "aws", { env: AWS_ENV })).not.toHaveProperty("dryRun");
  });
});

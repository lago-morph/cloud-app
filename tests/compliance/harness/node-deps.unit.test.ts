import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ACCOUNT, FakeCloud } from "../../../packages/framework/src/provision/cloudflare/fake-cloud.test-support.js";
import { stageLeftovers } from "./leftovers.js";
import { cloudflareOperations } from "../../../packages/framework/src/cli/commands/deploy.js";
import { FakeTarget } from "../../../packages/framework/src/provision/core/fake-target.js";
import { cliStageOps, cloudAccount, deployOrigin, devOrigin, generateTestSecret, pendingStageStore, readVersions, runProcess, secretsNotSet, stageResourceOperations, type OperationsFactory } from "./node-deps.js";
import type { RunCall } from "./driver.js";
import { SIGN_UP_SLOT_MARGIN_MS, signUpLedger, withSignUpSlot, type BudgetDeps } from "./sign-up-budget.js";

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

  it("keeps pending test stages in a file, per target", () => {
    dir = mkdtempSync(join(tmpdir(), "pending-"));
    const store = pendingStageStore(join(dir, "sub", "pending-stages.json"));
    expect(store.list("cloudflare")).toEqual([]);
    store.add("cloudflare", "test-a");
    store.add("cloudflare", "test-b");
    store.add("cloudflare", "test-a");
    store.remove("cloudflare", "test-b");
    expect(pendingStageStore(join(dir, "sub", "pending-stages.json")).list("cloudflare")).toEqual(["test-a"]);
  });

  it("reads exact framework and dependency versions from the installed packages", () => {
    const versions = readVersions(repo);
    const framework = JSON.parse(readFileSync(join(repo, "packages/framework/package.json"), "utf8")) as { version: string };
    expect(versions["@lago-morph/prototype-framework"]).toBe(framework.version);
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
    // Release 1 has no AWS operations (DEC-0508): the per-target factory refuses before any request, which the driver
    // would record as a failed leftover check, never as none.
    await expect(stageResourceOperations(repo, "aws" as never, { env: ENV, fetch })).rejects.toThrow(/no provisioning operations for target aws/);
    expect(seen).toEqual([]);
    const proxied = await stageResourceOperations(repo, "cloudflare", { env: { ...ENV, HTTPS_PROXY: "http://proxy:1", NODE_USE_ENV_PROXY: "1" }, fetch });
    expect(await stageLeftovers(proxied, stage)).toEqual([]);
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

// The leftover check goes through the target's `listStageResources` (PROV §2), here a fake target behind the operations
// interface (the real factory is the CLI's `targetOperations`). No cloud request is made.
describe("[COMPL-AC-004] leftovers through listStageResources (fake target)", () => {
  const STAGE = "test-cfleft00000001";
  /** The leftover check runs in the driver process: with no proxy variable it needs no NODE_USE_ENV_PROXY. */
  const CF_ENV = {};

  function fakeCloudflare(): { fake: FakeTarget; factory: OperationsFactory; seen: { target: string; requireCredentials: boolean; appDir: string }[] } {
    const fake = new FakeTarget({ databases: [{ name: `reference-${STAGE}-db-2` }, { name: `reference-${STAGE}x-db-1` }, { name: "reference-prodcheck-db-1" }] });
    fake.stageState({ app: "reference", stage: STAGE }).resources.push({ kind: "Worker", id: `reference-${STAGE}` }, { kind: "R2 bucket", id: `reference-${STAGE}-files` });
    const seen: { target: string; requireCredentials: boolean; appDir: string }[] = [];
    const factory: OperationsFactory = (options) => (input) => {
      seen.push({ target: input.target, requireCredentials: options.requireCredentials, appDir: input.appDir });
      return fake;
    };
    return { fake, factory, seen };
  }

  it("lists the stage's databases by the exact pattern and its resources by exact identifier, wired as remove wires them", async () => {
    const { fake, factory, seen } = fakeCloudflare();
    const ops = cliStageOps(repo, "cloudflare", { operations: factory, env: CF_ENV });
    expect(await ops.listStageResources(STAGE)).toEqual([`database reference-${STAGE}-db-2`, `Worker reference-${STAGE}`, `R2 bucket reference-${STAGE}-files`]);
    expect(seen).toEqual([{ target: "cloudflare", requireCredentials: true, appDir: join(repo, "apps", "reference") }]);
    expect(fake.calls).toEqual([`listStageResources reference/${STAGE}`]);
  });

  it("a removed stage has no leftovers; a failing listing rejects (the driver records it as a failed check)", async () => {
    const { fake, factory } = fakeCloudflare();
    fake.stages.clear();
    fake.databases.delete(`reference-${STAGE}-db-2`);
    expect(await cliStageOps(repo, "cloudflare", { operations: factory, env: CF_ENV }).listStageResources(STAGE)).toEqual([]);
    fake.fail("listStageResources", new Error("AccessDenied"));
    await expect(cliStageOps(repo, "cloudflare", { operations: factory, env: CF_ENV }).listStageResources(STAGE)).rejects.toThrow("AccessDenied");
  });

  it("refuses non-test stages", async () => {
    const { factory } = fakeCloudflare();
    await expect(cliStageOps(repo, "cloudflare", { operations: factory, env: CF_ENV }).listStageResources("prodcheck")).rejects.toThrow(/handles test stages/);
  });

  // G-EV F3 (DEC-0504): fakes mark the record.
  it("says it is a dry run when the CLI runner or the operations factory is a fake, and not otherwise", () => {
    const { factory } = fakeCloudflare();
    const run = (): Promise<{ status: number; output: string }> => Promise.resolve({ status: 0, output: "" });
    expect(cliStageOps(repo, "cloudflare", { operations: factory }).dryRun).toBe("fake stage operations (OperationsFactory)");
    expect(cliStageOps(repo, "cloudflare", { run, operations: factory }).dryRun).toBe("fake framework CLI runner; fake stage operations (OperationsFactory)");
    expect(cliStageOps(repo, "cloudflare", { run }).dryRun).toBe("fake framework CLI runner");
    expect(cliStageOps(repo, "cloudflare").dryRun).toBeUndefined();
    expect(cliStageOps(repo, "cloudflare", { env: CF_ENV })).not.toHaveProperty("dryRun");
  });
});

describe("check-login's sign-up within prodcheck's PAR-259 budget (sign-up-budget.ts)", () => {
  /** A fake clock whose sleep advances it, and a fresh directory for the ledger. */
  function budget(): BudgetDeps & { slept: number[] } {
    const d = mkdtempSync(join(tmpdir(), "node-deps-budget-"));
    dir = d;
    const clock = { now: 5_000_000 };
    const slept: number[] = [];
    return { dir: d, slept, now: () => clock.now, sleep: (ms) => ((clock.now += ms), slept.push(ms), Promise.resolve()), log: () => undefined };
  }
  const fakeRun =
    (calls: string[]) =>
    (call: RunCall): Promise<{ status: number; output: string }> => (calls.push(call.args.join(" ")), Promise.resolve({ status: 0, output: "check-login: done" }));

  it("takes one slot of <target>/prodcheck per check-login, after the tests' sign-ups there", async () => {
    const b = budget();
    const calls: string[] = [];
    // The tests' two sign-ups on prodcheck (AUTH-AC-005's admin-role part, MAIL-AC-007).
    await withSignUpSlot("cloudflare/prodcheck", { max: 3, windowS: 300 }, () => Promise.resolve(), b);
    await withSignUpSlot("cloudflare/prodcheck", { max: 3, windowS: 300 }, () => Promise.resolve(), b);
    const ops = cliStageOps(repo, "cloudflare", { run: fakeRun(calls), signUpBudget: b });
    await ops.checkLogin?.("prodcheck");
    expect(calls).toEqual(["prototype-framework check-login --target cloudflare --stage prodcheck"]);
    expect(b.slept, "three sign-ups fit PAR-259").toEqual([]);
    expect(signUpLedger("cloudflare/prodcheck", b)).toHaveLength(3);
    // A fourth (another check-login, a retry, the next run) waits out the oldest's window.
    await ops.checkLogin?.("prodcheck");
    expect(b.slept.reduce((a, n) => a + n, 0)).toBe(300_000 + SIGN_UP_SLOT_MARGIN_MS);
    expect(calls).toHaveLength(2);
  });

  it("uses no budget on a fake runner (it sends no sign-up)", async () => {
    const calls: string[] = [];
    await cliStageOps(repo, "cloudflare", { run: fakeRun(calls) }).checkLogin?.("prodcheck");
    expect(calls).toHaveLength(1);
  });
});

describe("criterion production stages on Cloudflare (DEC-0560)", () => {
  const ok = (result: unknown) => ({ status: 200, body: { success: true, result } });

  it("are listed from the account's Worker, database and bucket names; only stale marked ones are swept; removal is --confirm-production", async () => {
    const asked: string[] = [];
    const cfCall = (method: string, path: string) => {
      asked.push(`${method} ${path}`);
      if (path.endsWith("/workers/scripts")) return Promise.resolve(ok([{ id: "reference-p003abcdefghij" }, { id: "reference-prodcheck" }, { id: "prototype-mailsink" }, { id: "reference-p003ownerstage" }]));
      if (path.includes("/d1/database")) return Promise.resolve(ok([{ name: "reference-p004klmnopqrst-db-1" }, { name: "reference-test-x-db-1" }]));
      return Promise.resolve(ok({ buckets: [{ name: "reference-p003abcdefghij-files" }] }));
    };
    const old = new Date(Date.now() - 7 * 3_600_000).toISOString();
    const markers = new Map([
      ["p003abcdefghij", JSON.stringify({ stage: "p003abcdefghij", runId: "r1", createdAt: old })],
      ["p004klmnopqrst", JSON.stringify({ stage: "p004klmnopqrst", runId: "r2", createdAt: new Date().toISOString() })],
      ["p004zzzzzzzzzz", JSON.stringify({ stage: "p004zzzzzzzzzz", runId: "r3", createdAt: old })],
    ]);
    const removed: string[] = [];
    const store = { list: () => Promise.resolve(markers), remove: (st: string) => (removed.push(st), Promise.resolve()) };
    const calls: string[] = [];
    const run = (call: RunCall): Promise<{ status: number; output: string }> => (calls.push(call.args.join(" ")), Promise.resolve({ status: 0, output: "removed" }));
    const ops = cliStageOps(repo, "cloudflare", { run, cfCall, markers: store, env: { CLOUDFLARE_ACCOUNT_ID: "a1" } });
    // p004klmnopqrst is another run's live stage (fresh marker); p003ownerstage has no marker; p004zzzzzzzzzz is a stale marker without resources.
    expect(await ops.criterionStages?.()).toEqual({ stale: ["p003abcdefghij", "p004zzzzzzzzzz"], unmarked: ["p003ownerstage"] });
    expect(asked).toEqual(["GET /accounts/a1/workers/scripts", "GET /accounts/a1/d1/database?per_page=100&page=1", "GET /accounts/a1/r2/buckets?per_page=1000"]);
    await ops.forgetCriterionStage?.("p003abcdefghij");
    expect(removed).toEqual(["p003abcdefghij"]);
    await ops.remove("p003abcdefghij");
    await ops.remove("test-abc");
    expect(calls).toEqual(["prototype-framework remove --target cloudflare --stage p003abcdefghij --confirm-production p003abcdefghij", "prototype-framework remove --target cloudflare --stage test-abc"]);
  });

  it("a refused listing rejects (the driver records it as a leftover entry)", async () => {
    const store = { list: () => Promise.resolve(new Map<string, string>()), remove: () => Promise.resolve() };
    const ops = cliStageOps(repo, "cloudflare", { run: () => Promise.resolve({ status: 0, output: "" }), cfCall: () => Promise.resolve({ status: 403, body: { success: false } }), markers: store, env: { CLOUDFLARE_ACCOUNT_ID: "a1" } });
    await expect(ops.criterionStages?.()).rejects.toThrow("listing Worker scripts for the criterion production stages failed: HTTP 403");
  });
});

describe("the Cloudflare account operations (DEC-0530, DEC-0531)", () => {
  it("exist on Cloudflare with an account ID, and send the main token as a bearer token to the account's paths", async () => {
    expect(cloudAccount("local", { CLOUDFLARE_ACCOUNT_ID: "a1" })).toBeUndefined();
    expect(cloudAccount("cloudflare", {})).toBeUndefined();
    const seen: { url: string; auth: string | undefined }[] = [];
    const fakeFetch = ((url: string, init?: RequestInit) => {
      seen.push({ url, auth: (init?.headers as Record<string, string> | undefined)?.authorization });
      return Promise.resolve(new Response(JSON.stringify({ success: true, result: [] }), { status: 200 }));
    }) as typeof fetch;
    const ops = cloudAccount("cloudflare", { CLOUDFLARE_ACCOUNT_ID: "a1", CLOUDFLARE_API_TOKEN: "fake-main-token-not-a-credential" }, fakeFetch);
    expect(await ops?.d1Plan()).toMatchObject({ plan: "free", source: "api" });
    expect(seen).toEqual([{ url: "https://api.cloudflare.com/client/v4/accounts/a1/subscriptions", auth: "Bearer fake-main-token-not-a-credential" }]);
  });
});

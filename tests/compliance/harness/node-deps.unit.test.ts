import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ACCOUNT, FakeCloud } from "../../../packages/framework/src/provision/cloudflare/fake-cloud.test-support.js";
import { stageLeftovers } from "./leftovers.js";
import { deployOrigin, devOrigin, pendingStageStore, readVersions, stageResourceOperations } from "./node-deps.js";

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
    await expect(stageResourceOperations(repo, "aws", { env: ENV, fetch })).rejects.toThrow(/aws/);
    expect(seen).toEqual([]);
    const proxied = await stageResourceOperations(repo, "cloudflare", { env: { ...ENV, HTTPS_PROXY: "http://proxy:1", NODE_USE_ENV_PROXY: "1" }, fetch });
    expect(await stageLeftovers(proxied, stage)).toEqual([]);
  });
});

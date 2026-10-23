import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { captureIo } from "../../cli/io.test-support.js";
import type { Migration } from "../../mig/history.js";
import { runDeploy, type DeployRequest } from "../core/deploy.js";
import type { HealthOutcome } from "../core/operations.js";
import { runRemove } from "../core/remove.js";
import { runSetupAccount } from "../core/setup-account.js";
import { unwiredDatabases } from "./databases.js";
import { ACCOUNT, FakeCloud, FakeDatabases } from "./fake-cloud.test-support.js";
import { createCloudflareTarget, type CloudflareTargetOptions } from "./target.js";

const stage = { app: "notes", stage: "test-abc" };
const other = { app: "notes", stage: "test-xyz" };
const ENV = { CLOUDFLARE_API_TOKEN: "placeholder", CLOUDFLARE_ACCOUNT_ID: ACCOUNT, PATH: "/usr/bin" };

const migration = (id: string): Migration => ({ id, name: id.split("/")[1]!, file: `${id}.sql`, text: "", checksum: "", statements: [] });
const MIGRATIONS = { framework: [migration("framework/0001_init")], app: [migration("app/0001_schema")] };

const health204 = (async () => new Response(null, { status: 204 })) as unknown as typeof fetch;

function setup(overrides: Partial<CloudflareTargetOptions> = {}) {
  const cloud = FakeCloud.withSharedResources();
  const databases = new FakeDatabases();
  const preflights: { origin: string; bucket: string }[] = [];
  const options: CloudflareTargetOptions = {
    api: cloud.api,
    accountId: ACCOUNT,
    env: ENV,
    appDir: mkdtempSync(join(tmpdir(), "cf-target-")),
    databases,
    sst: cloud.sst,
    fetch: health204,
    code: { bundle: "/app/.framework/cloudflare/worker.js", compatibilityDate: "2026-10-01", logBucketBinding: "LOGS" },
    files: {
      bucketCors: (origin) => ({ rules: [{ allowed: { origins: [origin], methods: ["PUT", "GET"], headers: ["Content-Type"] }, maxAgeSeconds: 60 }] }),
      storagePreflight: async (input): Promise<HealthOutcome> => {
        preflights.push({ origin: input.origin, bucket: input.bucket });
        return { ok: true };
      },
    },
    randomKey: () => "generated-session-key",
    sleep: async () => {},
    ...overrides,
  };
  return { cloud, databases, preflights, options, target: createCloudflareTarget(options) };
}

const request = (s = stage): DeployRequest => ({ stage: s, migrations: MIGRATIONS, requiredSecrets: [] });

describe("Cloudflare preflight (PROV-REQ-002 step 1)", () => {
  it("[PROV-AC-002] credential part: names each missing credential variable and sends nothing", async () => {
    const { target, cloud } = setup({ env: { PATH: "/usr/bin" } });
    expect(await target.preflight(stage)).toEqual(["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]);
    expect(cloud.requests).toEqual([]);
  });

  it("an unusable token is named; a usable token without the token permission names that permission", async () => {
    const a = setup();
    a.cloud.override.set(`GET /accounts/${ACCOUNT}/tokens/verify`, { status: 401, body: { success: false, errors: [{ code: 1000, message: "Invalid API Token" }] } });
    expect(await a.target.preflight(stage)).toEqual(["CLOUDFLARE_API_TOKEN is not usable: HTTP 401: Invalid API Token (code 1000)"]);

    const b = setup();
    b.cloud.override.set(`GET /accounts/${ACCOUNT}/tokens/permission_groups`, { status: 403, body: { success: false, errors: [{ code: 9109, message: "Unauthorized" }] } });
    const problems = await b.target.preflight(stage);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/permission to create R2 API tokens/);
    expect(b.cloud.requests.every((r) => r.startsWith("GET "))).toBe(true);

    expect(await setup().target.preflight(stage)).toEqual([]);
  });
});

describe("setup-account on Cloudflare (PROV-REQ-004)", () => {
  it("[PROV-AC-004] unit part: creates the log bucket, the state home and the subdomain once; a second run changes nothing", async () => {
    const { cloud, target } = setup();
    cloud.buckets.clear();
    cloud.subdomain = undefined;
    expect(await runSetupAccount(target, captureIo())).toEqual({ status: 0, created: ["R2 bucket prototype-logs", "R2 bucket sst-state", "workers.dev subdomain"] });
    cloud.requests.length = 0;
    expect(await runSetupAccount(target, captureIo())).toEqual({ status: 0, created: [] });
    expect(cloud.requests.every((r) => r.startsWith("GET "))).toBe(true);
  });
});

describe("deploy on Cloudflare (PROV-REQ-002 steps 3, 5, 6, 7)", () => {
  it("a first deploy: step 3 deploys only the bucket and sets its CORS policy, step 5 the Worker against the new database, then the framework secrets, start and health", async () => {
    const { cloud, target, databases, preflights } = setup();
    const io = captureIo();
    const result = await runDeploy(target, request(), io);
    expect(io.err).toBe("");
    expect(result).toEqual({ status: 0, publicOrigin: "https://notes-test-abc.example.workers.dev" });
    // Step 3 of a first deploy is untargeted on a bucket-only program: SST 4.17.2 resolves
    // `--target` in the stage's previous state only (root cause 2026-10-23-pass1, R1).
    expect(cloud.sstRuns).toEqual(["install --stage test-abc", "deploy --stage test-abc", "deploy --stage test-abc"]);
    expect(cloud.programs[0]).not.toMatch(/"worker":/);
    expect(cloud.cors.get("notes-test-abc-files")).toEqual({
      rules: [{ allowed: { origins: ["https://notes-test-abc.example.workers.dev"], methods: ["PUT", "GET"], headers: ["Content-Type"] }, maxAgeSeconds: 60 }],
    });
    expect(databases.calls).toContain("create notes-test-abc-db-1");
    const worker = cloud.workers.get("notes-test-abc")!;
    expect(worker.bindings).toContainEqual({ type: "d1", name: "DB", id: "uuid-1" });
    expect([...worker.secrets.keys()].sort()).toEqual(["SECRET_FRAMEWORK_R2_ACCESS_KEY_ID", "SECRET_FRAMEWORK_R2_SECRET_ACCESS_KEY", "SECRET_FRAMEWORK_SESSION_KEY"]);
    expect(worker.secrets.get("SECRET_FRAMEWORK_SESSION_KEY")).toBe("generated-session-key");
    expect(worker.secrets.get("SECRET_FRAMEWORK_R2_ACCESS_KEY_ID")).toBe("tok1");
    expect([...cloud.tokens.values()].map((t) => t.name)).toEqual(["notes-test-abc-files-signing"]);
    expect({ enabled: worker.enabled, previews: worker.previews }).toEqual({ enabled: true, previews: false });
    expect(preflights).toEqual([{ origin: "https://notes-test-abc.example.workers.dev", bucket: "notes-test-abc-files" }]);
    expect(cloud.programs.at(-1)).not.toMatch(/"SECRET_/);
  });

  it("DEC-0091: a deploy onto a switched-off route, followed by startApp, leaves the route on with previews off", async () => {
    const { cloud, target } = setup();
    expect((await runDeploy(target, request(), captureIo())).status).toBe(0);
    await target.stopApp(stage);
    expect(cloud.workers.get("notes-test-abc")!.enabled).toBe(false);
    const io = captureIo();
    expect((await runDeploy(target, request(), io)).status).toBe(0);
    const w = cloud.workers.get("notes-test-abc")!;
    expect({ enabled: w.enabled, previews: w.previews }).toEqual({ enabled: true, previews: false });
    const routeCalls = cloud.requests.filter((r) => r.endsWith("/workers/scripts/notes-test-abc/subdomain"));
    expect(routeCalls.at(-1)).toBe(`POST /accounts/${ACCOUNT}/workers/scripts/notes-test-abc/subdomain`);
  });

  it("a redeploy keeps the existing framework secrets and token: no second token, no new session key", async () => {
    let n = 0;
    const { cloud, target } = setup({ randomKey: () => `key-${++n}` });
    await runDeploy(target, request(), captureIo());
    await runDeploy(target, request(), captureIo());
    expect(cloud.tokens.size).toBe(1);
    expect(cloud.workers.get("notes-test-abc")!.secrets.get("SECRET_FRAMEWORK_SESSION_KEY")).toBe("key-1");
  });

  it("a token left without its secrets (an interrupted deploy) is deleted and replaced, since its value is shown only once", async () => {
    const { cloud, target } = setup();
    await runDeploy(target, request(), captureIo());
    cloud.workers.get("notes-test-abc")!.secrets.delete("SECRET_FRAMEWORK_R2_SECRET_ACCESS_KEY");
    await runDeploy(target, request(), captureIo());
    expect([...cloud.tokens.keys()]).toEqual(["tok2"]);
    expect(cloud.workers.get("notes-test-abc")!.secrets.get("SECRET_FRAMEWORK_R2_ACCESS_KEY_ID")).toBe("tok2");
  });

  it("deploying code without the built Worker fails naming what is missing", async () => {
    const { code: _built, ...withoutCode } = setup().options;
    const target = createCloudflareTarget(withoutCode);
    const io = captureIo();
    const result = await runDeploy(target, request(), io);
    expect(result.failure?.step).toBe("code");
    expect(io.err).toMatch(/no built Worker code; build --target cloudflare/);
  });

  it("a failing SST deploy fails the step with SST's output", async () => {
    const { cloud, target } = setup();
    cloud.failSst.add("deploy");
    const io = captureIo();
    const result = await runDeploy(target, request(), io);
    expect(result.failure?.step).toBe("infrastructure");
    expect(io.err).toMatch(/sst deploy --stage test-abc failed \(exit 1\)/);
  });

  it("a second deploy targets step 3 at Files; the Worker and its secrets are unchanged by step 3", async () => {
    const { cloud, target } = setup();
    expect((await runDeploy(target, request(), captureIo())).status).toBe(0);
    await target.setSecret(stage, "apiKey", "v-1");
    const before = cloud.workers.get("notes-test-abc")!;
    const secrets = new Map(before.secrets);
    cloud.sstRuns.length = 0;
    await target.deployInfrastructure({ stage, database: { id: "uuid-1", name: "notes-test-abc-db-1", number: 1 } });
    expect(cloud.sstRuns).toEqual(["deploy --stage test-abc --target Files"]);
    expect(cloud.workers.get("notes-test-abc")).toBe(before);
    expect(before.secrets).toEqual(secrets);
    expect((await runDeploy(target, request(), captureIo())).status).toBe(0);
    expect(cloud.sstRuns.slice(1)).toEqual(["deploy --stage test-abc --target Files", "deploy --stage test-abc"]);
    expect(cloud.workers.get("notes-test-abc")!.secrets.get("SECRET_API_KEY")).toBe("v-1");
  });

  it("R1: step 3 of a stage with a database but no built Worker code is refused before SST runs; the Worker stays", async () => {
    const a = setup();
    expect((await runDeploy(a.target, request(), captureIo())).status).toBe(0);
    const { code: _built, ...withoutCode } = a.options;
    const target = createCloudflareTarget(withoutCode);
    a.cloud.sstRuns.length = 0;
    const io = captureIo();
    const result = await runDeploy(target, request(), io);
    expect(result.failure?.step).toBe("infrastructure");
    expect(io.err).toMatch(/no built Worker code/);
    expect(a.cloud.sstRuns).toEqual([]);
    await expect(target.deployInfrastructure({ stage, database: { id: "uuid-1", name: "notes-test-abc-db-1", number: 1 } })).rejects.toThrow(/no built Worker code/);
    expect(a.cloud.sstRuns).toEqual([]);
    expect([...a.cloud.workers.get("notes-test-abc")!.secrets.keys()]).toContain("SECRET_FRAMEWORK_SESSION_KEY");
  });

  it("R2: step 3 of a stage with a Worker but no database is refused before SST runs; the Worker and its secrets stay", async () => {
    const { cloud, target, databases } = setup();
    expect((await runDeploy(target, request(), captureIo())).status).toBe(0);
    await target.setSecret(stage, "apiKey", "v-1");
    databases.dbs.clear();
    cloud.sstRuns.length = 0;
    const io = captureIo();
    const result = await runDeploy(target, request(), io);
    expect(result.failure?.step).toBe("infrastructure");
    expect(io.err).toMatch(/Worker notes-test-abc but no database[\s\S]*restore the database or run remove/);
    expect(cloud.sstRuns).toEqual([]);
    const w = cloud.workers.get("notes-test-abc")!;
    expect(w.secrets.get("SECRET_API_KEY")).toBe("v-1");
    expect(w.secrets.has("SECRET_FRAMEWORK_SESSION_KEY")).toBe(true);
  });

  it("secrets set and the secret listing go through the Worker's secrets API", async () => {
    const { cloud, target } = setup();
    expect(await target.listSetSecrets(stage)).toBeNull();
    await runDeploy(target, request(), captureIo());
    await target.setSecret(stage, "apiKey", "v-1");
    expect(cloud.workers.get("notes-test-abc")!.secrets.get("SECRET_API_KEY")).toBe("v-1");
    expect(await target.listSetSecrets(stage)).toContain("apiKey");
  });
});

describe("listStageResources and remove on Cloudflare (PROV-REQ-003; DEC-0084, DEC-0263)", () => {
  it("lists the Worker, the bucket, the R2 API token and the SST state objects by exact identifier, and every listed database", async () => {
    const { target } = setup();
    await runDeploy(target, request(), captureIo());
    await runDeploy(target, request(other), captureIo());
    const listed = await target.listStageResources(stage);
    expect(listed.resources).toEqual([
      { kind: "Worker", id: "notes-test-abc" },
      { kind: "R2 bucket", id: "notes-test-abc-files" },
      { kind: "R2 API token", id: "tok1" },
      { kind: "SST state object", id: "app/notes/test-abc" },
      { kind: "SST state object", id: "passphrase/notes/test-abc" },
      ...listed.resources.filter((r) => r.kind === "SST state object" && r.id.startsWith("update/notes/test-abc/")),
    ]);
    expect(listed.resources.filter((r) => r.id.startsWith("update/notes/test-abc/")).length).toBeGreaterThan(0);
    expect(listed.resources.some((r) => r.id.includes("test-xyz"))).toBe(false);
    expect(listed.databases.map((d) => d.name).sort()).toEqual(["notes-test-abc-db-1", "notes-test-xyz-db-1"]);
  });

  it("[PROV-AC-003] unit part: remove empties the bucket, deletes the token, the databases, the SST resources and the stage's state objects; the other stage and the shared resources stay", async () => {
    const { cloud, target, databases } = setup();
    await runDeploy(target, request(), captureIo());
    await runDeploy(target, request(other), captureIo());
    cloud.buckets.get("notes-test-abc-files")!.add("uploads/a.png");
    cloud.buckets.get("prototype-logs")!.add("notes/test-abc/2026/10/20/x.json");
    const io = captureIo();
    expect(await runRemove(target, stage, io)).toEqual({ status: 0, leftovers: [] });
    expect(cloud.workers.has("notes-test-abc")).toBe(false);
    expect(cloud.buckets.has("notes-test-abc-files")).toBe(false);
    expect([...cloud.tokens.values()].map((t) => t.name)).toEqual(["notes-test-xyz-files-signing"]);
    expect([...cloud.buckets.get("sst-state")!].every((k) => k.includes("/test-xyz"))).toBe(true);
    expect(cloud.buckets.get("prototype-logs")!.size).toBe(1);
    expect(cloud.workers.has("notes-test-xyz")).toBe(true);
    expect([...databases.dbs.values()].map((d) => d.name)).toEqual(["notes-test-xyz-db-1"]);
    expect(cloud.sstRuns.at(-1)).toBe("remove --stage test-abc");

    // R3: the successful `sst remove` left `app/` behind; it is deleted, so a re-run skips `sst remove`.
    const runs = cloud.sstRuns.length;
    expect(await runRemove(target, stage, captureIo())).toEqual({ status: 0, leftovers: [] });
    expect(cloud.sstRuns.slice(runs).some((r) => r.startsWith("remove"))).toBe(false);
  });

  it("R3: remove after a failed first deploy (no app/ state object) skips sst remove and deletes the state objects", async () => {
    const { cloud, target } = setup();
    const state = cloud.buckets.get("sst-state")!;
    state.add("passphrase/notes/test-abc").add("update/notes/test-abc/1").add("app/notes/test-abcd");
    const io = captureIo();
    expect(await runRemove(target, stage, io)).toEqual({ status: 0, leftovers: [] });
    expect(io.err).toBe("");
    expect(cloud.sstRuns.some((r) => r.startsWith("remove"))).toBe(false);
    expect([...state]).toEqual(["app/notes/test-abcd"]);
  });

  it("R3: when the state listing fails, sst remove still runs and the failure is reported", async () => {
    const { cloud, target } = setup();
    await runDeploy(target, request(), captureIo());
    let failed = false;
    cloud.override.set(`GET /accounts/${ACCOUNT}/r2/buckets/sst-state/objects?per_page=1000`, () => {
      if (failed) {
        cloud.override.delete(`GET /accounts/${ACCOUNT}/r2/buckets/sst-state/objects?per_page=1000`);
        return { status: 200, body: { success: true, errors: [], messages: [], result: [...cloud.buckets.get("sst-state")!].sort().map((key) => ({ key })), result_info: { is_truncated: false } } };
      }
      failed = true;
      return { status: 500, body: { success: false, errors: [{ code: 1, message: "internal" }] } };
    });
    const error = await target.removeStage(stage).then(() => undefined, (e: unknown) => e as Error);
    expect(error?.message).toMatch(/listing the objects of R2 bucket sst-state/);
    expect(cloud.sstRuns.at(-1)).toBe("remove --stage test-abc");
    expect(cloud.workers.has("notes-test-abc")).toBe(false);
    expect([...cloud.buckets.get("sst-state")!].some((k) => k.includes("/test-abc"))).toBe(false);
  });

  it("when SST's removal fails, the Worker and the emptied bucket are deleted by their exact names; what still cannot be deleted is a leftover", async () => {
    const { cloud, target } = setup();
    await runDeploy(target, request(), captureIo());
    cloud.failSst.add("remove");
    expect((await runRemove(target, stage, captureIo())).leftovers).toEqual([]);
    expect(cloud.workers.has("notes-test-abc")).toBe(false);

    const b = setup();
    await runDeploy(b.target, request(), captureIo());
    b.cloud.failSst.add("remove");
    b.cloud.override.set(`DELETE /accounts/${ACCOUNT}/workers/scripts/notes-test-abc?force=true`, { status: 500, body: { success: false, errors: [{ code: 1, message: "internal" }] } });
    const io = captureIo();
    const result = await b.target.removeStage(stage).then(() => undefined, (e: unknown) => e as Error);
    expect(result?.message).toMatch(/sst remove --stage test-abc failed[\s\S]*deleting Worker notes-test-abc failed: HTTP 500/);
    const removed = await runRemove(b.target, stage, io);
    expect(removed.status).toBe(1);
    expect(removed.leftovers).toEqual(["Worker notes-test-abc"]);
  });

  it("the D1 operations go to the database seam; unwired, they fail naming D-04", async () => {
    const { target, databases } = setup();
    const db = await target.createDatabase(stage, "notes-test-abc-db-1");
    await target.copyDatabase(stage, db, "notes-test-abc-db-2");
    await target.checkMigratedDatabase({ stage, previous: db, next: db, applied: [], migrations: MIGRATIONS });
    await target.dropDatabase(stage, db);
    expect(databases.calls).toEqual(["create notes-test-abc-db-1", "copy notes-test-abc-db-1 notes-test-abc-db-2", "check", "drop notes-test-abc-db-1"]);
    const unwired = setup({ databases: unwiredDatabases() }).target;
    await expect(unwired.createDatabase(stage, "x")).rejects.toThrow(/D1 database operations are not wired.*D-04/);
    expect(() => unwired.migrationDatabase(db)).toThrow(/D-04/);
  });
});

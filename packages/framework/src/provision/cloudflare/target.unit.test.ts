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
import { ACCOUNT, FAKE_SIGNING, FakeCloud, FakeDatabases, FULL_POLICIES } from "./fake-cloud.test-support.js";
import { createAccountSigningCredential } from "./r2-token.js";
import { SETUP_STEPS } from "./setup-record.js";
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

/**
 * A 0.1.x setup's email domain in the account settings record (DEC-0514). Since v0.2.0 nothing
 * records one (DEC-0689) and deploy no longer reads it (DEC-0732).
 */
function recordEmailDomain(cloud: FakeCloud, emailDomain = "example.test"): void {
  const key = "sst-state/framework/account.json";
  cloud.buckets.get("sst-state")!.add("framework/account.json");
  cloud.objectBodies.set(key, { ...(cloud.objectBodies.get(key) as object | undefined), emailDomain });
}

/** The auth app link as a recording stand-in (the real one, over D1, is `worker.unit.test.ts`'s). */
function fakeAuthApp(problems: string[] = [], registerError?: Error) {
  const link = {
    calls: [] as string[],
    onRegister: undefined as (() => void) | undefined,
    problems: async () => (link.calls.push("problems"), problems),
    register: async (app: string, url: string) => {
      link.calls.push(`register ${app} ${url}`);
      link.onRegister?.();
      if (registerError) throw registerError;
    },
    unregister: async (app: string) => void link.calls.push(`unregister ${app}`),
  };
  return link;
}

describe("Cloudflare preflight (PROV-REQ-002 step 1)", () => {
  it("[PROV-AC-002] credential part: names each missing credential variable and sends nothing", async () => {
    const { target, cloud } = setup({ env: { PATH: "/usr/bin" } });
    expect(await target.preflight(stage)).toEqual(["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]);
    expect(cloud.requests).toEqual([]);
  });

  it("an unusable token is named; a usable token needs no permission on API tokens (DEC-0550, DEC-0551)", async () => {
    const a = setup();
    a.cloud.override.set(`GET /accounts/${ACCOUNT}/tokens/verify`, { status: 401, body: { success: false, errors: [{ code: 1000, message: "Invalid API Token" }] } });
    expect(await a.target.preflight(stage)).toEqual(["CLOUDFLARE_API_TOKEN is not usable: HTTP 401: Invalid API Token (code 1000)"]);

    const b = setup();
    const refused = { status: 403, body: { success: false, errors: [{ code: 9109, message: "Unauthorized to access requested resource" }] } };
    b.cloud.override.set(`GET /accounts/${ACCOUNT}/tokens/permission_groups`, refused);
    b.cloud.override.set(`GET /accounts/${ACCOUNT}/tokens?per_page=50&page=1`, refused);
    expect(await b.target.preflight(stage)).toEqual([]);
    expect(b.cloud.requests).toEqual([`GET /accounts/${ACCOUNT}/tokens/verify`]);
  });

  it("[PROV-AC-002] unit part: deploy with the everyday token's permissions (no Account API Tokens at all) deploys a stage; without the account's signing credential it stops at step 1, naming it and setup-account", async () => {
    const { cloud, target } = setup();
    const refused = { status: 403, body: { success: false, errors: [{ code: 9109, message: "Unauthorized to access requested resource" }] } };
    cloud.override.set(`GET /accounts/${ACCOUNT}/tokens/permission_groups`, refused);
    cloud.override.set(`GET /accounts/${ACCOUNT}/tokens?per_page=50&page=1`, refused);
    cloud.override.set(`POST /accounts/${ACCOUNT}/tokens`, refused);
    const io = captureIo();
    expect((await runDeploy(target, request(), io)).status).toBe(0);
    expect(io.err).toBe("");
    const secrets = cloud.workers.get("notes-test-abc")!.secrets;
    expect(secrets.get("SECRET_FRAMEWORK_R2_ACCESS_KEY_ID")).toBe(FAKE_SIGNING.accessKeyId);
    expect(secrets.get("SECRET_FRAMEWORK_R2_SECRET_ACCESS_KEY")).toBe(FAKE_SIGNING.secretAccessKey);
    expect((await target.listStageResources(stage)).resources.map((r) => r.kind)).not.toContain("R2 API token");

    const b = setup();
    b.cloud.buckets.get("sst-state")!.delete("framework/r2-signing.json");
    const io2 = captureIo();
    const result = await runDeploy(b.target, request(), io2);
    expect(result.failure?.step).toBe("preflight");
    expect(io2.err).toMatch(/R2 signing credential prototype-r2-signing.*run setup-account --target cloudflare first/);
    expect(b.cloud.requests.every((r) => r.startsWith("GET "))).toBe(true);
    expect(io2.err).not.toContain(FAKE_SIGNING.secretAccessKey);

    // Both re-run requirements (batch B's backup bucket, batch C's signing record, or a record whose
    // token predates the backup bucket's deny entry): one preflight message naming each, pointing to setup-account.
    const c = setup();
    c.cloud.buckets.delete("prototype-backups");
    c.cloud.objectBodies.set("sst-state/framework/r2-signing.json", { tokenId: "tok0", accessKeyId: "tok0", secretAccessKey: "5".repeat(64), deniedBuckets: ["prototype-logs", "sst-state", "prototype-mailsink"] });
    const io3 = captureIo();
    expect((await runDeploy(c.target, request(), io3)).failure?.step).toBe("preflight");
    const lines = io3.err.split("\n").filter((l) => l.includes("setup-account"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/R2 bucket prototype-backups.*R2 signing credential prototype-r2-signing.*run setup-account --target cloudflare first/);
    expect(c.cloud.requests.every((r) => r.startsWith("GET "))).toBe(true);
  });
});

describe("setup-account on Cloudflare (PROV-REQ-004)", () => {
  it("[PROV-AC-004] unit part: creates the shared resources once, with no email setup and no email domain (v0.2.0); a second run changes nothing", async () => {
    const { cloud, target } = setup();
    cloud.buckets.clear();
    cloud.subdomain = undefined;
    expect(await runSetupAccount(target, captureIo())).toEqual({
      status: 0,
      created: [
        "R2 bucket prototype-logs",
        "R2 bucket sst-state",
        "R2 bucket prototype-backups",
        "lifecycle rule of R2 bucket prototype-backups (PAR-311)",
        "workers.dev subdomain",
        "R2 signing credential prototype-r2-signing",
        "account setup record (setup version 1)",
      ],
    });
    // The record holds the setup record's fields, written last (plan-setup-wizard §4.4, DEC-0577).
    expect(cloud.objectBodies.get("sst-state/framework/account.json")).toEqual({
      setupVersion: 1,
      frameworkVersion: expect.any(String) as string,
      appliedAt: expect.any(String) as string,
      completedSteps: [...SETUP_STEPS],
    });
    // DEC-0552: a random pf- subdomain; DEC-0550: one account signing token and its record.
    expect(cloud.subdomain).toMatch(/^pf-[a-z0-9]{12}$/);
    expect(cloud.subdomain).not.toContain(ACCOUNT.slice(0, 6));
    expect([...cloud.tokens.values()].map((t) => t.name)).toEqual(["prototype-r2-signing"]);
    expect(Object.keys(cloud.objectBodies.get("sst-state/framework/r2-signing.json") as object).sort()).toEqual(["accessKeyId", "deniedBuckets", "secretAccessKey", "tokenId"]);
    // No zone, email or mail sink request.
    expect(cloud.requests.filter((r) => /\/zones|\/email|mailsink/.test(r))).toEqual([]);
    cloud.requests.length = 0;
    expect(await runSetupAccount(target, captureIo())).toEqual({ status: 0, created: [] });
    expect(cloud.requests.every((r) => r.startsWith("GET "))).toBe(true);
  });

  it("a release with a raised setup version records it and says so, not \"nothing changed\"", async () => {
    const { cloud, target } = setup();
    await runSetupAccount(target, captureIo());
    const upgraded = setup({ api: cloud.api, setupVersion: 2 }).target;
    const io = captureIo();
    expect(await runSetupAccount(upgraded, io)).toEqual({ status: 0, created: ["account setup record (setup version 2)"] });
    expect(io.out).not.toContain("nothing changed");
    expect(io.out).toContain("account setup record (setup version 2)");
  });

  it("the account settings record is framework/account.json in sst-state, written only on a change; a 0.1.x email domain in it is kept", async () => {
    const { cloud, target } = setup();
    expect(cloud.objectBodies.has("sst-state/framework/account.json")).toBe(false);
    recordEmailDomain(cloud, "two.example");
    await runSetupAccount(target, captureIo());
    expect(await runSetupAccount(target, captureIo())).toEqual({ status: 0, created: [] });
    // One write, the setup record's (DEC-0577); the stored email domain is kept as it is.
    expect(cloud.requests.filter((r) => r.startsWith("PUT ") && r.includes("/objects/"))).toEqual([`PUT /accounts/${ACCOUNT}/r2/buckets/sst-state/objects/framework%2Faccount.json`]);
    expect(cloud.objectBodies.get("sst-state/framework/account.json")).toMatchObject({ emailDomain: "two.example" });
    // The record is a shared account object, never one of a stage's SST state objects.
    await runDeploy(target, request(), captureIo());
    expect((await target.listStageResources(stage)).resources.map((r) => r.id)).not.toContain("framework/account.json");
  });

  it("removing a stage leaves a 0.1.x mail sink's Worker and bucket (only the admin app's optional cleanup removes them, plan-v0.2.0 §8)", async () => {
    const { cloud, target } = setup();
    await runSetupAccount(target, captureIo());
    cloud.workers.set("prototype-mailsink", { secrets: new Map(), enabled: true, previews: false, bindings: [] });
    cloud.buckets.set("prototype-mailsink", new Set());
    cloud.putObject("prototype-mailsink", "sink+a@t.example.test/20261025T100000000Z-x.eml", "Subject: x\n\nbody");
    expect((await runDeploy(target, request(), captureIo())).status).toBe(0);
    expect((await runRemove(target, stage, captureIo())).status).toBe(0);
    expect(cloud.workers.has("prototype-mailsink")).toBe(true);
    expect(cloud.buckets.get("prototype-mailsink")!.size).toBe(1);
    expect(cloud.requests.filter((r) => r.startsWith("DELETE ") && r.includes("prototype-mailsink"))).toEqual([]);
  });

  it("a stage whose fixed names are the mail sink's is refused by deploy, the stage listing and removal", async () => {
    const { cloud, target } = setup();
    const clash = { app: "prototype", stage: "mailsink" };
    cloud.workers.set("prototype-mailsink", { secrets: new Map(), enabled: true, previews: false, bindings: [] });
    const io = captureIo();
    expect((await runDeploy(target, request(clash), io)).status).toBe(1);
    expect(io.err).toMatch(/Worker name prototype-mailsink, which is an account resource/);
    await expect(target.listStageResources(clash)).rejects.toThrow(/account resource/);
    await expect(target.removeStage(clash)).rejects.toThrow(/account resource/);
    expect(cloud.workers.has("prototype-mailsink")).toBe(true);
  });

  it("an invalid email domain a stored record holds no longer stops a deploy: deploy does not read the record (DEC-0732)", async () => {
    const { cloud, target } = setup({ authApp: fakeAuthApp() });
    recordEmailDomain(cloud, "Not A Domain");
    for (const s of [stage, { app: "notes", stage: "prod" }]) {
      const io = captureIo();
      expect((await runDeploy(target, request(s), io)).status, io.err).toBe(0);
    }
    expect(cloud.requests.filter((r) => r.includes("framework%2Faccount.json"))).toEqual([]);
  });
});

describe("a production stage needs no email domain on Cloudflare (PROV-REQ-002 step 1; cloudflare.md §2 v0.2.0 amendment; DEC-0698, DEC-0732)", () => {
  const prod = { app: "notes", stage: "prod" };

  it("[PROV-AC-002] a production deploy on an account whose record names no email domain passes the preflight and succeeds; it reads no zone, no email setup and no account settings record", async () => {
    const { cloud, target } = setup({ authApp: fakeAuthApp() });
    const io = captureIo();
    expect((await runDeploy(target, request(prod), io)).status, io.err).toBe(0);
    expect(io.err).toBe("");
    expect(cloud.requests.filter((r) => /\/zones|\/email\/|framework%2Faccount\.json/.test(r))).toEqual([]);
  });

  it("binds no EMAIL and sets no FRAMEWORK_MAIL_FROM, on an account without a recorded email domain or with a 0.1.x one; nodejs_compat as before; the output names no sender", async () => {
    // A production stage also needs the account's auth app (DEC-0725).
    for (const recorded of [false, true]) {
      const { cloud, target } = setup({ authApp: fakeAuthApp() });
      if (recorded) recordEmailDomain(cloud);
      const io = captureIo();
      expect((await runDeploy(target, request(prod), io)).status, io.err).toBe(0);
      expect(io.out).not.toMatch(/sender address|sign-in page/);
      expect(cloud.workers.get("notes-prod")!.bindings.some((b) => b.type === "send_email" || b.name === "EMAIL")).toBe(false);
      const program = cloud.programs.at(-1)!;
      expect(program).not.toMatch(/FRAMEWORK_MAIL_FROM|send_email|no-reply@/);
      expect(program).toMatch(/"compatibilityFlags": \[\s*"nodejs_compat"\s*\]/);
    }
  });
});

describe("a production stage signs in through the account's auth app (plan-v0.2.0 §3, §4.1; DEC-0667, DEC-0725)", () => {
  const prod = { app: "notes", stage: "prod" };

  it("[PROV-AC-002] the preflight of a production stage names a missing auth app or registry and stops before creating anything; a test stage does not ask", async () => {
    const authApp = fakeAuthApp(["the account's auth app (Worker prototype-auth) is not deployed; …"]);
    const { cloud, target } = setup({ authApp });
    const io = captureIo();
    expect((await runDeploy(target, request(prod), io)).status).toBe(1);
    expect(io.err).toMatch(/deploy failed at step 1 \(preflight\)[\s\S]*the account's auth app \(Worker prototype-auth\) is not deployed/);
    expect(cloud.sstRuns).toEqual([]);
    expect(authApp.calls).toEqual(["problems"]);

    expect((await runDeploy(target, request(), captureIo())).status).toBe(0);
    expect(authApp.calls).toEqual(["problems"]);
  });

  it("a production deploy binds AUTH, sets the auth app's origin and registers <app>-<stage> with <origin>/api/auth/callback after the code; a test stage gets none of it", async () => {
    const authApp = fakeAuthApp();
    const { cloud, target } = setup({ authApp });
    let seen: unknown;
    // Registered once the code and its framework secrets are deployed, and before step 6 starts the app.
    authApp.onRegister = () => (seen = { worker: cloud.workers.has("notes-prod"), secrets: cloud.workers.get("notes-prod")?.secrets.size, started: cloud.requests.includes(`POST /accounts/${ACCOUNT}/workers/scripts/notes-prod/subdomain`) });
    expect((await runDeploy(target, request(prod), captureIo())).status).toBe(0);
    const worker = cloud.workers.get("notes-prod")!;
    expect(worker.bindings).toContainEqual({ type: "service", name: "AUTH", service: "prototype-auth", entrypoint: "AuthApp" });
    expect(cloud.programs.at(-1)).toContain('"FRAMEWORK_AUTH_APP_ORIGIN": "https://prototype-auth.example.workers.dev"');
    expect(authApp.calls).toEqual(["problems", "register notes-prod https://notes-prod.example.workers.dev/api/auth/callback"]);
    expect(seen).toEqual({ worker: true, secrets: 4, started: false });

    expect((await runDeploy(target, request(), captureIo())).status).toBe(0);
    expect(cloud.workers.get("notes-test-abc")!.bindings.some((b) => b.name === "AUTH")).toBe(false);
    expect(cloud.programs.at(-1)).not.toContain("FRAMEWORK_AUTH_APP_ORIGIN");
    expect(authApp.calls).toHaveLength(2);
  });

  it("step 3 of a production stage with a database declares the same AUTH binding as step 5", async () => {
    const authApp = fakeAuthApp();
    const { cloud, target } = setup({ authApp });
    await runDeploy(target, request(prod), captureIo());
    const before = cloud.programs.length;
    expect((await runDeploy(target, request(prod), captureIo())).status).toBe(0);
    expect(cloud.sstRuns.at(-2)).toBe("deploy --stage prod --target Files");
    for (const program of cloud.programs.slice(before)) expect(program).toContain('"name": "AUTH"');
  });

  it("a failed registration fails the deploy at step 5, naming the auth app, and the app is not started", async () => {
    const authApp = fakeAuthApp([], new Error("the account's auth app (Worker prototype-auth) has no registry (its D1 binding DB); run account setup in the admin app again"));
    const { cloud, target } = setup({ authApp });
    const io = captureIo();
    const result = await runDeploy(target, request(prod), io);
    expect(result.status).toBe(1);
    expect(result.failure?.step).toBe("code");
    expect(io.err).toContain("has no registry (its D1 binding DB)");
    expect(cloud.requests.filter((r) => r.startsWith("POST ") && r.endsWith("/workers/scripts/notes-prod/subdomain"))).toEqual([]);
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
    expect([...worker.secrets.keys()].sort()).toEqual([
      "SECRET_FRAMEWORK_AUTH_SECRET",
      "SECRET_FRAMEWORK_R2_ACCESS_KEY_ID",
      "SECRET_FRAMEWORK_R2_SECRET_ACCESS_KEY",
      "SECRET_FRAMEWORK_SESSION_KEY",
    ]);
    expect(worker.secrets.get("SECRET_FRAMEWORK_SESSION_KEY")).toBe("generated-session-key");
    expect(worker.secrets.get("SECRET_FRAMEWORK_AUTH_SECRET")).toBe("generated-session-key");
    expect(worker.secrets.get("SECRET_FRAMEWORK_R2_ACCESS_KEY_ID")).toBe(FAKE_SIGNING.accessKeyId);
    expect(worker.secrets.get("SECRET_FRAMEWORK_R2_SECRET_ACCESS_KEY")).toBe(FAKE_SIGNING.secretAccessKey);
    // DEC-0550: deploy creates no API token; the stages share the account's signing credential.
    expect([...cloud.tokens.values()].map((t) => t.name)).toEqual(["prototype-r2-signing"]);
    expect(cloud.requests.filter((r) => r.includes("/tokens") && !r.startsWith("GET "))).toEqual([]);
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
    const secrets = cloud.workers.get("notes-test-abc")!.secrets;
    expect(secrets.get("SECRET_FRAMEWORK_SESSION_KEY")).toBe("key-1");
    // frameworkAuthSecret: generated once per stage like the session key, its own 32 random bytes (PAR-253).
    expect(secrets.get("SECRET_FRAMEWORK_AUTH_SECRET")).toBe("key-2");
    expect(n).toBe(2);
  });

  it("the default generated keys are 32 random bytes in base64url, distinct for the session key and the auth secret", async () => {
    const { cloud, options } = setup();
    const { randomKey: _fixed, ...withDefaultKeys } = options;
    const target = createCloudflareTarget(withDefaultKeys);
    expect((await runDeploy(target, request(), captureIo())).status).toBe(0);
    const secrets = cloud.workers.get("notes-test-abc")!.secrets;
    const session = secrets.get("SECRET_FRAMEWORK_SESSION_KEY") ?? "";
    const auth = secrets.get("SECRET_FRAMEWORK_AUTH_SECRET") ?? "";
    for (const key of [session, auth]) {
      expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(key, "base64url")).toHaveLength(32);
    }
    expect(auth).not.toBe(session);
  });

  it("every deploy writes the account's current signing credential into the stage's secrets, so a replaced credential or a legacy stage switches over (DEC-0550)", async () => {
    const { cloud, target } = setup();
    await runDeploy(target, request(), captureIo());
    cloud.workers.get("notes-test-abc")!.secrets.set("SECRET_FRAMEWORK_R2_ACCESS_KEY_ID", "legacy-stage-token");
    cloud.objectBodies.set("sst-state/framework/r2-signing.json", { ...FAKE_SIGNING, tokenId: "tok7", accessKeyId: "tok7", secretAccessKey: "7".repeat(64) });
    await runDeploy(target, request(), captureIo());
    const secrets = cloud.workers.get("notes-test-abc")!.secrets;
    expect(secrets.get("SECRET_FRAMEWORK_R2_ACCESS_KEY_ID")).toBe("tok7");
    expect(secrets.get("SECRET_FRAMEWORK_R2_SECRET_ACCESS_KEY")).toBe("7".repeat(64));
  });

  describe("the signing credential bound from Secrets Store (plan-v0.2.0 D7, §10; DEC-0727, DEC-0729)", () => {
    const R2_SECRETS = ["SECRET_FRAMEWORK_R2_ACCESS_KEY_ID", "SECRET_FRAMEWORK_R2_SECRET_ACCESS_KEY"];
    /** The Worker-secret delete endpoint on the fake account; `seen` records the SST runs done at each delete. */
    function allowSecretDeletes(cloud: FakeCloud, seen: number[]) {
      for (const name of R2_SECRETS) {
        cloud.override.set(`DELETE /accounts/${ACCOUNT}/workers/scripts/notes-test-abc/secrets/${name}`, () => {
          seen.push(cloud.sstRuns.length);
          const w = cloud.workers.get("notes-test-abc");
          return w?.secrets.delete(name) === true ? { status: 200, body: { success: true, result: null } } : { status: 404, body: { success: false, errors: [{ code: 10056, message: "not found" }] } };
        });
      }
    }

    it("a deploy binds both S3 credentials from the store under the Worker secrets' names and copies neither; a stage holding copies has them deleted before the upload", async () => {
      const { cloud, target } = setup();
      const seen: number[] = [];
      allowSecretDeletes(cloud, seen);
      expect((await runDeploy(target, request(), captureIo())).status).toBe(0);
      expect(cloud.workers.get("notes-test-abc")!.secrets.has("SECRET_FRAMEWORK_R2_ACCESS_KEY_ID")).toBe(true);

      expect((await createAccountSigningCredential(cloud.api, ACCOUNT, { secretsStore: true })).where).toBe("secrets-store");
      const runs = cloud.sstRuns.length;
      const io = captureIo();
      expect((await runDeploy(target, request(), io)).status, io.err).toBe(0);
      const worker = cloud.workers.get("notes-test-abc")!;
      expect(worker.bindings).toContainEqual({ type: "secrets_store_secret", name: "SECRET_FRAMEWORK_R2_ACCESS_KEY_ID", storeId: "store1", secretName: "PROTOTYPE_R2_ACCESS_KEY_ID" });
      expect(worker.bindings).toContainEqual({ type: "secrets_store_secret", name: "SECRET_FRAMEWORK_R2_SECRET_ACCESS_KEY", storeId: "store1", secretName: "PROTOTYPE_R2_SECRET_ACCESS_KEY" });
      expect([...worker.secrets.keys()].sort()).toEqual(["SECRET_FRAMEWORK_AUTH_SECRET", "SECRET_FRAMEWORK_SESSION_KEY"]);
      // Deleted after step 3's targeted run and before step 5's upload, which takes their names.
      expect(seen).toEqual([runs + 1, runs + 1]);
      expect(cloud.programs.at(-1)).not.toContain(cloud.secretStores.get("store1")!.secrets.get("PROTOTYPE_R2_SECRET_ACCESS_KEY")!.value);
    });

    it("the Worker-secret fallback: once the record holds the credentials again, a deploy declares no Secrets Store binding and copies them", async () => {
      const { cloud, target } = setup();
      allowSecretDeletes(cloud, []);
      await createAccountSigningCredential(cloud.api, ACCOUNT, { secretsStore: true });
      expect((await runDeploy(target, request(), captureIo())).status).toBe(0);
      cloud.override.set(`GET /accounts/${ACCOUNT}/secrets_store/stores?per_page=50`, { status: 403, body: { success: false, errors: [{ code: 10000, message: "Authentication error" }] } });
      expect((await createAccountSigningCredential(cloud.api, ACCOUNT, { secretsStore: true })).where).toBe("record");
      expect((await runDeploy(target, request(), captureIo())).status).toBe(0);
      const worker = cloud.workers.get("notes-test-abc")!;
      expect(worker.bindings.some((b) => b.type === "secrets_store_secret")).toBe(false);
      const record = cloud.objectBodies.get("sst-state/framework/r2-signing.json") as { accessKeyId: string; secretAccessKey: string };
      expect(worker.secrets.get("SECRET_FRAMEWORK_R2_ACCESS_KEY_ID")).toBe(record.accessKeyId);
      expect(worker.secrets.get("SECRET_FRAMEWORK_R2_SECRET_ACCESS_KEY")).toBe(record.secretAccessKey);
    });

    it("[PROV-AC-002] unit part: with a store-held credential missing from the store, deploy stops at step 1 naming the signing credential", async () => {
      const { cloud, target } = setup();
      await createAccountSigningCredential(cloud.api, ACCOUNT, { secretsStore: true });
      cloud.secretStores.get("store1")!.secrets.delete("PROTOTYPE_R2_SECRET_ACCESS_KEY");
      const io = captureIo();
      expect((await runDeploy(target, request(), io)).status).toBe(1);
      expect(io.err).toMatch(/the account's shared resources are missing \(.*R2 signing credential prototype-r2-signing.*\)/);
      expect(cloud.sstRuns).toEqual([]);
    });
  });

  it("[PROV-AC-004] unit part: setup-account without Account API Tokens Write, while the signing credential is absent, names that permission and changes nothing (DEC-0551)", async () => {
    const { cloud, target } = setup();
    cloud.buckets.clear();
    cloud.tokens.clear();
    cloud.tokenPolicies = FULL_POLICIES.map((p) => ({ ...p, permission_groups: p.permission_groups.filter((g) => g.name !== "Account API Tokens Write").concat(p.id === "p1" ? [{ id: "r", name: "Account API Tokens Read" }] : []) }));
    const io = captureIo();
    expect(await runSetupAccount(target, io)).toEqual({ status: 1, created: [] });
    expect(io.err).toMatch(/lacks the permission "Account API Tokens Write" \(account\), which creating the R2 signing credential prototype-r2-signing needs/);
    expect(cloud.requests.every((r) => r.startsWith("GET "))).toBe(true);
    expect(cloud.buckets.size).toBe(0);
    // With the credential in place, the setup token's token permission is no longer needed.
    const b = setup();
    b.cloud.tokenPolicies = cloud.tokenPolicies;
    expect((await runSetupAccount(b.target, captureIo())).status).toBe(0);
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
  it("lists the Worker, the bucket, a legacy R2 API token and the SST state objects by exact identifier, and every listed database", async () => {
    const { cloud, target } = setup();
    await runDeploy(target, request(), captureIo());
    await runDeploy(target, request(other), captureIo());
    // A stage deployed before DEC-0550 still has its own token.
    cloud.tokens.set("legacy1", { name: "notes-test-abc-files-signing", resources: {} });
    const listed = await target.listStageResources(stage);
    expect(listed.resources).toEqual([
      { kind: "Worker", id: "notes-test-abc" },
      { kind: "R2 bucket", id: "notes-test-abc-files" },
      { kind: "R2 API token", id: "legacy1" },
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
    cloud.tokens.set("legacy1", { name: "notes-test-abc-files-signing", resources: {} });
    cloud.tokens.set("legacy2", { name: "notes-test-xyz-files-signing", resources: {} });
    cloud.buckets.get("notes-test-abc-files")!.add("uploads/a.png");
    cloud.buckets.get("prototype-logs")!.add("notes/test-abc/2026/10/20/x.json");
    const io = captureIo();
    expect(await runRemove(target, stage, io)).toEqual({ status: 0, leftovers: [] });
    expect(cloud.workers.has("notes-test-abc")).toBe(false);
    expect(cloud.buckets.has("notes-test-abc-files")).toBe(false);
    expect([...cloud.tokens.values()].map((t) => t.name).sort()).toEqual(["notes-test-xyz-files-signing", "prototype-r2-signing"]);
    expect([...cloud.buckets.get("sst-state")!].every((k) => k.includes("/test-xyz") || k.startsWith("framework/"))).toBe(true);
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
    expect([...state].filter((k) => !k.startsWith("framework/"))).toEqual(["app/notes/test-abcd"]);
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

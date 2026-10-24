import { describe, expect, it } from "vitest";
import type { Migration } from "../../mig/history.js";
import { FakeTarget } from "../../provision/core/fake-target.js";
import type { TargetOperations } from "../../provision/core/operations.js";
import { UsageError } from "../args.js";
import { captureIo } from "../io.test-support.js";
import { ABORT_AT_VARIABLE, deployCommand, type DeployDeps, type PreparedDeploy } from "./deploy.js";

const migration = (id: string): Migration => ({ id, name: id.split("/")[1] ?? id, file: `/apps/notes/migrations/sqlite/${id}.sql`, text: "", checksum: "0", statements: [] });

interface Harness {
  readonly deps: DeployDeps;
  readonly fake: FakeTarget;
  readonly recorded: [string, string, string, string][];
  readonly events: string[];
}

function harness(options: { env?: Record<string, string>; fake?: FakeTarget; prepared?: Partial<PreparedDeploy>; prepareError?: Error } = {}): Harness {
  const fake = options.fake ?? new FakeTarget();
  const recorded: [string, string, string, string][] = [];
  const events: string[] = [];
  const deps: DeployDeps = {
    env: options.env ?? {},
    prepare: async (appDir, target, stage) => {
      events.push(`prepare ${appDir} ${target} ${stage}`);
      if (options.prepareError) throw options.prepareError;
      return { app: "notes", migrations: { framework: [], app: [migration("app/0000_init")] }, requiredSecrets: [], code: { built: true }, ...options.prepared };
    },
    operations: (input) => {
      events.push(`operations ${input.target}`);
      return fake as TargetOperations;
    },
    recordDeployOutput: (appDir, target, stage, origin) => {
      recorded.push([appDir, target, stage, origin]);
    },
  };
  return { deps, fake, recorded, events };
}

const ARGS = ["--target", "cloudflare", "--stage", "test-abc"];

describe("deploy (CLI-REQ-001, PROV-REQ-002, CLI-REQ-003)", () => {
  it("deploys through the PROV core, prints the public origin and records it for smoke (DEC-0272)", async () => {
    const h = harness();
    const io = captureIo("/apps/notes");
    expect(await deployCommand(h.deps)(ARGS, io)).toBe(0);
    expect(h.events).toEqual(["prepare /apps/notes cloudflare test-abc", "operations cloudflare"]);
    expect(io.out).toContain("public origin: https://notes-test-abc.fake.example");
    expect(h.recorded).toEqual([["/apps/notes", "cloudflare", "test-abc", "https://notes-test-abc.fake.example"]]);
    expect(h.fake.answering({ app: "notes", stage: "test-abc" })).toBe("notes-test-abc-db-1");
  });

  it("is refused for target local (deploy is for clouds), before anything is built", async () => {
    const h = harness();
    await expect(deployCommand(h.deps)(["--target", "local", "--stage", "local"], captureIo())).rejects.toThrow(UsageError);
    expect(h.events).toEqual([]);
  });

  it("stops with status 1 before building when the process cannot use the proxy (NODE_USE_ENV_PROXY)", async () => {
    const h = harness({ env: { HTTPS_PROXY: "http://proxy:1" } });
    const io = captureIo();
    expect(await deployCommand(h.deps)(ARGS, io)).toBe(1);
    expect(io.err).toContain("NODE_USE_ENV_PROXY=1");
    expect(h.events).toEqual([]);
  });

  it("a build failure exits 1 before any cloud operation", async () => {
    const h = harness({ prepareError: new Error("src/app.ts: type error") });
    const io = captureIo();
    expect(await deployCommand(h.deps)(ARGS, io)).toBe(1);
    expect(io.err).toContain("src/app.ts: type error");
    expect(h.events).toEqual(["prepare /app cloudflare test-abc"]);
    expect(h.fake.calls).toEqual([]);
  });

  it("[CLI-AC-003] a failed deploy exits 1 and records no deploy output", async () => {
    const fake = new FakeTarget();
    fake.missingPrerequisites = ["CLOUDFLARE_API_TOKEN"];
    const h = harness({ fake });
    const io = captureIo();
    expect(await deployCommand(h.deps)(ARGS, io)).toBe(1);
    expect(io.err).toMatch(/deploy failed at step 1 \(preflight\)/);
    expect(io.err).toContain("CLOUDFLARE_API_TOKEN");
    expect(h.recorded).toEqual([]);
  });

  it("[CLI-AC-003] a failing migration whose cleanup also fails keeps the original failure and status 1", async () => {
    const fake = new FakeTarget();
    fake.failingMigrations.set("app/0000_init", new Error("near SELEC: syntax error"));
    fake.fail("dropDatabase", new Error("delete refused"));
    const h = harness({ fake });
    const io = captureIo();
    expect(await deployCommand(h.deps)(ARGS, io)).toBe(1);
    expect(io.err).toMatch(/deploy failed at step 4 \(migrate\): migration app\/0000_init failed/);
    expect(io.err).toContain("cleanup also failed: deleting new database notes-test-abc-db-1: delete refused");
  });

  it("never creates the account's shared resources: absent ones stop the deploy, naming setup-account", async () => {
    const fake = new FakeTarget({ sharedResources: { "R2 bucket prototype-logs": "absent" } });
    const h = harness({ fake });
    const io = captureIo();
    expect(await deployCommand(h.deps)(ARGS, io)).toBe(1);
    expect(io.err).toContain("run setup-account --target fake first");
    expect(fake.calls.some((c) => c.startsWith("createSharedResources"))).toBe(false);
  });

  it(`[COMPL-AC-008] the runner-only abort point comes from ${"PROTOTYPE_FRAMEWORK_ABORT_AT"} and stops the deploy with status 1`, async () => {
    expect(ABORT_AT_VARIABLE).toBe("PROTOTYPE_FRAMEWORK_ABORT_AT");
    const h = harness({ env: { PROTOTYPE_FRAMEWORK_ABORT_AT: "after-code" } });
    const io = captureIo();
    expect(await deployCommand(h.deps)(ARGS, io)).toBe(1);
    expect(io.err).toContain("runner abort point after the code deploy");
    expect(h.fake.calls.some((c) => c.startsWith("startApp"))).toBe(false);
    expect(h.recorded).toEqual([]);
  });

  it("an unknown abort point is a usage error naming the accepted values, before anything is built", async () => {
    const h = harness({ env: { PROTOTYPE_FRAMEWORK_ABORT_AT: "later" } });
    await expect(deployCommand(h.deps)(ARGS, captureIo())).rejects.toThrow(/after-copy, after-code/);
    expect(h.events).toEqual([]);
  });

  it("passes the app's declared secrets, so a missing one stops the stage's first deploy after step 5", async () => {
    const h = harness({ prepared: { requiredSecrets: ["apiKey"] } });
    const io = captureIo();
    expect(await deployCommand(h.deps)(ARGS, io)).toBe(1);
    expect(io.err).toContain("required secrets are not set: apiKey");
    expect(io.err).toContain("secrets set --target fake --stage test-abc");
  });

  it("for a production stage, also prints the Google callback URL to register (GOOGLE-REQ-004)", async () => {
    const fake = new FakeTarget();
    const h = harness({ fake, prepared: { googleClientId: "id-from-config" } });
    // A production stage's first deploy needs the Google client secret set after step 5: set it as the owner would.
    const io = captureIo();
    const first = await deployCommand(h.deps)(["--target", "cloudflare", "--stage", "prod"], io);
    expect(first).toBe(1);
    await fake.setSecret({ app: "notes", stage: "prod" }, "frameworkGoogleClientSecret", "x");
    const again = captureIo();
    expect(await deployCommand(h.deps)(["--target", "cloudflare", "--stage", "prod"], again)).toBe(0);
    expect(again.out).toContain("Google callback URL to register: https://notes-prod.fake.example/api/auth/callback");
  });

  it("a test stage prints no Google callback URL", async () => {
    const h = harness();
    const io = captureIo();
    await deployCommand(h.deps)(ARGS, io);
    expect(io.out).not.toContain("callback");
  });
});

describe("deploy --target aws (G-11)", () => {
  it("prepares the AWS build, hands its code to the AWS operations, and records the public origin under .framework/aws", async () => {
    const fake = new FakeTarget({ dialect: "postgres" });
    const seen: unknown[] = [];
    const h = harness({ fake, prepared: { code: { bundle: "/apps/notes/.framework/aws/bundle", handler: "index.handler" } } });
    const deps: DeployDeps = { ...h.deps, operations: (input) => (seen.push(input), h.deps.operations(input)) };
    const io = captureIo("/apps/notes");
    expect(await deployCommand(deps)(["--target", "aws", "--stage", "test-abc"], io)).toBe(0);
    expect(h.events).toEqual(["prepare /apps/notes aws test-abc", "operations aws"]);
    expect(seen).toEqual([{ appDir: "/apps/notes", target: "aws", code: { bundle: "/apps/notes/.framework/aws/bundle", handler: "index.handler" } }]);
    expect(h.recorded).toEqual([["/apps/notes", "aws", "test-abc", "https://notes-test-abc.fake.example"]]);
  });

  it("stops before building when the process cannot use the proxy, as on Cloudflare", async () => {
    const h = harness({ env: { HTTPS_PROXY: "http://proxy:1" } });
    const io = captureIo();
    expect(await deployCommand(h.deps)(["--target", "aws", "--stage", "test-abc"], io)).toBe(1);
    expect(io.err).toContain("NODE_USE_ENV_PROXY=1");
    expect(h.events).toEqual([]);
  });
});

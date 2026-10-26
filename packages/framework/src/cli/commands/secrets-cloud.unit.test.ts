import { describe, expect, it } from "vitest";
import { FakeTarget } from "../../provision/core/fake-target.js";
import { UsageError } from "../args.js";
import { captureIo } from "../io.test-support.js";
import { runCommand } from "../main.js";
import { secretsCommand, type SecretsDeps } from "./secrets.js";
import { cloudSecrets, type CloudSecretsDeps } from "./secrets-cloud.js";

const STAGE = { app: "notes", stage: "test-abc" };

function harness(env: Record<string, string> = {}) {
  const fake = new FakeTarget();
  fake.stageState(STAGE).secrets = new Set();
  const events: string[] = [];
  const cloud: CloudSecretsDeps = {
    env,
    appName: async () => "notes",
    operations: (input) => (events.push(`operations ${input.target}`), fake),
  };
  const local: string[] = [];
  const deps: SecretsDeps = {
    loadDeclaredSecrets: async () => ["apiKey"],
    setLocalSecret: async (_dir, name) => void local.push(name),
    cloud: cloudSecrets(cloud),
  };
  return { deps, fake, events, local };
}

const SET = ["set", "apiKey", "--target", "cloudflare", "--stage", "test-abc"];

describe("secrets set --target cloudflare (SEC-REQ-003, SEC-REQ-004, CLI-REQ-004)", () => {
  it("[SEC-AC-003] writes the value from standard input to the stage's Worker secret SECRET_<NAME>, never printing it", async () => {
    const h = harness();
    const value = `v-${crypto.randomUUID()}`;
    const io = captureIo("/apps/notes", [`${value}\n`]);
    expect(await secretsCommand(h.deps)(SET, io)).toBe(0);
    expect(h.fake.calls).toEqual(["setSecret notes/test-abc apiKey"]);
    expect(io.out).toContain("SECRET_API_KEY");
    expect(io.out + io.err).not.toContain(value);
    expect(h.local).toEqual([]);
  });

  it("[SEC-AC-004] rejects a value given as an argument, before touching the cloud", async () => {
    const h = harness();
    await expect(secretsCommand(h.deps)([...SET, "--value", "x"], captureIo("/a", ["x"]))).rejects.toThrow(UsageError);
    expect(h.fake.calls).toEqual([]);
  });

  it("a framework-internal secret can be set (frameworkAuthSecret on a production stage)", async () => {
    const h = harness();
    h.fake.stageState({ app: "notes", stage: "prod" }).secrets = new Set();
    const io = captureIo("/a", ["s3cr3t"]);
    expect(await secretsCommand(h.deps)(["set", "frameworkAuthSecret", "--target", "cloudflare", "--stage", "prod"], io)).toBe(0);
    expect(h.fake.calls).toEqual(["setSecret notes/prod frameworkAuthSecret"]);
  });

  it("a failure of the cloud store exits 1 with its message (the stage has no Worker yet)", async () => {
    const h = harness();
    h.fake.fail("setSecret", new Error("setting secret apiKey failed: Worker notes-test-abc does not exist yet; run deploy first"));
    const io = captureIo("/a", ["value"]);
    expect(await runCommand(["secrets", ...SET], io, { secrets: { summary: "", run: secretsCommand(h.deps) } })).toBe(1);
    expect(io.err).toContain("run deploy first");
  });

  it("an invalid stage name is a usage error; a process that cannot use the proxy exits 1; neither reads standard input", async () => {
    const h = harness();
    await expect(secretsCommand(h.deps)(["set", "apiKey", "--target", "cloudflare", "--stage", "Test_X"], captureIo("/a", ["v"]))).rejects.toThrow(UsageError);
    const p = harness({ HTTPS_PROXY: "http://p:1" });
    const io = captureIo("/a", ["v"]);
    expect(await secretsCommand(p.deps)(SET, io)).toBe(1);
    expect(io.err).toContain("NODE_USE_ENV_PROXY=1");
    expect(h.fake.calls).toEqual([]);
    expect(p.fake.calls).toEqual([]);
  });
});

// Unit tests for how the live-pass runner runs commands (scripts/live-pass/lib/exec.mjs): which
// environment the framework sees, and what a command record holds. Written from the brief: the
// framework keeps reading the variables it already reads, each set only for the command that needs it
// (DEC-0793); the owner's token is for the runner only; records hold arguments, exit code, timing and
// scrubbed output.
import { describe, expect, it, vi } from "vitest";
import { childEnv, runCommand } from "./lib/exec.mjs";
import { createScrubber } from "./lib/scrub.mjs";

// This sandbox's own environment holds the primary Cloudflare account's token and ID; the runner's
// values come from its secrets directory (DEC-0793) and reach a command only as a step sets them.
const BASE = {
  PATH: "/usr/bin",
  HOME: "/root",
  LIVE_PASS_OWNER_TOKEN: "owner-token-value-0123456789",
  CLOUDFLARE_ACCOUNT_ID: "primary-account-id",
  CLOUDFLARE_API_TOKEN: "primary-account-token-0123456789",
  CLOUDFLARE_BOOTSTRAP_TOKEN: "stale-boot-token-value-0123456789",
  CLOUDFLARE_EMAIL: "someone@example.com",
};
const TEST_ACCOUNT = "test-account-id";

describe("childEnv", () => {
  it("never passes the runner's own variables to a command", () => {
    const env = childEnv(BASE, { accountId: TEST_ACCOUNT });
    expect(Object.keys(env).filter((k) => k.startsWith("LIVE_PASS_"))).toEqual([]);
  });

  it("never passes a Cloudflare variable of the sandbox's own environment (the primary Cloudflare account's), only the test Cloudflare account's ID", () => {
    const env = childEnv(BASE, { accountId: TEST_ACCOUNT });
    expect(env.CLOUDFLARE_API_TOKEN).toBeUndefined();
    expect(env.CLOUDFLARE_BOOTSTRAP_TOKEN).toBeUndefined();
    expect(env.CLOUDFLARE_EMAIL).toBeUndefined();
    expect(env.CLOUDFLARE_ACCOUNT_ID).toBe(TEST_ACCOUNT);
  });

  it("passes a token only when the step sets it, for that one command", () => {
    expect(childEnv(BASE, { accountId: TEST_ACCOUNT, set: { CLOUDFLARE_BOOTSTRAP_TOKEN: "starter-value-0123456789" } }).CLOUDFLARE_BOOTSTRAP_TOKEN).toBe("starter-value-0123456789");
    const everyday = childEnv(BASE, { accountId: TEST_ACCOUNT, set: { CLOUDFLARE_API_TOKEN: "everyday-value-0123456789" } });
    expect(everyday.CLOUDFLARE_API_TOKEN).toBe("everyday-value-0123456789");
    expect(everyday.CLOUDFLARE_BOOTSTRAP_TOKEN).toBeUndefined();
  });

  it("refuses to build an environment without the test Cloudflare account's ID", () => {
    expect(() => childEnv(BASE, {})).toThrow(/account/);
  });

  it("protects the owner token's ID from the framework (PAR-361), and keeps any IDs already protected", () => {
    expect(childEnv(BASE, { accountId: TEST_ACCOUNT, protectIds: ["id1"] }).PROTOTYPE_FRAMEWORK_PROTECTED_TOKEN_IDS).toBe("id1");
    expect(childEnv({ ...BASE, PROTOTYPE_FRAMEWORK_PROTECTED_TOKEN_IDS: "id0" }, { accountId: TEST_ACCOUNT, protectIds: ["id1"] }).PROTOTYPE_FRAMEWORK_PROTECTED_TOKEN_IDS).toBe("id0,id1");
  });

  it("behind a proxy, sets NODE_USE_ENV_PROXY=1 as the framework requires", () => {
    expect(childEnv({ ...BASE, HTTPS_PROXY: "http://proxy:1" }, { accountId: TEST_ACCOUNT }).NODE_USE_ENV_PROXY).toBe("1");
    expect(childEnv(BASE, { accountId: TEST_ACCOUNT }).NODE_USE_ENV_PROXY).toBeUndefined();
  });

  it("keeps unrelated variables such as PATH and HOME", () => {
    expect(childEnv(BASE, { accountId: TEST_ACCOUNT })).toMatchObject({ PATH: "/usr/bin", HOME: "/root" });
  });
});

describe("runCommand", () => {
  const scrubber = () => createScrubber([{ name: "SECRET", value: "very-secret-value-123" }]);

  it("records arguments, exit code, timing and scrubbed output, and counts raw secret hits", async () => {
    const rec = await runCommand({
      argv: [process.execPath, "-e", "console.log('out very-secret-value-123'); console.error('err'); process.exit(3)"],
      cwd: process.cwd(),
      env: { PATH: process.env.PATH ?? "" },
      scrubber: scrubber(),
      echo: false,
    });
    expect(rec.exitCode).toBe(3);
    expect(rec.stdout).toBe("out [REDACTED:SECRET]\n");
    expect(rec.stderr).toBe("err\n");
    expect(rec.rawSecretHits).toEqual({ SECRET: 1 });
    expect(rec.durationMs).toBeGreaterThanOrEqual(0);
    expect(Date.parse(rec.endedAt)).toBeGreaterThanOrEqual(Date.parse(rec.startedAt));
    expect(rec.argv[0]).toBe(process.execPath);
  });

  it("scrubs secrets in the arguments and records which variables were set, never their values", async () => {
    const rec = await runCommand({
      argv: [process.execPath, "-e", "0", "very-secret-value-123"],
      cwd: process.cwd(),
      env: { PATH: process.env.PATH ?? "", CLOUDFLARE_API_TOKEN: "very-secret-value-123" },
      scrubber: scrubber(),
      echo: false,
    });
    expect(rec.argv[3]).toBe("[REDACTED:SECRET]");
    expect(rec.env).toEqual({ CLOUDFLARE_API_TOKEN: "set" });
    expect(JSON.stringify(rec)).not.toContain("very-secret-value-123");
  });

  it("feeds standard input without recording it", async () => {
    const rec = await runCommand({
      argv: [process.execPath, "-e", "process.stdin.on('data', d => process.stdout.write(String(d.length)))"],
      cwd: process.cwd(),
      env: { PATH: process.env.PATH ?? "" },
      input: "very-secret-value-123",
      scrubber: scrubber(),
      echo: false,
    });
    expect(rec.stdout).toBe("21");
    expect(rec.stdin).toBe("[given, not recorded]");
  });

  it("records a command that cannot start as exit code null with the error", async () => {
    const rec = await runCommand({ argv: ["/no/such/command"], cwd: process.cwd(), env: {}, scrubber: scrubber(), echo: false });
    expect(rec.exitCode).toBeNull();
    expect(rec.error).toMatch(/ENOENT/);
  });

  it("stops a command at its timeout and says so", async () => {
    const rec = await runCommand({ argv: [process.execPath, "-e", "setTimeout(() => {}, 10000)"], cwd: process.cwd(), env: {}, scrubber: scrubber(), echo: false, timeoutMs: 300 });
    expect(rec.timedOut).toBe(true);
    expect(rec.exitCode).not.toBe(0);
  });

  // Review 2026-11-02 (independent test author): what the runner echoes to the session's terminal
  // must be as free of credential values as the record. A pipe delivers output in chunks of any
  // size, so a value can arrive split across two chunks.
  const captureEcho = async (run: () => Promise<unknown>) => {
    const echoed: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      echoed.push(String(chunk));
      return true;
    });
    try {
      await run();
    } finally {
      spy.mockRestore();
    }
    return echoed.join("");
  };

  it("never echoes a secret to the terminal when it arrives split across two output chunks", async () => {
    const script = 'process.stdout.write("a very-secr"); setTimeout(() => process.stdout.write("et-value-123 b\\n"), 300);';
    let rec: Awaited<ReturnType<typeof runCommand>> | undefined;
    const echoed = await captureEcho(async () => {
      rec = await runCommand({ argv: [process.execPath, "-e", script], cwd: process.cwd(), env: { PATH: process.env.PATH ?? "" }, scrubber: scrubber(), echo: true });
    });
    expect(rec?.stdout).toBe("a [REDACTED:SECRET] b\n");
    expect(echoed).not.toContain("very-secr");
    expect(echoed).toContain("a [REDACTED:SECRET] b");
  });

  it("still echoes output that ends without a newline, once the command ends", async () => {
    const echoed = await captureEcho(() => runCommand({ argv: [process.execPath, "-e", "process.stdout.write('no newline at the end')"], cwd: process.cwd(), env: { PATH: process.env.PATH ?? "" }, scrubber: scrubber(), echo: true }));
    expect(echoed).toContain("no newline at the end");
  });
});

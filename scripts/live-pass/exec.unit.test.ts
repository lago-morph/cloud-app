// Unit tests for how the live-pass runner runs commands (scripts/live-pass/lib/exec.mjs): which
// environment the framework sees, and what a command record holds. Written from the brief: the
// framework keeps reading the variables it already reads; the runner's own admin token is for
// snapshots, telemetry and cleanup only; records hold arguments, exit code, timing and scrubbed output.
import { describe, expect, it } from "vitest";
import { childEnv, runCommand } from "./lib/exec.mjs";
import { createScrubber } from "./lib/scrub.mjs";

const BASE = {
  PATH: "/usr/bin",
  HOME: "/root",
  LIVE_PASS_ADMIN_TOKEN: "admin-token-value-0123456789",
  LIVE_PASS_BOOTSTRAP_LONG: "long-token-value-0123456789",
  LIVE_PASS_BOOTSTRAP_RERUN: "rerun-token-value-0123456789",
  CLOUDFLARE_ACCOUNT_ID: "acc",
  CLOUDFLARE_BOOTSTRAP_TOKEN: "boot-token-value-0123456789",
  CLOUDFLARE_API_TOKEN: "everyday-token-value-0123456789",
};

describe("childEnv", () => {
  it("never passes the runner's own variables to a command", () => {
    const env = childEnv(BASE, { session: 1 });
    expect(Object.keys(env).filter((k) => k.startsWith("LIVE_PASS_"))).toEqual([]);
  });

  it("session 1 passes the starter token as CLOUDFLARE_BOOTSTRAP_TOKEN, and no everyday token", () => {
    const env = childEnv(BASE, { session: 1 });
    expect(env.CLOUDFLARE_BOOTSTRAP_TOKEN).toBe(BASE.CLOUDFLARE_BOOTSTRAP_TOKEN);
    expect(env.CLOUDFLARE_API_TOKEN).toBeUndefined();
    expect(env.CLOUDFLARE_ACCOUNT_ID).toBe("acc");
  });

  it("session 2 passes the everyday token and never a starter token, even one left in the environment", () => {
    const env = childEnv(BASE, { session: 2 });
    expect(env.CLOUDFLARE_API_TOKEN).toBe(BASE.CLOUDFLARE_API_TOKEN);
    expect(env.CLOUDFLARE_BOOTSTRAP_TOKEN).toBeUndefined();
  });

  it("a step may set the starter token for one command (the long-lived or re-run token, or a bad paste)", () => {
    const env = childEnv(BASE, { session: 1, set: { CLOUDFLARE_BOOTSTRAP_TOKEN: BASE.LIVE_PASS_BOOTSTRAP_LONG } });
    expect(env.CLOUDFLARE_BOOTSTRAP_TOKEN).toBe(BASE.LIVE_PASS_BOOTSTRAP_LONG);
  });

  it("protects the admin token's ID from the framework (PAR-361), and keeps any IDs already protected", () => {
    expect(childEnv(BASE, { session: 1, protectIds: ["id1"] }).PROTOTYPE_FRAMEWORK_PROTECTED_TOKEN_IDS).toBe("id1");
    expect(childEnv({ ...BASE, PROTOTYPE_FRAMEWORK_PROTECTED_TOKEN_IDS: "id0" }, { session: 1, protectIds: ["id1"] }).PROTOTYPE_FRAMEWORK_PROTECTED_TOKEN_IDS).toBe("id0,id1");
  });

  it("behind a proxy, sets NODE_USE_ENV_PROXY=1 as the framework requires", () => {
    expect(childEnv({ ...BASE, HTTPS_PROXY: "http://proxy:1" }, { session: 1 }).NODE_USE_ENV_PROXY).toBe("1");
    expect(childEnv(BASE, { session: 1 }).NODE_USE_ENV_PROXY).toBeUndefined();
  });

  it("keeps unrelated variables such as PATH and HOME", () => {
    expect(childEnv(BASE, { session: 2 })).toMatchObject({ PATH: "/usr/bin", HOME: "/root" });
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
});

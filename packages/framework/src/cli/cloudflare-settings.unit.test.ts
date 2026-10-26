import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withCloudflareSettings } from "./cloudflare-settings.js";
import type { ProcessEnvironment } from "./commands/smoke-cloud.js";
import { captureIo } from "./io.test-support.js";
import { EXIT, type Command } from "./io.js";

// Fake values only; the marker is searched for in every output.
const MARKER = "zzLEAKMARKERzz";
const FILE_TOKEN = `file-${MARKER}-token`;
const ENV_TOKEN = `env-${MARKER}-token`;

let dir: string;
const git = (...args: string[]): void => void execFileSync("git", args, { cwd: dir, stdio: "ignore" });
const writeEnvFile = (text: string): void => writeFileSync(join(dir, ".env.cloudflare"), text);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pf-cli-settings-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A command that records the environment it was built with and exits with `status`. */
function recording(status: number): { seen: ProcessEnvironment[]; load: (env: ProcessEnvironment) => Command } {
  const seen: ProcessEnvironment[] = [];
  return {
    seen,
    load: (env) => {
      seen.push(env);
      return async (_args, io) => {
        io.stdout("ran\n");
        return status;
      };
    },
  };
}

describe("every Cloudflare command reads the environment and .env.cloudflare (plan-setup-wizard §4.2, §4.5; DEC-0570, DEC-0572, DEC-0573)", () => {
  it("--target cloudflare: the command is built with the file's values, the environment winning", async () => {
    writeEnvFile(`CLOUDFLARE_API_TOKEN=${FILE_TOKEN}\nCLOUDFLARE_ACCOUNT_ID=file-account\n`);
    const { seen, load } = recording(EXIT.ok);
    const io = captureIo(dir);
    const env = { PATH: "/bin", CLOUDFLARE_ACCOUNT_ID: "env-account" };
    expect(await withCloudflareSettings("deploy", load, env)(["--target", "cloudflare", "--stage", "test-a"], io)).toBe(EXIT.ok);
    expect(seen).toEqual([{ PATH: "/bin", CLOUDFLARE_API_TOKEN: FILE_TOKEN, CLOUDFLARE_ACCOUNT_ID: "env-account" }]);
    expect(io.out + io.err).not.toContain(MARKER);
  });

  it("another target reads no file and prints nothing extra", async () => {
    writeEnvFile(`CLOUDFLARE_API_TOKEN=${FILE_TOKEN}\n`);
    const { seen, load } = recording(EXIT.ok);
    const io = captureIo(dir);
    const env = { PATH: "/bin" };
    await withCloudflareSettings("admins", load, env)(["list", "--target", "local", "--stage", "s"], io);
    await withCloudflareSettings("mail", load, env)(["last", "--to", "a@example.com"], io);
    expect(seen).toEqual([env, env]);
    expect(io.err).toBe("");
  });

  it("names a setting that differs between the sources, never its value", async () => {
    writeEnvFile(`CLOUDFLARE_API_TOKEN=${FILE_TOKEN}\n`);
    const { seen, load } = recording(EXIT.ok);
    const io = captureIo(dir);
    await withCloudflareSettings("remove", load, { CLOUDFLARE_API_TOKEN: ENV_TOKEN })(["--target=cloudflare", "--stage", "test-a"], io);
    expect(seen[0]?.CLOUDFLARE_API_TOKEN).toBe(ENV_TOKEN);
    expect(io.err).toBe("remove: note: CLOUDFLARE_API_TOKEN is set in both the environment and .env.cloudflare and they differ: using the environment\n");
  });

  it("a file git does not ignore: a prominent warning on every run, and the exit status is the command's own", async () => {
    git("init", "-q");
    writeEnvFile(`CLOUDFLARE_API_TOKEN=${FILE_TOKEN}\n`);
    for (const status of [EXIT.ok, EXIT.failed, EXIT.ok]) {
      const io = captureIo(dir);
      expect(await withCloudflareSettings("deploy", recording(status).load, {})(["--target", "cloudflare", "--stage", "test-a"], io)).toBe(status);
      expect(io.err).toMatch(/^={78}\ndeploy: WARNING: \.env\.cloudflare holds your Cloudflare tokens and git does not ignore it: .*\n={78}\n$/);
      expect(io.out).toBe("ran\n");
      expect(io.out + io.err).not.toContain(MARKER);
    }
  });

  it("a tracked file: the warning says the tokens are in the history and how to replace them; the command still runs", async () => {
    git("init", "-q");
    writeEnvFile(`CLOUDFLARE_API_TOKEN=${FILE_TOKEN}\n`);
    git("add", ".env.cloudflare");
    const io = captureIo(dir);
    expect(await withCloudflareSettings("secrets set", recording(EXIT.ok).load, {})(["set", "X", "--target", "cloudflare", "--stage", "test-a"], io)).toBe(EXIT.ok);
    expect(io.err).toContain("secrets set: WARNING: .env.cloudflare is tracked by git, so the Cloudflare tokens in it are in the repository's history");
    expect(io.err).toContain("git rm --cached .env.cloudflare");
    expect(io.out).toBe("ran\n");
    expect(io.out + io.err).not.toContain(MARKER);
  });

  it("an ignored file, or a project that is not a repository: no warning", async () => {
    writeEnvFile(`CLOUDFLARE_API_TOKEN=${FILE_TOKEN}\n`);
    const outside = captureIo(dir);
    await withCloudflareSettings("stop", recording(EXIT.ok).load, {})(["--target", "cloudflare", "--stage", "test-a"], outside);
    expect(outside.err).toBe("");

    git("init", "-q");
    writeFileSync(join(dir, ".gitignore"), ".env.cloudflare\n");
    const ignored = captureIo(dir);
    await withCloudflareSettings("stop", recording(EXIT.ok).load, {})(["--target", "cloudflare", "--stage", "test-a"], ignored);
    expect(ignored.err).toBe("");
  });

  it("a fake token with a marker appears in no output, whatever the file holds", async () => {
    git("init", "-q");
    writeEnvFile([`CLOUDFLARE_BOOTSTRAP_TOKEN=${FILE_TOKEN}`, `CLOUDFLARE_API_TOKEN="${FILE_TOKEN}`, FILE_TOKEN, `CLOUDFLARE_ACCOUNT_ID=${MARKER}`, `CLOUDFLARE_EMAIL_DOMAIN=${MARKER}.example`].join("\n"));
    git("add", ".env.cloudflare");
    const io = captureIo(dir);
    const env = { CLOUDFLARE_BOOTSTRAP_TOKEN: ENV_TOKEN, CLOUDFLARE_API_TOKEN: ENV_TOKEN, CLOUDFLARE_ACCOUNT_ID: `${MARKER}-env`, CLOUDFLARE_EMAIL_DOMAIN: `${MARKER}-env.example` };
    await withCloudflareSettings("check-login", recording(EXIT.ok).load, env)(["--target", "cloudflare", "--stage", "prod"], io);
    expect(io.err).toContain("check-login: note: ");
    expect(io.err).toContain("check-login: WARNING: ");
    expect(io.out + io.err).not.toContain(MARKER);
  });
});

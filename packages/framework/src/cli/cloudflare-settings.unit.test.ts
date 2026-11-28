import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
let home: string;
const git = (...args: string[]): void => void execFileSync("git", args, { cwd: dir, stdio: "ignore" });
/** The project's old `.env.cloudflare` (retired, DEC-0799): never read, only noted and git-checked. */
const writeEnvFile = (text: string): void => writeFileSync(join(dir, ".env.cloudflare"), text);
const secretsPath = (): string => join(home, ".secrets", "cloudflare");
function writeSecrets(text: string): void {
  mkdirSync(join(home, ".secrets"), { recursive: true });
  writeFileSync(secretsPath(), text, { mode: 0o600 });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pf-cli-settings-"));
  home = mkdtempSync(join(tmpdir(), "pf-cli-home-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
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

describe("every Cloudflare command reads the environment, then the secrets file (DEC-0795; DEC-0572, DEC-0573)", () => {
  it("--target cloudflare: the command is built with the secrets file's values, the environment winning", async () => {
    writeSecrets(`CLOUDFLARE_API_TOKEN=${FILE_TOKEN}\nCLOUDFLARE_ACCOUNT_ID=file-account\n`);
    const { seen, load } = recording(EXIT.ok);
    const io = captureIo(dir);
    const env = { PATH: "/bin", HOME: home, CLOUDFLARE_ACCOUNT_ID: "env-account" };
    expect(await withCloudflareSettings("deploy", load, env)(["--target", "cloudflare", "--stage", "test-a"], io)).toBe(EXIT.ok);
    expect(seen).toEqual([{ PATH: "/bin", HOME: home, CLOUDFLARE_API_TOKEN: FILE_TOKEN, CLOUDFLARE_ACCOUNT_ID: "env-account" }]);
    expect(io.out + io.err).not.toContain(MARKER);
  });

  it("CLOUDFLARE_SECRETS_FILE points the commands at another file", async () => {
    const other = join(home, "cf.env");
    writeFileSync(other, `CLOUDFLARE_API_TOKEN=${FILE_TOKEN}\n`, { mode: 0o600 });
    const { seen, load } = recording(EXIT.ok);
    await withCloudflareSettings("deploy", load, { HOME: home, CLOUDFLARE_SECRETS_FILE: other })(["--target", "cloudflare", "--stage", "test-a"], captureIo(dir));
    expect(seen[0]?.CLOUDFLARE_API_TOKEN).toBe(FILE_TOKEN);
  });

  it("the project's old .env.cloudflare is not read: a note says to move it, and its values never reach the command", async () => {
    writeEnvFile(`CLOUDFLARE_API_TOKEN=${FILE_TOKEN}\nCLOUDFLARE_ACCOUNT_ID=file-account\n`);
    const { seen, load } = recording(EXIT.ok);
    const io = captureIo(dir);
    await withCloudflareSettings("deploy", load, { HOME: home })(["--target", "cloudflare", "--stage", "test-a"], io);
    expect(seen).toEqual([{ HOME: home }]);
    expect(io.err).toContain(`deploy: note: .env.cloudflare in the project folder is no longer read: put CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in ${secretsPath()}`);
    expect(io.out + io.err).not.toContain(MARKER);
  });

  it("the retired bootstrap token never reaches a command, from the environment or the file", async () => {
    writeSecrets(`CLOUDFLARE_BOOTSTRAP_TOKEN=${FILE_TOKEN}\nCLOUDFLARE_API_TOKEN=everyday\n`);
    const { seen, load } = recording(EXIT.ok);
    const io = captureIo(dir);
    await withCloudflareSettings("deploy", load, { HOME: home, CLOUDFLARE_BOOTSTRAP_TOKEN: ENV_TOKEN })(["--target", "cloudflare", "--stage", "test-a"], io);
    expect(seen).toEqual([{ HOME: home, CLOUDFLARE_API_TOKEN: "everyday" }]);
    expect(io.err).toContain("deploy: note: CLOUDFLARE_BOOTSTRAP_TOKEN is no longer used and was ignored");
    expect(io.out + io.err).not.toContain(MARKER);
  });

  it("another target reads no file and prints nothing extra", async () => {
    writeSecrets(`CLOUDFLARE_API_TOKEN=${FILE_TOKEN}\n`);
    writeEnvFile(`CLOUDFLARE_API_TOKEN=${FILE_TOKEN}\n`);
    const { seen, load } = recording(EXIT.ok);
    const io = captureIo(dir);
    const env = { PATH: "/bin", HOME: home };
    await withCloudflareSettings("admins", load, env)(["list", "--target", "local", "--stage", "s"], io);
    await withCloudflareSettings("mail", load, env)(["last", "--to", "a@example.invalid"], io);
    expect(seen).toEqual([env, env]);
    expect(io.err).toBe("");
  });

  it("names a setting that differs between the sources, never its value", async () => {
    writeSecrets(`CLOUDFLARE_API_TOKEN=${FILE_TOKEN}\n`);
    const { seen, load } = recording(EXIT.ok);
    const io = captureIo(dir);
    await withCloudflareSettings("remove", load, { HOME: home, CLOUDFLARE_API_TOKEN: ENV_TOKEN })(["--target=cloudflare", "--stage", "test-a"], io);
    expect(seen[0]?.CLOUDFLARE_API_TOKEN).toBe(ENV_TOKEN);
    expect(io.err).toBe(`remove: note: CLOUDFLARE_API_TOKEN is set in both the environment and ${secretsPath()} and they differ: using the environment\n`);
  });

  it.runIf(process.platform !== "win32")("a secrets file others can read: a note on every run, and the exit status is the command's own (DEC-0800)", async () => {
    writeSecrets(`CLOUDFLARE_API_TOKEN=${FILE_TOKEN}\n`);
    chmodSync(secretsPath(), 0o644);
    for (const status of [EXIT.ok, EXIT.failed]) {
      const io = captureIo(dir);
      expect(await withCloudflareSettings("deploy", recording(status).load, { HOME: home })(["--target", "cloudflare", "--stage", "test-a"], io)).toBe(status);
      expect(io.err).toBe(`deploy: note: the secrets file ${secretsPath()} can be read by other users (mode 644); make it private with: chmod 600 ${secretsPath()}\n`);
    }
  });

  it("an old .env.cloudflare git does not ignore: a prominent warning on every run, and the exit status is the command's own", async () => {
    git("init", "-q");
    writeEnvFile(`CLOUDFLARE_API_TOKEN=${FILE_TOKEN}\n`);
    for (const status of [EXIT.ok, EXIT.failed, EXIT.ok]) {
      const io = captureIo(dir);
      expect(await withCloudflareSettings("deploy", recording(status).load, { HOME: home })(["--target", "cloudflare", "--stage", "test-a"], io)).toBe(status);
      expect(io.err).toMatch(/={78}\ndeploy: WARNING: \.env\.cloudflare holds your Cloudflare tokens and git does not ignore it: .*\n={78}\n$/);
      expect(io.out).toBe("ran\n");
      expect(io.out + io.err).not.toContain(MARKER);
    }
  });

  it("an old tracked .env.cloudflare: the warning says the tokens are in the history and how to replace them; the command still runs", async () => {
    git("init", "-q");
    writeEnvFile(`CLOUDFLARE_API_TOKEN=${FILE_TOKEN}\n`);
    git("add", ".env.cloudflare");
    const io = captureIo(dir);
    expect(await withCloudflareSettings("secrets set", recording(EXIT.ok).load, { HOME: home })(["set", "X", "--target", "cloudflare", "--stage", "test-a"], io)).toBe(EXIT.ok);
    expect(io.err).toContain("secrets set: WARNING: .env.cloudflare is tracked by git, so the Cloudflare tokens in it are in the repository's history");
    expect(io.err).toContain("git rm --cached .env.cloudflare");
    expect(io.out).toBe("ran\n");
    expect(io.out + io.err).not.toContain(MARKER);
  });

  it("no old file and a private secrets file: no note and no warning", async () => {
    writeSecrets(`CLOUDFLARE_API_TOKEN=${FILE_TOKEN}\n`);
    git("init", "-q");
    const io = captureIo(dir);
    await withCloudflareSettings("stop", recording(EXIT.ok).load, { HOME: home })(["--target", "cloudflare", "--stage", "test-a"], io);
    expect(io.err).toBe("");
  });

  it("a fake token with a marker appears in no output, whatever the files hold", async () => {
    git("init", "-q");
    writeEnvFile([`CLOUDFLARE_BOOTSTRAP_TOKEN=${FILE_TOKEN}`, `CLOUDFLARE_API_TOKEN="${FILE_TOKEN}`, FILE_TOKEN].join("\n"));
    git("add", ".env.cloudflare");
    writeSecrets([`CLOUDFLARE_BOOTSTRAP_TOKEN=${FILE_TOKEN}`, `CLOUDFLARE_API_TOKEN="${FILE_TOKEN}`, FILE_TOKEN, `CLOUDFLARE_ACCOUNT_ID=${MARKER}`].join("\n"));
    const io = captureIo(dir);
    const env = { HOME: home, CLOUDFLARE_BOOTSTRAP_TOKEN: ENV_TOKEN, CLOUDFLARE_API_TOKEN: ENV_TOKEN, CLOUDFLARE_ACCOUNT_ID: `${MARKER}-env` };
    await withCloudflareSettings("check-login", recording(EXIT.ok).load, env)(["--target", "cloudflare", "--stage", "prod"], io);
    expect(io.err).toContain("check-login: note: ");
    expect(io.err).toContain("check-login: WARNING: ");
    expect(io.out + io.err).not.toContain(MARKER);
  });
});

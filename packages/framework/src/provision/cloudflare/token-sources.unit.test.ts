/**
 * The one credential's sources (DEC-0795, DEC-0799, DEC-0800; setup.md SETUP-REQ-002): the
 * environment first, then the secrets file in the home directory (PAR-450) or where
 * `CLOUDFLARE_SECRETS_FILE` points (PAR-451). Fake values only; every notice is searched for them.
 * No network.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cloudflareEnvironment,
  CREDENTIAL_TEMPLATE,
  DEFAULT_SECRETS_FILE,
  describeSource,
  ENV_CLOUDFLARE_FILE,
  mergeCloudflareSettings,
  readCloudflareSettings,
  SECRETS_FILE_ENV,
  secretsFilePath,
  SETTING_NAMES,
} from "./token-sources.js";

// Fake values only. The marker makes any leak of a value into a message easy to find.
const MARKER = "zzLEAKMARKERzz";
const FILE_TOKEN = `file-token-${MARKER}-1`;
const ENV_TOKEN = `env-token-${MARKER}-2`;
const isPosix = process.platform !== "win32";

let home: string;
let project: string;
const secrets = (): string => join(home, ".secrets", "cloudflare");
function writeSecrets(text: string, mode = 0o600, path = secrets()): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text, { mode });
  chmodSync(path, mode);
}
const noticesText = (n: readonly string[]): string => n.join("\n");

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "pf-home-"));
  project = mkdtempSync(join(tmpdir(), "pf-project-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
});

describe("the credential's names and template (owner decisions 1 and 2, DEC-0795)", () => {
  it("reads exactly CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID, and the template is those two lines with nothing after the =", () => {
    expect(SETTING_NAMES).toEqual(["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]);
    expect(CREDENTIAL_TEMPLATE).toBe("CLOUDFLARE_API_TOKEN=\nCLOUDFLARE_ACCOUNT_ID=\n");
  });
});

describe("the secrets file's path (PAR-450, PAR-451)", () => {
  it("defaults to ~/.secrets/cloudflare in the home directory, never the project", () => {
    expect(DEFAULT_SECRETS_FILE).toBe("~/.secrets/cloudflare");
    expect(secretsFilePath({}, home)).toBe(join(home, ".secrets", "cloudflare"));
  });

  it("takes the home directory from HOME when no home is passed", () => {
    expect(secretsFilePath({ HOME: home })).toBe(join(home, ".secrets", "cloudflare"));
  });

  it("CLOUDFLARE_SECRETS_FILE overrides it: an absolute path as is, ~/ and a relative path from the home directory", () => {
    expect(SECRETS_FILE_ENV).toBe("CLOUDFLARE_SECRETS_FILE");
    expect(secretsFilePath({ CLOUDFLARE_SECRETS_FILE: "/etc/elsewhere/cf" }, home)).toBe("/etc/elsewhere/cf");
    expect(secretsFilePath({ CLOUDFLARE_SECRETS_FILE: "~/keys/cf" }, home)).toBe(join(home, "keys", "cf"));
    expect(secretsFilePath({ CLOUDFLARE_SECRETS_FILE: "keys/cf" }, home)).toBe(join(home, "keys", "cf"));
    expect(secretsFilePath({ CLOUDFLARE_SECRETS_FILE: "  " }, home)).toBe(join(home, ".secrets", "cloudflare"));
  });
});

describe("environment first, then the secrets file (SETUP-REQ-002)", () => {
  it("no file and no environment: nothing set, no notice, the file reported absent", () => {
    const s = readCloudflareSettings({}, { home });
    expect(s.values).toEqual({});
    expect(s.notices).toEqual([]);
    expect(s.fileExists).toBe(false);
    expect(s.filePath).toBe(secrets());
  });

  it("reads both settings from the file, and says where each came from by path, never by value", () => {
    writeSecrets(`CLOUDFLARE_API_TOKEN=${FILE_TOKEN}\nCLOUDFLARE_ACCOUNT_ID=acct-file\n`);
    const s = readCloudflareSettings({}, { home });
    expect(s.values).toEqual({ CLOUDFLARE_API_TOKEN: FILE_TOKEN, CLOUDFLARE_ACCOUNT_ID: "acct-file" });
    expect(s.sources).toEqual({ CLOUDFLARE_API_TOKEN: "file", CLOUDFLARE_ACCOUNT_ID: "file" });
    expect(describeSource(s, "CLOUDFLARE_API_TOKEN")).toBe(`the file ${secrets()}`);
    expect(describeSource(s, "CLOUDFLARE_API_TOKEN")).not.toContain(MARKER);
  });

  it("the environment wins per setting; a differing value gets a notice naming the setting only", () => {
    writeSecrets(`CLOUDFLARE_API_TOKEN=${FILE_TOKEN}\nCLOUDFLARE_ACCOUNT_ID=acct-file\n`);
    const s = readCloudflareSettings({ CLOUDFLARE_API_TOKEN: ENV_TOKEN }, { home });
    expect(s.values).toEqual({ CLOUDFLARE_API_TOKEN: ENV_TOKEN, CLOUDFLARE_ACCOUNT_ID: "acct-file" });
    expect(s.sources).toEqual({ CLOUDFLARE_API_TOKEN: "environment", CLOUDFLARE_ACCOUNT_ID: "file" });
    expect(describeSource(s, "CLOUDFLARE_API_TOKEN")).toBe("the environment variable CLOUDFLARE_API_TOKEN");
    expect(s.notices).toHaveLength(1);
    expect(s.notices[0]).toMatch(/CLOUDFLARE_API_TOKEN is set in both the environment and .* they differ: using the environment/);
    expect(noticesText(s.notices)).not.toContain(MARKER);
  });

  it("the same value in both sources gets no notice; whitespace-only or empty values count as absent", () => {
    writeSecrets(`CLOUDFLARE_API_TOKEN=${FILE_TOKEN}\nCLOUDFLARE_ACCOUNT_ID=\n`);
    const s = readCloudflareSettings({ CLOUDFLARE_API_TOKEN: FILE_TOKEN, CLOUDFLARE_ACCOUNT_ID: "   " }, { home });
    expect(s.notices).toEqual([]);
    expect(s.values).toEqual({ CLOUDFLARE_API_TOKEN: FILE_TOKEN });
  });

  it("the environment alone, with no file, is enough", () => {
    const s = readCloudflareSettings({ CLOUDFLARE_API_TOKEN: ENV_TOKEN, CLOUDFLARE_ACCOUNT_ID: "acct" }, { home });
    expect(s.values).toEqual({ CLOUDFLARE_API_TOKEN: ENV_TOKEN, CLOUDFLARE_ACCOUNT_ID: "acct" });
    expect(s.notices).toEqual([]);
  });

  it("reads the file CLOUDFLARE_SECRETS_FILE names instead of the default", () => {
    writeSecrets(`CLOUDFLARE_API_TOKEN=default-${MARKER}\n`);
    const other = join(home, "elsewhere", "cf.env");
    writeSecrets(`CLOUDFLARE_API_TOKEN=${FILE_TOKEN}\n`, 0o600, other);
    const s = readCloudflareSettings({ CLOUDFLARE_SECRETS_FILE: other }, { home });
    expect(s.values.CLOUDFLARE_API_TOKEN).toBe(FILE_TOKEN);
    expect(s.filePath).toBe(other);
  });

  it("parses .env lines: comments, blank lines, export, quotes and a trailing comment; a later line wins; other names are ignored", () => {
    writeSecrets(["# my Cloudflare", "", "export CLOUDFLARE_API_TOKEN='first'", `CLOUDFLARE_API_TOKEN="${FILE_TOKEN}" # the admin token`, "CLOUDFLARE_ACCOUNT_ID=acct # mine", "OTHER=x"].join("\n"));
    const s = readCloudflareSettings({}, { home });
    expect(s.values).toEqual({ CLOUDFLARE_API_TOKEN: FILE_TOKEN, CLOUDFLARE_ACCOUNT_ID: "acct" });
    expect(s.notices).toEqual([]);
  });

  it("a line that is not NAME=value is named by number, never shown, and ignored", () => {
    writeSecrets(`CLOUDFLARE_API_TOKEN=${FILE_TOKEN}\nthis is ${MARKER} not an assignment\nCLOUDFLARE_ACCOUNT_ID="unclosed ${MARKER}\n`);
    const s = readCloudflareSettings({}, { home });
    expect(s.values).toEqual({ CLOUDFLARE_API_TOKEN: FILE_TOKEN });
    expect(s.notices).toEqual([`line 2 of ${secrets()} is not a NAME=value line and was ignored`, `line 3 of ${secrets()} is not a NAME=value line and was ignored`]);
  });

  it.runIf(isPosix)("a file that cannot be read is a notice, and the environment is used", () => {
    writeSecrets(`CLOUDFLARE_API_TOKEN=${FILE_TOKEN}\n`, 0o000);
    // root reads any file; then there is nothing to check.
    if (process.getuid?.() === 0) return;
    const s = readCloudflareSettings({ CLOUDFLARE_ACCOUNT_ID: "acct" }, { home });
    expect(s.values).toEqual({ CLOUDFLARE_ACCOUNT_ID: "acct" });
    expect(noticesText(s.notices)).toMatch(/could not be read \(EACCES\): using the environment only/);
  });
});

describe("the framework never writes the credential (DEC-0799)", () => {
  it("reading leaves the file byte for byte and creates nothing in the home directory or the project", () => {
    const text = `CLOUDFLARE_API_TOKEN=${FILE_TOKEN}\nCLOUDFLARE_ACCOUNT_ID=\n`;
    writeSecrets(text);
    const before = statSync(secrets()).mtimeMs;
    readCloudflareSettings({}, { home, projectDir: project });
    cloudflareEnvironment({}, { home, projectDir: project });
    expect(readFileSync(secrets(), "utf8")).toBe(text);
    expect(statSync(secrets()).mtimeMs).toBe(before);
    expect(readdirSync(join(home, ".secrets"))).toEqual(["cloudflare"]);
    expect(readdirSync(project)).toEqual([]);
  });

  it("no file: reading does not create one", () => {
    readCloudflareSettings({}, { home });
    expect(existsSync(join(home, ".secrets"))).toBe(false);
  });
});

describe("a secrets file others can read is warned about, never refused (owner decision 5, DEC-0800)", () => {
  it.runIf(isPosix)("mode 644 or 640: a notice with the path and chmod 600, and the values are still used", () => {
    for (const mode of [0o644, 0o640, 0o604]) {
      writeSecrets(`CLOUDFLARE_API_TOKEN=${FILE_TOKEN}\n`, mode);
      const s = readCloudflareSettings({}, { home });
      expect(s.values.CLOUDFLARE_API_TOKEN).toBe(FILE_TOKEN);
      expect(s.notices.filter((n) => n.includes("can be read by other users")), mode.toString(8)).toEqual([
        `the secrets file ${secrets()} can be read by other users (mode ${mode.toString(8)}); make it private with: chmod 600 ${secrets()}`,
      ]);
    }
  });

  it.runIf(isPosix)("mode 600 and 400: no warning", () => {
    for (const mode of [0o600, 0o400]) {
      writeSecrets(`CLOUDFLARE_API_TOKEN=${FILE_TOKEN}\n`, mode);
      expect(readCloudflareSettings({}, { home }).notices, mode.toString(8)).toEqual([]);
      chmodSync(secrets(), 0o600);
    }
  });
});

describe("the old .env.cloudflare and bootstrap token are not read (DEC-0796, DEC-0799)", () => {
  it("a project's .env.cloudflare is never read; a notice says to move its values to the secrets file", () => {
    writeFileSync(join(project, ENV_CLOUDFLARE_FILE), `CLOUDFLARE_API_TOKEN=${FILE_TOKEN}\nCLOUDFLARE_ACCOUNT_ID=acct\n`);
    const s = readCloudflareSettings({}, { home, projectDir: project });
    expect(s.values).toEqual({});
    expect(s.notices).toEqual([`.env.cloudflare in the project folder is no longer read: put CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in ${secrets()} (or in the environment), then delete .env.cloudflare`]);
  });

  it("CLOUDFLARE_BOOTSTRAP_TOKEN in the environment or the file: ignored, with a notice that never shows it", () => {
    for (const [env, file] of [[{ CLOUDFLARE_BOOTSTRAP_TOKEN: ENV_TOKEN }, ""], [{}, `CLOUDFLARE_BOOTSTRAP_TOKEN=${FILE_TOKEN}\n`]] as const) {
      if (file !== "") writeSecrets(file);
      const s = readCloudflareSettings(env, { home });
      expect(s.values).toEqual({});
      expect(s.notices).toEqual(["CLOUDFLARE_BOOTSTRAP_TOKEN is no longer used and was ignored: the framework needs only CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID. You can remove it."]);
    }
  });
});

describe("the merged environment every Cloudflare command runs with", () => {
  it("adds the file's values, the environment winning, and leaves out the retired bootstrap token and whitespace-only settings", () => {
    writeSecrets(`CLOUDFLARE_API_TOKEN=${FILE_TOKEN}\nCLOUDFLARE_ACCOUNT_ID=acct-file\n`);
    const env = { PATH: "/bin", CLOUDFLARE_ACCOUNT_ID: "acct-env", CLOUDFLARE_BOOTSTRAP_TOKEN: ENV_TOKEN };
    expect(cloudflareEnvironment(env, { home })).toEqual({ PATH: "/bin", CLOUDFLARE_API_TOKEN: FILE_TOKEN, CLOUDFLARE_ACCOUNT_ID: "acct-env" });
    expect(mergeCloudflareSettings({ CLOUDFLARE_API_TOKEN: "  " }, readCloudflareSettings({}, { home: join(home, "none") }))).toEqual({});
  });
});

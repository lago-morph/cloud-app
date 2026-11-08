// The live pass's secrets directory (DEC-0793): the test Cloudflare account's ID and its tokens live
// in one mode-700 directory outside the repository, one mode-600 file each; the process environment
// (which in this sandbox holds the primary Cloudflare account's token and ID) is never read.
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_SECRETS_DIR, loadSecrets, SECRET, saveSecret, secretsProblems, TOKEN_NAMES } from "./lib/secrets.mjs";

const TEST_ACCOUNT = "0123456789abcdef0123456789abcdef";
const PRIMARY_ACCOUNT = "fedcba9876543210fedcba9876543210";

function dir() {
  const d = join(mkdtempSync(join(tmpdir(), "live-pass-secrets-")), "s");
  mkdirSync(d, { mode: 0o700 });
  return d;
}
function put(d: string, name: string, value: string, mode = 0o600) {
  writeFileSync(join(d, name), `${value}\n`, { mode });
  chmodSync(join(d, name), mode);
}

describe("loadSecrets", () => {
  it("reads one value per file, trimmed, and nothing from the process environment", () => {
    const d = dir();
    put(d, SECRET.account, TEST_ACCOUNT);
    put(d, SECRET.owner, "owner-token-value-1234");
    const { values, loose } = loadSecrets(d);
    expect(values).toEqual({ [SECRET.account]: TEST_ACCOUNT, [SECRET.owner]: "owner-token-value-1234" });
    expect(loose).toEqual([]);
  });

  it("is empty for a directory that does not exist", () => {
    expect(loadSecrets(join(tmpdir(), "live-pass-no-such-dir-xyz"))).toEqual({ values: {}, loose: [] });
  });

  it("ignores files whose names are not secret names, and empty files", () => {
    const d = dir();
    put(d, "notes.txt", "x");
    put(d, SECRET.starter, "");
    expect(loadSecrets(d).values).toEqual({});
  });

  it("names a file, or the directory, that other users can read", () => {
    const d = dir();
    put(d, SECRET.owner, "owner-token-value-1234", 0o644);
    expect(loadSecrets(d).loose).toEqual([join(d, SECRET.owner)]);
    chmodSync(d, 0o755);
    expect(loadSecrets(d).loose).toContain(d);
  });
});

describe("DEFAULT_SECRETS_DIR", () => {
  it("is ~/.live-pass-secrets, outside the repository (runbook, \"For the agent in the session\", step 1)", () => {
    expect(DEFAULT_SECRETS_DIR).toBe(join(homedir(), ".live-pass-secrets"));
    const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
    expect(relative(repo, DEFAULT_SECRETS_DIR).startsWith("..")).toBe(true);
  });
});

describe("saveSecret", () => {
  it("writes the value in a mode-600 file inside a mode-700 directory", () => {
    const d = join(mkdtempSync(join(tmpdir(), "live-pass-secrets-")), "new");
    saveSecret(d, SECRET.everyday, "rolled-value-abcdefgh");
    expect(statSync(d).mode & 0o777).toBe(0o700);
    expect(statSync(join(d, SECRET.everyday)).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(d, SECRET.everyday), "utf8").trim()).toBe("rolled-value-abcdefgh");
    expect(loadSecrets(d).values[SECRET.everyday]).toBe("rolled-value-abcdefgh");
  });

  it("refuses a name that is not a secret name (no path outside the directory)", () => {
    expect(() => saveSecret(dir(), "../x", "v")).toThrow(/not a secret name/);
  });
});

describe("secretsProblems", () => {
  const ok = { [SECRET.account]: TEST_ACCOUNT, [SECRET.owner]: "owner-token-value-1234" };

  it("accepts the test Cloudflare account's ID and the owner's token", () => {
    expect(secretsProblems({ values: ok, loose: [] }, { dir: "/d", primaryAccountId: PRIMARY_ACCOUNT })).toEqual([]);
  });

  it("names a missing account ID or owner token", () => {
    const p = secretsProblems({ values: {}, loose: [] }, { dir: "/d" });
    expect(p.join("\n")).toContain(SECRET.account);
    expect(p.join("\n")).toContain(SECRET.owner);
  });

  it("refuses an account ID that is not 32 hexadecimal characters", () => {
    expect(secretsProblems({ values: { ...ok, [SECRET.account]: "my-account" }, loose: [] }, { dir: "/d" }).join("\n")).toMatch(/32 hexadecimal/);
  });

  it("refuses the primary Cloudflare account's ID (this sandbox's own) as the test Cloudflare account's", () => {
    const p = secretsProblems({ values: { ...ok, [SECRET.account]: PRIMARY_ACCOUNT }, loose: [] }, { dir: "/d", primaryAccountId: PRIMARY_ACCOUNT });
    expect(p.join("\n")).toMatch(/primary Cloudflare account/);
  });

  it("refuses loose files and two names holding the same token", () => {
    const p = secretsProblems({ values: { ...ok, [SECRET.starter]: "owner-token-value-1234" }, loose: ["/d/X"] }, { dir: "/d" });
    expect(p.join("\n")).toMatch(/\/d\/X can be read by other users/);
    expect(p.join("\n")).toMatch(new RegExp(`${SECRET.owner} and ${SECRET.starter} hold the same token`));
  });

  it("counts every token name, and not the account ID, as a token", () => {
    expect(TOKEN_NAMES).not.toContain(SECRET.account);
    expect(TOKEN_NAMES).toEqual(expect.arrayContaining([SECRET.owner, SECRET.starter, SECRET.starterRerun, SECRET.everyday]));
  });
});

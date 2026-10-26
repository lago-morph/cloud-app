import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BOOTSTRAP_DELETED_LINE,
  cloudflareEnvironment,
  commentOutBootstrap,
  mergeCloudflareSettings,
  ENV_CLOUDFLARE_FILE,
  ENV_CLOUDFLARE_TEMPLATE,
  fillInSettings,
  readCloudflareSettings,
  SETTING_NAMES,
  writeTemplateIfAbsent,
} from "./token-sources.js";

// Fake values only. The marker makes any leak of a value into a message easy to find.
const MARKER = "zzLEAKMARKERzz";
const FILE_TOKEN = `file-token-${MARKER}-1`;
const ENV_TOKEN = `env-token-${MARKER}-2`;

let dir: string;
const file = (): string => join(dir, ENV_CLOUDFLARE_FILE);
const write = (text: string): void => writeFileSync(file(), text);
const read = (): string => readFileSync(file(), "utf8");
const mode = (): number => statSync(file()).mode & 0o777;
const isPosix = process.platform !== "win32";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pf-token-sources-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe(".env.cloudflare and the environment (plan-setup-wizard §4.2; DEC-0570, DEC-0571, DEC-0573)", () => {
  it("names the four settings and writes plan §3.2's template exactly", () => {
    expect(SETTING_NAMES).toEqual(["CLOUDFLARE_BOOTSTRAP_TOKEN", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_EMAIL_DOMAIN", "CLOUDFLARE_ACCOUNT_ID"]);
    expect(ENV_CLOUDFLARE_TEMPLATE).toBe(
      "CLOUDFLARE_BOOTSTRAP_TOKEN=\nCLOUDFLARE_API_TOKEN=\nCLOUDFLARE_EMAIL_DOMAIN=\n# CLOUDFLARE_ACCOUNT_ID=        (only if your tokens see more than one account)\n",
    );
    expect(writeTemplateIfAbsent(dir)).toBe(true);
    expect(read()).toBe(ENV_CLOUDFLARE_TEMPLATE);
    if (isPosix) expect(mode()).toBe(0o600);
    write("CLOUDFLARE_API_TOKEN=kept\n");
    expect(writeTemplateIfAbsent(dir)).toBe(false);
    expect(read()).toBe("CLOUDFLARE_API_TOKEN=kept\n");
    // The template holds no values: every setting reads as absent.
    rmSync(file());
    writeTemplateIfAbsent(dir);
    expect(readCloudflareSettings(dir, {}).values).toEqual({});
  });

  it("reads the environment first, then the file; empty values count as absent in either", () => {
    write(`CLOUDFLARE_API_TOKEN=${FILE_TOKEN}\nCLOUDFLARE_ACCOUNT_ID=file-account\nCLOUDFLARE_EMAIL_DOMAIN=\nCLOUDFLARE_BOOTSTRAP_TOKEN=file-bootstrap\n`);
    const settings = readCloudflareSettings(dir, { CLOUDFLARE_API_TOKEN: "", CLOUDFLARE_ACCOUNT_ID: "env-account", CLOUDFLARE_EMAIL_DOMAIN: "env.example" });
    expect(settings.fileExists).toBe(true);
    expect(settings.values).toEqual({ CLOUDFLARE_API_TOKEN: FILE_TOKEN, CLOUDFLARE_ACCOUNT_ID: "env-account", CLOUDFLARE_EMAIL_DOMAIN: "env.example", CLOUDFLARE_BOOTSTRAP_TOKEN: "file-bootstrap" });
    expect(settings.sources).toEqual({ CLOUDFLARE_API_TOKEN: "file", CLOUDFLARE_ACCOUNT_ID: "environment", CLOUDFLARE_EMAIL_DOMAIN: "environment", CLOUDFLARE_BOOTSTRAP_TOKEN: "file" });

    const none = readCloudflareSettings(dir, { CLOUDFLARE_EMAIL_DOMAIN: "" });
    expect(none.values.CLOUDFLARE_EMAIL_DOMAIN).toBeUndefined();
    expect(none.sources.CLOUDFLARE_EMAIL_DOMAIN).toBeUndefined();
  });

  it("without a file, the environment alone, and no notices", () => {
    const settings = readCloudflareSettings(dir, { CLOUDFLARE_API_TOKEN: ENV_TOKEN, OTHER: "x" });
    expect(settings).toEqual({ values: { CLOUDFLARE_API_TOKEN: ENV_TOKEN }, sources: { CLOUDFLARE_API_TOKEN: "environment" }, notices: [], fileExists: false });
    expect(cloudflareEnvironment(dir, { CLOUDFLARE_API_TOKEN: ENV_TOKEN, OTHER: "x" })).toEqual({ CLOUDFLARE_API_TOKEN: ENV_TOKEN, OTHER: "x" });
  });

  it("when both are set and differ, says the environment is used, naming the setting and never a value", () => {
    write(`CLOUDFLARE_API_TOKEN=${FILE_TOKEN}\nCLOUDFLARE_ACCOUNT_ID=same\n`);
    const settings = readCloudflareSettings(dir, { CLOUDFLARE_API_TOKEN: ENV_TOKEN, CLOUDFLARE_ACCOUNT_ID: "same" });
    expect(settings.values.CLOUDFLARE_API_TOKEN).toBe(ENV_TOKEN);
    expect(settings.notices).toEqual(["CLOUDFLARE_API_TOKEN is set in both the environment and .env.cloudflare and they differ: using the environment"]);
    expect(settings.notices.join("\n")).not.toContain(MARKER);
  });

  it("parses comments, blank lines, quotes, export and inline comments; names unreadable lines by number only", () => {
    write(
      [
        "# a comment",
        "",
        `  export CLOUDFLARE_API_TOKEN = "${FILE_TOKEN}"  `,
        "CLOUDFLARE_ACCOUNT_ID='acc-quoted' # the account",
        "CLOUDFLARE_EMAIL_DOMAIN=mail.example # the domain",
        `${FILE_TOKEN}`,
        `CLOUDFLARE_BOOTSTRAP_TOKEN="${FILE_TOKEN}`,
        "# CLOUDFLARE_BOOTSTRAP_TOKEN=commented",
        "UNRELATED=ignored",
      ].join("\r\n"),
    );
    const settings = readCloudflareSettings(dir, {});
    expect(settings.values).toEqual({ CLOUDFLARE_API_TOKEN: FILE_TOKEN, CLOUDFLARE_ACCOUNT_ID: "acc-quoted", CLOUDFLARE_EMAIL_DOMAIN: "mail.example" });
    expect(settings.notices).toEqual([
      "line 6 of .env.cloudflare is not a NAME=value line and was ignored",
      "line 7 of .env.cloudflare is not a NAME=value line and was ignored",
    ]);
    expect(settings.notices.join("\n")).not.toContain(MARKER);
    expect(cloudflareEnvironment(dir, {}).UNRELATED).toBeUndefined();
  });

  it("cloudflareEnvironment merges the file into the environment, the environment winning", () => {
    write(`CLOUDFLARE_API_TOKEN=${FILE_TOKEN}\nCLOUDFLARE_ACCOUNT_ID=file-account\n`);
    expect(cloudflareEnvironment(dir, { PATH: "/bin", CLOUDFLARE_ACCOUNT_ID: "env-account", CLOUDFLARE_API_TOKEN: "" })).toEqual({
      PATH: "/bin",
      CLOUDFLARE_API_TOKEN: FILE_TOKEN,
      CLOUDFLARE_ACCOUNT_ID: "env-account",
    });
  });

  it.runIf(isPosix)("an unreadable file is a notice, not a failure, and gives no values", () => {
    if (process.getuid?.() === 0) return; // root reads any file
    write(`CLOUDFLARE_API_TOKEN=${FILE_TOKEN}\n`);
    chmodSync(file(), 0o000);
    const settings = readCloudflareSettings(dir, {});
    expect(settings.values).toEqual({});
    expect(settings.notices).toEqual([".env.cloudflare could not be read (EACCES): using the environment only"]);
  });

  it("comments out the bootstrap line and leaves the rest as it was, at mode 600", () => {
    expect(commentOutBootstrap(dir)).toBe(false);
    expect(existsSync(file())).toBe(false);
    write(`# mine\nCLOUDFLARE_BOOTSTRAP_TOKEN=${FILE_TOKEN}\nCLOUDFLARE_API_TOKEN=everyday\n`);
    chmodSync(file(), 0o644);
    expect(commentOutBootstrap(dir)).toBe(true);
    expect(read()).toBe(`# mine\n${BOOTSTRAP_DELETED_LINE}\nCLOUDFLARE_API_TOKEN=everyday\n`);
    expect(BOOTSTRAP_DELETED_LINE).toBe("# CLOUDFLARE_BOOTSTRAP_TOKEN=deleted by setup process");
    if (isPosix) expect(mode()).toBe(0o600);
    expect(readCloudflareSettings(dir, {}).values.CLOUDFLARE_BOOTSTRAP_TOKEN).toBeUndefined();
    // Nothing left to comment out.
    expect(commentOutBootstrap(dir)).toBe(false);
  });

  it("fills in an empty account ID and email domain, uncommenting the template's account line, at mode 600", () => {
    writeTemplateIfAbsent(dir);
    chmodSync(file(), 0o664);
    expect(fillInSettings(dir, { CLOUDFLARE_ACCOUNT_ID: "fake-account", CLOUDFLARE_EMAIL_DOMAIN: "mail.example" })).toEqual(["CLOUDFLARE_EMAIL_DOMAIN", "CLOUDFLARE_ACCOUNT_ID"]);
    expect(read()).toBe("CLOUDFLARE_BOOTSTRAP_TOKEN=\nCLOUDFLARE_API_TOKEN=\nCLOUDFLARE_EMAIL_DOMAIN=mail.example\nCLOUDFLARE_ACCOUNT_ID=fake-account\n");
    if (isPosix) expect(mode()).toBe(0o600);
  });

  it("never changes a value already in the file; adds a missing line; never creates an absent file (plan §3.4, SETUP-AC-002)", () => {
    write(`CLOUDFLARE_API_TOKEN=${FILE_TOKEN}\nCLOUDFLARE_EMAIL_DOMAIN=kept.example\n`);
    expect(fillInSettings(dir, { CLOUDFLARE_ACCOUNT_ID: "fake-account", CLOUDFLARE_EMAIL_DOMAIN: "other.example" })).toEqual(["CLOUDFLARE_ACCOUNT_ID"]);
    expect(read()).toBe(`CLOUDFLARE_API_TOKEN=${FILE_TOKEN}\nCLOUDFLARE_EMAIL_DOMAIN=kept.example\nCLOUDFLARE_ACCOUNT_ID=fake-account\n`);
    expect(fillInSettings(dir, { CLOUDFLARE_ACCOUNT_ID: "another" })).toEqual([]);

    rmSync(file());
    expect(fillInSettings(dir, { CLOUDFLARE_EMAIL_DOMAIN: "mail.example" })).toEqual([]);
    expect(existsSync(file())).toBe(false);
  });

  it("refuses a value it could not write back as one line, without naming the value", () => {
    writeTemplateIfAbsent(dir);
    expect(() => fillInSettings(dir, { CLOUDFLARE_ACCOUNT_ID: `bad ${MARKER}` })).toThrow(/^CLOUDFLARE_ACCOUNT_ID cannot be written to \.env\.cloudflare: the value holds a space, quote, backslash or #$/);
    expect(read()).toBe(ENV_CLOUDFLARE_TEMPLATE);
  });

  it.runIf(isPosix)("every write leaves the file at mode 600, also when it was wider before", () => {
    const writes: (() => unknown)[] = [
      () => writeTemplateIfAbsent(dir),
      () => fillInSettings(dir, { CLOUDFLARE_EMAIL_DOMAIN: "mail.example" }),
      () => commentOutBootstrap(dir),
      () => fillInSettings(dir, { CLOUDFLARE_ACCOUNT_ID: "fake-account" }),
    ];
    for (const step of writes) {
      if (existsSync(file())) chmodSync(file(), 0o666);
      expect(step()).toBeTruthy();
      expect(mode()).toBe(0o600);
    }
    expect(read()).toBe(`${BOOTSTRAP_DELETED_LINE}\nCLOUDFLARE_API_TOKEN=\nCLOUDFLARE_EMAIL_DOMAIN=mail.example\nCLOUDFLARE_ACCOUNT_ID=fake-account\n`);
  });

  it("the template's hint is not part of a value: a hint-only line reads as empty and is filled; a value typed before the hint is the value", () => {
    const hint = "(only if your tokens see more than one account)";
    write(`CLOUDFLARE_API_TOKEN=t\nCLOUDFLARE_ACCOUNT_ID=        ${hint}\n`);
    expect(readCloudflareSettings(dir, {}).values.CLOUDFLARE_ACCOUNT_ID).toBeUndefined();
    expect(readCloudflareSettings(dir, {}).notices).toEqual([]);
    expect(fillInSettings(dir, { CLOUDFLARE_ACCOUNT_ID: "fake-account" })).toEqual(["CLOUDFLARE_ACCOUNT_ID"]);
    expect(read()).toBe("CLOUDFLARE_API_TOKEN=t\nCLOUDFLARE_ACCOUNT_ID=fake-account\n");

    write(`CLOUDFLARE_ACCOUNT_ID=typed-account        ${hint}\nCLOUDFLARE_EMAIL_DOMAIN=${hint}\n`);
    expect(readCloudflareSettings(dir, {}).values).toEqual({ CLOUDFLARE_ACCOUNT_ID: "typed-account" });
  });

  it("an unquoted value with a space inside is unreadable, named by its line number only", () => {
    write(`CLOUDFLARE_API_TOKEN=${FILE_TOKEN} ${FILE_TOKEN}\nCLOUDFLARE_ACCOUNT_ID=ok\n`);
    const settings = readCloudflareSettings(dir, {});
    expect(settings.values).toEqual({ CLOUDFLARE_ACCOUNT_ID: "ok" });
    expect(settings.notices).toEqual(["line 1 of .env.cloudflare is not a NAME=value line and was ignored"]);
  });

  it("an environment value of only whitespace counts as absent", () => {
    write(`CLOUDFLARE_API_TOKEN=${FILE_TOKEN}\n`);
    const settings = readCloudflareSettings(dir, { CLOUDFLARE_API_TOKEN: "  \t", CLOUDFLARE_ACCOUNT_ID: " " });
    expect(settings.values).toEqual({ CLOUDFLARE_API_TOKEN: FILE_TOKEN });
    expect(settings.sources).toEqual({ CLOUDFLARE_API_TOKEN: "file" });
    expect(settings.notices).toEqual([]);
  });

  it("a whitespace-only environment value is left out of the merged environment, also when the file has none", () => {
    const merged = cloudflareEnvironment(dir, { CLOUDFLARE_API_TOKEN: "   ", CLOUDFLARE_ACCOUNT_ID: " ", PATH: "/bin" });
    expect(merged.CLOUDFLARE_API_TOKEN).toBeUndefined();
    expect(merged.CLOUDFLARE_ACCOUNT_ID).toBeUndefined();
    expect(merged.PATH).toBe("/bin");
    expect(mergeCloudflareSettings({ CLOUDFLARE_EMAIL_DOMAIN: "\t" }, readCloudflareSettings(dir, {})).CLOUDFLARE_EMAIL_DOMAIN).toBeUndefined();
  });

  it.runIf(isPosix)("a .env.cloudflare that is a symbolic link is written through to its target, which stays at mode 600; the link stays a link", () => {
    const shared = join(dir, "shared");
    mkdirSync(shared);
    const target = join(shared, "cloudflare.env");
    writeFileSync(target, `CLOUDFLARE_BOOTSTRAP_TOKEN=${FILE_TOKEN}\nCLOUDFLARE_API_TOKEN=x\n`);
    chmodSync(target, 0o644);
    symlinkSync(target, file());
    expect(commentOutBootstrap(dir)).toBe(true);
    expect(lstatSync(file()).isSymbolicLink()).toBe(true);
    expect(readFileSync(target, "utf8")).toBe(`${BOOTSTRAP_DELETED_LINE}\nCLOUDFLARE_API_TOKEN=x\n`);
    expect(statSync(target).mode & 0o777).toBe(0o600);
    expect(fillInSettings(dir, { CLOUDFLARE_EMAIL_DOMAIN: "example.test" })).toEqual(["CLOUDFLARE_EMAIL_DOMAIN"]);
    expect(lstatSync(file()).isSymbolicLink()).toBe(true);
    expect(readFileSync(target, "utf8")).toContain("CLOUDFLARE_EMAIL_DOMAIN=example.test\n");
    expect(readdirSync(shared)).toEqual(["cloudflare.env"]);
  });

  it.runIf(isPosix)("a .env.cloudflare that is a dangling symbolic link is written through: the target is created at mode 600 and the link stays a link (DEC-0614)", () => {
    const shared = join(dir, "shared");
    mkdirSync(shared);
    const target = join(shared, "cloudflare.env");
    // A relative link, through a second link, to a file not made yet.
    symlinkSync("hop", file());
    symlinkSync(join("shared", "cloudflare.env"), join(dir, "hop"));
    expect(writeTemplateIfAbsent(dir)).toBe(true);
    expect(lstatSync(file()).isSymbolicLink()).toBe(true);
    expect(lstatSync(join(dir, "hop")).isSymbolicLink()).toBe(true);
    expect(readFileSync(target, "utf8")).toBe(ENV_CLOUDFLARE_TEMPLATE);
    expect(statSync(target).mode & 0o777).toBe(0o600);
    expect(readdirSync(shared)).toEqual(["cloudflare.env"]);
    rmSync(target);
    expect(fillInSettings(dir, { CLOUDFLARE_EMAIL_DOMAIN: "example.test" })).toEqual(["CLOUDFLARE_EMAIL_DOMAIN"]);
    expect(lstatSync(file()).isSymbolicLink()).toBe(true);
    expect(readFileSync(target, "utf8")).toContain("CLOUDFLARE_EMAIL_DOMAIN=example.test\n");
    expect(statSync(target).mode & 0o777).toBe(0o600);
  });

  it("comments out a bootstrap line the parser cannot read, so no value stays in the file", () => {
    write(`CLOUDFLARE_BOOTSTRAP_TOKEN="${FILE_TOKEN}\nexport CLOUDFLARE_BOOTSTRAP_TOKEN = ${FILE_TOKEN} ${FILE_TOKEN}\nCLOUDFLARE_API_TOKEN=everyday\n`);
    expect(commentOutBootstrap(dir)).toBe(true);
    expect(read()).toBe(`${BOOTSTRAP_DELETED_LINE}\n${BOOTSTRAP_DELETED_LINE}\nCLOUDFLARE_API_TOKEN=everyday\n`);
    expect(read()).not.toContain(MARKER);
  });

  it.runIf(isPosix)("a rewrite replaces the file atomically (a new file renamed over it), at mode 600, leaving no temporary file", () => {
    write("CLOUDFLARE_BOOTSTRAP_TOKEN=b\nCLOUDFLARE_EMAIL_DOMAIN=\n");
    chmodSync(file(), 0o644);
    const before = statSync(file()).ino;
    expect(commentOutBootstrap(dir)).toBe(true);
    expect(statSync(file()).ino).not.toBe(before);
    expect(mode()).toBe(0o600);
    const again = statSync(file()).ino;
    expect(fillInSettings(dir, { CLOUDFLARE_EMAIL_DOMAIN: "mail.example" })).toEqual(["CLOUDFLARE_EMAIL_DOMAIN"]);
    expect(statSync(file()).ino).not.toBe(again);
    expect(mode()).toBe(0o600);
    expect(readdirSync(dir)).toEqual([ENV_CLOUDFLARE_FILE]);
  });
});

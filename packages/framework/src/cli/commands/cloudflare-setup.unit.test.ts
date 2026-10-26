/**
 * `cloudflare-setup` against the fake Cloudflare (plan-setup-wizard §6): every branch of §4.3, every
 * row of §3.4, the self-deletion, the in-place update, the token write guard, the local setup run
 * first, git warnings that never fail, and no token value, account ID, zone ID or workers.dev
 * subdomain in any output (every test's stdout and stderr are searched, DEC-0590).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ACCOUNT } from "../../provision/cloudflare/fake-cloud.test-support.js";
import { guardTokenWrites, NEXT_PROMPT } from "../../provision/cloudflare/cloudflare-setup.js";
import { ACCOUNT_SETUP_VERSION, BOOTSTRAP, deepLink, EVERYDAY } from "../../provision/cloudflare/permissions.js";
import { readSetupRecord, SETUP_STEPS } from "../../provision/cloudflare/setup-record.js";
import { applySetupSteps } from "../../provision/cloudflare/setup-steps.js";
import { dashboardPolicies, groupNamed, OTHER_ACCOUNT, SetupWorld } from "../../provision/cloudflare/setup-world.test-support.js";
import { runLocalSetup } from "../../provision/core/local-setup.js";
import { readDevVars } from "../../secrets/dev-vars.js";
import { captureIo } from "../io.test-support.js";
import { cloudflareSetupCommand, type CloudflareSetupCommandDeps } from "./cloudflare-setup.js";

const EVERYDAY_VALUE = "MARKER-everyday-token-value-000000000001";
const BOOT_VALUE = "MARKER-bootstrap-token-value-00000000002";
const OTHER_VALUE = "MARKER-other-token-value-00000000000003";
const SUB = "pf-markersubdomain";
const DOMAIN = "example.test";
const NOW = new Date("2026-10-26T12:00:00.000Z");
const EXPIRES = "2026-11-02T00:00:00Z";
const BOOT_LINK = deepLink("bootstrap");
const EVERYDAY_LINK = deepLink("everyday");

type Io = ReturnType<typeof captureIo>;
const runs: { io: Io; world: SetupWorld }[] = [];
const dirs: string[] = [];

afterEach(() => {
  // No output of any run holds a token value, an account ID, a zone ID or the subdomain.
  for (const { io, world } of runs.splice(0)) {
    const text = io.out + io.err;
    const zoneIds = [...world.accounts.values()].flatMap((a) => [...a.cloud.zones.values()].map((z) => z.id));
    for (const secret of ["MARKER", ACCOUNT, OTHER_ACCOUNT, SUB, ...zoneIds]) expect(text, `output holds ${secret.slice(0, 6)}…`).not.toContain(secret);
    // The messages leave the values out themselves; the run's redaction (DEC-0590) is only a backstop.
    expect(text).not.toContain("[hidden]");
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function project(options: { env?: string; repo?: boolean; gitignore?: string } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "cf-setup-"));
  dirs.push(dir);
  if (options.repo !== false) execFileSync("git", ["init", "-q"], { cwd: dir, stdio: "ignore" });
  if (options.gitignore !== undefined || options.repo !== false) writeFileSync(join(dir, ".gitignore"), options.gitignore ?? ".env.cloudflare\n");
  if (options.env !== undefined) writeFileSync(join(dir, ".env.cloudflare"), options.env);
  return dir;
}

const envFile = (lines: Record<string, string>) => Object.entries(lines).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
const readEnvFile = (dir: string) => readFileSync(join(dir, ".env.cloudflare"), "utf8");

/** A world whose accounts have no setup yet (no subdomain, so setup registers `SUB`). */
function freshWorld(): SetupWorld {
  const world = new SetupWorld();
  world.cloud().subdomain = undefined;
  return world;
}

async function setUpAccount(world: SetupWorld, accountId = ACCOUNT, emailDomain = DOMAIN): Promise<void> {
  const cloud = world.cloud(accountId);
  cloud.subdomain = undefined;
  await applySetupSteps(cloud.api, ACCOUNT, { emailDomain, steps: SETUP_STEPS, setupVersion: ACCOUNT_SETUP_VERSION, frameworkVersion: "0.0.0-test", now: () => NOW, newSubdomain: () => SUB, email: { sleep: async () => {} } });
}

/** A set-up account with a valid everyday token. */
async function setUpWorld(): Promise<SetupWorld> {
  const world = freshWorld();
  await setUpAccount(world);
  world.addToken("everyday", EVERYDAY_VALUE, "everyday-id");
  return world;
}

/** The local setup without npm: the real git-ignore step, the others already done. */
const fakeLocalSetup: NonNullable<CloudflareSetupCommandDeps["localSetup"]> = async (dir, o) => {
  const r = await o.ensureIgnored(dir);
  return [
    { step: "dependencies", result: "already" },
    { step: "local-secrets", result: "already" },
    r === "added" ? { step: "gitignore", result: "applied", message: "added .env.cloudflare to .gitignore" } : r === "already" ? { step: "gitignore", result: "already" } : { step: "gitignore", result: "warned", message: `WARNING: ${r}` },
  ];
};

interface RunOptions {
  env?: Record<string, string>;
  args?: string[];
  protectedTokenIds?: string[];
  reach?: (url: string) => Promise<void>;
  localSetup?: CloudflareSetupCommandDeps["localSetup"];
}

async function run(world: SetupWorld, dir: string, options: RunOptions = {}): Promise<{ status: number; io: Io; reached: string[] }> {
  const io = captureIo(dir);
  runs.push({ io, world });
  const reached: string[] = [];
  const status = await cloudflareSetupCommand({
    env: options.env ?? {},
    apiFor: world.apiFor,
    reach: options.reach ?? (async (url) => void reached.push(url)),
    localSetup: options.localSetup ?? fakeLocalSetup,
    stepOptions: { newSubdomain: () => SUB, email: { sleep: async () => {} } },
    frameworkVersion: "0.0.0-test",
    now: () => NOW,
    ...(options.protectedTokenIds === undefined ? {} : { protectedTokenIds: options.protectedTokenIds }),
  })(options.args ?? [], io);
  return { status, io, reached };
}

const bothTokens = (extra: Record<string, string> = {}) => envFile({ CLOUDFLARE_BOOTSTRAP_TOKEN: BOOT_VALUE, CLOUDFLARE_API_TOKEN: EVERYDAY_VALUE, CLOUDFLARE_EMAIL_DOMAIN: DOMAIN, ...extra });
const everydayOnly = (extra: Record<string, string> = {}) => envFile({ CLOUDFLARE_API_TOKEN: EVERYDAY_VALUE, CLOUDFLARE_EMAIL_DOMAIN: DOMAIN, ...extra });

describe("cloudflare-setup: no tokens (plan §3.2, §4.3 step 3)", () => {
  it("prints exactly the requirements, both links with what to choose, the template, where it goes and the next prompt; writes the template; exit 1", async () => {
    const world = freshWorld();
    const dir = project();
    const { status, io } = await run(world, dir);
    expect(status).toBe(1);
    expect(io.out).toBe(
      [
        "Cloudflare setup needs two API tokens, both made from pre-filled dashboard links. Setup never prints a token.",
        "",
        "Requirements:",
        "  - a Cloudflare account on the Workers Paid plan: sign-in by email (Better Auth with Cloudflare Email Sending) needs it;",
        "  - a domain on Cloudflare DNS in that account, which the sign-in emails are sent from.",
        "",
        "1. The bootstrap token (used once by this setup, which then deletes it), named prototype-framework-bootstrap:",
        `  ${BOOT_LINK}`,
        "  On the page: pick your account if the dashboard asks; keep your email domain's zone included (the link covers all the account's zones); under TTL, set an end date 7 days away or sooner. Then choose Continue to summary, then Create Token, and copy the token.",
        "",
        "2. The everyday token (used by deploy and the other commands), named prototype-framework:",
        `  ${EVERYDAY_LINK}`,
        "  On the page: pick your account if the dashboard asks; keep your email domain's zone included (the link covers all the account's zones); no TTL (expiry) is needed. Then choose Continue to summary, then Create Token, and copy the token.",
        "",
        "Fill in this template (leave CLOUDFLARE_EMAIL_DOMAIN empty to choose from your domains next time):",
        "CLOUDFLARE_BOOTSTRAP_TOKEN=",
        "CLOUDFLARE_API_TOKEN=",
        "CLOUDFLARE_EMAIL_DOMAIN=",
        "# CLOUDFLARE_ACCOUNT_ID=        (only if your tokens see more than one account)",
        "",
        "Where the values go:",
        "  - In a Claude Code cloud session: open the environment menu, choose Edit, and add each NAME=value line under Environment variables; save, then start a new session.",
        "  - On the command line: in the file .env.cloudflare in the project folder (which holds the template), or in the environment.",
        "",
        'Then say "continue prototype setup" (or run /prototype-framework continue setup); on the command line, run npm run cloudflare-setup again.',
        "",
      ].join("\n"),
    );
    expect(io.err).toBe("");
    expect(world.requests).toEqual([]);
    expect(readEnvFile(dir)).toBe("CLOUDFLARE_BOOTSTRAP_TOKEN=\nCLOUDFLARE_API_TOKEN=\nCLOUDFLARE_EMAIL_DOMAIN=\n# CLOUDFLARE_ACCOUNT_ID=        (only if your tokens see more than one account)\n");
    // Each link pre-fills its whole list.
    expect(new URL(BOOT_LINK).searchParams.get("permissionGroupKeys")).toContain(BOOTSTRAP[2]!.id);
    expect(new URL(EVERYDAY_LINK).searchParams.get("permissionGroupKeys")).toContain(EVERYDAY[6]!.id);
  });

  it("only a bootstrap token: asks for the everyday token with its link only", async () => {
    const world = freshWorld();
    world.addToken("bootstrap", BOOT_VALUE, "boot-id", { expires_on: EXPIRES });
    const { status, io } = await run(world, project({ env: envFile({ CLOUDFLARE_BOOTSTRAP_TOKEN: BOOT_VALUE }) }));
    expect(status).toBe(1);
    expect(io.out).toContain("CLOUDFLARE_API_TOKEN is not set");
    expect(io.out).toContain(EVERYDAY_LINK);
    expect(io.out).toContain("CLOUDFLARE_BOOTSTRAP_TOKEN=\nCLOUDFLARE_API_TOKEN=\nCLOUDFLARE_EMAIL_DOMAIN=\n");
    expect(io.out).not.toContain(BOOT_LINK);
    expect(world.writes()).toEqual([]);
  });
});

describe("cloudflare-setup: bad paste (plan §3.4)", () => {
  it("an everyday value that is not a token: names CLOUDFLARE_API_TOKEN and prints only its link", async () => {
    const world = freshWorld();
    const { status, io } = await run(world, project({ env: everydayOnly() }));
    expect(status).toBe(1);
    expect(io.out).toMatch(/^CLOUDFLARE_API_TOKEN \(the everyday token\): Cloudflare does not accept it as an API token \(HTTP 401: Invalid API Token \(code 1000\)\)/m);
    expect(io.out).toContain(EVERYDAY_LINK);
    expect(io.out).not.toContain(BOOT_LINK);
    expect(io.out).toContain(NEXT_PROMPT);
  });

  it("the everyday token pasted as the bootstrap token: names CLOUDFLARE_BOOTSTRAP_TOKEN, prints only its link, changes nothing", async () => {
    const world = await setUpWorld();
    world.addToken("everyday", OTHER_VALUE, "second-everyday");
    const { status, io } = await run(world, project({ env: envFile({ CLOUDFLARE_BOOTSTRAP_TOKEN: OTHER_VALUE, CLOUDFLARE_API_TOKEN: EVERYDAY_VALUE, CLOUDFLARE_EMAIL_DOMAIN: DOMAIN }) }));
    expect(status).toBe(1);
    expect(io.out).toMatch(/CLOUDFLARE_BOOTSTRAP_TOKEN \(the bootstrap token\): it cannot read API tokens .*lacks "Account API Tokens Write": was the everyday token pasted there\?/);
    expect(io.out).toContain(BOOT_LINK);
    expect(io.out).not.toContain(EVERYDAY_LINK);
    expect(world.writes()).toEqual([]);
  });

  it("the same token in both settings is named", async () => {
    const world = await setUpWorld();
    const { status, io } = await run(world, project({ env: envFile({ CLOUDFLARE_BOOTSTRAP_TOKEN: EVERYDAY_VALUE, CLOUDFLARE_API_TOKEN: EVERYDAY_VALUE }) }));
    expect(status).toBe(1);
    expect(io.out).toContain("CLOUDFLARE_BOOTSTRAP_TOKEN (the bootstrap token): it holds the same token as CLOUDFLARE_API_TOKEN");
    expect(io.out).toContain(BOOT_LINK);
    expect(io.out).not.toContain(EVERYDAY_LINK);
  });

  it("a bootstrap token lacking a permission names it; a user token as bootstrap token is refused and never deleted", async () => {
    const world = await setUpWorld();
    world.addToken("bootstrap", BOOT_VALUE, "boot-id", { groups: BOOTSTRAP.filter((g) => g.name !== "DNS Write"), expires_on: EXPIRES });
    const short = await run(world, project({ env: bothTokens() }));
    expect(short.status).toBe(1);
    expect(short.io.out).toContain('CLOUDFLARE_BOOTSTRAP_TOKEN (the bootstrap token): it lacks "DNS Write"');
    expect(short.io.out).toContain(BOOT_LINK);
    expect(short.io.out).not.toContain(EVERYDAY_LINK);

    const users = await setUpWorld();
    users.addUserToken(BOOT_VALUE, "owner-id", [ACCOUNT]);
    const user = await run(users, project({ env: bothTokens() }));
    expect(user.status).toBe(1);
    expect(user.io.out).toContain("CLOUDFLARE_BOOTSTRAP_TOKEN (the bootstrap token): it is a user API token");
    expect(users.token("owner-id").deleted).toBe(false);
    expect(users.writes()).toEqual([]);
  });

  it("a bootstrap token of another account than the everyday token's is named with the account names", async () => {
    const world = await setUpWorld();
    world.addAccount(OTHER_ACCOUNT, "Second account");
    world.addToken("bootstrap", BOOT_VALUE, "boot-id", { account: OTHER_ACCOUNT, expires_on: EXPIRES });
    const { status, io } = await run(world, project({ env: bothTokens() }));
    expect(status).toBe(1);
    expect(io.out).toContain('CLOUDFLARE_BOOTSTRAP_TOKEN (the bootstrap token): it belongs to the account "Second account", not "Main account"');
    expect(world.writes()).toEqual([]);
  });
});

describe("cloudflare-setup: a fresh account with both tokens (plan §4.3 steps 4–9)", () => {
  it("applies every step, writes the record, checks the everyday token once, deletes only the bootstrap token's own ID, comments out its line, fills in the file", async () => {
    const world = freshWorld();
    world.addToken("everyday", EVERYDAY_VALUE, "everyday-id");
    world.addToken("bootstrap", BOOT_VALUE, "boot-id", { expires_on: EXPIRES });
    const dir = project({ env: bothTokens() });
    const { status, io, reached } = await run(world, dir);
    expect(io.err).toBe("");
    expect(status).toBe(0);
    expect(io.out).toContain("account: Main account");
    expect(io.out).toContain(`account setup: applied ${SETUP_STEPS.join(", ")}`);
    expect(io.out).toContain("the bootstrap token deleted itself");
    expect(io.out).toContain("Cloudflare setup is complete.");
    expect(io.out).toContain("  plan: Workers Paid");
    expect(io.out).toContain("Next step: deploy a test stage: npm run deploy -- --target cloudflare --stage test-first");
    expect(io.out).not.toContain(BOOT_LINK);
    expect(await readSetupRecord(world.cloud().api, ACCOUNT)).toMatchObject({ setupVersion: ACCOUNT_SETUP_VERSION, emailDomain: DOMAIN, completedSteps: [...SETUP_STEPS] });
    // The everyday token's details read exactly once, with the bootstrap token; nothing to add.
    expect(world.requests.filter((r) => r.endsWith(`/tokens/everyday-id`))).toEqual([`boot-id GET /accounts/${ACCOUNT}/tokens/everyday-id`]);
    // The one token DELETE is the bootstrap token's own ID, sent by itself; the everyday token is untouched.
    expect(world.requests.filter((r) => / DELETE .*\/tokens\//.test(r))).toEqual([`boot-id DELETE /accounts/${ACCOUNT}/tokens/boot-id`]);
    expect(world.token("boot-id").deleted).toBe(true);
    expect(world.token("everyday-id").deleted).toBe(false);
    expect(readEnvFile(dir)).toBe(`# CLOUDFLARE_BOOTSTRAP_TOKEN=deleted by setup process\nCLOUDFLARE_API_TOKEN=${EVERYDAY_VALUE}\nCLOUDFLARE_EMAIL_DOMAIN=${DOMAIN}\nCLOUDFLARE_ACCOUNT_ID=${ACCOUNT}\n`);
    // The network check: the API, the account's R2 host and its workers.dev subdomain.
    expect(reached).toEqual(["https://api.cloudflare.com/client/v4/", `https://${ACCOUNT}.r2.cloudflarestorage.com/`, `https://${SUB}.workers.dev/`]);

    // A second run needs nothing: no prompt, nothing to do, no change.
    world.requests.length = 0;
    const again = await run(world, dir);
    expect(again.status).toBe(0);
    expect(again.io.out).toContain("Everything is already set up and current: nothing to do.");
    expect(world.writes()).toEqual([]);
  });

  it("the same cloud environment run twice: the second run finds the bootstrap token deleted, notes it, asks for nothing, exit 0", async () => {
    const world = await setUpWorld();
    world.addToken("bootstrap", BOOT_VALUE, "boot-id", { expires_on: EXPIRES });
    const env = { CLOUDFLARE_BOOTSTRAP_TOKEN: BOOT_VALUE, CLOUDFLARE_API_TOKEN: EVERYDAY_VALUE, CLOUDFLARE_EMAIL_DOMAIN: DOMAIN, CLAUDE_CODE_REMOTE: "true" };
    const dir = project();
    expect((await run(world, dir, { env })).status).toBe(0);
    expect(world.token("boot-id").deleted).toBe(true);
    const again = await run(world, dir, { env });
    expect(again.status).toBe(0);
    expect(again.io.out).toContain("Everything is already set up and current: nothing to do.");
    expect(again.io.err).toContain("note: CLOUDFLARE_BOOTSTRAP_TOKEN is no longer a valid token");
    expect(again.io.out + again.io.err).not.toMatch(/https:\/\/dash\.cloudflare\.com\/\?to=/);
  });

  it("an invalid bootstrap token when one is needed: named, with its link only", async () => {
    const world = freshWorld();
    world.addToken("everyday", EVERYDAY_VALUE, "everyday-id");
    const { status, io } = await run(world, project({ env: bothTokens() }));
    expect(status).toBe(1);
    expect(io.out).toContain("CLOUDFLARE_BOOTSTRAP_TOKEN (the bootstrap token): Cloudflare does not accept it as an API token");
    expect(io.out).toContain(BOOT_LINK);
    expect(io.out).not.toContain(EVERYDAY_LINK);
  });

  it("warns when the bootstrap token has no expiry", async () => {
    const world = await setUpWorld();
    world.addToken("bootstrap", BOOT_VALUE, "boot-id");
    const { status, io } = await run(world, project({ env: bothTokens() }));
    expect(status).toBe(0);
    expect(io.err).toContain("WARNING: CLOUDFLARE_BOOTSTRAP_TOKEN has no expiry");
  });

  it("a bootstrap token in the environment: after it deleted itself, says the variable can be removed (cloud session wording)", async () => {
    const world = await setUpWorld();
    world.addToken("bootstrap", BOOT_VALUE, "boot-id", { expires_on: EXPIRES });
    const { status, io } = await run(world, project(), { env: { CLOUDFLARE_BOOTSTRAP_TOKEN: BOOT_VALUE, CLOUDFLARE_API_TOKEN: EVERYDAY_VALUE, CLOUDFLARE_EMAIL_DOMAIN: DOMAIN, CLAUDE_CODE_REMOTE: "true" } });
    expect(status).toBe(0);
    expect(io.out).toContain("You can now remove CLOUDFLARE_BOOTSTRAP_TOKEN from the cloud environment's settings");
  });

  it("the plan is checked before the email domain is asked for (plan §4.3 step 4)", async () => {
    const world = freshWorld();
    world.accounts.get(ACCOUNT)!.plan = "free";
    world.addToken("everyday", EVERYDAY_VALUE, "everyday-id");
    world.addToken("bootstrap", BOOT_VALUE, "boot-id", { expires_on: EXPIRES });
    const { status, io } = await run(world, project({ env: envFile({ CLOUDFLARE_BOOTSTRAP_TOKEN: BOOT_VALUE, CLOUDFLARE_API_TOKEN: EVERYDAY_VALUE }) }));
    expect(status).toBe(1);
    expect(io.out).toContain("Workers Free plan");
    expect(io.out).not.toContain("Which domain");
  });

  it("the plan check with Billing Read: Workers Free stops before any change", async () => {
    const world = freshWorld();
    world.accounts.get(ACCOUNT)!.plan = "free";
    world.addToken("everyday", EVERYDAY_VALUE, "everyday-id");
    world.addToken("bootstrap", BOOT_VALUE, "boot-id", { expires_on: EXPIRES });
    const { status, io } = await run(world, project({ env: bothTokens() }));
    expect(status).toBe(1);
    expect(io.out).toContain('The account "Main account" is on the Workers Free plan');
    expect(world.writes()).toEqual([]);
    expect(world.token("boot-id").deleted).toBe(false);
  });
});

describe("cloudflare-setup: later runs (plan §3.4)", () => {
  it("everything valid and current: says so and asks for nothing (the everyday token cannot read the plan: not checked)", async () => {
    const world = await setUpWorld();
    const dir = project({ env: everydayOnly({ CLOUDFLARE_ACCOUNT_ID: ACCOUNT }) });
    const before = readEnvFile(dir);
    const { status, io } = await run(world, dir);
    expect(status).toBe(0);
    expect(io.out).toContain("Everything is already set up and current: nothing to do.");
    expect(io.out).toContain('  plan: not checked (reading it needs "Billing Read", which only the bootstrap token has)');
    expect(io.out).not.toMatch(/https:\/\/dash\.cloudflare\.com\/\?to=/);
    expect(world.writes()).toEqual([]);
    expect(readEnvFile(dir)).toBe(before);
  });

  it("valid tokens already in the environment are used without any prompt; no .env.cloudflare is created (plan §3.4, SETUP-AC-002)", async () => {
    const world = await setUpWorld();
    const dir = project();
    const { status, io } = await run(world, dir, { env: { CLOUDFLARE_API_TOKEN: EVERYDAY_VALUE, CLOUDFLARE_EMAIL_DOMAIN: DOMAIN } });
    expect(status).toBe(0);
    expect(io.out).not.toMatch(/https:\/\/dash\.cloudflare\.com\/\?to=/);
    expect(io.out).toContain("Everything is already set up and current: nothing to do.");
    expect(existsSync(join(dir, ".env.cloudflare"))).toBe(false);
  });

  it("a second project on the same account: the copied file is enough, no bootstrap token needed", async () => {
    const world = await setUpWorld();
    const first = project({ env: everydayOnly({ CLOUDFLARE_ACCOUNT_ID: ACCOUNT }) });
    const second = project({ env: readEnvFile(first) });
    const { status, io } = await run(world, second);
    expect(status).toBe(0);
    expect(io.out).toContain("nothing to do");
    expect(world.writes()).toEqual([]);
  });

  it("a release needing more everyday permissions: without the bootstrap token, only its link; with it, added in place (value unchanged), then it deletes itself", async () => {
    const world = freshWorld();
    await setUpAccount(world);
    const rules = groupNamed("Email Routing Rules Read");
    const everyday = world.addToken("everyday", EVERYDAY_VALUE, "everyday-id", { groups: EVERYDAY.filter((g) => g !== rules) });
    const dir = project({ env: everydayOnly({ CLOUDFLARE_ACCOUNT_ID: ACCOUNT }) });
    const without = await run(world, dir);
    expect(without.status).toBe(1);
    expect(without.io.out).toContain('CLOUDFLARE_API_TOKEN failed the quick check for "Email Routing Rules Read" (HTTP 403)');
    expect(without.io.out).toContain(BOOT_LINK);
    expect(without.io.out).not.toContain(EVERYDAY_LINK);
    expect(world.writes()).toEqual([]);

    world.addToken("bootstrap", BOOT_VALUE, "boot-id", { expires_on: EXPIRES });
    writeFileSync(join(dir, ".env.cloudflare"), `CLOUDFLARE_BOOTSTRAP_TOKEN=${BOOT_VALUE}\n${readEnvFile(dir)}`);
    const withBoot = await run(world, dir);
    expect(withBoot.io.err).toBe("");
    expect(withBoot.status).toBe(0);
    expect(withBoot.io.out).toContain('added "Email Routing Rules Read" to CLOUDFLARE_API_TOKEN in place (its value is unchanged)');
    expect(world.requests.filter((r) => / PUT .*\/tokens\//.test(r))).toEqual([`boot-id PUT /accounts/${ACCOUNT}/tokens/everyday-id`]);
    // Same token, same value, now with the group on the email domain's zone; the old policies kept.
    expect(everyday.value).toBe(EVERYDAY_VALUE);
    expect(everyday.policies.slice(0, 2).map((p) => p.id)).toEqual(["pol-a", "pol-z"]);
    expect(everyday.policies[2]).toEqual({ effect: "allow", resources: { [`com.cloudflare.api.account.zone.${world.cloud().zones.get(DOMAIN)!.id}`]: "*" }, permission_groups: [{ id: rules.id }] });
    expect(world.token("boot-id").deleted).toBe(true);
    // The everyday token now passes its own quick check.
    world.requests.length = 0;
    expect((await run(world, dir)).status).toBe(0);
  });

  it("a release needing more account setup: needs the bootstrap token once, runs only the missing step, deletes it", async () => {
    const world = await setUpWorld();
    world.cloud().buckets.delete("prototype-backups");
    world.cloud().lifecycles.delete("prototype-backups");
    const dir = project({ env: everydayOnly({ CLOUDFLARE_ACCOUNT_ID: ACCOUNT }) });
    const without = await run(world, dir);
    expect(without.status).toBe(1);
    expect(without.io.out).toContain("these setup steps are missing: backup-bucket, backup-lifecycle");
    expect(without.io.out).toContain(BOOT_LINK);

    world.addToken("bootstrap", BOOT_VALUE, "boot-id", { expires_on: EXPIRES });
    writeFileSync(join(dir, ".env.cloudflare"), `CLOUDFLARE_BOOTSTRAP_TOKEN=${BOOT_VALUE}\n${readEnvFile(dir)}`);
    const withBoot = await run(world, dir);
    expect(withBoot.status).toBe(0);
    expect(withBoot.io.out).toContain("account setup: applied backup-bucket, backup-lifecycle");
    expect(world.token("boot-id").deleted).toBe(true);
    expect(readEnvFile(dir)).toContain("# CLOUDFLARE_BOOTSTRAP_TOKEN=deleted by setup process");
  });

  it("an account switch: explains, changes nothing; with --switch-account sets up the new account and records its ID", async () => {
    const world = new SetupWorld();
    world.addAccount(OTHER_ACCOUNT, "New account");
    world.cloud(OTHER_ACCOUNT).subdomain = undefined;
    world.addToken("everyday", EVERYDAY_VALUE, "everyday-id", { account: OTHER_ACCOUNT });
    world.addToken("bootstrap", BOOT_VALUE, "boot-id", { account: OTHER_ACCOUNT, expires_on: EXPIRES });
    const dir = project({ env: bothTokens({ CLOUDFLARE_ACCOUNT_ID: ACCOUNT }) });
    const first = await run(world, dir);
    expect(first.status).toBe(1);
    expect(first.io.out).toContain('The tokens belong to the account "New account", but this project is set up for another account');
    expect(first.io.out).toContain("Stages deployed on the old account keep running");
    expect(first.io.out).toContain("npm run remove -- --target cloudflare --stage <stage>");
    expect(first.io.out).toContain("npm run cloudflare-setup -- --switch-account");
    expect(world.writes()).toEqual([]);

    const switched = await run(world, dir, { args: ["--switch-account"] });
    expect(switched.io.err).toBe("");
    expect(switched.status).toBe(0);
    expect(await readSetupRecord(world.cloud(OTHER_ACCOUNT).api, ACCOUNT)).toMatchObject({ emailDomain: DOMAIN });
    expect(readEnvFile(dir)).toContain(`CLOUDFLARE_ACCOUNT_ID=${OTHER_ACCOUNT}\n`);
    expect(readEnvFile(dir)).not.toContain(ACCOUNT);
  });
});

describe("cloudflare-setup: the account and the email domain (plan §4.3 steps 4–5)", () => {
  it("several accounts without CLOUDFLARE_ACCOUNT_ID: their names only, and how to set it; with it set, that account is used", async () => {
    const world = new SetupWorld();
    await setUpAccount(world);
    world.addAccount(OTHER_ACCOUNT, "Side account");
    world.addUserToken(EVERYDAY_VALUE, "user-id", [ACCOUNT, OTHER_ACCOUNT]);
    const { status, io } = await run(world, project({ env: everydayOnly() }));
    expect(status).toBe(1);
    expect(io.out).toContain("CLOUDFLARE_API_TOKEN can see 2 Cloudflare accounts:\n  1. Main account\n  2. Side account\n");
    expect(io.out).toContain("Set CLOUDFLARE_ACCOUNT_ID to it");

    const chosen = await run(world, project({ env: everydayOnly({ CLOUDFLARE_ACCOUNT_ID: ACCOUNT }) }));
    expect(chosen.status).toBe(0);
    expect(chosen.io.out).toContain("account: Main account");
  });

  it("a user token as the everyday token: its permissions cannot be read with the bootstrap token, so the quick check decides", async () => {
    const world = new SetupWorld();
    await setUpAccount(world);
    world.addUserToken(EVERYDAY_VALUE, "user-id", [ACCOUNT]);
    world.addToken("bootstrap", BOOT_VALUE, "boot-id", { expires_on: EXPIRES });
    const { status, io } = await run(world, project({ env: bothTokens() }));
    expect(status).toBe(0);
    expect(io.out).toContain("passed the quick check; it is not an account API token of this account, so its permissions were not read");
    expect(world.token("user-id").deleted).toBe(false);
    expect(world.requests.filter((r) => / (PUT|DELETE) .*\/tokens\//.test(r))).toEqual([`boot-id DELETE /accounts/${ACCOUNT}/tokens/boot-id`]);
  });

  it("no email domain: lists the zone names and asks; --email-domain answers; a domain not on the account is named", async () => {
    const world = await setUpWorld();
    const dir = project({ env: envFile({ CLOUDFLARE_API_TOKEN: EVERYDAY_VALUE }) });
    const ask = await run(world, dir);
    expect(ask.status).toBe(1);
    expect(ask.io.out).toContain('The account "Main account" has these domains on Cloudflare DNS:\n  1. example.test\n  2. one.example\n  3. two.example\n');
    expect(ask.io.out).toContain("npm run cloudflare-setup -- --email-domain <domain>");

    const answered = await run(world, dir, { args: ["--email-domain", DOMAIN] });
    expect(answered.status).toBe(0);
    expect(readEnvFile(dir)).toContain(`CLOUDFLARE_EMAIL_DOMAIN=${DOMAIN}\n`);

    const elsewhere = await run(world, project({ env: envFile({ CLOUDFLARE_API_TOKEN: EVERYDAY_VALUE, CLOUDFLARE_EMAIL_DOMAIN: "nowhere.example" }) }));
    expect(elsewhere.status).toBe(1);
    expect(elsewhere.io.out).toContain('The email domain nowhere.example is not a domain of the account "Main account"');
  });

  it("an account without any domain: explains that one is needed", async () => {
    const world = await setUpWorld();
    world.cloud().zones.clear();
    const { status, io } = await run(world, project({ env: envFile({ CLOUDFLARE_API_TOKEN: EVERYDAY_VALUE }) }));
    expect(status).toBe(1);
    expect(io.out).toContain('The account "Main account" has no domain on Cloudflare DNS');
  });
});

describe("cloudflare-setup: the everyday token checked with the bootstrap token (plan §4.3 step 7)", () => {
  it("scoped to another zone: explained with the everyday link only; no update; the bootstrap token is kept", async () => {
    const world = freshWorld();
    await setUpAccount(world);
    const otherZone = world.cloud().zones.get("one.example")!.id;
    world.addToken("everyday", EVERYDAY_VALUE, "everyday-id", { policies: dashboardPolicies(EVERYDAY, ACCOUNT, { [`com.cloudflare.api.account.zone.${otherZone}`]: "*" }) });
    world.addToken("bootstrap", BOOT_VALUE, "boot-id", { expires_on: EXPIRES });
    const { status, io } = await run(world, project({ env: bothTokens() }));
    expect(status).toBe(1);
    expect(io.out).toContain("CLOUDFLARE_API_TOKEN (the everyday token): it is scoped to other zones, not the email domain's zone (example.test)");
    expect(io.out).toContain(EVERYDAY_LINK);
    expect(io.out).not.toContain(BOOT_LINK);
    expect(world.requests.filter((r) => / (PUT|DELETE) .*\/tokens\//.test(r))).toEqual([]);
    expect(world.token("boot-id").deleted).toBe(false);
  });

  it("a deny policy: the token must be made again (an update cannot beat a deny)", async () => {
    const world = freshWorld();
    await setUpAccount(world);
    const d1 = groupNamed("D1 Write");
    world.addToken("everyday", EVERYDAY_VALUE, "everyday-id", { policies: [...dashboardPolicies(EVERYDAY, ACCOUNT), { effect: "deny", resources: { [`com.cloudflare.api.account.${ACCOUNT}`]: "*" }, permission_groups: [{ id: d1.id }] }] });
    world.addToken("bootstrap", BOOT_VALUE, "boot-id", { expires_on: EXPIRES });
    const { status, io } = await run(world, project({ env: bothTokens() }));
    expect(status).toBe(1);
    expect(io.out).toContain('a deny policy takes away "D1 Write", which an update cannot override');
    expect(world.requests.filter((r) => / PUT .*\/tokens\//.test(r))).toEqual([]);
  });
});

describe("cloudflare-setup: the token write guard (DEC-0589)", () => {
  it("a protected bootstrap ID is never deleted: no DELETE is sent, and the run fails", async () => {
    const world = await setUpWorld();
    world.addToken("bootstrap", BOOT_VALUE, "boot-id", { expires_on: EXPIRES });
    const { status, io } = await run(world, project({ env: bothTokens() }), { protectedTokenIds: ["boot-id"] });
    expect(status).toBe(1);
    expect(io.err).toContain("setup refused to delete an API token: its ID is protected");
    expect(world.requests.filter((r) => / DELETE /.test(r))).toEqual([]);
    expect(world.token("boot-id").deleted).toBe(false);
  });

  it("a protected everyday ID is never updated, also when it lacks permissions; the environment variable protects too", async () => {
    const world = freshWorld();
    await setUpAccount(world);
    world.addToken("everyday", EVERYDAY_VALUE, "everyday-id", { groups: EVERYDAY.filter((g) => g.name !== "D1 Write") });
    world.addToken("bootstrap", BOOT_VALUE, "boot-id", { expires_on: EXPIRES });
    const { status, io } = await run(world, project({ env: bothTokens() }), { env: { PROTOTYPE_FRAMEWORK_PROTECTED_TOKEN_IDS: "x, everyday-id" } });
    expect(status).toBe(1);
    expect(io.out).toContain("its ID is protected, so setup did not change it");
    expect(world.requests.filter((r) => / (PUT|DELETE) .*\/tokens\//.test(r))).toEqual([]);
  });

  it("guardTokenWrites refuses every write but the bootstrap self-delete and the everyday update, before sending", async () => {
    const sent: string[] = [];
    const api = guardTokenWrites(async (method, path) => (sent.push(`${method} ${path}`), { status: 200, body: { success: true, result: {} } }), {
      protectedIds: new Set(["owner"]),
      everydayId: "every",
      bootstrapId: "boot",
      selfDeleteArmed: () => armed,
    });
    let armed = false;
    for (const [method, path] of [
      ["DELETE", "/accounts/a/tokens/owner"],
      ["PUT", "/accounts/a/tokens/owner"],
      ["DELETE", "/user/tokens/owner"],
      ["DELETE", "/accounts/a/tokens/every"],
      ["DELETE", "/accounts/a/tokens/boot"],
      ["PUT", "/accounts/a/tokens/boot"],
      ["PUT", "/accounts/a/tokens/signing"],
    ] as const) {
      await expect(api(method, path), `${method} ${path}`).rejects.toThrow(/setup refused to/);
    }
    expect(sent).toEqual([]);
    armed = true;
    await api("DELETE", "/accounts/a/tokens/boot");
    await api("PUT", "/accounts/a/tokens/every", {});
    await api("DELETE", "/accounts/a/tokens/tok0");
    await api("GET", "/accounts/a/tokens/owner");
    expect(sent).toEqual(["DELETE /accounts/a/tokens/boot", "PUT /accounts/a/tokens/every", "DELETE /accounts/a/tokens/tok0", "GET /accounts/a/tokens/owner"]);
  });

  it("guardTokenWrites cannot be bypassed by a query string, a trailing or doubled slash, an encoded ID, a sub-path (the value roll) or another method", async () => {
    const sent: string[] = [];
    const api = guardTokenWrites(async (method, path) => (sent.push(`${method} ${path}`), { status: 200, body: { success: true, result: {} } }), {
      protectedIds: new Set(["owner"]),
      everydayId: "every",
      bootstrapId: "boot",
      selfDeleteArmed: () => false,
    });
    for (const [method, path] of [
      ["DELETE", "/accounts/a/tokens/owner?force=1"],
      ["DELETE", "/accounts/a/tokens/owner/"],
      ["DELETE", "//accounts/a/tokens/owner"],
      ["DELETE", "/accounts/a/tokens/%6Fwner"],
      ["PUT", "/accounts/a/tokens/owner/value"],
      ["PUT", "/accounts/a/tokens/every/value"],
      ["POST", "/accounts/a/tokens/every/value"],
      ["PUT", "/user/tokens/owner/value?x"],
      ["PATCH", "/accounts/a/tokens/every"],
      ["POST", "/accounts/a/tokens/owner"],
      ["DELETE", "/accounts/a/tokens/boot/"],
      ["DELETE", "/accounts/a/tokens/every?x=1"],
      ["PUT", "/accounts/a/tokens/boot?x=1"],
    ] as const) {
      await expect(api(method, path), `${method} ${path}`).rejects.toThrow(/setup refused to/);
    }
    expect(sent).toEqual([]);
    // Creating a token (the signing step) and reading are not token writes of an ID.
    await api("POST", "/accounts/a/tokens", {});
    await api("GET", "/accounts/a/tokens/owner?x=1");
    expect(sent).toEqual(["POST /accounts/a/tokens", "GET /accounts/a/tokens/owner?x=1"]);
  });

  it("guardTokenWrites judges the path the URL parser sends: dot segments, backslashes, tabs and newlines, encoded segments and case (DEC-0613)", async () => {
    const sent: string[] = [];
    const api = guardTokenWrites(async (method, path) => (sent.push(`${method} ${path}`), { status: 200, body: { success: true, result: {} } }), {
      protectedIds: new Set(["owner"]),
      everydayId: "every",
      bootstrapId: "boot",
      selfDeleteArmed: () => false,
    });
    for (const [method, path] of [
      ["DELETE", "/accounts/a/x/../tokens/owner"],
      ["DELETE", "/accounts/a/tokens/x/../owner"],
      ["DELETE", "/accounts/a/tokens\\owner"],
      ["DELETE", "/accounts\\a\\tokens\\owner"],
      ["DELETE", "/accounts/a/tok\tens/owner"],
      ["DELETE", "/accounts/a/tokens/ow\nner"],
      ["DELETE", "/accounts/a/tokens/own\r\ner"],
      ["DELETE", "/user/./tokens/owner"],
      ["DELETE", "/user/tokens/./owner"],
      ["DELETE", "/accounts/a/%74okens/owner"],
      ["DELETE", "/%61ccounts/a/tokens/owner"],
      ["DELETE", "/accounts/a/tokens/x/%2e%2e/owner"],
      ["DELETE", "/accounts/a/tokens/x/%2E./owner"],
      ["DELETE", "/accounts/a/tokens%2Fowner"],
      ["DELETE", "/accounts/a/tokens%5Cowner"],
      ["DELETE", "/accounts/a/tokens/%256Fwner"],
      ["DELETE", "/../../accounts/a/tokens/owner"],
      ["DELETE", "/accounts/a/tokens/owner#x"],
      ["DELETE", "/accounts/a/tokens/OWNER"],
      ["DELETE", "/accounts/a/TOKENS/owner"],
      ["DELETE", "/USER/tokens/owner"],
      ["DELETE", "/accounts/a/tokens/EVERY"],
      ["DELETE", "/accounts/a/x/../tokens/every"],
      ["DELETE", "/accounts/a/tokens/./boot"],
      ["PUT", "/accounts/a/tokens/x/../owner"],
      ["PUT", "/accounts/a/tokens/every/./value"],
      ["PUT", "/accounts/a/tokens/every%2Fvalue"],
      ["PUT", "/accounts/a/tokens/x/../signing"],
      ["PATCH", "/accounts/a/tokens\\every"],
      ["POST", "/user/tokens/x/%2e%2e/owner/value"],
    ] as const) {
      await expect(api(method, path), JSON.stringify(`${method} ${path}`)).rejects.toThrow(/setup refused to/);
    }
    expect(sent).toEqual([]);
    // The everyday update reached by another spelling is still the everyday update; a create is not a write of an ID.
    await api("PUT", "/accounts/a/tokens/./every", {});
    await api("POST", "/accounts/a/tokens/x/..", {});
    await api("DELETE", "/accounts/a/tokens/x/../tok0");
    expect(sent).toEqual(["PUT /accounts/a/tokens/./every", "POST /accounts/a/tokens/x/..", "DELETE /accounts/a/tokens/x/../tok0"]);
  });
});

describe("cloudflare-setup: local setup, git and the network (plan §4.3 steps 0, 1, 8)", () => {
  it("runs the local setup first when it is missing: local secrets set before anything else", async () => {
    const world = await setUpWorld();
    const dir = project({ env: everydayOnly() });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "app" }));
    const { status, io } = await run(world, dir, {
      localSetup: (d, o) => runLocalSetup(d, { ...o, npmInstall: async () => {}, declaredSecrets: async () => ["apiKey"], random: (n) => new Uint8Array(n).fill(7) }),
    });
    expect(status).toBe(0);
    expect(io.out.indexOf("local setup (local-secrets): set a random local value")).toBe(0);
    expect(io.out.indexOf("local setup")).toBeLessThan(io.out.indexOf("account: Main account"));
    expect(Object.keys(readDevVars(readFileSync(join(dir, ".dev.vars"), "utf8")))).toContain("SECRET_API_KEY");
  });

  it("adds .env.cloudflare to .gitignore when missing", async () => {
    const world = await setUpWorld();
    const dir = project({ env: everydayOnly(), gitignore: "node_modules/\n" });
    const { status, io } = await run(world, dir);
    expect(status).toBe(0);
    expect(io.out).toContain("local setup (gitignore): added .env.cloudflare to .gitignore");
    expect(readFileSync(join(dir, ".gitignore"), "utf8")).toContain("\n.env.cloudflare\n");
  });

  it("git warnings are prominent and never fail: not a repository, and a tracked file", async () => {
    const world = await setUpWorld();
    const notRepo = await run(world, project({ env: everydayOnly(), repo: false }));
    expect(notRepo.status).toBe(0);
    expect(notRepo.io.err).toMatch(/^={78}\ncloudflare-setup: WARNING: This project is not a git repository/);
    expect(notRepo.io.out).not.toContain("WARNING: not-a-repo");

    const dir = project({ env: everydayOnly(), gitignore: "" });
    execFileSync("git", ["add", "-f", ".env.cloudflare"], { cwd: dir, stdio: "ignore" });
    const tracked = await run(world, dir);
    expect(tracked.status).toBe(0);
    expect(tracked.io.err).toContain("cloudflare-setup: WARNING: .env.cloudflare is tracked by git");
  });

  it("a blocked host is named by its kind (never the subdomain) with where to change the network policy; exit 1", async () => {
    const world = await setUpWorld();
    const { status, io } = await run(world, project({ env: everydayOnly() }), { reach: async (url) => (url.includes(".workers.dev") ? Promise.reject(new Error("blocked")) : undefined) });
    expect(status).toBe(1);
    expect(io.out).toContain("This environment cannot reach the account's workers.dev subdomain (<subdomain>.workers.dev), which deploy needs.");
    expect(io.out).toContain("Network access");
  });

  it("a failure whose message holds the account ID or a token is printed with them hidden (the redaction backstop)", async () => {
    const world = await setUpWorld();
    const io = captureIo(project({ env: everydayOnly() }));
    const apiFor = (value: string) => {
      const api = world.apiFor(value);
      return async (method: Parameters<typeof api>[0], path: string, body?: unknown) => {
        if (path.startsWith("/zones?name=")) throw new Error(`Cloudflare API request GET ${path} with ${value} got no response`);
        return api(method, path, body);
      };
    };
    const status = await cloudflareSetupCommand({ env: {}, apiFor, reach: async () => {}, localSetup: fakeLocalSetup })([], io);
    expect(status).toBe(1);
    expect(io.err).toContain("cloudflare-setup failed: Cloudflare API request GET /zones?name=example.test&account.id=[hidden]");
    expect(io.out + io.err).not.toContain(ACCOUNT);
    expect(io.out + io.err).not.toContain("MARKER");
  });

  it("behind a proxy without NODE_USE_ENV_PROXY=1: the local setup and the no-token text still run; with tokens it stops before any request", async () => {
    const proxied = { HTTPS_PROXY: "http://proxy.invalid:3128" };
    const world = await setUpWorld();
    const none = await run(world, project(), { env: proxied });
    expect(none.status).toBe(1);
    expect(none.io.out).toContain("Cloudflare setup needs two API tokens");
    const tokens = await run(world, project({ env: everydayOnly() }), { env: proxied });
    expect(tokens.status).toBe(1);
    expect(tokens.io.err).toContain("cloudflare-setup failed: HTTPS_PROXY is set, but this process was not started with NODE_USE_ENV_PROXY=1");
    expect(world.requests).toEqual([]);
  });

  it("an unexpected argument is a usage error that never echoes it", async () => {
    const world = new SetupWorld();
    await expect(run(world, project(), { args: [EVERYDAY_VALUE] })).rejects.toThrow(/unexpected argument/);
    expect(existsSync(join(dirs.at(-1)!, ".env.cloudflare"))).toBe(false);
  });
});

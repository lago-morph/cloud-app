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
import { CloudflareRequestsStopped } from "../../provision/cloudflare/api.js";
import { ADMIN_APP_NEXT, BOOTSTRAP_MAX_LIFETIME_MS, bootstrapExpiryProblem, guardTokenWrites, NEXT_PROMPT } from "../../provision/cloudflare/cloudflare-setup.js";
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
/** Within PAR-435's 1 day of `NOW`. */
const EXPIRES = "2026-10-27T00:00:00Z";
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
        "  On the page: pick your account if the dashboard asks; under TTL, set an end date no more than 1 day away (setup deletes a bootstrap token that lives longer, or has no end date, at once). Then choose Continue to summary, then Create Token, and copy the token.",
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

  it("only a bootstrap token: the bootstrap runs without an everyday token (v0.2.0 plan §5.1)", async () => {
    const world = freshWorld();
    world.addToken("bootstrap", BOOT_VALUE, "boot-id", { expires_on: EXPIRES });
    const dir = project({ env: envFile({ CLOUDFLARE_BOOTSTRAP_TOKEN: BOOT_VALUE }) });
    const { status, io } = await run(world, dir);
    expect(io.err).toBe("");
    expect(status).toBe(0);
    expect(io.out).not.toContain("CLOUDFLARE_API_TOKEN is not set");
    expect(io.out).toContain("The Cloudflare bootstrap is complete.");
    expect(world.token("boot-id").deleted).toBe(true);
    expect(readEnvFile(dir)).toBe(`# CLOUDFLARE_BOOTSTRAP_TOKEN=deleted by setup process\nCLOUDFLARE_ACCOUNT_ID=${ACCOUNT}\n`);
  });
});

describe("cloudflare-setup: the bootstrap token's rules (v0.2.0 plan §5.1, §7; DEC-0681, DEC-0683)", () => {
  const AT = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
  const ONE_DAY = 86_400_000;

  it("bootstrapExpiryProblem: exactly 1 day away is accepted; 1 day + 1 s, none or an unreadable expiry is refused", () => {
    expect(BOOTSTRAP_MAX_LIFETIME_MS).toBe(ONE_DAY);
    expect(bootstrapExpiryProblem(AT(ONE_DAY), NOW)).toBeUndefined();
    expect(bootstrapExpiryProblem(AT(ONE_DAY - 1000), NOW)).toBeUndefined();
    expect(bootstrapExpiryProblem(AT(ONE_DAY + 1000), NOW)).toBe(`it expires more than 1 day from now (${AT(ONE_DAY + 1000)})`);
    expect(bootstrapExpiryProblem(undefined, NOW)).toBe("it has no expiry");
    expect(bootstrapExpiryProblem("next week", NOW)).toBe("its expiry cannot be read");
  });

  it("an expiry exactly 1 day away: the bootstrap runs, and the token deletes itself only at the end", async () => {
    const world = freshWorld();
    world.addToken("bootstrap", BOOT_VALUE, "boot-id", { expires_on: AT(ONE_DAY) });
    const { status, io } = await run(world, project({ env: envFile({ CLOUDFLARE_BOOTSTRAP_TOKEN: BOOT_VALUE }) }));
    expect(io.err).toBe("");
    expect(status).toBe(0);
    expect(world.requests.filter((r) => / DELETE /.test(r))).toEqual([`boot-id DELETE /accounts/${ACCOUNT}/tokens/boot-id`]);
    expect(world.requests.at(-1)).toBe(`boot-id DELETE /accounts/${ACCOUNT}/tokens/boot-id`);
  });

  for (const [label, expires] of [
    ["1 day + 1 s away", AT(ONE_DAY + 1000)],
    ["no expiry", undefined],
  ] as const) {
    it(`${label}: DELETE at once, before anything else is used; its line commented out; the link with a 1-day expiry; exit 1`, async () => {
      const world = freshWorld();
      world.addToken("bootstrap", BOOT_VALUE, "boot-id", expires === undefined ? {} : { expires_on: expires });
      const dir = project({ env: envFile({ CLOUDFLARE_BOOTSTRAP_TOKEN: BOOT_VALUE }) });
      const { status, io } = await run(world, dir);
      expect(status).toBe(1);
      expect(world.token("boot-id").deleted).toBe(true);
      // Only its identification and its own details are read before the DELETE, and nothing follows it.
      expect(world.requests).toEqual([`boot-id GET /accounts?per_page=50`, `boot-id GET /accounts/${ACCOUNT}/tokens/verify`, `boot-id GET /accounts/${ACCOUNT}/tokens/boot-id`, `boot-id DELETE /accounts/${ACCOUNT}/tokens/boot-id`]);
      expect(io.out).toContain(`CLOUDFLARE_BOOTSTRAP_TOKEN (the bootstrap token): ${expires === undefined ? "it has no expiry" : "it expires more than 1 day from now"}`);
      expect(io.out).toContain("Setup deleted it at once and used it for nothing else.");
      expect(io.out).toContain("Make a new bootstrap token with an expiry of 1 day or less");
      expect(io.out).toContain(BOOT_LINK);
      expect(io.out).not.toContain("The Cloudflare bootstrap is complete.");
      expect(readEnvFile(dir)).toBe("# CLOUDFLARE_BOOTSTRAP_TOKEN=deleted by setup process\n");
    });
  }

  it("a long-lived token whose DELETE fails: says to delete it in the dashboard, uses it for nothing, exit 1", async () => {
    const world = freshWorld();
    world.addToken("bootstrap", BOOT_VALUE, "boot-id");
    const apiFor = (value: string) => {
      const api = world.apiFor(value);
      return async (method: Parameters<typeof api>[0], path: string, body?: unknown) => (method === "DELETE" ? { status: 403, body: { success: false, errors: [{ code: 9109, message: "Unauthorized" }], result: null } } : api(method, path, body));
    };
    const dir = project({ env: envFile({ CLOUDFLARE_BOOTSTRAP_TOKEN: BOOT_VALUE }) });
    const io = captureIo(dir);
    runs.push({ io, world });
    const status = await cloudflareSetupCommand({ env: {}, apiFor, reach: async () => {}, localSetup: fakeLocalSetup, now: () => NOW })([], io);
    expect(status).toBe(1);
    expect(io.out).toContain("Setup could not delete it (HTTP 403: Unauthorized (code 9109)): delete it in the dashboard");
    expect(io.out).toContain(BOOT_LINK);
    expect(world.writes()).toEqual([]);
    expect(readEnvFile(dir)).toBe(`CLOUDFLARE_BOOTSTRAP_TOKEN=${BOOT_VALUE}\n`);
  });

  it("a long-lived protected token is neither deleted nor used (DEC-0589)", async () => {
    const world = freshWorld();
    world.addToken("bootstrap", BOOT_VALUE, "boot-id");
    const dir = project({ env: envFile({ CLOUDFLARE_BOOTSTRAP_TOKEN: BOOT_VALUE }) });
    const { status, io } = await run(world, dir, { protectedTokenIds: ["boot-id"] });
    expect(status).toBe(1);
    expect(io.out).toContain("Its ID is protected, so setup neither deleted nor used it.");
    expect(world.writes()).toEqual([]);
    expect(world.token("boot-id").deleted).toBe(false);
  });

  it("the value is never written: after the bootstrap, no file in the project holds it (in the file or the environment)", async () => {
    for (const fromFile of [true, false]) {
      const world = freshWorld();
      world.addToken("bootstrap", BOOT_VALUE, "boot-id", { expires_on: EXPIRES });
      const dir = project(fromFile ? { env: envFile({ CLOUDFLARE_BOOTSTRAP_TOKEN: BOOT_VALUE }) } : {});
      const { status, io } = await run(world, dir, fromFile ? {} : { env: { CLOUDFLARE_BOOTSTRAP_TOKEN: BOOT_VALUE } });
      expect(status).toBe(0);
      expect(io.out + io.err).not.toContain(BOOT_VALUE);
      const files = execFileSync("find", [dir, "-type", "f", "-not", "-path", "*/.git/*"], { encoding: "utf8" }).split("\n").filter((f) => f !== "");
      for (const f of files) expect(readFileSync(f, "utf8"), f).not.toContain(BOOT_VALUE);
    }
  });

  it("with an everyday token too: the bootstrap neither reads nor changes it, applies no account setup step, and its only write is its own DELETE (DEC-0682)", async () => {
    const world = freshWorld();
    world.addToken("everyday", EVERYDAY_VALUE, "everyday-id", { groups: EVERYDAY.slice(1) });
    world.addToken("bootstrap", BOOT_VALUE, "boot-id", { expires_on: EXPIRES });
    const { status, io } = await run(world, project({ env: bothTokens() }));
    expect(io.err).toBe("");
    expect(status).toBe(0);
    expect(world.requests.filter((r) => r.includes("/tokens/everyday-id"))).toEqual([]);
    expect(world.writes()).toEqual([`boot-id DELETE /accounts/${ACCOUNT}/tokens/boot-id`]);
    expect(await readSetupRecord(world.cloud().api, ACCOUNT)).toBeUndefined();
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
    world.addToken("bootstrap", BOOT_VALUE, "boot-id", { groups: BOOTSTRAP.filter((g) => g.name !== "OAuth Client Write"), expires_on: EXPIRES });
    const short = await run(world, project({ env: bothTokens() }));
    expect(short.status).toBe(1);
    expect(short.io.out).toContain('CLOUDFLARE_BOOTSTRAP_TOKEN (the bootstrap token): it lacks "OAuth Client Write"');
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

describe("cloudflare-setup: the bootstrap on a fresh account (v0.2.0 plan §5.1; plan §4.3 steps 4–9)", () => {
  it("reads its own permissions, applies no setup step, deletes only its own ID, comments out its line, fills in the account; a set-up account then needs nothing", async () => {
    const world = freshWorld();
    world.addToken("everyday", EVERYDAY_VALUE, "everyday-id");
    world.addToken("bootstrap", BOOT_VALUE, "boot-id", { expires_on: EXPIRES });
    const dir = project({ env: bothTokens() });
    const { status, io, reached } = await run(world, dir);
    expect(io.err).toBe("");
    expect(status).toBe(0);
    expect(io.out).toContain("account: Main account");
    expect(io.out).toContain("the bootstrap token deleted itself");
    expect(io.out).toContain("The Cloudflare bootstrap is complete.");
    expect(io.out).not.toContain("account setup: applied");
    expect(io.out).not.toContain(BOOT_LINK);
    expect(world.requests).toContain(`boot-id GET /accounts/${ACCOUNT}/tokens/boot-id`);
    // The one token DELETE is the bootstrap token's own ID, sent by itself; the everyday token is untouched.
    expect(world.requests.filter((r) => / DELETE .*\/tokens\//.test(r))).toEqual([`boot-id DELETE /accounts/${ACCOUNT}/tokens/boot-id`]);
    expect(world.token("boot-id").deleted).toBe(true);
    expect(world.token("everyday-id").deleted).toBe(false);
    expect(readEnvFile(dir)).toBe(`# CLOUDFLARE_BOOTSTRAP_TOKEN=deleted by setup process\nCLOUDFLARE_API_TOKEN=${EVERYDAY_VALUE}\nCLOUDFLARE_EMAIL_DOMAIN=${DOMAIN}\nCLOUDFLARE_ACCOUNT_ID=${ACCOUNT}\n`);
    expect(reached).toEqual([]);

    // Once the account is set up (the admin app's job since v0.2.0), a run needs nothing and checks
    // the network: the API, the account's R2 host and a Worker-style host under its workers.dev
    // subdomain (the bare subdomain has no DNS record; a script host answers 404).
    await setUpAccount(world);
    world.requests.length = 0;
    const again = await run(world, dir);
    expect(again.status).toBe(0);
    expect(again.io.out).toContain("Everything is already set up and current: nothing to do.");
    expect(again.io.out).toContain("Next step: deploy a test stage: npm run deploy -- --target cloudflare --stage test-first");
    expect(again.reached).toEqual(["https://api.cloudflare.com/client/v4/", `https://${ACCOUNT}.r2.cloudflarestorage.com/`, `https://prototype-framework-reachability.${SUB}.workers.dev/`]);
    expect(world.writes()).toEqual([]);
  });

  it("the token write guard lets the signing step replace an old signing token found by name, and no other token (DEC-0618)", async () => {
    const world = freshWorld();
    world.cloud().tokens.set("old-sign-id", { name: "prototype-r2-signing", resources: {} });
    world.cloud().tokens.set("unrelated-id", { name: "someone-else", resources: {} });
    const api = guardTokenWrites(world.cloud().api, { protectedIds: new Set(), selfDeleteArmed: () => false });
    await applySetupSteps(api, ACCOUNT, { emailDomain: DOMAIN, steps: SETUP_STEPS, setupVersion: ACCOUNT_SETUP_VERSION, frameworkVersion: "0.0.0-test", now: () => NOW, newSubdomain: () => SUB, email: { sleep: async () => {} } });
    expect(world.cloud().tokens.has("old-sign-id")).toBe(false);
    expect(world.cloud().tokens.has("unrelated-id")).toBe(true);
  });

  it("a failed delete of an old signing token names no token ID, only its name (SETUP-REQ-007)", async () => {
    const OLD = "0ld5ign000000000000000000000000b";
    const world = freshWorld();
    world.cloud().tokens.set(OLD, { name: "prototype-r2-signing", resources: {} });
    const inner = world.cloud().api;
    const failing: typeof inner = async (method, path, body) =>
      method === "DELETE" && path.endsWith(`/tokens/${OLD}`) ? { status: 403, body: { success: false, errors: [{ code: 9109, message: "Unauthorized" }], result: null } } : inner(method, path, body);
    const api = guardTokenWrites(failing, { protectedIds: new Set(), selfDeleteArmed: () => false });
    const applied = applySetupSteps(api, ACCOUNT, { emailDomain: DOMAIN, steps: SETUP_STEPS, setupVersion: ACCOUNT_SETUP_VERSION, frameworkVersion: "0.0.0-test", now: () => NOW, newSubdomain: () => SUB, email: { sleep: async () => {} } });
    const error = (await applied.then(() => undefined, (e: unknown) => e)) as Error;
    expect(error.message).toContain("deleting the R2 API token prototype-r2-signing failed");
    expect(error.message).not.toContain(OLD);
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

  it("an invalid bootstrap token on an account not set up: named, with its link only, and the admin app", async () => {
    const world = freshWorld();
    world.addToken("everyday", EVERYDAY_VALUE, "everyday-id");
    const { status, io } = await run(world, project({ env: bothTokens() }));
    expect(status).toBe(1);
    expect(io.out).toContain("This needs the admin app:");
    expect(io.out).toContain("CLOUDFLARE_BOOTSTRAP_TOKEN (the bootstrap token): Cloudflare does not accept it as an API token");
    expect(io.out).toContain(BOOT_LINK);
    expect(io.out).not.toContain(EVERYDAY_LINK);
  });

  it("a setup record from before the setup version: the bootstrap leaves it as it is, and the next check names the admin app's account setup (DEC-0682)", async () => {
    const world = await setUpWorld();
    world.cloud().objectBodies.set("sst-state/framework/account.json", { emailDomain: DOMAIN });
    world.addToken("bootstrap", BOOT_VALUE, "boot-id", { expires_on: EXPIRES });
    const dir = project({ env: bothTokens() });
    const { status, io } = await run(world, dir, { protectedTokenIds: [] });
    expect(status).toBe(0);
    expect(io.out).not.toContain("recorded setup version");
    expect(world.cloud().objectBodies.get("sst-state/framework/account.json")).toEqual({ emailDomain: DOMAIN });
    const check = await run(world, dir);
    expect(check.status).toBe(1);
    expect(check.io.out).toContain("This needs the admin app:\n  - the account has not been set up by this setup yet");
    expect(check.io.out).toContain(ADMIN_APP_NEXT);
    expect(check.io.out).toContain(BOOT_LINK);
  });

  it("a bootstrap token in the environment: after it deleted itself, says the variable can be removed (cloud session wording)", async () => {
    const world = await setUpWorld();
    world.addToken("bootstrap", BOOT_VALUE, "boot-id", { expires_on: EXPIRES });
    const { status, io } = await run(world, project(), { env: { CLOUDFLARE_BOOTSTRAP_TOKEN: BOOT_VALUE, CLOUDFLARE_API_TOKEN: EVERYDAY_VALUE, CLOUDFLARE_EMAIL_DOMAIN: DOMAIN, CLAUDE_CODE_REMOTE: "true" } });
    expect(status).toBe(0);
    expect(io.out).toContain("You can now remove CLOUDFLARE_BOOTSTRAP_TOKEN from the cloud environment's settings");
  });

  it("the plan is checked before the email domain is asked for (plan §4.3 step 4): only the setting can say Workers Free", async () => {
    const world = freshWorld();
    world.addToken("everyday", EVERYDAY_VALUE, "everyday-id");
    const { status, io } = await run(world, project({ env: envFile({ CLOUDFLARE_API_TOKEN: EVERYDAY_VALUE }) }), { env: { PROTOTYPE_FRAMEWORK_CLOUDFLARE_PLAN: "free" } });
    expect(status).toBe(1);
    expect(io.out).toContain('The account "Main account" is on the Workers Free plan');
    expect(io.out).not.toContain("Which domain");
    expect(world.writes()).toEqual([]);
  });

  it("the bootstrap reads no plan (it has no Billing Read): a Workers Free account is bootstrapped", async () => {
    const world = freshWorld();
    world.accounts.get(ACCOUNT)!.plan = "free";
    world.addToken("bootstrap", BOOT_VALUE, "boot-id", { expires_on: EXPIRES });
    const { status } = await run(world, project({ env: envFile({ CLOUDFLARE_BOOTSTRAP_TOKEN: BOOT_VALUE }) }));
    expect(status).toBe(0);
    expect(world.requests.filter((r) => r.includes("/subscriptions"))).toEqual([]);
    expect(world.token("boot-id").deleted).toBe(true);
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
    expect(io.out).toContain('  plan: not checked (reading it needs "Billing Read")');
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

  it("a release needing more everyday permissions: the failed reads and the admin app (or the bootstrap link); the bootstrap token never updates it (DEC-0682)", async () => {
    const world = freshWorld();
    await setUpAccount(world);
    const rules = groupNamed("Email Routing Rules Read");
    const everyday = world.addToken("everyday", EVERYDAY_VALUE, "everyday-id", { groups: EVERYDAY.filter((g) => g !== rules) });
    const before = JSON.stringify(everyday.policies);
    const dir = project({ env: everydayOnly({ CLOUDFLARE_ACCOUNT_ID: ACCOUNT }) });
    const without = await run(world, dir);
    expect(without.status).toBe(1);
    expect(without.io.out).toContain('CLOUDFLARE_API_TOKEN failed the quick check for "Email Routing Rules Read" (HTTP 403)');
    expect(without.io.out).toContain(ADMIN_APP_NEXT);
    expect(without.io.out).toContain(BOOT_LINK);
    expect(without.io.out).not.toContain(EVERYDAY_LINK);
    expect(world.writes()).toEqual([]);

    world.addToken("bootstrap", BOOT_VALUE, "boot-id", { expires_on: EXPIRES });
    writeFileSync(join(dir, ".env.cloudflare"), `CLOUDFLARE_BOOTSTRAP_TOKEN=${BOOT_VALUE}\n${readEnvFile(dir)}`);
    const withBoot = await run(world, dir);
    expect(withBoot.io.err).toBe("");
    expect(withBoot.status).toBe(0);
    expect(world.requests.filter((r) => / PUT /.test(r) || r.includes("/tokens/everyday-id"))).toEqual([]);
    expect(JSON.stringify(everyday.policies)).toBe(before);
    expect(world.token("boot-id").deleted).toBe(true);
  });

  it("a release needing more account setup: the missing steps and the admin app; the bootstrap token applies none of them (DEC-0682)", async () => {
    const world = await setUpWorld();
    world.cloud().buckets.delete("prototype-backups");
    world.cloud().lifecycles.delete("prototype-backups");
    const dir = project({ env: everydayOnly({ CLOUDFLARE_ACCOUNT_ID: ACCOUNT }) });
    const without = await run(world, dir);
    expect(without.status).toBe(1);
    expect(without.io.out).toContain("these setup steps are missing: backup-bucket, backup-lifecycle");
    expect(without.io.out).toContain(ADMIN_APP_NEXT);
    expect(without.io.out).toContain(BOOT_LINK);

    world.addToken("bootstrap", BOOT_VALUE, "boot-id", { expires_on: EXPIRES });
    writeFileSync(join(dir, ".env.cloudflare"), `CLOUDFLARE_BOOTSTRAP_TOKEN=${BOOT_VALUE}\n${readEnvFile(dir)}`);
    const withBoot = await run(world, dir);
    expect(withBoot.status).toBe(0);
    expect(withBoot.io.out).not.toContain("account setup: applied");
    expect(world.cloud().buckets.has("prototype-backups")).toBe(false);
    expect(world.token("boot-id").deleted).toBe(true);
    expect(readEnvFile(dir)).toContain("# CLOUDFLARE_BOOTSTRAP_TOKEN=deleted by setup process");
  });

  it("an account switch: explains, changes nothing; with --switch-account bootstraps the new account and records its ID", async () => {
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
    expect(switched.io.out).toContain("The Cloudflare bootstrap is complete.");
    expect(world.token("boot-id").deleted).toBe(true);
    expect(world.requests.filter((r) => r.includes(`/accounts/${ACCOUNT}/`))).toEqual([]);
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

  it("a user token as the everyday token: the quick check decides, and its permissions are never read", async () => {
    const world = new SetupWorld();
    await setUpAccount(world);
    world.addUserToken(EVERYDAY_VALUE, "user-id", [ACCOUNT]);
    const { status, io } = await run(world, project({ env: everydayOnly() }));
    expect(status).toBe(0);
    expect(io.out).toContain("  everyday token: passed the quick check");
    expect(world.token("user-id").deleted).toBe(false);
    expect(world.requests.filter((r) => r.includes("/tokens/user-id"))).toEqual([]);
    expect(world.writes()).toEqual([]);
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

describe("cloudflare-setup: an everyday token short of a permission (the admin app's since v0.2.0; DEC-0682)", () => {
  it("scoped to another zone: it cannot look up the email domain's zone, which is named; no token read or written", async () => {
    const world = freshWorld();
    await setUpAccount(world);
    const otherZone = world.cloud().zones.get("one.example")!.id;
    world.addToken("everyday", EVERYDAY_VALUE, "everyday-id", { policies: dashboardPolicies(EVERYDAY, ACCOUNT, { [`com.cloudflare.api.account.zone.${otherZone}`]: "*" }) });
    const { status, io } = await run(world, project({ env: everydayOnly() }));
    expect(status).toBe(1);
    expect(io.out).toContain("Looking up the zone of example.test failed");
    expect(io.out).toContain('CLOUDFLARE_API_TOKEN (the everyday token): it needs "Zone Read" on the email domain\'s zone');
    expect(world.requests.filter((r) => r.includes("/tokens/everyday-id"))).toEqual([]);
    expect(world.writes()).toEqual([]);
  });

  it("a deny policy: its failed read and the admin app; no token written", async () => {
    const world = freshWorld();
    await setUpAccount(world);
    const d1 = groupNamed("D1 Write");
    world.addToken("everyday", EVERYDAY_VALUE, "everyday-id", { policies: [...dashboardPolicies(EVERYDAY, ACCOUNT), { effect: "deny", resources: { [`com.cloudflare.api.account.${ACCOUNT}`]: "*" }, permission_groups: [{ id: d1.id }] }] });
    const { status, io } = await run(world, project({ env: everydayOnly() }));
    expect(status).toBe(1);
    expect(io.out).toContain('CLOUDFLARE_API_TOKEN failed the quick check for "D1 Write" (HTTP 403)');
    expect(io.out).toContain(ADMIN_APP_NEXT);
    expect(world.writes()).toEqual([]);
  });
});

describe("cloudflare-setup: the token write guard (DEC-0589)", () => {
  it("a protected bootstrap ID is never deleted: the self-delete is skipped (no DELETE sent), its line is kept, the run finishes normally (DEC-0589)", async () => {
    for (const how of ["option", "environment"] as const) {
      const world = await setUpWorld();
      world.addToken("bootstrap", BOOT_VALUE, "boot-id", { expires_on: EXPIRES });
      const dir = project({ env: bothTokens() });
      const { status, io } = await run(world, dir, how === "option" ? { protectedTokenIds: ["boot-id"] } : { env: { PROTOTYPE_FRAMEWORK_PROTECTED_TOKEN_IDS: "x, BOOT-ID" } });
      expect(io.err, how).toBe("");
      expect(status, how).toBe(0);
      expect(io.out).toContain("note: the bootstrap token is protected, so setup did not delete it");
      expect(io.out).not.toContain("deleted itself");
      expect(io.out).not.toContain("commented out");
      expect(world.requests.filter((r) => / DELETE /.test(r))).toEqual([]);
      expect(world.token("boot-id").deleted).toBe(false);
      // The token still exists, so its line stays as it was.
      expect(readEnvFile(dir).startsWith(`CLOUDFLARE_BOOTSTRAP_TOKEN=${BOOT_VALUE}\n`)).toBe(true);
      expect(io.out).toContain("The Cloudflare bootstrap is complete.");
    }
  });

  it("the bootstrap leaves the everyday token alone (no update, no delete), also one that lacks a permission and whose ID is protected", async () => {
    const world = freshWorld();
    await setUpAccount(world);
    world.addToken("everyday", EVERYDAY_VALUE, "everyday-id", { groups: EVERYDAY.filter((g) => g.name !== "D1 Write") });
    world.addToken("bootstrap", BOOT_VALUE, "boot-id", { expires_on: EXPIRES });
    const { status } = await run(world, project({ env: bothTokens() }), { env: { PROTOTYPE_FRAMEWORK_PROTECTED_TOKEN_IDS: "x, everyday-id" } });
    expect(status).toBe(0);
    expect(world.requests.filter((r) => / (PUT|DELETE) .*\/tokens\//.test(r))).toEqual([`boot-id DELETE /accounts/${ACCOUNT}/tokens/boot-id`]);
    expect(world.token("everyday-id").deleted).toBe(false);
  });

  it("guardTokenWrites refuses every write but the bootstrap self-delete, before sending; since v0.2.0 no token is updated (DEC-0682)", async () => {
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
      ["PUT", "/accounts/a/tokens/every"],
      ["DELETE", "/accounts/a/tokens/tok0"],
      ["DELETE", "/user/tokens/tok0"],
    ] as const) {
      await expect(api(method, path), `${method} ${path}`).rejects.toThrow(/setup refused to/);
    }
    expect(sent).toEqual([]);
    armed = true;
    await expect(api("DELETE", "/accounts/a/tokens/tok0"), "an ID setup did not learn as a signing token").rejects.toThrow(/setup refused to delete/);
    await expect(api("PUT", "/accounts/a/tokens/every", {}), "the everyday token, also while the self-delete is armed").rejects.toThrow(/setup refused to update/);
    await api("DELETE", "/accounts/a/tokens/boot");
    await api("GET", "/accounts/a/tokens/owner");
    expect(sent).toEqual(["DELETE /accounts/a/tokens/boot", "GET /accounts/a/tokens/owner"]);
  });

  it("guardTokenWrites deletes only the signing tokens it saw by name: listed or just created as prototype-r2-signing (DEC-0618)", async () => {
    const sent: string[] = [];
    const replies: Record<string, unknown> = {
      "GET /accounts/a/tokens?per_page=50&page=1": { success: true, result: [{ id: "old-sign", name: "prototype-r2-signing" }, { id: "other", name: "someone-else" }, { id: "owner", name: "prototype-r2-signing" }], result_info: { total_pages: 1 } },
      "POST /accounts/a/tokens": { success: true, result: { id: "new-sign", name: "prototype-r2-signing", value: "v" } },
    };
    const api = guardTokenWrites(async (method, path) => (sent.push(`${method} ${path}`), { status: 200, body: replies[`${method} ${path}`] ?? { success: true, result: {} } }), {
      protectedIds: new Set(["owner"]),
      everydayId: "every",
      bootstrapId: "boot",
      selfDeleteArmed: () => false,
    });
    await expect(api("DELETE", "/accounts/a/tokens/old-sign")).rejects.toThrow(/setup refused to delete/);
    await api("GET", "/accounts/a/tokens?per_page=50&page=1");
    await api("POST", "/accounts/a/tokens", { name: "prototype-r2-signing" });
    await api("DELETE", "/accounts/a/tokens/OLD-SIGN");
    await api("DELETE", "/accounts/a/tokens/new-sign");
    for (const path of ["/accounts/a/tokens/other", "/accounts/a/tokens/owner", "/accounts/a/tokens/every", "/accounts/a/tokens/boot"]) {
      await expect(api("DELETE", path), path).rejects.toThrow(/setup refused to delete/);
    }
    await expect(api("PUT", "/accounts/a/tokens/old-sign", {})).rejects.toThrow(/setup refused to update/);
    expect(sent).toEqual(["GET /accounts/a/tokens?per_page=50&page=1", "POST /accounts/a/tokens", "DELETE /accounts/a/tokens/OLD-SIGN", "DELETE /accounts/a/tokens/new-sign"]);
  });

  it("guardTokenWrites hands every token ID a token list or create answer names to the run's redaction (SETUP-REQ-007)", async () => {
    const seen: string[] = [];
    const replies: Record<string, unknown> = {
      "GET /accounts/a/tokens?per_page=50&page=1": { success: true, result: [{ id: "old-sign", name: "prototype-r2-signing" }, { id: "other", name: "someone-else" }] },
      "POST /accounts/a/tokens": { success: true, result: { id: "new-sign", value: "v" } },
    };
    const api = guardTokenWrites(async (method, path) => ({ status: 200, body: replies[`${method} ${path}`] ?? { success: true, result: [{ id: "not-a-token" }] } }), {
      protectedIds: new Set(),
      selfDeleteArmed: () => false,
      onTokenId: (id) => seen.push(id),
    });
    await api("GET", "/accounts/a/tokens?per_page=50&page=1");
    await api("POST", "/accounts/a/tokens", { name: "prototype-r2-signing" });
    await api("GET", "/accounts/a/workers/scripts");
    expect(seen).toEqual(["old-sign", "other", "new-sign"]);
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
      ["DELETE", "/accounts/a/tokens/x/../tok0"],
      ["PUT", "/accounts/a/tokens/./every"],
    ] as const) {
      await expect(api(method, path), JSON.stringify(`${method} ${path}`)).rejects.toThrow(/setup refused to/);
    }
    expect(sent).toEqual([]);
    // A create is not a write of an ID.
    await api("POST", "/accounts/a/tokens/x/..", {});
    expect(sent).toEqual(["POST /accounts/a/tokens/x/.."]);
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

  it("a stop of the request layer (a budget used up, a 429) during the network check ends the run instead of counting as a blocked host (DEC-0619)", async () => {
    const world = await setUpWorld();
    const urls: string[] = [];
    const stopped = await run(world, project({ env: everydayOnly() }), {
      reach: async (url) => {
        urls.push(url);
        throw new CloudflareRequestsStopped("live pass stopped: HTTP 429 on GET (rate limited)");
      },
    });
    expect(stopped.status).toBe(1);
    expect(urls).toHaveLength(1);
    expect(stopped.io.err).toContain("cloudflare-setup failed: live pass stopped: HTTP 429 on GET (rate limited)");
    expect(stopped.io.out).not.toContain("cannot reach");

    // The same when the network check's subdomain read (an API call; the run's last) is the one stopped.
    world.requests.length = 0;
    const reads = (await run(world, project({ env: everydayOnly() }))).status === 0 ? world.requests.filter((r) => r.endsWith("/workers/subdomain")).length : -1;
    let seen = 0;
    const apiFor = (value: string) => {
      const api = world.apiFor(value);
      return async (method: Parameters<typeof api>[0], path: string, body?: unknown) => {
        if (path.endsWith("/workers/subdomain") && ++seen === reads) throw new CloudflareRequestsStopped("the pass budget is used");
        return api(method, path, body);
      };
    };
    world.requests.length = 0;
    const io = captureIo(project({ env: everydayOnly() }));
    runs.push({ io, world });
    const reached: string[] = [];
    const status = await cloudflareSetupCommand({ env: {}, apiFor, reach: async (url) => void reached.push(url), localSetup: fakeLocalSetup, now: () => NOW })([], io);
    expect(status).toBe(1);
    expect(io.err).toContain("cloudflare-setup failed: the pass budget is used");
    expect(io.out).not.toContain("cannot reach");
    expect(reached).toEqual([]);
  });

  it("a stop of the request layer while the setup record or the plan is read ends the run with the stop, never as unreadable setup or a bootstrap request (DEC-0619)", async () => {
    /** The world's API, stopped from the first request `from` matches on: that one and every later one reject. */
    const stoppingFrom = (world: SetupWorld, from: (method: string, path: string) => boolean) => {
      let stopped = false;
      return (value: string) => {
        const api = world.apiFor(value);
        return async (method: Parameters<typeof api>[0], path: string, body?: unknown) => {
          if (stopped || from(method, path)) {
            stopped = true;
            throw new CloudflareRequestsStopped("live pass stopped: HTTP 429 on GET (rate limited)");
          }
          return api(method, path, body);
        };
      };
    };
    const runStopped = async (world: SetupWorld, env: string, from: (method: string, path: string) => boolean) => {
      const io = captureIo(project({ env }));
      runs.push({ io, world });
      const reached: string[] = [];
      const status = await cloudflareSetupCommand({ env: {}, apiFor: stoppingFrom(world, from), reach: async (url) => void reached.push(url), localSetup: fakeLocalSetup, now: () => NOW })([], io);
      return { status, io, reached };
    };
    const plainly = ({ status, io, reached }: Awaited<ReturnType<typeof runStopped>>) => {
      expect(status).toBe(1);
      expect(io.err).toContain("cloudflare-setup failed: live pass stopped: HTTP 429 on GET (rate limited)");
      expect(io.out).not.toContain("could not be read");
      expect(io.out).not.toContain("This needs the admin app");
      expect(io.out).not.toContain(BOOT_LINK);
      expect(reached).toEqual([]);
    };

    // The setup record's read (checkAccountSetup, with the everyday token).
    plainly(await runStopped(await setUpWorld(), everydayOnly(), (_m, path) => path.includes("/objects/")));
    // The zone lookup inside checkAccountSetup's email steps.
    const world = await setUpWorld();
    plainly(await runStopped(world, everydayOnly(), (_m, path) => path.startsWith("/zones") && world.requests.some((r) => r.includes("/objects/"))));
    // The plan read (with the everyday token since v0.2.0): not taken as "not checked".
    const planWorld = await setUpWorld();
    const planStop = await runStopped(planWorld, everydayOnly(), (_m, path) => path.endsWith("/subscriptions"));
    plainly(planStop);
    expect(planStop.io.out).not.toContain("not checked");
    expect(planWorld.writes()).toEqual([]);
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

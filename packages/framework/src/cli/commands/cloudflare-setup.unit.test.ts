/**
 * `cloudflare-setup` with the user's one token, against the fake Cloudflare (DEC-0795…DEC-0800;
 * setup.md SETUP-REQ-001…007): the credential's sources (environment, then the secrets file), the
 * no-credential template, the token and account checks, the permission check (missing named, more
 * silent), the whole account setup in one run, the token write guard (the user's token is never
 * deleted, rolled or updated), the local setup run first, git warnings that never fail, the network
 * check, and no token value, account ID, zone ID or workers.dev subdomain in any output (every
 * test's stdout and stderr are searched, DEC-0590). No network.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CloudflareRequestsStopped } from "../../provision/cloudflare/api.js";
import { ACCOUNT_ID_HELP, guardTokenWrites, NEXT_PROMPT, TOKEN_PAGE_CHOICES } from "../../provision/cloudflare/cloudflare-setup.js";
import { ACCOUNT } from "../../provision/cloudflare/fake-cloud.test-support.js";
import { CLIENT_NAMES } from "../../provision/cloudflare/oauth-clients.js";
import { ACCOUNT_SETUP_VERSION, deepLink, TOKEN, type TokenPolicy } from "../../provision/cloudflare/permissions.js";
import { readSetupRecord, SETUP_STEPS } from "../../provision/cloudflare/setup-record.js";
import { applySetupSteps } from "../../provision/cloudflare/setup-steps.js";
import { dashboardPolicies, groupNamed, OTHER_ACCOUNT, SetupWorld } from "../../provision/cloudflare/setup-world.test-support.js";
import { runLocalSetup } from "../../provision/core/local-setup.js";
import { readDevVars } from "../../secrets/dev-vars.js";
import { captureIo } from "../io.test-support.js";
import { cloudflareSetupCommand, type CloudflareSetupCommandDeps } from "./cloudflare-setup.js";

const TOKEN_VALUE = "MARKER-user-token-value-00000000000001";
const OTHER_VALUE = "MARKER-other-token-value-0000000000003";
const TOKEN_ID = "MARKERtokenid";
const SUB = "pf-markersubdomain";
const ADMIN_URL = `https://prototype-admin.${SUB}.workers.dev`;
const NOW = new Date("2026-11-27T12:00:00.000Z");
const LINK = deepLink("token");
const AUTH_SOURCE = 'export default { fetch() { return new Response("auth app"); } };';

type Io = ReturnType<typeof captureIo>;
const runs: { io: Io; world: SetupWorld }[] = [];
const dirs: string[] = [];

afterEach(() => {
  // No output of any run holds a token value, an account ID, a token ID, a zone ID or the subdomain.
  for (const { io, world } of runs.splice(0)) {
    // The one place the subdomain is printed: the admin app's URL in the summary (DEC-0686). On standard output only.
    const text = io.out.split(ADMIN_URL).join("<admin app URL>") + io.err;
    const zoneIds = [...world.accounts.values()].flatMap((a) => [...a.cloud.zones.values()].map((z) => z.id));
    for (const secret of ["MARKER", ACCOUNT, OTHER_ACCOUNT, SUB, ...zoneIds]) expect(text, `output holds ${secret.slice(0, 6)}…`).not.toContain(secret);
    // The messages leave the values out themselves; the run's redaction (DEC-0590) is only a backstop.
    expect(text).not.toContain("[hidden]");
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const temp = (prefix: string): string => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
};

/** A project folder: a git repository with `.env.cloudflare` ignored (the local setup's line). */
function project(options: { repo?: boolean; gitignore?: string } = {}): string {
  const dir = temp("cf-setup-");
  if (options.repo !== false) execFileSync("git", ["init", "-q"], { cwd: dir, stdio: "ignore" });
  if (options.gitignore !== undefined || options.repo !== false) writeFileSync(join(dir, ".gitignore"), options.gitignore ?? ".env.cloudflare\n");
  return dir;
}

/** A home directory, with the secrets file when `text` is given. */
function home(text?: string, mode = 0o600): string {
  const h = temp("cf-home-");
  if (text !== undefined) {
    mkdirSync(join(h, ".secrets"), { recursive: true });
    writeFileSync(join(h, ".secrets", "cloudflare"), text, { mode });
    chmodSync(join(h, ".secrets", "cloudflare"), mode);
  }
  return h;
}
const secretsOf = (h: string): string => join(h, ".secrets", "cloudflare");
const credential = (token = TOKEN_VALUE, account = ACCOUNT): string => `CLOUDFLARE_API_TOKEN=${token}\nCLOUDFLARE_ACCOUNT_ID=${account}\n`;

/** A world whose accounts have no setup yet (no subdomain, so setup registers `SUB`). */
function freshWorld(): SetupWorld {
  const world = new SetupWorld();
  world.cloud().subdomain = undefined;
  return world;
}

/** The account set up as an earlier run (or the admin app) left it: every step and the record. */
async function setUpAccount(world: SetupWorld, accountId = ACCOUNT): Promise<void> {
  const cloud = world.cloud(accountId);
  cloud.subdomain = undefined;
  await applySetupSteps(cloud.api, ACCOUNT, { steps: SETUP_STEPS, setupVersion: ACCOUNT_SETUP_VERSION, frameworkVersion: "0.0.0-test", now: () => NOW, newSubdomain: () => SUB });
}

/** A set-up account with the user's token (every permission of `TOKEN`). */
async function setUpWorld(): Promise<SetupWorld> {
  const world = freshWorld();
  await setUpAccount(world);
  world.addToken("token", TOKEN_VALUE, TOKEN_ID);
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
  home?: string;
  args?: string[];
  protectedTokenIds?: string[];
  reach?: (url: string) => Promise<void>;
  localSetup?: CloudflareSetupCommandDeps["localSetup"];
  apiFor?: CloudflareSetupCommandDeps["apiFor"];
}

async function run(world: SetupWorld, dir: string, options: RunOptions = {}): Promise<{ status: number; io: Io; reached: string[] }> {
  const io = captureIo(dir);
  runs.push({ io, world });
  const reached: string[] = [];
  const status = await cloudflareSetupCommand({
    env: options.env ?? {},
    home: options.home ?? home(),
    apiFor: options.apiFor ?? world.apiFor,
    reach: options.reach ?? (async (url) => void reached.push(url)),
    localSetup: options.localSetup ?? fakeLocalSetup,
    stepOptions: { newSubdomain: () => SUB },
    frameworkVersion: "0.0.0-test",
    authAppSource: () => AUTH_SOURCE,
    now: () => NOW,
    ...(options.protectedTokenIds === undefined ? {} : { protectedTokenIds: options.protectedTokenIds }),
  })(options.args ?? [], io);
  return { status, io, reached };
}

/** Requests that change the user's token (update, roll, delete), sent with any token. */
const tokenWrites = (world: SetupWorld, id = TOKEN_ID): string[] => world.requests.filter((r) => /^\S+ (PUT|PATCH|POST|DELETE) /.test(r) && r.toLowerCase().includes(`/tokens/${id.toLowerCase()}`));

describe("cloudflare-setup: no credential (owner decision 2, DEC-0795)", () => {
  it("prints the two-line template with nothing after the =, the resolved secrets file, the environment variables, the token link and the next prompt; writes nothing, sends nothing; exit 1", async () => {
    const world = new SetupWorld();
    const dir = project();
    const h = home();
    const { status, io } = await run(world, dir, { home: h });
    expect(status).toBe(1);
    const lines = io.out.split("\n");
    const at = lines.indexOf("CLOUDFLARE_API_TOKEN=");
    expect(at).toBeGreaterThan(-1);
    expect(lines[at + 1]).toBe("CLOUDFLARE_ACCOUNT_ID=");
    expect(io.out).toContain("No Cloudflare credential was found.");
    expect(io.out).toContain(`in the file ${secretsOf(h)}, shared by every project`);
    expect(io.out).toContain("Environment variables");
    expect(io.out).toContain("The environment variables win over the file.");
    expect(lines.map((l) => l.trim())).toContain(LINK);
    expect(io.out).toContain(TOKEN_PAGE_CHOICES);
    expect(io.out).toContain(ACCOUNT_ID_HELP);
    expect(io.out).toContain(NEXT_PROMPT);
    expect(io.out).not.toMatch(/bootstrap/i);
    expect(world.requests).toEqual([]);
    expect(existsSync(join(dir, ".env.cloudflare"))).toBe(false);
    expect(readdirSync(h)).toEqual([]);
  });

  it("CLOUDFLARE_SECRETS_FILE set: its path is the one printed", async () => {
    const h = home();
    const { status, io } = await run(new SetupWorld(), project(), { home: h, env: { CLOUDFLARE_SECRETS_FILE: "~/keys/cf.env" } });
    expect(status).toBe(1);
    expect(io.out).toContain(`in the file ${join(h, "keys", "cf.env")}, shared by every project`);
  });

  it("only one of the two set: names the missing one, with the template and the link; no request; exit 1", async () => {
    const world = await setUpWorld();
    const onlyToken = await run(world, project(), { env: { CLOUDFLARE_API_TOKEN: TOKEN_VALUE } });
    expect(onlyToken.status).toBe(1);
    expect(onlyToken.io.out).toContain("CLOUDFLARE_ACCOUNT_ID is not set.");
    expect(onlyToken.io.out).toContain("CLOUDFLARE_API_TOKEN=\nCLOUDFLARE_ACCOUNT_ID=\n");
    expect(onlyToken.io.out).toContain(LINK);
    const onlyAccount = await run(world, project(), { home: home(`CLOUDFLARE_ACCOUNT_ID=${ACCOUNT}\n`) });
    expect(onlyAccount.status).toBe(1);
    expect(onlyAccount.io.out).toContain("CLOUDFLARE_API_TOKEN is not set.");
    expect(world.requests).toEqual([]);
  });
});

describe("cloudflare-setup: where the credential comes from (owner decision 1, DEC-0795; SETUP-REQ-002)", () => {
  it("from the secrets file: says so by path, never the value; a set-up account needs nothing; the file is left byte for byte", async () => {
    const world = await setUpWorld();
    const h = home(credential());
    const { status, io } = await run(world, project(), { home: h });
    expect(status).toBe(0);
    expect(io.out).toContain(`CLOUDFLARE_API_TOKEN: from the file ${secretsOf(h)}`);
    expect(io.out).toContain(`CLOUDFLARE_ACCOUNT_ID: from the file ${secretsOf(h)}`);
    expect(io.out).toContain("Everything is already set up and current: nothing to do.");
    expect(readFileSync(secretsOf(h), "utf8")).toBe(credential());
    expect(world.writes()).toEqual([]);
  });

  it("from the environment: says so by variable; no file is created", async () => {
    const world = await setUpWorld();
    const h = home();
    const dir = project();
    const { status, io } = await run(world, dir, { home: h, env: { CLOUDFLARE_API_TOKEN: TOKEN_VALUE, CLOUDFLARE_ACCOUNT_ID: ACCOUNT } });
    expect(status).toBe(0);
    expect(io.out).toContain("CLOUDFLARE_API_TOKEN: from the environment variable CLOUDFLARE_API_TOKEN");
    expect(io.out).toContain("CLOUDFLARE_ACCOUNT_ID: from the environment variable CLOUDFLARE_ACCOUNT_ID");
    expect(readdirSync(h)).toEqual([]);
    expect(existsSync(join(dir, ".env.cloudflare"))).toBe(false);
  });

  it("the environment wins over the file: a broken token in the file is not used, and the difference is noted by name", async () => {
    const world = await setUpWorld();
    const h = home(credential(OTHER_VALUE));
    const { status, io } = await run(world, project(), { home: h, env: { CLOUDFLARE_API_TOKEN: TOKEN_VALUE } });
    expect(status).toBe(0);
    expect(io.out).toContain("CLOUDFLARE_API_TOKEN: from the environment variable CLOUDFLARE_API_TOKEN");
    expect(io.out).toContain(`CLOUDFLARE_ACCOUNT_ID: from the file ${secretsOf(h)}`);
    expect(io.err).toContain("cloudflare-setup: note: CLOUDFLARE_API_TOKEN is set in both the environment and");
    expect(world.requests.some((r) => r.startsWith("? "))).toBe(false);
  });

  it.runIf(process.platform !== "win32")("a secrets file others can read: warned about on standard error, and the run's result is unchanged (DEC-0800)", async () => {
    const world = await setUpWorld();
    const h = home(credential(), 0o644);
    const { status, io } = await run(world, project(), { home: h });
    expect(status).toBe(0);
    expect(io.err).toContain(`cloudflare-setup: note: the secrets file ${secretsOf(h)} can be read by other users (mode 644); make it private with: chmod 600 ${secretsOf(h)}`);
  });

  it("an old .env.cloudflare and a CLOUDFLARE_BOOTSTRAP_TOKEN are not used: each gets a note, and the run goes on with the one credential (DEC-0799)", async () => {
    const world = await setUpWorld();
    world.addToken("token", OTHER_VALUE, "MARKERother");
    const dir = project();
    writeFileSync(join(dir, ".env.cloudflare"), `CLOUDFLARE_BOOTSTRAP_TOKEN=${OTHER_VALUE}\nCLOUDFLARE_API_TOKEN=${OTHER_VALUE}\n`);
    const { status, io } = await run(world, dir, { home: home(credential()), env: { CLOUDFLARE_BOOTSTRAP_TOKEN: OTHER_VALUE } });
    expect(status).toBe(0);
    expect(io.err).toContain("cloudflare-setup: note: .env.cloudflare in the project folder is no longer read");
    expect(io.err).toContain("cloudflare-setup: note: CLOUDFLARE_BOOTSTRAP_TOKEN is no longer used and was ignored");
    expect(world.requests.filter((r) => r.startsWith("MARKERother "))).toEqual([]);
    expect(readFileSync(join(dir, ".env.cloudflare"), "utf8")).toBe(`CLOUDFLARE_BOOTSTRAP_TOKEN=${OTHER_VALUE}\nCLOUDFLARE_API_TOKEN=${OTHER_VALUE}\n`);
  });
});

describe("cloudflare-setup: a fresh account, set up in one run with the one token (DEC-0798)", () => {
  it("makes the OAuth clients, the admin app, the auth app, the shared buckets, the signing credential and the setup record; never touches the user's token; a second run changes nothing", async () => {
    const world = freshWorld();
    const user = world.addToken("token", TOKEN_VALUE, TOKEN_ID);
    const policiesBefore = JSON.stringify(user.policies);
    const h = home(credential());
    const { status, io, reached } = await run(world, project(), { home: h });
    expect(io.err).toBe("");
    expect(status).toBe(0);
    expect(io.out).toContain("CLOUDFLARE_API_TOKEN: has every permission the framework needs");
    expect(io.out).toContain(`OAuth clients: created ${CLIENT_NAMES.admin} and ${CLIENT_NAMES.signin}`);
    expect(io.out).toContain("admin app: deployed (Worker prototype-admin)");
    expect(io.out).toContain("account setup: The auth app is deployed at Worker prototype-auth on the account's workers.dev subdomain, with its new D1 database.");
    expect(io.out).toContain(`account setup: Recorded account setup version ${String(ACCOUNT_SETUP_VERSION)}.`);
    expect(io.out).toContain("Cloudflare setup is complete.");
    expect(io.out).toContain(`  admin app (optional; status and cleanup pages): ${ADMIN_URL}`);
    expect(io.out).toContain("Next step: deploy a test stage: npm run deploy -- --target cloudflare --stage test-first");
    expect(io.out).not.toMatch(/bootstrap token|everyday token|Everyday token page/i);
    const cloud = world.cloud();
    expect([...cloud.oauthClients.values()].map((c) => c.name).sort()).toEqual([CLIENT_NAMES.admin, CLIENT_NAMES.signin].sort());
    expect(cloud.workers.has("prototype-admin")).toBe(true);
    expect(cloud.workers.has("prototype-auth")).toBe(true);
    expect(cloud.d1Databases.map((d) => d.name)).toEqual(["prototype-auth"]);
    const record = await readSetupRecord(cloud.api, ACCOUNT);
    expect(record?.setupVersion).toBe(ACCOUNT_SETUP_VERSION);
    // The user's token: never updated, rolled or deleted; still valid with the same policies.
    expect(tokenWrites(world)).toEqual([]);
    expect(user.deleted).toBe(false);
    expect(JSON.stringify(user.policies)).toBe(policiesBefore);
    expect(reached).toEqual(["https://api.cloudflare.com/client/v4/", `https://${ACCOUNT}.r2.cloudflarestorage.com/`, `https://prototype-framework-reachability.${SUB}.workers.dev/`]);
    expect(readFileSync(secretsOf(h), "utf8")).toBe(credential());

    world.requests.length = 0;
    const again = await run(world, project(), { home: h });
    expect(again.status).toBe(0);
    expect(again.io.out).toContain("Everything is already set up and current: nothing to do.");
    expect(world.writes()).toEqual([]);
  });

  it("an account set up by the admin app earlier (or 0.2.0-rc01) is current: nothing is written", async () => {
    const world = await setUpWorld();
    const { status, io } = await run(world, project(), { home: home(credential()) });
    expect(status).toBe(0);
    expect(io.out).toContain("Everything is already set up and current: nothing to do.");
    expect(io.out).not.toContain("admin app (optional");
    expect(world.writes()).toEqual([]);
  });

  it("a setup record from an older release: the setup runs again and records the current version", async () => {
    const world = freshWorld();
    await applySetupSteps(world.cloud().api, ACCOUNT, { steps: SETUP_STEPS, setupVersion: 1, frameworkVersion: "0.1.1", now: () => NOW, newSubdomain: () => SUB });
    world.addToken("token", TOKEN_VALUE, TOKEN_ID);
    const { status, io } = await run(world, project(), { home: home(credential()) });
    expect(status).toBe(0);
    expect(io.out).toContain("Cloudflare setup is complete.");
    expect((await readSetupRecord(world.cloud().api, ACCOUNT))?.setupVersion).toBe(ACCOUNT_SETUP_VERSION);
    expect(tokenWrites(world)).toEqual([]);
  });

  it("a step that fails stops the run with exit 1 and its cause; the user's token is still untouched", async () => {
    const world = freshWorld();
    const user = world.addToken("token", TOKEN_VALUE, TOKEN_ID);
    const apiFor = (value: string) => {
      const api = world.apiFor(value);
      return async (method: Parameters<typeof api>[0], path: string, body?: unknown) =>
        method === "PUT" && path.endsWith("/workers/scripts/prototype-auth") ? { status: 500, body: { success: false, errors: [{ code: 10000, message: "injected" }], result: null } } : api(method, path, body);
    };
    const { status, io } = await run(world, project(), { home: home(credential()), apiFor });
    expect(status).toBe(1);
    expect(io.err).toContain("cloudflare-setup failed: uploading the auth app (Worker prototype-auth) failed");
    expect(tokenWrites(world)).toEqual([]);
    expect(user.deleted).toBe(false);
  });

  it("the signing step replaces an old signing token found by name through the guard, and no other token (DEC-0618)", async () => {
    const world = freshWorld();
    world.cloud().tokens.set("old-sign-id", { name: "prototype-r2-signing", resources: {} });
    world.cloud().tokens.set("unrelated-id", { name: "someone-else", resources: {} });
    const api = guardTokenWrites(world.cloud().api, { protectedIds: new Set(), userTokenId: "user-id" });
    await applySetupSteps(api, ACCOUNT, { steps: SETUP_STEPS, setupVersion: ACCOUNT_SETUP_VERSION, frameworkVersion: "0.0.0-test", now: () => NOW, newSubdomain: () => SUB });
    expect(world.cloud().tokens.has("old-sign-id")).toBe(false);
    expect(world.cloud().tokens.has("unrelated-id")).toBe(true);
  });
});

describe("cloudflare-setup: the token's permissions (owner decision 4, DEC-0797)", () => {
  it("missing two of the six: names exactly those two as the dashboard shows them, with the link; nothing written; exit 1", async () => {
    const world = await setUpWorld();
    world.token(TOKEN_ID).policies = dashboardPolicies(
      TOKEN.filter((g) => g.name !== "OAuth Client Write" && g.name !== "D1 Write"),
      ACCOUNT,
    );
    const { status, io } = await run(world, project(), { home: home(credential()) });
    expect(status).toBe(1);
    expect(io.out).toContain('CLOUDFLARE_API_TOKEN lacks these 2 permissions on the account "Main account":');
    expect(io.out).toContain('  - D1 Edit (account; API name "D1 Write")');
    expect(io.out).toContain('  - OAuth Client Edit (account; API name "OAuth Client Write")');
    expect(io.out.match(/^ {2}- /gm)).toHaveLength(2);
    expect(io.out).toContain(LINK);
    expect(io.out).toContain(NEXT_PROMPT);
    expect(world.writes()).toEqual([]);
    expect(tokenWrites(world)).toEqual([]);
  });

  it("missing one: says 'this permission'", async () => {
    const world = await setUpWorld();
    world.token(TOKEN_ID).policies = dashboardPolicies(TOKEN.filter((g) => g.name !== "Workers R2 Storage Write"), ACCOUNT);
    const { status, io } = await run(world, project(), { home: home(credential()) });
    expect(status).toBe(1);
    expect(io.out).toContain('CLOUDFLARE_API_TOKEN lacks this permission on the account "Main account":\n  - Workers R2 Storage Edit (account; API name "Workers R2 Storage Write")');
  });

  it("more permissions than needed (zone groups, extra account groups): nothing is said about them; exit 0", async () => {
    const world = await setUpWorld();
    world.token(TOKEN_ID).policies = [
      ...dashboardPolicies([...TOKEN, groupNamed("Secrets Store Read"), groupNamed("Workers Scripts Write")], ACCOUNT),
      { id: "pol-x", effect: "allow", resources: { [`com.cloudflare.api.account.${ACCOUNT}`]: "*" }, permission_groups: [{ id: "c8fed203ed3043cba015a93ad1616f1f", name: "Zone Read" }, { id: "extra", name: "Billing Read" }] },
    ];
    const { status, io } = await run(world, project(), { home: home(credential()) });
    expect(status).toBe(0);
    expect(io.out + io.err).not.toMatch(/more (permissions|than)|broad|too many|extra/i);
  });

  it("a token that cannot read its own permissions: names Account API Tokens Edit, says the others could not be checked, gives the link; exit 1", async () => {
    const world = await setUpWorld();
    world.token(TOKEN_ID).policies = dashboardPolicies(TOKEN.filter((g) => g.name !== "Account API Tokens Write"), ACCOUNT);
    const { status, io } = await run(world, project(), { home: home(credential()) });
    expect(status).toBe(1);
    expect(io.out).toContain("CLOUDFLARE_API_TOKEN cannot read its own permissions (HTTP 403");
    expect(io.out).toContain('  - Account API Tokens Edit (account; API name "Account API Tokens Write")');
    expect(io.out).toContain("Setup could not check its other permissions.");
    expect(io.out).toContain(LINK);
    expect(world.writes()).toEqual([]);
  });

  it("a deny policy takes a group away: it is named as missing", async () => {
    const world = await setUpWorld();
    const d1 = groupNamed("D1 Write");
    world.token(TOKEN_ID).policies = [...dashboardPolicies(TOKEN, ACCOUNT), { id: "deny", effect: "deny", resources: { [`com.cloudflare.api.account.${ACCOUNT}`]: "*" }, permission_groups: [{ id: d1.id }] } as TokenPolicy];
    const { status, io } = await run(world, project(), { home: home(credential()) });
    expect(status).toBe(1);
    expect(io.out).toContain('  - D1 Edit (account; API name "D1 Write")');
  });

  it("a user token (My Profile) that sees two accounts with every permission: the named account is used; its permissions are read from /user/tokens", async () => {
    const world = await setUpWorld();
    world.addAccount(OTHER_ACCOUNT, "Other account");
    world.addUserToken(OTHER_VALUE, "MARKERuser", [ACCOUNT, OTHER_ACCOUNT]);
    const { status, io } = await run(world, project(), { home: home(credential(OTHER_VALUE)) });
    expect(world.requests).toContain("MARKERuser GET /user/tokens/MARKERuser");
    expect(io.out).toContain("account: Main account");
    expect(status).toBe(0);
    expect(world.requests.filter((r) => r.includes(`/accounts/${OTHER_ACCOUNT}/`) && !r.endsWith("/tokens/verify"))).toEqual([]);
  });
});

describe("cloudflare-setup: a bad token or account (SETUP-REQ-003)", () => {
  it("a value that is not a token: says Cloudflare does not accept it, where it came from, and the link; exit 1; nothing written", async () => {
    const world = await setUpWorld();
    const h = home(credential("MARKER-not-a-token"));
    const { status, io } = await run(world, project(), { home: h });
    expect(status).toBe(1);
    expect(io.out).toContain(`CLOUDFLARE_API_TOKEN (from the file ${secretsOf(h)}): Cloudflare does not accept it as an API token (HTTP 401`);
    expect(io.out).toContain(LINK);
    expect(world.writes()).toEqual([]);
  });

  it("a token that is not active: named, with the link; exit 1", async () => {
    const world = await setUpWorld();
    world.token(TOKEN_ID).status = "disabled";
    const { status, io } = await run(world, project(), { env: { CLOUDFLARE_API_TOKEN: TOKEN_VALUE, CLOUDFLARE_ACCOUNT_ID: ACCOUNT } });
    expect(status).toBe(1);
    expect(io.out).toContain("CLOUDFLARE_API_TOKEN (from the environment variable CLOUDFLARE_API_TOKEN): the token is disabled, not active.");
    expect(io.out).toContain(LINK);
  });

  it("CLOUDFLARE_ACCOUNT_ID names an account the token cannot see: the accounts it sees by name only, how to find the ID, the link; exit 1; nothing sent to that account", async () => {
    const world = await setUpWorld();
    world.addAccount(OTHER_ACCOUNT, "Other account");
    const { status, io } = await run(world, project(), { home: home(credential(TOKEN_VALUE, OTHER_ACCOUNT)) });
    expect(status).toBe(1);
    expect(io.out).toContain("CLOUDFLARE_API_TOKEN cannot see the account CLOUDFLARE_ACCOUNT_ID names");
    expect(io.out).toContain("  1. Main account");
    expect(io.out).toContain(ACCOUNT_ID_HELP);
    expect(io.out).toContain(LINK);
    expect(world.requests.filter((r) => r.includes(`/accounts/${OTHER_ACCOUNT}/`))).toEqual([]);
    expect(world.writes()).toEqual([]);
  });

  it("an argument (the removed --switch-account, or a pasted token) is a usage error that never echoes it", async () => {
    for (const arg of ["--switch-account", TOKEN_VALUE]) {
      await expect(run(new SetupWorld(), project(), { args: [arg] })).rejects.toThrow(/takes no arguments/);
    }
    runs.length = 0;
  });
});

describe("cloudflare-setup: the token write guard never touches the user's token (owner decision 3, DEC-0796; DEC-0589)", () => {
  const recorder = () => {
    const sent: string[] = [];
    const api = guardTokenWrites(async (method, path) => (sent.push(`${method} ${path}`), { status: 200, body: { success: true, result: {} } }), { protectedIds: new Set(["owner"]), userTokenId: "mine" });
    return { sent, api };
  };

  it("refuses a DELETE, an update, a roll or any other write of the user's token, before sending", async () => {
    const { sent, api } = recorder();
    for (const [method, path] of [
      ["DELETE", "/accounts/a/tokens/mine"],
      ["PUT", "/accounts/a/tokens/mine"],
      ["PUT", "/accounts/a/tokens/mine/value"],
      ["POST", "/accounts/a/tokens/mine/value"],
      ["PATCH", "/accounts/a/tokens/mine"],
      ["DELETE", "/user/tokens/mine"],
      ["PUT", "/user/tokens/MINE/value"],
    ] as const) {
      await expect(api(method, path), `${method} ${path}`).rejects.toThrow(/setup refused to (delete|change) an API token: it is your token, which setup never deletes, rolls or updates/);
    }
    expect(sent).toEqual([]);
  });

  it("refuses protected IDs, any PUT, any roll, and a DELETE of a token it did not see as its own signing token", async () => {
    const { sent, api } = recorder();
    await expect(api("DELETE", "/accounts/a/tokens/owner")).rejects.toThrow(/its ID is protected/);
    await expect(api("PUT", "/accounts/a/tokens/other", {})).rejects.toThrow(/setup updates and rolls no token/);
    await expect(api("PUT", "/accounts/a/tokens/other/value", {})).rejects.toThrow(/setup updates and rolls no token/);
    await expect(api("DELETE", "/accounts/a/tokens/other")).rejects.toThrow(/setup deletes only the signing tokens it created/);
    expect(sent).toEqual([]);
  });

  it("deletes only the signing tokens it saw by name: listed or just created as prototype-r2-signing (DEC-0618); never the user's even if so named", async () => {
    const sent: string[] = [];
    const replies: Record<string, unknown> = {
      "GET /accounts/a/tokens?per_page=50&page=1": { success: true, result: [{ id: "old-sign", name: "prototype-r2-signing" }, { id: "other", name: "someone-else" }, { id: "mine", name: "prototype-r2-signing" }], result_info: { total_pages: 1 } },
      "POST /accounts/a/tokens": { success: true, result: { id: "new-sign", name: "prototype-r2-signing", value: "v" } },
    };
    const api = guardTokenWrites(async (method, path) => (sent.push(`${method} ${path}`), { status: 200, body: replies[`${method} ${path}`] ?? { success: true, result: {} } }), { protectedIds: new Set(), userTokenId: "mine" });
    await expect(api("DELETE", "/accounts/a/tokens/old-sign")).rejects.toThrow(/setup refused to delete/);
    await api("GET", "/accounts/a/tokens?per_page=50&page=1");
    await api("POST", "/accounts/a/tokens", { name: "prototype-r2-signing" });
    await api("DELETE", "/accounts/a/tokens/OLD-SIGN");
    await api("DELETE", "/accounts/a/tokens/new-sign");
    for (const path of ["/accounts/a/tokens/other", "/accounts/a/tokens/mine"]) await expect(api("DELETE", path), path).rejects.toThrow(/setup refused to delete/);
    expect(sent).toEqual(["GET /accounts/a/tokens?per_page=50&page=1", "POST /accounts/a/tokens", "DELETE /accounts/a/tokens/OLD-SIGN", "DELETE /accounts/a/tokens/new-sign"]);
  });

  it("hands every token ID a token list or create answer names to the run's redaction (SETUP-REQ-007)", async () => {
    const seen: string[] = [];
    const replies: Record<string, unknown> = {
      "GET /accounts/a/tokens?per_page=50&page=1": { success: true, result: [{ id: "old-sign", name: "prototype-r2-signing" }, { id: "other", name: "someone-else" }] },
      "POST /accounts/a/tokens": { success: true, result: { id: "new-sign", value: "v" } },
    };
    const api = guardTokenWrites(async (method, path) => ({ status: 200, body: replies[`${method} ${path}`] ?? { success: true, result: [{ id: "not-a-token" }] } }), { protectedIds: new Set(), onTokenId: (id) => seen.push(id) });
    await api("GET", "/accounts/a/tokens?per_page=50&page=1");
    await api("POST", "/accounts/a/tokens", { name: "prototype-r2-signing" });
    await api("GET", "/accounts/a/workers/scripts");
    expect(seen).toEqual(["old-sign", "other", "new-sign"]);
  });

  it("cannot be bypassed by a query string, slashes, encodings, dot segments, backslashes, control characters or case (DEC-0613)", async () => {
    const { sent, api } = recorder();
    for (const [method, path] of [
      ["DELETE", "/accounts/a/tokens/mine?force=1"],
      ["DELETE", "/accounts/a/tokens/mine/"],
      ["DELETE", "//accounts/a/tokens/mine"],
      ["DELETE", "/accounts/a/tokens/%6Dine"],
      ["DELETE", "/accounts/a/x/../tokens/mine"],
      ["DELETE", "/accounts/a/tokens/x/../mine"],
      ["DELETE", "/accounts/a/tokens\\mine"],
      ["DELETE", "/accounts\\a\\tokens\\mine"],
      ["DELETE", "/accounts/a/tok\tens/mine"],
      ["DELETE", "/accounts/a/tokens/mi\nne"],
      ["DELETE", "/user/./tokens/mine"],
      ["DELETE", "/accounts/a/%74okens/mine"],
      ["DELETE", "/accounts/a/tokens/x/%2e%2e/mine"],
      ["DELETE", "/accounts/a/tokens%2Fmine"],
      ["DELETE", "/accounts/a/tokens/%256Dine"],
      ["DELETE", "/../../accounts/a/tokens/mine"],
      ["DELETE", "/accounts/a/tokens/mine#x"],
      ["DELETE", "/accounts/a/tokens/MINE"],
      ["DELETE", "/accounts/a/TOKENS/mine"],
      ["DELETE", "/USER/tokens/mine"],
      ["PUT", "/accounts/a/tokens/mine/./value"],
      ["PUT", "/accounts/a/tokens/mine%2Fvalue"],
      ["POST", "/user/tokens/x/%2e%2e/mine/value"],
      ["DELETE", "/accounts/a/tokens/owner?x=1"],
      ["PUT", "/accounts/a/tokens/./owner"],
    ] as const) {
      await expect(api(method, path), JSON.stringify(`${method} ${path}`)).rejects.toThrow(/setup refused to/);
    }
    expect(sent).toEqual([]);
    // Creating a token (the signing step) and reading are not writes of an ID.
    await api("POST", "/accounts/a/tokens", {});
    await api("GET", "/accounts/a/tokens/mine?x=1");
    expect(sent).toEqual(["POST /accounts/a/tokens", "GET /accounts/a/tokens/mine?x=1"]);
  });

  it("a whole run with the user's token protected by PAR-361 and with the env setting: completes, and no token write names it", async () => {
    const world = freshWorld();
    world.addToken("token", TOKEN_VALUE, TOKEN_ID);
    const { status } = await run(world, project(), { home: home(credential()), env: { PROTOTYPE_FRAMEWORK_PROTECTED_TOKEN_IDS: TOKEN_ID }, protectedTokenIds: [TOKEN_ID] });
    expect(status).toBe(0);
    expect(world.requests.filter((r) => r.includes(`/tokens/${TOKEN_ID}`) && !/ GET /.test(r))).toEqual([]);
  });
});

describe("cloudflare-setup: local setup, git and the network (plan §4.3 steps 0, 1, 8)", () => {
  it("runs the local setup first when it is missing: local secrets set before anything else", async () => {
    const world = await setUpWorld();
    const dir = project();
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "app" }));
    const { status, io } = await run(world, dir, {
      home: home(credential()),
      localSetup: (d, o) => runLocalSetup(d, { ...o, npmInstall: async () => {}, declaredSecrets: async () => ["apiKey"], random: (n) => new Uint8Array(n).fill(7) }),
    });
    expect(status).toBe(0);
    expect(io.out.indexOf("local setup (local-secrets): set a random local value")).toBe(0);
    expect(io.out.indexOf("local setup")).toBeLessThan(io.out.indexOf("account: Main account"));
    expect(Object.keys(readDevVars(readFileSync(join(dir, ".dev.vars"), "utf8")))).toContain("SECRET_API_KEY");
  });

  it("adds .env.cloudflare to .gitignore when missing (an old file must never be committed)", async () => {
    const world = await setUpWorld();
    const dir = project({ gitignore: "node_modules/\n" });
    const { status, io } = await run(world, dir, { home: home(credential()) });
    expect(status).toBe(0);
    expect(io.out).toContain("local setup (gitignore): added .env.cloudflare to .gitignore");
    expect(readFileSync(join(dir, ".gitignore"), "utf8")).toContain("\n.env.cloudflare\n");
  });

  it("git warnings are prominent and never fail: not a repository, and an old tracked .env.cloudflare", async () => {
    const world = await setUpWorld();
    const notRepo = await run(world, project({ repo: false }), { home: home(credential()) });
    expect(notRepo.status).toBe(0);
    expect(notRepo.io.err).toMatch(/={78}\ncloudflare-setup: WARNING: This project is not a git repository/);
    expect(notRepo.io.out).not.toContain("WARNING: not-a-repo");

    const dir = project({ gitignore: "" });
    writeFileSync(join(dir, ".env.cloudflare"), "CLOUDFLARE_API_TOKEN=\n");
    execFileSync("git", ["add", "-f", ".env.cloudflare"], { cwd: dir, stdio: "ignore" });
    const tracked = await run(world, dir, { home: home(credential()) });
    expect(tracked.status).toBe(0);
    expect(tracked.io.err).toContain("cloudflare-setup: WARNING: .env.cloudflare is tracked by git");
  });

  it("a blocked host is named by its kind (never the subdomain) with where to change the network policy; exit 1", async () => {
    const world = await setUpWorld();
    const { status, io } = await run(world, project(), { home: home(credential()), reach: async (url) => (url.includes(".workers.dev") ? Promise.reject(new Error("blocked")) : undefined) });
    expect(status).toBe(1);
    expect(io.out).toContain("This environment cannot reach the account's workers.dev subdomain (<subdomain>.workers.dev), which deploy needs.");
    expect(io.out).toContain("Network access");
  });

  it("a stop of the request layer (a budget used up, a 429) ends the run instead of counting as a blocked host or unreadable setup (DEC-0619)", async () => {
    const world = await setUpWorld();
    const urls: string[] = [];
    const stopped = await run(world, project(), {
      home: home(credential()),
      reach: async (url) => {
        urls.push(url);
        throw new CloudflareRequestsStopped("live pass stopped: HTTP 429 on GET (rate limited)");
      },
    });
    expect(stopped.status).toBe(1);
    expect(urls).toHaveLength(1);
    expect(stopped.io.err).toContain("cloudflare-setup failed: live pass stopped: HTTP 429 on GET (rate limited)");
    expect(stopped.io.out).not.toContain("cannot reach");

    // While the setup record is read: the stop, never a run of the account setup.
    let stop = false;
    const apiFor = (value: string) => {
      const api = world.apiFor(value);
      return async (method: Parameters<typeof api>[0], path: string, body?: unknown) => {
        if (stop || path.includes("/objects/")) {
          stop = true;
          throw new CloudflareRequestsStopped("the pass budget is used");
        }
        return api(method, path, body);
      };
    };
    world.requests.length = 0;
    const r = await run(world, project(), { home: home(credential()), apiFor });
    expect(r.status).toBe(1);
    expect(r.io.err).toContain("cloudflare-setup failed: the pass budget is used");
    expect(r.reached).toEqual([]);
    expect(world.writes()).toEqual([]);
  });

  it("a failure whose message holds the account ID or the token is printed with them hidden (the redaction backstop)", async () => {
    const world = await setUpWorld();
    const io = captureIo(project());
    const apiFor = (value: string) => {
      const api = world.apiFor(value);
      return async (method: Parameters<typeof api>[0], path: string, body?: unknown) => {
        if (path.endsWith("/tokens/verify")) throw new Error(`Cloudflare API request GET ${path} with ${value} got no response`);
        return api(method, path, body);
      };
    };
    const status = await cloudflareSetupCommand({ env: {}, home: home(credential()), apiFor, reach: async () => {}, localSetup: fakeLocalSetup })([], io);
    expect(status).toBe(1);
    expect(io.err).toContain("cloudflare-setup failed: Cloudflare API request GET /accounts/[hidden]/tokens/verify with [hidden] got no response");
    expect(io.out + io.err).not.toContain(ACCOUNT);
    expect(io.out + io.err).not.toContain("MARKER");
  });

  it("behind a proxy without NODE_USE_ENV_PROXY=1: the local setup and the no-credential text still run; with a credential it stops before any request", async () => {
    const proxied = { HTTPS_PROXY: "http://proxy.invalid:3128" };
    const world = await setUpWorld();
    const none = await run(world, project(), { env: proxied });
    expect(none.status).toBe(1);
    expect(none.io.out).toContain("No Cloudflare credential was found.");
    const given = await run(world, project(), { env: proxied, home: home(credential()) });
    expect(given.status).toBe(1);
    expect(given.io.err).toContain("cloudflare-setup failed: HTTPS_PROXY is set, but this process was not started with NODE_USE_ENV_PROXY=1");
    expect(world.requests).toEqual([]);
  });
});

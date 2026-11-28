/**
 * SETUP-AC-001…SETUP-AC-010 (docs/components/setup.md §4, rewritten for the one credential,
 * DEC-0795…DEC-0800; Where: Local): the outcomes of `cloudflare-setup` against the fake Cloudflare
 * API with fake token values only and a temporary home directory (setup.md §4's preamble;
 * compliance.md §2 "Tokens the harness is given"). SETUP-AC-011 is the live milestone clause on a
 * real account and is not here.
 *
 * Expectations come from SETUP-REQ-001…007 and the parameters they name (PAR-343, PAR-361, PAR-436,
 * PAR-486, PAR-487), not from the command's code. The command is the framework CLI's own
 * (support/setup-runs.ts says what is injected). Every run's standard output, standard error and the
 * files it leaves are recorded; the last test (SETUP-AC-010) searches all of them for every fake
 * token value, token ID, account ID, zone ID and workers.dev subdomain.
 *
 * Readings of the criteria where they leave a choice (recorded here, not as decisions):
 * - "asks for nothing" (SETUP-AC-002): standard input is never read, and no link or next prompt is
 *   printed.
 * - "makes no Cloudflare write request": no request other than GET (a GraphQL query is a read).
 * - "no message about them" (SETUP-AC-004): the output holds no word about extra, broad or more
 *   permissions, and is the same as a run with exactly the list, line for line, but for nothing.
 * - "set off from the rest of the output" (SETUP-AC-009): a rule line (one mark repeated 10 times or
 *   more) above and below the warning's paragraph.
 * - "private" is the API's default, so the create request asks for nothing public (plan-v0.2.0
 *   §2.2), and "confidential" is a client authenticated with its secret (DEC-0750).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { tag } from "../../harness/index.js";
import { isLocal } from "../core/support/repo.js";
import { ACCOUNT_SETUP_VERSION, TOKEN } from "../../../../packages/framework/src/provision/cloudflare/permissions.js";
import { runLocalSetup } from "../../../../packages/framework/src/provision/core/local-setup.js";
import {
  ACCOUNT,
  addSecondAccount,
  addToken,
  credential,
  decodeLink,
  EVERYDAY_LINK,
  freshWorld,
  git,
  group,
  home,
  KEEP_TRACKED_MARKER,
  linesEqual,
  NEXT_PROMPT_PHRASE,
  project,
  PROTECTED_IDS_SETTING,
  removeProjects,
  RUNS,
  runSetup,
  SECOND_ACCOUNT,
  secretsFile,
  sensitiveHits,
  SERVER_ERROR,
  setOffByRules,
  setUpAccount,
  SUB,
  TEMPLATE_LINES,
  TOKEN_LINK,
  TOKEN_NAMES_LIST,
  tokenValue,
  tokenWritesOf,
  withReplies,
  writesOf,
  type RunResult,
  type SetupWorld,
  type TokenPolicy,
  type WorldToken,
} from "./support/setup-runs.js";

const RECORD_KEY = "sst-state/framework/account.json";
const ADMIN_URL = `https://prototype-admin.${SUB}.workers.dev`;

/** A set-up account with the user's token (`label`) and a home whose secrets file holds it. */
async function setUp(label: string, groups?: Parameters<typeof addToken>[3]): Promise<{ world: SetupWorld; token: WorldToken; homeDir: string }> {
  const world = freshWorld();
  await setUpAccount(world);
  const token = addToken(world, label, ACCOUNT, groups);
  return { world, token, homeDir: home(credential(token.value)) };
}

/** A stop's shape: exit 1, no write request, no token updated, rolled or deleted. */
function expectStopWithoutChange(r: RunResult, world: SetupWorld): void {
  expect(r.status, r.all).toBe(1);
  expect(writesOf(r.requests), "write requests").toEqual([]);
  expect(tokenWritesOf(r.requests), "token writes").toEqual([]);
  expect(world.tokens.filter((t) => t.deleted).map((t) => t.name), "deleted tokens").toEqual([]);
}

/** The token link on a line of its own. */
const hasLink = (r: RunResult): boolean => linesEqual(r.out, TOKEN_LINK) === 1;

if (isLocal()) {
  afterAll(() => removeProjects());

  describe("SETUP: no credential (SETUP-AC-001)", () => {
    it(tag("SETUP-AC-001", "with no credential anywhere: the two template lines exactly, the resolved secrets file path, environment variables, the token link exactly as deepLink builds it, where the account ID is, continue prototype setup; nothing about a bootstrap or everyday token; no file written, no request, exit 1"), async () => {
      const world = freshWorld();
      const dir = await project();
      const homeDir = home();
      const r = await runSetup("AC-001 no credential", world, dir, { home: homeDir });
      expect(r.status, r.all).toBe(1);
      const lines = r.out.split("\n");
      const at = lines.indexOf(TEMPLATE_LINES[0]);
      expect(at, `the template:\n${r.out}`).toBeGreaterThan(-1);
      expect(lines.slice(at, at + 2)).toEqual([...TEMPLATE_LINES]);
      expect(r.out).toContain(secretsFile(homeDir));
      expect(r.out).toMatch(/Environment variables/);
      expect(hasLink(r), `the token link on its own line:\n${r.out}`).toBe(true);
      expect(r.out).not.toContain(EVERYDAY_LINK);
      expect(r.out).toMatch(/account ID/i);
      expect(r.out).toContain(NEXT_PROMPT_PHRASE);
      expect(r.all).not.toMatch(/bootstrap|everyday/i);
      expect(r.requests, "no Cloudflare request").toEqual([]);
      expect(r.stdinReads).toBe(0);
      expect(existsSync(join(dir, ".env.cloudflare")), "no .env.cloudflare").toBe(false);
      expect(readdirSync(homeDir), "no secrets file").toEqual([]);
    });

    it(tag("SETUP-AC-001", "the token link pre-fills exactly TOKEN's six groups and the name prototype-framework-cli"), () => {
      const decoded = decodeLink(TOKEN_LINK, TOKEN);
      expect(decoded.unknownKeys).toEqual([]);
      expect(decoded.names).toEqual(TOKEN_NAMES_LIST);
      expect(decoded.tokenName).toBe("prototype-framework-cli");
    });

    it(tag("SETUP-AC-001", "with CLOUDFLARE_SECRETS_FILE set, that path is the one printed"), async () => {
      const homeDir = home();
      const r = await runSetup("AC-001 override path", freshWorld(), await project(), { home: homeDir, env: { CLOUDFLARE_SECRETS_FILE: "~/elsewhere/cloudflare.env" } });
      expect(r.status).toBe(1);
      expect(r.out).toContain(join(homeDir, "elsewhere", "cloudflare.env"));
    });

    it(tag("SETUP-AC-001", "only one of the two settings set: names the missing one, with the template and the link; no request; exit 1"), async () => {
      const world = freshWorld();
      const t = addToken(world, "ac001one");
      const onlyToken = await runSetup("AC-001 only the token", world, await project(), { env: { CLOUDFLARE_API_TOKEN: t.value } });
      expect(onlyToken.status).toBe(1);
      expect(onlyToken.out).toContain("CLOUDFLARE_ACCOUNT_ID is not set");
      expect(onlyToken.out.split("\n").filter((l) => (TEMPLATE_LINES as readonly string[]).includes(l))).toEqual([...TEMPLATE_LINES]);
      expect(hasLink(onlyToken)).toBe(true);
      const onlyAccount = await runSetup("AC-001 only the account", world, await project(), { home: home(`CLOUDFLARE_ACCOUNT_ID=${ACCOUNT}\n`) });
      expect(onlyAccount.status).toBe(1);
      expect(onlyAccount.out).toContain("CLOUDFLARE_API_TOKEN is not set");
      expect([...onlyToken.requests, ...onlyAccount.requests]).toEqual([]);
    });
  });

  describe("SETUP: everything current (SETUP-AC-002)", () => {
    it(tag("SETUP-AC-002", "a valid token with every permission and a current setup record: already set up, asks for nothing, no write request, the secrets file byte for byte, each source named by path and no value, exit 0"), async () => {
      const { world, token, homeDir } = await setUp("ac002");
      const before = readFileSync(secretsFile(homeDir), "utf8");
      const r = await runSetup("AC-002 current", world, await project(), { home: homeDir });
      expect(r.status, r.all).toBe(0);
      expect(r.out).toMatch(/already set up/i);
      expect(r.stdinReads).toBe(0);
      expect(r.all).not.toContain(TOKEN_LINK);
      expect(r.all).not.toContain(NEXT_PROMPT_PHRASE);
      expect(writesOf(r.requests)).toEqual([]);
      expect(readFileSync(secretsFile(homeDir), "utf8")).toBe(before);
      expect(r.out).toContain(`CLOUDFLARE_API_TOKEN: from the file ${secretsFile(homeDir)}`);
      expect(r.out).toContain(`CLOUDFLARE_ACCOUNT_ID: from the file ${secretsFile(homeDir)}`);
      expect(r.all).not.toContain(token.value);
    });

    it(tag("SETUP-AC-002", "the same with the values in the environment only: no file is created, no write request, each source named by variable, exit 0"), async () => {
      const { world, token } = await setUp("ac002env");
      const homeDir = home();
      const dir = await project();
      const r = await runSetup("AC-002 environment only", world, dir, { home: homeDir, env: { CLOUDFLARE_API_TOKEN: token.value, CLOUDFLARE_ACCOUNT_ID: ACCOUNT } });
      expect(r.status, r.all).toBe(0);
      expect(r.out).toContain("CLOUDFLARE_API_TOKEN: from the environment variable CLOUDFLARE_API_TOKEN");
      expect(r.out).toContain("CLOUDFLARE_ACCOUNT_ID: from the environment variable CLOUDFLARE_ACCOUNT_ID");
      expect(writesOf(r.requests)).toEqual([]);
      expect(readdirSync(homeDir)).toEqual([]);
      expect(existsSync(join(dir, ".env.cloudflare"))).toBe(false);
    });
  });

  describe("SETUP: bad credential (SETUP-AC-003)", () => {
    it(tag("SETUP-AC-003", "a value that is not a token: names CLOUDFLARE_API_TOKEN, where it came from and that Cloudflare does not accept it; the token link; exit 1, nothing written"), async () => {
      const { world } = await setUp("ac003bad");
      const homeDir = home(credential(tokenValue("not-a-real-token")));
      const r = await runSetup("AC-003 not a token", world, await project(), { home: homeDir });
      expectStopWithoutChange(r, world);
      expect(r.out).toContain(`CLOUDFLARE_API_TOKEN (from the file ${secretsFile(homeDir)})`);
      expect(r.out).toMatch(/does not accept it/);
      expect(hasLink(r)).toBe(true);
    });

    it(tag("SETUP-AC-003", "a token that is not active: names the setting and that it is not active; the token link; exit 1, nothing written"), async () => {
      const { world, token, homeDir } = await setUp("ac003inactive");
      token.status = "disabled";
      const r = await runSetup("AC-003 not active", world, await project(), { home: homeDir });
      expectStopWithoutChange(r, world);
      expect(r.out).toMatch(/CLOUDFLARE_API_TOKEN .*not active/);
      expect(hasLink(r)).toBe(true);
    });

    it(tag("SETUP-AC-003", "a CLOUDFLARE_ACCOUNT_ID the token cannot see: the accounts it sees by name only, the token link; exit 1, nothing written, nothing sent to that account"), async () => {
      const { world, token } = await setUp("ac003account");
      addSecondAccount(world);
      const r = await runSetup("AC-003 another account", world, await project(), { home: home(credential(token.value, SECOND_ACCOUNT)) });
      expectStopWithoutChange(r, world);
      expect(r.out).toContain("CLOUDFLARE_ACCOUNT_ID");
      expect(r.out).toContain("Main account");
      expect(r.out).not.toContain("Second account");
      expect(hasLink(r)).toBe(true);
      expect(r.requests.filter((q) => q.includes(SECOND_ACCOUNT))).toEqual([]);
    });
  });

  describe("SETUP: the token's permissions (SETUP-AC-004)", () => {
    it(tag("SETUP-AC-004", "lacking one permission: exactly that one by its dashboard name, the token link; nothing changed; exit 1"), async () => {
      const { world, homeDir } = await setUp("ac004one", TOKEN.filter((g) => g.name !== "OAuth Client Write"));
      const r = await runSetup("AC-004 one missing", world, await project(), { home: homeDir });
      expectStopWithoutChange(r, world);
      expect(r.out).toContain("OAuth Client Edit");
      for (const other of TOKEN.filter((g) => g.name !== "OAuth Client Write")) expect(r.out, other.name).not.toContain(other.name.replace(/ Write$/, " Edit"));
      expect(hasLink(r)).toBe(true);
    });

    it(tag("SETUP-AC-004", "lacking several: exactly those by their dashboard names; nothing changed; exit 1"), async () => {
      const missing = ["Workers R2 Storage Write", "D1 Write", "Secrets Store Write"];
      const { world, homeDir } = await setUp("ac004many", TOKEN.filter((g) => !missing.includes(g.name)));
      const r = await runSetup("AC-004 several missing", world, await project(), { home: homeDir });
      expectStopWithoutChange(r, world);
      for (const name of missing) expect(r.out, name).toContain(name.replace(/ Write$/, " Edit"));
      expect(r.out).not.toContain("Workers Scripts Edit");
      expect(r.out).not.toContain("OAuth Client Edit");
    });

    it(tag("SETUP-AC-004", "a permission taken away by a deny policy is named as missing"), async () => {
      const { world, token, homeDir } = await setUp("ac004deny");
      const d1 = group("D1 Write");
      token.policies = [...token.policies, { effect: "deny", resources: { [`com.cloudflare.api.account.${ACCOUNT}`]: "*" }, permission_groups: [{ id: d1.id }] } as TokenPolicy];
      const r = await runSetup("AC-004 deny", world, await project(), { home: homeDir });
      expectStopWithoutChange(r, world);
      expect(r.out).toContain("D1 Edit");
    });

    it(tag("SETUP-AC-004", "a token that cannot read its own permissions: Account API Tokens Edit named, the others not checked, the token link; exit 1"), async () => {
      const { world, homeDir } = await setUp("ac004self", TOKEN.filter((g) => g.name !== "Account API Tokens Write"));
      const r = await runSetup("AC-004 cannot read itself", world, await project(), { home: homeDir });
      expectStopWithoutChange(r, world);
      expect(r.out).toContain("Account API Tokens Edit");
      expect(r.out).toMatch(/could not check its other permissions/);
      expect(hasLink(r)).toBe(true);
    });

    it(tag("SETUP-AC-004", "a token with more permissions than the list (other account groups, zone groups): passes with no message about them"), async () => {
      const exact = await setUp("ac004exact");
      const r0 = await runSetup("AC-004 exactly the list", exact.world, await project(), { home: exact.homeDir });
      const { world, token, homeDir } = await setUp("ac004more");
      token.policies = [
        ...token.policies,
        { effect: "allow", resources: { [`com.cloudflare.api.account.${ACCOUNT}`]: "*" }, permission_groups: [group("Secrets Store Read"), { id: "c1e5f0d4c36d4b41a3bd0c4fa9e2f25e", name: "Billing Read" }] },
        { effect: "allow", resources: { [`com.cloudflare.api.account.${ACCOUNT}`]: { "com.cloudflare.api.account.zone.*": "*" } }, permission_groups: [{ id: "c8fed203ed3043cba015a93ad1616f1f", name: "Zone Read" }] },
      ];
      const r = await runSetup("AC-004 more than the list", world, await project(), { home: homeDir });
      expect(r.status, r.all).toBe(0);
      expect(r.all).not.toMatch(/extra|broad|more permissions|more than|too many|unneeded|not needed/i);
      expect(r.out.split("\n").length, "the same number of lines as a run with exactly the list").toBe(r0.out.split("\n").length);
    });
  });

  describe("SETUP: one run sets up a new account; the user's token is never changed (SETUP-AC-005)", () => {
    it(tag("SETUP-AC-005", "a new account: both OAuth clients as specified with their IDs and secrets in Secrets Store under PAR-436's names, the admin app, the auth app and its D1 database, the shared buckets, the signing credential, the setup record; the next step; exit 0; a second run changes nothing; the user's token never updated, rolled or deleted"), async () => {
      const world = freshWorld();
      const t = addToken(world, "ac005");
      const policies = JSON.stringify(t.policies);
      const homeDir = home(credential(t.value));
      const r = await runSetup("AC-005 new account", world, await project(), { home: homeDir });
      expect(r.status, r.all).toBe(0);
      const cloud = world.cloud();
      const clients = [...cloud.oauthClients.values()];
      expect(clients).toHaveLength(2);
      const admin = clients.find((c) => (c.body.optional_scopes as unknown[] | undefined)?.length);
      const signIn = clients.find((c) => c !== admin);
      expect([...((admin?.body.optional_scopes as string[]) ?? [])].sort()).toEqual(["account-api-tokens.write", "d1.write", "secrets-store.read", "secrets-store.write", "workers-r2.write", "workers-scripts.write"]);
      expect(signIn?.body.optional_scopes ?? []).toEqual([]);
      for (const c of clients) {
        expect(c.body.response_types, c.name).toEqual(["code", "id_token"]);
        expect([...(c.body.scopes as string[])].sort(), c.name).toEqual(["memberships.read", "user-details.read"]);
        expect(c.body.token_endpoint_auth_method ?? "none", `${c.name} is confidential`).not.toBe("none");
        expect(Object.entries(c.body).filter(([k, v]) => /public|visibility/i.test(k) && v !== false && v !== "private"), `${c.name} is private`).toEqual([]);
      }
      const stored = Object.fromEntries([...cloud.secretStores.values()].flatMap((s) => [...s.secrets].map(([k, v]) => [k, v.value] as const)));
      expect(stored).toMatchObject({ PROTOTYPE_ADMIN_CLIENT_ID: admin?.id, PROTOTYPE_ADMIN_CLIENT_SECRET: admin?.secret, PROTOTYPE_SIGNIN_CLIENT_ID: signIn?.id, PROTOTYPE_SIGNIN_CLIENT_SECRET: signIn?.secret });
      expect(cloud.workers.has("prototype-admin"), "the admin app").toBe(true);
      expect(cloud.workers.has("prototype-auth"), "the auth app").toBe(true);
      expect(cloud.d1Databases.map((d) => d.name), "the auth app's database").toContain("prototype-auth");
      expect(cloud.buckets.size, "the shared buckets").toBeGreaterThanOrEqual(3);
      expect([...cloud.tokens.values()].map((x) => x.name), "the signing token setup minted").toContain("prototype-r2-signing");
      expect((cloud.objectBodies.get(RECORD_KEY) as { setupVersion?: number } | undefined)?.setupVersion, "the setup record").toBe(ACCOUNT_SETUP_VERSION);
      expect(r.out).toContain(ADMIN_URL);
      expect(r.out).toContain("npm run deploy -- --target cloudflare --stage test-");

      world.requests.length = 0;
      const again = await runSetup("AC-005 second run", world, await project(), { home: homeDir });
      expect(again.status, again.all).toBe(0);
      expect(writesOf(again.requests), "the second run's writes").toEqual([]);

      for (const q of [...r.requests, ...again.requests]) expect(q.toLowerCase().includes(`/tokens/${t.id.toLowerCase()}`) && !/ GET /.test(q), q).toBe(false);
      expect(tokenWritesOf(r.requests).filter((q) => !/ DELETE /.test(q)), "no token update or roll").toEqual([]);
      expect(t.deleted).toBe(false);
      expect(JSON.stringify(t.policies)).toBe(policies);
    });

    it(tag("SETUP-AC-005", "the only token deletions are of prototype-r2-signing tokens (an old one replaced); a token PAR-361 names, and any other token, is neither updated nor deleted"), async () => {
      const world = freshWorld();
      await setUpAccount(world);
      // An older setup record: the setup runs again and its signing step finds the old signing token.
      const rec = world.cloud().objectBodies.get(RECORD_KEY) as Record<string, unknown>;
      world.cloud().objectBodies.set(RECORD_KEY, { ...rec, setupVersion: 1 });
      world.cloud().tokens.set("unrelated", { name: "someone-else", resources: {} });
      const t = addToken(world, "ac005guard");
      const other = addToken(world, "ac005other");
      const r = await runSetup("AC-005 guard", world, await project(), { home: home(credential(t.value)), env: { [PROTECTED_IDS_SETTING]: `${t.id},${other.id}` } });
      expect(r.status, r.all).toBe(0);
      const deletions = r.requests.filter((q) => / DELETE \/accounts\/[^/]+\/tokens\//.test(q));
      // Each request line starts with the sending token's ID; the deleted ID is in the path.
      for (const q of deletions) expect(q.slice(q.indexOf(" DELETE "))).not.toMatch(new RegExp(`${t.id}|${other.id}|unrelated`, "i"));
      expect(world.cloud().tokens.has("unrelated")).toBe(true);
      expect(tokenWritesOf(r.requests).filter((q) => !/ DELETE /.test(q))).toEqual([]);
      expect([t.deleted, other.deleted]).toEqual([false, false]);
    });

    it(tag("SETUP-AC-005", "a step that fails stops the run with exit 1 and its cause; the user's token is untouched"), async () => {
      const world = freshWorld();
      const t = addToken(world, "ac005fail");
      const apiFor = withReplies(world, (method, path) => (method === "PUT" && path.endsWith("/workers/scripts/prototype-admin") ? SERVER_ERROR : undefined));
      const r = await runSetup("AC-005 failed step", world, await project(), { home: home(credential(t.value)), apiFor });
      expect(r.status, r.all).toBe(1);
      expect(r.err).toMatch(/admin app/);
      expect(tokenWritesOf(r.requests)).toEqual([]);
      expect(t.deleted).toBe(false);
    });
  });

  describe("SETUP: the credential's sources (SETUP-AC-006)", () => {
    it(tag("SETUP-AC-006", "the environment wins over the secrets file per setting: a differing token in the file is not used and a notice names the setting; the account comes from the file"), async () => {
      const { world, token } = await setUp("ac006env");
      const stale = tokenValue("ac006stale");
      const homeDir = home(credential(stale));
      const r = await runSetup("AC-006 environment wins", world, await project(), { home: homeDir, env: { CLOUDFLARE_API_TOKEN: token.value } });
      expect(r.status, r.all).toBe(0);
      expect(r.requests.filter((q) => q.startsWith("? ")), "requests with the file's token").toEqual([]);
      expect(r.err).toMatch(/CLOUDFLARE_API_TOKEN is set in both the environment and .* using the environment/);
      expect(r.out).toContain(`CLOUDFLARE_ACCOUNT_ID: from the file ${secretsFile(homeDir)}`);
    });

    it(tag("SETUP-AC-006", "CLOUDFLARE_SECRETS_FILE points at another file, which is read"), async () => {
      const { world, token } = await setUp("ac006path");
      // The file lives outside the run's home directory, whose default secrets file is absent.
      const elsewhere = secretsFile(home(credential(token.value)));
      const r = await runSetup("AC-006 override", world, await project(), { home: home(), env: { CLOUDFLARE_SECRETS_FILE: elsewhere } });
      expect(r.status, r.all).toBe(0);
      expect(r.out).toContain(`from the file ${elsewhere}`);
    });

    it.runIf(process.platform !== "win32")(tag("SETUP-AC-006", "a secrets file readable by group or others: a warning with chmod 600 and the path; the exit status is that of mode 600"), async () => {
      const { world, token } = await setUp("ac006mode");
      const statuses: number[] = [];
      for (const mode of [0o600, 0o644, 0o640]) {
        const homeDir = home(credential(token.value), mode);
        const r = await runSetup(`AC-006 mode ${mode.toString(8)}`, world, await project(), { home: homeDir });
        statuses.push(r.status);
        const warned = r.all.includes(`chmod 600 ${secretsFile(homeDir)}`);
        expect(warned, `mode ${mode.toString(8)}:\n${r.all}`).toBe(mode !== 0o600);
      }
      expect(statuses).toEqual([0, 0, 0]);
    });

    it(tag("SETUP-AC-006", "an old .env.cloudflare and CLOUDFLARE_BOOTSTRAP_TOKEN are not used, each with a notice"), async () => {
      const { world, token, homeDir } = await setUp("ac006old");
      const oldToken = addToken(world, "ac006oldtoken");
      const dir = await project({ oldEnvFile: `CLOUDFLARE_BOOTSTRAP_TOKEN=${oldToken.value}\nCLOUDFLARE_API_TOKEN=${oldToken.value}\n` });
      const r = await runSetup("AC-006 old file", world, dir, { home: homeDir, env: { CLOUDFLARE_BOOTSTRAP_TOKEN: oldToken.value } });
      expect(r.status, r.all).toBe(0);
      expect(r.err).toMatch(/\.env\.cloudflare.*no longer read/);
      expect(r.err).toMatch(/CLOUDFLARE_BOOTSTRAP_TOKEN is no longer used/);
      expect(r.requests.filter((q) => q.startsWith(`${oldToken.id} `)), "requests with the old token").toEqual([]);
      expect(r.requests.some((q) => q.startsWith(`${token.id} `))).toBe(true);
    });

    it(tag("SETUP-AC-006", "an argument (the removed --switch-account, or a pasted value) is a usage error that does not echo it"), async () => {
      const value = tokenValue("ac006arg");
      for (const arg of ["--switch-account", value]) {
        const failure = await runSetup("AC-006 argument", freshWorld(), await project(), { args: [arg] }).then(
          () => undefined,
          (e: unknown) => e as Error,
        );
        expect(failure?.message ?? "", arg).toMatch(/takes no arguments/);
        expect(failure?.message ?? "").not.toContain(value);
      }
    });
  });

  describe("SETUP: a second project on the same machine (SETUP-AC-007)", () => {
    it(tag("SETUP-AC-007", "a second project with no file of its own completes from the same secrets file with no write request"), async () => {
      const world = freshWorld();
      const t = addToken(world, "ac007");
      const homeDir = home(credential(t.value));
      const first = await runSetup("AC-007 first project", world, await project(), { home: homeDir });
      expect(first.status, first.all).toBe(0);
      const second = await project();
      const r = await runSetup("AC-007 second project", world, second, { home: homeDir });
      expect(r.status, r.all).toBe(0);
      expect(writesOf(r.requests)).toEqual([]);
      expect(existsSync(join(second, ".env.cloudflare"))).toBe(false);
    });
  });

  describe("SETUP: stops with their link or command (SETUP-AC-008)", () => {
    for (const [label, host] of [
      ["the API", /^api\.cloudflare\.com$/],
      ["R2's storage host", /\.r2\.cloudflarestorage\.com$/],
      ["the workers.dev subdomain", /\.workers\.dev$/],
    ] as const) {
      it(tag("SETUP-AC-008", `a blocked network host (${label}): named by kind, with the hosts to allow in the cloud environment's network access settings; exit 1`), async () => {
        const { world, homeDir } = await setUp(`ac008${label.replace(/\W/g, "")}`);
        const r = await runSetup(`AC-008 blocked ${label}`, world, await project(), { home: homeDir, blocked: (url) => host.test(new URL(url).hostname) });
        expect(r.status, r.all).toBe(1);
        expect(r.out).toMatch(/cannot reach/);
        expect(r.out).toMatch(/Network access/);
        for (const allow of ["api.cloudflare.com", "*.r2.cloudflarestorage.com", "*.workers.dev"]) expect(r.out).toContain(allow);
      });
    }

    it(tag("SETUP-AC-008", "on Workers Free and with no zone: the command does not stop for the plan or a domain, and completes"), async () => {
      const { world, homeDir } = await setUp("ac008free");
      world.accounts.get(ACCOUNT)!.plan = "free";
      world.cloud().zones.clear();
      const r = await runSetup("AC-008 free, no zone", world, await project(), { home: homeDir });
      expect(r.status, r.all).toBe(0);
      expect(r.all).not.toMatch(/Workers Paid|domain/i);
    });
  });

  describe("SETUP: local setup first, git warnings never fail (SETUP-AC-009)", () => {
    it(tag("SETUP-AC-009", "a project whose local setup is missing: local secrets set and the .gitignore line added before the credential is read"), async () => {
      const { world, homeDir } = await setUp("ac009local");
      const dir = await project({ localSetupDone: false, gitignore: "node_modules\n" });
      const r = await runSetup("AC-009 local setup", world, dir, {
        home: homeDir,
        localSetup: (d, o) => runLocalSetup(d, { ...o, declaredSecrets: async () => ["apiKey"], npmInstall: async () => undefined }),
      });
      expect(r.status, r.all).toBe(0);
      expect(readFileSync(join(dir, ".dev.vars"), "utf8")).toMatch(/^SECRET_API_KEY=\S+/m);
      expect(readFileSync(join(dir, ".gitignore"), "utf8").split("\n")).toContain(".env.cloudflare");
      expect(r.out.indexOf("local setup")).toBeLessThan(r.out.indexOf("CLOUDFLARE_API_TOKEN: from"));
    });

    it(tag("SETUP-AC-009", "outside a git repository, an old .env.cloudflare not ignored (with PAR-343's marker, the line not added), and one tracked: each warning set off from the output; every exit status that of the baseline"), async () => {
      const { world, homeDir } = await setUp("ac009git");
      const baseline = await runSetup("AC-009 baseline", world, await project(), { home: homeDir });
      expect(baseline.status, baseline.all).toBe(0);
      expect(baseline.err).not.toMatch(/WARNING/);

      const outside = await runSetup("AC-009 outside a repository", world, await project({ repo: false }), { home: homeDir });
      expect(outside.status).toBe(baseline.status);
      expect(setOffByRules(outside.err, /not a git repository/)).toBe(true);

      const marked = await project({ gitignore: `${KEEP_TRACKED_MARKER}\n`, oldEnvFile: "CLOUDFLARE_API_TOKEN=\n" });
      const notIgnored = await runSetup("AC-009 not ignored", world, marked, { home: homeDir });
      expect(notIgnored.status).toBe(baseline.status);
      expect(setOffByRules(notIgnored.err, /\.env\.cloudflare.*git does not ignore it/)).toBe(true);
      expect(readFileSync(join(marked, ".gitignore"), "utf8").split("\n")).not.toContain(".env.cloudflare");

      const trackedDir = await project({ gitignore: "", oldEnvFile: "CLOUDFLARE_API_TOKEN=\n" });
      git(trackedDir, ["add", "-f", ".env.cloudflare"]);
      git(trackedDir, ["commit", "-q", "-m", "tracked by mistake"]);
      const tracked = await runSetup("AC-009 tracked", world, trackedDir, { home: homeDir });
      expect(tracked.status).toBe(baseline.status);
      expect(setOffByRules(tracked.err, /\.env\.cloudflare is tracked by git/)).toBe(true);
      expect(tracked.err).toMatch(/history/);
      expect(tracked.err).toContain("git rm --cached .env.cloudflare");
    });

    it(tag("SETUP-AC-009", "a stop is not changed by the git conditions: with no credential, outside a repository, the exit status is 1 as in a repository"), async () => {
      const inRepo = await runSetup("AC-009 stop in a repository", freshWorld(), await project());
      const outside = await runSetup("AC-009 stop outside", freshWorld(), await project({ repo: false }));
      expect([inRepo.status, outside.status]).toEqual([1, 1]);
    });
  });

  describe("SETUP: no token value in any output (SETUP-AC-010)", () => {
    it(tag("SETUP-AC-010", "across every run above, no stdout, stderr or file the command left holds a fake token value, token ID, account ID, zone ID, OAuth client secret or workers.dev subdomain (but the admin app's URL)"), () => {
      expect(RUNS.length).toBeGreaterThan(20);
      expect(sensitiveHits()).toEqual([]);
    });

    it(tag("SETUP-AC-010", "the search itself finds a planted value (a self-check of the scan)"), () => {
      const planted = tokenValue("planted");
      expect(sensitiveHits([{ label: "planted", out: `x ${planted} y`, err: "", files: {} }])).toEqual(["planted: stdout holds token value planted"]);
    });
  });
} else {
  // Untagged, so never selected as evidence: keeps the file a valid suite on cloud runs.
  describe("SETUP: cloudflare-setup on the fake API (local only)", () => {
    it("has nothing to run on a cloud", () => undefined);
  });
}

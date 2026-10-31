/**
 * SETUP-AC-001…SETUP-AC-010 (docs/components/setup.md §4; Where: Local): the outcomes of
 * `cloudflare-setup`, the re-runnable Cloudflare setup, against the fake Cloudflare API with fake
 * token values only (setup.md §4's preamble; compliance.md §2 "Tokens the harness is given",
 * DEC-0604). SETUP-AC-011 is the live milestone clause on a real account and is not here.
 *
 * Expectations come from SETUP-REQ-001…007, plan-setup-wizard §3.2, §3.4 and §4.3, and the
 * parameters they name (PAR-340…343, PAR-361), not from the command's code. The command is the
 * framework CLI's own (support/setup-runs.ts says what is injected). Every run's standard output,
 * standard error and the project files it leaves are recorded; the last test (SETUP-AC-010)
 * searches all of them for every fake token value, token ID, account ID, zone ID and workers.dev
 * subdomain.
 *
 * Reading of the criteria where they leave a choice (recorded here, not as decisions):
 * - "asks for nothing" (SETUP-AC-002): standard input is never read, and no link or next prompt
 *   is printed.
 * - "makes no Cloudflare write request": no request other than GET (a GraphQL query is a read).
 * - "set off from the rest of the output" (SETUP-AC-009): a rule line (one mark repeated 10 times
 *   or more) above and below the warning's paragraph.
 * - the same token in both settings (SETUP-AC-003): either setting may be named, but the output
 *   must name one, say they are the same, and print that token's link only.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { tag } from "../../harness/index.js";
import { isLocal } from "../core/support/repo.js";
import { ACCOUNT_SETUP_VERSION, BOOTSTRAP, EVERYDAY } from "../../../../packages/framework/src/provision/cloudflare/permissions.js";
import { runLocalSetup } from "../../../../packages/framework/src/provision/core/local-setup.js";
import {
  ACCOUNT,
  addBootstrap,
  addSecondAccount,
  addTokens,
  BOOT_LINK,
  BOOTSTRAP_DELETED_LINE,
  BOOTSTRAP_NAMES,
  BOOTSTRAP_SETTING,
  decodeLink,
  DOMAIN,
  envFile,
  envFileExists,
  EVERYDAY_LINK,
  EVERYDAY_NAMES,
  EVERYDAY_SETTING,
  EXPIRES_TOO_LATE,
  freshWorld,
  git,
  group,
  KEEP_TRACKED_MARKER,
  linesEqual,
  NEXT_PROMPT_PHRASE,
  project,
  PROTECTED_IDS_SETTING,
  readEnvFile,
  removeProjects,
  RUNS,
  runSetup,
  SECOND_ACCOUNT,
  sensitiveHits,
  SERVER_ERROR,
  setOffByRules,
  setUpFirstProject,
  SUB,
  TEMPLATE_LINES,
  tokenId,
  tokenValue,
  tokenWritesOf,
  withReplies,
  writesOf,
  type RunOptions,
  type RunResult,
  type SetupWorld,
  type TokenPolicy,
  type WorldToken,
} from "./support/setup-runs.js";

const RECORD_KEY = "sst-state/framework/account.json";

/** Which token links an output holds. */
function links(text: string): { bootstrap: boolean; everyday: boolean } {
  return { bootstrap: text.includes(BOOT_LINK), everyday: text.includes(EVERYDAY_LINK) };
}

/** A bad paste's output: names the setting, holds only that token's link, exit 1, no token written. */
function expectBadPaste(r: RunResult, setting: string, what: RegExp, world: SetupWorld): void {
  expect(r.status, r.all).toBe(1);
  expect(r.all, "names the setting").toContain(setting);
  expect(r.all, "says what is wrong").toMatch(what);
  const expected = setting === BOOTSTRAP_SETTING ? { bootstrap: true, everyday: false } : { bootstrap: false, everyday: true };
  expect(links(r.all), `only ${setting}'s link:\n${r.all}`).toEqual(expected);
  expect(tokenWritesOf(r.requests), "token updates or deletions").toEqual([]);
  expect(world.tokens.filter((t) => t.deleted).map((t) => t.name), "deleted tokens").toEqual([]);
}

/** The project's state after a run: requests to the old account's fake since `from`. */
const requestsSince = (cloud: { requests: string[] }, from: number): string[] => cloud.requests.slice(from);

if (isLocal()) {
  afterAll(() => removeProjects());

  describe("SETUP: no tokens (SETUP-AC-001)", () => {
    it(tag("SETUP-AC-001", "with no tokens anywhere: both links exactly as deepLink builds them, the four template lines, where they go, the requirements and the next prompt; template written; no Cloudflare request; exit 1"), async () => {
      const world = freshWorld();
      const dir = await project();
      const r = await runSetup("AC-001 no tokens", world, dir);
      expect(r.status, r.all).toBe(1);
      expect(linesEqual(r.out, BOOT_LINK), `the bootstrap link on a line of its own:\n${r.out}`).toBe(1);
      expect(linesEqual(r.out, EVERYDAY_LINK), "the everyday link on a line of its own").toBe(1);
      const outLines = r.out.split("\n");
      const at = outLines.indexOf(TEMPLATE_LINES[0]);
      expect(at, "the template's first line").toBeGreaterThanOrEqual(0);
      expect(outLines.slice(at, at + TEMPLATE_LINES.length), "the template's four lines, in order").toEqual([...TEMPLATE_LINES]);
      // Plan §3.2: the domain requirement.
      expect(r.out).toMatch(/Cloudflare DNS/);
      // Where they go: a cloud session's environment settings, then a new session; on the command line the environment or the file.
      expect(r.out).toMatch(/cloud session/i);
      expect(r.out).toMatch(/Environment variables/);
      expect(r.out).toMatch(/new session/i);
      expect(r.out).toMatch(/command line/i);
      expect(r.out).toContain(".env.cloudflare");
      expect(r.out).toMatch(/environment/i);
      expect(r.out).toContain(NEXT_PROMPT_PHRASE);
      // The template is written when absent.
      expect(envFileExists(dir)).toBe(true);
      expect(readEnvFile(dir).split("\n").filter((l) => l !== ""), "the file holds the template").toEqual([...TEMPLATE_LINES]);
      expect(r.requests, "Cloudflare requests").toEqual([]);
    });

    it(tag("SETUP-AC-001", "the links pre-fill exactly the permission groups and token names (everyday 7 groups, plan §4.1; bootstrap 4, v0.2.0 plan §5.1)"), () => {
      const everyday = decodeLink(EVERYDAY_LINK, EVERYDAY);
      const bootstrap = decodeLink(BOOT_LINK, BOOTSTRAP);
      expect(everyday.unknownKeys).toEqual([]);
      expect(bootstrap.unknownKeys).toEqual([]);
      expect([...everyday.names].sort()).toEqual([...EVERYDAY_NAMES].sort());
      expect([...bootstrap.names].sort()).toEqual([...BOOTSTRAP_NAMES].sort());
      expect(everyday.tokenName).toBe("prototype-framework");
      expect(bootstrap.tokenName).toBe("prototype-framework-bootstrap");
      expect(new URL(EVERYDAY_LINK).origin).toBe("https://dash.cloudflare.com");
      expect(new URL(BOOT_LINK).origin).toBe("https://dash.cloudflare.com");
    });

    it(tag("SETUP-AC-001", "an existing .env.cloudflare (the template, values empty) is left as it is, and the same instructions print"), async () => {
      const world = freshWorld();
      const text = `${TEMPLATE_LINES.join("\n")}\n# my own note\n`;
      const dir = await project({ envFile: text });
      const r = await runSetup("AC-001 template present", world, dir);
      expect(r.status, r.all).toBe(1);
      expect(links(r.out)).toEqual({ bootstrap: true, everyday: true });
      expect(r.out).toContain(NEXT_PROMPT_PHRASE);
      expect(readEnvFile(dir)).toBe(text);
      expect(r.requests).toEqual([]);
    });
  });

  describe("SETUP: everything current (SETUP-AC-002)", () => {
    it(tag("SETUP-AC-002", "a valid everyday token, a current setup record and every permission: already set up, asks for nothing, no write request, .env.cloudflare byte for byte, plan not checked, exit 0"), async () => {
      const { world, dir } = await setUpFirstProject("ac002");
      const before = readEnvFile(dir);
      const record = world.cloud().objectBodies.get(RECORD_KEY) as { setupVersion?: number; emailDomain?: string } | undefined;
      expect(record?.setupVersion, "the first setup wrote the release's setup version").toBe(ACCOUNT_SETUP_VERSION);
      expect(record?.emailDomain).toBe(DOMAIN);
      const r = await runSetup("AC-002 current", world, dir);
      expect(r.status, r.all).toBe(0);
      expect(r.all).toMatch(/already set up|nothing to do/i);
      expect(r.stdinReads, "standard input reads").toBe(0);
      expect(links(r.all), "no link asks the user for a token").toEqual({ bootstrap: false, everyday: false });
      expect(r.all).not.toContain(NEXT_PROMPT_PHRASE);
      expect(writesOf(r.requests), "write requests").toEqual([]);
      expect(readEnvFile(dir), ".env.cloudflare unchanged").toBe(before);
    });

    it(tag("SETUP-AC-002", "the same with the values in the environment only: no .env.cloudflare is written, no write request, exit 0"), async () => {
      const { world, dir, tokens } = await setUpFirstProject("ac002env");
      const second = await project();
      const env = { [EVERYDAY_SETTING]: tokens.everyday.value, CLOUDFLARE_EMAIL_DOMAIN: DOMAIN, CLOUDFLARE_ACCOUNT_ID: ACCOUNT };
      expect(readEnvFile(dir)).toContain(BOOTSTRAP_DELETED_LINE);
      const r = await runSetup("AC-002 environment only", world, second, { env });
      expect(r.status, r.all).toBe(0);
      expect(r.stdinReads).toBe(0);
      expect(links(r.all)).toEqual({ bootstrap: false, everyday: false });
      expect(writesOf(r.requests)).toEqual([]);
      expect(envFileExists(second), `with every value in the environment, setup changes nothing: no .env.cloudflare is created:\n${r.all}`).toBe(false);
      expect(r.all).toMatch(/already set up|nothing to do/i);
    });
  });

  describe("SETUP: bad pastes (SETUP-AC-003)", () => {
    const both = (boot: string | undefined, everyday: string | undefined, extra: Record<string, string> = {}) =>
      envFile({ ...(boot === undefined ? {} : { [BOOTSTRAP_SETTING]: boot }), ...(everyday === undefined ? {} : { [EVERYDAY_SETTING]: everyday }), CLOUDFLARE_EMAIL_DOMAIN: DOMAIN, ...extra });

    it(tag("SETUP-AC-003", "a value that is not a token as the everyday token: names CLOUDFLARE_API_TOKEN, only the everyday link, exit 1, no token written"), async () => {
      const world = freshWorld();
      const t = addTokens(world, "ac003a");
      const dir = await project({ envFile: both(t.bootstrap.value, tokenValue("not-a-token")) });
      const r = await runSetup("AC-003 not a token (everyday)", world, dir);
      expectBadPaste(r, EVERYDAY_SETTING, /not accept|not a valid|invalid|not .*token/i, world);
    });

    it(tag("SETUP-AC-003", "a value that is not a token as the bootstrap token: names CLOUDFLARE_BOOTSTRAP_TOKEN, only the bootstrap link, exit 1, no token written"), async () => {
      const world = freshWorld();
      const t = addTokens(world, "ac003b");
      const dir = await project({ envFile: both(tokenValue("not-a-token-b"), t.everyday.value) });
      const r = await runSetup("AC-003 not a token (bootstrap)", world, dir);
      expectBadPaste(r, BOOTSTRAP_SETTING, /not accept|not a valid|invalid|not .*token/i, world);
    });

    it(tag("SETUP-AC-003", "an everyday token that is not active: names CLOUDFLARE_API_TOKEN and that it is not active, only the everyday link, exit 1"), async () => {
      const world = freshWorld();
      const t = addTokens(world, "ac003c");
      t.everyday.status = "disabled";
      const dir = await project({ envFile: both(t.bootstrap.value, t.everyday.value) });
      const r = await runSetup("AC-003 not active", world, dir);
      expectBadPaste(r, EVERYDAY_SETTING, /not active|disabled/i, world);
    });

    it(tag("SETUP-AC-003", "the same token in both settings: names a setting, says they are the same, prints only that token's link, exit 1"), async () => {
      const world = freshWorld();
      const t = addTokens(world, "ac003d");
      const dir = await project({ envFile: both(t.everyday.value, t.everyday.value) });
      const r = await runSetup("AC-003 same token", world, dir);
      expect(r.status, r.all).toBe(1);
      expect(r.all).toMatch(/same/i);
      const l = links(r.all);
      expect(l.bootstrap !== l.everyday, `exactly one token's link:\n${r.all}`).toBe(true);
      expect(r.all).toContain(l.bootstrap ? BOOTSTRAP_SETTING : EVERYDAY_SETTING);
      expect(tokenWritesOf(r.requests)).toEqual([]);
    });

    it(tag("SETUP-AC-003", "an everyday-shaped token pasted as the bootstrap token: names CLOUDFLARE_BOOTSTRAP_TOKEN, only the bootstrap link, exit 1"), async () => {
      const world = freshWorld();
      const t = addTokens(world, "ac003e");
      const wrong = world.addToken("everyday", tokenValue("ac003e-everyday-as-boot"), tokenId("ac003ex"));
      const dir = await project({ envFile: both(wrong.value, t.everyday.value) });
      const r = await runSetup("AC-003 everyday as bootstrap", world, dir);
      expectBadPaste(r, BOOTSTRAP_SETTING, /API tokens|Account API Tokens Write|everyday token/i, world);
    });

    it(tag("SETUP-AC-003", "a user token as the bootstrap token: names CLOUDFLARE_BOOTSTRAP_TOKEN and that it is a user token, only the bootstrap link, exit 1"), async () => {
      const world = freshWorld();
      const t = addTokens(world, "ac003f");
      const user = world.addUserToken(tokenValue("ac003f-user"), tokenId("ac003fu"), [ACCOUNT]);
      const dir = await project({ envFile: both(user.value, t.everyday.value) });
      const r = await runSetup("AC-003 user token as bootstrap", world, dir);
      expectBadPaste(r, BOOTSTRAP_SETTING, /user/i, world);
      expect(user.deleted, "the user token is not deleted").toBe(false);
    });

    it(tag("SETUP-AC-003", "a bootstrap token of another account than the everyday token's: names CLOUDFLARE_BOOTSTRAP_TOKEN and the account, only the bootstrap link, exit 1"), async () => {
      const world = freshWorld();
      addSecondAccount(world);
      const t = addTokens(world, "ac003g");
      const other = addBootstrap(world, "ac003g-other", SECOND_ACCOUNT);
      const dir = await project({ envFile: both(other.value, t.everyday.value) });
      const r = await runSetup("AC-003 bootstrap of another account", world, dir);
      expectBadPaste(r, BOOTSTRAP_SETTING, /account/i, world);
    });

    // Since v0.2.0 the bootstrap token neither reads nor changes the everyday token (plan §5.1,
    // §5.2 page 2; DEC-0682): the everyday token's own checks run without a bootstrap token.
    it(tag("SETUP-AC-003", "an everyday token scoped to another zone: names CLOUDFLARE_API_TOKEN and the zone, only the everyday link, exit 1, no token written"), async () => {
      const world = freshWorld();
      const otherZone = world.cloud().zones.get("one.example")?.id ?? "";
      const t = addTokens(world, "ac003h");
      t.everyday.policies = t.everyday.policies.map((p: TokenPolicy) =>
        p.permission_groups.some((g) => g.name === "Zone Read") ? { ...p, resources: { [`com.cloudflare.api.account.zone.${otherZone}`]: "*" } } : p,
      );
      const dir = await project({ envFile: both(undefined, t.everyday.value) });
      const r = await runSetup("AC-003 everyday scoped to another zone", world, dir);
      expectBadPaste(r, EVERYDAY_SETTING, /zone/i, world);
    });

    it(tag("SETUP-AC-003", "an everyday token with a permission denied: names CLOUDFLARE_API_TOKEN and the permission, and the admin app; exit 1, no token written"), async () => {
      const world = freshWorld();
      const t = addTokens(world, "ac003i");
      const d1 = group("D1 Write");
      t.everyday.policies = [...t.everyday.policies, { id: "deny-d1", effect: "deny", resources: { [`com.cloudflare.api.account.${ACCOUNT}`]: "*" }, permission_groups: [{ id: d1.id, name: d1.name }] }];
      const dir = await project({ envFile: both(undefined, t.everyday.value) });
      const r = await runSetup("AC-003 everyday with a deny", world, dir);
      expect(r.status, r.all).toBe(1);
      expect(r.all).toContain(EVERYDAY_SETTING);
      expect(r.all).toMatch(/D1 Write/);
      expect(r.all).toMatch(/admin app/);
      expect(tokenWritesOf(r.requests)).toEqual([]);
      expect(world.tokens.filter((x) => x.deleted)).toEqual([]);
    });
  });

  describe("SETUP: everyday token short of a permission (SETUP-AC-004)", () => {
    const REMOVED = "Email Routing Rules Read";
    const without = (t: WorldToken, name: string) => {
      t.policies = t.policies.map((p) => ({ ...p, permission_groups: p.permission_groups.filter((g) => g.name !== name) }));
    };

    it(tag("SETUP-AC-004", "lacking one permission and no bootstrap token: only the bootstrap link and the next prompt, nothing changed, exit 1"), async () => {
      const { world, dir, tokens } = await setUpFirstProject("ac004a");
      without(tokens.everyday, REMOVED);
      const before = readEnvFile(dir);
      const r = await runSetup("AC-004 short, no bootstrap", world, dir);
      expect(r.status, r.all).toBe(1);
      expect(links(r.all), r.all).toEqual({ bootstrap: true, everyday: false });
      expect(r.all).toContain(NEXT_PROMPT_PHRASE);
      expect(writesOf(r.requests)).toEqual([]);
      expect(readEnvFile(dir)).toBe(before);
    });

    it(tag("SETUP-AC-004", "with the bootstrap token: the everyday token is left as it is for the admin app (neither read nor updated, no new token), the bootstrap token is deleted (401) and its line reads exactly PAR-342"), async () => {
      const { world, dir, tokens } = await setUpFirstProject("ac004b");
      without(tokens.everyday, REMOVED);
      const before = JSON.stringify(tokens.everyday.policies);
      const boot = addBootstrap(world, "ac004b-second");
      writeFileSync(join(dir, ".env.cloudflare"), readEnvFile(dir).replace(BOOTSTRAP_DELETED_LINE, `${BOOTSTRAP_SETTING}=${boot.value}`));
      const tokensBefore = world.tokens.length;
      const r = await runSetup("AC-004 short, with bootstrap", world, dir);
      expect(r.status, r.all).toBe(0);
      expect(r.requests.filter((q) => q.includes(`/tokens/${tokens.everyday.id}`)), "the everyday token is not touched").toEqual([]);
      expect(JSON.stringify(tokens.everyday.policies)).toBe(before);
      expect(tokens.everyday.deleted).toBe(false);
      expect(r.requests.filter((q) => / POST \/accounts\/[^/]+\/tokens$/.test(q)), "no new token is made").toEqual([]);
      expect(world.tokens.length).toBe(tokensBefore);
      // The bootstrap token deleted itself.
      expect(boot.deleted, "the fake lists the bootstrap token no more").toBe(true);
      expect((await world.apiFor(boot.value)("GET", `/accounts/${ACCOUNT}/tokens/verify`)).status).toBe(401);
      const lines = readEnvFile(dir).split("\n");
      expect(lines.filter((l) => l.includes(BOOTSTRAP_SETTING)), "the bootstrap line").toEqual([BOOTSTRAP_DELETED_LINE]);
    });
  });

  describe("SETUP: the setup record and the bootstrap token (SETUP-AC-005)", () => {
    const withBootstrap = (dir: string, boot: WorldToken) =>
      writeFileSync(join(dir, ".env.cloudflare"), readEnvFile(dir).replace(BOOTSTRAP_DELETED_LINE, `${BOOTSTRAP_SETTING}=${boot.value}`));
    /** A bootstrap's writes once the OAuth clients exist: the admin app uploaded and routed again (plan §5.1 step 3; DEC-0686), then the self-delete. */
    const rerunWrites = (boot: WorldToken) => [
      `${boot.id} PUT /accounts/${ACCOUNT}/workers/scripts/prototype-admin`,
      `${boot.id} POST /accounts/${ACCOUNT}/workers/scripts/prototype-admin/subdomain`,
      `${boot.id} DELETE /accounts/${ACCOUNT}/tokens/${boot.id}`,
    ];

    // Since v0.2.0 the account setup is the admin app's (plan §5.2 page 1; DEC-0682): the bootstrap
    // token creates no setup resource and writes no setup record.
    it(tag("SETUP-AC-005", "a setup record from before the setup version: the bootstrap creates nothing and leaves the record as it is; the bootstrap token deleted"), async () => {
      const { world, dir } = await setUpFirstProject("ac005a");
      world.cloud().objectBodies.set(RECORD_KEY, { emailDomain: DOMAIN });
      const boot = addBootstrap(world, "ac005a-second");
      withBootstrap(dir, boot);
      const r = await runSetup("AC-005 older record", world, dir);
      expect(r.status, r.all).toBe(0);
      expect(writesOf(r.requests), "the admin app's upload and route, then the self-delete").toEqual(rerunWrites(boot));
      expect(world.cloud().objectBodies.get(RECORD_KEY)).toEqual({ emailDomain: DOMAIN });
      expect(boot.deleted).toBe(true);
    });

    it(tag("SETUP-AC-005", "one setup step missing (the log bucket): the bootstrap does not apply it; the next check names it and the admin app"), async () => {
      const { world, dir } = await setUpFirstProject("ac005b");
      world.cloud().buckets.delete("prototype-logs");
      const boot = addBootstrap(world, "ac005b-second");
      withBootstrap(dir, boot);
      const r = await runSetup("AC-005 one step missing", world, dir);
      expect(r.status, r.all).toBe(0);
      expect(world.cloud().buckets.has("prototype-logs"), "the bootstrap creates no bucket").toBe(false);
      expect(boot.deleted).toBe(true);
      const check = await runSetup("AC-005 one step missing, check", world, dir);
      expect(check.status, check.all).toBe(1);
      expect(check.all).toMatch(/missing: [^\n]*log-bucket/);
      expect(check.all).toMatch(/admin app/);
      expect(writesOf(check.requests)).toEqual([]);
    });

    it(tag("SETUP-AC-005", "a current setup and a still-valid bootstrap token: the everyday token is not read with it, the bootstrap token deletes itself, nothing else changes"), async () => {
      const { world, dir, tokens } = await setUpFirstProject("ac005c");
      const boot = addBootstrap(world, "ac005c-second");
      withBootstrap(dir, boot);
      const r = await runSetup("AC-005 current with bootstrap", world, dir);
      expect(r.status, r.all).toBe(0);
      expect(r.requests.filter((q) => q.endsWith(`/tokens/${tokens.everyday.id}`)), "the everyday token's permissions").toEqual([]);
      expect(writesOf(r.requests), "the admin app's upload and route, then the self-delete").toEqual(rerunWrites(boot));
      expect(boot.deleted).toBe(true);
      expect(readEnvFile(dir)).toContain(BOOTSTRAP_DELETED_LINE);
      // Plan §5.1 step 5: the admin app's URL and the next step, last.
      expect(r.out.trimEnd()).toMatch(/Next step: open the admin app and sign in: https:\/\/prototype-admin\.[a-z0-9-]+\.workers\.dev$/);
    });

    it(tag("SETUP-AC-005", "a bootstrap token without an expiry, or one more than 1 day away, is deleted at once and used for nothing else, exit 1; one within 1 day runs (PAR-435)"), async () => {
      for (const [label, expires] of [["noexp", null], ["late", EXPIRES_TOO_LATE]] as const) {
        const a = await setUpFirstProject(`ac005d-${label}`);
        const long = addBootstrap(a.world, `ac005d-${label}-second`, ACCOUNT, expires);
        withBootstrap(a.dir, long);
        const r = await runSetup(`AC-005 bootstrap ${label}`, a.world, a.dir);
        expect(r.status, r.all).toBe(1);
        expect(long.deleted, "deleted at once").toBe(true);
        expect(writesOf(r.requests), "the only write is the self-delete").toEqual([`${long.id} DELETE /accounts/${ACCOUNT}/tokens/${long.id}`]);
        expect(r.requests.at(-1), "nothing after the DELETE").toBe(`${long.id} DELETE /accounts/${ACCOUNT}/tokens/${long.id}`);
        expect(r.all).toMatch(/1 day/);
        expect(links(r.all)).toEqual({ bootstrap: true, everyday: false });
        expect(readEnvFile(a.dir).split("\n").filter((l) => l.includes(BOOTSTRAP_SETTING))).toEqual([BOOTSTRAP_DELETED_LINE]);
      }
      const b = await setUpFirstProject("ac005d2");
      const withExpiry = addBootstrap(b.world, "ac005d2-exp");
      withBootstrap(b.dir, withExpiry);
      const s = await runSetup("AC-005 with expiry", b.world, b.dir);
      expect(s.status, s.all).toBe(0);
      expect(s.all, "no expiry complaint for a token within 1 day").not.toMatch(/no expiry|more than 1 day/i);
    });

    it(tag("SETUP-AC-005", "a bootstrap that stops before its end (the token lacks a permission): the bootstrap token is not deleted and its line is kept, exit 1"), async () => {
      const { world, dir } = await setUpFirstProject("ac005e");
      const boot = addBootstrap(world, "ac005e-second");
      boot.policies = boot.policies.map((p) => ({ ...p, permission_groups: p.permission_groups.filter((g) => g.name !== "Secrets Store Write") }));
      withBootstrap(dir, boot);
      const r = await runSetup("AC-005 bootstrap short", world, dir);
      expect(r.status, r.all).toBe(1);
      expect(r.all).toContain("Secrets Store Write");
      expect(boot.deleted, "the bootstrap token is kept").toBe(false);
      expect(r.requests.filter((q) => q.includes(` DELETE /accounts/${ACCOUNT}/tokens/${boot.id}`))).toEqual([]);
      expect(readEnvFile(dir)).toContain(`${BOOTSTRAP_SETTING}=${boot.value}`);
    });

    it(tag("SETUP-AC-005", "the self-delete fails: the line is kept, the dashboard named, exit 1"), async () => {
      const { world, dir } = await setUpFirstProject("ac005f");
      const boot = addBootstrap(world, "ac005f-second");
      withBootstrap(dir, boot);
      const apiFor = withReplies(world, (method, path) => (method === "DELETE" && path.endsWith(`/tokens/${boot.id}`) ? SERVER_ERROR : undefined));
      const r = await runSetup("AC-005 self-delete fails", world, dir, { apiFor });
      expect(r.status, r.all).toBe(1);
      expect(r.all).toMatch(/dashboard/);
      expect(boot.deleted).toBe(false);
      expect(readEnvFile(dir)).toContain(`${BOOTSTRAP_SETTING}=${boot.value}`);
    });

    it(tag("SETUP-AC-005", "an everyday token scoped to another account: named, with its link; exit 1, no token written"), async () => {
      const world = freshWorld();
      addSecondAccount(world);
      const t = addTokens(world, "ac005g");
      // Its account policy names the second account (made while the dashboard had that account selected).
      t.everyday.policies = t.everyday.policies.map((p) => (Object.keys(p.resources).some((k) => k === `com.cloudflare.api.account.${ACCOUNT}`) ? { ...p, resources: { [`com.cloudflare.api.account.${SECOND_ACCOUNT}`]: "*" } } : p));
      const dir = await project({ envFile: envFile({ [EVERYDAY_SETTING]: t.everyday.value, CLOUDFLARE_EMAIL_DOMAIN: DOMAIN }) });
      const r = await runSetup("AC-005 everyday of the wrong account", world, dir);
      expect(r.status, r.all).toBe(1);
      expect(r.all).toContain(EVERYDAY_SETTING);
      expect(r.all).toContain(EVERYDAY_LINK);
      expect(tokenWritesOf(r.requests)).toEqual([]);
    });

    it(tag("SETUP-AC-005", "a token whose ID is in PAR-361's setting is neither updated (everyday) nor deleted (bootstrap)"), async () => {
      const a = await setUpFirstProject("ac005h");
      a.tokens.everyday.policies = a.tokens.everyday.policies.map((p) => ({ ...p, permission_groups: p.permission_groups.filter((g) => g.name !== "D1 Write") }));
      const before = JSON.stringify(a.tokens.everyday.policies);
      const bootA = addBootstrap(a.world, "ac005h-second");
      withBootstrap(a.dir, bootA);
      const r = await runSetup("AC-005 protected everyday", a.world, a.dir, { env: { [PROTECTED_IDS_SETTING]: `other-id,${a.tokens.everyday.id}` } });
      expect(r.requests.filter((q) => / PUT /.test(q) && q.includes(a.tokens.everyday.id)), "updates of the protected token").toEqual([]);
      expect(JSON.stringify(a.tokens.everyday.policies)).toBe(before);
      expect(a.tokens.everyday.deleted).toBe(false);

      const b = await setUpFirstProject("ac005i");
      const bootB = addBootstrap(b.world, "ac005i-second");
      withBootstrap(b.dir, bootB);
      const s = await runSetup("AC-005 protected bootstrap", b.world, b.dir, { env: { [PROTECTED_IDS_SETTING]: bootB.id } });
      expect(s.requests.filter((q) => / DELETE /.test(q) && q.includes(bootB.id)), "deletions of the protected token").toEqual([]);
      expect(bootB.deleted).toBe(false);
    });
  });

  describe("SETUP: account switch (SETUP-AC-006)", () => {
    async function switched(label: string, accountIn: "file" | "environment") {
      const first = await setUpFirstProject(label);
      const newCloud = addSecondAccount(first.world);
      const t = addTokens(first.world, `${label}-new`, SECOND_ACCOUNT);
      const values = { [BOOTSTRAP_SETTING]: t.bootstrap.value, [EVERYDAY_SETTING]: t.everyday.value, CLOUDFLARE_EMAIL_DOMAIN: DOMAIN };
      const dir = await project({ envFile: envFile(accountIn === "file" ? { ...values, CLOUDFLARE_ACCOUNT_ID: ACCOUNT } : values) });
      const env = accountIn === "environment" ? { CLOUDFLARE_ACCOUNT_ID: ACCOUNT } : {};
      return { ...first, newCloud, t, dir, env };
    }

    it(tag("SETUP-AC-006", "tokens of another account than CLOUDFLARE_ACCOUNT_ID: old stages keep running, how to remove them with the old everyday token, nothing changed, exit 1; no request to the old account"), async () => {
      const s = await switched("ac006a", "file");
      const before = readEnvFile(s.dir);
      const oldFrom = s.world.cloud().requests.length;
      const r = await runSetup("AC-006 switch explained", s.world, s.dir, { env: s.env });
      expect(r.status, r.all).toBe(1);
      expect(r.all).toMatch(/keep running/i);
      expect(r.all).toMatch(/remove/);
      expect(r.all).toMatch(/old everyday token|old token/i);
      expect(r.all).toContain("--switch-account");
      expect(writesOf(r.requests)).toEqual([]);
      expect(readEnvFile(s.dir)).toBe(before);
      expect(requestsSince(s.world.cloud(), oldFrom), "requests to the old account").toEqual([]);
      expect(r.requests.filter((q) => q.includes(ACCOUNT)), "requests naming the old account").toEqual([]);
    });

    it(tag("SETUP-AC-006", "run again with --switch-account: the new account is bootstrapped (its bootstrap token deleted) and CLOUDFLARE_ACCOUNT_ID in .env.cloudflare names it; no request to the old account"), async () => {
      const s = await switched("ac006b", "file");
      await runSetup("AC-006 before switch", s.world, s.dir);
      const oldFrom = s.world.cloud().requests.length;
      const r = await runSetup("AC-006 --switch-account", s.world, s.dir, { args: ["--switch-account"] });
      expect(r.status, r.all).toBe(0);
      const account = readEnvFile(s.dir).split("\n").filter((l) => l.startsWith("CLOUDFLARE_ACCOUNT_ID="));
      expect(account).toEqual([`CLOUDFLARE_ACCOUNT_ID=${SECOND_ACCOUNT}`]);
      expect(s.t.bootstrap.deleted, "the new account's bootstrap token").toBe(true);
      expect(requestsSince(s.world.cloud(), oldFrom), "requests to the old account").toEqual([]);
      expect(r.requests.filter((q) => q.includes(ACCOUNT))).toEqual([]);
    });

    it(tag("SETUP-AC-006", "with CLOUDFLARE_ACCOUNT_ID from the environment, --switch-account says to change it there; no request to the old account"), async () => {
      const s = await switched("ac006c", "environment");
      const oldFrom = s.world.cloud().requests.length;
      const r = await runSetup("AC-006 --switch-account, environment", s.world, s.dir, { env: s.env, args: ["--switch-account"] });
      const lines = r.all.split("\n").filter((l) => l.includes("CLOUDFLARE_ACCOUNT_ID") && /environment/i.test(l));
      expect(lines.length, `says to change CLOUDFLARE_ACCOUNT_ID in the environment:\n${r.all}`).toBeGreaterThan(0);
      expect(requestsSince(s.world.cloud(), oldFrom)).toEqual([]);
      expect(r.requests.filter((q) => q.includes(ACCOUNT))).toEqual([]);
    });
  });

  describe("SETUP: a second project from a copied .env.cloudflare (SETUP-AC-007)", () => {
    it(tag("SETUP-AC-007", "a copy of the first project's .env.cloudflare (account and domain filled in, bootstrap line commented out) completes with no bootstrap token and no write request"), async () => {
      const { world, dir } = await setUpFirstProject("ac007");
      const copied = readEnvFile(dir);
      expect(copied.split("\n")).toContain(`CLOUDFLARE_ACCOUNT_ID=${ACCOUNT}`);
      expect(copied.split("\n")).toContain(`CLOUDFLARE_EMAIL_DOMAIN=${DOMAIN}`);
      expect(copied.split("\n")).toContain(BOOTSTRAP_DELETED_LINE);
      const second = await project({ envFile: copied });
      const r = await runSetup("AC-007 second project", world, second);
      expect(r.status, r.all).toBe(0);
      expect(writesOf(r.requests)).toEqual([]);
      expect(links(r.all)).toEqual({ bootstrap: false, everyday: false });
    });
  });

  describe("SETUP: stops with their link or command (SETUP-AC-008)", () => {
    it(tag("SETUP-AC-008", "two accounts visible and CLOUDFLARE_ACCOUNT_ID unset: the accounts by name only, how to set CLOUDFLARE_ACCOUNT_ID from the dashboard, exit 1"), async () => {
      const world = freshWorld();
      addSecondAccount(world);
      const user = world.addUserToken(tokenValue("ac008-user"), tokenId("ac008u"), [ACCOUNT, SECOND_ACCOUNT]);
      const dir = await project({ envFile: envFile({ [EVERYDAY_SETTING]: user.value, CLOUDFLARE_EMAIL_DOMAIN: DOMAIN }) });
      const r = await runSetup("AC-008 two accounts", world, dir);
      expect(r.status, r.all).toBe(1);
      expect(r.all).toContain("Main account");
      expect(r.all).toContain("Second account");
      expect(r.all).toContain("CLOUDFLARE_ACCOUNT_ID");
      expect(r.all).toContain("https://dash.cloudflare.com");
      expect(writesOf(r.requests)).toEqual([]);
    });

    it(tag("SETUP-AC-008", "no CLOUDFLARE_EMAIL_DOMAIN: the account's zone names and --email-domain <domain>, exit 1; also for a single zone"), async () => {
      const world = freshWorld();
      const t = addTokens(world, "ac008c");
      const dir = await project({ envFile: envFile({ [EVERYDAY_SETTING]: t.everyday.value }) });
      const r = await runSetup("AC-008 no email domain", world, dir);
      expect(r.status, r.all).toBe(1);
      for (const name of ["example.test", "one.example", "two.example"]) expect(r.all).toContain(name);
      expect(r.all).toContain("--email-domain <domain>");
      expect(r.all).toContain("CLOUDFLARE_EMAIL_DOMAIN");

      const single = freshWorld();
      for (const name of ["one.example", "two.example"]) single.cloud().zones.delete(name);
      const t2 = addTokens(single, "ac008c2");
      const dir2 = await project({ envFile: envFile({ [EVERYDAY_SETTING]: t2.everyday.value }) });
      const s = await runSetup("AC-008 no email domain, one zone", single, dir2);
      expect(s.status, s.all).toBe(1);
      expect(s.all).toContain("example.test");
      expect(s.all).toContain("--email-domain <domain>");
      expect(writesOf([...r.requests, ...s.requests])).toEqual([]);
    });

    it(tag("SETUP-AC-008", "no zone at all: a domain is needed, with the dashboard link, exit 1"), async () => {
      const world = freshWorld();
      world.cloud().zones.clear();
      const t = addTokens(world, "ac008d");
      const dir = await project({ envFile: envFile({ [EVERYDAY_SETTING]: t.everyday.value }) });
      const r = await runSetup("AC-008 no zone", world, dir);
      expect(r.status, r.all).toBe(1);
      expect(r.all).toMatch(/no domain|domain is needed|needs? (a|one) domain|add a domain/i);
      expect(r.all).toContain("https://dash.cloudflare.com");
    });

    const blockedCase = (label: string, host: RegExp, kind: RegExp) =>
      it(tag("SETUP-AC-008", `a blocked network host (${label}): named by kind, with the hosts to allow in the cloud environment's network access settings, exit 1`), async () => {
        const { world, dir } = await setUpFirstProject(`ac008-${label.replace(/\W+/g, "")}`);
        const r = await runSetup(`AC-008 blocked ${label}`, world, dir, { blocked: (url) => host.test(new URL(url).hostname) });
        expect(r.status, r.all).toBe(1);
        expect(r.all).toMatch(kind);
        expect(r.all).toMatch(/network/i);
        for (const allow of ["api.cloudflare.com", "*.r2.cloudflarestorage.com", "*.workers.dev"]) expect(r.all).toContain(allow);
        expect(r.reached.length, "the hosts were tried").toBeGreaterThanOrEqual(3);
      });
    blockedCase("the API", /^api\.cloudflare\.com$/, /api\.cloudflare\.com/);
    blockedCase("R2 storage", /\.r2\.cloudflarestorage\.com$/, /R2/);
    blockedCase("workers.dev", /\.workers\.dev$/, /workers\.dev/);
  });

  describe("SETUP: local setup first, git warnings never fail (SETUP-AC-009)", () => {
    it(tag("SETUP-AC-009", "a project whose local setup is missing: dependencies installed, local secrets set and the .gitignore line added, before any Cloudflare request"), async () => {
      const { world, tokens } = await setUpFirstProject("ac009a");
      const dir = await project({ localSetupDone: false, gitignore: "node_modules\n", envFile: envFile({ [EVERYDAY_SETTING]: tokens.everyday.value, CLOUDFLARE_EMAIL_DOMAIN: DOMAIN }) });
      writeFileSync(join(dir, "package.json"), `${JSON.stringify({ name: "setup-ac-app", private: true, type: "module", dependencies: { "setup-ac-dependency": "1.0.0" } }, null, 2)}\n`);
      const events: string[] = [];
      const apiFor = (token: string) => {
        const api = world.apiFor(token);
        return (async (method, path, body) => {
          events.push("request");
          return api(method, path, body);
        }) as typeof api;
      };
      const localSetup: NonNullable<RunOptions["localSetup"]> = (d, o) =>
        runLocalSetup(d, {
          ...o,
          declaredSecrets: async () => ["apiKey"],
          npmInstall: async (at) => {
            events.push("npm install");
            mkdirSync(join(at, "node_modules", "setup-ac-dependency"), { recursive: true });
            writeFileSync(join(at, "node_modules", "setup-ac-dependency", "package.json"), '{"name":"setup-ac-dependency","version":"1.0.0"}\n');
          },
        });
      const r = await runSetup("AC-009 local setup missing", world, dir, { apiFor, localSetup });
      expect(r.status, r.all).toBe(0);
      expect(events[0], "the dependencies are installed before any Cloudflare request").toBe("npm install");
      expect(events.filter((e) => e === "npm install")).toHaveLength(1);
      expect(readFileSync(join(dir, ".dev.vars"), "utf8")).toMatch(/^SECRET_API_KEY=\S+/m);
      expect(readFileSync(join(dir, ".gitignore"), "utf8").split("\n")).toContain(".env.cloudflare");
    });

    /** A current project whose git state `arrange` sets; the exit status and output of one run. */
    async function gitCase(label: string, options: { repo?: boolean; gitignore?: string | null }, arrange: (dir: string) => void = () => undefined) {
      const { world, tokens } = await setUpFirstProject(label);
      const dir = await project({ ...options, envFile: envFile({ [EVERYDAY_SETTING]: tokens.everyday.value, CLOUDFLARE_EMAIL_DOMAIN: DOMAIN, CLOUDFLARE_ACCOUNT_ID: ACCOUNT }) });
      arrange(dir);
      return { dir, r: await runSetup(`AC-009 ${label}`, world, dir) };
    }

    it(tag("SETUP-AC-009", "the baseline (a repository, the file ignored and untracked) exits 0 with no git warning"), async () => {
      const { r } = await gitCase("ac009-baseline", {});
      expect(r.status, r.all).toBe(0);
      expect(r.all).not.toMatch(/not a git repository|not ignore|tracked by git/i);
    });

    it(tag("SETUP-AC-009", "outside a git repository: a warning set off from the rest of the output, the same exit status as the baseline, on every run"), async () => {
      const { dir, r } = await gitCase("ac009-norepo", { repo: false, gitignore: null });
      let insideRepo = true;
      try {
        git(dir, ["rev-parse", "--is-inside-work-tree"]);
      } catch {
        insideRepo = false;
      }
      expect(insideRepo, "the project folder is outside any repository").toBe(false);
      expect(r.status, r.all).toBe(0);
      expect(setOffByRules(r.all, /not a git repository/i), `a set-off not-a-repository warning:\n${r.all}`).toBe(true);
    });

    it(tag("SETUP-AC-009", ".env.cloudflare not ignored (PAR-343's marker in .gitignore): a set-off warning, the line not added, the same exit status"), async () => {
      const { dir, r } = await gitCase("ac009-notignored", { gitignore: `${KEEP_TRACKED_MARKER}\n` });
      expect(r.status, r.all).toBe(0);
      expect(setOffByRules(r.all, /\.env\.cloudflare/), `a set-off not-ignored warning:\n${r.all}`).toBe(true);
      expect(r.all).toMatch(/not ignore|does not ignore|isn't ignored|not git-ignored/i);
      expect(readFileSync(join(dir, ".gitignore"), "utf8").split("\n"), "the line is not added with the marker").not.toContain(".env.cloudflare");
    });

    it(tag("SETUP-AC-009", ".env.cloudflare not ignored and no marker: setup adds the .gitignore line; exit status unchanged"), async () => {
      const { dir, r } = await gitCase("ac009-addline", { gitignore: "node_modules\n" });
      expect(r.status, r.all).toBe(0);
      expect(readFileSync(join(dir, ".gitignore"), "utf8").split("\n")).toContain(".env.cloudflare");
      let ignored = false;
      try {
        git(dir, ["check-ignore", "-q", ".env.cloudflare"]);
        ignored = true;
      } catch {
        ignored = false;
      }
      expect(ignored, "git now ignores the file").toBe(true);
    });

    it(tag("SETUP-AC-009", ".env.cloudflare tracked: a set-off warning that the tokens are in the history and how to replace them, the same exit status"), async () => {
      const { r } = await gitCase("ac009-tracked", {}, (dir) => {
        git(dir, ["add", "-f", ".env.cloudflare"]);
        git(dir, ["commit", "-q", "-m", "tracked by mistake"]);
      });
      expect(r.status, r.all).toBe(0);
      expect(setOffByRules(r.all, /tracked/i), `a set-off tracked warning:\n${r.all}`).toBe(true);
      expect(r.all).toMatch(/history/i);
      expect(r.all).toContain("git rm --cached .env.cloudflare");
    });

    it(tag("SETUP-AC-009", "a stop is not changed by the git conditions: with no tokens, outside a repository and with the file tracked, the exit status is 1 as in the baseline"), async () => {
      const statuses: number[] = [];
      for (const [label, options, arrange] of [
        ["baseline", {}, undefined],
        ["no repo", { repo: false, gitignore: null }, undefined],
        ["tracked", {}, (d: string) => {
          writeFileSync(join(d, ".env.cloudflare"), `${TEMPLATE_LINES.join("\n")}\n`);
          git(d, ["add", "-f", ".env.cloudflare"]);
          git(d, ["commit", "-q", "-m", "tracked"]);
        }],
      ] as const) {
        const dir = await project(options);
        arrange?.(dir);
        statuses.push((await runSetup(`AC-009 stop, ${label}`, freshWorld(), dir)).status);
      }
      expect(statuses).toEqual([1, 1, 1]);
    });
  });

  describe("SETUP: no token value in any output (SETUP-AC-010)", () => {
    it(tag("SETUP-AC-010", "across every run above, no stdout, stderr or file the command left (other than .env.cloudflare) holds a fake token value, token ID, account ID, zone ID or workers.dev subdomain"), () => {
      expect(RUNS.length, "the runs of SETUP-AC-001…009 were recorded").toBeGreaterThan(40);
      expect(SUB.length).toBeGreaterThan(8);
      expect(sensitiveHits(), "outputs holding a sensitive value").toEqual([]);
    });

    it(tag("SETUP-AC-010", "the search itself finds a planted value (a self-check of the scan)"), () => {
      const planted = tokenValue("planted");
      expect(sensitiveHits([{ label: "planted", out: `x ${planted} y`, err: "", files: {} }])).toEqual(["planted: stdout holds token value planted"]);
      expect(sensitiveHits([{ label: "planted", out: "", err: "", files: { "f.txt": `id ${ACCOUNT}` } }])).toEqual(["planted: file f.txt holds the fake account's ID"]);
    });
  });
} else {
  // Untagged, so never selected as evidence: keeps the file a valid suite on cloud runs.
  describe("SETUP: cloudflare-setup on the fake API (local only)", () => {
    it("has nothing to run on a cloud", () => undefined);
  });
}

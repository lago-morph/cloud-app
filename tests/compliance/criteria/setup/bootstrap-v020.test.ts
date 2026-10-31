/**
 * SETUP-AC-001…008 as rewritten for v0.2.0 (docs/components/setup.md §4, DEC-0697), and SETUP-AC-010
 * over this file's runs: `cloudflare-setup` against the fake Cloudflare API with fake token values
 * only. Written from the rewritten criteria and SETUP-REQ-001…007's v0.2.0 amendments, not from the
 * command's code; the older tests in cloudflare-setup.test.ts are C's and stay as they are. No
 * project here holds an email domain: v0.2.0 has none (SETUP-REQ-002 as amended).
 *
 * Readings recorded here (DEC-0750): "makes no Cloudflare write request" is no request other than
 * a GET; the admin app's Everyday token page is named as "Everyday token" next to "admin app"; "only
 * that token's remedy" means the bootstrap link without the Everyday token page, or the page without
 * any token link; "private" is the API's default, so the create request asks for nothing public
 * (plan-v0.2.0 §2.2), and "confidential" is a client authenticated with its secret.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { tag } from "../../harness/index.js";
import { isLocal } from "../core/support/repo.js";
import { BOOTSTRAP, EVERYDAY } from "../../../../packages/framework/src/provision/cloudflare/permissions.js";
import {
  ACCOUNT, addBootstrap, addSecondAccount, addTokens, BOOT_LINK, BOOTSTRAP_DELETED_LINE, BOOTSTRAP_NAMES, BOOTSTRAP_SETTING, decodeLink, envFile,
  envFileExists, EVERYDAY_LINK, EVERYDAY_SETTING, freshWorld, NEXT_PROMPT_PHRASE, project, PROTECTED_IDS_SETTING, readEnvFile, removeProjects, runSetup,
  SECOND_ACCOUNT, sensitiveHits, SERVER_ERROR, setUpAccount, SUB, tokenId, tokenValue, tokenWritesOf, withReplies, writesOf, type RunResult, type SetupWorld, type WorldToken,
} from "./support/setup-runs.js";

/** SETUP-REQ-003 as amended: plan-setup-wizard §3.2's template without the email domain line. */
const TEMPLATE = ["CLOUDFLARE_BOOTSTRAP_TOKEN=", "CLOUDFLARE_API_TOKEN=", "# CLOUDFLARE_ACCOUNT_ID=        (only if your tokens see more than one account)"];
const RECORD_KEY = "sst-state/framework/account.json";
const ADMIN_URL = `https://prototype-admin.${SUB}.workers.dev`;
const DAY_MS = 86_400_000; // PAR-435
const PAGE = /admin app[^\n]*Everyday token|Everyday token[^\n]*admin app/i;
const remedy = (r: RunResult) => ({ bootstrapLink: r.all.includes(BOOT_LINK), everydayLink: r.all.includes(EVERYDAY_LINK), everydayPage: PAGE.test(r.all) });
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

/** A first project after a v0.2.0 setup: the admin app's account setup done, the bootstrap run (exit 0). */
async function setUp(label: string): Promise<{ world: SetupWorld; dir: string; everyday: WorldToken }> {
  const world = freshWorld();
  await setUpAccount(world);
  const t = addTokens(world, label);
  const dir = await project({ envFile: envFile({ [BOOTSTRAP_SETTING]: t.bootstrap.value, [EVERYDAY_SETTING]: t.everyday.value }) });
  const r = await runSetup(`${label}: bootstrap`, world, dir);
  if (r.status !== 0) throw new Error(`bootstrap of ${label} exited ${String(r.status)}:\n${r.all}`);
  return { world, dir, everyday: t.everyday };
}

if (isLocal()) {
  afterAll(() => removeProjects());
  afterEach(() => vi.useRealTimers());

  describe("SETUP v0.2.0: no tokens, everything current, bad pastes", () => {
    it(tag("SETUP-AC-001", "no tokens: the bootstrap link as deepLink builds it (four groups), an expiry no more than 1 day away, the three template lines, where they go, the admin app makes the everyday token, the next prompt; no everyday link, plan or domain requirement; template written; no write; exit 1"), async () => {
      const world = freshWorld();
      const dir = await project();
      const r = await runSetup("v020 AC-001 no tokens", world, dir);
      expect(r.status, r.all).toBe(1);
      expect(r.out.split("\n").map((l) => l.trim())).toContain(BOOT_LINK);
      expect([...decodeLink(BOOT_LINK, BOOTSTRAP).names].sort()).toEqual([...BOOTSTRAP_NAMES].sort());
      expect(r.out).toMatch(/expir|end date|TTL/i);
      expect(r.out).toMatch(/1 day/);
      const lines = r.out.split("\n");
      const at = lines.indexOf(TEMPLATE[0]!);
      expect(lines.slice(at, at + 3), `the template's three lines, in order:\n${r.out}`).toEqual(TEMPLATE);
      expect(/^#? ?CLOUDFLARE_/.test(lines[at + 3] ?? ""), "no fourth template line").toBe(false);
      expect(r.out).not.toContain("CLOUDFLARE_EMAIL_DOMAIN");
      expect(r.out).toMatch(/cloud session/i);
      expect(r.out).toMatch(/command line/i);
      expect(r.out).toMatch(/admin app[^\n]*everyday token/i);
      expect(r.out).toContain(NEXT_PROMPT_PHRASE);
      expect(remedy(r).everydayLink, "no everyday-token link").toBe(false);
      expect(r.out, "no plan requirement").not.toMatch(/Workers Paid/i);
      expect(r.out, "no domain requirement").not.toMatch(/Cloudflare DNS|\ba domain\b|email domain/i);
      expect(envFileExists(dir)).toBe(true);
      expect(readEnvFile(dir).split("\n").filter((l) => l !== "")).toEqual(TEMPLATE);
      expect(writesOf(r.requests)).toEqual([]);
    });

    it(tag("SETUP-AC-002", "everything current, no email domain anywhere: already set up, asks for nothing, no write, .env.cloudflare byte for byte, exit 0; the same from the environment only"), async () => {
      const { world, dir, everyday } = await setUp("v020-ac002");
      const before = readEnvFile(dir);
      const r = await runSetup("v020 AC-002 current", world, dir);
      expect(r.status, r.all).toBe(0);
      expect(r.all).toMatch(/already set up/i);
      expect(r.stdinReads).toBe(0);
      expect(writesOf(r.requests)).toEqual([]);
      expect(readEnvFile(dir)).toBe(before);
      const bare = await project();
      const e = await runSetup("v020 AC-002 environment only", world, bare, { env: { [EVERYDAY_SETTING]: everyday.value, CLOUDFLARE_ACCOUNT_ID: ACCOUNT } });
      expect(e.status, e.all).toBe(0);
      expect(e.stdinReads).toBe(0);
      expect(writesOf(e.requests)).toEqual([]);
    });

    describe("SETUP-AC-003 bad pastes name the setting and give only that token's remedy", () => {
      type Case = [string, "bootstrap" | "everyday", RegExp, (w: SetupWorld) => { boot?: string; everyday?: string }];
      const cases: Case[] = [
        ["a value that is not a token as the everyday token", "everyday", /not accept|not a valid|invalid|not .*token/i, (w) => ({ boot: addTokens(w, "v3a").bootstrap.value, everyday: tokenValue("v3a-junk") })],
        ["a value that is not a token as the bootstrap token", "bootstrap", /not accept|not a valid|invalid|not .*token/i, (w) => ({ boot: tokenValue("v3b-junk"), everyday: addTokens(w, "v3b").everyday.value })],
        ["an everyday token that is not active", "everyday", /not active|disabled/i, (w) => { const t = addTokens(w, "v3c"); t.everyday.status = "disabled"; return { everyday: t.everyday.value }; }],
        ["the everyday token pasted as the bootstrap token", "bootstrap", /everyday|API tokens|bootstrap permission|Account API Tokens Write/i, (w) => { const t = addTokens(w, "v3e"); return { boot: t.everyday.value, everyday: w.addToken("everyday", tokenValue("v3e-2"), tokenId("v3e2")).value }; }],
        ["a user token as the bootstrap token", "bootstrap", /user (API )?token/i, (w) => ({ boot: w.addUserToken(tokenValue("v3f-user"), tokenId("v3fu"), [ACCOUNT]).value, everyday: addTokens(w, "v3f").everyday.value })],
        ["a bootstrap token of another account", "bootstrap", /account/i, (w) => { addSecondAccount(w); return { boot: addBootstrap(w, "v3g", SECOND_ACCOUNT).value, everyday: addTokens(w, "v3g").everyday.value }; }],
        ["an everyday token with a permission denied", "everyday", new RegExp(EVERYDAY[0]!.name), (w) => {
          const t = addTokens(w, "v3h");
          const g = EVERYDAY[0]!;
          t.everyday.policies = [...t.everyday.policies, { id: "deny", effect: "deny", resources: { [`com.cloudflare.api.account.${ACCOUNT}`]: "*" }, permission_groups: [{ id: g.id, name: g.name }] }];
          return { everyday: t.everyday.value };
        }],
      ];
      for (const [name, which, what, make] of cases) {
        it(tag("SETUP-AC-003", `${name}: names the setting and what is wrong, only that token's remedy, exit 1, no token updated or deleted`), async () => {
          const world = freshWorld();
          const { boot, everyday } = make(world);
          const dir = await project({ envFile: envFile({ ...(boot === undefined ? {} : { [BOOTSTRAP_SETTING]: boot }), ...(everyday === undefined ? {} : { [EVERYDAY_SETTING]: everyday }) }) });
          const r = await runSetup(`v020 AC-003 ${name}`, world, dir);
          expect(r.status, r.all).toBe(1);
          expect(r.all).toContain(which === "bootstrap" ? BOOTSTRAP_SETTING : EVERYDAY_SETTING);
          expect(r.all).toMatch(what);
          expect(remedy(r), r.all).toEqual(which === "bootstrap" ? { bootstrapLink: true, everydayLink: false, everydayPage: false } : { bootstrapLink: false, everydayLink: false, everydayPage: true });
          expect(tokenWritesOf(r.requests)).toEqual([]);
          expect(world.tokens.filter((t) => t.deleted)).toEqual([]);
        });
      }

      it(tag("SETUP-AC-003", "the same token in both settings: names a setting, says they are the same, gives that token's remedy only, exit 1, no token updated or deleted"), async () => {
        const world = freshWorld();
        const t = addTokens(world, "v3d");
        const dir = await project({ envFile: envFile({ [BOOTSTRAP_SETTING]: t.everyday.value, [EVERYDAY_SETTING]: t.everyday.value }) });
        const r = await runSetup("v020 AC-003 same token", world, dir);
        expect(r.status, r.all).toBe(1);
        expect(r.all).toMatch(/same/i);
        const got = remedy(r);
        expect(got.everydayLink).toBe(false);
        expect(got.bootstrapLink !== got.everydayPage, `one token's remedy:\n${r.all}`).toBe(true);
        expect(r.all).toContain(got.bootstrapLink ? BOOTSTRAP_SETTING : EVERYDAY_SETTING);
        expect(tokenWritesOf(r.requests)).toEqual([]);
      });
    });
  });

  describe("SETUP v0.2.0: the bootstrap", () => {
    it(tag("SETUP-AC-004", "an everyday token lacking one permission, no bootstrap token: names it, the Everyday token page and the bootstrap link; nothing changed; exit 1. With a bootstrap token: the everyday token neither read nor updated, no new token, the bootstrap token deleted (401) and its line exactly PAR-342"), async () => {
      const { world, dir, everyday } = await setUp("v020-ac004");
      const missing = EVERYDAY[0]!.name;
      everyday.policies = everyday.policies.map((p) => ({ ...p, permission_groups: p.permission_groups.filter((g) => g.name !== missing) }));
      const before = readEnvFile(dir);
      const r = await runSetup("v020 AC-004 short", world, dir);
      expect(r.status, r.all).toBe(1);
      expect(r.all).toContain(missing);
      expect(remedy(r), r.all).toMatchObject({ everydayPage: true, bootstrapLink: true, everydayLink: false });
      expect(writesOf(r.requests)).toEqual([]);
      expect(readEnvFile(dir)).toBe(before);

      const boot = addBootstrap(world, "v020-ac004-boot");
      writeFileSync(join(dir, ".env.cloudflare"), before.replace(BOOTSTRAP_DELETED_LINE, `${BOOTSTRAP_SETTING}=${boot.value}`));
      const policies = JSON.stringify(everyday.policies);
      const count = world.tokens.length;
      const b = await runSetup("v020 AC-004 short, with bootstrap", world, dir);
      expect(b.requests.filter((q) => q.includes(everyday.id)), "the everyday token is neither read nor updated").toEqual([]);
      expect(JSON.stringify(everyday.policies)).toBe(policies);
      expect(b.requests.filter((q) => / POST \/(accounts\/[^/]+|user)\/tokens$/.test(q)), "no new token").toEqual([]);
      expect(world.tokens.length).toBe(count);
      expect(boot.deleted).toBe(true);
      expect((await world.apiFor(boot.value)("GET", `/accounts/${ACCOUNT}/tokens/verify`)).status).toBe(401);
      expect(readEnvFile(dir).split("\n").filter((l) => l.includes("CLOUDFLARE_BOOTSTRAP_TOKEN"))).toEqual([BOOTSTRAP_DELETED_LINE]);
    });

    it(tag("SETUP-AC-005", "a usable bootstrap token on a new account: both OAuth clients as specified, their IDs and secrets in Secrets Store under PAR-436's names, the admin app deployed, its URL and the next step printed, the self-delete last; no setup step, no setup record"), async () => {
      const world = freshWorld();
      const t = addTokens(world, "v020-ac005");
      const dir = await project({ envFile: envFile({ [BOOTSTRAP_SETTING]: t.bootstrap.value, [EVERYDAY_SETTING]: t.everyday.value }) });
      const buckets = [...world.cloud().buckets.keys()];
      const r = await runSetup("v020 AC-005 bootstrap", world, dir);
      expect(r.status, r.all).toBe(0);
      const clients = [...world.cloud().oauthClients.values()];
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
      const stored = new Map([...world.cloud().secretStores.values()].flatMap((s) => [...s.secrets].map(([k, v]) => [k, v.value] as const)));
      expect(Object.fromEntries(stored)).toEqual({
        PROTOTYPE_ADMIN_CLIENT_ID: admin?.id, PROTOTYPE_ADMIN_CLIENT_SECRET: admin?.secret, PROTOTYPE_SIGNIN_CLIENT_ID: signIn?.id, PROTOTYPE_SIGNIN_CLIENT_SECRET: signIn?.secret,
      });
      expect(world.cloud().workers.has("prototype-admin"), "the admin app is deployed").toBe(true);
      expect(r.out).toContain(ADMIN_URL);
      expect(r.out).toMatch(/open the admin app and sign in/i);
      expect(r.requests.at(-1), "the self-delete is the last request").toBe(`${t.bootstrap.id} DELETE /accounts/${ACCOUNT}/tokens/${t.bootstrap.id}`);
      expect(t.bootstrap.deleted).toBe(true);
      expect([...world.cloud().buckets.keys()], "no setup step").toEqual(buckets);
      expect(world.cloud().objectBodies.has(RECORD_KEY), "no setup record").toBe(false);
    });

    it(tag("SETUP-AC-005", "an expiry exactly PAR-435 away runs; one second more, or none, is deleted at once, used for nothing else, exit 1 with the bootstrap link"), async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const now = Date.parse("2026-06-01T12:00:00Z");
      vi.setSystemTime(now);
      for (const [label, expires, ok] of [["exact", iso(now + DAY_MS), true], ["late", iso(now + DAY_MS + 1000), false], ["none", null, false]] as const) {
        const world = freshWorld();
        const t = addTokens(world, `v020-ac005-${label}`, ACCOUNT, { bootstrapExpires: expires });
        const dir = await project({ envFile: envFile({ [BOOTSTRAP_SETTING]: t.bootstrap.value, [EVERYDAY_SETTING]: t.everyday.value }) });
        const r = await runSetup(`v020 AC-005 expiry ${label}`, world, dir);
        expect(r.status, `${label}:\n${r.all}`).toBe(ok ? 0 : 1);
        expect(t.bootstrap.deleted, label).toBe(true);
        if (!ok) {
          expect(writesOf(r.requests), label).toEqual([`${t.bootstrap.id} DELETE /accounts/${ACCOUNT}/tokens/${t.bootstrap.id}`]);
          expect(r.all).toContain(BOOT_LINK);
        }
      }
    });

    it(tag("SETUP-AC-005", "a bootstrap that stops before its end, or whose self-delete fails, keeps the token and its line and exits 1, naming the dashboard for the failed delete; a protected token (PAR-361) is neither updated nor deleted, its line kept, and the run says so"), async () => {
      const cases = [
        ["stops", (b: WorldToken) => { b.policies = b.policies.map((p) => ({ ...p, permission_groups: p.permission_groups.filter((g) => g.name !== "Secrets Store Write") })); return {}; }],
        ["delete fails", (b: WorldToken, w: SetupWorld) => ({ apiFor: withReplies(w, (m, p) => (m === "DELETE" && p.endsWith(`/tokens/${b.id}`) ? SERVER_ERROR : undefined)) })],
        ["protected", (b: WorldToken) => ({ env: { [PROTECTED_IDS_SETTING]: b.id } })],
      ] as const;
      for (const [label, arrange] of cases) {
        const world = freshWorld();
        const t = addTokens(world, `v020-ac005-${label.replace(/\W/g, "")}`);
        const dir = await project({ envFile: envFile({ [BOOTSTRAP_SETTING]: t.bootstrap.value, [EVERYDAY_SETTING]: t.everyday.value }) });
        const r = await runSetup(`v020 AC-005 ${label}`, world, dir, arrange(t.bootstrap, world));
        if (label !== "protected") expect(r.status, `${label}:\n${r.all}`).toBe(1);
        expect(t.bootstrap.deleted, label).toBe(false);
        expect(readEnvFile(dir), label).toContain(`${BOOTSTRAP_SETTING}=${t.bootstrap.value}`);
        if (label === "delete fails") expect(r.all).toMatch(/dashboard/i);
        if (label === "protected") {
          expect(r.all).toMatch(/protected[^\n]*not delete|not delete[^\n]*protected/i);
          expect(tokenWritesOf(r.requests), "neither updated nor deleted").toEqual([]);
        }
      }
    });
  });

  describe("SETUP v0.2.0: switch, second project, stops", () => {
    it(tag("SETUP-AC-006", "tokens of another account: old stages keep running and how to remove them, no change, exit 1; with --switch-account and the new account's bootstrap token the bootstrap runs there and CLOUDFLARE_ACCOUNT_ID is written; no request to the old account"), async () => {
      const { world, dir } = await setUp("v020-ac006");
      const fresh = addSecondAccount(world);
      const t = addTokens(world, "v020-ac006-new", SECOND_ACCOUNT);
      writeFileSync(join(dir, ".env.cloudflare"), envFile({ [BOOTSTRAP_SETTING]: t.bootstrap.value, [EVERYDAY_SETTING]: t.everyday.value, CLOUDFLARE_ACCOUNT_ID: ACCOUNT }));
      const before = readEnvFile(dir);
      const old = world.cloud().requests.length;
      const r = await runSetup("v020 AC-006 explained", world, dir);
      expect(r.status, r.all).toBe(1);
      expect(r.all).toMatch(/keep running/i);
      expect(r.all).toMatch(/old everyday token|old token/i);
      expect(writesOf(r.requests)).toEqual([]);
      expect(readEnvFile(dir)).toBe(before);
      const s = await runSetup("v020 AC-006 --switch-account", world, dir, { args: ["--switch-account"] });
      expect(s.status, s.all).toBe(0);
      expect(fresh.oauthClients.size, "the bootstrap ran on the new account").toBe(2);
      expect(t.bootstrap.deleted).toBe(true);
      expect(readEnvFile(dir).split("\n").filter((l) => l.startsWith("CLOUDFLARE_ACCOUNT_ID="))).toEqual([`CLOUDFLARE_ACCOUNT_ID=${SECOND_ACCOUNT}`]);
      expect(world.cloud().requests.slice(old), "requests to the old account").toEqual([]);
    });

    it(tag("SETUP-AC-007", "a copy of the first project's .env.cloudflare (account filled in, the bootstrap line commented out, no email domain) completes with no bootstrap token and no write"), async () => {
      const { world, dir } = await setUp("v020-ac007");
      const copied = readEnvFile(dir);
      expect(copied.split("\n")).toEqual(expect.arrayContaining([`CLOUDFLARE_ACCOUNT_ID=${ACCOUNT}`, BOOTSTRAP_DELETED_LINE]));
      const r = await runSetup("v020 AC-007 second project", world, await project({ envFile: copied }));
      expect(r.status, r.all).toBe(0);
      expect(writesOf(r.requests)).toEqual([]);
    });

    it(tag("SETUP-AC-008", "on Workers Free, with no CLOUDFLARE_EMAIL_DOMAIN and no zone, the command does not stop for the plan or the domain"), async () => {
      const { world, dir } = await setUp("v020-ac008");
      const account = world.accounts.get(ACCOUNT);
      if (account === undefined) throw new Error("no main account");
      account.plan = "free";
      world.cloud().zones.clear();
      const r = await runSetup("v020 AC-008 free, no zone", world, dir);
      expect(r.status, r.all).toBe(0);
      expect(r.all).not.toMatch(/Workers Paid|email domain|no domain|--email-domain/i);
    });
  });

  describe("SETUP v0.2.0: no sensitive value in any output", () => {
    it(tag("SETUP-AC-010", "across every run in this file, no stdout, stderr or file the command left (other than .env.cloudflare) holds a fake token value, token ID, account ID, zone ID or workers.dev subdomain"), () => {
      expect(sensitiveHits()).toEqual([]);
    });
  });
}

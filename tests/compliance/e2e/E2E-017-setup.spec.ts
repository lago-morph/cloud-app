/**
 * E2E-017 — Setup: the bootstrap, then the admin app (Where: Local; plan-v0.2.0 §5, §7.1 "Add" 1).
 *
 * One fake account (support/setup-edge.ts) from start to end, as a new user meets it:
 * `cloudflare-setup` with a bootstrap token deploys the admin app into the account; the admin app
 * this test runs is the Worker that upload holds (its module and its bindings, the client ID and
 * secret read from the account's Secrets Store), under local workerd, with mock-oauth2-server as
 * Cloudflare's OAuth and the edge as Cloudflare's API, enforcing each grant's scopes. An
 * administrator signs in, runs account setup and makes the everyday token; `cloudflare-setup` with
 * that token then finds the account set up. The live run of the same steps is SETUP-AC-011's.
 *
 * Edge cases listed before writing (resources/edge-cases.md): expiry at exactly 1 day and 1 s past
 * it, and none (boundaries); a missing permission; an interrupted bootstrap and an interrupted
 * account setup, each run again (repetition); anonymous, a member who is not an administrator, and
 * someone outside the account (access); an unticked optional scope (failures). Not applicable:
 * text and order (setup takes no names or lists from the user).
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Miniflare } from "miniflare";
import { cloudflareSetupCommand } from "../../../packages/framework/src/cli/commands/cloudflare-setup.js";
import { captureIo } from "../../../packages/framework/src/cli/io.test-support.js";
import { ADMIN_APP_COMPATIBILITY_DATE, ADMIN_APP_COMPATIBILITY_FLAGS, ADMIN_APP_MODULE } from "../../../packages/framework/src/provision/cloudflare/admin-app-deploy.js";
import { ACCOUNT_SETTINGS_KEY } from "../../../packages/framework/src/provision/cloudflare/account-settings.js";
import { ACCOUNT } from "../../../packages/framework/src/provision/cloudflare/fake-cloud.test-support.js";
import { STATE_BUCKET } from "../../../packages/framework/src/provision/cloudflare/names.js";
import { APP_SCRIPTS, CLIENT_NAMES, CLIENT_SECRET_NAMES } from "../../../packages/framework/src/provision/cloudflare/oauth-clients.js";
import { BOOTSTRAP } from "../../../packages/framework/src/provision/cloudflare/permissions.js";
import { SetupWorld } from "../../../packages/framework/src/provision/cloudflare/setup-world.test-support.js";
import { startMockOAuth2, type MockOAuth2 } from "../../support/mock-oauth2/launcher.js";
import { tag } from "../harness/index.js";
import { expect, test } from "../harness/playwright.js";
import { startSetupEdge, type SetupEdge } from "./support/setup-edge.js";

/** Plan §5.2 page 2's everyday set, written out (not imported from the code under test): Workers Scripts Write, Workers R2 Storage Write, D1 Write, Secrets Store Read. */
const FOUR_GROUPS = ["e086da7e2179491d91ee5f35b3ca210a", "bf7481a1826f439697cb59a20b22293e", "09b2857d1c31407795e75e3fed8617a1", "5e33b7d77788455c9fdf18cbd38ee5a0"];
const NOW = new Date("2026-10-31T12:00:00.000Z");
const DAY_MS = 86_400_000;
const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const SUB = "e2e017sub";
const BOOT = (n: number) => `e2e017-bootstrap-value-${String(n)}-0123456789abcdef`;
const outputs: string[] = [];
const dirs: string[] = [];

test.describe.configure({ mode: "serial" });

function project(env: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "e2e017-"));
  dirs.push(dir);
  writeFileSync(join(dir, ".gitignore"), ".env.cloudflare\n");
  writeFileSync(join(dir, ".env.cloudflare"), Object.entries(env).map(([k, v]) => `${k}=${v}\n`).join(""));
  return dir;
}

/** `cloudflare-setup` as the CLI binds it, with the fake account's API in place of Cloudflare's (DEC-0761). */
async function setup(world: SetupWorld, dir: string): Promise<{ status: number; out: string }> {
  const io = captureIo(dir);
  const status = await cloudflareSetupCommand({
    env: {},
    apiFor: world.apiFor,
    reach: async () => {},
    // The local setup's npm steps are LOCAL-AC's; here only its git-ignore step runs.
    localSetup: async (d, o) => [{ step: "gitignore", result: (await o.ensureIgnored(d)) === "added" ? "applied" : "already" }],
    stepOptions: { newSubdomain: () => SUB },
    frameworkVersion: "0.2.0-e2e",
    now: () => NOW,
  })([], io);
  outputs.push(io.out, io.err);
  return { status, out: io.out + io.err };
}

function freshWorld(boot?: { value: string; expires_on?: string; groups?: typeof BOOTSTRAP }): SetupWorld {
  const world = new SetupWorld();
  world.cloud().subdomain = undefined;
  if (boot !== undefined) world.addToken("bootstrap", boot.value, `boot-${boot.value.slice(-6)}`, { ...(boot.expires_on === undefined ? {} : { expires_on: boot.expires_on }), ...(boot.groups === undefined ? {} : { groups: boot.groups }) });
  return world;
}

const filesUnder = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? filesUnder(join(dir, n)) : [readFileSync(join(dir, n), "utf8")]));

test.afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

test(tag("E2E-017", "bootstrap: a token with no expiry, or one 1 day + 1 s away, is deleted at once and used for nothing else; exactly 1 day away is accepted"), async () => {
  for (const [label, expires_on] of [["no expiry", undefined], ["1 day + 1 s", at(DAY_MS + 1000)]] as const) {
    const world = freshWorld({ value: BOOT(1), ...(expires_on === undefined ? {} : { expires_on }) });
    const dir = project({ CLOUDFLARE_BOOTSTRAP_TOKEN: BOOT(1) });
    const r = await setup(world, dir);
    expect(r.status, label).toBe(1);
    expect(world.writes(), label).toEqual([`boot-${BOOT(1).slice(-6)} DELETE /accounts/${ACCOUNT}/tokens/boot-${BOOT(1).slice(-6)}`]);
    expect(r.out, label).toContain("Make a new bootstrap token with an expiry of 1 day or less");
    expect(readFileSync(join(dir, ".env.cloudflare"), "utf8"), label).not.toContain(BOOT(1));
  }
  const world = freshWorld({ value: BOOT(2), expires_on: at(DAY_MS) });
  const r = await setup(world, project({ CLOUDFLARE_BOOTSTRAP_TOKEN: BOOT(2) }));
  expect(r.status, r.out).toBe(0);
  expect(world.cloud().workers.has(APP_SCRIPTS.admin)).toBe(true);
});

test(tag("E2E-017", "bootstrap: a token missing a permission is named, writes nothing and is kept"), async () => {
  const lacking = BOOTSTRAP.filter((g) => g.name !== "OAuth Client Write");
  const world = freshWorld({ value: BOOT(3), expires_on: at(DAY_MS / 2), groups: lacking });
  const dir = project({ CLOUDFLARE_BOOTSTRAP_TOKEN: BOOT(3) });
  const r = await setup(world, dir);
  expect(r.status).toBe(1);
  expect(r.out).toContain("OAuth Client Write");
  expect(world.writes()).toEqual([]);
  expect(readFileSync(join(dir, ".env.cloudflare"), "utf8")).toContain(`CLOUDFLARE_BOOTSTRAP_TOKEN=${BOOT(3)}`);
});

// The main account, carried through the rest of the file.
const world = freshWorld({ value: BOOT(4), expires_on: at(DAY_MS / 2) });
const appDir = project({ CLOUDFLARE_BOOTSTRAP_TOKEN: BOOT(4) });
let oauth: MockOAuth2 | undefined;
let edge: SetupEdge;
let mf: Miniflare | undefined;
let adminOrigin = "";
const seen: string[] = [];

test.afterAll(async () => {
  await mf?.dispose();
  await edge?.close();
  await oauth?.stop();
});

test(tag("E2E-017", "bootstrap: interrupted while deploying the admin app, then run again: the clients are made once, the admin app is deployed, the token deletes itself"), async () => {
  const upload = `PUT /accounts/${ACCOUNT}/workers/scripts/${APP_SCRIPTS.admin}`;
  world.cloud().override.set(upload, { status: 500, body: { success: false, errors: [{ code: 10013, message: "internal error" }], result: null } });
  const first = await setup(world, appDir);
  expect(first.status).toBe(1);
  expect(world.writes().some((w) => / DELETE /.test(w))).toBe(false);
  expect(readFileSync(join(appDir, ".env.cloudflare"), "utf8")).toContain(`CLOUDFLARE_BOOTSTRAP_TOKEN=${BOOT(4)}`);
  world.cloud().override.delete(upload);
  const again = await setup(world, appDir);
  expect(again.status, again.out).toBe(0);
  expect([...world.cloud().oauthClients.values()].map((c) => c.name).sort()).toEqual([CLIENT_NAMES.admin, CLIENT_NAMES.signin].sort());
  expect(world.token(`boot-${BOOT(4).slice(-6)}`).deleted).toBe(true);
  expect(readFileSync(join(appDir, ".env.cloudflare"), "utf8")).toMatch(/^# CLOUDFLARE_BOOTSTRAP_TOKEN=(?!e2e017)/m);
  expect(readFileSync(join(appDir, ".env.cloudflare"), "utf8")).not.toContain(BOOT(4));
  adminOrigin = /https:\/\/prototype-admin\.[a-z0-9-]+\.workers\.dev/.exec(again.out)?.[0] ?? "";
  expect(adminOrigin, "the bootstrap prints the admin app's URL").toBe(`https://${APP_SCRIPTS.admin}.${SUB}.workers.dev`);
});

/** The uploaded admin app's bindings as values: plain text as is, Secrets Store bindings read from the account's store. */
function uploadedEnv(): Record<string, { type: "text"; value: string }> {
  const worker = world.cloud().workers.get(APP_SCRIPTS.admin)!;
  const env: Record<string, { type: "text"; value: string }> = {};
  for (const b of worker.bindings as { type: string; name: string; text?: string; store_id?: string; secret_name?: string }[]) {
    if (b.type === "plain_text") env[b.name] = { type: "text", value: b.text ?? "" };
    else if (b.type === "secrets_store_secret") env[b.name] = { type: "text", value: world.cloud().secretStores.get(b.store_id!)!.secrets.get(b.secret_name!)!.value };
    else throw new Error(`the admin app has an unexpected binding ${b.type} ${b.name}`);
  }
  return env;
}

/** A browser: a cookie jar, Origin on POSTs, no redirects followed. */
class Browser {
  readonly jar = new Map<string, string>();
  async go(pathOrUrl: string, method: "GET" | "POST" = "GET"): Promise<{ status: number; location: string | null; text: string }> {
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${adminOrigin}${pathOrUrl}`;
    const headers: Record<string, string> = { cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ") };
    if (method === "POST") headers.origin = adminOrigin;
    // Through Miniflare's entry, as a request to the Worker's own URL (getWorker's route refuses a non-local Origin).
    const res = await mf!.dispatchFetch(url, { method, headers, redirect: "manual" });
    for (const c of res.headers.getSetCookie()) {
      const pair = c.split(";")[0] ?? "";
      const eq = pair.indexOf("=");
      if (/Max-Age=0/i.test(c)) this.jar.delete(pair.slice(0, eq));
      else this.jar.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
    const text = await res.text();
    seen.push(text, JSON.stringify([...res.headers]));
    return { status: res.status, location: res.headers.get("location"), text };
  }

  /** Starts a grant (`/signin` or a page), plays `sub` at the issuer's login, follows the callback. */
  async grant(path: string, sub: string): Promise<{ status: number; text: string; scope: string }> {
    const start = await this.go(path, "POST");
    expect(start.status, start.text).toBe(302);
    edge.noteAuthorize(start.location!);
    const login = await fetch(start.location!, { method: "POST", redirect: "manual", body: new URLSearchParams({ username: sub, claims: JSON.stringify({ sub, email: `${sub}@example.com`, email_verified: true }) }) });
    expect(login.status).toBe(302);
    return { ...(await this.go(login.headers.get("location")!)), scope: new URL(start.location!).searchParams.get("scope") ?? "" };
  }
}

test(tag("E2E-017", "admin app as deployed: an anonymous visitor, a member who is not an administrator and someone outside the account are refused; an administrator signs in"), async () => {
  test.setTimeout(600_000);
  expect(adminOrigin, "the bootstrap test ran first").not.toBe("");
  oauth = await startMockOAuth2();
  edge = await startSetupEdge(world, oauth.baseUrl);
  edge.members.set("owner", { roles: ["Super Administrator - All Privileges"] });
  edge.members.set("member", { roles: ["HTTP Applications Read"] });
  const worker = world.cloud().workers.get(APP_SCRIPTS.admin)!;
  mf = new Miniflare({
    handleStructuredLogs: (log) => void seen.push(JSON.stringify(log)),
    workers: [
      {
        config: {
          name: "admin",
          compatibilityDate: ADMIN_APP_COMPATIBILITY_DATE,
          compatibilityFlags: [...ADMIN_APP_COMPATIBILITY_FLAGS],
          manifest: { mainModule: "worker.js", modules: { "worker.js": { type: "esm" as const, contents: worker.modules!.get(ADMIN_APP_MODULE)! } } },
          // Cloudflare's OAuth and API are the local stand-ins (the settings only tests set, PAR-418).
          env: { ...uploadedEnv(), ADMIN_DISCOVERY_URL: { type: "text", value: edge.discoveryUrl }, ADMIN_API_BASE: { type: "text", value: edge.apiBase } },
        },
      },
    ],
  });
  const anonymous = new Browser();
  expect((await anonymous.go("/setup")).location).toBe("/");
  const refused = await anonymous.go("/setup", "POST");
  expect(refused.status, refused.text).toBe(401);
  for (const sub of ["member", "stranger"]) {
    const b = new Browser();
    expect((await b.grant("/signin", sub)).status, sub).toBe(403);
    expect(b.jar.has("__Host-admin-session"), sub).toBe(false);
  }
  const owner = new Browser();
  expect((await owner.grant("/signin", "owner")).status).toBe(303);
  expect((await owner.go("/")).text).toContain('href="/setup"');
});

test(tag("E2E-017", "account setup: an unticked scope is named and nothing is written; interrupted, then run again, it sets the account up once"), async () => {
  const owner = new Browser();
  await owner.grant("/signin", "owner");
  const before = world.cloud().requests.length;
  const edgeBefore = edge.writes.length;
  edge.untick.add("d1.write");
  const unticked = await owner.grant("/setup", "owner");
  edge.untick.clear();
  expect(unticked.status).toBe(403);
  expect(unticked.text).toContain("d1.write");
  expect(world.cloud().requests.slice(before).filter((r) => !r.startsWith("GET "))).toEqual([]);
  expect(edge.writes.slice(edgeBefore)).toEqual([]);

  // Interrupted at its last step, the setup record (every resource made, the record not written).
  const record = `PUT /accounts/${ACCOUNT}/r2/buckets/${STATE_BUCKET}/objects/${encodeURIComponent(ACCOUNT_SETTINGS_KEY)}`;
  world.cloud().override.set(record, { status: 500, body: { success: false, errors: [{ code: 10001, message: "internal error" }], result: null } });
  const interrupted = await owner.grant("/setup", "owner");
  world.cloud().override.delete(record);
  expect(interrupted.status, interrupted.text).not.toBe(200);
  expect(interrupted.text).toContain("Start again");
  const done = await owner.grant("/setup", "owner");
  expect(done.status, done.text).toBe(200);
  expect(world.cloud().workers.has(APP_SCRIPTS.signin), "the auth app is deployed").toBe(true);
  expect([...world.cloud().buckets.keys()]).toEqual(expect.arrayContaining(["prototype-logs", "sst-state", "prototype-backups"]));
  const workers = world.cloud().workers.size;
  expect((await owner.grant("/setup", "owner")).status, "run again").toBe(200);
  expect(world.cloud().workers.size).toBe(workers);
  // Nothing made twice across the interrupted run and both re-runs: one auth-app database, one signing token.
  expect(edge.databases.map((d) => d.name)).toEqual(["prototype-auth"]);
  expect([...world.cloud().tokens.values()].filter((t) => t.name === "prototype-r2-signing")).toHaveLength(1);
});

let everydayValue = "";
let everydayId = "";

test(tag("E2E-017", "everyday token: made through the grant with exactly the four groups, its value shown once on its page"), async () => {
  const owner = new Browser();
  await owner.grant("/signin", "owner");
  const page = await owner.grant("/everyday", "owner");
  expect(page.status, page.text).toBe(200);
  const made = world.tokens.find((t) => t.name === "prototype-framework" && !t.deleted)!;
  expect(made.policies.flatMap((p) => p.permission_groups.map((g) => g.id)).sort()).toEqual([...FOUR_GROUPS].sort());
  everydayValue = made.value;
  everydayId = made.id;
  expect(page.text.split(everydayValue)).toHaveLength(2);
});

test(tag("E2E-017", "no bootstrap or everyday token value, access token or client secret appears in any output, project file or admin-app response, except the everyday value on its own page"), () => {
  expect(everydayValue, "the everyday token test ran first").not.toBe("");
  const files = filesUnder(appDir).join("\n");
  const all = [...outputs, ...seen].join("\n");
  for (let n = 1; n <= 4; n++) expect(all + files).not.toContain(BOOT(n));
  expect(all.split(everydayValue)).toHaveLength(2);
  expect(files).not.toContain(everydayValue);
  for (const g of edge.grants) {
    expect(all).not.toContain(g.access);
    expect(all).not.toContain(g.refresh);
  }
  // Every secret the store holds, except the OAuth client IDs (identifiers, not secrets: plan §5.1 stores them beside their secrets).
  const ids = new Set(Object.values(CLIENT_SECRET_NAMES).map((n) => n.id));
  for (const store of world.cloud().secretStores.values()) for (const [name, s] of store.secrets) if (!ids.has(name)) expect(all + files, name).not.toContain(s.value);
});

// Fails until `57z-everyday-switch` (after C's 34a): cloudflare-setup still checks the 0.1.x seven-group set and the
// email domain's zone, so it refuses the four-group token page 2 makes (DEC-0716; root cause 2026-10-31-T2-E2E-017-setup-check-refuses-everyday-v2).
test(tag("E2E-017", "continue setup: cloudflare-setup with the everyday token the admin app made finds the account set up, and changes nothing"), async () => {
  expect(everydayValue, "the everyday token test ran first").not.toBe("");
  // The person saves it (plan §5.3 step 3); "continue prototype setup" checks that it works.
  writeFileSync(join(appDir, ".env.cloudflare"), `CLOUDFLARE_API_TOKEN=${everydayValue}\n`);
  const r = await setup(world, appDir);
  expect(r.status, r.out).toBe(0);
  expect(world.writes().filter((w) => w.startsWith(`${everydayId} `))).toEqual([]);
  expect(r.out).not.toContain(everydayValue);
});
